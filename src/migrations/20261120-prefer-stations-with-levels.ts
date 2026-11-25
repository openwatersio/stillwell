import { stationsPath } from "../store/paths.ts";
import { readRows } from "../store/parquet.ts";
import type { Migration } from "../jobs/migrations.ts";

/** A list column as DuckDB returns it. */
const list = (value: unknown): string[] =>
  (value as { items?: string[] } | null)?.items ?? (value as string[] | null) ?? [];

// `preferred` is worked out at publish, so the new ranking (a station with no stored record never outranks one that
// has one) reaches every group at the next publish. Compact daily rebuilds the bounds and publishes nightly; this
// publishes now.
export default {
  description: "Publish stations with the ranking that prefers a station holding levels",
  steps: [
    { ingest: "publish" },
    {
      check: "the preferred station of dwr/B95580's group holds levels",
      async verify(store) {
        const rows = await readRows(stationsPath(store));
        const byId = new Map(rows.map((r) => [String(r.id), r]));
        const group = byId.get("dwr/B95580");
        if (!group) throw new Error("dwr/B95580 isn't in stations.parquet");
        const preferred = byId.get(String(group.preferred));
        if (!preferred) throw new Error(`preferred ${String(group.preferred)} isn't listed`);
        if (preferred.first === null || preferred.last === null)
          throw new Error(
            `dwr/B95580's group prefers ${String(preferred.id)}, which holds no levels`,
          );
        const members = list(group.same_as);
        if (!members.length) throw new Error("dwr/B95580 is in no group");
        // Every other member names the same preferred station.
        for (const id of members) {
          const member = byId.get(id);
          if (!member) throw new Error(`${id}, in dwr/B95580's group, isn't listed`);
          if (member.preferred !== preferred.id)
            throw new Error(`${id} prefers another station than ${String(preferred.id)}`);
        }
      },
    },
  ],
} satisfies Migration;
