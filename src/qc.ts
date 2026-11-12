import { Flag, type Observation } from "./schema.ts";

/**
 * Quality control for observed levels. Deliberately small: per-source quirks
 * (clocks, datum shifts) take most of the effort and live in the adapters.
 */
export interface QcOptions {
  /**
   * Levels this many meters from the series' median are bad, as are those
   * outside `SPAN_M`. Relative, because some datums (NN, NAVD88) put inland
   * gauges hundreds of meters up.
   */
  limit_m?: number;
  /** A level unchanged for this long is suspect. Rivers and lakes can sit still for days. */
  flatline_s?: number;
  /**
   * Levels within this many meters of a run's first count as unchanged, so a
   * stuck gauge that dithers by a millimeter is still a flatline. Exact
   * equality where it's 0, as at still water, where a calm pool can waver by
   * a millimeter for days.
   */
  flatline_m?: number;
  /**
   * The flatline limit where a series moves in whole centimeters, where a calm
   * day can hold one value for hours. Judged from the changes in the three days
   * either side of each run, since a gauge's resolution can change mid-year.
   */
  centimeter_flatline_s?: number;
  /** The smallest jump from its neighbors that counts as a spike, in meters. */
  spike_m?: number;
  /**
   * Whether a level far outside the series' own range is suspect. Off for
   * sources with regulated pools, which sit nearly flat for months and then
   * rise meters in a flood.
   */
  outliers?: boolean;
  /**
   * Whether a level held for less than a flatline, far from the levels on both
   * sides of it, is suspect. Off for pools, which can be let up for a few hours
   * and back down.
   */
  held?: boolean;
}

/** How long a level unchanged is suspect, where a source's settings don't say. */
export const FLATLINE_S = 6 * 3600;

/**
 * Levels no gauge can read in any datum the store holds, in meters: below the
 * Dead Sea's shore or above Everest. QARTOD's gross range test fails a value
 * outside the sensor's span whatever the window holds, which catches a year
 * that is all placeholder, such as USACE's 30,479.695 m (100,000 ft), where
 * the window's own median is the placeholder. A scan of every year file in
 * November 2026 found no real level above 1,817 m, at USGS's Lyman Lake.
 */
export const SPAN_M = [-500, 9000] as const;

/** Whether a level is finite and within `SPAN_M`. */
const possible = (level: number) => level >= SPAN_M[0] && level <= SPAN_M[1];

/**
 * Rows as a source sent them, with `source_flag` set to their flag before QC
 * can make it worse. Only freshly fetched rows get this: a stored row's flag
 * may already hold QC's marks. An adapter that marks a source's value worse
 * itself, such as USGS's `ICE` qualifier, does so before this, so it shows in
 * `source_flag`; errata spans are marked after, by `fromSource`.
 */
export function withSourceFlag<T extends Observation>(rows: T[]): T[] {
  // Levels to the 0.1 mm the store reads back, so a fetched value equals its stored copy, as a flatline needs.
  return rows.map((r) => ({
    ...r,
    level: Math.round(r.level * 10_000) / 10_000,
    source_flag: r.source_flag ?? r.flag,
  }));
}

/**
 * Rows with `flag` worked out again from what the source said, `source_flag`,
 * and the spans the store's errata flag `suspect`, so QC starts over and a rule
 * that loosens clears what it flagged before. A row written before
 * `source_flag` was kept gets it from its flag when that's better than
 * suspect, since QC and errata only ever mark a value suspect or bad, so the
 * flag is the source's; a suspect or bad one may be QC's, so it stays.
 */
export function fromSource<T extends Observation>(
  rows: T[],
  suspect: [number, number][] = [],
): T[] {
  return rows.map((r) => {
    const source = r.source_flag ?? (r.flag < Flag.suspect ? r.flag : undefined);
    const marked = suspect.some(([from, to]) => r.time >= from && r.time < to);
    const flag = Math.max(source ?? r.flag, marked ? Flag.suspect : 0) as Flag;
    return source === undefined ? { ...r, flag } : { ...r, flag, source_flag: source };
  });
}

