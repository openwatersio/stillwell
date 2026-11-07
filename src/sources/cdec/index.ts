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
 * 15-minute river stage at tidal gauges in the Sacramento–San Joaquin Delta and
 * Suisun Bay from the California Data Exchange Center (CDEC), run by the
 * Department of Water Resources. See README.md.
 */
const API = "https://cdec.water.ca.gov/dynamicapp";
const FEET = 0.3048;
const DAY_MS = 86_400_000;

export const metadata: SourceMetadata = {
  id: "cdec",
  name: "California Data Exchange Center (CDEC)",
  url: "https://cdec.water.ca.gov/",
  license: {
    id: "CA-DWR-public-records",
    name: "California public records, no license stated",
    url: "https://water.ca.gov/Conditions-of-Use",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "California Department of Water Resources (CDEC)",
  terms:
    "CDEC publishes its data without a license or a restriction on reuse, under DWR's conditions of use, which disclaim any guarantee of accuracy, completeness or timeliness. CDEC's data is preliminary and subject to revision. Each station credits its operator. Changes in the lake: levels converted from feet to meters and rounded to the millimeter, times converted from Pacific time to UTC, missing readings dropped, and quality flags added.",
  // Readings arrive within the hour.
  hourly: true,
  // CDEC never marks a reading reviewed; DWR's reviewed record is the Water Data Library.
  finalizes: false,
  // Pacific time, standard or daylight.
  utc_offsets: [-8, -7],
};

/** The CDEC stations TICON keeps, by CDEC code; those an operator other than USGS runs are read. */
// prettier-ignore
export const CODES = [
  "BDL", "BIR", "BLL", "BRY", "CYG", "DLC", "DSJ", "DWS", "FAL", "FPT", "GES", "GSS", "GYS", "HLT",
  "HOL", "HSL", "HUN", "HWB", "IBS", "LIB", "LPS", "M13", "MAB", "MAL", "MOK", "MRW", "MRZ", "NMR",
  "OBI", "ODM", "OH4", "OLR", "ORQ", "OSJ", "PEL", "PRI", "PTB", "ROR", "RYE", "RYF", "RYI", "SDC",
  "SGG", "SJG", "SJJ", "SKT", "SMR", "SNC", "SRV", "SSS", "SUC", "SUT", "TOE", "TRN", "TSL", "UCS",
  "VCU", "VNE", "VOL", "VON",
];

/**
 * The days stations moved to NAVD88, by their pages' notes; nothing before is
 * read. GSS and SUT were on an arbitrary datum until 1 October 2005, and MAL
 * and MRZ show NGVD29 until 1 October 2006.
 */
export const NAVD88_SINCE: Record<string, string> = {
  GSS: "2005-10-01",
  MAL: "2006-10-01",
  MRZ: "2006-10-01",
  SUT: "2005-10-01",
};

/** Datums a station's page gives only in a note, with no gauge-zero table. */
export const NOTED: Record<string, string> = {
  // "Datum of this station is NAVD88."
  BDL: "NAVD88",
};

/** The datums a gauge-zero table names, as the lake labels them. */
const DATUMS: Record<string, string> = { "NAVD 88": "NAVD88", "NGVD 29": "NGVD29" };

/** A CDEC station as listed, with the first day read and, once closed, the day after the last. */
export type CdecStation = ListedStation & {
  record_start: string | null;
  record_end: string | null;
};

/** What a station's metadata page says, as far as the adapter reads it. */
export interface Meta {
  name: string;
  lat: number;
  lon: number;
  operator: string;
  /** The gauge zero's elevation in feet and the datum the table names, such as `NAVD 88`, or null where there's no table. */
  zero: { feet: number; datum: string } | null;
  /** 15-minute river stage (sensor 1, event), as `MM/DD/YYYY` dates; `to` is null while current. */
  stage: { from: string; to: string | null } | null;
}

/** Every station in `CODES` that an operator other than USGS runs and that has 15-minute stage. */
export async function stations(): Promise<ListedStation[]> {
  const out: CdecStation[] = [];
  for (const code of CODES) {
    const meta = parseMeta(
      await getText(`${API}/staMeta?station_id=${code}`, { fresh: true, pace }),
      code,
    );
    // USGS's gauges are in `usgs`; one it runs with another agency is too.
    if (/USGS|Geological/i.test(meta.operator) || !meta.stage) continue;
    const { datum, datums } = datumOf(code, meta.zero);
    const from = Math.max(local(meta.stage.from), navd88Since(code));
    const active = meta.stage.to === null;
    out.push({
      ...stationDefaults(metadata),
      id: `cdec/${code}`,
      source_id: code,
      name: meta.name,
      lat: meta.lat,
      lon: meta.lon,
      country_code: "US",
      kind: "estuary",
      // Petaluma's gauge reports about every 9 minutes; the rest every 15.
      interval_s: code === "PTB" ? null : 900,
      datum,
      datums,
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      status: active ? "active" : "inactive",
      live: active,
      min_interval_s: null,
      attribution: attributionOf(meta.operator),
      source_url: `${API}/staMeta?station_id=${code}`,
      record_start: new Date(from).toISOString(),
      record_end: active ? null : new Date(local(meta.stage.to!, 1)).toISOString(),
    });
  }
  if (!out.length) throw new Error("CDEC listed none of its stations");
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** `MM/DD/YYYY`, or the day `days` after it, as the instant its Pacific day starts. */
function local(date: string, days = 0): number {
  const [m, d, y] = date.split("/");
  return fromPacific(Date.UTC(Number(y), Number(m) - 1, Number(d) + days));
}

/**
 * A station's datum, from its page. A gauge zero of 0.0 ft in a named datum
 * puts the stage in that datum; any other puts it above the gauge's zero,
 * `GZ`, with the zero's elevation as the offset to the named datum. A station
 * with no table takes a datum its notes give, or `GZ`. A change in what the
 * page says changes the station's datum, which opens a datum epoch at the
 * next refresh, or holds it for a person to check.
 */
export function datumOf(
  code: string,
  zero: Meta["zero"],
): { datum: string; datums: Record<string, number> } {
  const named = zero && DATUMS[zero.datum];
  if (zero && !named)
    throw new Error(`CDEC's page for ${code} names an unknown datum, ${zero.datum}`);
  if (zero && zero.feet === 0) return { datum: named!, datums: {} };
  if (zero)
    return { datum: "GZ", datums: { [named!]: Math.round(zero.feet * FEET * 1000) / 1000 } };
  return { datum: NOTED[code] ?? "GZ", datums: {} };
}

/** When a station's stage began in NAVD88, as an instant; 0 where it always was, or isn't. */
export function navd88Since(code: string): number {
  const since = NAVD88_SINCE[code];
  if (!since) return 0;
  const [y, m, d] = since.split("-");
  return local(`${m}/${d}/${y}`);
}

/** A station's metadata page: name, position, operator and its 15-minute stage's dates. */
export function parseMeta(html: string, code: string): Meta {
  const cell = (label: string) =>
    new RegExp(`<b>${label}</b></td><td>([^<]*)`).exec(html)?.[1]?.trim() ?? "";
  const name = /<h2>([^<]+)<\/h2>/.exec(html)?.[1]?.trim();
  const lat = parseFloat(cell("Latitude"));
  const lon = parseFloat(cell("Longitude"));
  const operator = decode(cell("Operator"));
  if (!name || !operator || !Number.isFinite(lat) || !Number.isFinite(lon) || !lat || !lon)
    throw new Error(`CDEC's page for ${code} has no name, operator or position`);
  // A page cut short, or laid out anew, mustn't read as a station without stage.
  const sensors = html.split("The following data types are available online")[1];
  if (!sensors || !/<\/table>/i.test(sensors))
    throw new Error(`CDEC's page for ${code} has no sensor table`);
  // Each sensor row: description, number, duration link, collection, then its
  // dates. A station can have several 15-minute rows, one per way the data came
  // in, so they're merged: the earliest start, and current if any one is.
  let stage: Meta["stage"] = null;
  for (const row of html.split(/<tr>/i)) {
    if (!/<b>RIVER STAGE<\/b>, FEET/.test(row) || !/<b>1<\/b>/.test(row)) continue;
    const m =
      />(event|hourly|daily|monthly)<\/a>[\s\S]*?>\s*(\d\d\/\d\d\/\d{4}) to (present|\d\d\/\d\d\/\d{4})\s*</.exec(
        row,
      );
    if (!m) throw new Error(`CDEC's page for ${code} has a stage row it can't read`);
    if (m[1] !== "event") continue;
    const to = m[3] === "present" ? null : m[3]!;
    if (!stage) stage = { from: m[2]!, to };
    else
      stage = {
        from: local(m[2]!) < local(stage.from) ? m[2]! : stage.from,
        to: to === null || stage.to === null ? null : local(to) > local(stage.to) ? to : stage.to,
      };
  }
  // The gauge-zero table's first row: the zero's elevation and its datum.
  const table = /<th>Zero[\s\S]*?<\/table>/.exec(html)?.[0];
  const row = table && /<td>\s*(-?[\d.]+)'\s*([A-Z]+ ?\d+)\s*<\/td>/.exec(table);
  const zero = row ? { feet: Number(row[1]), datum: row[2]!.replace(/\s+/g, " ") } : null;
  return { name: titleCase(name), lat, lon, operator, zero, stage };
}

const decode = (text: string) => text.replace(/&amp;/g, "&").replace(/&#39;/g, "'");

/** `SAN JOAQUIN R AT PRISONERS PT` → `San Joaquin R At Prisoners Pt`. */
function titleCase(text: string): string {
  return decode(text)
    .replace(/\s+/g, " ")
    .replace(/\b([A-Z])([A-Z']+)\b/g, (_, a: string, b: string) => a + b.toLowerCase());
}

/**
 * Credit the operators CDEC names, by agency name. A part after a known
 * agency that names one of its divisions (`Div of …`, `… Region Office`) is
 * left out; any other is credited as CDEC gives it.
 */
export function attributionOf(operator: string): string {
  const names: string[] = [];
  let known = false;
  for (const part of operator.split("/").map((p) => p.trim())) {
    const agency = /Water Resources|^DWR$/i.test(part)
      ? "California Department of Water Resources"
      : /Bureau of Reclamation|^USBR$/i.test(part)
        ? "U.S. Bureau of Reclamation"
        : /Corps of Engineers/i.test(part)
          ? "U.S. Army Corps of Engineers"
          : null;
    if (agency) known = true;
    else if (known && /^Div\b|Division|Region(al)? Office|Branch|Section/i.test(part)) continue;
    const name = agency ?? part;
    if (name && !names.includes(name)) names.push(name);
  }
  if (!names.length) throw new Error(`CDEC names no operator in "${operator}"`);
  return `${names.join(", ")}, via CDEC`;
}

/**
 * Levels in meters over [start, end), from 15-minute river stage (sensor 1),
 * a calendar year a request. Every value is preliminary: CDEC never marks one
 * reviewed.
 */
export async function levels(
  station: Pick<CdecStation, "source_id"> &
    Partial<Pick<CdecStation, "record_start" | "record_end">>,
  start: Date,
  end: Date,
): Promise<Observation[]> {
  const code = station.source_id;
  if (!/^[A-Z][A-Z0-9]{2}$/.test(code)) throw new Error(`Not a CDEC station: ${code}`);
  // Nothing from before a station's NAVD88 start, even for one read from
  // `stations.parquet`, which doesn't carry `record_start`.
  const from = Math.max(
    start.getTime(),
    Date.parse(station.record_start ?? "1900-01-01T00:00:00Z"),
    navd88Since(code),
  );
  const to = Math.min(end.getTime(), Date.parse(station.record_end ?? "9999-01-01T00:00:00Z"));
  let out: Observation[] = [];
  for (let t = from; t < to;) {
    const until = Math.min(to, Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1));
    // Pacific dates; End runs to the start of its day, so it's the day after.
    const csv = await getText(
      `${API}/req/CSVDataServlet?Stations=${code}&SensorNums=1&dur_code=E&Start=${pacificDate(t)}&End=${dayAfter(pacificDate(until - 1))}`,
      // CDEC may revise any reading, so nothing is cached.
      { fresh: true, pace },
    );
    out = out.concat(parse(csv, code).filter((o) => o.time >= t && o.time < until));
    t = until;
  }
  return out;
}

/** The calendar day after a `YYYY-MM-DD` date, whatever its length in Pacific time. */
function dayAfter(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

/** The Pacific date an instant falls on, `YYYY-MM-DD`. */
function pacificDate(time: number): string {
  return new Date(time + offsetAt(time)).toISOString().slice(0, 10);
}

/**
 * CDEC's CSV: `STATION_ID,DURATION,SENSOR_NUMBER,SENSOR_TYPE,DATE TIME,OBS DATE,VALUE,DATA_FLAG,UNITS`,
 * times `YYYYMMDD HHMM` in Pacific time, `---` for a missing reading.
 */
export function parse(text: string, code: string): Observation[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  if (!/^STATION_ID,DURATION,SENSOR_NUMBER,SENSOR_TYPE,DATE TIME,OBS DATE,VALUE/.test(lines[0]!))
    throw new Error(`CDEC ${code} sent an unexpected header: ${lines[0]}`);
  const byTime = new Map<number, Observation>();
  for (const line of lines.slice(1)) {
    const [id, , sensor, , stamp, , value, , units] = line.split(",");
    if (id !== code || sensor !== "1")
      throw new Error(`CDEC ${code} sent a row for ${id} ${sensor}`);
    // A missing reading can come without units.
    if (!value?.trim() || value.trim() === "---") continue;
    if (units?.trim() !== "FEET") throw new Error(`CDEC ${code} sent ${units} rather than feet`);
    const m = /^(\d{4})(\d\d)(\d\d) (\d\d)(\d\d)$/.exec(stamp ?? "");
    const feet = Number(value);
    if (!m || !Number.isFinite(feet)) throw new Error(`CDEC ${code} sent a bad row: ${line}`);
    const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
    // Date.UTC rolls an impossible date or time into the next, so check it reads back.
    if (!new Date(wall).toISOString().startsWith(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`))
      throw new Error(`CDEC ${code} sent a bad row: ${line}`);
    const time = fromPacific(wall);
    // On the day daylight saving ends, CDEC sends the repeated hour once, as
    // standard time, but its 00:45 reading is daylight time in some years
    // (2023) and standard in others (2024, 2025), so it's dropped.
    if (+m[4]! === 0 && +m[5]! === 45 && offsetAt(time) > offsetAt(time + 2 * 3_600_000)) continue;
    byTime.set(time, {
      time,
      level: Math.round(feet * FEET * 1000) / 1000 + 0,
      flag: Flag.preliminary,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

const PACIFIC = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Pacific time's offset from UTC at an instant, in milliseconds (−8 or −7 hours). */
export function offsetAt(time: number): number {
  const p = Object.fromEntries(PACIFIC.formatToParts(time).map((x) => [x.type, x.value]));
  const wall = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!);
  return wall - Math.floor(time / 60_000) * 60_000;
}

/**
 * A Pacific wall-clock time, given as if it were UTC, as the instant it names.
 * In the hour repeated when daylight saving ends, which CDEC sends once, it's
 * read as standard time.
 */
export function fromPacific(wall: number): number {
  const guess = wall + 8 * 3_600_000;
  const first = wall - offsetAt(guess);
  return wall - offsetAt(first);
}

/** CDEC publishes no limit, so requests start half a second apart. */
export const pacing = { requestMs: 500 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

export const source: Source = {
  metadata,
  stations,
  observations: async (s: Station, start, end) => levels(s as CdecStation, start, end),
};
