import { stationsPath } from "../store/paths.ts";
import { publishedProducts } from "../store/parquet.ts";
import type { Migration } from "../jobs/migrations.ts";

// RWS's list keeps only stations with observed levels, and lists `levels` and `extremes` alone. BSH has no source
// anymore, so publishing leaves it out of stations.parquet.
export default {
  description: "Drop prediction products from the station lists",
  steps: [
    { ingest: "stations rws --no-publish" },
    { ingest: "publish" },
    {
      check: "stations.parquet lists no BSH station and no product but levels and extremes",
      async verify(store) {
        const products = await publishedProducts(stationsPath(store));
        if (products.has("bsh")) throw new Error("stations.parquet still lists BSH");
        for (const [source, set] of products) {
          const other = [...set].filter((p) => p !== "levels" && p !== "extremes");
          if (other.length) throw new Error(`${source} lists ${other.join(", ")}`);
        }
      },
    },
  ],
} satisfies Migration;
