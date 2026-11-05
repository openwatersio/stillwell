# Using the water-levels bucket

Every public series in the lake is Parquet at `https://water-levels.openwaters.io/`, readable without an account by DuckDB, Polars, pandas or anything else that reads Parquet over HTTPS. Non-commercial sources aren't here; they go to a separate private lake.

Each source's license and the attribution it asks for are in [`sources.json`](https://water-levels.openwaters.io/sources.json). Every source here allows commercial use.

So far the bucket holds the station lists that have been published to it and one year of data, Hoek van Holland in 2024. Scheduled ingest fills in the rest (phase 4 of [plan.md](plan.md)).

## Layout

```
stations.parquet                                      one row per station
sources.json                                          license and attribution per source
recent/<source>.parquet                               last 7 days: station, time, level_m, flag, received
obs/<source>/<station>/<year>.parquet                 observed levels: time, level_m, flag, received, datum
extremes/<source>/<station>/<year>.parquet            the source's observed high and low waters: time, level_m, type, flag, datum
predictions/<source>/<station>/<year>.parquet         the source's predicted curve: time, level_m, flag, received, datum
predicted-extremes/<source>/<station>/<year>.parquet  the source's predicted high and low waters: time, level_m, type, flag[, transit, event], datum
```

- **`<station>`** is the station's `source_id` from `stations.parquet`, URL-encoded. A station's `id` is `<source>/<source_id>`, such as `rws/hoekvanholland`, so the path is the `id` with the product in front.
- **`time`** is UTC, as `TIMESTAMPTZ`. Set your session to UTC (`SET TimeZone = 'UTC'`) or tools such as pandas show it in your local zone.
- **`level_m`** is meters in the file's `datum`, which is the same on every row and matches the station's `datum` in `stations.parquet`.
- **`flag`** runs from best to worst: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad. Source flags fold into these, and quality control only makes a flag worse. `flag <= 2` keeps everything not flagged as a problem.
- **`received`** is when ingest first saw a value arrive. It's empty for backfilled history.
- **`type`** is `high` or `low`. BSH's predicted extremes also carry its `transit` number and `event` index.

## Stations

A station is one source's series at one place; a gauge is the instrument, and `same_as` links stations that share one. Cuxhaven, for example, is `pegelonline/5990020` for observed levels and `bsh/506P` for predictions.

`stations.parquet` has one row per station. Besides `id`, `name`, `lat` and `lon`, these columns matter most:

- **`datum`**: what levels are measured from, such as `NAP`, `PNP` (gauge zero), `SKN` (chart datum), `STND` (CO-OPS station datum) or `GZ` (USACE gauge zero).
- **`datums`**: meters to add to a level in `datum` to refer it to each other datum the source publishes.
- **`products`**: which of `levels`, `extremes`, `predictions` and `predicted_extremes` the station has.
- **`same_as`**: other stations for the same physical gauge, such as a BSH prediction gauge and its PEGELONLINE series.
- **`status`**: `active` or `inactive`.
- **`commercial_use`**, **`license`** and **`attribution`**: the source's terms.

The examples below use the DuckDB CLI (`brew install duckdb`), and each one reads straight from the bucket.

How many stations each source has, and in which datums:

```sql
SELECT source, count(*) AS stations, string_agg(DISTINCT datum, ', ' ORDER BY datum) AS datums
FROM 'https://water-levels.openwaters.io/stations.parquet'
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
SELECT id, name, datum, products, same_as
FROM 'https://water-levels.openwaters.io/stations.parquet'
WHERE name ILIKE '%cuxhaven%';
```

```
┌─────────────────────┬─────────────────────────────┬─────────┬───────────────────────────────────┬───────────────────────┐
│         id          │            name             │  datum  │             products              │        same_as        │
│       varchar       │           varchar           │ varchar │             varchar[]             │       varchar[]       │
├─────────────────────┼─────────────────────────────┼─────────┼───────────────────────────────────┼───────────────────────┤
│ bsh/506P            │ Cuxhaven, Steubenhöft, Elbe │ PNP     │ [predictions, predicted_extremes] │ [pegelonline/5990020] │
│ pegelonline/5990020 │ CUXHAVEN STEUBENHÖFT        │ PNP     │ [levels]                          │ [bsh/506P]            │
└─────────────────────┴─────────────────────────────┴─────────┴───────────────────────────────────┴───────────────────────┘
```

The nearest stations with observed levels to a point, here the mouth of the Nieuwe Waterweg:

```sql
SELECT id, name,
  round(6371 * acos(least(1,
    sin(radians(lat)) * sin(radians(51.98)) +
    cos(radians(lat)) * cos(radians(51.98)) * cos(radians(lon - 4.12)))), 2) AS km
FROM 'https://water-levels.openwaters.io/stations.parquet'
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
FROM 'https://water-levels.openwaters.io/stations.parquet'
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
FROM 'https://water-levels.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
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
FROM 'https://water-levels.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
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
FROM 'https://water-levels.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
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
FROM 'https://water-levels.openwaters.io/extremes/rws/hoekvanholland/2024.parquet'
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
FROM 'https://water-levels.openwaters.io/obs/rws/hoekvanholland/2024.parquet' o
JOIN 'https://water-levels.openwaters.io/predictions/rws/hoekvanholland/2024.parquet' p USING (time)
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

HTTPS has no directory listing, so wildcards such as `obs/rws/*/2024.parquet` don't work. Build the list of paths, then pass it to `read_parquet`. For several years of one station:

```sql
SET VARIABLE files = (
  SELECT list('https://water-levels.openwaters.io/obs/rws/hoekvanholland/' || y || '.parquet')
  FROM range(2024, 2025) t(y)
);
SELECT count(*) AS n FROM read_parquet(getvariable('files'));
```

The same works for many stations, with paths built from `stations.parquet`. A missing file is an error, so list only files that exist. `stations.parquet` will record each station's `first` and `last` observation once compaction derives them from the lake; until then they're empty.

## Python

DuckDB's Python package reads the same way and hands the result to pandas:

```python
import duckdb

con = duckdb.connect()
con.sql("SET TimeZone = 'UTC'")
df = con.sql("""
    SELECT time, level_m
    FROM 'https://water-levels.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
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
