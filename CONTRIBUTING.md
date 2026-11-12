# Contributing to Stillwell

This repo fetches water levels from each source's own service and writes them as Parquet to the store. The [README](README.md) covers what's in the store, and [docs/data.md](docs/data.md) covers how to read it. This file is for running and changing the code. [docs/plan.md](docs/plan.md) has the plan, and [docs/api.md](docs/api.md) the API design.

## Layout

```
src/sources/<source>/  one adapter per source, each with a README on that service's quirks
src/store/              Parquet writing, merging and paths
src/hroi/              the harmonic representation of inequalities (HRoI), BSH's prediction method
src/                   shared pieces: HTTP and the response cache, the schema, QC, station lists and datum epochs, harmonics
scripts/               ingest.ts, the weekly canary, the failure alerts, the TICON inventory, the clock check, the cross-station checks and the HRoI evaluations
test/                  node:test suites, with recorded responses in test/fixtures/
workers/cron/          the Cloudflare Worker that starts the scheduled workflows
docs/                  the plan, the API design, the store's layout and the evaluations
.github/workflows/     CI (ci.yml), the manual ingest against R2 (ingest.yml), and the scheduled ingest-hourly.yml, compact-daily.yml, monthly.yml (station lists, refetches, the cross-station report and keeping the schedules enabled), bucket-check.yml (a weekly read of the public bucket) and canary.yml (a weekly live request per adapter)
```

## Getting started

Requires Node 24 or later. CI and local development read the Node version from `.mise.toml`, and `mise install` installs it.

```bash
npm ci
```

```bash
npm run check
```

Ingest writes to `data/` by default and caches every response in `.cache/`, so you can run any adapter locally without credentials. Only the R2 store needs the `S3_*` variables.

## Commands

