// What the levels Worker reads: the live window from D1 and everything older
// from the store's Parquet files on R2 (docs/plans/cloudflare.md, The levels API).

import { decompress } from "fzstd";
import {
  type AsyncBuffer,
  parquetMetadataAsync,
  parquetReadObjects,
  type ParquetRow,
} from "hyparquet";
import { buildCatalog, type Catalog, type CatalogStation } from "../../src/api/catalog.ts";
import type { EpochSpan, LevelsData } from "../../src/api/handler.ts";
import { MAX_VALUES, stepSampler, type StoredLevel, TooManyValues } from "../../src/api/levels.ts";
import { Flag } from "../../src/schema.ts";
import { seriesPath } from "../../src/store/paths.ts";

/** The parts of a D1 binding the Worker uses. */
export interface D1 {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
    };
  };
}

/** The parts of an R2 binding the Worker uses. */
export interface Bucket {
  get(
    key: string,
    options?: {
      range: { offset: number; length: number } | { suffix: number };
      onlyIf?: { etagMatches: string };
    },
  ): Promise<{ size: number; etag: string; arrayBuffer?(): Promise<ArrayBuffer> } | null>;
}

const DAY = 86_400_000;
/** How many UTC days D1 holds: today and the 7 before. */
const LIVE_DAYS = 8;
/** How much of a file's end the first read takes: the footer, and the whole of most year files. */
const TAIL_BYTES = 1 << 20;

// The store writes zstd (src/store/parquet.ts, copyOut); fzstd is pure JavaScript, which a Worker can run.
const compressors = {
  ZSTD: (input: Uint8Array, length: number) => decompress(input, new Uint8Array(length)),
};
// Times as epoch ms, which take less memory than Dates.
const parsers = {
  timestampFromMilliseconds: (ms: bigint) => Number(ms),
  timestampFromMicroseconds: (us: bigint) => Number(us / 1000n),
  timestampFromNanoseconds: (ns: bigint) => Number(ns / 1_000_000n),
};

/**
 * An R2 object as a file the Parquet reader reads in ranges, or null when
 * it doesn't exist: one read of its last megabyte, then one per range before
 * that, so a year file larger than a Worker's memory still reads. Each later
 * range is read only from the version the first read found, so a file
 * compaction rewrites meanwhile fails the read rather than mix two versions.
 */
export async function r2File(bucket: Bucket, key: string): Promise<AsyncBuffer | null> {
  const tail = await bucket.get(key, { range: { suffix: TAIL_BYTES } });
  if (!tail?.arrayBuffer) return null;
  const end = await tail.arrayBuffer();
  const from = tail.size - end.byteLength;
  return {
    byteLength: tail.size,
    async slice(start, stop = tail.size) {
      if (start >= from) return end.slice(start - from, stop - from);
      const part = await bucket.get(key, {
        range: { offset: start, length: stop - start },
        onlyIf: { etagMatches: tail.etag },
      });
      if (!part) throw new Error(`${key} is gone`);
      // R2 answers a failed condition with the object's metadata and no body.
      if (!part.arrayBuffer) throw new Error(`${key} changed while it was read`);
      return part.arrayBuffer();
    },
  };
}

/**
 * Each row of a Parquet file, one row group at a time, which holds the
 * reader's memory to one group's: the whole station list at once takes over
 * 128 MB. `groups` picks the row groups to read from their columns'
 * statistics and their number of rows.
 */
async function eachRow(
  file: AsyncBuffer,
  columns: string[],
  each: (row: ParquetRow) => void,
  groups: (
    columns: Record<string, { min?: unknown; max?: unknown }>,
    rows: number,
  ) => boolean = () => true,
): Promise<void> {
  const metadata = await parquetMetadataAsync(file);
  let rowStart = 0;
  for (const group of metadata.row_groups) {
    const rowEnd = rowStart + Number(group.num_rows);
    const stats = Object.fromEntries(
      group.columns.map((c) => [
        c.meta_data?.path_in_schema[0] ?? "",
        { min: c.meta_data?.statistics?.min_value, max: c.meta_data?.statistics?.max_value },
      ]),
    );
    if (groups(stats, rowEnd - rowStart))
      for (const row of await parquetReadObjects({
        file,
        metadata,
        columns,
        compressors,
        parsers,
        rowStart,
        rowEnd,
      }))
        each(row);
    rowStart = rowEnd;
  }
}

