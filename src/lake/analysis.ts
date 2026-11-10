import { isDeepStrictEqual } from "node:util";
import { currentEpoch } from "../epochs.ts";
import { fromSource, qc } from "../qc.ts";
import { Flag, type LakeStation, type Observation, type Source, type Station } from "../schema.ts";
import { DRAINS_RUNS, TIDE_M, drains, tideOf } from "../tidal.ts";
import {
  exists,
  listFiles,
  listYears,
  readJsonArray,
  readObservations,
  readRows,
  readStationBounds,
  writeJsonArray,
  writeRows,
} from "./parquet.ts";
import { analysisHistoryPath, analysisPath, boundsPath, seriesDir, seriesPath } from "./paths.ts";
import { chunks, pool, qcFor } from "./recent.ts";

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
  /**
   * When the station's stored years were last requalified under its
   * verdict: null while a verdict that changed its QC waits for `requalify`
   * (`pending`).
   */
  requalified: string | null;
}

/**
 * The rules' version. Change it with any threshold below or in `qcFor`, so
 * `analyze` judges every station again and requalifies its stored years.
 */
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

/** Stations `analyze` judges between writes. */
const BATCH = 500;

/** A verdict stands this long before `analyze` judges the station again. */
const REJUDGE_MS = 365 * 86_400_000;

const DAY_MS = 86_400_000;

type Verdict = Omit<Analysis, "id" | "analyzed" | "rules" | "requalified">;

/**
 * Whether a station's levels carry a tide, from its last year: the lunar
 * tide (`tideOf`) is `TIDE_M` or more, on `COVERED_DAYS` days or more,
 * its water sits within `ABOVE_SEA_M` of sea level where its datums can say
 * (`toSeaLevel`), and, away from the coast, no more than `DRAINS_RUNS` runs
 * of a still level are ones only a tide gauge's flatline limit flags, as at a
 * creek that drains to a sill at low water. On the coast such runs are a
 * stuck gauge or one left dry, which QC should flag: Coruña, with a 1.25 m
 * tide, has 732 of them in its last year in GESLA. Null, where the values
 * can't say: under `COVERED_DAYS` days, or too coarse to fit. The flags start
 * over from the source's (`fromSource`), so the verdict doesn't depend on the
 * one QC used when they were written, and `suspect`, the source's errata
 * and adapter spans, are flagged as `requalify` flags them.
 */
export function judge(
  station: Station,
  rows: Observation[],
  suspect: [number, number][] = [],
): Verdict {
  // A suspect or bad value written before `source_flag` was kept may be QC's, so it can't start over; it's left out.
  const start = fromSource(
    rows.filter((r) => r.source_flag !== undefined || r.flag < Flag.suspect),
    suspect,
  );
  const still = qc(start, { flatline_s: 48 * 3600, outliers: false });
  // A tide gauge's flatline rule alone, so `drains` counts held levels, not outliers.
  const tide = qc(start, { outliers: false });
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
  const offset = toSeaLevel(station);
  const aboveSea = offset !== null && offset + middle > ABOVE_SEA_M;
  return {
    tidal: tide_m >= TIDE_M && !aboveSea && (station.kind === "coastal" || runs <= DRAINS_RUNS),
    tide_m,
    days,
    drains: runs,
  };
}

/**
 * Datums measured from mean sea level by a national survey, so a level in
 * one is a height above the sea, in the order a station's datums are read.
 * IGLD is the Great Lakes', which sit 75 to 183 m up. A local tidal datum
 * such as MSL doesn't count: upriver it sits at the water, wherever that is.
 */
const SEA_LEVEL = [
  "NAVD88",
  "NGVD29",
  "NHN",
  "NN",
  "HN",
  "NN2000",
  "NAP",
  "AOD",
  "RH2000",
  "IGN69",
  "IGLD",
  "PRVD02",
  "ODM",
];

/**
 * Meters to add to a station's levels to put them above sea level: none
 * where its datum is one (`SEA_LEVEL`), its gauge zero's height in the first
 * such datum its datums give, and null where they give none.
 */
