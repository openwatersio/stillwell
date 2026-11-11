import { currentEpoch } from "./epochs.ts";
import { mergeFetched, sameRows } from "./lake/merge.ts";
import {
  asWritten,
  listYears,
  readExtremeFile,
  readObservationFile,
  readTimeBounds,
  readYearFiles,
  writeExtremes,
  writeObservations,
  type YearStats,
  type StationBounds,
  type YearFile,
} from "./lake/parquet.ts";
import { csvFields } from "./csv.ts";
import { qcFor, refuseOtherDatum } from "./lake/recent.ts";
import { judgeFetched } from "./lake/requalify.ts";
import type {
  Epoch,
  LakeStation,
  Observation,
  Product,
  PublishedExtreme,
  Source,
  SourceMetadata,
  Station,
} from "./schema.ts";

const DAY_MS = 86_400_000;

/**
 * Whether backfill can skip a year it was asked for, given that year's file.
 * A year is done when:
 *
 * - the request covers the whole calendar year, so a run over part of a year
 *   always fetches it;
 * - the year has ended, so the current year (and any later one) is always fetched;
 * - its file exists and holds no `preliminary` values, so provisional USGS and
 *   preliminary CO-OPS values are fetched again until the source approves them.
 *   A month whose provisional values the source later withdraws keeps them,
 *   since a month the fetch returns nothing for keeps what it had, so that year
 *   is fetched on every run until someone removes them. A year that ends by
 *   the station's `source_qc_start` (`qcStart`), stated or inferred, is the
 *   exception: the source won't check those values, so they stay
 *   `preliminary` for good;
 * - it has values in every month and its last value is in the year's last 7
 *   days, so a file an earlier run wrote over part of the year, or with a month
 *   the source returned nothing for, is fetched again. A station that began or
 *   stopped partway through a year, or a seasonal gauge, has that year fetched
 *   again each run, which is one request at USGS and a month's worth at CO-OPS.
 *
 * A value QC raised from preliminary to `suspect` keeps `preliminary` in
 * `source_flag`, and counts here as provisional. Files written before
 * `source_flag` existed have none, so there a value QC flagged that way
 * doesn't count, and a year whose every provisional value QC flagged is done. A source qualifier such as
 * USGS's ICE is mapped to `suspect` by the adapter, before `source_flag` is
 * set, so a file whose every provisional value carries one counts as done. An
 * adapter's own verdict, such as REFMAR's suspect clock spans, sets
 * `source_flag` to the source's flag itself.
 *
 * Provisional years are fetched on every run, so a long campaign of runs
 * uses `--skip-written` (`yearWritten`) instead.
 *
 * A year the source returns nothing for writes no file, so it is fetched again
 * on every run in either mode; adapters that bound requests to each series'
 * dates (USGS, CO-OPS) send no request for those years outside them. Within
 * them, `--skip-written` records the years it found empty and skips them for
 * 30 days (`src/empty-years.ts`).
 */
export function yearDone(
  file: YearFile | undefined,
  from: Date,
  to: Date,
  now: number,
  qcStart?: string | null,
): boolean {
  if (!wholeEndedYear(from, to, now)) return false;
  const unchecked = qcStart != null && to.getTime() <= Date.parse(qcStart);
  if (!file || (file.preliminary > 0 && !unchecked) || file.months < 12) return false;
  return file.last >= to.getTime() - 7 * DAY_MS;
}

/**
 * For `--skip-written`: whether a year has a file at all, complete or not, for
 * a whole year that has ended. From `COMPACTED_SINCE` on, the file must also
 * have values in every month or hold values backfill wrote. A partial request and the current year are
 * still fetched, so a file this campaign writes is always a whole ended year;
 * a file an earlier run wrote partway through its year, or with a month the
 * source returned nothing for, is skipped all the same.
 */
export function yearWritten(
  written: Set<number>,
  from: Date,
  to: Date,
  now: number,
  file?: YearFile,
): boolean {
  const year = from.getUTCFullYear();
  if (!wholeEndedYear(from, to, now) || !written.has(year)) return false;
  if (year < COMPACTED_SINCE) return true;
  return file !== undefined && (file.months === 12 || file.backfilled > 0);
}

