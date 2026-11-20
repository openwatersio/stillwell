import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = [
  "ea-holyhead-2026-erratic",
  "ea-holyhead-2026-april-erratic",
  "ea-washpile-2026-offset",
  "ea-washpile-2026-gap",
];

// The Holyhead and Washpile spans cover days the stored 2026 values don't flag yet, and the retired Holyhead span's flags on 22 to 31 January come off; a requalify does both.
export default {
  description: "Flag the EA's erratic Holyhead and shifted Washpile readings of 2026",
  steps: [
    { ingest: "requalify ea E70539,E71339 2026 2027" },
    { ingest: "publish" },
    {
      check: "the EA's Holyhead and Washpile errata read back from the store",
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
