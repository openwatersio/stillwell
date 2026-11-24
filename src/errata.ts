/**
 * Errors in what a source publishes, found while ingesting it: values on the
 * wrong clock or day, positions far from the gauge, metadata that contradicts
 * the data, two endpoints that disagree. Each source's errata are in
 * `src/sources/<source>/errata.ts`, which the adapter registry imports,
 * reviewed with the code that handles them. A `flagged` erratum with stations and a span is flagged `suspect` by
 * `withErrata` wherever the store fetches or requalifies those values; other
 * handling is the adapter's, which cites the ID (`erratum \`<id>\``) where it
 * works around it. `publish` lists each station's errata in the `errata`
 * column of `stations.parquet` and writes them to `errata.json`. An entry
 * also records its report to the agency, which `npm run errata` drafts.
 * Once the agency fixes the data and the store has refetched it, the entry
 * goes and its ID moves to `retired`. See docs/contributing/sources.md.
 */
import {
  Flag,
  Unjudged,
  type Observation,
  type Source,
  type Station,
  type StoredStation,
} from "./schema.ts";
import { possible } from "./span.ts";
import { median } from "./stats.ts";

/** What the store does about an erratum. */
export const HANDLING = ["corrected", "flagged", "dropped", "refused", "avoided", "kept"] as const;
/**
 * `corrected`: values or metadata changed to what the source should have
 * published. `flagged`: values kept, flagged `suspect` or worse. `dropped`:
 * stations or values left out. `refused`: the adapter refuses the file, so its
 * values are missing until it's fixed. `avoided`: the store doesn't use the
 * wrong part, so nothing in it is affected. `kept`: kept as the source serves it.
 */
export type Handling = (typeof HANDLING)[number];

export interface Erratum {
  /** `<source>-<what>`, never reused. */
  id: string;
  source: string;
  /**
   * Store station IDs known to be affected; null for every station of the
   * source. Partial or empty where the source doesn't say which stations, or
   * they aren't in the store; `error` says which. Other sources' records that
   * copy the source's values, such as GESLA's copy of a gauge, are listed here
   * too, so one erratum covers every record that carries the error.
   */
  stations: string[] | null;
  /**
   * The UTC days of values the error is in, `since` to before `until`; null
   * for an open end or none. What the store lacks or changed as a result can
   * be wider, and `response` says so.
   */
  since: string | null;
  until: string | null;
  /** What the source publishes wrong. */
  error: string;
  handling: Handling;
  /** What the store does about it. */
  response: string;
  /** How it was found and how sure it is. */
  evidence: string | null;
  /** The day it was first reported to the agency; null until then. */
  reported: string | null;
  /** Where the report went and what the agency answered. */
  report: string | null;
  /** Reads the store back and throws where it doesn't hold what the entry says (`npm run errata:check`). */
  check?: Check;
}

/**
 * Reads the store back, as a migration's check does, and throws where it
 * doesn't hold what the entry says: the error, as the store keeps it, and
 * what the store did about it, such as a span flagged, values shifted,
 * dropped or kept. A check that throws after a refetch means the source
 * changed the data, so the entry needs looking at again.
 */
export type Check = (store: StoreReader, erratum: Erratum) => Promise<void>;

/** What a check reads the store through; `npm run errata:check` gives it. */
export interface StoreReader {
  /** A station's levels at times from `since` to before `until` (UTC days, `YYYY-MM-DD`), from every epoch's files, by time. */
  levels(
    station: string,
    since: string,
    until: string,
  ): Promise<(Observation & { epoch: number })[]>;
  /** A station, of any source, as the store lists it in its source's list, or null when it doesn't. */
  station(id: string): Promise<StoredStation | null>;
  /** Every row of a Parquet file in the public store, by its path under the root, such as `stations.parquet`; none when there's no file. */
  rows(path: string): Promise<Record<string, unknown>[]>;
}

const DAY_MS = 86_400_000;

