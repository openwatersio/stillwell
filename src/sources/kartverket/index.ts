import { DatumChanged } from "../../epochs.ts";
import { getText } from "../../http.ts";
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
 * Kartverket's (the Norwegian Hydrographic Service's) permanent tide gauges,
 * from its tide API: 10-minute observed levels against chart datum. See
 * README.md.
 */
const API = "https://vannstand.kartverket.no/tideapi.php";

export const metadata: SourceMetadata = {
  id: "kartverket",
  name: "Kartverket (Norwegian Mapping Authority), Hydrographic Service",
  url: "https://vannstand.kartverket.no/tideapi_en.html",
  license: {
    id: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0 International",
    url: "https://kartverket.no/en/api-and-data/tides-and-water-level-data",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "Norwegian Mapping Authority, Hydrographic Service",
  contact: {
    email: "kundesenter@kartverket.no",
    url: "https://kartverket.no/en/about-kartverket/contact-us/contact-form",
  },
  terms:
    "Licensed under CC BY 4.0. The Norwegian Mapping Authority, Hydrographic Service must be credited. Kartverket asks users not to poll the API excessively. Kartverket doesn't mark which values it has quality-controlled, so values from the last year are treated as preliminary. Changes in the lake: levels converted from centimeters to meters, and quality flags added.",
  // The API serves a station's whole record against its current chart datum.
  archive: "current",
  // Values arrive 10 to 20 minutes after they're measured.
  hourly: true,
  // Values count as final once they're a year old, so the refetch reads them again until then.
  finalizes: true,
};

/** The datum Kartverket's gauges are read against; the only one every station has. */
const DATUM = "CD";
/** Other datums `stationlevels` gives, by its code and the label kept in `datums`. */
const OTHER_DATUMS: Record<string, string> = { MSL: "MSL", NN2000: "NN2000" };

const MINUTE_MS = 60_000;
const INTERVAL_MS = 10 * MINUTE_MS;
const DAY_MS = 86_400_000;
/**
 * The API carries no quality flag, and Kartverket revises recent values
 * without saying when; values this old count as final.
 */
const FINAL_MS = 365 * DAY_MS;

/** A Kartverket station as listed, with its first observation the API has, which a backfill keeps to. */
export type KartverketStation = ListedStation & { record_start: string | null };

/**
 * Every permanent tide gauge the API lists, with its first observation and its
 * datum offsets. A gauge whose first observation can't be read keeps the one
 * `previous` has.
 */
export async function stations(previous: Station[] = []): Promise<KartverketStation[]> {
  const known = new Map(previous.map((s) => [s.id, s as Partial<KartverketStation>]));
  const xml = await request({ tide_request: "stationlist", type: "perm" }, true);
  // The API answers with `<location>` elements; its documentation shows `<station>`.
  const list = [...elements(xml, "location"), ...elements(xml, "station")].filter(
    (s) => s.code && s.type?.toUpperCase() === "PERM",
  );
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!list.length) throw new Error("Kartverket listed no stations");
  const out: KartverketStation[] = [];
  for (const s of list) {
    const code = s.code!.toUpperCase();
    // A gauge's own details failing, such as a new one with no observations
    // yet, leaves it without them rather than refusing the whole list.
    const first = await request({ tide_request: "obstime", stationcode: code }, true).then(
      (xml) => elements(xml, "obstime")[0]?.first,
      (error: Error) => void console.warn(`  kartverket ${code}: no obstime: ${error.message}`),
    );
    // Offsets that can't be read are kept from the lake's list, and so is NN2000
    // when a reply leaves it out, so `seriesChanged` keeps its baseline. Other
    // offsets aren't, since a new epoch mustn't start with the old datum's.
    const previousDatums = known.get(`kartverket/${code}`)?.datums;
    const read = await offsets(code).catch(
      (error: Error) => void console.warn(`  kartverket ${code}: no levels: ${error.message}`),
    );
    const datums: Record<string, number> = read
      ? {
          ...read,
          ...(read.NN2000 === undefined && previousDatums?.NN2000 !== undefined
            ? { NN2000: previousDatums.NN2000 }
            : {}),
        }
      : { ...previousDatums };
    const lat = Number(s.latitude);
    out.push({
      ...stationDefaults(metadata),
      id: `kartverket/${code}`,
      source_id: code,
      name: s.name!,
      lat,
      lon: Number(s.longitude),
      // Ny-Ålesund is on Svalbard.
      country_code: lat > 74 ? "SJ" : "NO",
      kind: "coastal",
      interval_s: INTERVAL_MS / 1000,
      datum: DATUM,
      datums,
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      status: "active",
      // Values arrive 10 to 20 minutes after they're measured.
      live: true,
      min_interval_s: INTERVAL_MS / 1000,
      source_url: `https://www.kartverket.no/til-sjos/se-havniva/resultat?latitude=${s.latitude}&longitude=${s.longitude}`,
      record_start:
        first && !Number.isNaN(Date.parse(first))
          ? new Date(first).toISOString()
          : (known.get(`kartverket/${code}`)?.record_start ?? null),
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The other datums' heights relative to chart datum, from `stationlevels`, or
 * null when it doesn't give them against chart datum in centimeters.
 */
async function offsets(code: string): Promise<Record<string, number> | null> {
  const xml = await request(
    { tide_request: "stationlevels", stationcode: code, refcode: "cd", lang: "en" },
    true,
  );
  const head = elements(xml, "locationlevel")[0];
  if (head?.reflevel !== DATUM || head.unit !== "cm") return null;
  const datums: Record<string, number> = {};
  for (const r of elements(xml, "reflevel")) {
    const value = Number(r.value);
    if (r.code && OTHER_DATUMS[r.code] && r.value && Number.isFinite(value))
      datums[OTHER_DATUMS[r.code]!] = -Math.round(value * 10) / 1000;
  }
  return datums;
}

/**
 * Refuses levels once chart datum has moved against NN2000 since the lake's
 * list, which the API would serve the whole record against, until a refresh
 * opens an epoch for it. Asked once a station per process.
 */
const asked = new Map<string, Promise<Record<string, number> | null>>();

/**
 * Throws `DatumChanged` with `seriesChanged`'s reason as the reference, so
 * Ingest hourly starts a refresh, which opens or holds the epoch, and a change
 * rejected in `overrides.epochs` matches its epoch and asks for none. Offsets that can't be
 * read refuse a backfill, which writes the lake's years, but only warn for
 * `strict` false, so an outage of `stationlevels` doesn't stop hourly ingest.
 */
async function checkChartDatum(
  code: string,
  nn2000: number | undefined,
  strict: boolean,
): Promise<void> {
  let offsetsNow = asked.get(code);
  if (!offsetsNow) {
    offsetsNow = offsets(code);
    asked.set(code, offsetsNow);
    // A request that failed is asked again next time.
    offsetsNow.catch(() => asked.delete(code));
  }
  let now: Record<string, number> | null;
  try {
    now = await offsetsNow;
  } catch (error) {
    if (strict) throw error;
    console.warn(`  kartverket ${code}: chart datum not checked: ${(error as Error).message}`);
    return;
  }
  // A reply without NN2000 can't say the datum stayed, so a backfill refuses it too.
  if (now?.NN2000 === undefined) {
    if (strict && nn2000 !== undefined)
      throw new Error(`Kartverket ${code}'s offsets don't give NN2000`);
    if (nn2000 !== undefined)
      console.warn(`  kartverket ${code}: chart datum not checked: no NN2000 in its offsets`);
    return;
  }
  // A list with no baseline gives nothing to compare with, so a backfill waits for a refresh that reads one.
  if (nn2000 === undefined) {
    if (strict)
      throw new Error(`Kartverket ${code} has no NN2000 in the lake's list; run ingest stations`);
    return;
  }
  const reason = moved(nn2000, now.NN2000);
  if (reason)
    throw new DatumChanged(`Kartverket ${code}'s ${reason}; run ingest stations`, DATUM, reason);
}

/** Why chart datum isn't where it was against NN2000, when it moved more than a centimeter. */
function moved(was: number | undefined, now: number | undefined): string | null {
  if (was === undefined || now === undefined) return null;
  // Whole millimeters, as the offsets come, so floating point can't tip the boundary.
  if (Math.round(Math.abs(now - was) * 1000) <= 10) return null;
  return `chart datum is now ${-now} m below NN2000, not ${-was}`;
}

/** For tests: forget the chart datum checks. */
export function forgetChecks(): void {
  asked.clear();
}

/**
 * Observed 10-minute levels in meters above chart datum over [start, end), a
 * UTC calendar year per request, from the station's first observation on.
 */
export async function levels(
  sourceId: string,
  start: Date,
  end: Date,
  {
    datum = DATUM,
    record_start,
    datums,
  }: { datum?: string; record_start?: string | null; datums?: Record<string, number> } = {},
): Promise<Observation[]> {
  if (!/^[A-Z]{3}$/.test(sourceId)) throw new Error(`Not a Kartverket station: ${sourceId}`);
  // Hourly ingest's few hours too, since compaction folds them into the year files.
  const strict = start.getTime() < Date.now() - 2 * DAY_MS;
  if (datums && (strict || datums.NN2000 !== undefined))
    await checkChartDatum(sourceId, datums.NN2000, strict);
  const from = Math.max(
    start.getTime(),
    record_start ? Date.parse(record_start) - DAY_MS : -Infinity,
  );
  const out: Observation[] = [];
  for (const [a, b] of years(from, end.getTime())) {
    // `fromtime` and `totime` are both inclusive, to the minute, in the zone `tzone` names.
    const xml = await request(
      {
        tide_request: "stationdata",
        stationcode: sourceId,
        datatype: "obs",
        refcode: datum.toLowerCase(),
        interval: "10",
        tzone: "0",
        dst: "0",
        lang: "en",
        fromtime: minute(a),
        totime: minute(b),
      },
      false,
      (text) => final(text, b),
    );
    for (const value of parse(xml, sourceId, datum))
      if (value.time >= a && value.time < b) out.push(value);
  }
  return out;
}

/** The observed levels in a `stationdata` response, refusing any datum but `datum`. */
function parse(xml: string, sourceId: string, datum: string): Observation[] {
  const block = /<data\b([^>]*\btype="observation"[^>]*)>([\s\S]*?)<\/data>/.exec(xml);
  if (!block) return [];
  const head = attributes(block[1]!);
  // A plain error: the list always names chart datum, so a refresh can't open
  // an epoch, and `DatumChanged` would dispatch one every day for nothing.
  if (head.reflevelcode !== datum)
    throw new Error(`Kartverket ${sourceId} is measured from ${head.reflevelcode}, not ${datum}`);
  if (head.unit !== "cm") throw new Error(`Kartverket ${sourceId} sent levels in ${head.unit}`);
  const cutoff = Date.now() - FINAL_MS;
  const out: Observation[] = [];
  for (const w of elements(block[2]!, "waterlevel")) {
    const level = Number(w.value);
    const time = Date.parse(w.time!);
    if (w.value === undefined || !Number.isFinite(level) || Number.isNaN(time)) continue;
    out.push({
      time,
      // Centimeters to a tenth, as whole millimeters in meters.
      level: Math.round(level * 10) / 1000,
      // `obs` is the only flag the API documents for observations.
      flag: w.flag !== "obs" ? Flag.suspect : time < cutoff ? Flag.good : Flag.preliminary,
    });
  }
  return out;
}

/**
 * Whether a response for a range ending at `end` can be cached: every value in
 * it is final and it runs to the range's end.
 */
export function final(text: string, end: number, now = Date.now()): boolean {
  const last = elements(text, "waterlevel").at(-1)?.time;
  return end <= now - FINAL_MS && !!last && Date.parse(last) >= end - INTERVAL_MS;
}

/** [from, to) split at UTC calendar years. */
function* years(from: number, to: number): Generator<[number, number]> {
  for (let t = from; t < to;) {
    const next = Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
    yield [t, Math.min(next, to)];
    t = next;
  }
}

/** `yyyy-mm-ddTHH:MM` in UTC. */
function minute(t: number): string {
  return new Date(t).toISOString().slice(0, 16);
}

/** Each `<tag ...>` element's attributes. */
function elements(xml: string, tag: string): Record<string, string | undefined>[] {
  return [...xml.matchAll(new RegExp(`<${tag}\\b([^>]*?)/?>`, "g"))].map((m) => attributes(m[1]!));
}

function attributes(text: string): Record<string, string | undefined> {
  return Object.fromEntries(
    [...text.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1]!, decode(m[2]!)]),
  );
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e]!);
}

