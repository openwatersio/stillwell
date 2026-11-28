import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const ID = "usgs-altitude-contradicts-crms";

// The refresh clears the offsets the store holds for a site `GAGE_DATUMS` now gives none.
export default {
  description: "Take the NAVD88 offset off USGS's Barataria Waterway gauge",
  steps: [
    { ingest: "stations usgs --no-publish" },
    { ingest: "publish" },
    {
      check: "the erratum's check reads back from the store and the station lists carry it",
      async verify(store) {
        const e = errata.find((x) => x.id === ID);
        if (!e?.check) throw new Error(`no erratum ${ID} with a check`);
        const reader = errataReader(() => store, store);
        const rows = await reader.rows("stations.parquet");
        for (const id of e.stations!) {
          const listed = JSON.stringify(rows.find((r) => r.id === id)?.errata ?? null);
          if (!listed.includes(ID)) throw new Error(`stations.parquet lists no ${ID} for ${id}`);
        }
        await e.check(reader, e);
      },
    },
  ],
} satisfies Migration;
