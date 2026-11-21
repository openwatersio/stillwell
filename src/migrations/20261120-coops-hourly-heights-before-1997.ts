import { Flag } from "../schema.ts";
import { seriesPath } from "../store/paths.ts";
import { readObservations } from "../store/parquet.ts";
import type { Migration } from "../jobs/migrations.ts";

// The 6-minute record starts between 1994 and 1996, and earlier years already read hourly heights only, so 1994 to 1996
// are the years a refetch changes: about 700 station-years, a month of 6-minute levels each plus the year's hourly
// heights, at a second a request.
export default {
  description: "Read CO-OPS's verified hourly heights before 1997",
  steps: [
    ...[1, 2, 3, 4].map((i) => ({
      ingest: `backfill coops all 1994 1997 --refetch --with-inactive --shard ${i}/4`,
      timeout: 240,
    })),
    {
      check:
        "Anchorage 1996 and 1995 and Chuuk 1994 hold no preliminary level, and 9435380 1995 every hour",
      async verify(store) {
        for (const [id, year] of [
          ["9455920", 1996],
          ["9455920", 1995],
          ["1840000", 1994],
        ] as const) {
          const rows = await readObservations(seriesPath(store, "levels", "coops", id, year));
          if (!rows.length) throw new Error(`coops/${id} ${year}: no levels`);
          const preliminary = rows.filter((r) => r.flag === Flag.preliminary).length;
          if (preliminary)
            throw new Error(
              `coops/${id} ${year}: ${preliminary} of ${rows.length} levels are preliminary`,
            );
        }
        const rows = await readObservations(seriesPath(store, "levels", "coops", "9435380", 1995));
        const hours = new Set(rows.map((r) => Math.floor(r.time / 3_600_000))).size;
        if (hours !== 8760) throw new Error(`coops/9435380 1995: ${hours} hours, not 8,760`);
      },
    },
  ],
} satisfies Migration;
