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
 * The Marine Institute's Irish National Tide Gauge Network: 5-minute sea levels
 * from its ERDDAP, in meters above Ordnance Datum Malin. See README.md.
 */
const ERDDAP = "https://erddap.marine.ie/erddap/tabledap";
const DATASET = "IrishNationalTideGaugeNetwork";

export const metadata: SourceMetadata = {
  id: "marine-institute",
  name: "Marine Institute, Irish National Tide Gauge Network",
  url: "https://erddap.marine.ie/erddap/tabledap/IrishNationalTideGaugeNetwork.html",
  license: {
    id: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0 International",
    url: "https://creativecommons.org/licenses/by/4.0/",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "Marine Institute",
  terms:
    "CC BY 4.0: credit the Marine Institute, link to the license and say if the data was changed. The Marine Institute accepts no responsibility for errors, omissions or misleading information in the data, or for loss or damage from its use. Changes in the lake: quality flags added and missing values dropped.",
};

/** Ordnance Datum Malin, which every gauge reports, and Lowest Astronomical Tide. */
const DATUM = "ODM";
const LAT = "LAT";
/** What a gauge the network names "Unreferenced" measures from: its OD Malin column, tied to no benchmark. */
const ZERO = "ZERO";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * A station as listed. `record_start` and `record_end` are the first and last
 * days the network has, which a backfill keeps to; `record_end` is null while
 * the gauge still reports. Kept in the lake's list only.
 */
export type MarineInstituteStation = ListedStation & {
  record_start: string | null;
  record_end: string | null;
};

type Row = Record<string, string | number | null>;

interface Table {
  table: { columnNames: string[]; rows: (string | number | null)[][] };
}

/** ERDDAP's rows as objects keyed by column name. */
function rowsOf(body: Table): Row[] {
  const { columnNames, rows } = body.table;
  return rows.map((r) => Object.fromEntries(columnNames.map((c, i) => [c, r[i] ?? null])));
}

/** `<dataset>.json?<variables>&<constraints>`, each part percent-encoded. */
function url(variables: string, constraints: string[] = []): string {
  return `${ERDDAP}/${DATASET}.json?${[variables, ...constraints].map(encodeURIComponent).join("&")}`;
}

/** The network's `station_id`, such as "Malin Head - Portmore Pier", as `malin-head-portmore-pier`. */
export function slug(stationId: string): string {
  return stationId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function datumOf(stationId: string): string {
  return /unreferenced/i.test(stationId) ? ZERO : DATUM;
}

/**
 * Every gauge in the dataset, with its record span and its current offset to
 * LAT. Spans come one station at a time: the whole dataset's outlasts ERDDAP's
 * 60-second gateway timeout.
 */
export async function stations(): Promise<MarineInstituteStation[]> {
  const listed = rowsOf(await request(url("station_id,longitude,latitude", ["distinct()"]), true));
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!listed.length) throw new Error("The Marine Institute listed no stations");
  // `distinct()` gives a row per position, so a gauge that moved comes more than once.
  const byName = new Map(listed.map((r) => [String(r.station_id), r]));
  const slugs = new Map<string, string>();
  for (const name of byName.keys()) {
    const other = slugs.get(slug(name));
    if (other) throw new Error(`Marine Institute gauges "${other}" and "${name}" share an ID`);
    slugs.set(slug(name), name);
  }
  const out: MarineInstituteStation[] = [];
  for (const [name, r] of byName) {
    const span = rowsOf(
      await request(
        url("station_id,time,longitude,latitude,Water_Level_LAT,Water_Level_OD_Malin", [
          `station_id=${JSON.stringify(name)}`,
          'orderByMinMax("station_id,time")',
        ]),
        true,
      ),
    );
    const first = span[0]?.time;
    const last = span.at(-1);
    const ended =
      typeof last?.time === "string" && Date.parse(last.time) < Date.now() - 365 * DAY_MS;
    const datum = datumOf(name);
    const lat = last?.Water_Level_LAT;
    const odm = last?.Water_Level_OD_Malin;
    out.push({
      ...stationDefaults(metadata),
      id: `${metadata.id}/${slug(name)}`,
      source_id: slug(name),
      name,
      // The latest row's position, since a gauge that moved has several.
      lat: Number(last?.latitude ?? r.latitude),
      lon: Number(last?.longitude ?? r.longitude),
      country_code: "IE",
      kind: "coastal",
      interval_s: 300,
      datum,
      // LAT less OD Malin is the same in every row of a gauge's current LAT; rounded to the millimeter both come in.
      datums:
        datum === DATUM && typeof lat === "number" && typeof odm === "number"
          ? { [LAT]: Math.round((lat - odm) * 1000) / 1000 }
          : {},
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      status: ended ? "inactive" : "active",
      // Values reach ERDDAP within minutes.
      live: !ended,
      min_interval_s: null,
      source_url: metadata.url,
      record_start: typeof first === "string" ? first.slice(0, 10) : null,
      record_end: ended ? String(last!.time).slice(0, 10) : null,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Levels over [start, end) in meters above OD Malin (or the unreferenced zero
 * of a gauge the network names so), a calendar year per request. `stationId` is
 * the network's `station_id`, the station's `name`.
 */
export async function levels(
  stationId: string,
  start: Date,
  end: Date,
  {
    datum = datumOf(stationId),
    record_start,
    record_end,
  }: Partial<Pick<MarineInstituteStation, "datum" | "record_start" | "record_end">> = {},
): Promise<Observation[]> {
  // Every gauge's levels come from the one OD Malin column; a station recorded
  // in another datum would mix two references in its files.
  if (datum !== datumOf(stationId))
    throw new Error(
      `Marine Institute ${stationId} is measured from ${datumOf(stationId)}, not ${datum}`,
    );
  const from = Math.max(start.getTime(), record_start ? Date.parse(record_start) : -Infinity);
  const to = Math.min(end.getTime(), record_end ? Date.parse(record_end) + DAY_MS : Infinity);
  const out: Observation[] = [];
  for (const [a, b] of years(from, to)) {
    const rows = rowsOf(
      await request(
        url("time,Water_Level_OD_Malin,QC_Flag", [
          `station_id=${JSON.stringify(stationId)}`,
          `time>=${new Date(a).toISOString()}`,
          `time<${new Date(b).toISOString()}`,
        ]),
        false,
        b,
      ),
    );
    for (const r of rows) {
      const flag = flagOf(r.QC_Flag);
      if (typeof r.Water_Level_OD_Malin !== "number" || flag === null) continue;
      out.push({ time: Date.parse(String(r.time)), level: r.Water_Level_OD_Malin, flag });
    }
  }
  return out;
}

/** QC_Flag: 1 good, 0 not yet checked, 9 missing; the dataset documents no others. */
function flagOf(qc: unknown): Flag | null {
  return qc === 1 ? Flag.good : qc === 0 ? Flag.preliminary : qc === 9 ? null : Flag.suspect;
}

/** [from, to) split at UTC calendar years. */
function* years(from: number, to: number): Generator<[number, number]> {
  for (let t = from; t < to;) {
    const next = Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
    yield [t, Math.min(next, to)];
    t = next;
  }
}

/** The Marine Institute's ERDDAP publishes no limit; requests start a second apart. */
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
 * other 404 fails. Station lists are fresh. A range of levels ending at `end`
 * is cached only when every value is QC'd good and they run to its last hour,
 * since unchecked values can still be checked or replaced.
 */
async function request(href: string, fresh = false, end?: number): Promise<Table> {
  try {
    return await getJson<Table>(href, {
      fresh,
      pace,
      keep: (text) => end !== undefined && final(text, end),
    });
  } catch (error) {
    if (error instanceof HttpError && /produced no matching results/.test(error.body))
      return { table: { columnNames: [], rows: [] } };
    throw error;
  }
}

export function final(text: string, end: number): boolean {
  const { columnNames, rows } = (JSON.parse(text) as Table).table;
  const qc = columnNames.indexOf("QC_Flag");
  const time = columnNames.indexOf("time");
  const last = rows.at(-1)?.[time];
  return (
    rows.every((r) => r[qc] === 1) && typeof last === "string" && Date.parse(last) >= end - HOUR_MS
  );
}

export const source: Source = {
  metadata,
  stations,
  observations: (s, start, end) => levels(s.name, start, end, s as MarineInstituteStation),
};
