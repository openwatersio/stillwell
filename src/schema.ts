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

/**
 * One value in a series. `received` is when we first saw it, if we saw it
 * arrive. `flag` is the worse of the source's flag and QC's; `source_flag` is
 * the source's alone, kept so that whether the source finalized a value isn't
 * lost when QC marks it. Values written before it was kept have none.
 */
export interface Observation extends Sample {
  flag: Flag;
  source_flag?: Flag;
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
  /** Other lake series from the same physical gauge, by `src/same-as.ts`. */
  same_as: string[];
  /**
   * The series to use for the gauge's observed levels among this one and its
   * `same_as`, the station's own ID when it's the one. Set as
   * `stations.parquet` is built, never by an adapter.
   */
  preferred?: string;
  /** The IDs of the errata, open `source-error` issues, that affect the station. Set as `stations.parquet` is built. */
  errata?: string[];
  status: "active" | "inactive";
  /** Whether the live endpoint serves this station. */
  live: boolean;
  /**
   * Where the source says its quality checks of this station's values start,
   * as a UTC instant: it never checked the values before it and never will,
   * so a `preliminary` one from before it is final as it stands, having
   * passed only the lake's QC. Null or absent where the source states no
   * such date. Absent in a source's list means the adapter hasn't asked yet.
   */
  source_qc_start?: string | null;
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
  /**
   * Where the source says `reference` starts, as a UTC instant, or null when it
   * doesn't say. A first epoch with no `since` learns it here, so a
   * later change can still be checked against it.
   */
  reference_since: string | null;
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
  license: {
    id: string;
    name: string;
    url: string;
    /** The default for the source's stations; a station's own terms can differ. */
    commercial_use: boolean;
    /**
     * Whether the terms let anyone republish the data, which the public lake
     * does. A source that withholds it keeps its list and series in the
     * restricted lake. This, not `commercial_use`, decides the lake.
     */
    redistribution: boolean;
  };
  attribution: string;
  /**
   * Where to report an error in the source's data: the agency's published
   * mailbox or contact form, at least one of them. Never a person's own
   * address, since `sources.json` publishes it.
   */
  contact: { email: string; url?: string } | { email?: string; url: string };
  /** Anything a user of the data should know about the terms. */
  terms?: string;
  /**
   * `current` when the source serves past values measured from each station's
   * current reference, as PEGELONLINE's raw-data download does, so a backfill
   * can reach back before the date the source gives that reference.
   * `previous` when it serves past values in the reference of their time, as
   * RWS does across the 2005 NAP revision, so those before the reference's
   * start go to an epoch of their own, which backfill fills too.
   */
  archive?: "current" | "previous";
  /**
   * Whether the source publishes values within hours, so hourly ingest polls
   * its live stations into recent/. A source that delivers later, as UHSLC's
   * monthly fast-delivery files do, is left to backfill and the refetch.
   */
  hourly: boolean;
  /**
   * Whether values the source first publishes as preliminary become final
   * later, so the monthly refetch fetches them again until they do.
   * `sources.json` publishes it, telling readers that a false source's
   * `preliminary` values stay so, so it follows what the source does, never
   * only what a refetch costs.
   */
  finalizes: boolean;
  /**
   * Whether the adapter answers an outage with an error, never with no values,
   * so a year it returns nothing for has none. A `--skip-written` backfill
   * then records such years and skips them for 30 days (`src/empty-years.ts`).
   */
  empty_means_none?: boolean;
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
  /**
   * Spans of a station's values that the lake's own errata flag `suspect`,
   * worked out from the source's levels and flags alone, so requalify flags
   * them again without fetching. `record` reads the values of one epoch that
   * the caller holds, a year at a time, which can be only part of it, such as
   * the recent window; one that needs the whole record throws when it isn't.
   * The adapter flags the same spans in what it fetches, keeping
   * `source_flag` the source's.
   */
  suspect?(
    station: Station,
    record: () => AsyncIterable<Observation[]>,
  ): Promise<[number, number][]>;
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
