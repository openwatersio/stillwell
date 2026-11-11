/**
 * Errors in what a source publishes, found while ingesting it: values on the
 * wrong clock or day, positions far from the gauge, metadata that contradicts
 * the data, two endpoints that disagree. Each source's errata are in
 * `src/sources/<source>/errata.json`, which the adapter registry imports,
 * reviewed with the code that handles them. A `flagged` erratum with stations and a span is flagged `suspect` by
 * `withErrata` wherever the lake fetches or requalifies those values; other
 * handling is the adapter's, which cites the ID (`erratum \`<id>\``) where it
 * works around it. `publish` lists each station's errata in the `errata`
 * column of `stations.parquet` and writes them to `errata.json`. An entry
 * also records its report to the agency, which `npm run errata` drafts.
 * Once the agency fixes the data and the lake has refetched it, the entry
 * goes and its ID moves to `retired`. See CONTRIBUTING.md.
 */
import { Flag, Unjudged, type Observation, type Source, type Station } from "./schema.ts";

/** What the lake does about an erratum. */
export const HANDLING = ["corrected", "flagged", "dropped", "refused", "avoided", "kept"] as const;
/**
 * `corrected`: values or metadata changed to what the source should have
 * published. `flagged`: values kept, flagged `suspect` or worse. `dropped`:
 * stations or values left out. `refused`: the adapter refuses the file, so its
 * values are missing until it's fixed. `avoided`: the lake doesn't use the
 * wrong part, so nothing in it is affected. `kept`: kept as the source serves it.
 */
export type Handling = (typeof HANDLING)[number];

export interface Erratum {
  /** `<source>-<what>`, never reused. */
  id: string;
  source: string;
  /**
   * Lake station IDs known to be affected; null for every station of the
   * source. Partial or empty where the source doesn't say which stations, or
   * they aren't in the lake; `error` says which.
   */
  stations: string[] | null;
  /**
   * The UTC days of values the error is in, `since` to before `until`; null
   * for an open end or none. What the lake lacks or changed as a result can
   * be wider, and `response` says so.
   */
  since: string | null;
  until: string | null;
  /** What the source publishes wrong. */
  error: string;
  handling: Handling;
  /** What the lake does about it. */
  response: string;
  /** How it was found and how sure it is. */
  evidence: string | null;
  /** The day it was first reported to the agency; null until then. */
  reported: string | null;
  /** Where the report went and what the agency answered. */
  report: string | null;
}

export const REPO = "openwatersio/water-levels";
/** An entry's fields, so a misspelled one, which would widen or drop a span, is refused. */
const FIELDS = new Set([
  "id",
  "stations",
  "since",
  "until",
  "handling",
  "error",
  "response",
  "evidence",
  "reported",
  "report",
]);

/** A source's errata and retired IDs from its `errata.json`, or an Error saying what's wrong. */
export function parseErrata(
  source: string,
  data: unknown,
): { errata: Erratum[]; retired: string[] } {
  const where = `src/sources/${source}/errata.json`;
  const file = (data ?? {}) as { errata?: unknown; retired?: unknown };
  if (!Array.isArray(file.errata) || !Array.isArray(file.retired))
    throw new Error(`${where}: needs "errata" and "retired" arrays`);
  if (!file.retired.every((id) => typeof id === "string"))
    throw new Error(`${where}: "retired" holds something other than IDs`);
  const retired = file.retired as string[];
  const errata = (file.errata as Record<string, unknown>[]).map((raw, i) => {
    const at = `${where} #${i + 1}`;
    const unknown = Object.keys(raw).filter((k) => !FIELDS.has(k));
    if (unknown.length) throw new Error(`${at}: no field ${unknown.join(", ")}`);
    const text = (name: string, required: boolean): string | null => {
      const value = raw[name] ?? null;
      if (value !== null && (typeof value !== "string" || !value.trim()))
        throw new Error(`${at}: "${name}" isn't text`);
      if (required && value === null) throw new Error(`${at}: no "${name}"`);
      return value as string | null;
    };
    const day = (name: string): string | null => {
      const value = text(name, false);
      // A real day: Date rolls 2026-02-30 over to March, so it must come back the same.
      if (
        value !== null &&
        !(
          /^\d{4}-\d{2}-\d{2}$/.test(value) &&
          new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
        )
      )
        throw new Error(`${at}: "${name}" is ${value}, not YYYY-MM-DD`);
      return value;
    };
    const id = text("id", true)!;
    if (!new RegExp(`^${source}-[a-z0-9-]+$`).test(id))
      throw new Error(`${at}: ID ${id} isn't ${source}-<what>`);
    if (retired.includes(id)) throw new Error(`${at}: ID ${id} is retired`);
    const listed = raw.stations;
    if (
      listed !== "every station" &&
      !(Array.isArray(listed) && listed.every((s) => typeof s === "string"))
    )
      throw new Error(`${at}: "stations" is neither a list nor "every station"`);
    const stations = listed === "every station" ? null : (listed as string[]);
    for (const s of stations ?? [])
      if (!s.startsWith(`${source}/`)) throw new Error(`${at}: station ${s} isn't ${source}'s`);
    const [since, until] = [day("since"), day("until")];
    if (since && until && since >= until) throw new Error(`${at}: "since" isn't before "until"`);
    const handling = text("handling", true)!;
    if (!(HANDLING as readonly string[]).includes(handling))
      throw new Error(`${at}: handling ${handling} isn't one of ${HANDLING.join(", ")}`);
    return {
      id,
      source,
      stations,
      since,
      until,
      error: text("error", true)!,
      handling: handling as Handling,
      response: text("response", true)!,
      evidence: text("evidence", false),
      reported: day("reported"),
      report: text("report", false),
    };
  });
  return { errata, retired };
}

