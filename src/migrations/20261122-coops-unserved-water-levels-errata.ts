import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const ID = "coops-inventory-lists-unserved-water-levels";

// The entry keeps the store as it is, so publish only carries it to the station lists and errata.json.
export default {
  description: "Publish the CO-OPS erratum on inventory periods the data API serves nothing for",
  steps: [
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
