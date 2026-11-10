import type { Product } from "../schema.ts";

/**
 * The lake's layout, under a root that is a local directory or an `s3://` URL:
 *
 *   stations.parquet                                    one row per series
 *   sources.json                                        license, attribution, contact and finalizes per source
 *   errata.json                                         errors in what sources publish, and what the lake does about them
 *   stations/<source>.parquet                           one source's list, with datum epochs
 *   stations/bounds/<source>.parquet                    first, last, earliest preliminary and screened, by compaction and backfill
 *   stations/analysis/<source>.parquet                  what analysis measures from each station's levels, such as whether they carry a tide
 *   stations/years/<source>.parquet                     each year file of levels: hours, values by flag and a version
 *   stations/empty/<source>.json                        years a `--skip-written` backfill found nothing in, for 30 days
 *   history/stations/<source>/<time>.parquet            the list as each refresh started, less withheld stations
 *   history/stations/<source>/<time>.json               what that refresh changed
 *   history/analysis/<source>/<time>.json               stations whose QC an analysis changed
 *   recent/<source>.parquet                             last 7 days, every live station and any since retired
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

/** Every product a station can have files for. */
export const PRODUCTS = Object.keys(DATASET) as Product[];

export function seriesPath(
  root: string,
  product: Product,
  source: string,
  sourceId: string,
  year: number,
  epoch = 1,
): string {
  return `${seriesDir(root, product, source, sourceId, epoch)}/${year}.parquet`;
}

/** The directory that holds one epoch's yearly files: the station's own for epoch 1, its numbered subdirectory for a later one. */
export function seriesDir(
  root: string,
  product: Product,
  source: string,
  sourceId: string,
  epoch = 1,
): string {
  const dir = stationDir(root, product, source, sourceId);
  return epoch === 1 ? dir : `${dir}/${epoch}`;
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

/** A glob for every station's epoch-1 files, at the plain paths, for one source. */
export function sourceFirstEpochFiles(root: string, product: Product, source: string): string {
  return `${root}/${DATASET[product]}/${source}/*/*.parquet`;
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

export function analysisPath(root: string, source: string): string {
  return `${root}/stations/analysis/${source}.parquet`;
}

/** The stations an `analyze` run changed QC for, and why. */
export function analysisHistoryPath(root: string, source: string, time: string): string {
  return `${root}/history/analysis/${source}/${time.replaceAll(":", "").replace(/\.\d+Z$/, "Z")}.json`;
}

export function yearsPath(root: string, source: string): string {
  return `${root}/stations/years/${source}.parquet`;
}

export function emptyYearsPath(root: string, source: string): string {
  return `${root}/stations/empty/${source}.json`;
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

export function errataPath(root: string): string {
  return `${root}/errata.json`;
}
