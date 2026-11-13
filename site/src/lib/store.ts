// Build-time reads of the store, through DuckDB in Node. Pages render from these once per build.
import { DuckDBInstance } from "@duckdb/node-api";
import { url } from "./paths";

const connection = await (await DuckDBInstance.create(":memory:")).connect();
await connection.run("SET TimeZone = 'UTC'");

type Row = Record<string, any>;

/** Rows as JavaScript values: Dates for times, BigInts for 64-bit integers. */
export async function rows(sql: string): Promise<Row[]> {
  return (await connection.runAndReadAll(sql)).getRowObjectsJS() as Row[];
}

/**
 * A query's result as DuckDB itself prints each value, for showing it beside its SQL. Statements before
 * the last one (SET, SET VARIABLE) run first, as they would in the CLI.
 */
export async function table(
  sql: string,
  limit = 50,
): Promise<{ columns: string[]; types: string[]; rows: string[][] }> {
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean);
  const last = statements.pop()!;
  for (const s of statements) await connection.run(s);
  const typed = await connection.runAndReadAll(`SELECT * FROM (${last}) LIMIT 0`);
  const reader = await connection.runAndReadAll(
    `SELECT COLUMNS(*)::VARCHAR FROM (${last}) LIMIT ${limit}`,
  );
  return {
    columns: reader.columnNames(),
    types: typed.columnTypes().map(String),
    rows: (reader.getRows() as (string | null)[][]).map((r) => r.map((v) => v ?? "NULL")),
  };
}

let stationsCache: Promise<Row[]> | undefined;

/** Every station, with nested fields as plain objects. Loaded once per build. */
export function stations(): Promise<Row[]> {
  stationsCache ??= rows(`
    SELECT * EXCLUDE (datums, datums_source, datums_epoch, datums_attribution, epochs, same_as, errata, products),
      to_json(datums)::VARCHAR AS datums, to_json(datums_source)::VARCHAR AS datums_source,
      to_json(datums_epoch)::VARCHAR AS datums_epoch, to_json(datums_attribution)::VARCHAR AS datums_attribution,
      to_json(epochs)::VARCHAR AS epochs, to_json(same_as)::VARCHAR AS same_as, to_json(errata)::VARCHAR AS errata,
      to_json(products)::VARCHAR AS products
    FROM '${url("stations.parquet")}'`).then((all) =>
    all.map((s) => {
      for (const k of ["datums", "datums_source", "datums_epoch"])
        s[k] = JSON.parse(s[k] ?? "null") ?? {};
      for (const k of ["datums_attribution", "epochs", "same_as", "errata", "products"])
        s[k] = JSON.parse(s[k] ?? "null") ?? [];
      // to_json writes times as "2005-01-01 00:00:00+00", which not every browser parses; pages get ISO 8601.
      for (const e of s.epochs)
        for (const k of ["since", "until", "seen", "reference_since"])
          if (e[k]) e[k] = new Date(e[k]).toISOString();
      return s;
    }),
  );
  return stationsCache;
}

/** A station's current datum epoch: its open one, else its latest that wasn't held or rejected. */
export function currentEpoch(station: Row): number {
  const epochs: Row[] = station.epochs ?? [];
  return (
    epochs.find((e) => e.state === "open")?.id ??
    Math.max(
      1,
      ...epochs.filter((e) => e.state !== "held" && e.state !== "rejected").map((e) => e.id),
    )
  );
}

// References an offset can be carried through between two stations of a gauge, from the store's own
// sharedReference in src/datums.ts: national height systems and Admiralty Chart Datum. Gauge zeros and tidal
// datums don't count, even under the same name, since two stations' can differ.
// shortcut: matches datum keys exactly, without the store's aliases, GESLA zeros or links.parquet's offsets; read
// links.parquet if a linked station's predictions go missing.
const REFERENCES = ["NAP", "NHN", "NN", "HN", "NGVD29", "RH2000", "AOD", "ACD"];
const isReference = (key: string) => REFERENCES.includes(key) || /^NAVD88\(.+\)$/.test(key);

/** Meters to add to a level in `from`'s datum to refer it to `to`'s, through a reference both have; undefined without one. */
export function shiftBetween(from: Row, to: Row): number | undefined {
  if (from.id === to.id) return 0;
  const [a, b] = [
    { ...from.datums, [from.datum]: 0 },
    { ...to.datums, [to.datum]: 0 },
  ];
  const keys = [...REFERENCES, ...Object.keys(a).filter((k) => k.startsWith("NAVD88("))];
  const shared = keys.find((k) => isReference(k) && a[k] !== undefined && b[k] !== undefined);
  return shared === undefined ? undefined : a[shared] - b[shared];
}

let byIdCache: Promise<Map<string, Row>> | undefined;

/** Every station by its id, built once per build rather than once per page. */
export function stationsById(): Promise<Map<string, Row>> {
  byIdCache ??= stations().then((all) => new Map(all.map((s) => [s.id, s])));
  return byIdCache;
}

const yearsCache = new Map<string, Promise<Map<string, Row[]>>>();

/** A source's years list, by station id; empty for a source with no levels written yet, which has no file. */
export function years(source: string): Promise<Map<string, Row[]>> {
  if (!yearsCache.has(source))
    yearsCache.set(
      source,
      rows(`
        SELECT id, epoch, year, hours, good, interpolated, preliminary, suspect, bad
        FROM '${url(`stations/years/${source}.parquet`)}' WHERE year IS NOT NULL ORDER BY id, epoch, year`).then(
        (all) => {
          const byId = new Map<string, Row[]>();
          for (const r of all) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
          return byId;
        },
        (error) => {
          if (/\b404\b/.test(String(error))) return new Map();
          throw error;
        },
      ),
    );
  return yearsCache.get(source)!;
}

const jsonCache = new Map<string, Promise<any>>();

/** A JSON file in the store, such as sources.json, errata.json or datapackage.json. */
export function json(path: string): Promise<any> {
  if (!jsonCache.has(path))
    jsonCache.set(
      path,
      fetch(url(path)).then((r) => {
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.json();
      }),
    );
  return jsonCache.get(path)!;
}
