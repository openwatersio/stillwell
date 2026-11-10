import { Blocked, getJson } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type PublishedExtreme,
  type Source,
  type SourceMetadata,
  type Station,
} from "../../schema.ts";

/**
 * NOAA CO-OPS, the US National Water Level Observation Network and the
 * historical stations before it, through the metadata API (mdapi) and the data
 * API (datagetter).
 *
 * Levels are in station datum (STND), the gauge's own fixed zero, rather than
 * MLLW: MLLW moves against the gauge with each new tidal epoch, and a file must
 * stay in one datum. `datums` gives MLLW, MSL, NAVD88 and the rest from STND. On
 * the Great Lakes STND is IGLD 1985.
 */
const MDAPI = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi";
const DATA = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

export const metadata: SourceMetadata = {
  id: "coops",
  name: "NOAA Center for Operational Oceanographic Products and Services (CO-OPS)",
  url: "https://tidesandcurrents.noaa.gov/",
  license: {
    id: "US-Government-Works",
    name: "U.S. Government work, public domain",
    url: "https://tidesandcurrents.noaa.gov/disclaimers.html",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "NOAA National Ocean Service, CO-OPS",
  contact: {
    email: "Tide.Predictions@noaa.gov",
    url: "https://tidesandcurrents.noaa.gov/contact.html",
  },
  // Preliminary 6-minute values are verified a month or two later.
  hourly: true,
  finalizes: true,
  // `rowsOf` returns nothing only for "No data was found"; any other error body or status throws.
  empty_means_none: true,
  terms: "Preliminary data are unverified and may change once CO-OPS verifies them.",
};

const DATUM = "STND";

interface ApiStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  state: string | null;
  tidal: boolean;
  greatlakes: boolean;
  /** "Great Lakes" on every Great Lakes station, and on Point Aux Frenes, which `greatlakes` misses. */
  tideType?: string;
  details?: { established?: string; removed?: string };
}

interface ApiDatums {
  error?: { message?: string };
  datums: { name: string; value: number }[] | null;
  LAT?: number | null;
  HAT?: number | null;
}

/**
 * Every station with water levels, current or historical. Stations on the
 * current network are live; the rest are listed for their history.
 */
export async function stations(): Promise<ListedStation[]> {
  const all = await metadataOf<{ stations: ApiStation[] }>(
    "stations.json?type=historicwl&expand=details",
    true,
  );
  const current = await metadataOf<{ stations: ApiStation[] }>(
    "stations.json?type=waterlevels",
    true,
  );
  // An empty list is a broken response; taken at its word, it would end every live feed.
  if (!current.stations?.length || !all.stations?.length)
    throw new Error("CO-OPS listed no water-level stations");
  const live = new Set(current.stations.map((s) => s.id));
  const listed = new Map(all.stations.map((s) => [s.id, s]));
  // A few current stations aren't on the historical list yet.
  for (const s of current.stations) if (!listed.has(s.id)) listed.set(s.id, s);
  const stations: ListedStation[] = [];
  const failed: string[] = [];
  let inARow = 0;
  // A slow API that never quite fails mustn't run past the job's timeout.
  const deadline = Date.now() + pacing.refreshBudgetMs;
  for (const s of listed.values()) {
    if (Date.now() > deadline)
      throw new Error(`CO-OPS datums took longer than ${pacing.refreshBudgetMs / 60_000} minutes`);
    let heights: Record<string, number> | null = null;
    try {
      heights = await datums(s.id);
      inARow = 0;
    } catch (error) {
      // No offsets this time; the station keeps the ones it had.
      failed.push(`${s.id}: ${error instanceof Error ? error.message : error}`);
      // A few stations failing is the station's problem; several in a row, or
      // many in all, means the API is, and waiting out each one would take hours.
      if (++inARow >= 5 || failed.length > Math.max(10, listed.size / 10))
        throw new Error(`CO-OPS datums failed for ${failed.length} stations, e.g. ${failed[0]}`);
    }
    stations.push(toStation(s, live.has(s.id), heights));
  }
  for (const f of failed) console.error(`  coops ${f}`);
  return stations.sort((a, b) => a.id.localeCompare(b.id));
}

/** CO-OPS datum names, as they're kept in `datums`. */
const DATUM_NAMES: Record<string, string> = {
  MHHW: "MHHW",
  MHW: "MHW",
  DTL: "DTL",
  MTL: "MTL",
  MSL: "MSL",
  MLW: "MLW",
  MLLW: "MLLW",
  NAVD88: "NAVD88",
  NGVD29: "NGVD29",
  IGLD: "IGLD",
  GL_LWD: "LWD",
};

