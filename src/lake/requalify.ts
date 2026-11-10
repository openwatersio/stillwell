import { fromSource, qc, withSourceFlag, type QcOptions } from "../qc.ts";
import type { LakeStation, Observation, Source } from "../schema.ts";
import { mergeFetched, sameRows } from "./merge.ts";
import {
  listYears,
  readDatums,
  readObservationFile,
  writeObservations,
  type YearStats,
} from "./parquet.ts";
import { seriesDir } from "./paths.ts";
import { qcFor } from "./recent.ts";

/**
 * Work a station's flags out again from what the lake holds, without asking
 * the source: each year file of levels from `start` to before `end`, in every
 * epoch, starts over from its `source_flag` and the source's errata spans
 * (`fromSource`), then QC runs with the current rules, judged with the years
 * either side, and the file is written only when a row changed, its stats
 * going in `written` by path. Returns the files written and the rows whose
 * flag changed.
 */
export async function requalify(
  source: Source,
  station: LakeStation,
  root: string,
  start: number,
  end: number,
  written = new Map<string, YearStats>(),
): Promise<{ files: number; changed: number }> {
  // Every epoch's datums and errata spans first, so a file to resolve by hand,
  // or a record a source can't judge, stops the station before any is written.
  const plans = [];
  for (const epoch of station.epochs) {
    const dir = seriesDir(root, "levels", station.source, station.source_id, epoch.id);
    const years = [...(await listYears(dir))].sort((a, b) => a - b);
    const wanted = years.filter((y) => y >= start && y < end);
    if (!wanted.length) continue;
    const path = (year: number) => `${dir}/${year}.parquet`;
    for (const year of wanted) {
      const datums = await readDatums(path(year));
      if (datums.length !== 1)
        throw new Error(`${path(year)} holds ${datums.join(", ") || "no datum"}; resolve by hand`);
    }
    const suspect =
      (await source.suspect?.(station, async function* () {
        for (const year of years) yield (await readObservationFile(path(year))).rows;
      })) ?? [];
    plans.push({ years, wanted, path, suspect });
  }
  const opts = qcFor(station);
  let files = 0;
  let changed = 0;
  for (const { years, wanted, path, suspect } of plans) {
    // Each year once, and only the three a step needs.
    const cache = new Map<number, Promise<{ rows: Observation[]; datums: string[] }>>();
    const read = (year: number) => {
      if (!cache.has(year))
        cache.set(
          year,
          years.includes(year)
            ? readObservationFile(path(year))
            : Promise.resolve({ rows: [], datums: [] }),
        );
      return cache.get(year)!;
    };
    for (const year of wanted) {
      for (const y of cache.keys()) if (y < year - 1) cache.delete(y);
      const [{ rows: had, datums }, before, after] = await Promise.all([
        read(year),
        read(year - 1),
        read(year + 1),
      ]);
      // writeObservations stamps one datum on every row; the check above is only as fresh as its read.
      if (datums.length !== 1)
        throw new Error(`${path(year)}'s datums changed while requalify ran`);
      const next = qc(fromSource(had, suspect), opts, [...before.rows, ...after.rows]);
      if (sameRows(had, next)) continue;
      const flags = new Map(had.map((r) => [r.time, r.flag]));
      changed += next.filter((r) => flags.get(r.time) !== r.flag).length;
      written.set(path(year), await writeObservations(path(year), next, datums[0]!));
      files++;
    }
  }
  return { files, changed };
}

/**
 * Backfill's fetched levels merged into the year they're written to, then the
 * whole year QC'd with `context` from the years either side, as requalify
 * does, so a partial fetch is judged against the same medians and spreads.
 * What it didn't fetch keeps its flag, since only requalify knows a source's
 * errata spans over the whole record.
 */
export function judgeFetched(
  existing: Observation[],
  fetched: Observation[],
  start: number,
  end: number,
  opts: QcOptions,
  context: Observation[],
): Observation[] {
  const merged = mergeFetched(existing, withSourceFlag(fetched), start, end);
  const times = new Set(fetched.map((r) => r.time));
  const stored = new Map(existing.map((r) => [r.time, r.flag]));
  return qc(merged, opts, context).map((r) =>
    times.has(r.time) ? r : { ...r, flag: stored.get(r.time) ?? r.flag },
  );
}
