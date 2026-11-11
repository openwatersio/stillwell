import { csvFields } from "../../csv.ts";
import { getJson, getText } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type Kind,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
  Unjudged,
} from "../../schema.ts";
import { TIDAL } from "../dwr/index.ts";
import { CONTRIBUTORS as UHSLC_CONTRIBUTORS } from "../uhslc/contributors.ts";
import { withheld as uhslcWithheld } from "../uhslc/index.ts";
import { NOTICES, type Notice } from "../uhslc/notices.ts";
import { CONTRIBUTORS } from "./contributors.ts";
import { DROPPED } from "./dropped.ts";

/**
 * GESLA 4.1 (Global Extreme Sea Level Analysis), a static release of 6,682
 * sea level records from more than 40 agencies, read record by record from
 * the release's zip on iCloud. See README.md.
 */
export const metadata: SourceMetadata = {
  id: "gesla",
  name: "GESLA 4.1 (Global Extreme Sea Level Analysis)",
  url: "https://gesla787883612.wordpress.com/",
  license: {
    id: "LicenseRef-GESLA",
    name: "GESLA terms: research use, and consultancy for most contributors",
    url: "https://gesla787883612.wordpress.com/license/",
    // GESLA's license table allows research and consultancy for most
    // contributors; the rest are tagged per station (contributors.ts).
    commercial_use: true,
    redistribution: true,
  },
  attribution: "GESLA-4.1 (Haigh et al. 2023; Woodworth et al. 2017)",
  contact: {
    email: "gesla.help@gmail.com",
    url: "https://gesla787883612.wordpress.com/contact/",
  },
  // A static release: nothing new arrives and nothing is revised.
  hourly: false,
  finalizes: false,
  terms:
    "GESLA can be freely used for research; consultancy use of the CMEMS, University of Zagreb and City of Venice records needs those organizations' permission. Cite Haigh et al. (2023), doi:10.1002/gdj3.174, and Woodworth et al. (2017), doi:10.5194/essd-9-1-2017, and acknowledge gesla.org; GESLA asks that users also cite Caldwell et al. (2015) for UHSLC's data. Each station's attribution names its contributor, whose own terms can be stricter.",
};

/** iCloud share IDs from GESLA's downloads page: the release zip and its metadata CSV. */
const ZIP_SHARE = "092OldNDh1CEOTcC1atuThsww";
const METADATA_SHARE = "02fFab01rq4LdVcwRCf5QCyCQ";
const RESOLVE =
  "https://ckdatabasews.icloud.com/database/1/com.apple.cloudkit/production/public/records/resolve";
/**
 * What the 4.1 release holds: the zip's size, which checks the share still
 * holds this release, and its number of records, which the metadata must list
 * exactly. Tests swap in their fixture's.
 */
export const release = { bytes: 7_942_398_938, records: 6682 };

/** GESLA levels are in each record's own datum, described in `datum_information`. */
const DATUM = "ZERO";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * GESLA 4.1 stamps WSV's hourly means at the start of the hour they average,
 * 30 minutes early. Erratum `gesla-wsv-hourly-means-early`.
 */
const WSV_SHIFT_MS = 30 * 60_000;

/**
 * GESLA copies UHSLC's Hong Kong records, which are an hour early, as they
 * are. Erratum `gesla-hong-kong-hour-early`.
 */
const HONG_KONG = /^hong_kong-329[a-z]?-hkg-uhslc_(fd|rq)$/;

/**
 * GESLA's copies of 40 CRMS gauges, by site, are an hour early. Erratum
 * `gesla-crms-hour-early`, whose stations a test keeps equal to this list.
 */
export const CRMS_EARLY = new Set(
  `
  0002 0003 0006 0008 0030 0033 0034 0035 0038 0039
  0046 0047 0056 0058 0059 0061 0063 0065 0086 0089
  0097 0103 0108 0114 0115 0117 0118 0119 0120 0121
  0125 0129 0131 0132 0135 0136 0139 0146 0147 0148
`
    .trim()
    .split(/\s+/)
    .map((site) => `crms${site}-crms${site}-usa-crms`),
);

/** A GESLA record as listed, with the fields of its metadata row kept in the store's list. */
export type GeslaStation = ListedStation & {
  /** `CONTRIBUTOR (ABBREVIATED)`, such as `NOAA` or `UHSLC_RQ`. */
  contributor: string;
  originator: string | null;
  datum_information: string | null;
  record_quality: string | null;
  record_start: string | null;
  record_end: string | null;
};

