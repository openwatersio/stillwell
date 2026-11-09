import { DatumChanged } from "../../epochs.ts";
import { getJson, getText, HttpError } from "../../http.ts";
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
 * SMHI's hourly sea level in RH2000 (parameter 6, "Havsvattenstånd"), from its
 * Open Data Oceanographic Observations API. Each station's whole record comes
 * as one CSV, `corrected-archive`, to midnight UTC today; `latest-day` has the
 * hours since the previous midnight. See README.md.
 */
const API = "https://opendata-download-ocobs.smhi.se/api/version/latest/parameter/6";
const DATUM = "RH2000";

export const metadata: SourceMetadata = {
  id: "smhi",
  name: "Swedish Meteorological and Hydrological Institute (SMHI)",
  url: "https://www.smhi.se/data/oceanografi/havsvattenstand",
  license: {
    id: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0",
    url: "https://www.smhi.se/data/om-smhis-data/villkor-for-anvandning",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "SMHI",
  contact: { email: "dataleveranser@smhi.se" },
  terms:
    "SMHI's open data is licensed under CC BY 4.0 (Sweden), commercial use included. Name SMHI as the source and say whether you changed the data. SMHI asks users not to download the same data repeatedly and to use its latest update. Changes in the lake: levels converted from centimeters to meters, and quality flags added; values from the current and previous calendar months are marked preliminary.",
  archive: "current",
  // `latest-day` has values within about an hour of their time.
  hourly: true,
  // SMHI corrects each month's values, so the refetch reads them again.
  finalizes: true,
  // Until 2004 most of SMHI's gauges report whole centimeters, which on calm
  // Baltic days hold one value for up to a day and a half.
  qc: { centimeter_flatline_s: 48 * 3600 },
};

/** How long `stations` spends reading stations' notes before keeping the rest as they were. */
const NOTES_BUDGET_MS = 15 * 60_000;

/** Göta älv gauges upriver of the harbor mouth. */
const ESTUARY = new Set([33092, 33093, 33094, 33095, 33097]);

const HOUR_MS = 3_600_000;
/** How far a closed station's final archive may end before its listed end. */
const FINAL_SLACK_MS = 6 * HOUR_MS;
const DAY_MS = 86_400_000;

/** An SMHI station as listed, with the first and last hours SMHI has, which a backfill keeps to. */
export type SmhiStation = ListedStation & {
  record_start: string | null;
  record_end: string | null;
};

interface Listing {
  station: {
    id: number;
    name: string;
    owner: string;
    latitude: number;
    longitude: number;
    active: boolean;
    from: number;
    to: number;
  }[];
}

/**
 * Every station SMHI lists for hourly sea level in RH2000, active or closed,
 * with where SMHI says its checks start (`qcStartOf`), read from an active
 * station's `latest-day` and, once, from a closed station's archive, which
 * doesn't change. Where a read fails, its notes are cut short, or the reads
 * have run past `NOTES_BUDGET_MS`, the station keeps what `previous` had, so
 * a slow SMHI holds up the list by at most one read's retries past the budget. A date
 * the notes stop giving goes with a warning: SMHI may have checked those
 * values since, or reworded the note, which `qcStartOf` then needs to learn.
 */
export async function stations(previous: Station[] = []): Promise<SmhiStation[]> {
  const { station } = await getJson<Listing>(`${API}.json`, { fresh: true, pace });
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!station?.length) throw new Error("SMHI listed no sea-level stations");
  const before = new Map(previous.map((s) => [s.id, s]));
  const listed = station
    .map((s): SmhiStation => {
      const id = String(s.id);
      return {
        ...stationDefaults(metadata),
        id: `smhi/${id}`,
        source_id: id,
        name: s.name,
        lat: s.latitude,
        lon: s.longitude,
        country_code: "SE",
        kind: ESTUARY.has(s.id) ? "estuary" : "coastal",
        interval_s: 3600,
        datum: DATUM,
        datums: {},
        products: ["levels"],
        first: null,
        last: null,
        tide_station: null,
        same_as: [],
        status: s.active ? "active" : "inactive",
        live: s.active,
        // SMHI publishes no limit; a station has a new value once an hour.
        min_interval_s: 3600,
        source_url: `${API}/station/${id}.json`,
        record_start: Number.isFinite(s.from) ? new Date(s.from).toISOString() : null,
        // A station still reporting grows on every refresh, so it gets no end.
        record_end: s.active || !Number.isFinite(s.to) ? null : new Date(s.to).toISOString(),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const deadline = Date.now() + NOTES_BUDGET_MS;
  for (const s of listed) {
    const old = before.get(s.id);
    // A list written before the field was kept lacks it; null means looked for and not found.
    const known = old && "source_qc_start" in old;
    if (known) s.source_qc_start = old.source_qc_start ?? null;
    if ((known && s.status === "inactive") || Date.now() > deadline) continue;
    const active = s.status === "active";
    try {
      const text = await getText(
        `${API}/station/${s.source_id}/period/${active ? "latest-day" : "corrected-archive"}/data.csv`,
        // A latest-day is a couple of kilobytes; a closed station's archive can be decades of hours.
        { fresh: true, pace, timeout: active ? 30 : 120 },
      );
      const found = qcStartOf(text);
      if (found === null && s.source_qc_start)
        console.warn(
          `SMHI ${s.source_id}'s notes no longer give the QC start ${s.source_qc_start}`,
        );
      if (found !== undefined) s.source_qc_start = found;
    } catch (error) {
      // A refusal fails every request after it, so the run stops.
      if (error instanceof HttpError && / returned (403|429)\b/.test(error.message)) throw error;
      console.warn(`Keeping SMHI ${s.source_id}'s QC start: ${error}`);
    }
  }
  return listed;
}

/**
 * Where SMHI says its checks of a station start, from a CSV's notes: at some
 * stations, "Data före 2019-07-01 är ej kvalitetskontrollerad", data before 1
 * July 2019 hasn't been quality-controlled, and automatic checks run from
 * then on. Taken as midnight UTC, the clock of SMHI's times. Null when the
 * notes reach `Orsaker till saknade data`, which follows it, without one;
 * undefined when they stop sooner, as in a `latest-day` of a few hours.
 */
export function qcStartOf(text: string): string | null | undefined {
  const date = /Data före (\d{4}-\d\d-\d\d) är ej kvalitetskontrollerad/.exec(text)?.[1];
  // stations.parquet's column is a timestamp, so a date that isn't one would fail every publish.
  if (date) return Number.isNaN(Date.parse(date)) ? undefined : `${date}T00:00:00Z`;
  return text.includes("Orsaker till saknade data") ? null : undefined;
}

/**
 * Hourly levels in meters over [start, end), from the station's archive (read
 * once per process) and, for the hours after it, `latest-day`. A range from
 * the previous UTC midnight on, where `latest-day` starts, needs only `latest-day`.
 */
export async function levels(
  sourceId: string,
  start: Date,
  end: Date,
  {
    datum,
    record_start,
    record_end,
  }: Partial<Pick<SmhiStation, "datum" | "record_start" | "record_end">> = {},
): Promise<Observation[]> {
  datum ??= DATUM;
  if (!/^\d+$/.test(sourceId)) throw new Error(`Not an SMHI station: ${sourceId}`);
  // Years outside the record send no request.
  const from = Math.max(
    start.getTime(),
    record_start ? Date.parse(record_start) - DAY_MS : -Infinity,
  );
  const to = Math.min(end.getTime(), record_end ? Date.parse(record_end) + DAY_MS : Infinity);
  if (from >= to) return [];
  const now = Date.now();
  // `latest-day` starts at the previous UTC midnight.
  const latestFrom = Math.floor(now / DAY_MS) * DAY_MS - DAY_MS;
  let out: Observation[] = [];
  let last = -Infinity;
  if (from < latestFrom) {
    const archive = await archiveOf(sourceId, datum);
    // Only a range that reaches past the archive's end can lose hours to a cut;
    // checking every range would fail a station's whole record during an outage.
    if (to > archive.last) complete(archive, sourceId, record_end);
    out = archive.values.slice(lowerBound(archive.values, from), lowerBound(archive.values, to));
    last = archive.last;
  }
  // The archive runs to at least where `latest-day` starts (see `archiveOf`).
  if (to > last && to > latestFrom) {
    const latest = parse(
      await getText(`${API}/station/${sourceId}/period/latest-day/data.csv`, { fresh: true, pace }),
      sourceId,
      datum,
    );
    out.push(...latest.values.filter((o) => o.time > last && o.time >= from && o.time < to));
  }
  // SMHI corrects its data monthly, so a value from this month or the last can still change.
  const settled = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 1, 1);
  return out.map((o) =>
    o.time >= settled ? { ...o, flag: Math.max(o.flag, Flag.preliminary) as Flag } : o,
  );
}

interface Parsed {
  values: Observation[];
  /** The last value's time. */
  last: number;
  /** The station's last hour, from the `t.o.m.` note. */
  through: number | null;
}

/**
 * Archives by station, most recent last. A backfill asks for a station a year
 * at a time from several workers at once, so a few are kept; each is fetched
 * fresh, since SMHI adds a day to it every night.
 */
const archives = new Map<string, Promise<Parsed>>();
const ARCHIVES_KEPT = 8;

function archiveOf(sourceId: string, datum: string): Promise<Parsed> {
  const key = `${sourceId} ${datum}`;
  let archive = archives.get(key);
  if (archive) archives.delete(key);
  else
    archive = getText(`${API}/station/${sourceId}/period/corrected-archive/data.csv`, {
      fresh: true,
      pace,
    }).then((text) => parse(text, sourceId, datum));
  archives.set(key, archive);
  // A failed fetch isn't kept, so the next year asks again.
  archive.catch(() => archives.get(key) === archive && archives.delete(key));
  while (archives.size > ARCHIVES_KEPT) archives.delete(archives.keys().next().value!);
  return archive;
}

/**
 * An archive read to its end runs to the previous UTC midnight, where
 * `latest-day` takes over, or for a closed station to the end the station list
 * gives; SMHI builds an active station's archive to today's midnight. One that
 * ends sooner was cut short, or is a stale copy, and backfill would take its
 * missing hours as gone and delete them from the lake. A stale copy's
 * `t.o.m.` note ends with its own rows, so the note can't show one is current.
 *
 * A closed station's last hours can have no rows at all: Landsort (2073)
 * ends at 09:00 though its note and the station list both give 12:00. An
 * archive whose note reaches the listed end, which a stale copy's can't, gets
 * `FINAL_SLACK_MS` for that. The note sits in the header, so a download cut
 * later still carries it; the slack is kept to a few hours for that reason.
 */
function complete(archive: Parsed, sourceId: string, recordEnd?: string | null): void {
  const midnight = Math.floor(Date.now() / DAY_MS) * DAY_MS - DAY_MS;
  const end = recordEnd ? Date.parse(recordEnd) : null;
  const final =
    end !== null && end <= midnight && archive.through !== null && archive.through >= end;
  const due = end !== null ? Math.min(end, midnight) : midnight;
  if (archive.last < due - (final ? FINAL_SLACK_MS : HOUR_MS))
    throw new Error(
      `SMHI ${sourceId}'s archive ends at ${new Date(archive.last).toISOString()}, before ${new Date(due).toISOString()}`,
    );
}

/** Forget every archive read, for tests. */
export function forgetArchives(): void {
  archives.clear();
}

/**
 * SMHI's CSV: a few header lines, then `time;cm;quality;depth`, with notes in
 * a sixth column beside the first rows, among them `Höjdsystem: RH2000` and
 * `Tidsperiod (t.o.m.) = <last hour> (UTC)`.
 */
export function parse(text: string, sourceId: string, datum: string): Parsed {
  const system = /Höjdsystem: *([^;\r\n]+)/.exec(text)?.[1]?.trim();
  if (system && system !== datum)
    // A plain error: the list doesn't name the system, so a refresh can't open
    // an epoch, and `DatumChanged` would dispatch one every day for nothing.
    throw new Error(`SMHI ${sourceId} is measured from ${system}, not ${datum}`);
  const values: Observation[] = [];
  for (const line of text.split("\n")) {
    const m = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d);(-?[\d.]+);([A-Z]);/.exec(line);
    if (!m) continue;
    values.push({
      time: Date.parse(`${m[1]!.replace(" ", "T")}Z`),
      level: Math.round(Number(m[2]) * 10) / 1000,
      flag: flagOf(m[3]!),
    });
  }
  // The notes sit beside the first rows, so a `latest-day` of a few hours can lack them.
  if (!system && values.length >= NOTE_ROWS)
    throw new Error(`SMHI ${sourceId} names no height system`);
  const through = /t\.o\.m\.\) = (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/.exec(text)?.[1];
  return {
    values,
    last: values.at(-1)?.time ?? -Infinity,
    through: through ? Date.parse(`${through.replace(" ", "T")}Z`) : null,
  };
}

/** Rows the notes column spans; `Höjdsystem` is the fourth note. */
const NOTE_ROWS = 12;

/**
 * G is checked and approved. O is unchecked, and Y roughly checked, including
 * the last two hours, so both are preliminary, for QC to judge. SMHI documents
 * no others.
 */
function flagOf(quality: string): Flag {
  return quality === "G"
    ? Flag.good
    : quality === "O" || quality === "Y"
      ? Flag.preliminary
      : Flag.suspect;
}

/** The first index whose time is at or after `time`. */
function lowerBound(values: Observation[], time: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (values[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * SMHI publishes no limit but asks users not to load its services needlessly,
 * so requests start a second apart.
 */
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
  observations: (s, start, end) => levels(s.source_id, start, end, s as SmhiStation),
};
