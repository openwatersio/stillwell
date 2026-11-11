import { getJson, getText } from "../../http.ts";
import { Flag, type Observation } from "../../schema.ts";
import { zipEntries } from "./index.ts";

/**
 * The Hamburg Port Authority gauges whose history PEGELONLINE doesn't offer,
 * from kuestendaten.de's WISKI download: one zip per series, of 1-minute
 * values in centimeters above gauge zero, stamped in UTC+1 all year.
 */
const BASE =
  "https://www.kuestendaten.de/DE/dynamisch/appl/data/daten_prod/prodNeuProd/direct_download/wiski/";

/** The zip of each gauge's "Wasserstand (PNP)" series, by PEGELONLINE number. */
export const GAUGES: Record<string, string> = {
  "5952020": "BUNTHAUS",
  "5952025": "HAMBURG-HARBURG",
  "5952030": "SCHOEPFSTELLE",
  "5952050": "HAMBURG_ST._PAULI",
  "5952060": "SEEMANNSHOEFT",
  "5952065": "BLANKENESE_UF",
};

/** The first value in every one of the files. */
export const SINCE = "1999-11-01";

export const ATTRIBUTION =
  "Hamburg Port Authority, via Wasserstraßen- und Schifffahrtsverwaltung des Bundes, www.kuestendaten.de";

/** robots.txt asks for a 60-second crawl delay. */
export const pacing = { delayMs: 60_000 };

/** Each gauge's file is `<name><SERIES>.zip`. */
const SERIES = "!Wasserstand (PNP)";

/** The catalog's fields this checks; each entry has many more. */
interface CatalogEntry {
  zipFileName: string;
  Messstellennummer: string;
  Zeitzone: string;
  /** The file's last value, `YYYY-MM-DD HH:MM:SS` in UTC+1. */
  aufnahmeEnde: string;
  /** When the file was last published. */
  aktualisiert: string;
}

/**
 * The `aufnahmeEnde` of the files the store was last backfilled from. Bump it
 * after each backfill, as openwatersio/stillwell#125 lists.
 */
export const BACKFILLED_TO = "2026-06-30 23:59:00";

/**
 * The catalog's entry for each gauge's file, so the weekly canary sees a
 * renamed file or a catalog in another form without downloading the zips.
 * Throws for a gauge whose file it doesn't list under that gauge's number,
 * in UTC+1, with a readable `aufnahmeEnde`.
 */
export async function catalog(): Promise<CatalogEntry[]> {
  const entries = await getJson<CatalogEntry[]>(`${BASE}WISKI_datenDownload.json`, {
    fresh: true,
    pace,
  });
  if (!Array.isArray(entries)) throw new Error("kuestendaten.de's catalog isn't a list");
  const found = Object.entries(GAUGES).map(([station, file]) => ({
    station,
    file,
    entry: entries.find(
      (e) =>
        e?.zipFileName === `${file}${SERIES}.zip` &&
        e.Messstellennummer === station &&
        /\bUTC\+1\)/.test(e?.Zeitzone) &&
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(e.aufnahmeEnde),
    ),
  }));
  const missing = found.filter((f) => !f.entry).map((f) => `${f.file} (${f.station})`);
  if (missing.length)
    throw new Error(
      `kuestendaten.de's catalog has no UTC+1 water levels, with their end, for ${missing.join(", ")}`,
    );
  return found.map((f) => f.entry!);
}

/** Why the canary fails when files run past `BACKFILLED_TO`, or undefined. */
export function update(entries: CatalogEntry[]): string | undefined {
  // Both are `YYYY-MM-DD HH:MM:SS`, which catalog() checks, so they sort as text.
  const newer = entries.filter((e) => e.aufnahmeEnde > BACKFILLED_TO);
  if (!newer.length) return undefined;
  const files = newer.map(
    (e) => `${e.zipFileName} to ${e.aufnahmeEnde}, published ${e.aktualisiert}`,
  );
  // The files are published days apart, and a backfill before the last would miss it.
  const waiting = entries.filter((e) => e.aufnahmeEnde <= BACKFILLED_TO);
  const wait = waiting.length
    ? ` Wait for ${waiting.map((e) => e.zipFileName).join(", ")} too.`
    : "";
  return `kuestendaten.de has HPA values past ${BACKFILLED_TO} (UTC+1): ${files.join("; ")}.${wait} Run the backfill in https://github.com/openwatersio/stillwell/issues/125, then bump BACKFILLED_TO.`;
}

/** A gauge's whole file: minutes since the epoch (UTC) and levels in centimeters. */
interface Series {
  minutes: Int32Array;
  cm: Float32Array;
  length: number;
}

// shortcut: keeps each gauge's series, about 110 MB, for the life of the process; fine for six gauges.
const series = new Map<string, Promise<Series>>();
let gate: Promise<void> = Promise.resolve();
let next = 0;

/**
 * Levels in meters above gauge zero (PNP) over [start, end), from the gauge's
 * file, downloaded once a process. A file that fails, to download or to read,
 * fails every range of the gauge until the next run. With `datum`, throws
 * unless it's PNP.
 */
