import { getJson, getText } from "../../http.ts";
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
 * The Environment Agency's real-time flood-monitoring API, for its tide
 * gauges: the UK National Tide Gauge Network's and the EA's own coastal ones.
 * The readings API keeps about 30 days, the daily archive files about a year.
 * See README.md.
 */
const API = "https://environment.data.gov.uk/flood-monitoring";
const DAY_MS = 86_400_000;
/** Days back the archive's files are sure to reach; it kept about 380 in November 2026. */
const ARCHIVE_DAYS = 350;
/** Whole days back the readings API still answers for, two short of what it keeps. */
const API_DAYS = 28;

export const metadata: SourceMetadata = {
  id: "ea",
  name: "Environment Agency",
  url: "https://environment.data.gov.uk/flood-monitoring/doc/reference",
  license: {
    id: "OGL-UK-3.0",
    name: "Open Government Licence v3.0",
    url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    commercial_use: true,
    redistribution: true,
  },
  attribution:
    "This uses Environment Agency flood and river level data from the real-time data API (Beta)",
  contact: { url: "https://environment.data.gov.uk/support" },
  terms: "Real-time readings, not quality-controlled.",
  // The readings API has each reading within the hour.
  hourly: true,
  // The EA never quality-controls or revises a reading, so none becomes final.
  finalizes: false,
};

/**
 * The measure a station's levels are read from, from its notation and datum,
 * so a station from `stations.parquet`, without the list's extra fields, has it.
 */
export function measureOf(station: { source_id: string; datum: string | null }): string {
  return `${station.source_id}-level-tidal_level-Mean-15_min-${station.datum === "CD" ? "m" : "mAOD"}`;
}

interface ApiMeasure {
  "@id": string;
  qualifier?: string;
  unitName?: string;
  period?: number;
}

interface ApiStation {
  notation: string;
  RLOIid?: string;
  label: string | string[];
  lat?: number | number[];
  long?: number | number[];
  measures?: ApiMeasure | ApiMeasure[];
}

/** Gauges outside Great Britain and Northern Ireland, by label. */
const COUNTRIES: Record<string, string> = { Jersey: "JE", "Port Erin": "IM" };

/** A tidal level series' unit, and the datum it measures from. */
const UNITS: Record<string, string> = { mAOD: "AOD", m: "CD" };

/**
 * Every `TideGauge` station with a tidal level in meters. Most National Tide
 * Gauge Network gauges are listed twice, once in mAOD and once in meters above
 * chart datum, with the same readings, so a gauge's chart datum series is kept
 * only where it has no mAOD one (Avonmouth, Bournemouth, Hinkley Point and
 * Immingham). Series in millimeters copy one in meters.
 */
export async function stations(): Promise<ListedStation[]> {
  const { items } = await getJson<{ items: ApiStation[] }>(
    `${API}/id/stations?type=TideGauge&_limit=1000`,
    { fresh: true },
  );
  const tidal = items.flatMap((s) => {
    // Only the series the archive's day files are read for, so backfill and
    // hourly ingest read the same one.
    const measure = [s.measures ?? []]
      .flat()
      // The mAOD series first, where a station has both.
      .sort((a, b) => Number(b.unitName === "mAOD") - Number(a.unitName === "mAOD"))
      .find((m) => TIDE_GAUGE.test(`${m["@id"]},`) && UNITS[m.unitName ?? ""]);
    const datum = measure && UNITS[measure.unitName!]!;
    // Only a series named as `measureOf` names it, so a listed station reads the series it lists.
    return measure &&
      measure["@id"].endsWith(`/${measureOf({ source_id: s.notation, datum: datum! })}`)
      ? [{ s, measure, datum: datum! }]
      : [];
  });
  // A gauge's twins share its label, or a position within about 2 km.
  const aod = tidal.filter((g) => g.datum === "AOD").map((g) => g.s);
  const near = (a: ApiStation, b: ApiStation) =>
    labelOf(a) === labelOf(b) ||
    [a.lat, a.long].every((v, i) => Math.abs(firstOf(v) - firstOf([b.lat, b.long][i])) < 0.02);
  const listed: ListedStation[] = [];
  for (const { s, measure, datum } of tidal) {
    const [lat, lon] = [s.lat, s.long].map((v) => [v].flat()[0]);
    const name = labelOf(s);
    if (lat === undefined || lon === undefined || (datum === "CD" && aod.some((a) => near(a, s))))
      continue;
    listed.push({
      ...stationDefaults(metadata),
      id: `ea/${s.notation}`,
      source_id: s.notation,
      name,
      lat,
      lon,
      country_code: COUNTRIES[name] ?? "GB",
      kind: "coastal",
      interval_s: measure.period ?? 900,
      datum,
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      status: "active",
      live: true,
      min_interval_s: 900,
      // Check for Flooding's page is keyed by the River Levels on the Internet ID.
      source_url: s.RLOIid ? `https://check-for-flooding.service.gov.uk/station/${s.RLOIid}` : null,
    });
  }
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!listed.length) throw new Error("EA listed no tide gauges");
  return listed.sort((a, b) => a.id.localeCompare(b.id));
}

