import type { Erratum } from "../errata.ts";
import type { Source, StoredStation } from "../schema.ts";
import { FILES } from "../store/files.ts";
import { exists, readRows, writeTable } from "../store/parquet.ts";
import { constituentsPath, fitsPath } from "../store/paths.ts";
import { pool } from "../store/recent.ts";
import { readYears, type YearRow } from "../store/years.ts";
import {
  engineVersion,
  fitStation,
  type Fit,
  type FitContext,
  type FittedCandidate,
} from "./fit.ts";
import { emptyInputs, finalYear, Unfit, type Inputs } from "./series.ts";

/**
 * A source's fits in the store: `fits/<source>.parquet`, a row per station,
 * and `constituents/<source>.parquet`, a row per fitted station and candidate.
 * `fitSource` fits the stations that are due and keeps the rest's rows.
 */

/** A TIMESTAMPTZ as DuckDB returns it, in ISO form; null stays null. */
const iso = (value: unknown) =>
  value === null || value === undefined
    ? null
    : new Date(Number((value as { micros: bigint }).micros / 1000n)).toISOString();
const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

const FIT_NUMBERS = [
  "hours",
  "rms_m",
  "years",
  "held_out",
  "held_out_hours",
  "held_out_rms_m",
  "variance_explained",
  "d1_rms_m",
  "d2_rms_m",
  "d4_rms_m",
  "d6_rms_m",
  "turns",
  "turns_missed",
  "turn_time_mean_min",
  "turn_time_rms_min",
  "turn_height_mean_m",
  "turn_height_rms_m",
  "mean_range_m",
] as const;

/** A source's fits by station; none before its first run. */
export async function readFits(store: string, source: string): Promise<Map<string, Fit>> {
  const path = fitsPath(store, source);
  if (!(await exists(path))) return new Map();
  return new Map(
    (await readRows(path)).map((r) => {
      const fit = {
        id: String(r.id),
        fitted: iso(r.fitted)!,
        reason: text(r.reason),
        version: text(r.version),
        since: iso(r.since),
        until: iso(r.until),
        node_corrections: text(r.node_corrections),
        engine: String(r.engine),
        settled_before: iso(r.settled_before),
        source_qc_start: iso(r.source_qc_start),
        inputs: String(r.inputs),
        ...Object.fromEntries(FIT_NUMBERS.map((name) => [name, number(r[name])])),
      } as Fit;
      return [fit.id, fit];
    }),
  );
}

/** A source's candidate rows, in the file's order; none before its first run. */
export async function readConstituents(store: string, source: string): Promise<FittedCandidate[]> {
  const path = constituentsPath(store, source);
  if (!(await exists(path))) return [];
  return (await readRows(path)).map((r) => ({
    id: String(r.id),
    name: String(r.name),
    rank: Number(r.rank),
    // DuckDB returns a list as a value holding its items.
    doodson: (r.doodson as { items: unknown[] }).items.map(Number),
    speed: Number(r.speed),
    kept: Boolean(r.kept),
    reason: text(r.reason),
    conflict: text(r.conflict),
    amplitude_m: number(r.amplitude_m),
    phase_deg: number(r.phase_deg),
    amplitude_ci_m: number(r.amplitude_ci_m),
    phase_ci_deg: number(r.phase_ci_deg),
    snr: number(r.snr),
    yearly_amplitude_sd_m: number(r.yearly_amplitude_sd_m),
    yearly_phase_sd_deg: number(r.yearly_phase_sd_deg),
    yearly_se_m: number(r.yearly_se_m),
  }));
}

/** Both files, written together so every fit with constants has its candidate rows. */
export async function writeFits(
  store: string,
  source: string,
  fits: Fit[],
  constituents: FittedCandidate[],
): Promise<void> {
  await writeTable(constituentsPath(store, source), constituents, FILES.constituents);
  await writeTable(fitsPath(store, source), fits, FILES.fits);
}

/**
 * Whether a station's fit should run again: it has none, its last try gave no
 * constants, another engine version fitted it, a year file it read has another
 * version or is gone, or the station has a year file after its held-out year
 * that the source's final year now reaches.
 */
