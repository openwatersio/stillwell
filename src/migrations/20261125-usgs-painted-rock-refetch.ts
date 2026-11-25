import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

// A backfill replaces every stored reading in a month it fetches, so one of 2026 brings the Painted Rock readings USGS
// has since withdrawn down to what it still serves (erratum `usgs-gila-painted-rock-high-readings`).
export default {
  description: "Replace the Painted Rock readings USGS withdrew",
  steps: [
    { ingest: "backfill usgs 09519800 2026 2027" },
    { ingest: "publish" },
    {
      check: "usgs/09519800 holds no level above 100 m on 12 to 13 November 2026",
      async verify(store) {
        const entry = errata.find((e) => e.id === "usgs-gila-painted-rock-high-readings");
        if (!entry?.check)
          throw new Error("no erratum usgs-gila-painted-rock-high-readings with a check");
        await entry.check(
          errataReader(() => store, store),
          entry,
        );
      },
    },
  ],
} satisfies Migration;
