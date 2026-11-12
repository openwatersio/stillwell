import { getText } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
} from "../../schema.ts";

/**
 * UNAM's Servicio Mareográfico Nacional (SMN): the last 5 days of 1-minute
 * levels from each sensor at Mexico's tide gauges, in meters above the
 * sensor's zero, in UTC, one CSV per station. See README.md.
 */
const SITE = "https://www.mareografico.unam.mx";
const DATUM = "ZERO";
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** How far back SMN's files surely reach: 5 days and a few hours. */
const WINDOW_MS = 5 * 24 * HOUR_MS;
/** The longest a file's line can be: the time, the prediction and six sensors. */
const LINE_BYTES = 80;

export const metadata: SourceMetadata = {
  id: "unam",
  name: "Servicio Mareográfico Nacional, UNAM (SMN)",
  url: `${SITE}/estaciones/`,
  license: {
    id: "UNAM",
    name: "UNAM website terms",
    url: SITE,
    // Reproduction is allowed for non-profit ends only, unaltered (#48).
    commercial_use: false,
    // Public while SMN's permission is asked for (#48), on the expectation it's given.
    redistribution: true,
  },
  attribution:
    "SMN: Universidad Nacional Autónoma de México, Instituto de Geofísica, Servicio Mareográfico Nacional, México, http://www.mareografico.unam.mx",
  contact: { email: "mareografico@igeofisica.unam.mx" },
  terms:
    "SMN's site says its pages and contents may be reproduced for non-profit ends, unaltered and citing the full source and its address; anything else needs the institution's written permission (Esta página y sus contenidos pueden ser reproducidos con fines no lucrativos, siempre y cuando no se mutile, se cite la fuente completa y su dirección electrónica, de otra forma, se requiere permiso previo por escrito de la Institución). Permission to republish has been asked for (openwatersio/stillwell#48); until it's given, treat the data as non-commercial. Cite it as: SMN <year>: Universidad Nacional Autónoma de México, Instituto de Geofísica, Servicio Mareográfico Nacional, México, http://www.mareografico.unam.mx. Changes in the store: each sensor's column is a series of its own, SMN's tide prediction is left out, and quality flags are added.",
  // Each file is rewritten every minute, about 15 minutes behind.
  hourly: true,
  // SMN publishes raw values only, and keeps none past 5 days.
  finalizes: false,
};

/** Each sea-level column's sensor, by its header: the ID's suffix and the name's. */
const SENSORS: [RegExp, string, string][] = [
  [/^Nivel del? mar \(radar promedio\)$/, "radar", "radar"],
  [/^Nivel del? mar \(flotador promedio\)$/, "flotador-promedio", "float, averaged"],
  [/^Nivel del? mar \(flotador\)$/, "flotador", "float"],
  [/^Nivel del? mar \(?CBS\)?$/, "cbs", "CBS"],
  [/^Nivel del? mar \(?PLS\)?$/, "pls", "PLS"],
];

/**
 * Each station's position, by SMN's number. SMN publishes none; these are
 * GESLA 4.1's for its records of the same gauges.
 */
const POSITIONS: Record<string, [number, number]> = {
  "1": [19.1917, -96.1233],
  "2": [16.8383, -99.9033],
  "3": [20.0803, -90.5708],
  "4": [20.8583, -90.4033],
  "5": [18.6367, -91.8367],
  "6": [18.5725, -92.6575],
  "7": [21.2419, -86.7317],
  "8": [21.3033, -89.6667],
  "9": [20.8683, -86.8667],
  "10": [21.1617, -90.0483],
  "11": [21.34, -89.3083],
  "12": [20.9683, -97.3117],
  "13": [15.7533, -96.13],
  "14": [24.2667, -110.3333],
  "15": [17.94, -102.1783],
  "16": [23.1817, -106.4233],
  "17": [15.6667, -96.4917],
  "18": [14.7117, -92.4017],
  "19": [20.6583, -105.2433],
  "20": [16.3183, -95.1967],
  "21": [17.6367, -101.5583],
  "22": [18.7662, -95.756],
  "31": [19.0567, -104.3183],
  "37": [18.2968, -93.8545],
  "38": [19.3127, -87.4463],
  "41": [16.8383, -99.9033],
};

/** Stations left out, by number, with the reason. */
const LEFT_OUT: Record<string, string> = {
  "40": "Río Grijalva has no published position",
};

