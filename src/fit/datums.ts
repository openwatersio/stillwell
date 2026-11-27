import { createHash } from "node:crypto";
import {
  computeDatums,
  computeDatumsFromObservations,
  type Sample as DatumSample,
} from "@slackwater/datums";
import type { HarmonicConstituent } from "@slackwater/engine";
import { currentEpoch } from "../epochs.ts";
import type { Epoch, StoredStation } from "../schema.ts";
import { FILES } from "../store/files.ts";
import { exists, readRows, writeTable } from "../store/parquet.ts";
import { fitDatumsPath } from "../store/paths.ts";
import type { Fit } from "./fit.ts";
import { packageVersion } from "./references.ts";
import { NODE_CORRECTIONS } from "./scores.ts";
import { CANDIDATES } from "./candidates.ts";
import { emptyInputs, readSeries, type Inputs, type ReadContext } from "./series.ts";

/**
 * Tidal datums from a station's own fit, by `@slackwater/datums`: the observed
 * datums reduced from its measured levels over the longest run of whole years
 * of complete months, the latest on a tie, that it has within the fit's window
 * and held-out year, and the
 * datums of a 19-year synthesis of the fit's constants, HAT and LAT among
 * them, over the epoch the package pins. A row of `fits/datums/<source>.parquet`
 * belongs to one fit, joined on `id`, `version` and `fitted`.
 */

const YEAR_MS = (y: number) => Date.UTC(y, 0, 1);

/**
 * The closest two values the observed reduction reads, in ms. NOAA tabulates
 * high and low waters from 6-minute values, and the package reads a tide's
 * height from a cubic over 2.5 to 6.5 hours of a series finer than 15 minutes,
 * so a 1-minute series thinned to every 5 minutes gives the same tides, and 19
 * years of it fits a fit's worker, where the whole series wouldn't. It is
 * 4½ minutes, so a 5-minute series whose stamps are each within 15 seconds of
 * their mark is read whole.
 */
export const DATUM_SPACING_MS = 270_000;
const iso = (t: number | Date) => new Date(t).toISOString();

/**
 * This step's method, counted up whenever a change here could change a
 * station's datums, so every stored row comes due under the new one. The
 * package's version is in the digest itself, and needs no count.
 */
export const DATUMS_METHOD = 1;

/** The package that reduces the datums and its version, as their provenance. */
export const datumsVersion = () => packageVersion("@slackwater/datums");

/** A row of `fits/datums/<source>.parquet`. */
export interface FitDatums {
  id: string;
  /** The `version` and `fitted` of the fit the datums come from. */
  version: string;
  fitted: string;
  /** When the datums were reduced. */
  reduced: string;
  /** Why the station has no observed datums; null where it has them. */
  reason: string | null;
  /** The zero the datums are heights above: the station's current datum, in its current epoch. */
  datum: string;
  epoch: number;
  /** The observed reduction's window, `since` to before `until`. */
  since: string | null;
  until: string | null;
  months: number | null;
  observed_hours: number | null;
  inferred_hours: number | null;
  /** Heights of the observed datums above `datum`, in meters, by name. */
  observed: Record<string, number> | null;
  /** The synthesis's window, the package's pinned epoch; null without predicted datums. */
  predicted_since: string | null;
  predicted_until: string | null;
  /**
   * Heights of the datums of the fit's constants above `datum`, in meters, by
   * name; null where the fit kept no daily or faster constituent.
   */
  predicted: Record<string, number> | null;
  /** Kept constituents the package's engine doesn't define, left out of both. */
  ignored: string[];
  package: string;
  /** `datumsDigest` when the datums were reduced: they are due again when it changes. */
  digest: string;
}

/**
 * A digest of what a station's datums depend on besides its fit, which the
 * row's `version` and `fitted` name: the package's version and this step's
 * method.
 */
