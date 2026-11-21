import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import { seriesPath } from "../store/paths.ts";
import { readObservations } from "../store/parquet.ts";
import type { Migration } from "../jobs/migrations.ts";

const DAY_MS = 86_400_000;
const utc = (iso: string) => Date.parse(iso);

// The eight gages whose epoch 2 the decisions reject: epoch 1 holds 2026-11-05 14:12 to 11-16 14:19 again, and USGS's
// current series fills the days its old series never delivered (erratum `usgs-undated-gage-changes`).
const REJECTED = [
  "06207500",
  "08098295",
  "08111056",
  "08111070",
  "08117857",
  "08117858",
  "09505400",
  "09510200",
];

export default {
  description: "Place the 11 days of USGS readings at ten gages in their epochs",
  steps: [
    { ingest: "stations usgs --no-publish" },
    { ingest: `backfill usgs ${REJECTED.join(",")} 2026 2027` },
    { ingest: "backfill usgs 09505800 2026 2027" },
    { ingest: "misplaced usgs" },
    { ingest: "compact usgs --rebuild-bounds" },
    { ingest: "publish" },
    {
      check: "the decisions applied, and each gage's readings sit in the epoch that holds them",
      async verify(store) {
        const reader = errataReader(() => store, store);
        const entry = errata.find((e) => e.id === "usgs-undated-gage-changes");
        if (!entry?.check) throw new Error("no erratum usgs-undated-gage-changes with a check");
        await entry.check(reader, entry);

        const rows = (id: string, epoch: number) =>
          readObservations(seriesPath(store, "levels", "usgs", id, 2026, epoch)).catch(() => []);
        // Every UTC day from 5 to 16 November holds readings in epoch 1's files, from the days stored before to the
        // days USGS's current series gave back.
        for (const id of REJECTED) {
          const times = (await rows(id, 1)).map((r) => r.time);
          for (
            let day = utc("2026-11-06T00:00:00Z");
            day < utc("2026-11-16T00:00:00Z");
            day += DAY_MS
          )
            if (!times.some((t) => t >= day && t < day + DAY_MS))
              throw new Error(
                `usgs/${id}: no readings on ${new Date(day).toISOString().slice(0, 10)}`,
              );
        }

        // 09505800: the readings from the new series' first, 22:45 UTC on 2026-11-10, are in epoch 2's file and no
        // longer in epoch 1's.
        const split = utc("2026-11-10T22:45:00Z");
        const [first, second] = [await rows("09505800", 1), await rows("09505800", 2)];
        const stray = first.filter((r) => r.time >= split).length;
        if (stray)
          throw new Error(
            `usgs/09505800: ${stray} readings from 22:45 on 10 November remain in epoch 1`,
          );
        const placed = second.filter(
          (r) => r.time >= split && r.time < utc("2026-11-16T14:19:07Z"),
        );
        if (placed.length < 100 || Math.min(...placed.map((r) => r.time)) !== split)
          throw new Error(
            `usgs/09505800: ${placed.length} readings in epoch 2 from 22:45 on 10 November`,
          );
        if (!first.some((r) => r.time < split && r.time >= utc("2026-11-05T14:15:00Z")))
          throw new Error("usgs/09505800: no readings of 5 to 10 November left in epoch 1");

        // 07263883: epoch 1 holds the headwater's readings to its last, 20:15 UTC on 2026-11-08.
        const headwater = (await rows("07263883", 1)).map((r) => r.time);
        if (Math.max(...headwater) !== utc("2026-11-08T20:15:00Z"))
          throw new Error(
            "usgs/07263883: epoch 1's last reading isn't the headwater's, 20:15 on 8 November",
          );
      },
    },
  ],
} satisfies Migration;