| Command                           | Does                                                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`                   | Everything CI checks: lint, typecheck and tests. Run it before pushing.                                                            |
| `npm test`                        | The `node:test` suites in `test/`. They use recorded fixtures and make no network calls.                                           |
| `npm run typecheck`               | `tsc --noEmit`.                                                                                                                    |
| `npm run lint` / `npm run format` | Check / write formatting with Prettier.                                                                                            |
| `npm run ingest -- <args>`        | `scripts/ingest.ts`: `stations`, `publish`, `backfill`, `recent`, `compact`, `requalify`, `withhold` and `years`, described below. |
| `npm run ticon:inventory`         | Rewrite `docs/ticon-replacement.md` and its CSV from a tide-database checkout.                                                     |
| `npm run errata`                  | Draft the report to each agency of its errata not yet reported, and check the erratum IDs the code cites.                          |
| `npm run uhslc:contributors`      | Rescan UHSLC's documentation files for each station's contributor and terms.                                                       |
| `npm run gesla:contributors`      | Rewrite docs/gesla-contributors.md from GESLA 4.1's metadata and each contributor's terms.                                         |
| `npm run evaluate:bsh` / `:rws`   | Rerun the HRoI evaluations into `docs/results/`. The RWS one downloads about 50 years of data.                                     |
| `npm run clock-check -- <args>`   | `scripts/clock-check.ts`: check a new series' clock against TICON, described below.                                                |
| `npm run cross-check -- <args>`   | `scripts/cross-check.ts`: compare a region's gauges with each other and with their own tide, described below.                      |

CI also checks that `package-lock.json` regenerates from `package.json` and that every package resolves from the npm registry.

## Running ingest

`scripts/ingest.ts` has nine commands: `stations`, `publish`, `backfill`, `recent`, `compact`, `requalify`, `analyze`, `withhold` and `years`. `stations` refreshes each source's list in the store, `stations/<source>.parquet`, for every source or the ones named, then writes `stations.parquet` and `sources.json`, unless `--no-publish`; `publish` writes only those two, from the lists in the store. Neither changes a file in the repo. Before writing a list it copies the previous one, less any withheld stations, to `history/stations/<source>/`, with a report of the stations added, retired, removed and changed, which it also prints and adds to a GitHub job summary. It keeps the previous list when the fetch fails, comes back empty or shrinks by half, when a station's terms differ from its source's, when the store has history for the source but no list, or when more stations changed datum at once than an adapter bug would explain (rerun with `--accept-epochs`, the Monthly workflow's `accept_epochs`, after checking them). A station the source stops listing stays, marked inactive; a withheld one leaves (see [Withheld stations](#withheld-stations)). A new source's first refresh starts its list; a source with series in the store but no list or history is refused rather than started over. A station's datum epochs, and the decisions about them in the source's `overrides`, are described in [docs/stations.md](docs/stations.md).

```bash
node scripts/ingest.ts stations
```

Backfill stations' observations, extremes and predictions by year, with the end year exclusive. Pass a comma-separated list of station IDs, or `all` for every active station of the source:

```bash
node scripts/ingest.ts backfill rws hoekvanholland 2016 2025
```

```bash
node scripts/ingest.ts backfill bsh 506P 2026 2028
```

```bash
node scripts/ingest.ts backfill pegelonline 5990020 2000 2027
```

```bash
node scripts/ingest.ts backfill uhslc 001,329 1960 2026
```

Backfill skips a year whose file is already complete: a past year, asked for whole, whose file has values in every month, runs into the year's last week and holds no preliminary values (`yearDone` in `src/backfill.ts`). So a run cut short, such as by the Ingest workflow's 6-hour cap, doesn't fetch those years again, and `--refetch` fetches every year anyway. A station's first and last years, and years with a missing month, are never complete, so they're fetched every run too. That rule still fetches every year with preliminary values on each run, so a campaign of many runs, such as the USGS record, passes `--skip-written` to skip every whole, ended year that has a file at all, from a listing of each station's files, and ends at the current year so it never fetches a year still under way. Compaction writes the current year's file for every live station each night, so from 2026 on (`COMPACTED_SINCE`) a year's file counts as written only if it has values in every month or holds values backfill wrote, which takes a read of those years. Compaction began in November 2026, so that year's files need a backfill before `--skip-written` trusts them. Otherwise it skips a file whatever it holds, so a year an earlier run wrote only part of, such as `backfill bsh 506P 2026 2028` above, needs `--refetch` or a run without `--skip-written` to fill in. A year a source returns nothing for writes no file. With `--skip-written`, a source whose metadata sets `empty_means_none` (its adapter throws on an outage rather than answer with nothing; CO-OPS so far) has backfill record a year with no file in `stations/empty/<source>.json` and skip it for 30 days, so a campaign's later runs don't ask again; after that, or without `--skip-written`, it's fetched again, in case the empty answer was an outage. Within a series' dates that still costs a request per year or month: USGS, CO-OPS, UHSLC, Kartverket, SMHI, JMA, the Marine Institute, SFWMD, California DWR and CDEC ask only within each series' dates, REFMAR from each gauge's first observation where SHOM gives one, but USACE doesn't yet, so start a USACE backfill near its series' first year.

`preliminary` in place of the station IDs takes every station, active or not, whose bounds hold a preliminary value, and fetches it from that value's month, or from the start date when that's later, to the end date or the end of the year of its last value, whichever is sooner. The start date is the cutoff: a station whose recorded value is before it is listed, in the output and on the run's page, and fetched only from the cutoff on, if it has values after it. Compaction and backfill look for preliminary values only from three years before this one, the Monthly cutoff, so a station is listed when its value falls behind the cutoff at the turn of a year, or after a killed backfill left it lowered to where its fetch began. Its next read then moves the value to the earliest from the cutoff on, or clears it; a station whose files end before the cutoff has its value cleared there and then. So older values still preliminary are listed once and then left. A `preliminary` run with an earlier start than the cutoff reads from that start, so it sees what it fetched. `--skip-unscreened` leaves out a station with at least a year of record in its current epoch and no value its source screened, kept in the bounds as `screened`, which compaction and backfill set from the files they read (backfill from the cutoff year on). A value counts as screened when its `source_flag` isn't preliminary, or, in a file from before `source_flag`, when its flag is good or interpolated, since a suspect or bad one there may be QC's alone. The Monthly refetch passes it for USACE and REFMAR, some of whose offices screen nothing, except in January, so once a year every station is read again and one whose office began screening rejoins. After fetching a station's levels, and for every station `preliminary` picks, backfill reads its earliest preliminary value in the current epoch again into the bounds, every 100 stations so a run stopped by its time limit keeps most of them, and one the source has finalized drops out. Other backfills first lower each 100 stations' values to where their fetches start, but no earlier than the cutoff year, behind which nothing looks, so a run killed partway leaves them too early, which the next refetch corrects, rather than too late:

```bash
node scripts/ingest.ts backfill coops preliminary 2023 2026-11-01
```

`--first <file>` runs the stations a file names before the rest: one ID per line, or a CSV with a `replacement_id`, `id` or `station` column, such as `docs/ticon-replacement.csv`, which lists the station matched to every TICON record, accepted or not. An unsharded run stops if the file names none of the stations; a shard can hold none of them, so it doesn't.

```bash
node scripts/ingest.ts backfill usgs all 2007 2026 --skip-written --first docs/ticon-replacement.csv
```

`--shard 2/8` takes the second of eight sets of stations, split by a hash of their IDs so a station's shard never changes, for separate jobs. The Ingest workflow runs a source's jobs one at a time, in its `store-<source>` group with that source's hourly and compaction runs, so there dispatch each shard after the last one finishes. A shard holds that group for hours, so the source's hourly runs skip meanwhile, and compaction too if one spans 00:40 UTC. The next hourly run's 12 hours and compaction's 6 days catch up a gap shorter than those, so leave a gap between shards for both to run, or run `compact <source> --days 6` between them; back-to-back shards over more than 6 days lose values from the 7-day window before they reach the year files. That's how the current year gets backfilled: both modes fetch a year still under way in full on every run, so a run over it never resumes, and it has to be split into shards that each fit in one run, such as `backfill usgs all 2026 2027 --shard 1/3`, then `2/3` and `3/3`, each dispatched with `timeout` at 360 minutes, since one stopped partway starts over on its next run. Shards running at once need a matrix workflow, which doesn't exist yet. Every backfill also rewrites the source's whole bounds file, `stations/bounds/<source>.parquet`, after each 100 stations, so two shards writing at once lose each other's preliminary values. Such a workflow has to run them one after another in the source's group, or keep shards from writing the bounds.

Merge the last hours from every live station into the source's recent window, which keeps 7 days by default (`--keep-days`). A value seen for the first time gets `received` set to the time of the fetch, and a station whose fetch fails or brings nothing keeps what it had:

```bash
node scripts/ingest.ts recent pegelonline --hours 3
```

Fold the last whole UTC days of the recent window (`--days`, 1 by default, which is yesterday, and at most 6) into each station's year files under `obs/`, each row into its datum epoch's files, carrying `received`. Each year file is read, merged and written whole, so a failed run leaves the file it had, and a file the fold doesn't change isn't written. The window's level and flag win over the file's, except that a value the source hasn't finalized never replaces one it has, such as a verified backfill. Both are judged by the source's own flag, kept as `source_flag`, so QC marking a verified value suspect doesn't unfinalize it:

```bash
node scripts/ingest.ts compact pegelonline --days 6
```

Then it writes each station's first and last level, over all its epochs, to `stations/bounds/<source>.parquet`, which `stations.parquet` is built from. Compact daily rebuilds it with `publish` once every source's compaction is done. It lists the source's files under `obs/` and reads only the end years it can't take from the fold or the bounds it has; `--rebuild-bounds` reads every station's end years again, as the first run does. Beside them it keeps each station's earliest value in its current epoch that the source sent as preliminary, which `backfill … preliminary` starts from: the one it knows, unless a file it folded holds an earlier one. A station new to the bounds, or every station with `--rebuild-bounds`, has its files read from three years before this one (`REFETCH_YEARS`, the refetch's cutoff) until one holds a preliminary value, at most four files. Bounds an older build wrote have no `preliminary` column, and compaction keeps them that way, since filling it in reads up to four files for every station, more than Compact daily's 50 minutes may hold at USGS. Run `compact <source> --rebuild-bounds` from the Ingest workflow, with a longer `timeout`, to fill it in; until then `backfill … preliminary` refuses to run, and other backfills leave the bounds alone.

Both print a summary (stations updated, stale, failed and waiting on a held datum change, and values written), and add it to the workflow run's page in Actions.

Work the flags of stations' observed levels out again from what the store holds, over the years given (end exclusive), without asking the source, so a change to QC's rules, or to a station's analysis, reaches values already stored. Pass station IDs or `all`, which takes inactive stations too:

```bash
node scripts/ingest.ts requalify smhi all 1880 2027
```

Each year file starts over from its `source_flag` and the errata spans the source's adapter flags (its `suspect`, such as REFMAR's Pointe-à-Pitre clock, or GESLA's datum jumps, which it works out from the store's copy of the record and can't when that ends more than a year inside the record's stated ends, as where GESLA's own file holds nulls there; the record then keeps the flags it has, among them the datum jumps backfill found in GESLA's whole file, gets its `errata.json` spans and the current QC, which can only make a flag worse, so a looser rule or a retired erratum never clears a mark there, and the run lists it under warnings and counts it requalified), then QC runs with the current rules, with the years either side read too, so a flatline or spike across New Year is judged whole. A file is written only when a row changed. A value from before `source_flag` was kept gets it from its flag where that's better than suspect, since QC only marks values suspect or bad; a suspect or bad one may be QC's, so its flag stays until a backfill fetches it again. Backfill QCs the whole year it writes the same way, with the years either side as they are when it runs, though the values it didn't fetch keep their flags; a year written before the one after it existed isn't judged against it again until `requalify` runs. The recent window starts its stored values over from `source_flag` each hour a fetch brings values, except within the longest flatline rule's length of its oldest value, and judges them over its 7 days; compaction folds those flags into the current year's file as they are, so `requalify` there gives flags judged over the whole year. Its summary counts as values the rows whose flag changed, so a first run that only fills in `source_flag` writes files with no values. A station with a file holding more than one datum, or whose source's spans fail for any other reason, fails before any of its files is written. `--shard 2/8` splits `all` as backfill does. Run it from the Ingest workflow, which runs it in the source's group, as it does backfill.

Measure what the store can tell about each station from its levels, and keep it in `stations/analysis/<source>.parquet`: today, whether its levels carry a tide, which picks QC's flatline, outlier and residual-jump rules for it ([docs/stations.md](docs/stations.md#analysis) has the rule). It judges the stations that are due, those with no verdict, a verdict over a year old or one under other rules (`RULES` in `src/store/analysis.ts`, which a change to `qcFor`'s thresholds bumps and which requalifies every station, or `JUDGE`, which a change to the verdict's rules bumps and which requalifies only the stations whose QC changes), or every station with `--all`, and prints those whose QC changes, writing every 500 stations; `--requalify` then requalifies those, and every station after its first verdict, over every year, 100 at a time, marking each batch done, and starts batches only for `--budget` minutes (120 by default), so the source's hourly runs and compaction aren't held off for long; what it doesn't reach, or a run stopped partway leaves, waits for the next. The Monthly workflow runs it for every source it refreshes, before publishing. Run it from the Ingest workflow, which runs it in the source's group:

```bash
node scripts/ingest.ts analyze usgs --requalify --concurrency 8
```

Every run that writes a year file of levels, `backfill`, `compact` and `requalify`, keeps `stations/years/<source>.parquet` in step: each year file with its hours, values by flag and a version, for readers to tell a year with no values from a file they failed to read ([docs/data.md](docs/data.md#which-years-a-station-has)). They mark each batch of stations before writing and set their files' rows after, and compaction then lists the source's files and reads any a stopped run left without a current row ([docs/stations.md](docs/stations.md#store-layout)). A source with files but no years file gets one only from `years`, which reads every year file of levels the source has, and resumes where a run stopped by its time limit left off. `--rebuild-years` reads every file again even when the years file has them, or can't be read; if it's stopped, run `years` again without the flag to finish. Run it from the Ingest workflow, which runs it in the source's group:

```bash
node scripts/ingest.ts years usgs
```

Compaction checks only that every year file has a row and every row a file, not that a row's version still matches its file. Anything that writes year files without keeping the years file leaves rows whose version no longer matches the file, and compaction rereads such a station only if a stopped run left it marked: a rollback to a build from before the years file, a run from an older local checkout, or a restore of `obs/` from a backup. Afterwards, once the current build is back, run `years <source> --rebuild-years` for each source whose files it wrote.

These environment variables choose where it writes:

| Variable                                                  | Means                                                                                                                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STILLWELL_STORE`                                         | The store: a directory, `data` by default, or an `s3://` URL.                                                                                                    |
| `STILLWELL_RESTRICTED_STORE`                              | A separate, private store for sources whose terms bar republishing their data. Ingest refuses to write one without it, and refuses one that is the public store. |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credentials for an `s3://` store such as R2, the same variables crowd-depth reads. `S3_REGION` defaults to `auto`.                                               |
| `STILLWELL_CACHE`                                         | The response cache, `.cache` by default.                                                                                                                         |

