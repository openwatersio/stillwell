import { getText } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
  type Station,
} from "../../schema.ts";

/**
 * The Channel Coastal Observatory's real-time API for the National Network of
 * Regional Coastal Monitoring Programmes' tide gauges: 10-minute levels in
 * meters above chart datum. Every request needs a key tied to a domain. See
 * README.md.
 */
const API = "https://coastalmonitoring.org/observations";
const HOUR_MS = 3_600_000;
/** The most hours one site's request covers; the API caps a longer one. */
const MAX_HOURS = 8760;

export const metadata: SourceMetadata = {
  id: "cco",
  name: "Channel Coastal Observatory, National Network of Regional Coastal Monitoring Programmes",
  url: "https://www.coastalmonitoring.org/ccoresources/api/",
  license: {
    id: "OGL-UK-3.0",
    name: "Open Government Licence v3.0",
    url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    commercial_use: true,
    redistribution: true,
  },
  attribution:
    "Real time data are from the National Network of Regional Coastal Monitoring Programmes, made freely available under the terms of the Open Government Licence v3.0. Data are not quality-controlled in real time.",
  contact: { url: "https://www.coastalmonitoring.org/contact_us", email: "cco@channelcoast.org" },
  terms:
    "Open Government Licence v3.0. Real-time data are not quality-controlled; the observatory checks each month in arrears.",
  // The API has each reading within 10 minutes.
  hourly: true,
  // Readings carry no flag until the monthly check, which can flag them.
  finalizes: true,
  // An outage is an error, so a year with no readings has none.
  empty_means_none: true,
};

/** Requests that go out start this far apart; the API publishes no rate limit. */
export const pacing = { requestMs: 1000 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/** The key and the domain it was issued for, from the environment. */
function credentials(): Record<string, string> {
  const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process
    ?.env;
  const key = env?.CCO_API_KEY;
  const referer = env?.CCO_REFERER;
  if (!key || !referer)
    throw new Error("CCO needs CCO_API_KEY and CCO_REFERER, the domain the key was issued for");
  // The key goes in a header, never the URL, so it stays out of logs and cache keys.
  return { "x-api-key": key, referer };
}

/**
 * GESLA's records of CCO's gauges by the name CCO lists them under, which the
 * store links as one gauge. Whitby Harbour is a gauge of its own, 150 m from
 * the EA's and BODC's Whitby: CMEMS, GESLA and TICON keep the two apart, so
 * only its CCO record is linked.
 */
const GESLA: Record<string, string> = {
  "arun platform": "gesla/arun_platform-arn-gbr-cco",
  brighton: "gesla/brighton-btn-gbr-cco",
  "deal pier": "gesla/deal_pier-dlp-gbr-cco",
  exmouth: "gesla/exmouth-exm-gbr-cco",
  "hastings pier": "gesla/hastings_pier-hgp-gbr-cco",
  "herne bay": "gesla/herne_bay-hby-gbr-cco",
  lymington: "gesla/lymington-lym-gbr-cco",
  penarth: "gesla/penarth-pen-gbr-cco",
  "port isaac": "gesla/port_isaac-pti-gbr-cco",
  "sandown pier": "gesla/sandown_pier-sdp-gbr-cco",
  scarborough: "gesla/scarborough-sca-gbr-cco",
  "second severn crossing": "gesla/severn_bridge-ssc-gbr-cco",
  "swanage pier": "gesla/swanage_pier-swp-gbr-cco",
  "west bay harbour": "gesla/west_bay_harbour-wbh-gbr-cco",
  "whitby harbour": "gesla/whitby_harbour-wtb-gbr-cco",
};

interface Feature {
  geometry?: { type?: string; coordinates?: number[] } | null;
  properties?: {
    id?: unknown;
    sensor?: unknown;
    date?: unknown;
    value?: unknown;
    QCflag?: unknown;
  };
}

async function tides(time: string, query = "", hours?: number): Promise<Feature[]> {
  const text = await getText(`${API}/tides/${time}.geojson${query}`, {
    fresh: true,
    pace,
    headers: credentials(),
    // A year of one site can take minutes to answer; a short window or the list shouldn't hold a run for that long.
    timeout: hours !== undefined && hours > 24 ? 900 : undefined,
  });
  // A window with no readings answers `{"type":"FeatureCollection","features":]}`, which isn't JSON (erratum `cco-empty-window-answers`).
  if (/"features"\s*:\s*\]/.test(text)) return [];
  const body = JSON.parse(text) as { features?: Feature[] };
  if (!Array.isArray(body.features)) throw new Error("CCO answered without a feature list");
  return body.features;
}

/**
 * Every site the tides group lists. A site's `id` is a number; an external
 * site's is a link to its provider's page, with no readings, so it's left out.
 */
