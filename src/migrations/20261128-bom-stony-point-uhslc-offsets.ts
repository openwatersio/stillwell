import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const IDS = [
  "bom-stony-point-2005-2014-zero",
  "bom-stony-point-november-2007-timing",
  "uhslc-suva-2023-august-offset",
  "uhslc-honiara-2023-offsets",
  "uhslc-honiara-2024-march",
  "uhslc-port-vila-2022-march",
  "uhslc-esperance-1993-1996",
  "bom-port-vila-2022-march",
  "bom-esperance-1993-1996",
];

// Stony Point's 2005 to 2014 values are stored 0.090 m low, which only a refetch through the adapter corrects; requalifies flag November 2007 at Stony Point and UHSLC's shifted spans, in the series and GESLA's copies.
export default {
  description:
    "Raise BOM's Stony Point levels of 2005 to 2014 and flag UHSLC's shifted Suva and Honiara spans",
  steps: [
    { ingest: "backfill bom 993 2005 2015 --refetch" },
    { ingest: "requalify bom 993 2007 2008" },
    { ingest: "requalify uhslc 009,018 2023 2025" },
    { ingest: "requalify gesla western_port_stony_point-60710-aus-bom 2007 2008" },
    { ingest: "requalify gesla suva-018-fji-uhslc_fd,honiara-009-slb-uhslc_fd 2023 2025" },
    { ingest: "publish" },
    {
      check:
        "the Stony Point, Suva and Honiara errata read back from the store and the station lists",
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