Write to R2 only through the Ingest and Monthly workflows. A run from your own machine shares no concurrency group with the scheduled jobs, so it and Ingest hourly or Compact daily can each rewrite a file the other just read, and one's values are lost. That includes the bounds file, which backfill and compaction both rewrite whole.

If a source starts reporting a station in another datum, `ingest stations` opens a datum epoch for it and reports it. A change it holds for a decision (soon after the last one, or back to an earlier reference) fails the run on every refresh until the source's `overrides` decide, and `backfill` and `recent` skip that station meanwhile. `backfill … all` skips inactive stations.

## Withheld stations

A station whose owner refused permission to republish its data is withheld: never listed, fetched or published, and deleted from the store. A source names them with `withheld` (`Source` in `src/schema.ts`). The rule covers UHSLC's records and GESLA's copies of them: UHSLC withholds every series of a station number one of whose documentation files carries a notice marked `refused` in `src/sources/uhslc/notices.ts`, versions the scan hasn't read included, and GESLA every copy of such a series and every record carrying such a notice. `ALSO_WITHHELD`, beside the notices, adds station numbers by hand, with the reason, where another source credits the gauge to a refusing contributor. Today that's the South African Navy Hydrographic Office's ([#80](https://github.com/openwatersio/stillwell/issues/80), [#82](https://github.com/openwatersio/stillwell/issues/82)): 27 stations, GESLA's 25 records of its gauges, UHSLC's Walvis Bay, `uhslc/220`, and UHSLC's Lüderitz, `uhslc/702`. Lüderitz's UHSLC documentation names no contributor, but GESLA names SANHO as originator and SANHO refused "any of our national tide gauge data", so `ALSO_WITHHELD` names 702. A refusal from any other contributor, such as one of GESLA's own, needs a rule of its own.

