import type { Erratum } from "../errata.ts";
import type { Source, StoredStation } from "../schema.ts";
import { FILES } from "../store/files.ts";
import { exists, readRows, writeTable } from "../store/parquet.ts";
import { constituentsPath, fitsPath, seriesPath } from "../store/paths.ts";
import { poolUntil } from "../store/recent.ts";
import { readYears, type YearRow } from "../store/years.ts";
import {
  engineVersion,
  fitStation,
  type Fit,
  type FitContext,
  type FittedCandidate,
} from "./fit.ts";
import { Busy, emptyInputs, finalYear, holds, inputsDigest, Unfit, type Inputs } from "./series.ts";
import { fitInWorker, workerCount } from "./workers.ts";

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
  "z0_m",
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
    version: String(r.version),
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

/**
 * Both files. One can be written and the other not, when a run stops between
 * them, so each candidate row carries its fit's `version`: a reader joins on
 * it, and `due` fits a station again when its rows and its fit disagree.
 */
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
 * Take stations' rows out of both files, as `withhold` and `drop` do for a
 * station whose values leave the store, since its constants are made from
 * them. Rewrites only a file that holds one, and returns the stations found.
 */
export async function dropFits(
  store: string,
  source: string,
  gone: (id: string) => boolean,
): Promise<string[]> {
  const fits = await readFits(store, source);
  const constituents = await readConstituents(store, source);
  const found = new Set([...fits.keys(), ...constituents.map((c) => c.id)].filter(gone));
  if (!found.size) return [];
  // Candidates first, so no constants outlast the fit row that names them.
  await writeFits(
    store,
    source,
    [...fits.values()].filter((f) => !gone(f.id)),
    constituents.filter((c) => !gone(c.id)),
  );
  return [...found].sort();
}

/**
 * Whether a station's fit should run again: it has none, another engine
 * version fitted it, anything it depends on has changed (`inputsDigest`: a
 * year file, an epoch, an erratum's decision, the source's final year), or
 * its candidate rows aren't the ones its row names. A station without
 * constants is tried again only when one of those changes.
 */
export function due(
  previous: Fit | undefined,
  digest: string,
  engine: string,
  rows: readonly Pick<FittedCandidate, "version">[] = [],
): boolean {
  if (!previous || previous.engine !== engine) return true;
  let stored: string | undefined;
  try {
    stored = (JSON.parse(previous.inputs) as Inputs).digest;
  } catch {
    // Inputs that can't be read can't show the fit is current.
  }
  if (stored !== digest) return true;
  return previous.version === null
    ? rows.length > 0
    : !rows.length || rows.some((r) => r.version !== previous.version);
}

/**
 * The year files a station's last fit read that the years file has no row for though the store
 * still holds them, by `<epoch> <year>`: what a years file built from a short listing leaves.
 */
async function missingFromYears(
  store: string,
  station: StoredStation,
  previous: Fit | undefined,
  years: ReadonlyMap<string, YearRow>,
): Promise<string[]> {
  if (!previous?.version) return [];
  let read: string[];
  try {
    read = Object.keys((JSON.parse(previous.inputs) as Inputs).versions);
  } catch {
    return [];
  }
  const missing: string[] = [];
  for (const key of read) {
    if (years.has(`${station.id} ${key}`)) continue;
    const [epoch, year] = key.split(" ").map(Number);
    const path = seriesPath(store, "levels", station.source, station.source_id, year!, epoch);
    if (await holds(path)) missing.push(key);
  }
  return missing;
}

export interface FitReport {
  /** Stations fitted in this run, with constants. */
  fitted: string[];
  /** Stations this run tried that have no constants, with why. */
  none: { id: string; reason: string }[];
  /** Stations whose fit threw, with the error. */
  failed: string[];
  /** Stations whose year files are being written, left as they were for the next run. */
  waiting: string[];
  /** Due stations the run's time ended before, which stay due. */
  left: number;
  /** Stations whose stored fit is current. */
  current: number;
}

/** How many stations are fitted between writes, so a run that stops loses at most these. */
const BATCH = 25;

/**
 * Fit `source`'s stations that are due, or every one with `all`, and write
 * both files after each batch. A station that leaves the list loses its rows.
 * A fit that throws keeps the station's stored rows and is reported, as does
 * a station whose year files are being written. While any station of a
 * source that finalizes is being written, its final year can't be told, and
 * the run waits, writing nothing. With `until`, it stops starting
 * stations at that time and reports how many are left.
 */