export function datumsDigest(pkg: string): string {
  return createHash("sha256")
    .update(JSON.stringify({ pkg, method: DATUMS_METHOD }))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Whether a station's datums should be reduced again: its fit has constants
 * and its row is missing, from another fit, or under another digest.
 */
export function datumsDue(fit: Fit, row: FitDatums | undefined, pkg: string): boolean {
  if (fit.version === null) return false;
  return (
    !row ||
    row.version !== fit.version ||
    row.fitted !== fit.fitted ||
    row.digest !== datumsDigest(pkg)
  );
}

/**
 * A fit read before the station's epochs last changed, as one whose refit
 * failed: its `z0_m` is in the zero its levels were moved into then, and a
 * reduction now would read them into another. Its datums wait for a fit.
 */
export class Stale extends Error {}

const epochsOf = (
  epochs: readonly Pick<Epoch, "id" | "since" | "until" | "to_current" | "state">[],
) =>
  JSON.stringify(
    [...epochs]
      .sort((a, b) => a.id - b.id)
      .map(({ id, since, until, to_current, state }) => [id, since, until, to_current, state]),
  );

/** Whether a fit read the station's epochs as they are now. */
export function readCurrentEpochs(station: StoredStation, fit: Pick<Fit, "inputs">): boolean {
  try {
    return epochsOf((JSON.parse(fit.inputs) as Inputs).epochs) === epochsOf(station.epochs);
  } catch {
    return false;
  }
}

/** Each candidate's speed, in degrees an hour, by name. */
const SPEED = new Map(CANDIDATES.map((c) => [c.name, c.speed]));
/** Slower than any daily tide: ALP1, the slowest candidate in the diurnal band, is 12.38° an hour. */
const DAILY_SPEED = 10;

/**
 * Reduce one fitted station's datums. The observed reduction reads every
 * measured value, final or not, at every instant the year files hold, from the
 * start of the fit's window to the end of its held-out year: good and
 * preliminary values, never interpolated, suspect or bad ones, so the
 * package's own gap fill and its bounds apply. The fit's constants fill gaps
 * of up to 23 hours under the corrections they were fitted with. The
 * synthesis predicts the constants over the package's pinned epoch on top of
 * the fit's `z0_m`, where the fit kept a daily or faster constituent. Throws
 * `Busy` while the station's year files are being written, and `Stale` where
 * the fit read other epochs than the station has now.
 */
export async function reduceDatums(
  station: StoredStation,
  fit: Fit,
  constants: HarmonicConstituent[],
  context: Omit<ReadContext, "inputs">,
): Promise<FitDatums> {
  if (fit.version === null || fit.since === null || fit.held_out === null || fit.z0_m === null)
    throw new Error(`${station.id}: its fit has no constants to reduce datums from`);
  if (!readCurrentEpochs(station, fit))
    throw new Stale(`${station.id}: its epochs changed after its fit; it waits for a fit`);
  const pkg = datumsVersion();
  const options = { nodeCorrections: NODE_CORRECTIONS } as const;

  // Turns of an annual wave aren't tides, and constants with no turns at all make the package throw.
  const daily = constants.some((c) => c.amplitude > 0 && (SPEED.get(c.name) ?? 0) > DAILY_SPEED);
  const synthesis = daily
    ? computeDatums(constants, undefined, { ...options, offset: fit.z0_m })
    : null;
  const current = currentEpoch(station.epochs);
  const row: FitDatums = {
    id: station.id,
    version: fit.version,
    fitted: fit.fitted,
    reduced: context.now.toISOString(),
    reason: null,
    datum: current.datum,
    epoch: current.id,
    since: null,
    until: null,
    months: null,
    observed_hours: null,
    inferred_hours: null,
    observed: null,
    predicted_since: synthesis && iso(synthesis.start),
    predicted_until: synthesis && iso(synthesis.end),
    predicted: synthesis?.datums ?? null,
    ignored: synthesis?.ignoredConstituents ?? [],
    package: pkg,
    digest: datumsDigest(pkg),
  };

  // Measured values never wait to settle, so the read throws only `Busy` and real faults.
  const samples: DatumSample[] = (
    await readSeries(
      station,
      { start: Date.parse(fit.since), end: YEAR_MS(fit.held_out + 1) },
      "measured",
      { ...context, inputs: emptyInputs() },
      DATUM_SPACING_MS,
    )
  ).map((s) => ({ time: new Date(s.time), level: s.level }));
  const observed = computeDatumsFromObservations(samples, constants, options);
  if (!observed)
    return {
      ...row,
      reason: "no whole year of complete months with a high and a low water",
    };
  return {
    ...row,
    since: iso(observed.start),
    until: iso(observed.end),
    months: observed.coverage.months,
    observed_hours: observed.coverage.observedHours,
    inferred_hours: observed.coverage.inferredHours,
    observed: observed.datums,
    ignored: [...new Set([...row.ignored, ...(observed.ignoredConstituents ?? [])])].sort(),
  };
}

const timestamp = (value: unknown) =>
  value === null || value === undefined
    ? null
    : new Date(Number((value as { micros: bigint }).micros / 1000n)).toISOString();
const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

/** A MAP as DuckDB returns it, as an object; null stays null. */
function mapOf(value: unknown): Record<string, number> | null {
  if (value === null || value === undefined) return null;
  const { entries } = value as { entries: { key: unknown; value: unknown }[] };
  return Object.fromEntries(entries.map((e) => [String(e.key), Number(e.value)]));
}

/** A source's datum rows by station; none before its first run. */
export async function readFitDatums(
  store: string,
  source: string,
): Promise<Map<string, FitDatums>> {
  const path = fitDatumsPath(store, source);
  if (!(await exists(path))) return new Map();
  return new Map(
    (await readRows(path)).map((r) => {
      const row: FitDatums = {
        id: String(r.id),
        version: String(r.version),
        fitted: timestamp(r.fitted)!,
        reduced: timestamp(r.reduced)!,
        reason: text(r.reason),
        datum: String(r.datum),
        epoch: Number(r.epoch),
        since: timestamp(r.since),
        until: timestamp(r.until),
        months: number(r.months),
        observed_hours: number(r.observed_hours),
        inferred_hours: number(r.inferred_hours),
        observed: mapOf(r.observed),
        predicted_since: timestamp(r.predicted_since),
        predicted_until: timestamp(r.predicted_until),
        predicted: mapOf(r.predicted),
        // DuckDB returns a list as a value holding its items.
        ignored: (r.ignored as { items: unknown[] }).items.map(String),
        package: String(r.package),
        digest: String(r.digest),
      };
      return [row.id, row];
    }),
  );
}

/** The file, or none where a source has never had a row, as a source whose stations have no constants. */
export async function writeFitDatums(
  store: string,
  source: string,
  rows: FitDatums[],
): Promise<void> {
  const path = fitDatumsPath(store, source);
  if (rows.length || (await exists(path))) await writeTable(path, rows, FILES["fit-datums"]);
}
