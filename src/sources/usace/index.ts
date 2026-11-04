import { getJson } from "../../http.ts";
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
 * US Army Corps of Engineers river stage, from the Corps Water Management
 * System through the CWMS Data API (CDA).
 *
 * A station is a CWMS location, and its levels are one `Stage.Inst` series
 * there, in meters above the gauge's zero (`GZ`). Where CWMS gives the gauge
 * zero's elevation in NGVD29 or NAVD88, `datums` carries it.
 */
const API = "https://cwms-data.usace.army.mil/cwms-data";

/** The district offices on the Mississippi, Ohio, Missouri and their tributaries. */
export const OFFICES = ["MVS", "MVK", "MVM", "MVN", "LRL", "LRP", "LRH", "LRN", "LRC"];

export const metadata: SourceMetadata = {
  id: "usace",
  name: "U.S. Army Corps of Engineers, Corps Water Management System (CWMS)",
  url: "https://cwms-data.usace.army.mil/cwms-data/",
  license: {
    id: "US-Government-Works",
    name: "U.S. Government work, public domain",
    url: "https://www.law.cornell.edu/uscode/text/33/2342",
    commercial_use: true,
  },
  attribution: "U.S. Army Corps of Engineers",
  // Navigation pools sit nearly flat for months, then rise meters in a flood,
  // which the outlier rule would mark suspect.
  qc: { outliers: false },
  terms:
    "Unscreened values are as the gauge reported them, and the Corps may revise them. The Corps assumes no liability for their accuracy.",
};

/** Levels are stage, the height above the gauge's own zero. */
const DATUM = "GZ";

const V2 = { headers: { accept: "application/json;version=2" } };

/** A series in CDA's time-series catalog. */
export interface CatalogSeries {
  office: string;
  name: string;
  interval: string;
  versioned?: boolean;
  extents?: { "earliest-time"?: string; "latest-time"?: string }[];
}

/** A location in CDA's location catalog. */
export interface CatalogLocation {
  office: string;
  name: string;
  "public-name"?: string;
  "long-name"?: string;
  kind?: string;
  latitude?: number;
  longitude?: number;
  elevation?: number;
  unit?: string;
  "vertical-datum"?: string;
  nation?: string;
  "bounding-office"?: string;
}

/**
 * A USACE station as listed, with the CWMS series its levels come from. The
 * series is kept in the committed list only; `stations.parquet` doesn't carry it.
 */
export type UsaceStation = ListedStation & { series: string };

/**
 * Every location in the offices with an observed stage series, one series
 * each. A station in `previous` keeps its committed series while CWMS still
 * lists it, so a refresh never moves a station's files to another series.
 */
