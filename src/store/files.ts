/**
 * Every file Stillwell publishes to the store: its path, each column's DuckDB
 * type, whether it can be null, and what it means, and how its rows are
 * sorted. The writers in `parquet.ts` take their columns and types from here,
 * the tests and the weekly bucket check compare written files with it
 * (`checkFile`), and publish writes it to the store as `datapackage.json`. It
 * imports nothing, so anything can read it without DuckDB, such as a docs site
 * rendering schema tables. The store also holds files ingest keeps for itself,
 * such as `stations/bounds/` and `history/`, which aren't defined here.
 */

export interface Column {
  name: string;
  /** The DuckDB type the writer casts to, as `CREATE TABLE` spells it. */
  type: string;
  /** One line of Markdown. */
  description: string;
  /** Whether a row can hold null. */
  nullable?: boolean;
  /** Whether a file can lack the column: older files, or sources that don't give it. */
  optional?: boolean;
  /** A `STRUCT(...)[]` column's fields, which give its `type`. */
  fields?: Column[];
}

export interface ParquetFile {
  /** Its path in the store, with `<placeholders>` and `[optional parts]`. */
  path: string;
  /** A file in the public store that has this layout. */
  example: string;
  title: string;
  /** Markdown. */
  description: string;
  columns: Column[];
  /** SQL `ORDER BY` terms the rows are sorted by. */
  sort: string[];
}

/** A list of structs from its fields, such as `epochs`. */
function structList(fields: Column[]): string {
  return `STRUCT(${fields.map((f) => `${f.name} ${f.type}`).join(", ")})[]`;
}

const EPOCH_FIELDS: Column[] = [
  {
    name: "id",
    type: "INTEGER",
    description:
      "The epoch's number, counting up from 1 and never reused. Epoch 1's files are at the station's plain paths, a later one's in a directory of its number.",
  },
  {
    name: "datum",
    type: "VARCHAR",
    description: "The datum the epoch's levels are measured from.",
  },
  {
    name: "since",
    type: "TIMESTAMPTZ",
    nullable: true,
    description: "When the epoch starts, in UTC; null for a first epoch with no known start.",
  },
  {
    name: "until",
    type: "TIMESTAMPTZ",
    nullable: true,
    description: "When the epoch ends, in UTC; null for the current one.",
  },
  {
    name: "seen",
    type: "TIMESTAMPTZ",
    nullable: true,
    description: "The last station refresh whose fetch named the epoch's datum.",
  },
  {
    name: "reference",
    type: "VARCHAR",
    nullable: true,
    description:
      "The source's own name for the reference the levels are measured against, where it gives more than the datum's label, such as PEGELONLINE's `gaugeZero.validFrom` or the research-quality version of a UHSLC series. For USGS, Kartverket and DMI it is the reason the source gave for a series changing.",
  },
  {
    name: "reference_since",
    type: "TIMESTAMPTZ",
    nullable: true,
    description: "Where the source says `reference` starts, in UTC; null where it doesn't say.",
  },
  {
    name: "datums",
    type: "MAP(VARCHAR, DOUBLE)",
    description:
      "Meters to add to a level in the epoch's `datum` to refer it to each other datum that the source gives, without the MSL, LAT and chart datum offsets that the station's `datums` adds from slackwater-database or linked stations. In the current epoch they're the source's latest offsets, kept as they were when a refresh brings none, unless the source marks the ones it gave wrong, and while the station is held; they're frozen when the epoch closes.",
  },
  {
    name: "to_current",
    type: "DOUBLE",
    nullable: true,
    description:
      "Meters to add to the epoch's levels to put them in the station's current `datum`; null where they can't be converted.",
  },
  {
    name: "state",
    type: "VARCHAR",
    description: "`open`, `closed`, `held` (a change waiting for a decision) or `rejected`.",
  },
];

const EPOCHS: Column = {
  name: "epochs",
  type: structList(EPOCH_FIELDS),
  description: "Each span over which the station's levels share one reference.",
  fields: EPOCH_FIELDS,
};

