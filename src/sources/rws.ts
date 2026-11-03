import { cachedJson, cachedText } from "../cache.ts";
import type { Extreme, Sample, Station } from "../types.ts";

/**
 * Rijkswaterstaat Waterwebservices (DDAPI 2.0). Data is CC0 unless a component
 * says otherwise: https://rijkswaterstaatdata.nl/waterdata/
 *
 * Observed levels (`meting`) and the astronomical tide (`astronomisch`) are 10-minute
 * series in integer centimeters. Extremes come as two channels on the same
 * timestamps: GETETTPE says `hoogwater` or `laagwater`, WATHTE carries the height.
 */
const BASE = "https://ddapi20-waterwebservices.rijkswaterstaat.nl";
const OBSERVATIONS = `${BASE}/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen`;
const CATALOGUE = `${BASE}/METADATASERVICES/OphalenCatalogus`;

// The service refuses requests over 160,000 values. A year of 10-minute data is
// 52,560, so yearly chunks stay well inside it.
const CHUNK_MS = 365 * 86_400_000;

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

interface CatalogueLocation {
  Locatie_MessageID: number;
  Code: string;
  Naam: string;
  Lat: number;
  Lon: number;
}

interface Catalogue {
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
  LocatieLijst: CatalogueLocation[];
}

/** Locations with a water-level series against `datum` (NAP by default). */
export async function stations(datum = "NAP"): Promise<Station[]> {
  const catalogue = await cachedJson<Catalogue>(CATALOGUE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      CatalogusFilter: { Grootheden: true, Hoedanigheden: true, Groeperingen: true },
    }),
  });
  const heightIds = new Set(
    catalogue.AquoMetadataLijst.filter(
      (m) => m.Grootheid.Code === "WATHTE" && m.Hoedanigheid.Code === datum && !m.Groepering?.Code,
    ).map((m) => m.AquoMetadata_MessageID),
  );
  const locationIds = new Set(
    catalogue.AquoMetadataLocatieLijst.filter((l) => heightIds.has(l.AquoMetaData_MessageID)).map(
      (l) => l.Locatie_MessageID,
    ),
  );
  return catalogue.LocatieLijst.filter((l) => locationIds.has(l.Locatie_MessageID))
    .map((l) => ({
      id: `rws:${l.Code}`,
      name: l.Naam,
      lat: l.Lat,
      lon: l.Lon,
      datum,
      source_url: `https://waterinfo.rws.nl/publiek/waterhoogte/${encodeURIComponent(l.Code)}/details`,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

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
): Promise<Sample[]> {
  const samples: Sample[] = [];
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
      samples.push({ time: Date.parse(m.Tijdstip), level: value / 100 });
    }
  }
  return dedupe(samples).filter((s) => s.time >= start.getTime() && s.time < end.getTime());
}

/** High and low waters at `location` over [start, end), as RWS selects them. */
export async function extremes(
  location: string,
  start: Date,
  end: Date,
  { process = "meting", datum = "NAP", fresh }: LevelsOptions = {},
): Promise<Extreme[]> {
  const grouping = EXTREME_GROUPING[process];
  if (!grouping) throw new Error(`RWS publishes no extremes for ${process}`);
  const result: Extreme[] = [];
  for (const [from, to] of chunks(start, end)) {
    const series = await request(
      location,
      { Groepering: { Code: grouping }, ProcesType: process },
      from,
      to,
      fresh,
    );
    const types = series.find((s) => s.AquoMetadata.Typering?.Code === "GETETTPE");
    const heights = series.find(
      (s) =>
        s.AquoMetadata.Grootheid.Code === "WATHTE" && s.AquoMetadata.Hoedanigheid.Code === datum,
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
      if (kind !== "hoogwater" && kind !== "laagwater") continue;
      result.push({ time, level: value / 100, type: kind === "hoogwater" ? "high" : "low" });
    }
  }
  return dedupe(result).filter((s) => s.time >= start.getTime() && s.time < end.getTime());
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
  const text = await cachedText(OBSERVATIONS, {
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
    throw new Error(`RWS height datum is ${series.AquoMetadata.Hoedanigheid.Code}, not ${datum}`);
}

function* chunks(start: Date, end: Date): Generator<[Date, Date]> {
  for (let t = start.getTime(); t < end.getTime(); t += CHUNK_MS)
    yield [new Date(t), new Date(Math.min(t + CHUNK_MS, end.getTime()))];
}

// Chunk boundaries are inclusive on both ends, so the shared sample repeats.
function dedupe<T extends Sample>(samples: T[]): T[] {
  samples.sort((a, b) => a.time - b.time);
  return samples.filter((s, i) => i === 0 || s.time !== samples[i - 1]!.time);
}