// prettier-ignore
const COUNTRIES: Record<string, string> = {
  AGO: "AO", ARG: "AR", ASM: "AS", ATA: "AQ", AUS: "AU", BEL: "BE", BGD: "BD", BGR: "BG", BHR: "BH",
  BHS: "BS", BLZ: "BZ", BRA: "BR", BRB: "BB", CAN: "CA", CHL: "CL", CHN: "CN", CIV: "CI", CMR: "CM",
  COG: "CG", COK: "CK", COL: "CO", CPV: "CV", CRI: "CR", CUB: "CU", CUW: "CW", CYP: "CY", DEU: "DE",
  DJI: "DJ", DMA: "DM", DNK: "DK", DOM: "DO", ECU: "EC", EGY: "EG", ESP: "ES", EST: "EE", FIN: "FI",
  FJI: "FJ", FRA: "FR", FSM: "FM", GBR: "GB", GHA: "GH", GRC: "GR", GRD: "GD", GRL: "GL", GTM: "GT",
  HKG: "HK", HND: "HN", HRV: "HR", HTI: "HT", IDN: "ID", IND: "IN", IRL: "IE", IRN: "IR", ISL: "IS",
  ISR: "IL", ITA: "IT", JAM: "JM", JPN: "JP", KEN: "KE", KIR: "KI", LKA: "LK", LTU: "LT", LVA: "LV",
  MDG: "MG", MDV: "MV", MEX: "MX", MHL: "MH", MMR: "MM", MNP: "MP", MOZ: "MZ", MRT: "MR", MUS: "MU",
  MYS: "MY", NAM: "NA", NGA: "NG", NIC: "NI", NIU: "NU", NLD: "NL", NOR: "NO", NRU: "NR", NZL: "NZ",
  OMN: "OM", PAK: "PK", PAN: "PA", PER: "PE", PHL: "PH", PLW: "PW", PNG: "PG", POL: "PL", PRI: "PR",
  PRT: "PT", PYF: "PF", ROU: "RO", RUS: "RU", SEN: "SN", SGP: "SG", SHN: "SH", SLB: "SB", SLV: "SV",
  STP: "ST", SVN: "SI", SWE: "SE", SYC: "SC", THA: "TH", TON: "TO", TTO: "TT", TUR: "TR", TUV: "TV",
  TWN: "TW", TZA: "TZ", UKR: "UA", USA: "US", VCT: "VC", VEN: "VE", VNM: "VN", VUT: "VU", WSM: "WS",
  YEM: "YE", ZAF: "ZA",
};

function countryOf(code: string): string | null {
  if (!code) return null;
  const iso = COUNTRIES[code];
  if (!iso) throw new Error(`GESLA country ${code} isn't in COUNTRIES`);
  return iso;
}

const KINDS: Record<string, Kind> = { Coastal: "coastal", River: "river", Lake: "lake" };

/** A share's signed download URL for `filename`, which the share's own name doesn't matter to. */
async function resolve(share: string, filename: string): Promise<{ url: string; size: number }> {
  const body = await getJson<{
    results: {
      rootRecord: {
        fields: { size: { value: number }; fileContent: { value: { downloadURL: string } } };
      };
    }[];
  }>(RESOLVE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shortGUIDs: [{ value: share }] }),
    // Signed for a while only, so never cached.
    fresh: true,
  });
  const fields = body.results[0]?.rootRecord?.fields;
  if (!fields) throw new Error(`iCloud share ${share} resolved to nothing`);
  return {
    url: fields.fileContent.value.downloadURL.replace("${f}", encodeURIComponent(filename)),
    size: fields.size.value,
  };
}

/** The records the last `stations()` left out as withheld, by file name. */
export const withheldFiles: string[] = [];

