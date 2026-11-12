import { getJson, getText } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
} from "../../schema.ts";

/**
 * The Japan Oceanographic Data Center's hourly tide records from the Japan
 * Coast Guard, the Geospatial Information Authority of Japan and port
 * authorities: one zip per station holding a text file per year, in
 * centimeters above the station's zero, in JST. See README.md.
 */
const SITE = "https://www.jodc.go.jp";
const DATUM = "ZERO";

export const metadata: SourceMetadata = {
  id: "jodc",
  name: "Japan Oceanographic Data Center (JODC)",
  url: `${SITE}/vpage/tide.html`,
  license: {
    id: "JODC",
    name: "JODC J-DOSS terms of use",
    url: `${SITE}/jodcweb/JDOSS/index.html`,
    // JODC asks for permission before its data is passed to third parties (#47).
    commercial_use: false,
    // Public while JODC's permission is asked for (#47), on the expectation it's given.
    redistribution: true,
  },
  attribution: "Japan Oceanographic Data Center",
  contact: { email: "jodc@jodc.go.jp", url: `${SITE}/jodcweb/contactUs.html` },
  terms:
    "JODC serves these records to anyone, but its J-DOSS terms say not to copy the data and provide it to third parties without permission (無断で、データ等を複製して第三者に提供しないようにしてください), and ask that work using it credit JODC. Permission to republish has been asked for (openwatersio/stillwell#47); until it's given, treat the data as research use only. Credit JODC and the observing agency each station's attribution names, and, as JODC asks, send it a copy of work that uses the data. Changes in the store: times converted from JST (UTC+3 at Syowa Station) to UTC, levels from centimeters to meters, and quality flags added.",
  // Records arrive in a yearly batch.
  hourly: false,
  // JODC publishes final values only.
  finalizes: false,
  utc_offsets: [3, 9],
};

const HOUR_MS = 3_600_000;

/** The observing agency, by the code's prefix; four digits are a port authority's. */
const AGENCIES: [RegExp, string][] = [
  [/^HD\d\d$/, "Japan Coast Guard"],
  [/^GS\d\d$/, "Geospatial Information Authority of Japan"],
  [/^\d{4}$/, "Ports and Harbours Bureau"],
];

/** Syowa Station, in Antarctica, keeps UTC+3; every other station JST. */
const offsetOf = (code: string) => (code === "HD50" ? 3 : 9) * HOUR_MS;

/** A JODC station as listed, with the first and last years of its record. */
export type JodcStation = ListedStation & { record_start: string; record_end: string };

interface Feature {
  properties: { code: string; ename: string; syear: string; eyear: string };
  geometry: { geometries: { coordinates: [number, number] }[] };
}

/** "KASHIMAKO" as "Kashimako", "SYOWA STATION (Antarctica)" as "Syowa Station (Antarctica)". */
const titleCase = (name: string) =>
  name.replace(/[A-Za-z]+/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());

/**
 * Every station JODC lists but JMA's, whose records the `jma` source reads
 * from JMA itself.
 */
export async function stations(): Promise<JodcStation[]> {
  const list = await getJson<{ features: Feature[] }>(`${SITE}/vpage/tide/station_info.json`, {
    fresh: true,
    pace,
  });
  const listed = list.features.flatMap((f) => {
    const { code, syear, eyear } = f.properties;
    const agency = AGENCIES.find(([pattern]) => pattern.test(code))?.[1];
    if (!agency) return [];
    const first = Number(syear);
    const last = Number(eyear);
    // A year past next would make every other station of its agency inactive.
    if (!(first > 1800 && last >= first && last <= new Date().getUTCFullYear() + 1))
      throw new Error(`JODC ${code} has years ${syear}-${eyear}`);
    return [{ f, agency, first, last }];
  });
  // JODC adds a year at a time, a year or more late and to each agency's
  // stations on its own, so a station is active while its record reaches
  // within two years of the newest of its agency's, whatever the date.
  const newest = new Map<string, number>();
  for (const { agency, last } of listed)
    newest.set(agency, Math.max(last, newest.get(agency) ?? last));
  const out = listed.map(({ f, agency, first, last }): JodcStation => {
    const { code, ename } = f.properties;
    const [lon, lat] = f.geometry.geometries[0]!.coordinates;
    return {
      ...stationDefaults(metadata),
      attribution: `${metadata.attribution}; ${agency}`,
      id: `jodc/${code}`,
      source_id: code,
      name: titleCase(ename),
      lat,
      lon,
      country_code: code === "HD50" ? "AQ" : "JP",
      kind: "coastal",
      interval_s: 3600,
      datum: DATUM,
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      status: last >= newest.get(agency)! - 2 ? "active" : "inactive",
      live: false,
      min_interval_s: null,
      source_url: `${SITE}/TideAttrib/tide_attrib_${code}_e.htm`,
      // A record's first hours, before its UTC year, are dropped (see `record`).
      record_start: new Date(Date.UTC(first, 0, 1)).toISOString(),
      record_end: new Date(Date.UTC(last + 1, 0, 1) - offsetOf(code)).toISOString(),
    };
  });
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!out.length) throw new Error("JODC listed no tide stations");
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** The files in a zip, by name, read from their local headers. */
export async function unzip(zip: Buffer): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let p = 0;
  let entries = 0;
  for (; p + 30 <= zip.length && zip.readUInt32LE(p) === 0x04034b50; entries++) {
    const flags = zip.readUInt16LE(p + 6);
    const method = zip.readUInt16LE(p + 8);
    const size = zip.readUInt32LE(p + 18);
    const nameLength = zip.readUInt16LE(p + 26);
    const name = zip.toString("latin1", p + 30, p + 30 + nameLength);
    const start = p + 30 + nameLength + zip.readUInt16LE(p + 28);
    // Sizes after the data (bit 3) would leave nothing here to find the next file by.
    if (flags & 8) throw new Error(`JODC's zip puts ${name}'s size after its data`);
    const data = zip.subarray(start, start + size);
    if (data.length !== size) throw new Error(`JODC's zip is cut off in ${name}`);
    let text: string;
    if (method === 0) text = data.toString("latin1");
    else if (method === 8) {
      const stream = new Blob([new Uint8Array(data)])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      text = Buffer.from(await new Response(stream).arrayBuffer()).toString("latin1");
    } else throw new Error(`JODC's zip compresses ${name} with method ${method}`);
    // Some zips hold a year twice, as copies (erratum `jodc-zip-duplicates`).
    if (out.has(name) && out.get(name) !== text)
      throw new Error(`JODC's zip holds two different ${name}`);
    out.set(name, text);
    p = start + size;
  }
  if (!out.size) throw new Error("JODC's zip holds no files");
  // A body cut off between entries reads as a whole zip of fewer years, so the
  // central directory's count, at the end, has to match.
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < p || end + 22 > zip.length || zip.readUInt16LE(end + 10) !== entries)
    throw new Error("JODC's zip is cut off after its last whole file");
  return out;
}