async function readRows(file: AsyncBuffer, columns: string[]): Promise<ParquetRow[]> {
  const rows: ParquetRow[] = [];
  await eachRow(file, columns, (row) => rows.push(row));
  return rows;
}

const STATION_COLUMNS = [
  "id",
  "source",
  "name",
  "datum",
  "chart_datum",
  "frame",
  "commercial_use",
  "attribution",
  "datums_attribution",
  "tide_station",
  "min_interval_s",
  "interval_s",
  "products",
  "epochs",
];

/** The public stations and their offsets, from `stations.parquet` and `stations/offsets.parquet` in `bucket`. */
export async function loadCatalog(bucket: Bucket): Promise<Catalog> {
  const [stationsFile, offsetsFile] = await Promise.all(
    ["stations.parquet", "stations/offsets.parquet"].map(async (key) => {
      const object = await bucket.get(key);
      if (!object?.arrayBuffer) throw new Error(`no ${key} in the store`);
      return object.arrayBuffer();
    }),
  );
  type Epoch = {
    id: number;
    since: number | null;
    until: number | null;
    to_current: number | null;
    state: string;
  };
  const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
  const stations: Record<string, unknown>[] = [];
  // Each epoch's fields as arrays in step, as buildCatalog takes them, made
  // as each row is read so the rest of the epoch, such as its datums, isn't kept.
  await eachRow(stationsFile!, STATION_COLUMNS, ({ epochs, ...s }) => {
    const list = (epochs ?? []) as Epoch[];
    stations.push({
      ...s,
      epoch_ids: list.map((e) => e.id),
      since: list.map((e) => iso(e.since)),
      until: list.map((e) => iso(e.until)),
      to_current: list.map((e) => e.to_current),
      state: list.map((e) => e.state),
    });
  });
  const offsets = await readRows(offsetsFile!, ["station", "epoch", "datum", "offset_m"]);
  // An empty file is a broken publish; the last list keeps serving.
  if (!stations.length) throw new Error("no stations in stations.parquet");
  if (!offsets.length) throw new Error("no offsets in stations/offsets.parquet");
  return buildCatalog(stations, offsets);
}

/** One D1 `live` value: epoch, time, level, flag, source flag and received, times in epoch ms. */
type LiveValue = [number, number, number, number, number | null, number | null];

