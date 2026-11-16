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
    "Licensed under CC BY 3.0 NZ. Land Information New Zealand must be credited. LINZ does not quality-control the data and warns that the sensors drift, so it advises caution for long-term analysis. Changes in the store: rows LINZ marks missing or bad, or sets to a sensor-off value, are left out; over spans where sensor 40 is stuck, erratic or missing, sensor 41's levels stand in, or nothing is read where both are stuck; Napier's levels before a step in 2008 are converted to the later zero by the API; datum steps are converted by what UHSLC's records measure at Wellington, Port Chalmers, Tauranga and Gisborne, and those gauges' minutes between a step and the next day are left out; and quality flags are added. The source's errata list each span and step.",
  // Each gauge's whole record is served against its own zero, as it was measured.
  archive: "previous",
  // Daily files appear 6 to 12 days after their day, in batches, so hourly ingest would find nothing.
  hourly: false,
  // A year's file replaces its daily files and marks as missing the sensor-off values they hold.
  finalizes: true,
};

/** The datum LINZ's levels are measured from: each sensor's own tide gauge zero (TG0). */
const DATUM = "ZERO";
/** The sensor whose files the store reads. Sensor 41 sits on a zero of its own, and the two drift apart by 0.3 to 1.5 m at some gauges (README). */
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
    const years = (data.datasets ?? [])
      .filter((d) => d.sensor === SENSOR)
      .map((d) => Number(d.year));
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
 * `CD` line of a calibration's table of heights above gauge zero, where no
 * sensors were replaced since, or "Chart Datum is X m below TG0". "Chart Datum is X m below BM" at a reference port
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
  // A calibration's offset is for the zero of the sensors then, so it isn't kept once the
  // README lists sensors replaced in that year or later.
  const calibrated = Number(/Results of (\d{4}) calibration/.exec(text)?.[1]);
  const replaced = [...text.matchAll(/^\s*(\d{4}):.*\breplaced\b/gim)].map((m) => Number(m[1]));
  if (above && !replaced.some((y) => y >= calibrated))
    datums.CD = -Math.round(Number(above) * 1000) / 1000;
  else if (below) datums.CD = Math.round(Number(below) * 1000) / 1000;
  return { name, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, datums };
}

/**
 * Observed 1-minute levels in meters above the gauge's zero over [start, end),
 * from sensor 40's files, except over the spans of `SENSOR_41`, where sensor 41's
 * stand in or nothing is read. A UTC calendar year per listing: the year's zip
 * when LINZ has issued it, else each day's.
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
  const spans = SENSOR_41[sourceId] ?? [];
  const out: Observation[] = [];
  for (let year = new Date(from).getUTCFullYear(); Date.UTC(year, 0, 1) < to; year++) {
    const yearStart = Date.UTC(year, 0, 1);
    const yearEnd = Date.UTC(year + 1, 0, 1);
    // Sensor 40's files are read only outside the spans, so a year inside one lists and downloads none.
    const stretches = outside(spans, Math.max(from, yearStart), Math.min(to, yearEnd));
    if (stretches.length) {
      const names = await listing(sourceId, SENSOR, year);
      // A gauge's sensor 40 years run without a gap, so a past year in its record with no files is
      // an answer gone wrong, which backfill would take for a year with no data.
      if (!names.length && record_start && year < new Date().getUTCFullYear())
        throw new Error(`LINZ lists no files for ${sourceId} in ${year}`);
      for (const o of await sensorLevels(sourceId, SENSOR, year, names, stretches)) out.push(o);
    }
    let names41: string[] | undefined;
    for (const s of spans) {
      const a = Math.max(from, Date.parse(s.from), yearStart);
      const b = Math.min(to, Date.parse(s.to), yearEnd);
      if (s.sensor !== "41" || a >= b) continue;
      names41 ??= await listing(sourceId, "41", year);
      if (!names41.length)
        throw new Error(`LINZ lists no sensor 41 files for ${sourceId} in ${year}`);
      // Pushed one by one: a year's minutes are more than a spread's arguments can hold.
      for (const o of await sensorLevels(sourceId, "41", year, names41, [[a, b]])) out.push(o);
    }
  }
  return out.sort((a, b) => a.time - b.time);
}

/** `[from, to)` less the spans, as the stretches left. */
function outside(
  spans: { from: string; to: string }[],
  from: number,
  to: number,
): [number, number][] {
  let parts: [number, number][] = from < to ? [[from, to]] : [];
  for (const s of spans) {
    const a = Date.parse(s.from);
    const b = Date.parse(s.to);
    parts = parts.flatMap(([x, y]): [number, number][] =>
      a >= y || b <= x
        ? [[x, y]]
        : (
            [
              [x, Math.min(y, a)],
              [Math.max(x, b), y],
            ] as [number, number][]
          ).filter(([p, q]) => q > p),
    );
  }
  return parts;
}

