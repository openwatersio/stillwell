import { getJson, getText } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Overrides,
  type Source,
  type SourceMetadata,
  type Station,
} from "../../schema.ts";
import { unzip } from "../pegelonline/index.ts";

/**
 * Land Information New Zealand's (Toitū Te Whenua's) tsunami gauge network:
 * 1-minute sea levels from its open download API, one zip per day or year. See
 * README.md.
 */
const API = "https://sealevel-data.linz.govt.nz";

export const metadata: SourceMetadata = {
  id: "linz",
  name: "Toitū Te Whenua Land Information New Zealand (LINZ), tsunami gauge network",
  url: "https://www.linz.govt.nz/products-services/data/types-linz-data/sea-level-data/sea-level-data-downloads",
  license: {
    id: "CC-BY-3.0-NZ",
    name: "Creative Commons Attribution 3.0 New Zealand",
    url: "https://creativecommons.org/licenses/by/3.0/nz/",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "Land Information New Zealand",
  contact: {
    email: "customersupport@linz.govt.nz",
    url: "https://www.linz.govt.nz/contact-us",
  },
  terms:
    "Licensed under CC BY 3.0 NZ. Land Information New Zealand must be credited. LINZ does not quality-control the data and warns that the sensors drift, so it advises caution for long-term analysis. Changes in the store: rows LINZ marks missing or bad, or sets to a sensor-off value, are left out, and quality flags added.",
  // Each gauge's whole record is served against its own zero, as it was measured.
  archive: "previous",
  // Daily files appear 6 to 12 days after their day, in batches, so hourly ingest would find nothing.
  hourly: false,
  // A year's file replaces its daily files and marks as missing the sensor-off values they hold.
  finalizes: true,
};

/** The datum LINZ's levels are measured from: each sensor's own tide gauge zero (TG0). */
const DATUM = "ZERO";
/** The sensor whose files the store reads. Sensor 41 sits on another zero, about 14 cm higher at Wellington. */
const SENSOR = "40";
const DAY_MS = 86_400_000;
/** A year's file is cached once its year began this many years ago: LINZ issued 2019's in January 2022 and may reissue one. */
const CACHE_AFTER_YEARS = 4;

/** A LINZ gauge as listed, with the span of its sensor-40 files, which a backfill keeps to. */
export type LinzStation = ListedStation & { record_start: string; record_end: string | null };

interface GaugeData {
  gauge: string;
  description: string;
  datasets: { year: string; sensor: string }[];
}

/**
 * The gauges the API lists that have sensor 40 files. Cape Roberts and Scott
 * Base have only sensor `00`, in formats that change from year to year, which
 * this adapter doesn't read. A gauge whose README can't be read keeps the
 * entry in `previous`, or is left out when it has none.
 */
export async function stations(previous: Station[] = []): Promise<LinzStation[]> {
  const known = new Map(previous.map((s) => [s.id, s as LinzStation]));
  const { gauges } = await getJson<{ gauges: string[] }>(`${API}/api/listGauges`, {
    fresh: true,
    pace,
  });
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!gauges?.length) throw new Error("LINZ listed no gauges");
  const thisYear = new Date().getUTCFullYear();
  const out: LinzStation[] = [];
  for (const code of gauges) {
    if (!/^[A-Z]{4}$/.test(code)) throw new Error(`Not a LINZ gauge code: ${code}`);
    const data = await getJson<GaugeData>(`${API}/api/getGaugeData/${code}`, { fresh: true, pace });
    const years = data.datasets.filter((d) => d.sensor === SENSOR).map((d) => Number(d.year));
    if (years.some((y) => !Number.isInteger(y)))
      throw new Error(`LINZ ${code}: a dataset's year isn't a number`);
    const was = known.get(`linz/${code}`);
    if (!years.length) {
      // A gauge that had sensor 40 files and has none now is likelier a glitch than a closed gauge.
      console.warn(
        `  linz ${code}: no sensor ${SENSOR} files${was ? "; kept as listed" : ", so not listed"}`,
      );
      if (was) out.push(was);
      continue;
    }
    const first = Math.min(...years);
    const last = Math.max(...years);
    const readme = parseReadme(data.description);
    if (!readme) {
      console.warn(
        `  linz ${code}: README has no name or position${was ? "; kept as listed" : ""}`,
      );
      if (was) out.push(was);
      continue;
    }
    // Sensor 40 stopped before last year: Sumner closed in 2022.
    const active = last >= thisYear - 1;
    out.push({
      ...stationDefaults(metadata),
      id: `linz/${code}`,
      source_id: code,
      name: readme.name,
      lat: readme.lat,
      lon: readme.lon,
      country_code: "NZ",
      kind: "coastal",
      interval_s: 60,
      datum: DATUM,
      datums: readme.datums,
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      status: active ? "active" : "inactive",
      live: false,
      min_interval_s: null,
      source_url: `${API}/tidegauge/${code}/`,
      record_start: `${first}-01-01T00:00:00.000Z`,
      record_end: active ? null : `${last + 1}-01-01T00:00:00.000Z`,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** One coordinate such as `41° 17' 04"S`, which some READMEs write with a stray quote or no seconds mark. */
const COORDINATE = /(\d+)\D+?(\d+)(?:\D+?(\d+(?:\.\d+)?))?\D*?([NSEW])\b/g;

/**
 * A gauge's name, position and the chart datum offset its README states: the
 * `CD` line of a calibration's table of heights above gauge zero, or "Chart
 * Datum is X m below TG0". "Chart Datum is X m below BM" at a reference port
 * says nothing of where gauge zero is, so gives no offset.
 */
export function parseReadme(
  text: string,
): { name: string; lat: number; lon: number; datums: Record<string, number> } | null {
  const name = /^NAME:[ \t]*(.+?)\s*$/m.exec(text)?.[1];
  const at = text.indexOf("WGS-84 POSITION:");
  if (!name || at < 0) return null;
  let lat: number | undefined;
  let lon: number | undefined;
  for (const m of text
    .slice(at + 16, at + 120)
    .split(/NZTM|UTM/)[0]!
    .matchAll(COORDINATE)) {
    const isLat = m[4] === "N" || m[4] === "S";
    // The first of each is the position; a later number, such as a mistyped "CITM COORDINATES" line's, is not.
    if (isLat ? lat !== undefined : lon !== undefined) continue;
    const [deg, min, sec] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
    if (min >= 60 || sec >= 60) return null;
    const value = (deg + min / 60 + sec / 3600) * (m[4] === "S" || m[4] === "W" ? -1 : 1);
    if (isLat) lat = value;
    else lon = value;
  }
  if (lat === undefined || lon === undefined || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  const datums: Record<string, number> = {};
  const above = /^\s*CD\s*-\s*(\d+(?:\.\d+)?)\b/m.exec(text)?.[1];
  const below = /Chart Datum is (\d+(?:\.\d+)?)\s*m below TG0/i.exec(text)?.[1];
  // Millimeters, as LINZ gives them, so floating point doesn't leave 0.0000001.
  if (above) datums.CD = -Math.round(Number(above) * 1000) / 1000;
  else if (below) datums.CD = Math.round(Number(below) * 1000) / 1000;
  return { name, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, datums };
}

/**
 * Observed 1-minute levels in meters above the gauge's zero over [start, end),
 * from sensor 40's files, a UTC calendar year per listing: the year's zip when
 * LINZ has issued it, else each day's.
 */
export async function levels(
  sourceId: string,
  start: Date,
  end: Date,
  { record_start, record_end }: { record_start?: string | null; record_end?: string | null } = {},
): Promise<Observation[]> {
  if (!/^[A-Z]{4}$/.test(sourceId)) throw new Error(`Not a LINZ station: ${sourceId}`);
  const from = Math.max(start.getTime(), record_start ? Date.parse(record_start) : -Infinity);
  const to = Math.min(end.getTime(), record_end ? Date.parse(record_end) : Infinity);
  const out: Observation[] = [];
  for (let year = new Date(from).getUTCFullYear(); Date.UTC(year, 0, 1) < to; year++) {
    const names = await listing(sourceId, year);
    // A gauge's sensor 40 years run without a gap, so a past year in its record with no files is
    // an answer gone wrong, which backfill would take for a year with no data.
    if (!names.length && record_start && year < new Date().getUTCFullYear())
      throw new Error(`LINZ lists no files for ${sourceId} in ${year}`);
    const yearly = `${sourceId}_${SENSOR}_${year}.zip`;
    const files = names.includes(yearly)
      ? [yearly]
      : names.filter((n) => {
          const day = dayOf(n, sourceId, year);
          return day !== null && day + DAY_MS > from && day < to;
        });
    for (const name of files) {
      const final = name === yearly;
      const zip = await getText(`${API}/tidegauge/${sourceId}/${year}/${SENSOR}/${name}`, {
        base64: true,
        pace,
        // Only a year's file, once it is old enough that LINZ is unlikely to reissue it, is cached.
        fresh: !final || Date.UTC(year + CACHE_AFTER_YEARS, 0, 1) > Date.now(),
        timeout: 120,
      });
      for (const [file, csv] of await unzip(zip)) {
        if (!file.toLowerCase().endsWith(".csv")) continue;
        for (const o of parse(csv, sourceId, !final))
          if (o.time >= from && o.time < to) out.push(o);
      }
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** The names of a gauge's sensor-40 files for a year. */
async function listing(code: string, year: number): Promise<string[]> {
  const { files } = await getJson<{ files: { name: string }[] }>(
    `${API}/api/listDatasetFiles/${code}/${year}/${SENSOR}`,
    { fresh: true, pace },
  );
  if (!Array.isArray(files)) throw new Error(`LINZ ${code} ${year}: no file list`);
  return files.map((f) => f.name).filter(Boolean);
}

/** The UTC midnight a daily file's name `<code>_40_<year><day of year>.zip` gives, or null for any other file. */
function dayOf(name: string, code: string, year: number): number | null {
  const m = new RegExp(`^${code}_${SENSOR}_${year}(\\d{3})\\.zip$`).exec(name);
  const day = Number(m?.[1]);
  return m && day >= 1 && day <= 366 ? Date.UTC(year, 0, day) : null;
}

/**
 * The levels in one file. A daily file's rows are `WLGT,2019-04-20 00:00,5.251`,
 * a year's `WLGT,20190101,00:00:00,03.487`. LINZ writes a missing value as
 * `//.///` and marks a bad one with a trailing `/` (`47.80/`), and its daily
 * files hold 0.001 where a sensor was off, which the year's file replaces with
 * the missing mark (erratum `linz-sensor-off-values`); none of those are
 * levels, nor is a 0.000.
 */
export function parse(csv: string, code: string, daily: boolean): Observation[] {
  const flag = daily ? Flag.preliminary : Flag.good;
  const out: Observation[] = [];
  for (const line of csv.split("\n")) {
    const f = line.trim().split(",");
    if (f[0] !== code) continue;
    const [stamp, value] =
      f.length === 3 ? [f[1]!, f[2]!] : f.length === 4 ? [`${f[1]} ${f[2]}`, f[3]!] : [];
    const m = /^(\d{4})-?(\d{2})-?(\d{2}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(stamp ?? "");
    if (!m || !/^-?\d+(\.\d+)?$/.test(value!)) continue;
    const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const time = Date.UTC(y, mo - 1, d, h, mi, s);
    const at = new Date(time);
    // Date.UTC rolls 31 February over to March, so a date that doesn't read back isn't one.
    if (at.getUTCDate() !== d || at.getUTCMonth() !== mo - 1 || h > 23 || mi > 59 || s > 59)
      continue;
    const level = Number(value);
    if (level === 0 || (daily && level === 0.001)) continue;
    out.push({ time, level: Math.round(level * 1000) / 1000, flag });
  }
  return out;
}

/**
 * LINZ's servers sit behind a CDN and publish no rate limit; requests start a
 * second apart, as for the other open file services.
 */
export const pacing = { requestMs: 1000 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/**
 * Kaikoura's gauge was lifted 0.88 m by the earthquake of 14 November 2016
 * (NZDT; 13 November 11:02 UTC), which its README says, so its levels step down
 * by about 0.9 m (erratum `linz-kaikoura-uplift`). The chart datum offset its
 * README gives is from a 2017 calibration, after the lift.
 */
const overrides: Overrides = {
  epochs: {
    "linz/KAIT start": {
      to_current: -0.88,
      note: "The README says the station was uplifted 0.88 m, so a level before the lift is that much higher than the same water after it, and the daily means step by about 0.9 m (erratum `linz-kaikoura-uplift`).",
    },
  },
  splits: {
    "linz/KAIT": [
      {
        since: "2016-11-14",
        note: "Daily means step from about 3.4 m to 2.4 m across the Kaikoura earthquake of 13 November 2016, 11:02 UTC (erratum `linz-kaikoura-uplift`).",
      },
    ],
  },
};

export const source: Source = {
  metadata,
  overrides,
  stations,
  observations: (s, start, end) => levels(s.source_id, start, end, s as Partial<LinzStation>),
};