An adapter refuses to fetch a withheld station, and `backfill`, `recent`, `compact` and `requalify` read the source's list without them, so a list not yet refreshed fetches nothing of theirs. Each refresh drops them from the list it read, from the snapshot it writes of that list, and from the source's bounds, recent window, empty-years record and analysis, with its history, reporting them as removed rather than retired, and leaves them out of the sharp-shrink guard. It refuses to remove more than 5 stations or 2% of the list, whichever is larger, as likelier a wrong rule; `--accept-withheld`, the Monthly workflow's `accept_withheld`, lets that through once a person has checked the rule. While any withheld station the store has known, by the list, its history, the bounds, the recent window or the analysis, still has series files, every refresh's report says to run `withhold`, and the run fails, after writing the list; in the Monthly workflow, the publish job still runs after a failed list job, so `stations.parquet` drops the station either way. `publish` leaves out any the list still has, and doesn't count an erratum naming a withheld station as naming an unknown one. `withhold` deletes their files:

```bash
node scripts/ingest.ts withhold gesla
```

It finds every withheld station the store has known, from the source's list, its history, its bounds, its recent window and the directories of its files, and refuses more than the refresh's limit of those stations unless `--accept-withheld`. Then it deletes each one's directory under `obs/`, `extremes/`, `predictions/` and `predicted-extremes/`, later epochs included, and drops its rows as a refresh does. A local store's are deleted from disk; on R2 the AWS CLI deletes them with the store's `S3_*` credentials, since DuckDB can't delete objects, and refuses any other remote store, such as the public one over HTTPS. Each prefix ends in the station's encoded ID and a slash, so it names that station's directory alone, and an empty ID, `.` or `..` is refused.

To withhold stations in the R2 store once the change is on `main`:

1. Check in Actions that no Ingest, Ingest hourly, Compact daily or Monthly run for those sources, started from `main` before the merge, is still queued or running. Such a run uses the old code, which lists and fetches the withheld stations and could write their files back after `withhold` deletes them.
2. Dispatch Ingest with `withhold <source>` for each source the rule covers, such as `withhold gesla`, then `withhold uhslc`. Each runs in the source's group, so check that it started rather than show as cancelled.
3. Dispatch Monthly with `sources` set to those sources, `gesla uhslc`, which drops them from the lists and publishes `stations.parquet`.
4. Run `npm run ticon:inventory` against the refreshed public store and commit `docs/ticon-replacement.md` and its CSV, so GESLA's copies of withheld records are no longer named.
5. Take withheld stations out of the errata that list them, such as Mossel Bay's FD record in `gesla-uhslc-positions`. `publish` doesn't fail on them meanwhile.

