import { DatumChanged } from "../../epochs.ts";
import { Blocked, getJson, getText } from "../../http.ts";
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

/**
 * PEGELONLINE, the WSV's gauge service: raw water levels in centimeters above
 * gauge zero (PNP), at 1-minute resolution at tide gauges. The REST API keeps
 * 31 days; the station pages' raw-data download reaches back to 2000 at most
 * federal gauges.
 */
const API = "https://www.pegelonline.wsv.de/webservices/rest-api/v2";
const SITE = "https://pegelonline.wsv.de";
const DAY_MS = 86_400_000;
// A day short of the REST API's 31, so a range near its edge isn't cut short.
const REST_DAYS = 30;

export const metadata: SourceMetadata = {
  id: "pegelonline",
  name: "PEGELONLINE (Wasserstraßen- und Schifffahrtsverwaltung des Bundes)",
  url: "https://www.pegelonline.wsv.de/",
  license: {
    id: "DL-DE-ZERO-2.0",
    name: "Datenlizenz Deutschland – Zero – Version 2.0",
    url: "https://www.pegelonline.wsv.de/gast/nutzungsbedingungen",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "Wasserstraßen- und Schifffahrtsverwaltung des Bundes (WSV), PEGELONLINE",
  // Raw values only: neither the feed nor the download ever finalizes them.
  hourly: true,
  finalizes: false,
  // Central European time, standard or summer.
  utc_offsets: [1, 2],
  terms: "Raw, unchecked values.",
  // The download shows no step at any gauge zero's validFrom it covers (README).
  archive: "current",
};

/**
 * A station with the first day of its raw-data download, or null where the
 * download reaches no further back than the REST API or isn't offered.
 */
export type PegelonlineStation = ListedStation & { history_since?: string | null };

export interface ApiStation {
  uuid: string;
  number: string;
  shortname: string;
  longname: string;
  latitude?: number;
  longitude?: number;
  water: { shortname: string };
  timeseries?: {
    shortname: string;
    unit: string;
    equidistance?: number;
    gaugeZero?: { unit: string; value: number; validFrom: string };
  }[];
}

/** Every station with a water-level (`W`) series, as the API lists it. */
export async function list(): Promise<ApiStation[]> {
  const stations = await getJson<ApiStation[]>(
    `${API}/stations.json?includeTimeseries=true&timeseries=W`,
    { fresh: true },
  );
  // Without a position there's nothing to place.
  return stations.filter((s) => s.latitude !== undefined && s.longitude !== undefined);
}

/**
 * Each station with its `history_since`. A station in `previous` with a date
 * keeps it; the rest ask the download dialog, one at a time.
 */
export async function stations(previous: Station[] = []): Promise<PegelonlineStation[]> {
  const known = new Map(
    previous.map((s) => [s.id, (s as Partial<PegelonlineStation>).history_since]),
  );
  const listed: PegelonlineStation[] = [];
  let failures = 0;
  for (const s of await list()) {
    const station: PegelonlineStation = toStation(s);
    let since = known.get(station.id);
    // A date is kept; a null is asked again, since a new gauge's record grows and
    // WSV can add history. A failed request leaves it as it was, to try again at
    // the next refresh, and five stop the asking, so a site that's down can't
    // stall the refresh.
    if (!since && failures < 5) {
      try {
        since = await historySince(s.uuid);
      } catch (error) {
        failures++;
        console.warn(`PEGELONLINE ${s.number}: no history_since: ${(error as Error).message}`);
      }
    }
    if (since !== undefined) station.history_since = since;
    listed.push(station);
  }
  return listed.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The first day the raw-data download offers for a station's water levels, as
 * YYYY-MM-DD, from the dialog behind its "Download Wasserstände (Rohdaten)"
 * button. Null when it offers only about the REST API's 31 days, or nothing.
 */
export async function historySince(uuid: string): Promise<string | null> {
  let html: string;
  try {
    html = await getText(`${SITE}/gast/download/modal?uuid=${uuid}&parameter=W`, {
      fresh: true,
      // A small page; a site that hangs shouldn't hold a refresh for minutes a station.
      timeout: 30,
    });
  } catch (error) {
    // A gauge without a download answers 400.
    if (/returned 400$/.test((error as Error).message)) return null;
    throw error;
  }
  const [min, max] = ["min", "max"].map(
    (a) => new RegExp(`${a}="(\\d{4}-\\d{2}-\\d{2})"`).exec(html)?.[1],
  );
  if (!min || !max) throw new Error("download dialog has no date range");
  // Hamburg Port Authority's gauges, among others, offer a rolling 31 days; the
  // margin over that only absorbs a slightly longer window, so a new gauge's
  // record counts once it's longer.
  return Date.parse(max) - Date.parse(min) <= 40 * DAY_MS ? null : min;
}

/**
 * Water levels in meters over [start, end) from the REST API, within the last
 * 31 days, in the series' own datum (see `UNITS`). `station` is a PEGELONLINE number or UUID.
 * With `datum`, throws if the series is now in another.
 */
export async function levels(
  station: string,
  start: Date,
  end: Date,
  datum?: string,
): Promise<Observation[]> {
  const unit = parseUnit(await unitOf(station), station);
  if (datum && unit.datum !== datum)
    throw new DatumChanged(
      `PEGELONLINE ${station} is now in ${unit.datum}, not ${datum}`,
      unit.datum,
      // Only a PNP series has a reference, its gauge zero's date, which the unit doesn't give.
      unit.datum === "PNP" ? undefined : null,
    );
  const { scale } = unit;
  const params = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  const values = await getJson<{ timestamp: string; value: number }[]>(
    `${API}/stations/${encodeURIComponent(station)}/W/measurements.json?${params}`,
    { fresh: true },
  );
  return values
    .map((v) => ({ time: Date.parse(v.timestamp), level: v.value * scale, flag: Flag.preliminary }))
    .filter((v) => v.time >= start.getTime() && v.time < end.getTime());
}

/**
 * Water levels in meters over [start, end) from the raw-data download, in the
 * unit its series information gives. `station` is a PEGELONLINE number. With
 * `datum`, throws if the file is in another. Days the download doesn't cover
 * come back empty.
 */
export async function history(
  station: string,
  start: Date,
  end: Date,
  datum?: string,
): Promise<Observation[]> {
  if (blocked) throw blocked;
  // The form takes whole local days, both included; a local day starts up to
  // two hours before the UTC one.
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  // One download at a time, and each prepared file downloads once, so neither
  // answer can be cached. The station lookup waits its turn with them.
  const files = await oneAtATime(async () => {
    // A lookup can come from the cache, so only its refusals count, not its answers.
    const { uuid } = await ask(station, () =>
      getJson<ApiStation>(`${API}/stations/${encodeURIComponent(station)}.json`),
    );
    const body = new URLSearchParams({
      uuid,
      parameter: "W",
      start: day(start.getTime() - DAY_MS),
      end: day(end.getTime() + 2 * 3_600_000),
      // JSON's timestamps carry their offset; CSV's local times repeat an hour each autumn.
      format: "json",
    });
    // A download URL works once, so a download that fails without a refusal
    // (a bad zip, say) prepares again, after a rest, rather than retry it.
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) await sleep(pacing.restMs);
      try {
        const { downloadUrl } = await ask(station, () =>
          getJson<{ downloadUrl?: string }>(`${SITE}/gast/download/prepare`, {
            method: "POST",
            body: body.toString(),
            headers: { "content-type": "application/x-www-form-urlencoded" },
            fresh: true,
          }),
        );
        if (!downloadUrl) throw new Error(`PEGELONLINE ${station} download wasn't prepared`);
        const zip = await ask(station, () =>
          getText(`${SITE}${downloadUrl}`, { fresh: true, base64: true }),
        );
        const files = await unzip(zip);
        endRefusals();
        return files;
      } catch (error) {
        // The HTTP layer has already retried a refusal with backoff, or found
        // its Retry-After too long to wait, so asking again now won't help.
        if (blocked || attempt >= 3 || REFUSAL.test(String(error))) throw error;
      }
    }
  });
  const info = files.get("zeitreiheninformation.txt") ?? "";
  const unit = parseUnit(/^timeseries_unit=(.*)$/m.exec(info)?.[1] ?? "", station);
  if (datum && unit.datum !== datum)
    throw new Error(`PEGELONLINE ${station} download is in ${unit.datum}, not ${datum}`);
  const json = [...files].find(([name]) => name.endsWith(".json"));
  if (!json) throw new Error(`PEGELONLINE ${station} download has no JSON file`);
  return (JSON.parse(json[1]) as { timestamp: string; value: number | null }[])
    .filter((v) => typeof v.value === "number")
    .map((v) => ({
      time: Date.parse(v.timestamp),
      level: v.value! * unit.scale,
      flag: Flag.preliminary,
    }))
    .filter((v) => v.time >= start.getTime() && v.time < end.getTime());
}