/**
 * A sensor's levels within any of `ranges` (`[from, to)`) from one year's files:
 * the year's file if LINZ has issued it, else each day's, each read once.
 */
async function sensorLevels(
  code: string,
  sensor: string,
  year: number,
  names: string[],
  ranges: [number, number][],
): Promise<Observation[]> {
  const out: Observation[] = [];
  const yearly = `${code}_${sensor}_${year}.zip`;
  const files = names.includes(yearly)
    ? [yearly]
    : names.filter((n) => {
        const day = dayOf(n, code, sensor, year);
        return day !== null && ranges.some(([from, to]) => day + DAY_MS > from && day < to);
      });
  for (const name of files) {
    const final = name === yearly;
    const zip = await getText(`${API}/tidegauge/${code}/${year}/${sensor}/${name}`, {
      base64: true,
      pace,
      // Only a year's file, once it is old enough that LINZ is unlikely to reissue it, is cached.
      fresh: !final || Date.UTC(year + CACHE_AFTER_YEARS, 0, 1) > Date.now(),
      timeout: 120,
    });
    for (const [file, csv] of await unzip(zip)) {
      if (!file.toLowerCase().endsWith(".csv")) continue;
      for (const o of parse(csv, code, !final))
        if (ranges.some(([from, to]) => o.time >= from && o.time < to)) out.push(o);
    }
  }
  return out;
}

/** The names of a gauge's files for a sensor and year. */
async function listing(code: string, sensor: string, year: number): Promise<string[]> {
  const { files } = await getJson<{ files: { name: string }[] }>(
    `${API}/api/listDatasetFiles/${code}/${year}/${sensor}`,
    { fresh: true, pace },
  );
  if (!Array.isArray(files)) throw new Error(`LINZ ${code} ${year}: no file list`);
  return files.map((f) => f.name).filter(Boolean);
}

/** The UTC midnight a daily file's name `<code>_<sensor>_<year><day of year>.zip` gives, or null for any other file. */
function dayOf(name: string, code: string, sensor: string, year: number): number | null {
  const m = new RegExp(`^${code}_${sensor}_${year}(\\d{3})\\.zip$`).exec(name);
  const day = Number(m?.[1]);
  return m && day >= 1 && day <= 366 ? Date.UTC(year, 0, day) : null;
}

/**
 * UTC spans, `from` to before `to`, over which sensor 40 is stuck, erratic or
 * missing while sensor 41 reads a tide whose level is within 0.25 m of sensor
 * 40's healthy levels on each side; the store reads sensor 41 over them (the
 * `linz-*-sensor-fault` errata). A null sensor reads neither: both are stuck,
 * or the first minutes after a step in the zero, which the epoch split can't
 * place (erratum `linz-napier-step-2008`).
 */
