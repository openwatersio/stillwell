import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import { readRows } from "../store/parquet.ts";
import { listLevelFiles, fileKey } from "../store/years.ts";
import { stationsPath } from "../store/paths.ts";
import type { Migration } from "../jobs/migrations.ts";

const ID = "usace-longitude-sign";
const STATIONS = ["MVK.Pine_Bluff", "LRL.BuckCreek", "LRH.PleasantHill-Outflow"];

// The refresh lists the three at USGS's positions, which `POSITIONS` moves them to, and backfill reads their history.
export default {
  description: "List three USACE gauges whose CWMS longitude lost its sign, and backfill them",
  steps: [
    { ingest: "stations usace --no-publish" },
    { ingest: `backfill usace ${STATIONS.join(",")} 1980 2027`, timeout: 240 },
    { ingest: "compact usace --rebuild-bounds" },
    { ingest: "publish" },
    {
      check: "the three gauges are listed at USGS's positions and hold levels",
      async verify(store) {
        const e = errata.find((x) => x.id === ID);
        if (!e?.check) throw new Error(`no erratum ${ID} with a check`);
        await e.check(
          errataReader(() => store, store),
          e,
        );
        const listed = new Map((await readRows(stationsPath(store))).map((r) => [String(r.id), r]));
        const files = (await listLevelFiles(store, "usace")).map((f) => fileKey("usace", f));
        for (const id of STATIONS) {
          const row = listed.get(`usace/${id}`);
          if (!row) throw new Error(`usace/${id} isn't in stations.parquet`);
          if (row.first === null || row.last === null)
            throw new Error(`usace/${id} is listed with no levels`);
          if (!files.some((f) => f?.id === `usace/${id}`))
            throw new Error(`the store holds no year file of levels for usace/${id}`);
        }
      },
    },
  ],
} satisfies Migration;
