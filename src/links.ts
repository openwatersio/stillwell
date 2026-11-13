import { CARRIED, sharedReference, TIDAL_KM } from "./datums.ts";
import { Flag, type Epoch, type Observation, type StoredStation } from "./schema.ts";
import { isMissing, readObservationFile, readRows, writeRows } from "./store/parquet.ts";
import { linksPath, seriesPath } from "./store/paths.ts";
import { readYears } from "./store/years.ts";
import { km } from "./ticon.ts";

/**
 * Offsets measured between linked series of one gauge from their levels, for pairs that share no reference datum to carry offsets through
 * (`sharedReference`), such as PEGELONLINE's gauges and WSV's GESLA files.
 * `measureLinks` writes them to `stations/links.parquet` once a month, and
 * publish carries MSL, LAT and chart datum along a pair that agrees
 * (`linkShifts`).
 */

/** One measured pair, `a` < `b`, each in its open epoch. */
export interface LinkOffset {
  a: string;
  b: string;
  a_epoch: number;
  b_epoch: number;
  /** The window measured, `[since, until)`, ISO times. */
  since: string;
  until: string;
  hours: number;
  /** Meters to add to a level in `a` to get the level in `b`: the median difference. */
  offset_m: number;
  /**
   * How far the monthly medians of the differences range: small for one
   * gauge recorded twice, large across a datum step or between two gauges
   * whose levels part with the river's flow.
   */
  spread_m: number;
}

const HOUR_MS = 3_600_000;
/** Fewer shared hours than this aren't measured: 30 days. */
export const MIN_HOURS = 720;
const MINUTE_MS = 60_000;
/** The widest spread publish carries offsets along. */
export const SPREAD_M = 0.01;
/** A month with fewer shared hours than this, 10 days, has no median of its own. */
const MONTH_HOURS = 240;
/** Months a pair needs with `MONTH_HOURS`, so the spread can show a step. */
const MIN_MONTHS = 2;
/** Years tried, latest first, before a pair waits for next month. */
const MAX_TRIES = 3;

const openEpoch = (s: StoredStation): Epoch | undefined =>
  s.epochs.filter((e) => e.state === "open").at(-1);

/** Whether a station has `key` of its own: its datum, or an offset publish didn't carry in. */
const own = (s: StoredStation, key: string) =>
  key === s.datum || (key in s.datums && s.datums_source?.[key] !== "computed");

/**
 * Linked pairs within `TIDAL_KM` that share no reference, where one has an
 * offset of its own the other lacks, both with levels in their open epochs,
 * and when those epochs' records overlap, `[start, end)`. Offsets publish
 * carried (`computed`) don't count, so a pair stays measured once they're carried.
 */
export function pairsToMeasure(
  stations: StoredStation[],
): { a: StoredStation; b: StoredStation; start: number; end: number }[] {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const pairs = [];
  for (const a of stations)
    for (const id of a.same_as ?? []) {
      const b = byId.get(id);
      if (!b || a.id >= b.id || km(a, b) > TIDAL_KM || sharedReference(a, b)) continue;
      const keys = [...CARRIED, a.chart_datum, b.chart_datum].filter((k): k is string => !!k);
      if (!keys.some((k) => own(a, k) !== own(b, k))) continue;
      const [ea, eb] = [openEpoch(a), openEpoch(b)];
      if (!ea || !eb || !a.products.includes("levels") || !b.products.includes("levels")) continue;
      const times = [a.first, b.first, ea.since, eb.since].filter((t): t is string => !!t);
      const start = Math.max(...times.map(Date.parse));
      // One interval past each last value, so the window holds it and its end stays exclusive.
      const past = (s: StoredStation) =>
        s.last ? Date.parse(s.last) + 1000 * (s.interval_s || 60) : Infinity;
      const end = Math.min(
        past(a),
        past(b),
        ...[ea.until, eb.until].map((t) => (t ? Date.parse(t) : Infinity)),
      );
      if (!a.first || !b.first || !a.last || !b.last || end - start < MIN_HOURS * HOUR_MS) continue;
      pairs.push({ a, b, start, end });
    }
  return pairs;
}

/** A series' good or preliminary levels in `[start, end)`, by whole minute. */
export function byMinute(rows: Observation[], start: number, end: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of rows)
    if (r.time >= start && r.time < end && !Number.isNaN(r.level))
      if (r.flag === Flag.good || r.flag === Flag.preliminary)
        out.set(Math.round(r.time / MINUTE_MS), r.level);
  return out;
}