/**
 * Sorts, drops repeated timestamps, and flags limits, flatlines, spikes, held
 * levels and outliers. `context` is values from either side, such as the neighboring
 * years, so a flatline or spike across the edge is judged whole; they take no
 * part in the medians and spreads the rules measure against, and aren't
 * returned.
 */
export function qc<T extends Observation>(
  rows: T[],
  {
    limit_m = 20,
    flatline_s = FLATLINE_S,
    flatline_m = 0,
    centimeter_flatline_s = 0,
    spike_m = 0.25,
    outliers = true,
    held = true,
  }: QcOptions = {},
  context: Observation[] = [],
): T[] {
  const out = unique(rows).map((r) => ({ ...r }));
  if (!out.length) return out;
  const own = new Set<Observation>(out);
  const times = new Set(out.map((r) => r.time));
  // Levels within `SPAN_M` only, so no neighbor, residual, run or spread sees a NaN or one beyond it; the limit rule marks those bad.
  const all = unique([...out, ...context.filter((r) => !times.has(r.time))]).filter((r) =>
    possible(r.level),
  );
  const worsen = (r: Observation, flag: Flag) => {
    if (own.has(r)) r.flag = Math.max(r.flag, flag) as Flag;
  };

  const middle = median(out.filter((r) => possible(r.level)).map((r) => r.level)) ?? 0;
  out.forEach((r) => {
    if (!possible(r.level) || Math.abs(r.level - middle) > limit_m) worsen(r, Flag.bad);
  });

  // Flatlines: runs within `flatline_m` of their first value lasting at least
  // `flatline_s`, or `centimeter_flatline_s` where the level moves in whole
  // centimeters around them. In 0.1 mm, the store's resolution.
  const tolerance = Math.round(flatline_m * 10_000);
  for (let i = 0; i < all.length;) {
    let j = i;
    while (
      j + 1 < all.length &&
      Math.abs(Math.round((all[j + 1]!.level - all[i]!.level) * 10_000)) <= tolerance
    )
      j++;
    const span = all[j]!.time - all[i]!.time;
    if (
      j - i >= 3 &&
      span >= flatline_s * 1000 &&
      (span >= centimeter_flatline_s * 1000 || !wholeCentimeters(all, i, j))
    )
      for (let k = i; k <= j; k++) worsen(all[k]!, Flag.suspect);
    i = j + 1;
  }

  // Spikes: far from the median of the neighbors within three sampling intervals.
  // The threshold scales with how far values normally sit from that median, so
  // noisy gauges get more room than smooth ones, but never less than `spike_m`.
  const spacing = median(out.slice(1).map((r, i) => r.time - out[i]!.time)) ?? 0;
  const residuals = all.map((r, i) => {
    // Neighbors on both sides, so a slope at an edge or a gap doesn't look like a spike.
    const before: Observation[] = [];
    const after: Observation[] = [];
    for (let k = i - 1; k >= 0 && r.time - all[k]!.time <= 3 * spacing; k--) before.push(all[k]!);
    for (let k = i + 1; k < all.length && all[k]!.time - r.time <= 3 * spacing; k++)
      after.push(all[k]!);
    if (!before.length || !after.length) return undefined;
    // Only neighbors whose mirrored time on the other side also holds a value, within half an
    // interval, so a gap on one side doesn't move the median along a steep tide; all of them
    // where none pair, so every value with neighbors on both sides is judged.
    const offset = (x: Observation) => Math.abs(x.time - r.time);
    // Both sides run outward from the value, so one pass over each finds the pairs.
    const paired = (side: Observation[], other: Observation[]) => {
      let j = 0;
      return side.filter((x) => {
        while (j < other.length && offset(other[j]!) < offset(x) - spacing / 2) j++;
        return j < other.length && offset(other[j]!) <= offset(x) + spacing / 2;
      });
    };
    const mirrored = [...paired(before, after), ...paired(after, before)];
    return (
      r.level - median((mirrored.length ? mirrored : [...before, ...after]).map((x) => x.level))!
    );
  });
  const threshold = Math.max(
    spike_m,
    8 * mad(residuals.filter((d, i): d is number => d !== undefined && own.has(all[i]!))),
  );
  residuals.forEach((d, i) => {
    if (d !== undefined && Math.abs(d) > threshold) worsen(all[i]!, Flag.suspect);
  });

  // Held levels: three or more values within a centimeter of the first,
  // shorter than a flatline, beyond the spike threshold from the levels on both
  // sides of them, the same way, as when a gauge holds a reading while the tide
  // moves. Within such a run the spike rule's neighbors are the run itself, so
  // it sees only the ends. Two values can share a high water, and a run a real
  // step ends sits level with one side, but a real level that rises and falls
  // back that way, such as a lock basin's, is flagged too.
  const side = (from: number, step: number, edge: number) => {
    const near: number[] = [];
    for (let k = from; all[k] && Math.abs(all[k]!.time - edge) <= 3 * spacing; k += step)
      near.push(all[k]!.level);
    return median(near);
  };
  // In 0.1 mm, the store's resolution, so a centimeter's difference is the same at any level.
  const near = (k: number, i: number) =>
    k < all.length && Math.abs(Math.round((all[k]!.level - all[i]!.level) * 10_000)) <= 100;
  for (let i = 0; held && i < all.length;) {
    let j = i;
    while (near(j + 1, i) && all[j + 1]!.time - all[i]!.time < flatline_s * 1000) j++;
    // A run as long as a flatline is left to the flatline limits, so it's passed whole.
    if (near(j + 1, i)) {
      i = j + 1;
      continue;
    }
    const level = median(all.slice(i, j + 1).map((r) => r.level))!;
    const before = side(i - 1, -1, all[i]!.time);
    const after = side(j + 1, 1, all[j]!.time);
    if (
      j - i >= 2 &&
      before !== undefined &&
      after !== undefined &&
      Math.min(Math.abs(level - before), Math.abs(level - after)) > threshold &&
      Math.sign(level - before) === Math.sign(level - after)
    ) {
      for (let k = i; k <= j; k++) worsen(all[k]!, Flag.suspect);
      i = j + 1;
    } else i++; // A value just before a hold, within a centimeter of it, starts no run that hides it.
  }

  // Outliers: far outside the series' own range, such as a sensor reading its zero.
  // The floor keeps a short, nearly flat window from flagging ordinary changes.
  if (outliers) {
    const levels = out.map((r) => r.level).filter(possible);
    const center = median(levels) ?? 0;
    const outlier = Math.max(10 * mad(levels), 4 * spike_m);
    out.forEach((r) => {
      if (Math.abs(r.level - center) > outlier) worsen(r, Flag.suspect);
    });
  }

  return out;
}

