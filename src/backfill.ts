import { listYears, readYearFiles, type YearFile } from "./lake/parquet.ts";
import type { Station } from "./schema.ts";

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
 *   is fetched on every run until someone removes them;
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
 * set, so a file whose every provisional value carries one counts as done.
 *
 * Provisional years are fetched on every run, so a long campaign of runs
 * uses `--skip-written` (`yearWritten`) instead.
 *
 * A year the source returns nothing for writes no file, so it is fetched again
 * on every run in either mode; adapters that bound requests to each series'
 * dates (USGS, CO-OPS) send no request for those years.
 */
export function yearDone(file: YearFile | undefined, from: Date, to: Date, now: number): boolean {
  if (!wholeEndedYear(from, to, now)) return false;
  if (!file || file.preliminary > 0 || file.months < 12) return false;
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

function wholeEndedYear(from: Date, to: Date, now: number): boolean {
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

/** A CSV line's fields, with quoted fields unquoted and empty fields kept. */
function csvFields(line: string): string[] {
  const fields = [""];
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted && c === '"' && line[i + 1] === '"') {
      fields[fields.length - 1] += '"';
      i++;
    } else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) fields.push("");
    else fields[fields.length - 1] += c;
  }
  return fields;
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
 * listing, plus a read of years from `COMPACTED_SINCE` on; `none` fetches every year. A failed read throws, so the
 * caller fails the series rather than fetch every year again.
 */
export async function yearsToFetch(
  dir: string,
  start: Date,
  end: Date,
  mode: "complete" | "written" | "none",
  now: number,
): Promise<{ fetch: [Date, Date][]; skipped: number }> {
  const all = [...years(start, end)];
  // No whole ended year asked for means nothing to skip, so nothing to read.
  if (!all.some(([from, to]) => wholeEndedYear(from, to, now))) mode = "none";
  let done: (from: Date, to: Date) => boolean = () => false;
  if (mode === "written") {
    const listed = await listYears(dir);
    // Only the years compaction may have written need a read.
    const read = all
      .filter(([from, to]) => wholeEndedYear(from, to, now))
      .map(([from]) => from.getUTCFullYear())
      .filter((y) => y >= COMPACTED_SINCE && listed.has(y));
    const files = read.length
      ? await readYearFiles(dir, read, listed)
      : new Map<number, YearFile>();
    done = (from, to) => yearWritten(listed, from, to, now, files.get(from.getUTCFullYear()));
  } else if (mode === "complete") {
    const asked = all.filter(([from, to]) => wholeEndedYear(from, to, now));
    const files = await readYearFiles(
      dir,
      asked.map(([from]) => from.getUTCFullYear()),
    );
    done = (from, to) => yearDone(files.get(from.getUTCFullYear()), from, to, now);
  }
  const fetch = all.filter(([from, to]) => !done(from, to));
  return { fetch, skipped: all.length - fetch.length };
}

/** [start, end) split at UTC year boundaries. */
export function* years(start: Date, end: Date): Generator<[Date, Date]> {
  for (let t = start.getTime(); t < end.getTime();) {
    const next = Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
    yield [new Date(t), new Date(Math.min(next, end.getTime()))];
    t = next;
  }
}
