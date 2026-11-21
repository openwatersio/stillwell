/**
 * Whether another record of a gauge copies an erratum's record over its span,
 * and so carries the error: `errata:copies` compares each record that
 * `same_as` links to a `flagged` erratum's stations but the erratum doesn't
 * list.
 */
import type { Observation } from "./schema.ts";
import { median } from "./stats.ts";

const HALF_HOUR_MS = 1_800_000;
/** Meters: a record this close to the original, once their datums are lined up, holds its values. */
export const COPY_M = 0.01;
/** Meters: a record this far from the original holds values of its own. */
export const OWN_M = 0.03;
/** The fewest shared values inside a piece of the span, and outside the span, that judge a pair; a piece with fewer can't, by its shift alone, make it the record's own. */
export const MIN_INSIDE = 6;
export const MIN_OUTSIDE = 24;
/** The share of the copy's values inside the span that may have no value of the original near them. */
export const MAX_UNMATCHED = 0.05;

export type Verdict = "copy" | "own" | "unclear" | "too few" | "no control";

type Level = Pick<Observation, "time" | "level">;

export interface Comparison {
  /** Values compared inside the span and outside it. */
  inside: number;
  outside: number;
  /** UTC days inside the span with a value compared. */
  days: number;
  /** The copy's values inside the span with no value of the original within half an hour. */
  unmatched: number;
  /** The difference's median outside the span, which lines the two datums up; inside it where there's none outside. */
  offset_m: number;
  /** How far the median inside the span sits from `offset_m`: in the piece furthest off, where there are pieces. */
  shift_m: number;
  /** RMS of the difference inside the span, less `offset_m`. */
  rms_m: number;
  verdict: Verdict;
}

/**
 * How `copy` compares with `original` inside `[from, to)` against the values
 * outside it. Each of the copy's values is matched with the original's at the
 * same time, or with the original's mean over the hour centred on it, as an
 * hourly copy holds one or the other, whichever fits better. The datum offset
 * comes from outside the span, so a copy that corrected the error, such as an
 * offset or a datum step, shows as a shift inside it, judged in each of
 * `pieces` (the parts of the span read, which default to the whole). A copy
 * holding values the original lacks, such as ones the original drops, isn't a
 * copy over the span. Without enough values outside, the offset can't be told
 * from the error.
 */
export function compare(
  original: Level[],
  copy: Level[],
  from: number,
  to: number,
  pieces: [number, number][] = [[from, to]],
): Comparison {
  // Sorted, one value a time, since reads of nearby pieces can overlap.
  original = [
    ...new Map([...original].sort((a, b) => a.time - b.time).map((o) => [o.time, o])).values(),
  ];
  const at = new Map(original.map((o) => [o.time, o.level]));
  const times = original.map((o) => o.time);
  const near = (time: number) => {
    const i = lowerBound(times, time - HALF_HOUR_MS);
    return i < times.length && times[i]! < time + HALF_HOUR_MS ? i : -1;
  };
  const centredMean = (time: number) => {
    let i = near(time);
    if (i < 0) return undefined;
    let [sum, n] = [0, 0];
    for (; i < times.length && times[i]! < time + HALF_HOUR_MS; i++) {
      sum += original[i]!.level;
      n++;
    }
    return sum / n;
  };
  const inSpan = (time: number) => time >= from && time < to;
  const unmatched = copy.filter((o) => inSpan(o.time) && near(o.time) < 0).length;
  const fit = (pick: (time: number) => number | undefined) => {
    const inside: { time: number; d: number }[] = [];
    const outside: number[] = [];
    for (const o of copy) {
      const level = pick(o.time);
      if (level === undefined) continue;
      if (inSpan(o.time)) inside.push({ time: o.time, d: o.level - level });
      else outside.push(o.level - level);
    }
    const control = outside.length >= MIN_OUTSIDE;
    const offset = (control ? median(outside) : median(inside.map((x) => x.d))) || 0;
    const rms = Math.sqrt(
      inside.reduce((s, x) => s + (x.d - offset) ** 2, 0) / (inside.length || 1),
    );
    // The piece furthest off, of those with enough values to judge; a thinner one's shift
    // can make the pair unclear, not its own, so a short stretch that differs can't hide
    // behind the rest. Its values still count in the RMS.
    let shift = NaN;
    let thin = 0;
    for (const [a, b] of pieces) {
      const ds = inside.filter((x) => x.time >= a && x.time < b).map((x) => x.d);
      if (!ds.length) continue;
      const s = median(ds) - offset;
      if (ds.length < MIN_INSIDE) thin = Math.max(thin, Math.abs(s));
      else if (!(Math.abs(s) <= Math.abs(shift))) shift = s;
    }
    return {
      inside: inside.length,
      days: new Set(inside.map((x) => Math.floor(x.time / 86_400_000))).size,
      outside: outside.length,
      offset_m: offset,
      shift_m: shift,
      rms_m: rms,
      thin,
      control,
    };
  };
  const fits = [fit((time) => at.get(time)), fit(centredMean)];
  const best =
    fits.filter((f) => f.inside >= MIN_INSIDE).sort((a, b) => a.rms_m - b.rms_m)[0] ??
    fits.sort((a, b) => b.inside - a.inside)[0]!;
  const { control, thin, ...rest } = best;
  const out = { ...rest, unmatched };
  const verdict: Verdict =
    out.inside < MIN_INSIDE || Number.isNaN(out.shift_m)
      ? "too few"
      : out.rms_m > OWN_M ||
          Math.abs(out.shift_m) > OWN_M ||
          unmatched > MAX_UNMATCHED * (out.inside + unmatched)
        ? "own"
        : !control
          ? "no control"
          : out.rms_m < COPY_M && Math.abs(out.shift_m) < COPY_M && thin < COPY_M
            ? "copy"
            : "unclear";
  return { ...out, verdict };
}

function lowerBound(sorted: number[], value: number): number {
  let [lo, hi] = [0, sorted.length];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
