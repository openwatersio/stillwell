import { getJson } from "../../http.ts";
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
 * REFMAR, SHOM's coordination of the French tide gauge networks: SHOM's own
 * RONIM gauges and its partners' (ports, Vigicrues, local authorities), served
 * by data.shom.fr's tide gauge service. See README.md.
 */
const API = "https://services.data.shom.fr/maregraphie";
const DAY_MS = 86_400_000;

export const metadata: SourceMetadata = {
  id: "refmar",
  name: "REFMAR (Shom)",
  url: "https://refmar.shom.fr/",
  license: {
    id: "etalab-2.0",
    name: "Licence Ouverte / Open Licence 2.0 (Etalab)",
    url: "https://www.etalab.gouv.fr/licence-ouverte-open-licence/",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "REFMAR, Shom (doi:10.17183/REFMAR)",
  contact: { email: "refmar@shom.fr", url: "https://refmar.shom.fr/contact" },
  // Raw values arrive within minutes, from the 1-minute series.
  hourly: true,
  // SHOM validates raw values weeks to months later.
  finalizes: true,
  terms:
    "Cite the source as REFMAR with the network's DOI (doi:10.17183/REFMAR#RONIM for Shom's gauges, #PARTENAIRES for its partners') and the date of the last update, and credit each gauge's owner.",
};

/** Data source ids: raw 1-minute, raw 10-minute, validated 10-minute and validated hourly. */
const RAW_1MIN = 1;
const RAW = 2;
const VALIDATED = 3;
const HOURLY = 4;

/**
 * A REFMAR gauge with the first day SHOM gives for its record, kept in the
 * store's list so a backfill doesn't ask for decades before it.
 */
export type RefmarStation = ListedStation & { first_observation: string | null };

interface ListedGauge {
  shom_id: string;
  name: string;
  longitude: number;
  latitude: number;
  state: string;
  reseau: string | null;
}

interface Gauge extends ListedGauge {
  organismes?: { nom: string }[];
  verticalRef?: { nom_ref?: string; zero_hydro?: string; zh_ref?: string };
  date_prem_obs?: string;
  sect_geographique?: string;
}

/** What each gauge's levels are measured from, by `verticalRef.zero_hydro`. */
const DATUMS: Record<string, string> = {
  zero_hydrographique: "ZH",
  zero_instrumental_inconnu: "ZI",
  non_rattaché: "ZI",
};

/**
 * The earliest year asked for at a gauge SHOM gives no first observation for:
 * five years before the first 1 June with values, from a probe of 1 June every
 * five years since 1960 (November 2026). The rest, whose first values the
 * probe found from 2015 on or not at all, are asked for from 2010.
 */
// prettier-ignore
const UNDATED_FROM: Record<string, number> = {
  192: 1970, 6117: 1980, 6118: 1980, 399: 1985, 4201: 1995, 792: 1995, 6272: 2000,
  165: 2005, 440: 2005, 609: 2005, 6119: 2005, 6385: 2005, 6407: 2005, 779: 2005,
};
const UNDATED_DEFAULT = 2010;
/** Raw 1-minute values start in the 2000s; a month before this isn't asked for them. */
const RAW_1MIN_FROM = Date.UTC(2005, 0, 1);

/** Gauge states SHOM publishes: working, irregular, stopped, broken, in maintenance. */
const PUBLISHED = new Set(["OK", "ASYNC", "OLD", "KO", "PB"]);

/** Requests start at least this far apart. */
export const pacing = { requestMs: 500 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/**
 * Every gauge the service lists. Each one's record is asked for its datum,
 * owners and first observation, one at a time. A gauge SHOM hides from its map
 * (`HIDDEN`) isn't published, so it's listed with no products and no datum: a
 * new one isn't added, and one already in the store keeps its record but is
 * never fetched again. A record that fails, or comes back without a vertical
 * reference or owners, leaves a gauge already in `previous` as it was, and a
 * new gauge out until the next refresh.
 */
export async function stations(previous: Station[] = []): Promise<RefmarStation[]> {
  const listed = await getJson<ListedGauge[]>(`${API}/service/tidegauges`, { fresh: true, pace });
  // An empty list is a broken response; taken at its word, it would retire every station.
  if (!listed.length) throw new Error("REFMAR listed no tide gauges");
  const before = new Map(previous.map((s) => [s.id, s as RefmarStation]));
  const gauges: RefmarStation[] = [];
  let asked = 0;
  let partial = 0;
  for (const g of listed) {
    const old = before.get(`refmar/${g.shom_id}`);
    // A state this adapter doesn't know, such as HIDDEN, isn't published.
    // The stored record's kind comes from a `KINDS` decision, since REFMAR never gives one, so it's left for the refresh to set again.
    if (!PUBLISHED.has(g.state)) {
      gauges.push({
        ...(old ?? toStation(g)),
        kind: null,
        datum: null,
        products: [],
        live: false,
      });
      continue;
    }
    asked++;
    let detail: Gauge | undefined;
    try {
      detail = await gauge(g.shom_id);
    } catch (error) {
      console.warn(`REFMAR ${g.shom_id}: ${(error as Error).message}`);
    }
    let station: RefmarStation | undefined;
    try {
      // A record needs a vertical reference and at least one owner to credit.
      if (detail?.verticalRef && detail.organismes?.length)
        station = toStation({ ...g, ...detail });
    } catch (error) {
      console.warn(`REFMAR ${g.shom_id}: ${(error as Error).message}`);
    }
    // An empty vertical reference reads as an unknown zero, which a gauge
    // with a named one keeps rather than open a datum epoch on.
    if (station && old && station.datum === "ZI" && !detail?.verticalRef?.zero_hydro)
      station.datum = null;
    // A record that drops its first observation keeps the one it had.
    if (station && old && !station.first_observation)
      station.first_observation = old.first_observation ?? null;
    if (station) gauges.push(station);
    else partial++;
    if (!station && old) gauges.push({ ...old, kind: null, live: g.state !== "OLD" });
    else if (!station)
      console.warn(`REFMAR ${g.shom_id}: no full record; left out until the next refresh`);
  }
  // Most records failing at once is the service, or a changed record shape,
  // not those gauges; a list frozen at the previous records would hide it.
  if (partial > asked / 2)
    throw new Error(`REFMAR gave ${partial} of ${asked} gauges no full record`);
  return gauges.sort((a, b) => a.id.localeCompare(b.id));
}

/** One gauge's full record. */
export function gauge(id: string): Promise<Gauge> {
  return getJson<Gauge>(`${API}/service/completetidegauge/${id}`, { fresh: true, pace });
}

export function toStation(g: Gauge): RefmarStation {
  const ref = g.verticalRef ?? {};
  // No vertical reference at all, or a zero this adapter doesn't know, leaves
  // the datum unsaid, so the station keeps the one it has; a reference that
  // names no zero is an unknown one.
  const datum =
    g.verticalRef === undefined ? null : ref.zero_hydro ? (DATUMS[ref.zero_hydro] ?? null) : "ZI";
  const zh = String(ref.zh_ref ?? "").trim() ? Number(String(ref.zh_ref).replace(",", ".")) : NaN;
  const owners = (g.organismes ?? []).map((o) => o.nom).filter(Boolean);
  const network = g.reseau === "RONIM" ? "#RONIM" : g.reseau === "REFMAR" ? "#PARTENAIRES" : "";
  return {
    ...stationDefaults(metadata),
    id: `refmar/${g.shom_id}`,
    source_id: g.shom_id,
    name: g.name.replace(/_/g, " "),
    lat: g.latitude,
    lon: g.longitude,
    country_code: countryOf(g.sect_geographique, g.latitude, g.longitude),
    kind: null,
    interval_s: 600,
    datum,
    // zh_ref is chart datum's height in the land survey's datum, so adding it
    // to a level above chart datum gives one in the survey's.
    datums: datum === "ZH" && ref.nom_ref && Number.isFinite(zh) ? { [ref.nom_ref]: zh } : {},
    products: ["levels"],
    first: null,
    last: null,
    attribution: `${owners.length ? `© ${owners.join(", ")}; ` : ""}REFMAR, Shom (doi:10.17183/REFMAR${network})`,
    tide_station: null,
    same_as: [],
    // A gauge SHOM marks OLD has stopped, but its record is still served.
    status: "active",
    live: g.state !== "OLD",
    min_interval_s: 600,
    source_url: `https://refmar.shom.fr/donnees/${g.shom_id}`,
    first_observation:
      g.date_prem_obs && Number.isFinite(Date.parse(g.date_prem_obs)) ? g.date_prem_obs : null,
  };
}

/**
 * ISO 3166-1 codes by SHOM's geographic sector. The Antilles–Guyane and
 * Indian Ocean sectors span several territories, told apart by latitude.
 */
export function countryOf(sector: string | undefined, lat: number, lon: number): string | null {
  switch (sector) {
    case "FH":
      return "FR";
    case "PF":
    case "NC":
    case "WF":
      return sector;
    case "SP":
      return "PM";
    case "AN":
      return "AQ";
    case "AG":
      if (lat < 10) return "GF";
      if (lat > 17.8) return lon < -62.95 ? "MF" : "BL";
      return lat > 15.8 ? "GP" : "MQ";
    case "OI":
      if (lat > -14) return "YT";
      if (lat > -22 && lon > 55 && lon < 56) return "RE";
      return "TF";
    default:
      return null;
  }
}

interface Row {
  idsource: number;
  value: number | null;
  timestamp: string;
}

/**
 * Levels in meters above the station's datum over [start, end), a calendar
 * month a request, the most the service answers. Each month takes SHOM's
 * validated values (10-minute, or hourly where that's all it has), then raw
 * 10-minute values after the last validated one, then raw 1-minute values on
 * the ten minutes after the last of those.
 */
export async function levels(
  station: Pick<RefmarStation, "source_id" | "first_observation">,
  start: Date,
  end: Date,
): Promise<Observation[]> {
  const dated = station.first_observation ? Date.parse(station.first_observation) : NaN;
  // A month's margin, in case the first observation is dated late.
  const first = Number.isFinite(dated)
    ? dated - 31 * DAY_MS
    : Date.UTC(UNDATED_FROM[station.source_id] ?? UNDATED_DEFAULT, 0, 1);
  // Nothing is asked for past now, such as the rest of a year under way.
  const stop = Math.min(end.getTime(), Date.now());
  const out: Observation[] = [];
  for (let m = monthStart(Math.max(start.getTime(), first)); m < stop; m = nextMonth(m)) {
    const from = Math.max(m, start.getTime());
    const to = Math.min(nextMonth(m), stop);
    out.push(...(await month(station.source_id, from, to)));
  }
  // Raw values between two validated ones are ones validation rejected, such
  // as a gap that runs to the end of a month. Raw values before the range's
  // first validated one are kept: they can be from before SHOM validated the
  // gauge at all. Raw values after its last, in a range more than a week
  // back, are checked against the month after it, since backfill asks a year
  // at a time.
  let firstGood = out.find((o) => o.flag === Flag.good)?.time;
  // Raw values at the start of a range are checked against the month before
  // it in the same way, unless that's before the gauge's first observation.
  if (firstGood !== undefined && out[0]?.flag === Flag.preliminary && start.getTime() > first) {
    const before = monthStart(start.getTime() - 1);
    if ((await rowsOf(station.source_id, [VALIDATED, HOURLY], before, start.getTime())).length)
      firstGood = -Infinity;
  }
  let lastGood = out.findLast((o) => o.flag === Flag.good)?.time ?? -Infinity;
  if (
    firstGood !== undefined &&
    out.at(-1)?.flag === Flag.preliminary &&
    stop < Date.now() - 7 * DAY_MS
  ) {
    const next = await rowsOf(station.source_id, [VALIDATED, HOURLY], stop, nextMonth(stop));
    if (next.length) lastGood = Infinity;
  }
  return out.filter(
    (o) =>
      o.flag === Flag.good || firstGood === undefined || o.time < firstGood || o.time > lastGood,
  );
}

async function month(id: string, from: number, to: number): Promise<Observation[]> {
  const byTime = new Map<number, Observation>();
  const rows = await rowsOf(id, [RAW, VALIDATED, HOURLY], from, to);
  // The 10-minute value wins where both validated series have one.
  const validated = rows
    .filter((r) => r.idsource !== RAW)
    .sort((a, b) => b.idsource - a.idsource || a.time - b.time);
  for (const r of validated) byTime.set(r.time, { time: r.time, level: r.level, flag: Flag.good });
  const last = validated.reduce((a, r) => (r.time >= a.time ? r : a), {
    time: from - 1,
    idsource: RAW,
  });
  for (const r of rows)
    if (r.idsource === RAW && r.time > last.time)
      byTime.set(r.time, { time: r.time, level: r.level, flag: Flag.preliminary });
  // Nothing is missing after the last value but its own interval: an hour
  // after an hourly validated value, ten minutes after any other.
  const after = Math.max(from - 1, ...byTime.keys());
  const gap = after === last.time && last.idsource === HOURLY ? 3_600_000 : 600_000;
  if (after < to - gap && to > RAW_1MIN_FROM)
    for (const r of await rowsOf(id, [RAW_1MIN], after + 1, to))
      if (r.time > after && r.time % 600_000 === 0)
        byTime.set(r.time, { time: r.time, level: r.level, flag: Flag.preliminary });
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** One request's rows within [from, to). `dtEnd` is inclusive, so it asks to a second before `to`. */
async function rowsOf(
  id: string,
  sources: number[],
  from: number,
  to: number,
): Promise<{ idsource: number; time: number; level: number }[]> {
  const params = new URLSearchParams({
    sources: sources.join(","),
    dtStart: iso(from),
    dtEnd: iso(to - 1000),
  });
  const body = await getJson<{ data: Row[] }>(`${API}/observation/json/${id}?${params}`, {
    pace,
    // Raw values change as they arrive; a month is kept once it's validated to its end.
    keep: (text) => complete(text, to),
  });
  return body.data
    .filter((r) => typeof r.value === "number")
    .map((r) => ({ idsource: r.idsource, time: parseTime(r.timestamp), level: r.value! }))
    .filter((r) => r.time >= from && r.time < to);
}

/** Whether an answer's validated values run to its last hour, so it won't change. */
export function complete(text: string, to: number): boolean {
  const rows = (JSON.parse(text) as { data: Row[] }).data.filter(
    (r) => typeof r.value === "number",
  );
  const isValidated = (r: Row) => r.idsource === VALIDATED || r.idsource === HOURLY;
  const lastValidated = Math.max(...rows.filter(isValidated).map((r) => parseTime(r.timestamp)));
  // Raw values after the validated ones would be served from the cache unrevised.
  return (
    lastValidated >= to - 3_600_000 &&
    !rows.some((r) => !isValidated(r) && parseTime(r.timestamp) > lastValidated)
  );
}

const parseTime = (timestamp: string) =>
  Date.parse(`${timestamp.replace(/\//g, "-").replace(" ", "T")}Z`);

const iso = (t: number) => new Date(t).toISOString().slice(0, 19) + "Z";

function monthStart(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function nextMonth(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export const source: Source = {
  metadata,
  stations,
  observations: async (s: Station, start, end) => {
    // A hidden gauge is listed without levels, so ingest never asks; this guards direct callers.
    if (!s.products.includes("levels")) throw new Error(`REFMAR ${s.source_id} isn't published`);
    return levels(s as RefmarStation, start, end);
  },
  // Gauges whose zero moved with no change of datum marked, found from their
  // values (docs/stations.md, "Unreported zero moves").
  overrides: {
    splits: {
      "refmar/108": [
        {
          since: "1997-02-28",
          note: "Monthly medians step from about 1.1 m to 6.0 m (erratum `refmar-dumont-durville-datums`).",
        },
        {
          since: "1997-12-17",
          note: "Back to about 1.1 m (erratum `refmar-dumont-durville-datums`).",
        },
        {
          since: "2000-03-03",
          note: "Up to about 6.0 m again (erratum `refmar-dumont-durville-datums`).",
        },
        {
          since: "2006-01-09",
          note: "Down to about 5.1 m (erratum `refmar-dumont-durville-datums`).",
        },
        {
          since: "2023-03-10",
          note: "Down to about 1.3 m, today's zero (erratum `refmar-dumont-durville-datums`).",
        },
      ],
      "refmar/495": [
        {
          since: "2020-03-06",
          note: "Values read 1.35 m higher from this day, as the zero moved down, against UHSLC's record of the gauge (erratum `refmar-hiva-oa-uhslc-2020-datum`).",
        },
      ],
      "refmar/6438": [
        {
          since: "2021-09-12",
          note: "1.4 to 2.8 m from today's zero against Saint-Malo, drifting by about 0.8 m (erratum `refmar-cancale-vigicrues-2021-2025-datum`).",
        },
        {
          since: "2025-01-21",
          note: "Today's zero, which reads 0.13 m higher than the one before 2021, against Saint-Malo (erratum `refmar-cancale-vigicrues-2021-2025-datum`).",
        },
      ],
    },
    epochs: {
      "refmar/495 start": {
        to_current: 1.35,
        note: "REFMAR sits 0.24 m above UHSLC's record of the gauge (uhslc/017) every year from 2010 to 2015 and 1.59 m above it from 2020; UHSLC's has no step. REFMAR's yearly medians from 1977 to 2017 stay within 0.68 to 0.91 m, so the years before UHSLC's record are on the same zero.",
      },
      "refmar/6438 start": {
        to_current: 0.13,
        note: "Cancale less Saint-Malo (refmar/410) is 0.95 m before 12 September 2021 and 1.04 to 1.11 m from 21 January 2025. The epoch between drifts by 0.8 m against Saint-Malo, so it has no offset.",
      },
    },
  },
};
