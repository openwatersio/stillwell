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
import { load, rowsOf, type Parser } from "./export.ts";

/**
 * Louisiana's Coastwide Reference Monitoring System (CRMS): hourly water
 * levels at the surface-water gauges of about 400 marsh and swamp sites, from
 * CPRA's weekly export of the whole record. See README.md.
 */
export const metadata: SourceMetadata = {
  id: "crms",
  name: "Coastwide Reference Monitoring System (CRMS), Louisiana CPRA",
  url: "https://cims.coastal.la.gov/",
  license: {
    id: "CPRA-public-domain",
    name: "Public domain, as CPRA's CIMS disclaimer states",
    url: "https://cims.coastal.la.gov/About.aspx",
    commercial_use: true,
    redistribution: true,
  },
  attribution:
    "Coastal Protection and Restoration Authority (CPRA) of Louisiana. Coastwide Reference Monitoring System. Coastal Information Management System (CIMS) database. https://cims.coastal.la.gov",
  contact: { email: "cpra-cims@usgs.gov", url: "https://cims.coastal.la.gov/" },
  terms:
    "CPRA's CIMS disclaimer puts CPRA's data in the public domain and lets it be distributed or copied, with no warranty, and asks for a credit; its suggested citation adds the year and the date accessed. The store reads CIMS's weekly export once a month, so a value is as of the export its station's last refetch read. CPRA recommends getting its data from a CPRA server. Changes in the store: adjusted water elevations converted from feet to meters and rounded to the millimeter, times from Central Standard Time to UTC, rows without an adjusted elevation dropped, as are a surface-water gauge's rows CPRA labels a marsh well, and values CPRA's comments describe as a dry sensor or a stand-in flagged suspect.",
  // The export is weekly and its newest values are months old.
  hourly: false,
  // CPRA sends no preliminary values, but re-adjusts recent months from field
  // visits, so the monthly refetch reads the last three years again (monthly.yml).
  finalizes: true,
  // Values before the GEOID12B switch are served against GEOID99 (README.md).
  archive: "previous",
  utc_offsets: [-6, -6],
};

const DATUM = "NAVD88";
const FEET = 0.3048;
const HOUR_MS = 3_600_000;
/** CRMS's times are Central Standard Time all year. */
const CST_MS = -6 * HOUR_MS;

/**
 * Every CRMS series moved from GEOID99 to GEOID12B at 2013-10-01 00:00 CST,
 * with no conversion between them. The export serves the earlier values
 * against GEOID99, so they make an epoch of their own.
 */
export const GEOID12B = { id: "GEOID12B", since: "2013-10-01" };
const SWITCH = Date.UTC(2013, 9, 1) - CST_MS;
export const GEOIDS = ["GEOID99", "GEOID12B"];
const OTHER_GEOID = 255;

/** A surface-water gauge: `CRMS<site>-H0<n>`. `H0X` is a copy of another site's gauge. */
const SURFACE = /^CRMS\d{4}-H0\d$/;

const LAYERS = "https://cimsgeo3.coastal.louisiana.gov/arcgis/rest/services/prot_rest";

/**
 * Comments CPRA puts on a row whose water elevation isn't the water's: the
 * water at or below the sensor, low water on its own (not as the cause of a
 * salinity or conductance reading), the sonde out of the water, a day's median
 * standing in for its readings, readings moved to the top of the hour, or a
 * sonde that couldn't vent, which a pressure gauge's level depends on. A
 * comment about another measurement leaves the elevation alone.
 */
const SUSPECT =
  /water level less than or equal to|(^\s*|[.;]\s*)low water\.?\s*($|[.;])|out of the water|median daily value|reset to (the )?top of the hour|data suspect due to desiccant/i;

interface Feature<T> {
  attributes: T;
}