export const SENSOR_41: Record<string, { from: string; to: string; sensor: "41" | null }[]> = {
  AUCT: [{ from: "2012-11-19", to: "2012-11-27", sensor: "41" }],
  CHIT: [{ from: "2008-11-25", to: "2010-02-17", sensor: "41" }],
  CPIT: [
    { from: "2012-01-29", to: "2012-03-31", sensor: "41" },
    { from: "2019-07-26", to: "2021-07-26", sensor: "41" },
  ],
  GIST: [{ from: "2021-05-11T23:56:00Z", to: "2021-05-12", sensor: null }],
  NAPT: [
    { from: "2008-02-24T18:51:00Z", to: "2008-02-25", sensor: null },
    { from: "2010-02-07", to: "2010-03-05", sensor: "41" },
  ],
  NCPT: [
    { from: "2011-07-07", to: "2011-09-22", sensor: "41" },
    { from: "2011-09-22", to: "2011-10-06", sensor: null },
    { from: "2011-10-06", to: "2012-02-20", sensor: "41" },
    { from: "2012-12-13", to: "2013-03-04", sensor: "41" },
    { from: "2013-11-17", to: "2014-01-23", sensor: "41" },
  ],
  SUMT: [{ from: "2016-06-28", to: "2022-04-02", sensor: "41" }],
  TAUT: [{ from: "2024-03-20T23:17:00Z", to: "2024-03-21", sensor: null }],
  WLGT: [
    { from: "2014-12-23", to: "2015-01-10", sensor: "41" },
    { from: "2021-04-15T21:56:00Z", to: "2021-04-16", sensor: null },
  ],
};

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
    "linz/WLGT start": {
      to_current: -0.64,
      note: "Wellington's zero stepped down 0.26 m on 30 May 2012 and 0.38 m on 16 April 2021, so a level before the first is 0.64 m higher than the same water now (errata `linz-wellington-step-2012` and `linz-wellington-step-2021`).",
    },
    "linz/WLGT 2012-05-30T00:00:00Z": {
      to_current: -0.38,
      note: "A level between the two steps is 0.38 m higher than the same water since 16 April 2021 (erratum `linz-wellington-step-2021`).",
    },
    "linz/GIST start": {
      to_current: -1.53,
      note: "Gisborne's zero stepped down 0.57 m on 26 September 2013, 0.41 m on 12 May 2021 and 0.54 m on 13 December 2024, so a level before the first is 1.53 m higher than the same water now (errata `linz-gisborne-step-2013`, `linz-gisborne-step-2021` and `linz-gisborne-step-2024`).",
    },
    "linz/GIST 2013-09-26T00:00:00Z": {
      to_current: -0.95,
      note: "A level between the first two steps and the last is 0.95 m higher than the same water now (errata `linz-gisborne-step-2021` and `linz-gisborne-step-2024`).",
    },
    "linz/GIST 2021-05-12T00:00:00Z": {
      to_current: -0.54,
      note: "A level between the last two steps is 0.54 m higher than the same water since 13 December 2024 (erratum `linz-gisborne-step-2024`).",
    },
    "linz/OTAT start": {
      to_current: -0.56,
      note: "Port Chalmers' zero stepped down 0.56 m on 26 May 2021, when its sensors were replaced (erratum `linz-port-chalmers-step-2021`).",
    },
    "linz/TAUT start": {
      to_current: -0.47,
      note: "Tauranga's zero stepped down 0.47 m on 20 March 2024 (erratum `linz-tauranga-step-2024`).",
    },
    "linz/NAPT start": {
      to_current: -0.344,
      note: "The README lists a \"step in data on February 25\" 2008, at 18:51 UTC on 24 February after a gap in the record. Both sensors' levels fall 0.34 to 0.37 m against UHSLC's hourly Napier, so a level before the step is 0.344 m higher than the same water after it (erratum `linz-napier-step-2008`).",
    },
    "linz/KAIT start": {
      to_current: -0.88,
      note: "The README says the station was uplifted 0.88 m, so a level before the lift is that much higher than the same water after it, and the daily means step by about 0.9 m (erratum `linz-kaikoura-uplift`).",
    },
  },
  splits: {
    "linz/GIST": [
      {
        since: "2013-09-26",
        note: "Gisborne's levels fall 0.57 m against UHSLC's hourly Gisborne (`078b`) between 20:48 UTC on 25 September 2013 and 03:23 on the 26th, a gap in the record (erratum `linz-gisborne-step-2013`).",
      },
      {
        since: "2021-05-12",
        note: "Gisborne's levels fall 0.41 m against UHSLC's hourly Gisborne from 23:56 UTC on 11 May 2021, after a gap, and a split starts on a whole day, so the four minutes before midnight are left out (erratum `linz-gisborne-step-2021`).",
      },
      {
        since: "2024-12-13",
        note: "Gisborne's levels fall 0.54 m against UHSLC's hourly Gisborne, and the file for 13 December 2024 is the first after a gap that began before 12 December (erratum `linz-gisborne-step-2024`).",
      },
    ],
    "linz/GBIT": [
      {
        since: "2024-09-10",
        note: "Korotiti Bay's sensors were replaced on 11 September 2024 (NZ time), and both read about 0.8 m lower from 21:39 UTC on the 10th, when the day's file begins, after a gap. No other record of the gauge gives the step's size, so the earlier epoch has no `to_current` (erratum `linz-korotiti-bay-step-2024`).",
      },
    ],
    "linz/OTAT": [
      {
        since: "2021-05-26",
        note: "Port Chalmers' sensors were replaced on 26 May 2021, and levels from 03:00 UTC on the 26th, after a gap, are 0.56 m lower against UHSLC's hourly Port Chalmers (erratum `linz-port-chalmers-step-2021`).",
      },
    ],
    "linz/TAUT": [
      {
        since: "2024-03-21",
        note: "Tauranga's levels fall 0.47 m against UHSLC's hourly Tauranga from 23:17 UTC on 20 March 2024, after a gap, and a split starts on a whole day, so that evening's minutes are left out (erratum `linz-tauranga-step-2024`).",
      },
    ],
    "linz/WLGT": [
      {
        since: "2012-05-30",
        note: "Wellington's sensors were replaced on 30 May 2012, and levels fall 0.26 m against UHSLC's hourly Wellington between 22:54 UTC on the 29th and 00:02 on the 30th (erratum `linz-wellington-step-2012`).",
      },
      {
        since: "2021-04-16",
        note: "Wellington's levels fall 0.38 m against UHSLC's hourly Wellington from 21:56 UTC on 15 April 2021, after a gap, and a split starts on a whole day, so the two hours after it are left out (erratum `linz-wellington-step-2021`).",
      },
    ],
    "linz/NAPT": [
      {
        since: "2008-02-25",
        note: "TG0 stepped down 0.344 m at 18:51 UTC on 24 February 2008, and a split starts on a whole day, so the five hours after the step are left out (erratum `linz-napier-step-2008`).",
      },
    ],
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
