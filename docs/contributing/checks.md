# Checks

## TICON inventory

```bash
npm run ticon:inventory
```

Reads a slackwater-database checkout (`TIDE_DATABASE`, default `../slackwater-database`) and the store's station lists (`STILLWELL_STORE`, default the public bucket over HTTPS, so a local store needs every public source refreshed; restricted sources are left out), and writes the TICON inventory to `reports/` (`STILLWELL_REPORTS`): the store series for each TICON record's originator, where there is one, for every record slackwater-database ships, and how far along each one is. The Site workflow writes it before each build, from slackwater-database at the version this repository installs, and the [inventory page](https://openwatersio.github.io/stillwell/reports/ticon-inventory/) shows it. Nothing in the store pipeline reads it.

## Clock check

```bash
npm run clock-check -- 2020 uhslc/329=hong_kong-329-hkg-uhslc_fd uhslc/057=honolulu-1612340-usa-noaa
```

Cross-correlates a year of each station's levels, or the dates given as `<start>/<end>` in place of the year for a source that keeps less (the EA's readings API keeps 30 days), fetched through its adapter with the station as the store's list has it (`STILLWELL_STORE`, default the public bucket, or the adapter's own list when the store has none), against the prediction from a record's constants in a slackwater-database checkout (`TIDE_DATABASE`, default `../slackwater-database`): a TICON record by its name, or a record of another dataset there that holds harmonic constituents, such as `dmi/30357`, at lags of up to 3 hours in 10-minute steps, and prints a Markdown table of the best lag. It exits nonzero when a series fits best 30 minutes or more off, or has fewer than 30 days of values to check (or, for a range shorter than a month, values on fewer than all but one of its days, as for SMN's 5), which is how local time labeled UTC, or Hong Kong's early stamps, show up. A positive lag means the stamps run late. A record fitted to the same series, or a copy of it, only shows a clock that changed since, so check against constants fitted to another originator's observations of the gauge where there are any. The semidiurnal tide repeats every 12.42 hours, so a 12-hour error, such as New Zealand or Fiji local time labeled UTC, looks like a lag of under half an hour there; the K1 column, from K1's phase in a fit of the year against the record's, shows it, and fails the check at 3 hours or more. Values spanning under 183 days are too short to fit K1, so it shows `no K1`, and a lag of 20 minutes or more fails, since that's where a 12-hour error shows.

## Pair check

```bash
npm run pair-check -- 2025 coops/8725520=sfwmd/VALI75
```

Compares two records of one gauge from different originators, which is the independent clock check wherever the store holds one: a TICON record fitted to the same series, or a copy of the source's own data in an aggregator's records, shows only that a clock hasn't changed. It reads a year of each station's `good` and `preliminary` levels from the latest datum epoch that holds part of the year, within its span (a station with more than one epoch in the year is noted), reads the second series at each of the first's times shifted by lags of up to 3 hours in 10-minute steps (interpolating between readings 20 minutes apart or less, so where either series has sparser readings, such as hourly values, only lags that land on one of them are tried), and prints the RMS of the difference at the best lag and at zero, the number of lags it could try, and the mean difference. Where both stations name a datum, or one names the other's, it also prints how far the mean is from the offset between them, which checks the datum, though a bare `NAVD88` or `NGVD29` names more than one realization, so a difference of a few centimeters can be the realization rather than a fault. A positive lag means the first series' stamps run late, as in the clock check. A lag counts when its RMS, with the mean removed, is under three quarters of the zero-lag RMS and at least 0.5 cm lower, and the command then exits nonzero, as it does for a pair with under 200 shared readings or files it can't read, which it marks `not checked` or `not read`. A pair under 2 mm RMS at zero lag is marked `same values`: one record's values held twice say nothing about either clock, though two sensors could agree that closely at a still gauge, so look at where the second record comes from. The mean is removed first, so a pair a constant apart is marked too, and its mean column says by how much. Nearby gauges on a tide can fit best at the tide's travel time, and river gauges at a lag that has nothing to do with a clock, so read a lag with the gauges' positions.

The candidate pairs are in `stations/matches.parquet` (`a`, `b`, and the `rms_m` and `lag_h` of their hourly levels) and in each station's `same_as`. A pair under `DIFFER_M` (3 cm, in [`src/matches.ts`](../../src/matches.ts)) RMS is near enough to one gauge for a clock to show. List a source's pairs with another source's records in DuckDB, and take the year from the pair's `until`:

```sql
SELECT a, b, year(until - INTERVAL 1 DAY) AS year
FROM read_parquet('https://stillwell.openwaters.io/stations/matches.parquet')
WHERE (a LIKE 'coops/%') <> (b LIKE 'coops/%') AND months >= 6 AND rms_m < 0.03;
```

A pair is independent when the two records come from different agencies. An aggregator's record takes its originator from its institution, contributor or name suffix, and a record that copies the source's own data doesn't count. Records of one agency's gauges that the agency itself passes to another, such as a data service's copy of its gauge, don't count either.

