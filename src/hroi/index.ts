import { Matrix, SingularValueDecomposition } from "ml-matrix";
import type { EventIndex, Extreme, Sample, TransitExtreme } from "../types.ts";
import { type PartialTide, SET_3 } from "./constituents.ts";
import { LUNAR_DAY_MS, transits, type Transit } from "./transits.ts";

/**
 * Harmonic representation of inequalities (HRoI), after Horn (1960) and Boesch
 * and Müller-Navarra (2019).
 *
 * Each high and low water belongs to a lunar transit at Greenwich and has one of
 * four event indices (HW or LW, after an upper or a lower transit). For each
 * index, the lunitidal interval (time after the transit) and the height are
 * modeled as a mean plus long-period harmonics of the transit number:
 *
 *   y(n) = a0 + Σ a_l cos(ω_l n) + b_l sin(ω_l n)
 *
 * That is eight small least-squares fits. Prediction evaluates them at each
 * future transit, so it yields exactly one HW and one LW per half lunar day.
 */

const HALF_LUNAR_DAY_MS = LUNAR_DAY_MS / 2;
const HOUR_MS = 3_600_000;
const EVENTS: EventIndex[] = [1, 2, 3, 4];

export interface LunitidalIntervals {
  /** Mean high- and low-water intervals after the assigned transit, in hours. */
  high: number;
  low: number;
}

export interface Series {
  /** [a0, a1..aL, b1..bL] for the lunitidal interval, in hours. */
  interval: number[];
  /** [a0, a1..aL, b1..bL] for the height, in meters. */
  height: number[];
  count: number;
}

export interface Model {
  tides: PartialTide[];
  intervals: LunitidalIntervals;
  series: Record<EventIndex, Series>;
}

/** An extreme with its transit assigned and its lunitidal interval measured. */
export interface AssignedExtreme extends TransitExtreme {
  interval: number; // hours
}

/**
 * Estimate mean lunitidal intervals from extremes. Intervals are only known
 * modulo half a lunar day; by convention the HW interval lies in
 * [0, 12.42) hours and the LW interval follows it within the next half day, so
 * a low water is assigned to the same transit as the high water before it.
 */
export function estimateIntervals(extremes: Extreme[], transits: Transit[]): LunitidalIntervals {
  const phase = (type: Extreme["type"]) => {
    let x = 0;
    let y = 0;
    for (const e of extremes) {
      if (e.type !== type) continue;
      const prev = transitBefore(transits, e.time);
      if (!prev) continue;
      const angle = ((e.time - prev.time) / HALF_LUNAR_DAY_MS) * 2 * Math.PI;
      x += Math.cos(angle);
      y += Math.sin(angle);
    }
    const turns = (Math.atan2(y, x) / (2 * Math.PI) + 1) % 1;
    return (turns * HALF_LUNAR_DAY_MS) / HOUR_MS;
  };
  const high = phase("high");
  let low = phase("low");
  while (low <= high) low += HALF_LUNAR_DAY_MS / HOUR_MS;
  return { high, low };
}

/**
 * Assign each extreme to the transit whose mean interval puts it closest. Where
 * a transit gets two extremes of one type (a double low water, say), the more
 * extreme one is kept.
 */
export function assign(
  extremes: Extreme[],
  transits: Transit[],
  intervals: LunitidalIntervals,
): AssignedExtreme[] {
  const byKey = new Map<string, AssignedExtreme>();
  for (const e of extremes) {
    const target = e.time - intervals[e.type] * HOUR_MS;
    const transit = nearest(transits, target);
    if (!transit || Math.abs(transit.time - target) > HALF_LUNAR_DAY_MS / 2) continue;
    const event = eventIndex(e.type, transit.upper);
    const assigned: AssignedExtreme = {
      ...e,
      transit: transit.number,
      event,
      interval: (e.time - transit.time) / HOUR_MS,
    };
    const key = `${transit.number}:${event}`;
    const existing = byKey.get(key);
    const better =
      !existing || (e.type === "high" ? e.level > existing.level : e.level < existing.level);
    if (better) byKey.set(key, assigned);
  }
  return [...byKey.values()].sort((a, b) => a.time - b.time);
}

/**
 * Measure lunitidal intervals for extremes that already carry transit numbers
 * and event indices, as BSH's files do.
 */
