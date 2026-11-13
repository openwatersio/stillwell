# Using the Stillwell store

Every public series in the store is Parquet at `https://stillwell.openwaters.io/`, readable without an account by DuckDB, Polars, pandas or anything else that reads Parquet over HTTPS. It holds what each source lets anyone republish, with `commercial_use` false on the stations whose terms bar commercial use, and on those of a source whose permission to republish has been asked for and not yet given. The [README](../README.md#license) has the license, and each source's README has its own terms.

The store holds every source's station list and the year files backfilled so far; `stations/years/<source>.parquet` lists which years each series has. Scheduled ingest refreshes `recent/` every hour and folds each day into the year files at 00:45 UTC. The [DMI](../src/sources/dmi/README.md) adapter isn't registered, so DMI isn't in the store, and [issues labeled `source`](https://github.com/openwatersio/stillwell/issues?q=is%3Aissue%20state%3Aopen%20label%3Asource) track the sources still to come.

## Layout

```
stations.parquet                                      one row per station
sources.json                                          license, attribution, contact and `finalizes` per source
errata.json                                           errors in what sources publish, and what the store does about them
stations/offsets.parquet                              meters to add to a level in each station's epoch to refer it to each datum: station, epoch, datum, offset_m
stations/links.parquet                                offsets measured between linked series' levels, once a month: a, b, a_epoch, b_epoch, since, until, hours, offset_m, spread_m
stations/<source>.parquet                             one source's list, as ingest keeps it
stations/years/<source>.parquet                       every year file of observed levels: id, epoch, year, hours, values by flag, version
stations/analysis/<source>.parquet                    what the store measures from each station's levels, such as whether they carry a tide
history/stations/<source>/<time>.parquet, .json       each refresh's previous list, and what it changed
recent/<source>.parquet                               last 7 days: station, time, level_m, flag, source_flag, received, epoch
obs/<source>/<station>/<year>.parquet                 observed levels: time, level_m, flag, source_flag, received, datum
extremes/<source>/<station>/<year>.parquet            the source's observed high and low waters: time, level_m, type, flag, datum
predictions/<source>/<station>/<year>.parquet         the source's predicted curve: time, level_m, flag, source_flag, received, datum
predicted-extremes/<source>/<station>/<year>.parquet  the source's predicted high and low waters: time, level_m, type, flag[, transit, event], datum
```

[stations.md](stations.md#store-layout) describes the files ingest keeps for itself beside these.

- **`<station>`** is the station's `source_id` from `stations.parquet`, URL-encoded. A station's `id` is `<source>/<source_id>`, such as `rws/hoekvanholland`, so the path is the `id` with the product in front.
- **Datum epochs.** When a source moves a station to another reference, its later values go to files of their own, with the epoch's number after `<station>`: `obs/<source>/<station>/2/<year>.parquet`. Epoch 1 is the plain path, and `recent` rows say their epoch in its `epoch` column; rows from different epochs are in different datums. Most stations have one epoch; [Datum epochs](#datum-epochs) below shows how to read across several.
- **`time`** is UTC, as `TIMESTAMPTZ`. Set your session to UTC (`SET TimeZone = 'UTC'`) or tools such as pandas show it in your local zone.
- **`level_m`** is meters in the file's `datum`, which is the same on every row and matches its epoch's `datum` in `stations.parquet`.
- **`flag`** runs from best to worst: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad. Source flags fold into these, and quality control only ever marks a value suspect or bad, so `flag` is never better than `source_flag`. QC works `flag` out from `source_flag` and the store's rules, so a value a rule no longer flags is clear again once the store reruns QC over it, which it does for the values it fetches, and for stored years after a rule changes, when the Monthly workflow's `analyze --requalify` reaches the station. A value without a `source_flag` that QC marked suspect or bad keeps its mark. `flag <= 2` keeps everything not flagged as a problem. A `preliminary` value is one the source hasn't checked. Two signals mark the ones it never will: every `preliminary` value from a source whose `finalizes` is false in `sources.json`, and values from before a station's `source_qc_start`, which the source states or the store infers from its flags. Those have passed only the store's QC, and stay `preliminary`; such a source can still revise a value, which reaches the store only when ingest fetches it again. Elsewhere a `preliminary` value may be checked later, and the Monthly refetch reads the last three years again for it, but some never are, without a sign. Each source's README says how it marks checked values.
- **`source_flag`** is the source's own flag on the same scale, before quality control, so a value the source verified (0 or 1) still shows as verified where QC marked it suspect. The store can mark a span worse than its source does without changing `source_flag`, as an erratum in [`errata.json`](https://stillwell.openwaters.io/errata.json) can, so read `flag` to skip what shouldn't be used. Where a source doesn't mark which values it has checked, its adapter decides, as its README says. `source_flag` is null in predictions and in some older values, and some older files don't have the column. Where such a value's flag is better than suspect, it's the source's, and rerunning QC fills it in; a suspect or bad one may be QC's, so it stays null.
- **`received`** is when ingest first saw a value arrive. It's empty for backfilled history.
- **`type`** is `high` or `low`. A source can give both lows of a double low water, so two lows can come in a row. BSH's predicted extremes also carry its `transit` number and `event` index.

## Stations

A station is one source's series at one place; a gauge is the instrument, and `same_as` links stations that share one. Cuxhaven, for example, is `pegelonline/5990020` for observed levels and `bsh/506P` for predictions.

`stations.parquet` has one row per station:

- **`id`**, **`source`** and **`source_id`**: the station's ID, `<source>/<source_id>`, and its parts.
- **`name`**, **`lat`**, **`lon`** and **`country_code`**: as the source gives them, or as `POSITIONS` ([`src/positions.ts`](../src/positions.ts)) corrects them where a source places a station away from its gauge.
- **`kind`**: `coastal`, `estuary`, `lake` or `river`, from the source or from `KINDS` ([`src/kinds.ts`](../src/kinds.ts)), and null where neither says.
- **`interval_s`**: the station's usual interval between values, in seconds.
- **`datum`**: what levels are measured from, in the source's own name for it, such as `NAP`, `PNP` (gauge zero) or `STND` (CO-OPS station datum). Each source's README lists its datums.
- **`datums`**: meters to add to a level in `datum` to refer it to each other datum: those the source publishes, and MSL, LAT and chart datum from slackwater-database or another series of the gauge. Both describe the station's current epoch; an earlier epoch's levels need its own `datums`, or `to_current` first (see [Datum epochs](#datum-epochs)), or read `stations/offsets.parquet`, which has done that.
- **`datums_source`**: where each of `datums` came from. `source` is the source's own offset. `slackwater-database` is the station's own record in slackwater-database, joined by the source's station ID (or, for TICON's RWS and SMHI records, through [ticon-inventory.csv](ticon-inventory.csv)) within 10 km, when the record's datums are measured from the same zero as the station's levels: NOAA's STND, Kartverket's chart datum, a GESLA file's gauge zero, or NAP and RH 2000 for TICON's RWS and SMHI records, unless the store's copy of the GESLA file names another zero, as a few of RWS's offshore files do. Where several records join a station, the one whose datums can be used, then an accepted one, then the latest reduction, gives all of them, so values are never mixed from two records. It replaces the source's MSL, LAT and chart datum, and publish reports any that differ by more than 5 cm. A record whose terms bar commercial use serves only a station whose terms do too. `computed` is carried from another station of the gauge (`same_as`) through a reference both give an offset to: a national height system (NAP, NHN, NN, HN, NGVD29, RH 2000, ordnance datum, or NAVD88 with its realization) or Admiralty Chart Datum, which is fixed at each UK port. That's how a PEGELONLINE gauge gets BSH's SKN through NHN, and an EA gauge BODC's chart datum through ordnance datum. Between two stations within 1 km that share no reference, offsets are carried through the offset measured between their levels instead (`stations/links.parquet`, below), which is how a PEGELONLINE gauge gets MSL and LAT from WSV's or UHSLC's file of it in GESLA, and that GESLA file gets SKN back from PEGELONLINE. MSL, LAT and other tidal datums are carried only between stations within 1 km of each other, since they change along an estuary; SKN and chart datum CD hold for a whole stretch and carry along any link. Nothing is carried from a station whose terms bar commercial use to one whose terms allow it. A record slackwater-database keeps in the constituent frame (MSL = 0), or rejects for anything but being another record's copy, gives nothing, nor does one whose reduction period overlaps an epoch that doesn't convert to the current one, or converts by more than 5 cm, since its datums would then mix two references by more than that. RWS's 2005 revision of NAP moved most Dutch gauges by up to 3 cm, so datums reduced across it can be off by up to that much.
- **`datums_epoch`**: the period each tidal datum in `datums` was reduced over, as `start` and `end` dates, where slackwater-database says, or where the source does: CO-OPS's datum analysis periods, from the earliest date they give to the latest, which also dates the values slackwater-database's NOAA records give for the same station. A carried tidal datum keeps its period, so it isn't carried to a station with an epoch in that period that doesn't convert. Empty, or without the key, for other sources' own offsets and for height systems.
- **`datums_attribution`**: the credits owed for any `slackwater-database` or `computed` offsets: slackwater-database's for each record behind them, such as TICON-4's citation, and the `attribution` of each linked station an offset was carried from, such as BSH's for SKN at a PEGELONLINE gauge. Show them with those offsets wherever they're shown, beside `attribution`, including offsets read from `stations/offsets.parquet`, which carries no credits or terms of its own, so join it to `stations.parquet` for `commercial_use` too. Empty where `datums` holds only the source's own.
- **`chart_datum`**: the datum charts use at the station, such as `MLLW`, `LAT`, `SKN` or `CD`: slackwater-database's choice where it has a record, otherwise the source's own or one carried from a linked station, such as BSH's SKN at a PEGELONLINE gauge. Null when the station has no offset to one. A level's default datum is `chart_datum`, or `datum` when it's null.
- **`frame`**: `gauge` when the chart-datum offset is from the slackwater-database record that `tide_station` names, so levels line up with that station's predictions; `source` when it's the source's, computed, or from another record of the gauge; `unknown` with no `chart_datum`, or where the `tide_station`'s datums are in the constituent frame (MSL = 0), so its predictions can't be compared with levels in absolute terms.
- **`epochs`**: each span over which the station's levels share one reference (see [Datum epochs](#datum-epochs)).
- **`products`**: which of `levels`, `extremes`, `predictions` and `predicted_extremes` the station has.
- **`first`** and **`last`**: the station's first and last observation, over all its epochs, from the bounds compaction and backfill write. `stations.parquet` is rebuilt after compaction each night, so they usually trail the store by about a day, and are null for a station with no observations yet.
- **`same_as`**: other stations for the same physical gauge, such as a BSH prediction gauge and its PEGELONLINE series, or a UHSLC copy of a CO-OPS gauge. A CRMS site's series are linked as one gauge too, though CPRA moved it and numbered each position anew, so the earlier series hold years the later ones don't. [stations.md](stations.md#gauges-in-more-than-one-source) says how they're matched.
- **`preferred`**: the station to use for the gauge's observed levels among this one and its `same_as`; the station's own `id` when it's the one, or when it has no links. `WHERE preferred = id` gives one station per gauge; for a gauge's whole record, read its `same_as` too, which can hold years the preferred series doesn't, such as a CRMS site's earlier series or GESLA's copy from before an originator's series starts. Among a gauge's stations with observed levels, it picks one whose terms allow commercial use where there is one. A record's length counts only its share of values not flagged suspect or bad, from its source's years file, so a long record of flagged values doesn't outrank a shorter clean one. It can pick an inactive station, so filter on `status` after picking, not before, or the gauge drops out. [stations.md](stations.md#gauges-in-more-than-one-source) has the order.
- **`tide_station`**: the slackwater-database station for the gauge: the station's own record, or the accepted record that replaces a copy slackwater-database rejected as a duplicate, or else the one linked to the station's `preferred` series or another of its `same_as`.
- **`errata`**: the errors found in what the source publishes for this station, by ID, such as UHSLC's Hong Kong heights stamped an hour early. [`errata.json`](https://stillwell.openwaters.io/errata.json) has each one: which stations and span of values it's in, what's wrong, whether the store corrected, flagged, dropped, refused, avoided or kept them, the evidence, when it was reported to the agency and what it answered, and a link (`url`) to the file in this repository that holds it.
- **`source_qc_start`**: where the source's quality checks of the station's values start, as a UTC time, or null where none is known. Null means unknown. It doesn't mean the source never checks the station's values, or that it has checked them all: its `preliminary` values may be checked later or never. The source won't check the `preliminary` values before it, so they won't change. `flag <= 2 AND time < source_qc_start` gives that history where it passed the store's QC. A source's README says where its dates come from.
- **`source_qc_start_inferred`**: whether the store inferred `source_qc_start` from the source's flags (true) or the source stated it (false). Null without a `source_qc_start`, or with one the station refresh hasn't read yet. Add `AND source_qc_start_inferred = false` to keep to stated dates. An inferred date is the store's reading of the flags, worked out once and kept, and backfill doesn't fetch the years before it again.
- **`tidal`**: whether the station's levels carry a tide, measured from its last year in the store: true where M2's and O1's amplitudes add to 8 cm or more (`tide_m`), with exceptions for water well above sea level and for creeks that drain to a sill. Null where its values can't say, or before its first analysis. It's measured, not taken from `kind`: a river can be tidal, and the Baltic isn't. QC's flatline, outlier, held-level and residual-jump rules follow it. [stations.md](stations.md#analysis) has the rules.
- **`tide_m`**: the lunar tide `tidal` is judged by, M2's and O1's amplitudes added, in meters, fitted over the station's last year of usable values. Null where they span under 30 days or are sampled too coarsely to fit, and before the station's first analysis.
- **`status`**: `active` or `inactive`. A station the source stops listing stays, inactive, and an adapter marks inactive a station its source lists as ended, such as a CO-OPS station with a `removed` date that's off the current network. An inactive station's history stays in the store.
- **`live`**: whether hourly ingest polls the station into `recent/`.
- **`min_interval_s`**: how often the source lets ingest ask for the station, in seconds, where it says.
- **`source_url`**: the station's page at its source.
- **`commercial_use`**, **`license`** and **`attribution`**: the station's terms. `license` is its source's; where a contributor's own terms apply, as at some UHSLC and GESLA records, `commercial_use` follows them and `attribution` adds the contributor's credit.

The examples below use the DuckDB CLI (`brew install duckdb`), and each one reads straight from the store.

How many stations each source has, and in which datums:

```sql
SELECT source, count(*) AS stations, string_agg(DISTINCT datum, ', ' ORDER BY datum) AS datums
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE status = 'active'
GROUP BY source ORDER BY source;
```

```
┌──────────────────┬──────────┬──────────────────────┐
│      source      │ stations │        datums        │
├──────────────────┼──────────┼──────────────────────┤
│ bodc             │ 42       │ CD                   │
│ bsh              │ 172      │ PNP, SKN             │
│ cdec             │ 35       │ GZ, NAVD88           │
│ coops            │ 332      │ STND                 │
│ crms             │ 383      │ NAVD88               │
│ dwr              │ 46       │ GZ, NAVD88           │
│ ea               │ 43       │ AOD, CD              │
│ gesla            │ 6656     │ ZERO                 │
│ jma              │ 70       │ DL                   │
│ kartverket       │ 33       │ CD                   │
│ marine-institute │ 23       │ ODM, ZERO            │
│ pegelonline      │ 692      │ NN, PNP              │
│ refmar           │ 173      │ ZH, ZI               │
│ rws              │ 664      │ MSL, NAP             │
│ sfwmd            │ 37       │ NAVD88               │
│ smhi             │ 60       │ RH2000               │
│ uhslc            │ 741      │ ZERO                 │
│ usace            │ 1353     │ GZ                   │
│ usgs             │ 13972    │ GAGE, NAVD88, NGVD29 │
└──────────────────┴──────────┴──────────────────────┘
```

A gauge by name, with its links to other sources:

```sql
SELECT id, products, preferred
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE name ILIKE '%cuxhaven%'
ORDER BY id;
```

```
┌──────────────────────────────────────────┬───────────────────────────────────┬─────────────────────┐
│                    id                    │             products              │      preferred      │
├──────────────────────────────────────────┼───────────────────────────────────┼─────────────────────┤
│ bsh/506P                                 │ [predictions, predicted_extremes] │ pegelonline/5990020 │
│ gesla/cuxhaven-825-deu-uhslc_fd          │ [levels]                          │ pegelonline/5990020 │
│ gesla/cuxhaven-825a-deu-uhslc_rq         │ [levels]                          │ pegelonline/5990020 │
│ gesla/cuxhaven_steubenhoft-cux-deu-bfg   │ [levels]                          │ pegelonline/5990020 │
│ gesla/cuxhavensteubenhft-5990020-deu-wsv │ [levels]                          │ pegelonline/5990020 │
│ gesla/cuxhaventg-cux-deu-cmems           │ [levels]                          │ pegelonline/5990020 │
│ pegelonline/5990020                      │ [levels]                          │ pegelonline/5990020 │
│ uhslc/825                                │ [levels]                          │ pegelonline/5990020 │
└──────────────────────────────────────────┴───────────────────────────────────┴─────────────────────┘
```

One station per gauge, so a map or a count doesn't show a gauge once for each source that carries it:

```sql
SELECT count(*) AS gauges
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE list_contains(products, 'levels') AND preferred = id;
```

The nearest gauges with observed levels to a point, here the mouth of the Nieuwe Waterweg:

```sql
SELECT id, name,
  round(6371 * acos(least(1,
    sin(radians(lat)) * sin(radians(51.98)) +
    cos(radians(lat)) * cos(radians(51.98)) * cos(radians(lon - 4.12)))), 2) AS km
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE status = 'active' AND list_contains(products, 'levels') AND preferred = id
ORDER BY km LIMIT 5;
```

```
┌──────────────────────────────────────┬─────────────────────────────────┬──────┐
│                  id                  │              name               │  km  │
├──────────────────────────────────────┼─────────────────────────────────┼──────┤
│ gesla/hoekvanhollandtg-hoe-nld-cmems │ HoekVanHollandTG                │ 0.0  │
│ rws/hoekvanholland                   │ Hoek van Holland                │ 0.35 │
│ rws/hoekvanholland.splitsingsdam     │ Hoek van Holland, splitsingsdam │ 0.89 │
│ rws/beerkanaal                       │ Beerkanaal                      │ 1.84 │
│ rws/europoort.dintelhaven            │ Europoort Dintelhaven           │ 2.29 │
└──────────────────────────────────────┴─────────────────────────────────┴──────┘
```

Datum offsets are a map. Add one to a level to convert it:

```sql
SELECT id, datum, datums['NHN'] AS to_nhn_m
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE id IN ('pegelonline/5990020', 'bsh/726A');
```

```
┌─────────────────────┬─────────┬──────────┐
│         id          │  datum  │ to_nhn_m │
│       varchar       │ varchar │  double  │
├─────────────────────┼─────────┼──────────┤
│ bsh/726A            │ SKN     │    -1.92 │
│ pegelonline/5990020 │ PNP     │   -5.033 │
└─────────────────────┴─────────┴──────────┘
```

So a level of 5.00 m above gauge zero at Cuxhaven is 5.00 − 5.033 = −0.033 m in NHN.

## Series

The first values of a year:

```sql
SET TimeZone = 'UTC';
SELECT time, level_m, flag, datum
FROM 'https://stillwell.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
ORDER BY time LIMIT 5;
```

```
┌──────────────────────────┬─────────┬───────┬─────────┐
│           time           │ level_m │ flag  │  datum  │
│ timestamp with time zone │  float  │ uint8 │ varchar │
├──────────────────────────┼─────────┼───────┼─────────┤
│ 2024-01-01 00:00:00+00   │    0.07 │     0 │ NAP     │
│ 2024-01-01 00:10:00+00   │    0.07 │     0 │ NAP     │
│ 2024-01-01 00:20:00+00   │    0.07 │     0 │ NAP     │
│ 2024-01-01 00:30:00+00   │    0.09 │     0 │ NAP     │
│ 2024-01-01 00:40:00+00   │    0.08 │     0 │ NAP     │
└──────────────────────────┴─────────┴───────┴─────────┘
```

Monthly statistics, leaving out values flagged as suspect or bad:

```sql
SELECT date_trunc('month', time) AS month,
  round(avg(level_m), 3) AS mean_m, round(min(level_m), 2) AS min_m,
  round(max(level_m), 2) AS max_m, count(*) AS n
FROM 'https://stillwell.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
WHERE flag <= 2
GROUP BY ALL ORDER BY month LIMIT 4;
```

```
┌──────────────────────────┬────────┬───────┬───────┬───────┐
│          month           │ mean_m │ min_m │ max_m │   n   │
│ timestamp with time zone │ double │ float │ float │ int64 │
├──────────────────────────┼────────┼───────┼───────┼───────┤
│ 2024-01-01 00:00:00+00   │  0.273 │ -0.98 │  2.41 │  4464 │
│ 2024-02-01 00:00:00+00   │  0.258 │ -1.07 │  2.12 │  4176 │
│ 2024-03-01 00:00:00+00   │  0.129 │ -0.99 │  1.97 │  4464 │
│ 2024-04-01 00:00:00+00   │  0.246 │ -0.94 │  1.95 │  4320 │
└──────────────────────────┴────────┴───────┴───────┴───────┘
```

How many values each flag has:

```sql
SELECT flag, count(*) AS n
FROM 'https://stillwell.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
GROUP BY flag ORDER BY flag;
```

```
┌───────┬───────┐
│ flag  │   n   │
│ uint8 │ int64 │
├───────┼───────┤
│     0 │ 52631 │
│     3 │    73 │
└───────┴───────┘
```

The year's highest high waters, as RWS selected them:

```sql
SELECT time, level_m
FROM 'https://stillwell.openwaters.io/extremes/rws/hoekvanholland/2024.parquet'
WHERE type = 'high' ORDER BY level_m DESC LIMIT 3;
```

```
┌──────────────────────────┬─────────┐
│           time           │ level_m │
│ timestamp with time zone │  float  │
├──────────────────────────┼─────────┤
│ 2024-01-15 16:34:00+00   │    2.41 │
│ 2024-12-06 04:19:00+00   │    2.22 │
│ 2024-11-20 16:35:00+00   │    2.21 │
└──────────────────────────┴─────────┘
```

The surge, as observed minus RWS's own prediction, at its largest:

```sql
SELECT o.time, o.level_m AS observed_m, p.level_m AS predicted_m,
  round(o.level_m - p.level_m, 2) AS residual_m
FROM 'https://stillwell.openwaters.io/obs/rws/hoekvanholland/2024.parquet' o
JOIN 'https://stillwell.openwaters.io/predictions/rws/hoekvanholland/2024.parquet' p USING (time)
ORDER BY abs(o.level_m - p.level_m) DESC LIMIT 3;
```

```
┌──────────────────────────┬────────────┬─────────────┬────────────┐
│           time           │ observed_m │ predicted_m │ residual_m │
│ timestamp with time zone │   float    │    float    │   float    │
├──────────────────────────┼────────────┼─────────────┼────────────┤
│ 2024-12-22 11:40:00+00   │       0.75 │        -0.7 │       1.45 │
│ 2024-12-22 11:50:00+00   │       0.73 │       -0.71 │       1.44 │
│ 2024-12-06 09:10:00+00   │       0.89 │       -0.54 │       1.43 │
└──────────────────────────┴────────────┴─────────────┴────────────┘
```

## Reading many files

HTTPS has no directory listing, so wildcards such as `obs/rws/*/2024.parquet` don't work. Build the list of paths, then pass it to `read_parquet`, with `union_by_name = true` when you select `*`, since some older files lack `source_flag`. For several years of one station:

```sql
SET VARIABLE files = (
  SELECT list('https://stillwell.openwaters.io/obs/rws/hoekvanholland/' || y || '.parquet')
  FROM range(2020, 2025) t(y)
);
SELECT count(*) AS n FROM read_parquet(getvariable('files'), union_by_name = true);
```

The same works for many stations, with paths built from `stations.parquet`. A missing file is an error, so list only files that exist: `stations/years/<source>.parquet`, below, lists them.

## Which years a station has

A year with no values has no file, so a missing file and a failed download look alike. `stations/years/<source>.parquet` settles it: one row per year file of observed levels the source has, in every epoch, with

- **`id`**, **`epoch`** and **`year`**: the station's `id` from `stations.parquet`, the datum epoch whose files hold it (1 for the plain path), and the year;
- **`hours`**: how many UTC hours hold at least one value, of any flag;
- **`good`**, **`interpolated`**, **`preliminary`**, **`suspect`** and **`bad`**: how many values have each `flag`;
- **`version`**: a hash of the file's rows, which changes when any row's `time`, `level_m`, `flag`, `source_flag` or `received` does, and only then.

A year between a station's first and last rows with no row of its own has no values. A row with no `epoch` or `year` marks a station whose rows may be out of date, and which may have a year with a file but no row: a run is writing its files, or one stopped partway or couldn't read one of them and the nightly check hasn't caught up. Read again later, or read the files and don't trust their versions. A mark from a stopped run usually clears the next night, but a station with many files can stay marked a few nights. The file covers `obs/` only, not extremes or predictions. Every run that writes a year file of levels keeps it, and compaction checks each night that every file has a row and every row a file, so it's current but for those marks; `stations.parquet` lags it by up to a rebuild.

The years of one station, with how much of each its source hasn't checked:

```sql
SELECT epoch, year, hours, good + interpolated AS checked, preliminary, suspect + bad AS flagged, version
FROM 'https://stillwell.openwaters.io/stations/years/rws.parquet'
WHERE id = 'rws/hoekvanholland'
ORDER BY epoch, year;
```

The paths of every year with a file, to pass to `read_parquet` as in [Reading many files](#reading-many-files):

```sql
SELECT list('https://stillwell.openwaters.io/obs/' || id ||
  CASE WHEN epoch = 1 THEN '' ELSE '/' || epoch END || '/' || year || '.parquet' ORDER BY epoch, year)
FROM 'https://stillwell.openwaters.io/stations/years/rws.parquet'
WHERE id = 'rws/hoekvanholland' AND year IS NOT NULL;
```

That works for an `id` whose `source_id` needs no URL-encoding; one with a `/`, space or other reserved character needs its `source_id` encoded in the path.

**Caching.** To keep a local copy of a year, read its row in the years file first, then download the file and store the row's `version` beside it, and download it again only when the years file shows a different one. Read in that order, a download that lands just after a run rewrote the file holds newer rows than the version stored with it, which costs one more download next time, never a stale copy; read the other way round, it can store an old version beside new rows. Don't cache a station's years while it's marked. A file's HTTP `ETag` works as well for a conditional request, with `If-None-Match`, but treat it as an opaque tag to compare with the last one seen, not as a checksum: an object uploaded in several parts has an `ETag` that isn't its MD5.

## Datum epochs

`stations/links.parquet` holds offsets measured between linked stations within 1 km that share no reference datum, where one has MSL, LAT or a chart datum of its own (not `computed`) the other lacks. The Monthly workflow measures each pair in the latest calendar year of their open epochs that measures, trying up to three of the years in which both files hold at least 30 days, latest first: at each minute both have a good or preliminary value, the first such in each hour, `offset_m` is the median of `b`'s level less `a`'s, over `hours` hours (at least 30 days) between `since` and `until`. `spread_m` is how far the medians of months with at least 10 days range, and a pair needs two such months. Publish carries offsets along a pair whose `spread_m` is 1 cm or less and whose `a_epoch` and `b_epoch` are still the stations' open epochs; a datum step, or two gauges whose levels part with a river's flow, spreads wider. A row the month's run doesn't replace is kept, so a missing list or file, a rewrite in progress or a failed read takes nothing away; a pair whose values were read but don't measure, or that is no longer linked, loses its row, and publish leaves out a row whose stations have since moved more than 1 km apart; a station that opens a new epoch waits for the next month's measurement. Publish fails if the file can't be read, rather than publish without the offsets it gives. The rows are derived from both stations' levels and carry no terms of their own: join them to `stations.parquet` for each station's `commercial_use` and `attribution`.

`stations/offsets.parquet` has already applied `to_current`: for each station and epoch, the meters to add to a level to refer it to each named datum. An epoch that converts to the current one has a row for every datum in the current `datums`; one that doesn't (`to_current` null) has rows only for its own frozen offsets. A station's own label, such as NAP, STND or the `MSL` RWS measures its offshore platforms from, isn't the datum of that name, so it has a row only where it's the station's `chart_datum`, as Kartverket's `CD` is, and only in an epoch that converts. To read a level in its own epoch's reference, use `to_current` from `epochs`; a join on a datum the epoch has no row for finds nothing.

`stations.parquet`'s `epochs` lists each span over which a station's levels share one reference: `id`, `datum`, `since` and `until` (UTC, either null when open-ended), `seen` (the last refresh that confirmed it), `reference` (the source's own name for it, where it has one), `reference_since` (where the source says that starts), `datums` (its offsets), `to_current` and `state`. `to_current` is the meters to add to that epoch's levels to put them in the station's current `datum`, and null when they can't be converted, such as across a gauge zero reset nobody has measured. Rows in an epoch's files outside its `since` and `until` aren't part of the series: the uncertain stretch around a change, or, where an epoch opened with a start in the past, years written before it opened, which the new epoch's files hold again. A station's whole record in its current datum:

```sql
SET TimeZone = 'UTC';
SET VARIABLE base = 'https://stillwell.openwaters.io/obs/pegelonline/5990020';
WITH e AS (
  SELECT unnest(epochs, recursive := true)
  FROM 'https://stillwell.openwaters.io/stations.parquet' WHERE id = 'pegelonline/5990020'
),
o AS (
  -- epoch 1's files; add one per later epoch from its directory with UNION ALL BY NAME,
  -- since some older files lack the source_flag column
  SELECT 1 AS epoch, * FROM read_parquet(getvariable('base') || '/2024.parquet')
)
SELECT o.time, o.level_m + e.to_current AS level_m, o.flag
FROM o JOIN e ON o.epoch = e.id
  AND (e.since IS NULL OR o.time >= e.since) AND (e.until IS NULL OR o.time < e.until)
WHERE e.to_current IS NOT NULL
-- after a rejected epoch, its files and the epoch before it can share a time; the latter wins
QUALIFY row_number() OVER (PARTITION BY o.time ORDER BY e.state = 'rejected') = 1
ORDER BY o.time;
```

[stations.md](stations.md#datum-epochs) has the rules for when an epoch opens and how epochs convert.

## Python

DuckDB's Python package reads the same way and hands the result to pandas:

```python
import duckdb

con = duckdb.connect()
con.sql("SET TimeZone = 'UTC'")
df = con.sql("""
    SELECT time, level_m
    FROM 'https://stillwell.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
    WHERE flag <= 2
""").df()
daily = df.set_index("time").level_m.resample("D").agg(["min", "max"])
print(daily.head(3))
```

```
                            min   max
time
2024-01-01 00:00:00+00:00 -0.25  1.68
2024-01-02 00:00:00+00:00 -0.63  1.54
2024-01-03 00:00:00+00:00 -0.27  1.56
```
