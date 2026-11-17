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

/**
 * USGS water data through the OGC API (api.waterdata.usgs.gov/ogcapi/v1), which
 * replaces the legacy waterservices retired on 2027-02-22.
 *
 * Each station is one instantaneous series: gage height (00065) in the gage's
 * own datum where the site has it, else a water-surface elevation in NAVD88 or
 * NGVD29. `datums` gives the gage datum's altitude from `monitoring-locations`
 * where USGS surveyed it, or from `GAGE_DATUMS`.
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
    redistribution: true,
  },
  attribution: "U.S. Geological Survey",
  contact: { email: "wdfn@usgs.gov", url: "https://waterdata.usgs.gov/questions-comments/" },
  // Provisional values are approved months to years later.
  hourly: true,
  finalizes: true,
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
 * `altitude_method_code`s that mean USGS surveyed the altitude: levels (L),
 * GPS (D, G, F) or survey-grade GNSS (W, X, Y, Z). Only then is it the gage
 * datum's (erratum `usgs-unsurveyed-altitudes`). One estimated from a map (M),
 * a digital elevation model (N), lidar (J) or an altimeter (A) is the ground
 * at the site's coordinates: at tidal sites 17 of 38 such offsets put the
 * water more than 2 m from NAVD88's zero, against 10 of 223 surveyed ones. A
 * reported (R) or unknown (U) method, or none, isn't evidence of a survey.
 */
const SURVEYED = new Set(["L", "D", "G", "F", "W", "X", "Y", "Z"]);

/**
 * Whether a site's altitude was surveyed, so it's the gage datum's: a survey
 * method (`SURVEYED`) with an `altitude_accuracy` under a foot, since USGS
 * gives some surveyed altitudes as far out as 141 ft (erratum
 * `usgs-imprecise-altitudes`). With no accuracy given, only differentially
 * corrected (D) and survey-grade (F) GPS count.
 */
export function isSurveyed(
  location: Pick<ApiLocation, "altitude_method_code" | "altitude_accuracy">,
): boolean {
  const code = location.altitude_method_code ?? "";
  if (!SURVEYED.has(code)) return false;
  const accuracy = location.altitude_accuracy;
  return typeof accuracy === "number" ? accuracy < 1 : code === "D" || code === "F";
}

/** Every `altitude_method_code` USGS gave in November 2026. */
const METHODS = new Set([...SURVEYED, "M", "N", "J", "A", "R", "U"]);

/**
 * Gage datums decided per site, by site number, where `altitude` isn't the
 * gage's zero: the offsets to give instead, or none, and the `altitude` in
 * feet and `vertical_datum` USGS listed when it was decided. A site USGS lists at another altitude
 * may have been resurveyed or moved, so the decision is no longer applied: it
 * gets no offsets, and the refresh logs it for a person to look at. Each note
 * says where the value comes from.
 */
export const GAGE_DATUMS: Record<
  string,
  { altitude: number; vertical_datum: string; datums: Record<string, number>; note: string }