/**
 * The first year compaction writes year files for. It began in November 2026,
 * so it created that year's files from the year's last weeks alone. From this
 * year on, a file counts as written for `--skip-written` only if it has values
 * in every month, as a year compaction carried through does, or holds values
 * backfill wrote (no `received` time; compacted values always have one).
 * Backfill over compacted values keeps their `received`, so a backfilled year
 * is known by its months, not by that. A station that began partway through a
 * year and was never backfilled has that year fetched on every run, one
 * request at USGS, and so does one whose values the hourly sweep had all
 * caught before backfill ran over them, since those keep their `received`.
 */
export const COMPACTED_SINCE = 2026;

export function wholeEndedYear(from: Date, to: Date, now: number): boolean {
  const year = from.getUTCFullYear();
  const end = Date.UTC(year + 1, 0, 1);
  return from.getTime() === Date.UTC(year, 0, 1) && to.getTime() === end && end <= now;
}

/**
 * Station IDs from a file, one per line, for `--first`: a plain list (blank
 * lines and `#` comments skipped), or a CSV with a header, whose
 * `replacement_id`, `id` or `station` column is used, so
 * docs/ticon-replacement.csv works as it is. IDs may be bare (`07010000`) or
 * carry their source (`usgs/07010000`); ones for another source are dropped.
 */