The other order works for steps 2 and 3, since `withhold` finds stations the list no longer has, but this one deletes the values first. Rolling back the release that withholds them would list them again at the next refresh and fetch them again at the next backfill, so a rollback needs these steps repeated once the rule is back. Snapshots in `history/stations/` written before the refresh still list the withheld stations, without any values; neither command rewrites them.

## TICON replacement

```bash
npm run ticon:inventory
```

Reads a tide-database checkout (`TIDE_DATABASE`, default `../slackwater-database`) and the store's station lists (`STILLWELL_STORE`, default the public bucket over HTTPS, so a local store needs every public source refreshed; restricted sources are left out), and writes [docs/ticon-replacement.md](docs/ticon-replacement.md): which store source can replace each TICON record tide-database ships, and how far along each one is.

## Clock check

```bash
npm run clock-check -- 2020 uhslc/329=hong_kong-329-hkg-uhslc_fd uhslc/057=honolulu-1612340-usa-noaa
```

Cross-correlates a year of each station's levels, or the dates given as `<start>/<end>` in place of the year for a source that keeps less (the EA's readings API keeps 30 days), fetched through its adapter with the station as the store's list has it (`STILLWELL_STORE`, default the public bucket, or the adapter's own list when the store has none), against the prediction from a TICON record's constants in a tide-database checkout (`TIDE_DATABASE`, default `../slackwater-database`), at lags of up to 3 hours in 10-minute steps, and prints a Markdown table of the best lag. It exits nonzero when a series fits best 30 minutes or more off, or has fewer than 30 days of values to check, which is how local time labeled UTC, or Hong Kong's early stamps, show up. A positive lag means the stamps run late. A TICON record fitted to the same series only shows a clock that changed since, so check against another originator's record for the same gauge where TICON has one. The semidiurnal tide repeats every 12.42 hours, so a 12-hour error, such as New Zealand or Fiji local time labeled UTC, looks like a lag of under half an hour there; the K1 column, from K1's phase in a fit of the year against TICON's, shows it, and fails the check at 3 hours or more. Values spanning under 183 days are too short to fit K1, so it shows `no K1`, and a lag of 20 minutes or more fails, since that's where a 12-hour error shows.

## Cross-station checks

```bash
npm run cross-check -- 53.2,6.5,55.3,9.2 2000 2027 pegelonline,gesla
```

Reads hourly values (the value within 10 minutes of each hour, `flag` good or preliminary) for every station with levels in a box (`minLat,minLon,maxLat,maxLon`), between two years with the second exclusive, from the sources named or all of them, leaving out stations whose `kind` is `river` or `lake`. It reads the store at `STILLWELL_STORE`, the public bucket by default, or a local directory (not `s3://`), caches each series in `.cache/cross-check/<store>/`, a directory per store, and reads a station again when its `first`, `last` or epoch span changes (delete the directory to read it all again, such as after a `requalify`), and prints a Markdown report for a person to judge. It changes nothing in the store. It reads a station's first datum epoch only, within that epoch's span, and the report lists the stations that have later epochs, whose later values go unchecked, and those left out: with under 60 days of values, or with values but too few near the hour, such as GESLA's WSV records of hourly means, stamped at the half hour. Those records' years are checked only through PEGELONLINE's copy of the gauge. Stations linked by `same_as` count as one gauge, represented by the `preferred` one where it has values here, otherwise the longest; years only another copy holds are left out of the checks that use one station per gauge. Every station is timed, compared with its copies and checked for steps; the copied-month check and the neighbors for steps use one station per gauge. It looks for errors that QC of one station at a time can't see:

- **Months holding another gauge's data.** Every pair of gauges with 6 or more months in common, month by month: same-hour correlation and the RMS of their difference once the month's mean difference is removed. A month counts when it is under 3 cm RMS and a quarter of the pair's usual RMS, and, for a pair that usually agrees within 3 cm, identical to 2 mm. Pairs that usually agree within a centimeter are listed as gauges `same_as` may be missing, and not checked for copies.
- **Copies of one gauge that disagree.** Each pair of a gauge's stations, month by month, where the RMS reaches 3 cm.
- **Tide timing.** A harmonic fit of the station's whole span (the leading 40 constituents of the standard set, without long-period ones), then the least squares coefficient of the semidiurnal and diurnal bands' time derivatives in observed minus predicted, for each 15-day window. It reports runs of two or more windows that depart from the station's median by 8 minutes or four times its scatter, whichever is more. A clock error moves both bands by the same minutes. Lags past about half an hour come out smaller than they are. Stations with under 6 windows, or whose scatter is over 20 minutes and so have too little tide to time, are listed and skipped, and the diurnal band is left blank where its tide is under 5 cm.
- **Level steps.** Daily means from 20 or more hours, each station less its 4 nearest gauges within 150 km, and a step where the medians of the 30 daily values either side, spanning at most 120 days, differ by 8 cm or more and by three times the spread of the values about them. A step counts for the station when two or more neighbors show it within 5 days with the same sign, and more of them do than don't among those with the values to show it. Stations with fewer than 2 such gauges are listed and skipped.

Gauges whose daily mean follows river flow, a sluice or a canal's management (in the German Bight the Eider, the Kiel Canal, the Leda and the tidal Ems) step against every neighbor, so their steps need a look at the gauge before they count.

