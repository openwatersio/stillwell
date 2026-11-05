import type { QcOptions } from "./qc.ts";
import type { Extreme, Sample, TransitExtreme } from "./types.ts";

/**
 * Quality flags, ordered from best to worst so that combining two flags is
 * `Math.max`. Source flags fold into these, and QC can only make a flag worse.
 */
export const Flag = {
  good: 0,
  interpolated: 1,
  preliminary: 2,
  suspect: 3,
  bad: 4,
} as const;

export type Flag = (typeof Flag)[keyof typeof Flag];

export const FLAG_NAMES = Object.keys(Flag) as (keyof typeof Flag)[];

/** One value in a series. `received` is when we first saw it, if we saw it arrive. */
export interface Observation extends Sample {
  flag: Flag;
  received?: number;
}

/** A high or low water a source publishes, observed or predicted. */
export type PublishedExtreme = (Extreme | TransitExtreme) & { flag: Flag };

export type Kind = "coastal" | "estuary" | "lake" | "river";

/** What a station has in the lake. */
export type Product = "levels" | "extremes" | "predictions" | "predicted_extremes";

export interface Station {
  /** `<source>/<source_id>`, e.g. `rws/hoekvanholland`. */
  id: string;
  source: string;
  source_id: string;
  name: string;
  lat: number;
  lon: number;
  country_code: string | null;
  kind: Kind | null;
  /** Native sampling interval of the observed series, in seconds. */
  interval_s: number | null;
  /** What levels are measured from, e.g. `NAP`, `PNP`, `MLLW`. */
  datum: string;
  /** Meters to add to a level in `datum` to refer it to each other datum. */
  datums: Record<string, number>;
  products: Product[];
  /**
   * First and last observation in the lake, as ISO times; null until a lake
   * job fills them in. Derived from the lake, never committed.
   */
  first: string | null;
  last: string | null;
  license: string;
  commercial_use: boolean;
  attribution: string;
  /** tide-database station (`source/id`) for the same gauge. */
  tide_station: string | null;
  /** Other lake series from the same physical gauge. */
  same_as: string[];
  status: "active" | "inactive";
  /** Whether the live endpoint serves this station. */
  live: boolean;
  /** How often the source lets us ask for this station, in seconds. */
  min_interval_s: number | null;
  source_url: string | null;
}

/** A station as a source lists it, with `datum` null when the source didn't say this time. */
export type ListedStation = Omit<Station, "datum"> & { datum: string | null };

export interface SourceMetadata {
  id: string;
  name: string;
  url: string;
  license: { id: string; name: string; url: string; commercial_use: boolean };
  attribution: string;
  /** Anything a user of the data should know about the terms. */
  terms?: string;
  /** How far back `observations` reaches, in days, when the source keeps a rolling window. */
  window_days?: number;
  /** Quality-control settings for the source's observed levels, where the defaults don't fit. */
  qc?: QcOptions;
}

/**
 * One upstream source. Adapters use only `fetch` (through `src/http.ts`) so the
 * same code runs in Node for ingest and in the Worker for live levels.
 */
export interface Source {
  metadata: SourceMetadata;
  /** `previous` is the committed list, for a source that keeps choices it made before. */
  stations(previous?: Station[]): Promise<ListedStation[]>;
  /**
   * Why a listed station no longer measures from what its committed record
   * does, though its datum's name is unchanged; null when it still does.
   */
  seriesChanged?(committed: Station, listed: ListedStation): string | null;
  /**
   * Observed levels over [start, end) for many stations in one sweep, by
   * station ID, with an Error for a station the sweep refused, for sources
   * where asking each station would take too many requests. `recent` uses it
   * in place of `observations` when it's there.
   */
  recent?(stations: Station[], start: Date, end: Date): Promise<Map<string, Observation[] | Error>>;
  /**
   * Observed levels over [start, end). Every product comes in `station.datum`,
   * and throws rather than return values in another, so a file never mixes two.
   */
  observations?(station: Station, start: Date, end: Date): Promise<Observation[]>;
  /** High and low waters the source selects from its observations. */
  extremes?(station: Station, start: Date, end: Date): Promise<PublishedExtreme[]>;
  /** The source's own predicted curve over [start, end). */
  predictions?(station: Station, start: Date, end: Date): Promise<Observation[]>;
  /** The source's own predicted high and low waters over [start, end). */
  predictedExtremes?(station: Station, start: Date, end: Date): Promise<PublishedExtreme[]>;
}

/** Fields every station from a source shares. */
export function stationDefaults(
  metadata: SourceMetadata,
): Pick<Station, "source" | "license" | "commercial_use" | "attribution"> {
  return {
    source: metadata.id,
    license: metadata.license.id,
    commercial_use: metadata.license.commercial_use,
    attribution: metadata.attribution,
  };
}