function toSeaLevel(station: Station): number | null {
  if (SEA_LEVEL.includes(station.datum)) return 0;
  const datum = SEA_LEVEL.find((d) => d in (station.datums ?? {}));
  return datum === undefined ? null : station.datums[datum]!;
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
        requalified: r.requalified == null ? null : new Date(r.requalified as string).toISOString(),
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
  /** Stations judged with less than they should be, such as without their errata spans. */
  warned: string[];
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
  const report: AnalysisReport = { judged: 0, changed: [], failed: [], warned: [] };
  const listed = new Set(stations.map((s) => s.id));
  // The history too, so a run stopped partway still says which stations it changed.
  const save = async () => {
    await writeAnalysis(
      lake,
      id,
      [...next.values()].filter((a) => listed.has(a.id)),
    );
    if (report.changed.length)
      await writeJsonArray(analysisHistoryPath(lake, id, options.now.toISOString()), [
        {
          rules: RULES,
          changed: [...report.changed].sort((a, b) => a.id.localeCompare(b.id)),
        },
      ]);
  };
  // Written every `BATCH` stations, so a run stopped partway keeps what it judged.
  for (const batch of chunks(due, BATCH)) {
    await pool(batch, options.concurrency ?? 8, async (station) => {
      try {
        const epoch = currentEpoch(station.epochs).id;
        const year = new Date(bounds.get(station.id)!.last!).getUTCFullYear();
        let rows: Observation[] = [];
        for (const y of [year - 1, year])
          rows = rows.concat(
            await readObservations(seriesPath(lake, "levels", id, station.source_id, y, epoch)),
          );
        // The source's errata and adapter spans, from the epoch's whole record, as requalify reads it.
        const dir = seriesDir(lake, "levels", id, station.source_id, epoch);
        // One the adapter refuses, such as GESLA's for a record the lake holds only part of, is judged without them.
        const spans =
          (await source
            .suspect?.(station, async function* () {
              for (const y of [...(await listYears(dir))].sort((a, b) => a - b))
                yield await readObservations(`${dir}/${y}.parquet`);
            })
            .catch((error: unknown) => {
              report.warned.push(
                `${station.id}: judged without its errata spans: ${error instanceof Error ? error.message : error}`,
              );
              return [];
            })) ?? [];
        const verdict = judge(station, rows, spans);
        const was = previous.get(station.id);
        report.judged++;
        // Values that can't say, such as a new epoch's first weeks, don't undo a
        // verdict, though new rules still requalify the station under it.
        if (verdict.tidal === null && was && was.tidal !== null) {
          if (was.rules !== RULES)
            next.set(station.id, { ...was, rules: RULES, requalified: null });
          return;
        }
        const from = was?.tidal ?? null;
        const changed = !isDeepStrictEqual(
          qcFor({ ...station, tidal: from, tide_m: was?.tide_m ?? null }),
          qcFor({ ...station, ...verdict }),
        );
        // A first verdict, or one under new rules, requalifies too: the stored years may be under rules no build has now.
        const requalify = changed || !was || was.rules !== RULES;
        next.set(station.id, {
          id: station.id,
          analyzed: options.now.toISOString(),
          rules: RULES,
          ...verdict,
          requalified: requalify ? null : was!.requalified,
        });
        if (changed)
          report.changed.push({ id: station.id, from, to: verdict.tidal, tide_m: verdict.tide_m });
      } catch (error) {
        report.failed.push(`${station.id}: ${error instanceof Error ? error.message : error}`);
      }
    });
    await save();
  }
  // Stations no longer listed leave even when none is due.
  if (!due.length) await save();
  report.changed.sort((a, b) => a.id.localeCompare(b.id));
  return report;
}

/** A source's analysis, `rows` sorted by ID. */
export function writeAnalysis(lake: string, source: string, rows: Analysis[]): Promise<void> {
  return writeRows(
    analysisPath(lake, source),
    rows,
    {
      id: "VARCHAR",
      analyzed: "TIMESTAMPTZ",
      rules: "VARCHAR",
      tidal: "BOOLEAN",
      tide_m: "DOUBLE",
      days: "INTEGER",
      drains: "INTEGER",
      requalified: "TIMESTAMPTZ",
    },
    "id",
  );
}

/**
 * Stations whose stored years aren't requalified under their verdict yet:
 * after a first verdict, one under new `RULES`, or one that changed their QC.
 */
export function pending(analysis: Map<string, Analysis>): string[] {
  return [...analysis.values()].filter((a) => a.requalified === null).map((a) => a.id);
}

/** Record that `ids`' stored years are requalified under their verdicts, as of `now`. */
export async function markRequalified(
  lake: string,
  source: string,
  ids: string[],
  now: Date,
): Promise<void> {
  const done = new Set(ids);
  const analysis = await readAnalysis(lake, source);
  await writeAnalysis(
    lake,
    source,
    [...analysis.values()].map((a) =>
      done.has(a.id) ? { ...a, requalified: now.toISOString() } : a,
    ),
  );
}

/**
 * Drop the stations `held` names from a source's analysis and its history,
 * rewriting only a file that names one, as withholding needs. Returns the
 * station IDs it dropped.
 */
export async function dropAnalysis(
  lake: string,
  source: string,
  held: (station: string) => boolean,
): Promise<string[]> {
  const dropped = new Set<string>();
  const analysis = await readAnalysis(lake, source);
  const gone = [...analysis.keys()].filter(held);
  if (gone.length) {
    for (const station of gone) dropped.add(station);
    await writeAnalysis(
      lake,
      source,
      [...analysis.values()].filter((a) => !held(a.id)),
    );
  }
  for (const file of await listFiles(analysisHistoryPath(lake, source, "*"))) {
    const runs = ((await readJsonArray(file)) ?? []) as { changed: { id: string }[] }[];
    if (!runs.some((r) => r.changed.some((c) => held(c.id)))) continue;
    for (const r of runs) for (const c of r.changed) if (held(c.id)) dropped.add(c.id);
    await writeJsonArray(
      file,
      runs.map((r) => ({ ...r, changed: r.changed.filter((c) => !held(c.id)) })),
    );
  }
  return [...dropped].sort();
}
