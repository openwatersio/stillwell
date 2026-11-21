import {
  exists,
  readObservationFile,
  readRows,
  readStationBounds,
  readTimes,
} from "../store/parquet.ts";
import { possible } from "../span.ts";
import { boundsPath, seriesPath, stationsPath } from "../store/paths.ts";
import { Flag } from "../schema.ts";
import { fileKey, listLevelFiles, readYears } from "../store/years.ts";
import type { Migration } from "../jobs/migrations.ts";

// Ten year files that hold nothing but placeholder levels, each flagged bad: 99,999 ft (30,479.695 m) at the Missouri
// stations, and −1.04 × 10³⁸ m at the Cumberland River gauge (erratum `usace-fill-values`). The store
// leaves such levels out wherever it fetches them, and a year file can't be emptied, so requalify and compaction keep
// these.
const FILES: Record<string, number[]> = {
  "LRN.CTHT1-CumberlandR-CarthageTN": [1984, 1985, 1986],
  "MVS.Bethany-Marrowbone_Cr": [2025, 2026],
  "MVS.Chesterville-Kaskaskia": [2025, 2026],
  "MVS.Sullivan-Jonathan_Cr": [2025, 2026],
  "MVS.Greenville-St_Francis": [2026],
};

/** A list column as DuckDB returns it. */
const list = (value: unknown): number[] =>
  ((value as { items?: unknown[] }).items ?? (value as unknown[])).map(Number);

export default {
  description: "Remove ten USACE year files that hold only placeholder levels",
  steps: [
    ...Object.entries(FILES).map(([station, years]) => ({
      ingest: `delete-years usace ${station} 1 ${years.join(",")}`,
    })),
    { ingest: "compact usace --rebuild-bounds" },
    { ingest: "publish" },
    {
      check:
        "the ten files and their rows are gone, and the bounds and missing years follow the files that remain",
      async verify(store) {
        const years = await readYears(store, "usace");
        if (!years) throw new Error("usace has no years file");
        const files = (await listLevelFiles(store, "usace")).flatMap(
          (f) => fileKey("usace", f) ?? [],
        );
        const bounds = await readStationBounds(boundsPath(store, "usace"));
        const published = new Map(
          (await readRows(stationsPath(store))).map((r) => [String(r.id), r]),
        );
        const iso = (t: number) => new Date(t).toISOString().slice(0, 19) + "Z";
        for (const [sourceId, gone] of Object.entries(FILES)) {
          const id = `usace/${sourceId}`;
          const fileOf = (year: number, epoch = 1) =>
            seriesPath(store, "levels", "usace", sourceId, year, epoch);
          for (const year of gone) {
            // Each path read directly, since a listing may come back short. A file compaction has written
            // since, from readings, may stand; one of only placeholders may not.
            if (!(await exists(fileOf(year)))) continue;
            const { rows } = await readObservationFile(fileOf(year));
            if (!rows.some((r) => r.flag !== Flag.bad || possible(r.level)))
              throw new Error(`${fileOf(year)} still holds only placeholders`);
          }
          const own = files.filter((f) => f.id === id);
          if (!own.length) throw new Error(`${id} has no year files left`);
          // A station a running compaction marked in the years file has rows out of date until it commits; run the check again.
          if ([...years.values()].some((r) => r.id === id && r.year === null))
            throw new Error(`${id} is marked in the years file, as while compaction runs; retry`);
          // The years file has a row for each file that remains, and for no other.
          const rowYears = [...years.values()]
            .filter((r) => r.id === id)
            .map((r) => `${r.epoch} ${r.year}`)
            .sort();
          const fileYears = own.map((f) => `${f.epoch} ${f.year}`).sort();
          if (rowYears.join() !== fileYears.join())
            throw new Error(
              `${id}: the years file lists ${rowYears.join(", ")}, the files ${fileYears.join(", ")}`,
            );
          // The bounds reach no further than the first and last file's rows, and the last is in the last file's year, so
          // neither is still in a deleted file.
          const ordered = own.toSorted((a, b) => a.year - b.year || a.epoch - b.epoch);
          const b = bounds.get(id);
          const first = ordered[0]!;
          const last = ordered.at(-1)!;
          const times = async (f: { year: number; epoch: number }) =>
            readTimes(fileOf(f.year, f.epoch));
          const lo = Math.min(...(await times(first)));
          const hi = Math.max(...(await times(last)));
          if (!b?.first || !b.last || b.first < iso(lo) || b.last > iso(hi))
            throw new Error(
              `${id}: bounds ${b?.first} to ${b?.last}, files ${iso(lo)} to ${iso(hi)}`,
            );
          if (Date.parse(b.last) < Date.UTC(last.year, 0, 1))
            throw new Error(`${id}: bounds end before ${last.year}, its last file`);
          // A year with no file is missing, unless `missingYears` is sure the source has nothing there: before the
          // station's first file, after an inactive station's last, or in the current year of a station that isn't live.
          const row = published.get(id);
          if (!row?.missing_years)
            throw new Error(
              `${id}: missing_years is null, as while a run has the station marked; publish again`,
            );
          const listed = list(row.missing_years);
          const thisYear = new Date().getUTCFullYear();
          for (const year of gone) {
            const sure =
              year < first.year ||
              (row.status === "inactive" && year > last.year) ||
              (year >= thisYear && row.live !== true);
            if (!own.some((f) => f.year === year) && !sure && !listed.includes(year))
              throw new Error(`${id}: ${year} has no file and isn't in missing_years`);
          }
        }
      },
    },
  ],
} satisfies Migration;
