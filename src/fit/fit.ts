import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTidePredictor, type HarmonicConstituent } from "@slackwater/engine";
import type { StoredStation } from "../schema.ts";
import type { Sample } from "../types.ts";
import { CANDIDATES } from "./candidates.ts";
import {
  FIT_OPTIONS,
  fitSamples,
  MIN_FIT_DAYS,
  SEASONAL_SIGNIFICANCE,
  tooShort,
} from "./window.ts";
import {
  harmonicSamples,
  NODE_CORRECTIONS,
  scoreHeldOut,
  SEASONAL,
  tidalResiduals,
  yearlyScatter,
} from "./scores.ts";
import {
  Busy,
  emptyInputs,
  inputsDigest,
  readSeries,
  Unfit,
  type Inputs,
  type ReadContext,
} from "./series.ts";

/*
 * The method and its scoring follow slackwater-database's fits of the same
 * series (https://github.com/openwatersio/slackwater-database), MIT licensed,
 * copyright Open Water Software, LLC.
 */

/**
 * One station's harmonic fit: constants from up to 19 years of final values on
 * the hour, scored on a year the fit didn't read. The method is the published
 * one: least squares with each constituent's nodal factors applied at each
 * sample's time (Foreman, Cherniawsky and Ballantyne 2009), robust weights
 * (Leffler and Jay 2009), the Rayleigh criterion and SNR ≥ 2 to choose
 * constituents (Foreman 1977; Codiga 2011), and confidence intervals from the
 * residual spectrum (Pawlowicz, Beardsley and Lentz 2002).
 *
 * A fit is a measurement, published whatever its size: nothing here decides
 * whether a gauge has enough tide to predict. Its rows carry what a reader
 * needs to decide that.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** The longest window a fit takes: one nodal cycle. */
export const MAX_FIT_YEARS = 19;
export { FIT_OPTIONS, MIN_FIT_DAYS, NODE_CORRECTIONS, SEASONAL_SIGNIFICANCE };

/** The package that fitted and its version, as the fit's provenance. */
export function engineVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.resolve("@slackwater/engine")));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "@slackwater/engine") return `${pkg.name}@${pkg.version}`;
    } catch {
      // No package.json at this level.
    }
    const up = dirname(dir);
    if (up === dir) throw new Error("can't find @slackwater/engine's package.json");
    dir = up;
  }
}

/** A row of `fits/<source>.parquet`. */
export interface Fit {
  id: string;
  /** When the fit ran. */
  fitted: string;
  /** Why the station has no constants; null where it has. */
  reason: string | null;
  /** A digest of the fit's window and constants; null without constants. */
  version: string | null;
  /** The fit's window, `since` to before `until`. */
  since: string | null;
  until: string | null;
  /** Hourly values fitted. */
  hours: number | null;
  /** The window's mean level, in the station's current datum: what a prediction from the constants is added to. */
  z0_m: number | null;
  /** RMS residual of the fit over its window, under the fit's robust weights. */
  rms_m: number | null;
  /** Calendar years of the window fitted on their own for the yearly scatter. */
  years: number | null;
  node_corrections: string | null;
  engine: string;
  /** The year the fit is scored on, which it didn't read. */
  held_out: number | null;
  held_out_hours: number | null;
  /** Tidal-band RMS of observed minus predicted over the held-out year, after a Godin filter. */
  held_out_rms_m: number | null;
  /** One minus the residual's variance over the observed levels', both after the Godin filter. */
  variance_explained: number | null;
  d1_rms_m: number | null;
  d2_rms_m: number | null;
  d4_rms_m: number | null;
  d6_rms_m: number | null;
  turns: number | null;
  turns_missed: number | null;
  turn_time_mean_min: number | null;
  turn_time_rms_min: number | null;
  turn_height_mean_m: number | null;
  turn_height_rms_m: number | null;
  /** Mean high water minus mean low water of the fit's prediction over the held-out year. */
  mean_range_m: number | null;
  settled_before: string | null;
  source_qc_start: string | null;
  /** The year files, epochs and errata the fit read, as JSON (`Inputs`). */
  inputs: string;
}

