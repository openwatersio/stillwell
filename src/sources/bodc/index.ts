import { getJson, HttpError } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
} from "../../schema.ts";

/**
 * BODC's processed, quality-controlled 15-minute levels from the UK National
 * Tide Gauge Network, from its ERDDAP, in meters above Admiralty Chart Datum.
 * See README.md.
 */
const ERDDAP = "https://erddap.bodc.ac.uk/erddap/tabledap";

export const metadata: SourceMetadata = {
  id: "bodc",
  name: "British Oceanographic Data Centre, UK National Tide Gauge Network",
  url: "https://www.bodc.ac.uk/data/hosted_data_systems/sea_level/uk_tide_gauge_network/",
  license: {
    id: "OGL-UK-3.0",
    name: "Open Government Licence v3.0",
    url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    commercial_use: true,
    redistribution: true,
  },
  attribution:
    "British Oceanographic Data Centre, as part of the function of the National Tidal and Sea Level Facility; Environment Agency",
  contact: { email: "enquiries@bodc.ac.uk" },
  terms:
    "Open Government Licence v3.0, as each dataset's ERDDAP metadata says and BODC confirmed in writing (ticket BODCREQ-11479, 9 November 2026), which allows republishing under CC BY 4.0. Credit BODC, as part of the National Tidal and Sea Level Facility, and the Environment Agency, which owns the network.",
  // BODC processes each month weeks to months after it ends.
  hourly: false,
  // BODC sends no preliminary values, but it adds months late, fills gaps and
  // reflags months it has published, so the monthly refetch reads the last
  // three years again (monthly.yml).
  finalizes: true,
};

/** Admiralty Chart Datum, which BODC's levels are measured from. */
const DATUM = "CD";

/**
 * Chart datum's height relative to ordnance datum (Newlyn, or the local one
 * where the network uses it), in meters, by BODC's port code, from NTSLF's
 * table (https://ntslf.org/tides/datum). The EA's mAOD readings agree to the
 * centimeter where they overlap; README.md lists where they differ. Harwich and
 * Portbury aren't in the table.
 */
const CD_TO_OD: Record<string, number> = {
  ABE: -2.25,
  BAN: -2.01,
  BAR: -2.44,
  BOU: -1.4,
  CRO: -2.75,
  DEV: -3.22,
  DOV: -3.67,
  FIS: -2.44,
  HEY: -4.9,
  HIN: -5.9,
  HOL: -3.05,
  ILF: -4.8,
  IMM: -3.9,
  IOM: -2.75,
  JER: -5.88,
  KIN: -2.5,
  LEI: -2.9,
  LER: -1.22,
  LIV: -4.93,
  LLA: -3.85,
  LOW: -1.5,
  MHA: -3.71,
  MIL: -1.62,
  MUM: -5.0,
  NEW: -3.05,
  NHA: -3.52,
  NPO: -5.81,
  NSH: -2.6,
  POR: -1.8,
  PRU: -1.24,
  PTM: -2.73,
  SHE: -2.9,
  STM: -2.91,
  STO: -2.71,
  TOB: -2.39,
  ULL: -2.75,
  WEY: -0.93,
  WHI: -3.0,
  WIC: -1.71,
  WOR: -4.2,
};

/** Gauges outside Great Britain and Northern Ireland. */
const COUNTRY: Record<string, string> = { JER: "JE", IOM: "IM" };

/**
 * The channel BODC's processed series is. Each dataset holds every sensor's
 * channel and marks none as the main one; this one matches GESLA's copy of
 * BODC's processed files value for value at every gauge both have.
 */
const LEVEL = "ASLVBG02";

type Cell = string | number | null;
type Row = Record<string, Cell>;

interface Table {
  table: { columnNames: string[]; rows: Cell[][] };
}

function rowsOf(body: Table): Row[] {
  const { columnNames, rows } = body.table;
  return rows.map((r) => Object.fromEntries(columnNames.map((c, i) => [c, r[i] ?? null])));
}

/** `<dataset>.json?<variables>&<constraints>`, each part percent-encoded. */
function url(dataset: string, variables: string, constraints: string[] = []): string {
  return `${ERDDAP}/${dataset}.json?${[variables, ...constraints].map(encodeURIComponent).join("&")}`;
}

/** Each gauge's dataset, such as `LER_ukcff_4109_001`, by port code. */
async function datasets(): Promise<Row[]> {
  const rows = rowsOf(
    await request(
      url("allDatasets", "datasetID,title,minLongitude,minLatitude", ['datasetID=~".*_ukcff_.*"']),
    ),
  );
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!rows.length)
    throw new Error("BODC's ERDDAP listed no UK National Tide Gauge Network datasets");
  return rows;
}

let byCode: Promise<Map<string, string>> | undefined;

/** The dataset of a port code, looked up once a run, since `stations.parquet` doesn't keep it. */
async function datasetOf(code: string): Promise<string> {
  // A failed lookup isn't kept, so the next station asks again.
  byCode ??= datasets()
    .then(byPort)
    .catch((error: unknown) => {
      byCode = undefined;
      throw error;
    });
  const dataset = (await byCode).get(code.toUpperCase());
  if (!dataset) throw new Error(`BODC's ERDDAP has no dataset for ${code}`);
  return dataset;
}

