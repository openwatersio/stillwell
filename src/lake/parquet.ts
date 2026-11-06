import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  Flag,
  type Epoch,
  type LakeStation,
  type Observation,
  type PublishedExtreme,
  type Station,
} from "../schema.ts";
import type { EventIndex } from "../types.ts";

/**
 * Read and write the lake's Parquet files through DuckDB, on local disk or on
 * R2. An `s3://` path uses the credentials in S3_ENDPOINT, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY and S3_REGION, the same variables crowd-depth reads.
 *
 * Times are stored as TIMESTAMPTZ in UTC and levels as FLOAT (float32), so
 * levels read back rounded to a tenth of a millimeter.
 */
let instance: Promise<DuckDBInstance> | undefined;
const lanes: { queue: Promise<unknown>; pending: number; db: Promise<DuckDBConnection> }[] = [];
let laneCount = 1;
const current = new AsyncLocalStorage<Promise<DuckDBConnection>>();

/**
 * How many DuckDB connections run lake work at once, 1 by default. Compaction
 * raises it, since each year file on R2 is mostly waiting on the network.
 */
export function setConnections(count: number): void {
  laneCount = Math.max(1, Math.floor(count));
}

/**
 * Run DuckDB work one call at a time on a connection: the least busy of
 * `setConnections` of them. Connections share one in-memory database, so work
 * on one table can span calls that land on different connections.
 */
function serial<T>(work: () => Promise<T>): Promise<T> {
  while (lanes.length < laneCount) {
    const db = connect();
    // A lane no work reaches yet mustn't end the process if its setup fails;
    // the work that does reach it gets the error.
    db.catch(() => undefined);
    lanes.push({ queue: Promise.resolve(), pending: 0, db });
  }
  const lane = lanes.slice(0, laneCount).reduce((a, b) => (b.pending < a.pending ? b : a));
  lane.pending++;
  const run = () => current.run(lane.db, work);
  const next = lane.queue.then(run, run).finally(() => lane.pending--);
  lane.queue = next.catch(() => undefined);
  return next;
}

function connection(): Promise<DuckDBConnection> {
  const db = current.getStore();
  if (!db) throw new Error("DuckDB work must run through serial()");
  return db;
}

/**
 * A connection to the one in-memory instance. The instance loads httpfs and
 * creates the lake's S3 secret once, when it starts: secrets belong to the
 * instance, and connections creating one at the same moment conflict in its
 * catalog, which failed most of a 16-connection compaction's reads.
 */
async function connect(): Promise<DuckDBConnection> {
  instance ??= (async () => {
    const created = await DuckDBInstance.create(":memory:");
    const endpoint = process.env.S3_ENDPOINT;
    if (endpoint) {
      const setup = await created.connect();
      await setup.run("INSTALL httpfs; LOAD httpfs;");
      await setup.run(
        `CREATE SECRET lake (TYPE s3, KEY_ID ${quote(process.env.S3_ACCESS_KEY_ID ?? "")}, SECRET ${quote(process.env.S3_SECRET_ACCESS_KEY ?? "")}, ENDPOINT ${quote(endpoint.replace(/^https?:\/\//, ""))}, REGION ${quote(process.env.S3_REGION ?? "auto")}, URL_STYLE 'path'${endpoint.startsWith("http://") ? ", USE_SSL false" : ""})`,
      );
    }
    return created;
  })();
  const db = await (await instance).connect();
  await db.run("SET TimeZone = 'UTC'");
  return db;
}

/**
 * Observations: `time`, `level_m`, `flag`, `source_flag`, `received`, `datum`,
 * sorted by time.
 * `datum` is the same on every row; it lets a reader, and the next write, check
 * that a file holds one datum.
 */
export async function writeObservations(
  path: string,
  rows: Observation[],
  datum: string,
): Promise<void> {
  await copyRows(path, rows, "time, level_m, flag, source_flag, received, datum", datum, (r) => [
    r.time,
    r.level,
    r.flag,
    r.received ?? null,
    null,
    null,
    null,
    null,
    null,
    r.source_flag ?? null,
  ]);
}

export async function readObservations(path: string): Promise<Observation[]> {
  return (await readObservationFile(path)).rows;
}

