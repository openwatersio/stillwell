import type { Product } from "../schema.ts";

/**
 * The lake's layout, under a root that is a local directory or an `s3://` URL:
 *
 *   stations.parquet                                    one row per series
 *   sources.json                                        license and attribution per source
 *   recent/<source>.parquet                             last 7 days, every live station and any since retired
 *   obs/<source>/<station>/<year>.parquet               observed levels
 *   extremes/<source>/<station>/<year>.parquet          the source's observed high and low waters
 *   predictions/<source>/<station>/<year>.parquet       the source's predicted curve
 *   predicted-extremes/<source>/<station>/<year>.parquet the source's predicted high and low waters
 *
 * `<station>` is the station's `source_id`, URL-encoded. Every file is in the
 * station's one datum, named in `stations.parquet`.
 */
export const DATASET: Record<Product, string> = {
  levels: "obs",
  extremes: "extremes",
  predictions: "predictions",
  predicted_extremes: "predicted-extremes",
};

export function seriesPath(
  root: string,
  product: Product,
  source: string,
  sourceId: string,
  year: number,
): string {
  return `${root}/${DATASET[product]}/${source}/${encodeURIComponent(sourceId)}/${year}.parquet`;
}

export function recentPath(root: string, source: string): string {
  return `${root}/recent/${source}.parquet`;
}

export function stationsPath(root: string): string {
  return `${root}/stations.parquet`;
}

export function sourcesPath(root: string): string {
  return `${root}/sources.json`;
}
