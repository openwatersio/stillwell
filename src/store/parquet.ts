import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import {
  Flag,
  type Epoch,
  type StoredStation,
  type Observation,
  type PublishedExtreme,
  type Station,
} from "../schema.ts";
import type { EventIndex } from "../types.ts";
import type { OffsetRow } from "../datums.ts";
import { FILES, IN_LIST_EXTRA, columnTypes, type Column, type ParquetFile } from "./files.ts";
// Refuses the store and cache variables under their old names.
import "../cache.ts";

/**
 * Read and write the store's Parquet files through DuckDB, on local disk or on
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
 * How many DuckDB connections run store work at once, 1 by default. Backfill,
 * compaction and `years` raise it to their concurrency, and requalify's
 * workers each to 4, since each year file on R2 is mostly waiting on the network. Each running call holds
 * one of libuv's pool threads; scripts/threadpool.ts gives the pool 64 unless
 * the environment sets its size, so more lanes than that wait for a thread.
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

/**
 * Once every connection this thread has started is open, or has failed. Work
 * that needs no connection, such as listing a directory that isn't there,
 * starts one without waiting for it, and a worker thread ended while DuckDB
 * is still starting aborts the whole process.
 */
export async function connected(): Promise<void> {
  await Promise.all(lanes.map((lane) => lane.db.catch(() => undefined)));
}

function connection(): Promise<DuckDBConnection> {
  const db = current.getStore();
  if (!db) throw new Error("DuckDB work must run through serial()");
  return db;
}

let settings: Record<string, string> = {};

/** DuckDB settings, such as `threads` and `memory_limit`, for the instance this thread starts. */
export function limitDuckDb(options: Record<string, string>): void {
  if (instance) throw new Error("DuckDB already started");
  settings = options;
}

/**
 * A connection to the one in-memory instance. The instance loads httpfs and
 * creates the store's S3 secret once, when it starts: secrets belong to the
 * instance, and connections creating one at the same moment conflict in its
 * catalog, which failed most of a 16-connection compaction's reads.
 */
