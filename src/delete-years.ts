/**
 * Delete year files of levels that hold nothing but placeholders: every value
 * flagged bad and outside the store's span (`SPAN_M`), such as a source's
 * 99,999 ft where it has no reading. A year file always has some rows, so
 * requalify and compaction keep a file whose levels all fall outside the span,
 * and the store has no other way to take one out. `ingest delete-years`
 * deletes the files named, refusing any with a level inside the span or a
 * value not flagged bad, then drops their rows from the source's years file.
 * The bounds keep the station's old ends until `compact --rebuild-bounds`, and
 * `publish` works `missing_years` out from the files that remain.
 */
import { Flag } from "./schema.ts";
import { possible } from "./span.ts";
import { exists, readObservationFile } from "./store/parquet.ts";
import { seriesPath } from "./store/paths.ts";
import { dropYearFiles } from "./store/years.ts";
import { removePrefixes, seriesPrefixes } from "./withhold.ts";

export interface DeletedYears {
  /** The files deleted now. */
  files: string[];
  /** The named files that were already gone, as after a run that stopped before it dropped their rows. */
  gone: string[];
  /** How many values they held. */
  rows: number;
}

/**
 * Delete one station's year files of levels for `years` in `epoch`. Refuses,
 * before deleting any, a file with a level inside the span or a value not
 * flagged bad, and a station ID that names more than one directory. A file
 * already gone is skipped, so a run a failure stopped partway can run again;
 * its rows in the years file go with the rest. `remove` deletes files
 * (`removePrefixes`).
 */
export async function deleteYears(
  store: string,
  source: string,
  sourceId: string,
  epoch: number,
  years: number[],
  remove: (store: string, files: string[]) => Promise<void> = removePrefixes,
): Promise<DeletedYears> {
  // Refuses an ID with a wildcard, or one that names another station's directory.
  seriesPrefixes(store, source, [sourceId]);
  if (!Number.isInteger(epoch) || epoch < 1) throw new Error(`Not an epoch: ${epoch}`);
  if (!years.length || years.some((y) => !Number.isInteger(y) || y < 1000 || y > 9999))
    throw new Error(`Not a list of years: ${years.join(",")}`);
  const sorted = [...new Set(years)].sort((a, b) => a - b);
  let rows = 0;
  const files: string[] = [];
  const gone: string[] = [];
  for (const year of sorted) {
    const file = seriesPath(store, "levels", source, sourceId, year, epoch);
    if (!(await exists(file))) {
      gone.push(file);
      continue;
    }
    const read = await readObservationFile(file);
    const kept = read.rows.filter((r) => r.flag !== Flag.bad || possible(r.level)).length;
    if (kept)
      throw new Error(
        `${file} holds ${kept} of ${read.rows.length} values that aren't flagged bad or lie inside the span; it's not deleted`,
      );
    rows += read.rows.length;
    files.push(file);
  }
  if (files.length) await remove(store, files);
  await dropYearFiles(
    store,
    source,
    sorted.map((year) => ({ id: `${source}/${sourceId}`, epoch, year })),
  );
  return { files, gone, rows };
}