const STATION_COLUMNS: Column[] = [
  {
    name: "id",
    type: "VARCHAR",
    description:
      "The station's ID, `<source>/<source_id>`, such as `rws/hoekvanholland`. Every other file names a station by it.",
  },
  {
    name: "source",
    type: "VARCHAR",
    description: "The source that publishes the station's data, its `id` in `sources.json`.",
  },
  {
    name: "source_id",
    type: "VARCHAR",
    description:
      "The source's own ID for the station, or one made from it: letters, digits, `.`, `_`, `~` and `-`, so series paths and URLs hold it as it is.",
  },
  { name: "name", type: "VARCHAR", description: "The station's name, as the source gives it." },
  {
    name: "lat",
    type: "DOUBLE",
    description:
      "Latitude in degrees, as the source gives it, or as the store corrects it where a source places a station away from its gauge.",
  },
  { name: "lon", type: "DOUBLE", description: "Longitude in degrees, as `lat`." },
  {
    name: "country_code",
    type: "VARCHAR",
    nullable: true,
    description: "ISO 3166-1 alpha-2 country code.",
  },
  {
    name: "kind",
    type: "VARCHAR",
    nullable: true,
    description:
      "`coastal`, `estuary`, `lake` or `river`, from the source or the store's own list; null where neither says.",
  },
  {
    name: "interval_s",
    type: "INTEGER",
    nullable: true,
    description:
      "The station's usual interval between values, in seconds: the source's, or where it gives none, the most common step between its last year's values (`step_s` in its analysis). The store measures the step at least once a year, so a change in sampling can take up to a year to show, and a station that samples irregularly, such as SFWMD, gets its most common gap. Null where neither says, as for a station not yet measured.",
  },
  {
    name: "datum",
    type: "VARCHAR",
    description:
      "What the station's levels are measured from, in the source's own name for it, such as `NAP`, `PNP` (gauge zero) or `STND`.",
  },
  {
    name: "datums",
    type: "MAP(VARCHAR, DOUBLE)",
    description:
      "Meters to add to a level in `datum` to refer it to each other datum, in the station's current epoch.",
  },
  {
    name: "datums_source",
    type: "MAP(VARCHAR, VARCHAR)",
    description:
      "Where each offset in `datums` came from: `source`, `slackwater-database` or `computed` from another series of the gauge.",
  },
  {
    name: "datums_epoch",
    type: 'MAP(VARCHAR, STRUCT(start DATE, "end" DATE))',
    description:
      "The period each tidal datum in `datums` was reduced over, as `start` and `end` dates, where known.",
  },
  {
    name: "datums_attribution",
    type: "VARCHAR[]",
    description:
      "The credits owed for offsets in `datums` that don't come from the source itself; empty where it holds only the source's.",
  },
  {
    name: "chart_datum",
    type: "VARCHAR",
    nullable: true,
    description:
      "The datum charts use at the station, such as `MLLW`, `LAT`, `SKN` or `CD`; null where the station has no offset to one.",
  },
  {
    name: "frame",
    type: "VARCHAR",
    description:
      "`gauge` where levels line up with the predictions of `tide_station`, `source` where the chart-datum offset is the source's or carried from another series, `unknown` otherwise.",
  },
  {
    name: "products",
    type: "VARCHAR[]",
    description:
      "Which of `levels`, `extremes`, `predictions` and `predicted_extremes` the station has.",
  },
  {
    name: "first",
    type: "TIMESTAMPTZ",
    nullable: true,
    description:
      "The station's first observation, over all its datum epochs; null before it has any.",
  },
  {
    name: "last",
    type: "TIMESTAMPTZ",
    nullable: true,
    description: "The station's last observation; null before it has any.",
  },
  {
    name: "missing_years",
    type: "INTEGER[]",
    nullable: true,
    description:
      "The UTC years of observed levels the store doesn't have yet, from the source's `backfill.since` in `sources.json` to this year for a live station, or for another to the year after its last stored one or the last year a backfill asked for, whichever is later, but not this year. A year counts as had when no backfill can ask the source for it in the station's datum; when its file is in the station's series, and at a source polled hourly from 2026 on a backfill also covered it or compaction carried it from the year's start, since compaction began in November 2026 and writes a station's first year from when it was first polled; or when a backfill asked for it, got nothing, and that answer is sure: the source answers an outage with an error, or the year is before the station's first stored year or, for an inactive station, after its last. An empty year inside the record, or after an active station's, stays listed, since it may have been an outage. Empty when the station's history is complete; null where it isn't known, while a run is writing the station's files, or where the station has no levels.",
  },
  {
    name: "license",
    type: "VARCHAR",
    description: "The license of the station's data, as its source's `license.id`.",
  },
  {
    name: "commercial_use",
    type: "BOOLEAN",
    description:
      "Whether the station's terms allow commercial use. Where a contributor's own terms apply, this follows them.",
  },
  {
    name: "attribution",
    type: "VARCHAR",
    description:
      "The credit the station's data requires, including a contributor's where its terms apply.",
  },
  {
    name: "tide_station",
    type: "VARCHAR",
    nullable: true,
    description: "The gauge's station in slackwater-database, the tide prediction database.",
  },
  {
    name: "same_as",
    type: "VARCHAR[]",
    description: "Other stations of the same physical gauge, by `id`.",
  },
  {
    name: "preferred",
    type: "VARCHAR",
    description:
      "The station to read for observed levels among this one and its `same_as`; its own `id` when it's the one. Worked out again each time this file is built, so it can change.",
  },
  {
    name: "errata",
    type: "VARCHAR[]",
    description:
      "The IDs of the errors found in what the source publishes for this station, in `errata.json`.",
  },
  {
    name: "status",
    type: "VARCHAR",
    description:
      "`active` or `inactive`. A station the source stops listing, lists as ended (such as a CO-OPS station with a `removed` date), or that has stopped reporting by its source's own test (as at DWR, JODC, CDEC, SFWMD, JMA and SMHI), stays in the store, inactive, with its history, so its ID is never reused; so does a record set aside as another gauge's, such as GESLA's Uddevalla. A station withheld at its owner's request is removed entirely.",
  },
  {
    name: "live",
    type: "BOOLEAN",
    description:
      "Whether the station's latest values are fetched as they come in. Its last 7 days are in `recent/`, which is rewritten every hour.",
  },
  {
    name: "min_interval_s",
    type: "INTEGER",
    nullable: true,
    description:
      "The shortest time between requests for the station, in seconds: the source's own limit where it publishes one, or the store's choice where it doesn't; null where neither sets one.",
  },
  {
    name: "source_qc_start",
    type: "TIMESTAMPTZ",
    nullable: true,
    description:
      "Where the source's quality checks of the station's values start, in UTC; null where unknown. The source won't check the `preliminary` values before it.",
  },
  {
    name: "source_qc_start_inferred",
    type: "BOOLEAN",
    nullable: true,
    description:
      "Whether the store inferred `source_qc_start` from the source's flags (true) or the source stated it (false); null without one, or where the station refresh hasn't read one yet. An inferred date is the store's reading of the flags, worked out once and kept. Filter on `source_qc_start_inferred = false` to keep only dates the source stated.",
  },
  {
    name: "tidal",
    type: "BOOLEAN",
    nullable: true,
    description:
      "Whether the station's levels carry a tide, measured from its last year of levels rather than taken from `kind`, so a river can be tidal and the Baltic isn't; null where the levels can't say, or before they're first measured.",
  },
  {
    name: "tide_m",
    type: "DOUBLE",
    nullable: true,
    description:
      "The amplitudes of M2 and O1 added, in meters, that `tidal` is judged by. Null where the usable values span under 30 days or are sampled too coarsely to fit (median step over 3 hours), and before the station's first measurement.",
  },
  {
    name: "source_url",
    type: "VARCHAR",
    nullable: true,
    description: "The station's page at its source.",
  },
];

