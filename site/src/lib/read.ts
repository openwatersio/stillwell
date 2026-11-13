// Browser reads of the store's Parquet files with hyparquet: ranged requests, no DuckDB.
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from "hyparquet";
import { compressors } from "hyparquet-compressors";

type Row = Record<string, any>;

/** The columns a file has of those asked for: older files can lack an optional one, such as source_flag. */
const present = (metadata: Awaited<ReturnType<typeof parquetMetadataAsync>>, columns: string[]) => {
  const names = new Set(metadata.schema.map((e) => e.name));
  return columns.filter((c) => names.has(c));
};

/** Some columns of a whole file, or [] when it doesn't exist. */
export async function readFile(url: string, columns: string[]): Promise<Row[]> {
  try {
    const file = await asyncBufferFromUrl({ url });
    const metadata = await parquetMetadataAsync(file);
    return await parquetReadObjects({
      file,
      metadata,
      columns: present(metadata, columns),
      compressors,
    });
  } catch (error) {
    if (String(error).includes("404")) return [];
    throw error;
  }
}

/**
 * One station's rows from a file sorted by station, such as recent/<source>.parquet: only the row groups
 * whose station statistics can hold it are read.
 */
export async function readStation(url: string, station: string, columns: string[]): Promise<Row[]> {
  let file;
  try {
    file = await asyncBufferFromUrl({ url });
  } catch (error) {
    // A source with no live stations yet has no recent file.
    if (String(error).includes("404")) return [];
    throw error;
  }
  const metadata = await parquetMetadataAsync(file);
  const out: Row[] = [];
  let start = 0;
  for (const group of metadata.row_groups) {
    const rows = Number(group.num_rows);
    const stats = group.columns.find((c) => c.meta_data?.path_in_schema[0] === "station")?.meta_data
      ?.statistics;
    const min = stats?.min_value ?? stats?.min;
    const max = stats?.max_value ?? stats?.max;
    if (min == null || max == null || (station >= String(min) && station <= String(max))) {
      const read = await parquetReadObjects({
        file,
        metadata,
        compressors,
        columns: present(metadata, ["station", ...columns]),
        rowStart: start,
        rowEnd: start + rows,
      });
      for (const r of read) if (r.station === station) out.push(r);
    }
    start += rows;
  }
  return out;
}

/** The newest value in a file, from its footer's statistics alone. */
export async function latest(url: string, column = "time"): Promise<Date | undefined> {
  const metadata = await parquetMetadataAsync(await asyncBufferFromUrl({ url }));
  let newest: Date | undefined;
  for (const group of metadata.row_groups) {
    const stats = group.columns.find((c) => c.meta_data?.path_in_schema[0] === column)?.meta_data
      ?.statistics;
    const max = stats?.max_value ?? stats?.max;
    const time =
      max instanceof Date
        ? max
        : typeof max === "bigint"
          ? new Date(Number(max / 1000n))
          : undefined;
    if (time && (!newest || time > newest)) newest = time;
  }
  return newest;
}
