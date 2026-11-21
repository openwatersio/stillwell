import { seriesPath } from "../store/paths.ts";
import { readObservations } from "../store/parquet.ts";
import type { Migration } from "../jobs/migrations.ts";

// A refetch on 2026-11-19 of CCO's quality-controlled files read 28,255, 49,844 and 52,434 readings (June 2018 at 10
// minutes where the store held 1-minute readings), so a refetch that came back short fails the check.
const FLOOR: Record<number, number> = { 2018: 26_800, 2019: 47_300, 2020: 49_800 };

// #486 leaves out Brighton's placeholder, −9.99999, which reads back as −10 since levels are stored to 4 decimals
// (erratum `cco-fill-values`); a refetch replaces each month of 2018 to 2020 that holds one. The station's first and last
// readings don't change, so its bounds need no rebuild.
export default {
  description: "Leave out Brighton's placeholder level",
  steps: [
    { ingest: "backfill cco 88 2018 2021 --refetch --concurrency 1" },
    {
      check: "no level of −10 in Brighton's 2018 to 2020, and no year short of readings",
      async verify(store) {
        for (const [year, floor] of Object.entries(FLOOR)) {
          const rows = await readObservations(
            seriesPath(store, "levels", "cco", "88", Number(year)),
          );
          if (rows.length < floor)
            throw new Error(`cco/88 ${year}: ${rows.length} readings, under ${floor}`);
          const left = rows.filter((r) => r.level === -10).length;
          if (left) throw new Error(`cco/88 ${year}: ${left} levels of −10 remain`);
        }
      },
    },
  ],
} satisfies Migration;
