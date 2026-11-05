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

/**
 * A station as a source lists it, with `datum` null when the source didn't say
 * this time. `reference` names the reference its levels are measured against,
 * where the source says more than the datum's label: a new `id` under the same
 * label is a moved gauge zero. `since` is the first whole local day on it,
 * when the source says.
 */
export type ListedStation = Omit<Station, "datum"> & {
  datum: string | null;
  reference?: { id: string; since: string | null } | null;
};

/**
 * A span over which a station's levels share one reference. Each epoch has its
 * own series files, and `to_current` puts its levels in the current epoch's
 * datum, or is null when they can't be. See docs/stations.md.
 */
export interface Epoch {
  /** Counts up from 1 and is never reused. Epoch 1's files are at the station's plain paths. */
  id: number;
  datum: string;
  /** UTC instants; `since` is null for a first epoch with no known start, `until` for the current one. */
  since: string | null;
  until: string | null;
  /** The last refresh whose fetch named this epoch's datum. */
  seen: string | null;
  /** The source's own name for the reference, such as PEGELONLINE's `gaugeZero.validFrom`. */
  reference: string | null;
  /** Offsets to other datums, as `Station.datums`; frozen when the epoch closes. */
  datums: Record<string, number>;
  to_current: number | null;
  state: "open" | "closed" | "held" | "rejected";
}

/** A station as the lake's lists hold it, with its datum epochs. */
export type LakeStation = Station & { epochs: Epoch[] };

/**
 * A person's decision on one epoch, keyed in `Overrides.epochs` by
 * `epochKey`: confirm or reject a held one, reject one that never happened,
 * end the epoch before it earlier than the source said, or say how to convert
 * it when no shared reference does.
 */
export interface EpochDecision {
  confirm?: boolean;
  reject?: boolean;
  /** YYYY-MM-DD: the last whole local day the previous epoch is known to hold. */
  until?: string;
  to_current?: number;
  note: string;
}

/** Decisions a person made about a source's stations, kept in its adapter. */
export interface Overrides {
  epochs?: Record<string, EpochDecision>;
}

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
  /**
   * The range of the source's local UTC offsets in hours, such as [-6, -4] for
   * US Central and Eastern time, so a date it gives can be turned into the
   * instants its day surely starts after and ends before. Defaults to [0, 0].
   */
  utc_offsets?: [number, number];
}

/**
 * One upstream source. Adapters use only `fetch` (through `src/http.ts`) so the
 * same code runs in Node for ingest and in the Worker for live levels.
 */
export interface Source {
  metadata: SourceMetadata;
  /** Decisions a person made about the source's stations. */
  overrides?: Overrides;
  /** `previous` is the lake's list, for a source that keeps choices it made before. */
  stations(previous?: Station[]): Promise<ListedStation[]>;
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
