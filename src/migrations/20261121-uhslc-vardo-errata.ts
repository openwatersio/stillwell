import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = ["uhslc-vardo-1989-2003-decimeters", "uhslc-vardo-zero-steps"];

// Both entries keep the values as served, so publish carries them to the station list and errata.json.
export default {
  description: "Publish the UHSLC Vardø errata on decimeter rounding and zero steps",
  steps: [
    { ingest: "publish" },
    {
      check: "each erratum's check reads back from the store",
      async verify(store) {
        const reader = errataReader(() => store, store);
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
