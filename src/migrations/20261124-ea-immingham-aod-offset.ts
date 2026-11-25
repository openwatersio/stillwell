import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const ID = "ea-immingham-aod-offset";

// The span covers days the stored 2026 values don't flag yet, and a requalify applies it to them.
export default {
  description: "Flag the EA's Immingham mAOD series on the two days it steps 1.46 m off its twin",
  steps: [
    { ingest: "requalify ea E71139 2026 2027" },
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