const DAY_MS = 86_400_000;

/**
 * Whether most of the changes within three days of the run `out[i..j]` are whole
 * centimeters. Fewer than 24 changes can't tell, so they count as finer.
 */
function wholeCentimeters(out: Observation[], i: number, j: number): boolean {
  let changes = 0;
  let whole = 0;
  const count = (k: number) => {
    const d = Math.abs(out[k]!.level - out[k - 1]!.level) * 100;
    if (!(d > 0)) return;
    changes++;
    if (Math.abs(d - Math.round(d)) < 1e-6) whole++;
  };
  for (let k = i; k > 0 && out[i]!.time - out[k - 1]!.time <= 3 * DAY_MS; k--) count(k);
  for (let k = j + 1; k < out.length && out[k]!.time - out[j]!.time <= 3 * DAY_MS; k++) count(k);
  return changes >= 24 && whole > changes / 2;
}

/** Sorted by time, keeping the first of each timestamp. */
function unique<T extends { time: number }>(rows: T[]): T[] {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  return sorted.filter((r, i) => i === 0 || r.time !== sorted[i - 1]!.time);
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median absolute deviation, scaled to a standard deviation for normal data. */
function mad(values: number[]): number {
  values = values.filter(Number.isFinite);
  const center = median(values);
  if (center === undefined) return 0;
  return 1.4826 * median(values.map((v) => Math.abs(v - center)))!;
}
