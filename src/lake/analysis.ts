import { isDeepStrictEqual } from "node:util";
import { currentEpoch } from "../epochs.ts";
import { fromSource, qc } from "../qc.ts";
import { Flag, type LakeStation, type Observation, type Source, type Station } from "../schema.ts";
import { DRAINS_RUNS, TIDE_M, drains, tideOf } from "../tidal.ts";
import {
  exists,
  readObservations,
  readRows,
  readStationBounds,
  writeJsonArray,
  writeRows,
} from "./parquet.ts";
import { analysisHistoryPath, analysisPath, boundsPath, seriesPath } from "./paths.ts";
import { pool, qcFor } from "./recent.ts";

/**
 * What the lake measures about each station from the values it holds, in
 * `stations/analysis/<source>.parquet`, rather than lists written into code:
 * whether its levels carry a tide (`tidal`, which picks QC's flatline and
 * outlier rules in `qcFor`), and the measures behind that. `listOf` merges a
 * station's row into it, so backfill, recent, compaction and requalify judge
 * its values by it, and `publish` puts `tidal` and `tide_m` in
 * `stations.parquet`. `ingest analyze` writes it (`analyze`).
 */
export interface Analysis {
  id: string;
  /** When the station was last judged, as an ISO instant. */
  analyzed: string;
  /** `RULES` as it was then, so a change to a rule judges every station again. */
  rules: string;
  /** Whether the station's levels carry a tide (`judge`); null where its values can't say. */
  tidal: boolean | null;
  /** The lunar tide, M2's and O1's amplitudes added, in meters (`tideOf`). */
  tide_m: number | null;
  /** Days of the last year with usable values. */
  days: number | null;
  /** Runs of the last year only a tide gauge's flatline limit flags (`drains`). */
  drains: number | null;
}

/** The rules' version. Change it with any threshold below, so `analyze` judges every station again. */
export const RULES = "tidal-1";

/** Days of the last year with values that a verdict needs. */
export const COVERED_DAYS = 30;

/**
 * Water this far above sea level, in meters, isn't tidal, whatever its fit
 * says: flash floods and dam schedules put 8 to 30 cm into M2 and O1 at
 * mountain streams and tailwaters (USGS's Salt River near Roosevelt, the
 * Colorado at Lees Ferry), and the tidal streams measured sit within 10 m.
 */
export const ABOVE_SEA_M = 10;

/** A verdict stands this long before `analyze` judges the station again. */
const REJUDGE_MS = 365 * 86_400_000;

const DAY_MS = 86_400_000;

type Verdict = Omit<Analysis, "id" | "analyzed" | "rules">;

/**
 * Whether a station's levels carry a tide, from its last year: the lunar
 * tide (`tideOf`) is `TIDE_M` or more, on `COVERED_DAYS` days or more,
 * its water sits within `ABOVE_SEA_M` of sea level where its datum says how
 * high its gauge zero is, and no more than `DRAINS_RUNS` runs of a still
 * level are ones only a tide gauge's flatline limit flags, as at a creek that
 * drains to a sill at low water. Null, where the values can't say: under
 * `COVERED_DAYS` days, or too coarse to fit. The flags start over from the
 * source's (`fromSource`), so the verdict doesn't depend on the one QC used
 * when they were written.
 */
export function judge(source: Source, station: Station, rows: Observation[]): Verdict {
  const start = fromSource(rows);
  const still = qc(start, qcFor(source, { ...station, tidal: false }));
  const tide = qc(start, qcFor(source, { ...station, tidal: true }));
  const flags = still.map((r) => r.flag);
  const times = still.map((r) => r.time);
  const levels = still.map((r) => r.level);
  const tide_m = tideOf({ times, levels, source: flags });
  const since = (times.at(-1) ?? 0) - 366 * DAY_MS;
  const usable = still.filter((r) => r.time > since && r.flag < Flag.suspect);
  const days = new Set(usable.map((r) => Math.floor(r.time / DAY_MS))).size;
  const runs = drains(still, tide);
  if (tide_m === null || days < COVERED_DAYS) return { tidal: null, tide_m, days, drains: runs };
  const middle = usable.map((r) => r.level).sort((a, b) => a - b)[usable.length >> 1] ?? 0;
  const altitude = gaugeZero(station);
  const aboveSea = altitude !== null && altitude + middle > ABOVE_SEA_M;
  return {
    tidal: tide_m >= TIDE_M && !aboveSea && runs <= DRAINS_RUNS,
    tide_m,
    days,
    drains: runs,
  };
}

/**
 * How high a station's gauge zero sits above sea level, where its datum is
 * the gauge's own (`GAGE`) and its datums give one; null where they don't.
 */
