import { Flag } from "../schema.ts";
import type { Catalog, CatalogStation } from "./catalog.ts";
import {
  conversionFor,
  convertibleEpochs,
  levelsResponse,
  maxAge,
  parseLevels,
  type ParamError,
  type StoredLevel,
  TooManyValues,
  usableFor,
} from "./levels.ts";

export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const LEVELS = /^\/water-levels\/stations\/([^/]+)\/([^/]+)\/levels$/;

/** An epoch's span in ms, either end null when open. */
export interface EpochSpan {
  id: number;
  since: number | null;
  until: number | null;
}

/** Where `levels` reads its values: D1 and the year files (workers/api/store.ts). */
export interface LevelsData {
  /**
   * The station's values from `from` to `to`, inclusive. With `sampling`, it
   * may leave out any value that `stepSampler` wouldn't keep.
   */
  readLevels(
    station: CatalogStation,
    from: number,
    to: number,
    sampling?: { step: number; usable: (v: StoredLevel) => boolean },
  ): Promise<StoredLevel[]>;
  /**
   * The time of the station's newest value that isn't bad and that the
   * response could show: in one of `epochs`, within its span. A value in an
   * epoch opened since the list was published, or one that doesn't convert,
   * isn't shown, so it isn't counted either.
   */
  newest(station: string, epochs: EpochSpan[]): Promise<number | null>;
  /** When the last pass that ended cleanly and asked for the station's interval group finished, or null. */
  lastPass(source: string, group: number): Promise<number | null>;
}

/** The `levels` route over the catalog of public stations and `data`, and `/health`. */
export function apiHandler(
  deps: { data: LevelsData } & {
    catalog: () => Catalog | null;
    now?: () => number;
  },
): (method: string, url: string) => Promise<ApiResponse> {
  const now = deps.now ?? Date.now;
  const data = deps.data;
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

    if (!station.levels) return json(404, { message: `${id} has no observed levels` });

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
        data.readLevels(
          station,
          query.start - half,
          query.end + half,
          query.step
            ? { step: query.step, usable: usableFor(station, conversion, query.includeBad) }
            : undefined,
        ),
        data.newest(id, convertibleEpochs(station, conversion)),
        data.lastPass(station.source, station.min_interval_s ?? 0),
      ]);
    } catch (error) {
      if (error instanceof TooManyValues)
        return invalid([{ path: "end", message: `${id}: ${error.message}` }]);
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