export async function fitSource(
  store: string,
  source: Source,
  stations: StoredStation[],
  options: {
    now: Date;
    errata: Erratum[];
    all?: boolean;
    /** Only these stations, by `id`; none of them when empty, as an empty shard is. */
    only?: string[];
    /** How many stations are fitted at once, each on a thread of its own; one where not given. */
    concurrency?: number;
    /**
     * When to stop starting stations, in epoch milliseconds: the ones a run doesn't reach stay due
     * for the next. Every run fits the stations with the largest measured tide first.
     */
    until?: number;
    /** The clock `until` is read against. */
    clock?: () => number;
    /** Fits one station: on a worker thread, unless a caller gives another way. */
    fit?: typeof fitStation;
    log?: (line: string) => void;
  },
): Promise<FitReport> {
  const { metadata } = source;
  const years = await readYears(store, metadata.id);
  if (!years)
    throw new Error(`${metadata.id} has no years file; run \`ingest years ${metadata.id}\` first`);
  const engine = engineVersion();
  // A list that comes back empty would take every station's rows with it.
  if (!stations.length) throw new Error(`${metadata.id} lists no stations to fit`);
  const report: FitReport = { fitted: [], none: [], failed: [], waiting: [], left: 0, current: 0 };
  const listed = new Set(stations.map((s) => s.id));
  const before = await readFits(store, metadata.id);
  const fits = new Map([...before].filter(([id]) => listed.has(id)));
  const constituents = new Map<string, FittedCandidate[]>();
  const candidates = await readConstituents(store, metadata.id);
  for (const row of candidates) {
    if (!listed.has(row.id)) continue;
    if (!constituents.has(row.id)) constituents.set(row.id, []);
    constituents.get(row.id)!.push(row);
  }
  const dropped = before.size !== fits.size || candidates.some((row) => !listed.has(row.id));
  const save = () =>
    writeFits(store, metadata.id, [...fits.values()], [...constituents.values()].flat());
  const chosen = stations.filter((s) => !options.only || options.only.includes(s.id));

  const writing = new Set(
    [...years.values()].filter((r) => r.epoch === null || r.year === null).map((r) => r.id),
  );
  const qcStarts = new Map(
    stations.flatMap((s) =>
      s.source_qc_start ? [[s.id, Date.parse(s.source_qc_start)] as const] : [],
    ),
  );
  // Stations being written vote for no year, so the final year may be theirs to change, and a
  // run on the wrong one would fit every station twice. The run waits, writing nothing.
  if (metadata.finalizes && writing.size) {
    options.log?.(
      `  ${writing.size} stations' year files are being written, so ${metadata.id}'s final year can't be told`,
    );
    report.waiting.push(...chosen.map((s) => s.id));
    return report;
  }
  let final: number | null;
  let unfit = "";
  try {
    final = finalYear(metadata, years, options.now, qcStarts);
  } catch (error) {
    if (!(error instanceof Unfit)) throw error;
    final = null;
    unfit = error.message;
  }

  const base = { store, metadata, years, errata: options.errata, now: options.now, engine };
  const digestOf = (station: StoredStation) =>
    inputsDigest(station, { metadata, years, errata: options.errata, finalYear: final });
  const until = options.until ?? Infinity;
  const clock = options.clock ?? Date.now;
  const todo: StoredStation[] = [];
  for (const s of chosen) {
    if (writing.has(s.id)) {
      report.waiting.push(s.id);
      continue;
    }
    if (!options.all && !due(fits.get(s.id), digestOf(s), engine, constituents.get(s.id))) continue;
    // A years file built from a short listing lacks rows for files the store still holds, and a
    // fit from it would replace constants with ones from less of the record. A file that is
    // really gone, as after `delete-years` or a new epoch, is a change to fit again for.
    const short = await missingFromYears(store, s, fits.get(s.id), years);
    if (short.length) {
      report.failed.push(
        `${s.id}: the years file lacks ${short.length} year files its fit read and the store still holds, ${short[0]} among them; run \`ingest years ${metadata.id}\``,
      );
      continue;
    }
    todo.push(s);
  }
  report.current = chosen.length - todo.length - report.waiting.length - report.failed.length;
  // Largest tide first, so a run that can't reach every station spends its time where a fit says
  // most. A station analysis hasn't measured comes last, and none is ever left out for its size.
  const tide = (s: StoredStation) => (Number.isFinite(s.tide_m) ? s.tide_m! : -1);
  todo.sort((a, b) => tide(b) - tide(a));

  if (final === null) {
    // A source that finalizes and has constants has had a final year, so losing it is a fault in
    // the years file, such as a rebuild from a short listing, and no reason to take them away.
    const fitted = todo.filter((s) => fits.get(s.id)?.version);
    if (metadata.finalizes && fitted.length)
      throw new Error(
        `${metadata.id}: ${unfit}, though ${fitted.length} of its stations have constants; check its years file`,
      );
  }
  // A run whose time has passed fits nothing and says how many stations are due. It still takes
  // out the rows of stations that left the list, which is no fit's work.
  if (clock() > until) {
    report.left = todo.length;
    if (dropped) await save();
    return report;
  }
  if (final === null) {
    // No station of the source can be fitted, and each one's row says why.
    for (const station of todo) {
      fits.set(station.id, {
        ...blank(station.id, options.now, engine, digestOf(station)),
        reason: unfit,
      });
      constituents.delete(station.id);
      report.none.push({ id: station.id, reason: unfit });
    }
    await save();
    return report;
  }
  const context: FitContext = { ...base, finalYear: final };
  const fit = options.fit ?? fitInWorker;
  const workers = workerCount(options.concurrency ?? 1);
  let saved = false;
  for (let i = 0; i < todo.length; i += BATCH) {
    if (clock() > until) {
      report.left += todo.length - i;
      break;
    }
    const batch = todo.slice(i, i + BATCH);
    const late = await poolUntil(
      batch,
      workers,
      until,
      async (station) => {
        try {
          const result = await fit(station, context);
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
          if (error instanceof Busy) return void report.waiting.push(station.id);
          report.failed.push(
            `${station.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
      options.clock,
    );
    report.left += late.length;
    await save();
    saved = true;
  }
  // With nothing fitted, the files change only by the rows of stations that left the list.
  if (!saved && dropped) await save();
  return report;
}

const blank = (id: string, now: Date, engine: string, digest: string): Fit => ({
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
  inputs: JSON.stringify({ ...emptyInputs(), digest }),
  ...(Object.fromEntries(FIT_NUMBERS.map((name) => [name, null])) as Pick<
    Fit,
    (typeof FIT_NUMBERS)[number]
  >),
});
