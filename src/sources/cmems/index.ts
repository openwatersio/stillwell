import { firstOfMonth } from "../schedule.ts";
import { DatabaseSync } from "node:sqlite";
import { getJson, getText, HttpError } from "../../http.ts";
import { possible } from "../../span.ts";
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
 * Copernicus Marine's in situ near-real-time global product: tide gauges the
 * In Situ TAC relays from national networks, read from the Marine Data Store's
 * public buckets. See README.md.
 */
const PRODUCT = "INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030";
const DATASET = "cmems_obs-ins_glo_phybgcwav_mynrt_na_irr_202311";
/** The native files' root, which the index files' paths are relative to. */
const ROOT = "https://s3.waw3-1.cloudferro.com/mdl-native-01/native";
const NATIVE = `${ROOT}/${PRODUCT}/${DATASET}`;
const STAC = `https://stac.marine.copernicus.eu/metadata/${PRODUCT}/${DATASET}--ext--`;
const DOI = "https://doi.org/10.48670/moi-00036";

export const metadata: SourceMetadata = {
  id: "cmems",
  name: "Copernicus Marine Service, In Situ TAC global near-real-time observations",
  url: `https://data.marine.copernicus.eu/product/${PRODUCT}/description`,
  // Section 2.2 allows redistribution "via any media" and derived products "for any purpose", and
  // 2.4 asks for the credit with the DOI. GESLA's research-only label for CMEMS is GESLA's own term.
  license: {
    id: "LicenseRef-Copernicus-Marine",
    name: "Copernicus Marine Service licence",
    url: "https://marine.copernicus.eu/user-corner/service-commitments-and-licence",
    commercial_use: true,
    redistribution: true,
  },
  attribution: `E.U. Copernicus Marine Service Information; ${DOI}`,
  // Copernicus Marine's user support; each file also names its production unit (`publisher_email`) and provider.
  contact: { url: "https://marine.copernicus.eu/contact" },
  terms:
    "The Copernicus Marine Service licence asks licensees to keep records of their use (section 2.6). Each station's attribution adds the institution that provides the gauge and any credit line that institution asks for, such as SHOM's DOI.",
  // Values reach the store's sources within 24 to 48 hours, too late for the hourly window.
  hourly: false,
  // The latest window's values are replaced by the history copy about two months later.
  finalizes: true,
};

/** Every gauge's levels are in its own datum, which the source describes in `datum_information`. */
const DATUM = "ZERO";

const DAY_MS = 86_400_000;

/**
 * A gauge as listed, under its platform code. `datum_information` is the
 * `sea_level_datum` CMEMS gives, `institution` the provider, `citation` the
 * credit line the provider adds to CMEMS's own, and `record_start` and
 * `record_end` the history files' span, `record_end` null while the gauge
 * reports. Kept in the store's list only.
 */
export type CmemsStation = ListedStation & {
  datum_information: string | null;
  institution: string | null;
  citation: string | null;
  record_start: string | null;
  record_end: string | null;
};

/** One row of the native index files. */
interface IndexRow {
  file: string;
  lat: number;
  lon: number;
  start: string;
  end: string;
  institution: string;
}

/**
 * The tide-gauge files with sea level in an index (`index_history.txt` or
 * `index_latest.txt`), by platform code. A gauge's code is the file name
 * between `<region>_TS_TG_` and the file's date or SHOM's `_<n>minute`, which
 * splits one gauge's history by sampling interval.
 */
export function parseIndex(text: string): Map<string, IndexRow[]> {
  const out = new Map<string, IndexRow[]>();
  for (const line of text.split("\n").map((l) => l.trimEnd())) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split(",");
    // Only tide gauges with sea level are read; another platform's row, such
    // as a profile whose institution holds a comma, is none of the store's.
    if (!/\/[A-Z]{2}_TS_TG_/.test(f[1] ?? "") || !f.at(-1)!.split(" ").includes("SLEV")) continue;
    if (f.length !== 12) throw new Error(`CMEMS index row has ${f.length} fields: ${line}`);
    const [, file, latMin, latMax, lonMin, lonMax, start, end, institution] = f as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const code = /\/[A-Z]{2}_TS_TG_(.+?)(?:_\d+minute|_\d{8})?\.nc$/.exec(file)?.[1];
    if (!code) continue;
    // The file's span of positions; a gauge's is a point, or a few hundred meters where it moved.
    const row = {
      file,
      lat: middle(latMin, latMax),
      lon: middle(lonMin, lonMax),
      start,
      end,
      institution,
    };
    if (row.lat === null || row.lon === null || !instant(start) || !instant(end))
      throw new Error(`CMEMS index row has a bad position or time: ${line}`);
    const rows = out.get(code) ?? out.set(code, []).get(code)!;
    rows.push(row as IndexRow);
  }
  return out;
}

