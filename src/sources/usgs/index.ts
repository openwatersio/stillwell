import { getJson, type RequestOptions } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type Kind,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
  type Station,
} from "../../schema.ts";
import { TIDAL_SITES } from "./tidal-sites.ts";

/**
 * USGS water data through the OGC API (api.waterdata.usgs.gov/ogcapi/v1), which
 * replaces the legacy waterservices retired on 2027-02-22.
 *
 * Each station is one instantaneous series: gage height (00065) in the gage's
 * own datum where the site has it, else a water-surface elevation in NAVD88 or
 * NGVD29. `datums` gives the gage datum's altitude from `monitoring-locations`.
 */
const API = "https://api.waterdata.usgs.gov/ogcapi/v1";

export const metadata: SourceMetadata = {
  id: "usgs",
  name: "U.S. Geological Survey Water Data",
  url: "https://waterdata.usgs.gov/",
  license: {
    id: "US-Government-Works",
    name: "U.S. Government work, public domain",
    url: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    commercial_use: true,
  },
  attribution: "U.S. Geological Survey",
  terms: "Provisional data are subject to revision until USGS approves them.",
};

/** The gage's own zero, which gage height (00065) is measured from. */
export const GAGE = "GAGE";

/**
 * Water-level parameters, most preferred first, with the datum each is in. A
 * site's station is its series of the first one it has. An array, since an
 * object would put the integer-like codes ahead of 00065.
 */
const PARAMETERS: [code: string, datum: string][] = [
  ["00065", GAGE], // gage height
  ["72279", "NAVD88"], // tidal elevation, NOS-averaged
  ["62620", "NAVD88"], // estuary or ocean water surface elevation
  ["63160", "NAVD88"], // stream water level elevation
  ["62619", "NGVD29"], // estuary or ocean water surface elevation
  ["63158", "NGVD29"], // stream water level elevation
];
const DATUM_OF = new Map(PARAMETERS);

/** Parameters only measured where the water is tidal. */
const TIDAL_PARAMETERS = new Set(["72279", "62620", "62619"]);

/** Vertical datums `monitoring-locations` gives a gage's altitude in, as kept in `datums`. */
const VERTICAL_DATUMS: Record<string, string> = {
  NAVD88: "NAVD88",
  NGVD29: "NGVD29",
  IGLD: "IGLD",
  IGLD85: "IGLD",
  PRVD02: "PRVD02",
  LMSL: "LMSL",
};

/**
 * HUC regions of the Mississippi and Ohio basins whose river stage crowd-depth
 * reduces soundings with: the Ohio (05), Tennessee (06), Upper (07) and Lower
 * (08) Mississippi.
 */
const RIVER_REGIONS = new Set(["05", "06", "07", "08"]);

const FEET = 0.3048;
const DAY_MS = 86_400_000;

interface ApiSeries {
  id: string;
  monitoring_location_id: string;
  parameter_code: string;
  statistic_id: string | null;
  begin: string | null;
  end: string | null;
  sublocation_identifier: string | null;
  primary: string | null;
  unit_of_measure: string;
}

interface ApiLocation {
  id: string;
  monitoring_location_name: string;
  agency_code: string;
  site_type_code: string | null;
  state_name: string | null;
  country_code: string | null;
  hydrologic_unit_code: string | null;
  altitude: number | null;
  vertical_datum: string | null;
}

interface Collection<T> {
  features: { id?: string; properties: T; geometry: { coordinates: number[] } | null }[];
  links?: { rel: string; href: string }[];
}

/**
 * A USGS station as listed, with the series its levels come from. They're kept
 * in the committed list only; `stations.parquet` doesn't carry them.
 */
export type UsgsStation = ListedStation & { time_series_id: string; parameter_code: string };

/**
 * Tidal and estuary sites, low-lying streams and river stage in the Mississippi
 * and Ohio basins, each with its preferred water-level series.
 */
