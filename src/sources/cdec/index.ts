import { getText } from "../../http.ts";
import { currentEpoch } from "../../epochs.ts";
import { possible } from "../../span.ts";
import {
  Flag,
  stationDefaults,
  type StoredStation,
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
  // Operators' terms restrict no reuse: the Bureau of Reclamation's data is a U.S. Government
  // work, and the City of Petaluma's Terms of Use (https://cityofpetaluma.org/terms-of-use/)
  // call its site's information "provided as a public service", its records public under
  // California's Public Records Act.
  attribution: "California Department of Water Resources (CDEC)",
  // The help desk address CDEC's contact page gives.
  contact: {
    email: "flood.webmaster@water.ca.gov",
    url: "https://cdec.water.ca.gov/CDECContact.html",
  },
  terms:
    "CDEC publishes its data without a license or a restriction on reuse, under DWR's conditions of use, which disclaim any guarantee of accuracy, completeness or timeliness. Each station credits its operator.",
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

/** The datums a gauge-zero table names, as the store labels them. */
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
export async function stations(previous: Station[] = []): Promise<ListedStation[]> {
  const before = new Map(previous.map((s) => [s.source_id, s as Partial<StoredStation>]));
  const out: CdecStation[] = [];
  for (const code of CODES) {
    let meta: Meta;
    let found: ReturnType<typeof datumOf> | null;
    try {
      meta = parseMeta(
        await getText(`${API}/staMeta?station_id=${code}`, { fresh: true, pace }),
        code,
      );
      // USGS's pages aren't read for a datum, since their stations are left out.
      found =
        meta.stage && !/USGS|Geological/i.test(meta.operator) ? datumOf(code, meta.zero) : null;
    } catch (error) {
      // A page for a code the last list left out (USGS's, or one with no
      // 15-minute stage) can go without failing the rest; a listed one can't.
      if (before.size && !before.has(code)) {
        console.warn(`Skipping CDEC ${code}, not listed before: ${error}`);
        continue;
      }
      throw error;
    }
    const listed = before.get(code);
    // USGS's gauges are in `usgs`; one it runs with another agency is too. A
    // listed station that USGS now shares fails, rather than go quietly inactive.
    if (/USGS|Geological/i.test(meta.operator)) {
      if (listed)
        throw new Error(`CDEC's page for ${code} now names ${meta.operator} as its operator`);
      continue;
    }
    if (!meta.stage) {
      // A listed station's stage row gone missing is likelier a changed page than a gauge without stage.
      if (listed) throw new Error(`CDEC's page for ${code} no longer shows its 15-minute stage`);
      continue;
    }
    let { datum, datums, reference } = found!;
    // A page that loses its gauge-zero table says nothing of the datum this
    // time, so the station keeps the one it was listed with, as `datum: null`
    // means; a template change or a gap is likelier than a gauge losing its datum.
    const was = listed?.epochs?.length ? currentEpoch(listed.epochs).reference : null;
    if (!meta.zero && was) {
      console.warn(`CDEC's page for ${code} has no gauge-zero table; keeping ${was}`);
      datum = null;
      datums = {};
    }
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
      // The gauge-zero row, so a moved zero under the same label opens an epoch.
      reference: reference === null ? null : { id: reference, since: null },
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
 * next refresh, or holds it for a decision.
 */
export function datumOf(
  code: string,
  zero: Meta["zero"],
): { datum: string | null; datums: Record<string, number>; reference: string | null } {
  // No table: a datum the notes give, or gauge zero, and no reference, so a
  // table appearing later is recorded rather than read as a moved zero.
  if (!zero) return { datum: NOTED[code] ?? "GZ", datums: {}, reference: null };
  const named = DATUMS[zero.datum];
  if (!named) throw new Error(`CDEC's page for ${code} names an unknown datum, "${zero.datum}"`);
  const reference = `${zero.feet} ft ${named}`;
  if (zero.feet === 0) return { datum: named, datums: {}, reference };
  return {
    datum: "GZ",
    datums: { [named]: Math.round(zero.feet * FEET * 1000) / 1000 },
    reference,
  };
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
  // Any datum name is read, so one the adapter doesn't know fails rather than reads as no table.
  const row = table && /<td>\s*(-?[\d.]+)'\s*([^<]*?)\s*<\/td>/.exec(table);
  const zero =
    row && row[2]!.trim() ? { feet: Number(row[1]), datum: row[2]!.replace(/\s+/g, " ") } : null;
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
  // A range with no readings still has the header, so an empty reply is a failure.
  if (!lines.length) throw new Error(`CDEC ${code} sent an empty reply`);
  if (!/^STATION_ID,DURATION,SENSOR_NUMBER,SENSOR_TYPE,DATE TIME,OBS DATE,VALUE/.test(lines[0]!))
    throw new Error(`CDEC ${code} sent an unexpected header: ${lines[0]}`);
  const rows: { wall: number; feet: number }[] = [];
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
    rows.push({ wall, feet });
  }
  const stamped = [...new Map(rows.map((r) => [r.wall, r])).values()];
  const standardFrom = fallBackStandard(stamped);
  const byTime = new Map<number, Observation>();
  for (const { wall, feet } of stamped) {
    const time = fromPacific(wall);
    // A wall time in the hour skipped when daylight saving starts doesn't exist.
    if (time + offsetAt(time) !== wall) continue;
    const day = wall - (wall % DAY_MS);
    const from = standardFrom.get(day);
    // On the day daylight saving ends, the stamps after the clock's switch are standard time.
    if (from !== undefined && wall - day < SWITCH_END_MS) {
      // No clear switch: a stamp it could fall on, from 00:30 to 01:00, is dropped.
      if (from === null && wall - day >= SWITCH_FROM_MS && wall - day < 3_600_000) continue;
      if (from !== null && wall >= from) {
        byTime.set(wall + 8 * 3_600_000, {
          time: wall + 8 * 3_600_000,
          level: Math.round(feet * FEET * 1000) / 1000 + 0,
          flag: Flag.preliminary,
        });
        continue;
      }
    }
    byTime.set(time, {
      time,
      level: Math.round(feet * FEET * 1000) / 1000 + 0,
      flag: Flag.preliminary,
    });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** The stamps of the day daylight saving ends that the clock's switch to standard time can fall on start here, 00:30. */
const SWITCH_FROM_MS = 30 * 60_000;
/** CDEC's stamps from 01:00 to 02:00 on that day are standard time, which `fromPacific` reads. */
const SWITCH_END_MS = 2 * 3_600_000;
/** How far a level must jump across the hour a switch skips, in feet, and over every other step. */
const SWITCH_JUMP_FT = 0.2;
const SWITCH_JUMP_OVER = 2;

/**
 * For each day daylight saving ends, the wall time (as if UTC) of the first
 * stamp CDEC wrote in standard time, or null where the data doesn't say
 * (erratum `cdec-fall-back-clock`). On that day CDEC sends the repeated 01:00
 * hour once, as standard time, and its clock switches to standard time at
 * 00:30, 00:45 or 01:00 (Fisherman's Cut against DWR's record of the gauge:
 * 00:30 in 2018 and 00:45 in 2017, 2019 and 2021 to 2023), so a 00:30 or 00:45
 * stamp can be either time. The hour the switch skips shows as one jump in the
 * level between two consecutive stamps, at least 0.2 ft and twice any other
 * step from 00:00 to 02:00, and the first stamp after it is the first in
 * standard time. It's null where no jump stands out, where the reply has no
 * stamp at 00:15 or before and one at 01:45 or after (a window that starts or
 * ends inside the day's first two hours, as a live poll's can, so a later reply never
 * decides otherwise), and where a stamp is missing
 * around the jump, since the one step then spans two. A level no gauge reads
 * (`possible`) is left out of the search.
 */
function fallBackStandard(rows: { wall: number; feet: number }[]): Map<number, number | null> {
  const days = new Map<number, { wall: number; feet: number }[]>();
  for (const r of rows) {
    const day = r.wall - (r.wall % DAY_MS);
    if (r.wall - day >= SWITCH_END_MS || !possible(r.feet * FEET)) continue;
    (days.get(day) ?? days.set(day, []).get(day)!).push(r);
  }
  const out = new Map<number, number | null>();
  for (const [day, stamps] of days) {
    // Only the day offsets differ across: daylight time at 00:30, standard at 03:00.
    const probe = fromPacific(day + SWITCH_FROM_MS);
    if (!(offsetAt(probe) > offsetAt(probe + 2 * 3_600_000))) continue;
    stamps.sort((a, b) => a.wall - b.wall);
    const steps = stamps.slice(1).map((b, i) => ({
      to: b.wall,
      from: stamps[i]!.wall,
      // CDEC's values are in hundredths of a foot.
      jump: Math.round(Math.abs(b.feet - stamps[i]!.feet) * 100) / 100,
    }));
    const gaps = steps.map((x) => x.to - x.from).sort((a, b) => a - b);
    const usual = gaps[Math.floor(gaps.length / 2)] ?? 0;
    // The switch lies between stamps ending from 00:30 on, up to the first at or after 01:00.
    const end = steps.find((x) => x.to - day >= 3_600_000)?.to;
    const candidates = steps.filter(
      (x) => end !== undefined && x.to - day >= SWITCH_FROM_MS && x.to <= end,
    );
    const even = candidates.every((x) => x.to - x.from > 0 && x.to - x.from <= 1.5 * usual);
    const best = candidates.reduce<(typeof steps)[number] | undefined>(
      (a, x) => (!a || x.jump > a.jump ? x : a),
      undefined,
    );
    const rest = steps.filter((x) => x !== best).reduce((a, x) => Math.max(a, x.jump), 0);
    out.set(
      day,
      best &&
        even &&
        stamps[0]!.wall - day <= 15 * 60_000 &&
        stamps.at(-1)!.wall - day >= 105 * 60_000 &&
        best.jump >= SWITCH_JUMP_FT &&
        best.jump >= SWITCH_JUMP_OVER * rest
        ? best.to
        : null,
    );
  }
  return out;
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