async function connect(): Promise<DuckDBConnection> {
  instance ??= (async () => {
    const created = await DuckDBInstance.create(":memory:", settings);
    const endpoint = process.env.S3_ENDPOINT;
    if (endpoint) {
      const setup = await created.connect();
      await setup.run("INSTALL httpfs; LOAD httpfs;");
      await setup.run(
        `CREATE SECRET store (TYPE s3, KEY_ID ${quote(process.env.S3_ACCESS_KEY_ID ?? "")}, SECRET ${quote(process.env.S3_SECRET_ACCESS_KEY ?? "")}, ENDPOINT ${quote(endpoint.replace(/^https?:\/\//, ""))}, REGION ${quote(process.env.S3_REGION ?? "auto")}, URL_STYLE 'path'${endpoint.startsWith("http://") ? ", USE_SSL false" : ""})`,
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
export function writeObservations(
  path: string,
  rows: Observation[],
  datum: string,
): Promise<YearStats> {
  return serial(async () => {
    const table = await createTable();
    try {
      await appendObservations(table, rows);
      return await writeObservationTable(path, table, datum);
    } finally {
      await dropTable(table);
    }
  });
}

/** A year file's earliest and latest row, earliest preliminary one, and whether the source screened any, as `readTimeBounds` gives them. */
export type FileBounds = [number, number, number | null, boolean];

/**
 * Fold rows into the year file at `path` without reading all of it into
 * JavaScript: `fold` gets the datums the file holds and its rows from `from`
 * on, as `readObservationFile` reads them, and returns those rows merged, or
 * null to leave the file as it is. The file's earlier rows stay in DuckDB and
 * are written back as they were, so a year file costs JavaScript only the
 * rows a fold can change. Returns the earlier rows' bounds inside `window`,
 * and the written file's stats, null when `fold` left it. A missing file has
 * no rows. Earlier rows that share a time, which a whole read and rewrite
 * would collapse to one, are kept as the file has them. `fold` runs while this
 * holds a DuckDB connection, so it mustn't wait on other store reads or writes.
 */
export function foldObservationFile(
  path: string,
  from: number,
  datum: string,
  window: [number, number] | null,
  fold: (rows: Observation[], datums: string[]) => Promise<Observation[] | null>,
): Promise<{ before: FileBounds | null; stats: YearStats | null }> {
  return serial(async () => {
    const db = await connection();
    let read: string | undefined;
    let write: string | undefined;
    try {
      read = await createTable();
      write = await createTable();
      const glob = /[*?[]/.test(path);
      // As readObservationFile: the empty row names `source_flag` for files
      // written before it was kept, and only this file counts when its path
      // has a glob character, which read_parquet would match against others.
      const source = `(SELECT NULL::VARCHAR AS filename, NULL::TIMESTAMPTZ AS time, NULL::FLOAT AS level_m, NULL::UTINYINT AS flag, NULL::UTINYINT AS source_flag, NULL::TIMESTAMPTZ AS received, NULL::VARCHAR AS datum WHERE false UNION ALL BY NAME SELECT * FROM read_parquet(${quote(path)}, filename = true, union_by_name = true))`;
      // `station` holds each row's datum here, and `type` its file. Levels are
      // rounded as observation() rounds them, so earlier rows are written as a
      // read and rewrite would write them, even from a file that holds doubles:
      // Math.round's half up, a zero keeping its sign, which the version hashes,
      // and a missing level as 0.
      const x = "coalesce(level_m, 0)::DOUBLE * 10000";
      const rounded = `CASE WHEN ${x} - floor(${x}) >= 0.5 THEN ceil(${x}) ELSE floor(${x}) END`;
      try {
        await db.run(
          `INSERT INTO ${read} (time_ms, level_m, flag, received_ms, source_flag, station, type) SELECT epoch_ms(time), CASE WHEN ${rounded} = 0 THEN coalesce(level_m, 0)::DOUBLE * 0 ELSE ${rounded} / 10000 END, flag, epoch_ms(received), source_flag, datum, ${glob ? "filename" : "NULL"} FROM ${source}`,
        );
      } catch (error) {
        // A missing file is an empty series, not a failure.
        if (!isMissing(error)) throw error;
      }
      if (glob) {
        const names = (await db.runAndReadAll(`SELECT DISTINCT type FROM ${read}`))
          .getRowObjects()
          .map((r) => String(r.type));
        const own = names.filter((n) => posix.normalize(n) === posix.normalize(path));
        // With none of its own, every row read is another file's: the file is missing.
        await db.run(
          own.length
            ? `DELETE FROM ${read} WHERE type NOT IN (${own.map(quote).join(", ")})`
            : `DELETE FROM ${read}`,
        );
      }
      const datums = (await db.runAndReadAll(`SELECT DISTINCT station FROM ${read}`))
        .getRowObjects()
        .map((r) => String(r.station));
      const later = (
        await db.runAndReadAll(
          `SELECT time_ms AS time, level_m, flag, source_flag, received_ms AS received FROM ${read} WHERE time_ms >= ${from} ORDER BY time_ms`,
        )
      )
        .getRowObjects()
        .map(observation);
      let before: FileBounds | null = null;
      if (window) {
        const ms = (t: number) => String(Math.max(-8.64e15, Math.min(8.64e15, t)));
        const inside = `time_ms < ${from} AND time_ms >= ${ms(window[0])} AND time_ms < ${ms(window[1])}`;
        const [r] = (
          await db.runAndReadAll(
            `SELECT min(time_ms) FILTER (WHERE ${inside}) AS first, max(time_ms) FILTER (WHERE ${inside}) AS last, min(time_ms) FILTER (WHERE ${inside} AND coalesce(source_flag, flag) = ${Flag.preliminary}) AS preliminary, count(*) FILTER (WHERE ${inside} AND CASE WHEN source_flag IS NULL THEN flag < ${Flag.preliminary} ELSE source_flag != ${Flag.preliminary} END) AS screened FROM ${read}`,
          )
        ).getRowObjects();
        if (r!.first !== null)
          before = [
            Number(r!.first),
            Number(r!.last),
            r!.preliminary === null ? null : Number(r!.preliminary),
            Number(r!.screened) > 0,
          ];
      }
      const merged = await fold(later, datums);
      if (!merged) return { before, stats: null };
      await db.run(
        `INSERT INTO ${write} (time_ms, level_m, flag, received_ms, source_flag) SELECT time_ms, level_m, flag, received_ms, source_flag FROM ${read} WHERE time_ms < ${from}`,
      );
      await appendObservations(write, merged);
      return { before, stats: await writeObservationTable(path, write, datum) };
    } finally {
      await (read ? dropTable(read) : Promise.resolve()).finally(() => write && dropTable(write));
    }
  });
}

function appendObservations(table: string, rows: Observation[]): Promise<void> {
  return appendRows(table, rows, (r) => [
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

/** Write a table of observations to `path` and return its stats. */
async function writeObservationTable(
  path: string,
  table: string,
  datum: string,
): Promise<YearStats> {
  await copyOut(path, table, FILES.obs.columns, datum, "time_ms");
  // The rows as copyOut wrote them, so the hash matches a read of the file.
  const reader = await (
    await connection()
  ).runAndReadAll(
    `SELECT ${YEAR_STATS} FROM (SELECT epoch_ms(time_ms::BIGINT)::TIMESTAMPTZ AS time, level_m, flag, source_flag, epoch_ms(received_ms::BIGINT)::TIMESTAMPTZ AS received FROM ${table})`,
  );
  return yearStats(reader.getRowObjects()[0]!);
}

/**
 * A year file of levels: how many UTC hours hold a value, how many values
 * have each flag, by flag, and `version`, a hash of its rows that changes
 * when any value, flag or `received` does.
 */
export type YearStats = { hours: number; flags: number[]; version: string };

// One expression for a write and a read, so both hash a file's rows alike.
const YEAR_STATS = [
  "count(DISTINCT floor(epoch_ms(time) / 3600000)) AS hours",
  ...[0, 1, 2, 3, 4].map((f) => `count(*) FILTER (WHERE flag = ${f}) AS flag${f}`),
  // The row count goes in too, since two identical rows cancel in bit_xor.
  "md5(concat(printf('%032x', coalesce(bit_xor(md5_number(concat(epoch_ms(time), ',', level_m, ',', flag, ',', source_flag, ',', epoch_ms(received)))), 0::UHUGEINT)), ',', count(*))) AS version",
].join(", ");

/** A year file with no rows, as `YEAR_STATS` gives one. */
export const EMPTY_YEAR: YearStats = {
  hours: 0,
  flags: [0, 0, 0, 0, 0],
  // md5 of the empty bit_xor and a count of 0.
  version: "a6d15f1ab28e5c9dfee9f3bb78c4ab5d",
};

function yearStats(r: Record<string, unknown>): YearStats {
  return {
    hours: Number(r.hours),
    flags: [0, 1, 2, 3, 4].map((f) => Number(r[`flag${f}`])),
    version: String(r.version),
  };
}

/** Each year file's `YearStats`, by its path as given; a file with no rows has none, which `EMPTY_YEAR` stands for. */
export async function readYearStats(files: string[]): Promise<Map<string, YearStats>> {
  // read_parquet globs, so a path with a glob character is read alone, where
  // grouping by file keeps out the others it matches; in a batch it could
  // read a file twice.
  const glob = (f: string) => /[*?[]/.test(f);
  const stats = new Map<string, YearStats>();
  for (const batch of [files.filter((f) => !glob(f)), ...files.filter(glob).map((f) => [f])]) {
    if (!batch.length) continue;
    const rows = await serial(async () => {
      const db = await connection();
      const reader = await db.runAndReadAll(
        // The empty row names every column, so a file written before `source_flag` reads it as null.
        `SELECT filename, ${YEAR_STATS} FROM (SELECT NULL::VARCHAR AS filename, NULL::TIMESTAMPTZ AS time, NULL::FLOAT AS level_m, NULL::UTINYINT AS flag, NULL::UTINYINT AS source_flag, NULL::TIMESTAMPTZ AS received WHERE false UNION ALL BY NAME SELECT * FROM read_parquet([${batch.map(quote).join(", ")}], filename = true, union_by_name = true)) GROUP BY filename`,
      );
      return reader.getRowObjects();
    });
    for (const r of rows) {
      const file = String(r.filename);
      if (batch.includes(file)) stats.set(file, yearStats(r));
      // Alone, a glob character matches other files; in a batch, a name that wasn't asked for is a path read wrong.
      else if (batch.length > 1 || !glob(batch[0]!))
        throw new Error(`read ${file}, which wasn't asked for`);
    }
  }
  return stats;
}

export async function readObservations(path: string): Promise<Observation[]> {
  return (await readObservationFile(path)).rows;
}

/** A series file's observations and the datums it holds, in one read. */
export async function readObservationFile(
  path: string,
): Promise<{ rows: Observation[]; datums: string[] }> {
  // Every column, since a file written before `source_flag` was kept has none.
  // read_parquet globs, so a station ID with a glob character reads only its own file.
  const glob = /[*?[]/.test(path);
  const rows = (await read(path, OBSERVATION_COLUMNS, "time", "", "", glob)).filter(
    (r) => !glob || posix.normalize(String(r.filename)) === posix.normalize(path),
  );
  for (const r of rows) delete r.filename;
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
  // Only BSH gives `transit` and `event`; other sources' files have observed extremes' columns.
  const transit = rows.some((r) => "transit" in r);
  await copyRows(
    path,
    rows,
    FILES[transit ? "predicted-extremes" : "extremes"].columns,
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
  return (await readExtremeFile(path)).rows;
}

/** A series file's extremes and the datums it holds, in one read. */
export async function readExtremeFile(
  path: string,
): Promise<{ rows: PublishedExtreme[]; datums: string[] }> {
  const rows = await read(path, "SELECT epoch_ms(time) AS time, * EXCLUDE (time)");
  const datums = [...new Set(rows.map((r) => String(r.datum)))];
  const extremes = rows.map((r) => {
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
  return { rows: extremes, datums };
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
    await serial(() => copyOut(path, table, FILES.recent.columns, undefined, "station, time_ms"));
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

/**
 * Rows `writeObservations` wrote, as a read of the file returns them: the
 * level through its FLOAT column, times as whole milliseconds.
 */
export function asWritten(rows: Observation[]): Observation[] {
  return rows.map((r) =>
    observation({
      time: Math.round(r.time),
      level_m: Math.fround(r.level),
      flag: r.flag,
      source_flag: r.source_flag ?? null,
      received: r.received === undefined ? null : Math.round(r.received),
    }),
  );
}

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

/** `stations.parquet`: one row per series, sorted by ID, with its datum epochs. */
export function writeStations(path: string, stations: StoredStation[]): Promise<void> {
  return writeTable(path, stations, FILES.stations);
}

/** `stations/offsets.parquet`: meters to add to a level in each station's epoch to refer it to each datum. */
export function writeOffsets(path: string, rows: OffsetRow[]): Promise<void> {
  return writeTable(path, rows, FILES.offsets);
}

const STATION_FIELDS = new Set(FILES.stations.columns.map((c) => c.name));

/**
 * A source's list, `stations/<source>.parquet`: the shared columns except
 * `first` and `last`, its epochs, and the source's own fields as JSON in `extra`.
 */
export async function writeStationList(path: string, stations: StoredStation[]): Promise<void> {
  const rows = stations.map((s) => {
    const extra = Object.fromEntries(
      Object.entries(s).filter(([key]) => !STATION_FIELDS.has(key) || IN_LIST_EXTRA.includes(key)),
    );
    return { ...s, extra: JSON.stringify(extra) };
  });
  await writeTable(path, rows, FILES.lists);
}

/** A source's list, or null when the store has none. */
export async function readStationList(path: string): Promise<StoredStation[] | null> {
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
    } as StoredStation;
  });
}

/** The distinct station IDs in list files, such as a source's list and its snapshots. */
export async function listedIds(files: string[]): Promise<string[]> {
  if (!files.length) return [];
  return serial(async () => {
    const db = await connection();
    if (files.some((f) => /^https?:/.test(f))) await db.run("INSTALL httpfs; LOAD httpfs;");
    const reader = await db.runAndReadAll(
      `SELECT DISTINCT id FROM read_parquet([${files.map(quote).join(", ")}], union_by_name = true) ORDER BY id`,
    );
    return reader.getRowObjects().map((r) => String(r.id));
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
 * `last`, such as a source's bounds, and its earliest `preliminary` value;
 * none when the file doesn't exist yet. `preliminary` is undefined in a file
 * without the column, such as one an older build wrote, so it isn't taken
 * for known to have none.
 */
export async function readStationBounds(path: string): Promise<Map<string, StationBounds>> {
  const rows = await read(
    path,
    // `screened` and `preliminary` are missing from files written before them.
    `SELECT COLUMNS(lambda c: c IN ('id', 'screened')), strftime(COLUMNS(lambda c: c IN ('first', 'last', 'preliminary')), '%Y-%m-%dT%H:%M:%SZ')`,
    "id",
  );
  return new Map(
    rows.map((r) => [
      String(r.id),
      {
        first: (r.first as string | null) ?? null,
        last: (r.last as string | null) ?? null,
        preliminary: "preliminary" in r ? ((r.preliminary as string | null) ?? null) : undefined,
        screened: (r.screened as boolean | null | undefined) ?? null,
      },
    ]),
  );
}

/**
 * A station's row in its source's bounds: its first and last level, and the
 * earliest value in its current epoch the source sent as preliminary, which
 * the monthly refetch fetches again from (`backfill … preliminary`).
 */
export type StationBounds = Pick<Station, "first" | "last"> & {
  preliminary?: string | null;
  /** Whether the current epoch holds a value the source screened; null when not yet known. */
  screened?: boolean | null;
};

/**
 * A source's bounds, `stations/bounds/<source>.parquet`: `id`, `first`, `last`
 * `screened` and, unless `preliminary` is false, `preliminary`, sorted by ID.
 */
export async function writeStationBounds(
  path: string,
  bounds: ({ id: string } & Partial<StationBounds>)[],
  preliminary = true,
): Promise<void> {
  const columns: Record<string, string> = {
    id: "VARCHAR",
    first: "TIMESTAMPTZ",
    last: "TIMESTAMPTZ",
  };
  if (preliminary) columns.preliminary = "TIMESTAMPTZ";
  columns.screened = "BOOLEAN";
  await viaJson(
    path,
    bounds,
    `SELECT ${Object.keys(columns).join(", ")} FROM read_json(?, format = 'newline_delimited', columns = ${struct(columns)}) ORDER BY id`,
    "FORMAT parquet, COMPRESSION zstd",
  );
}

/** Every row of a Parquet file, by column name; none when there's no file. */
export function readRows(path: string): Promise<Record<string, unknown>[]> {
  return read(path, "SELECT *", "ALL");
}

/**
 * Rows as Parquet with the given columns and types, sorted by `order`, in row
 * groups a filter on its first column can skip: a reader after one station
 * fetches the footer and one group. 2,048 rows is DuckDB's smallest group (its
 * vector size); a smaller ROW_GROUP_SIZE still writes 2,048.
 */
export async function writeRows(
  path: string,
  rows: object[],
  columns: Record<string, string>,
  order: string,
): Promise<void> {
  await viaJson(
    path,
    rows,
    `SELECT ${Object.keys(columns).join(", ")} FROM read_json(?, format = 'newline_delimited', columns = ${struct(columns)}) ORDER BY ${order}`,
    "FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 2048",
  );
}

/** Rows as one of the published files in `FILES`, with its columns, types and sort. */
export function writeTable(path: string, rows: object[], file: ParquetFile): Promise<void> {
  return writeRows(path, rows, columnTypes(file), file.sort.join(", "));
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
 * until)` in milliseconds, the earliest there the source sent as
 * preliminary (null when none), and whether any there the source screened,
 * by its path as given; a file with none there has no entry.
 */
export async function readTimeBounds(
  files: { file: string; window: [number, number] }[],
): Promise<Map<string, [number, number, number | null, boolean]>> {
  if (!files.length) return new Map();
  // Infinity isn't SQL; these are past any time a level has.
  const ms = (t: number) => String(Math.max(-8.64e15, Math.min(8.64e15, t)));
  const windows = files
    .map((f) => `(${quote(f.file)}, ${ms(f.window[0])}, ${ms(f.window[1])})`)
    .join(", ");
  const inside = "epoch_ms(p.time) >= w.lo AND epoch_ms(p.time) < w.hi";
  const preliminary = `${inside} AND coalesce(p.source_flag, p.flag) = ${Flag.preliminary}`;
  // Without `source_flag`, a suspect or bad flag may be QC's alone, so only a
  // good or interpolated one says the source screened it.
  const screened = `${inside} AND CASE WHEN p.source_flag IS NULL THEN p.flag < ${Flag.preliminary} ELSE p.source_flag != ${Flag.preliminary} END`;
  const rows = await serial(async () => {
    const db = await connection();
    const reader = await db.runAndReadAll(
      // The empty row names `source_flag`, so files written before it existed read it as null.
      `SELECT p.filename, count(w.path) AS asked, epoch_ms(min(p.time) FILTER (WHERE ${inside})) AS first, epoch_ms(max(p.time) FILTER (WHERE ${inside})) AS last, epoch_ms(min(p.time) FILTER (WHERE ${preliminary})) AS preliminary, count(*) FILTER (WHERE ${screened}) AS screened FROM (SELECT NULL::VARCHAR AS filename, NULL::TIMESTAMPTZ AS time, NULL::UTINYINT AS flag, NULL::UTINYINT AS source_flag WHERE false UNION ALL BY NAME SELECT * FROM read_parquet([${files.map((f) => quote(f.file)).join(", ")}], filename = true, union_by_name = true)) p LEFT JOIN (VALUES ${windows}) w(path, lo, hi) ON p.filename = w.path GROUP BY p.filename`,
    );
    return reader.getRowObjects();
  });
  // read_parquet globs too, so a path with a glob character can read other files.
  const other = rows.find((r) => Number(r.asked) === 0);
  if (other) throw new Error(`read ${String(other.filename)}, which wasn't asked for`);
  return new Map(
    rows
      .filter((r) => r.first !== null)
      .map((r) => [
        String(r.filename),
        [
          Number(r.first),
          Number(r.last),
          r.preliminary === null ? null : Number(r.preliminary),
          Number(r.screened) > 0,
        ],
      ]),
  );
}

/** A JSON array `writeJsonArray` wrote, or null where there's none. */
export async function readJsonArray(path: string): Promise<unknown[] | null> {
  if (!isRemote(path) && !existsSync(path)) return null;
  return serial(async () => {
    const db = await connection();
    try {
      const reader = await db.runAndReadAll(
        `SELECT to_json(t)::VARCHAR AS row FROM read_json(${quote(path)}, format = 'array') t`,
      );
      return reader.getRowObjects().map((r) => JSON.parse(String(r.row)) as unknown);
    } catch (error) {
      if (isRemote(path) && isMissing(error)) return null;
      throw error;
    }
  });
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

/**
 * A JSON value as `JSON.stringify` writes it, through DuckDB as the rest go:
 * one line, which a CSV with no quoting or header copies as it is. JSON
 * escapes the control character used as the delimiter, so it can't occur.
 */
export function writeJson(path: string, value: unknown): Promise<void> {
  return serial(async () => {
    const db = await connection();
    await prepare(path);
    const dir = await mkdtemp(join(tmpdir(), "stillwell-"));
    try {
      const file = join(dir, "value.json");
      await writeFile(file, JSON.stringify(value, null, 0));
      await db.run(
        `COPY (SELECT content FROM read_text(${quote(file)})) TO ${quote(path)} (FORMAT csv, HEADER false, QUOTE '', ESCAPE '', DELIMITER '\x1f')`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

/**
 * What in the Parquet file at `path` differs from `file`'s definition: a
 * column missing, unexpected, out of order or of another type, nulls in a
 * column (or a list's struct field) that has none, or rows out of order. None
 * when it matches. Types are compared as DuckDB spells them back.
 */
export async function checkFile(path: string, file: ParquetFile): Promise<string[]> {
  // read_parquet globs a local or S3 path, which would check other files; HTTP doesn't.
  if (/[*?[]/.test(path) && !/^https?:/.test(path))
    throw new Error(`can't check ${path}, which has a glob character`);
  return serial(async () => {
    const db = await connection();
    if (/^https?:/.test(path)) await db.run("INSTALL httpfs; LOAD httpfs;");
    const describe = async (select: string) =>
      new Map(
        (await db.runAndReadAll(`DESCRIBE ${select}`))
          .getRowObjects()
          .map((r) => [String(r.column_name), String(r.column_type)]),
      );
    const source = `read_parquet(${quote(path)}, file_row_number = true)`;
    const actual = await describe(`SELECT * EXCLUDE (file_row_number) FROM ${source}`);
    const declared = await describe(
      `SELECT ${file.columns.map((c) => `NULL::${c.type} AS "${c.name}"`).join(", ")}`,
    );
    const columns = file.columns.filter((c) => actual.has(c.name) || !c.optional);
    const problems: string[] = [];
    for (const c of columns) {
      if (!actual.has(c.name)) problems.push(`no column ${c.name}`);
      else if (actual.get(c.name) !== declared.get(c.name))
        problems.push(`${c.name} is ${actual.get(c.name)}, not ${declared.get(c.name)}`);
    }
    const unexpected = [...actual.keys()].filter((n) => !declared.has(n));
    if (unexpected.length) problems.push(`unexpected columns ${unexpected.join(", ")}`);
    const order = [...actual.keys()].filter((n) => declared.has(n));
    const expected = columns.map((c) => c.name).filter((n) => actual.has(n));
    if (order.join() !== expected.join())
      problems.push(`columns in the order ${order.join(", ")}, not ${expected.join(", ")}`);
    if (problems.length) return problems;

    const counts = [
      ...columns
        .filter((c) => !c.nullable)
        .map((c) => [c.name, `count(*) FILTER (WHERE "${c.name}" IS NULL)`]),
      ...columns
        .filter((c) => !c.nullable)
        .flatMap((c) =>
          (c.fields ?? [])
            .filter((f) => !f.nullable)
            .map((f) => [
              `${c.name}.${f.name}`,
              `(SELECT count(*) FILTER (WHERE e."${f.name}" IS NULL) FROM (SELECT unnest("${c.name}") AS e FROM ${source}))`,
            ]),
        ),
      [
        "sort",
        `(SELECT count(*) FROM (SELECT file_row_number, row_number() OVER (ORDER BY ${file.sort.join(", ")}, file_row_number) - 1 AS sorted FROM ${source}) WHERE file_row_number != sorted)`,
      ],
    ];
    const [row] = (
      await db.runAndReadAll(
        `SELECT ${counts.map(([name, sql]) => `${sql} AS "${name}"`).join(", ")} FROM ${source}`,
      )
    ).getRowObjects();
    for (const [name] of counts) {
      const n = Number(row![name!]);
      if (n) problems.push(name === "sort" ? `${n} rows out of order` : `${n} nulls in ${name}`);
    }
    return problems;
  });
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
  columns: Column[],
  datum: string | undefined,
  cells: (row: T) => Cell[],
  order = "time_ms",
): Promise<void> {
  return serial(() => copyRowsNow(path, rows, columns, datum, cells, order));
}

async function copyRowsNow<T>(
  path: string,
  rows: T[],
  columns: Column[],
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

/** Copy a scratch table to `path` as `columns`, each cast to its type. */
async function copyOut(
  path: string,
  table: string,
  columns: Column[],
  datum: string | undefined,
  order: string,
): Promise<void> {
  const db = await connection();
  await prepare(path);
  const select = columns
    .map(({ name, type }) => {
      const value =
        name === "time" || name === "received"
          ? `epoch_ms(${name}_ms::BIGINT)`
          : name === "datum"
            ? quote(datum!)
            : name;
      return `CAST(${value} AS ${type}) AS ${name}`;
    })
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
  const dir = await mkdtemp(join(tmpdir(), "stillwell-"));
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
  filename = false,
): Promise<Record<string, unknown>[]> {
  return serial(() => readNow(path, select, order, alias, where, filename));
}

async function readNow(
  path: string,
  select: string,
  order: string,
  alias: string,
  where: string,
  filename: boolean,
): Promise<Record<string, unknown>[]> {
  if (!isRemote(path) && !existsSync(path)) return [];
  const db = await connection();
  if (/^https?:/.test(path)) await db.run("INSTALL httpfs; LOAD httpfs;");
  try {
    const reader = await db.runAndReadAll(
      `${select} FROM read_parquet(${quote(path)}${filename ? ", filename = true, union_by_name = true" : ""}) ${alias} ${where} ORDER BY ${order}`,
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