export function parseStationList(text: string, sourceId: string, csv: boolean): string[] {
  let lines = text.split(/\r?\n/).map((l) => l.trim());
  if (csv) {
    const header = csvFields(lines.shift() ?? "");
    const column = ["replacement_id", "id", "station"]
      .map((c) => header.indexOf(c))
      .find((i) => i >= 0);
    if (column === undefined) throw new Error("CSV needs a replacement_id, id or station column");
    lines = lines.map((l) => csvFields(l)[column] ?? "");
  } else lines = lines.map((l) => l.replace(/#.*/, "").trim());
  const ids: string[] = [];
  for (const line of lines) {
    if (!line) continue;
    const slash = line.indexOf("/");
    if (slash >= 0 && line.slice(0, slash) !== sourceId) continue;
    ids.push(slash >= 0 ? line : `${sourceId}/${line}`);
  }
  return [...new Set(ids)];
}

/** The stations named in `first`, in its order, then the rest in theirs. */
export function orderStations<T extends Pick<Station, "id">>(stations: T[], first: string[]): T[] {
  const rank = new Map(first.map((id, i) => [id, i]));
  const named = stations
    .filter((s) => rank.has(s.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...named, ...stations.filter((s) => !rank.has(s.id))];
}

/**
 * Shard `index` of `count` (1-based): the stations whose ID hashes to it, so a
 * station always lands in the same shard, whatever order `--first` asks for and
 * however the station list changes between one shard's run and the next.
 */
export function shard<T extends Pick<Station, "id">>(
  stations: T[],
  index: number,
  count: number,
): T[] {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    !Number.isInteger(index) ||
    index < 1 ||
    index > count
  )
    throw new Error(`Not a shard: ${index}/${count}`);
  return stations.filter((s) => hash(s.id) % count === index - 1);
}

/** FNV-1a, 32 bits: stable across runs, machines and Node versions. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h;
}

/** Parses `--shard 2/8`. */
export function parseShard(value: string): [number, number] {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) throw new Error(`--shard takes INDEX/COUNT, such as 2/8, not ${value}`);
  return [Number(match[1]), Number(match[2])];
}

/**
 * Which years of one station's series backfill fetches over [start, end), and
 * how many it skips: `complete` skips what `yearDone` calls done, from one read
 * of the series directory; `written` skips what `yearWritten` does, from a
 * listing, plus a read of years from `COMPACTED_SINCE` on; `none` fetches every year. Both
 * skipping modes return the years their listing found (`listed`). A failed read throws, so the
 * caller fails the series rather than fetch every year again.
 */
export async function yearsToFetch(
  dir: string,
  start: Date,
  end: Date,
  mode: "complete" | "written" | "none",
  now: number,
  qcStart?: string | null,
): Promise<{ fetch: [Date, Date][]; skipped: number; listed?: Set<number> }> {
  const all = [...years(start, end)];
  // No whole ended year asked for means nothing to skip, so nothing to read.
  if (!all.some(([from, to]) => wholeEndedYear(from, to, now))) mode = "none";
  let done: (from: Date, to: Date) => boolean = () => false;
  let listed: Set<number> | undefined;
  if (mode === "written") {
    const found = await listYears(dir);
    listed = found;
    // Only the years compaction may have written need a read.
    const read = all
      .filter(([from, to]) => wholeEndedYear(from, to, now))
      .map(([from]) => from.getUTCFullYear())
      .filter((y) => y >= COMPACTED_SINCE && found.has(y));
    const files = read.length ? await readYearFiles(dir, read, found) : new Map<number, YearFile>();
    done = (from, to) => yearWritten(found, from, to, now, files.get(from.getUTCFullYear()));
  } else if (mode === "complete") {
    const asked = all.filter(([from, to]) => wholeEndedYear(from, to, now));
    listed = await listYears(dir);
    const files = await readYearFiles(
      dir,
      asked.map(([from]) => from.getUTCFullYear()),
      listed,
    );
    done = (from, to) => yearDone(files.get(from.getUTCFullYear()), from, to, now, qcStart);
  }
  const fetch = all.filter(([from, to]) => !done(from, to));
  return { fetch, skipped: all.length - fetch.length, listed };
}

/** [start, end) split at UTC year boundaries. */
export function* years(start: Date, end: Date): Generator<[Date, Date]> {
  for (let t = start.getTime(); t < end.getTime();) {
    const next = Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
    yield [new Date(t), new Date(Math.min(next, end.getTime()))];
    t = next;
  }
}

/**
 * For `backfill <source> preliminary <start> <end>`: every station whose
 * bounds hold a preliminary value, active or not, with the range to fetch:
 * from that value's month, or from `start` when it's earlier, to `end`, or to
 * the end of the year of the station's last value when that's sooner. A
 * station whose earliest preliminary value is before `start` is past the
 * cutoff and listed in `past`; it's still fetched from `start` when its last
 * value is after it, since its later values may be preliminary too. With
 * `skipUnscreened`, a station with at least a year of record in its current
 * epoch and no value there the source screened is left out and listed in `unscreened`, since a source
 * that screens nothing, such as some USACE offices, would have it fetched
 * every month for nothing; one whose `screened` isn't known yet isn't.
 */
export function preliminaryRuns<T extends Pick<LakeStation, "id" | "products" | "epochs">>(
  stations: T[],
  bounds: Map<string, StationBounds>,
  start: Date,
  end: Date,
  skipUnscreened = false,
): {
  runs: { station: T; from: Date; to: Date }[];
  past: { id: string; preliminary: string }[];
  unscreened: string[];
} {
  const runs: { station: T; from: Date; to: Date }[] = [];
  const past: { id: string; preliminary: string }[] = [];
  const unscreened: string[] = [];
  for (const station of stations) {
    const { preliminary, first, last, screened } = bounds.get(station.id) ?? {};
    // A station whose list dropped levels can't have them read again.
    if (!preliminary || !station.products.includes("levels")) continue;
    if (
      skipUnscreened &&
      screened === false &&
      first &&
      last &&
      Date.parse(last) - recordSince(station, first) >= 365 * DAY_MS
    ) {
      unscreened.push(station.id);
      continue;
    }
    const time = new Date(preliminary);
    if (time < start) past.push({ id: station.id, preliminary });
    const month = Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), 1);
    const from = new Date(Math.max(start.getTime(), month));
    const lastYear = last ? new Date(last).getUTCFullYear() : NaN;
    const to = new Date(Math.min(end.getTime(), Date.UTC(lastYear + 1, 0, 1) || Infinity));
    if (from < to) runs.push({ station, from, to });
  }
  return { runs, past, unscreened };
}