export function measure(extremes: TransitExtreme[], transits: Transit[]): AssignedExtreme[] {
  const lookup = new Map(transits.map((t) => [`${t.number}:${t.upper}`, t]));
  return extremes.flatMap((e) => {
    const transit = lookup.get(`${e.transit}:${e.event <= 2}`);
    return transit ? [{ ...e, interval: (e.time - transit.time) / HOUR_MS }] : [];
  });
}

export interface FitOptions {
  tides?: PartialTide[];
  intervals?: LunitidalIntervals;
  /**
   * Ridge penalty on the harmonic coefficients, relative to the number of
   * extremes. BSH fits 19 years, which separates every pair in its set. Shorter
   * records can't separate pairs such as Mm and the tropical month (8.85 years
   * apart), and an unpenalized fit then extrapolates wildly; about 1e-4 keeps
   * a one-year fit stable.
   */
  ridge?: number;
}

/** Fit the eight HRoI series to assigned extremes. */
export function fit(extremes: AssignedExtreme[], options: FitOptions = {}): Model {
  const tides = options.tides ?? SET_3;
  const series = {} as Record<EventIndex, Series>;
  for (const event of EVENTS) {
    const rows = extremes.filter((e) => e.event === event);
    if (rows.length < 1 + 2 * tides.length)
      throw new Error(`HRoI event ${event} has ${rows.length} extremes for ${tides.length} tides`);
    const solve = solver(new Matrix(rows.map((e) => basis(e.transit, tides))), options.ridge ?? 0);
    series[event] = {
      interval: solve(rows.map((e) => e.interval)),
      height: solve(rows.map((e) => e.level)),
      count: rows.length,
    };
  }
  const intervals = options.intervals ?? {
    high: mean(extremes.filter((e) => e.type === "high").map((e) => e.interval)),
    low: mean(extremes.filter((e) => e.type === "low").map((e) => e.interval)),
  };
  return { tides, intervals, series };
}

