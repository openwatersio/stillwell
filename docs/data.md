# Using the Stillwell bucket

Every public series in the store is Parquet at `https://stillwell.openwaters.io/`, readable without an account by DuckDB, Polars, pandas or anything else that reads Parquet over HTTPS. Data whose source bars republishing isn't here; it goes to a separate private store. The exception is UHSLC stations whose contributor's own terms are stricter than UHSLC's, which are public while permission is asked ([uhslc-contributors.md](uhslc-contributors.md)). Non-commercial data a source lets anyone republish is here, with `commercial_use` false on its stations.

The data is CC BY 4.0, credited to "Open Waters" and to each station's `attribution`, except stations with `commercial_use` false, which keep their contributor's terms. Each station's `license` names its source's license, which still applies to the source's values alongside CC BY (see the [README](../README.md#license)). Each source's license, the attribution it asks for, and where to report an error in its data (`contact`) are in [`sources.json`](https://stillwell.openwaters.io/sources.json). Every station says whether its terms allow commercial use (`commercial_use`); most do. A station whose terms differ from its source's, as at some UHSLC gauges, carries the credit they ask for in its `attribution`, and [uhslc-contributors.md](uhslc-contributors.md) gives the terms.

The bucket holds every published source's station list and the year files backfilled so far; `stations/years/<source>.parquet` lists which years each series has. Scheduled ingest refreshes `recent/` every hour and folds each day into the year files at 00:40 UTC; older years come with backfill, which is still under way for some sources.

## Layout

```
stations.parquet                                      one row per station
sources.json                                          license, attribution, contact and `finalizes` per source
errata.json                                           errors in what sources publish, and what the store does about them
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

- **`<station>`** is the station's `source_id` from `stations.parquet`, URL-encoded. A station's `id` is `<source>/<source_id>`, such as `rws/hoekvanholland`, so the path is the `id` with the product in front.
- **Datum epochs.** When a source moves a station to another reference, its later values go to files of their own, with the epoch's number after `<station>`: `obs/<source>/<station>/2/<year>.parquet`. Epoch 1 is the plain path, and `recent` rows say their epoch in its `epoch` column; rows from different epochs are in different datums. Most stations have one epoch, apart from RWS's Dutch NAP stations, whose values before 2005 are in an epoch of their own; [Datum epochs](#datum-epochs) below shows how to read across them.
- **`time`** is UTC, as `TIMESTAMPTZ`. Set your session to UTC (`SET TimeZone = 'UTC'`) or tools such as pandas show it in your local zone.
- **`level_m`** is meters in the file's `datum`, which is the same on every row and matches its epoch's `datum` in `stations.parquet`.
- **`flag`** runs from best to worst: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad. Source flags fold into these, and quality control only ever marks a value suspect or bad, so `flag` is never better than `source_flag`. QC works `flag` out from `source_flag` and the store's rules, so a value a rule no longer flags is clear again once the store reruns QC over it, which it does for the values it fetches, and for stored years after a rule changes, when the Monthly workflow's `analyze --requalify` reaches the station. A value from before `source_flag` was kept that QC marked suspect or bad keeps its mark. `flag <= 2` keeps everything not flagged as a problem. A `preliminary` value is one the source hasn't checked. Two signals mark the ones it never will: every `preliminary` value from a source whose `finalizes` is false in `sources.json`, such as EA, PEGELONLINE and CDEC, which never mark a value checked, and values from before a station's `source_qc_start`, which the source states or the store infers from its flags. Those have passed only the store's QC, and stay `preliminary`; such a source can still revise a value, which reaches the store only when someone fetches it again. Elsewhere a `preliminary` value may be checked later, and the Monthly refetch reads the last three years again for it, but some never are, without a sign: SMHI's closed stations that are all unchecked, such as Landsort's to 2006, and USACE offices that screen nothing.
- **`source_flag`** is the source's own flag on the same scale, before quality control, so a value the source verified (0 or 1) still shows as verified where QC marked it suspect. The store can mark a span worse than its source does without changing `source_flag`, as the erratum `refmar-pointe-a-pitre-clock` does for Pointe-à-Pitre's 2020 to 2024 clock, so read `flag` to skip what shouldn't be used. Where a source doesn't mark which values it has checked, the adapter decides: Kartverket's values count as verified once they're a year old, and SMHI's from this month and the last count as preliminary at best, even where SMHI marks them checked, since it corrects them monthly. California DWR's from this month and the three before count as preliminary at best, since DWR edits its data without marking it. It's null in predictions and in values written before it was kept, and files written before then don't have the column. Where such a value's flag is better than suspect, it's the source's, and rerunning QC fills it in; a suspect or bad one may be QC's, so it stays null.
- **`received`** is when ingest first saw a value arrive. It's empty for backfilled history.
- **`type`** is `high` or `low`. RWS's observed extremes give both lows of a double low water, so two lows can come in a row. BSH's predicted extremes also carry its `transit` number and `event` index.

## Stations

A station is one source's series at one place; a gauge is the instrument, and `same_as` links stations that share one. Cuxhaven, for example, is `pegelonline/5990020` for observed levels and `bsh/506P` for predictions.

`stations.parquet` has one row per station. Besides `id`, `name`, `lat` and `lon`, these columns matter most:

- **`datum`**: what levels are measured from, such as `NAP`, `PNP` (gauge zero), `SKN` (chart datum), `STND` (CO-OPS station datum), `GZ` (gauge zero at USACE, California DWR and CDEC), `GAGE` (USGS gage datum), `ZH` (REFMAR chart datum), `ZI` (a REFMAR gauge's unknown instrument zero), `AOD` (ordnance datum: Newlyn in Great Britain, the local one in Northern Ireland, the Isle of Man and Jersey) or `CD` (chart datum, at four EA gauges and every BODC gauge).
- **`datums`**: meters to add to a level in `datum` to refer it to each other datum the source publishes. Both describe the station's current epoch; an earlier epoch's levels need its own `datums`, or `to_current` first (see [Datum epochs](#datum-epochs)).
- **`products`**: which of `levels`, `extremes`, `predictions` and `predicted_extremes` the station has.
- **`same_as`**: other stations for the same physical gauge, such as a BSH prediction gauge and its PEGELONLINE series, or a UHSLC copy of a CO-OPS gauge. [stations.md](stations.md#gauges-in-more-than-one-source) says how they're matched.
- **`preferred`**: the station to use for the gauge's observed levels among this one and its `same_as`; the station's own `id` when it's the one, or when it has no links. `WHERE preferred = id` gives one station per gauge. Among a gauge's stations with observed levels, it picks one whose terms allow commercial use where there is one. A record's length counts only its share of values not flagged suspect or bad, from its source's years file, so a long record of flagged values doesn't outrank a shorter clean one; a station whose source has no years file counts its whole record. It can pick an inactive station, so filter on `status` after picking, not before, or the gauge drops out.
- **`errata`**: the errors found in what the source publishes for this station, by ID, such as UHSLC's Hong Kong heights stamped an hour early. [`errata.json`](https://stillwell.openwaters.io/errata.json) has each one: which stations and span of values it's in, what's wrong, whether the store corrected, flagged, dropped, refused, avoided or kept them, the evidence, when it was reported to the agency and what it answered, and a link (`url`) to the file in this repository that holds it.
- **`source_qc_start`**: where the source's quality checks of the station's values start, as a UTC time, or null where none is known or the station's list hasn't been read for it yet. Null means unknown. It doesn't mean the source never checks the station's values, or that it has checked them all: its `preliminary` values may be checked later or never. At SMHI, the [adapter's notes](../src/sources/smhi/README.md) say why each station without a date has none. The source won't check the `preliminary` values before it, so they won't change. SMHI states one for 28 of its stations, 25 of them the Swedish Maritime Administration's: data before 1 July 2019 isn't quality-controlled, and automatic checks run from then on. At about 25 more SMHI stations whose notes state none, the store infers it from SMHI's flags, as the first checked value after the last month or more of unchecked ones: 1 January 2010 at most of SMHI's own, and 11 January 2018 at Uddevalla. `flag <= 2 AND time < source_qc_start` gives that history where it passed the store's QC.
- **`source_qc_start_inferred`**: whether the store inferred `source_qc_start` from the source's flags (true) or the source stated it (false). Null without a `source_qc_start`, or with one the station refresh hasn't read again since the column was added, which it settles on a later refresh. Add `AND source_qc_start_inferred = false` to keep to stated dates. An inferred date is the store's reading of the flags, worked out once and kept, and backfill doesn't fetch the years before it again.
- **`tidal`**: whether the station's levels carry a tide, measured from its last year in the store: true where M2's and O1's amplitudes add to 8 cm or more (`tide_m`), on at least 30 days of values, at water within 10 m of sea level where its datums say how high it sits, and, away from the coast, where it doesn't hold still between tides like a creek drained to a sill. Null where its values can't say (under 30 days, or sampled too coarsely to fit a tide), or before its first analysis. It's measured, not taken from `kind`: a river can be tidal, and the Baltic isn't. QC follows it: still water gets two days before a flatline is suspect and no outlier or held-level check (a sea without a tide keeps six hours for values in millimeters), tidal water six hours, counting values within 2 mm of a run's first as unchanged, or two days where its tide is under 30 cm and its values move in whole centimeters. [stations.md](stations.md#analysis) has the rule.
- **`tide_m`**: the lunar tide `tidal` is judged by, M2's and O1's amplitudes added, in meters, fitted over the station's last year of usable values. Null where they span under 30 days or are sampled too coarsely to fit, and before the station's first analysis.
- **`status`**: `active` or `inactive`.
- **`commercial_use`**, **`license`** and **`attribution`**: the station's terms. `license` is its source's; where a contributor's own terms apply, as at some UHSLC gauges, `commercial_use` follows them and `attribution` adds the contributor's credit.

The examples below use the DuckDB CLI (`brew install duckdb`), and each one reads straight from the bucket.

How many stations each source has, and in which datums:

```sql
SELECT source, count(*) AS stations, string_agg(DISTINCT datum, ', ' ORDER BY datum) AS datums
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE status = 'active'
GROUP BY source ORDER BY source;
```

```
┌─────────────┬──────────┬──────────┐
│   source    │ stations │  datums  │
│   varchar   │  int64   │ varchar  │
├─────────────┼──────────┼──────────┤
│ bsh         │      172 │ PNP, SKN │
│ pegelonline │      691 │ NN, PNP  │
│ rws         │      691 │ MSL, NAP │
└─────────────┴──────────┴──────────┘
```

A gauge by name, with its links to other sources:

```sql
SELECT id, name, products, same_as, preferred
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE name ILIKE '%cuxhaven%';
```

```
┌─────────────────────┬─────────────────────────────┬───────────────────────────────────┬───────────────────────┬─────────────────────┐
│         id          │            name             │             products              │        same_as        │      preferred      │
│       varchar       │           varchar           │             varchar[]             │       varchar[]       │       varchar       │
├─────────────────────┼─────────────────────────────┼───────────────────────────────────┼───────────────────────┼─────────────────────┤
│ bsh/506P            │ Cuxhaven, Steubenhöft, Elbe │ [predictions, predicted_extremes] │ [pegelonline/5990020] │ pegelonline/5990020 │
│ pegelonline/5990020 │ CUXHAVEN STEUBENHÖFT        │ [levels]                          │ [bsh/506P]            │ pegelonline/5990020 │
└─────────────────────┴─────────────────────────────┴───────────────────────────────────┴───────────────────────┴─────────────────────┘
```

One station per gauge, so a map or a count doesn't show a gauge once for each source that carries it:

```sql
SELECT count(*) AS gauges
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE list_contains(products, 'levels') AND preferred = id;
```

The nearest stations with observed levels to a point, here the mouth of the Nieuwe Waterweg:

```sql
SELECT id, name,
  round(6371 * acos(least(1,
    sin(radians(lat)) * sin(radians(51.98)) +
    cos(radians(lat)) * cos(radians(51.98)) * cos(radians(lon - 4.12)))), 2) AS km
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE status = 'active' AND list_contains(products, 'levels')
ORDER BY km LIMIT 5;
```

```
┌──────────────────────────────────┬─────────────────────────────────┬────────┐
│                id                │              name               │   km   │
│             varchar              │             varchar             │ double │
├──────────────────────────────────┼─────────────────────────────────┼────────┤
│ rws/hoekvanholland               │ Hoek van Holland                │   0.35 │
│ rws/hoekvanholland.splitsingsdam │ Hoek van Holland, splitsingsdam │   0.89 │
│ rws/beerkanaal                   │ Beerkanaal                      │   1.84 │
│ rws/europoort.dintelhaven        │ Europoort Dintelhaven           │   2.29 │
│ rws/scheurhaven                  │ Scheurhaven                     │   2.35 │
└──────────────────────────────────┴─────────────────────────────────┴────────┘
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

HTTPS has no directory listing, so wildcards such as `obs/rws/*/2024.parquet` don't work. Build the list of paths, then pass it to `read_parquet`, with `union_by_name = true` when you select `*`, since older files lack `source_flag`. For several years of one station:

```sql
SET VARIABLE files = (
  SELECT list('https://stillwell.openwaters.io/obs/rws/hoekvanholland/' || y || '.parquet')
  FROM range(2024, 2025) t(y)
);
SELECT count(*) AS n FROM read_parquet(getvariable('files'), union_by_name = true);
```

The same works for many stations, with paths built from `stations.parquet`. A missing file is an error, so list only files that exist: `stations/years/<source>.parquet`, below, lists them. `stations.parquet` records each station's `first` and `last` observation, over all its epochs, from the bounds compaction writes each night; they reach it when `stations.parquet` is next rebuilt, and are empty for a station with no observations yet.

## Which years a station has

A year with no values has no file, so a missing file and a failed download look alike. `stations/years/<source>.parquet` settles it: one row per year file of observed levels the source has, in every epoch, with

- **`id`**, **`epoch`** and **`year`**: the station's `id` from `stations.parquet`, the datum epoch whose files hold it (1 for the plain path), and the year;
- **`hours`**: how many UTC hours hold at least one value, of any flag;
- **`good`**, **`interpolated`**, **`preliminary`**, **`suspect`** and **`bad`**: how many values have each `flag`;
- **`version`**: a hash of the file's rows, which changes when any row's `time`, `level_m`, `flag`, `source_flag` or `received` does, and only then.

A year between a station's first and last rows with no row of its own has no values. A row with no `epoch` or `year` marks a station whose rows may be out of date, and which may have a year with a file but no row: a run is writing its files, or one stopped partway or couldn't read one of them and the nightly check hasn't caught up. Read again later, or read the files and don't trust their versions. A mark from a stopped run usually clears the next night, but a station with many files can stay marked a few nights. The file covers `obs/` only, not extremes or predictions. Every run that writes a year file of levels keeps it, and compaction checks each night that every file has a row and every row a file, so it's current but for those marks, as long as nothing else writes the files; `stations.parquet` lags it by up to a rebuild. A source has no years file until the store builds one for it, so a missing one means not built yet, not a source with no files.

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
  -- since files written before source_flag was kept lack that column
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

[stations.md](stations.md) has the rules for when an epoch opens and how epochs convert.

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
