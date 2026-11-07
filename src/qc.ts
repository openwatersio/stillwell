import { Flag, type Observation } from "./schema.ts";

/**
 * Quality control for observed levels. Deliberately small: per-source quirks
 * (clocks, datum shifts) take most of the effort and live in the adapters. This
 * runs in Node and in the Worker.
 */
export interface QcOptions {
  /**
   * Levels this many meters from the series' median are bad. Relative, because
   * some datums (NN, NAVD88) put inland gauges hundreds of meters up.
   */
  limit_m?: number;
  /** A level unchanged for this long is suspect. Rivers and lakes can sit still for hours. */
  flatline_s?: number;
  /** The smallest jump from its neighbors that counts as a spike, in meters. */
  spike_m?: number;
  /**
   * Whether a level far outside the series' own range is suspect. Off for
   * sources with regulated pools, which sit nearly flat for months and then
   * rise meters in a flood.
   */
  outliers?: boolean;
}

/**
 * Rows as a source sent them, with `source_flag` set to their flag before QC
 * can make it worse. Only freshly fetched rows get this: a stored row's flag
 * may already hold QC's marks. An adapter that marks a source's value worse
 * itself, such as REFMAR's suspect spans, sets `source_flag` to the source's.
 */
export function withSourceFlag<T extends Observation>(rows: T[]): T[] {
  return rows.map((r) => ({ ...r, source_flag: r.source_flag ?? r.flag }));
}

/** Sorts, drops repeated timestamps, and flags limits, flatlines, spikes and outliers. */
export function qc<T extends Observation>(
  rows: T[],
  { limit_m = 20, flatline_s = 6 * 3600, spike_m = 0.25, outliers = true }: QcOptions = {},
): T[] {
  const sorted = [...rows].sort((a, b) => a.time - b.time);
  const out = sorted
    .filter((r, i) => i === 0 || r.time !== sorted[i - 1]!.time)
    .map((r) => ({ ...r }));
  if (!out.length) return out;
  const worsen = (i: number, flag: Flag) => (out[i]!.flag = Math.max(out[i]!.flag, flag) as Flag);

  const middle = median(out.filter((r) => Number.isFinite(r.level)).map((r) => r.level)) ?? 0;
  out.forEach((r, i) => {
    if (!Number.isFinite(r.level) || Math.abs(r.level - middle) > limit_m) worsen(i, Flag.bad);
  });

  // Flatlines: runs of one value lasting at least `flatline_s`.
  for (let i = 0; i < out.length;) {
    let j = i;
    while (j + 1 < out.length && out[j + 1]!.level === out[i]!.level) j++;
    if (j - i >= 3 && out[j]!.time - out[i]!.time >= flatline_s * 1000)
      for (let k = i; k <= j; k++) worsen(k, Flag.suspect);
    i = j + 1;
  }

  // Spikes: far from the median of the neighbors within three sampling intervals.
  // The threshold scales with how far values normally sit from that median, so
  // noisy gauges get more room than smooth ones, but never less than `spike_m`.
  const spacing = median(out.slice(1).map((r, i) => r.time - out[i]!.time)) ?? 0;
  const residuals = out.map((r, i) => {
    // Neighbors on both sides, so a slope at an edge or a gap doesn't look like a spike.
    const before: number[] = [];
    const after: number[] = [];
    for (let k = i - 1; k >= 0 && r.time - out[k]!.time <= 3 * spacing; k--)
      before.push(out[k]!.level);
    for (let k = i + 1; k < out.length && out[k]!.time - r.time <= 3 * spacing; k++)
      after.push(out[k]!.level);
    return before.length && after.length ? r.level - median([...before, ...after])! : undefined;
  });
  const threshold = Math.max(
    spike_m,
    8 * mad(residuals.filter((d): d is number => d !== undefined)),
  );
  residuals.forEach((d, i) => {
    if (d !== undefined && Math.abs(d) > threshold) worsen(i, Flag.suspect);
  });

  // Outliers: far outside the series' own range, such as a sensor reading its zero.
  // The floor keeps a short, nearly flat window from flagging ordinary changes.
  if (outliers) {
    const levels = out.map((r) => r.level);
    const center = median(levels)!;
    const outlier = Math.max(10 * mad(levels), 4 * spike_m);
    out.forEach((r, i) => {
      if (Math.abs(r.level - center) > outlier) worsen(i, Flag.suspect);
    });
  }

  return out;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Median absolute deviation, scaled to a standard deviation for normal data. */
function mad(values: number[]): number {
  const center = median(values);
  if (center === undefined) return 0;
  return 1.4826 * median(values.map((v) => Math.abs(v - center)))!;
}
