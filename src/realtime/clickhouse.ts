import type { Source } from "../schema.ts";
import type { StationObservation } from "../store/parquet.ts";
import { chunks } from "../chunks.ts";

/**
 * ClickHouse over its HTTP interface, bound to one database. Values go in as
 * bound parameters (`{name:Type}` in the SQL), never into the SQL itself.
 */
export interface ClickHouse {
  database: string;
  /** Rows of a SELECT, each as an object of its columns. */
  query<T = Record<string, unknown>>(sql: string, params?: Params): Promise<T[]>;
  /** A statement with no result, such as DDL or a DELETE. */
  exec(sql: string, params?: Params): Promise<void>;
  /** Insert rows into `table` as JSON. */
  insert(table: string, rows: Record<string, unknown>[]): Promise<void>;
}

/** How long a request to ClickHouse may take. */
const TIMEOUT_MS = 10 * 60_000;

type Param = string | number | boolean | null | string[] | number[];
type Params = Record<string, Param>;

/** The database a source's values go to: one of their own for a source whose terms bar republishing. */
export function databaseFor(source: Source): string {
  return source.metadata.license.redistribution ? "stillwell" : "stillwell_restricted";
}

/** A client for the database `database` at `url` (CLICKHOUSE_URL, by default on loopback). */
export function clickhouse(
  database: string,
  url = process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123",
): ClickHouse {
  const headers: Record<string, string> = {};
  if (process.env.CLICKHOUSE_USER) headers["X-ClickHouse-User"] = process.env.CLICKHOUSE_USER;
  if (process.env.CLICKHOUSE_PASSWORD)
    headers["X-ClickHouse-Key"] = process.env.CLICKHOUSE_PASSWORD;

  async function post(sql: string, params: Params = {}, body?: string, db = true): Promise<string> {
    // wait_end_of_query makes an error partway through a result a failed request, not data.
    const search = new URLSearchParams({
      query: sql,
      date_time_input_format: "best_effort",
      // A null in a column that can't hold one fails the insert rather than become 0.
      input_format_null_as_default: "0",
      wait_end_of_query: "1",
    });
    if (db) search.set("database", database);
    for (const [name, value] of Object.entries(params)) search.set(`param_${name}`, text(value));
    // A stuck query, such as a DELETE behind a slow mutation, fails rather than hold a pass forever.
    const response = await fetch(`${url}/?${search}`, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const answer = await response.text();
    if (!response.ok) throw new Error(`ClickHouse: ${answer.trim()}`);
    return answer;
  }

  return {
    database,
    async query<T>(sql: string, params?: Params) {
      const answer = await post(`${sql} FORMAT JSONEachRow`, params);
      return answer
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as T);
    },
    async exec(sql, params) {
      // CREATE DATABASE runs before the database exists.
      await post(sql, params, undefined, !/^\s*CREATE DATABASE/i.test(sql));
    },
    async insert(table, rows) {
      // In chunks, so a body never nears a JavaScript string's limit.
      for (const batch of chunks(rows, 50_000))
        await post(
          `INSERT INTO ${table} FORMAT JSONEachRow`,
          {},
          batch.map((r) => JSON.stringify(r)).join("\n"),
        );
    },
  };
}

/** A parameter's text form, as ClickHouse reads it for the parameter's type. */
function text(value: Param): string {
  if (value === null) return "\\N";
  if (Array.isArray(value))
    return `[${value.map((v) => (typeof v === "string" ? `'${escape(v)}'` : String(v))).join(",")}]`;
  return typeof value === "string" ? escape(value) : String(value);
}

function escape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n");
}

/**
 * Create the database and its tables. Observations are keyed by station and
 * time, so a later version of a value replaces it whatever its epoch, and are
 * kept a day past the 7 the poller keeps current, until the history moves in
 * (docs/plans/realtime.md, step 2), which creates the table without the TTL.
 */