/**
 * Station fields a source's list keeps as JSON in `extra`, beside the
 * source's own fields, so a station whose source hasn't been asked for its QC
 * start has none rather than null, and its adapter knows to ask.
 */
export const IN_LIST_EXTRA = ["source_qc_start", "source_qc_start_inferred"];

/** Station columns `stations/<source>.parquet` keeps in `extra`, or leaves to publish. */
const NOT_IN_LISTS = new Set([
  "first",
  "last",
  "missing_years",
  "preferred",
  "errata",
  "tidal",
  "tide_m",
  "datums_source",
  "datums_epoch",
  "datums_attribution",
  "chart_datum",
  "frame",
  ...IN_LIST_EXTRA,
]);

const LEVEL = (what: string): Column => ({
  name: "level_m",
  type: "FLOAT",
  description: `The ${what} in meters, in \`datum\`, as a 32-bit float.`,
});

const DATUM: Column = {
  name: "datum",
  type: "VARCHAR",
  description:
    "The datum `level_m` is measured from, the same on every row. It matches the epoch's `datum` in `stations.parquet`.",
};

const FLAG: Column = {
  name: "flag",
  type: "UTINYINT",
  description:
    "Quality, from best to worst: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad, after the store's quality checks. `flag <= 2` keeps everything not flagged as a problem.",
};

const SOURCE_FLAG: Column = {
  name: "source_flag",
  type: "UTINYINT",
  nullable: true,
  optional: true,
  description:
    "The source's own flag on the same scale, before the store's quality checks; null in predictions and some older values, and missing from some older files. Where an older value's `source_flag` is null and its `flag` is better than suspect, the `flag` is the source's; a suspect or bad one may be the store's own quality check.",
};

const RECEIVED: Column = {
  name: "received",
  type: "TIMESTAMPTZ",
  nullable: true,
  optional: true,
  description:
    "When the store first saw the value arrive; null for backfilled history, and missing from some older files.",
};

