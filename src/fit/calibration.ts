import type { FittedConstituent, HarmonicConstituent } from "@slackwater/engine";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import type { StoredStation } from "../schema.ts";
import { EMPTY_YEAR, readYearStats } from "../store/parquet.ts";
import { seriesDir } from "../store/paths.ts";
import type { YearRow } from "../store/years.ts";
import { CANDIDATES, type Candidate } from "./candidates.ts";
import type { Verdict } from "./window.ts";

/**
 * A fit's constants against an agency's published ones for the same gauge,
 * constituent by constituent. The comparison is what the calibration report
 * (docs/results/fit-calibration.md) is built from, and nothing here fits or
 * reads the store.
 */

const RAD = Math.PI / 180;

/**
 * A digest of the candidate list, its names and Doodson numbers in order, as
 * `inputsDigest` takes them. The calibration report records it, since a
 * change to the list moves fits without a new `METHOD`.
 */
export function candidatesDigest(): string {
  return createHash("sha256")
    .update(JSON.stringify(CANDIDATES.map((c) => [c.name, c.doodson])))
    .digest("hex")
    .slice(0, 16);
}

/**
 * NOAA's names the engine's catalog resolves to another line than NOAA's, so a
 * prediction or fit under the catalog's name isn't NOAA's constituent: 4MSL12
 * resolves to 6MSN12, half a cycle away. They are left out of what is fitted
 * and predicted as NOAA's, and reported.
 */
export const MISNAMED: readonly string[] = ["4MSL12"];

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
  verdicts: readonly Pick<Verdict, "name" | "reason" | "conflict">[],
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

/** An agency's published constants for a gauge: amplitudes in meters and Greenwich phase lags in UTC, in degrees. */
export interface Published {
  /** The agency's note on the constants, which for NOAA names the years analyzed. */
  comment: string;
  constants: HarmonicConstituent[];
}

/**
 * NOAA's constants from a CO-OPS metadata answer (`harcon.json?units=metric`).
 * Throws on an answer that isn't a whole set: one in other units, with a
 * value that isn't a number, with a name twice, without one of the
 * candidates NOAA's standard 37 give, or whose constituents carry different
 * comments, since the comment says which analysis the constants are from.
 */
export function noaaConstants(
  id: string,
  body: {
    units?: string;
    HarmonicConstituents?: {
      name: string;
      amplitude: number;
      phase_GMT: number;
      comments?: string;
    }[];
  },
): Published {
  const list = body.HarmonicConstituents;
  if (body.units !== "meters" || !list?.length)
    throw new Error(`${id}: NOAA's constants didn't come back in meters`);
  const comments = new Set(list.map((c) => c.comments ?? ""));
  if (comments.size !== 1)
    throw new Error(`${id}: NOAA's constants carry ${comments.size} different comments`);
  const constants = list.map((c) => ({ name: c.name, amplitude: c.amplitude, phase: c.phase_GMT }));
  if (constants.some((c) => !Number.isFinite(c.amplitude) || !Number.isFinite(c.phase)))
    throw new Error(`${id}: NOAA's constants hold a value that isn't a number`);
  if (constants.some((c) => c.amplitude < 0 || c.phase < 0 || c.phase > 360))
    throw new Error(
      `${id}: NOAA's constants hold an amplitude under zero or a phase outside 0 to 360`,
    );
  // Two spellings of one candidate would be compared with one fitted constant twice.
  if (new Set(constants.map((c) => candidateOf(c.name)?.name ?? c.name)).size !== constants.length)
    throw new Error(`${id}: NOAA's constants name a constituent twice`);
  const found = new Set(constants.map((c) => candidateOf(c.name)?.name));
  const missing = CANDIDATES.filter((c) => c.from.includes("noaa") && !found.has(c.name));
  if (missing.length)
    throw new Error(`${id}: NOAA's constants lack ${missing.map((c) => c.name).join(", ")}`);
  return { comment: [...comments][0]!, constants };
}

/**
 * The years the first sentence of NOAA's comment on a station's constants
 * names, as `2014-2018` or `(2016-2019, 2022)`: the years of the harmonic
 * analysis. The sentences after it are about the long-period constituents.
 */
export function analysisYears(comment: string): number[] {
  const sentence = comment.split(/\.(?:\s|$)/)[0] ?? "";
  const years = new Set<number>();
  for (const [, from, to] of sentence.matchAll(/\b((?:19|20)\d{2})(?:\s*-\s*((?:19|20)\d{2}))?\b/g))
    for (let y = Number(from); y <= Number(to ?? from); y++) years.add(y);
  return [...years].sort((a, b) => a - b);
}

/**
 * Checks that a local copy's years file agrees with its files for a station:
 * every year file in the station's directories has a row in `years`, with the
 * version the file's values give. Throws where one doesn't. A station the
 * copy marks as being written can be read without its marker only once this
 * passes, since its rows are then known to describe the files read. A row
 * without a file is left to the reader, which refuses a year it is asked for
 * and can't find.
 */
export async function checkCopy(
  store: string,
  station: StoredStation,
  years: ReadonlyMap<string, YearRow>,
): Promise<void> {
  const files: { path: string; epoch: number; year: number }[] = [];
  for (const epoch of station.epochs) {
    const dir = seriesDir(store, "levels", station.source, station.source_id, epoch.id);
    if (!existsSync(dir)) continue;
    for (const name of await readdir(dir)) {
      const year = /^(\d{4})\.parquet$/.exec(name)?.[1];
      if (year) files.push({ path: `${dir}/${name}`, epoch: epoch.id, year: Number(year) });
    }
  }
  const stats = await readYearStats(files.map((f) => f.path));
  const wrong = files.filter((f) => {
    const row = years.get(`${station.id} ${f.epoch} ${f.year}`);
    return !row || row.version !== (stats.get(f.path) ?? EMPTY_YEAR).version;
  });
  if (wrong.length)
    throw new Error(
      `${station.id}: the copy's years file doesn't describe its files for ${wrong.map((f) => f.year).join(", ")}; copy the station's files and the years file again`,
    );
}
