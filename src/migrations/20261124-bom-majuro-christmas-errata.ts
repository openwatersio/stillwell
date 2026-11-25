import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = [
  "bom-majuro-2005-2008-values",
  "bom-christmas-island-2009-offset",
  "uhslc-christmas-island-2009-offset",
];

// Majuro's 2005 to 2008 values are stored unflagged; a requalify flags the span. The Christmas Island entries keep both series as they are, so only publish carries them to the station lists.
export default {
  description:
    "Flag BOM's Majuro values of 2005 to 2008 and publish the Christmas Island offset errata",
  steps: [
    { ingest: "requalify bom 005 2005 2009" },
    { ingest: "publish" },
    {
      check:
        "the Majuro and Christmas Island errata read back from the store and the station lists",
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
