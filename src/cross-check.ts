import { constituents as engineConstituents, createTidePredictor } from "@slackwater/engine";
import type { HarmonicModel } from "./harmonic.ts";

/**
 * Checks that compare a station with its neighbors or with its own tide, for
 * errors one station's QC can't see: a month holding another gauge's data, a
 * clock that drifts or jumps, and a level step. The methods are those of the
 * SANHO audit (openwatersio/water-levels#82, #112).
 */

export const HOUR_MS = 3_600_000;
const DAY_HOURS = 24;

/** Hourly levels from hour `start` (hours since 1970), NaN where missing. */
export interface Hourly {
  start: number;
  levels: Float64Array;
}

export interface MonthAgreement {
  /** UTC month, `YYYY-MM`. */
  month: string;
  hours: number;
  r: number;
  /** RMS of the difference once the month's mean difference is removed, in meters. */
  rms: number;
}

/**
 * Same-hour agreement between two series, by UTC month. The mean difference is
 * removed first, since two gauges' datums differ.
 */
export function monthlyAgreement(a: Hourly, b: Hourly, minHours = 360): MonthAgreement[] {
  const from = Math.max(a.start, b.start);
  const to = Math.min(a.start + a.levels.length, b.start + b.levels.length);
  const out: MonthAgreement[] = [];
  let hour = from;
  while (hour < to) {
    const date = new Date(hour * HOUR_MS);
    const next = Math.min(to, Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) / HOUR_MS);
    const x: number[] = [];
    const y: number[] = [];
    for (let h = hour; h < next; h++) {
      const va = a.levels[h - a.start]!;
      const vb = b.levels[h - b.start]!;
      if (!Number.isNaN(va) && !Number.isNaN(vb)) {
        x.push(va);
        y.push(vb);
      }
    }
    if (x.length >= minHours)
      out.push({
        month: date.toISOString().slice(0, 7),
        hours: x.length,
        r: correlation(x, y),
        rms: Math.sqrt(variance(x.map((v, i) => v - y[i]!))),
      });
    hour = next;
  }
  return out;
}

/** Meters: a pair whose usual monthly RMS is under this is one gauge recorded twice. */
export const SAME_GAUGE = 0.01;

export interface Copy extends MonthAgreement {
  /** The pair's median monthly RMS, in meters. */
  usual: number;
}

/**
 * Months in which two gauges agree far better than they usually do: one holds
 * the other's data. A month counts when its RMS is under `maxRms` and under
 * `ratio` of the pair's median, which takes `minMonths` of history to judge.
 * Close neighbors that usually agree within `close` must match to within
 * `identical`, since chance alone takes them under a quarter of that; a pair
 * that always matches is one gauge, for `same_as`, not a copy.
 */
export function copies(
  months: MonthAgreement[],
  {
    maxRms = 0.03,
    ratio = 0.25,
    minMonths = 6,
    close = 0.03,
    identical = 0.002,
    same = SAME_GAUGE,
  } = {},
): Copy[] {
  if (months.length < minMonths) return [];
  const usual = median(months.map((m) => m.rms));
  if (usual < same) return [];
  return months
    .filter((m) => m.rms < maxRms && m.rms < ratio * usual && (usual >= close || m.rms < identical))
    .map((m) => ({ ...m, usual }));
}

export interface TimingWindow {
  /** Start of the window, ms. */
  time: number;
  hours: number;
  /** Minutes the stamps run late against the fit, from the semidiurnal band. */
  semidiurnal: number;
  /** The same from the diurnal band, or null where the diurnal tide is too small to time. */
  diurnal: number | null;
}

/** Degrees per hour: semidiurnal band, then diurnal. */
const BANDS = { semidiurnal: [26, 32], diurnal: [12, 17] } as const;

/**
 * How late each window's stamps run against a harmonic fit, from the least
 * squares coefficient of each band's time derivative in observed minus
 * predicted. A clock error moves both bands by the same minutes; a physical
 * change rarely does. The linearization underestimates lags past about half an
 * hour, so a large one is a sign, not a measure.
 */