/**
 * The API documents capacity for about 20 requests a second, shared by every
 * user, and asks not to be polled hard; requests start a second apart.
 */
export const pacing = { requestMs: 1000 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/** The API answers a bad request with 200 and an `<error>` element, which fails. */
async function request(
  params: Record<string, string>,
  fresh: boolean,
  keep?: (text: string) => boolean,
): Promise<string> {
  const text = await getText(`${API}?${new URLSearchParams(params)}`, {
    fresh,
    pace,
    keep: (t) => !!keep?.(t) && !/<error>/.test(t),
  });
  const error = /<error>([^<]*)<\/error>/.exec(text);
  if (error) throw new Error(`Kartverket: ${decode(error[1]!)}`);
  return text;
}

/**
 * Chart datum is tidal, so Kartverket can redefine it, and the API would then
 * serve the whole record against the new one. Its height in NN2000 moving by
 * more than a centimeter says it was, so the refresh opens or holds an epoch
 * rather than let the lake's years and new values sit on two zeros. Ny-Ålesund
 * has no NN2000, so a change there goes unseen.
 */
export function seriesChanged(committed: Station, listed: ListedStation): string | null {
  return moved(committed.datums.NN2000, listed.datums.NN2000);
}

export const source: Source = {
  metadata,
  stations,
  seriesChanged,
  observations: (s, start, end) =>
    levels(s.source_id, start, end, { ...(s as Partial<KartverketStation>), datum: s.datum }),
};