const TIME: Column = {
  name: "time",
  type: "TIMESTAMPTZ",
  description: "The value's time, in UTC.",
};

/** The years file's count of values with each `flag`, in flag order. */
export const FLAG_COUNTS = ["good", "interpolated", "preliminary", "suspect", "bad"];

const SERIES_PATH = "<source>/<station>[/<epoch>]/<year>.parquet";
const SERIES_NOTE =
  "`<station>` is the station's `source_id`, which needs no URL-encoding, and `<epoch>` the datum epoch's `id`, left out for epoch 1.";

const OBSERVATION_COLUMNS = [TIME, LEVEL("level"), FLAG, SOURCE_FLAG, RECEIVED, DATUM];

const EXTREME_COLUMNS = (what: string): Column[] => [
  { ...TIME, description: `The time of the ${what} high or low water, in UTC.` },
  LEVEL(`${what} level`),
  {
    name: "type",
    type: "VARCHAR",
    description:
      "`high` or `low`. A source can give both lows of a double low water, so two lows can come in a row.",
  },
  { ...FLAG, description: "Quality on the same scale as observed levels' `flag`." },
];

export const FILES = {
  stations: {
    path: "stations.parquet",
    example: "stations.parquet",
    title: "Stations",
    description: "One row per station: one source's series at one place.",
    columns: [...STATION_COLUMNS, EPOCHS],
    sort: ["id"],
  },
  lists: {
    path: "stations/<source>.parquet",
    example: "stations/rws.parquet",
    title: "Source station lists",
    description:
      "One source's list as ingest keeps it: every station it has listed but withheld ones. `history/stations/<source>/<time>.parquet` holds each refresh's previous list in the layout of its time.",
    columns: [
      ...STATION_COLUMNS.filter((c) => !NOT_IN_LISTS.has(c.name)),
      EPOCHS,
      {
        name: "extra",
        type: "VARCHAR",
        description:
          "The source's own fields for the station, and `source_qc_start` and `source_qc_start_inferred` once the adapter has asked, as a JSON object.",
      },
    ],
    sort: ["id"],
  },
  offsets: {
    path: "stations/offsets.parquet",
    example: "stations/offsets.parquet",
    title: "Datum offsets",
    description:
      "Meters to add to a level in each station's epoch to refer it to each datum, with `to_current` already applied. It carries no terms of its own: join it to `stations.parquet` for `commercial_use` and `datums_attribution`.",
    columns: [
      {
        name: "station",
        type: "VARCHAR",
        description: "The station's `id` in `stations.parquet`.",
      },
      {
        name: "epoch",
        type: "INTEGER",
        description: "The datum epoch whose levels the offset applies to, its `id` in `epochs`.",
      },
      {
        name: "datum",
        type: "VARCHAR",
        description:
          "The datum the offset refers levels to, such as `NHN`, `MSL`, `LAT` or `MLLW`.",
      },
      {
        name: "offset_m",
        type: "DOUBLE",
        description: "Meters to add to a level in the epoch's files to refer it to `datum`.",
      },
    ],
    sort: ["station", "epoch", "datum"],
  },
  links: {
    path: "stations/links.parquet",
    example: "stations/links.parquet",
    title: "Linked series offsets",
    description:
      "Offsets measured once a month between linked stations within 1 km that share no reference datum.",
    columns: [
      {
        name: "a",
        type: "VARCHAR",
        description:
          "One station of the pair, its `id` in `stations.parquet`. It sorts before `b`.",
      },
      { name: "b", type: "VARCHAR", description: "The other station of the pair." },
      {
        name: "a_epoch",
        type: "INTEGER",
        description: "The datum epoch of `a` whose levels were measured.",
      },
      {
        name: "b_epoch",
        type: "INTEGER",
        description: "The datum epoch of `b` whose levels were measured.",
      },
      {
        name: "since",
        type: "TIMESTAMPTZ",
        description: "The start of the window measured, in UTC.",
      },
      {
        name: "until",
        type: "TIMESTAMPTZ",
        description:
          "The end of the window measured, in UTC, exclusive: the earliest of the end of the year measured, the end of either station's epoch, and one sampling interval (the source's `interval_s`, or a minute) after the last value either station holds. A row measured before November 2026 and not replaced since ends at the last value itself.",
      },
      {
        name: "hours",
        type: "INTEGER",
        description: "How many hours the offset is the median of, at least 30 days' worth.",
      },
      {
        name: "offset_m",
        type: "DOUBLE",
        description:
          "The median of `b`'s level less `a`'s, in meters, each in its own epoch's datum. Add it to a level of `a` to refer it to `b`'s datum.",
      },
      {
        name: "spread_m",
        type: "DOUBLE",
        description:
          "How far the medians of the measured months range, in meters, over months with at least 10 days.",
      },
    ],
    sort: ["a", "b"],
  },
  matches: {
    path: "stations/matches.parquet",
    example: "stations/matches.parquet",
    title: "Level matches",
    description:
      "Pairs of stations within 10 km, and every linked pair, compared once a month by their hourly levels. Publish links a pair whose levels agree within 1 cm.",
    columns: [
      {
        name: "a",
        type: "VARCHAR",
        description:
          "One station of the pair, its `id` in `stations.parquet`. It sorts before `b`.",
      },
      { name: "b", type: "VARCHAR", description: "The other station of the pair." },
      {
        name: "since",
        type: "TIMESTAMPTZ",
        description: "The start of the window compared, in UTC: the first of the years compared.",
      },
      {
        name: "until",
        type: "TIMESTAMPTZ",
        description: "The end of the window compared, in UTC, exclusive.",
      },
      {
        name: "months",
        type: "INTEGER",
        description:
          "How many months both stations hold at least 15 days of the same hours in, while `a`'s levels move by 5 cm (a standard deviation); at least 6.",
      },
      {
        name: "hours",
        type: "INTEGER",
        description:
          "How many hours both stations hold a good or preliminary value at, in those months.",
      },
      {
        name: "rms_m",
        type: "DOUBLE",
        description:
          "The median of the months' RMS difference between the two, in meters, once each month's mean difference is removed. Under 0.01 is one gauge recorded twice.",
      },
      {
        name: "lag_h",
        type: "INTEGER",
        description:
          "Hours, from -2 to 2, to add to `b`'s times that agree best; 0 unless one halves `rms_m`. Another value is likely a clock error in one of them.",
      },
      {
        name: "lag_rms_m",
        type: "DOUBLE",
        description: "`rms_m` with `b`'s times moved by `lag_h`.",
      },
    ],
    sort: ["a", "b"],
  },
  years: {
    path: "stations/years/<source>.parquet",
    example: "stations/years/rws.parquet",
    title: "Year files",
    description:
      "One row per year file of observed levels under `obs/`, in every epoch. A row with no `epoch` or `year` marks a station whose rows may be out of date.",
    columns: [
      { name: "id", type: "VARCHAR", description: "The station's `id` in `stations.parquet`." },
      {
        name: "epoch",
        type: "INTEGER",
        nullable: true,
        description:
          "The datum epoch whose files hold the year, 1 for the plain path; null in a mark.",
      },
      {
        name: "year",
        type: "INTEGER",
        nullable: true,
        description: "The UTC year; null in a mark.",
      },
      {
        name: "hours",
        type: "INTEGER",
        nullable: true,
        description: "How many UTC hours hold at least one value, of any flag.",
      },
      ...FLAG_COUNTS.map((name, flag): Column => ({
        name,
        type: "INTEGER",
        nullable: true,
        description: `How many values have \`flag\` ${flag}.`,
      })),
      {
        name: "version",
        type: "VARCHAR",
        nullable: true,
        description:
          "A hash of the file's rows, which changes when any row's `time`, `level_m`, `flag`, `source_flag` or `received` does, and only then.",
      },
    ],
    sort: ["id", "epoch NULLS FIRST", "year NULLS FIRST"],
  },
  analysis: {
    path: "stations/analysis/<source>.parquet",
    example: "stations/analysis/rws.parquet",
    title: "Station analysis",
    description:
      "What the store measures from each station's levels, one row per station it has judged.",
    columns: [
      { name: "id", type: "VARCHAR", description: "The station's `id` in `stations.parquet`." },
      { name: "analyzed", type: "TIMESTAMPTZ", description: "When the station was last judged." },
      {
        name: "rules",
        type: "VARCHAR",
        description: "The version of the QC rules the verdict was judged under.",
      },
      {
        name: "judge",
        type: "VARCHAR",
        nullable: true,
        optional: true,
        description:
          "The version of the judgment that set `tidal`; null or missing where written before it was kept.",
      },
      {
        name: "tidal",
        type: "BOOLEAN",
        nullable: true,
        description: "Whether the station's levels carry a tide; null where its values can't say.",
      },
      {
        name: "tide_m",
        type: "DOUBLE",
        nullable: true,
        description: "The amplitudes of M2 and O1 added, in meters.",
      },
      {
        name: "days",
        type: "INTEGER",
        nullable: true,
        description: "Days of the last year with usable values.",
      },
      {
        name: "drains",
        type: "INTEGER",
        nullable: true,
        description:
          "Runs of the last year that a tide gauge's flatline rules flag and still water's don't.",
      },
      {
        name: "step_s",
        type: "INTEGER",
        nullable: true,
        // A file written before it was kept has no such column.
        optional: true,
        description:
          "The most common step between the last year's values, in seconds; null with under two values, or in a row judged before it was kept.",
      },
      {
        name: "sea_level",
        type: "VARCHAR",
        nullable: true,
        // A file written before it was kept has no such column.
        optional: true,
        description:
          "What the 10 m sea-level check read from the station's list when it was judged: `datum` and its gauge zero's height in meters above a sea-level datum, `ground` and its ground's altitude where it has no such offset, or null where it had neither. A station whose list gives something else is judged again.",
      },
      {
        name: "requalified",
        type: "TIMESTAMPTZ",
        nullable: true,
        description:
          "When the station's stored years were last requalified under its verdict; null while a change waits for it.",
      },
    ],
    sort: ["id"],
  },
  recent: {
    path: "recent/<source>.parquet",
    example: "recent/rws.parquet",
    title: "Recent levels",
    description:
      "The last 7 days of observed levels from a source's live stations, refreshed hourly.",
    columns: [
      {
        name: "station",
        type: "VARCHAR",
        description: "The station's `id` in `stations.parquet`.",
      },
      TIME,
      { ...LEVEL("level"), description: "The level in meters, in the epoch's datum." },
      FLAG,
      SOURCE_FLAG,
      RECEIVED,
      {
        name: "epoch",
        type: "INTEGER",
        optional: true,
        description:
          "The datum epoch the value belongs to; rows from different epochs are in different datums.",
      },
    ],
    sort: ["station", "time"],
  },
  obs: {
    path: `obs/${SERIES_PATH}`,
    example: "obs/rws/hoekvanholland/2024.parquet",
    title: "Observed levels",
    description: `A station's observed levels for one UTC year. ${SERIES_NOTE}`,
    columns: OBSERVATION_COLUMNS,
    sort: ["time"],
  },
  extremes: {
    path: `extremes/${SERIES_PATH}`,
    example: "extremes/rws/hoekvanholland/2024.parquet",
    title: "Observed extremes",
    description: `The source's observed high and low waters for one UTC year. ${SERIES_NOTE}`,
    columns: [...EXTREME_COLUMNS("observed"), DATUM],
    sort: ["time"],
  },
  predictions: {
    path: `predictions/${SERIES_PATH}`,
    example: "predictions/rws/hoekvanholland/2024.parquet",
    title: "Predicted levels",
    description: `The source's predicted curve for one UTC year. ${SERIES_NOTE}`,
    columns: [
      TIME,
      LEVEL("predicted level"),
      FLAG,
      SOURCE_FLAG,
      {
        ...RECEIVED,
        description:
          "Always null: predictions are fetched in bulk, never as they come in; missing from some older files.",
      },
      DATUM,
    ],
    sort: ["time"],
  },
  "predicted-extremes": {
    path: `predicted-extremes/${SERIES_PATH}`,
    example: "predicted-extremes/bsh/506P/2026.parquet",
    title: "Predicted extremes",
    description: `The source's predicted high and low waters for one UTC year. ${SERIES_NOTE}`,
    columns: [
      ...EXTREME_COLUMNS("predicted"),
      {
        name: "transit",
        type: "INTEGER",
        optional: true,
        description:
          "BSH's number for the lunar transit the high or low water follows; only in BSH's files.",
      },
      {
        name: "event",
        type: "UTINYINT",
        optional: true,
        description:
          "Which one it is after that transit: 1 high water after the upper transit, 2 low water after it, 3 high water after the lower, 4 low water after it; only in BSH's files.",
      },
      DATUM,
    ],
    sort: ["time"],
  },
} satisfies Record<string, ParquetFile>;

