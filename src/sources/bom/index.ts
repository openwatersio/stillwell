import { gunzipSync } from "node:zlib";
import { FtpError } from "../../ftp.ts";
import { getText } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
} from "../../schema.ts";
import { BOM_CONDITIONS, NOTICES } from "../uhslc/notices.ts";

/**
 * The Bureau of Meteorology's National Tidal Centre's hourly sea levels for
 * the gauges of its two monitoring projects, from the yearly archives on its
 * anonymous FTP server: one `ar` archive a year, a compressed text file in
 * UHSLC's format for each station, in millimeters above the station's tide
 * gauge zero, in UTC. See README.md.
 */
const DIRECTORY = "ftp://ftp.bom.gov.au/anon/home/ntc/pacific/uhslc";
const DATUM = "TGZ";
const HOUR_MS = 3_600_000;

const DISCLAIMER =
  "The Bureau of Meteorology gives no warranty of any kind whether express, implied, statutory or otherwise in respect to the availability, accuracy, currency, completeness, quality or reliability of the information or that the information will be fit for any particular purpose or will not infringe any third party Intellectual Property rights. The Bureau's liability for any loss, damage, cost or expense resulting from use of, or reliance on, the information is entirely excluded.";
const MODIFIED_DISCLAIMER =
  "This product is based on Bureau of Meteorology information that has subsequently been modified. The Bureau does not necessarily support or endorse, or have any connection with, the product. In respect of that part of the information which is sourced from the Bureau, and to the maximum extent permitted by law: (i) The Bureau makes no representation and gives no warranty of any kind whether express, implied, statutory or otherwise in respect to the availability, accuracy, currency, completeness, quality or reliability of the information or that the information will be fit for any particular purpose or will not infringe any third party Intellectual Property rights; and (ii) the Bureau's liability for any loss, damage, cost or expense resulting from use of, or reliance on, the information is entirely excluded.";

export const metadata: SourceMetadata = {
  id: "bom",
  name: "Bureau of Meteorology, National Tidal Centre",
  url: "https://www.bom.gov.au/oceanography/projects/ntc/ntc.shtml",
  license: {
    id: "LicenseRef-BOM",
    name: "Bureau of Meteorology conditions of use for tide information",
    url: BOM_CONDITIONS,
    // As UHSLC's copies of these gauges are (`NOTICES.bom`): BOM's reply
    // (CAS-151567-N3L2D4) allows use under its conditions, and the store reads
    // that as covering commercial use. A copy can't carry looser terms than
    // the original, so a change to one is a change to both.
    commercial_use: NOTICES.bom!.commercial_use,
    redistribution: true,
  },
  attribution: NOTICES.bom!.credit!,
  // The page that publishes the Centre's contact details; BOM's site is closed to scripted requests, so no mailbox is recorded.
  contact: { url: "https://www.bom.gov.au/oceanography/projects/ntc/ntc.shtml" },
  terms: `${NOTICES.bom!.terms} "${DISCLAIMER}" Where a product modifies the data: "${MODIFIED_DISCLAIMER}" Changes in the store: levels from millimeters to meters, the tide gauge zero named ${DATUM}, and quality flags added.`,
  // The files are rebuilt about monthly, and weeks behind.
  hourly: false,
  // The last years' values are preliminary until BOM has rebuilt their archives.
  finalizes: true,
  empty_means_none: true,
};

/** One gauge of BOM's, by the station number its files carry. */
interface Gauge {
  /** The number in the archive's file names and lines, `h<number>.dat`. */
  number: string;
  name: string;
  /** From BOM's own record of the gauge in GESLA, or UHSLC's where GESLA has none. */
  lat: number;
  lon: number;
  country_code: string;
  /** Which monitoring project runs the gauge; none for a gauge BOM runs outside both. */
  project?: "ABSLMP" | "SPSLCMP";
  /**
   * UHSLC's series of the gauge, which carry the same hourly values, by ID. BOM
   * numbers its Australian Baseline Array gauges (956 to 959, 992 to 997) in its
   * own series, not UHSLC's, so they're named here rather than found by name.
   */
  uhslc: string[];
  /**
   * BOM hasn't said the gauge is its own to republish, so the station is
   * tagged non-commercial until it does (the request to BOM asks).
   */
  unconfirmed?: boolean;
  /** The last day of the gauge's last file, when that file stops before December 31. */
  stopped?: string;
  /** GESLA's record of BOM's own file for the gauge. */
  gesla?: string;
  /**
   * Meters from the tide gauge zero up to the Australian Height Datum, from
   * the list beside the files (`readme.txt`); where it gives one value that fits
   * the gauge's mean level. Broome's doesn't (erratum `bom-broome-ahd`).
   */
  ahd?: number;
}