/** A row of `constituents/<source>.parquet`: one candidate of one fit. */
export interface FittedCandidate {
  id: string;
  /** The `version` of the fit the row belongs to. */
  version: string;
  name: string;
  /** Place in the candidates' priority order, from 1. */
  rank: number;
  doodson: number[];
  speed: number;
  kept: boolean;
  /** Why it wasn't kept: `rayleigh`, `snr`, `nyquist`, `unknown`, `rankDeficient` or `seasonal`. */
  reason: string | null;
  /** The constituent a `rayleigh` candidate couldn't be separated from. */
  conflict: string | null;
  amplitude_m: number | null;
  /** Greenwich phase lag in degrees, in UTC. */
  phase_deg: number | null;
  /** Half-widths of the 95% intervals. */
  amplitude_ci_m: number | null;
  phase_ci_deg: number | null;
  snr: number | null;
  /** Between the yearly fits: standard deviation of amplitude and circular standard deviation of phase. */
  yearly_amplitude_sd_m: number | null;
  yearly_phase_sd_deg: number | null;
  /** For Sa and Ssa: the standard error of the mean of the yearly fits. */
  yearly_se_m: number | null;
}

export interface FitContext extends Omit<ReadContext, "inputs"> {
  /** The source's last whole year of final values (`finalYear`). */
  finalYear: number;
  engine: string;
}

const year = (y: number) => ({ start: Date.UTC(y, 0, 1), end: Date.UTC(y + 1, 0, 1) });
const iso = (t: number) => new Date(t).toISOString();

const noFit = (id: string, context: FitContext, inputs: Inputs, reason: string): Fit => ({
  id,
  fitted: context.now.toISOString(),
  reason,
  version: null,
  since: null,
  until: null,
  hours: null,
  z0_m: null,
  rms_m: null,
  years: null,
  node_corrections: null,
  engine: context.engine,
  held_out: null,
  held_out_hours: null,
  held_out_rms_m: null,
  variance_explained: null,
  d1_rms_m: null,
  d2_rms_m: null,
  d4_rms_m: null,
  d6_rms_m: null,
  turns: null,
  turns_missed: null,
  turn_time_mean_min: null,
  turn_time_rms_min: null,
  turn_height_mean_m: null,
  turn_height_rms_m: null,
  mean_range_m: null,
  settled_before: inputs.settled_before,
  source_qc_start: inputs.source_qc_start,
  inputs: JSON.stringify(inputs),
});

/** Mean high water minus mean low water of the curve `constituents` predict from `start` to `end`. */
export function meanRange(
  constituents: HarmonicConstituent[],
  start: number,
  end: number,
): number | null {
  const extremes = createTidePredictor(constituents, {
    offset: false,
    nodeCorrections: NODE_CORRECTIONS,
  }).getExtremesPrediction({
    start: new Date(start),
    end: new Date(end),
  });
  const mean = (high: boolean) => {
    const levels = extremes.filter((e) => e.high === high).map((e) => e.level);
    return levels.length ? levels.reduce((s, x) => s + x, 0) / levels.length : null;
  };
  const [high, low] = [mean(true), mean(false)];
  return high === null || low === null ? null : high - low;
}

/** A number that couldn't be computed, such as a mean over no turns or an interval from an empty spectrum, is null in the file. */
const finite = (x: number | null) => (x !== null && Number.isFinite(x) ? x : null);

const variance = (xs: number[]) => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length;
};

/**
 * The share of the tidal band's variance the constants explain over
 * `observed`: one minus the residual's variance over the observed levels',
 * both after the Godin filter. Null where no hour can be scored or the
 * observed levels don't vary.
 */
export function varianceExplained(
  constituents: HarmonicConstituent[],
  observed: readonly Sample[],
): number | null {
  const residual = [...tidalResiduals(constituents, observed).values()];
  const levels = [...tidalResiduals([], observed).values()];
  if (!residual.length || !levels.length) return null;
  const total = variance(levels);
  return total > 0 ? 1 - variance(residual) / total : null;
}

/**
 * Fit one station. The held-out year is the latest, at or before the source's
 * last year of final values, in which half the station's hours can be scored:
 * an hour counts when the 71 hours around it all have values, as the Godin
 * filter needs. The window is the 19 years before it, or as many as the
 * station has. Returns the fit's row and a row for every candidate; a station
 * that can't be fitted gets a row that says why and no candidates. Throws
 * `Busy` while the station's year files are being written.
 */
