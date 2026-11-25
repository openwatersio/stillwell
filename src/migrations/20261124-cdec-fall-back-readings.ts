import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import { stationsPath } from "../store/paths.ts";
import { readRows } from "../store/parquet.ts";
import type { Migration } from "../jobs/migrations.ts";

// The adapter used to drop CDEC's 00:45 stamp on the day daylight saving ends and read a 00:30 stamp as daylight time
// even where CDEC had switched to standard time. It now places the stamps from the level's jump across the skipped
// hour (erratum `cdec-fall-back-clock`), so a refetch of every year refills the 00:45 readings and moves the 00:30
// ones that are standard time. A refetch replaces the rows of each year it fetches, so no misdated row stays.
// DWR's three stations listed in NAD27 are placed in NAD83 by the next station refresh.
export default {
  description:
    "Refill CDEC's readings on the day daylight saving ends, and place DWR's NAD27 stations",
  steps: [
    { ingest: "backfill cdec all 1998 2027 --refetch --with-inactive" },
    { ingest: "stations dwr --no-publish" },
    { ingest: "publish" },
    {
      check: "the erratum for CDEC's fall-back clock reads back from the store",
      async verify(store) {
        const e = errata.find((x) => x.id === "cdec-fall-back-clock");
        if (!e?.check) throw new Error("no erratum cdec-fall-back-clock with a check");
        await e.check(
          errataReader(() => store, store),
          e,
        );
      },
    },
    {
      check: "DWR's NAD27 stations are listed in NAD83",
      async verify(store) {
        const rows = await readRows(stationsPath(store));
        const at = (id: string) => rows.find((r) => r.id === id);
        for (const [id, lat, lon] of [
          ["dwr/B91110", 38.073533, -121.85607],
          ["dwr/B95270", 37.890224, -121.570955],
          ["dwr/E33510", 38.079644, -122.105521],
        ] as const) {
          const r = at(id);
          if (!r) throw new Error(`${id} isn't in stations.parquet`);
          if (Math.abs(Number(r.lat) - lat) > 1e-6 || Math.abs(Number(r.lon) - lon) > 1e-6)
            throw new Error(`${id} is at ${String(r.lat)}, ${String(r.lon)}`);
        }
      },
    },
  ],
} satisfies Migration;
