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
    "Licensed under CC BY 3.0 NZ. Land Information New Zealand must be credited. LINZ does not quality-control the data and warns that the sensors drift, so it advises caution for long-term analysis. Changes in the store: rows LINZ marks missing or bad, or sets to a sensor-off value, are left out; over spans where sensor 40 is stuck, erratic or missing, sensor 41's levels stand in, or nothing is read where both are stuck; Napier's levels before a step in 2008 are converted to the later zero by the API; datum steps are converted by what UHSLC's records measure at Wellington, Port Chalmers, Tauranga and Gisborne, and those gauges' minutes between a step and the next day are left out; Cape Roberts' and Scott Base's times are converted to UTC and Scott Base's levels from millimeters to meters, and their rows that aren't levels, repeat or disagree, and the spans where a gauge read no sea level, are left out; and quality flags are added. The source's errata list each span and step.",
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
/**
 * Cape Roberts and Scott Base, LINZ's two Antarctic gauges, have only sensor
 * `00` files, in formats that change from year to year (README).
 */
const ANTARCTIC = new Set(["ROBT", "SCOT"]);
const sensorOf = (code: string): string => (ANTARCTIC.has(code) ? "00" : SENSOR);
/**
 * Scott Base's gauge was removed on 5 March 2026 (its README), so its record
 * ends there, though its last year is the current one. The end is exclusive: its
 * last level is 23:49 UTC on 4 March.
 */
