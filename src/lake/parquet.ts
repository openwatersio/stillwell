import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import type { Flag, Observation, PublishedExtreme, Station } from "../schema.ts";
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

/** Observations: `time`, `level_m`, `flag`, `received`, sorted by time. */
export async function writeObservations(path: string, rows: Observation[]): Promise<void> {
  await copyRows(path, rows, "time, level_m, flag, received", (r) => [
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

/** Extremes: `time`, `level_m`, `type`, `flag`, plus `transit` and `event` when the source gives them. */
export async function writeExtremes(path: string, rows: PublishedExtreme[]): Promise<void> {
  const transit = rows.some((r) => "transit" in r);
  await copyRows(
    path,
    rows,
    `time, level_m, type, flag${transit ? ", transit, event" : ""}`,
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
  const rows = await read(path, "SELECT epoch_ms(time) AS time, * EXCLUDE (time)");
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

export type StationObservation = Observation & { station: string };

/** The recent window for a source: `station`, then the observation columns, sorted by station and time. */
export async function writeRecent(path: string, rows: StationObservation[]): Promise<void> {
  await copyRows(
    path,
    rows,
    "station, time, level_m, flag, received",
    (r) => [r.time, r.level, r.flag, r.received ?? null, null, r.station, null, null],
    "station, time_ms",
  );
}

export async function readRecent(path: string): Promise<StationObservation[]> {
  const rows = await read(
    path,
    "SELECT station, epoch_ms(time) AS time, level_m, flag, epoch_ms(received) AS received",
    "station, time",
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
  cells: (row: T) => Cell[],
  order = "time_ms",
): Promise<void> {
  return serial(() => copyRowsNow(path, rows, columns, cells, order));
}

async function copyRowsNow<T>(
  path: string,
  rows: T[],
  columns: string,
  cells: (row: T) => Cell[],
  order: string,
): Promise<void> {
  const db = await connection();
  await prepare(path);
  const table = `rows_${Math.random().toString(36).slice(2)}`;
  await db.run(
    `CREATE TABLE ${table} (time_ms DOUBLE, level_m FLOAT, flag UTINYINT, received_ms DOUBLE, type VARCHAR, station VARCHAR, transit INTEGER, event UTINYINT)`,
  );
  try {
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
    const select = columns
      .split(", ")
      .map((c) =>
        c === "time"
          ? "epoch_ms(time_ms::BIGINT)::TIMESTAMPTZ AS time"
          : c === "received"
            ? "epoch_ms(received_ms::BIGINT)::TIMESTAMPTZ AS received"
            : c,
      )
      .join(", ");
    await db.run(
      `COPY (SELECT ${select} FROM ${table} ORDER BY ${order}) TO ${quote(path)} (FORMAT parquet, COMPRESSION zstd)`,
    );
  } finally {
    await db.run(`DROP TABLE ${table}`);
  }
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

function read(path: string, select: string, order = "time"): Promise<Record<string, unknown>[]> {
  return serial(() => readNow(path, select, order));
}

async function readNow(
  path: string,
  select: string,
  order: string,
): Promise<Record<string, unknown>[]> {
  if (!isRemote(path) && !existsSync(path)) return [];
  const db = await connection();
  try {
    const reader = await db.runAndReadAll(
      `${select} FROM read_parquet(${quote(path)}) ORDER BY ${order}`,
    );
    return reader.getRowObjects() as Record<string, unknown>[];
  } catch (error) {
    // A missing remote file is an empty series, not a failure.
    if (isRemote(path) && /404|No files found|does not exist/i.test(String(error))) return [];
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