function middle(min: string, max: string): number | null {
  const [a, b] = [min, max].map((t) => (t.trim() !== "" ? Number(t) : NaN)) as [number, number];
  return Number.isFinite(a) && Number.isFinite(b) ? (a + b) / 2 : null;
}

/** Whether `text` is an ISO instant that names a real time, since `Date.parse` rolls 31 February over. */
function instant(text: string): boolean {
  const t = Date.parse(text);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 19) === text.slice(0, 19);
}

/**
 * A text attribute's value from a netCDF-4 file's bytes, or null; the store
 * reads nothing else from these files. HDF5 writes a text attribute as its
 * name, null-padded to 8 bytes in a version 1 message, a string datatype
 * (first byte 0x13) with the text's length, a scalar dataspace of 8 bytes
 * (version 1) or 4 (version 2), then the text, its length in bytes.
 */
export function attribute(file: Buffer, name: string): string | null {
  let at = file.indexOf(`${name}\0`, 0, "latin1");
  // Not the tail of a longer name, such as `xcitation`.
  while (at > 0 && /[\w]/.test(String.fromCharCode(file[at - 1]!)))
    at = file.indexOf(`${name}\0`, at + 1, "latin1");
  if (at < 0) return null;
  let p = at + name.length + 1;
  while (file[p] === 0 && p < at + name.length + 8) p++;
  if (file[p] !== 0x13 || p + 16 > file.length) return null;
  const length = file.readUInt32LE(p + 4);
  const space = { 1: 8, 2: 4 }[file[p + 8] as number];
  if (!space) return null;
  p += 8 + space;
  const value = file
    .toString("utf8", p, p + length)
    .replace(/\0+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  // A one-byte placeholder, such as A121TG's empty platform_name, isn't text.
  return /^[\p{L}\p{N}\p{P}\p{Zs}\p{S}]+$/u.test(value) && value.length > 1 ? value : null;
}

/**
 * A gauge's `platform_name`, or null for the code in its place. The Baltic
 * unit's files cut a name with letters beyond ASCII short, a byte for each
 * byte past the first such a letter takes ("Fåbor" for Fåborg), or put U+FFFD
 * in a letter's place ("Ark�"), so those names give way to the code
 * (erratum `cmems-baltic-names`).
 */
function nameOf(name: string | null, file: string): string | null {
  return name && /\/BO_TS_/.test(file) && /[^\x20-\x7e]/.test(name) ? null : name;
}

/** The sentence every file's `citation` starts with; what follows is the provider's own. */
const CITATION =
  /^These data were collated within the Copernicus Marine Service \(In Situ\) and EMODnet collaboration framework\. Data is made freely available by the Copernicus Marine Service and the programs that contribute to it\.\s*/;

/** What a station takes from its newest file. */
type Details = Pick<CmemsStation, "name" | "datum_information" | "citation">;

/** A file's name, datum and credit, or null where it can't be read, such as a daily file gone from the window. */
async function detailsOf(code: string, path: string): Promise<Details | null> {
  let file: Buffer;
  try {
    file = Buffer.from(await getText(`${ROOT}/${path}`, { base64: true }), "base64");
  } catch (error) {
    console.warn(`CMEMS ${code}: can't read ${path}: ${(error as Error).message}`);
    return null;
  }
  // Every file names the Copernicus licence; one naming another, or none, needs a decision first.
  const license = attribute(file, "license");
  if (license !== metadata.license.url)
    throw new Error(`CMEMS ${code}: ${path} names the licence ${license}`);
  return {
    name: nameOf(attribute(file, "platform_name"), path) ?? code,
    datum_information: attribute(file, "sea_level_datum"),
    citation: attribute(file, "citation")?.replace(CITATION, "") || null,
  };
}

/**
 * Every tide gauge with sea level in the product's history, active where its
 * latest window has a file. The datum, name and credit come from each gauge's
 * newest file: its latest daily file, or, for a gauge that has stopped, its
 * history file, read once: a stopped gauge the store's list (`previous`)
 * already has, with the same last day, keeps what it had. A file that can't
 * be read keeps what the list had, or leaves the name to the code.
 */
export async function stations(previous: Station[] = []): Promise<CmemsStation[]> {
  const history = parseIndex(await getText(`${NATIVE}/index_history.txt`, { fresh: true }));
  const latest = parseIndex(await getText(`${NATIVE}/index_latest.txt`, { fresh: true }));
  // An empty index is a broken response; taken at its word, it would retire every station.
  if (!history.size) throw new Error("CMEMS's history index lists no tide gauges");
  if (!latest.size) throw new Error("CMEMS's latest index lists no tide gauges");
  // A latest index short of most gauges would retire them, and the monthly
  // refetch would then skip them; the refresh's own guard counts every
  // station, active or not, so it can't see this.
  const was = previous.filter((s) => s.status === "active").length;
  if (was >= 20 && latest.size < was / 2)
    throw new Error(`CMEMS's latest index lists ${latest.size} tide gauges, the store ${was}`);
  const listed = new Map((previous as CmemsStation[]).map((s) => [s.source_id, s]));
  const out: CmemsStation[] = [];
  for (const code of [...new Set([...history.keys(), ...latest.keys()])].sort()) {
    const past = (history.get(code) ?? []).sort((a, b) => a.end.localeCompare(b.end));
    const recent = (latest.get(code) ?? []).sort((a, b) => a.file.localeCompare(b.file));
    const newest = recent.at(-1) ?? past.at(-1)!;
    const institution = newest.institution || null;
    const active = recent.length > 0;
    const record_end = active ? null : newest.end.slice(0, 10);
    const had = listed.get(code);
    const kept: Details | undefined = had && {
      name: had.name,
      datum_information: had.datum_information ?? null,
      citation: had.citation ?? null,
    };
    // A stopped gauge keeps what an earlier read found, never an empty fallback.
    const read = kept && (kept.datum_information !== null || kept.citation !== null);
    const details = (!active && had?.record_end === record_end && read && kept) ||
      (await detailsOf(code, newest.file)) ||
      kept || { name: code, datum_information: null, citation: null };
    out.push({
      ...stationDefaults(metadata),
      id: `${metadata.id}/${code}`,
      source_id: code,
      name: details.name,
      lat: newest.lat,
      lon: newest.lon,
      // shortcut: CMEMS gives only the institution's country, which isn't the
      // gauge's for SHOM's or JRC's networks abroad; set it if a country lookup by position arrives.
      country_code: null,
      kind: null,
      interval_s: null,
      datum: DATUM,
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      // A provider's credit line, such as SHOM's DOI, is a condition of use, so it goes where users read credits.
      // None found (SHOM's DOI, the Open Government Licence, DL-DE Zero 2.0) restricts republishing or commercial use.
      attribution: [metadata.attribution, institution, details.citation].filter(Boolean).join("; "),
      tide_station: null,
      same_as: [],
      status: active ? "active" : "inactive",
      live: false,
      min_interval_s: null,
      source_url: metadata.url,
      datum_information: details.datum_information,
      institution,
      citation: details.citation,
      record_start: [...past, ...recent].map((r) => r.start.slice(0, 10)).sort()[0] ?? null,
      record_end,
    });
  }
  return out;
}

/** Where a dataset's per-platform SQLite chunks are, and how long each chunk's span is. */
interface Chunks {
  href: string;
  ref: number;
  len: number;
}

const chunked = new Map<string, Promise<Chunks>>();

/** The `history` or `latest` dataset's chunk layout, from its STAC record, once a run. */
function chunksOf(part: "history" | "latest"): Promise<Chunks> {
  let found = chunked.get(part);
  if (!found) {
    found = getJson<{
      assets: {
        platformChunked: {
          href: string;
          viewDims: { time: { chunkRefCoord: number; chunkLen: { timeSeries: number } } };
        };
      };
    }>(`${STAC}${part}/dataset.stac.json`, { fresh: true }).then(({ assets }) => {
      const layout = {
        href: assets.platformChunked.href,
        ref: assets.platformChunked.viewDims.time.chunkRefCoord,
        len: assets.platformChunked.viewDims.time.chunkLen.timeSeries,
      };
      // A renamed field would read as no chunks, every gauge empty, or as chunks without end.
      if (!layout.href || !Number.isFinite(layout.ref) || !(layout.len > 0))
        throw new Error(`CMEMS's ${part} STAC record has no chunk layout the store reads`);
      return layout;
    });
    found.catch(() => chunked.delete(part));
    chunked.set(part, found);
  }
  return found;
}

interface Row {
  time: number;
  value: number | null;
  value_qc: number | null;
}

/** A platform's sea levels in a dataset over [from, to) seconds, chunk by chunk. */
async function rows(part: "history" | "latest", code: string, from: number, to: number) {
  const { href, ref, len } = await chunksOf(part);
  const out: Row[] = [];
  for (let i = Math.floor((from - ref) / len); i <= Math.floor((to - 1 - ref) / len); i++) {
    let body: string;
    try {
      body = await getText(`${href}/${encodeURIComponent(code)}___TG/SLEV/${i}.0.0.0.sqlite`, {
        base64: true,
        // A chunk ending within the last year can still be rewritten.
        fresh: (ref + (i + 1) * len) * 1000 > Date.now() - 365 * DAY_MS,
      });
    } catch (error) {
      // The bucket answers a chunk that doesn't exist, a span with no values, with 403.
      if (error instanceof HttpError && / returned 40[34]$/.test(error.message)) continue;
      throw error;
    }
    const db = new DatabaseSync(":memory:");
    try {
      db.deserialize(new Uint8Array(Buffer.from(body, "base64")));
      // A row at a time: a chunk of minutes holds more rows than a spread can pass.
      for (const row of db
        .prepare(
          "SELECT time, value, value_qc FROM data WHERE time >= ? AND time < ? ORDER BY time",
        )
        .iterate(from, to))
        out.push(row as unknown as Row);
    } finally {
      db.close();
    }
  }
  return out;
}

/**
 * Copernicus QC flags: 0 none, 1 good, 2 probably good, 3 probably bad, 4 bad,
 * 5 changed, 7 nominal, 8 interpolated, 9 missing (dropped).
 */
function flagOf(qc: number | null): Flag | null {
  switch (qc) {
    case 0:
      return Flag.preliminary;
    case 1:
    case 2:
    case 5:
      return Flag.good;
    case 4:
      return Flag.bad;
    case 8:
      return Flag.interpolated;
    case 9:
      return null;
    default:
      return Flag.suspect;
  }
}

/** How far back the latest window is asked for; it holds about the last 30 days. */
const LATEST_MS = 60 * DAY_MS;

/**
 * Levels over [start, end) in the gauge's own datum, in meters. The history
 * copy holds each gauge's record to about two months ago and the latest
 * window about the last month, sometimes finer. Where both have a time, the
 * history's value stands; the latest window's others are `preliminary`. The source keeps
 * stored values (`keepsStored`), so a month the latest window has moved past
 * keeps what it held until the history copy reaches it.
 */
export async function levels(
  code: string,
  start: Date,
  end: Date,
  {
    datum = DATUM,
    record_start,
    record_end,
  }: Partial<Pick<CmemsStation, "datum" | "record_start" | "record_end">> = {},
): Promise<Observation[]> {
  if (datum !== DATUM) throw new Error(`CMEMS ${code} is measured from ${DATUM}, not ${datum}`);
  const from = Math.max(start.getTime(), record_start ? Date.parse(record_start) : -Infinity);
  const to = Math.min(end.getTime(), record_end ? Date.parse(record_end) + DAY_MS : Infinity);
  if (from >= to) return [];
  const [a, b] = [Math.floor(from / 1000), Math.ceil(to / 1000)];
  const past = await rows("history", code, a, b);
  const since = Math.floor((Date.now() - LATEST_MS) / 1000);
  const recent = b > since ? await rows("latest", code, Math.max(a, since), b) : [];
  const out = new Map<number, Observation>();
  for (const [list, floor] of [
    [past, Flag.good],
    [recent, Flag.preliminary],
  ] as const)
    for (const r of list) {
      const flag = flagOf(r.value_qc);
      // A level no gauge can read is a fill value, such as 999,999.06 m, so it's missing
      // (erratum `cmems-fill-values`).
      if (r.value === null || !possible(r.value) || flag === null || out.has(r.time)) continue;
      out.set(r.time, { time: r.time * 1000, level: r.value, flag: Math.max(flag, floor) as Flag });
    }
  return [...out.values()].sort((x, y) => x.time - y.time);
}

export const source: Source = {
  metadata,
  // The latest window holds about the last month and the history copy reaches about two months back, so every
  // gauge is read again from six months back, closing the gap and finalizing what the history copy replaced.
  // Stopped gauges too, since the history copy reaches a gauge's last months after it leaves the latest window.
  schedule: {
    refetch: (today) => [
      ["all", firstOfMonth(today, -6), firstOfMonth(today, 1), "--with-inactive"],
    ],
  },
  stations,
  observations: (s, start, end) => levels(s.source_id, start, end, s as CmemsStation),
  // A file's datum text names its gauge's zero; a new one is a new reference,
  // though every series is stored as ZERO.
  seriesChanged: (committed, listed) => {
    const text = (s: unknown) =>
      (s as Partial<CmemsStation>).datum_information?.toLowerCase().replace(/\s+/g, " ") ?? null;
    const [was, now] = [text(committed), text(listed)];
    return was && now && was !== now
      ? `CMEMS's sea_level_datum changed from "${(committed as CmemsStation).datum_information}" to "${(listed as CmemsStation).datum_information}"`
      : null;
  },
  // The latest window holds only the last month or so, and the history copy
  // can be sampled more coarsely, so a refetch must not drop what the store holds.
  keepsStored: true,
};