The Monthly workflow's `cross-check` job runs the checks after each full refresh of the station lists, on the 2nd or dispatched with no `sources`, over this year and the five before in three regions: the German Bight (PEGELONLINE and GESLA), the US East Coast (CO-OPS and GESLA) and Sweden (SMHI and GESLA). Each region's report is in the run's summary and an artifact; a region that fails to read its values reports nothing, and its job can be rerun. Most GESLA records end between 2020 and 2025, so the window holds only their last years, and a station whose first datum epoch ended before the window, which is all the checks read, is listed rather than checked. Read it for findings not yet in an `errata.json`, check each against another record of the gauge or a neighbor before adding an erratum (see [Source errata](#source-errata)), and add a region as a matrix entry in `.github/workflows/monthly.yml`.

## Evaluations

```bash
npm run evaluate:bsh
```

```bash
npm run evaluate:rws
```

Each writes `docs/results/<source>.json` and prints a Markdown table for [docs/hroi-evaluation.md](docs/hroi-evaluation.md). The RWS one downloads about 50 years of 10-minute data in total the first time, which takes 20–30 minutes.

## Adding a source

Each source is a directory in `src/sources/` that exports a `Source` (defined in `src/schema.ts`), registered in `src/sources/index.ts`, with a README on the service's endpoints, limits, datums and license. Its metadata's `contact` says where to report an error in the data: the agency's own mailbox or contact form, never a person's address, with the page that publishes it in the README. Record real responses into `test/fixtures/` for its tests rather than calling the service. Check the source's terms before writing anything to the public store. The store republishes the data, so its `license.redistribution` decides the store: a source whose terms bar republishing goes to the restricted store. Commercial use is a separate tag, `commercial_use`, which the API and products filter on: the source's default, set per station where the terms differ, such as a contributor's own terms in a source that relays other agencies' data. Data the source itself withholds until its owner grants permission isn't listed at all, and nor is data whose owner refused permission (see [Withheld stations](#withheld-stations)).

Registering the source is all the scheduled workflows need. Each picks its sources from the adapters' metadata (`src/sources/jobs.ts`, printed by `node scripts/sources.ts <job>`), so none lists them by hand, apart from the monthly refetch's own arguments for some sources:

- hourly ingest takes the sources whose metadata sets `hourly`, meaning they publish values within hours;
- nightly compaction takes every source with `observations`, and every hourly one;
- the Monthly workflow refreshes every source's list;
- the monthly refetch takes the sources whose metadata sets `finalizes`, meaning values they publish as preliminary become final later. California DWR, which nothing else fetches, has its own case there: every active station again from January of last year. So does BODC, whose months arrive late and in batches: every station's last three years, finished ones included. So does CRMS, whose only source is a weekly export of the whole record that CPRA re-adjusts after field visits: every station in its list, inactive ones included, for its last three years, from one download of the export.

Only sources whose `license.redistribution` is true are scheduled, since the workflows have no restricted store. The workflows run `scripts/sources.ts` without `npm ci`, so nothing an adapter imports may be a package; `test/jobs.test.ts` checks. Until a new source's list is in the store, its hourly and compaction jobs skip it with a note; the Monthly refresh on the 2nd starts the list, or dispatch Monthly with `sources` set to the source after merging to start it at once. The skip shows as a warning on the run's page. A manual refetch of a source with no list yet fails; the scheduled one on the 9th comes after the refresh on the 2nd. The weekly canary's probes in `scripts/canary.ts` are still written per source.

## Source errata

When a source publishes something wrong, such as values on the wrong clock or day, a gauge placed far from where it is, metadata that contradicts the data, or two endpoints that disagree, record it as an erratum, whether the adapter works around it or not. Each source's errata are in `src/sources/<source>/errata.json`, reviewed with the code that handles them; nothing else holds them.

1. Add an entry to the source's `errata.json` (start the file as `{"errata": [], "retired": []}` and import it in `errataFiles` in `src/sources/index.ts`, which the tests check): an `id` (`<source>-<what>`, never reused), the `stations` it affects (store IDs, or `"every station"`), the UTC days of values it's in (`since`, and `until`, the day after the last; leave one out for an open end, both for an error in metadata), what's wrong (`error`), what the store does about it (`handling`: `corrected`, `flagged`, `dropped`, `refused`, `avoided` or `kept`, and `response`, in a sentence or two), and how it was found (`evidence`). A `flagged` entry with stations and a span needs no code: the adapter registry flags that span `suspect` in the levels the store fetches or requalifies (extremes aren't flagged), keeping the source's own flag as `source_flag`. Run `requalify` over the span after it merges to flag the values already in the store, and again after an entry stops being `flagged`, to clear them, once any epoch or offset that replaces the flag is in the store (after the station refresh that applies it).
2. Cite the ID as ``erratum `<id>` `` where the adapter works around the error otherwise. The tests fail on a file that doesn't parse, an ID used twice or retired, and a citation no entry holds.

`publish` puts each station's errata in the `errata` column of `stations.parquet` and writes them to `errata.json`, with a link to the file each is in, and fails the run, after publishing, on an erratum that names a station the store doesn't hold.

Reports go to each agency in its own language, one message covering its errata not yet reported, to the channel in the adapter's `metadata.contact`, and only once a person has approved the text. `npm run errata` drafts that message for each source with entries that have no `reported` date (`npm run errata -- <source>` for some). An entry with a `report` but no `reported` date is held back, and the note says why. Once it's sent, set each entry's `reported` to the day and its `report` to where it went, naming the channel (the agency's contact form or published address), never a person; add the agency's answer to `report` when it comes. When the agency fixes the data, remove the workaround, refetch what it touched, and delete the entry, moving its ID to `retired`.

