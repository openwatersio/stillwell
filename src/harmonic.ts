import {
  constituents as engineConstituents,
  createTidePredictor,
  fit as engineFit,
  type HarmonicConstituent,
} from "@slackwater/engine";
import type { Extreme, Sample } from "./types.ts";

/**
 * The harmonic method as Slackwater runs it: least squares through
 * `@slackwater/engine`'s `fit`, predicted with `createTidePredictor`.
 */

/**
 * The 69 constituents of t_tide's standard set (Pawlowicz et al. 2002), in
 * priority order: when a record is too short to separate two of them, the
 * earlier one is kept.
 */
// prettier-ignore
export const STANDARD = [
  "M2", "S2", "N2", "K2", "K1", "O1", "P1", "Q1",
  "M4", "MS4", "MN4", "M6", "2MS6", "2MN6", "M8", "MK4", "S4", "SN4", "2SM6", "2MK6", "MSK6", "SK4",
  "Sa", "Ssa", "Mm", "MSf", "Mf", "MSm",
  "2N2", "mu2", "nu2", "L2", "lambda2", "T2", "R2", "eps2", "eta2", "MKS2", "MSN2", "gamma2", "alpha2", "beta2", "OQ2",
  "J1", "M1", "OO1", "2Q1", "sigma1", "rho1", "tau1", "BET1", "NO1", "chi1", "pi1", "S1", "psi1", "phi1", "theta1", "SO1", "ups1", "ALP1",
  "MO3", "M3", "SO3", "MK3", "SK3",
  "2MK5", "2SK5",
  "3MK7",
];

/**
 * Shallow-water compound tides beyond the standard set, which shallow and
 * river gauges need (openwatersio/slackwater-database#152 needed about 166 terms
 * for RWS gauges).
 */
// prettier-ignore
export const SHALLOW = [
  "2MN2", "2MS2", "MNS2", "MSK2", "2SM2", "3M2S2", "MNK2", "2MK2",
  "2MK3", "2MS3",
  "3MS4", "2MNS4", "3MN4", "MSN4", "2MSK4", "2MKS4", "3MK4", "N4", "ML4", "MA4",
  "3MK5", "3MO5", "MSO5", "M5", "2MO5",
  "3MS6", "4MS6", "2MSN6", "2NM6", "3MN6", "MSN6", "2MSK6", "3MSK6", "M2N6",
  "2MSO7", "M7", "4MK7",
  "3MS8", "3MN8", "2MSN8", "2(MS)8", "4MS8", "3MSK8",
  "4MN10", "M10", "3M2S10", "4MS10",
  "M12", "5MS12", "4M2S12",
];

const HOUR_MS = 3_600_000;

/** Engine keys for names and aliases, case-insensitive. */
const keys = (() => {
  const map = new Map<string, string>();
  for (const [key, c] of Object.entries(engineConstituents)) {
    for (const name of [key, c.name, ...((c as { aliases?: string[] }).aliases ?? [])])
      if (!map.has(name.toUpperCase())) map.set(name.toUpperCase(), key);
  }
  return map;
})();

/**
 * Keep the constituents the engine knows that `spanHours` of record can
 * separate (Rayleigh criterion), in priority order.
 */
export function resolvable(names: string[], spanHours: number, rayleigh = 1): string[] {
  const kept: { key: string; speed: number }[] = [];
  for (const name of names) {
    const key = keys.get(name.toUpperCase());
    if (!key || kept.some((k) => k.key === key)) continue;
    const speed = engineConstituents[key]!.speed;
    const separated = (other: number) => Math.abs(speed - other) * spanHours >= 360 * rayleigh;
    if (separated(0) && kept.every((k) => separated(k.speed))) kept.push({ key, speed });
  }
  return kept.map((k) => k.key);
}

export interface HarmonicModel {
  constituents: HarmonicConstituent[];
  offset: number;
  rms: number;
}

export function fit(samples: Sample[], names: string[]): HarmonicModel {
  const span = (samples.at(-1)!.time - samples[0]!.time) / HOUR_MS;
  const result = engineFit(
    samples.map((s) => ({ time: new Date(s.time), value: s.level })),
    resolvable(names, span),
  );
  return { constituents: result.constituents, offset: result.offset, rms: result.rms };
}

export function timeline(model: HarmonicModel, times: number[]): Sample[] {
  const predictor = createTidePredictor(model.constituents, { offset: model.offset });
  return times.map((time) => ({
    time,
    level: predictor.getWaterLevelAtTime({ time: new Date(time) }).level,
  }));
}

/** Every turning point of the predicted curve, as Slackwater reports them. */
export function extremes(model: HarmonicModel, start: number, end: number): Extreme[] {
  const predictor = createTidePredictor(model.constituents, { offset: model.offset });
  return predictor
    .getExtremesPrediction({ start: new Date(start), end: new Date(end) })
    .map((e) => ({ time: e.time.getTime(), level: e.level, type: e.high ? "high" : "low" }));
}