export type FileName = keyof typeof FILES;

/** A file's columns as `{ name: type }`, as DuckDB's `read_json` takes them. */
export function columnTypes(file: ParquetFile): Record<string, string> {
  return Object.fromEntries(file.columns.map((c) => [c.name, c.type]));
}

/** A JSON Schema (draft 2020-12), in the subset `jsonProblems` checks. */
export type JsonSchema = {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  /** Valid when it fits at least one of these. */
  anyOf?: JsonSchema[];
};

const nullable = (type: string) => [type, "null"];

export const SOURCES_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://stillwell.openwaters.io/sources.schema.json",
  title: "sources.json",
  description: "Each source in the store, with its terms and where to report an error in its data.",
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "name",
      "url",
      "license",
      "attribution",
      "contact",
      "finalizes",
      "stations",
      "backfill",
    ],
    properties: {
      id: { type: "string", description: "The source's ID, as in each station's `source`." },
      name: { type: "string", description: "The agency or service's name." },
      url: { type: "string", description: "The source's page." },
      license: {
        type: "object",
        description: "The source's terms.",
        additionalProperties: false,
        required: ["id", "name", "url", "commercial_use", "redistribution"],
        properties: {
          id: { type: "string", description: "An SPDX identifier, or the source's own name." },
          name: { type: "string", description: "The license's name." },
          url: { type: "string", description: "The license's text." },
          commercial_use: {
            type: "boolean",
            description:
              "True only where the source's terms and every one of its stations, inactive ones too, allow commercial use; read each station's own `commercial_use`.",
          },
          redistribution: {
            type: "boolean",
            description: "Whether the terms let anyone republish the data.",
          },
        },
      },
      attribution: { type: "string", description: "The credit the source's data requires." },
      contact: {
        type: "object",
        description: "Where to report an error in the source's data: a mailbox, a form, or both.",
        additionalProperties: false,
        properties: {
          email: { type: nullable("string"), description: "The agency's published mailbox." },
          url: { type: nullable("string"), description: "The agency's contact page." },
        },
        anyOf: [
          { required: ["email"], properties: { email: { type: "string" } } },
          { required: ["url"], properties: { url: { type: "string" } } },
        ],
      },
      terms: {
        type: nullable("string"),
        description:
          "Anything a user of the data should know about the source's conditions of use. Stillwell changes every source's data the same way: levels in meters, times in UTC, values the source marks missing left out, and a quality flag on each value. A value the source marks bad is flagged `bad` or left out, as the source's README says. The source's README and errata describe any other change.",
      },
      finalizes: {
        type: "boolean",
        description:
          "Whether values the source publishes as preliminary become final later. Where false, `preliminary` values stay so.",
      },
      stations: { type: "integer", description: "How many active stations the source has." },
      backfill: {
        type: nullable("object"),
        description:
          "How much of the source's history the store has, from `stations.parquet`'s `missing_years`; null where that isn't known.",
        additionalProperties: false,
        required: ["since", "complete", "incomplete"],
        properties: {
          since: {
            type: nullable("integer"),
            description:
              "The first UTC year any of the source's stations has a file of levels for; null before it has one.",
          },
          complete: {
            type: "integer",
            description:
              "How many stations with levels, active or not, have every year from `since` on, or a source's answer that it has none.",
          },
          incomplete: {
            type: "integer",
            description:
              "How many stations with levels have a year in `missing_years`. A station a run is writing, whose `missing_years` is null, is in neither count.",
          },
        },
      },
    },
  },
};

