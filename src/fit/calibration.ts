import type { FittedConstituent, HarmonicConstituent } from "@slackwater/engine";
import { CANDIDATES, type Candidate } from "./candidates.ts";
import type { Verdict } from "./window.ts";

/**
 * A fit's constants against an agency's published ones for the same gauge,
 * constituent by constituent. The comparison is what the calibration report
 * (docs/results/fit-calibration.md) is built from, and nothing here fits or
 * reads the store.
 */

const RAD = Math.PI / 180;

/** The candidate an agency's name means: its own name, or one of the spellings the candidate lists. */
export function candidateOf(name: string): Candidate | undefined {
  return CANDIDATES.find((c) => c.name === name || c.spellings?.includes(name));
}

/**
 * The fitted constituent to compare with the agency's `name`, or why there is
 * none. Where selection dropped the candidate for one earlier in the list on
 * the same line, with the same Doodson numbers, the fit holds that line under
 * the earlier name, and `sameLine` names it: the two are one frequency, though
 * their nodal corrections can differ.
 */
export function fittedFor(
  name: string,
  constituents: readonly FittedConstituent[],
  verdicts: readonly Verdict[],
): { fitted: FittedConstituent; sameLine: string | null } | { reason: string } {
  const candidate = candidateOf(name);
  if (!candidate) return { reason: "not a candidate" };
  const own = constituents.find((c) => c.name === candidate.name);
  if (own) return { fitted: own, sameLine: null };
  const verdict = verdicts.find((v) => v.name === candidate.name);
  const other = verdict?.conflict ? candidateOf(verdict.conflict) : undefined;
  if (verdict?.reason === "rayleigh" && other && sameLine(candidate, other)) {
    const fitted = constituents.find((c) => c.name === other.name);
    if (fitted) return { fitted, sameLine: other.name };
  }
  return {
    reason:
      verdict?.reason === "rayleigh" && verdict.conflict
        ? `rayleigh (${verdict.conflict})`
        : (verdict?.reason ?? "not fitted"),
  };
}

const sameLine = (a: Candidate, b: Candidate) =>
  a.doodson.length === b.doodson.length && a.doodson.every((n, i) => n === b.doodson[i]);

/** Half the last digit an agency publishes, in meters and degrees: what rounding alone can move a constant by. */
export interface Rounding {
  amplitude: number;
  phase: number;
}

/** One constituent of a fit against the agency's. Differences are the fit's minus the agency's. */
export interface Difference {
  /** Meters. */
  amplitude: number;
  /** The amplitude difference as a share of the agency's amplitude; null where that is zero. */
  relative: number | null;
  /** Degrees, wrapped to ±180; null where either amplitude is zero, so one phase means nothing. */
  phase: number | null;
  /** The length of the difference of the two constants as vectors, in meters. */
  vector: number;
  /**
   * The larger of the amplitude and phase differences over the fit's 95%
   * half-widths, each widened in quadrature by the agency's rounding: over 1
   * is outside the interval, by that factor. Null where the fit gave no interval.
   */
  ratio: number | null;
}

/** Degrees from `b` to `a`, wrapped to ±180. */
export const phaseDifference = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

export function difference(
  ours: FittedConstituent,
  theirs: HarmonicConstituent,
  rounding: Rounding,
): Difference {
  const amplitude = ours.amplitude - theirs.amplitude;
  const phase =
    theirs.amplitude > 0 && ours.amplitude > 0 ? phaseDifference(ours.phase, theirs.phase) : null;
  const vector = Math.hypot(
    ours.amplitude * Math.cos(ours.phase * RAD) - theirs.amplitude * Math.cos(theirs.phase * RAD),
    ours.amplitude * Math.sin(ours.phase * RAD) - theirs.amplitude * Math.sin(theirs.phase * RAD),
  );
  const ai = ours.amplitudeInterval;
  const pi = ours.phaseInterval;
  const finite = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);
  const ratio =
    finite(ai) && finite(pi)
      ? Math.max(
          Math.abs(amplitude) / Math.hypot(ai, rounding.amplitude),
          phase === null ? 0 : Math.abs(phase) / Math.hypot(pi, rounding.phase),
        )
      : null;
  return {
    amplitude,
    relative: theirs.amplitude > 0 ? amplitude / theirs.amplitude : null,
    phase,
    vector,
    ratio,
  };
}

/** The vector average of one constituent's constants from several fits, as NOAA averages its yearly analyses. */
export function vectorAverage(
  constants: readonly Pick<HarmonicConstituent, "amplitude" | "phase">[],
): { amplitude: number; phase: number } | null {
  if (!constants.length) return null;
  const x = constants.reduce((s, c) => s + c.amplitude * Math.cos(c.phase * RAD), 0);
  const y = constants.reduce((s, c) => s + c.amplitude * Math.sin(c.phase * RAD), 0);
  return {
    amplitude: Math.hypot(x, y) / constants.length,
    phase: (((Math.atan2(y, x) / RAD) % 360) + 360) % 360,
  };
}

/** The middle value of `xs`; null for none. */
export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