/** Where a station's record in its current epoch starts: its first value, or the epoch's start if later. */
function recordSince(station: Pick<LakeStation, "epochs">, first: string): number {
  const since = station.epochs.filter((e) => e.state === "open").at(-1)?.since;
  return Math.max(Date.parse(first), since ? Date.parse(since) : -Infinity);
}

/**
 * The earliest value a station's series directory holds inside `window`,
 * `[since, until)` in milliseconds, in its files from `fromYear` on, that the
 * source sent as preliminary, or null when it holds none: the rows compaction
 * counts for the same epoch and years. With it, whether any value there is
 * one the source screened.
 */
export async function earliestPreliminary(
  dir: string,
  window: [number, number] = [-Infinity, Infinity],
  fromYear = -Infinity,
): Promise<{ preliminary: number | null; screened: boolean }> {
  const years = [...(await listYears(dir))].filter((y) => y >= fromYear);
  const read = [
    ...(await readTimeBounds(years.map((y) => ({ file: `${dir}/${y}.parquet`, window })))).values(),
  ];
  const times = read.flatMap(([, , p]) => p ?? []);
  return {
    preliminary: times.length ? Math.min(...times) : null,
    screened: read.some(([, , , screened]) => screened),
  };
}

/**
 * The epochs a backfill over [start, end) writes, each with the part of the
 * range in its span: the current one, never before its start, since earlier
 * values are in another reference. An `archive: "previous"` source serves past
 * values in the reference of their time, so its current epoch also never
 * starts before the reference it names, which a station with more than one
 * epoch records without a split; and each closed epoch under the same label,
 * as a split leaves, gets its own span. So does each closed epoch before one a
 * hand-entered split opened (`splits`, the instants from `splitStarts`), whose
 * source serves its span on the zero of its time, as it always has; the next
 * epoch's start says so even after a decision ends this one earlier. A closed epoch under another label isn't, since the
 * source serves only the station's current one.
 */
export function epochSpans(
  epochs: Epoch[],
  start: Date,
  end: Date,
  archive: SourceMetadata["archive"],
  splits: Set<string> = new Set(),
): { epoch: Epoch; from: Date; to: Date }[] {
  const current = currentEpoch(epochs);
  const at = (iso: string | null, fallback: number) => (iso === null ? fallback : Date.parse(iso));
  const previous = archive === "previous";
  const currentStart = Math.max(
    at(current.since, -Infinity),
    previous ? at(current.reference_since, -Infinity) : -Infinity,
  );
  // Ids run in time order; a rejected or held epoch doesn't follow anything.
  const nextOf = (e: Epoch) =>
    epochs.find((x) => x.id > e.id && (x.state === "open" || x.state === "closed"));
  return epochs
    .filter(
      (e) =>
        e === current ||
        (e.state === "closed" &&
          e.datum === current.datum &&
          (previous || splits.has(nextOf(e)?.since ?? ""))),
    )
    .map((epoch) => {
      const from = epoch === current ? currentStart : at(epoch.since, -Infinity);
      // A closed epoch never reaches into the current one's span, whatever its own says.
      const to = epoch === current ? Infinity : Math.min(at(epoch.until, Infinity), currentStart);
      return {
        epoch,
        from: new Date(Math.max(start.getTime(), from)),
        to: new Date(Math.min(end.getTime(), to)),
      };
    })
    .filter(({ from, to }) => from < to);
}

/** A year file's rows and the datums it holds. */
export type YearRead<T> = { rows: T[]; datums: string[] };

/**
 * One series' year files as a backfill walk reads them: each at most once, and
 * none the walk's listing (`listed`) didn't find, so a station new to the lake
 * costs no read. Backfill walks the years in order and QCs each with the years
 * either side, so the year it read as one year's neighbor is the next it merges
 * into, and the year it just wrote is the next one's context. It holds the
 * year before the last one asked for, on.
 *
 * Nothing here sees another writer's change during the walk. On Actions the
 * `lake-<source>` concurrency group keeps every writer of a source's files to
 * one job at a time; a local run must not overlap another that writes the
 * same source, which would race a read-then-write without the cache too.
 */
