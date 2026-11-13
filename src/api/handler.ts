import type { ClickHouse } from "../realtime/clickhouse.ts";
import { Flag } from "../schema.ts";
import type { Catalog } from "./catalog.ts";
import {
  conversionFor,
  levelsResponse,
  maxAge,
  parseLevels,
  type ParamError,
  type StoredLevel,
} from "./levels.ts";

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const LEVELS = /^\/water-levels\/stations\/([^/]+)\/([^/]+)\/levels$/;

/**
 * stillwell-api's routes over ClickHouse's `stillwell` database and the
 * catalog of public stations: `levels`, and `/health`.
 */
export function apiHandler(deps: {
  ch: ClickHouse;
  catalog: () => Catalog | null;
  now?: () => number;
}): (method: string, url: string) => Promise<ApiResponse> {
  const now = deps.now ?? Date.now;
  return async (method, url) => {
    if (method !== "GET" && method !== "HEAD") return json(405, { message: "Only GET is served" });
    const { pathname, searchParams } = new URL(url, "http://localhost");
    const catalog = deps.catalog();
    if (pathname === "/health")
      return json(catalog ? 200 : 503, {
        status: catalog ? "ok" : "loading",
        stations: catalog?.size ?? 0,
      });

    const match = LEVELS.exec(pathname);
    if (!match) return json(404, { message: "Not found" });
    if (!catalog) return json(503, { message: "The station list is still loading" });
    let id: string;
    try {
      id = `${decodeURIComponent(match[1]!)}/${decodeURIComponent(match[2]!)}`;
    } catch {
      return json(404, { message: "Unknown station" });
    }
    const station = catalog.get(id);
    if (!station) return json(404, { message: `Unknown station ${id}` });
    if (!station.commercial_use)
      return json(451, {
        message: `${id}'s terms bar commercial use, and the open API serves only stations whose terms allow it`,
      });

    const at = now();
    const parsed = parseLevels(searchParams, at);
    if ("errors" in parsed) return invalid(parsed.errors);
    const { query } = parsed;
    const conversion = conversionFor(station, query.datum);
    if ("path" in conversion) return invalid([conversion]);

    const half = query.step / 2;
    let values: StoredLevel[];
    let asOf: number | null;
    let updated: number | null;
    try {
      [values, asOf, updated] = await Promise.all([
        readLevels(deps.ch, id, query.start - half, query.end + half),
        newest(deps.ch, id, [...station.epochs.keys()]),
        lastPass(deps.ch, station.source, station.min_interval_s ?? 0),
      ]);
    } catch (error) {
      console.error(`levels ${id}: ${(error as Error).message}`);
      return json(503, { message: "Levels are unavailable; try again shortly" });
    }
    const body = levelsResponse({ station, conversion, query, values, asOf, updated, now: at });
    return json(200, body, maxAge(station, query.end, at));
  };
}

function invalid(errors: ParamError[]): ApiResponse {
  return json(400, { message: errors[0]!.message, errors });
}

function json(status: number, body: object, age?: number): ApiResponse {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": age === undefined ? "no-store" : `public, max-age=${age}`,
    },
    body: JSON.stringify(body),
  };
}

interface Row {
  epoch: number;
  time_ms: string;
  level: number;
  flag: number;
  received_ms: string | null;
}

/** A station's values from `from` to `to`, inclusive. */
async function readLevels(
  ch: ClickHouse,
  station: string,
  from: number,
  to: number,
): Promise<StoredLevel[]> {
  const rows = await ch.query<Row>(
    `SELECT epoch, toUnixTimestamp64Milli(time) AS time_ms, level, flag,
       toUnixTimestamp64Milli(received) AS received_ms
     FROM observations FINAL
     WHERE station = {station:String}
       AND time >= fromUnixTimestamp64Milli({from:Int64}) AND time <= fromUnixTimestamp64Milli({to:Int64})
     ORDER BY time
     SETTINGS do_not_merge_across_partitions_select_final = 1`,
    { station, from: Math.floor(from), to: Math.ceil(to) },
  );
  return rows.map((r) => ({
    epoch: Number(r.epoch),
    time: Number(r.time_ms),
    level: r.level,
    flag: r.flag,
    received: r.received_ms === null ? null : Number(r.received_ms),
  }));
}

/**
 * The time of the station's newest value that isn't bad, or null, in the
 * epochs the station list knows: a value in an epoch opened since the list
 * was published can't be converted yet, so it isn't shown or counted.
 */
async function newest(ch: ClickHouse, station: string, epochs: number[]): Promise<number | null> {
  const [row] = await ch.query<{ t: string | null }>(
    `SELECT toUnixTimestamp64Milli(maxOrNull(time)) AS t
     FROM observations FINAL
     WHERE station = {station:String} AND flag != {bad:UInt8} AND epoch IN {epochs:Array(UInt16)}
     SETTINGS do_not_merge_across_partitions_select_final = 1`,
    { station, bad: Flag.bad, epochs },
  );
  return row?.t == null ? null : Number(row.t);
}

/** When the last pass that ended cleanly and asked for the station's interval group finished, or null. */
async function lastPass(ch: ClickHouse, source: string, group: number): Promise<number | null> {
  const [row] = await ch.query<{ t: string | null }>(
    `SELECT toUnixTimestamp64Milli(maxOrNull(finished)) AS t
     FROM polls
     WHERE source = {source:String} AND ok AND (empty(intervals) OR has(intervals, {group:UInt32}))`,
    { source, group },
  );
  return row?.t == null ? null : Number(row.t);
}
