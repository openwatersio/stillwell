import type { Extreme, Sample } from "./types.ts";

export interface ErrorStats {
  n: number;
  /** Mean error (prediction minus reference). */
  bias: number;
  rms: number;
  p95: number;
  max: number;
}

export function stats(errors: number[]): ErrorStats {
  const n = errors.length;
  if (n === 0) return { n, bias: NaN, rms: NaN, p95: NaN, max: NaN };
  const abs = errors.map(Math.abs).sort((a, b) => a - b);
  return {
    n,
    bias: errors.reduce((a, b) => a + b, 0) / n,
    rms: Math.sqrt(errors.reduce((a, b) => a + b * b, 0) / n),
    p95: abs[Math.min(n - 1, Math.floor(0.95 * n))]!,
    max: abs[n - 1]!,
  };
}

/** Errors of `predicted` against `reference` at the reference's times. */
export function curveErrors(predicted: Sample[], reference: Sample[]): ErrorStats {
  const at = new Map(predicted.map((s) => [s.time, s.level]));
  const errors: number[] = [];
  for (const r of reference) {
    const p = at.get(r.time);
    if (p !== undefined) errors.push(p - r.level);
  }
  return stats(errors);
}

export interface PairStats {
  /** Time errors in minutes and height errors in meters, over matched pairs. */
  time: ErrorStats;
  height: ErrorStats;
}

export interface ExtremeComparison extends PairStats {
  reference: number;
  predicted: number;
  matched: number;
  high: PairStats;
  low: PairStats;
}

/**
 * Match each reference extreme to the nearest predicted extreme of the same
 * type within `windowMinutes`, one to one, and compare the pairs.
 */
export function compareExtremes(
  predicted: Extreme[],
  reference: Extreme[],
  windowMinutes = 180,
): ExtremeComparison {
  const window = windowMinutes * 60_000;
  const used = new Set<number>();
  const pairs: { type: Extreme["type"]; time: number; height: number }[] = [];
  const sorted = [...predicted].sort((a, b) => a.time - b.time);
  let start = 0;
  for (const r of [...reference].sort((a, b) => a.time - b.time)) {
    while (start < sorted.length && sorted[start]!.time < r.time - window) start++;
    let best = -1;
    for (let i = start; i < sorted.length && sorted[i]!.time <= r.time + window; i++) {
      const p = sorted[i]!;
      if (p.type !== r.type || used.has(i)) continue;
      if (best < 0 || Math.abs(p.time - r.time) < Math.abs(sorted[best]!.time - r.time)) best = i;
    }
    if (best < 0) continue;
    used.add(best);
    pairs.push({
      type: r.type,
      time: (sorted[best]!.time - r.time) / 60_000,
      height: sorted[best]!.level - r.level,
    });
  }
  const of = (subset: typeof pairs): PairStats => ({
    time: stats(subset.map((p) => p.time)),
    height: stats(subset.map((p) => p.height)),
  });
  return {
    reference: reference.length,
    predicted: predicted.length,
    matched: pairs.length,
    ...of(pairs),
    high: of(pairs.filter((p) => p.type === "high")),
    low: of(pairs.filter((p) => p.type === "low")),
  };
}