export function timing(
  series: Hourly,
  model: HarmonicModel,
  { windowDays = 15, minHours = 240, minDiurnal = 0.05 } = {},
): TimingWindow[] {
  const band = ([low, high]: readonly [number, number]) =>
    createTidePredictor(
      model.constituents.filter((c) => {
        const speed = engineConstituents[c.name]?.speed ?? 0;
        return speed >= low && speed <= high;
      }),
      { offset: 0 },
    );
  // Every half hour from half an hour before the first value, so hour h is at
  // index 2(h − start) + 1 and its neighbors half an hour either side.
  const halfHours = (p: ReturnType<typeof createTidePredictor>) =>
    p
      .getTimelinePrediction({
        start: new Date((series.start - 0.5) * HOUR_MS),
        end: new Date((series.start + series.levels.length - 0.5) * HOUR_MS),
        timeFidelity: 1800,
      })
      .map((p) => p.level);
  const full = halfHours(createTidePredictor(model.constituents, { offset: model.offset }));
  const semi = halfHours(band(BANDS.semidiurnal));
  const diur = halfHours(band(BANDS.diurnal));
  const at = (h: number) => 2 * (h - series.start) + 1;
  // Per hour, so a coefficient of −1 is a stamp one hour late.
  const slope = (p: number[], h: number) => p[at(h) + 1]! - p[at(h) - 1]!;

  const out: TimingWindow[] = [];
  const window = windowDays * DAY_HOURS;
  // Windows start on whole days from 1970, so every station's windows line up.
  const first = Math.floor(series.start / window) * window;
  for (let w = first; w < series.start + series.levels.length; w += window) {
    const rows: number[][] = [];
    const residual: number[] = [];
    let diurnalPower = 0;
    for (let h = Math.max(w, series.start); h < w + window; h++) {
      const value = series.levels[h - series.start];
      if (value === undefined || Number.isNaN(value)) continue;
      rows.push([1, slope(semi, h), slope(diur, h)]);
      residual.push(value - full[at(h)]!);
      diurnalPower += diur[at(h)]! ** 2;
    }
    if (rows.length < minHours) continue;
    const diurnalRms = Math.sqrt(diurnalPower / rows.length);
    const timed = diurnalRms >= minDiurnal / Math.SQRT2;
    const x = timed ? rows : rows.map((r) => r.slice(0, 2));
    const coef = leastSquares(x, residual);
    out.push({
      time: w * HOUR_MS,
      hours: rows.length,
      semidiurnal: -coef[1]! * 60,
      diurnal: timed ? -coef[2]! * 60 : null,
    });
  }
  return out;
}

export interface Run {
  from: number;
  to: number;
  /** Windows in the run. */
  count: number;
  /** The largest departure from the record's median, signed, in the series' unit. */
  peak: number;
}

/**
 * Stretches of consecutive values, at most `gap` apart, that depart from the
 * record's median by `threshold` or more in the same direction.
 */
export function runs(
  values: { time: number; value: number }[],
  threshold: number,
  gap: number,
  minCount = 2,
): Run[] {
  const center = median(values.map((v) => v.value));
  const out: Run[] = [];
  let current: Run | null = null;
  for (const { time, value } of values) {
    const off = value - center;
    const sign = Math.sign(off);
    const within = current && time - current.to <= gap && Math.sign(current.peak) === sign;
    if (Math.abs(off) < threshold) {
      current = null;
      continue;
    }
    if (within) {
      current!.to = time;
      current!.count++;
      if (Math.abs(off) > Math.abs(current!.peak)) current!.peak = off;
    } else {
      current = { from: time, to: time, count: 1, peak: off };
      out.push(current);
    }
  }
  return out.filter((r) => r.count >= minCount);
}

/** Daily means from `minHours` or more hourly values, by day since 1970. */
export function dailyMeans(series: Hourly, minHours = 20): Map<number, number> {
  const sums = new Map<number, { sum: number; n: number }>();
  series.levels.forEach((value, i) => {
    if (Number.isNaN(value)) return;
    const day = Math.floor((series.start + i) / DAY_HOURS);
    const s = sums.get(day) ?? { sum: 0, n: 0 };
    s.sum += value;
    s.n++;
    sums.set(day, s);
  });
  const out = new Map<number, number>();
  for (const [day, { sum, n }] of sums) if (n >= minHours) out.set(day, sum / n);
  return out;
}

const STEP_WINDOW = 30;
const STEP_SPAN = 120;

export interface Step {
  /** First day after the step, since 1970. */
  day: number;
  /** Meters: the median after less the median before. */
  size: number;
}

/**
 * Level steps in a daily series, such as one gauge less its neighbor: where the
 * median of the next `window` values differs from that of the previous
 * `window` by `minStep` or more, at the largest such change within a window
 * either side, and by `spreadFactor` times the values' spread about those two
 * medians. A datum step stands clear of that spread; weather, river flow and
 * sluice operations move the difference by as much as they step it.
 */
