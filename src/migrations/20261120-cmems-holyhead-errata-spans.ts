import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = [
  "cmems-wangerooge-west-2026-dropout",
  "cmems-holyhead-2026-erratic",
  "cmems-holyhead-2026-april-erratic",
];

// The Holyhead spans cover days the stored 2026 values don't flag yet, and a requalify applies them.
export default {
  description: "Flag CMEMS's erratic Holyhead readings of February and April 2026",
  steps: [
    { ingest: "requalify cmems Holyhead 2026 2027" },
    { ingest: "publish" },
    {
      check: "the three CMEMS errata read back from the store",
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