/** A series file's observations and the datums it holds, in one read. */
export async function readObservationFile(
  path: string,
): Promise<{ rows: Observation[]; datums: string[] }> {
  // Every column, since a file written before `source_flag` was kept has none.
  const rows = await read(path, OBSERVATION_COLUMNS);
  const datums = new Set<string>();
  return {
    rows: rows.map((r) => {
      datums.add(String(r.datum));
      return observation(r);
    }),
    datums: [...datums],
  };
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
  /** Values the source sent as preliminary, whatever QC raised them to. */
  preliminary: number;
  months: number;
  last: number;
  /** Values with no `received` time, which only backfill writes. */
  backfilled: number;
}

/**
 * What the yearly files in a station's series directory hold, by year, for the
 * years asked about: a listing, then one read of just those files, so a file
 * for a year not asked about is never opened. A caller that already listed the
 * directory passes `listed`, to save a second listing.
 */
export async function readYearFiles(
  dir: string,
  years: number[],
  listed?: Set<number>,
): Promise<Map<number, YearFile>> {
  listed ??= await listYears(dir);
  const files = years.filter((y) => listed.has(y)).map((y) => quote(`${dir}/${y}.parquet`));
  if (!files.length) return new Map();
  const rows = await serial(async () => {
    const db = await connection();
    const reader = await db.runAndReadAll(
      // The empty row names `source_flag` and `received`, so files written
      // before they existed read them as null rather than fail to bind.
      `SELECT filename, count(*) FILTER (WHERE coalesce(source_flag, flag) = ${Flag.preliminary}) AS preliminary, count(DISTINCT month(time)) AS months, epoch_ms(max(time)) AS last, count(*) FILTER (WHERE received IS NULL) AS backfilled FROM (SELECT NULL::VARCHAR AS filename, NULL::TIMESTAMPTZ AS time, NULL::UTINYINT AS flag, NULL::UTINYINT AS source_flag, NULL::TIMESTAMPTZ AS received WHERE false UNION ALL BY NAME SELECT * FROM read_parquet([${files.join(", ")}], filename = true, union_by_name = true)) GROUP BY filename ORDER BY filename`,
    );
    return reader.getRowObjects();
  });
  // read_parquet globs too, so a station ID with a glob character reads other
  // stations' files; only this directory's count, as in listYears.
  const own = posix.normalize(dir);
  const mine = rows.filter((r) => {
    const match = /^(.*)\/\d{4}\.parquet$/.exec(String(r.filename));
    return match !== null && posix.normalize(match[1]!) === own;
  });
  return new Map(
    mine.map((r) => [
      Number(/(\d{4})\.parquet$/.exec(String(r.filename))![1]),
      {
        preliminary: Number(r.preliminary),
        months: Number(r.months),
        last: Number(r.last),
        backfilled: Number(r.backfilled),
      },
    ]),
  );
}

