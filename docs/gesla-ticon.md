# Using the water-levels database for GESLA and TICON

Ivan, Marta and Mike, this is for you. GESLA and TICON have been the foundation of [tide-database](https://github.com/openwatersio/slackwater-database), the open tide prediction database behind Open Waters. To keep it current, we built a database of observed water levels that reads from the agencies themselves, every hour, and takes in GESLA 4.1 beside them. It's free to use, and we'd like to offer it to you. This document explains what it is, then shows how to rebuild GESLA's records and TICON's constants from the originators' own data, checked against GESLA and TICON as published. Every query and script here has been run against the live database.

## What the database is

[water-levels](https://github.com/openwatersio/water-levels) collects observed and predicted water levels from tide, river and lake gauges into one layout. Each agency publishes in its own format, with its own datums, flags and quirks. water-levels fetches from each one, checks quality, and writes every series the same way:

- **One schema.** Times are UTC, levels are meters, and quality flags run from 0 (good) to 4 (bad), whatever scale the source used. The source's own flag is kept beside ours.
- **Datums kept as served.** Each series stays in the datum its source measures from. The station list gives the offsets the source publishes, and a change of gauge zero opens a new datum epoch rather than being mixed into one series.
- **Terms per station.** Every station carries its license, the credit it asks for, and whether its terms allow commercial use.
- **Links between sources.** When two sources cover one gauge, their stations name each other (`same_as`), and one series is marked as the best of the group (`preferred`).
- **Errata in the open.** When a source publishes something wrong, the correction is a public issue, and every station lists the errata that touch it.

It's all Parquet files at `https://water-levels.openwaters.io/`. There's no account, no API key and no client to install: DuckDB, Polars, pandas, R's `arrow` package, or anything else that reads Parquet over HTTPS works. Open Waters runs it on Cloudflare R2, and GitHub Actions fetch new values every hour and backfill each source's history.

It holds 17 sources, about 27,800 series. Twelve are fetched every hour: NOAA CO-OPS, USGS, USACE, Rijkswaterstaat, PEGELONLINE, REFMAR, Kartverket, SMHI, the Marine Institute, the Environment Agency, and two US state networks. UHSLC, JMA, BSH, California DWR and GESLA 4.1 come in as their sources release them. The [README](../README.md#sources) lists each one's coverage.

## Where to read more

- [README](../README.md): the sources, the layout and the license.
- [docs/data.md](data.md): the columns of every file, with DuckDB examples for stations, series, epochs and reading many files.
- [docs/stations.md](stations.md): how station lists, datum epochs and links between sources work.
- [src/sources/gesla/README.md](../src/sources/gesla/README.md): how GESLA 4.1 is read, flagged, corrected and linked to the originators.
- [docs/gesla-contributors.md](gesla-contributors.md): each GESLA contributor's terms as the database applies them.
- [docs/ticon-replacement.md](ticon-replacement.md) and [its CSV](ticon-replacement.csv): every TICON-4 record, its originator's series in the database, and its GESLA 4.1 copy.
- [errata.json](https://water-levels.openwaters.io/errata.json): every published correction, with its issue.

## GESLA's records and their originators

Every GESLA record is linked to the same gauge in the database's other sources, where there is one: by the originator's station code where GESLA's code is one (CO-OPS, USGS, PEGELONLINE, SMHI, REFMAR, Kartverket, UHSLC, SFWMD, California DWR), and otherwise by position and name. 3,625 of the 6,682 records in GESLA 4.1 link to a series the database fetches every hour, so for those the originator's own data can stand in for GESLA's copy, and runs on to the present:

```sql
CREATE TABLE s AS SELECT * FROM 'https://water-levels.openwaters.io/stations.parquet';
SELECT o.source, count(DISTINCT g.id) AS gesla_records, count(DISTINCT o.id) AS series,
  count(DISTINCT o.id) FILTER (WHERE o.last > now() - INTERVAL 7 DAY) AS reporting_now
FROM (SELECT id, unnest(same_as) AS other FROM s WHERE source = 'gesla') g
JOIN s o ON o.id = g.other
WHERE o.source IN ('coops', 'usgs', 'usace', 'rws', 'pegelonline', 'refmar', 'kartverket',
                   'smhi', 'marine-institute', 'ea', 'cdec', 'sfwmd')
GROUP BY o.source ORDER BY gesla_records DESC;
```

| Source           | GESLA records | Series | Reporting now |
| ---------------- | ------------: | -----: | ------------: |
| coops            |         1,652 |  1,407 |           281 |
| usgs             |           691 |    658 |           456 |
| rws              |           426 |    299 |           114 |
| refmar           |           270 |    135 |            95 |
| pegelonline      |           190 |    145 |           142 |
| smhi             |           137 |     71 |            60 |
| ea               |            92 |     42 |            39 |
| kartverket       |            61 |     28 |            28 |
| cdec             |            60 |     41 |               |
| marine-institute |            42 |     20 |            19 |
| sfwmd            |            40 |     40 |            34 |
| usace            |            14 |     14 |             8 |

A series can stand for several GESLA records, since GESLA often holds a gauge from several contributors: a NOAA record, a UHSLC copy and a CMEMS copy, say. GESLA 4.1 itself is in the database too, as the source `gesla`, with every record as released, so each rebuilt record can be checked against GESLA's own.

## Rebuilding GESLA from the originators

### A record, rebuilt

This Python function writes a GESLA-format file for a GESLA record from its originator's series. It finds the series the database links to the record from a source fetched every hour, reads the years it has, and keeps the values on the hour:

```python
import duckdb
import urllib.error
import urllib.parse
import urllib.request

LAKE = "https://water-levels.openwaters.io"
# Sources the database fetches every hour, so a rebuilt record runs to the present.
HOURLY = {"coops", "usgs", "usace", "rws", "pegelonline", "refmar", "kartverket",
          "smhi", "marine-institute", "ea", "cdec", "sfwmd"}

con = duckdb.connect()
con.sql("SET TimeZone = 'UTC'")


def originator(gesla_record: str) -> dict:
    """The series from an hourly-fetched source that the database links to a GESLA record."""
    rows = con.execute(
        f"""
        SELECT o.id, o.source, o.source_id, o.name, o.lat, o.lon, o.country_code, o.datum,
          o.first, o.last, o.attribution, o.id = g.preferred AS preferred
        FROM '{LAKE}/stations.parquet' g JOIN '{LAKE}/stations.parquet' o
          ON list_contains(g.same_as, o.id)
        WHERE g.id = ?
        ORDER BY preferred DESC, o.first
        """,
        [f"gesla/{gesla_record}"],
    ).df()
    rows = rows[rows.source.isin(HOURLY)]
    if rows.empty:
        raise LookupError(f"no hourly-fetched series is linked to {gesla_record}")
    return rows.iloc[0].to_dict()


def year_files(series: dict, start: int, end: int) -> list[str]:
    """The series' year files from start to end, skipping years with none."""
    code = urllib.parse.quote(series["source_id"], safe="")
    files = []
    for year in range(start, end + 1):
        url = f"{LAKE}/obs/{series['source']}/{code}/{year}.parquet"
        try:
            urllib.request.urlopen(urllib.request.Request(url, method="HEAD"))
            files.append(url)
        except urllib.error.HTTPError:
            pass
    return files


def rebuild(gesla_record: str, path: str, start: int | None = None, end: int | None = None):
    """Write a GESLA-format file for a record, from its originator's series, on the hour."""
    s = originator(gesla_record)
    files = year_files(s, start or s["first"].year, end or s["last"].year)
    values = con.execute(
        """
        SELECT strftime(time, '%Y/%m/%d'), strftime(time, '%H:%M:%S'), level_m,
          CASE flag WHEN 0 THEN 1 WHEN 1 THEN 2 WHEN 2 THEN 0 WHEN 3 THEN 3 ELSE 4 END,
          (flag <= 2)::INT
        FROM read_parquet(?, union_by_name = true)
        WHERE minute(time) = 0 AND second(time) = 0
        ORDER BY time
        """,
        [files],
    ).fetchall()
    header = [
        "FORMAT VERSION 5.0, rebuilt from https://water-levels.openwaters.io",
        f"SITE NAME {s['name']}",
        f"SITE CODE {s['source_id']}",
        f"COUNTRY {s['country_code']}",
        f"ORIGINATOR {s['attribution']}",
        f"LATITUDE {s['lat']:.8f}",
        f"LONGITUDE {s['lon']:.8f}",
        f"START DATE/TIME {values[0][0]} {values[0][1]}",
        f"END DATE/TIME {values[-1][0]} {values[-1][1]}",
        "TIME ZONE HOURS 0",
        f"DATUM INFORMATION {s['datum']} (water-levels series {s['id']})",
        "NULL VALUE -99.9999",
    ]
    with open(path, "w") as out:
        out.writelines(f"# {line}\n" for line in header)
        for date, time, level, qc, use in values:
            out.write(f"{date} {time} {level:9.4f} {qc} {use}\n")
    return s["id"], len(values)


rebuild("atlantic_city-8534720-usa-noaa", "atlantic_city-8534720-usa-noaa.txt", 2015, 2016)
```

```
# FORMAT VERSION 5.0, rebuilt from https://water-levels.openwaters.io
# SITE NAME Atlantic City
# SITE CODE 8534720
# COUNTRY US
# ORIGINATOR NOAA National Ocean Service, CO-OPS
# LATITUDE 39.35666700
# LONGITUDE -74.41805000
# START DATE/TIME 2015/01/01 00:00:00
# END DATE/TIME 2016/12/31 23:00:00
# TIME ZONE HOURS 0
# DATUM INFORMATION STND (water-levels series coops/8534720)
# NULL VALUE -99.9999
2015/01/01 00:00:00    1.9080 1 1
2015/01/01 01:00:00    1.6770 1 1
2015/01/01 02:00:00    1.5190 1 1
```

Against GESLA 4.1's own `atlantic_city-8534720-usa-noaa` for 2015 and 2016:

- **Every value matches.** On the 17,523 hours both files hold, the levels are identical, in the same datum (CO-OPS's station datum, which GESLA calls "Station Datum").
- **21 more hours.** GESLA lists 21 hours as missing that CO-OPS now serves.
- **8 flags differ,** where the database's own QC marks a value suspect that GESLA marks correct.

Leave out `start` and `end` and the record runs from CO-OPS's first year, 1911, to the last hour the database fetched. The same series also has CO-OPS's 6-minute values, ten times as many, by dropping the `minute(time) = 0` condition.

### How each originator lines up with GESLA

The same comparison at one gauge per source, for 2015, matching the originator's values to GESLA's at the same times:

| Source      | GESLA record                      | How to match GESLA                                         | Result                                          |
| ----------- | --------------------------------- | ---------------------------------------------------------- | ----------------------------------------------- |
| CO-OPS      | `atlantic_city-8534720-usa-noaa`  | Values on the hour                                         | Identical, 8,752 hours                          |
| SMHI        | `arko-2545-swe-smhi`              | Values as served (hourly)                                  | Identical, 8,265 hours                          |
| Kartverket  | `alesund-aes-nor-nhs`             | Values on the hour, from 10-minute data                    | 99.5% identical, the other 45 hours within 1 mm |
| PEGELONLINE | `bakez-9510066-deu-wsv`           | Hourly means of the 1-minute values                        | Within 1.5 mm for 99.99% of 8,548 hours         |
| REFMAR      | `ajaccio_aspretto-300-fra-refmar` | Hourly means of the 10-minute values, centered on the hour | No offset, 3 mm spread                          |

Two of these say something about GESLA's records:

- **WSV's values are hourly means, stamped at the start of the hour they average,** so a PEGELONLINE mean over 10:00 to 11:00 matches GESLA's 10:00 value. The database's `gesla` source moves those records 30 minutes later, to the middle of the hour ([#77](https://github.com/openwatersio/water-levels/issues/77)). The comparison above uses those moved times.
- **REFMAR's hourly values aren't a plain mean** of its 10-minute ones. They're probably REFMAR's own filtered hourly product, which the database doesn't read, since it reads the 10-minute values where REFMAR has them.

To rebuild a WSV record as GESLA has it, read hourly means instead of the values on the hour, with this in place of the `FROM … WHERE` part of `rebuild`'s query:

```sql
SELECT time_bucket(INTERVAL 1 HOUR, time) AS time, avg(level_m) AS level_m, max(flag) AS flag
FROM read_parquet(?, union_by_name = true)
GROUP BY 1 HAVING count(*) >= 50  -- most of the hour's 60 values
ORDER BY 1
```

### The station list, in GESLA's terms

GESLA's metadata file comes from the originators' station lists too. `stations.parquet` holds every series with its name, position, datum, interval, span, terms and links. This lists the CO-OPS series behind GESLA's NOAA records, with the GESLA record each one stands for:

```sql
SET TimeZone = 'UTC';
SELECT g.source_id AS gesla_file, o.id AS series, o.name, round(o.lat, 4) AS lat,
  round(o.lon, 4) AS lon, o.datum, o.interval_s,
  strftime(o.first, '%Y-%m-%d') AS start, strftime(o.last, '%Y-%m-%d') AS "end", o.commercial_use
FROM 'https://water-levels.openwaters.io/stations.parquet' g
JOIN 'https://water-levels.openwaters.io/stations.parquet' o ON list_contains(g.same_as, o.id)
WHERE g.source = 'gesla' AND g.source_id LIKE '%-noaa' AND o.source = 'coops'
ORDER BY gesla_file LIMIT 3;
```

GESLA's own fields for each record (contributor, originator, datum information, record quality and span) are in `stations/gesla.parquet`, in its `extra` column, as JSON:

```sql
SELECT source_id, json_extract_string(extra, '$.contributor') AS contributor,
  json_extract_string(extra, '$.datum_information') AS datum_information,
  json_extract_string(extra, '$.record_start')[:10] AS start_date,
  json_extract_string(extra, '$.record_end')[:10] AS end_date
FROM 'https://water-levels.openwaters.io/stations/gesla.parquet'
WHERE source_id = 'atlantic_city-8534720-usa-noaa';
```

### Flags

The database keeps one flag scale for every source: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad. `rebuild` maps it to GESLA's QC flag as 1 correct, 2 interpolated, 0 no quality control (for preliminary, real-time values), 3 doubtful and 4 wrong, and sets the use flag to 0 for suspect and bad values.

Every source's flags map onto the database's scale by its own rules. Each adapter's README in [src/sources](../src/sources) gives them. The database's own QC (limits, flatlines, spikes and outliers) runs on top, and `flag` is the worse of the two. `source_flag` keeps the source's verdict before our checks.

### GESLA's own records

Where no hourly source covers a record, or for its years before the originator's archive begins, GESLA's copy is in the database as the source `gesla`: one series per record, named by its file name, in files of `obs/gesla/<file name>/<year>.parquet`. For example, `gesla/aberdeen-abe-gbr-bodc` holds BODC's Aberdeen record from 1930, while the Environment Agency's live series for the same gauge, `ea/E70739`, reaches back only a year. The database changes GESLA's values only where it found an error, each a public issue:

- **WSV's hourly means stamped at the start of the hour** ([#77](https://github.com/openwatersio/water-levels/issues/77)), moved 30 minutes later.
- **Hong Kong an hour early** ([#78](https://github.com/openwatersio/water-levels/issues/78)), in UHSLC's records 329, 329a and 329b, which GESLA carries, moved an hour later.
- **Datum jumps flagged usable** ([#79](https://github.com/openwatersio/water-levels/issues/79)): Cape d'Or's 1965 values sit about 20 m above its later ones, Mazatlán's float and radar gauges are 0.9 to 2.5 m apart for months of 2021, and Ōminato and Gorge at Craigflower step by 1 to 2 m. A check on the raw levels flags every segment that sits apart from the record's longest one as `suspect`.
- **Wewak's time zone** ([#81](https://github.com/openwatersio/water-levels/issues/81)), labeled UTC+1, though the record fits UHSLC's copy of the gauge on UTC, so its times are kept as served.

GESLA 4.1 fixed several things we corrected for in 4.0: WSV's and RWS's local time labeled UTC, and the missing year-end hours in the JODC Japan Coast Guard records. The backfill of GESLA into the database is still running, record by record in name order, so some of its files aren't there yet.

## Rebuilding TICON from the originators

TICON-4 is constituents fitted to GESLA-4 records. With the originators' series in the database, a fit is a query and a call to any harmonic analysis package. This uses [UTide](https://github.com/wesleybowman/UTide) on ten years of CO-OPS's Atlantic City series, on the hour, as GESLA's record has it:

```python
import duckdb, utide

con = duckdb.connect()
con.sql("SET TimeZone = 'UTC'")
files = [f"https://water-levels.openwaters.io/obs/coops/8534720/{y}.parquet" for y in range(2015, 2025)]
df = con.execute(
    "SELECT time, level_m FROM read_parquet(?, union_by_name = true) "
    "WHERE flag IN (0, 1) AND minute(time) = 0 ORDER BY time",
    [files],
).df()

coef = utide.solve(df.time.dt.tz_localize(None), df.level_m.values, lat=39.357,
                   method="ols", conf_int="none", verbose=False)
for name in ("M2", "S2", "N2", "K1", "O1"):
    i = list(coef.name).index(name)
    print(f"{name}  {coef.A[i]:.4f} m  {coef.g[i]:6.2f}°")
```

It reads 87,404 hourly values from ten year files over HTTPS in about three seconds. Against TICON-4's published constants for `atlantic_city-8534720-usa-noaa`, fitted from 1911 to 2025, and the same fit at Aberdeen:

| Constituent | Atlantic City, CO-OPS 2015–2024 | TICON-4           | Aberdeen, EA live feed, Nov 2025–Nov 2026 | TICON-4           |
| ----------- | ------------------------------- | ----------------- | ----------------------------------------- | ----------------- |
| M2          | 0.5822 m, 355.47°               | 0.5845 m, 355.10° | 1.2971 m, 24.87°                          | 1.3008 m, 24.49°  |
| S2          | 0.1149 m, 20.34°                | 0.1177 m, 19.03°  | 0.4412 m, 63.18°                          | 0.4401 m, 62.69°  |
| N2          | 0.1339 m, 336.62°               | 0.1347 m, 336.10° |                                           | 0.2586 m, 1.06°   |
| K1          | 0.1091 m, 181.13°               | 0.1083 m, 181.38° | 0.1030 m, 207.05°                         | 0.1124 m, 204.75° |
| O1          | 0.0742 m, 166.36°               | 0.0747 m, 166.66° | 0.1283 m, 48.67°                          | 0.1266 m, 51.06°  |

Phases are Greenwich phase lags, in degrees on UTC. Aberdeen's fit uses the Environment Agency's year of 15-minute, real-time values, with `flag <= 2` since they're preliminary, against TICON-4's fit to BODC's record from 1930. The originators' current data carries the same constants on.

### Every TICON record

[docs/ticon-replacement.csv](ticon-replacement.csv) has one row for each of the 4,838 TICON-4 records tide-database ships. Each row gives the originator's series in the database (`replacement_source`, `replacement_id`) and whether the database reads that originator yet (`status`), and the record's GESLA 4.1 copy (`gesla_id`) with that copy's terms (`gesla_commercial_use`). Of the 2,527 records tide-database's quality evaluation accepts, 1,409 have an originator's series ready; the summary in [ticon-replacement.md](ticon-replacement.md) gives the rest by source and status. To refit every TICON record from the originators, loop over the CSV's ready rows, read each `replacement_id`'s years over the record's TICON period (`epoch_start` to `epoch_end`), and fit, falling back to `gesla_id` for years the originator's archive doesn't reach.

### What tide-database is doing with this

tide-database has started re-fitting its stations from the database rather than take TICON's constants as published, beginning with SMHI's 71 Swedish records from SMHI's own observations ([slackwater-database#405](https://github.com/openwatersio/slackwater-database/pull/405)). Each re-fit is gated: fitted on all but the last year, scored on the held-out year, and swapped in only where it scores no worse than TICON's constants on that year. Of SMHI's 71, 40 swap, 28 keep TICON's constants, and 3 have too little data. Where the re-fit loses to TICON, we'd much rather understand why than override TICON, and your view on those cases would help.

## Things to know

- **Backfills are still running.** CO-OPS's and USGS's histories, and GESLA's records, are still being written. A query for a file that doesn't exist yet fails rather than returning nothing, which is why `rebuild` checks each year first.
- **Datums.** Each originator's series is in its own datum, with the offsets it publishes in `stations.parquet`'s `datums`. GESLA's records are labeled `ZERO`, the contributor's own datum, with GESLA's description in `datum_information` and no offsets. Where the two match, as at Atlantic City, a rebuilt record and GESLA's agree to the millimeter; where they don't, as at Aberdeen (Ordnance Datum Newlyn in the EA's feed, Admiralty Chart Datum in BODC's record), they differ by the offset between the datums.
- **Datum epochs.** A series whose datum changed has a subdirectory per later epoch, which `rebuild` doesn't read. [docs/data.md](data.md#datum-epochs) shows how to read a whole record in its current datum.
- **Terms.** Each series carries its source's terms, and each GESLA record its contributor's, from GESLA's license table and from what this repository knows of the originator. We're asking several contributors for permission directly; [docs/gesla-contributors.md](gesla-contributors.md) has the details.
- **Credit.** Each series' `attribution` gives the credit its source asks for; GESLA's records name GESLA-4.1 (Haigh et al. 2023; Woodworth et al. 2017) and the contributor. The database is CC BY 4.0, credited to Open Waters and to each station's attribution, except where a source's terms say otherwise.

## What we'd ask of you

- **Look at the errata:** tell us if any of [#77](https://github.com/openwatersio/water-levels/issues/77), [#78](https://github.com/openwatersio/water-levels/issues/78), [#79](https://github.com/openwatersio/water-levels/issues/79) or [#81](https://github.com/openwatersio/water-levels/issues/81) is wrong, or should be fixed in GESLA itself.
- **Aberdeen's recent flags:** GESLA 4.1 marks much of Aberdeen's recent record doubtful and not for use: in 2020, 23,400 of its 35,136 values, in GESLA's own file. Fitted on their own, the flagged values of 2020 and 2024 give M2 1.265 m at 23.7°, against 1.290 m at 24.4° from the unflagged ones of the same years: close, but not the same. We'd like to know what the flag reflects, and whether other BODC records share it.
- **Tell us where an originator is missing:** if you know an agency's own feed for a GESLA contributor that the database doesn't read yet, we'd like to add it.
- **Use it, and tell us what breaks:** for GESLA 5, TICON-5, or a check of either against the originators' current data. Issues on [the repository](https://github.com/openwatersio/water-levels/issues) reach us.