/** The UTC day of a time, as `live` keys it. */
function dayOf(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** The UTC day of a time as a number, which is quicker to look up than its date. */
function dayNumber(time: number): number {
  return Math.floor(time / DAY);
}

/** `levels`' values from D1's `live` for the last 8 days, and the year files on R2 for any time D1 doesn't hold. */
export function storeData(db: D1, bucket: Bucket, now: () => number = Date.now): LevelsData {
  return {
    async readLevels(station, from, to, sampling) {
      const sampler = sampling && stepSampler(sampling.step, sampling.usable);
      const all: StoredLevel[] = [];
      const add = (v: StoredLevel) => {
        if (sampler) return sampler.add(v);
        if (all.length >= MAX_VALUES.held) throw new TooManyValues();
        all.push(v);
      };
      const first = dayOf(Math.max(from, now() - (LIVE_DAYS - 1) * DAY));
      const last = dayOf(to);
      const live =
        first <= last
          ? (
              await db
                .prepare("SELECT day, rows FROM live WHERE station = ? AND day >= ? AND day <= ?")
                .bind(station.id, first, last)
                .all<{ day: string; rows: string }>()
            ).results
          : [];
      // Each day D1 holds, from its first value on: before that, as on the day the poller started or came back from an
      // outage longer than its lookback, the year files have it.
      const heldFrom = new Map<number, number>();
      for (const { day, rows } of live) {
        const values = JSON.parse(rows) as LiveValue[];
        if (values.length) heldFrom.set(dayNumber(Date.parse(day)), values[0]![1]);
        for (const [epoch, time, level, flag, , received] of values)
          if (time >= from && time <= to) add({ epoch, time, level, flag, received });
      }
      // Only the times D1 doesn't hold, so it wins where both have a time.
      const missing = (t: number) => {
        const since = heldFrom.get(dayNumber(t));
        return since === undefined || t < since;
      };
      let firstMissing: number | undefined;
      let lastMissing: number | undefined;
      for (let day = dayNumber(from) * DAY; day <= to; day += DAY)
        if (missing(Math.max(day, from))) [firstMissing, lastMissing] = [firstMissing ?? day, day];
      if (firstMissing !== undefined) {
        const range = [Math.max(from, firstMissing), Math.min(to, lastMissing! + DAY - 1)] as const;
        await readYears(bucket, station, ...range, missing, add);
      }
      return (sampler ? sampler.values() : all).sort((a, b) => a.time - b.time);
    },

    async newest(station, epochs) {
      if (!epochs.length) return null;
      const { results } = await db
        .prepare("SELECT rows FROM live WHERE station = ? ORDER BY day DESC")
        .bind(station)
        .all<{ rows: string }>();
      for (const { rows } of results) {
        const values = JSON.parse(rows) as LiveValue[];
        for (let i = values.length - 1; i >= 0; i--) {
          const [epoch, time, , flag] = values[i]!;
          if (flag !== Flag.bad && within(epochs, epoch, time)) return time;
        }
      }
      return null;
    },

    async lastPass(source, group) {
      const row = await db
        .prepare(
          `SELECT max(finished) AS t FROM polls
           WHERE source = ? AND ok = 1
             AND (json_array_length(intervals) = 0 OR EXISTS (SELECT 1 FROM json_each(polls.intervals) WHERE value = ?))`,
        )
        .bind(source, group)
        .first<{ t: number | null }>();
      return row?.t ?? null;
    },
  };
}

function within(epochs: EpochSpan[], epoch: number, time: number): boolean {
  const e = epochs.find((e) => e.id === epoch);
  return !!e && (e.since === null || time >= e.since) && (e.until === null || time < e.until);
}

/**
 * Gives `add` the station's values from `from` to `to` in its year files,
 * at the times `keep` takes: each UTC year's file of each epoch whose span
 * meets the range, skipping row groups outside it. A file that doesn't exist
 * has none. Row groups of more than `MAX_VALUES.read` values in all throw
 * `TooManyValues` before they're read.
 */
async function readYears(
  bucket: Bucket,
  station: CatalogStation,
  from: number,
  to: number,
  keep: (time: number) => boolean,
  add: (v: StoredLevel) => void,
): Promise<void> {
  const sourceId = station.id.slice(station.source.length + 1);
  const files: { epoch: number; year: number }[] = [];
  for (const [epoch, span] of station.epochs) {
    if ((span.since !== null && to < span.since) || (span.until !== null && from >= span.until))
      continue;
    for (let year = new Date(from).getUTCFullYear(); year <= new Date(to).getUTCFullYear(); year++)
      files.push({ epoch, year });
  }
  let read = 0;
  // One file at a time, so only one is in memory.
  for (const { epoch, year } of files) {
    // The root is the bucket's, so the key is the path without its leading slash.
    const file = await r2File(
      bucket,
      seriesPath("", "levels", station.source, sourceId, year, epoch).slice(1),
    );
    if (!file) continue;
    await eachRow(
      file,
      ["time", "level_m", "flag", "received"],
      (r) => {
        if (r.time >= from && r.time <= to && keep(r.time))
          add({ epoch, time: r.time, level: r.level_m, flag: r.flag, received: r.received });
      },
      ({ time }, rows) => {
        if (Number(time?.max) < from || Number(time?.min) > to) return false;
        if ((read += rows) > MAX_VALUES.read) throw new TooManyValues();
        return true;
      },
    );
  }
}