/** Predict high and low waters in [start, end). */
export function predict(model: Model, start: number, end: number): AssignedExtreme[] {
  // An event follows its transit by up to about a lunar day, so start early.
  const result: AssignedExtreme[] = [];
  for (const transit of transits(start - 2 * LUNAR_DAY_MS, end)) {
    const vector = basis(transit.number, model.tides);
    for (const type of ["high", "low"] as const) {
      const event = eventIndex(type, transit.upper);
      const s = model.series[event];
      const interval = dot(vector, s.interval);
      const time = Math.round(transit.time + interval * HOUR_MS);
      if (time < start || time >= end) continue;
      result.push({
        time,
        level: dot(vector, s.height),
        type,
        transit: transit.number,
        event,
        interval,
      });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

/**
 * The mean tide curve: normalized rising and falling branches between
 * consecutive extremes, sampled at `bins + 1` points from 0 to 1. BSH draws its
 * 10-minute curves by fitting a mean observed curve between HRoI extremes.
 */
export interface TideCurve {
  rise: number[];
  fall: number[];
}

export function meanCurve(samples: Sample[], extremes: Extreme[], bins = 60): TideCurve {
  const sums = { rise: new Float64Array(bins + 1), fall: new Float64Array(bins + 1) };
  const counts = { rise: new Float64Array(bins + 1), fall: new Float64Array(bins + 1) };
  let i = 0;
  for (let k = 1; k < extremes.length; k++) {
    const a = extremes[k - 1]!;
    const b = extremes[k]!;
    if (a.type === b.type || b.level === a.level) continue;
    const branch = a.type === "low" ? "rise" : "fall";
    while (i < samples.length && samples[i]!.time < a.time) i++;
    for (let j = i; j < samples.length && samples[j]!.time <= b.time; j++) {
      const s = samples[j]!;
      const u = (s.time - a.time) / (b.time - a.time);
      const bin = Math.round(u * bins);
      sums[branch][bin]! += (s.level - a.level) / (b.level - a.level);
      counts[branch][bin]!++;
    }
  }
  const average = (branch: "rise" | "fall") =>
    Array.from(sums[branch], (sum, bin) =>
      bin === 0
        ? 0
        : bin === bins
          ? 1
          : counts[branch][bin]
            ? sum / counts[branch][bin]!
            : bin / bins,
    );
  return { rise: average("rise"), fall: average("fall") };
}

/** Water levels at `times` from extremes and a mean tide curve. */
export function curveAt(extremes: Extreme[], shape: TideCurve, times: number[]): Sample[] {
  const result: Sample[] = [];
  let k = 1;
  for (const time of times) {
    while (k < extremes.length && extremes[k]!.time < time) k++;
    const a = extremes[k - 1];
    const b = extremes[k];
    if (!a || !b || time < a.time) continue;
    const branch = a.type === "low" ? shape.rise : shape.fall;
    const u = ((time - a.time) / (b.time - a.time)) * (branch.length - 1);
    const lo = Math.floor(u);
    const v = branch[lo]! + (branch[Math.min(lo + 1, branch.length - 1)]! - branch[lo]!) * (u - lo);
    result.push({ time, level: a.level + v * (b.level - a.level) });
  }
  return result;
}

/**
 * Pick one high and one low water per transit from a curve: the highest and
 * lowest values within half a lunar half-day of each mean interval. This is
 * the selection the HRoI implies, and resembles RWS's canonical events.
 */
export function canonicalExtremes(
  samples: Sample[],
  transits: Transit[],
  intervals: LunitidalIntervals,
): Extreme[] {
  const result: Extreme[] = [];
  const half = HALF_LUNAR_DAY_MS / 2;
  for (const type of ["high", "low"] as const) {
    const sign = type === "high" ? 1 : -1;
    let i = 0;
    for (const transit of transits) {
      const center = transit.time + intervals[type] * HOUR_MS;
      while (i < samples.length && samples[i]!.time < center - half) i++;
      let best: Sample | undefined;
      let j = i;
      for (; j < samples.length && samples[j]!.time < center + half; j++)
        if (!best || sign * samples[j]!.level > sign * best.level) best = samples[j];
      // Skip windows at the edge of the record or with a gap at the extreme.
      if (!best || i >= samples.length || samples[i]!.time - (center - half) > HOUR_MS) continue;
      if (j >= samples.length || center + half - samples[j - 1]!.time > HOUR_MS) continue;
      // Center plateaus: average the times within a centimeter of the extreme.
      const near = samples
        .slice(i, j)
        .filter((s) => sign * (best!.level - s.level) <= 0.01)
        .map((s) => s.time);
      result.push({ time: Math.round(mean(near)), level: best.level, type });
    }
  }
  return result.sort((a, b) => a.time - b.time);
}

function solver(design: Matrix, ridge: number): (y: number[]) => number[] {
  if (ridge === 0) {
    const svd = new SingularValueDecomposition(design, { autoTranspose: true });
    return (y) => svd.solve(Matrix.columnVector(y)).getColumn(0);
  }
  const normal = design.transpose().mmul(design);
  // Leave the mean (column 0) unpenalized.
  for (let i = 1; i < normal.rows; i++) normal.set(i, i, normal.get(i, i) + ridge * design.rows);
  const inverse = new SingularValueDecomposition(normal).inverse();
  const projection = inverse.mmul(design.transpose());
  return (y) => projection.mmul(Matrix.columnVector(y)).getColumn(0);
}

function basis(n: number, tides: PartialTide[]): number[] {
  const row = [1];
  for (const t of tides) row.push(Math.cos((t.omega * n * Math.PI) / 180));
  for (const t of tides) row.push(Math.sin((t.omega * n * Math.PI) / 180));
  return row;
}

function eventIndex(type: Extreme["type"], upper: boolean): EventIndex {
  return type === "high" ? (upper ? 1 : 3) : upper ? 2 : 4;
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Index of the last transit at or before `time`, or -1. */
function indexBefore(transits: Transit[], time: number): number {
  let lo = -1;
  let hi = transits.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (transits[mid]!.time <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function transitBefore(transits: Transit[], time: number): Transit | undefined {
  return transits[indexBefore(transits, time)];
}

function nearest(transits: Transit[], time: number): Transit | undefined {
  const i = indexBefore(transits, time);
  const before = transits[i];
  const after = transits[i + 1];
  if (!before) return after;
  if (!after) return before;
  return time - before.time <= after.time - time ? before : after;
}
