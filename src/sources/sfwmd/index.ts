import { getText } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type Kind,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
  type Station,
} from "../../schema.ts";
import { unzip } from "../pegelonline/index.ts";

/**
 * South Florida Water Management District stage at tidal structures and
 * estuaries, from DBHYDRO through the API behind DBHYDRO Insights. Each
 * station joins two of DBHYDRO's series (dbkeys): the derived, reviewed record
 * up to where it ends, and the telemetry series after. See README.md.
 */
const API = "https://insightsdata.api.sfwmd.gov/v1/insights-data";
const DATUM = "NAVD88";
const FEET = 0.3048;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** DBHYDRO's times are Eastern Standard Time all year. */
const EST_MS = -5 * HOUR_MS;

export const metadata: SourceMetadata = {
  id: "sfwmd",
  name: "South Florida Water Management District (DBHYDRO)",
  url: "https://www.sfwmd.gov/science-data/dbhydro",
  license: {
    id: "SFWMD-public-records",
    name: "Florida public records, no license stated",
    url: "https://www.sfwmd.gov/disclaimer",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "South Florida Water Management District",
  terms:
    "SFWMD publishes DBHYDRO without a license or a restriction on reuse, as Florida public records. Its disclaimer gives the data as is, without warranty, and asks users to get it from the District's own server. Provisional values are subject to revision. Changes in the lake: levels converted from feet to meters and rounded to the millimeter, missing readings dropped, and quality flags added.",
  // Telemetry arrives within minutes.
  hourly: true,
  // Provisional values are approved within days to months.
  finalizes: true,
  utc_offsets: [-5, -5],
};

/**
 * The SFWMD gauges TICON keeps, all with a tidal signal: structure tailwaters
 * (and G-58's headwater) on canals at tidewater, estuary gauges on the Miami,
 * Caloosahatchee and Loxahatchee rivers, and three bay gauges in Florida Bay
 * and Barnes Sound.
 */
const TIDAL: Record<string, Kind> = {
  COCO1_T: "estuary",
  G54_T: "estuary",
  G56_T: "estuary",
  G57_T: "estuary",
  G58_H: "estuary",
  G93_T: "estuary",
  GG1_T: "estuary",
  "GORDON 2_T": "estuary",
  GORDY_T: "estuary",
  HALDEMAN_T: "estuary",
  HC1_T: "estuary",
  MARKH: "estuary",
  MBTS: "coastal",
  MDTS: "coastal",
  MRMS1: "estuary",
  MRMS4: "estuary",
  S123_T: "estuary",
  S13_T: "estuary",
  S155_T: "estuary",
  S197_T: "estuary",
  S20F_T: "estuary",
  S20G_T: "estuary",
  S21_T: "estuary",
  S21A_T: "estuary",
  S22_T: "estuary",
  S25_T: "estuary",
  S25B_T: "estuary",
  S25BM_T: "estuary",
  S26_T: "estuary",
  S27_T: "estuary",
  S28_T: "estuary",
  S29_T: "estuary",
  S36_T: "estuary",
  S37A_T: "estuary",
  S40_T: "estuary",
  S41_T: "estuary",
  S44_T: "estuary",
  S46_T: "estuary",
  S49_T: "estuary",
  S79_T: "estuary",
  TPTS: "coastal",
  VALI75: "estuary",
  WCOCO_T: "estuary",
};

/** A series in DBHYDRO's continuous catalog, as far as the adapter reads it. */
export interface CatalogSeries {
  timeseriesId: string;
  location: string | null;
  locationDesc: string | null;
  parameter: string;
  frequency: string;
  statisticType: string;
  agency: string;
  recorder: string | null;
  units: string | null;
  status: string | null;
  /** DDMMSS.sss, north. */
  latitude: number | null;
  /** DDMMSS.sss, west. */
  longitude: number | null;
  datumAware: string | null;
  /** Midnight EST of the first and last days, as epoch milliseconds. */
  startDate: number | null;
  endDate: number | null;
}

/**
 * An SFWMD station as listed. `series` is the telemetry series, which starts
 * at `series_start` and, once the station is inactive, ends at `series_end`.
 * `history` is the derived series, over [`history_start`, `history_end`) as
 * the catalog gives it. `record_start` is the first day either has, and
 * `record_end`, for an inactive station, the day after the last, so a backfill
 * asks for nothing outside them.
 */
export type SfwmdStation = ListedStation & {
  series: string;
  series_start: string | null;
  series_end: string | null;
  history: string | null;
  history_start: string | null;
  history_end: string | null;
  record_start: string | null;
  record_end: string | null;
};

/** A DBHYDRO dbkey: five letters or digits. */
const DBKEY = /^[A-Z0-9]{5}$/;

type Series = Pick<SfwmdStation, "series" | "history" | "history_end"> &
  Partial<
    Pick<
      SfwmdStation,
      "series_start" | "series_end" | "history_start" | "record_start" | "record_end"
    >
  >;

/**
 * Stage readings at an instant from the District's own gauges, in series
 * DBHYDRO converts to NAVD88 on request (`datumAware`).
 */
const isStage = (s: CatalogSeries) =>
  s.parameter === "STG" &&
  s.frequency === "BK" &&
  s.statisticType === "INST" &&
  s.agency === "WMD" &&
  s.datumAware === "Y";

/** Every station in `TIDAL` that the catalog lists a stage series for. */
export async function stations(): Promise<ListedStation[]> {
  // The catalog ignores filters and returns all 35,000 series, about 40 MB.
  const { results } = JSON.parse(
    await getText(`${API}/cont/ts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: {} }),
      fresh: true,
      pace,
    }),
  ) as { results: CatalogSeries[] };
  if (!results?.length) throw new Error("DBHYDRO listed no series");
  const byLocation = new Map<string, CatalogSeries[]>();
  for (const s of results)
    if (s.location && s.location in TIDAL && isStage(s))
      byLocation.set(s.location, [...(byLocation.get(s.location) ?? []), s]);
  return [...byLocation]
    .map(([location, series]) => toStation(location, series))
    .filter((s): s is SfwmdStation => s !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * `history` is the derived ("one parameter") series, DBHYDRO's reviewed record
 * joined from the gauge's earlier series. `series` is the latest-ending other
 * one, the earliest-starting of those that end together.
 */
export function toStation(location: string, series: CatalogSeries[]): SfwmdStation | null {
  // A derived series with no end can't say where telemetry takes over.
  const derived = series
    .filter((s) => s.recorder === "ONEP" && s.endDate != null)
    .sort((a, b) => (b.endDate ?? 0) - (a.endDate ?? 0))[0];
  const live = series
    .filter((s) => s.recorder !== "ONEP")
    .sort(
      // A series with no end date is still running.
      (a, b) =>
        (b.endDate ?? Number.MAX_SAFE_INTEGER) - (a.endDate ?? Number.MAX_SAFE_INTEGER) ||
        (a.startDate ?? 0) - (b.startDate ?? 0),
    )[0];
  const main = live ?? derived;
  // Only a derived series with no end: nothing to read, and the station goes unlisted.
  if (!main) return null;
  const history = live && derived ? derived : undefined;
  for (const s of [main, history]) {
    if (!s) continue;
    if (s.units !== "ft NAVD88")
      throw new Error(`DBHYDRO ${s.timeseriesId} at ${location} is in ${s.units}, not ft NAVD88`);
    if (!DBKEY.test(s.timeseriesId))
      throw new Error(`DBHYDRO ${location} lists an unreadable dbkey ${s.timeseriesId}`);
  }
  if (main.latitude == null || main.longitude == null)
    throw new Error(`DBHYDRO ${main.timeseriesId} at ${location} has no position`);
  const starts = [main.startDate, history?.startDate].filter((t): t is number => t != null);
  const ends = [main.endDate, history?.endDate].filter((t): t is number => t != null);
  const active = main.status === "A";
  const iso = (t: number | null | undefined) => (t == null ? null : new Date(t).toISOString());
  const id = location.replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    ...stationDefaults(metadata),
    id: `sfwmd/${id}`,
    source_id: id,
    // MARKH's description is a note about the gauge it replaced.
    name:
      location === "MARKH"
        ? "Caloosahatchee River at Marker H"
        : titleCase(main.locationDesc ?? location),
    lat: degrees(main.latitude),
    lon: -degrees(main.longitude),
    country_code: "US",
    kind: TIDAL[location]!,
    // Breakpoint readings, irregular and as close as 30 seconds apart.
    interval_s: null,
    datum: DATUM,
    datums: {},
    products: ["levels"],
    first: null,
    last: null,
    tide_station: null,
    same_as: [],
    status: active ? "active" : "inactive",
    live: active,
    min_interval_s: 300,
    source_url: `https://insightsdata.sfwmd.gov/#/shared-reports?timeseriesIds=${main.timeseriesId}&reportType=timeseries&format=json&period=3days&datum=NAVD88&module=continuous`,
    series: main.timeseriesId,
    series_start: iso(main.startDate),
    // Only a closed series' end is kept; an active one's moves every month.
    series_end: active || main.endDate == null ? null : iso(main.endDate + DAY_MS),
    history: history?.timeseriesId ?? null,
    history_start: iso(history?.startDate),
    history_end: iso(history?.endDate),
    record_start: starts.length ? iso(Math.min(...starts)) : null,
    // `endDate` is midnight EST starting the last day.
    record_end: !active && ends.length ? iso(Math.max(...ends) + DAY_MS) : null,
  };
}

/** DBHYDRO's packed DDMMSS.sss as decimal degrees. */
export function degrees(packed: number): number {
  const d = Math.floor(packed / 10000);
  const m = Math.floor((packed % 10000) / 100);
  const s = packed % 100;
  return Math.round((d + m / 60 + s / 3600) * 1e6) / 1e6;
}

/** `S-123 STRUCTURE ON CANAL C-100` → `S-123 Structure On Canal C-100`, keeping codes upper case. */
function titleCase(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b([A-Z])([A-Z]+)\b/g, (_, a: string, b: string) => a + b.toLowerCase())
    .replace(/'S\b/g, "'s");
}

/**
 * Levels in meters NAVD88 over [start, end): the derived series between
 * `history_start` and `history_end`, and the telemetry series before and after
 * it. The lake replaces each UTC month that has values, so the series switch
 * only at the start of a month: a month the derived series covers in part,
 * where telemetry covers it too, comes from telemetry, and a series that sends
 * nothing for a month leaves that month in the lake as it was. Where telemetry
 * ended before the derived series did, the derived series runs to the end.
 */
export async function levels(station: Series, start: Date, end: Date): Promise<Observation[]> {
  if (station.record_start)
    start = new Date(Math.max(start.getTime(), Date.parse(station.record_start)));
  if (station.record_end) end = new Date(Math.min(end.getTime(), Date.parse(station.record_end)));
  const [from, to] = [start.getTime(), end.getTime()];
  if (from >= to) return [];
  if (!station.history) return read(station.series, from, to);
  const seriesStart = Date.parse(station.series_start ?? "9999-01-01T00:00:00Z");
  const seriesEnd = Date.parse(station.series_end ?? "9999-01-01T00:00:00Z");
  const historyStart = Date.parse(station.history_start ?? "1900-01-01T00:00:00Z");
  const historyEnd = Date.parse(station.history_end ?? "1900-01-01T00:00:00Z");
  // Telemetry from before the derived series starts takes that first month too.
  const early = seriesStart < historyStart ? monthAfter(historyStart) : historyStart;
  // Telemetry takes the month the derived series ends in, unless it starts later in it.
  const late =
    seriesEnd <= historyEnd
      ? Infinity
      : Math.max(
          monthOf(historyEnd),
          monthAfter(Date.parse(station.series_start ?? "1900-01-01T00:00:00Z")),
        );
  let out: Observation[] = [];
  for (const [dbkey, a, b] of [
    [station.series, from, Math.min(to, early)],
    [station.history, Math.max(from, early), Math.min(to, late)],
    [station.series, Math.max(from, late), to],
  ] as const)
    if (a < b) out = out.concat(await read(dbkey, a, b));
  return out;
}

/** The start of the UTC month `time` falls in. */
const monthOf = (time: number) =>
  Date.UTC(new Date(time).getUTCFullYear(), new Date(time).getUTCMonth(), 1);
/** The first start of a UTC month at or after `time`. */
const monthAfter = (time: number) =>
  monthOf(time) === time
    ? time
    : Date.UTC(new Date(time).getUTCFullYear(), new Date(time).getUTCMonth() + 1, 1);

/**
 * One series over [from, to), asked for by whole EST days, one request per UTC
 * calendar year, so a backfill's year is one request.
 */
async function read(dbkey: string, from: number, to: number): Promise<Observation[]> {
  if (!DBKEY.test(dbkey)) throw new Error(`Not a DBHYDRO dbkey: ${dbkey}`);
  let out: Observation[] = [];
  for (let day = from; day < to;) {
    const first = estDate(day);
    const yearEnd = Date.UTC(new Date(day).getUTCFullYear() + 1, 0, 1);
    const last = estDate(Math.min(to, yearEnd) - 1);
    const zip = await getText(
      `${API}/cont/data?timeseriesIds=${dbkey}&reportType=timeseries&format=csv&startDate=${first}&endDate=${last}&datum=${DATUM}`,
      { base64: true, fresh: true, pace },
    );
    const files = [...(await unzip(zip)).values()];
    // A range with no readings comes as an empty zip.
    if (files.length > 1) throw new Error(`DBHYDRO ${dbkey} sent ${files.length} files`);
    // A year can hold 175,000 readings, too many to spread into push().
    const until = Math.min(to, yearEnd);
    if (files[0])
      out = out.concat(parse(files[0], dbkey).filter((o) => o.time >= day && o.time < until));
    day = Math.min(to, yearEnd);
  }
  return out;
}

/** `YYYYMMDD` of the EST day an instant falls on. */
function estDate(time: number): string {
  return new Date(time + EST_MS).toISOString().slice(0, 10).replaceAll("-", "");
}

/**
 * DBHYDRO's CSV: `#` notes, then
 * `TIMESERIESID,STATION,SOURCE_TIMESERIES,PARAMETER,TIMESTAMP,VALUE,CODE,REVISION_DATE,QUALITY_CODE`.
 */
const HEADER =
  "TIMESERIESID,STATION,SOURCE_TIMESERIES,PARAMETER,TIMESTAMP,VALUE,CODE,REVISION_DATE,QUALITY_CODE";

export function parse(text: string, dbkey: string): Observation[] {
  const out: Observation[] = [];
  let header = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const cells = line.split(",").map((c) => c.replace(/^"|"$/g, "").trim());
    if (!header) {
      if (cells.join(",") !== HEADER)
        throw new Error(`DBHYDRO ${dbkey} sent an unexpected header: ${line}`);
      header = true;
      continue;
    }
    const [id, , , parameter, timestamp, value, code, , quality] = cells;
    if (id !== dbkey || parameter !== "STG")
      throw new Error(`DBHYDRO ${dbkey} sent a row for ${id} ${parameter}`);
    // `M` marks a missing reading, which normally carries no value.
    if (!value || code === "M") continue;
    const time = Date.parse(`${timestamp!.replace(" ", "T")}Z`) - EST_MS;
    const feet = Number(value);
    if (Number.isNaN(time) || !Number.isFinite(feet))
      throw new Error(`DBHYDRO ${dbkey} sent a bad row: ${line}`);
    out.push({
      time,
      level: Math.round(feet * FEET * 1000) / 1000 + 0,
      flag: flagOf(quality!, code!),
    });
  }
  if (!header) throw new Error(`DBHYDRO ${dbkey} sent no data table`);
  return out;
}

/**
 * A is approved and P provisional. Of the codes, E marks an estimate; V comes
 * on ordinary approved readings and is undocumented, so it changes nothing;
 * any other is suspect.
 */
function flagOf(quality: string, code: string): Flag {
  const flag: Flag =
    quality === "A" ? Flag.good : quality === "P" ? Flag.preliminary : Flag.suspect;
  if (!code || code === "V") return flag;
  return Math.max(flag, code === "E" ? Flag.interpolated : Flag.suspect) as Flag;
}

/** DBHYDRO publishes no limit; a year's request takes about 20 seconds anyway. */
export const pacing = { requestMs: 1000 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/**
 * The series a station reads, from its list entry. A station read from
 * `stations.parquet` has only the telemetry series, which is enough for recent levels.
 */
function seriesOf(station: Station): Series {
  const s = station as Partial<SfwmdStation>;
  if (station.datum !== DATUM)
    throw new Error(`${station.id} is in ${station.datum}, not ${DATUM}`);
  // `stations.parquet` doesn't carry `series`; its `source_url` names the telemetry series.
  const series =
    s.series ??
    (station.source_url ? /timeseriesIds=([A-Z0-9]{5})&/.exec(station.source_url)?.[1] : undefined);
  if (!series) throw new Error(`${station.id} names no DBHYDRO series`);
  return {
    series,
    series_start: s.series_start ?? null,
    series_end: s.series_end ?? null,
    history: s.history ?? null,
    history_start: s.history_start ?? null,
    history_end: s.history_end ?? null,
    record_start: s.record_start ?? null,
    record_end: s.record_end ?? null,
  };
}

export const source: Source = {
  metadata,
  stations,
  observations: async (s, start, end) => levels(seriesOf(s), start, end),
};