/**
 * The gauges BOM runs itself: the Australian Baseline Sea Level Monitoring
 * Array's 16 whose files are in the archives (its Thursday Island gauge
 * isn't), the Pacific Sea Level and Geodetic Monitoring Project's 13, and
 * Suva and Christmas Island, whose records GESLA credits to BOM and which
 * BOM's National Tidal Centre supplies to PSMSL, but which BOM hasn't confirmed
 * are its own to republish. Christmas Island's file is
 * in the archives for 2007 to 2011 only. The archives also carry port and
 * state-agency gauges (Fremantle, Brisbane Bar, Bundaberg, Fort Denison,
 * Townsville, Booby Island), which are those agencies' to publish and aren't
 * listed.
 */
export const GAUGES: Gauge[] = [
  {
    number: "995",
    lat: -19.277,
    lon: 147.058,
    name: "Cape Ferguson",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["343a"],
    gesla: "cape_ferguson-59260-aus-bom",
    ahd: 1.59,
  },
  {
    number: "996",
    lat: -23.167,
    lon: 150.792,
    name: "Rosslyn Bay",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["330a"],
    gesla: "rosslyn_bay-59670-aus-bom",
    ahd: 2.36,
  },
  {
    number: "997",
    lat: -34.475,
    lon: 150.91,
    name: "Port Kembla",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["342a"],
    gesla: "port_kembla-60420-aus-bom",
    ahd: 0.872,
  },
  {
    number: "994",
    lat: -41.053,
    lon: 145.911,
    name: "Burnie",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["344a"],
    gesla: "burnie-60910-aus-bom",
    ahd: 1.938,
  },
  {
    number: "335",
    lat: -42.549,
    lon: 147.928,
    name: "Spring Bay",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["335"],
    gesla: "spring_bay-61170-aus-bom",
    ahd: 1.153,
  },
  {
    number: "129",
    lat: -38.351,
    lon: 141.62,
    name: "Portland",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["129"],
    gesla: "portland-61410-aus-bom",
    ahd: 0.507,
  },
  {
    number: "956",
    lat: -35.109,
    lon: 138.467,
    name: "Port Stanvac",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["100a"],
    gesla: "port_stanvac-61583-aus-bom",
  },
  {
    number: "128",
    lat: -32.149,
    lon: 133.641,
    name: "Thevenard",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["128"],
    gesla: "thevenard-62000-aus-bom",
    ahd: 0.993,
  },
  {
    number: "176",
    lat: -33.871,
    lon: 121.895,
    name: "Esperance",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["176"],
    gesla: "esperance-62080-aus-bom",
    ahd: 0.707,
  },
  {
    number: "958",
    lat: -31.826,
    lon: 115.739,
    name: "Hillarys",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["132a"],
    gesla: "hillarys-62237-aus-bom",
    ahd: 0.763,
  },
  {
    number: "166",
    lat: -18.001,
    lon: 122.219,
    name: "Broome",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["166"],
    gesla: "broome-62650-aus-bom",
  },
  {
    number: "168",
    lat: -12.472,
    lon: 130.846,
    name: "Darwin",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["168"],
    gesla: "darwin-63230-aus-bom",
  },
  {
    number: "959",
    lat: -13.86,
    lon: 136.416,
    name: "Milner Bay",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: ["145a"],
    gesla: "milner_bay_groote_eylandt-63511-aus-bom",
  },
  {
    number: "171",
    lat: -12.117,
    lon: 96.892,
    name: "Cocos (Home Island)",
    country_code: "CC",
    project: "ABSLMP",
    uhslc: ["171"],
    gesla: "home_island-46280-aus-bom",
  },
  {
    number: "170",
    lat: -10.417,
    lon: 105.667,
    name: "Christmas Island",
    country_code: "CX",
    unconfirmed: true,
    stopped: "2011-08-31",
    uhslc: ["170"],
    gesla: "christmas_island-46290-aus-bom",
  },
  {
    number: "993",
    lat: -38.374,
    lon: 145.223,
    name: "Stony Point",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: [],
    gesla: "western_port_stony_point-60710-aus-bom",
    ahd: 1.6,
  },
  {
    number: "992",
    lat: -38.547,
    lon: 143.989,
    name: "Lorne",
    country_code: "AU",
    project: "ABSLMP",
    uhslc: [],
    gesla: "lorne-60790-aus-bom",
    ahd: 1.423,
  },
  {
    number: "001",
    lat: 6.987,
    lon: 158.243,
    name: "Pohnpei",
    country_code: "FM",
    project: "SPSLCMP",
    uhslc: ["001"],
    gesla: "pohnpei-67950-fsm-bom",
  },
  {
    number: "002",
    lat: 1.365,
    lon: 172.933,
    name: "Tarawa (Betio)",
    country_code: "KI",
    project: "SPSLCMP",
    uhslc: ["002"],
    gesla: "tarawa_betio-67590-kir-bom",
  },
  {
    number: "004",
    lat: -0.532,
    lon: 166.91,
    name: "Nauru",
    country_code: "NR",
    project: "SPSLCMP",
    uhslc: ["004"],
    gesla: "nauru-67640-nru-bom",
  },
  {
    number: "005",
    lat: 7.106,
    lon: 171.373,
    name: "Majuro",
    country_code: "MH",
    project: "SPSLCMP",
    uhslc: ["005"],
    gesla: "majuro-67680-mhl-bom",
  },
  {
    number: "009",
    lat: -9.429,
    lon: 159.955,
    name: "Honiara",
    country_code: "SB",
    project: "SPSLCMP",
    uhslc: ["009"],
    gesla: "honiara-56670-slb-bom",
  },
  {
    number: "018",
    lat: -18.132,
    lon: 178.427,
    name: "Suva",
    country_code: "FJ",
    unconfirmed: true,
    uhslc: ["018"],
    gesla: "suva-67050-fji-bom",
  },
  {
    number: "023",
    lat: -21.205,
    lon: -159.785,
    name: "Rarotonga",
    country_code: "CK",
    project: "SPSLCMP",
    uhslc: ["023"],
    gesla: "rarotonga_avarua_harbour-65980-cok-bom",
  },
  {
    number: "025",
    lat: -8.503,
    lon: 179.195,
    name: "Funafuti",
    country_code: "TV",
    project: "SPSLCMP",
    uhslc: ["025"],
    gesla: "funafuti-67440-tuv-bom",
  },
  {
    number: "038",
    lat: -21.137,
    lon: -175.181,
    name: "Nuku'alofa",
    country_code: "TO",
    project: "SPSLCMP",
    uhslc: ["038"],
    gesla: "nukualofa-66600-ton-bom",
  },
  {
    number: "046",
    lat: -17.761,
    lon: 168.293,
    name: "Port Vila",
    country_code: "VU",
    project: "SPSLCMP",
    uhslc: ["046"],
    gesla: "port_vila-57320-vut-bom",
  },
  {
    number: "400",
    lat: -2.037,
    lon: 147.375,
    name: "Lombrum",
    country_code: "PG",
    project: "SPSLCMP",
    uhslc: ["400"],
    gesla: "lombrum-56130-png-bom",
  },
  {
    number: "401",
    lat: -13.827,
    lon: -171.761,
    name: "Apia",
    country_code: "WS",
    project: "SPSLCMP",
    uhslc: ["401"],
    gesla: "apia-66840-wsm-bom",
  },
  {
    number: "402",
    lat: -17.605,
    lon: 177.438,
    name: "Lautoka",
    country_code: "FJ",
    project: "SPSLCMP",
    uhslc: ["402"],
    gesla: "lautoka-67070-fji-bom",
  },
  {
    number: "598",
    lat: -19.05,
    lon: -169.92,
    name: "Alofi (Niue)",
    country_code: "NU",
    project: "SPSLCMP",
    uhslc: ["598"],
  },
];