export async function stations(): Promise<UsgsStation[]> {
  const series: ApiSeries[] = [];
  for (const [parameter] of PARAMETERS) {
    const params = new URLSearchParams({
      parameter_code: parameter,
      computation_period_identifier: "Points",
      properties:
        "id,monitoring_location_id,parameter_code,statistic_id,begin,end,sublocation_identifier,primary,unit_of_measure",
    });
    const listed = await items<ApiSeries>("time-series-metadata", params, { fresh: true });
    // Every parameter has series somewhere; an empty answer is a broken one.
    if (!listed.length) throw new Error(`USGS listed no ${parameter} series`);
    series.push(...listed);
  }
  // Daily tidal highs and lows (statistic 00021) are computed only at tidal
  // sites, and so are the tidal-only parameters, whichever series a site uses.
  const tidal = new Set(
    (
      await items<{ monitoring_location_id: string }>(
        "time-series-metadata",
        new URLSearchParams({ statistic_id: "00021", properties: "monitoring_location_id" }),
        { fresh: true },
      )
    ).map((s) => s.monitoring_location_id),
  );
  // Without it, every site typed as a plain stream would drop out.
  if (!tidal.size) throw new Error("USGS listed no daily tidal statistics");
  for (const s of series)
    if (TIDAL_PARAMETERS.has(s.parameter_code)) tidal.add(s.monitoring_location_id);
  const chosen = choose(series);

  const locations = new Map<string, Collection<ApiLocation>["features"][number]>();
  const fetchLocations = async (ids: string[]) => {
    for (let i = 0; i < ids.length; i += LOCATION_BATCH) {
      const batch = ids.slice(i, i + LOCATION_BATCH);
      const params = new URLSearchParams({
        properties:
          "id,monitoring_location_name,agency_code,site_type_code,state_name,country_code,hydrologic_unit_code,altitude,vertical_datum",
        filter: `id IN (${batch.map((id) => `'${id}'`).join(",")})`,
        "filter-lang": "cql-text",
      });
      for (const f of await features<ApiLocation>("monitoring-locations", params, { fresh: true }))
        locations.set(f.properties.id, f);
    }
  };
  await fetchLocations([...chosen.keys()]);
  // A short answer would quietly retire the stations it left out, so the
  // sites it missed are asked for again, and any still missing fail the list.
  await fetchLocations([...chosen.keys()].filter((id) => !locations.has(id)));
  const missing = [...chosen.keys()].filter((id) => !locations.has(id));
  if (missing.length)
    throw new Error(
      `USGS has no monitoring location for ${missing.length} sites, e.g. ${missing[0]}`,
    );

  const out: UsgsStation[] = [];
  for (const [id, s] of chosen) {
    const location = locations.get(id);
    if (!location?.geometry || location.properties.agency_code !== "USGS") continue;
    const kind = kindOf(location.properties, tidal.has(id) || TIDAL_SITES.has(id));
    if (kind) out.push(toStation(location.properties, location.geometry.coordinates, s, kind));
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** How many sites one `monitoring-locations` request asks for, keeping the URL short. */
const LOCATION_BATCH = 200;

/**
 * Each site's series of its most preferred parameter: instantaneous values,
 * the primary series before others, the gage itself before a headwater or
 * tailwater sublocation, one reporting now before one that isn't, one that
 * reported in the last year before one that ended earlier (the latest first),
 * and then the earliest start.
 */
export function choose(series: ApiSeries[]): Map<string, ApiSeries> {
  const order = PARAMETERS.map(([code]) => code);
  const rank = (s: ApiSeries) => [
    // A preferred parameter that stopped more than a year ago doesn't keep a
    // site off the live feed when another of its series still reports.
    recentYear(s) ? 0 : 1,
    order.indexOf(s.parameter_code),
    s.primary === "Primary" ? 0 : 1,
    s.sublocation_identifier ? 1 : 0,
    reporting(s) ? 0 : 1,
    // Within the last year counts as current, so an outage of weeks or months
    // doesn't hand the site to an older series and flag a change that isn't one.
    recentYear(s) ? 0 : Date.now() - Date.parse(s.end ?? "1900-01-01"),
    s.begin ? Date.parse(s.begin) : Infinity,
  ];
  const chosen = new Map<string, ApiSeries>();
  for (const s of series) {
    // A few instantaneous series carry no statistic code (Housatonic River at Shelton, 01208760).
    const instantaneous = s.statistic_id === "00011" || s.statistic_id === null;
    if (!DATUM_OF.has(s.parameter_code) || !instantaneous) continue;
    if (s.unit_of_measure !== "ft") continue;
    const best = chosen.get(s.monitoring_location_id);
    if (!best || before(rank(s), rank(best))) chosen.set(s.monitoring_location_id, s);
  }
  return chosen;
}

/** A series that reported in the last year. */
function recentYear(s: ApiSeries): boolean {
  return s.end !== null && Date.parse(s.end) >= Date.now() - 365 * DAY_MS;
}

/** A series that reported in the last week; it's on the live feed. */
function reporting(s: Pick<ApiSeries, "end">): boolean {
  return s.end !== null && Date.parse(s.end) > Date.now() - 7 * DAY_MS;
}

function before(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!;
  return false;
}

/**
 * Which sites are water-level stations, and what kind: coastal and estuary
 * sites, sites USGS treats as tidal, streams whose gage datum is below sea
 * level, and river stage in the Mississippi and Ohio basins. Null for the rest.
 */
export function kindOf(
  location: Pick<
    ApiLocation,
    "site_type_code" | "hydrologic_unit_code" | "altitude" | "vertical_datum"
  >,
  tidal: boolean,
): Kind | null {
  const type = location.site_type_code ?? "";
  const huc = location.hydrologic_unit_code ?? "";
  if (type === "OC" || type === "OC-CO") return "coastal";
  if (type === "ES" || type === "ST-TS" || tidal) return "estuary";
  if (!type.startsWith("ST")) return null;
  // A gage datum below sea level is a reach the tide can reach, except in the
  // closed Salton Sea basin (HUC 1810). An altitude of exactly 0 isn't a sign:
  // it's where USGS sets the gage datum to NAVD88 itself, inland too.
  const belowSeaLevel =
    location.altitude !== null &&
    location.vertical_datum !== null &&
    location.vertical_datum in VERTICAL_DATUMS &&
    location.altitude < 0 &&
    !huc.startsWith("1810");
  // The Lower Mississippi-Lake Maurepas subregion (0809) is Louisiana's coast,
  // where gages sit in tidal bayous, canals and sector gates.
  if (belowSeaLevel || huc.startsWith("0809")) return "estuary";
  if (type === "ST" && RIVER_REGIONS.has(huc.slice(0, 2))) return "river";
  return null;
}

/** US territories `monitoring-locations` lists under the United States. */
const TERRITORIES: Record<string, string> = {
  "Puerto Rico": "PR",
  "Virgin Islands": "VI",
  Guam: "GU",
  "American Samoa": "AS",
  "Northern Mariana Islands": "MP",
};

function toStation(
  location: ApiLocation,
  [lon, lat]: number[],
  series: ApiSeries,
  kind: Kind,
): UsgsStation {
  const site = location.id.replace(/^USGS-/, "");
  const datum = DATUM_OF.get(series.parameter_code)!;
  const datums: Record<string, number> = {};
  // Gage height plus the gage datum's altitude is the level in that vertical datum.
  const vertical = location.vertical_datum ? VERTICAL_DATUMS[location.vertical_datum] : undefined;
  if (datum === GAGE && vertical && typeof location.altitude === "number")
    datums[vertical] = Math.round(location.altitude * FEET * 1000) / 1000 + 0; // + 0 turns -0 into 0
  const live = reporting(series);
  return {
    ...stationDefaults(metadata),
    id: `usgs/${site}`,
    source_id: site,
    name: location.monitoring_location_name,
    lat: lat!,
    lon: lon!,
    country_code: TERRITORIES[location.state_name ?? ""] ?? location.country_code ?? null,
    kind,
    interval_s: null,
    datum,
    datums,
    products: ["levels"],
    first: null,
    last: null,
    tide_station: null,
    same_as: [],
    status: "active",
    live,
    min_interval_s: 900,
    source_url: `https://waterdata.usgs.gov/monitoring-location/${location.id}/`,
    time_series_id: series.id,
    parameter_code: series.parameter_code,
  };
}

interface Value {
  time: string;
  value: string | null;
  approval_status: string | null;
  qualifier: string[] | string | null;
}

/**
 * Observed levels in meters over [start, end) from one series, a calendar year
 * per request (the API allows 1,100 days), following each page's `next` link.
 */
export async function levels(timeSeriesId: string, start: Date, end: Date): Promise<Observation[]> {
  const out: Observation[] = [];
  for (const [from, to] of years(start, end)) {
    const params = new URLSearchParams({
      time_series_id: timeSeriesId,
      // Both ends are inclusive; values at `to` are dropped below.
      datetime: `${from.toISOString()}/${to.toISOString()}`,
      properties: "time,value,approval_status,qualifier",
    });
    for await (const page of pages<Value>("continuous", params, { keep: approved }))
      for (const v of page) {
        refuseOtherDatum(v, timeSeriesId);
        const o = toObservation(v);
        if (o) out.push(o);
      }
  }
  return tidy(out, start, end);
}

/** A value in meters, or null when it's missing. */
function toObservation(v: Value): Observation | null {
  const feet = v.value === null ? NaN : Number(v.value);
  if (v.value === "" || !Number.isFinite(feet)) return null;
  // Hundredths of a foot are 3 mm; four decimals keep them without float noise.
  return { time: Date.parse(v.time), level: Math.round(feet * FEET * 1e4) / 1e4, flag: flagOf(v) };
}

/** Sorted, without repeated times, within [start, end). */
function tidy(rows: Observation[], start: Date, end: Date): Observation[] {
  rows.sort((a, b) => a.time - b.time);
  return rows.filter(
    (r, i) =>
      r.time >= start.getTime() &&
      r.time < end.getTime() &&
      (i === 0 || r.time !== rows[i - 1]!.time),
  );
}

/**
 * The last hours at every station in one sweep: `continuous` answers a time
 * filter with no site filter, a parameter at a time, paging through every
 * site's values, so a day is about 40 requests rather than one per station.
 * Values from series no station uses are dropped.
 */
export async function recent(
  list: Station[],
  start: Date,
  end: Date,
): Promise<Map<string, Observation[] | Error>> {
  const bySeries = new Map<string, string>();
  const parameters = new Set<string>();
  const out = new Map<string, Observation[] | Error>();
  for (const station of list) {
    try {
      bySeries.set(checked(station), station.id);
      parameters.add((station as Station & UsgsStation).parameter_code);
    } catch (error) {
      // One station committed in another datum fails alone, not the sweep.
      out.set(station.id, error as Error);
    }
  }
  const rows = new Map<string, Observation[]>();
  let anything = false;
  for (const parameter of parameters) {
    let values = 0;
    const params = new URLSearchParams({
      parameter_code: parameter,
      datetime: `${start.toISOString()}/${end.toISOString()}`,
      properties: "time_series_id,time,value,approval_status,qualifier",
    });
    // Page by page, keeping only the stations' own series: a day of every site is millions of values.
    for await (const page of pages<Value & { time_series_id: string }>("continuous", params, {
      fresh: true,
    }))
      for (const v of page) {
        values++;
        const id = bySeries.get(v.time_series_id);
        if (!id || out.has(id)) continue;
        try {
          refuseOtherDatum(v, v.time_series_id);
        } catch (error) {
          out.set(id, error as Error);
          rows.delete(id);
          continue;
        }
        const o = toObservation(v);
        if (!o) continue;
        const kept = rows.get(id);
        if (kept) kept.push(o);
        else rows.set(id, [o]);
      }
    anything ||= values > 0;
    // Its stations never all go quiet at once; no values at all is an outage of that parameter.
    if (!values)
      for (const station of list)
        if ((station as Station & UsgsStation).parameter_code === parameter && !out.has(station.id))
          out.set(station.id, new Error(`USGS returned no ${parameter} values`));
  }
  // Thousands of live gages never all go quiet at once; no values at all is an outage.
  if (bySeries.size && !anything)
    throw new Error(`USGS returned no values for ${start.toISOString()} to ${end.toISOString()}`);
  for (const [id, r] of rows) out.set(id, tidy(r, start, end));
  return out;
}

/**
 * A station committed against one series or gage zero, now listed against
 * another: a different `time_series_id` (USGS made another series primary, or
 * reissued it), or a gage datum that moved against its vertical datum. Either
 * way the stored values and new ones aren't measured from the same zero.
 */
export function seriesChanged(committed: Station, listed: ListedStation): string | null {
  const [was, now] = [committed, listed] as unknown as Partial<UsgsStation>[];
  if (was!.time_series_id && now!.time_series_id && was!.time_series_id !== now!.time_series_id)
    return `series ${was!.time_series_id} is now ${now!.time_series_id}`;
  if (committed.datum !== GAGE) return null;
  const [before, after] = [Object.keys(committed.datums), Object.keys(listed.datums)];
  for (const name of before) {
    const [height, next] = [committed.datums[name]!, listed.datums[name]];
    if (next !== undefined && Math.abs(next - height) > 0.0005)
      return `gage datum is now ${next} m above ${name}, not ${height}`;
  }
  // A gage datum referenced to another vertical datum may have moved too, and
  // nothing says by how much. A site that lists no altitude at all is more
  // likely a gap in the answer, and keeps its offsets.
  if (before.length && after.length && !before.some((name) => name in listed.datums))
    return `gage datum is now given against ${after.join(", ")}, not ${before.join(", ")}`;
  return null;
}

/**
 * Qualifiers that make a value suspect: affected by ice, equipment trouble, a
 * dry sensor, and a level below what the gage can record (LESSTHAN, BLWMIN),
 * which is a bound rather than a reading. The rest (REVISED, SEASONAL,
 * REGULATED, URBAN, TIDE, BACKWATER, DISCONTINUED, UNAVAIL) describe the site
 * or the record, not the value; backwater affects discharge, not stage.
 */
const SUSPECT = new Set(["ICE", "EQUIP", "DRY", "LESSTHAN", "BLWMIN"]);

/** Qualifiers that put a value in another datum than the series' current one. */
const OTHER_DATUM = new Set(["DIFFDATUM", "DATUMCHANGE"]);

function qualifiers(v: Pick<Value, "qualifier">): string[] {
  const q = v.qualifier;
  return (q === null ? [] : Array.isArray(q) ? q : [q]).map((s) => s.toUpperCase());
}

/**
 * A value measured from another datum means the gage datum moved during the
 * series, so the stored values and the new ones may not share a zero. That's
 * for a person to resolve, so the fetch fails rather than mix the two.
 */
function refuseOtherDatum(v: Value, series: string): void {
  const q = qualifiers(v).find((q) => OTHER_DATUM.has(q));
  if (q && v.value !== null)
    throw new Error(
      `USGS series ${series} has values in another datum (${q}) at ${v.time}; resolve by hand`,
    );
}

/**
 * Approved values are good and provisional ones preliminary; an estimated value
 * is at best interpolated, and the qualifiers in SUSPECT make any value suspect.
 */
export function flagOf(v: Pick<Value, "approval_status" | "qualifier">): Flag {
  const q = qualifiers(v);
  if (q.some((s) => SUSPECT.has(s))) return Flag.suspect;
  const flag = v.approval_status === "Approved" ? Flag.good : Flag.preliminary;
  return q.includes("ESTIMATED") ? (Math.max(flag, Flag.interpolated) as Flag) : flag;
}

/** [start, end) split at UTC calendar years. */
function* years(start: Date, end: Date): Generator<[Date, Date]> {
  for (let t = start.getTime(); t < end.getTime();) {
    const next = Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
    yield [new Date(t), new Date(Math.min(next, end.getTime()))];
    t = next;
  }
}

/**
 * USGS approves values months to years after they're measured (Olmsted's 2024
 * gage height was still provisional in November 2026), replacing provisional
 * ones, so only a page of values that are all approved is cached. An empty page
 * isn't either: values can arrive late, and an outage can answer with none.
 */
export function approved(text: string): boolean {
  return /"approval_status"\s*:\s*"Approved"/.test(text) && !text.includes('"Provisional"');
}

/** Every item of a collection, following `next` links. */
async function items<T>(
  collection: string,
  params: URLSearchParams,
  options: RequestOptions,
): Promise<T[]> {
  const out: T[] = [];
  for await (const page of pages<T>(collection, params, options)) out.push(...page);
  return out;
}

/** A collection's items a page at a time, following `next` links. */
async function* pages<T>(
  collection: string,
  params: URLSearchParams,
  options: RequestOptions,
): AsyncGenerator<T[]> {
  for await (const page of featurePages<T>(collection, params, options))
    yield page.map((f) => f.properties);
}

async function features<T>(
  collection: string,
  params: URLSearchParams,
  options: RequestOptions,
): Promise<Collection<T>["features"]> {
  const out: Collection<T>["features"] = [];
  for await (const page of featurePages<T>(collection, params, options)) out.push(...page);
  return out;
}

async function* featurePages<T>(
  collection: string,
  params: URLSearchParams,
  options: RequestOptions,
): AsyncGenerator<Collection<T>["features"]> {
  const query = new URLSearchParams({
    f: "json",
    limit: String(PAGE),
    ...Object.fromEntries(params),
  });
  if (collection !== "monitoring-locations") query.set("skipGeometry", "true");
  let url: string | undefined = `${API}/collections/${collection}/items?${query}`;
  while (url) {
    const page: Collection<T> = await request<Collection<T>>(url, options);
    yield page.features;
    url = page.links?.find((l) => l.rel === "next")?.href;
    // The key goes with every request, so only ever to the API itself.
    if (url && !url.startsWith(`${API}/`)) throw new Error(`USGS paged to ${url}, off the API`);
  }
}

/** The most items the API returns in one page. */
const PAGE = 50_000;

/**
 * Keyless clients get 1,000 requests in any rolling hour per IP, through
 * api.data.gov, and every client behind that IP shares them. Past that the API
 * answers 429 with a Retry-After of up to an hour, until the oldest request in
 * the window ages out. So requests that go out start `requestMs` apart (cache
 * hits don't wait), a little over 3.6 seconds to leave a margin, which keeps
 * one keyless run under the limit, and a 429
 * waits `blockedMs`, twice, before giving up. A key in USGS_API_KEY gives the
 * run a budget of its own; it goes in a header, never the URL, so it stays out
 * of logs and cache keys. Tests shrink the waits.
 */
export const pacing = { requestMs: 3700, blockedMs: 15 * 60_000 };
let nextSlot = 0;
let blockedUntil = 0;

/**
 * Holds each request that goes out to its slot, `requestMs` after the last
 * one's. One that wakes inside a block a 429 started since it took its slot
 * takes a new slot after the block.
 */
async function pace(): Promise<void> {
  do {
    const now = Date.now();
    const slot = Math.max(now, nextSlot, blockedUntil);
    nextSlot = slot + pacing.requestMs;
    await sleep(slot - now);
  } while (Date.now() < blockedUntil);
}

async function request<T>(url: string, options: RequestOptions): Promise<T> {
  const key = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .USGS_API_KEY;
  for (let attempt = 1; ; attempt++) {
    try {
      return await getJson<T>(url, { ...options, pace, headers: key ? { "x-api-key": key } : {} });
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("returned 429")) throw error;
      // Wait as long as the API asks, and hold every other request back too.
      const asked = /retry after (\d+) s/.exec(String(error))?.[1];
      const wait = asked ? Math.min(Number(asked) * 1000 + 5000, 3_700_000) : pacing.blockedMs;
      blockedUntil = Math.max(blockedUntil, Date.now() + wait);
      await sleep(wait);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** Every request is for the station's own series, so one committed in another datum is refused. */
function checked(station: Station): string {
  const s = station as Station & Partial<UsgsStation>;
  if (!s.time_series_id || !s.parameter_code)
    throw new Error(`${station.id} has no time_series_id; refresh the USGS station list`);
  const datum = DATUM_OF.get(s.parameter_code);
  if (station.datum !== datum)
    throw new Error(`${station.id} is in ${station.datum}; its USGS series is in ${datum}`);
  return s.time_series_id;
}

export const source: Source = {
  metadata,
  stations,
  seriesChanged,
  observations: (s: Station, start, end) => levels(checked(s), start, end),
  recent,
};
