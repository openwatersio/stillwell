import { monthlyAgreement, SAME_GAUGE, type Hourly } from "./cross-check.ts";
import { distanceKm as km, median } from "./stats.ts";
import type { StoredStation } from "./schema.ts";
import { comparable, joinsNoGroup } from "./same-as.ts";
import { FILES } from "./store/files.ts";
import { isMissing, readHourly, readRows, writeTable } from "./store/parquet.ts";
import { matchesPath, seriesPath } from "./store/paths.ts";
import { epochWindow } from "./store/recent.ts";
import { readYears, usableHours } from "./store/years.ts";

/**
 * Pairs of stations compared by their hourly levels, for `linkGauges` to link
 * those that record one gauge (`sameByData`) whatever their names, and to
 * report links whose levels disagree. `compareStations` writes them to
 * `stations/matches.parquet` once a month, and publish reads them.
 */

/** One compared pair, `a` < `b`. */
export interface DataMatch {
  a: string;
  b: string;
  /** The window compared, `[since, until)`, ISO times. */
  since: string;
  until: string;
  /** Months with `monthlyAgreement`'s 15 days of shared hours, in which `a` moves by `MIN_SPREAD_M`. */
  months: number;
  hours: number;
  /** Median of the months' RMS difference once each month's mean difference is removed, in meters. */
  rms_m: number;
  /** Hours to add to `b`'s times that agree best, from −`MAX_LAG_H` to `MAX_LAG_H`; 0 when none beats same-hour. */
  lag_h: number;
  /** `rms_m` at `lag_h`. */
  lag_rms_m: number;
}

/** Farthest apart two stations are compared, unless they're already linked. */
export const MATCH_KM = 10;
/** Months a pair needs before its levels decide anything. */
export const MIN_MONTHS = 6;
/** Meters: linked stations that usually differ by this much are likelier two gauges. */
export const DIFFER_M = 0.03;
/**
 * Meters: the standard deviation a month of `a` needs to count. Two gauges on
 * still water, a pool or a lake, agree within `SAME_GAUGE` without being one;
 * where the water moves 5 cm, 1 cm RMS is a correlation above 0.98.
 */
export const MIN_SPREAD_M = 0.05;
/** Hours either way a copy's clock is searched for an offset. */
export const MAX_LAG_H = 2;
/**
 * The latest overlapping years compared: a median over three years rides out a
 * stretch where a copy's processing differs for a few months.
 */
const MAX_YEARS = 3;
/** Station-years of hourly values kept in memory, about 70 kB each. */
const CACHE_YEARS = 8000;
const HOUR_MS = 3_600_000;

const enough = (m: DataMatch) => m.months >= MIN_MONTHS;
/** One gauge recorded twice. */
export const sameByData = (m: DataMatch) => enough(m) && m.rms_m < SAME_GAUGE;
/** One gauge recorded twice with one clock off by whole hours: a likely erratum, not a link. */
export const shiftedByData = (m: DataMatch) =>
  enough(m) && !sameByData(m) && m.lag_h !== 0 && m.lag_rms_m < SAME_GAUGE;
/** Two gauges, not one. */
export const differsByData = (m: DataMatch) =>
  enough(m) && m.rms_m >= DIFFER_M && !shiftedByData(m);

const hasLevels = (s: StoredStation) =>
  s.products.includes("levels") && s.first !== null && s.last !== null;

/**
 * Last month's rows of `stations/links.parquet` or `stations/matches.parquet`,
 * less those naming a station left out by decision: one withheld (`shown` is
 * false), or one in `stations` that joins no group (`joinsNoGroup`), such as a
 * GESLA record `isDropped` finds. Neither run reads such a station again, so
 * nothing else takes its rows away. A station listed without levels for any
 * other reason, or missing from `stations`, as a list that can't be read
 * leaves it, keeps its rows.
 */
export function withoutGone<T extends { a: string; b: string }>(
  rows: T[],
  stations: StoredStation[],
  shown: (id: string) => boolean,
): T[] {
  const gone = new Set(stations.filter(joinsNoGroup).map((s) => s.id));
  const kept = (id: string) => shown(id) && !gone.has(id);
  return rows.filter((r) => kept(r.a) && kept(r.b));
}