/** Stations' parsed records, since backfill asks for a station a year at a time. */
const records = new Map<string, Promise<Observation[]>>();
const KEEP = 4;

function record(code: string): Promise<Observation[]> {
  let got = records.get(code);
  if (got) records.delete(code);
  else {
    // Fresh, since a zip gains a year in place; the record's kept for the run.
    // A failed one is kept too, so a station's other years don't fetch it again.
    got = getText(`${SITE}/vpage/tide/${code}.zip`, { base64: true, fresh: true, pace }).then(
      async (body) => {
        const files = await unzip(Buffer.from(body, "base64"));
        const years = new Set<number>();
        const out: Observation[] = [];
        for (const [name, text] of files) {
          const m = /^(\w+)_(\d{4})\.txt$/.exec(name);
          if (!m || m[1] !== code) throw new Error(`JODC ${code}'s zip holds ${name}`);
          years.add(Number(m[2]));
          out.push(...parse(text, code, Number(m[2])));
        }
        // A year's file starts at midnight local time, hours before the UTC year.
        // Before the record's first year, those hours alone would make a year
        // file of their own (`record_start`).
        const since = Date.UTC(Math.min(...years), 0, 1);
        return out.filter((o) => o.time >= since);
      },
    );
    got.catch(() => {});
  }
  // Kept as most recently used, so a record a worker is still backfilling isn't evicted.
  records.set(code, got);
  if (records.size > KEEP) records.delete(records.keys().next().value!);
  return got;
}

/** Hourly levels in meters above the station's zero over [start, end). */
export async function levels(
  code: string,
  start: Date,
  end: Date,
  {
    datum,
    record_start,
    record_end,
  }: Partial<Pick<JodcStation, "datum" | "record_start" | "record_end">> = {},
): Promise<Observation[]> {
  if ((datum ?? DATUM) !== DATUM) throw new Error(`JODC ${code} is read in ${DATUM}, not ${datum}`);
  if (!AGENCIES.some(([pattern]) => pattern.test(code)))
    throw new Error(`Not a JODC station: ${code}`);
  // Years outside the record would fetch its zip only to find nothing.
  if (
    (record_start && end.getTime() <= Date.parse(record_start)) ||
    (record_end && start.getTime() >= Date.parse(record_end))
  )
    return [];
  return (await record(code)).filter((o) => o.time >= start.getTime() && o.time < end.getTime());
}

/**
 * One year's file: a line per local day, `code,YYYY/MM/DD,` then 24 levels
 * for hours 0 to 23 in centimeters, 9999 where missing.
 */
export function parse(text: string, code: string, year: number): Observation[] {
  const offset = offsetOf(code);
  const seen = new Set<number>();
  const out: Observation[] = [];
  let previous: number | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const fields = line.split(",").map((f) => f.trim());
    const m = /^(\d{4})\/(\d\d)\/(\d\d)$/.exec(fields[1] ?? "");
    if (fields.length !== 26 || fields[0] !== code || !m || Number(m[1]) !== year)
      throw new Error(`JODC ${code}'s file for ${year} has a line ${line.slice(0, 40)}`);
    // A line dated day 00 is the day after the line before it (erratum `jodc-day-zero`).
    const day =
      m[3] === "00"
        ? (previous ?? Date.UTC(year, Number(m[2]) - 1, 0)) + 24 * HOUR_MS
        : Date.UTC(year, Number(m[2]) - 1, Number(m[3]));
    if (
      (m[3] !== "00" && new Date(day).getUTCDate() !== Number(m[3])) ||
      new Date(day).getUTCMonth() !== Number(m[2]) - 1
    )
      throw new Error(`JODC ${code}: no day ${fields[1]}`);
    if (seen.has(day)) throw new Error(`JODC ${code} has ${fields[1]} twice`);
    seen.add(day);
    previous = day;
    for (let hour = 0; hour < 24; hour++) {
      const cell = fields[hour + 2]!;
      if (cell === "9999" || cell === "") continue;
      if (!/^-?\d+$/.test(cell)) throw new Error(`JODC ${code}: not a level: ${cell}`);
      out.push({ time: day + hour * HOUR_MS - offset, level: Number(cell) / 100, flag: Flag.good });
    }
  }
  return out;
}

/** JODC publishes no rate limit; requests start a second apart. */
export const pacing = { requestMs: 1000 };
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
  observations: (s, start, end) => levels(s.source_id, start, end, s),
};
