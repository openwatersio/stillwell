import { fit as engineFit, selectConstituents, type FittedConstituent } from "@slackwater/engine";
import type { Sample } from "../types.ts";
import { CANDIDATES } from "./candidates.ts";
import { FIT_OPTIONS, MIN_FIT_DAYS, SEASONAL_SIGNIFICANCE } from "./fit.ts";
import { harmonicSamples, NODE_CORRECTIONS, SEASONAL, yearlyScatter } from "./scores.ts";
import { Unfit } from "./series.ts";

const DAY_MS = 86_400_000;

/** What selection decided for one candidate of a fit. */
export interface Verdict {
  name: string;
  kept: boolean;
  /** Why it wasn't kept, as a candidate row's `reason`. */
  reason: string | null;
  /** The constituent a `rayleigh` candidate couldn't be separated from. */
  conflict: string | null;
}

/** A fit of given samples: the kept constants with their intervals, and every candidate's verdict. */
export interface WindowFit {
  /** Hourly values fitted. */
  hours: number;
  z0: number;
  rms: number;
  constituents: FittedConstituent[];
  verdicts: Verdict[];
}

/**
 * Fit `samples`, a station's levels on the hour sorted by time, as
 * `fitStation` fits its own window: the same candidates, the Rayleigh and SNR
 * selection in a plain fit, robust weights for the constituents kept, and Sa
 * and Ssa judged by their yearly spread. `fitStation` chooses the 19 years
 * before its held-out year; this fits whatever window the caller read, such
 * as the years an agency analyzed, so the two can be compared on one record.
 * The samples needn't be contiguous. Throws `Unfit` for a record too short
 * to fit, as `fitStation` gives no constants for one.
 */
export function fitSamples(samples: readonly Sample[]): WindowFit {
  const days = samples.length ? (samples.at(-1)!.time - samples[0]!.time) / DAY_MS : 0;
  if (days < MIN_FIT_DAYS || samples.length < (MIN_FIT_DAYS * 24) / 2)
    throw new Unfit(`under ${MIN_FIT_DAYS} days of values`);

  const seasonal: readonly string[] = SEASONAL;
  const candidates = CANDIDATES.filter((c) => !seasonal.includes(c.name));
  const engineSamples = harmonicSamples(samples);
  const { selection } = selectConstituents(engineSamples, {
    candidates: candidates.map(({ name }) => ({ name })),
    nodeCorrections: NODE_CORRECTIONS,
  });
  const chosen = selection.filter((s) => s.kept).map((s) => s.name);
  const fitted = engineFit(engineSamples, [...chosen, ...SEASONAL], {
    ...FIT_OPTIONS,
    confidence: true,
    dropDependent: true,
  });
  const yearly = yearlyScatter(
    samples,
    [...fitted.constituents]
      .filter((c) => !seasonal.includes(c.name))
      .sort((a, b) => b.amplitude - a.amplitude)
      .map((c) => c.name),
    { ...FIT_OPTIONS, seasonal: true },
  );
  const seasonalKept = (name: string, amplitude: number) => {
    const spread = yearly.seasonal?.[name];
    return !!spread && amplitude >= SEASONAL_SIGNIFICANCE * spread.se;
  };
  const kept = fitted.constituents.filter(
    (c) => !seasonal.includes(c.name) || seasonalKept(c.name, c.amplitude),
  );
  if (kept.some((c) => !Number.isFinite(c.amplitude) || !Number.isFinite(c.phase)))
    throw new Error("the fit gave a constant that isn't a number");

  const verdicts = new Map(selection.map((s) => [s.name, s]));
  const names = new Set(kept.map((c) => c.name));
  const fittedNames = new Set(fitted.constituents.map((c) => c.name));
  return {
    hours: samples.length,
    z0: fitted.offset,
    rms: fitted.rms,
    constituents: kept,
    verdicts: CANDIDATES.map(({ name }) => {
      const verdict = verdicts.get(name);
      const isKept = names.has(name);
      return {
        name,
        kept: isKept,
        reason: isKept
          ? null
          : seasonal.includes(name)
            ? fittedNames.has(name)
              ? "seasonal"
              : "rankDeficient"
            : (verdict?.reason ?? "rankDeficient"),
        conflict: verdict?.conflict ?? null,
      };
    }),
  };
}
