import { DatumChanged } from "../../epochs.ts";
import { getJson, getText } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type Observation,
  type Product,
  type PublishedExtreme,
  type Source,
  type SourceMetadata,
  type ListedStation,
  type Station,
} from "../../schema.ts";

/**
 * Rijkswaterstaat Waterwebservices (DDAPI 2.0). Data is CC0 unless a component
 * says otherwise: https://rijkswaterstaatdata.nl/waterdata/
 *
 * Observed levels (`meting`) and the astronomical tide (`astronomisch`) are 10-minute
 * series in integer centimeters. Extremes come as two channels on the same
 * timestamps: GETETTPE gives the type (`EXTREME_TYPES`), WATHTE the height.
 */
const BASE = "https://ddapi20-waterwebservices.rijkswaterstaat.nl";
const OBSERVATIONS = `${BASE}/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen`;
const CATALOG = `${BASE}/METADATASERVICES/OphalenCatalogus`;

export const metadata: SourceMetadata = {
  id: "rws",
  name: "Rijkswaterstaat",
  url: "https://rijkswaterstaatdata.nl/waterdata/",
  license: {
    id: "CC0-1.0",
    name: "CC0 1.0",
    url: "https://rijkswaterstaatdata.nl/waterdata/",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "Rijkswaterstaat",
  // Unchecked values are checked later.
  hourly: true,
  finalizes: true,
  terms: "No uptime guarantee; fair use, at most 160,000 values per request.",
  // Values from before the 2005 NAP revision come in the old NAP.
  archive: "previous",
};

// The service refuses requests over 160,000 values. A year of 10-minute data is
// 52,560, so yearly chunks stay well inside it.
const CHUNK_MS = 365 * 86_400_000;

/**
 * The 2005 NAP revision gave every gauge's zero post a new height, and RWS
 * serves values from before 2005 against the old one. These are the
 * centimeters to add to a pre-2005 observed value to put it on today's NAP,
 * from the two RLR factors PSMSL records for each gauge (Dillingh et al. 2010):
 * the factor up to 2005 minus the one from 2005 on. Each converted series
 * matches PSMSL's RLR series within a few millimeters in every year from 1990
 * to 2006. Delfzijl's doesn't: RWS has corrected its archive for subsidence
 * since, by 5 to 40 mm. The astronomical tide is left as served: converting it
 * would step its mean level by 4 to 5 cm at 2005, where it steps by 1 to 2 cm
 * as served.
 *
 * Every other Dutch NAP station lists `REVISED_NAP` as its reference, so its
 * values before 2005 go to an epoch of their own, in the old NAP, which
 * converts to today's only by a decision in `overrides`. A gauge whose offset
 * turns up later gets that decision, not an entry here, since its old-NAP
 * epoch's files would then mix two references.
 */
export const NAP_2005: Record<string, number> = {
  vlissingen: -3.0, // PSMSL 20
  "oosterschelde.roompotsluis.buiten": -3.0, // PSMSL 1551
  hoekvanholland: -2.8, // PSMSL 22
  maassluis: -2.4, // PSMSL 9
  "ijmuiden.buitenhaven": -2.1, // PSMSL 32
  "terschelling.west": -2.1, // PSMSL 236
  "denhelder.marsdiep": -1.7, // PSMSL 23
  "harlingen.waddenzee": -0.7, // PSMSL 25
};

/**
 * Where the revised NAP starts. PSMSL's factors change between monthly means,
 * so the hour isn't known; UTC midnight lines the old-NAP epochs up with the
 * year files.
 */
const NAP_REVISED = Date.UTC(2005, 0, 1);

/** The reference Dutch NAP stations without a `NAP_2005` offset list. */
export const REVISED_NAP = { id: "NAP 2005", since: "2005-01-01" };

/** Centimeters to add to a value before 2005 to put it on today's NAP. */
function revision(location: string, datum: string, process: ProcessType): number {
  if (datum !== "NAP" || process !== "meting") return 0;
  return NAP_2005[location] ?? 0;
}

// Rounded to the millimeter, so float noise doesn't reach the files.
const onRevisedNap = (value: number, time: number, cm: number) =>
  Math.round((time < NAP_REVISED ? value + cm : value) * 10) / 1000;

export type ProcessType = "meting" | "astronomisch" | "verwachting";

/** Groupings that carry extremes, keyed by process type. */
const EXTREME_GROUPING: Partial<Record<ProcessType, string>> = {
  meting: "GETETM2",
  astronomisch: "GETETBRKD2",
};

interface Measurement {
  Tijdstip: string;
  Meetwaarde: { Waarde_Numeriek?: number; Waarde_Alfanumeriek?: string };
  WaarnemingMetadata: { Statuswaarde?: string; Kwaliteitswaardecode?: string };
}

interface Series {
  Locatie: { Code: string };
  AquoMetadata: {
    ProcesType?: string;
    Grootheid: { Code: string };
    Hoedanigheid: { Code: string };
    Eenheid?: { Code: string };
    Groepering?: { Code: string };
    Typering?: { Code: string };
  };
  MetingenLijst: Measurement[];
}

interface Response {
  Succesvol: boolean;
  Foutmelding?: string;
  WaarnemingenLijst?: Series[];
}

interface CatalogLocation {
  Locatie_MessageID: number;
  Code: string;
  Naam: string;
  Lat: number;
  Lon: number;
}

interface Catalog {
  AquoMetadataLijst: {
    AquoMetadata_MessageID: number;
    Grootheid: { Code: string };
    Hoedanigheid: { Code: string };
    Groepering?: { Code: string };
  }[];
  AquoMetadataLocatieLijst: {
    AquoMetaData_MessageID: number;
    Locatie_MessageID: number;
  }[];
  LocatieLijst: CatalogLocation[];
}

/**
 * Locations with a water-level series against NAP, or against MSL where that's
 * all a location has (the offshore platforms).
 */
export async function stations(): Promise<ListedStation[]> {
  const catalog = await getJson<Catalog>(CATALOG, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      CatalogusFilter: { Grootheden: true, Hoedanigheden: true, Groeperingen: true },
    }),
  });
  // What each metadata entry gives a location: a height series or a set of extremes.
  const productsOf = new Map<number, Product[]>();
  const datumOf = new Map<number, string>();
  for (const m of catalog.AquoMetadataLijst) {
    const grouping = m.Groepering?.Code;
    if (!grouping && m.Grootheid.Code === "WATHTE" && DATUMS.includes(m.Hoedanigheid.Code)) {
      productsOf.set(m.AquoMetadata_MessageID, ["levels"]);
      datumOf.set(m.AquoMetadata_MessageID, m.Hoedanigheid.Code);
    } else if (grouping === EXTREME_GROUPING.meting)
      productsOf.set(m.AquoMetadata_MessageID, ["extremes"]);
    else if (grouping === EXTREME_GROUPING.astronomisch)
      productsOf.set(m.AquoMetadata_MessageID, ["predictions", "predicted_extremes"]);
  }
  const products = new Map<number, Set<Product>>();
  const datums = new Map<number, Set<string>>();
  for (const link of catalog.AquoMetadataLocatieLijst) {
    const datum = datumOf.get(link.AquoMetaData_MessageID);
    if (datum)
      datums.set(
        link.Locatie_MessageID,
        (datums.get(link.Locatie_MessageID) ?? new Set()).add(datum),
      );
    const found = productsOf.get(link.AquoMetaData_MessageID);
    if (!found) continue;
    const set = products.get(link.Locatie_MessageID) ?? new Set();
    for (const p of found) set.add(p);
    products.set(link.Locatie_MessageID, set);
  }
  return linkTwins(
    catalog.LocatieLijst.filter((l) => products.get(l.Locatie_MessageID)?.has("levels"))
      .map((l): Station => ({
        ...stationDefaults(metadata),
        id: `rws/${l.Code}`,
        source_id: l.Code,
        name: l.Naam,
        lat: l.Lat,
        lon: l.Lon,
        // The Caribbean Netherlands (Bonaire, Sint Eustatius, Saba) has its own code.
        country_code: l.Lon < -30 ? "BQ" : "NL",
        kind: null,
        interval_s: 600,
        datum: DATUMS.find((d) => datums.get(l.Locatie_MessageID)?.has(d))!,
        datums: {},
        products: productsFor(
          products.get(l.Locatie_MessageID)!,
          DATUMS.find((d) => datums.get(l.Locatie_MessageID)?.has(d))!,
        ),
        first: null,
        last: null,
        tide_station: null,
        same_as: [],
        status: "active",
        live: true,
        min_interval_s: 300,
        source_url: `https://waterinfo.rws.nl/publiek/waterhoogte/${encodeURIComponent(l.Code)}/details`,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  ).map((s) => ({ ...s, reference: revisedNap(s) ? REVISED_NAP : null }));
}

/** Whether a station's NAP values before 2005 are in the old NAP, with no known offset. */
function revisedNap(station: Station): boolean {
  return (
    station.datum === "NAP" &&
    station.country_code === "NL" &&
    NAP_2005[station.source_id] === undefined
  );
}

/**
 * Codes RWS lists for the same gauge, a few meters apart. Checked by hand:
 * nearness alone isn't enough, since the two sides of a lock sit meters apart
 * at different levels.
 */
const TWINS = [["ameland.westgat", "amelandwestgat"]];

function linkTwins(stations: Station[]): Station[] {
  const byCode = new Map(stations.map((s) => [s.source_id, s]));
  for (const pair of TWINS)
    for (const code of pair) {
      const station = byCode.get(code);
      if (!station) continue;
      const others = pair.filter((c) => c !== code && byCode.has(c)).map((c) => `rws/${c}`);
      station.same_as = [...new Set([...station.same_as, ...others])].sort();
    }
  return stations;
}

/**
 * The groupings RWS publishes extremes and the astronomical tide under are
 * against NAP, even at the offshore platforms whose levels are only against
 * MSL. A station's files are all in its one datum, so an MSL station lists
 * levels only.
 */
function productsFor(available: Set<Product>, datum: string): Product[] {
  return ORDER.filter((p) => available.has(p) && (datum === "NAP" || p === "levels"));
}

/** Preferred first: NAP on land and in estuaries, MSL offshore. */
const DATUMS = ["NAP", "MSL"];

const ORDER: Product[] = ["levels", "extremes", "predictions", "predicted_extremes"];

export interface LevelsOptions {
  process?: ProcessType;
  datum?: string;
  /** Skip the response cache. Use for ranges that include the present. */
  fresh?: boolean;
}

/** Water levels in meters at `location` (an RWS location code) over [start, end). */
export async function levels(
  location: string,
  start: Date,
  end: Date,
  { process = "meting", datum = "NAP", fresh }: LevelsOptions = {},
): Promise<Observation[]> {
  const samples: Observation[] = [];
  const cm = revision(location, datum, process);
  for (const [from, to] of chunks(start, end)) {
    const series = await request(
      location,
      { Grootheid: { Code: "WATHTE" }, Hoedanigheid: { Code: datum }, ProcesType: process },
      from,
      to,
      fresh,
    );
    // A request without a grouping also returns grouped channels (e.g. extremes).
    const channel = series.find((s) => !s.AquoMetadata.Groepering?.Code);
    if (!channel) continue;
    assertCentimeters(channel, datum);
    for (const m of channel.MetingenLijst) {
      const value = m.Meetwaarde.Waarde_Numeriek;
      // RWS marks missing values with large sentinels (e.g. 999999999).
      if (value === undefined || Math.abs(value) > 10_000) continue;
      const time = Date.parse(m.Tijdstip);
      samples.push({ time, level: onRevisedNap(value, time, cm), flag: flagOf(m, process) });
    }
  }
  return dedupe(samples).filter((s) => s.time >= start.getTime() && s.time < end.getTime());
}

/**
 * Where a cycle has a double low water (an agger), RWS publishes both lows as
 * `laagwater 1` and `laagwater 2`, with the rise between them as `topagger`.
 * Both are low waters; the rise isn't a high water.
 */
const EXTREME_TYPES: Record<string, "high" | "low"> = {
  hoogwater: "high",
  laagwater: "low",
  "laagwater 1": "low",
  "laagwater 2": "low",
};

/** High and low waters at `location` over [start, end), as RWS selects them. */
export async function extremes(
  location: string,
  start: Date,
  end: Date,
  { process = "meting", datum = "NAP", fresh }: LevelsOptions = {},
): Promise<PublishedExtreme[]> {
  const grouping = EXTREME_GROUPING[process];
  if (!grouping) throw new Error(`RWS publishes no extremes for ${process}`);
  const result: PublishedExtreme[] = [];
  const cm = revision(location, datum, process);
  for (const [from, to] of chunks(start, end)) {
    const series = await request(
      location,
      { Groepering: { Code: grouping }, ProcesType: process },
      from,
      to,
      fresh,
    );
    const types = series.find((s) => s.AquoMetadata.Typering?.Code === "GETETTPE");
    const all = series.filter((s) => s.AquoMetadata.Grootheid.Code === "WATHTE");
    const heights = all.find((s) => s.AquoMetadata.Hoedanigheid.Code === datum);
    // Heights only in another datum mean RWS moved the grouping; refuse rather than skip.
    if (types && all.length && !heights)
      throw new DatumChanged(
        `RWS ${location} extremes are in ${all[0]!.AquoMetadata.Hoedanigheid.Code}, not ${datum}`,
        all[0]!.AquoMetadata.Hoedanigheid.Code,
        null,
      );
    if (!types || !heights) continue;
    assertCentimeters(heights, datum);
    const typeAt = new Map(
      types.MetingenLijst.map((m) => [Date.parse(m.Tijdstip), m.Meetwaarde.Waarde_Alfanumeriek]),
    );
    for (const m of heights.MetingenLijst) {
      const time = Date.parse(m.Tijdstip);
      const kind = typeAt.get(time);
      const value = m.Meetwaarde.Waarde_Numeriek;
      if (value === undefined || Math.abs(value) > 10_000) continue;
      if (kind === undefined || kind === "topagger") continue;
      const type = EXTREME_TYPES[kind];
      // A type RWS adds would otherwise vanish, as the agger's lows once did.
      if (!type) throw new Error(`RWS ${location}: unknown extreme type ${kind}`);
      result.push({
        time,
        level: onRevisedNap(value, time, cm),
        type,
        flag: flagOf(m, process),
      });
    }
  }
  return dedupe(result).filter((s) => s.time >= start.getTime() && s.time < end.getTime());
}

/**
 * Checked (`Gecontroleerd`) values are good and unchecked ones preliminary.
 * Quality code `00` is a normal value. What `25` means isn't documented where
 * we've looked, so it and any other code count as suspect until it is.
 */
function flagOf(m: Measurement, process: ProcessType): Flag {
  if (process === "astronomisch") return Flag.good;
  const status = m.WaarnemingMetadata.Statuswaarde;
  const code = m.WaarnemingMetadata.Kwaliteitswaardecode;
  const flag = status === "Gecontroleerd" || status === "Definitief" ? Flag.good : Flag.preliminary;
  return code === "00" || code === undefined ? flag : Flag.suspect;
}

async function request(
  location: string,
  metadata: Record<string, unknown>,
  start: Date,
  end: Date,
  fresh = false,
): Promise<Series[]> {
  const body = JSON.stringify({
    Locatie: { Code: location },
    AquoPlusWaarnemingMetadata: { AquoMetadata: metadata },
    Periode: {
      Begindatumtijd: start.toISOString().replace("Z", "+00:00"),
      Einddatumtijd: end.toISOString().replace("Z", "+00:00"),
    },
  });
  const text = await getText(OBSERVATIONS, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    fresh,
  });
  // The service answers an empty range with an empty body.
  if (!text.trim()) return [];
  const response = JSON.parse(text) as Response;
  if (!response.Succesvol) {
    if (response.Foutmelding?.includes("Geen gegevens")) return [];
    throw new Error(`RWS ${location}: ${response.Foutmelding}`);
  }
  return response.WaarnemingenLijst ?? [];
}

function assertCentimeters(series: Series, datum: string): void {
  const unit = series.AquoMetadata.Eenheid?.Code;
  if (unit && unit !== "cm") throw new Error(`RWS height unit is ${unit}, not cm`);
  if (series.AquoMetadata.Hoedanigheid.Code !== datum)
    throw new DatumChanged(
      `RWS height datum is ${series.AquoMetadata.Hoedanigheid.Code}, not ${datum}`,
      series.AquoMetadata.Hoedanigheid.Code,
      null,
    );
}

function* chunks(start: Date, end: Date): Generator<[Date, Date]> {
  for (let t = start.getTime(); t < end.getTime(); t += CHUNK_MS)
    yield [new Date(t), new Date(Math.min(t + CHUNK_MS, end.getTime()))];
}

// Chunk boundaries are inclusive on both ends, so the shared sample repeats.
function dedupe<T extends { time: number }>(samples: T[]): T[] {
  samples.sort((a, b) => a.time - b.time);
  return samples.filter((s, i) => i === 0 || s.time !== samples[i - 1]!.time);
}

/** Ranges that reach within a day of now aren't final yet, so skip the cache. */
function fresh(end: Date): boolean {
  return end.getTime() > Date.now() - 86_400_000;
}

export const source: Source = {
  metadata,
  stations: () => stations(),
  observations: (s, start, end) =>
    levels(s.source_id, start, end, { datum: s.datum, fresh: fresh(end) }),
  // Every product asks for the station's datum, so a file never mixes two.
  extremes: (s, start, end) =>
    extremes(s.source_id, start, end, { datum: s.datum, fresh: fresh(end) }),
  predictions: (s, start, end) =>
    levels(s.source_id, start, end, { process: "astronomisch", datum: s.datum, fresh: fresh(end) }),
  predictedExtremes: (s, start, end) =>
    extremes(s.source_id, start, end, {
      process: "astronomisch",
      datum: s.datum,
      fresh: fresh(end),
    }),
};