function gaugeZero(station: Station): number | null {
  if (station.datum !== "GAGE") return null;
  return Object.values(station.datums ?? {})[0] ?? null;
}

/** A source's analysis by station ID; empty where there's none yet. */
export async function readAnalysis(lake: string, source: string): Promise<Map<string, Analysis>> {
  const path = analysisPath(lake, source);
  if (!(await exists(path))) return new Map();
  const rows = await readRows(path);
  return new Map(
    rows.map((r) => [
      String(r.id),
      {
        id: String(r.id),
        analyzed: new Date(r.analyzed as string).toISOString(),
        rules: String(r.rules),
        tidal: (r.tidal as boolean | null) ?? null,
        tide_m: (r.tide_m as number | null) ?? null,
        days: r.days === null ? null : Number(r.days),
        drains: r.drains === null ? null : Number(r.drains),
      },
    ]),
  );
}

/** Stations with their analysis's `tidal` and `tide_m`, null where there's none. */
export async function withAnalysis<T extends Station>(
  lake: string,
  source: string,
  stations: T[],
): Promise<T[]> {
  const analysis = await readAnalysis(lake, source);
  return stations.map((s) => {
    const a = analysis.get(s.id);
    return { ...s, tidal: a?.tidal ?? null, tide_m: a?.tide_m ?? null };
  });
}

export interface AnalysisReport {
  judged: number;
  /** Stations whose QC options changed with their verdict, which need requalifying. */
  changed: { id: string; from: boolean | null; to: boolean | null; tide_m: number | null }[];
  failed: string[];
}

/**
 * Judge a source's stations that are due (`judge`), from the last two years of
 * their current epoch in the lake, and write the source's analysis, keeping
 * the rows of stations not due or not judged. A station is due with no row,
 * a row under other `RULES`, no verdict, or a verdict older than a year, or
 * with `all`. Writes the stations whose QC options change with the
 * new verdict to `history/analysis/<source>/<time>.json` and returns them.
 */
export async function analyze(
  lake: string,
  source: Source,
  stations: LakeStation[],
  options: { now: Date; all?: boolean; concurrency?: number },
): Promise<AnalysisReport> {
  const id = source.metadata.id;
  const previous = await readAnalysis(lake, id);
  const bounds = await readStationBounds(boundsPath(lake, id));
  const now = options.now.getTime();
  const due = stations.filter((s) => {
    if (!bounds.get(s.id)?.last) return false;
    const p = previous.get(s.id);
    return (
      options.all ||
      !p ||
      p.rules !== RULES ||
      p.tidal === null ||
      now - Date.parse(p.analyzed) > REJUDGE_MS
    );
  });
  const next = new Map(previous);
  const report: AnalysisReport = { judged: 0, changed: [], failed: [] };
  await pool(due, options.concurrency ?? 8, async (station) => {
    try {
      const epoch = currentEpoch(station.epochs).id;
      const year = new Date(bounds.get(station.id)!.last!).getUTCFullYear();
      let rows: Observation[] = [];
      for (const y of [year - 1, year])
        rows = rows.concat(
          await readObservations(seriesPath(lake, "levels", id, station.source_id, y, epoch)),
        );
      // A suspect or bad value written before `source_flag` was kept may be QC's, so its flags can't start over.
      if (rows.some((r) => r.source_flag === undefined && r.flag >= Flag.suspect))
        throw new Error("holds flags written before source_flag was kept; requalify it first");
      const verdict = judge(source, station, rows);
      next.set(station.id, {
        id: station.id,
        analyzed: options.now.toISOString(),
        rules: RULES,
        ...verdict,
      });
      report.judged++;
      const from = previous.get(station.id)?.tidal ?? null;
      const before = qcFor(source, { ...station, tidal: from });
      const after = qcFor(source, { ...station, tidal: verdict.tidal });
      if (!isDeepStrictEqual(before, after))
        report.changed.push({ id: station.id, from, to: verdict.tidal, tide_m: verdict.tide_m });
    } catch (error) {
      report.failed.push(`${station.id}: ${error instanceof Error ? error.message : error}`);
    }
  });
  const listed = new Set(stations.map((s) => s.id));
  await writeRows(
    analysisPath(lake, id),
    [...next.values()].filter((a) => listed.has(a.id)),
    {
      id: "VARCHAR",
      analyzed: "TIMESTAMPTZ",
      rules: "VARCHAR",
      tidal: "BOOLEAN",
      tide_m: "DOUBLE",
      days: "INTEGER",
      drains: "INTEGER",
    },
    "id",
  );
  report.changed.sort((a, b) => a.id.localeCompare(b.id));
  if (report.changed.length)
    await writeJsonArray(analysisHistoryPath(lake, id, options.now.toISOString()), [
      { rules: RULES, changed: report.changed },
    ]);
  return report;
}