/** All of a layer query's features, a page at a time. */
async function query<T>(layer: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ;) {
    const url = `${LAYERS}/${layer}/query?${new URLSearchParams({
      ...params,
      returnGeometry: "false",
      f: "json",
      ...(offset ? { resultOffset: String(offset) } : {}),
    })}`;
    const page = await getJson<{
      features?: Feature<T>[];
      exceededTransferLimit?: boolean;
      error?: { message: string };
    }>(url, { fresh: true });
    if (!page.features)
      throw new Error(`CIMS's ${layer} answered ${page.error?.message ?? "no features"}`);
    out.push(...page.features.map((f) => f.attributes));
    if (!page.exceededTransferLimit) return out;
    if (!page.features.length) throw new Error(`CIMS's ${layer} said there was more but sent none`);
    offset += page.features.length;
  }
}

interface LayerStation {
  "CPRA_monitoring.STATION_ID": string | null;
  "CPRA_monitoring.SITE": string | null;
  "CPRA_monitoring.LATDD": number | null;
  "CPRA_monitoring.LONGDD": number | null;
  "CPRA_monitoring.BASIN": string | null;
  "mondata.STATUS": string | null;
}

/**
 * CRMS's hourly surface-water gauges, from CIMS's monitoring-stations layer,
 * each linked to the site's other series, listed or still in `previous`.
 */
export async function stations(previous: Station[] = []): Promise<ListedStation[]> {
  const [listed, sites] = await Promise.all([
    query<LayerStation>("monitoring_stations/MapServer/0", {
      where:
        "mondata.DATA_TYPE='Hydrography' AND mondata.PROJ_TYPE='CRMS' AND mondata.FREQUENCY LIKE '%Hourly%'",
      // Pages of a query are stable only in a stated order.
      orderByFields: "CPRA_monitoring.OBJECTID",
      outFields:
        "CPRA_monitoring.STATION_ID,CPRA_monitoring.SITE,CPRA_monitoring.LATDD,CPRA_monitoring.LONGDD,CPRA_monitoring.BASIN,mondata.STATUS,mondata.SENSOR_ENV",
    }),
    query<{ SITE_ID: string; VEGTYPE: string | null }>("crms_points/MapServer/0", {
      where: "1=1",
      orderByFields: "OBJECTID_1",
      outFields: "SITE_ID,VEGTYPE",
    }),
  ]);
  const vegetation = new Map(sites.map((s) => [s.SITE_ID, s.VEGTYPE]));
  const out = new Map<string, ListedStation>();
  for (const s of listed) {
    // Some IDs end in a no-break space, which trim() drops.
    const id = s["CPRA_monitoring.STATION_ID"]?.trim() ?? "";
    if (!SURFACE.test(id)) continue;
    const lat = s["CPRA_monitoring.LATDD"];
    const lon = s["CPRA_monitoring.LONGDD"];
    if (lat == null || lon == null) throw new Error(`CIMS lists ${id} with no position`);
    const site = id.slice(0, 8);
    out.set(id, {
      ...stationDefaults(metadata),
      id: `crms/${id}`,
      source_id: id,
      name: id,
      lat,
      lon,
      country_code: "US",
      // Forested swamp holds still water; the marsh sites are estuarine.
      kind: vegetation.get(site) === "SWAMP" ? "lake" : "estuary",
      interval_s: 3600,
      datum: DATUM,
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      // A station the layer lists more than once is active if any row says so.
      status:
        s["mondata.STATUS"] === "Inactive" && out.get(id)?.status !== "active"
          ? "inactive"
          : "active",
      live: false,
      min_interval_s: null,
      source_url: null,
      reference: GEOID12B,
    });
  }
  // CPRA numbers a gauge it moves within a site anew, H02 after H01, so a
  // site's series are one record, which GESLA's copies span. A series the
  // layer no longer lists stays in the store, so it's linked too.
  const ids = new Set([...out.values(), ...previous].map((s) => s.id));
  const bySite = Map.groupBy(ids, (id) => id.slice(0, 13));
  for (const s of out.values())
    s.same_as = bySite
      .get(s.id.slice(0, 13))!
      .filter((id) => id !== s.id)
      .sort();
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Reads the export's rows of surface-water gauges with an adjusted elevation. */
export const parser: Parser = (header) => {
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CRMS's export has no ${name} column`);
    return i;
  };
  const c = {
    station: col("Station ID"),
    date: col("Date (mm/dd/yyyy)"),
    time: col("Time (hh:mm:ss)"),
    zone: col("Time Zone"),
    environment: col("Sensor Environment"),
    level: col("Adjusted Water Elevation to Datum (ft)"),
    geoid: col("Geoid"),
    comments: col("Comments"),
  };
  return (f) => {
    // Some station IDs end in a no-break space, which trim() drops.
    const station = f[c.station]!.trim();
    const level = f[c.level];
    if (!SURFACE.test(station)) return null;
    // Every surface-water row's clock is checked, with an elevation or without, so a changed clock fails the run.
    if (f[c.zone] !== "CST")
      throw new Error(`CRMS's ${station} has a row in ${f[c.zone]}, not CST`);
    const d = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(f[c.date]!);
    const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(f[c.time]!);
    if (!d || !t) throw new Error(`CRMS's ${station} has an unreadable row: ${f.join(",")}`);
    const local = Date.UTC(+d[3]!, +d[1]! - 1, +d[2]!, +t[1]!, +t[2]!, +t[3]!);
    // Date.UTC rolls 2/31 over to March and 13/1 to January; a time that rolls over is refused.
    const back = new Date(local).toISOString();
    const stated = `${d[3]}-${d[1]!.padStart(2, "0")}-${d[2]!.padStart(2, "0")}T${t[1]}:${t[2]}:${t[3]}`;
    if (back.slice(0, 19) !== stated)
      throw new Error(`CRMS's ${station} has an impossible time ${f[c.date]} ${f[c.time]}`);
    // CPRA withdraws a value by leaving its elevation empty.
    if (!level) return null;
    // CPRA files a marsh well under a surface-water ID once, erratum `crms-0626-marsh-well`.
    const environment = f[c.environment]!.trim();
    if (environment === "Marsh Well") return null;
    if (environment !== "Surface Water")
      throw new Error(
        `CRMS's ${station} has an elevation in a ${environment || "blank"} sensor environment`,
      );
    const feet = Number(level);
    if (!Number.isFinite(feet))
      throw new Error(`CRMS's ${station} has an unreadable row: ${f.join(",")}`);
    const geoid = GEOIDS.indexOf(f[c.geoid]!);
    return {
      station,
      row: {
        time: local - CST_MS,
        feet,
        geoid: geoid < 0 ? OTHER_GEOID : geoid,
        flag: SUSPECT.test(f[c.comments] ?? "") ? Flag.suspect : Flag.good,
      },
    };
  };
};