export function seriesFiles<T>(
  dir: string,
  listed: Set<number>,
  read: (path: string) => Promise<YearRead<T>>,
) {
  listed = new Set(listed);
  const held = new Map<number, Promise<YearRead<T>>>();
  const path = (year: number) => `${dir}/${year}.parquet`;
  return {
    path,
    get(year: number): Promise<YearRead<T>> {
      for (const y of held.keys()) if (y < year - 1) held.delete(y);
      let file = held.get(year);
      if (!file) {
        file = listed.has(year) ? read(path(year)) : Promise.resolve({ rows: [], datums: [] });
        held.set(year, file);
        // A failed read is tried again by the next year that needs it.
        const mine = file;
        file.catch(() => held.get(year) === mine && held.delete(year));
      }
      return file;
    },
    /** What a write left in the year's file, or `undefined` when that isn't known. */
    wrote(year: number, file?: YearRead<T>): void {
      listed.add(year);
      if (file) held.set(year, Promise.resolve(file));
      else held.delete(year);
    },
  };
}

export type SeriesFiles<T> = ReturnType<typeof seriesFiles<T>>;

/** The reader for a product's year files. */
export function readerOf(product: Product) {
  return product === "levels" || product === "predictions" ? readObservationFile : readExtremeFile;
}

/**
 * Fetch one year of a series and merge it into its file, read through
 * `files`. Returns how many rows the year's file now holds, undefined when
 * nothing changed, or `empty` when the source returned nothing for the year.
 * A year file of levels it writes goes in `written`, for the source's years.
 */
export async function backfillYear(
  source: Source,
  station: LakeStation,
  product: Product,
  from: Date,
  to: Date,
  epoch: Epoch,
  files: SeriesFiles<Observation> | SeriesFiles<PublishedExtreme>,
  written: Map<string, YearStats>,
): Promise<number | "empty" | undefined> {
  // The epoch's own datum, which a closed epoch keeps when the station's moves on.
  station = { ...station, datum: epoch.datum };
  const year = from.getUTCFullYear();
  const path = files.path(year);
  const range = [from.getTime(), to.getTime()] as const;
  if (product === "levels" || product === "predictions") {
    const series = files as SeriesFiles<Observation>;
    const get = product === "levels" ? source.observations : source.predictions;
    if (!get) return undefined;
    const rows = await get(station, from, to);
    // An empty fetch is an outage, a year the source no longer publishes, or a
    // datum it no longer serves; it never empties a file.
    if (!rows.length) return "empty";
    const { rows: existing, datums } = await series.get(year);
    await refuseOtherDatum(path, station, datums);
    let merged = mergeFetched(existing, rows, ...range);
    if (product === "levels")
      merged = judgeFetched(existing, rows, ...range, qcFor(station), [
        ...(await series.get(year - 1)).rows,
        ...(await series.get(year + 1)).rows,
      ]);
    if (!merged.length || sameRows(existing, merged)) return undefined;
    let stats: YearStats;
    try {
      stats = await writeObservations(path, merged, station.datum);
    } catch (error) {
      series.wrote(year);
      throw error;
    }
    series.wrote(year, { rows: asWritten(merged), datums: [station.datum] });
    if (product === "levels") written.set(path, stats);
    return merged.length;
  }
  const series = files as SeriesFiles<PublishedExtreme>;
  const get = product === "extremes" ? source.extremes : source.predictedExtremes;
  if (!get) return undefined;
  const rows = await get(station, from, to);
  if (!rows.length) return "empty";
  const { rows: existing, datums } = await series.get(year);
  await refuseOtherDatum(path, station, datums);
  const merged = mergeFetched<PublishedExtreme>(existing, rows, ...range);
  if (!merged.length || sameRows(existing, merged)) return undefined;
  // No later year reads it back, so the walk forgets it.
  series.wrote(year);
  await writeExtremes(path, merged, station.datum);
  return merged.length;
}
