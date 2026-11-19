import { gunzipSync } from "node:zlib";
import { getText, HttpError } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
} from "../../schema.ts";

/**
 * ISPRA's Rete Mareografica Nazionale: 10-minute levels of Italy's national
 * tide gauges, from the monthly CSVs in ISPRA's open data repository, listed
 * by its RDF dump. See README.md.
 */
const REPOSITORY = "https://rep.isprambiente.it";
const DUMP = `${REPOSITORY}/downloads/lod/rdf/rmn/kg/rmn_dump.nt.gz`;

export const metadata: SourceMetadata = {
  id: "ispra",
  name: "ISPRA, Rete Mareografica Nazionale",
  url: "https://www.mareografico.it/",
  license: {
    id: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0 International",
    url: "https://creativecommons.org/licenses/by/4.0/",
    commercial_use: true,
    redistribution: true,
  },
  attribution:
    "ISPRA, Istituto Superiore per la Protezione e la Ricerca Ambientale, Rete Mareografica Nazionale (doi:10.83182/ispra-rmn, doi:10.83182/ispra-ron)",
  // mareografico.it publishes no address for errors in the data.
  contact: { url: "https://www.mareografico.it/" },
  terms:
    "CC BY 4.0: credit ISPRA, link to the license and say if the data was changed. ISPRA releases the values as they are, from unvalidated dynamic data, accepts no responsibility for errors or omissions, and says its own database prevails where the two differ. Changes in the store: levels converted from centimeters to meters and flagged preliminary.",
  // ISPRA's open files are monthly archives that stop in 2023, and its live view has no API.
  hourly: false,
  // Every file is validation level L0, and ISPRA publishes no validated version.
  finalizes: false,
};

/** Each gauge's zero, which the files don't tie to any datum. */
const DATUM = "ZERO";
const INTERVAL_S = 600;

/** Gauges mareografico.it shows that the archive doesn't list, so GESLA's records of them have no series here. */
const NOT_IN_ARCHIVE = new Set(["arbatax", "cetraro", "marzamemi", "milazzo", "pozzallo"]);

/**
 * The store ID of the archive's gauge that a GESLA ISPRA record's file, such
 * as `laspezia-las-ita-ispra`, names, or null where the archive lacks it.
 */
export function idOfGeslaFile(file: string): string | null {
  const name = file.split("-")[0]!.replaceAll("_", "-");
  const slug =
    { laspezia: "la-spezia", tremiti: "isole-tremiti", "reggio-calabria": "reggio-di-calabria" }[
      name
    ] ?? name;
  return NOT_IN_ARCHIVE.has(slug) ? null : `${metadata.id}/${slug}`;
}