/** `day` (`YYYY-MM-DD`) as UTC midnight, refusing text that isn't a real day: `Date.parse` rolls 2023-04-31 over to May. */
export function utcDay(day: string): number {
  const time = Date.parse(`${day}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    Number.isNaN(time) ||
    new Date(time).toISOString().slice(0, 10) !== day
  )
    throw new Error(`${day} isn't a UTC day, YYYY-MM-DD`);
  return time;
}

/** The UTC day `n` days after `day`. */
export const dayAfter = (day: string, n: number) =>
  new Date(utcDay(day) + n * DAY_MS).toISOString().slice(0, 10);

/**
 * Throws unless a `flagged` entry's span holds each station's levels flagged
 * `suspect` or worse, read on the span's first, middle and last days, and no
 * day just outside it has more than half its levels flagged above a source
 * flag that was good. Inside the span `source_flag` isn't required, since a
 * value stored before it was kept and already suspect has none; outside, such
 * a value doesn't count. A day with no levels, such as one in a gap or a
 * dropped span, isn't judged, and a station with none on all three fails.
 * `stations` defaults to every station the entry lists. Pass `outside: false`
 * for a record whose values the day the span ends are suspect for a reason of
 * their own, such as a datum jump GESLA's rule finds there; the day before the
 * span is judged still.
 */
export async function flaggedSpan(
  store: StoreReader,
  e: Pick<Erratum, "id" | "stations" | "since" | "until">,
  stations: string[] = e.stations ?? [],
  { untilDay = true }: { untilDay?: boolean } = {},
): Promise<void> {
  if (!e.since && !e.until) throw new Error(`${e.id} has no span`);
  if (!stations.length) throw new Error(`${e.id} names no station to read`);
  // A span's middle day too, so one requalified only at its ends doesn't pass.
  const middle =
    e.since && e.until
      ? new Date((utcDay(e.since) + utcDay(e.until) - DAY_MS) / 2).toISOString().slice(0, 10)
      : null;
  const inside = [e.since, middle, e.until && dayAfter(e.until, -1)].filter(
    (d): d is string => !!d,
  );
  const outside = [e.since && dayAfter(e.since, -1), untilDay ? e.until : null].filter(
    (d): d is string => !!d,
  );
  for (const station of stations) {
    let read = 0;
    for (const day of new Set(inside)) {
      const rows = await store.levels(station, day, dayAfter(day, 1));
      read += rows.length;
      const missed = rows.filter((o) => o.flag < Flag.suspect);
      if (missed.length)
        throw new Error(
          `${missed.length} of ${station}'s ${rows.length} levels on ${day} aren't suspect`,
        );
    }
    if (!read) throw new Error(`the store holds no ${station} levels on ${inside.join(" or ")}`);
    for (const day of outside) {
      const rows = await store.levels(station, day, dayAfter(day, 1));
      // The source's own suspect flag is its call, not spill from the erratum.
      const flagged = rows.filter(
        (o) =>
          // A value without `source_flag` was stored before it was kept, so whose flag it is can't be told.
          o.flag >= Flag.suspect && o.source_flag !== undefined && o.source_flag < Flag.suspect,
      ).length;
      if (flagged > rows.length / 2)
        throw new Error(
          `${flagged} of ${station}'s ${rows.length} levels on ${day}, outside the span, are suspect`,
        );
    }
  }
}

/**
 * The median of `other`'s level minus `station`'s at the hours both hold from
 * `since` to before `until` (UTC days). Throws where they share under 300
 * hours, so an empty read never passes.
 */
export async function medianGap(
  store: StoreReader,
  station: string,
  other: string,
  since: string,
  until: string,
): Promise<number> {
  const [a, b] = await Promise.all([
    store.levels(station, since, until),
    store.levels(other, since, until),
  ]);
  const theirs = new Map(b.map((o) => [o.time, o.level]));
  const mine = new Map(a.map((o) => [o.time, o.level]));
  const gaps = [...mine].flatMap(([time, level]) =>
    theirs.has(time) ? [theirs.get(time)! - level] : [],
  );
  if (gaps.length < 300)
    throw new Error(
      `${station} and ${other} share only ${gaps.length} hours from ${since} to ${until}`,
    );
  return median(gaps);
}

/**
 * Throws unless the store holds `station`'s levels in `year` with no level
 * outside the store's span beside possible ones: those are dropped, and a year
 * file of nothing else keeps them flagged `bad`.
 */
export async function impossibleDropped(
  store: StoreReader,
  station: string,
  year: number,
): Promise<void> {
  const rows = await store.levels(station, `${year}-01-01`, `${year + 1}-01-01`);
  if (!rows.length) throw new Error(`the store holds no ${station} levels in ${year}`);
  const kept = rows.filter((o) => !possible(o.level));
  if (kept.length && kept.length < rows.length)
    throw new Error(
      `${station}'s ${year} holds ${kept.length} impossible levels beside possible ones`,
    );
  if (kept.some((o) => o.flag !== Flag.bad))
    throw new Error(`${station}'s ${year} holds impossible levels not flagged bad`);
}

/** A source's `errata.ts`: its errata as written, and the IDs it retired. */
export interface ErrataFile {
  errata: {
    id: string;
    stations: string[] | "every station";
    since?: string | null;
    until?: string | null;
    handling: Handling;
    error: string;
    response: string;
    evidence?: string | null;
    reported?: string | null;
    report?: string | null;
    check: Check;
  }[];
  retired: string[];
}

export const REPO = "openwatersio/stillwell";
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
  "check",
]);