export const ERRATA_SCHEMA: JsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://stillwell.openwaters.io/errata.schema.json",
  title: "errata.json",
  description: "Errors found in what sources publish, and what the store does about them.",
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: [
      "id",
      "source",
      "stations",
      "since",
      "until",
      "error",
      "handling",
      "response",
      "evidence",
      "reported",
      "report",
      "url",
    ],
    properties: {
      id: {
        type: "string",
        description: "The erratum's ID, `<source>-<what>`, such as `uhslc-hong-kong-hour-early`.",
      },
      source: { type: "string", description: "The source that publishes the error." },
      stations: {
        type: nullable("array"),
        items: { type: "string" },
        description:
          "The station IDs known to be affected; null for every station of the source. It can be partial or empty, and `error` says so.",
      },
      since: {
        type: nullable("string"),
        format: "date",
        description: "The first UTC day of values the error is in; null for an open start or none.",
      },
      until: {
        type: nullable("string"),
        format: "date",
        description:
          "The UTC day after the last day of values the error is in; null for an open end or none.",
      },
      error: { type: "string", description: "What the source publishes wrong." },
      handling: {
        type: "string",
        enum: ["corrected", "flagged", "dropped", "refused", "avoided", "kept"],
        description: "What the store does about it.",
      },
      response: {
        type: "string",
        description: "What the store does about it, in a sentence or two.",
      },
      evidence: {
        type: nullable("string"),
        description: "How the error was found and how sure it is, in Markdown.",
      },
      reported: {
        type: nullable("string"),
        format: "date",
        description: "The day the error was first reported to the agency; null until then.",
      },
      report: {
        type: nullable("string"),
        description: "Where the report went and what the agency answered.",
      },
      url: {
        type: "string",
        description: "The file in the Stillwell repository that holds the entry.",
      },
    },
  },
};