/** Datasets by port code, refusing two for one code, since which is the gauge's isn't known. */
function byPort(rows: Row[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) {
    const dataset = String(r.datasetID);
    const code = dataset.split("_")[0]!;
    const other = out.get(code);
    if (other)
      throw new Error(`BODC's ERDDAP has two datasets for ${code}: ${other} and ${dataset}`);
    out.set(code, dataset);
  }
  return out;
}

export async function stations(): Promise<ListedStation[]> {
  const rows = await datasets();
  byPort(rows);
  return rows
    .map((r) => {
      const dataset = String(r.datasetID);
      const code = dataset.split("_")[0]!;
      const od = CD_TO_OD[code];
      return {
        ...stationDefaults(metadata),
        id: `${metadata.id}/${code.toLowerCase()}`,
        source_id: code.toLowerCase(),
        name: String(r.title).replace(/^.*tide gauge station /, ""),
        // Immingham's and Newhaven's are -999, and Workington's is in Cornwall:
        // erratum `bodc-erddap-positions`, corrected in POSITIONS.
        lat: Number(r.minLatitude),
        lon: Number(r.minLongitude),
        country_code: COUNTRY[code] ?? "GB",
        kind: "coastal" as const,
        interval_s: 900,
        datum: DATUM,
        datums: (od === undefined ? {} : { AOD: od }) as Record<string, number>,
        products: ["levels" as const],
        first: null,
        last: null,
        tide_station: null,
        same_as: [],
        // Every gauge still runs; BODC's months only arrive late.
        status: "active" as const,
        live: false,
        min_interval_s: null,
        source_url: `${ERDDAP}/${dataset}.html`,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Levels over [start, end) in meters above chart datum, a calendar year per
 * request. `code` is the station's `source_id`.
 */
export async function levels(
  code: string,
  start: Date,
  end: Date,
  datum = DATUM,
): Promise<Observation[]> {
  if (datum !== DATUM) throw new Error(`BODC ${code} is measured from ${DATUM}, not ${datum}`);
  const dataset = await datasetOf(code);
  const out: Observation[] = [];
  for (const [a, b] of years(start.getTime(), end.getTime())) {
    const rows = rowsOf(
      await request(
        // Half a minute either side, so a value stamped just off a year's edge comes with the year it rounds into.
        url(dataset, `time,${LEVEL},F${LEVEL}`, [
          `time>=${new Date(a - 30_000).toISOString()}`,
          `time<${new Date(b - 30_000).toISOString()}`,
        ]),
      ),
    );
    for (const r of rows) {
      let flag = flagOf(r[`F${LEVEL}`]);
      const level = r[LEVEL];
      if (typeof level !== "number" || flag === null) continue;
      // An improbable 0 or -1 mm stands in for no reading, at some gauges for years (see README.md).
      if (qualifier(r[`F${LEVEL}`]) === "M" && Math.abs(level) <= 0.001) flag = Flag.bad;
      // Times come a few milliseconds off the quarter hour: erratum `bodc-erddap-times`.
      const time = Math.round(Date.parse(String(r.time)) / 60_000) * 60_000;
      if (time >= a && time < b) out.push({ time, level, flag });
    }
  }
  return out;
}

/**
 * BODC's qualifier, quoted as `'M'`: blank is good, `M` improbable, `N` null
 * and `T` interpolated. Any other letter is taken as suspect.
 */
export function flagOf(raw: Cell): Flag | null {
  const f = qualifier(raw);
  if (f === "") return Flag.good;
  if (f === "N") return null;
  if (f === "T") return Flag.interpolated;
  return Flag.suspect;
}

/** BODC's qualifier without its quotes. */
function qualifier(raw: Cell): string {
  return String(raw ?? "")
    .replace(/'/g, "")
    .trim();
}

/** [from, to) split at UTC calendar years. */
function* years(from: number, to: number): Generator<[number, number]> {
  for (let t = from; t < to;) {
    const next = Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
    yield [t, Math.min(next, to)];
    t = next;
  }
}

/** BODC's ERDDAP publishes no limit; requests start a second apart. */
export const pacing = { requestMs: 1000 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/**
 * ERDDAP answers a query with no rows with 404 and says so in the body; any
 * other 404 fails. Never cached: BODC adds months to a year, and fills gaps, late.
 */
async function request(href: string): Promise<Table> {
  try {
    return await getJson<Table>(href, { fresh: true, pace });
  } catch (error) {
    if (error instanceof HttpError && /produced no matching results/.test(error.body))
      return { table: { columnNames: [], rows: [] } };
    throw error;
  }
}

/** Forget the dataset lookup, for tests that serve another list. */
export function reset(): void {
  byCode = undefined;
}

export const source: Source = {
  metadata,
  stations,
  observations: (s, start, end) => levels(s.source_id, start, end, s.datum),
};