/** A source's errata and retired IDs from its `errata.ts`, or an Error saying what's wrong. */
export function parseErrata(
  source: string,
  data: unknown,
): { errata: Erratum[]; retired: string[] } {
  const where = `src/sources/${source}/errata.ts`;
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
      if (value !== null)
        try {
          utcDay(value);
        } catch {
          throw new Error(`${at}: "${name}" is ${value}, not YYYY-MM-DD`);
        }
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
      if (!/^[a-z0-9-]+\/./.test(s)) throw new Error(`${at}: station ${s} isn't <source>/<id>`);
    // Another source's record is listed only beside the original it copies.
    if (stations?.length && !stations.some((s) => s.startsWith(`${source}/`)))
      throw new Error(`${at}: lists none of ${source}'s stations`);
    const [since, until] = [day("since"), day("until")];
    if (since && until && since >= until) throw new Error(`${at}: "since" isn't before "until"`);
    if (raw.check !== undefined && typeof raw.check !== "function")
      throw new Error(`${at}: "check" isn't a function`);
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
      ...(raw.check ? { check: raw.check as Check } : {}),
    };
  });
  return { errata, retired };
}

/**
 * Every source's errata, from each one's `errata.ts`, by source ID, and what
 * is wrong with them: a file whose entries break the rules is left out whole,
 * and an ID two entries share or one retired anywhere leaves out the later
 * entry, as does one listing a station of a source not in `known`. The registry reads them as it loads, so such a file must cost only
 * its own errata, not every job; the tests and `publish` fail on the problems.
 * A file that doesn't load fails the registry's import, which the type check
 * and the tests catch before it merges.
 */
export function readErrata(
  files: Record<string, unknown>,
  known: string[] = Object.keys(files),
): {
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
      // A copy's station is checked here, where every source is known: one of no source would flag nothing.
      const stranger = (e.stations ?? []).find(
        (id) => !known.includes(id.slice(0, id.indexOf("/"))),
      );
      if (stranger)
        problems.push(`erratum ${e.id} lists ${stranger}, a station of no registered source`);
      seen.add(e.id);
      return !problem && !stranger;
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
  const own = errata.filter((e) => covers(e, source.metadata.id));
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
      // The adapter judges the values outside the errata spans: an erratic span
      // mustn't move a median the adapter's rule reads, such as GESLA's datum
      // jumps, and flag the sound values around it. The values stay, so a
      // rule that needs the record's ends still sees them.
      const marked = spans(station, own);
      const judged = marked.length
        ? async function* () {
            for await (const rows of record())
              yield rows.map((o) =>
                marked.some(([from, to]) => o.time >= from && o.time < to)
                  ? {
                      ...o,
                      flag: Math.max(o.flag, Flag.suspect) as Flag,
                      source_flag: Math.max(o.source_flag ?? o.flag, Flag.suspect) as Flag,
                    }
                  : o,
              );
          }
        : record;
      try {
        adapter = (await suspect?.(station, judged)) ?? [];
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
  return errata.map(({ check: _, ...e }) => ({
    ...e,
    url: `https://github.com/${REPO}/blob/main/src/sources/${e.source}/errata.ts`,
  }));
}

/** The IDs of the errata that affect a station. */
export function errataOf(station: { id: string; source: string }, errata: Erratum[]): string[] {
  return errata
    .filter((e) => (e.stations ? e.stations.includes(station.id) : e.source === station.source))
    .map((e) => e.id);
}

/** Whether `e` is `source`'s, or lists one of its stations as a copy. */
export function covers(e: Erratum, source: string): boolean {
  return e.source === source || (e.stations ?? []).some((s) => s.startsWith(`${source}/`));
}
