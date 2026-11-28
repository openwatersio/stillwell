import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { constituents as catalog } from "@slackwater/engine";
import { sawYear, type HeldOutScore, type NodeCorrections, type OtherConstants } from "./scores.ts";

/**
 * The constants slackwater-database holds for a fitted gauge, scored on the
 * fit's held-out year by the code that scores the fit: what a record to score
 * is, when its stored scores are due again, and their rows. Which records are
 * a station's is in `reference-links.ts`, which the fits and their workers
 * don't load.
 */

/** How a record is known to be the station's gauge. */
export type Link = "id" | "levels";

/** One record to score, as plain data, so it can cross to a worker thread. */
export interface Reference {
  /** The record's ID in slackwater-database. */
  id: string;
  /** The name of the record's source there. */
  source: string;
  /** The `@slackwater/database` release the constants were read from. */
  release: string;
  link: Link;
  /** For `levels`, the series whose levels agree with the station's. */
  linked: string | null;
  nodeCorrections: NodeCorrections;
  /** Whether `nodeCorrections` is this project's assumption, not the source's statement. */
  assumed: boolean;
  /** The span the record says it was analyzed over. */
  epoch: { start: string; end: string } | null;
  /** The record's terms there, and the credit it asks for. */
  license: string;
  commercialUse: boolean;
  attribution: string;
  constituents: { name: string; amplitude: number; phase: number }[];
  digest: string;
}

/** A row of `fits/references/<source>.parquet`: one record's score against one fit. */
export interface ReferenceScore {
  id: string;
  /** The `version` and `fitted` of the fit the row belongs to. */
  version: string;
  fitted: string;
  reference: string;
  reference_source: string;
  reference_license: string;
  reference_commercial_use: boolean;
  reference_attribution: string;
  release: string;
  digest: string;
  link: Link;
  linked: string | null;
  node_corrections: string;
  node_corrections_assumed: boolean;
  /** Whether the record's analysis covered the held-out year; null where its span isn't known. */
  seen: boolean | null;
  /** How many constants the record has, and how many the engine can't predict. */
  constituents: number;
  unpredicted: number;
  scored: string;
  held_out: number;
  held_out_hours: number;
  held_out_rms_m: number | null;
  /** The standard error of the fit's residual variance minus the record's, in m². */
  variance_difference_se_m2: number | null;
  d1_rms_m: number | null;
  d2_rms_m: number | null;
  d4_rms_m: number | null;
  d6_rms_m: number | null;
  turns: number;
  turns_missed: number;
  turn_time_mean_min: number | null;
  turn_time_rms_min: number | null;
  turn_height_mean_m: number | null;
  turn_height_rms_m: number | null;
}

/**
 * The nodal corrections each slackwater-database source's constants were
 * fitted under, by the prefix of its record IDs, where they are known: NOAA's
 * analyses use Schureman's (docs/fits.md, Nodal corrections). A record of any
 * other source is predicted under `ASSUMED`, and its row says so. That
 * includes TICON's: its constants come back under no one family (docs/fits.md,
 * Reference scores; `scripts/ticon-corrections.ts`).
 */
export const STATED: Record<string, NodeCorrections> = { noaa: "schureman" };
/**
 * For a source whose corrections aren't known: the IHO's, which
 * `@slackwater/engine` defaults to, so the score is of the curve
 * slackwater-database's own predictions give.
 */
export const ASSUMED: NodeCorrections = "iho";

/**
 * A digest of a record's constants, in their order: of the array of
 * `[name, amplitude, phase]` as `JSON.stringify` writes it, with no spaces
 * and each number in its shortest form that reads back the same. A score
 * counts only while the constants it was taken against are the record's.
 */
export function constantsDigest(
  constituents: readonly { name: string; amplitude: number; phase: number }[],
): string {
  return createHash("sha256")
    .update(JSON.stringify(constituents.map((c) => [c.name, c.amplitude, c.phase])))
    .digest("hex")
    .slice(0, 16);
}

/** A whole day as `YYYY-MM-DD` that is a real date, in epoch ms; NaN otherwise. */
const day = (text: string) => {
  const time = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN;
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === text ? time : NaN;
};

/**
 * Whether a record analyzed over `epoch` read any of `year`; null where it
 * doesn't say when it was analyzed, or gives days that aren't dates or a span
 * that ends before it starts.
 */