/**
 * The median of `b - a` at the minutes both have a value, the first such in
 * each hour, so a series sampled every minute counts no more than an hourly
 * one; and how far the medians of months with `MONTH_HOURS` range. Null
 * under `MIN_HOURS`, or under `MIN_MONTHS` such months.
 */
export function measure(
  a: Map<number, number>,
  b: Map<number, number>,
): { hours: number; offset_m: number; spread_m: number } | null {
  const diffs = new Map<number, number>();
  for (const [minute, level] of a) {
    const other = b.get(minute);
    const hour = Math.floor(minute / 60);
    if (other !== undefined && !diffs.has(hour)) diffs.set(hour, other - level);
  }
  if (diffs.size < MIN_HOURS) return null;
  const months = new Map<string, number[]>();
  for (const [hour, d] of diffs) {
    const month = new Date(hour * HOUR_MS).toISOString().slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), d]);
  }
  const medians = [...months.values()].filter((m) => m.length >= MONTH_HOURS).map(median);
  if (medians.length < MIN_MONTHS) return null;
  return {
    hours: diffs.size,
    offset_m: round(median([...diffs.values()])),
    spread_m: round(Math.max(...medians) - Math.min(...medians)),
  };
}

/**
 * The years to measure a pair in, one file each, latest first: those of
 * their overlap in which both files hold `MIN_HOURS` hours of any flag, by
 * `hours` (`<id> <epoch> <year>` to the hours its file holds, from the
 * sources' years files). Whether enough of them are shared and usable shows
 * only once they're read.
 */
export function yearsToMeasure(
  a: StoredStation,
  b: StoredStation,
  start: number,
  end: number,
  hours: Map<string, number>,
): number[] {
  const has = (s: StoredStation, y: number) =>
    (hours.get(`${s.id} ${openEpoch(s)!.id} ${y}`) ?? 0) >= MIN_HOURS;
  const years = [];
  for (let y = new Date(end - 1).getUTCFullYear(); y >= new Date(start).getUTCFullYear(); y--)
    if (has(a, y) && has(b, y)) years.push(y);
  return years;
}

