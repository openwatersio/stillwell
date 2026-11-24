# California Department of Water Resources (`dwr`)

Stage at tidal gauges in the Sacramento–San Joaquin Delta and Suisun Marsh, from the [Water Data Library](https://wdl.water.ca.gov/ContinuousData.aspx) (WDL), the continuous monitoring data of the California Department of Water Resources (DWR).

- **Stations:** the DWR gauges TICON keeps (`TIDAL` in the adapter), each `dwr/<DWR station number>`, such as `dwr/B95050Q` for Fisherman's Cut. All are DWR's own gauges, listed in WDL as "DWR Hydstra". A gauge is left out where WDL gives no position, as at five closed ones such as Hood, or has no file with data. A station silent for a year is `inactive`.
- **Parameters:** each station reads one raw point series (`RAW`): `WaterSurfaceElevationNAVD88`, "Water Surface Elevation (NAVD88) (feet)", where it has one with data, and otherwise `StreamLevel`, "Corrected Stage (Feet)". Daily means are left out. `extra` in `stations/dwr.parquet` gives each station's parameter and the span of its record.
- **Levels:** feet, converted to meters and rounded to the millimeter, every 15 minutes on the quarter hour.
- **Times:** Pacific Standard Time all year. Fisherman's Cut lags NOAA's Port Chicago (9415144) by about 170 minutes in both January and July, so its clock doesn't change for daylight saving.
- **Datum:** `NAVD88` for elevation, and `GZ`, the gauge's own zero, for stage. The stage files don't name the gauge zero's datum, so `datums` is empty. A listed station keeps its parameter, so an empty file at refresh time leaves it out of that month's list rather than move it to another datum. The stage files don't say whether a gauge's zero was ever reset, so a reset in a long stage record shows only as a step. `archive` isn't set.
- **Flags:** Hydstra's quality codes, which each file lists: 1 (good), 2 (good, edited) and 40 (fair measurement) are `good`; 70 (estimated) and 76 (reliable interpolation) are `interpolated`; 151 (missing) and 255 (no data) are dropped; 170 (unreliable) and any other code are `suspect`. WDL marks nothing as provisional, but DWR edits its data after publishing it, and its stage files arrive months after the readings, so values from the current calendar month and the three before it are at most `preliminary`.
- **Freshness:** WDL rewrites each file daily. Elevation files end a day or two before the request, and stage files months back. No station is `live`, and the store reads every active station once a month, from January of the year before.

## Known limits

- **Positions:** WDL lists its positions in NAD83 or WGS84 (`lldatum`), and three stations in NAD27: Collinsville (B91110), Old River near Byron (B95270) and Goodyear Slough at Lake Herman Road (E33510). `NAD27` in the adapter holds their NAD83(2011) positions, converted with NOAA's [NCAT](https://geodesy.noaa.gov/NCAT/) (NADCON 5.0), which move each about 94 m west and 9 m south. A station WDL lists in NAD27 at another position than the one converted fails the refresh, since publishing it as NAD83 would put it about 94 m off. WDL lists no datum for six stations: Sacramento River at Walnut Grove (B91651), whose position has six decimals, and five closed ones with no position.
- **Fisherman's Cut:** CDEC's real-time copy of this gauge (FCT) differs from DWR's by steps that begin and end within a month (see the [CDEC README](../cdec/README.md)), and no independent record shows which of the two moved.
- **Late values:** values a file gains more than a year after their time reach the store only through a manual backfill.

## Running ingest

- **Files:** the [CNRA open data portal](https://data.cnra.ca.gov/dataset/fcba3a88-a359-4a71-a58c-6b0ff8fdc53f) lists WDL's stations (`stations.csv`) and a download link for each station and parameter (`station-trace-download-links.csv`). Each link is a CSV on Azure blob storage with the station's whole record. Rows are `MM/DD/YYYY HH:MM:SS, value, quality,`, with notes beside the first rows in a fourth column naming the station, the variable and the quality codes.
- **Station refresh:** a refresh probes each file's first KB to decide whether to list it and which parameter a new station takes. It leaves out a file that's empty, has no data row or names another station (erratum `dwr-b95580-another-header`), a trace row with no times, and a station with no name. A new station whose NAVD88 file is unusable falls back to its stage file.
- **Variable check:** a whole file is checked against its notes, and a tail read against the file's first KB, checked once per process. A file whose notes name another variable is refused.
- **Requests:** a range from two years back or older reads the whole file, 0.5 to 65 MB, about 2 GB for all 50, and keeps the four most recent files in memory for the process, so a backfill at the default `--concurrency` of 4, which asks for a station a year at a time, mostly downloads each file once for its older years. A file can still be evicted while its station waits on a write, and a higher concurrency evicts files still in use, so some are downloaded again. Each file held is up to about 1.5 million readings in memory. A more recent range, such as the monthly refetch, reads the file's tail with a byte range. Azure doesn't serve a range counted from the end, so the offset is a guess from the record's start: rows are 43 bytes with a value and 33 without, so guesses at 43, 41 and 33 bytes a row go in turn, and the whole file is read if none reaches back far enough. Tail reads aren't kept, so a backfill reads the tail again for each of the last two years. A guess past the end gets a 416 and costs nothing.
- **Limits:** none published. Nothing is cached on disk, since DWR rewrites every file daily.

### Backfill

Monthly refreshes DWR's list on the 2nd; `sources: dwr` on a Monthly dispatch starts it. Backfill through the Ingest workflow, active stations first and the five inactive ones in a second run:

```bash
node scripts/ingest.ts backfill dwr all 1975 2026 --skip-written
```

```bash
node scripts/ingest.ts backfill dwr B91110,B91210,B95400,B95480,E33510 1975 2026 --skip-written
```

That's about 1,400 station-years, but each station's file is downloaded once, about 2 GB in all, which should fit in one Ingest run. The current year is fetched whole on every run, so backfill it on its own with `backfill dwr all 2026 2027`.

### Scheduled runs

Monthly's refetch on the 9th runs with `--refetch` over every active station, from January of last year to that day, finished years included, reading each station's last year or two again from the tail of its file. The generic refetch never reads past the end of a station's last stored year, and drops a station once it holds no preliminary value. That's two tail reads a station, about 100 MB a month.
