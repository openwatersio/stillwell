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
 * California Department of Water Resources stage at tidal gauges in the
 * Sacramento–San Joaquin Delta, from its Water Data Library's continuous data:
 * one CSV per station and parameter holding the whole record, rewritten daily.
 * See README.md.
 */
const PORTAL = "https://data.cnra.ca.gov/dataset/fcba3a88-a359-4a71-a58c-6b0ff8fdc53f/resource";
const STATIONS_CSV = `${PORTAL}/c2b08f48-acfd-4a5b-9799-0f3e07d83192/download/stations.csv`;
const TRACES_CSV = `${PORTAL}/cdb5dd35-c344-4969-8ab2-d0e2d6c00821/download/station-trace-download-links.csv`;
const FILES = "https://wdlstorageaccount.blob.core.windows.net/wdlcontinuous";
const FEET = 0.3048;
const STEP_MS = 900_000;
const DAY_MS = 86_400_000;
/** WDL's times are Pacific Standard Time all year. */
const PST_MS = -8 * 3_600_000;

export const metadata: SourceMetadata = {
  id: "dwr",
  name: "California Department of Water Resources (Water Data Library)",
  url: "https://wdl.water.ca.gov/ContinuousData.aspx",
  license: {
    id: "CA-DWR-public-records",
    name: "California public records, no license stated",
    url: "https://water.ca.gov/Conditions-of-Use",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "California Department of Water Resources",
  contact: { email: "wdlweb@water.ca.gov", url: "https://wdl.water.ca.gov/ContactUs.aspx" },
  terms:
    "DWR publishes the Water Data Library without a license or a restriction on reuse. Its conditions of use disclaim any guarantee of accuracy, completeness or timeliness, and DWR edits its data after publishing it. Changes in the lake: levels converted from feet to meters and rounded to the millimeter, missing readings dropped, and quality flags added; values from the last four calendar months are marked preliminary.",
  // Files are rewritten daily and run a day or more behind, too late for the
  // hourly window; Monthly's refetch brings each station up to date instead.
  hourly: false,
  finalizes: true,
  utc_offsets: [-8, -8],
};

/** The level parameters read, each with its datum and the variable a file's notes name. */
const PARAMETERS = {
  WaterSurfaceElevationNAVD88: { datum: "NAVD88", variable: /Water Surface Elevation \(NAVD88\)/ },
  StreamLevel: { datum: "GZ", variable: /Corrected Stage/ },
} as const;
type Parameter = keyof typeof PARAMETERS;

/**
 * The DWR gauges TICON keeps: tidal stations in the Delta, Suisun Bay and the
 * lower Sacramento and San Joaquin rivers.
 */
// prettier-ignore
export const TIDAL = new Set([
  "A02100", "A02104", "B91110", "B91210", "B91212", "B91250Q", "B91450Q", "B91470Q", "B91475",
  "B91510", "B91511", "B91560", "B91651", "B91750", "B91780", "B94100", "B94150", "B94175",
  "B95020", "B95050Q", "B95060", "B95100", "B95180", "B95218", "B95250", "B95260", "B95261",
  "B95270", "B95283", "B95290", "B95295", "B95300", "B95310", "B95320Q", "B95325", "B95338Q",
  "B95339Q", "B95340", "B95341Q", "B95365", "B95366", "B95370Q", "B95380", "B95390Q", "B95400",
  "B95410Q", "B95415Q", "B95420", "B95421", "B95425", "B95460", "B95468", "B95480", "B95500",
  "B95503", "B95530", "B95540", "B95541Q", "B95580", "B95620", "B95640Q", "B95660", "B95740",
  "B95760Q", "B95765", "B95820", "E03300", "E03355", "E33510", "E33670Q", "E33680",
]);

/**
 * A DWR station as listed, with the parameter its levels come from, and its
 * first reading and, once it's inactive, the step after its last, so a
 * backfill asks for nothing outside them.
 */
export type DwrStation = ListedStation & {
  parameter: Parameter;
  record_start: string | null;
  record_end: string | null;
};

/** A station silent this long is inactive; reviewed stage arrives months late. */
const INACTIVE_AFTER_MS = 365 * DAY_MS;

/** Every station in `TIDAL` that the trace list gives a raw level file for. */
export async function stations(previous: Station[] = []): Promise<ListedStation[]> {
  // A listed station keeps its parameter, so an empty file at refresh time
  // can't move it to another datum; it's left out until the file has data.
  const kept = new Map(
    previous.map((s) => [s.source_id, (s as Partial<DwrStation>).parameter] as const),
  );
  const [listed, traces] = await Promise.all([
    getText(STATIONS_CSV, { fresh: true }).then(records),
    getText(TRACES_CSV, { fresh: true }).then(records),
  ]);
  if (!listed.length || !traces.length) throw new Error("WDL listed no stations or traces");
  const byNumber = new Map(listed.map((s) => [s.station_number!, s]));
  const out: DwrStation[] = [];
  for (const number of TIDAL) {
    const station = byNumber.get(number);
    if (!station?.station_name?.trim()) continue;
    // WDL's own gauges only; another agency's would be a copy under DWR's name.
    if (station.source !== "DWR Hydstra") {
      console.warn(`WDL lists ${number} from ${station.source}, so it's left out`);
      continue;
    }
    // NAVD88 where a new station has it, otherwise stage. Some listed files
    // are empty, and answer any range with 416, so the next is tried.
    let trace: Record<string, string> | undefined;
    const choices = kept.get(number)
      ? [kept.get(number)!]
      : (Object.keys(PARAMETERS) as Parameter[]);
    for (const p of choices) {
      const t = traces.find(
        (t) => t.station_number === number && t.parameter === p && t.output_interval === "RAW",
      );
      if (!t?.start_time || !t.end_time) continue;
      const problem = await fileProblem(number, p);
      if (!problem) {
        trace = t;
        break;
      }
      console.warn(`WDL's ${p} file for ${number} ${problem}`);
    }
    if (!trace) continue;
    const parameter = trace.parameter as Parameter;
    const lat = Number(station.latitude);
    const lon = Number(station.longitude);
    // Some closed stations have none, such as Hood (B91780), closed in 1986.
    if (!lat || !lon || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      console.warn(`WDL lists no position for ${number}, so it's left out`);
      continue;
    }
    const last = pst(trace.end_time!);
    const active = Date.now() - last < INACTIVE_AFTER_MS;
    out.push({
      ...stationDefaults(metadata),
      id: `dwr/${number}`,
      source_id: number,
      name: station.station_name.trim(),
      lat,
      lon,
      country_code: "US",
      kind: "estuary",
      interval_s: 900,
      datum: PARAMETERS[parameter].datum,
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      status: active ? "active" : "inactive",
      // Nothing reads WDL live: its files run a day or more behind.
      live: false,
      min_interval_s: null,
      source_url: urlOf(number, parameter),
      parameter,
      record_start: new Date(pst(trace.start_time!)).toISOString(),
      record_end: active ? null : new Date(last + STEP_MS).toISOString(),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Why a station's file can't be read, from its first KB, or null if it can: an
 * empty file, or one whose header names another station, as B95580's names
 * B95500 (erratum `dwr-b95580-another-header`).
 */
async function fileProblem(number: string, parameter: Parameter): Promise<string | null> {
  let head: string;
  try {
    head = await getText(urlOf(number, parameter), {
      fresh: true,
      headers: { range: "bytes=0-1023" },
    });
  } catch (error) {
    if (/\b416\b/.test(String(error))) return "is empty";
    throw error;
  }
  const station = headerStation(head);
  if (station && station !== number) return `names station ${station}`;
  return /^\d\d\/\d\d\/\d{4} \d\d:\d\d:\d\d,/m.test(head) ? null : "has no data";
}

/** The station a file's header names, `"Time","B95050Q"`, with or without quotes or a BOM. */
const headerStation = (head: string) => /^\uFEFF?"?Time"?,"?([^",\r\n]*)/.exec(head)?.[1];

const urlOf = (number: string, parameter: Parameter) =>
  `${FILES}/${number}/por/${number}_${parameter}_RAW.csv`;

/** `YYYY-MM-DD HH:MM:SS` in PST as an instant. */
function pst(text: string): number {
  const time = Date.parse(`${text.trim().replace(" ", "T")}Z`) - PST_MS;
  if (Number.isNaN(time)) throw new Error(`WDL gave an unreadable time: ${text}`);
  return time;
}

/** A CSV with a header row, as records; quoted fields may hold commas. */
export function records(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  const [header, ...body] = rows.filter((r) => r.some((f) => f));
  if (!header) return [];
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

type Wanted = Pick<DwrStation, "source_id" | "parameter" | "datum"> &
  Partial<Pick<DwrStation, "record_start" | "record_end">>;

/**
 * Levels in meters over [start, end), in the station's datum. A range within
 * the last two years reads the file's tail; anything older reads the whole
 * file, once per process for the few stations asked for most recently.
 */
export async function levels(station: Wanted, start: Date, end: Date): Promise<Observation[]> {
  const { source_id: number, parameter } = station;
  if (!/^[A-Z]\d{5}Q?$/.test(number)) throw new Error(`Not a WDL station: ${number}`);
  if (!(parameter in PARAMETERS)) throw new Error(`dwr/${number} reads no known parameter`);
  if (station.datum !== PARAMETERS[parameter].datum)
    throw new Error(
      `dwr/${number} is in ${station.datum}; its ${parameter} is in ${PARAMETERS[parameter].datum}`,
    );
  const first = Date.parse(station.record_start ?? "1900-01-01T00:00:00Z");
  const from = Math.max(start.getTime(), first);
  const to = Math.min(end.getTime(), Date.parse(station.record_end ?? "9999-01-01T00:00:00Z"));
  if (from >= to) return [];
  const values =
    station.record_start && from > Date.now() - 2 * 365 * DAY_MS
      ? (await checkVariable(number, parameter), await tail(number, parameter, first, from))
      : await whole(number, parameter);
  // DWR edits recent data without marking it, so the last four months stay preliminary.
  const now = new Date();
  const settled = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1);
  return values
    .slice(lowerBound(values, from), lowerBound(values, to))
    .map((o) =>
      o.time >= settled ? { ...o, flag: Math.max(o.flag, Flag.preliminary) as Flag } : o,
    );
}

/** Files whose notes have been checked this process, by URL. */
const checked = new Map<string, Promise<void>>();

/** Refuse a file whose notes, in its first KB, name another variable; checked once per process. */
function checkVariable(number: string, parameter: Parameter): Promise<void> {
  const url = urlOf(number, parameter);
  let check = checked.get(url);
  if (!check) {
    check = getText(url, { fresh: true, headers: { range: "bytes=0-1023" } }).then(
      (text) => variableOk(text, number, parameter),
      // An empty file answers 416, and has no variable to check.
      (error) => {
        if (!/\b416\b/.test(String(error))) throw error;
      },
    );
    checked.set(url, check);
    check.catch(() => checked.get(url) === check && checked.delete(url));
  }
  return check;
}

function variableOk(text: string, number: string, parameter: Parameter): void {
  const station = headerStation(text);
  if (station && station !== number)
    throw new Error(`WDL's file for ${number} names station ${station}`);
  const variable = /\d+\.\d+ - ([^,\r\n]+)/.exec(text)?.[1];
  // An empty file, which some listed traces are, has no notes and no values.
  if (text.trim() && !PARAMETERS[parameter].variable.test(variable ?? ""))
    throw new Error(`WDL ${number} ${parameter} names ${variable ?? "no variable"}`);
}

/** Files read whole, by URL, most recent last; each can hold over a million readings. */
const files = new Map<string, Promise<Observation[]>>();
const FILES_KEPT = 4;

function whole(number: string, parameter: Parameter): Promise<Observation[]> {
  const url = urlOf(number, parameter);
  let file = files.get(url);
  if (file) files.delete(url);
  else
    file = getText(url, { fresh: true }).then((text) => {
      variableOk(text, number, parameter);
      return parse(text, number);
    });
  files.set(url, file);
  file.catch(() => files.get(url) === file && files.delete(url));
  while (files.size > FILES_KEPT) files.delete(files.keys().next().value!);
  return file;
}

/** Forget every file read, for tests. */
export function forgetFiles(): void {
  files.clear();
  checked.clear();
}

/**
 * The file from `from` on, by a byte range. Rows are a 15-minute grid, 43
 * bytes with a value and 33 without, so the row at `from` starts at least 33
 * bytes per step in. Guesses go from 43 down to 33, since one that overshoots
 * costs only a short answer, and the whole file is read when none reaches back
 * to `from`. Azure doesn't serve a range
 * counted from the end, so the offset counts from the start.
 */
async function tail(
  number: string,
  parameter: Parameter,
  first: number,
  from: number,
): Promise<Observation[]> {
  const steps = Math.max(0, Math.floor((from - first) / STEP_MS));
  for (const width of [43, 41, 33]) {
    const offset = Math.max(0, steps * width - 4096);
    if (!offset) break;
    let text: string;
    try {
      text = await getText(urlOf(number, parameter), {
        fresh: true,
        headers: { range: `bytes=${offset}-` },
      });
    } catch (error) {
      // 416: the guess ran past the end of the file, which can be empty.
      if (/\b416\b/.test(String(error))) continue;
      throw error;
    }
    // The first line may be cut, so it starts from the first whole row.
    const values = parse(text.slice(text.indexOf("\n") + 1), number);
    if (values[0] && values[0].time <= from) return values;
  }
  return whole(number, parameter);
}

/**
 * Data rows, `MM/DD/YYYY HH:MM:SS, value, quality,` with notes in a fourth
 * column beside the first rows. A missing reading has an empty value.
 */
export function parse(text: string, number: string): Observation[] {
  const out: Observation[] = [];
  const row = /^(\d\d)\/(\d\d)\/(\d{4}) (\d\d:\d\d:\d\d),\s*"?([^",]*)"?,\s*(\d+),/gm;
  for (const m of text.matchAll(row)) {
    const value = m[5]!.trim();
    if (!value) continue;
    const flag = flagOf(Number(m[6]));
    if (flag === null) continue;
    const feet = Number(value);
    const local = `${m[3]}-${m[1]}-${m[2]}T${m[4]}`;
    const utc = Date.parse(`${local}Z`);
    // Date.parse rolls an impossible day, such as 30 February, into the next month.
    const real = !Number.isNaN(utc) && new Date(utc).toISOString().startsWith(local);
    const time = utc - PST_MS;
    if (!Number.isFinite(feet) || !real) throw new Error(`WDL ${number} sent a bad row: ${m[0]}`);
    out.push({
      time,
      level: Math.round(feet * FEET * 1000) / 1000 + 0,
      flag,
    });
  }
  // Files are in time order; an edited one that isn't would break the slicing in `levels`.
  return out.every((o, i) => i === 0 || o.time > out[i - 1]!.time)
    ? out
    : [...new Map(out.map((o) => [o.time, o])).values()].sort((a, b) => a.time - b.time);
}

/**
 * Hydstra's quality codes as each file lists them: 1 good, 2 good and edited,
 * 40 a fair measurement, 70 estimated, 76 reliably interpolated, 151 missing,
 * 170 unreliable, 255 no data. Missing and no data are dropped.
 */
function flagOf(quality: number): Flag | null {
  if (quality === 151 || quality === 255) return null;
  if (quality === 1 || quality === 2 || quality === 40) return Flag.good;
  if (quality === 70 || quality === 76) return Flag.interpolated;
  return Flag.suspect;
}

/** The first index whose time is at or after `time`. */
function lowerBound(values: Observation[], time: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The parameter a station reads. A station read from `stations.parquet`, which
 * doesn't carry it, has it from `source_url`, which names the file.
 */
function wantedOf(station: Station): Wanted {
  const s = station as Partial<DwrStation>;
  const parameter =
    s.parameter ??
    (/_([A-Za-z0-9]+)_RAW\.csv$/.exec(station.source_url ?? "")?.[1] as Parameter | undefined);
  if (!parameter) throw new Error(`${station.id} names no WDL parameter`);
  return {
    source_id: station.source_id,
    parameter,
    datum: station.datum,
    record_start: s.record_start ?? null,
    record_end: s.record_end ?? null,
  };
}

export const source: Source = {
  metadata,
  stations,
  observations: async (s, start, end) => levels(wantedOf(s), start, end),
};
