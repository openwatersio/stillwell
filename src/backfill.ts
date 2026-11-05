import type { YearFile } from "./lake/parquet.ts";
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
 *   preliminary CO-OPS values are fetched again until the source approves them;
 * - it has values in every month and its last value is in the year's last 7
 *   days, so a file an earlier run wrote over part of the year, or with a month
 *   the source returned nothing for, is fetched again. A station that began or
 *   stopped partway through a year, or a seasonal gauge, has that year fetched
 *   again each run, which is one request at USGS and a month's worth at CO-OPS.
 *
 * A value both provisional and `suspect` or `bad`, from QC or a source
 * qualifier such as USGS's ICE, is stored as the worse flag, so this can't see
 * it was provisional; a file whose every provisional value is flagged that way
 * counts as done.
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
 * a whole year that has ended. A partial request and the current year are
 * still fetched, so a file this campaign writes is always a whole ended year;
 * a file an earlier run wrote partway through its year, or with a month the
 * source returned nothing for, is skipped all the same.
 */
export function yearWritten(written: Set<number>, from: Date, to: Date, now: number): boolean {
  return wholeEndedYear(from, to, now) && written.has(from.getUTCFullYear());
}

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

/** A CSV line's fields, with quoted fields unquoted. */
function csvFields(line: string): string[] {
  return [...line.matchAll(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)].map((m) => {
    const field = m[1]!;
    return field.startsWith('"') ? field.slice(1, -1).replaceAll('""', '"') : field;
  });
}

/** The stations named in `first`, in its order, then the rest in theirs. */
export function orderStations(stations: Station[], first: string[]): Station[] {
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
export function shard(stations: Station[], index: number, count: number): Station[] {
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
