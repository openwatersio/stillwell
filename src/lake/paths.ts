import type { Product } from "../schema.ts";

/**
 * The lake's layout, under a root that is a local directory or an `s3://` URL:
 *
 *   stations.parquet                                    one row per series
 *   sources.json                                        license and attribution per source
 *   stations/<source>.parquet                           one source's list, with datum epochs
 *   stations/bounds/<source>.parquet                    first and last, written by compaction
 *   history/stations/<source>/<time>.parquet            the list as each refresh started
 *   history/stations/<source>/<time>.json               what that refresh changed
 *   recent/<source>.parquet                             last 7 days, every live station
 *   obs/<source>/<station>/<year>.parquet               observed levels
 *   extremes/<source>/<station>/<year>.parquet          the source's observed high and low waters
 *   predictions/<source>/<station>/<year>.parquet       the source's predicted curve
 *   predicted-extremes/<source>/<station>/<year>.parquet the source's predicted high and low waters
 *
 * `<station>` is the station's `source_id`, URL-encoded. Each datum epoch has
 * files of its own: epoch 1 at the paths above, a later one with its number
 * after `<station>`, as `obs/<source>/<station>/2/<year>.parquet`. Every file
 * is in its epoch's one datum.
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
  epoch = 1,
): string {
  const dir = `${root}/${DATASET[product]}/${source}/${encodeURIComponent(sourceId)}`;
  return epoch === 1 ? `${dir}/${year}.parquet` : `${dir}/${epoch}/${year}.parquet`;
}

/** A station's directory for one product, which holds epoch 1's years and later epochs' directories. */
export function stationDir(
  root: string,
  product: Product,
  source: string,
  sourceId: string,
): string {
  return `${root}/${DATASET[product]}/${source}/${encodeURIComponent(sourceId)}`;
}

/** A glob for the files in every station's later epochs' directories, for one source. */
export function sourceEpochDirs(root: string, product: Product, source: string): string {
  return `${root}/${DATASET[product]}/${source}/*/*/*.parquet`;
}

/** A glob for the files in a station's later epochs' directories. */
export function epochDirs(
  root: string,
  product: Product,
  source: string,
  sourceId: string,
): string {
  return `${stationDir(root, product, source, sourceId)}/*/*.parquet`;
}

export function stationListPath(root: string, source: string): string {
  return `${root}/stations/${source}.parquet`;
}

export function boundsPath(root: string, source: string): string {
  return `${root}/stations/bounds/${source}.parquet`;
}

/** A refresh's snapshot of the list, and with `.json`, its report. */
export function historyPath(
  root: string,
  source: string,
  time: string,
  ext: "parquet" | "json",
): string {
  return `${root}/history/stations/${source}/${time.replaceAll(":", "")}.${ext}`;
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
