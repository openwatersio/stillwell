import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = ["cmems-st-pauli-wrong-minute", "pegelonline-st-pauli-2026-11-09-dip"];

// The entries keep the store as it is, so publish only carries them to the station lists and errata.json.
export default {
  description: "Publish the errata on St. Pauli values taken from other minutes",
  steps: [
    { ingest: "publish" },
    {
      check: "each erratum's check reads back from the store and the station lists carry it",
      async verify(store) {
        const reader = errataReader(() => store, store);
        const rows = await reader.rows("stations.parquet");
        for (const id of IDS) {
          const e = errata.find((x) => x.id === id);
          if (!e?.check) throw new Error(`no erratum ${id} with a check`);
          for (const station of e.stations!) {
            const listed = JSON.stringify(rows.find((r) => r.id === station)?.errata ?? null);
            if (!listed.includes(id))
              throw new Error(`stations.parquet lists no ${id} for ${station}`);
          }
          await e.check(reader, e);
        }
        const old = JSON.stringify(
          rows.find((r) => r.id === "gesla/stpaulitg-stp-deu-cmems")?.errata ?? null,
        );
        if (old.includes("gesla-st-pauli-wrong-minute"))
          throw new Error("stations.parquet still lists gesla-st-pauli-wrong-minute");
      },
    },
  ],
} satisfies Migration;