const labelOf = (s: ApiStation) => [s.label].flat()[0]!;
const firstOf = (v: number | number[] | undefined) => Number([v].flat()[0]);

/**
 * Levels in meters above the station's datum over [start, end): from the readings
 * API for the last 28 whole days, from the daily archive files before.
 */
export async function levels(measure: string, start: Date, end: Date): Promise<Observation[]> {
  const split = Math.max(start.getTime(), dayOf(Date.now()) - API_DAYS * DAY_MS);
  const until = Math.min(split, end.getTime());
  const out: Observation[] = [];
  // Backfill replaces each month it gets values for, so a month with a day the
  // archive no longer holds gives none, from the archive or the API, keeping
  // what the store has for it.
  const missing = new Set<string>();
  const monthOf = (t: number) => new Date(t).toISOString().slice(0, 7);
  // A start within the API's days reads no archive file, not even its own day's.
  for (let day = dayOf(start.getTime()); start.getTime() < until && day < until; day += DAY_MS) {
    if (missing.has(monthOf(day))) continue;
    const today = archiveDay(day);
    // The next few days download while this one is read, rather than one at a time.
    for (let ahead = day + DAY_MS; ahead < Math.min(day + 4 * DAY_MS, until); ahead += DAY_MS)
      archiveDay(ahead).catch(() => {});
    const file = await today;
    if (!file) {
      missing.add(monthOf(day));
      continue;
    }
    const pairs = file.get(measure) ?? [];
    for (let i = 0; i < pairs.length; i += 2)
      if (pairs[i]! >= start.getTime() && pairs[i]! < until)
        out.push(reading(pairs[i]!, pairs[i + 1]!));
  }
  if (split < end.getTime()) {
    const { items } = await getJson<{ items: { dateTime: string; value: unknown }[] }>(
      `${API}/id/measures/${measure}/readings?since=${new Date(split).toISOString()}&_sorted&_limit=10000`,
      { fresh: true },
    );
    const times = items
      .filter((r) => typeof r.value === "number")
      .map((r) => Date.parse(r.dateTime));
    for (const r of items.toReversed()) {
      const time = Date.parse(r.dateTime);
      if (typeof r.value === "number" && time >= split && time < end.getTime())
        out.push(reading(time, r.value));
    }
    // An answer that's empty, or starts more than a day late, as when the API
    // isn't serving the measure or keeps fewer days, would leave the split's
    // month without the days between.
    // Only where the archive gave the days before; a range within the API's
    // days, as compaction's, has no other copy to keep.
    if (split > start.getTime() && (!times.length || Math.min(...times) > split + DAY_MS))
      missing.add(monthOf(split));
  }
  return out.filter((o) => !missing.has(monthOf(o.time)));
}

const reading = (time: number, level: number): Observation => ({
  time,
  level,
  flag: Flag.preliminary,
});