export async function migrate(ch: ClickHouse): Promise<void> {
  await ch.exec(`CREATE DATABASE IF NOT EXISTS ${ch.database}`);
  await ch.exec(`
    CREATE TABLE IF NOT EXISTS observations (
      station LowCardinality(String),
      epoch UInt16,
      time DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD),
      level Float32 CODEC(Gorilla, ZSTD),
      flag UInt8,
      source_flag Nullable(UInt8),
      received Nullable(DateTime64(3, 'UTC')) CODEC(DoubleDelta, ZSTD),
      version UInt64
    ) ENGINE = ReplacingMergeTree(version)
    PARTITION BY toYear(time)
    ORDER BY (station, time)
    TTL toDateTime(time) + INTERVAL 8 DAY`);
  await ch.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      source LowCardinality(String),
      started DateTime64(3, 'UTC'),
      finished DateTime64(3, 'UTC'),
      -- The min_interval_s groups the pass asked for, 0 for none given; empty for every station.
      intervals Array(UInt32),
      ok Bool,
      stations UInt32,
      updated UInt32,
      \`values\` UInt32,
      stale Array(String),
      failed Array(String),
      blocked Bool,
      datum_changed Bool
    ) ENGINE = MergeTree
    ORDER BY (source, started)
    TTL toDateTime(started) + INTERVAL 90 DAY`);
}

/**
 * Where the poller reads and writes each station's recent values. Deletes
 * return once the rows are gone, so a read after one never sees them.
 */
export interface ObservationStore {
  /** The named stations' values from `from` on, sorted by station and time. */
  read(stations: string[], from: number): Promise<StationObservation[]>;
  /** Insert rows as the given version, replacing any at the same station and time. */
  write(rows: StationObservation[], version: number): Promise<void>;
  /** Delete the given values. */
  remove(values: { station: string; time: number }[]): Promise<void>;
  /** Delete every value of the given stations. */
  removeStations(stations: string[]): Promise<void>;
  /** The stations with values whose ID starts with `<source>/`. */
  stations(source: string): Promise<string[]>;
}

interface Row {
  station: string;
  epoch: number;
  time_ms: string;
  level: number;
  flag: number;
  source_flag: number | null;
  received_ms: string | null;
}

/** The observations table as an `ObservationStore`. */
export function observationStore(ch: ClickHouse): ObservationStore {
  return {
    async read(stations, from) {
      if (!stations.length) return [];
      // The aliases differ from the columns, which a WHERE would otherwise read as the alias.
      const rows = await ch.query<Row>(
        `SELECT station, epoch, toUnixTimestamp64Milli(time) AS time_ms, level, flag, source_flag,
           toUnixTimestamp64Milli(received) AS received_ms
         FROM observations FINAL
         WHERE station IN {stations:Array(String)} AND time >= fromUnixTimestamp64Milli({from:Int64})
         ORDER BY station, time
         SETTINGS do_not_merge_across_partitions_select_final = 1`,
        { stations, from },
      );
      return rows.map((r) => ({
        station: r.station,
        epoch: Number(r.epoch),
        time: Number(r.time_ms),
        level: r.level,
        flag: r.flag as StationObservation["flag"],
        ...(r.source_flag === null
          ? {}
          : { source_flag: r.source_flag as StationObservation["flag"] }),
        ...(r.received_ms === null ? {} : { received: Number(r.received_ms) }),
      }));
    },
    async write(rows, version) {
      await ch.insert(
        "observations",
        rows.map((r) => ({
          station: r.station,
          epoch: r.epoch,
          time: iso(r.time),
          level: r.level,
          flag: r.flag,
          source_flag: r.source_flag ?? null,
          received: r.received === undefined ? null : iso(r.received),
          version,
        })),
      );
    },
    async remove(values) {
      // One DELETE for many values, in chunks under ClickHouse's 128 KiB for one parameter.
      for (const batch of chunks(values, 1000))
        await ch.exec(
          `DELETE FROM observations WHERE station IN {stations:Array(String)}
           AND concat(station, ' ', toString(toUnixTimestamp64Milli(time))) IN {keys:Array(String)}
           SETTINGS lightweight_deletes_sync = 2`,
          {
            stations: [...new Set(batch.map((v) => v.station))],
            keys: batch.map((v) => `${v.station} ${v.time}`),
          },
        );
    },
    async removeStations(stations) {
      for (const batch of chunks(stations, 1000))
        await ch.exec(
          `DELETE FROM observations WHERE station IN {stations:Array(String)}
           SETTINGS lightweight_deletes_sync = 2`,
          {
            stations: batch,
          },
        );
    },
    async stations(source) {
      const rows = await ch.query<{ station: string }>(
        // A range on the sort key, so it reads only the source's part: `0` follows `/`.
        `SELECT DISTINCT station FROM observations
         WHERE station >= {from:String} AND station < {to:String}`,
        { from: `${source}/`, to: `${source}0` },
      );
      return rows.map((r) => r.station);
    },
  };
}

function iso(time: number): string {
  return new Date(time).toISOString();
}