/** The JSON files the store publishes, by path, with their schemas. */
export const JSON_FILES: Record<string, JsonSchema> = {
  "sources.json": SOURCES_SCHEMA,
  "errata.json": ERRATA_SCHEMA,
};

/**
 * What in `value` breaks `schema`, by JSON path; none when it fits. Checks
 * only the keywords `JsonSchema` has, which are all these schemas use.
 */
export function jsonProblems(schema: JsonSchema, value: unknown, at = "$"): string[] {
  const kind =
    value === null
      ? "null"
      : Array.isArray(value)
        ? "array"
        : Number.isInteger(value)
          ? "integer"
          : typeof value;
  const types = schema.type === undefined ? [] : [schema.type].flat();
  if (types.length && !types.some((t) => t === kind || (t === "number" && kind === "integer")))
    return [`${at}: ${kind}, not ${types.join(" or ")}`];
  const problems: string[] = [];
  if (schema.anyOf && schema.anyOf.every((s) => jsonProblems(s, value, at).length))
    problems.push(`${at}: fits none of its ${schema.anyOf.length} forms`);
  if (schema.enum && !schema.enum.includes(value))
    problems.push(`${at}: ${JSON.stringify(value)} isn't one of ${schema.enum.join(", ")}`);
  if (
    schema.format === "date" &&
    typeof value === "string" &&
    !(
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      new Date(Date.parse(`${value}T00:00:00Z`) || 0).toISOString().startsWith(value)
    )
  )
    problems.push(`${at}: ${value} isn't a date`);
  if (kind === "array" && schema.items)
    (value as unknown[]).forEach((v, i) =>
      problems.push(...jsonProblems(schema.items!, v, `${at}[${i}]`)),
    );
  if (kind === "object") {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? [])
      if (!(key in object)) problems.push(`${at}: no ${key}`);
    for (const [key, v] of Object.entries(object)) {
      const property = schema.properties?.[key];
      if (property) problems.push(...jsonProblems(property, v, `${at}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${at}: unexpected ${key}`);
    }
  }
  return problems;
}