export async function levels(
  station: string,
  start: Date,
  end: Date,
  datum?: string,
): Promise<Observation[]> {
  const file = GAUGES[station];
  if (!file) throw new Error(`kuestendaten.de has no file for PEGELONLINE ${station}`);
  if (datum && datum !== "PNP")
    throw new Error(`kuestendaten.de ${station} is in PNP, not ${datum}`);
  if (end.getTime() <= Date.parse(SINCE) - 3_600_000) return [];
  let read = series.get(station);
  if (!read) {
    read = getText(`${BASE}${encodeURIComponent(`${file}${SERIES}`)}.zip`, {
      fresh: true,
      base64: true,
      pace,
    }).then((zip) => parse(zip, station));
    series.set(station, read);
  }
  const { minutes, cm, length } = await read;
  const from = Math.ceil(start.getTime() / 60_000);
  const to = Math.ceil(end.getTime() / 60_000);
  const rows: Observation[] = [];
  for (let i = lowerBound(minutes, length, from); i < length && minutes[i]! < to; i++)
    rows.push({ time: minutes[i]! * 60_000, level: cm[i]! / 100, flag: Flag.preliminary });
  return rows;
}

/** Starts each request, retries included, `pacing.delayMs` after the last one started. */
function pace(): Promise<void> {
  gate = gate.then(async () => {
    const wait = next - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    next = Date.now() + pacing.delayMs;
  });
  return gate;
}

function lowerBound(sorted: Int32Array, length: number, value: number): number {
  let [lo, hi] = [0, length];
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Reads a zip's one file, a header of `key : value` lines, a `====` rule, a
 * column line, tab-separated rows of time, level and status, and another rule
 * before the row count. Refuses a file for another gauge, in another unit or
 * time zone, with a status other than 240, whose meaning nobody has said, on
 * any row, or with fewer rows than its footer counts.
 */
export function parse(zip: string, station: string): Promise<Series> {
  return parseEntries(zipEntries(zip), station);
}

export async function parseEntries(
  files: Map<string, () => ReadableStream<Uint8Array>>,
  station: string,
): Promise<Series> {
  const entries = [...files.values()];
  if (entries.length !== 1) throw new Error(`kuestendaten.de ${station}: ${entries.length} files`);
  const header = new Map<string, string>();
  let part = "header" as "header" | "columns" | "rows" | "footer";
  let rows = 0;
  let declared: number | undefined;
  let out: Series | undefined;
  const fail = (why: string) => new Error(`kuestendaten.de ${station}: ${why}`);
  const line = (text: string) => {
    if (part === "footer") {
      const count = /^Anzahl Datens\S+ im Abfragezeitraum\s*:\s*(\d+)\s*$/.exec(text)?.[1];
      if (count) declared = Number(count);
      return;
    }
    if (text.startsWith("====")) {
      if (part === "header") {
        if (header.get("Messstellennummer") !== station)
          throw fail(`file is for ${header.get("Messstellennummer")}`);
        if (header.get("Parameter-Einheit") !== "cm")
          throw fail(`unit is ${header.get("Parameter-Einheit")}`);
        if (!/\bUTC\+1\)/.test(header.get("Zeitzone") ?? ""))
          throw fail(`time zone is ${header.get("Zeitzone")}`);
        const [first, last] = ["Erster Messwert", "Letzter Messwert"].map((k) =>
          minuteOf(header.get(k) ?? ""),
        );
        if (!(last! >= first!)) throw fail("no range in the header");
        const size = last - first + 1;
        out = { minutes: new Int32Array(size), cm: new Float32Array(size), length: 0 };
        part = "columns";
      } else part = "footer";
      return;
    }
    if (part === "header") {
      const colon = text.indexOf(":");
      if (colon > 0) header.set(text.slice(0, colon).trim(), text.slice(colon + 1).trim());
      return;
    }
    if (part === "columns") {
      part = "rows";
      return;
    }
    rows++;
    const [time, value, status] = text.split("\t");
    if (status !== "240") throw fail(`status ${status} at ${time}`);
    // A minute with no value, which the files have a few of.
    if (!value) return;
    const minute = minuteOf(time!);
    const level = Number(value);
    if (Number.isNaN(minute) || !Number.isFinite(level))
      throw fail(`unreadable row ${JSON.stringify(text)}`);
    const s = out!;
    if (s.length && minute <= s.minutes[s.length - 1]!) throw fail(`${time} out of order`);
    if (s.length === s.minutes.length) throw fail(`rows past the header's last value`);
    s.minutes[s.length] = minute;
    s.cm[s.length++] = level;
  };
  let rest = "";
  const decoder = new TextDecoder();
  for await (const bytes of entries[0]!()) {
    const lines = (rest + decoder.decode(bytes, { stream: true })).split("\n");
    rest = lines.pop()!;
    for (const l of lines) line(l.replace(/\r$/, ""));
  }
  line(rest + decoder.decode());
  // The footer's count catches a file cut short between its rules.
  if (part !== "footer" || !out || declared !== rows)
    throw fail(`file ends early: ${rows} rows of ${declared ?? "an unknown number"}`);
  return out;
}

/** Minutes since the epoch (UTC) of a `YYYY-MM-DD HH:MM:SS` time in UTC+1, or NaN. */
function minuteOf(time: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):00$/.exec(time);
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m.map(Number);
  return Date.UTC(y!, mo! - 1, d!, h! - 1, mi!) / 60_000;
}

/** For tests: forget every series read and the delay. */
export function reset(): void {
  series.clear();
  next = 0;
}