Anyone can report an error with the **Source error** issue form. A maintainer who agrees adds the entry and closes the issue.

## Ingest on R2

The Ingest workflow runs `scripts/ingest.ts` against the public `water-levels` bucket. Only maintainers can start it, and its credentials live in the `lake` environment, which only runs on `main`. Two workflows run on a schedule from the same environment, each source a job of its own: Ingest hourly runs `recent --hours 12` at 12 minutes past each hour, and Compact daily runs `compact --days 6` at 00:40 UTC, so late values, revised flags and a missed night still reach the year files, then runs `publish` so `stations.parquet` carries the bounds it wrote. Both can also be started by hand. Monthly refreshes each source's list on the 2nd at 01:25 UTC, each in a job of its own in the source's `store-<source>` group, then publishes `stations.parquet` in the `store` group. On the 9th at 03:35 UTC it refetches values the source may have finalized since, with `backfill <source> preliminary` for every source whose metadata sets `finalizes` (all but the five whose metadata sets it false: PEGELONLINE and EA, which never finalize a reading, CDEC, which marks none reviewed, GESLA, a static release, and BSH, which publishes predictions only), JMA's first backfilling every open station from two months back to this month, since nothing else brings its new values, and California DWR, BODC and CRMS instead reading every station again over a fixed span (see Adding a source). The refetch takes each station from its earliest preliminary value, from January three years back on, to this month, or for USGS to this year for a twelfth of its stations each month, by `--shard`, so each station comes round once a year, and a USGS refetch that stops partway needs a rerun within the month, before the shard moves on. Both can be started by hand, for some sources, with `refetch` checked for the second, which fails when none of the sources named finalizes its values; the Ingest workflow refuses `stations`, so lists are refreshed only here, with `accept_epochs` checked to pass `--accept-epochs`. Ingest hourly starts a Monthly refresh of one source, at most once a day counting any dispatched refresh that includes the source (a scheduled Monthly, normally a backup that plans nothing, doesn't count), when `recent` fails a station with `DatumChanged`, which PEGELONLINE's `levels` throws in `recent` when a series' unit changes, and Kartverket's when chart datum moves against NN2000; other sources' datum changes wait for the 2nd. Monthly also keeps the schedules alive: GitHub disables a public repo's scheduled workflows after 60 days without a commit, and enabling each one through the API every month restarts that count; one a maintainer turned off stays off. If GitHub ever disables them anyway, enable each one again from its page in Actions, Monthly first. Every job that writes one source's files, a manual `backfill`, `recent`, `compact` or `withhold` included, runs in that source's `store-<source>` concurrency group, so no two rewrite one file at once. Station lists are refreshed only by Monthly, so a refresh never runs beside another refresh of the same list or the source's other jobs, and `stations.parquet` is published only in the `store` group, by Monthly's or Compact daily's `publish` job or an Ingest `publish`. No source's job takes that group, and a publish runs in about a minute, so it never holds up a backfill; Compact daily's waits for every source's compaction, though, and so for any backfill holding one up. Ingest's other commands without a source run in the `store` group too. A run waiting in a group is cancelled when the next one arrives, so while a long backfill holds a source, its hourly runs skip until it's done, and the next one's 12 hours, plus the window's 6 days for compaction, catch up. That goes for a manual run too: one started while the source's scheduled job is running can be cancelled by the next hourly run, so start it when the group is free, and check that it started rather than show as cancelled.

GitHub's `schedule` trigger runs workflows hours late or not at all, so a Cloudflare Worker, [workers/cron](workers/cron/README.md), starts Ingest hourly, Compact daily and Monthly at those times, and Canary at 07:00 UTC on Mondays, through the `workflow_dispatch` API. Each workflow keeps its `schedule`, five minutes later, as a backup. A scheduled run first looks for a dispatched run that already started on `main` (in the last hour for Ingest hourly, 23 hours for Compact daily, the last day for a Monthly run of the same title, Monthly or Refetch for every source, and the last day for Canary) and runs nothing if it finds one, since a second run would wait in each source's group and cancel any job already waiting there. Bucket check stays on GitHub's schedule alone.

When a source's job fails in two runs of either workflow on `main` in a row, dispatched or scheduled, the workflow's `alert` job (`scripts/alert.sh`) opens an issue titled "Ingest hourly is failing for <source>" or "Compact daily is failing for <source>", and closes it when that job next succeeds. Compact daily's `publish` counts as a source of its own, "Compact daily is failing for publish". It opens one issue per workflow and source at a time. A job cancelled or skipped before its first step, such as one cancelled while it waited on its group, doesn't count either way; any other that didn't succeed, a timeout or a cancelled job that had started included, is a failure. It runs only on a run's first attempt, since a re-run would judge a source by an older result than its latest, and not on a backup that found a dispatched run and skipped.

## Canary