/**
 * A station's levels over [start, end), in meters, NAVD88 against the geoid
 * of their time. A value whose geoid isn't GEOID99 before the switch or
 * GEOID12B from it fails the fetch, as a datum change no epoch holds.
 */
export async function levels(
  station: Pick<Station, "source_id" | "datum">,
  start: Date,
  end: Date,
): Promise<Observation[]> {
  if (station.datum !== DATUM)
    throw new Error(`CRMS's ${station.source_id} is in ${DATUM}, not ${station.datum}`);
  const rows = await rowsOf(await load(parser), station.source_id);
  const out: Observation[] = [];
  for (const r of rows) {
    if (r.time < start.getTime() || r.time >= end.getTime()) continue;
    const expected = r.time < SWITCH ? 0 : 1;
    if (r.geoid !== expected)
      throw new Error(
        `CRMS's ${station.source_id} has a value at ${new Date(r.time).toISOString()} against ${GEOIDS[r.geoid] ?? "another geoid"}, not ${GEOIDS[expected]}`,
      );
    const flag = r.flag as Flag;
    out.push({
      time: r.time,
      level: Math.round(r.feet * FEET * 1000) / 1000,
      flag,
      source_flag: flag,
    });
  }
  return out;
}

export const source: Source = {
  metadata,
  stations,
  observations: (s, start, end) => levels(s, start, end),
};