/** Heights above STND, in meters, for the datums CO-OPS publishes at a station. */
async function datums(id: string): Promise<Record<string, number>> {
  // Fresh, so a new tidal epoch's datums reach the next refresh.
  const d = await metadataOf<ApiDatums>(`stations/${id}/datums.json?units=metric`, true);
  // CO-OPS answers some failures with 200 and an error body; that's a failure, not "no datums".
  if (d.error) throw new Error(`CO-OPS datums ${id}: ${d.error.message ?? "error"}`);
  const heights: Record<string, number> = {};
  for (const { name, value } of d.datums ?? [])
    if (DATUM_NAMES[name] && typeof value === "number") heights[DATUM_NAMES[name]] = value;
  if (typeof d.LAT === "number") heights.LAT = d.LAT;
  if (typeof d.HAT === "number") heights.HAT = d.HAT;
  return heights;
}

/**
 * A CO-OPS station as listed, with the dates it was established and removed, so
 * a backfill can skip years it wasn't there. They're kept in the lake's list
 * only; `stations.parquet` doesn't carry them.
 */
export type CoopsStation = ListedStation & { established: string | null; removed: string | null };

/** `heights` is null when the datums request failed, so the station keeps the offsets it had. */
function toStation(
  s: ApiStation,
  live: boolean,
  heights: Record<string, number> | null,
): CoopsStation {
  // On the Great Lakes, STND is IGLD 1985. A failed or empty answer adds
  // nothing, so the station keeps the offsets it had rather than IGLD alone.
  heights = heights === null || !Object.keys(heights).length ? {} : heights;
  if (s.greatlakes && Object.keys(heights).length) heights = { IGLD: 0, ...heights };
  const datums: Record<string, number> = {};
  for (const [name, height] of Object.entries(heights))
    datums[name] = Math.round(-height * 1000) / 1000 + 0; // + 0 turns -0 into 0
  return {
    ...stationDefaults(metadata),
    id: `coops/${s.id}`,
    source_id: s.id,
    name: s.name,
    lat: s.lat,
    lon: s.lng,
    country_code: countryOf(s.state),
    kind: s.greatlakes || s.tideType === "Great Lakes" ? "lake" : s.tidal ? "coastal" : null,
    // Current stations report every 6 minutes; historical ones may have only hourly heights.
    interval_s: live ? 360 : null,
    datum: DATUM,
    datums,
    // Great Lakes stations have no tide, so no high and low waters.
    products: s.tidal ? ["levels", "extremes"] : ["levels"],
    first: null,
    last: null,
    tide_station: null,
    same_as: [],
    status: "active",
    live,
    min_interval_s: 360,
    source_url: `https://tidesandcurrents.noaa.gov/stationhome.html?id=${s.id}`,
    established: s.details?.established ? isoOf(s.details.established) : null,
    removed: s.details?.removed ? isoOf(s.details.removed) : null,
  };
}

/** US states and the District of Columbia, which CO-OPS gives as `state`. */
const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(
    " ",
  ),
);

/** Codes CO-OPS gives as `state` that are their own country code, and names Intl spells differently. */
const COUNTRIES: Record<string, string> = {
  PR: "PR",
  VI: "VI",
  GU: "GU",
  AS: "AS",
  MP: "MP",
  FM: "FM",
  MH: "MH",
  PW: "PW",
  UM: "UM",
  "United States of America": "US",
};

/** Country names to ISO codes, from Intl, skipping retired codes such as DD for Germany. */
const NAMED = (() => {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const byName = new Map<string, string>();
  for (let a = 65; a <= 90; a++)
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = names.of(code);
      if (!name || name === code) continue;
      // A retired or alias code canonicalizes to another, e.g. und-DD to und-DE.
      if (Intl.getCanonicalLocales(`und-${code}`)[0] !== `und-${code}`) continue;
      byName.set(plain(name), code);
    }
  return byName;
})();

function plain(name: string): string {
  return name.replace(/&/g, "and").toLowerCase();
}

/** ISO country code from CO-OPS's `state`: a US state, a territory, or a country's name. */
export function countryOf(state: string | null): string | null {
  if (!state) return null;
  if (STATES.has(state)) return "US";
  return COUNTRIES[state] ?? NAMED.get(plain(state)) ?? null;
}

interface Row {
  t: string;
  v: string;
  f?: string;
  q?: string;
  ty?: string;
}

/**
 * Observed levels in meters above STND over [start, end), a calendar month per
 * request: 6-minute values, plus hourly heights for any part of the month before
 * the 6-minute record starts (everything before about 1996).
 */