The Canary workflow runs `scripts/canary.ts` each Monday: one small request per adapter, through the adapter's own code and pacing, for a few days at a gauge that has run for years. It fails when an adapter returns no values, or when a response's shape (each JSON path and its types, or for BSH the code that starts each line) has lost a path or gained a type since the shape recorded in `src/sources/<source>/canary.json`. A field the source adds doesn't fail it, and neither does a null where the recording had a value or an object, or a value where it had only null. A source with no recording yet prints its shape and has only to return values. JMA is never recorded (`UNRECORDED`): its paths name the month and its plain text has no shape, so it has only to return values from both its provisional and final sets. The `kuestendaten` probe reads only kuestendaten.de's catalog, which lists every series on the portal, so it isn't recorded either; it fails when the catalog doesn't list a Hamburg Port Authority gauge's water-level file under the gauge's number in UTC+1, and when a file runs past `BACKFILLED_TO` in [kuestendaten.ts](src/sources/pegelonline/kuestendaten.ts): a new half-year to backfill, which stays red until the backfill runs and `BACKFILLED_TO` moves, so any other source's failure in those weeks shares the red run. USGS needs `USGS_API_KEY` as a repository secret, since the canary doesn't run in the `lake` environment, and is skipped without it. Once the adapter handles a change, check the new shape and record it:

```bash
node scripts/canary.ts <source> --record
```

## Gotchas

- **Everything in the public store is public.** The bucket serves every file in it, so a source whose terms bar republishing writes only to `STILLWELL_RESTRICTED_STORE`, and ingest refuses to write one without it. Don't work around that refusal.
- **A station's files keep one datum.** Adapters refuse values in any datum but the station's, and backfill refuses to write into a file recorded in another. When a source moves a station to another reference, the next `ingest stations` opens a datum epoch whose values go to files of their own; a change soon after the last one, or back to an earlier reference, is held, and the run exits nonzero, until it's confirmed or rejected in the source's `overrides`. A zero a source moved without saying gets a datum epoch from the day listed in the source's `overrides.splits` with its erratum ([docs/stations.md](docs/stations.md#when-an-epoch-opens)).
- **`.cache/` hides upstream changes.** A historical fetch is served from the cache once it has run, keyed by URL and request body, so delete `.cache/`, or point `STILLWELL_CACHE` at an empty directory, when you need to see what the service returns now.

## License and CLA

The code is [AGPL-3.0](LICENSE). Every contributor signs the [Contributor License Agreement](CLA.md) before we merge their pull request; the CLA workflow asks on your first one. The CLA lets Open Water Software, LLC move code into MIT packages, such as shared math another project imports, and offer other licenses, while an OSI-approved license stays public. Code another project needs to import belongs in an MIT package, not here, or that project becomes AGPL.

## Review checks

The traps this project has fallen into, for the openwaters-review skill and anyone reviewing a change:

- A change that works around something a source publishes wrong, such as a clock shift, a skipped or refused file, a fixed position or a flagged span, adds an erratum for it and cites its ID (see [Source errata](#source-errata)). A workaround with no erratum hides the error from users of the store and from the agency.
- A store path built from a station ID is read with DuckDB's `read_parquet` or `glob`, which treat `*`, `?` and `[` as wildcards, and `encodeURIComponent` leaves `*` alone. A new read of such a path keeps only the rows or files from that exact path (`filename = true`, as `readObservationFile` and `readYearFiles` do), so an ID like `a*` doesn't read another station's files.
- QC has more than one flatline limit (`flatline_s`, and `centimeter_flatline_s` for a small tide that moves in whole centimeters). Code that reasons about how far a run can reach, such as the recent window's edge, uses the longest that applies, not the default.
- A date parsed from what a source or an errata file writes is checked by turning it back into text, as `src/errata.ts` does: `Date.parse` rolls `2019-02-31` over to 3 March rather than refusing it.
- A write changes only the values its run is about. Backfill rewrites the values it fetched and compaction the days it folds; QC that reads more of the year, for its medians or a run across the edge, leaves the flags of the rest as they were. Only `requalify` changes stored flags it didn't fetch.
- A refresh's guards against the last run need a stored list. `shrankSharply` compares only once that list has 20 active stations, and its live-station check only once it has 20 live ones. The withheld-station limit counts only stations taken out of the stored list, so it limits nothing on a first refresh, and withheld stations in the fetch are dropped with no limit. A first refresh still refuses an empty fetch, a station from another source, a list with no station that has a datum, and more than five datum changes at once, such as epochs opened by `splits` overrides, unless run with `--accept-epochs`. It accepts any other fetch of the source's own stations. A change that adds a guard against the last run's state says what the first run, with nothing stored, accepts.
- Store listings (`listFiles`, and the globs in `highestEpochs`, `exists` and `anyFile`) give no sign that they're complete, and one that comes back short but not empty fails quietly. The years file drops the rows of files the listing missed; it refuses an empty listing only where a row with a year exists. The bounds keep a station the listing misses entirely, except under `--rebuild-bounds`, but narrow `first` and `last` when its end years are missing. A short `highestEpochs` can give a new epoch an id whose files already exist. A refresh with no stored list that misses the history in its glob starts a new list from the fetch instead of refusing. `withhold` finds directories in the listing as well as in rows and history, so a short listing can hide a station whose only trace is its directories. A change that reads a listing says what a short one would do.
- Runs outside the workflows share no concurrency group with the scheduled jobs. A local store directory also has no AWS CLI deletes, and it always lists completely. Code that deletes refuses a store it can't delete from, as `withhold` refuses any store that isn't on S3 or a local directory.

## Shared conventions

Open Waters' [repository standards](https://github.com/openwatersio/.github/blob/main/REPOSITORY_STANDARDS.md) and [marketing guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/marketing.md) apply here.