> = {
  "01389802": {
    altitude: 100.0,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Passaic R at Great Falls: gage height averages 115 ft against ground at 104 ft (USGS 3DEP), so the gage reads elevation and adding the 100 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "02266291": {
    altitude: 96.0,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Lateral 405 at S-405A: gage height averages 96.0 ft against ground at 95.9 ft (USGS 3DEP) and an altitude of 96 ft, so the gage reads elevation and adding the altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "02266292": {
    altitude: 101.0,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Lateral 405 below S-405A: gage height averages 90.2 ft against ground at 99.7 ft (USGS 3DEP), so the gage reads elevation and adding the 101 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "02266295": {
    altitude: 93.0,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Lateral 410 at S-410: gage height averages 95.5 ft against ground at 93.2 ft (USGS 3DEP), so the gage reads elevation and adding the 93 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "02266296": {
    altitude: 89.0,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Lateral 410 below S-410: gage height averages 90.1 ft against ground at 88.1 ft (USGS 3DEP), so the gage reads elevation and adding the 89 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "02272701": {
    altitude: 24.0,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Kissimmee River above S-69: gage height averages 31.5 ft against ground at 23.8 ft (USGS 3DEP); adding the 24 ft altitude puts the water 32 ft above the ground. Erratum `usgs-gage-reads-elevation`.",
  },
  "02321975": {
    altitude: 35.0,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Santa Fe River at US 441: gage height averages 31.5 ft against ground at 37 ft (USGS 3DEP), so the gage reads elevation and adding the 35 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "02400175": {
    altitude: 556.29,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Coosa River at Adams Ferry: gage height averages 505 ft against ground at 509 ft (USGS 3DEP), so the gage reads elevation and adding the 556 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "02492100": {
    altitude: 19.07,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Pearl River Navigation Canal lock: gage height averages 25.5 ft against ground at 29.5 ft (USGS 3DEP); adding the 19 ft altitude puts the water 15 ft above the ground. Erratum `usgs-gage-reads-elevation`.",
  },
  "05548185": {
    altitude: 790.09,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Elizabeth Lake drain: gage height averages 793.9 ft against ground at 793.7 ft (USGS 3DEP), so the gage reads elevation and adding the 790 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "07250550": {
    altitude: 402.27,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Arkansas River at Trimble Lock and Dam: gage height averages 372 ft against ground at 392 ft at the dam (USGS 3DEP), so the gage reads elevation and adding the 402 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "07263450": {
    altitude: 223.61,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Arkansas River at Murray Dam: gage height averages 249 ft against ground at 238 ft (USGS 3DEP), so the gage reads elevation and adding the 224 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "07263708": {
    altitude: 242.87,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Mound Lake at Plum Bayou Mounds: gage height averages 230.8 ft against ground at 231.5 ft (USGS 3DEP), so the gage reads elevation and adding the 243 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "07288800": {
    altitude: 40.17,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Yazoo River at Redwood: gage height averages 57 ft against ground at 66 ft (USGS 3DEP); adding the 40 ft altitude puts the water 31 ft above the ground. Erratum `usgs-gage-reads-elevation`.",
  },
  "07359000": {
    altitude: 312.57,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Lake Catherine at Jones Mill: gage height averages 302.5 ft against ground at 322 ft by the lake (USGS 3DEP), so the gage reads elevation and adding the 313 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "08015910": {
    altitude: 24.71,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Calcasieu River at Moss Bluff: gage height averages 25.5 ft where the ground model reads the water at -1 ft (USGS 3DEP); adding the 24.7 ft altitude puts this tidal reach 51 ft above it. Erratum `usgs-altitude-contradicts-levels`.",
  },
  "08065500": {
    altitude: 118.05,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Trinity River near Midway: gage height averages 129 ft against ground at 165 ft at the bridge (USGS 3DEP), so the gage reads elevation and adding the 118 ft altitude puts the water 82 ft above the bridge. Erratum `usgs-gage-reads-elevation`.",
  },
  "08180990": {
    altitude: 978.7,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Leon Creek at IH 10: gage height averages 982 ft against ground at 1,004 ft at the bridge (USGS 3DEP), so the gage reads elevation and adding the 979 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "08470500": {
    altitude: 17.53,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Arroyo Colorado at FM 106: gage height averaged 10.6 ft in its last year where the ground model reads the water at -0.5 ft (USGS 3DEP); adding the 17.5 ft altitude puts it 28 ft above it. Erratum `usgs-altitude-contradicts-levels`.",
  },
  "08474395": {
    altitude: -2.35,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Brazos Santiago Pass at South Padre Island: with the -2.35 ft altitude the water reads 0.68 m below NOAA's co-located SPI Brazos Santiago gauge (8779749) and 0.79 m below South Padre Island CG Station (8779748), 1.4 km away, in each's NAVD88 over the same 169 hours in November 2026, with 1 to 2 cm spread. Erratum `usgs-altitude-contradicts-levels`.",
  },
  "09328990": {
    altitude: 3785.0,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Colorado River above Dirty Devil River: gage height averages 3,568 ft, Lake Powell's surface, so the gage reads elevation and adding the 3,785 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "09429495": {
    altitude: 184.29,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Imperial Reservoir at Imperial Dam: gage height averages 180.4 ft against ground at 186 ft (USGS 3DEP), so the gage reads elevation and adding the 184 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "09469000": {
    altitude: 2502.02,
    vertical_datum: "NAVD88",
    datums: {},
    note: "San Carlos Reservoir at Coolidge Dam: gage height averages 2,448.5 ft against ground at 2,450 ft (USGS 3DEP), so the gage reads elevation and adding the 2,502 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "11312676": {
    altitude: 0.0,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Middle River at Middle River: with the 0.0 ft altitude the water reads 2.95 ft above Old River near Byron (11313315) over the same 168 hours in November 2026, with 0.26 ft spread, in one tidal channel system. Erratum `usgs-altitude-contradicts-levels`.",
  },
  "11313405": {
    altitude: 0.0,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Old River at Bacon Island: with the 0.0 ft altitude the water reads 5.2 ft above Old River near Byron (11313315), downstream on the same channel, over the same 168 hours in November 2026, with 0.31 ft spread. Erratum `usgs-altitude-contradicts-levels`.",
  },
  "11313433": {
    altitude: 0.0,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Dutch Slough below Jersey Island Road: with the 0.0 ft altitude the water reads 3.5 ft above Old River near Byron (11313315) and the San Joaquin at Jersey Point (11337190) over the same 168 hours in November 2026. Erratum `usgs-altitude-contradicts-levels`.",
  },
  "11507200": {
    altitude: 4126.22,
    vertical_datum: "NGVD29",
    datums: {},
    note: "A Canal at Klamath Falls: gage height averaged 4,142.6 ft in its last year against ground at 4,141 ft (USGS 3DEP), so the gage reads elevation and adding the 4,126 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "15278000": {
    altitude: 859.8,
    vertical_datum: "NGVD29",
    datums: {},
    note: "Eklutna Lake near Palmer: gage height averages 846.8 ft, the lake's surface, so the gage reads elevation and adding the 860 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "182827067040500": {
    altitude: 397.99,
    vertical_datum: "PRVD02",
    datums: {},
    note: "Lago Guerrero near Isabela: gage height averages 407 ft against ground at 415 ft (USGS 3DEP), so the gage reads elevation and adding the 398 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
  "422206071033901": {
    altitude: -5.0,
    vertical_datum: "NAVD88",
    datums: { NAVD88: -32.516 },
    note: "Charles River below the New Charles River Dam: USGS's -5 ft is a DEM estimate. The gage reads the Metropolitan District Commission datum, 106.68 ft below NAVD88, the surveyed altitude of the Charles River Dam gage (01104715) whose readings it shares; with it the water reads 4 cm below NOAA's Boston gauge (8443970) in its NAVD88, with 1 cm spread, over 1,678 shared readings in November 2026. Erratum `usgs-boston-dam-datums`.",
  },
  "422340071043201": {
    altitude: -5.0,
    vertical_datum: "NAVD88",
    datums: { NAVD88: -32.516 },
    note: "Mystic River below the Amelia Earhart Dam: USGS's -5 ft is a DEM estimate. The gage reads the Metropolitan District Commission datum, 106.68 ft below NAVD88, the surveyed altitude of the Charles River Dam gage (01104715) whose readings it shares; with it the water reads 5 cm below NOAA's Boston gauge (8443970) in its NAVD88, with 1 cm spread, over 335 shared readings in November 2026. Erratum `usgs-boston-dam-datums`.",
  },
  "423000088164401": {
    altitude: 789.71,
    vertical_datum: "NAVD88",
    datums: {},
    note: "Elizabeth Lake at Twin Lakes: gage height averages 794.0 ft against ground at 794.2 ft (USGS 3DEP), so the gage reads elevation and adding the 790 ft altitude counts it twice. Erratum `usgs-gage-reads-elevation`.",
  },
};

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
  altitude_method_code: string | null;
  /** In feet. */
  altitude_accuracy: number | null;
  vertical_datum: string | null;
}

interface Collection<T> {
  features: { id?: string; properties: T; geometry: { coordinates: number[] } | null }[];
  links?: { rel: string; href: string }[];
}

/**
 * A USGS station as listed, with the series its levels come from. They're kept
 * in the store's station list only; `stations.parquet` doesn't carry them.
 */
export type UsgsStation = ListedStation & {
  time_series_id: string;
  parameter_code: string;
  /** When the series began, so backfill doesn't ask for years before it. */
  series_begin: string | null;
  /** When a series that stopped reporting ended; null while it's live, so the list doesn't change with every refresh. */
  series_end: string | null;
  /** The site's altitude in meters where it gives no offsets, for the tidal judgment (`judge`). */
  ground_m?: number;
};

/** Every USGS-run site with a water-level series, each with its preferred one. */
export async function stations(previous: Station[] = []): Promise<UsgsStation[]> {
  const grounds = new Map(previous.map((p) => [p.id, (p as Partial<UsgsStation>).ground_m]));
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
          "id,monitoring_location_name,agency_code,site_type_code,state_name,country_code,hydrologic_unit_code,altitude,altitude_accuracy,altitude_method_code,vertical_datum",
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

  checkAltitudes([...locations.values()].map((f) => f.properties));
  const out: UsgsStation[] = [];
  for (const [id, s] of chosen) {
    const location = locations.get(id);
    if (!location?.geometry || location.properties.agency_code !== "USGS") continue;
    const kind = kindOf(location.properties, tidal.has(id));
    out.push(toStation(location.properties, location.geometry.coordinates, s, kind, grounds));
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Refuses a `monitoring-locations` reply that dropped or changed the fields
 * the offsets rest on, which would clear nearly every offset: more than 1 in
 * 30 sites with an altitude giving no method USGS used in November 2026
 * (about 1 in 130 then gave none), or more than 1 in 30 surveyed sites giving
 * no accuracy (none did). Up to 10 are allowed whatever the share, so a short
 * list with a gap or two isn't refused; a whole USGS reply holds about 13,500
 * altitudes, where the share decides.
 */
export function checkAltitudes(
  locations: Pick<ApiLocation, "altitude" | "altitude_method_code" | "altitude_accuracy">[],
): void {
  const limit = (n: number) => Math.max(10, n / 30);
  const altitudes = locations.filter((l) => typeof l.altitude === "number");
  const unknown = altitudes.filter((l) => !METHODS.has(l.altitude_method_code ?? "")).length;
  if (unknown > limit(altitudes.length))
    throw new Error(
      `USGS gave no known altitude method for ${unknown} of ${altitudes.length} sites with an altitude`,
    );
  const surveys = altitudes.filter((l) => SURVEYED.has(l.altitude_method_code ?? ""));
  const unrated = surveys.filter((l) => typeof l.altitude_accuracy !== "number").length;
  if (unrated > limit(surveys.length))
    throw new Error(
      `USGS gave no altitude accuracy for ${unrated} of ${surveys.length} surveyed sites with an altitude`,
    );
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
 * A station's kind, from what USGS itself says about the site: its site type,
 * and whether it measures a tidal-only parameter or computes daily tidal highs
 * and lows there. Whether a stream is tidal is otherwise left to whoever reads
 * the levels; a guess here would set QC's flatline rule on a hunch.
 */
export function kindOf(location: Pick<ApiLocation, "site_type_code">, tidal: boolean): Kind {
  const type = location.site_type_code ?? "";
  if (type === "OC" || type === "OC-CO") return "coastal";
  if (type === "ES" || type === "ST-TS" || tidal) return "estuary";
  // Lakes, reservoirs and impoundments, and wetlands, whose water sits still.
  if (type === "LK" || type === "WE") return "lake";
  // Streams, canals, ditches, springs and facilities such as diversions.
  return "river";
}

/**
 * The CRMS gauge a USGS site relays, named for it, such as `CRMS0282-H01-RT`;
 * a bare site, `CRMS0641`, is its first surface-water gauge.
 */
export function crmsOf(name: string): string[] {
  const match = /^CRMS(\d{4})(-H0\d)?(-RT)?$/.exec(name.trim());
  return match ? [`crms/CRMS${match[1]}${match[2] ?? "-H01"}`] : [];
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
  grounds: Map<string, number | undefined> = new Map(),
): UsgsStation {
  const site = location.id.replace(/^USGS-/, "");
  const datum = DATUM_OF.get(series.parameter_code)!;
  let datums: Record<string, number> = {};
  let noDatums = false;
  // Gage height plus the gage datum's altitude is the level in that vertical datum.
  const vertical = location.vertical_datum ? VERTICAL_DATUMS[location.vertical_datum] : undefined;
  const decided = GAGE_DATUMS[site];
  const surveyed = isSurveyed(location);
  if (decided && datum !== GAGE)
    console.warn(`usgs/${site}: GAGE_DATUMS has a decision, but its series is in ${datum}`);
  // An answer with no altitude and no method is more likely a gap, and keeps the stored offsets.
  const gap = typeof location.altitude !== "number" && !location.altitude_method_code;
  if (datum === GAGE && decided && !gap) {
    if (
      decided.altitude === location.altitude &&
      decided.vertical_datum === location.vertical_datum
    )
      datums = { ...decided.datums };
    else
      console.warn(
        `usgs/${site}: USGS lists its altitude as ${location.altitude} ft ${location.vertical_datum}, not the ${decided.altitude} ft ${decided.vertical_datum} GAGE_DATUMS decided against, so it has no offsets`,
      );
    noDatums = !Object.keys(datums).length;
  } else if (datum === GAGE && surveyed && vertical && typeof location.altitude === "number")
    datums[vertical] = Math.round(location.altitude * FEET * 1000) / 1000 + 0; // + 0 turns -0 into 0
  // An unsurveyed altitude, or an unsurveyed method with no altitude, says the stored offsets aren't the gage's zero.
  // A survey method with the altitude missing is a gap too, and keeps them.
  else if (datum === GAGE && !decided && !gap)
    noDatums =
      typeof location.altitude === "number"
        ? !surveyed
        : !SURVEYED.has(location.altitude_method_code ?? "");
  // The ground's altitude still says how far above the sea the site is, for the tidal judgment.
  // An answer with no altitude keeps the ground the store held.
  const ground =
    noDatums && vertical && typeof location.altitude === "number"
      ? Math.round(location.altitude * FEET * 1000) / 1000 + 0
      : typeof location.altitude !== "number"
        ? (grounds.get(`usgs/${site}`) ?? null)
        : null;
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
    ...(noDatums && { no_datums: true }),
    ...(ground !== null && { ground_m: ground }),
    products: ["levels"],
    first: null,
    last: null,
    tide_station: null,
    same_as: crmsOf(location.monitoring_location_name),
    status: "active",
    live,
    min_interval_s: 900,
    source_url: `https://waterdata.usgs.gov/monitoring-location/${location.id}/`,
    time_series_id: series.id,
    parameter_code: series.parameter_code,
    series_begin: series.begin,
    series_end: live ? null : series.end,
  };
}

/** The part of [start, end) the station's series covers, or null when it covers none of it. */
export function within(station: Station, start: Date, end: Date): [Date, Date] | null {
  const s = station as Station & Partial<UsgsStation>;
  const from = s.series_begin
    ? Math.max(start.getTime(), Date.parse(s.series_begin))
    : start.getTime();
  // The end is inclusive, so a value stamped at it is kept.
  const to = s.series_end ? Math.min(end.getTime(), Date.parse(s.series_end) + 1) : end.getTime();
  return from < to ? [new Date(from), new Date(to)] : null;
}

interface Value {
  time: string;
  value: string | null;
  approval_status: string | null;
  qualifier: (string | null)[] | string | null;
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
      // One station listed in another datum fails alone, not the sweep.
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
 * A station kept against one series or gage zero, now listed against
 * another: a different `time_series_id` (USGS made another series primary, or
 * reissued it), or a gage datum that moved against its vertical datum. Either
 * way the stored values and new ones aren't measured from the same zero.
 */
export function seriesChanged(committed: Station, listed: ListedStation): string | null {
  const [was, now] = [committed, listed] as unknown as Partial<UsgsStation>[];
  if (was!.time_series_id && now!.time_series_id && was!.time_series_id !== now!.time_series_id)
    return `series ${was!.time_series_id} is now ${now!.time_series_id}`;
  // A decided gage datum corrects the offset; the zero itself didn't move. A
  // real move shows as USGS listing another altitude, which sets the decision
  // aside and opens an epoch for a person to decide.
  if (committed.datum !== GAGE) return null;
  const decided = GAGE_DATUMS[listed.source_id];
  if (decided) {
    // A decision set aside while the store holds its offsets: the zero may have moved.
    const setAside =
      listed.no_datums &&
      Object.entries(decided.datums).some(([name, offset]) => committed.datums[name] === offset);
    return setAside ? "USGS lists another altitude than GAGE_DATUMS decided against" : null;
  }
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
  // A list can hold nulls, as at 01097480 in 2008.
  return (Array.isArray(q) ? q : [q])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.toUpperCase());
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
  const statuses = [...text.matchAll(/"approval_status"\s*:\s*("[^"]*"|null)/g)].map((m) => m[1]);
  return statuses.length > 0 && statuses.every((status) => status === '"Approved"');
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
 * the window ages out. Every client shares one key, a run's backfill beside the
 * poller's sweeps, each about 30 requests every 15 minutes. So requests that go
 * out start `requestMs` apart (cache hits don't wait), 4.8 seconds, about 750
 * an hour, which leaves a quarter of the limit for the sweeps. A 429 holds every request for as long as
 * it waits: `fetchText` retries one with a Retry-After of a minute or less, or
 * none, after a backoff, up to three times; past those, or for a longer
 * Retry-After, `request` waits as long as it asks (`blockedMs` without one)
 * and starts over, up to three rounds in all. The key in USGS_API_KEY goes in a
 * header, never the URL, so it stays out of logs and cache keys. Tests shrink
 * the waits.
 */
export const pacing = { requestMs: 4800, blockedMs: 15 * 60_000 };
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
      return await getJson<T>(url, {
        ...options,
        pace,
        throttled: hold,
        headers: key ? { "x-api-key": key } : {},
      });
    } catch (error) {
      if (attempt >= 3 || !String(error).includes("returned 429")) throw error;
      // fetchText's own retries are spent, or the API asked for more than a
      // minute: wait as long as it asks, and hold every other request back too.
      const asked = /retry after (\d+) s/.exec(String(error))?.[1];
      const wait = asked ? Math.min(Number(asked) * 1000 + 5000, 3_700_000) : pacing.blockedMs;
      hold(wait / 1000);
      await sleep(wait);
    }
  }
}

/** Holds every request, those already waiting for their slot too, until a 429's wait is over. */
function hold(seconds: number): void {
  blockedUntil = Math.max(blockedUntil, Date.now() + seconds * 1000);
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** Every request is for the station's own series, so one listed in another datum is refused. */
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
  observations: async (s: Station, start, end) => {
    const id = checked(s);
    const range = within(s, start, end);
    return range ? levels(id, ...range) : [];
  },
  recent,
};