/** A Frictionless Table Schema field type for a DuckDB type. */
function fieldType(type: string): string {
  if (type.endsWith("[]")) return "array";
  if (/^(MAP|STRUCT)\(/.test(type)) return "object";
  if (type === "TIMESTAMPTZ") return "datetime";
  if (type === "DATE") return "date";
  if (type === "BOOLEAN") return "boolean";
  if (/^(FLOAT|DOUBLE)$/.test(type)) return "number";
  if (/INT$/.test(type) || type === "INTEGER") return "integer";
  return "string";
}

function field(c: Column): object {
  return {
    name: c.name,
    type: fieldType(c.type),
    description: c.description,
    duckdbType: c.type,
    ...(c.nullable || c.optional ? {} : { constraints: { required: true } }),
    ...(c.optional ? { optional: true } : {}),
    ...(c.fields ? { fields: c.fields.map(field) } : {}),
  };
}

/**
 * `datapackage.json`: a Frictionless Data Package (v2) with a resource per
 * file. A file with a `<placeholder>` in its path has its `example` as `path`
 * and its pattern as `pattern`. Beside the Table Schema properties, each field
 * has `duckdbType`, the type written, and `optional` where a file can lack it,
 * and a list of structs has its `fields`. A JSON file has its JSON Schema's
 * path as `jsonSchema`, since a resource's `schema` is a Table Schema.
 */
export function dataPackage(): object {
  return {
    $schema: "https://datapackage.org/profiles/2.0/datapackage.json",
    name: "stillwell",
    title: "Stillwell",
    description:
      "Observed and predicted water levels from tide and river gauges, from each source's own service.",
    homepage: "https://github.com/openwatersio/stillwell",
    resources: [
      ...Object.entries(FILES).map(([name, f]) => ({
        name,
        title: f.title,
        description: f.description,
        path: f.example,
        ...(f.path === f.example ? {} : { pattern: f.path }),
        format: "parquet",
        mediatype: "application/vnd.apache.parquet",
        type: "table",
        sort: f.sort,
        schema: {
          $schema: "https://datapackage.org/profiles/2.0/tableschema.json",
          fields: f.columns.map(field),
        },
      })),
      ...Object.entries(JSON_FILES).map(([path, schema]) => ({
        name: path.replace(/\.json$/, ""),
        title: schema.title,
        description: schema.description,
        path,
        format: "json",
        mediatype: "application/json",
        jsonSchema: path.replace(/\.json$/, ".schema.json"),
      })),
    ],
  };
}
