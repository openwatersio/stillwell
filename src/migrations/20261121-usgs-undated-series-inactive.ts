import { readYears } from "../store/years.ts";
import { readStationList } from "../store/parquet.ts";
import { stationListPath } from "../store/paths.ts";
import type { Migration } from "../jobs/migrations.ts";

// A site whose series have no begin or end date isn't listed, so the refresh lists its stored station inactive and a
// backfill leaves it alone until USGS dates a series.
export default {
  description: "List USGS stations with no dated series as inactive",
  steps: [
    { ingest: "stations usgs --no-publish" },
    {
      check: "no inactive USGS station with undated series holds stored levels",
      async verify(store) {
        const list = (await readStationList(stationListPath(store, "usgs"))) ?? [];
        const years = await readYears(store, "usgs");
        if (!years) throw new Error("the store has no years file for USGS");
        const held = new Set(
          [...years.values()].filter((y) => y.year !== null && (y.hours ?? 0) > 0).map((y) => y.id),
        );
        const dropped = list.filter((s) => {
          const x = s as unknown as { series_begin?: string | null; series_end?: string | null };
          return s.status === "inactive" && !s.live && !x.series_begin && !x.series_end;
        });
        const withLevels = dropped.filter((s) => held.has(s.id)).map((s) => s.id);
        if (withLevels.length)
          throw new Error(
            `${withLevels.length} inactive undated USGS stations hold levels, e.g. ${withLevels[0]}`,
          );
      },
    },
    { ingest: "publish" },
  ],
} satisfies Migration;
