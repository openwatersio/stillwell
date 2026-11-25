import { sources } from "../sources/index.ts";
import { readStationBounds } from "../store/parquet.ts";
import { boundsPath } from "../store/paths.ts";
import { storeOfSource } from "../store/stores.ts";
import type { Migration } from "../jobs/migrations.ts";

// Sources whose stored years held levels outside the store's span when this was written (the fill-values errata).
const SOURCES = ["cdec", "cmems", "gesla", "pegelonline", "usace", "usgs"];

// A station's first and last value now leave out levels outside the span, which the bounds written before did not.
export default {
  description: "Rebuild the bounds of the sources whose files hold fill values",
  steps: [
    ...SOURCES.map((source) => ({ ingest: `compact ${source} --rebuild-bounds` })),
    { ingest: "publish" },
    {
      check: "each of those sources has a bounds file with a station in it",
      async verify(store) {
        for (const id of SOURCES) {
          const source = sources[id];
          if (!source || storeOfSource(source.metadata) !== store) continue;
          const bounds = await readStationBounds(boundsPath(store, id));
          if (!bounds.size) throw new Error(`${id}: the bounds file is empty`);
        }
      },
    },
  ],
} satisfies Migration;