/** One station per GESLA record, from the release's metadata CSV, less withheld records. */
export async function stations(): Promise<GeslaStation[]> {
  const { url } = await resolve(METADATA_SHARE, "GESLA4-1_ALL.csv");
  const lines = (await getText(url, { fresh: true })).split(/\r\n?|\n/).filter(Boolean);
  // The header runs its last two names together ("…QUALITYDOWNLOAD LINK"),
  // so columns are found by name and the link is the row's last field.
  const header = csvFields(lines.shift() ?? "");
  const col = (name: string) => {
    const i = header.findIndex((h) => h.startsWith(name));
    if (i < 0) throw new Error(`GESLA's metadata has no ${name} column`);
    return i;
  };
  const c = {
    file: col("FILE NAME"),
    site: col("SITE NAME"),
    code: col("SITE CODE"),
    country: col("COUNTRY"),
    contributor: col("CONTRIBUTOR (ABBREVIATED)"),
    originator: col("ORGINATOR"),
    lat: col("LATITUDE"),
    lon: col("LONGITUDE"),
    start: col("START DATE/TIME"),
    end: col("END DATE/TIME"),
    datum: col("DATUM INFORMATION"),
    type: col("GAUGE TYPE"),
    quality: col("OVERALL RECORD QUALITY"),
  };
  const rows = lines.map(csvFields);
  // The release is static, so anything but all of it, once, is a broken
  // download; taken at its word, a short list would retire the records it lost.
  const files = new Set(rows.map((r) => r[c.file]?.trim()));
  if (rows.length !== release.records || files.size !== rows.length)
    throw new Error(
      `GESLA's metadata lists ${files.size} records in ${rows.length} rows, not ${release.records}`,
    );
  const bad = rows.findIndex((r) => r.length !== header.length + 1);
  if (bad >= 0) throw new Error(`GESLA's metadata row ${bad + 2} has ${rows[bad]!.length} fields`);
  // A release that renames a dropped record would otherwise list it again.
  for (const file of DROPPED) {
    if (!files.has(file)) throw new Error(`GESLA's metadata has no ${file}, which DROPPED names`);
    console.log(`GESLA: listing ${file} inactive, since its values are another gauge's (DROPPED)`);
  }
  withheldFiles.length = 0;
  const kept = rows.filter((r) => {
    const file = r[c.file]!.trim();
    const why = withheld(file);
    if (why) {
      console.log(`GESLA: leaving out ${file}: ${why}`);
      withheldFiles.push(file);
    }
    return !why;
  });
  const listed = kept.map((r): GeslaStation & { code: string } => {
    const file = r[c.file]!.trim();
    const abbrev = r[c.contributor]!.trim();
    const contributor = CONTRIBUTORS[abbrev.toUpperCase()];
    if (!contributor) throw new Error(`GESLA contributor ${abbrev} isn't in contributors.ts`);
    const terms = abbrev.startsWith("UHSLC_")
      ? uhslcTerms(file)
      : { commercial_use: contributor.commercial_use, credits: [contributor.name] };
    return {
      ...stationDefaults(metadata),
      id: `gesla/${file}`,
      source_id: file,
      name: r[c.site]!.trim().replace(/_+/g, " "),
      lat: Number(r[c.lat]),
      lon: Number(r[c.lon]),
      country_code: countryOf(r[c.country]!.trim()),
      kind: KINDS[r[c.type]!.trim()] ?? null,
      interval_s: null,
      datum: DATUM,
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      commercial_use: terms.commercial_use,
      attribution: [metadata.attribution, ...terms.credits].join("; "),
      tide_station: null,
      same_as: [],
      status: "active",
      live: false,
      min_interval_s: null,
      source_url: r.at(-1)?.startsWith("https://") ? r.at(-1)! : null,
      contributor: abbrev,
      originator: r[c.originator]!.trim() || null,
      datum_information: r[c.datum]!.trim() || null,
      record_quality: r[c.quality]!.trim() || null,
      record_start: isoOf(r[c.start]!),
      record_end: isoOf(r[c.end]!),
      code: r[c.code]!.trim(),
    };
  });
  // UHSLC numbers whose fast-delivery series GESLA has, which carries the number's latest version.
  const fd = new Map(
    listed.filter((s) => s.contributor === "UHSLC_FD").map((s) => [s.code.toLowerCase(), s.id]),
  );
  return listed
    .map(({ code, ...s }) =>
      DROPPED.has(s.source_id)
        ? { ...s, products: [], status: "inactive" as const }
        : { ...s, same_as: originatorIds(s.contributor, code, s.lon, fd, s.source_id) },
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The store series a record copies, where GESLA's site code is that source's
 * own ID. Other records are matched by nearness and name (src/same-as.ts).
 * A UHSLC research-quality record links to GESLA's fast-delivery record of
 * the same number where there is one, which links to UHSLC's series of that
 * number, since UHSLC lists the version its series carries under the number
 * alone.
 */
export function originatorIds(
  contributor: string,
  code: string,
  lon: number,
  fd: Map<string, string> = new Map(),
  file = "",
): string[] {
  const upper = code.toUpperCase();
  switch (contributor.toUpperCase()) {
    case "NOAA":
    case "DA_SAT":
      return /^\d{7}$/.test(code) ? [`coops/${code}`] : [];
    case "USGS":
      // GESLA drops the leading zero of USGS's parts 01 to 09. A 7-digit
      // number lost one; a longer one between 100° W and the prime meridian,
      // where the parts with no zero are only Puerto Rico's (50), likely did
      // too; the Pacific islands' east longitudes are parts 16 and 17. The Pacific parts
      // (11 to 16) and the 13- and 15-digit numbers from a site's position have none.
      if (!/^\d+$/.test(code)) return [];
      return [
        `usgs/${code.length === 7 || (code.length < 13 && lon > -100 && lon < 0 && !code.startsWith("50")) ? `0${code}` : code}`,
      ];
    case "WSV":
      return [`pegelonline/${code}`];
    case "BODC":
      // BODC's port code, which its ERDDAP datasets start with.
      return [`bodc/${code.toLowerCase()}`];
    case "SMHI":
      return [`smhi/${code}`];
    case "REFMAR":
      return [`refmar/${code}`];
    case "NHS":
      return [`kartverket/${upper}`];
    case "CDWR":
      // Water Data Library numbers are DWR's, without the Q its NAVD88
      // series end in; three-letter codes are CDEC's.
      if (/^[A-Z]\d{5}Q?$/.test(upper)) {
        const number = upper.replace(/Q$/, "");
        return [`dwr/${TIDAL.has(`${number}Q`) ? `${number}Q` : number}`];
      }
      return /^[A-Z]{3}$/.test(upper) ? [`cdec/${upper}`] : [];
    case "SFWMD":
      // A tailwater, named `…_t` in the file, is SFWMD's series with `_T`.
      return /_t(_|$)/.test(file.split("-")[0]!)
        ? [`sfwmd/${upper.replace(/_T$/, "")}_T`]
        : [`sfwmd/${upper}`];
    case "CRMS":
      // The site's first surface-water gauge, which GESLA's records start on.
      return /^CRMS\d{4}$/.test(upper) ? [`crms/${upper}-H01`] : [];
    case "UHSLC_FD":
      return [`uhslc/${code.toLowerCase()}`];
    case "UHSLC_RQ": {
      const id = code.toLowerCase();
      const sibling = fd.get(id.slice(0, 3));
      return [sibling ?? `uhslc/${id}`];
    }
    default:
      return [];
  }
}

/**
 * Why a record is withheld from the store, or null: a copy of a UHSLC record
 * whose terms carry a contributor's refusal to let the store republish it
 * (`refused` in src/sources/uhslc/notices.ts), or of any version of a station
 * number the `uhslc` adapter withholds, so a version the scan hasn't seen is
 * covered too. GESLA's other contributors' records aren't covered. The adapter
 * never lists or fetches one.
 */
export function withheld(file: string): string | null {
  const match = /-(\d{3})[a-z]?-[a-z]{3}-uhslc_(fd|rq)$/.exec(file);
  if (!match) return null;
  const refused = uhslcTerms(file).refused;
  if (refused) return `${refused.name} refused republication (${refused.refused})`;
  return uhslcWithheld(match[1]!);
}

/**
 * A UHSLC record's terms from UHSLC's documentation files, as the `uhslc`
 * adapter tags them: a research-quality record's own file; for a
 * fast-delivery record, which UHSLC builds on its versions, the strictest
 * terms and every credit of all its number's versions, or UHSLC's own where
 * it has none. A version the scan never saw, or whose notice is gone, is
 * non-commercial. The scan has files for only some of South Africa's gauges
 * (181A, 184A and 221A, each with SANHO's notice), and every South African
 * record is SANHO's, so each takes SANHO's terms. `refused` is the first
 * notice whose contributor refused republication.
 */
function uhslcTerms(file: string): {
  commercial_use: boolean;
  credits: string[];
  refused: Notice | null;
} {
  const match = /-(\d{3}[a-z]?)-([a-z]{3})-uhslc_(fd|rq)$/.exec(file);
  // A UHSLC file named some other way has terms nobody has read.
  if (!match)
    return {
      commercial_use: false,
      credits: ["University of Hawaii Sea Level Center (UHSLC)"],
      refused: null,
    };
  const code = match[1]!;
  const keys =
    code.length === 4
      ? [code]
      : Object.keys(UHSLC_CONTRIBUTORS).filter((k) => k.slice(0, 3) === code);
  const records = keys.map((k) => UHSLC_CONTRIBUTORS[k]);
  const notices: [string | null | undefined, string | null][] =
    match[2] === "zaf"
      ? [["sanho", null]]
      : records.map((r) => [r ? r.notice : undefined, r?.contributor ?? null]);
  const out = {
    commercial_use: true,
    credits: ["University of Hawaii Sea Level Center (UHSLC)"],
    refused: null as Notice | null,
  };
  for (const [name, contributor] of notices) {
    // undefined: a version the scan never saw; null: UHSLC's own terms.
    if (name === null) continue;
    const notice = name === undefined ? undefined : NOTICES[name];
    if (!notice) {
      out.commercial_use = false;
      continue;
    }
    if (!notice.commercial_use) out.commercial_use = false;
    if (notice.refused) out.refused ??= notice;
    const credit = notice.credit ?? contributor;
    if (credit && !out.credits.includes(credit)) out.credits.push(credit);
  }
  return out;
}

/** `yyyy/mm/dd hh:mm:ss` as an ISO instant, or null. */
function isoOf(text: string): string | null {
  if (!/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(text.trim())) return null;
  const t = timeOf(text.trim());
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function timeOf(s: string, at = 0): number {
  return Date.UTC(
    +s.slice(at, at + 4),
    +s.slice(at + 5, at + 7) - 1,
    +s.slice(at + 8, at + 10),
    +s.slice(at + 11, at + 13),
    +s.slice(at + 14, at + 16),
    +s.slice(at + 17, at + 19),
  );
}

/** A record's values, sorted by time, with flags already the store's. */
export interface GeslaRecord {
  times: Float64Array;
  levels: Float64Array;
  /** GESLA's own flags, as the store's. */
  source: Uint8Array;
  /** `source`, worsened by the datum-jump check. */
  flags: Uint8Array;
}

/**
 * GESLA's QC flag (column 4) as the store's flag: 0 is no QC, 1 correct (both
 * good, leaving them to the store's own QC), 2
 * interpolated, 3 doubtful, 4 a spike or wrong; 5, missing, has no value.
 * A value its use flag (column 5) says not to use is at least suspect.
 */
// A static release never finalizes anything, so "no QC" isn't preliminary.
const QC_FLAGS = [Flag.good, Flag.good, Flag.interpolated, Flag.suspect, Flag.bad];

/** Parses a GESLA file, applying the clock fixes for `file`. */
export function parse(text: string, file: string, kind: Kind | null): GeslaRecord {
  const nul = /^# NULL VALUE\s+(\S+)/m.exec(text)?.[1];
  // Every record but Wewak's says it's on UTC. Wewak's says UTC+1 but is on
  // UTC (erratum `gesla-wewak-time-zone`), so its times are kept; any other
  // record off UTC is refused rather than guessed at.
  const zone = /^# TIME ZONE HOURS\s+(\S+)/m.exec(text)?.[1] ?? "0";
  if (zone !== "0" && file !== "wewak-56070-png-bom")
    throw new Error(`GESLA's ${file} is on UTC${zone}, which the adapter doesn't convert`);
  const shift = HONG_KONG.test(file) || CRMS_EARLY.has(file) ? HOUR_MS : 0;
  // Typed arrays sized by the line count, since the largest records hold 6 million values.
  let lines = 1;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) lines++;
  let times = new Float64Array(lines);
  let levels = new Float64Array(lines);
  let source = new Uint8Array(lines);
  let n = 0;
  let sorted = true;
  for (let at = 0; at < text.length;) {
    let end = text.indexOf("\n", at);
    if (end < 0) end = text.length;
    if (text.charCodeAt(at) !== 35 /* # */ && end - at > 20) {
      const fields = text
        .slice(at + 20, end)
        .trim()
        .split(/\s+/);
      const qc = Number(fields[1]);
      if (qc >= 0 && qc <= 4 && fields[0] !== nul) {
        const flag = QC_FLAGS[qc]!;
        times[n] = timeOf(text, at) + shift;
        if (n && times[n]! < times[n - 1]!) sorted = false;
        levels[n] = Number(fields[0]);
        source[n] = fields[2] === "0" ? Math.max(flag, Flag.suspect) : flag;
        n++;
      }
    }
    at = end + 1;
  }
  times = times.slice(0, n);
  levels = levels.slice(0, n);
  source = source.slice(0, n);
  // Files are in time order; one that isn't is sorted.
  if (!sorted) {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => times[a]! - times[b]!);
    [times, levels, source] = [
      Float64Array.from(order, (i) => times[i]!),
      Float64Array.from(order, (i) => levels[i]!),
      Uint8Array.from(order, (i) => source[i]!),
    ];
  }
  // WSV's hourly means; a WSV record at another interval isn't one.
  if (file.endsWith("-wsv") && medianStep(times) === HOUR_MS)
    for (let i = 0; i < n; i++) times[i]! += WSV_SHIFT_MS;
  const record: GeslaRecord = { times, levels, source, flags: new Uint8Array(0) };
  record.flags = record.source.slice();
  if (kind === "coastal")
    for (const [from, to] of datumJumps(record))
      for (let i = 0; i < record.times.length; i++)
        if (record.times[i]! >= from && record.times[i]! < to)
          record.flags[i] = Math.max(record.flags[i]!, Flag.suspect);
  return record;
}

/** The median step between a record's first 1,000 values. */
function medianStep(times: Float64Array): number {
  const steps: number[] = [];
  for (let i = 1; i < Math.min(times.length, 1001); i++) steps.push(times[i]! - times[i - 1]!);
  return steps.length ? median(steps) : NaN;
}

/** A shift of a coastal record's 30-day median level, in meters, that counts as a datum jump. */
export const JUMP_M = 0.75;
const JUMP_DAYS = 30;
const EDGE_DAYS = 5;

/**
 * Spans of a coastal record whose level sits a datum jump away from the
 * record's main level, though GESLA flags them usable, as at Cape d'Or and
 * Mazatlán (erratum `gesla-datum-jumps`). From daily means of the usable
 * values on days whose usable values span at least 12 hours: a jump is where
 * the median of the next 30 such days differs from the previous 30's (fewer
 * near the record's ends) by more than `JUMP_M`. The jumps cut the record into segments, and every segment whose
 * median is more than `JUMP_M` from the longest segment's is returned.
 * Medians over a month ride out surges and seasons; a river's floods don't,
 * a tidal river's included, so only coastal records are checked.
 */
export function datumJumps(
  record: Pick<GeslaRecord, "times" | "levels" | "source">,
): [number, number][] {
  const days: { day: number; mean: number }[] = [];
  let day = NaN;
  let sum = 0;
  let n = 0;
  let first = 0;
  let last = 0;
  const close = () => {
    if (n && last - first >= 12 * HOUR_MS) days.push({ day, mean: sum / n });
  };
  for (let i = 0; i < record.times.length; i++) {
    if (record.source[i]! >= Flag.suspect) continue;
    const t = record.times[i]!;
    const d = Math.floor(t / DAY_MS) * DAY_MS;
    if (d !== day) {
      close();
      day = d;
      sum = n = 0;
      first = t;
    }
    sum += record.levels[i]!;
    n++;
    last = t;
  }
  close();
  const step = (i: number, w: number) =>
    Math.abs(
      median(days.slice(i, i + w).map((d) => d.mean)) -
        median(days.slice(Math.max(0, i - w), i).map((d) => d.mean)),
    );
  // A month's medians flip as soon as half the window crosses the jump, so
  // the jump itself is the largest day-to-day step within a few days. A jump
  // partway through a UTC day splits across two daily steps, so a daily step
  // of half a jump counts.
  const cuts: number[] = [];
  // Near a record's ends, the medians are over the days there are, at least `EDGE_DAYS`.
  for (let i = EDGE_DAYS; i + EDGE_DAYS <= days.length; i++) {
    const daily = step(i, 1);
    if (daily <= JUMP_M / 2 || step(i, JUMP_DAYS) <= JUMP_M) continue;
    let peak = true;
    for (let j = Math.max(1, i - 3); j <= Math.min(days.length - 1, i + 3) && peak; j++)
      if (j !== i && step(j, 1) > daily) peak = false;
    if (peak) cuts.push(i);
  }
  if (!cuts.length) return [];
  const bounds = [0, ...cuts, days.length];
  const segments = bounds.slice(1).map((end, k) => {
    const start = bounds[k]!;
    return {
      from: k === 0 ? -Infinity : days[start]!.day,
      to: end === days.length ? Infinity : days[end]!.day,
      days: end - start,
      median: median(days.slice(start, end).map((d) => d.mean)),
    };
  });
  const main = segments.reduce((a, b) => (b.days > a.days ? b : a));
  return segments
    .filter((s) => Math.abs(s.median - main.median) > JUMP_M)
    .map((s) => [s.from, s.to] as [number, number]);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Where each record sits in the zip, from its central directory: by file name, offset and compressed size. */
let index: Promise<Map<string, { offset: number; size: number }>> | undefined;

/** `bytes` of the zip, as a Buffer. */
async function range(url: string, from: number, to: number): Promise<Buffer> {
  const bytes = Buffer.from(
    await getText(url, {
      headers: { range: `bytes=${from}-${to - 1}` },
      base64: true,
      // A whole 7.9 GB zip sent for a range mustn't be read.
      partial: true,
      // The URL is signed for minutes only, and the cache keys by URL and body, not the range.
      fresh: true,
    }),
    "base64",
  );
  if (bytes.length !== to - from)
    throw new Error(`GESLA's zip sent ${bytes.length} bytes for a range of ${to - from}`);
  return bytes;
}

/**
 * The zip's signed URL, shared by every read until a minute before its `e`,
 * the expiry in Unix seconds: CloudKit signs for 15 minutes. Resolving it for
 * every record would call CloudKit thousands of times a run, and it times out
 * under that load.
 */
type Signed = Promise<{ url: string; expires: number }>;
let signed: Signed | undefined;
const MARGIN_MS = 60_000;
/** How long a URL with no `e` is kept. */
const UNSTATED_MS = 5 * 60_000;

/**
 * The shared URL, or a new one when it's unset or near its expiry: workers
 * that find it so together share one resolve. A failed resolve fails the
 * worker that started it, and the workers waiting on it start another.
 */
async function zip(): Promise<{ url: string; from: Signed }> {
  for (;;) {
    const current = signed;
    if (current) {
      const held = await current.catch(() => undefined);
      if (held && Date.now() < held.expires) return { url: held.url, from: current };
      // Another worker replaced it meanwhile, or its resolve failed: start over.
      if (signed !== current) continue;
    }
    const next: Signed = resolve(ZIP_SHARE, "GESLA4.1.zip").then(({ url, size }) => {
      if (size !== release.bytes)
        throw new Error(
          `GESLA's 4.1 share holds ${size} bytes, not ${release.bytes}; a new release?`,
        );
      const e = Number(new URL(url).searchParams.get("e"));
      return { url, expires: e > 0 ? e * 1000 - MARGIN_MS : Date.now() + UNSTATED_MS };
    });
    signed = next;
    const got = await next.catch((error: unknown) => {
      if (signed === next) signed = undefined;
      throw error;
    });
    return { url: got.url, from: next };
  }
}

/** Forgets the zip's signed URL, so the next read resolves a new one: only `from`, if given, so a failure on an old URL keeps a newer one. */
export function forgetZipUrl(from?: Signed): void {
  if (!from || signed === from) signed = undefined;
}

/** A range of the zip, resolving the URL again once if the signed one fails. */
async function zipRange(from: number, to: number): Promise<Buffer> {
  const first = await zip();
  try {
    return await range(first.url, from, to);
  } catch {
    // An expired or revoked signature reads as an HTTP error, like any other failure.
    forgetZipUrl(first.from);
    return range((await zip()).url, from, to);
  }
}

/** Reads the zip's (ZIP64) central directory. */
async function readIndex(): Promise<Map<string, { offset: number; size: number }>> {
  const tail = await zipRange(Math.max(0, release.bytes - 65_536), release.bytes);
  const at = tail.lastIndexOf(Buffer.from("PK\x06\x06", "latin1"));
  if (at < 0) throw new Error("GESLA's zip has no ZIP64 end of central directory");
  const dirSize = Number(tail.readBigUInt64LE(at + 40));
  const dirOffset = Number(tail.readBigUInt64LE(at + 48));
  const dir = await zipRange(dirOffset, dirOffset + dirSize);
  const out = new Map<string, { offset: number; size: number }>();
  for (let p = 0; p + 46 <= dir.length && dir.readUInt32LE(p) === 0x02014b50;) {
    if (dir.readUInt16LE(p + 10) !== 8)
      throw new Error("GESLA's zip has a record that isn't deflated");
    let size = dir.readUInt32LE(p + 20);
    let usize = dir.readUInt32LE(p + 24);
    const nameLength = dir.readUInt16LE(p + 28);
    const extraLength = dir.readUInt16LE(p + 30);
    const commentLength = dir.readUInt16LE(p + 32);
    let offset = dir.readUInt32LE(p + 42);
    const name = dir.toString("utf8", p + 46, p + 46 + nameLength);
    // ZIP64 extra field: the 64-bit sizes and offset, in that order, for each that overflowed.
    for (let q = p + 46 + nameLength; q < p + 46 + nameLength + extraLength;) {
      const id = dir.readUInt16LE(q);
      const length = dir.readUInt16LE(q + 2);
      if (id === 1) {
        let r = q + 4;
        const next = () => Number(dir.readBigUInt64LE((r += 8) - 8));
        if (usize === 0xffffffff) usize = next();
        if (size === 0xffffffff) size = next();
        if (offset === 0xffffffff) offset = next();
      }
      q += 4 + length;
    }
    out.set(name, { offset, size });
    p += 46 + nameLength + extraLength + commentLength;
  }
  if (!out.size) throw new Error("GESLA's zip lists no records");
  return out;
}

/** One record's file, read from the zip: its local header, then its deflated data. */
export async function readRecord(file: string): Promise<string> {
  index ??= readIndex().catch((error: unknown) => {
    index = undefined;
    throw error;
  });
  const entry = (await index).get(file);
  if (!entry) throw new Error(`GESLA's zip has no record ${file}`);
  // The local header's name and extra field can differ in length from the
  // central directory's, so it's read first.
  const header = await zipRange(entry.offset, entry.offset + 30);
  if (header.readUInt32LE(0) !== 0x04034b50)
    throw new Error(`GESLA's zip has no record at ${file}'s offset`);
  const start = entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  const deflated = await zipRange(start, start + entry.size);
  const stream = new Blob([new Uint8Array(deflated)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return Buffer.from(await new Response(stream).arrayBuffer()).toString("latin1");
}

/**
 * Records parsed lately, since backfill asks for a station a year at a time
 * and each request would otherwise read the whole record again.
 */
const recent = new Map<string, Promise<GeslaRecord>>();
const KEEP = 8;

function record(station: Pick<GeslaStation, "source_id" | "kind">): Promise<GeslaRecord> {
  let got = recent.get(station.source_id);
  // Kept as most recently used, so a record a worker is still backfilling isn't evicted.
  if (got) {
    recent.delete(station.source_id);
    recent.set(station.source_id, got);
  } else {
    got = readRecord(station.source_id).then((text) =>
      parse(text, station.source_id, station.kind),
    );
    got.catch(() => recent.delete(station.source_id));
    recent.set(station.source_id, got);
    if (recent.size > KEEP) recent.delete(recent.keys().next().value!);
  }
  return got;
}

/** A record's levels over [start, end), in meters in the record's own datum. */
export async function levels(
  station: Pick<GeslaStation, "source_id" | "kind"> &
    Partial<Pick<GeslaStation, "record_start" | "record_end">>,
  start: Date,
  end: Date,
): Promise<Observation[]> {
  const refused = withheld(station.source_id);
  if (refused) throw new Error(`GESLA's ${station.source_id} is withheld: ${refused}`);
  // The record's own span, with a margin for the clock fixes.
  if (station.record_start && Date.parse(station.record_start) - HOUR_MS >= end.getTime())
    return [];
  if (station.record_end && Date.parse(station.record_end) + HOUR_MS < start.getTime()) return [];
  if (DROPPED.has(station.source_id))
    throw new Error(`GESLA's ${station.source_id} holds another gauge's values (see DROPPED)`);
  const r = await record(station);
  const out: Observation[] = [];
  for (let i = lowerBound(r.times, start.getTime()); i < r.times.length; i++) {
    if (r.times[i]! >= end.getTime()) break;
    out.push({
      time: r.times[i]!,
      level: r.levels[i]!,
      flag: r.flags[i] as Flag,
      source_flag: r.source[i] as Flag,
    });
  }
  return out;
}

function lowerBound(times: Float64Array, t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const source: Source = {
  metadata,
  stations,
  withheld,
  observations: (s, start, end) => levels(s as GeslaStation, start, end),
  // The datum jumps, from the store's copy of the record. They're judged against
  // the record's longest segment, so a copy that misses either end is refused;
  // a year missing in the middle isn't seen. shortcut: a backfill that failed a
  // middle year can shift the longest segment; check each year once GESLA's empty years are recorded.
  suspect: async (s, record) => {
    if (s.kind !== "coastal") return [];
    const [times, levels, source]: number[][] = [[], [], []];
    for await (const rows of record())
      for (const r of rows) {
        times.push(r.time);
        levels.push(r.level);
        source.push(r.source_flag ?? r.flag);
      }
    // A year's margin, since a record's stated ends can fall in null lines the store never holds.
    const { record_start, record_end } = s as GeslaStation;
    const YEAR_MS = 366 * DAY_MS;
    const held = times.length
      ? `${new Date(times[0]!).toISOString()} to ${new Date(times.at(-1)!).toISOString()}`
      : "nothing";
    if (
      !times.length ||
      (record_start && times[0]! > Date.parse(record_start) + YEAR_MS) ||
      (record_end && times.at(-1)! < Date.parse(record_end) - YEAR_MS)
    )
      throw new Unjudged(
        `the store holds ${held} of GESLA's ${s.source_id}, not its whole record (${record_start} to ${record_end}), so its datum jumps go unjudged; GESLA's stated span counts the rows it marks missing, so a store that holds every year with values can still fall short of it`,
      );
    return datumJumps({
      times: Float64Array.from(times),
      levels: Float64Array.from(levels),
      source: Uint8Array.from(source),
    });
  },
};