## Cross-station checks

```bash
npm run cross-check -- 53.2,6.5,55.3,9.2 2000 2027 pegelonline,gesla
```

Reads hourly values (the value within 10 minutes of each hour, `flag` good or preliminary) for every station with levels in a box (`minLat,minLon,maxLat,maxLon`), between two years with the second exclusive, from the sources named or all of them, leaving out stations whose `kind` is `river` or `lake`. It reads the store at `STILLWELL_STORE`, the public bucket by default, or a local directory (not `s3://`), caches each series in `.cache/cross-check/<store>/`, a directory per store, and reads a station again when its `first`, `last` or epoch span changes (delete the directory to read it all again, such as after a `requalify`), and prints a Markdown report for a person to judge. With `--findings <file.json> --region <name>` it also writes what it found as JSON ([`src/findings.ts`](../../src/findings.ts)) for the errata report. It changes nothing in the store. It reads every datum epoch's files but a held one's, each within its epoch's span, as `matches` does, with no offset between epochs, so a step at an epoch's start can show as one. The report lists the stations left out: with under 60 days of values, or with values but too few near the hour, such as GESLA's WSV records of hourly means, stamped at the half hour. Those records' years are checked only through PEGELONLINE's copy of the gauge. Stations linked by `same_as` count as one gauge, represented by the `preferred` one where it has values here, otherwise the longest; years only another copy holds are left out of the checks that use one station per gauge. Every station is timed, compared with its copies and checked for steps; the copied-month check and the neighbors for steps use one station per gauge. It looks for errors that QC of one station at a time can't see:

- **Months holding another gauge's data.** Every pair of gauges with 6 or more months in common, month by month: same-hour correlation and the RMS of their difference once the month's mean difference is removed. A month counts when it is under 3 cm RMS and a quarter of the pair's usual RMS, and, for a pair that usually agrees within 3 cm, identical to 2 mm. Pairs that usually agree within a centimeter are listed as gauges `same_as` may be missing, and not checked for copies.
- **Copies of one gauge that disagree.** Each pair of a gauge's stations, month by month, where the RMS reaches 3 cm.
- **Tide timing.** A harmonic fit of the station's whole span (the leading 40 constituents of the standard set, without long-period ones), then the least squares coefficient of the semidiurnal and diurnal bands' time derivatives in observed minus predicted, for each 15-day window. It reports runs of two or more windows that depart from the station's median by 8 minutes or four times its scatter, whichever is more. A clock error moves both bands by the same minutes. Lags past about half an hour come out smaller than they are. Stations with under 6 windows, or whose scatter is over 20 minutes and so have too little tide to time, are listed and skipped, and the diurnal band is left blank where its tide is under 5 cm.
- **Level steps.** Daily means from 20 or more hours, each station less its 4 nearest gauges within 150 km, and a step where the medians of the 30 daily values either side, spanning at most 120 days, differ by 8 cm or more and by three times the spread of the values about them. A step counts for the station when two or more neighbors show it within 5 days with the same sign, and more of them do than don't among those with the values to show it. Stations with fewer than 2 such gauges are listed and skipped.

Gauges whose daily mean follows river flow, a sluice or a canal's management (in the German Bight the Eider, the Kiel Canal, the Leda and the tidal Ems) step against every neighbor, so their steps need a look at the gauge before they count.

The Monthly workflow's `cross-check` job runs the checks after each full refresh of the station lists, on the 2nd or dispatched with no `sources`, over this year and the five before in each region its matrix names, each a box and the sources to read there. Each region's report is in the run's summary and an artifact; a region that fails to read its values reports nothing, and its job can be rerun. Many GESLA records end before the window or partway through it, so it holds only their last years, and a station whose first datum epoch ended before the window, which is all the checks read, is listed rather than checked. Add a region as a matrix entry in [`.github/workflows/monthly.yml`](../../.github/workflows/monthly.yml).

The report's copies of one gauge that disagree and its pairs that `same_as` doesn't link aren't findings; read them in the region's report.

Each region's job also writes its findings to `findings.json` in its artifact, with the run and its time, and the Errata check workflow lists those nothing settles in the errata report ([`scripts/errata-report.ts`](../../scripts/errata-report.ts)), which the [errata runbook](errata-runbook.md) works. A finding changes nothing in the store. It is one of four kinds:

- `offset`: a step and the next one back the other way by about as much, the two adding to less than a quarter of the larger (`offsets` in [`src/findings.ts`](../../src/findings.ts)), within 400 days, as a span the levels sat off, widened by 15 days at each end since the steps' days come from 30-day medians.
- `clock`: a run of tide-timing windows, from the first window's start to the last one's end.
- `step`: a step no other undoes within 400 days in the years checked, 15 days either side of its day: a change of zero, which a datum epoch answers, or an offset that runs past the years checked.
- `copied`: consecutive months a pair of gauges agree far better than usual, one holding the other's data.

