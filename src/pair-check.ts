/**
 * The fit behind `scripts/pair-check.ts`: two records of one gauge, compared
 * at lags of up to 3 hours in 10-minute steps.
 */
import type { StoredStation } from "./schema.ts";

export interface Reading {
  time: number;
  level: number;
}

const MINUTE_MS = 60_000;
/** Lags tried, in minutes, every 10 up to 3 hours either way. */
export const LAGS = Array.from({ length: 37 }, (_, i) => (i - 18) * 10);
/** Shared readings a lag needs to count. */
export const MIN_SHARED = 200;
/** The furthest apart two readings can be and still give an interpolated one between them. */
const MAX_GAP_MS = 20 * MINUTE_MS;
/** The RMS under which two records hold the same values, in meters. */
export const SAME_RMS_M = 0.002;

/** `b`'s level at `time`, which `b` sorts by: a reading there, or one between readings 20 minutes apart or less. */
export function levelAt(b: Reading[], time: number): number | undefined {
  let [lo, hi] = [0, b.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  const next = b[lo];
  if (next && next.time === time) return next.level;
  const prev = b[lo - 1];
  if (!prev || !next || next.time - prev.time > MAX_GAP_MS) return undefined;
  return prev.level + ((next.level - prev.level) * (time - prev.time)) / (next.time - prev.time);
}

export interface Fit {
  lag: number;
  n: number;
  mean: number;
  rms: number;
}

/**
 * The agreement of `a` with `b` at each lag, `b` read at `a`'s time less the
 * lag, so a positive lag is a late clock in `a`. `tried` counts the lags with
 * `MIN_SHARED` readings, which are the only ones that can win.
 */
export function fit(
  a: Reading[],
  b: Reading[],
): { best: Fit | null; zero: Fit | undefined; tried: number } {
  const at = LAGS.flatMap((lag) => {
    let [n, sum, squares] = [0, 0, 0];
    for (const r of a) {
      const v = levelAt(b, r.time - lag * MINUTE_MS);
      if (v === undefined) continue;
      n++;
      sum += r.level - v;
      squares += (r.level - v) ** 2;
    }
    if (n < MIN_SHARED) return [];
    const mean = sum / n;
    return [{ lag, n, mean, rms: Math.sqrt(Math.max(0, squares / n - mean * mean)) }];
  });
  const best = at.reduce<Fit | null>((x, y) => (!x || y.rms < x.rms ? y : x), null);
  return { best, zero: at.find((x) => x.lag === 0), tried: at.length };
}

/** Whether `best` is a lag the clock check counts: under three quarters of the zero-lag RMS and 0.5 cm less. */
export function clockOff(best: Fit, zero: Fit): boolean {
  return best.lag !== 0 && best.rms < 0.75 * zero.rms && zero.rms - best.rms >= 0.005;
}

/** Datums that are each station's own zero or a tide's average at one station, so two stations naming one share no reference. */
const LOCAL = new Set([
  "ZERO",
  "GAGE",
  "GZ",
  "STND",
  "PNP",
  "CD",
  "DL",
  "ZH",
  "ZI",
  "MSL",
  "MLLW",
  "MLW",
  "MHW",
  "MHHW",
  "MTL",
  "DTL",
  "LAT",
  "HAT",
  "GT",
  "MN",
  "DHQ",
  "DLQ",
]);

export interface EpochDatums {
  datum: string;
  datums: Record<string, number>;
}

/**
 * The first reference both epochs know, and the mean `x` less `y` to expect
 * where their levels are one gauge's: `y`'s offset to it less `x`'s.
 */
export function sharedDatum(
  x: EpochDatums,
  y: EpochDatums,
): { name: string; expected: number } | null {
  const offsetTo = (d: EpochDatums, name: string) =>
    d.datum === name ? 0 : (d.datums[name] ?? null);
  const names = new Set(
    [x.datum, y.datum, ...Object.keys(x.datums), ...Object.keys(y.datums)].filter(
      (n) => !LOCAL.has(n),
    ),
  );
  for (const name of names) {
    const [ox, oy] = [offsetTo(x, name), offsetTo(y, name)];
    if (ox !== null && oy !== null) return { name, expected: oy - ox };
  }
  return null;
}

/** The epoch of `s` that holds the most recent part of `[from, to)`, as the store keeps it: open or closed, not held or rejected. */
export function latestEpoch(
  s: StoredStation,
  from: number,
  to: number,
): { epoch: StoredStation["epochs"][number]; of: number } | null {
  const epochs = (s.epochs ?? []).filter(
    (e) =>
      (e.state === "open" || e.state === "closed") &&
      (!e.since || Date.parse(e.since) < to) &&
      (!e.until || Date.parse(e.until) > from),
  );
  const latest = epochs
    .sort((a, b) => (Date.parse(a.since ?? "") || 0) - (Date.parse(b.since ?? "") || 0))
    .at(-1);
  return latest ? { epoch: latest, of: epochs.length } : null;
}