/** A station's open epoch's values in one year's file, between `start` and `end`, by minute; null when the file is gone. */
async function levels(
  store: string,
  s: StoredStation,
  year: number,
  start: number,
  end: number,
): Promise<Map<number, number> | null> {
  const path = seriesPath(store, "levels", s.source, s.source_id, year, openEpoch(s)!.id);
  try {
    const { rows } = await readObservationFile(path);
    // A local store reads a missing file as no rows; a written file always has some.
    return rows.length ? byMinute(rows, start, end) : null;
  } catch (error) {
    // The years file can lag a rewrite that removed the file.
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * Measures every pair `pairsToMeasure` finds, `concurrency` at a time, in
 * the latest of the first `MAX_TRIES` years `yearsToMeasure` gives that
 * measures. Every `previous` row the run doesn't replace is kept, unless its
 * pair's values were read and didn't measure, a station it names has opened
 * another epoch since, or its listed stations are no longer linked: a missing list, years file or level file, a
 * rewrite in progress (marked in the years file) or a failed read
 * (`failed`) takes no offsets away.
 */
export async function measureLinks(
  store: string,
  stations: StoredStation[],
  concurrency: number,
  previous: LinkOffset[] = [],
): Promise<{ rows: LinkOffset[]; failed: number }> {
  const pairs = pairsToMeasure(stations);
  const hours = new Map<string, number>();
  const marked = new Set<string>();
  for (const source of new Set(pairs.flatMap((p) => [p.a.source, p.b.source])))
    for (const r of (await readYears(store, source))?.values() ?? [])
      if (r.year === null) marked.add(r.id);
      else if (r.hours) hours.set(`${r.id} ${r.epoch} ${r.year}`, r.hours);
  const fresh = new Map<string, LinkOffset>();
  const dropped = new Set<string>();
  let [next, failed] = [0, 0];
  const worker = async () => {
    while (next < pairs.length) {
      const { a, b, ...overlap } = pairs[next++]!;
      const key = `${a.id} ${b.id}`;
      if (marked.has(a.id) || marked.has(b.id)) continue;
      let read = false;
      try {
        for (const year of yearsToMeasure(a, b, overlap.start, overlap.end, hours).slice(
          0,
          MAX_TRIES,
        )) {
          const start = Math.max(overlap.start, Date.UTC(year, 0, 1));
          const end = Math.min(overlap.end, Date.UTC(year + 1, 0, 1));
          const [x, y] = [
            await levels(store, a, year, start, end),
            await levels(store, b, year, start, end),
          ];
          // A file gone since the years file was written: try again next month.
          if (!x || !y) {
            read = false;
            break;
          }
          read = true;
          const m = measure(x, y);
          if (!m) continue;
          const [since, until] = [new Date(start).toISOString(), new Date(end).toISOString()];
          const [a_epoch, b_epoch] = [openEpoch(a)!.id, openEpoch(b)!.id];
          fresh.set(key, { a: a.id, b: b.id, a_epoch, b_epoch, since, until, ...m });
          break;
        }
      } catch (error) {
        console.error(`${key}: ${String(error)}`);
        [read, failed] = [false, failed + 1];
      }
      if (read && !fresh.has(key)) dropped.add(key);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  const byId = new Map(stations.map((s) => [s.id, s]));
  const moved = (id: string, epoch: number) => {
    const s = byId.get(id);
    return s !== undefined && openEpoch(s)?.id !== epoch;
  };
  // A pair both of whose stations are listed but no longer linked is no longer one gauge.
  const unlinked = (r: LinkOffset) =>
    byId.has(r.a) && byId.has(r.b) && !byId.get(r.a)!.same_as.includes(r.b);
  const kept = previous.filter((r) => {
    const key = `${r.a} ${r.b}`;
    return (
      !fresh.has(key) &&
      !dropped.has(key) &&
      !moved(r.a, r.a_epoch) &&
      !moved(r.b, r.b_epoch) &&
      !unlinked(r)
    );
  });
  console.error(
    `measured ${fresh.size} of ${pairs.length} linked pairs, kept ${kept.length} from before, dropped ${dropped.size}; ${failed} failed`,
  );
  const rows = [...fresh.values(), ...kept];
  return { rows: rows.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b)), failed };
}

/**
 * Meters to add to a level in one series to get its linked series', keyed
 * `<from> <to>` both ways, for pairs that agree and are still measured in
 * each station's open epoch: a new epoch waits for the next measurement.
 */
export function linkShifts(rows: LinkOffset[], stations: StoredStation[]): Map<string, number> {
  const byId = new Map(stations.map((s) => [s.id, s]));
  const shifts = new Map<string, number>();
  for (const r of rows) {
    const [a, b] = [byId.get(r.a), byId.get(r.b)];
    if (!a || !b || r.hours < MIN_HOURS || !(r.spread_m <= SPREAD_M)) continue;
    // A station moved since must be measured again before its pair counts.
    if (km(a, b) > TIDAL_KM) continue;
    if (openEpoch(a)?.id !== r.a_epoch || openEpoch(b)?.id !== r.b_epoch) continue;
    shifts.set(`${r.a} ${r.b}`, r.offset_m);
    shifts.set(`${r.b} ${r.a}`, round(-r.offset_m));
  }
  return shifts;
}

const COLUMNS = {
  a: "VARCHAR",
  b: "VARCHAR",
  a_epoch: "INTEGER",
  b_epoch: "INTEGER",
  since: "TIMESTAMPTZ",
  until: "TIMESTAMPTZ",
  hours: "INTEGER",
  offset_m: "DOUBLE",
  spread_m: "DOUBLE",
};

export function writeLinks(store: string, rows: LinkOffset[]): Promise<void> {
  return writeRows(linksPath(store), rows, COLUMNS, "a, b");
}

/** The measured pairs, none before the first measurement. */
export async function readLinks(store: string): Promise<LinkOffset[]> {
  return (await readRows(linksPath(store))).map((r) => ({
    a: String(r.a),
    b: String(r.b),
    a_epoch: Number(r.a_epoch),
    b_epoch: Number(r.b_epoch),
    since: iso(r.since),
    until: iso(r.until),
    hours: Number(r.hours),
    offset_m: Number(r.offset_m),
    spread_m: Number(r.spread_m),
  }));
}

/** A TIMESTAMPTZ as DuckDB returns it, in ISO form. */
const iso = (value: unknown) =>
  new Date(Number((value as { micros: bigint }).micros / 1000n)).toISOString();

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round = (x: number) => Math.round(x * 1e4) / 1e4 || 0;