export async function fitStation(
  station: StoredStation,
  context: FitContext,
): Promise<{ fit: Fit; constituents: FittedCandidate[] }> {
  const inputs = { ...emptyInputs(), digest: inputsDigest(station, context) };
  const read = (period: { start: number; end: number }) =>
    readSeries(station, period, "final", { ...context, inputs });
  const none = (reason: string) => ({
    fit: noFit(station.id, context, inputs, reason),
    constituents: [],
  });
  try {
    const listed = [...context.years.values()]
      .filter((r) => r.id === station.id && r.year !== null)
      .map((r) => r.year!);
    if (!listed.length) return none("no year files");
    const first = Math.min(...listed);

    let heldOut: number | undefined;
    let heldSamples: Sample[] = [];
    for (let y = context.finalYear; y >= first; y--) {
      const span = year(y);
      const samples = await read(span);
      const hours = (span.end - span.start) / HOUR_MS;
      if (samples.length >= hours / 2 && tidalResiduals([], samples).size >= hours / 2) {
        heldOut = y;
        heldSamples = samples;
        break;
      }
    }
    if (heldOut === undefined)
      return none("no year with half its hours final, on the hour and scoreable");

    const start = Math.max(year(first).start, year(heldOut - MAX_FIT_YEARS).start);
    const end = year(heldOut).start;
    const samples = await read({ start, end });
    if (tooShort(samples))
      return none(`under ${MIN_FIT_DAYS} days of final values before ${heldOut}`);

    const fitted = fitSamples(samples);
    const { yearly } = fitted;
    const constants = fitted.constituents.map(({ name, amplitude, phase }) => ({
      name,
      amplitude,
      phase,
    }));

    const version = createHash("sha256")
      .update(JSON.stringify([start, end, NODE_CORRECTIONS, constants]))
      .digest("hex")
      .slice(0, 16);
    const byName = new Map(fitted.fitted.map((c) => [c.name, c]));
    const rows: FittedCandidate[] = CANDIDATES.map((candidate, index) => {
      const c = byName.get(candidate.name);
      const verdict = fitted.verdicts[index]!;
      const scatter = yearly.constituents[candidate.name];
      return {
        id: station.id,
        version,
        name: candidate.name,
        rank: index + 1,
        doodson: candidate.doodson,
        speed: candidate.speed,
        kept: verdict.kept,
        reason: verdict.reason,
        conflict: verdict.conflict,
        amplitude_m: finite(c?.amplitude ?? null),
        phase_deg: finite(c?.phase ?? null),
        amplitude_ci_m: finite(c?.amplitudeInterval ?? null),
        phase_ci_deg: finite(c?.phaseInterval ?? null),
        snr: finite(c?.snr ?? verdict.snr),
        yearly_amplitude_sd_m: finite(scatter?.amplitude ?? null),
        yearly_phase_sd_deg: finite(scatter?.phase ?? null),
        yearly_se_m: finite(yearly.seasonal?.[candidate.name]?.se ?? null),
      };
    });

    const span = year(heldOut);
    const score = scoreHeldOut(heldSamples, constants, {}).fit;
    return {
      fit: {
        id: station.id,
        fitted: context.now.toISOString(),
        reason: null,
        version,
        since: iso(start),
        until: iso(end),
        hours: samples.length,
        z0_m: finite(fitted.z0),
        rms_m: finite(fitted.rms),
        years: yearly.years,
        node_corrections: NODE_CORRECTIONS,
        engine: context.engine,
        held_out: heldOut,
        held_out_hours: score.hours,
        held_out_rms_m: finite(score.rms),
        variance_explained: finite(varianceExplained(constants, heldSamples)),
        d1_rms_m: finite(score.bands.D1),
        d2_rms_m: finite(score.bands.D2),
        d4_rms_m: finite(score.bands.D4),
        d6_rms_m: finite(score.bands.D6),
        turns: score.turns.matched,
        turns_missed: score.turns.unmatched,
        turn_time_mean_min: finite(score.turns.timeMean),
        turn_time_rms_min: finite(score.turns.timeRms),
        turn_height_mean_m: finite(score.turns.heightMean),
        turn_height_rms_m: finite(score.turns.heightRms),
        mean_range_m: finite(meanRange(constants, span.start, span.end)),
        settled_before: inputs.settled_before,
        source_qc_start: inputs.source_qc_start,
        inputs: JSON.stringify(inputs),
      },
      constituents: rows,
    };
  } catch (error) {
    if (error instanceof Unfit && !(error instanceof Busy)) return none(error.message);
    throw error;
  }
}
