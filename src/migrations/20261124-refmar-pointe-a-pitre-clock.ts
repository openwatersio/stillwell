import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import { Flag } from "../schema.ts";
import type { Migration } from "../jobs/migrations.ts";

const ID = "refmar-pointe-a-pitre-clock";
// The erratum starts on 1 January 2023. A requalify starts each value over from its `source_flag`,
// so 2020 to 2022 loses the mark the earlier span put on every record the erratum lists.
export default {
  description: "Clear the suspect flag from Pointe-à-Pitre's levels before 2023",
  steps: [
    { ingest: "requalify refmar 125 2020 2023" },
    { ingest: "requalify cmems PointeAPitreTG 2020 2023" },
    {
      ingest:
        "requalify gesla pointe_a_pitre-125-fra-refmar,pointeapitretg_60minute-poi-fra-cmems 2020 2023",
    },
    { ingest: "publish" },
    {
      check: "every record the erratum lists is flagged only from 2023",
      async verify(store) {
        const e = errata.find((x) => x.id === ID);
        if (!e?.check) throw new Error(`no erratum ${ID} with a check`);
        const reader = errataReader(() => store, store);
        await e.check(reader, e);
        for (const id of e.stations!) {
          let read = 0;
          for (const year of [2020, 2021, 2022]) {
            const rows = await reader.levels(id, `${year}-01-01`, `${year + 1}-01-01`);
            read += rows.length;
            // Only a flag above the source's own is the erratum's; QC marks a few values of its own.
            const spill = rows.filter(
              (o) =>
                o.flag >= Flag.suspect &&
                o.source_flag !== undefined &&
                o.source_flag < Flag.suspect,
            ).length;
            if (spill > rows.length * 0.05)
              throw new Error(
                `${spill} of ${id}'s ${rows.length} values in ${year} are flagged above the source's`,
              );
          }
          if (!read) throw new Error(`${id} has no values from 2020 to 2022`);
        }
      },
    },
  ],
} satisfies Migration;