const PROJECTS = {
  ABSLMP: "Australian Baseline Sea Level Monitoring Array",
  SPSLCMP: "Pacific Sea Level and Geodetic Monitoring Project",
};

/**
 * Every gauge in `GAUGES`, active when the newest year's archive holds a value
 * for it.
 */
export async function stations(): Promise<ListedStation[]> {
  let year = new Date().getUTCFullYear();
  // Early in a year its archive may not be there yet.
  let archive = await archiveOf(year);
  if (!archive) archive = await archiveOf(--year);
  if (!archive) throw new Error(`BOM has no archive for ${year} or ${year + 1}`);
  // A gauge down for the weeks a new year's archive covers is still active: the year before counts too.
  const before = await archiveOf(year - 1);
  const hasValues = (from: Map<string, Buffer> | null, number: string, y: number) => {
    const member = from?.get(number);
    return member ? parse(latin1(uncompress(member)), number, y).length > 0 : false;
  };
  const out = GAUGES.map((g): ListedStation => {
    const active = hasValues(archive, g.number, year) || hasValues(before, g.number, year - 1);
    return {
      ...stationDefaults(metadata),
      ...(g.unconfirmed && { commercial_use: false }),
      attribution: g.project
        ? `${metadata.attribution}; ${PROJECTS[g.project]}`
        : metadata.attribution,
      id: `bom/${g.number}`,
      source_id: g.number,
      name: g.name,
      lat: g.lat,
      lon: g.lon,
      country_code: g.country_code,
      kind: "coastal",
      interval_s: 3600,
      datum: DATUM,
      // The list's value is the height of AHD above the gauge zero, so a level less it is in AHD.
      datums: g.ahd === undefined ? {} : { AHD: -g.ahd },
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [
        ...g.uhslc.map((id) => `uhslc/${id}`),
        ...(g.gesla ? [`gesla/${g.gesla}`] : []),
      ].sort(),
      status: active ? "active" : "inactive",
      live: false,
      min_interval_s: null,
      source_url: metadata.url,
    };
  });
  // An archive with every gauge empty is a broken one; taken at its word, it would retire every station.
  if (!out.some((s) => s.status === "active"))
    throw new Error("BOM's newest archive holds no values");
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Whether a 550 for the year's archive just means BOM has none: it keeps
 * archives for 1996 and from 2005 on, so 1997 to 2004 have none, and nor has
 * the year under way (or a later one) before BOM writes its first archive.
 */
const noArchive = (year: number) =>
  year < 1996 || (year > 1996 && year < 2005) || year >= new Date().getUTCFullYear();

/** The archives fetched this run, by year, as each station's compressed file; null where BOM has none. */
export const archives = new Map<number, Promise<Map<string, Buffer> | null>>();

/** One year's archive: each station's file, still compressed, by station number. Null for a year BOM has no archive for. */
export function archiveOf(year: number): Promise<Map<string, Buffer> | null> {
  let got = archives.get(year);
  if (!got) {
    // Fresh, since an archive is rebuilt in place; kept for the run, since a
    // backfill asks for a station a year at a time and every station is in each.
    got = getText(`${DIRECTORY}/${year}.ar`, { base64: true, fresh: true, pace }).then(
      (body) => unar(Buffer.from(body, "base64"), year),
      (error) => {
        // Only the years BOM has no archive for read as none: any other 550 is a file it should have.
        if (error instanceof FtpError && error.code === 550 && noArchive(year)) return null;
        // Kept, failed, for the run, so each gauge doesn't ask a stalled server again.
        throw error;
      },
    );
    got.catch(() => {});
    archives.set(year, got);
  }
  return got;
}

/** Hourly levels in meters above the gauge's tide gauge zero over [start, end). */
export async function levels(
  number: string,
  start: Date,
  end: Date,
  { datum }: { datum?: string } = {},
): Promise<Observation[]> {
  if ((datum ?? DATUM) !== DATUM)
    throw new Error(`BOM ${number} is read in ${DATUM}, not ${datum}`);
  const gauge = GAUGES.find((g) => g.number === number);
  if (!gauge) throw new Error(`Not a BOM gauge: ${number}`);
  const out: Observation[] = [];
  const thisYear = new Date().getUTCFullYear();
  for (
    let year = start.getUTCFullYear();
    year <= new Date(end.getTime() - 1).getUTCFullYear();
    year++
  ) {
    const member = (await archiveOf(year))?.get(number);
    if (!member) continue;
    // BOM rebuilds a year's archive in the first weeks of the next year and
    // again in the one after (`2025.ar` on 16 February 2026, `2024.ar` on 30
    // January 2026), so until April the last two years are preliminary too.
    const flag =
      year >= thisYear || (year >= thisYear - 2 && new Date().getUTCMonth() < 3)
        ? Flag.preliminary
        : Flag.good;
    // A year two or more back is whole in every file BOM has written, bar the last of a gauge whose
    // file stops early, so a short one is cut off.
    const stops = gauge.stopped && year === Number(gauge.stopped.slice(0, 4));
    const whole =
      year > thisYear - 2 ? false : stops ? Date.parse(gauge.stopped!) + 24 * HOUR_MS : true;
    for (const o of parse(latin1(uncompress(member)), number, year, whole))
      if (o.time >= start.getTime() && o.time < end.getTime())
        out.push({ ...o, flag, source_flag: flag });
  }
  return out;
}

const latin1 = (b: Buffer) => b.toString("latin1");

const LINE = /^(\d{3}).{8}(\d{4})([ \d]\d)([ \d]\d)([12])((?:[ \d-]{5}){12})$/;

/**
 * A year's file: after a first line holding the station's position, a line for
 * each half of each day: the station number, its name (8), the year, month, day
 * (2 each), the half, `1` for hours 0 to 11 and `2` for 12 to 23, then 12
 * levels in millimeters, 5 characters each, `9999` where missing.
 */
export function parse(
  text: string,
  number: string,
  year: number,
  /**
   * Whether the file is a finished year's, which has to run to the year's last
   * half-day, or the midnight (ms) after the last day a gauge's file ends on.
   */
  whole: boolean | number = false,
): Observation[] {
  const out: Observation[] = [];
  // Only the file's last newline ends a line without one; a blank line inside is a damaged record.
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  // A file starts with the station's position, which holds no value; one that's
  // damaged (erratum `bom-burnie-2005-position-line`) is skipped like it.
  if (lines.length && !LINE.test(lines[0]!)) lines.shift();
  // The lines run from January 1 on, a half-day each, without a gap or a repeat.
  let midnight = Date.UTC(year, 0, 1);
  let half = 1;
  for (const line of lines) {
    const m = LINE.exec(line);
    if (!m || m[1] !== number || Number(m[2]) !== year)
      throw new Error(`BOM ${number}'s file for ${year} has a line ${line.slice(0, 40)}`);
    const [month, day] = [Number(m[3]), Number(m[4])];
    // Date.UTC rolls 31 June over to 1 July, and day 0 or month 13 into the neighboring one.
    const dated = new Date(midnight);
    if (month !== dated.getUTCMonth() + 1 || day !== dated.getUTCDate() || Number(m[5]) !== half)
      throw new Error(
        `BOM ${number}'s file for ${year} has ${line.slice(11, 21).trim()} where ${new Date(midnight).toISOString().slice(0, 10)} half ${half} belongs`,
      );
    const cells = m[6]!;
    for (let i = 0; i < 12; i++) {
      const cell = cells.slice(5 * i, 5 * i + 5).trim();
      // 9999 is the format's missing value, so a level of 9.999 m can't be told from it.
      if (cell === "9999") continue;
      if (!/^-?\d+$/.test(cell)) throw new Error(`BOM ${number}: not a level: "${cell}"`);
      out.push({
        time: midnight + ((half - 1) * 12 + i) * HOUR_MS,
        level: Number(cell) / 1000,
        flag: Flag.good,
      });
    }
    if (half === 2) midnight += 24 * HOUR_MS;
    half = half === 1 ? 2 : 1;
  }
  const end = whole === true ? Date.UTC(year + 1, 0, 1) : whole;
  if (end && (midnight !== end || half !== 1))
    throw new Error(
      `BOM ${number}'s file for ${year} ends ${midnight < end ? "before" : "after"} ${new Date(midnight).toISOString().slice(0, 10)} half ${half}`,
    );
  return out;
}

/**
 * The files of a Unix `ar` archive, by station number: each member is named
 * `h<number>.dat.Z`, a `compress`ed text file, and kept compressed.
 */
export function unar(archive: Buffer, year: number): Map<string, Buffer> {
  if (archive.toString("latin1", 0, 8) !== "!<arch>\n")
    throw new Error(`BOM's ${year}.ar isn't an archive`);
  const out = new Map<string, Buffer>();
  let p = 8;
  while (p < archive.length) {
    if (p + 60 > archive.length || archive.toString("latin1", p + 58, p + 60) !== "`\n")
      throw new Error(`BOM's ${year}.ar has a bad header at ${p}`);
    const name = archive
      .toString("latin1", p, p + 16)
      .trim()
      .replace(/\/$/, "");
    const size = Number(archive.toString("latin1", p + 48, p + 58));
    const body = archive.subarray(p + 60, p + 60 + size);
    if (!Number.isInteger(size) || body.length !== size)
      throw new Error(`BOM's ${year}.ar is cut off in ${name}`);
    const m = /^h(\d{3})\.dat\.Z$/.exec(name);
    // Any other file in the archive isn't a gauge's.
    if (!m) {
      p += 60 + size + (size % 2);
      continue;
    }
    if (out.has(m[1]!)) throw new Error(`BOM's ${year}.ar holds ${name} twice`);
    out.set(m[1]!, Buffer.from(body));
    p += 60 + size + (size % 2);
  }
  if (!out.size) throw new Error(`BOM's ${year}.ar holds no files`);
  return out;
}

/**
 * A member's text. A file `compress` wrote (`.Z`) is read by the LZW decoder its format describes:
 * codes of 9 bits, widening to the file's limit as the table fills, written
 * least significant bit first in groups of eight codes that a change of width
 * or a clear code cuts short.
 */
export function uncompress(z: Buffer): Buffer {
  // Every member of 1996's archive is a gzip file under the same name (erratum `bom-gzip-named-z`).
  if (z[0] === 0x1f && z[1] === 0x8b) return gunzipSync(z);
  if (z.length < 3 || z[0] !== 0x1f || z[1] !== 0x9d) throw new Error("Not a compressed (.Z) file");
  const maxBits = z[2]! & 0x1f;
  const block = (z[2]! & 0x80) !== 0;
  if (maxBits < 9 || maxBits > 16) throw new Error(`Compressed file with ${maxBits}-bit codes`);
  const prefix = new Uint16Array(1 << maxBits);
  const suffix = new Uint8Array(1 << maxBits);
  for (let i = 0; i < 256; i++) suffix[i] = i;
  let bits = 9;
  let free = block ? 257 : 256;
  let position = 24; // in bits
  let groupStart = position;
  let inGroup = 0;
  let old = -1;
  let first = 0;
  let out = Buffer.alloc(Math.max(1024, z.length * 4));
  let length = 0;
  const stack = new Uint8Array(1 << maxBits);
  /** Skips what's left of the group of codes a change of width or a clear code ends. */
  const endGroup = () => {
    if (inGroup > 0) position = groupStart + bits * 8;
    inGroup = 0;
  };
  for (;;) {
    if (position + bits > z.length * 8) break;
    if (inGroup === 0) groupStart = position;
    let code = 0;
    for (let i = 0; i < bits; i++) {
      const at = position + i;
      code |= ((z[at >> 3]! >> (at & 7)) & 1) << i;
    }
    position += bits;
    if (++inGroup === 8) inGroup = 0;
    if (old === -1) {
      if (code > 255) throw new Error("Compressed file starts with a table code");
      out[length++] = first = code;
      old = code;
      continue;
    }
    if (block && code === 256) {
      endGroup();
      bits = 9;
      free = 257;
      old = -1;
      continue;
    }
    const incode = code;
    let sp = 0;
    if (code >= free) {
      if (code > free) throw new Error("Compressed file is corrupt");
      stack[sp++] = first;
      code = old;
    }
    while (code >= 256) {
      stack[sp++] = suffix[code]!;
      code = prefix[code]!;
    }
    stack[sp++] = first = code;
    if (length + sp > out.length) out = Buffer.concat([out, Buffer.alloc(out.length)]);
    while (sp > 0) out[length++] = stack[--sp]!;
    if (free < 1 << maxBits) {
      prefix[free] = old;
      suffix[free] = first;
      free++;
    }
    old = incode;
    if (free > (1 << bits) - 1 && bits < maxBits) {
      endGroup();
      bits++;
    }
  }
  return out.subarray(0, length);
}

/** BOM publishes no rate limit for its FTP server; requests start a second apart. */
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