/** One sensor's series at an SMN station, with its file's column. */
export type UnamStation = ListedStation & { column: string };

/**
 * SMN's series for a GESLA or TICON record of one sensor at its gauges, by
 * the sensor and number in its ID (`lapaz_radar-14-mex-unam` is `14-radar`),
 * or null for another record, such as the historical ones (`unam_hist`).
 */
export function seriesOf(id: string): string | null {
  const m = /^([a-z_]+)_(radar|flotador|nivelcbs|nivelpls)-(\d+)-mex-unam$/i.exec(id);
  if (!m) return null;
  // GESLA numbers Ciudad del Carmen's radar 4, Celestún's number; SMN's is 5
  // (erratum `gesla-unam-carmen-number`).
  const number = m[1]!.toLowerCase() === "ciudadcarmen" ? "5" : m[3]!;
  const sensor = m[2]!.toLowerCase().replace(/^nivel/, "");
  return `${number}-${sensor}`;
}

/** The station numbers and names in a station page's menu, and the page's own station. */
export function numbered(html: string): Map<string, string> {
  const out = new Map(
    [...html.matchAll(/<option value="(\d+)">\s*\d+\s*-\s*([^<]+?)\s*</g)].map(([, n, name]) => [
      n!,
      name!,
    ]),
  );
  // An entry the pattern misses would retire its station without an error.
  if (out.size !== html.match(/<option value=/g)?.length)
    throw new Error("SMN's station menu has an entry it can't read");
  // The menu leaves out the station whose page it is, which only the heading
  // names, so a heading it can't read would drop that station without an error.
  const own = /<h1[^>]*>\s*([^<(]+?)\s*\((\d+)\)/.exec(html);
  if (!own) throw new Error("SMN's station page has no heading naming its station");
  out.set(own[2]!, own[1]!);
  return out;
}

const fileOf = (number: string) => `${SITE}/estaciones/grdata/data-${number}_metros.csv`;

/** A station file's columns, from its first line. */
async function header(number: string): Promise<string[]> {
  const text = await getText(fileOf(number), {
    fresh: true,
    headers: { range: "bytes=0-511" },
    pace,
  });
  const line = text.split(/\r?\n/)[0]!;
  if (!line.startsWith("Tiempo,")) throw new Error(`SMN ${number}'s file starts ${line}`);
  return line.split(",");
}

/** A series for each sea-level sensor in each station's file. */
export async function stations(): Promise<UnamStation[]> {
  const menu = numbered(await getText(`${SITE}/estaciones/?estacion=1`, { fresh: true, pace }));
  // An empty menu is a broken page; taken at its word, it would retire every station.
  if (menu.size < 2) throw new Error("SMN's station page lists no stations");
  const out: UnamStation[] = [];
  for (const [number, name] of menu) {
    if (LEFT_OUT[number]) continue;
    const at = POSITIONS[number];
    if (!at)
      throw new Error(`SMN station ${number} (${name}) has no known position; add it to POSITIONS`);
    for (const column of (await header(number)).slice(1)) {
      if (column === "Pronostico") continue;
      const sensor = SENSORS.find(([pattern]) => pattern.test(column));
      if (!sensor) throw new Error(`SMN ${number} has a column ${column}`);
      out.push({
        ...stationDefaults(metadata),
        id: `unam/${number}-${sensor[1]}`,
        source_id: `${number}-${sensor[1]}`,
        name: `${name.replace(/_/g, " ")} (${sensor[2]})`,
        lat: at[0],
        lon: at[1],
        country_code: "MX",
        kind: "coastal",
        interval_s: 60,
        datum: DATUM,
        datums: {},
        products: ["levels"],
        first: null,
        last: null,
        tide_station: null,
        same_as: [],
        status: "active",
        live: true,
        source_qc_start: null,
        source_qc_start_inferred: null,
        min_interval_s: 300,
        source_url: `${SITE}/estaciones/?estacion=${number}`,
        column,
      });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

/**
 * Files fetched in the last few minutes, by station and range, so one
 * station's sensors share a fetch.
 */
const files = new Map<string, { at: number; got: Promise<[string[], string]> }>();

/** A station's columns, and its file's lines from about `start` on, from a byte range of its end. */
function tail(number: string, start: number): Promise<[string[], string]> {
  const now = Date.now();
  // Whole hours, so series asked for the same hours share a range.
  const minutes = (Math.ceil((now - start) / HOUR_MS) + 1) * 60;
  const key = `${number}:${minutes}`;
  for (const [k, v] of files) if (now - v.at > 5 * MINUTE_MS) files.delete(k);
  let got = files.get(key)?.got;
  if (!got) {
    got = Promise.all([
      header(number),
      getText(fileOf(number), {
        fresh: true,
        headers: { range: `bytes=-${minutes * LINE_BYTES}` },
        pace,
      }),
    ]);
    got.catch(() => files.delete(key));
    files.set(key, { at: now, got });
  }
  return got;
}

/** One sensor's levels in meters above its zero over [start, end). */
export async function levels(
  station: Pick<UnamStation, "source_id" | "column"> & Partial<Pick<UnamStation, "datum">>,
  start: Date,
  end: Date,
): Promise<Observation[]> {
  if ((station.datum ?? DATUM) !== DATUM)
    throw new Error(`SMN ${station.source_id} is read in ${DATUM}, not ${station.datum}`);
  // Backfill replaces each month it brings values for, so a fetch from before
  // the window would replace a month's stored values with its last 5 days.
  if (start.getTime() < Date.now() - WINDOW_MS)
    throw new Error(
      `SMN serves only the last 5 days; ask from ${new Date(Date.now() - WINDOW_MS).toISOString()} on`,
    );
  const number = station.source_id.split("-")[0]!;
  const [columns, text] = await tail(number, start.getTime());
  // A read caught mid-rewrite can stop short; its last line is the prediction's,
  // which runs to the present, so one well before then means the rest is missing.
  const last = [...text.matchAll(/\n(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),[^\n]*(?=\n)/g)].at(-1)?.[1];
  const until = Math.min(end.getTime(), Date.now());
  if (last && Date.parse(`${last}Z`) < until - 30 * MINUTE_MS)
    throw new Error(
      `SMN ${station.source_id}'s file ends at ${last}, before ${new Date(until).toISOString()}`,
    );
  // An answer that starts after `start` would replace what the store holds from
  // `start` on with less: a whole file after SMN restarts its logger, or a range
  // whose lines run longer than `LINE_BYTES`.
  const first = /\n(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),/.exec(text)?.[1];
  if (first && Date.parse(`${first}Z`) > start.getTime() + 2 * MINUTE_MS)
    throw new Error(
      `SMN ${station.source_id}'s file starts at ${first}, after ${start.toISOString()}`,
    );
  return parse(text, columns, station.column, station.source_id, start.getTime(), end.getTime());
}

/**
 * A file's lines: `YYYY-MM-DD HH:MM:SS` in UTC, then a value per column,
 * blank where missing. A range's first line is usually cut, so it's skipped
 * unless whole, and so is the header.
 */
export function parse(
  text: string,
  columns: string[],
  column: string,
  id: string,
  from = -Infinity,
  to = Infinity,
): Observation[] {
  const at = columns.indexOf(column);
  if (at < 1) throw new Error(`SMN ${id}'s file has no column ${column}`);
  const out: Observation[] = [];
  // A file being rewritten as it's read can end mid-line, even mid-value, so
  // a last line without its newline is dropped.
  const lines = text.split(/\r?\n/);
  if (!/\n$/.test(text)) lines.pop();
  for (const [i, line] of lines.entries()) {
    if (!line || line.startsWith("Tiempo,")) continue;
    const fields = line.split(",");
    const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/.exec(fields[0]!);
    const time = m ? Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!) : NaN;
    // A range reaches hours past the ones asked for, whose lines don't matter.
    if (time < from || time >= to) continue;
    if (!m || fields.length !== columns.length) {
      if (i === 0) continue;
      throw new Error(`SMN ${id}: not a line of ${columns.length} fields: ${line}`);
    }
    const cell = fields[at]!.trim();
    if (!cell) continue;
    const level = Number(cell);
    if (!Number.isFinite(level)) throw new Error(`SMN ${id}: not a level: ${cell}`);
    out.push({
      time,
      level,
      flag: Flag.preliminary,
    });
  }
  return out;
}

/** SMN publishes no rate limit; requests start half a second apart. */
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
  observations: (s, start, end) => levels(s as UnamStation, start, end),
};