A finding whose values a `flagged` or `dropped` erratum covers leaves the next run, since the checks read only good and preliminary values (see [Source errata](sources.md#source-errata)). Every other finding stays until an entry in [`src/cross-check-reviewed.ts`](../../src/cross-check-reviewed.ts) settles it: one of its kind and station, and for `copied` the same pair, at any record of the gauge `same_as` links among those the region reads, whose span holds the finding's, give or take 15 days at each end; an `offset` entry also settles a `step` inside it (`open` in [`src/findings.ts`](../../src/findings.ts)). The entry's reason says what the values show and how that was confirmed, naming the erratum where one answers it. That covers:

- an error a `kept` erratum answers, or one for another record of the gauge than the finding's station;
- a `corrected` erratum, a datum epoch included, since the checks read the values as the source served them, with no offset between epochs;
- real water a neighbor doesn't share, and a step at the start of a datum epoch the source declared, which get no erratum, since an erratum is a report of an error to the agency.

An erratum alone never settles a finding, since one for a different error can cover the same days.

## Evaluations

```bash
npm run evaluate:bsh
```

```bash
npm run evaluate:rws
```

Each writes `docs/results/<source>.json` and prints a Markdown table for the [HRoI evaluation](../hroi-evaluation.md). The RWS one downloads about 50 years of 10-minute data in total the first time, which takes 20–30 minutes.

## Fit calibration

```bash
STILLWELL_STORE=<copy> npm run calibrate:fits
```

Fits a fixed list of CO-OPS reference stations from the store and compares the constants with the ones NOAA publishes for the same gauges, into the [fit calibration](../results/fit-calibration.md) and its `docs/results/fit-calibration.json`. Run it again whenever a change to [`src/fit/`](../../src/fit/) or the engine could move a fit's constants, and commit both files. [`src/fit/calibration-stations.ts`](../../src/fit/calibration-stations.ts) holds the stations, why each is there and the years NOAA analyzed.

It reads a copy of the store in a local directory that `STILLWELL_STORE` names, refuses a URL and the checkout's own `data` by its path, and never writes to the store. The copy needs `stations/coops.parquet`, `stations/years/coops.parquet` and, for each listed station, every year file the fits read, in each of its epochs' directories: NOAA's analysis years, the held-out year, the 19 years before it and the year before those. The script checks that each year file in the copy has a row in the copy's years file with that file's version, and stops where one doesn't, before the fits and again after them, so a copy taken while the store was being written is used only where its years file describes its files. A copy can also mark a station as being written. The reader refuses such a station, so the script drops the marker once that check has passed, and the report names the stations. Marked stations vote for no final year, so the run stops where the source's last year of final values would differ with their rows counted.

NOAA's constants come from the CO-OPS metadata API at each run, through the adapter's paced requests. Each station's entry pins NOAA's comment on its constants, which names the analysis years, and the run stops where the comment differs by a character, until the entry's years are set from the new one. It also stops on an answer that lacks one of NOAA's standard 37 constituents, names one twice, holds an amplitude under zero or a phase outside 0 to 360, or has another number of constituents than the station's entry expects, and where the store holds under two thirds of the hours of a year NOAA analyzed.

One station takes about seven minutes on one core, on a worker thread with the heap and DuckDB limits the store's own fits have ([`src/fit/workers.ts`](../../src/fit/workers.ts)). `--concurrency` sets how many are fitted at once, four by default. Every run fits every station, so the report's stations share one engine, method and final year, and a run in which any station fails writes nothing. `--report` rewrites the Markdown from the JSON without fitting. A test fails while the JSON names another method, set of nodal corrections, candidate list, list of shallow-water compounds, spelling or pinned station than the code has, until the calibration is run again. It doesn't compare the engine's version, which the report names: after a release of the engine the report is of the earlier one until someone runs it again.

## Published files

[`src/store/files.ts`](../../src/store/files.ts) defines every file the store publishes: its path, each column's DuckDB type, whether it can be null, a one-line description, and the sort order, with JSON Schemas for `sources.json` and `errata.json`. The writers in [`src/store/parquet.ts`](../../src/store/parquet.ts) take their columns and types from it, [`test/files.test.ts`](../../test/files.test.ts) writes each file and compares it with its definition, and publish writes it to the store as `datapackage.json`, `sources.schema.json` and `errata.schema.json`. To add or change a column, change its definition there, and the docs that describe it. The site's reference pages render their schema tables from the published `datapackage.json`, so they follow once publish has run. The series files (`obs/`, `predictions/`, `extremes/`, `predicted-extremes/` and `recent/`) are copied out of a scratch table in `parquet.ts` (`createTable`, `appendRows`, `copyOut`), and their readers and the `version` hash (`YEAR_STATS`) name its columns too, so a change to one of those columns needs them changed as well. A column older files lack is `optional`, so readers know to use `union_by_name`. The weekly bucket check runs [`scripts/check-files.ts`](../../scripts/check-files.ts) against the public store, which you can run too:

```bash
node scripts/check-files.ts https://stillwell.openwaters.io
```