interface Gauge {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

interface Listing {
  /** Each gauge by the slug its files are named for. */
  stations: Map<string, Gauge>;
  /** The months the dump lists, `YYYYMM`, by slug. */
  months: Map<string, string[]>;
}

const NODE = "<https://w3id.org/italia/env/ld/rmn";
const MEDIA = new RegExp(
  `^${NODE}/media/00105_(\\w+)_hydrometriclevel_\\d{6}> <[^>]*hasDownloadURL> <${REPOSITORY}/file/rmn/([a-z-]+)_hydrometric_(\\d{6})\\.csv> \\.$`,
);
/** The series' English label, whose name is the gauge's own: the platform's names the municipality. */
const LABEL = new RegExp(
  `^${NODE}/observationseries/00105_(\\w+)_hydrometriclevel_(\\d{6})> <[^>]*rdf-schema#label> "(.+) - Water Level, \\w+ \\d{4}"@en \\.$`,
);
const PLATFORM = new RegExp(`^${NODE}/platform/00105_(\\w+)_09> <([^>]*)> "([^"]*)"`);

/** The dump's gauges and listed months. Exported for tests. */
export function parseDump(text: string): Listing {
  // A gauge's code and label can change over the years; the latest month's wins, whatever the line order. A platform's position is taken as the dump gives it.
  const codes = new Map<string, { month: string; code: string }>();
  const months = new Map<string, Set<string>>();
  const names = new Map<string, { month: string; name: string }>();
  const coords = new Map<string, { lat?: number; lon?: number }>();
  for (const line of text.split(/\r?\n/)) {
    const media = MEDIA.exec(line);
    if (media) {
      const [, code, slug, month] = media as unknown as [string, string, string, string];
      if (month >= (codes.get(slug)?.month ?? "")) codes.set(slug, { month, code });
      (months.get(slug) ?? months.set(slug, new Set()).get(slug)!).add(month);
      continue;
    }
    // A level file the pattern misses would drop its gauge or months without a trace.
    if (line.includes("hasDownloadURL") && line.includes("_hydrometric_"))
      throw new Error(`ISPRA's dump has a level file this adapter can't read: ${line}`);
    const label = LABEL.exec(line);
    if (label) {
      const [, code, month, name] = label as unknown as [string, string, string, string];
      if (month >= (names.get(code)?.month ?? "")) names.set(code, { month, name });
      continue;
    }
    const platform = PLATFORM.exec(line);
    if (!platform) continue;
    const [, code, predicate, value] = platform as unknown as [string, string, string, string];
    if (predicate.endsWith("wgs84_pos#lat"))
      coords.set(code, { ...coords.get(code), lat: Number(value) });
    else if (predicate.endsWith("wgs84_pos#long"))
      coords.set(code, { ...coords.get(code), lon: Number(value) });
  }
  const stations = new Map<string, Gauge>();
  for (const [slug, { code }] of codes) {
    const c = coords.get(code);
    const name = names.get(code)?.name;
    if (!name || c?.lat === undefined || c.lon === undefined || !c.lat || !c.lon)
      throw new Error(`ISPRA's dump gives no name or position for ${slug} (${code})`);
    stations.set(slug, { code, name, lat: c.lat, lon: c.lon });
  }
  return { stations, months: new Map([...months].map(([slug, set]) => [slug, [...set].sort()])) };
}

let listing: Promise<Listing> | undefined;

/** The dump, read once a run: it is the only list of which months exist. */
function read(): Promise<Listing> {
  listing ??= getText(DUMP, { base64: true, fresh: true, pace })
    .then((body) => parseDump(gunzipSync(Buffer.from(body, "base64")).toString("utf8")))
    .catch((error) => {
      listing = undefined;
      throw error;
    });
  return listing;
}

/** Every gauge the dump lists, each with the position and name ISPRA gives it. */
export async function stations(): Promise<ListedStation[]> {
  const { stations: listed } = await read();
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!listed.size) throw new Error("ISPRA's dump lists no tide gauges");
  return [...listed]
    .map(([slug, s]): ListedStation => ({
      ...stationDefaults(metadata),
      id: `${metadata.id}/${slug}`,
      source_id: slug,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      country_code: "IT",
      kind: "coastal",
      interval_s: INTERVAL_S,
      datum: DATUM,
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      // The network still reports, but no feed of it is open: see the README.
      status: "active",
      live: false,
      min_interval_s: null,
      source_url: metadata.url,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

const MONTH = /^(\d{4})(\d{2})$/;

/**
 * Levels over [start, end) in meters above the gauge's zero: the listed
 * months that overlap, one file each. A listed month the repository doesn't
 * serve is skipped (erratum `ispra-listed-months-missing`).
 */
export async function levels(slug: string, start: Date, end: Date): Promise<Observation[]> {
  const { months } = await read();
  const listed = months.get(slug);
  if (!listed) throw new Error(`ISPRA's dump lists no gauge ${slug}`);
  const out: Observation[] = [];
  for (const yyyymm of listed) {
    const [, y, m] = MONTH.exec(yyyymm)!;
    const from = Date.UTC(Number(y), Number(m) - 1, 1);
    if (from >= end.getTime() || Date.UTC(Number(y), Number(m), 1) <= start.getTime()) continue;
    let text: string;
    try {
      text = await getText(`${REPOSITORY}/file/rmn/${slug}_hydrometric_${yyyymm}.csv`, { pace });
    } catch (error) {
      if (error instanceof HttpError && / returned 404$/.test(error.message.split(" (")[0]!))
        continue;
      throw error;
    }
    out.push(...parse(text).filter((o) => o.time >= start.getTime() && o.time < end.getTime()));
  }
  return out;
}

/** `2014-01-01 00:10:00;-25.7`: UTC, then centimeters. A file's first row can leave the time out (`2015-01-01;-1.6`), meaning 00:00. */
const ROW = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}:\d{2}))?;(-?\d+(?:\.\d+)?)$/;

/**
 * `UTC;Level` rows in UTC and centimeters. A row that isn't one, or whose
 * date doesn't exist (`Date.parse` rolls 31 February over to March), fails the
 * file. A row with no time is midnight (erratum `ispra-midnight-without-time`),
 * and a time with two different levels is dropped (erratum `ispra-repeated-times`).
 */
export function parse(text: string): Observation[] {
  const [header, ...rows] = text.split(/\r?\n/);
  if (header?.trim() !== "UTC;Level") throw new Error(`ISPRA's file starts "${header}"`);
  // Levels are compared as ISPRA writes them, not as rounded to millimeters; null marks a time with two.
  const seen = new Map<number, number | null>();
  const out: Observation[] = [];
  // Only the file's last line terminator leaves an empty element; a blank row elsewhere is a corrupt file.
  if (rows.at(-1) === "") rows.pop();
  for (const [i, row] of rows.entries()) {
    const match = ROW.exec(row);
    // A date with no time is the first row's midnight, and nowhere else.
    const clock = match?.[2] ?? (i === 0 ? "00:00:00" : "");
    if (match && !clock) throw new Error(`ISPRA's file has the row "${row}"`);
    const t = match ? Date.parse(`${match[1]}T${clock}Z`) : NaN;
    if (
      !match ||
      !Number.isFinite(t) ||
      new Date(t).toISOString().slice(0, 19) !== `${match[1]}T${clock}`
    )
      throw new Error(`ISPRA's file has the row "${row}"`);
    const cm = Number(match[3]);
    if (seen.has(t)) {
      if (seen.get(t) !== cm) seen.set(t, null);
      continue;
    }
    seen.set(t, cm);
    out.push({ time: t, level: Math.round(cm * 10) / 1000, flag: Flag.preliminary });
  }
  return out.filter((o) => seen.get(o.time) !== null);
}

/** ISPRA publishes no limit; requests start a second apart. */
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
  observations: (s, start, end) => levels(s.source_id, start, end),
};