export function due(
  previous: Fit | undefined,
  station: { id: string },
  years: ReadonlyMap<string, YearRow>,
  final: number,
  engine: string,
): boolean {
  if (!previous || previous.reason !== null || previous.engine !== engine) return true;
  const { versions } = JSON.parse(previous.inputs) as Inputs;
  for (const [key, version] of Object.entries(versions))
    if (years.get(`${station.id} ${key}`)?.version !== version) return true;
  return [...years.values()].some(
    (r) => r.id === station.id && r.year !== null && r.year > previous.held_out! && r.year <= final,
  );
}

export interface FitReport {
  /** Stations fitted in this run, with constants. */
  fitted: string[];
  /** Stations this run tried that have no constants, with why. */
  none: { id: string; reason: string }[];
  /** Stations whose fit threw, with the error. */
  failed: string[];
  /** Stations whose stored fit is current. */
  current: number;
}

/** How many stations are fitted between writes, so a run that stops loses at most these. */
const BATCH = 25;

/**
 * Fit `source`'s stations that are due, or every one with `all`, and write
 * both files after each batch. A station that leaves the list loses its rows.
 * A fit that throws keeps the station's stored rows and is reported.
 */
export async function fitSource(
  store: string,
  source: Source,
  stations: StoredStation[],
  options: {
    now: Date;
    errata: Erratum[];
    all?: boolean;
    /** Only these stations, by `id`. */
    only?: string[];
    concurrency?: number;
    log?: (line: string) => void;
  },
): Promise<FitReport> {
  const { metadata } = source;
  const years = await readYears(store, metadata.id);
  if (!years)
    throw new Error(`${metadata.id} has no years file; run \`ingest years ${metadata.id}\` first`);
  const engine = engineVersion();
  const report: FitReport = { fitted: [], none: [], failed: [], current: 0 };
  const listed = new Set(stations.map((s) => s.id));
  const fits = new Map([...(await readFits(store, metadata.id))].filter(([id]) => listed.has(id)));
  const constituents = new Map<string, FittedCandidate[]>();
  for (const row of await readConstituents(store, metadata.id)) {
    if (!listed.has(row.id)) continue;
    if (!constituents.has(row.id)) constituents.set(row.id, []);
    constituents.get(row.id)!.push(row);
  }
  const save = () =>
    writeFits(store, metadata.id, [...fits.values()], [...constituents.values()].flat());
  const chosen = stations.filter((s) => !options.only?.length || options.only.includes(s.id));

  let final: number;
  try {
    final = finalYear(metadata, years, options.now);
  } catch (error) {
    if (!(error instanceof Unfit)) throw error;
    // No station of the source can be fitted, and each one's row says why.
    for (const station of chosen) {
      fits.set(station.id, {
        ...blank(station.id, options.now, engine),
        reason: error.message,
      });
      constituents.delete(station.id);
      report.none.push({ id: station.id, reason: error.message });
    }
    await save();
    return report;
  }

  const context: FitContext = {
    store,
    metadata,
    years,
    errata: options.errata,
    now: options.now,
    finalYear: final,
    engine,
  };
  const todo = chosen.filter((s) => options.all || due(fits.get(s.id), s, years, final, engine));
  report.current = chosen.length - todo.length;
  for (let i = 0; i < todo.length; i += BATCH) {
    await pool(todo.slice(i, i + BATCH), options.concurrency ?? 2, async (station) => {
      try {
        const result = await fitStation(station, context);
        fits.set(station.id, result.fit);
        if (result.constituents.length) constituents.set(station.id, result.constituents);
        else constituents.delete(station.id);
        if (result.fit.reason === null) report.fitted.push(station.id);
        else report.none.push({ id: station.id, reason: result.fit.reason });
        options.log?.(
          result.fit.reason === null
            ? `  ${station.id}: fitted ${result.fit.since!.slice(0, 4)} to ${result.fit.held_out! - 1}, scored on ${result.fit.held_out}`
            : `  ${station.id}: ${result.fit.reason}`,
        );
      } catch (error) {
        report.failed.push(
          `${station.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    await save();
  }
  if (!todo.length) await save();
  return report;
}

const blank = (id: string, now: Date, engine: string): Fit => ({
  id,
  fitted: now.toISOString(),
  reason: null,
  version: null,
  since: null,
  until: null,
  node_corrections: null,
  engine,
  settled_before: null,
  source_qc_start: null,
  inputs: JSON.stringify(emptyInputs()),
  ...(Object.fromEntries(FIT_NUMBERS.map((name) => [name, null])) as Pick<
    Fit,
    (typeof FIT_NUMBERS)[number]
  >),
});