export async function levels(
  id: string,
  start: Date,
  end: Date,
  station: Partial<Pick<CoopsStation, "live" | "established" | "removed">> = {},
): Promise<Observation[]> {
  const window = await operated(id, end, station);
  const out: Observation[] = [];
  for (const [from, to] of chunks(start, end, "month")) {
    if (!overlaps(window, from, to)) continue;
    const sixMinute = await rowsOf("water_level", id, from, to);
    const first = sixMinute.find((r) => r.v !== "" && Number.isFinite(Number(r.v)));
    const firstSixMinute = first ? timeOf(first.t) : to.getTime();
    // Hourly heights fill in only what the 6-minute record doesn't reach.
    // Only before the 6-minute era: later, a month with no 6-minute values is
    // an outage or a gap, and hourly heights would replace the lake's 6-minute
    // values for that month.
    const hourly =
      from.getTime() < SIX_MINUTE_ERA && firstSixMinute > from.getTime()
        ? (await rowsOf("hourly_height", id, from, to)).filter((r) => timeOf(r.t) < firstSixMinute)
        : [];
    for (const r of [...hourly, ...sixMinute]) {
      const level = Number(r.v);
      if (r.v === "" || !Number.isFinite(level)) continue;
      out.push({ time: timeOf(r.t), level, flag: flagOf(r) });
    }
  }
  return within(dedupe(out), start, end);
}

/** CO-OPS's verified high and low waters over [start, end), in meters above STND, up to a calendar year per request. */
export async function extremes(
  id: string,
  start: Date,
  end: Date,
  station: Partial<Pick<CoopsStation, "live" | "established" | "removed">> = {},
): Promise<PublishedExtreme[]> {
  const window = await operated(id, end, station);
  const out: PublishedExtreme[] = [];
  for (const [from, to] of [...chunks(start, end, "year")].flatMap(within365)) {
    if (!overlaps(window, from, to)) continue;
    for (const r of await rowsOf("high_low", id, from, to)) {
      const level = Number(r.v);
      if (r.v === "" || !Number.isFinite(level) || !r.ty) continue;
      out.push({
        time: timeOf(r.t),
        level,
        type: r.ty.trim().startsWith("H") ? "high" : "low",
        flag: flagOf(r),
      });
    }
  }
  return within(dedupe(out), start, end);
}

/**
 * Flags from the row. `q` is `v` once verified and `p` while preliminary;
 * hourly heights and high and low waters are verified products and carry no
 * `q`. `f` is a list of 0/1 flags: for 6-minute values, too many outliers (O),
 * flat (F), rate of change (R) and limit (L); for hourly heights and extremes,
 * inferred (I) and limit (L). O counts rejected samples rather than flagging
 * the value, so it's left out.
 *
 * On a verified 6-minute value (`q` is `v`), L alone isn't suspect: it's left
 * from CO-OPS's acquisition check against limits that are stale at some
 * stations (erratum `coops-stale-limit-flag`). Hourly heights and high and low
 * waters keep L as suspect, since nothing shows their L is stale too.
 */
export function flagOf(row: Pick<Row, "f" | "q">): Flag {
  const f = (row.f ?? "").split(",").map(Number);
  let flag: Flag = row.q === "p" ? Flag.preliminary : Flag.good;
  if (f.length === 4) {
    if (f[1] || f[2] || (row.q !== "v" && f[3])) flag = Flag.suspect;
  } else if (f.length === 2) {
    if (f[1]) flag = Flag.suspect;
    else if (f[0]) flag = Math.max(flag, Flag.interpolated) as Flag;
  }
  return flag;
}

async function rowsOf(product: string, id: string, from: Date, to: Date): Promise<Row[]> {
  const params = new URLSearchParams({
    product,
    station: id,
    datum: DATUM,
    units: "metric",
    time_zone: "gmt",
    format: "json",
    application: "openwaters",
    begin_date: stamp(from),
    // end_date is inclusive and to the minute: the last whole minute before `to`.
    end_date: stamp(new Date(Math.ceil(to.getTime() / MINUTE_MS) * MINUTE_MS - MINUTE_MS)),
  });
  const body = await dataOf<{ data?: Row[]; error?: { message: string } }>(
    `${DATA}?${params}`,
    fresh(to),
  );
  if (body.error) {
    if (/No data was found/i.test(body.error.message)) return [];
    throw new Error(`CO-OPS ${product} ${id}: ${body.error.message.trim()}`);
  }
  // Only "No data was found" means none (`empty_means_none`); a body with
  // neither data nor an error, as a gateway might send, is an outage.
  if (!Array.isArray(body.data)) throw new Error(`CO-OPS ${product} ${id}: no data in the answer`);
  return body.data;
}

