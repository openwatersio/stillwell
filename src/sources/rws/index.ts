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
  contact: { url: "https://rijkswaterstaatdata.nl/contact/" },
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
    /** How values were derived: `NVT` for each reading as measured, `GEM24H` for a daily mean. */
    WaardeBewerkingsMethode?: { Code: string };
    /** The instrument, such as a float gauge or a pressure sensor. */
    MeetApparaat?: { Code: string };
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
  /** Free text: a river kilometer, a former name, or "platform" at the offshore platforms. */
  Omschrijving?: string;
  Lat: number;
  Lon: number;
}

interface Catalog {
  AquoMetadataLijst: {
    AquoMetadata_MessageID: number;
    Grootheid: { Code: string };
    Hoedanigheid: { Code: string };
    Groepering?: { Code: string };
    /** `meting` (measured), `astronomisch` (astronomical tide) or `verwachting` (forecast). */
    ProcesType?: string;
  }[];
  AquoMetadataLocatieLijst: {
    AquoMetaData_MessageID: number;
    Locatie_MessageID: number;
  }[];
  LocatieLijst: CatalogLocation[];
}

/**
 * Locations with a measured water-level series against NAP, or against MSL
 * where that's all a location measures (the offshore platforms), and those
 * with only RWS's astronomical tide, listed for their predictions.
 */