export function seenIn(reference: Pick<Reference, "epoch">, year: number): boolean | null {
  const { epoch } = reference;
  if (!epoch || !(day(epoch.start) <= day(epoch.end))) return null;
  return sawYear(epoch, new Date(Date.UTC(year, 0, 1)), new Date(Date.UTC(year + 1, 0, 1)));
}

/** What `scoreHeldOut` takes for each record, by its ID. */
export function othersOf(
  references: readonly Reference[],
  year: number,
): Record<string, OtherConstants> {
  return Object.fromEntries(
    references.map((r) => [
      r.id,
      { constituents: r.constituents, seen: seenIn(r, year), nodeCorrections: r.nodeCorrections },
    ]),
  );
}

/** What of a record a stored score depends on, besides the fit: the row is scored again when it changes. */
const key = (r: {
  reference: string;
  reference_license: string;
  reference_commercial_use: boolean;
  reference_attribution: string;
  digest: string;
  link: string;
  linked: string | null;
  node_corrections: string;
  node_corrections_assumed: boolean;
  seen: boolean | null;
}) =>
  JSON.stringify([
    r.reference,
    r.reference_license,
    r.reference_commercial_use,
    r.reference_attribution,
    r.digest,
    r.link,
    r.linked,
    r.node_corrections,
    r.node_corrections_assumed,
    r.seen,
  ]);

/**
 * Whether a fit's stored scores are no longer the ones its records would
 * get: a record joined or left the gauge, a release changed one's constants,
 * its terms or whether its analysis covers the held-out year, the link to one changed,
 * or the rows are another fit's, as a run stopped between the files, or a
 * build that doesn't keep this file, leaves them. A fit's `version` covers
 * its window and constants, not the held-out year's values, so the rows also
 * carry the fit's `fitted`. The fit itself is as it was, so only the scores
 * run again.
 */
export function referencesDue(
  fit: { version: string | null; held_out: number | null; fitted: string },
  stored: readonly ReferenceScore[],
  references: readonly Reference[],
): boolean {
  if (fit.version === null || fit.held_out === null) return stored.length > 0;
  if (stored.some((r) => r.version !== fit.version || r.fitted !== fit.fitted)) return true;
  const expected = references.map((r) =>
    key({
      reference: r.id,
      reference_license: r.license,
      reference_commercial_use: r.commercialUse,
      reference_attribution: r.attribution,
      digest: r.digest,
      link: r.link,
      linked: r.linked,
      node_corrections: r.nodeCorrections,
      node_corrections_assumed: r.assumed,
      seen: seenIn(r, fit.held_out!),
    }),
  );
  return JSON.stringify(expected.sort()) !== JSON.stringify(stored.map(key).sort());
}

/** A number that couldn't be computed, such as a mean over no turns, is null in the file. */
const finite = (x: number | null | undefined) =>
  x !== null && x !== undefined && Number.isFinite(x) ? x : null;

/** The rows for a fit's records, from their scores by record ID (`scoreHeldOut`'s `others`). */
export function referenceRows(
  fit: { id: string; version: string; fitted: string; held_out: number },
  references: readonly Reference[],
  scores: Record<string, HeldOutScore>,
  now: Date,
): ReferenceScore[] {
  return references.map((r) => {
    const score = scores[r.id]!;
    return {
      id: fit.id,
      version: fit.version,
      fitted: fit.fitted,
      reference: r.id,
      reference_source: r.source,
      reference_license: r.license,
      reference_commercial_use: r.commercialUse,
      reference_attribution: r.attribution,
      release: r.release,
      digest: r.digest,
      link: r.link,
      linked: r.linked,
      node_corrections: r.nodeCorrections,
      node_corrections_assumed: r.assumed,
      seen: score.seen ?? null,
      constituents: r.constituents.length,
      unpredicted: r.constituents.filter((c) => !catalog[c.name]).length,
      scored: now.toISOString(),
      held_out: fit.held_out,
      held_out_hours: score.hours,
      held_out_rms_m: finite(score.rms),
      variance_difference_se_m2: finite(score.se),
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
    };
  });
}

/** An installed package and its version, such as `@slackwater/engine@1.0.0`, as provenance. */
export function packageVersion(name: string): string {
  let dir = dirname(fileURLToPath(import.meta.resolve(name)));
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === name) return `${pkg.name}@${pkg.version}`;
    } catch {
      // No package.json at this level.
    }
    const up = dirname(dir);
    if (up === dir) throw new Error(`can't find ${name}'s package.json`);
    dir = up;
  }
}