/**
 * After each download the next waits as long as it took, at least `restMs`
 * and at most `maxRestMs`, or longer when the site's Retry-After asks, up to
 * `maxHoldMs`. Refusals at `refusals` different stations with no download
 * completed between them stop every download after, including those already
 * queued (see `ask`).
 */
export const pacing = { restMs: 5_000, maxRestMs: 60_000, maxHoldMs: 15 * 60_000, refusals: 3 };
// `fetchWithRetry`'s wording for a refusal, an outage, a hang or a dropped connection.
const REFUSAL = /returned (403|429|500|502|503|504|timeout|a network error)\b/;
let queue: Promise<unknown> = Promise.resolve();
let restUntil = 0;
let holdUntil = 0;
let refused = 0;
const refusing = new Set<string>();
let blocked: Blocked | undefined;

function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    if (!blocked) await sleep(restUntil - Date.now());
    if (blocked) throw blocked;
    const began = Date.now();
    try {
      return await task();
    } finally {
      const done = Date.now();
      restUntil = Math.max(
        done + Math.min(Math.max(pacing.restMs, done - began), pacing.maxRestMs),
        holdUntil,
      );
    }
  });
  queue = next.catch(() => {});
  return next;
}

/**
 * Asks the site, keeping count of refusals: a 403, 429, 500, 502, 503 or 504,
 * timeout or dropped connection, once the HTTP layer has retried. Refusals at
 * `pacing.refusals` different stations, with no download completed between
 * them, are a block. One gauge refused year after year is a broken series, not
 * the site turning this client away, so it fails only its own years.
 */
