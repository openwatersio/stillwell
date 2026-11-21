import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const ID = "coops-gps-buoy-9414796";

export default {
  description: "Leave CO-OPS's GPS buoy 9414796 out of the station list",
  steps: [
    { ingest: "stations coops --no-publish" },
    { ingest: "withhold coops" },
    { ingest: "matches --prune" },
    { ingest: "links --prune" },
    { ingest: "publish" },
    {
      check: "the erratum for CO-OPS's GPS buoy reads back from the store",
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