const CLOSED: Record<string, string> = { SCOT: "2026-03-05T00:00:00.000Z" };
/** Gauges whose files label times ahead of UTC, so a UTC year's last hours are in the next year's file. */
const AHEAD = new Set(["SCOT"]);
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
 * The gauges the API lists that have sensor 40 files, and the two Antarctic
 * gauges, which have sensor `00` files. A gauge whose README can't be read keeps
 * the entry in `previous`, or is left out when it has none.
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
    const sensor = sensorOf(code);
    const years = (data.datasets ?? [])
      .filter((d) => d.sensor === sensor)
      .map((d) => Number(d.year));
    if (years.some((y) => !Number.isInteger(y)))
      throw new Error(`LINZ ${code}: a dataset's year isn't a number`);
    const was = known.get(`linz/${code}`);
    if (!years.length) {
      // A gauge that had sensor 40 files and has none now is likelier a glitch than a closed gauge.
      console.warn(
        `  linz ${code}: no sensor ${sensor} files${was ? "; kept as listed" : ", so not listed"}`,
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
    const closed = CLOSED[code];
    const active = !closed && last >= thisYear - 1;
    out.push({
      ...stationDefaults(metadata),
      id: `linz/${code}`,
      source_id: code,
      name: readme.name,
      lat: readme.lat,
      lon: readme.lon,
      country_code: ANTARCTIC.has(code) ? "AQ" : "NZ",
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
      record_end: active ? null : (closed ?? `${last + 1}-01-01T00:00:00.000Z`),
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
 * when LINZ has issued it, else each day's. The Antarctic gauges' sensor `00`
 * files are read the same way, with their clocks and units settled in `atGauge`.
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
  const sensor = sensorOf(sourceId);
  const out: Observation[] = [];
  for (let year = new Date(from).getUTCFullYear(); Date.UTC(year, 0, 1) < to; year++) {
    const yearStart = Date.UTC(year, 0, 1);
    const yearEnd = Date.UTC(year + 1, 0, 1);
    // A day's Antarctic file ends with the next day's first row, so the year's last one holds January 1's.
    const slack = ANTARCTIC.has(sourceId) ? 5 * 60_000 : 0;
    // Sensor 40's files are read only outside the spans, so a year inside one lists and downloads none.
    const stretches = outside(spans, Math.max(from, yearStart), Math.min(to, yearEnd + slack));
    if (stretches.length) {
      const names = await listing(sourceId, sensor, year);
      // A gauge's sensor 40 years run without a gap, so a past year in its record with no files is
      // an answer gone wrong, which backfill would take for a year with no data.
      if (!names.length && record_start && year < new Date().getUTCFullYear())
        throw new Error(`LINZ lists no files for ${sourceId} in ${year}`);
      for (const o of await sensorLevels(sourceId, sensor, year, names, stretches)) out.push(o);
      // Scott Base's labels run up to 13 hours ahead of UTC, so the next year's file begins in this one.
      if (
        AHEAD.has(sourceId) &&
        Math.min(to, yearEnd) > yearEnd - 14 * 3_600_000 &&
        yearEnd < Date.parse(record_end ?? "9999")
      ) {
        const next = await listing(sourceId, sensor, year + 1);
        for (const o of await sensorLevels(sourceId, sensor, year + 1, next, stretches))
          out.push(o);
      }
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
  out.sort((a, b) => a.time - b.time);
  return ANTARCTIC.has(sourceId) ? unrepeated(out) : out;
}

/**
 * A level once for each minute. The Antarctic files repeat rows (all of Cape
 * Roberts' 31 December 2021, Scott Base's 24 and 25 January 2017), mostly with
 * the same level; where two levels disagree for one minute neither is known to be
 * right, so neither is kept (erratum `linz-antarctic-file-rows`).
 */
function unrepeated(sorted: Observation[]): Observation[] {
  const out: Observation[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i + 1;
    while (j < sorted.length && sorted[j]!.time === sorted[i]!.time) j++;
    if (sorted.slice(i, j).every((o) => o.level === sorted[i]!.level)) out.push(sorted[i]!);
    i = j;
  }
  return out;
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
 * the year's file if LINZ has issued it, else each day's or the months' it
 * names, each read once.
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
        const span = fileSpan(n, code, sensor, year);
        // Scott Base's labels run up to 13 hours ahead of UTC, and a day's Cape Roberts file ends with the next day's first row.
        const margin = AHEAD.has(code) ? 13 * 3_600_000 : ANTARCTIC.has(code) ? 5 * 60_000 : 0;
        return (
          span && ranges.some(([from, to]) => span[1] + margin > from && span[0] - margin < to)
        );
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
      for (const row of parse(csv, code, !final)) {
        const o = atGauge(code, row);
        if (o && ranges.some(([from, to]) => o.time >= from && o.time < to)) out.push(o);
      }
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

/**
 * The label days `[from, to)` a file's name covers: `<code>_<sensor>_<year><day of year>.zip`
 * is one day, `<code>_<sensor>_<year>_<first month>-<last month>.zip` (Scott Base's
 * `SCOT_00_2026_01-03.zip`) is those months, and any other file, such as the year's, is null.
 */
function fileSpan(
  name: string,
  code: string,
  sensor: string,
  year: number,
): [number, number] | null {
  const day = new RegExp(`^${code}_${sensor}_${year}(\\d{3})\\.zip$`).exec(name);
  const n = Number(day?.[1]);
  if (day) return n >= 1 && n <= 366 ? [Date.UTC(year, 0, n), Date.UTC(year, 0, n + 1)] : null;
  const months = new RegExp(`^${code}_${sensor}_${year}_(\\d{2})-(\\d{2})\\.zip$`).exec(name);
  const [m1, m2] = [Number(months?.[1]), Number(months?.[2])];
  return months && m1 >= 1 && m2 >= m1 && m2 <= 12
    ? [Date.UTC(year, m1 - 1, 1), Date.UTC(year, m2, 1)]
    : null;
}

/**
 * UTC spans, `from` to before `to`, over which sensor 40 is stuck, erratic or
 * missing while sensor 41 reads a tide whose level is within 0.25 m of sensor
 * 40's healthy levels on each side; the store reads sensor 41 over them (the
 * `linz-*-sensor-fault` errata). A null sensor reads neither: both are stuck,
 * the first minutes after a step in the zero, which the epoch split can't
 * place (erratum `linz-napier-step-2008`), or the Antarctic gauges' sensor `00`
 * reads no sea level (the `linz-cape-roberts-*` and `linz-scott-base-*` errata).
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
  // Cape Roberts and Scott Base have no sensor 41; these are spans where the one
  // sensor reads no sea level, or the minutes after a step in its zero up to the
  // whole day an epoch can start on.
  ROBT: [
    { from: "2009-12-04T03:00:00Z", to: "2010-01-01", sensor: null },
    { from: "2019-02-03T03:00:00Z", to: "2019-02-04", sensor: null },
    { from: "2021-03-16T21:00:00Z", to: "2021-11-06T06:00:00Z", sensor: null },
  ],
  SCOT: [
    { from: "2016-01-01", to: "2016-02-02T04:00:00Z", sensor: null },
    { from: "2016-02-28T23:00:00Z", to: "2016-03-29", sensor: null },
    { from: "2018-12-13T09:00:00Z", to: "2018-12-18T20:00:00Z", sensor: null },
    { from: "2019-02-24T12:00:00Z", to: "2019-11-03T02:00:00Z", sensor: null },
    { from: "2020-01-25T06:00:00Z", to: "2020-05-12T04:10:00Z", sensor: null },
    { from: "2021-03-16T19:00:00Z", to: "2021-11-17T02:00:00Z", sensor: null },
    { from: "2022-03-06T08:00:00Z", to: "2022-03-08T02:00:00Z", sensor: null },
    { from: "2024-05-09T21:00:00Z", to: "2024-05-10T03:00:00Z", sensor: null },
    { from: "2025-03-09T01:00:00Z", to: "2025-11-20T01:00:00Z", sensor: null },
  ],
  SUMT: [{ from: "2016-06-28", to: "2022-04-02", sensor: "41" }],
  TAUT: [{ from: "2024-03-20T23:17:00Z", to: "2024-03-21", sensor: null }],
  WLGT: [
    { from: "2014-12-23", to: "2015-01-10", sensor: "41" },
    { from: "2021-04-15T21:56:00Z", to: "2021-04-16", sensor: null },
  ],
};

/**
 * The levels in one file, with times as the file labels them. A daily file's rows
 * are `WLGT,2019-04-20 00:00,5.251`, a year's `WLGT,20190101,00:00:00,03.487`.
 * LINZ writes a missing value as `//.///` and marks a bad one with a trailing `/`
 * (`47.80/`), and its daily files hold 0.001 where a sensor was off, which the
 * year's file replaces with the missing mark (erratum `linz-sensor-off-values`);
 * none of those are levels, nor is a 0.000. The Antarctic files add layouts, and
 * their rows are kept only where every field is where its layout puts it (erratum
 * `linz-antarctic-file-rows`):
 *
 * - `ROBT,20110101,0:00:00,5.345,30,-2.338,993.15`: code, date, time, level, then
 *   the samples in the five minutes, temperature and pressure, repeated in 2010's;
 * - `2024,1,1000,30,5.676,-3.458,973.02`: year, day of the year, hour and minute
 *   as one number, samples, level, temperature, pressure;
 * - `2023-01-01,00:00:00,2.504` and `1/01/2025,00:00:00,3162`: date, time, level,
 *   in meters or millimeters (`atGauge` says which).
 */
export function parse(csv: string, code: string, daily: boolean): Observation[] {
  const flag = daily ? Flag.preliminary : Flag.good;
  const out: Observation[] = [];
  for (const line of csv.split("\n")) {
    const f = line
      .trim()
      .split(",")
      .map((x) => x.trim());
    let stamp: string | undefined;
    let value: string | undefined;
    if (f[0] === code) {
      if (f.length === 3) [stamp, value] = [f[1], f[2]];
      else if ([4, 7, 10].includes(f.length)) [stamp, value] = [`${f[1]} ${f[2]}`, f[3]];
    } else if (/^\d{4}$/.test(f[0]!) && f.length === 7) {
      const [year, day, hhmm] = [Number(f[0]), Number(f[1]), Number(f[2])];
      const date = new Date(Date.UTC(year, 0, day));
      if (day >= 1 && date.getUTCFullYear() === year && /^\d+$/.test(f[3]!) && /^\d+$/.test(f[2]!))
        [stamp, value] = [
          `${date.toISOString().slice(0, 10)} ${Math.floor(hhmm / 100)}:${String(hhmm % 100).padStart(2, "0")}`,
          f[4],
        ];
    } else if (f.length === 3 && /^\d{4}-\d{2}-\d{2}$/.test(f[0]!)) {
      [stamp, value] = [`${f[0]} ${f[1]}`, f[2]];
    } else if (f.length === 3 && /^\d{1,2}\/\d{2}\/\d{4}$/.test(f[0]!)) {
      const [d, mo, y] = f[0]!.split("/");
      [stamp, value] = [`${y}-${mo}-${d!.padStart(2, "0")} ${f[1]}`, f[2]];
    }
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
 * An Antarctic gauge's level in meters at UTC from a row as the file labels it, or
 * null where the label or unit can't be settled (erratum `linz-scott-base-clock`).
 *
 * - Cape Roberts' labels are UTC, as its README says, in meters; -6999 and 6999 mark
 *   a missing level.
 * - Scott Base's labels are NZST, UTC+12, as its README says only of the first
 *   format, except from 25 November 2023, when the logger was reinstalled, to
 *   some day from 29 to 31 October 2024, when they are UTC+13; those three days,
 *   whose labels run on without a break, are left out. Its levels are millimeters
 *   from 2024, meters before.
 */
function atGauge(code: string, row: Observation): Observation | null {
  let { time, level } = row;
  if (code === "SCOT") {
    if (time >= Date.UTC(2024, 9, 29) && time < Date.UTC(2024, 10, 1)) return null;
    time -= (time >= Date.UTC(2023, 10, 25) && time < Date.UTC(2024, 9, 29) ? 13 : 12) * 3_600_000;
    if (row.time >= Date.UTC(2024, 0, 1)) level /= 1000;
  }
  return Math.abs(level) >= 100 ? null : { ...row, time, level: Math.round(level * 1000) / 1000 };
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
    "linz/ROBT": [
      {
        since: "2010-11-05",
        note: "Cape Roberts' gauge was re-established on 5 November 2010 after the failure of 2009, and its levels sit about 0.25 m below those of the summer of 2009. No other record of the gauge covers 2009, so the earlier epoch has no `to_current` (erratum `linz-cape-roberts-step-2010`).",
      },
      {
        since: "2019-02-04",
        note: "Cape Roberts' levels step up 1.2 m at 03:07 UTC on 3 February 2019, and a split starts on a whole day, so the rest of that day is left out (erratum `linz-cape-roberts-step-2019`).",
      },
      {
        since: "2021-11-06",
        note: "Cape Roberts' gauge was re-established on 6 November 2021 after failing on 16 March, and its levels sit about 1.7 m below the gauge's before. Scott Base's gauge failed in the same months, so no record measures either step alone, and the earlier epoch has no `to_current` (erratum `linz-cape-roberts-step-2021`).",
      },
    ],
    "linz/SCOT": [
      {
        since: "2016-03-29",
        note: "Scott Base's levels before its failure on 28 February 2016 are 0.120 m higher than UHSLC's hourly Scott Base, and from 29 March they are level with it (erratum `linz-scott-base-step-2016`).",
      },
      {
        since: "2018-01-22",
        note: "Scott Base's README lists a drift of TG0 on 15 and 16 January 2018 and an offset of about 0.08 m on the 21st, and its levels fall 0.09 m against Cape Roberts' across them (erratum `linz-scott-base-step-2018`).",
      },
      {
        since: "2019-11-03",
        note: "Scott Base's gauge failed on 24 February 2019 and reads a tide again from 3 November, 0.50 m lower against Cape Roberts' (erratum `linz-scott-base-step-2019`).",
      },
      {
        since: "2020-05-12",
        note: "Scott Base's gauge was returned to the water on 12 May 2020 with its mount moved about 1 m, and its levels rise 0.18 m against Cape Roberts' (erratum `linz-scott-base-step-2020`).",
      },
      {
        since: "2021-11-17",
        note: "Scott Base's gauge was re-established on 17 November 2021 after its failure in March. Cape Roberts' gauge was re-established in the same months, so no record measures either step alone (erratum `linz-scott-base-step-2021`).",
      },
      {
        since: "2022-10-30",
        note: "Scott Base's file for 2022 has no levels from 9 March to 30 October, and its levels rise 0.17 m against Cape Roberts' across the gap (erratum `linz-scott-base-step-2022`).",
      },
      {
        since: "2025-11-20",
        note: "Scott Base's levels fall 0.64 m against Cape Roberts' across its failure of 2025, when the README says its gantry was moved landward (erratum `linz-scott-base-step-2025`).",
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
