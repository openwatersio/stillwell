import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { Flag, type Observation, type PublishedExtreme, type Station } from "../schema.ts";
import type { EventIndex } from "../types.ts";

/**
 * Read and write the lake's Parquet files through DuckDB, on local disk or on
 * R2. An `s3://` path uses the credentials in S3_ENDPOINT, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY and S3_REGION, the same variables crowd-depth reads.
 *
 * Times are stored as TIMESTAMPTZ in UTC and levels as FLOAT (float32), so
 * levels read back rounded to a tenth of a millimeter.
 */
let connecting: Promise<DuckDBConnection> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Run DuckDB work one call at a time, since callers share one connection. */
function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

function connection(): Promise<DuckDBConnection> {
  connecting ??= (async () => {
    const instance = await DuckDBInstance.create(":memory:");
    const db = await instance.connect();
    await db.run("SET TimeZone = 'UTC'");
    const endpoint = process.env.S3_ENDPOINT;
    if (endpoint) {
      await db.run("INSTALL httpfs; LOAD httpfs;");
      await db.run(
        `CREATE SECRET lake (TYPE s3, KEY_ID ${quote(process.env.S3_ACCESS_KEY_ID ?? "")}, SECRET ${quote(process.env.S3_SECRET_ACCESS_KEY ?? "")}, ENDPOINT ${quote(endpoint.replace(/^https?:\/\//, ""))}, REGION ${quote(process.env.S3_REGION ?? "auto")}, URL_STYLE 'path')`,
      );
    }
    return db;
  })();
  return connecting;
}

/**
 * Observations: `time`, `level_m`, `flag`, `received`, `datum`, sorted by time.
 * `datum` is the same on every row; it lets a reader, and the next write, check
 * that a file holds one datum.
 */
export async function writeObservations(
  path: string,
  rows: Observation[],
  datum: string,
): Promise<void> {
  await copyRows(path, rows, "time, level_m, flag, received, datum", datum, (r) => [
    r.time,
    r.level,
    r.flag,
    r.received ?? null,
    null,
    null,
    null,
    null,
  ]);
}

export async function readObservations(path: string): Promise<Observation[]> {
  const rows = await read(
    path,
    "SELECT epoch_ms(time) AS time, level_m, flag, epoch_ms(received) AS received",
  );
  return rows.map((r) => {
    const o: Observation = { time: Number(r.time), level: level(r.level_m), flag: r.flag as Flag };
    if (r.received !== null) o.received = Number(r.received);
    return o;
  });
}

/**
 * Extremes: `time`, `level_m`, `type`, `flag`, plus `transit` and `event` when
 * the source gives them, and `datum` as for observations.
 */
export async function writeExtremes(
  path: string,
  rows: PublishedExtreme[],
  datum: string,
): Promise<void> {
  const transit = rows.some((r) => "transit" in r);
  await copyRows(
    path,
    rows,
    `time, level_m, type, flag${transit ? ", transit, event" : ""}, datum`,
    datum,
    (r) => [
      r.time,
      r.level,
      r.flag,
      null,
      r.type,
      null,
      "transit" in r ? r.transit : null,
      "event" in r ? r.event : null,
    ],
  );
}

export async function readExtremes(path: string): Promise<PublishedExtreme[]> {
  const rows = await read(path, "SELECT epoch_ms(time) AS time, * EXCLUDE (time, datum)");
  return rows.map((r) => {
    const e = {
      time: Number(r.time),
      level: level(r.level_m),
      type: r.type as "high" | "low",
      flag: r.flag as Flag,
    };
    return r.transit === undefined || r.transit === null
      ? e
      : { ...e, transit: Number(r.transit), event: Number(r.event) as EventIndex };
  });
}

/** The datums a series file holds: one, or none when the file doesn't exist. */
export async function readDatums(path: string): Promise<string[]> {
  const rows = await read(path, "SELECT DISTINCT datum", "datum");
  return rows.map((r) => String(r.datum));
}

/** What backfill needs to know about one yearly file: its preliminary values, months with values and last time. */
export interface YearFile {
  preliminary: number;
  months: number;
  last: number;
}

/**
 * Every yearly file in a station's series directory, by year, in one read, so
 * backfill can tell which years are already written without a request per year.
 */
export async function readYearFiles(dir: string): Promise<Map<number, YearFile>> {
  if (!isRemote(dir) && !existsSync(dir)) return new Map();
  const rows = await read(
    `${dir}/*.parquet`,
    `SELECT filename, count(*) FILTER (WHERE flag = ${Flag.preliminary}) AS preliminary, count(DISTINCT month(time)) AS months, epoch_ms(max(time)) AS last`,
    "filename",
    "GROUP BY filename",
    { filename: true },
  );
  return new Map(
    rows.flatMap((r) => {
      const year = /(\d{4})\.parquet$/.exec(String(r.filename))?.[1];
      return year
        ? [
            [
              Number(year),
              {
                preliminary: Number(r.preliminary),
                months: Number(r.months),
                last: Number(r.last),
              },
            ],
          ]
        : [];
    }),
  );
}

