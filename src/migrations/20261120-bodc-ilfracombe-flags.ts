import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import { Flag } from "../schema.ts";
import type { Migration } from "../jobs/migrations.ts";

// Days across the retired erratum's span, 30 September 2023 to 20 March 2025, that QC leaves not flagged whole once the erratum's flags are gone.
const DAYS = ["2024-03-05", "2024-08-20", "2025-01-10"];

export default {
  description: "Clear the retired Ilfracombe erratum's flags",
  steps: [
    { ingest: "requalify bodc bodc/ilf 2023 2026" },
    { ingest: "publish" },
    {
      check:
        "Ilfracombe's days in the retired span aren't flagged whole, and the BODC errata read back",
      async verify(store) {
        const reader = errataReader(() => store, store);
        for (const day of DAYS) {
          const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
            .toISOString()
            .slice(0, 10);
          const rows = await reader.levels("bodc/ilf", day, next);
          if (!rows.length) throw new Error(`the store holds no bodc/ilf levels on ${day}`);
          const flagged = rows.filter((o) => o.flag >= Flag.suspect).length;
          if (flagged > rows.length * 0.9)
            throw new Error(
              `${flagged} of bodc/ilf's ${rows.length} levels on ${day} are still suspect`,
            );
        }
        for (const e of errata.filter((x) => x.source === "bodc")) {
          if (!e.check) throw new Error(`no check for ${e.id}`);
          try {
            await e.check(reader, e);
          } catch (error) {
            throw new Error(`${e.id}: ${(error as Error).message}`);
          }
        }
      },
    },
  ],
} satisfies Migration;
