import { getJson } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type Kind,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
} from "../../schema.ts";

/**
 * PEGELONLINE, the WSV's real-time gauge service. It keeps 31 days of raw water
 * levels in centimeters above gauge zero (PNP), at 1-minute resolution at tide
 * gauges. Longer records have to be collected by fetching on a schedule.
 */
const API = "https://www.pegelonline.wsv.de/webservices/rest-api/v2";

export const metadata: SourceMetadata = {
  id: "pegelonline",
  name: "PEGELONLINE (Wasserstraßen- und Schifffahrtsverwaltung des Bundes)",
  url: "https://www.pegelonline.wsv.de/",
  license: {
    id: "DL-DE-ZERO-2.0",
    name: "Datenlizenz Deutschland – Zero – Version 2.0",
    url: "https://www.pegelonline.wsv.de/gast/nutzungsbedingungen",
    commercial_use: true,
  },
  attribution: "Wasserstraßen- und Schifffahrtsverwaltung des Bundes (WSV), PEGELONLINE",
  // Central European time, standard or summer.
  utc_offsets: [1, 2],
  terms: "Raw, unchecked values.",
  window_days: 31,
};

export interface ApiStation {
  uuid: string;
  number: string;
  shortname: string;
  longname: string;
  latitude?: number;
  longitude?: number;
  water: { shortname: string };
  timeseries?: {
    shortname: string;
    unit: string;
    equidistance?: number;
    gaugeZero?: { unit: string; value: number; validFrom: string };
  }[];
}

/** Every station with a water-level (`W`) series, as the API lists it. */
export async function list(): Promise<ApiStation[]> {
  const stations = await getJson<ApiStation[]>(
    `${API}/stations.json?includeTimeseries=true&timeseries=W`,
    { fresh: true },
  );
  // Without a position there's nothing to place.
  return stations.filter((s) => s.latitude !== undefined && s.longitude !== undefined);
}

export async function stations(): Promise<ListedStation[]> {
  return (await list()).map(toStation).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Water levels in meters over [start, end), within the last 31 days, in the
 * series' own datum (see `UNITS`). `station` is a PEGELONLINE number or UUID.
 * With `datum`, throws if the series is now in another.
 */
export async function levels(
  station: string,
  start: Date,
  end: Date,
  datum?: string,
): Promise<Observation[]> {
  const unit = parseUnit(await unitOf(station), station);
  if (datum && unit.datum !== datum)
    throw new Error(`PEGELONLINE ${station} is now in ${unit.datum}, not ${datum}`);
  const { scale } = unit;
  const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  const values = await getJson<{ timestamp: string; value: number }[]>(
    `${API}/stations/${encodeURIComponent(station)}/W/measurements.json?${params}`,
    { fresh: true },
  );
  return values
    .map((v) => ({ time: Date.parse(v.timestamp), level: v.value * scale, flag: Flag.preliminary }))
    .filter((v) => v.time >= start.getTime() && v.time < end.getTime());
}

/** Series units: most are centimeters above gauge zero, some meters above NN. */
const UNITS: Record<string, { datum: string; scale: number }> = {
  cm: { datum: "PNP", scale: 0.01 },
  "m+PNP": { datum: "PNP", scale: 1 },
  "m+NN": { datum: "NN", scale: 1 },
};

function parseUnit(unit: string, station: string): { datum: string; scale: number } {
  const known = UNITS[unit];
  if (!known) throw new Error(`PEGELONLINE ${station} unit is ${unit}`);
  return known;
}

// The measurements endpoint doesn't say its unit, so ask the series once per
// station and process. A unit that moves the series to another datum also marks
// the station inactive at the next station refresh.
const units = new Map<string, Promise<string>>();

function unitOf(station: string): Promise<string> {
  let unit = units.get(station);
  if (!unit) {
    unit = getJson<{ unit: string }>(`${API}/stations/${encodeURIComponent(station)}/W.json`).then(
      (t) => t.unit,
    );
    units.set(station, unit);
  }
  return unit;
}

// The open sea; everything else in PEGELONLINE is a river, canal or lake.
const SEA = new Set(["NORDSEE", "OSTSEE"]);

/** A station missing its W series this time lists no datum, so it keeps the one it had. */
function toStation(s: ApiStation): ListedStation {
  const series = s.timeseries?.find((t) => t.shortname === "W");
  const levelDatum = series ? parseUnit(series.unit, s.number).datum : null;
  const zero = series?.gaugeZero;
  const datums: Record<string, number> = {};
  // Gauge zero is given as a height in another datum, e.g. "m. ü. NHN".
  const datum = zero && /\b(NHN|NN|HN)\b/.exec(zero.unit)?.[1];
  if (levelDatum === "PNP" && datum && zero.unit.startsWith("m")) datums[datum] = zero.value;
  const kind: Kind | null = SEA.has(s.water.shortname) ? "coastal" : null;
  // A gauge zero valid from another day is a moved zero; the day itself is left
  // out, since nobody says when in it the change came. The same date with
  // another height is a re-survey, which only changes `datums`.
  const validFrom = levelDatum === "PNP" ? zero?.validFrom?.slice(0, 10) : undefined;
  const reference = validFrom
    ? {
        id: validFrom,
        since: new Date(Date.parse(validFrom) + 86_400_000).toISOString().slice(0, 10),
      }
    : null;
  return {
    ...stationDefaults(metadata),
    id: `pegelonline/${s.number}`,
    source_id: s.number,
    name: s.longname,
    lat: s.latitude!,
    lon: s.longitude!,
    country_code: "DE",
    kind,
    interval_s: series?.equidistance ? series.equidistance * 60 : null,
    datum: levelDatum,
    datums,
    products: ["levels"],
    first: null,
    last: null,
    tide_station: null,
    same_as: [],
    status: "active",
    live: true,
    min_interval_s: 300,
    source_url: `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${s.number}`,
    reference,
  };
}

export const source: Source = {
  metadata,
  stations,
  observations: (s, start, end) => levels(s.source_id, start, end, s.datum),
};