/**
 * The pairs to compare, `a` < `b`, nearest first: every pair within `MATCH_KM` that
 * `linkGauges` could join by data (`comparable`), and every linked pair, at any
 * distance, so links whose levels disagree are found; each with records that overlap.
 */
export function pairsToCompare(
  stations: StoredStation[],
  radius = MATCH_KM,
): [StoredStation, StoredStation][] {
  const located = stations
    .filter((s) => hasLevels(s) && Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .sort((a, b) => a.lat - b.lat);
  const overlap = (a: StoredStation, b: StoredStation) =>
    Date.parse(a.first!) < Date.parse(b.last!) && Date.parse(b.first!) < Date.parse(a.last!);
  const pairs = new Map<string, [StoredStation, StoredStation]>();
  const add = (a: StoredStation, b: StoredStation) => {
    const [x, y] = a.id < b.id ? [a, b] : [b, a];
    if (a.id !== b.id && overlap(a, b)) pairs.set(`${x.id} ${y.id}`, [x, y]);
  };
  const window = radius / 111;
  for (let i = 0; i < located.length; i++) {
    const a = located[i]!;
    for (let j = i + 1; j < located.length && located[j]!.lat - a.lat <= window; j++) {
      const b = located[j]!;
      if (comparable(a, b) && km(a, b) <= radius) add(a, b);
    }
  }
  const byId = new Map(stations.filter(hasLevels).map((s) => [s.id, s]));
  for (const a of byId.values())
    for (const id of a.same_as) {
      const b = byId.get(id);
      if (b) add(a, b);
    }
  // Neighbors in turn, so the station-years they share are still cached.
  return [...pairs.values()].sort(([a], [b]) => a.lat - b.lat || a.lon - b.lon);
}

/**
 * Two series' agreement month by month at each lag from −`MAX_LAG_H` to
 * `MAX_LAG_H` hours, or null under `MIN_MONTHS` same-hour months. A lag
 * other than 0 is kept only where it beats same-hour by half, so noise
 * doesn't pick one.
 */
export function compare(
  a: Hourly,
  b: Hourly,
): Pick<DataMatch, "months" | "hours" | "rms_m" | "lag_h" | "lag_rms_m"> | null {
  const at = (lag: number) =>
    monthlyAgreement(a, { start: b.start + lag, levels: b.levels }).filter(
      (m) => m.spread >= MIN_SPREAD_M,
    );
  const same = at(0);
  if (same.length < MIN_MONTHS) return null;
  const rms_m = round(median(same.map((m) => m.rms)));
  let [lag_h, lag_rms_m] = [0, rms_m];
  for (let lag = -MAX_LAG_H; lag <= MAX_LAG_H; lag++) {
    const months = lag === 0 ? [] : at(lag);
    if (months.length < MIN_MONTHS) continue;
    const rms = round(median(months.map((m) => m.rms)));
    if (rms < lag_rms_m && rms < rms_m / 2) [lag_h, lag_rms_m] = [lag, rms];
  }
  const hours = same.reduce((sum, m) => sum + m.hours, 0);
  return { months: same.length, hours, rms_m, lag_h, lag_rms_m };
}

/**
 * The years both stations' files hold at least 15 days in, by `hours` (`<id> <year>` to the
 * hours its files hold, every epoch together), latest first, at most `MAX_YEARS`.
 */
export function yearsToCompare(
  a: StoredStation,
  b: StoredStation,
  hours: Map<string, number>,
): number[] {
  const has = (s: StoredStation, y: number) => (hours.get(`${s.id} ${y}`) ?? 0) >= 360;
  const years = [];
  const from = Math.max(Date.parse(a.first!), Date.parse(b.first!));
  const to = Math.min(Date.parse(a.last!), Date.parse(b.last!));
  for (
    let y = new Date(to).getUTCFullYear();
    y >= new Date(from).getUTCFullYear() && years.length < MAX_YEARS;
    y--
  )
    if (has(a, y) && has(b, y)) years.push(y);
  return years;
}

/**
 * Whether too many pairs stopped agreeing in one run to be gauges: at least 20,
 * and more than 5% of those that agreed. Many at once is likelier a source's
 * change, such as values flagged or stamped off the hour.
 */
export function tooManyStopped(stopped: number, agreed: number): boolean {
  return stopped >= 20 && stopped > agreed * 0.05;
}

/**
 * Compares every pair `pairsToCompare` finds, `concurrency` at a time, over
 * the years `yearsToCompare` gives. A `previous` row the run doesn't replace
 * is kept unless its pair's levels were read and no longer compare (under
 * `MIN_MONTHS` usable months), or its stations are listed but no longer a
 * pair: a missing list, bounds, years file or level file, a years file with
 * no year in common, a rewrite in progress (marked in the years file) or a
 * failed read (`failed`) takes no row away.
 */
export async function compareStations(
  store: string,
  stations: StoredStation[],
  concurrency: number,
  previous: DataMatch[] = [],
): Promise<{ rows: DataMatch[]; failed: number; pairs: number }> {
  const pairs = pairsToCompare(stations);
  const hours = new Map<string, number>();
  const epochs = new Map<string, number[]>();
  const marked = new Set<string>();
  const epochsOf = new Map(stations.map((s) => [s.id, s.epochs]));
  /** Sources with a years file. */
  const listed = new Set<string>();
  /** Sources whose years file couldn't be read: their pairs keep last month's rows, as failed reads. */
  const unread = new Set<string>();
  for (const source of new Set(pairs.flatMap(([a, b]) => [a.source, b.source]))) {
    let rows: Awaited<ReturnType<typeof readYears>>;
    try {
      rows = await readYears(store, source);
    } catch (e) {
      console.error(`${store}: ${source}'s years file: ${(e as Error).message}`);
      unread.add(source);
      continue;
    }
    if (rows) listed.add(source);
    for (const r of rows?.values() ?? [])
      if (r.year === null) marked.add(r.id);
      // Hours in a held epoch, or one the list doesn't have, aren't read, so they choose no year.
      else if (usableHours(r) && epochWindow(epochsOf.get(r.id) ?? [], r.epoch ?? 1)) {
        const key = `${r.id} ${r.year}`;
        hours.set(key, (hours.get(key) ?? 0) + usableHours(r));
        epochs.set(key, [...(epochs.get(key) ?? []), r.epoch ?? 1]);
      }
  }
  const cache = new Map<string, Promise<Float64Array | null>>();
  const yearStart = (y: number) => Date.UTC(y, 0, 1) / HOUR_MS;
  /**
   * A station-year's hourly levels from its first hour, NaN where missing,
   * every listed epoch's file together within the epoch's span; null when a
   * file the years file lists is gone.
   */
  const year = (s: StoredStation, y: number) => {
    const key = `${s.id} ${y}`;
    let hit = cache.get(key);
    if (!hit) {
      hit = (async () => {
        const out = new Float64Array(yearStart(y + 1) - yearStart(y)).fill(NaN);
        for (const epoch of epochs.get(key) ?? []) {
          const window = epochWindow(s.epochs, epoch);
          if (!window) continue;
          const path = seriesPath(store, "levels", s.source, s.source_id, y, epoch);
          let hourly: Map<number, number> | null;
          try {
            hourly = await readHourly(path);
          } catch (error) {
            // The years file can lag a rewrite that removed the file.
            if (isMissing(error)) return null;
            throw error;
          }
          if (!hourly) return null;
          const [from, to] = [
            Math.max(yearStart(y), window[0] / HOUR_MS),
            Math.min(yearStart(y + 1), window[1] / HOUR_MS),
          ];
          for (const [h, v] of hourly) if (h >= from && h < to) out[h - yearStart(y)] = v;
        }
        return out;
      })();
      // A failed read isn't kept, so the next pair tries again.
      hit.catch(() => cache.delete(key));
      cache.set(key, hit);
      if (cache.size > CACHE_YEARS) cache.delete(cache.keys().next().value!);
    }
    return hit;
  };
  /** A station's levels over `years`, or null when a file is gone. */
  const series = async (s: StoredStation, years: number[]): Promise<Hourly | null> => {
    const start = yearStart(Math.min(...years));
    const levels = new Float64Array(yearStart(Math.max(...years) + 1) - start).fill(NaN);
    for (const y of years) {
      const values = await year(s, y);
      if (!values) return null;
      levels.set(values, yearStart(y) - start);
    }
    return { start, levels };
  };

  const before = new Map(previous.map((r) => [`${r.a} ${r.b}`, r]));
  const yearsOf = (r: DataMatch) => {
    const out = [];
    for (let y = new Date(r.since).getUTCFullYear(); y < new Date(r.until).getUTCFullYear(); y++)
      out.push(y);
    return out;
  };
  const fresh = new Map<string, DataMatch>();
  const keep = new Set<string>();
  let [next, failed, done] = [0, 0, 0];
  const worker = async () => {
    while (next < pairs.length) {
      const [a, b] = pairs[next++]!;
      const key = `${a.id} ${b.id}`;
      if (++done % 1000 === 0) console.error(`compared ${done} of ${pairs.length} pairs`);
      if (unread.has(a.source) || unread.has(b.source)) {
        keep.add(key);
        failed++;
        continue;
      }
      if (marked.has(a.id) || marked.has(b.id)) {
        keep.add(key);
        continue;
      }
      if (!listed.has(a.source) || !listed.has(b.source)) {
        keep.add(key);
        continue;
      }
      const years = yearsToCompare(a, b, hours);
      // Records that overlap with no year in common, or a year last month's window had gone
      // from within this one's: a years file short of rows.
      const last = before.get(key);
      const lost = last && yearsOf(last).some((y) => y >= Math.min(...years) && !years.includes(y));
      if (!years.length || lost) {
        keep.add(key);
        continue;
      }
      try {
        const [x, y] = [await series(a, years), await series(b, years)];
        if (!x || !y) {
          keep.add(key);
          continue;
        }
        const m = compare(x, y);
        if (!m) continue;
        const [since, until] = [
          Date.UTC(Math.min(...years), 0, 1),
          Date.UTC(Math.max(...years) + 1, 0, 1),
        ];
        fresh.set(key, {
          a: a.id,
          b: b.id,
          since: new Date(since).toISOString(),
          until: new Date(until).toISOString(),
          ...m,
        });
      } catch (error) {
        console.error(`${key}: ${String(error)}`);
        keep.add(key);
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  // A station missing from the lists, or its bounds, takes no row away.
  const ids = new Set(stations.filter(hasLevels).map((s) => s.id));
  const kept = previous.filter(
    (r) =>
      !fresh.has(`${r.a} ${r.b}`) && (keep.has(`${r.a} ${r.b}`) || !ids.has(r.a) || !ids.has(r.b)),
  );
  const rows = [...fresh.values(), ...kept];
  return {
    rows: rows.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b)),
    failed,
    pairs: pairs.length,
  };
}

export function writeMatches(store: string, rows: DataMatch[]): Promise<void> {
  return writeTable(matchesPath(store), rows, FILES.matches);
}

/** The compared pairs, none before the first comparison. */
export async function readMatches(store: string): Promise<DataMatch[]> {
  return (await readRows(matchesPath(store))).map((r) => ({
    a: String(r.a),
    b: String(r.b),
    since: iso(r.since),
    until: iso(r.until),
    months: Number(r.months),
    hours: Number(r.hours),
    rms_m: Number(r.rms_m),
    lag_h: Number(r.lag_h),
    lag_rms_m: Number(r.lag_rms_m),
  }));
}

/** A TIMESTAMPTZ as DuckDB returns it, in ISO form. */
const iso = (value: unknown) =>
  new Date(Number((value as { micros: bigint }).micros / 1000n)).toISOString();

/** To 0.1 mm, without -0; NaN stays NaN, so it never reads as agreeing. */
const round = (x: number) => Math.round(x * 1e4) / 1e4 + 0;
