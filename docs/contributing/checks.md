# Checks

## TICON inventory

```bash
npm run ticon:inventory
```

Reads a slackwater-database checkout (`TIDE_DATABASE`, default `../slackwater-database`) and the store's station lists (`STILLWELL_STORE`, default the public bucket over HTTPS, so a local store needs every public source refreshed; restricted sources are left out), and writes the [TICON inventory](../ticon-inventory.md): the store series for each TICON record's originator, where there is one, for every record slackwater-database ships, and how far along each one is.

## Clock check

```bash
npm run clock-check -- 2020 uhslc/329=hong_kong-329-hkg-uhslc_fd uhslc/057=honolulu-1612340-usa-noaa
```

Cross-correlates a year of each station's levels, or the dates given as `<start>/<end>` in place of the year for a source that keeps less (the EA's readings API keeps 30 days), fetched through its adapter with the station as the store's list has it (`STILLWELL_STORE`, default the public bucket, or the adapter's own list when the store has none), against the prediction from a TICON record's constants in a slackwater-database checkout (`TIDE_DATABASE`, default `../slackwater-database`), at lags of up to 3 hours in 10-minute steps, and prints a Markdown table of the best lag. It exits nonzero when a series fits best 30 minutes or more off, or has fewer than 30 days of values to check (or, for a range shorter than a month, values on fewer than all but one of its days, as for SMN's 5), which is how local time labeled UTC, or Hong Kong's early stamps, show up. A positive lag means the stamps run late. A TICON record fitted to the same series only shows a clock that changed since, so check against another originator's record for the same gauge where TICON has one. The semidiurnal tide repeats every 12.42 hours, so a 12-hour error, such as New Zealand or Fiji local time labeled UTC, looks like a lag of under half an hour there; the K1 column, from K1's phase in a fit of the year against TICON's, shows it, and fails the check at 3 hours or more. Values spanning under 183 days are too short to fit K1, so it shows `no K1`, and a lag of 20 minutes or more fails, since that's where a 12-hour error shows.

## Cross-station checks

```bash
npm run cross-check -- 53.2,6.5,55.3,9.2 2000 2027 pegelonline,gesla
```

Reads hourly values (the value within 10 minutes of each hour, `flag` good or preliminary) for every station with levels in a box (`minLat,minLon,maxLat,maxLon`), between two years with the second exclusive, from the sources named or all of them, leaving out stations whose `kind` is `river` or `lake`. It reads the store at `STILLWELL_STORE`, the public bucket by default, or a local directory (not `s3://`), caches each series in `.cache/cross-check/<store>/`, a directory per store, and reads a station again when its `first`, `last` or epoch span changes (delete the directory to read it all again, such as after a `requalify`), and prints a Markdown report for a person to judge. It changes nothing in the store. It reads every datum epoch's files but a held one's, each within its epoch's span, as `matches` does, with no offset between epochs, so a step at an epoch's start can show as one. The report lists the stations left out: with under 60 days of values, or with values but too few near the hour, such as GESLA's WSV records of hourly means, stamped at the half hour. Those records' years are checked only through PEGELONLINE's copy of the gauge. Stations linked by `same_as` count as one gauge, represented by the `preferred` one where it has values here, otherwise the longest; years only another copy holds are left out of the checks that use one station per gauge. Every station is timed, compared with its copies and checked for steps; the copied-month check and the neighbors for steps use one station per gauge. It looks for errors that QC of one station at a time can't see:

- **Months holding another gauge's data.** Every pair of gauges with 6 or more months in common, month by month: same-hour correlation and the RMS of their difference once the month's mean difference is removed. A month counts when it is under 3 cm RMS and a quarter of the pair's usual RMS, and, for a pair that usually agrees within 3 cm, identical to 2 mm. Pairs that usually agree within a centimeter are listed as gauges `same_as` may be missing, and not checked for copies.
- **Copies of one gauge that disagree.** Each pair of a gauge's stations, month by month, where the RMS reaches 3 cm.
- **Tide timing.** A harmonic fit of the station's whole span (the leading 40 constituents of the standard set, without long-period ones), then the least squares coefficient of the semidiurnal and diurnal bands' time derivatives in observed minus predicted, for each 15-day window. It reports runs of two or more windows that depart from the station's median by 8 minutes or four times its scatter, whichever is more. A clock error moves both bands by the same minutes. Lags past about half an hour come out smaller than they are. Stations with under 6 windows, or whose scatter is over 20 minutes and so have too little tide to time, are listed and skipped, and the diurnal band is left blank where its tide is under 5 cm.
- **Level steps.** Daily means from 20 or more hours, each station less its 4 nearest gauges within 150 km, and a step where the medians of the 30 daily values either side, spanning at most 120 days, differ by 8 cm or more and by three times the spread of the values about them. A step counts for the station when two or more neighbors show it within 5 days with the same sign, and more of them do than don't among those with the values to show it. Stations with fewer than 2 such gauges are listed and skipped.

Gauges whose daily mean follows river flow, a sluice or a canal's management (in the German Bight the Eider, the Kiel Canal, the Leda and the tidal Ems) step against every neighbor, so their steps need a look at the gauge before they count.

The Monthly workflow's `cross-check` job runs the checks after each full refresh of the station lists, on the 2nd or dispatched with no `sources`, over this year and the five before in each region its matrix names, each a box and the sources to read there. Each region's report is in the run's summary and an artifact; a region that fails to read its values reports nothing, and its job can be rerun. Many GESLA records end before the window or partway through it, so it holds only their last years, and a station whose first datum epoch ended before the window, which is all the checks read, is listed rather than checked. Read it for findings not yet in an `errata.ts`, check each against another record of the gauge or a neighbor before adding an erratum (see [Source errata](sources.md#source-errata)), and add a region as a matrix entry in [`.github/workflows/monthly.yml`](../../.github/workflows/monthly.yml).

## Evaluations

```bash
npm run evaluate:bsh
```

```bash
npm run evaluate:rws
```

Each writes `docs/results/<source>.json` and prints a Markdown table for the [HRoI evaluation](../hroi-evaluation.md). The RWS one downloads about 50 years of 10-minute data in total the first time, which takes 20–30 minutes.

## Published files

[`src/store/files.ts`](../../src/store/files.ts) defines every file the store publishes: its path, each column's DuckDB type, whether it can be null, a one-line description, and the sort order, with JSON Schemas for `sources.json` and `errata.json`. The writers in [`src/store/parquet.ts`](../../src/store/parquet.ts) take their columns and types from it, [`test/files.test.ts`](../../test/files.test.ts) writes each file and compares it with its definition, and publish writes it to the store as `datapackage.json`, `sources.schema.json` and `errata.schema.json`. To add or change a column, change its definition there, and the docs that describe it. The site's reference pages render their schema tables from the published `datapackage.json`, so they follow once publish has run. The series files (`obs/`, `predictions/`, `extremes/`, `predicted-extremes/` and `recent/`) are copied out of a scratch table in `parquet.ts` (`createTable`, `appendRows`, `copyOut`), and their readers and the `version` hash (`YEAR_STATS`) name its columns too, so a change to one of those columns needs them changed as well. A column older files lack is `optional`, so readers know to use `union_by_name`. The weekly bucket check runs [`scripts/check-files.ts`](../../scripts/check-files.ts) against the public store, which you can run too:

```bash
node scripts/check-files.ts https://stillwell.openwaters.io
```