async function ask<T>(station: string, request: () => Promise<T>): Promise<T> {
  if (blocked) throw blocked;
  try {
    return await request();
  } catch (error) {
    const message = String(error);
    if (!REFUSAL.test(message)) throw error;
    refused++;
    refusing.add(station);
    // A Retry-After too long for the HTTP layer to wait holds the next
    // request as long, and one longer than `maxHoldMs` stops the run.
    const asked = Number(/\(retry after (\d+) s\)/.exec(message)?.[1] ?? 0) * 1000;
    if (asked > pacing.maxHoldMs)
      blocked = new Blocked(
        `PEGELONLINE asked to wait ${asked / 1000} s (${(error as Error).message}); stopping`,
      );
    else if (asked) holdUntil = Math.max(holdUntil, Date.now() + asked);
    if (!blocked && refusing.size >= pacing.refusals)
      blocked = new Blocked(
        `PEGELONLINE refused ${refused} requests at ${refusing.size} stations with no download between (${(error as Error).message}); stopping`,
      );
    throw blocked ?? error;
  }
}

function endRefusals(): void {
  refused = 0;
  refusing.clear();
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** For tests: forget a block and the count of refusals. */
export function resetPacing(): void {
  restUntil = 0;
  holdUntil = 0;
  endRefusals();
  blocked = undefined;
}

/**
 * The text files in a zip, by name, from its central directory: PEGELONLINE's
 * local headers leave the sizes to a descriptor after the data.
 */
export async function unzip(base64: string): Promise<Map<string, string>> {
  const zip = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const view = new DataView(zip.buffer);
  let end = zip.length - 22;
  while (end > 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end <= 0) throw new Error("not a zip");
  const files = new Map<string, string>();
  let p = view.getUint32(end + 16, true);
  for (let i = view.getUint16(end + 10, true); i > 0; i--) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const [nameLength, extraLength, commentLength] = [28, 30, 32].map((o) =>
      view.getUint16(p + o, true),
    );
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLength!));
    const local = view.getUint32(p + 42, true);
    const offset = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(offset, offset + size);
    if (method !== 0 && method !== 8) throw new Error(`zip method ${method}`);
    const stream = new Blob([data]).stream();
    const bytes =
      method === 8 ? stream.pipeThrough(new DecompressionStream("deflate-raw")) : stream;
    files.set(name, await new Response(bytes).text());
    p += 46 + nameLength! + extraLength! + commentLength!;
  }
  return files;
}