function dayOf(t: number): number {
  return Math.floor(t / DAY_MS) * DAY_MS;
}

/**
 * Every tidal level in one day's archive file, by measure. Each file holds
 * every EA measure's readings, about 60 MB, so it's read once a run and its
 * tide gauge levels kept for the other stations; it's never cached on disk.
 */
/** Each measure's readings as alternating times and levels, which keeps a year of them small. */
type Day = Map<string, number[]> | null;
const days = new Map<number, Promise<Day>>();

/** A day file's readings, or null when the archive doesn't hold the day. */
export function archiveDay(day: number): Promise<Day> {
  let parsed = days.get(day);
  if (!parsed) {
    parsed = fetchDay(day);
    days.set(day, parsed);
    // A day that failed to download is asked again by the next station; one
    // that came back in the wrong shape would only fail again, so it's kept.
    parsed.catch((error) => {
      if (!(error instanceof ArchiveShapeError)) days.delete(day);
    });
  }
  return parsed;
}

async function fetchDay(day: number): Promise<Day> {
  const date = new Date(day).toISOString().slice(0, 10);
  let csv: string;
  try {
    csv = await getText(`${API}/archive/readings-${date}.csv`, { fresh: true });
  } catch (error) {
    // The archive keeps about a year; a day outside it answers 404. One well
    // inside it is a gap, reported loudly, but still only drops its month, so
    // a day the EA never publishes doesn't block the rest of the year.
    if (!/returned 404$/.test((error as Error).message)) throw error;
    if (day > Date.now() - ARCHIVE_DAYS * DAY_MS)
      console.error(
        `::error::EA archive has no ${date}, inside the year it keeps; its month is left out`,
      );
    else console.warn(`EA archive has no ${date}; its month is left out`);
    return null;
  }
  // A file in another shape, or without a single tide gauge reading, fails
  // rather than read as a day with nothing, which would drop its month quietly.
  if (!csv.startsWith("dateTime,measure,value"))
    throw new ArchiveShapeError(`EA archive ${date} isn't the CSV it was`);
  const parsed = parseArchive(csv);
  if (!parsed.size) throw new ArchiveShapeError(`EA archive ${date} has no tide gauge readings`);
  return parsed;
}

/** A day file that downloaded but can't be read. */
class ArchiveShapeError extends Error {}

/** A day file's tide gauge levels by measure ID, as alternating times and levels. */
export function parseArchive(csv: string): Map<string, number[]> {
  const byMeasure = new Map<string, number[]>();
  for (const line of csv.split("\n")) {
    // The 15-minute mean tidal series in meters, which tide gauges report; the
    // rest would hold a year of files in memory for nothing.
    if (!TIDE_GAUGE.test(line)) continue;
    const [dateTime, url, value] = line.trim().split(",");
    // A value can be blank, or two readings joined by "|".
    const level = Number(value);
    if (!dateTime || !url || !value || !Number.isFinite(level)) continue;
    const measure = url.slice(url.lastIndexOf("/") + 1);
    let rows = byMeasure.get(measure);
    // A substring can keep the whole day file alive, so a new key is copied.
    if (!rows) byMeasure.set(intern(measure), (rows = []));
    rows.push(Date.parse(dateTime), level);
  }
  return byMeasure;
}

const keys = new Map<string, string>();
const codec = { encoder: new TextEncoder(), decoder: new TextDecoder() };

/** A measure ID as a string of its own, shared across days. */
function intern(id: string): string {
  let key = keys.get(id);
  if (!key) keys.set((key = codec.decoder.decode(codec.encoder.encode(id))), key);
  return key;
}

const TIDE_GAUGE = /-tidal_level-Mean-15_min-m(AOD)?,/;

/** For tests: forget the archive days read so far. */
export function forgetArchive(): void {
  days.clear();
}

export const source: Source = {
  metadata,
  stations,
  observations: (s: Station, start, end) => levels(measureOf(s), start, end),
};
