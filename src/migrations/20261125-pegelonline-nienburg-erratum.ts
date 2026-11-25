import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

// The span covers days the stored 2026 values don't flag yet; a requalify flags them.
export default {
  description: "Flag PEGELONLINE's wrong Nienburg readings of 6 and 7 November 2026",
  steps: [
    { ingest: "requalify pegelonline 47900118 2026 2027" },
    { ingest: "publish" },
    {
      check: "the erratum for Nienburg's readings reads back from the store",
      async verify(store) {
        const e = errata.find((x) => x.id === "pegelonline-nienburg-2026-11-06");
        if (!e?.check) throw new Error("no erratum pegelonline-nienburg-2026-11-06 with a check");
        await e.check(
          errataReader(() => store, store),
          e,
        );
      },
    },
  ],
} satisfies Migration;