export async function stations(previous: Station[] = []): Promise<ListedStation[]> {
  const committed = new Map<string, string>();
  for (const s of previous) {
    const { series } = s as Partial<UsaceStation>;
    if (series) committed.set(s.id, series);
  }
  const out: UsaceStation[] = [];
  for (const office of OFFICES) {
    const { series, locations } = await catalogsOf(office);
    out.push(...toStations(office, series, locations, committed));
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

async function catalogsOf(
  office: string,
): Promise<{ series: CatalogSeries[]; locations: CatalogLocation[] }> {
  const series = await catalog<CatalogSeries>("TIMESERIES", office, {
    like: ".*\\.Stage\\.Inst\\..*",
    "include-extents": "true",
  });
  const locations = await catalog<CatalogLocation>("LOCATIONS", office, {});
  // An office with no stage series is a broken answer, not a district without gauges.
  if (!series.length || !locations.length)
    throw new Error(`CWMS listed no stage series or locations for ${office}`);
  return { series, locations };
}

/**
 * One station per location that has an observed series, from an office's
 * catalogs. `committed` maps station IDs to the series they already use.
 */
export function toStations(
  office: string,
  series: CatalogSeries[],
  locations: CatalogLocation[],
  committed: Map<string, string> = new Map(),
  now = Date.now(),
): UsaceStation[] {
  const byName = new Map(locations.map((l) => [l.name, l]));
  const listed = new Map(series.map((s) => [s.name, s]));
  const byLocation = Map.groupBy(
    series.filter((s) => observed(s)),
    (s) => s.name.split(".")[0]!,
  );
  const out = new Map<string, UsaceStation>();
  // In name order, so which of two new locations that share an ID wins doesn't depend on the catalog's order.
  for (const [name, candidates] of [...byLocation].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const location = byName.get(name);
    if (!location || !placed(location)) continue;
    // Piezometers and observation wells read groundwater in a dam's foundation, not a water surface.
    if (GROUNDWATER.test(name)) continue;
    const id = idOf(office, name);
    // A committed station's ID belongs to the location its series is at, so
    // it's never handed to another location that now maps to the same ID. If
    // that location is gone, the station goes unlisted, and so inactive.
    const committedSeries = committed.get(`usace/${id}`);
    if (committedSeries && committedSeries.split(".")[0] !== name) {
      console.error(
        `  usace ${office} location ${name} is ${id}, which belongs to ${committedSeries.split(".")[0]}; skipping ${name}`,
      );
      continue;
    }
    if (out.has(id)) {
      console.error(
        `  usace ${office} locations ${out.get(id)!.series.split(".")[0]} and ${name} are both ${id}; skipping ${name}`,
      );
      continue;
    }
    const best = candidates.sort((a, b) => rank(b, now) - rank(a, now) || first(a) - first(b))[0]!;
    const kept = committedSeries;
    const station = toStation(office, id, location, kept ? listed.get(kept) : best, kept, now);
    // A committed series CWMS no longer lists keeps the station on it, inactive,
    // for a person to move to another series (and decide whether its files mix two).
    if (kept && !listed.has(kept)) {
      console.error(
        `  usace/${id}: ${kept} is no longer listed; marked inactive (CWMS now offers ${best.name})`,
      );
      station.status = "inactive";
    }
    out.set(id, station);
  }
  return [...out.values()];
}

const GROUNDWATER = /piezometer|-OW\d+[A-Z]?$/i;

/**
 * Whether a location's position is in the contiguous US, where all nine offices
 * are. Some locations sit at 0,0 or at a placeholder such as 9.09,9.09, and a
 * few have the longitude's sign dropped, which puts them in Asia.
 */
function placed(l: CatalogLocation): boolean {
  const { latitude: lat, longitude: lon } = l;
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    lat > 24 &&
    lat < 50 &&
    lon > -125 &&
    lon < -66
  );
}

/**
 * `<office>.<location>`, with anything but letters, digits, `.`, `_` and `-`
 * as `_`, so an ID needs no escaping in a lake path, a URL or a shell argument.
 */
function idOf(office: string, location: string): string {
  return `${office}.${location.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/**
 * `series` is the catalog entry the station reads, or undefined when its
 * committed series (`name`) is no longer listed.
 */
function toStation(
  office: string,
  id: string,
  l: CatalogLocation,
  series: CatalogSeries | undefined,
  name: string | undefined,
  now: number,
): UsaceStation {
  name ??= series!.name;
  return {
    ...stationDefaults(metadata),
    id: `usace/${id}`,
    source_id: id,
    name: (l["public-name"]?.trim() || l["long-name"]?.trim() || l.name).replace(/\s+/g, " "),
    lat: l.latitude!,
    lon: l.longitude!,
    country_code: /^(US|United States)/.test(l.nation ?? "US") ? "US" : null,
    kind: l.kind?.startsWith("STREAM") ? "river" : null,
    interval_s: INTERVALS[name.split(".")[3]!] ?? null,
    datum: DATUM,
    datums: datumsOf(l),
    products: ["levels"],
    first: null,
    last: null,
    tide_station: null,
    same_as: [],
    status: "active",
    live: series ? current(series, now) : false,
    min_interval_s: null,
    source_url: `${API}/timeseries?office=${office}&name=${encodeURIComponent(name)}`,
    series: name,
  };
}

/**
 * The gauge zero's elevation, as the height to add to a stage to refer it to
 * the vertical datum CWMS names for the location. Local and unnamed datums are
 * left out, and so is an elevation of exactly 0, which some offices give a
 * location they have no elevation for.
 */
export function datumsOf(l: CatalogLocation): Record<string, number> {
  const named = (l["vertical-datum"] ?? "").replace(/[\s-]|\(.*\)/g, "").toUpperCase();
  const datum = VERTICAL_DATUMS[named];
  const scale = l.unit === "ft" ? 0.3048 : l.unit === "m" ? 1 : null;
  if (!datum || scale === null || typeof l.elevation !== "number" || !l.elevation) return {};
  return { [datum]: Math.round(l.elevation * scale * 1000) / 1000 + 0 };
}

const VERTICAL_DATUMS: Record<string, string> = { NGVD29: "NGVD29", NAVD88: "NAVD88" };

/** Regular intervals CWMS stage is observed at, in seconds. */
const INTERVALS: Record<string, number> = {
  "5Minutes": 300,
  "6Minutes": 360,
  "10Minutes": 600,
  "15Minutes": 900,
  "~15Minutes": 900,
  "30Minutes": 1800,
  "1Hour": 3600,
  "2Hours": 7200,
  "~2Hours": 7200,
  "4Hours": 14400,
  "6Hours": 21600,
  "1Day": 86400,
  "~1Day": 86400,
};

/**
 * Versions that hold observations rather than forecasts, statistics or a copy
 * converted to another datum. CWMS version names are each office's own; these
 * are the observed ones the nine offices use.
 */
const OBSERVED = /(^|[-_])(rev|raw)$|^(OBS|OBS-USGS|Observed|MVM-PUB|historic-data-merge)$/i;
/** A version naming a datum is the stage converted to it, not stage above gauge zero. */
const CONVERTED = /NAVD|NGVD|LWRP|MLG|MLLW/i;

function observed(s: CatalogSeries): boolean {
  const parts = s.name.split(".");
  if (parts.length !== 6 || parts[1] !== "Stage" || parts[2] !== "Inst") return false;
  const version = parts[5]!;
  return (
    !s.versioned &&
    INTERVALS[s.interval] !== undefined &&
    OBSERVED.test(version) &&
    !CONVERTED.test(version)
  );
}

/**
 * Which of a location's series to take: one still reporting, then one finer
 * than daily, then a revised one over raw, then the finest interval. The
 * catalog's latest times lag by weeks, so "still reporting" allows half a year.
 */
function rank(s: CatalogSeries, now: number): number {
  const version = s.name.split(".")[5]!;
  const interval = INTERVALS[s.interval]!;
  return (
    (current(s, now) ? 8 : 0) +
    (interval < 86400 ? 4 : 0) +
    (/raw$/i.test(version) ? 0 : 2) +
    1 / interval
  );
}

function current(s: CatalogSeries, now: number): boolean {
  return times(s, "latest-time").some((t) => t > now - 183 * DAY_MS);
}

function first(s: CatalogSeries): number {
  return Math.min(Infinity, ...times(s, "earliest-time"));
}

function times(s: CatalogSeries, field: "earliest-time" | "latest-time"): number[] {
  return (s.extents ?? []).map((e) => Date.parse(e[field] ?? "")).filter(Number.isFinite);
}

/** Every entry of a catalog, following its pages. Always fresh: the catalog changes. */
async function catalog<T>(
  dataset: string,
  office: string,
  params: Record<string, string>,
): Promise<T[]> {
  const out: T[] = [];
  let page: string | undefined;
  do {
    const query = new URLSearchParams({ office, "page-size": "5000", ...params });
    if (page) query.set("page", page);
    const body = await getJson<{ entries?: T[]; "next-page"?: string }>(
      `${API}/catalog/${dataset}?${query}`,
      { ...V2, fresh: true },
    );
    out.push(...(body.entries ?? []));
    page = body["next-page"] || undefined;
  } while (page);
  return out;
}

interface ApiSeries {
  units?: string;
  values?: [number, number | null, number][];
  "next-page"?: string;
}

/**
 * Stage in meters above gauge zero over [start, end), from the CWMS series
 * `name` in `office`, a calendar year per request.
 */
export async function levels(
  office: string,
  name: string,
  start: Date,
  end: Date,
): Promise<Observation[]> {
  const out: Observation[] = [];
  for (const [from, to] of years(start, end)) {
    let page: string | undefined;
    do {
      const query = new URLSearchParams({
        office,
        name,
        unit: "SI",
        begin: from.toISOString(),
        end: to.toISOString(),
        "page-size": "100000",
      });
      if (page) query.set("page", page);
      const body = await getJson<ApiSeries>(`${API}/timeseries?${query}`, {
        ...V2,
        fresh: fresh(to),
      });
      if (body.values?.length && body.units !== "m")
        throw new Error(`CWMS ${office} ${name} came in ${body.units}, not m`);
      for (const [time, level, quality] of body.values ?? []) {
        const flag = flagOf(quality);
        if (level === null || !Number.isFinite(level) || flag === null) continue;
        out.push({ time, level: Math.round(level * 1000) / 1000, flag });
      }
      page = body["next-page"] || undefined;
    } while (page);
  }
  out.sort((a, b) => a.time - b.time);
  return out.filter(
    (r, i) =>
      r.time >= start.getTime() &&
      r.time < end.getTime() &&
      (i === 0 || r.time !== out[i - 1]!.time),
  );
}

/**
 * A CWMS quality code as a lake flag, or null for a value CWMS marks missing.
 * The code is a bit field: bit 0 says the value was screened, bits 1 to 4 that
 * screening found it okay (2), missing (4), questionable (8) or rejected (16),
 * and bits 11 to 14 how a replaced value was replaced (1, linear interpolation),
 * as USACE's CWMS-Data-Quality library reads them
 * (https://github.com/USACE-WaterManagement/CWMS-Data-Quality). A value nobody
 * has screened, or screened without a verdict, is preliminary.
 */
export function flagOf(quality: number): Flag | null {
  const q = quality >>> 0;
  if (q & 4) return null;
  if (q & 16) return Flag.bad;
  if (q & 8) return Flag.suspect;
  if (!(q & 1) || !(q & 2)) return Flag.preliminary;
  if (((q >>> 11) & 15) === 1) return Flag.interpolated;
  return Flag.good;
}

const DAY_MS = 86_400_000;

/** Offices revise recent values, so they're never cached. */
function fresh(end: Date): boolean {
  return end.getTime() > Date.now() - 120 * DAY_MS;
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
 * The office and series a station's levels come from. Every request is stage
 * above gauge zero, so a station committed in another datum is refused. A
 * station read from `stations.parquet`, which doesn't carry `series`, has it
 * from `source_url`, which names it.
 */
function seriesOf(station: Station): [string, string] {
  if (station.datum !== DATUM)
    throw new Error(`${station.id} is in ${station.datum}; CWMS stage comes in ${DATUM}`);
  const office = station.source_id.split(".")[0]!;
  const series =
    (station as Partial<UsaceStation>).series ??
    (station.source_url ? new URL(station.source_url).searchParams.get("name") : null);
  if (!series) throw new Error(`${station.id} names no CWMS series`);
  return [office, series];
}

export const source: Source = {
  metadata,
  stations,
  observations: async (s: Station, start, end) => levels(...seriesOf(s), start, end),
};