export function steps(
  daily: Map<number, number>,
  { window = STEP_WINDOW, minStep = 0.08, spreadFactor = 3, maxSpanDays = STEP_SPAN } = {},
): Step[] {
  const days = [...daily.keys()].sort((a, b) => a - b);
  const values = days.map((d) => daily.get(d)!);
  if (values.length < 2 * window) return [];
  const candidates: (Step & { i: number })[] = [];
  for (let i = window; i <= values.length - window; i++) {
    // Values either side must be close in time, or a gap would hide a slow change.
    if (days[i + window - 1]! - days[i - window]! > maxSpanDays) continue;
    const size = median(values.slice(i, i + window)) - median(values.slice(i - window, i));
    if (Math.abs(size) >= minStep) candidates.push({ day: days[i]!, size, i });
  }
  const peaks = candidates.filter((c) =>
    candidates.every(
      (o) =>
        Math.abs(o.day - c.day) > window ||
        Math.abs(o.size) < Math.abs(c.size) ||
        // Medians plateau, so of equal peaks the first stands.
        (Math.abs(o.size) === Math.abs(c.size) && o.day >= c.day),
    ),
  );
  return peaks
    .filter(({ i, size }) => {
      const before = values.slice(i - window, i);
      const after = values.slice(i, i + window);
      const [low, high] = [median(before), median(after)];
      const spread =
        1.4826 *
        median([...before.map((v) => Math.abs(v - low)), ...after.map((v) => Math.abs(v - high))]);
      return Math.abs(size) >= spreadFactor * spread;
    })
    .map(({ day, size }) => ({ day, size }));
}

export interface StationStep extends Step {
  /** Neighbors whose difference shows the step. */
  seen: string[];
  /** Neighbors with data on both sides that don't. */
  unseen: string[];
}

/**
 * Steps at a station, from steps in its differences against each neighbor: a
 * step in the station shows against every neighbor with the same sign, while
 * one in a neighbor shows against that neighbor alone. A step counts when
 * `minSeen` neighbors show it within `tolerance` days and most of those that
 * could, do.
 */
export function attribute(
  station: Map<number, number>,
  neighbors: Map<string, Map<number, number>>,
  {
    tolerance = 5,
    minSeen = 2,
    ...options
  }: Parameters<typeof steps>[1] & {
    tolerance?: number;
    minSeen?: number;
  } = {},
): StationStep[] {
  const found = new Map<string, Step[]>();
  const shared = new Map<string, number[]>();
  for (const [id, other] of neighbors) {
    const diff = new Map<number, number>();
    for (const [day, value] of station) {
      const o = other.get(day);
      if (o !== undefined) diff.set(day, value - o);
    }
    found.set(id, steps(diff, options));
    shared.set(
      id,
      [...diff.keys()].sort((a, b) => a - b),
    );
  }
  const { window = STEP_WINDOW, maxSpanDays = STEP_SPAN } = options;
  // A neighbor counts against a step only where `steps` could have seen it there.
  const could = (days: number[], day: number) =>
    days.some(
      (d, i) =>
        Math.abs(d - day) <= tolerance &&
        i >= window &&
        i + window <= days.length &&
        days[i + window - 1]! - days[i - window]! <= maxSpanDays,
    );
  const out: StationStep[] = [];
  const all = [...found.entries()].flatMap(([id, s]) => s.map((step) => ({ id, ...step })));
  all.sort((a, b) => Math.abs(b.size) - Math.abs(a.size));
  for (const step of all) {
    if (out.some((o) => Math.abs(o.day - step.day) <= tolerance)) continue;
    const seen: string[] = [];
    const sizes: number[] = [];
    const unseen: string[] = [];
    for (const [id, list] of found) {
      const match = list.find(
        (s) =>
          Math.abs(s.day - step.day) <= tolerance && Math.sign(s.size) === Math.sign(step.size),
      );
      if (match) {
        seen.push(id);
        sizes.push(match.size);
      } else if (could(shared.get(id)!, step.day)) unseen.push(id);
    }
    if (seen.length >= minSeen && seen.length > unseen.length)
      out.push({ day: step.day, size: median(sizes), seen, unseen });
  }
  return out.sort((a, b) => a.day - b.day);
}

/** Least squares by the normal equations and Gaussian elimination; fine for a few well-scaled columns. */
function leastSquares(rows: number[][], y: number[]): number[] {
  const n = rows[0]!.length;
  const a = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      rows.reduce((s, r, k) => s + r[i]! * (j < n ? r[j]! : y[k]!), 0),
    ),
  );
  for (let c = 0; c < n; c++) {
    const pivot = a
      .slice(c)
      .reduce((best, row, i) => (Math.abs(row[c]!) > Math.abs(a[best]![c]!) ? c + i : best), c);
    [a[c], a[pivot]] = [a[pivot]!, a[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r]![c]! / a[c]![c]!;
      for (let j = c; j <= n; j++) a[r]![j]! -= f * a[c]![j]!;
    }
  }
  return a.map((row, i) => row[n]! / row[i]!);
}

/** Great-circle distance in km. */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function variance(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
}

function correlation(a: number[], b: number[]): number {
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}
