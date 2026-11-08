# Using the water-levels database for GESLA and TICON

Ivan, Marta and Mike, this is for you. GESLA and TICON have been the foundation of [tide-database](https://github.com/openwatersio/slackwater-database), the open tide prediction database behind Open Waters. To keep it growing, we built a database of observed water levels that takes in GESLA 4.1 and also reads from the agencies themselves. It's free to use, and we'd like to offer it to you. This document explains what it is, and shows how to recreate GESLA's files and TICON's constants from it, with queries you can run as they stand.

## What the database is

[water-levels](https://github.com/openwatersio/water-levels) collects observed and predicted water levels from tide, river and lake gauges into one layout. Each agency publishes in its own format, with its own datums, flags and quirks. water-levels fetches from each one, checks quality, and writes every series the same way:

- **One schema.** Times are UTC, levels are meters, and quality flags run from 0 (good) to 4 (bad), whatever scale the source used. The source's own flag is kept beside ours.
- **Datums kept as served.** Each series stays in the datum its source measures from. The station list gives the offsets the source publishes, and a change of gauge zero opens a new datum epoch rather than being mixed into one series.
- **Terms per station.** Every station carries its license, the credit it asks for, and whether its terms allow commercial use.
- **Links between sources.** When two sources cover one gauge, their stations name each other (`same_as`), and one series is marked as the best of the group (`preferred`).
- **Errata in the open.** When a source publishes something wrong, the correction is a public issue, and every station lists the errata that touch it.

It's all Parquet files at `https://water-levels.openwaters.io/`. There's no account, no API key and no client to install: DuckDB, Polars, pandas, R's `arrow` package, or anything else that reads Parquet over HTTPS works. Open Waters runs it on Cloudflare R2. GitHub Actions fetch new values every hour and backfill history.

It holds 17 sources so far: CO-OPS, USGS, USACE, UHSLC, Rijkswaterstaat, PEGELONLINE, BSH, REFMAR, Kartverket, SMHI, JMA, the Marine Institute, the Environment Agency, three US state networks, and GESLA 4.1. That's about 27,800 series. The [README](../README.md#sources) lists each one's coverage.

## Where to read more

- [README](../README.md): the sources, the layout and the license.
- [docs/data.md](data.md): the columns of every file, with DuckDB examples for stations, series, epochs and reading many files.
- [docs/stations.md](stations.md): how station lists, datum epochs and links between sources work.
- [src/sources/gesla/README.md](../src/sources/gesla/README.md): how GESLA 4.1 is read, flagged, corrected and linked.
- [docs/gesla-contributors.md](gesla-contributors.md): each GESLA contributor's terms as the lake applies them.
- [docs/ticon-replacement.md](ticon-replacement.md) and [its CSV](ticon-replacement.csv): every TICON-4 record, its originator's series in the lake, and its GESLA 4.1 copy.
- [errata.json](https://water-levels.openwaters.io/errata.json): every published correction, with its issue.

## How GESLA 4.1 sits in the database

GESLA 4.1 is one source among the others, `gesla`, with all 6,682 records. Each record is one series, named by its file name: `gesla/aberdeen-abe-gbr-bodc` is GESLA's `aberdeen-abe-gbr-bodc`. Values are read from the 4.1 zip as released, with GESLA's QC and use flags carried into ours, as described under "Flags" below.

The lake doesn't change GESLA's values except where it has found an error, and each of those is a public issue:

- **WSV's hourly means are stamped 30 minutes early** ([#77](https://github.com/openwatersio/water-levels/issues/77)). In 2015, Cuxhaven's value at T equals the mean of PEGELONLINE's 1-minute values from T to T + 60 minutes, to within 3.7 mm. The lake moves these records 30 minutes later.
- **Hong Kong is an hour early** ([#78](https://github.com/openwatersio/water-levels/issues/78)), as in UHSLC's copies of records 329, 329a and 329b, which GESLA carries. The lake moves them an hour later.
- **Datum jumps flagged usable** ([#79](https://github.com/openwatersio/water-levels/issues/79)). Cape d'Or's 1965 values sit about 20 m above its later ones, Mazatlán's float and radar gauges are 0.9 to 2.5 m apart for months of 2021, and Ōminato and Gorge at Craigflower step by 1 to 2 m. A check on the raw levels flags every segment that sits apart from the record's longest one as `suspect`.
- **Wewak's time zone** ([#81](https://github.com/openwatersio/water-levels/issues/81)) is labeled UTC+1, but the record fits UHSLC's copy of the gauge on UTC, so the lake keeps its times as served.

We'd welcome your view on each of these. If any is wrong, or already fixed on your side, the issue is the place to say so.

GESLA 4.1 also fixed several things we used to correct for 4.0: WSV's and RWS's local time labeled UTC, and the missing year-end hours in the JODC Japan Coast Guard records. The [GESLA adapter's README](../src/sources/gesla/README.md#errata) has the checks behind each of these.

Every GESLA record is linked to the same gauge in the lake's other sources, where there is one: by the originator's station code where GESLA's code is one (CO-OPS, USGS, PEGELONLINE, SMHI, REFMAR, Kartverket, UHSLC, SFWMD, California DWR), and otherwise by position and name. 4,602 of the 6,682 records have at least one link. Within a linked group, the originator's own series is `preferred`, since it continues past GESLA's release, and GESLA's copy covers the years before the originator's archive begins.

The GESLA backfill into the lake is still running. Every record is in the station list, but the data files are written record by record in name order. At the time of writing, records through the early letters of the alphabet, Aberdeen among them, are in.

## Recreating GESLA

The examples use the [DuckDB CLI](https://duckdb.org/docs/installation/) (`brew install duckdb`). Each one reads straight from the bucket.

### The metadata file

GESLA's own station list, `stations/gesla.parquet`, holds every record with GESLA's fields. Contributor, originator, datum information, record quality and the record's span are in its `extra` column, as JSON. This rebuilds GESLA's metadata file, here for BODC's records:

```sql
SET TimeZone = 'UTC';
SELECT source_id AS file_name, name AS site_name, country_code AS country,
  round(lat, 4) AS lat, round(lon, 4) AS lon,
  json_extract_string(extra, '$.contributor') AS contributor,
  json_extract_string(extra, '$.datum_information') AS datum_information,
  json_extract_string(extra, '$.record_start')[:10] AS start_date,
  json_extract_string(extra, '$.record_end')[:10] AS end_date,
  kind AS gauge_type, commercial_use
FROM 'https://water-levels.openwaters.io/stations/gesla.parquet'
WHERE json_extract_string(extra, '$.contributor') = 'BODC'
ORDER BY file_name LIMIT 4;
```

```
┌────────────────────────┬───────────┬─────────┬─────────┬─────────┬─────────────┬─────────────────────────────┬────────────┬────────────┬────────────┬────────────────┐
│       file_name        │ site_name │ country │   lat   │   lon   │ contributor │      datum_information      │ start_date │  end_date  │ gauge_type │ commercial_use │
├────────────────────────┼───────────┼─────────┼─────────┼─────────┼─────────────┼─────────────────────────────┼────────────┼────────────┼────────────┼────────────────┤
│ aberdeen-abe-gbr-bodc  │ Aberdeen  │ GB      │  57.144 │ -2.0802 │ BODC        │ Admiralty Chart Datum (ACD) │ 1930-01-01 │ 2026-04-30 │ coastal    │ false          │
│ avonmouth-avo-gbr-bodc │ Avonmouth │ GB      │ 51.5078 │ -2.7128 │ BODC        │ Admiralty Chart Datum (ACD) │ 1961-01-01 │ 2012-04-30 │ coastal    │ false          │
│ bangor-ban-gbr-bodc    │ Bangor    │ GB      │ 54.6648 │ -5.6695 │ BODC        │ Admiralty Chart Datum (ACD) │ 1994-11-01 │ 2026-04-30 │ coastal    │ false          │
│ barmouth-bar-gbr-bodc  │ Barmouth  │ GB      │ 52.7193 │  -4.045 │ BODC        │ Admiralty Chart Datum (ACD) │ 1961-01-01 │ 2026-04-30 │ coastal    │ false          │
└────────────────────────┴───────────┴─────────┴─────────┴─────────┴─────────────┴─────────────────────────────┴────────────┴────────────┴────────────┴────────────────┘
```

`commercial_use` is false here because the UK National Tide Gauge Network's terms don't let users pass the data on, and BODC has been asked for permission, as [docs/gesla-contributors.md](gesla-contributors.md) records. Drop the `WHERE` to list all 6,682 records.

### A record's data

Each record's values are in one file per year, `obs/gesla/<file name>/<year>.parquet`, with `time`, `level_m`, `flag` and `source_flag`. This puts them back in GESLA's columns:

```sql
SET TimeZone = 'UTC';
SELECT strftime(o.time, '%Y/%m/%d') AS date, strftime(o.time, '%H:%M:%S') AS time,
  o.level_m AS sea_level,
  CASE o.flag WHEN 0 THEN 1 WHEN 1 THEN 2 WHEN 2 THEN 0 WHEN 3 THEN 3 ELSE 4 END AS qc_flag,
  (o.flag <= 2)::INT AS use_flag
FROM 'https://water-levels.openwaters.io/obs/gesla/aberdeen-abe-gbr-bodc/2015.parquet' o
ORDER BY o.time LIMIT 4;
```

```
┌────────────┬──────────┬───────────┬─────────┬──────────┐
│    date    │   time   │ sea_level │ qc_flag │ use_flag │
├────────────┼──────────┼───────────┼─────────┼──────────┤
│ 2015/01/01 │ 00:00:00 │     3.202 │       1 │        1 │
│ 2015/01/01 │ 00:15:00 │      3.07 │       1 │        1 │
│ 2015/01/01 │ 00:30:00 │     2.912 │       1 │        1 │
│ 2015/01/01 │ 00:45:00 │     2.783 │       1 │        1 │
└────────────┴──────────┴───────────┴─────────┴──────────┘
```

To write several years as one file in GESLA's layout, read each year and `COPY` the result. HTTPS has no directory listing, so list the year files:

```sql
SET TimeZone = 'UTC';
SET VARIABLE files = (
  SELECT list('https://water-levels.openwaters.io/obs/gesla/aberdeen-abe-gbr-bodc/' || y || '.parquet')
  FROM range(2015, 2025) t(y)
);
COPY (
  SELECT strftime(time, '%Y/%m/%d') AS date, strftime(time, '%H:%M:%S') AS time_of_day,
    level_m AS sea_level,
    CASE flag WHEN 0 THEN 1 WHEN 1 THEN 2 WHEN 2 THEN 0 WHEN 3 THEN 3 ELSE 4 END AS qc_flag,
    (flag <= 2)::INT AS use_flag
  FROM read_parquet(getvariable('files'), union_by_name = true)
  ORDER BY 1, 2
) TO 'aberdeen-abe-gbr-bodc-2015-2024.txt' (DELIMITER ' ', HEADER false);
```

A missing file is an error, and a record can have whole years with no values, such as Aberdeen's 1940 and 1941, for which the lake writes no file. For a whole record, check which years exist first. In Python:

```python
import duckdb, json, urllib.request

BASE = "https://water-levels.openwaters.io"

def year_files(record: str) -> list[str]:
    """The year files a GESLA record has in the lake, over its span."""
    con = duckdb.connect()
    extra = con.execute(
        f"SELECT extra FROM '{BASE}/stations/gesla.parquet' WHERE source_id = ?", [record]
    ).fetchone()[0]
    span = json.loads(extra)
    files = []
    for year in range(int(span["record_start"][:4]), int(span["record_end"][:4]) + 1):
        url = f"{BASE}/obs/gesla/{record}/{year}.parquet"
        try:
            urllib.request.urlopen(urllib.request.Request(url, method="HEAD"))
            files.append(url)
        except urllib.error.HTTPError:
            pass  # no values that year
    return files
```

Pass the list to `read_parquet` as above.

### Flags

The lake keeps one flag scale for every source: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad. GESLA's flags map onto it as the adapter reads them:

| GESLA QC flag              | Lake `flag`     |
| -------------------------- | --------------- |
| 0, no quality control      | 0, good         |
| 1, correct                 | 0, good         |
| 2, interpolated            | 1, interpolated |
| 3, doubtful                | 3, suspect      |
| 4, isolated spike or wrong | 4, bad          |
| 5, missing                 | dropped         |

A value whose use flag is 0 is at least `suspect`. The lake's own QC (limits, flatlines, spikes and outliers) runs on top, and `flag` is the worse of the two. `source_flag` keeps the flag before our checks. The queries above map back to GESLA's scale, so GESLA's 0 and 1 both come back as 1.

### Past the release: the originator's own series

GESLA's copy stops at its release. The station list links Aberdeen to the Environment Agency's live gauge, `ea/E70739`, which the lake reads every hour:

```sql
SET TimeZone = 'UTC';
SELECT id, name, datum, interval_s, first, last, commercial_use, preferred, same_as
FROM 'https://water-levels.openwaters.io/stations.parquet'
WHERE id IN ('gesla/aberdeen-abe-gbr-bodc', 'ea/E70739');
```

```
ea/E70739                    Aberdeen  AOD   900   2025-11-01  2026-11-07  true   ea/E70739  [gesla/aberdeen-abe-gbr-bodc, gesla/aberdeen-abe-gbr-cmems]
gesla/aberdeen-abe-gbr-bodc  Aberdeen  ZERO  …                             false  ea/E70739  [ea/E70739, gesla/aberdeen-abe-gbr-cmems]
```

The EA's values are 15-minute, real-time and unchecked, so they're flagged `preliminary`, and its own archive reaches back only about a year. GESLA's record is in Admiralty Chart Datum, while the EA's is in Ordnance Datum Newlyn (`AOD`), so joining the two takes the offset between those datums. The lake doesn't publish that offset yet. This is the arrangement we'd like for every GESLA contributor: the originator's own feed for the present, linked to GESLA's record for the past.

## Recreating TICON

TICON-4 is constituents fitted to GESLA-4 records. With the records in the lake, a fit is a query and a call to any harmonic analysis package. This one uses [UTide](https://github.com/wesleybowman/UTide) on ten years of Aberdeen:

```python
import duckdb, utide

con = duckdb.connect()
con.sql("SET TimeZone = 'UTC'")
record = "gesla/aberdeen-abe-gbr-bodc"
files = [f"https://water-levels.openwaters.io/obs/{record}/{y}.parquet" for y in range(2015, 2025)]
df = con.execute(
    "SELECT time, level_m FROM read_parquet(?, union_by_name = true) "
    "WHERE flag IN (0, 1) ORDER BY time",  # good and interpolated, as GESLA's use flag
    [files],
).df()

coef = utide.solve(df.time.dt.tz_localize(None), df.level_m.values, lat=57.144,
                   method="ols", conf_int="none", verbose=False)
for name in ("M2", "S2", "N2", "K1", "O1"):
    i = list(coef.name).index(name)
    print(f"{name}  {coef.A[i]:.4f} m  {coef.g[i]:6.2f}°")
```

It reads ten year files over HTTPS in about three seconds, and keeps 171,328 of their 350,580 values. Most of the rest GESLA itself marks doubtful and not for use (QC flag 3, use flag 0): in 2020, 23,400 of Aberdeen's 35,136 values, as in GESLA's own file. Against TICON-4's published constants for `aberdeen-abe-gbr-bodc`, whose fit runs from 1930 to 2025:

| Constituent | Lake + UTide, 2015–2024 | TICON-4           | Environment Agency feed, Nov 2025–Nov 2026 |
| ----------- | ----------------------- | ----------------- | ------------------------------------------ |
| M2          | 1.2996 m, 24.70°        | 1.3008 m, 24.49°  | 1.2971 m, 24.87°                           |
| S2          | 0.4372 m, 62.96°        | 0.4401 m, 62.69°  | 0.4412 m, 63.18°                           |
| N2          | 0.2582 m, 1.37°         | 0.2586 m, 1.06°   |                                            |
| K1          | 0.1123 m, 206.15°       | 0.1124 m, 204.75° | 0.1030 m, 207.05°                          |
| O1          | 0.1238 m, 51.32°        | 0.1266 m, 51.06°  | 0.1283 m, 48.67°                           |

Phases are Greenwich phase lags, in degrees on UTC. The last column fits the EA's year of live data the same way, with `flag <= 2` since those values are preliminary. It shows the same gauge's constants carry on in the originator's feed.

### Every TICON record

[docs/ticon-replacement.csv](ticon-replacement.csv) has one row for each of the 4,838 TICON-4 records tide-database ships. Each row gives:

- **The originator's series** in the lake (`replacement_source`, `replacement_id`), and whether an adapter for that originator exists yet (`status`).
- **Its GESLA 4.1 copy** in the lake (`gesla_id`) and that copy's terms (`gesla_commercial_use`).

GESLA names its files as TICON names its records, so a TICON record's GESLA copy is `gesla/<TICON id>`. That holds for 2,471 of the 2,527 records tide-database's quality evaluation accepts. The 56 without a copy are all Rijkswaterstaat's, which GESLA 4.1 renamed or dropped. The [GESLA adapter's README](../src/sources/gesla/README.md#40-records-missing-from-41) lists the 4.0 records 4.1 dropped, with their nearest 4.1 records.

To fit every TICON record from the lake, loop over the CSV, read each `gesla_id`'s years over the record's TICON period (`epoch_start` to `epoch_end`), and fit. Where `replacement_id` names an originator's series, it can stand in for, or extend, the GESLA copy.

### What tide-database is doing with this

tide-database is starting to re-fit its stations from the lake rather than take TICON's constants as published. Each re-fit is gated: it is fitted on all but the last year, scored on the held-out year, and swapped in only where it scores no worse than TICON's constants on that year. Both scores are recorded with the station. The [phase 6 plan](plan.md#phase-6-tide-database-reads-the-lake-6-days-in-tide-database) has the details. Where the re-fit loses to TICON, we'd much rather understand why than override TICON, and your view on those cases would help.

## Things to know

- **The GESLA backfill isn't finished.** The station list is complete, but some data files don't exist yet. A query for a missing file fails rather than returning nothing.
- **Datums.** GESLA's records are labeled `ZERO`, the contributor's own datum. The station list gives no offsets for them, and `datum_information` holds GESLA's free-text description. The originators' series carry their own datum and its published offsets.
- **Datum epochs.** A series whose datum changed has a subdirectory per later epoch. [docs/data.md](data.md#datum-epochs) shows how to read a whole record in its current datum. GESLA's records are all one epoch.
- **Paths.** A station's code is URL-encoded in its path. GESLA's file names need no encoding.
- **Terms.** Each GESLA record carries its contributor's terms as the lake understands them, from GESLA's license table and from what this repository knows of the originator. We're asking several contributors for permission directly; [docs/gesla-contributors.md](gesla-contributors.md) has the details.
- **Credit.** Each record's `attribution` names GESLA-4.1 (Haigh et al. 2023; Woodworth et al. 2017) and the contributor. The lake's own license is CC BY 4.0, credited to Open Waters and to each station's attribution, except where a contributor's terms say otherwise.

## What we'd ask of you

- **Look at the errata:** tell us if any of [#77](https://github.com/openwatersio/water-levels/issues/77), [#78](https://github.com/openwatersio/water-levels/issues/78), [#79](https://github.com/openwatersio/water-levels/issues/79) or [#81](https://github.com/openwatersio/water-levels/issues/81) is wrong, or should be fixed in GESLA itself.
- **Aberdeen's recent flags:** GESLA 4.1 marks much of Aberdeen's recent record doubtful and not for use, two thirds of 2020. Fitted on their own, the flagged values of 2020 and 2024 give M2 1.265 m at 23.7°, against 1.290 m at 24.4° from the unflagged ones of the same years: close, but not the same. We'd like to know what the flag reflects, and whether other BODC records share it.
- **Tell us where an originator is missing:** if you know an agency's own feed for a GESLA contributor that the lake doesn't read yet, we'd like to add it.
- **Use it, and tell us what breaks:** for GESLA 5, TICON-5, or a check of either against the originators' current data. Issues on [the repository](https://github.com/openwatersio/water-levels/issues) reach us.