export async function stations(): Promise<ListedStation[]> {
  const catalog = await getJson<Catalog>(CATALOG, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      CatalogusFilter: {
        Grootheden: true,
        Hoedanigheden: true,
        Groeperingen: true,
        ProcesTypes: true,
      },
    }),
  });
  // What each metadata entry gives a location: a height series or a set of extremes.
  const productsOf = new Map<number, Product[]>();
  const datumOf = new Map<number, string>();
  for (const m of catalog.AquoMetadataLijst) {
    const grouping = m.Groepering?.Code;
    // Measured heights only: Europlatform and Goeree Lichteiland have NAP forecasts but measure against MSL.
    if (
      !grouping &&
      m.Grootheid.Code === "WATHTE" &&
      m.ProcesType === "meting" &&
      DATUMS.includes(m.Hoedanigheid.Code)
    ) {
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
    // A location with only RWS's astronomical tide, such as Knock and Dukegat, is listed for its predictions.
    catalog.LocatieLijst.filter((l) => {
      const set = products.get(l.Locatie_MessageID);
      return set?.has("levels") || set?.has("predictions");
    })
      .map((l): Station => {
        const available = products.get(l.Locatie_MessageID)!;
        const measured = available.has("levels");
        // The astronomical groupings are against NAP even where a location measures against MSL.
        const datum = DATUMS.find((d) => datums.get(l.Locatie_MessageID)?.has(d)) ?? "NAP";
        return {
          ...stationDefaults(metadata),
          id: `rws/${l.Code}`,
          source_id: l.Code,
          name: l.Naam,
          lat: l.Lat,
          lon: l.Lon,
          // The Caribbean Netherlands (Bonaire, Sint Eustatius, Saba) has its own code.
          country_code: l.Lon < -30 ? "BQ" : "NL",
          // The only water RWS's catalog names is the sea of its offshore platforms.
          kind: /platform/i.test(l.Omschrijving ?? "") ? "coastal" : null,
          interval_s: measured ? 600 : null,
          datum,
          datums: {},
          products: productsFor(available, datum),
          first: null,
          last: null,
          tide_station: null,
          same_as: [],
          status: "active",
          live: measured,
          min_interval_s: 300,
          source_url: `https://waterinfo.rws.nl/publiek/waterhoogte/${encodeURIComponent(l.Code)}/details`,
        };
      })
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
 * at different levels. Erratum `rws-ameland-westgat-twice`.
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
    for (const channel of readings(
      location,
      series.filter((s) => !s.AquoMetadata.Groepering?.Code),
    )) {
      assertCentimeters(channel, datum);
      for (const m of channel.MetingenLijst) {
        const value = m.Meetwaarde.Waarde_Numeriek;
        // RWS marks missing values with large sentinels (e.g. 999999999).
        if (value === undefined || Math.abs(value) > 10_000) continue;
        const time = Date.parse(m.Tijdstip);
        samples.push({ time, level: onRevisedNap(value, time, cm), flag: flagOf(m, process) });
      }
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
    // Every series of each kind, since RWS can split one channel's year into several.
    // Every type series counts: a type is only looked up at a height's time.
    const types = readings(
      location,
      series.filter((s) => s.AquoMetadata.Typering?.Code === "GETETTPE"),
    );
    // Readings only: a daily mean in the datum doesn't hide readings that moved to another.
    const all = readings(
      location,
      series.filter((s) => s.AquoMetadata.Grootheid.Code === "WATHTE"),
    );
    const inDatum = all.filter((s) => s.AquoMetadata.Hoedanigheid.Code === datum);
    // Heights only in another datum mean RWS moved the grouping; refuse rather than skip.
    // Heights in the datum that are all missing-value sentinels are an outage, not a move.
    if (types.length && all.length && !inDatum.length)
      throw new DatumChanged(
        `RWS ${location} extremes are in ${all[0]!.AquoMetadata.Hoedanigheid.Code}, not ${datum}`,
        all[0]!.AquoMetadata.Hoedanigheid.Code,
        null,
      );
    const heights = consecutive(inDatum);
    if (!types.length || !heights.length) continue;
    for (const h of heights) assertCentimeters(h, datum);
    // At a time two type selections share, the one that labels more of the chosen heights'
    // values wins, then the one with fewer labels elsewhere: a selection's labels sit at its
    // own heights' times, so one padded with sentinels can't relabel another's extremes.
    const chosen = new Set(heights.flatMap(valueTimes));
    const fit = (t: Series) => {
      const at = t.MetingenLijst.filter((m) => chosen.has(Date.parse(m.Tijdstip))).length;
      return [at, t.MetingenLijst.length - at] as const;
    };
    const typeAt = new Map<number, string | undefined>();
    for (const t of types
      .map((t) => ({ t, f: fit(t) }))
      .sort((a, b) => b.f[0] - a.f[0] || a.f[1] - b.f[1])
      .map(({ t }) => t))
      for (const m of t.MetingenLijst) {
        const time = Date.parse(m.Tijdstip);
        if (!typeAt.has(time)) typeAt.set(time, m.Meetwaarde.Waarde_Alfanumeriek);
      }
    for (const m of heights.flatMap((h) => h.MetingenLijst)) {
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
 * Checked (`Gecontroleerd`) and final (`Definitief`) values are good, and unchecked ones preliminary.
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

/** Ways RWS derives values that aren't readings as measured, which are left out. */
const MEANS = new Set(["GEM24H"]);

/** The times of a series' values, in order; a missing-value sentinel isn't a value. */
function valueTimes(s: Series): number[] {
  return s.MetingenLijst.filter((m) => {
    const v = m.Meetwaarde.Waarde_Numeriek;
    return v === undefined ? m.Meetwaarde.Waarde_Alfanumeriek !== undefined : Math.abs(v) <= 10_000;
  })
    .map((m) => Date.parse(m.Tijdstip))
    .sort((a, b) => a - b);
}

/** Series with more values first; stable, so equal ones keep their order. */
const byValues = (series: Series[]) =>
  series
    .map((s) => ({ s, n: valueTimes(s).length }))
    .sort((a, b) => b.n - a.n)
    .map(({ s }) => s);

/**
 * Every series of readings as measured, the one to keep first where two share a
 * time. RWS answers a request with a series per instrument and per way of deriving
 * values, all of one height: at Katsbinnen in 1999 a float gauge's year and 7
 * values from the next year's pressure sensor, at Maastricht Borgharen in 1988 a
 * daily mean (`GEM24H`) beside the 10-minute readings, and at Goeree Lichteiland in
 * 2023 two parts with the same metadata. A mean is left out, and any other way of
 * deriving values fails, rather than vanish. A series whose values span a day or
 * more ranks by its median step between values, the finest first, so a 10-minute
 * gauge's reading wins over a once-a-day staff gauge's; a shorter one ranks after
 * those, so a burst of a few values only fills times the others lack. Then more
 * values, then the instrument's code. Pushed in this order, `dedupe` keeps the
 * first series' value at a time two share.
 */
function readings(location: string, series: Series[]): Series[] {
  // A series with one value has no step.
  const step = (t: number[]) => {
    const steps = t
      .slice(1)
      .map((x, i) => x - t[i]!)
      .filter((d) => d > 0)
      .sort((a, b) => a - b);
    return steps.length ? steps[Math.floor(steps.length / 2)]! : Infinity;
  };
  const instrument = (s: Series) => s.AquoMetadata.MeetApparaat?.Code ?? "";
  return series
    .filter((s) => {
      const how = s.AquoMetadata.WaardeBewerkingsMethode?.Code ?? "NVT";
      if (how !== "NVT" && !MEANS.has(how))
        throw new Error(`RWS ${location}: unknown WaardeBewerkingsMethode ${how}`);
      return how === "NVT";
    })
    .map((s) => {
      const t = valueTimes(s);
      const long = t.length > 1 && t.at(-1)! - t[0]! >= 86_400_000;
      return { s, long, step: long ? step(t) : Infinity, n: t.length, code: instrument(s) };
    })
    .sort(
      (a, b) =>
        Number(b.long) - Number(a.long) ||
        a.step - b.step ||
        b.n - a.n ||
        (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
    )
    .map(({ s }) => s);
}

/**
 * Of series of readings, the one with the most values and each other whose whole
 * span lies outside every one already taken. RWS can answer a period's extremes
 * with two selections of the same tides, as at Hoek van Holland in early 2024 (314
 * extremes with the agger's lows and 224 without, with the same metadata), so a
 * series that overlaps would give a tide a second extreme. Parts that follow each
 * other, as at Goeree Lichteiland in 2023, or one instrument handing over to
 * another, are taken. Ranked by values, not step: a stray pair of extremes 10
 * minutes apart mustn't push out the year's selection. A series with no values
 * takes no span.
 */
function consecutive(series: Series[]): Series[] {
  const taken: { series: Series; from: number; to: number }[] = [];
  for (const s of byValues(series)) {
    const t = valueTimes(s);
    if (!t.length) continue;
    const [from, to] = [t[0]!, t.at(-1)!];
    if (taken.every((x) => to < x.from || from > x.to)) taken.push({ series: s, from, to });
  }
  return taken.map((x) => x.series);
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
  overrides: {
    // Listed in NAP from RWS's NAP forecasts, though they measure against MSL.
    restarts: {
      "rws/europlatform": {
        datum: "MSL",
        note: "RWS's NAP series here is a forecast; its measured levels, from 1990 on, are against MSL. The store held no files in any product or epoch (November 2026).",
      },
      "rws/goeree.lichteiland": {
        datum: "MSL",
        note: "RWS's NAP series here is a forecast; its measured levels, from 1990 on, are against MSL. The store held only 2024's measured extremes against NAP (extremes/rws/goeree.lichteiland/2/2024.parquet, 1,415 rows), which go unread after the restart, by decision, for the MSL levels from 1990 (November 2026).",
      },
    },
    // A gauge whose zero moved with no change of datum marked (docs/stations.md, "Unreported zero moves").
    splits: {
      "rws/kralendijk.plazabeachterminal": [
        {
          since: "2026-10-27",
          note: "Monthly medians step from −0.62 m in January and February 2026 to +0.12 to +0.15 m from late October, after a gap; no gauge nearby to measure the offset (erratum `rws-kralendijk-2026-level`).",
        },
      ],
    },
  },
};
