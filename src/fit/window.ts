import {
  fit as engineFit,
  selectConstituents,
  type FitOptions,
  type FittedConstituent,
} from "@slackwater/engine";
import type { Sample } from "../types.ts";
import { CANDIDATES } from "./candidates.ts";
import {
  harmonicSamples,
  NODE_CORRECTIONS,
  SEASONAL,
  yearlyScatter,
  type YearlyScatter,
} from "./scores.ts";
import { Unfit } from "./series.ts";

const DAY_MS = 86_400_000;
/** The shortest window a fit takes: under half a year the record can't separate P1 from K1 or K2 from S2. */
export const MIN_FIT_DAYS = 183;
/**
 * How many standard errors of the yearly mean Sa's or Ssa's amplitude must
 * reach to be kept. Weather, steric change and river flow set their size, not
 * the record's resolution, so the test is whether the mean over the years is
 * significant (Parker 2007, §3.7.2), near the 95% level as SNR ≥ 2 is.
 */
export const SEASONAL_SIGNIFICANCE = 2;
/** What the fit of the kept constituents, and each year's fit, is run with. */
export const FIT_OPTIONS: FitOptions = { robust: true, nodeCorrections: NODE_CORRECTIONS };

/** What selection decided for one candidate of a fit. */
export interface Verdict {
  name: string;
  kept: boolean;
  /** Why it wasn't kept, as a candidate row's `reason`. */
  reason: string | null;
  /** The constituent a `rayleigh` candidate couldn't be separated from. */
  conflict: string | null;
  /** The signal-to-noise ratio selection measured in its plain fit; null for Sa and Ssa, which selection leaves out. */
  snr: number | null;
}

/** A fit of given samples: the kept constants with their intervals, and every candidate's verdict. */
export interface WindowFit {
  /** Hourly values fitted. */
  hours: number;
  z0: number;
  rms: number;
  constituents: FittedConstituent[];
  /** Every constituent the fit held, kept or not: `constituents` and Sa or Ssa where their yearly spread dropped them. */
  fitted: FittedConstituent[];
  /** A verdict for every candidate, in the candidates' order. */
  verdicts: Verdict[];
  /** The fits of each calendar year by itself: the scatter of the major constituents and the spread of Sa and Ssa. */
  yearly: YearlyScatter;
}

/** Whether `samples` are too few to fit: the span and the count both, so a few values far apart aren't a record. */
export function tooShort(samples: readonly Sample[]): boolean {
  const days = samples.length ? (samples.at(-1)!.time - samples[0]!.time) / DAY_MS : 0;
  return days < MIN_FIT_DAYS || samples.length < (MIN_FIT_DAYS * 24) / 2;
}

/**
 * Fit `samples`, a station's levels on the hour sorted by time: the
 * candidates, the Rayleigh and SNR selection in a plain fit, robust weights
 * for the constituents kept, and Sa and Ssa judged by their yearly spread.
 * It is the fit `fitStation` makes of the 19 years before its held-out year,
 * and fits whatever window a caller read, such as the years an agency
 * analyzed, so the two are one method. The samples needn't be contiguous.
 * Throws `Unfit` for a record too short to fit.
 */
export function fitSamples(samples: readonly Sample[]): WindowFit {
  if (tooShort(samples)) throw new Unfit(`under ${MIN_FIT_DAYS} days of values`);

  // Sa and Ssa leave the selection and are judged by their yearly spread. Selection tests each
  // candidate in a plain fit; the robust weights enter with the fit of those it keeps.
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
  // Largest first, so a pair a year can't separate keeps its larger member.
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
  // Constants that aren't numbers predict nothing, and would read as missing in a file.
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
    fitted: fitted.constituents,
    yearly,
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
        snr: verdict?.snr ?? null,
      };
    }),
  };
}