/** The years a station's series directory has files for, from a listing alone. */
export function listYears(dir: string): Promise<Set<number>> {
  return serial(async () => {
    if (!isRemote(dir) && !existsSync(dir)) return new Set<number>();
    const db = await connection();
    const reader = await db.runAndReadAll(`SELECT file FROM glob(${quote(`${dir}/*.parquet`)})`);
    return new Set(
      reader
        .getRowObjects()
        .map((r) => /(\d{4})\.parquet$/.exec(String(r.file))?.[1])
        .filter((y) => y !== undefined)
        .map(Number),
    );
  });
}

export type StationObservation = Observation & { station: string };

/** The recent window for a source: `station`, then the observation columns, sorted by station and time. */
export async function writeRecent(
  path: string,
  batches: Iterable<StationObservation[]> | AsyncIterable<StationObservation[]>,
): Promise<void> {
  // A batch of stations at a time: every live USGS station's 7 days is about
  // 9 million values, too many to hold as objects at once.
  const table = await serial(createTable);
  try {
    for await (const rows of batches) await serial(() => appendRows(table, rows, recentCells));
    await serial(() =>
      copyOut(path, table, "station, time, level_m, flag, received", undefined, "station, time_ms"),
    );
  } finally {
    await serial(() => dropTable(table));
  }
}

const recentCells = (r: StationObservation): Cell[] => [
  r.time,
  r.level,
  r.flag,
  r.received ?? null,
  null,
  r.station,
  null,
  null,
];

/**
 * Decode every value of a recent window without keeping any, so a file that
 * can't be read in full fails now. A missing file passes.
 */
export async function checkRecent(path: string): Promise<void> {
  await read(path, "SELECT sum(hash(station, time, level_m, flag, received)) AS h", "h");
}

/** The recent window, or just the named stations' part of it. */
export async function readRecent(path: string, stations?: string[]): Promise<StationObservation[]> {
  if (stations?.length === 0) return [];
  const rows = await read(
    path,
    "SELECT station, epoch_ms(time) AS time, level_m, flag, epoch_ms(received) AS received",
    "station, time",
    // The file is sorted by station, so the range lets DuckDB skip the row groups outside it.
    stations
      ? `WHERE station BETWEEN ${quote(stations.reduce((a, b) => (a < b ? a : b)))} AND ${quote(stations.reduce((a, b) => (a > b ? a : b)))} AND station IN (${stations.map(quote).join(", ")})`
      : "",
  );
  return rows.map((r) => {
    const o: StationObservation = {
      station: String(r.station),
      time: Number(r.time),
      level: level(r.level_m),
      flag: r.flag as Flag,
    };
    if (r.received !== null) o.received = Number(r.received);
    return o;
  });
}

const STATION_COLUMNS: Record<keyof Station, string> = {
  id: "VARCHAR",
  source: "VARCHAR",
  source_id: "VARCHAR",
  name: "VARCHAR",
  lat: "DOUBLE",
  lon: "DOUBLE",
  country_code: "VARCHAR",
  kind: "VARCHAR",
  interval_s: "INTEGER",
  datum: "VARCHAR",
  datums: "MAP(VARCHAR, DOUBLE)",
  products: "VARCHAR[]",
  first: "TIMESTAMPTZ",
  last: "TIMESTAMPTZ",
  license: "VARCHAR",
  commercial_use: "BOOLEAN",
  attribution: "VARCHAR",
  tide_station: "VARCHAR",
  same_as: "VARCHAR[]",
  status: "VARCHAR",
  live: "BOOLEAN",
  min_interval_s: "INTEGER",
  source_url: "VARCHAR",
};

/** `stations.parquet`: one row per series, sorted by ID. */
export async function writeStations(path: string, stations: Station[]): Promise<void> {
  await viaJson(
    path,
    stations,
    `SELECT ${Object.keys(STATION_COLUMNS).join(", ")} FROM read_json(?, format = 'newline_delimited', columns = ${struct(STATION_COLUMNS)}) ORDER BY id`,
    "FORMAT parquet, COMPRESSION zstd",
  );
}

/** A JSON array, through DuckDB so it can go to R2 like everything else. */
export async function writeJsonArray(path: string, rows: object[]): Promise<void> {
  await viaJson(
    path,
    rows,
    "SELECT * FROM read_json(?, format = 'newline_delimited')",
    "FORMAT json, ARRAY true",
  );
}

type Cell = number | string | null;

/**
 * Append rows to a scratch table with columns (time_ms, level_m, flag,
 * received_ms, type, station, transit, event) and copy the named columns out.
 */
function copyRows<T>(
  path: string,
  rows: T[],
  columns: string,
  datum: string | undefined,
  cells: (row: T) => Cell[],
  order = "time_ms",
): Promise<void> {
  return serial(() => copyRowsNow(path, rows, columns, datum, cells, order));
}

async function copyRowsNow<T>(
  path: string,
  rows: T[],
  columns: string,
  datum: string | undefined,
  cells: (row: T) => Cell[],
  order: string,
): Promise<void> {
  const table = await createTable();
  try {
    await appendRows(table, rows, cells);
    await copyOut(path, table, columns, datum, order);
  } finally {
    await dropTable(table);
  }
}

async function createTable(): Promise<string> {
  const db = await connection();
  const table = `rows_${Math.random().toString(36).slice(2)}`;
  await db.run(
    `CREATE TABLE ${table} (time_ms DOUBLE, level_m FLOAT, flag UTINYINT, received_ms DOUBLE, type VARCHAR, station VARCHAR, transit INTEGER, event UTINYINT)`,
  );
  return table;
}

async function appendRows<T>(table: string, rows: T[], cells: (row: T) => Cell[]): Promise<void> {
  const db = await connection();
  const appender = await db.createAppender(table);
  for (const row of rows) {
    const [time, level, flag, received, type, station, transit, event] = cells(row);
    appender.appendDouble(time as number);
    appender.appendFloat(level as number);
    appender.appendUTinyInt(flag as number);
    received === null ? appender.appendNull() : appender.appendDouble(received as number);
    type === null ? appender.appendNull() : appender.appendVarchar(type as string);
    station === null ? appender.appendNull() : appender.appendVarchar(station as string);
    transit === null ? appender.appendNull() : appender.appendInteger(transit as number);
    event === null ? appender.appendNull() : appender.appendUTinyInt(event as number);
    appender.endRow();
  }
  appender.closeSync();
}

async function copyOut(
  path: string,
  table: string,
  columns: string,
  datum: string | undefined,
  order: string,
): Promise<void> {
  const db = await connection();
  await prepare(path);
  const select = columns
    .split(", ")
    .map((c) =>
      c === "time"
        ? "epoch_ms(time_ms::BIGINT)::TIMESTAMPTZ AS time"
        : c === "received"
          ? "epoch_ms(received_ms::BIGINT)::TIMESTAMPTZ AS received"
          : c === "datum"
            ? `${quote(datum!)} AS datum`
            : c,
    )
    .join(", ");
  await db.run(
    `COPY (SELECT ${select} FROM ${table} ORDER BY ${order}) TO ${quote(path)} (FORMAT parquet, COMPRESSION zstd)`,
  );
}

async function dropTable(table: string): Promise<void> {
  await (await connection()).run(`DROP TABLE ${table}`);
}

/** Write rows to a local NDJSON file, then let DuckDB select from it into `path`. */
function viaJson(path: string, rows: object[], select: string, format: string): Promise<void> {
  return serial(() => viaJsonNow(path, rows, select, format));
}

async function viaJsonNow(path: string, rows: object[], select: string, format: string) {
  const db = await connection();
  await prepare(path);
  const dir = await mkdtemp(join(tmpdir(), "water-levels-"));
  try {
    const file = join(dir, "rows.json");
    await writeFile(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    await db.run(`COPY (${select.replace("?", quote(file))}) TO ${quote(path)} (${format})`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function read(
  path: string,
  select: string,
  order = "time",
  where = "",
  { filename = false } = {},
): Promise<Record<string, unknown>[]> {
  return serial(() => readNow(path, select, order, where, filename));
}

async function readNow(
  path: string,
  select: string,
  order: string,
  where: string,
  filename = false,
): Promise<Record<string, unknown>[]> {
  if (!isRemote(path) && !path.includes("*") && !existsSync(path)) return [];
  const db = await connection();
  try {
    const source = filename
      ? `read_parquet(${quote(path)}, filename = true, union_by_name = true)`
      : `read_parquet(${quote(path)})`;
    const reader = await db.runAndReadAll(`${select} FROM ${source} ${where} ORDER BY ${order}`);
    return reader.getRowObjects() as Record<string, unknown>[];
  } catch (error) {
    // A missing remote file, or a pattern nothing matches, is an empty series, not a failure.
    if (
      (isRemote(path) || path.includes("*")) &&
      /404|No files found|does not exist/i.test(String(error))
    )
      return [];
    throw error;
  }
}

async function prepare(path: string): Promise<void> {
  if (!isRemote(path)) await mkdir(dirname(path), { recursive: true });
}

function isRemote(path: string): boolean {
  return /^[a-z0-9]+:\/\//.test(path);
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function struct(columns: Record<string, string>): string {
  return `{${Object.entries(columns)
    .map(([k, v]) => `${k}: ${quote(v)}`)
    .join(", ")}}`;
}

function level(value: unknown): number {
  return Math.round(Number(value) * 10_000) / 10_000;
}
