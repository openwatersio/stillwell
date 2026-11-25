import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

// Between 18:20 UTC on 12 November 2026 and 11:20 on the 13th, usgs/09519800 holds 187 readings of 282 to 302 m at
// 5-minute steps that USGS has withdrawn; it serves a reading every 15 minutes there, 68 of them from 18:30 to 11:15.
// A backfill replaces every stored reading in a month it fetches, so one of 2026 leaves what USGS serves.
export default {
  description: "Replace the Painted Rock readings USGS withdrew",
  steps: [
    { ingest: "backfill usgs 09519800 2026 2027 --refetch" },
    {
      check:
        "usgs/09519800 holds no level above 100 m on 12 to 13 November 2026, and its 15-minute readings",
      async verify(store) {
        const levels = await errataReader(() => store, store).levels(
          "usgs/09519800",
          "2026-11-12",
          "2026-11-14",
        );
        const high = levels.filter((o) => o.level > 100);
        if (high.length)
          throw new Error(`usgs/09519800 still holds ${high.length} levels above 100 m`);
        const [first, last] = [
          Date.parse("2026-11-12T18:30:00Z"),
          Date.parse("2026-11-13T11:15:00Z"),
        ];
        const inside = levels.filter((o) => o.time >= first && o.time <= last);
        if (inside.length < 60)
          throw new Error(
            `usgs/09519800 holds ${inside.length} levels from 18:30 on 12 to 11:15 on 13 November, at least 60 of the 68 USGS serves`,
          );
      },
    },
    { ingest: "publish" },
  ],
} satisfies Migration;