// When the station operated, so a backfill doesn't ask for decades it wasn't
// there: from the lake's list when it has the dates, else from the
// station's details. A live station's last month needs neither.
const windows = new Map<string, Promise<[number, number]>>();

function operated(
  id: string,
  end: Date,
  { live, established, removed }: Partial<Pick<CoopsStation, "live" | "established" | "removed">>,
): Promise<[number, number]> {
  if (live && end.getTime() > Date.now() - 31 * DAY_MS)
    return Promise.resolve([-Infinity, Infinity]);
  // A live station is running, whatever an old removed date says.
  const open = ([from, to]: [number, number]): [number, number] => [from, live ? Infinity : to];
  // Only dates the list actually gave count; a missing one is looked up.
  if (typeof established === "string" || typeof removed === "string")
    return Promise.resolve(open(windowOf(established ?? null, removed ?? null, id)));
  let window = windows.get(id);
  if (!window) {
    window = metadataOf<{ established?: string; removed?: string }>(
      `stations/${id}/details.json`,
      true,
    ).then((d) =>
      windowOf(
        d.established ? isoOf(d.established) : null,
        d.removed ? isoOf(d.removed) : null,
        id,
      ),
    );
    // A failed lookup is tried again next time rather than remembered.
    window.catch(() => windows.delete(id));
    windows.set(id, window);
  }
  return window.then(open);
}

/** The [established, removed] window, refusing a date that doesn't parse rather than skipping every year. */
function windowOf(
  established: string | null,
  removed: string | null,
  id: string,
): [number, number] {
  const from = established ? Date.parse(established) : -Infinity;
  const to = removed ? Date.parse(removed) : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to))
    throw new Error(
      `CO-OPS ${id} has unreadable dates: established ${established}, removed ${removed}`,
    );
  // Removed before it was established means it was reinstalled; don't skip anything.
  return from <= to ? [from, to] : [-Infinity, Infinity];
}

function overlaps([from, to]: [number, number], start: Date, end: Date): boolean {
  return from < end.getTime() && to >= start.getTime();
}

/** A CO-OPS GMT time, `YYYY-MM-DD HH:MM[:SS]`, as an epoch; NaN if it isn't one. */
function timeOf(t: string): number {
  return Date.parse(isoOf(t));
}

/** A CO-OPS GMT time as ISO 8601 UTC. */
function isoOf(t: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?/.exec(t.trim());
  return match ? `${match[1]}T${match[2]}${match[3] ?? ":00"}Z` : t;
}

function stamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)} ${iso.slice(11, 16)}`;
}

/** CO-OPS's 6-minute record starts between 1994 and 1996, depending on the station. */
const SIX_MINUTE_ERA = Date.UTC(1997, 0, 1);
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** [start, end) split at UTC calendar months or years. */
function* chunks(start: Date, end: Date, unit: "month" | "year"): Generator<[Date, Date]> {
  for (let t = start.getTime(); t < end.getTime();) {
    const d = new Date(t);
    const next =
      unit === "month"
        ? Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
        : Date.UTC(d.getUTCFullYear() + 1, 0, 1);
    yield [new Date(t), new Date(Math.min(next, end.getTime()))];
    t = next;
  }
}

/** CO-OPS refuses a high/low request over 365 days, so a leap year goes in two halves. */
function within365([from, to]: [Date, Date]): [Date, Date][] {
  if (to.getTime() - from.getTime() <= 365 * DAY_MS) return [[from, to]];
  const mid = new Date(Date.UTC(from.getUTCFullYear(), 6, 1));
  return [
    [from, mid],
    [mid, to],
  ];
}

function dedupe<T extends { time: number }>(rows: T[]): T[] {
  rows.sort((a, b) => a.time - b.time);
  return rows.filter((r, i) => i === 0 || r.time !== rows[i - 1]!.time);
}

function within<T extends { time: number }>(rows: T[], start: Date, end: Date): T[] {
  return rows.filter((r) => r.time >= start.getTime() && r.time < end.getTime());
}

/** Recent values change as CO-OPS verifies them, so they're never cached. */
function fresh(end: Date): boolean {
  return end.getTime() > Date.now() - 120 * DAY_MS;
}

/**
 * Both APIs block a client for a few minutes once it passes a rate limit,
 * answering 403 from their gateway: the data API did after about 16 seconds of
 * a backfill asking for four stations' months at once with no pause. So
 * metadata requests start at least a second apart, data requests `dataMs`
 * apart. A metadata 403 waits `blockedMs`, then twice that. A data 403 holds
 * every data request for `blockedMs`, the next for twice that, and a third
 * hold in a row throws `Blocked`: every data request
 * after it fails at once without going out, for the life of the process, so a
 * run stops instead of sending thousands of requests into the block. (A
 * long-lived Worker would need the block to expire.) Tests shrink the waits.
 */
export const pacing = {
  metadataMs: 1000,
  dataMs: 1000,
  blockedMs: 150_000,
  refreshBudgetMs: 120 * 60_000,
};
let metadataQueue: Promise<unknown> = Promise.resolve();
let lastMetadata = 0;

/**
 * Metadata requests go one at a time. A station refresh skips a station whose
 * request still fails and stops on its own after several in a row, so a 403
 * here fails only its request.
 */
function metadataOf<T>(path: string, fresh = false): Promise<T> {
  const next = metadataQueue.then(async () => {
    for (let attempt = 1; ; attempt++) {
      await sleep(lastMetadata + pacing.metadataMs - Date.now());
      lastMetadata = Date.now();
      try {
        return await getJson<T>(`${MDAPI}/${path}`, { fresh });
      } catch (error) {
        if (attempt >= 3 || !String(error).includes("returned 403")) throw error;
        await sleep(pacing.blockedMs * attempt);
      }
    }
  });
  metadataQueue = next.catch(() => undefined);
  return next as Promise<T>;
}

let blocked: Blocked | undefined;
let nextData = 0;
let dataHeldUntil = 0;
// Holds in a row, and which one is current: a request knows the hold that was
// current when it went out.
let dataHolds = 0;
let holdGeneration = 0;

/**
 * Holds each data request that goes out to its slot, `dataMs` after the last
 * one's. One that wakes inside a hold a 403 started since it took its slot
 * takes a new slot after the hold.
 */
async function paceData(): Promise<void> {
  do {
    if (blocked) throw blocked;
    const now = Date.now();
    const slot = Math.max(now, nextData, dataHeldUntil);
    nextData = slot + pacing.dataMs;
    await sleep(slot - now);
  } while (Date.now() < dataHeldUntil);
  if (blocked) throw blocked;
}

/**
 * Only answers that went over the network count, never cache hits, and only
 * for requests that went out after the current hold began: a 403 for one sent
 * before it is the same block, and a 200 for one is no sign it has lifted. An
 * answer resets the count. Only a request's first try starts a hold; its
 * retries wait out the current one and then fail that request alone. So a URL
 * CO-OPS refuses on its own costs one hold, and a block stops the run once
 * three requests in turn, each after the last one's hold, are refused.
 */
async function dataOf<T>(url: string, fresh: boolean): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    if (blocked) throw blocked;
    let sent: number | undefined;
    const pace = async () => {
      await paceData();
      sent = holdGeneration;
    };
    try {
      const body = await getJson<T>(url, { fresh, pace });
      if (sent === holdGeneration) dataHolds = 0;
      return body;
    } catch (error) {
      if (error instanceof Blocked || !String(error).includes("returned 403")) throw error;
      // Only a first try starts a hold, so a URL refused on its own costs one
      // hold, and a block is known by different requests refused in turn.
      if (attempt === 1 && sent === holdGeneration) {
        if (dataHolds + 1 >= 3) throw block(error);
        dataHolds++;
        holdGeneration++;
        dataHeldUntil = Date.now() + pacing.blockedMs * dataHolds;
      } else if (attempt >= 3) throw error;
      await sleep(dataHeldUntil - Date.now());
    }
  }
}

function block(error: unknown): Blocked {
  blocked ??= new Blocked(
    `CO-OPS's data API is still refusing requests after ${(3 * pacing.blockedMs) / 60_000} minutes of waiting (${error instanceof Error ? error.message : error}); stopping`,
  );
  return blocked;
}

/** For tests: forget a block and the pacing state. */
export function resetPacing(): void {
  blocked = undefined;
  nextData = 0;
  dataHeldUntil = 0;
  dataHolds = 0;
  holdGeneration = 0;
  lastMetadata = 0;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/** Every request is in STND, so a station committed in any other datum is refused. */
function checked(station: Station): string {
  if (station.datum !== DATUM)
    throw new Error(`${station.id} is in ${station.datum}; CO-OPS levels come in ${DATUM}`);
  return station.source_id;
}

export const source: Source = {
  metadata,
  stations,
  observations: (s: Station, start, end) => levels(checked(s), start, end, s as CoopsStation),
  extremes: (s: Station, start, end) => extremes(checked(s), start, end, s as CoopsStation),
};
