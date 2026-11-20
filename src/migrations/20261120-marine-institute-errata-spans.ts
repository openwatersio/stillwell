import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = [
  "marine-institute-castletownbere-2026-offsets",
  "marine-institute-malin-head-2026-offset",
  "marine-institute-malin-head-2026-may-offset",
];

// Castletownbere's and Malin Head's errata spans cover days the stored 2026 values don't flag yet, and a requalify applies the spans to them.
export default {
  description: "Flag Castletownbere's and Malin Head's erratic 2026 readings",
  steps: [
    { ingest: "requalify marine-institute castletownbere-port,malin-head-portmore-pier 2026 2027" },
    {
      check: "the three errata's spans are flagged and their offsets read back",
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
