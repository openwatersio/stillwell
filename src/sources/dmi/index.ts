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
 * Danish Meteorological Institute (DMI) tide gauge observations, from its
 * open Oceanographic Observation API (OGC API Features, GeoJSON): DMI's and
 * the Danish Coastal Authority's gauges, which DMI's terms cover.
 * See README.md.
 */
const API = "https://opendataapi.dmi.dk/v2/oceanObs/collections";

export const metadata: SourceMetadata = {
  id: "dmi",
  name: "Danish Meteorological Institute (DMI)",
  url: "https://www.dmi.dk/friedata/dokumentation/oceanographic-observations-data",
  license: {
    id: "CC-BY-4.0",
    name: "Creative Commons Attribution 4.0 International",
    url: "https://www.dmi.dk/friedata/dokumentation/terms-of-use",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "Danish Meteorological Institute (DMI)",
  contact: { email: "friedata_kontakt@dmi.dk" },
  terms:
    "DMI's open data is licensed under CC BY 4.0: give appropriate credit, link to the license (https://creativecommons.org/licenses/by/4.0/) and indicate if changes were made. DMI says its observations are raw measurements that may be faulty, that its databases may change as errors are found, and that it gives no warranty. Changes in the store: levels converted from centimeters to meters, and quality flags added.",
  // Values arrive a minute or two after they're measured.
  hourly: true,
  // Hand checks stopped in 2013, so `auto` values stay as they are; a refetch would find nothing new.
  finalizes: false,
};

/** The Coastal Authority, the one owner besides DMI that DMI's terms cover, and the credit they name. */
const COASTAL_AUTHORITY = "Kystdirektoratet / Coastal Authority";
/** Owners whose gauges DMI's terms cover; municipalities' and ports' aren't listed. */
const COVERED = new Set(["DMI", COASTAL_AUTHORITY]);
const OWNER_CREDITS: Record<string, string> = {
  [COASTAL_AUTHORITY]: "Danish Coastal Authority (Kystdirektoratet)",
};

/**
 * The datum each sea-level parameter is measured from, in centimeters.
 * `sea_reg` is the gauge's own registration: on DVR90 at the Coastal
 * Authority's gauges from May 2002, as DMI's documentation says; at DMI's gauges it's an
 * instrument reading, so they use the others.
 * `LN` is each DMI gauge's local zero.
 */
const DATUMS = { sealev_dvr: "DVR90", sea_reg: "DVR90", sealev_ln: "LN" } as const;
/**
 * The Coastal Authority's gauges running before it moved `sea_reg` to DVR90 on
 * this day, each split into an epoch of its own from it, since before it
 * they're on an older reference 5 to 20 cm above DVR90 by an offset nobody has
 * measured: erratum `dmi-coastal-authority-dnn`. Splits are never removed,
 * even once the erratum is retired.
 */
const DVR90_SINCE = "2002-05-29";
export const SPLIT_STATIONS = [
  9004201, 9004203, 9004303, 9005101, 9005103, 9005110, 9005113, 9005201, 9005203, 9005210, 9005212,
  9005213, 9006401, 9006501, 9006601, 9006701, 9006703, 9006801, 9006901, 9006902, 9007101, 9007102,
  9010101, 9010102, 9010201, 9010202, 9020101, 9020102, 9020201, 9020202, 9020301, 9020302, 9030101,
  9030102, 9030201, 9030202,
].map((n) => `dmi/${n}`);
export type Parameter = keyof typeof DATUMS;

const COUNTRIES: Record<string, string> = { DNK: "DK", GRL: "GL", FRO: "FO" };

/** DMI's largest page; a year of 10-minute values (about 52,600) fits in one. */
const LIMIT = 300_000;
/** DMI lists about 100 sea-level series this reads; a list short of that is caught mid-reload. */
const MIN_STATIONS = 90;
const DAY_MS = 86_400_000;

/**
 * A DMI station as listed. `parameter` is the series its levels come from,
 * `owner` the station's owner as DMI names it, and `record_start` and
 * `record_end` the days its operation starts and ends, which a backfill keeps
 * to. They're kept in the store's list only.
 */
export type DmiStation = ListedStation & {
  parameter: Parameter;
  owner: string;
  record_start: string | null;
  record_end: string | null;
};

interface Feature<P> {
  geometry: { coordinates: [number, number] } | null;
  properties: P;
}

interface Collection<P> {
  features: Feature<P>[];
  links: { rel: string; href: string }[];
}

interface StationProps {
  stationId: string;
  name: string;
  owner: string;
  country: string | null;
  status: string;
  parameterId: string[];
  operationFrom: string | null;
  operationTo: string | null;
  validFrom: string;
  validTo: string | null;
}

interface ObservationProps {
  stationId: string;
  parameterId: string;
  observed: string;
  value: number | null;
  qcStatus?: string;
  qcResult?: number;
}

/**
 * Every station with a sea-level series. DMI lists a station once for each
 * period of its metadata, so each is collapsed to its latest period, with the
 * span of all of them.
 */
export async function stations(previous: Station[] = []): Promise<DmiStation[]> {
  const stored = new Map(previous.map((s) => [s.id, s as Partial<DmiStation>]));
  const items = await features<StationProps>(`${API}/station/items?limit=${LIMIT}`);
  const byId = new Map<string, Feature<StationProps>[]>();
  for (const f of items)
    byId.set(f.properties.stationId, [...(byId.get(f.properties.stationId) ?? []), f]);
  const listed: DmiStation[] = [];
  let newHandovers = 0;
  for (const [id, all] of byId) {
    all.sort((a, b) => Date.parse(a.properties.validFrom) - Date.parse(b.properties.validFrom));
    // Only the periods DMI or the Coastal Authority owned the gauge, so the
    // record ends where it's handed to another owner; one that starts under
    // another owner isn't listed.
    const handover = all.findIndex((f) => !COVERED.has(f.properties.owner));
    if (handover === 0) continue;
    const periods = handover < 0 ? all : all.slice(0, handover);
    const handedOver = handover < 0 ? null : Date.parse(all[handover]!.properties.validFrom);
    const latest = periods.at(-1)!;
    const p = latest.properties;
    // `sea_reg` is DVR90 only where the Coastal Authority owned every period that carries it.
    const regOwners = periods.filter((f) => f.properties.parameterId.includes("sea_reg"));
    // The latest period's parameters, so a move to another one reaches `seriesChanged`;
    // every period's when the latest gives none this reads, so a gap doesn't drop the station.
    const owner = regOwners.every((f) => f.properties.owner === COASTAL_AUTHORITY)
      ? COASTAL_AUTHORITY
      : "DMI";
    const parameter =
      parameterOf(owner, new Set(p.parameterId)) ??
      parameterOf(owner, new Set(periods.flatMap((f) => f.properties.parameterId)));
    if (!parameter || !latest.geometry) continue;
    const [lon, lat] = latest.geometry.coordinates;
    const isEnded = handedOver !== null || p.status !== "Active" || !!p.operationTo || !!p.validTo;
    // `validFrom` is when a period of metadata starts, not the record, so only `operationFrom` dates it.
    const starts = periods
      .map((f) => f.properties.operationFrom)
      .filter((d): d is string => !!d)
      .sort();
    // The record holds every period's values, so it carries every owner's credit.
    const credits = [...new Set(periods.map((f) => OWNER_CREDITS[f.properties.owner]))].filter(
      (c): c is string => !!c,
    );
    // An inactive period with no end date says nothing of when values stop. A
    // handed-over record ends the day before the handover, since `levels` reads
    // a day past `record_end`.
    const ends = [
      (p.operationTo ?? p.validTo)?.slice(0, 10),
      handedOver === null ? undefined : new Date(handedOver - DAY_MS).toISOString().slice(0, 10),
    ].filter((d): d is string => !!d);
    const recordEnd = ends.sort()[0] ?? null;
    // A handover the stored list doesn't end at yet: hourly ingest may have stored
    // the new owner's values since, which have to be deleted by hand. A station
    // the store has never listed has no values to delete but still counts toward
    // the floor; one stored inactive with no end isn't read hourly, so neither.
    const was = stored.get(`dmi/${id}`);
    const unseen = !was || (was.record_end ? was.record_end > recordEnd! : was.status === "active");
    if (handedOver !== null && unseen) {
      newHandovers++;
      if (was)
        console.warn(
          `DMI ${id} was handed to ${all[handover]!.properties.owner || "no owner"} on ${all[handover]!.properties.validFrom}; delete any values stored from then on, from recent/ too`,
        );
    }
    listed.push({
      ...stationDefaults(metadata),
      id: `dmi/${id}`,
      source_id: id,
      name: p.name,
      lat,
      lon,
      country_code: COUNTRIES[p.country ?? ""] ?? null,
      kind: "coastal",
      // Sampling went to 10 minutes in 2001; the old local-zero records and any
      // that ended before then varied.
      interval_s: parameter === "sealev_ln" || (recordEnd && recordEnd < "2002") ? null : 600,
      datum: DATUMS[parameter],
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      attribution: [metadata.attribution, ...credits].join("; "),
      tide_station: null,
      same_as: [],
      status: isEnded ? "inactive" : "active",
      live: !isEnded,
      min_interval_s: 600,
      source_url: null,
      parameter,
      owner: p.owner,
      record_start: starts[0]?.slice(0, 10) ?? null,
      record_end: recordEnd,
    });
  }
  // An empty or partial list would retire the stations it leaves out, and a
  // renamed owner would retire its gauges as handed over, so neither counts.
  if (listed.length - newHandovers < MIN_STATIONS)
    throw new Error(
      `DMI listed only ${listed.length - newHandovers} sea-level stations it still owns; try again later`,
    );
  return listed.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The series a station's levels come from: DVR90 where DMI serves it, the
 * Coastal Authority gauge's own registration, and DMI's local zero for its old
 * records that have neither. Null for any other gauge with only its
 * registration, whose datum DMI doesn't give: DMI's own, where it's an
 * instrument reading, and municipalities' and ports', which DMI's terms don't
 * cover either.
 */
export function parameterOf(owner: string, parameters: Set<string>): Parameter | null {
  if (parameters.has("sealev_dvr")) return "sealev_dvr";
  if (owner === COASTAL_AUTHORITY && parameters.has("sea_reg")) return "sea_reg";
  if (parameters.has("sealev_ln")) return "sealev_ln";
  return null;
}

/**
 * Levels in meters over [start, end), a calendar year per request, from the
 * station's `parameter`, which must be measured from `datum`. Values DMI
 * checked by hand are good, those only its automatic checks passed are
 * preliminary, and those either check flagged are suspect, or bad when DMI
 * marks them erroneous.
 */
export async function levels(
  sourceId: string,
  start: Date,
  end: Date,
  {
    datum = "DVR90",
    parameter = "sealev_dvr",
    owner = "DMI",
    record_start,
    record_end,
  }: Partial<
    Pick<DmiStation, "datum" | "parameter" | "owner" | "record_start" | "record_end">
  > = {},
): Promise<Observation[]> {
  if (!/^\d+$/.test(sourceId)) throw new Error(`Not a DMI station: ${sourceId}`);
  // A station the list dropped keeps its old fields in the store, owner included.
  if (!COVERED.has(owner))
    throw new Error(`DMI ${sourceId} is owned by ${owner}, whose data DMI's terms don't cover`);
  // The datum follows from the parameter, so they disagree only in a hand-edited
  // list; a plain error, since a refresh would have nothing to open.
  if (DATUMS[parameter] !== datum)
    throw new Error(
      `DMI ${sourceId}'s ${parameter} is measured from ${DATUMS[parameter]}, not ${datum}`,
    );
  // A day's margin, since the span comes from the station's metadata.
  const from = Math.max(
    start.getTime(),
    record_start ? Date.parse(record_start) - DAY_MS : -Infinity,
  );
  const to = Math.min(end.getTime(), record_end ? Date.parse(record_end) + DAY_MS : Infinity);
  const out: Observation[] = [];
  for (const [a, b] of years(from, to)) {
    // Both ends of DMI's range are inclusive, so it ends a millisecond early.
    const url = `${API}/observation/items?stationId=${sourceId}&parameterId=${parameter}&datetime=${new Date(a).toISOString()}/${new Date(b - 1).toISOString()}&limit=${LIMIT}`;
    for (const { properties: p } of await features<ObservationProps>(url)) {
      if (p.parameterId !== parameter)
        throw new Error(`DMI ${sourceId} answered ${p.parameterId} for ${parameter}`);
      const time = Date.parse(p.observed);
      if (typeof p.value !== "number" || !(time >= a && time < b)) continue;
      out.push({ time, level: Math.round(p.value * 10) / 1000, flag: flagOf(p) });
    }
  }
  // Paging by offset over a range that's still growing can repeat a value.
  return out
    .sort((x, y) => x.time - y.time)
    .filter((o, i, all) => i === 0 || o.time !== all[i - 1]!.time);
}

/** qcResult 6 is "data is erroneous"; 1 to 5 are failed value, step and consistency checks. */
function flagOf({ qcStatus, qcResult }: ObservationProps): Flag {
  if (qcResult === 6) return Flag.bad;
  if (typeof qcResult === "number" && qcResult >= 1 && qcResult <= 5) return Flag.suspect;
  return qcStatus === "manual" ? Flag.good : Flag.preliminary;
}

/**
 * Every feature of a collection, following `next` links. DMI may answer a
 * page with fewer features than asked for and still link a next one, so the
 * last page is the empty one, which has no link. Nothing is cached: DMI sends
 * the newest values first, so a cached first page and a live second one at its
 * old offset would skip or repeat values once DMI corrects a year.
 */
async function features<P>(url: string): Promise<Feature<P>[]> {
  const out: Feature<P>[] = [];
  for (let next: string | undefined = url; next;) {
    const page: Collection<P> = await getJson<Collection<P>>(next, { fresh: true, pace });
    out.push(...page.features);
    next = page.features.length ? page.links.find((l) => l.rel === "next")?.href : undefined;
  }
  return out;
}

/** [from, to) split at UTC calendar years. */
function* years(from: number, to: number): Generator<[number, number]> {
  for (let t = from; t < to;) {
    const next = Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
    yield [t, Math.min(next, to)];
    t = next;
  }
}

/**
 * DMI's fair-use limit is 500 requests per 5 seconds; requests start a quarter
 * of a second apart, well inside it, since a year's page is about 2 MB.
 */
export const pacing = { requestMs: 250 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/**
 * A station whose levels come from another parameter, though its datum's name
 * is the same, such as a Coastal Authority gauge moving from `sea_reg` to
 * `sealev_dvr`, isn't the same series, so the refresh opens or holds an epoch.
 */
export function seriesChanged(committed: Station, listed: ListedStation): string | null {
  const [was, now] = [committed, listed].map((s) => (s as Partial<DmiStation>).parameter);
  return was && now && was !== now ? `levels now come from ${now}, not ${was}` : null;
}

export const source: Source = {
  metadata,
  stations,
  seriesChanged,
  observations: (s, start, end) => levels(s.source_id, start, end, s as DmiStation),
  overrides: {
    // docs/stations.md, "Unreported zero moves": the epoch before converts only once an offset is measured.
    splits: Object.fromEntries(
      SPLIT_STATIONS.map((id) => [
        id,
        [
          {
            since: DVR90_SINCE,
            note: "The Coastal Authority's `sea_reg` moves from an older reference, likely DNN, 5 to 20 cm above DVR90, to DVR90 by 29 May 2002 (erratum `dmi-coastal-authority-dnn`).",
          },
        ],
      ]),
    ),
  },
};
