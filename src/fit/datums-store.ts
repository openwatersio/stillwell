import type { Erratum } from "../errata.ts";
import type { Source, StoredStation } from "../schema.ts";
import { pool } from "../store/recent.ts";
import { readYears } from "../store/years.ts";
import {
  datumsDue,
  datumsVersion,
  readFitDatums,
  readCurrentEpochs,
  reduceDatums,
  writeFitDatums,
  type FitDatums,
} from "./datums.ts";
import type { Fit, FittedCandidate } from "./fit.ts";
import { Busy } from "./series.ts";
import { readConstituents, readFits } from "./store.ts";
import { datumsInWorker, workerCount } from "./workers.ts";

/**
 * A source's tidal datums in the store: `fits/datums/<source>.parquet`, a row
 * per station with constants. `datumsSource` reduces the stations whose
 * datums are due, after `fitSource` has written the fits they come from.
 */

/** A fit's constants from its candidate rows, in their order. */
export const constantsOf = (
  rows: readonly {
    version: string;
    kept: boolean;
    name: string;
    amplitude_m: number | null;
    phase_deg: number | null;
  }[],
  version: string,
) =>
  rows
    .filter(
      (r) => r.version === version && r.kept && r.amplitude_m !== null && r.phase_deg !== null,
    )
    .map((r) => ({ name: r.name, amplitude: r.amplitude_m!, phase: r.phase_deg! }));

export interface DatumsReport {
  /** Stations whose datums were reduced in this run. */
  reduced: string[];
  /** Of those, the ones with no observed datums, with why. */
  none: { id: string; reason: string }[];
  /** Stations whose reduction threw, with the error. */
  failed: string[];
  /** Stations whose year files are being written, left as they were for the next run. */
  waiting: string[];
  /** Stations whose epochs changed after their fit, as when a refit failed, left as they were for the next fit. */
  stale: string[];
  /** Stations whose stored datums are current. */
  current: number;
}

/** How many stations are reduced between writes, so a run that stops loses at most these. */
const BATCH = 25;

/**
 * Reduce the datums of `source`'s stations that are due (`datumsDue`), or of
 * every station with constants with `all`, from the fits in the store, and
 * write the file after each batch. A row whose fit is gone or has another
 * `version` or `fitted` leaves the file, so no row describes a fit that isn't
 * the station's. A reduction that throws leaves the station without a row and
 * is reported. A station whose year files are being written, or whose epochs
 * changed after its fit, keeps any row it has for that fit.
 */
export async function datumsSource(
  store: string,
  source: Source,
  stations: StoredStation[],
  options: {
    now: Date;
    errata: Erratum[];
    all?: boolean;
    /** Only these stations, by `id`; none of them when empty. */
    only?: string[];
    concurrency?: number;
    /** Reduces one station: on a worker thread, unless a caller gives another way. */
    reduce?: typeof reduceDatums;
    log?: (line: string) => void;
  },
): Promise<DatumsReport> {
  const { metadata } = source;
  const years = await readYears(store, metadata.id);
  if (!years)
    throw new Error(`${metadata.id} has no years file; run \`ingest years ${metadata.id}\` first`);
  const pkg = datumsVersion();
  // A list that comes back empty would take every station's rows with it.
  if (!stations.length) throw new Error(`${metadata.id} lists no stations to reduce datums for`);
  const report: DatumsReport = {
    reduced: [],
    none: [],
    failed: [],
    waiting: [],
    stale: [],
    current: 0,
  };
  const listed = new Set(stations.map((s) => s.id));
  const fits = await readFits(store, metadata.id);
  const before = await readFitDatums(store, metadata.id);
  const current = (id: string, row: FitDatums) => {
    const fit = fits.get(id);
    return listed.has(id) && fit?.version === row.version && fit.fitted === row.fitted;
  };
  const rows = new Map([...before].filter(([id, row]) => current(id, row)));
  const changed = rows.size !== before.size;

  const writing = new Set(
    [...years.values()].filter((r) => r.epoch === null || r.year === null).map((r) => r.id),
  );
  const todo: { station: StoredStation; fit: Fit }[] = [];
  for (const station of stations) {
    if (options.only && !options.only.includes(station.id)) continue;
    const fit = fits.get(station.id);
    if (!fit?.version) continue;
    if (!options.all && !datumsDue(fit, rows.get(station.id), pkg)) {
      report.current++;
      continue;
    }
    if (writing.has(station.id)) {
      report.waiting.push(station.id);
      continue;
    }
    // Here rather than in the worker, which sends back only `Busy` as itself.
    if (!readCurrentEpochs(station, fit)) {
      report.stale.push(station.id);
      continue;
    }
    todo.push({ station, fit });
  }
  const save = () =>
    writeFitDatums(
      store,
      metadata.id,
      [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)),
    );
  if (!todo.length) {
    if (changed) await save();
    return report;
  }

  const candidates = new Map<string, FittedCandidate[]>();
  for (const row of await readConstituents(store, metadata.id)) {
    if (!candidates.has(row.id)) candidates.set(row.id, []);
    candidates.get(row.id)!.push(row);
  }
  const reduce = options.reduce ?? datumsInWorker;
  const workers = workerCount(options.concurrency ?? 1);
  const context = { store, metadata, years, errata: options.errata, now: options.now };
  for (let i = 0; i < todo.length; i += BATCH) {
    await pool(todo.slice(i, i + BATCH), workers, async ({ station, fit }) => {
      const constants = constantsOf(candidates.get(station.id) ?? [], fit.version!);
      try {
        const row = await reduce(station, fit, constants, context);
        rows.set(station.id, row);
        report.reduced.push(station.id);
        if (row.reason !== null) report.none.push({ id: station.id, reason: row.reason });
        options.log?.(
          row.reason === null
            ? `  ${station.id}: datums over ${row.since!.slice(0, 7)} to ${row.until!.slice(0, 7)}, ${row.months} months, ${row.inferred_hours} hours filled`
            : `  ${station.id}: no observed datums, ${row.reason}`,
        );
      } catch (error) {
        if (error instanceof Busy) return void report.waiting.push(station.id);
        rows.delete(station.id);
        report.failed.push(
          `${station.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    await save();
  }
  return report;
}
