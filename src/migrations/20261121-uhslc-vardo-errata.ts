import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = [
  "uhslc-vardo-1989-2003-decimeters",
  "uhslc-tregde-1987-2003-decimeters",
  "uhslc-vardo-zero-steps",
  "gesla-vardo-uhslc-1989-2003-decimeters",
  "gesla-vardo-uhslc-zero-steps",
];

// Both entries keep the values as served, so publish carries them to the station list and errata.json.
export default {
  description:
    "Publish the UHSLC errata on Vardø and Tregde decimeter rounding and Vardø's zero steps",
  steps: [
    { ingest: "publish" },
    {
      check: "each erratum's check reads back from the store",
      async verify(store) {
        const reader = errataReader(() => store, store);
        // The published station lists carry what publish wrote.
        const listed = (await reader.rows("stations.parquet")).find((r) => r.id === "uhslc/805");
        const ids = JSON.stringify(listed?.errata ?? null);
        for (const id of IDS.filter((x) => x.startsWith("uhslc-vardo")))
          if (!ids.includes(id)) throw new Error(`stations.parquet lists no ${id} for uhslc/805`);
        for (const id of IDS) {
          const e = errata.find((x) => x.id === id);
          if (!e?.check) throw new Error(`no erratum ${id} with a check`);
          try {
            await e.check(reader, e);
          } catch (error) {
            throw new Error(`${id}: ${(error as Error).message}`);
          }
        }
      },
    },
  ],
} satisfies Migration;