/**
 * Every source's errata, from each one's `errata.json`, by source ID, and what
 * is wrong with them: a file whose entries break the rules is left out whole,
 * and an ID two entries share or one retired anywhere leaves out the later
 * entry. The registry reads them as it loads, so such a file must cost only
 * its own errata, not every job; the tests and `publish` fail on the problems.
 * A file that isn't JSON at all fails the registry's import, which Prettier's
 * check and the tests catch before it merges.
 */
export function readErrata(files: Record<string, unknown>): {
  errata: Erratum[];
  problems: string[];
} {
  const problems: string[] = [];
  const all = Object.entries(files).flatMap(([source, data]) => {
    try {
      return [parseErrata(source, data)];
    } catch (error) {
      problems.push((error as Error).message);
      return [];
    }
  });
  const retired = new Set(all.flatMap((f) => f.retired));
  const seen = new Set<string>();
  const errata = all
    .flatMap((f) => f.errata)
    .filter((e) => {
      const problem = seen.has(e.id) ? "used twice" : retired.has(e.id) ? "retired" : null;
      if (problem) problems.push(`erratum ID ${e.id} is ${problem}`);
      seen.add(e.id);
      return !problem;
    });
  return { errata, problems };
}

/**
 * Spans of a station's values its `flagged` errata mark `suspect`: those that
 * name it, or every station, and bound a span. A flagged erratum without a span, such as GESLA's
 * datum jumps, is its adapter's to work out.
 */
export function spans(station: { id: string }, errata: Erratum[]): [number, number][] {
  return errata
    .filter(
      (e) =>
        e.handling === "flagged" &&
        (e.stations === null || e.stations.includes(station.id)) &&
        (e.since !== null || e.until !== null),
    )
    .map((e) => [
      e.since === null ? -Infinity : Date.parse(`${e.since}T00:00:00Z`),
      e.until === null ? Infinity : Date.parse(`${e.until}T00:00:00Z`),
    ]);
}

/**
 * The source with its errata's spans flagged: added to the spans `suspect`
 * returns, which `recent` and `requalify` apply to stored values, and marked
 * in the levels `observations` and `recent` fetch, keeping the source's own
 * flag as `source_flag`.
 */
export function withErrata(source: Source, errata: Erratum[]): Source {
  const own = errata.filter((e) => e.source === source.metadata.id);
  if (!own.some((e) => e.handling === "flagged")) return source;
  const mark = (station: { id: string }, rows: Observation[]): Observation[] => {
    const marked = spans(station, own);
    return rows.map((o) =>
      marked.some(([from, to]) => o.time >= from && o.time < to)
        ? {
            ...o,
            flag: Math.max(o.flag, Flag.suspect) as Flag,
            source_flag: o.source_flag ?? o.flag,
          }
        : o,
    );
  };
  const { suspect, observations, recent } = source;
  return {
    ...source,
    suspect: async (station, record) => {
      let adapter: [number, number][];
      try {
        adapter = (await suspect?.(station, record)) ?? [];
      } catch (error) {
        // The errata spans hold whatever the adapter can't judge.
        if (error instanceof Unjudged)
          throw new Unjudged(error.message, [...error.spans, ...spans(station, own)]);
        throw error;
      }
      return [...adapter, ...spans(station, own)];
    },
    ...(observations && {
      observations: async (station: Station, start: Date, end: Date) =>
        mark(station, await observations(station, start, end)),
    }),
    ...(recent && {
      recent: async (stations: Station[], start: Date, end: Date) => {
        const fetched = await recent(stations, start, end);
        return new Map(
          [...fetched].map(([id, rows]) => [id, rows instanceof Error ? rows : mark({ id }, rows)]),
        );
      },
    }),
  };
}

/** `errata.json`: each erratum with a link to the file it's kept in. */
export function published(errata: Erratum[]): object[] {
  return errata.map((e) => ({
    ...e,
    url: `https://github.com/${REPO}/blob/main/src/sources/${e.source}/errata.json`,
  }));
}

/** The IDs of the errata that affect a station. */
export function errataOf(station: { id: string; source: string }, errata: Erratum[]): string[] {
  return errata
    .filter((e) => e.source === station.source && (!e.stations || e.stations.includes(station.id)))
    .map((e) => e.id);
}