export async function stations(_previous?: Station[], now = Date.now()): Promise<ListedStation[]> {
  const listed = new Map<string, ListedStation>();
  let dated = false;
  for (const { geometry, properties: p } of await tides("latest")) {
    const [lon, lat] = geometry?.coordinates ?? [];
    if (!/^\d+$/.test(String(p?.id))) continue;
    // A site that loses its name or position would otherwise be retired by the next refresh.
    if (typeof p?.sensor !== "string" || typeof lat !== "number" || typeof lon !== "number")
      throw new Error(`CCO site ${p?.id} has no name or position`);
    // A layer can answer in British National Grid, or with the axes swapped; the network's gauges are around Great Britain.
    if (lat < 49 || lat > 61 || lon < -9 || lon > 3)
      throw new Error(
        `CCO site ${p?.id} is at ${lat}, ${lon}, which isn't a position around Great Britain`,
      );
    const id = String(p!.id);
    const last = parseDate(p!.date);
    // Active while it reported within the year, as the store's other lists judge it.
    const active = last !== null && last > now - 366 * 24 * HOUR_MS;
    dated ||= last !== null;
    listed.set(id, {
      ...stationDefaults(metadata),
      id: `cco/${id}`,
      source_id: id,
      name: p.sensor,
      lat,
      lon,
      country_code: "GB",
      kind: "coastal",
      interval_s: 600,
      datum: "CD",
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: GESLA[p.sensor.toLowerCase()] ? [GESLA[p.sensor.toLowerCase()]!] : [],
      status: active ? "active" : "inactive",
      live: active,
      // Stillwell told the observatory it reads each site once an hour.
      min_interval_s: 3600,
      source_url: "https://coastalmonitoring.org/observations/",
    });
  }
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!listed.size) throw new Error("CCO listed no tide gauges");
  // Dates in another layout would read every site as stopped.
  if (!dated) throw new Error("CCO listed no site with a date YYYYMMDD#hhmmss");
  return [...listed.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Levels in meters above chart datum over [start, end), a request of up to a
 * year at a time. A request for a time and a duration answers with every
 * reading in the hours before the time.
 */
export async function levels(sourceId: string, start: Date, end: Date): Promise<Observation[]> {
  if (!/^\d+$/.test(sourceId)) throw new Error(`CCO has no site ${sourceId}`);
  const out = new Map<number, Observation>();
  for (let cursor = end.getTime(); cursor > start.getTime();) {
    const hours = Math.min(MAX_HOURS, Math.ceil((cursor - start.getTime()) / HOUR_MS));
    const features = await tides(
      new Date(cursor).toISOString().replace(/[-:T]|\.\d+Z/g, ""),
      `?sensor=${sourceId}&duration=${hours}`,
      hours,
    );
    // Several sites can answer a request that names one; keep only the one asked for.
    const mine = features.filter(({ properties: p }) => String(p?.id) === sourceId);
    // An answer with features but none of this site's is a response this adapter misreads, not a gap.
    if (features.length && !mine.length)
      throw new Error(`CCO answered for site ${sourceId} with no feature carrying its id`);
    for (const { properties: p } of mine) {
      const time = parseDate(p?.date);
      if (time === null) throw new Error(`CCO reading of site ${sourceId} has date ${p?.date}`);
      // The API sends the value as text, such as "3.88300"; a missing one is null or blank, or 9999 in the manual's files.
      const text = typeof p?.value === "string" ? p.value.trim() : p?.value;
      if (text === null || text === undefined || text === "") continue;
      const level =
        typeof text === "string" && /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)
          ? Number(text)
          : text;
      if (typeof level !== "number" || !Number.isFinite(level))
        throw new Error(`CCO reading of site ${sourceId} has value ${p?.value}`);
      // Fill values, 9999 and ±999.9999 (erratum `cco-fill-values`); no tide reaches 999 m.
      if (Math.abs(level) >= 999) continue;
      if (time >= start.getTime() && time < end.getTime())
        out.set(time, { time, level, flag: flagOf(p?.QCflag) });
    }
    // Each request starts one reading inside the last, so a reading at the edge the API leaves out of a window isn't lost; the Map drops the repeat.
    if (cursor - hours * HOUR_MS <= start.getTime()) break;
    cursor -= hours * HOUR_MS - 600_000;
  }
  return [...out.values()].sort((a, b) => a.time - b.time);
}

/** A `YYYYMMDD#hhmmss` stamp, in UTC, as milliseconds; null where it isn't a real time. */
function parseDate(text: unknown): number | null {
  const m = /^(\d{4})(\d\d)(\d\d)#(\d\d)(\d\d)(\d\d)$/.exec(String(text));
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const time = Date.UTC(y, mo - 1, d, h, mi, s);
  // Date.UTC rolls 31 February over to March, so a stamp is checked by turning it back.
  const back = new Date(time).toISOString();
  return back.startsWith(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`) ? time : null;
}

/**
 * The monthly check's flag, which follows the IOC's scheme (TideQCManual
 * v1.0, table 1). None means not checked yet. A value the check marks missing
 * (9) that the API still sends is bad, so a refetch replaces the stored one.
 */
function flagOf(code: unknown): Flag {
  // 0 is "no QC performed" in the IOC scheme.
  const text = String(code ?? "").trim();
  if (text === "" || text === "0") return Flag.preliminary;
  switch (text) {
    case "1":
    case "5": // correct but extreme
      return Flag.good;
    case "2":
      return Flag.interpolated;
    case "4":
    case "8":
    case "9":
      return Flag.bad;
    // Doubtful (3), a reference change (6), flat-lining (7) and any code the manual doesn't list.
    default:
      return Flag.suspect;
  }
}

export const source: Source = {
  metadata,
  stations,
  observations: (s: Station, start, end) => levels(s.source_id, start, end),
};