/** The years a station's series directory has files for, from a listing alone. */
export function listYears(dir: string): Promise<Set<number>> {
  return serial(async () => {
    if (!isRemote(dir) && !existsSync(dir)) return new Set<number>();
    const db = await connection();
    const reader = await db.runAndReadAll(`SELECT file FROM glob(${quote(`${dir}/*.parquet`)})`);
    // A station ID with a glob character matches other directories too, so
    // only files directly in this one count. DuckDB drops a leading `./` and
    // doubled slashes, so both sides are normalized before comparing.
    const own = posix.normalize(dir);
    const years = new Set<number>();
    for (const r of reader.getRowObjects()) {
      const match = /^(.*)\/(\d{4})\.parquet$/.exec(String(r.file));
      if (match && posix.normalize(match[1]!) === own) years.add(Number(match[2]));
    }
    return years;
  });
}

/** A recent value, with the station and the datum epoch it was fetched in. */
export type StationObservation = Observation & { station: string; epoch: number };

/**
 * The recent window for a source: `station`, then the observation columns and
 * `epoch`, sorted by station and time.
 */
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
      copyOut(
        path,
        table,
        "station, time, level_m, flag, source_flag, received, epoch",
        undefined,
        "station, time_ms",
      ),
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
  r.epoch,
  r.source_flag ?? null,
];

const OBSERVATION_COLUMNS =
  "SELECT * REPLACE (epoch_ms(time) AS time, epoch_ms(received) AS received)";

function observation(r: Record<string, unknown>): Observation {
  const o: Observation = { time: Number(r.time), level: level(r.level_m), flag: r.flag as Flag };
  if (r.source_flag != null) o.source_flag = r.source_flag as Flag;
  if (r.received !== null) o.received = Number(r.received);
  return o;
}

/**
 * Decode every value of a recent window without keeping any, so a file that
 * can't be read in full fails now. A missing file passes.
 */
export async function checkRecent(path: string): Promise<void> {
  await read(path, "SELECT sum(hash(r)) AS h", "h", "r");
}

/** The stations a recent window holds values for; none when the file doesn't exist. */
export async function recentStations(path: string): Promise<string[]> {
  const rows = await read(path, "SELECT DISTINCT station", "station");
  return rows.map((r) => String(r.station));
}

/** The highest epoch each station has rows for in a recent window; none for a file from before epochs. */
export async function recentEpochs(path: string): Promise<Map<string, number>> {
  let rows;
  try {
    rows = await read(
      path,
      "SELECT station, max(epoch) AS epoch",
      "station",
      "",
      "GROUP BY station",
    );
  } catch (error) {
    if (!/column "epoch"/i.test(String(error))) throw error;
    return new Map();
  }
  return new Map(rows.map((r) => [String(r.station), Number(r.epoch)]));
}

/** The recent window, or just the named stations' part of it. */
export async function readRecent(path: string, stations?: string[]): Promise<StationObservation[]> {
  if (stations?.length === 0) return [];
  // The file is sorted by station, so the range lets DuckDB skip the row groups outside it.
  const where = stations
    ? `WHERE station BETWEEN ${quote(stations.reduce((a, b) => (a < b ? a : b)))} AND ${quote(stations.reduce((a, b) => (a > b ? a : b)))} AND station IN (${stations.map(quote).join(", ")})`
    : "";
  // Every column, since older files lack some: one written before epochs has
  // no `epoch`, and every row in it is epoch 1; one written before
  // `source_flag` was kept has none.
  const rows = await read(path, OBSERVATION_COLUMNS, "station, time", "", where);
  return rows.map((r) => ({
    station: String(r.station),
    ...observation(r),
    epoch: r.epoch == null ? 1 : Number(r.epoch),
  }));
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

const EPOCHS =
  "STRUCT(id INTEGER, datum VARCHAR, since TIMESTAMPTZ, until TIMESTAMPTZ, seen TIMESTAMPTZ, reference VARCHAR, reference_since TIMESTAMPTZ, datums MAP(VARCHAR, DOUBLE), to_current DOUBLE, state VARCHAR)[]";

/** `stations.parquet`: one row per series, sorted by ID, with its datum epochs. */
export async function writeStations(path: string, stations: LakeStation[]): Promise<void> {
  const columns = { ...STATION_COLUMNS, epochs: EPOCHS };
  await viaJson(
    path,
    stations,
    `SELECT ${Object.keys(columns).join(", ")} FROM read_json(?, format = 'newline_delimited', columns = ${struct(columns)}) ORDER BY id`,
    "FORMAT parquet, COMPRESSION zstd",
  );
}

/** What a source's list holds besides the shared columns, kept as JSON in `extra`. */
const LIST_COLUMNS: Record<string, string> = Object.fromEntries(
  Object.entries(STATION_COLUMNS).filter(([key]) => key !== "first" && key !== "last"),
);

/**
 * A source's list, `stations/<source>.parquet`: the shared columns except
 * `first` and `last`, its epochs, and the source's own fields as JSON in `extra`.
 */
export async function writeStationList(path: string, stations: LakeStation[]): Promise<void> {
  const rows = stations.map((s) => {
    const extra = Object.fromEntries(
      Object.entries(s).filter(([key]) => !(key in STATION_COLUMNS) && key !== "epochs"),
    );
    return { ...s, extra: JSON.stringify(extra) };
  });
  const columns = { ...LIST_COLUMNS, epochs: EPOCHS, extra: "VARCHAR" };
  await viaJson(
    path,
    rows,
    `SELECT ${Object.keys(columns).join(", ")} FROM read_json(?, format = 'newline_delimited', columns = ${struct(columns)}) ORDER BY id`,
    "FORMAT parquet, COMPRESSION zstd",
  );
}

/** A source's list, or null when the lake has none. */
export async function readStationList(path: string): Promise<LakeStation[] | null> {
  if (!(await exists(path))) return null;
  const rows = await read(path, "SELECT to_json(t)::VARCHAR AS row", "id", "t");
  return rows.map((r) => {
    const { extra, epochs, ...fields } = JSON.parse(String(r.row)) as Record<string, unknown>;
    return {
      ...fields,
      ...(JSON.parse(String(extra ?? "{}")) as object),
      first: null,
      last: null,
      epochs: (epochs as Epoch[]).map((e) => ({
        ...e,
        since: isoOf(e.since),
        until: isoOf(e.until),
        seen: isoOf(e.seen),
        reference_since: isoOf(e.reference_since),
        datums: e.datums ?? {},
      })),
    } as LakeStation;
  });
}

/** Whether any file matches `pattern`, a path or a glob, local or remote. */
export async function exists(pattern: string): Promise<boolean> {
  const literal = !/[*?[]/.test(pattern);
  if (!isRemote(pattern) && literal) return existsSync(pattern);
  // A remote path is checked by reading it: HTTPS can't list files, and an S3
  // glob of a path with no wildcard echoes it back whether or not it exists.
  // `read` gives no rows for "not found", and throws any other failure.
  if (literal) return (await read(pattern, "SELECT count(*) AS n", "n")).length > 0;
  return serial(async () => {
    const db = await connection();
    const reader = await db.runAndReadAll(`SELECT count(*) AS n FROM glob(${quote(pattern)})`);
    return Number(reader.getRowObjects()[0]!.n) > 0;
  });
}

/** Whether any file matches any of `patterns`, which must hold a wildcard. */
export async function anyFile(patterns: string[]): Promise<boolean> {
  return serial(async () => {
    const db = await connection();
    for (const pattern of patterns) {
      const reader = await db.runAndReadAll(`SELECT file FROM glob(${quote(pattern)}) LIMIT 1`);
      if (reader.getRowObjects().length) return true;
    }
    return false;
  });
}

/** The sources a published `stations.parquet` lists; none when there's no file. */
export async function publishedSources(path: string): Promise<string[]> {
  const rows = await read(path, "SELECT DISTINCT source", "source");
  return rows.map((r) => String(r.source));
}

/**
 * The highest epoch directory each station has among the files `patterns`
 * match, by the station's directory (`epochDirs` without its last two parts).
 */
export async function highestEpochs(patterns: string[]): Promise<Map<string, number>> {
  return serial(async () => {
    const db = await connection();
    const highest = new Map<string, number>();
    for (const pattern of patterns) {
      const reader = await db.runAndReadAll(`SELECT file FROM glob(${quote(pattern)})`);
      for (const { file } of reader.getRowObjects()) {
        const match = /^(.*)\/(\d+)\/\d{4}\.parquet$/.exec(String(file));
        if (match) highest.set(match[1]!, Math.max(highest.get(match[1]!) ?? 1, Number(match[2])));
      }
    }
    return highest;
  });
}

/** DuckDB's JSON timestamps (`2020-01-01 06:00:00+00`) as ISO strings. */
function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const time = Date.parse(String(value).replace(" ", "T").replace(/\+00$/, "Z"));
  if (Number.isNaN(time)) throw new Error(`Not a time: ${value}`);
  return new Date(time).toISOString().replace(".000Z", "Z");
}

/**
 * Each station's `first` and `last` from a file with `id`, `first` and
 * `last`, such as a source's bounds; none when the file doesn't exist yet.
 */
export async function readStationBounds(
  path: string,
): Promise<Map<string, Pick<Station, "first" | "last">>> {
  const rows = await read(
    path,
    `SELECT id, strftime(first, '%Y-%m-%dT%H:%M:%SZ') AS first, strftime(last, '%Y-%m-%dT%H:%M:%SZ') AS last`,
    "id",
  );
  return new Map(
    rows.map((r) => [
      String(r.id),
      { first: (r.first as string | null) ?? null, last: (r.last as string | null) ?? null },
    ]),
  );
}

/** A source's bounds, `stations/bounds/<source>.parquet`: `id`, `first` and `last`, sorted by ID. */
export async function writeStationBounds(
  path: string,
  bounds: { id: string; first: string; last: string }[],
): Promise<void> {
  const columns = { id: "VARCHAR", first: "TIMESTAMPTZ", last: "TIMESTAMPTZ" };
  await viaJson(
    path,
    bounds,
    `SELECT id, first, last FROM read_json(?, format = 'newline_delimited', columns = ${struct(columns)}) ORDER BY id`,
    "FORMAT parquet, COMPRESSION zstd",
  );
}

/** The files a glob matches, local or remote; none when its directory doesn't exist. */
export function listFiles(pattern: string): Promise<string[]> {
  return serial(async () => {
    const db = await connection();
    const reader = await db.runAndReadAll(`SELECT file FROM glob(${quote(pattern)})`);
    return reader.getRowObjects().map((r) => String(r.file));
  });
}

/**
 * Each series file's earliest and latest `time` inside its `window`, `[from,
 * until)` in milliseconds, by its path as given; a file with none there has no entry.
 */
export async function readTimeBounds(
  files: { file: string; window: [number, number] }[],
): Promise<Map<string, [number, number]>> {
  if (!files.length) return new Map();
  // Infinity isn't SQL; these are past any time a level has.
  const ms = (t: number) => String(Math.max(-8.64e15, Math.min(8.64e15, t)));
  const windows = files
    .map((f) => `(${quote(f.file)}, ${ms(f.window[0])}, ${ms(f.window[1])})`)
    .join(", ");
  const inside = "epoch_ms(p.time) >= w.lo AND epoch_ms(p.time) < w.hi";
  const rows = await serial(async () => {
    const db = await connection();
    const reader = await db.runAndReadAll(
      `SELECT p.filename, count(w.path) AS asked, epoch_ms(min(p.time) FILTER (WHERE ${inside})) AS first, epoch_ms(max(p.time) FILTER (WHERE ${inside})) AS last FROM read_parquet([${files.map((f) => quote(f.file)).join(", ")}], filename = true) p LEFT JOIN (VALUES ${windows}) w(path, lo, hi) ON p.filename = w.path GROUP BY p.filename`,
    );
    return reader.getRowObjects();
  });
  // read_parquet globs too, so a path with a glob character can read other files.
  const other = rows.find((r) => Number(r.asked) === 0);
  if (other) throw new Error(`read ${String(other.filename)}, which wasn't asked for`);
  return new Map(
    rows
      .filter((r) => r.first !== null)
      .map((r) => [String(r.filename), [Number(r.first), Number(r.last)]]),
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
 * received_ms, type, station, transit, event, epoch, source_flag) and copy the
 * named columns out.
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
    `CREATE TABLE ${table} (time_ms DOUBLE, level_m FLOAT, flag UTINYINT, received_ms DOUBLE, type VARCHAR, station VARCHAR, transit INTEGER, event UTINYINT, epoch INTEGER, source_flag UTINYINT)`,
  );
  return table;
}

async function appendRows<T>(table: string, rows: T[], cells: (row: T) => Cell[]): Promise<void> {
  const db = await connection();
  const appender = await db.createAppender(table);
  for (const row of rows) {
    const [
      time,
      level,
      flag,
      received,
      type,
      station,
      transit,
      event,
      epoch = null,
      sourceFlag = null,
    ] = cells(row);
    appender.appendDouble(time as number);
    appender.appendFloat(level as number);
    appender.appendUTinyInt(flag as number);
    received === null ? appender.appendNull() : appender.appendDouble(received as number);
    type === null ? appender.appendNull() : appender.appendVarchar(type as string);
    station === null ? appender.appendNull() : appender.appendVarchar(station as string);
    transit === null ? appender.appendNull() : appender.appendInteger(transit as number);
    event === null ? appender.appendNull() : appender.appendUTinyInt(event as number);
    epoch === null ? appender.appendNull() : appender.appendInteger(epoch as number);
    sourceFlag === null ? appender.appendNull() : appender.appendUTinyInt(sourceFlag as number);
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
  alias = "",
  where = "",
): Promise<Record<string, unknown>[]> {
  return serial(() => readNow(path, select, order, alias, where));
}

async function readNow(
  path: string,
  select: string,
  order: string,
  alias: string,
  where: string,
): Promise<Record<string, unknown>[]> {
  if (!isRemote(path) && !existsSync(path)) return [];
  const db = await connection();
  if (/^https?:/.test(path)) await db.run("INSTALL httpfs; LOAD httpfs;");
  try {
    const reader = await db.runAndReadAll(
      `${select} FROM read_parquet(${quote(path)}) ${alias} ${where} ORDER BY ${order}`,
    );
    return reader.getRowObjects() as Record<string, unknown>[];
  } catch (error) {
    // A missing remote file is an empty series, not a failure.
    if (isRemote(path) && isMissing(error)) return [];
    throw error;
  }
}

/**
 * Whether a remote read failed because the object doesn't exist. DuckDB's
 * message quotes the object's path, and station IDs such as CO-OPS 1612404
 * hold "404", so only DuckDB's own wording for a 404 counts; any other error
 * fails the read rather than pass for an empty file that a write would replace.
 */
export function isMissing(error: unknown): boolean {
  return /\(HTTP 404 Not Found\)|returned HTTP 404 for|No files found that match/.test(
    String(error),
  );
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
