import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const ID = "gesla-cape-ferguson-clock-drift";

// The erratum's span runs to February 2022; a requalify applies it to the stored values. End years are exclusive.
export default {
  description: "Flag GESLA's Cape Ferguson values from the years its clock ran late",
  steps: [
    { ingest: "requalify gesla cape_ferguson-h033007a-aus-bom 2019 2023" },
    { ingest: "publish" },
    {
      check: "the erratum's span holds the record's levels flagged suspect",
      async verify(store) {
        const e = errata.find((x) => x.id === ID);
        if (!e?.check) throw new Error(`no erratum ${ID} with a check`);
        await e.check(
          errataReader(() => store, store),
          e,
        );
      },
    },
  ],
} satisfies Migration;