/** Series units: most are centimeters above gauge zero, some meters above NN. */
const UNITS: Record<string, { datum: string; scale: number }> = {
  cm: { datum: "PNP", scale: 0.01 },
  "m+PNP": { datum: "PNP", scale: 1 },
  "m+NN": { datum: "NN", scale: 1 },
};

function parseUnit(unit: string, station: string): { datum: string; scale: number } {
  const known = UNITS[unit];
  if (!known) throw new Error(`PEGELONLINE ${station} unit is ${unit}`);
  return known;
}

// The measurements endpoint doesn't say its unit, so ask the series once per
// station and process. A unit that moves the series to another datum opens a
// datum epoch for the station at the next station refresh.
const units = new Map<string, Promise<string>>();

function unitOf(station: string): Promise<string> {
  let unit = units.get(station);
  if (!unit) {
    unit = getJson<{ unit: string }>(`${API}/stations/${encodeURIComponent(station)}/W.json`).then(
      (t) => t.unit,
    );
    units.set(station, unit);
  }
  return unit;
}

// The open sea; everything else in PEGELONLINE is a river, canal or lake.
const SEA = new Set(["NORDSEE", "OSTSEE"]);

/** A station missing its W series this time lists no datum, so it keeps the one it had. */
function toStation(s: ApiStation): ListedStation {
  const series = s.timeseries?.find((t) => t.shortname === "W");
  const levelDatum = series ? parseUnit(series.unit, s.number).datum : null;
  const zero = series?.gaugeZero;
  const datums: Record<string, number> = {};
  // Gauge zero is given as a height in another datum, e.g. "m. ü. NHN".
  const datum = zero && /\b(NHN|NN|HN)\b/.exec(zero.unit)?.[1];
  if (levelDatum === "PNP" && datum && zero.unit.startsWith("m")) datums[datum] = zero.value;
  const kind: Kind | null = SEA.has(s.water.shortname) ? "coastal" : null;
  // A gauge zero valid from another day is a moved zero; the day itself is left
  // out, since nobody says when in it the change came. The same date with
  // another height is a re-survey, which only changes `datums`.
  const validFrom = levelDatum === "PNP" ? zero?.validFrom?.slice(0, 10) : undefined;
  const reference = validFrom
    ? {
        id: validFrom,
        since: new Date(Date.parse(validFrom) + 86_400_000).toISOString().slice(0, 10),
      }
    : null;
  return {
    ...stationDefaults(metadata),
    id: `pegelonline/${s.number}`,
    source_id: s.number,
    name: s.longname,
    lat: s.latitude!,
    lon: s.longitude!,
    country_code: "DE",
    kind,
    interval_s: series?.equidistance ? series.equidistance * 60 : null,
    datum: levelDatum,
    datums,
    products: ["levels"],
    first: null,
    last: null,
    tide_station: null,
    same_as: [],
    status: "active",
    live: true,
    min_interval_s: 300,
    source_url: `https://www.pegelonline.wsv.de/gast/stammdaten?pegelnr=${s.number}`,
    reference,
  };
}

export const source: Source = {
  metadata,
  stations,
  observations,
};

/**
 * `recent` stays on the REST API; anything older comes from the download,
 * from the station's `history_since` where it's known.
 */
async function observations(s: Station, start: Date, end: Date): Promise<Observation[]> {
  const rest = Date.now() - REST_DAYS * DAY_MS;
  if (start.getTime() >= rest) return levels(s.source_id, start, end, s.datum);
  const since = (s as Partial<PegelonlineStation>).history_since;
  // Unset until a refresh asks; without it, a backfill would ask for years the gauge doesn't have.
  if (since === undefined)
    throw new Error(`PEGELONLINE ${s.source_id} has no history_since; run ingest stations first`);
  // Not the REST API's last 30 days either: backfill replaces whole months, so
  // a month it only half covers would lose the rows before.
  if (since === null) return [];
  const from = Math.max(start.getTime(), Date.parse(since) - DAY_MS);
  return from < end.getTime() ? history(s.source_id, new Date(from), end, s.datum) : [];
}
