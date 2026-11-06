# Contributing to water-levels

This repo fetches water levels from each source's own service and writes them as Parquet to the lake. The [README](README.md) covers what's in the lake, and [docs/data.md](docs/data.md) covers how to read it. This file is for running and changing the code. [docs/plan.md](docs/plan.md) has the plan, and [docs/api.md](docs/api.md) the API design.

## Layout

```
src/sources/<source>/  one adapter per source, each with a README on that service's quirks
src/lake/              Parquet writing, merging and paths
src/hroi/              the harmonic representation of inequalities (HRoI), BSH's prediction method
src/                   shared pieces: HTTP and the response cache, the schema, QC, station lists and datum epochs, harmonics
scripts/               ingest.ts, the weekly canary, the failure alerts, the TICON inventory and the HRoI evaluations
test/                  node:test suites, with recorded responses in test/fixtures/
workers/cron/          the Cloudflare Worker that starts the scheduled workflows
docs/                  the plan, the API design, the lake's layout and the evaluations
.github/workflows/     CI (ci.yml), the manual ingest against R2 (ingest.yml), and the scheduled ingest-hourly.yml, compact-daily.yml, monthly.yml (station lists, refetches and keeping the schedules enabled), bucket-check.yml (a weekly read of the public bucket) and canary.yml (a weekly live request per adapter)
```

## Getting started

Requires Node 24 or later. CI and local development read the Node version from `.mise.toml`, and `mise install` installs it.

```bash
npm ci
```

```bash
npm run check
```

Ingest writes to `data/` by default and caches every response in `.cache/`, so you can run any adapter locally without credentials. Only the R2 lake needs the `S3_*` variables.

## Commands

| Command                           | Does                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `npm run check`                   | Everything CI checks: lint, typecheck and tests. Run it before pushing.                          |
| `npm test`                        | The `node:test` suites in `test/`. They use recorded fixtures and make no network calls.         |
| `npm run typecheck`               | `tsc --noEmit`.                                                                                  |
| `npm run lint` / `npm run format` | Check / write formatting with Prettier.                                                          |
| `npm run ingest -- <args>`        | `scripts/ingest.ts`: `stations`, `publish`, `backfill`, `recent` and `compact`, described below. |
| `npm run ticon:inventory`         | Rewrite `docs/ticon-replacement.md` and its CSV from a tide-database checkout.                   |
| `npm run evaluate:bsh` / `:rws`   | Rerun the HRoI evaluations into `docs/results/`. The RWS one downloads about 50 years of data.   |

CI also checks that `package-lock.json` regenerates from `package.json` and that every package resolves from the npm registry.

## Running ingest

`scripts/ingest.ts` has five commands: `stations`, `publish`, `backfill`, `recent` and `compact`. `stations` refreshes each source's list in the lake, `stations/<source>.parquet`, for every source or the ones named, then writes `stations.parquet` and `sources.json`, unless `--no-publish`; `publish` writes only those two, from the lists in the lake. Neither changes a file in the repo. Before writing a list it copies the previous one to `history/stations/<source>/`, with a report of the stations added, retired and changed, which it also prints and adds to a GitHub job summary. It keeps the previous list when the fetch fails, comes back empty or shrinks by half, when a station's terms differ from its source's, when the lake has history for the source but no list, or when more stations changed datum at once than an adapter bug would explain (rerun with `--accept-epochs`, the Monthly workflow's `accept_epochs`, after checking them). A station the source stops listing stays, marked inactive. A new source's first refresh starts its list; a source with series in the lake but no list or history is refused rather than started over. A station's datum epochs, and the decisions a person makes about them in the source's `overrides`, are described in [docs/stations.md](docs/stations.md).

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

Backfill skips a year whose file is already complete: a past year, asked for whole, whose file has values in every month, runs into the year's last week and holds no preliminary values (`yearDone` in `src/backfill.ts`). So a run cut short, such as by the Ingest workflow's 6-hour cap, doesn't fetch those years again, and `--refetch` fetches every year anyway. A station's first and last years, and years with a missing month, are never complete, so they're fetched every run too. That rule still fetches every year with preliminary values on each run, so a campaign of many runs, such as the USGS record, passes `--skip-written` to skip every whole, ended year that has a file at all, from a listing of each station's files, and ends at the current year so it never fetches a year still under way. Compaction writes the current year's file for every live station each night, so from 2026 on (`COMPACTED_SINCE`) a year's file counts as written only if it has values in every month or holds values backfill wrote, which takes a read of those years. Compaction began in November 2026, so that year's files need a backfill before `--skip-written` trusts them. Otherwise it skips a file whatever it holds, so a year an earlier run wrote only part of, such as `backfill bsh 506P 2026 2028` above, needs `--refetch` or a run without `--skip-written` to fill in. A year a source returns nothing for writes no file, so it's fetched again each run; USGS and CO-OPS ask only within each series' dates, but USACE doesn't yet, so start a USACE backfill near its series' first year.

`preliminary` in place of the station IDs takes every station, active or not, whose bounds hold a preliminary value, and fetches it from that value's month, or from the start date when that's later, to the end date or the end of the year of its last value, whichever is sooner. The start date is the cutoff: a station whose recorded value is before it is listed, in the output and on the run's page, and fetched only from the cutoff on, if it has values after it. Compaction and backfill look for preliminary values only from three years before this one, the Monthly cutoff, so a station is listed when its value falls behind the cutoff at the turn of a year, or after a killed backfill left it lowered to where its fetch began. Its next read then moves the value to the earliest from the cutoff on, or clears it, so older values still preliminary are listed once and then left. `--skip-unscreened` leaves out a station with at least a year of record in its current epoch and no value its source screened, kept in the bounds as `screened`, which compaction and backfill set from the files they read (backfill from the cutoff year on). A value counts as screened when its `source_flag` isn't preliminary, or, in a file from before `source_flag`, when its flag is good or interpolated, since a suspect or bad one there may be QC's alone. The Monthly refetch passes it for USACE, some of whose offices screen nothing, except in January, so once a year every station is read again and one whose office began screening rejoins. After fetching a station's levels, and for every station `preliminary` picks, backfill reads its earliest preliminary value in the current epoch again into the bounds, every 100 stations so a run stopped by its time limit keeps most of them, and one the source has finalized drops out. Other backfills first lower each 100 stations' values to where their fetches start, so a run killed partway leaves them too early, which the next refetch corrects, rather than too late:

```bash
node scripts/ingest.ts backfill coops preliminary 2023 2026-11-01
```

`--first <file>` runs the stations a file names before the rest: one ID per line, or a CSV with a `replacement_id`, `id` or `station` column, such as `docs/ticon-replacement.csv`, which lists the station matched to every TICON record, accepted or not. An unsharded run stops if the file names none of the stations; a shard can hold none of them, so it doesn't.

```bash
node scripts/ingest.ts backfill usgs all 2007 2026 --skip-written --first docs/ticon-replacement.csv
```

`--shard 2/8` takes the second of eight sets of stations, split by a hash of their IDs so a station's shard never changes, for separate jobs. The Ingest workflow runs a source's jobs one at a time, in its `lake-<source>` group with that source's hourly and compaction runs, so there dispatch each shard after the last one finishes. A shard holds that group for hours, so the source's hourly runs skip meanwhile, and compaction too if one spans 00:40 UTC. The next hourly run's 12 hours and compaction's 6 days catch up a gap shorter than those, so leave a gap between shards for both to run, or run `compact <source> --days 6` between them; back-to-back shards over more than 6 days lose values from the 7-day window before they reach the year files. That's how the current year gets backfilled: both modes fetch a year still under way in full on every run, so a run over it never resumes, and it has to be split into shards that each fit in one run, such as `backfill usgs all 2026 2027 --shard 1/3`, then `2/3` and `3/3`, each dispatched with `timeout` at 360 minutes, since one stopped partway starts over on its next run. Shards running at once need a matrix workflow, which doesn't exist yet. Every backfill also rewrites the source's whole bounds file, `stations/bounds/<source>.parquet`, after each 100 stations, so two shards writing at once lose each other's preliminary values. Such a workflow has to run them one after another in the source's group, or keep shards from writing the bounds.

Merge the last hours from every live station into the source's recent window, which keeps 7 days by default (`--keep-days`). A value seen for the first time gets `received` set to the time of the fetch, and a station whose fetch fails or brings nothing keeps what it had:

```bash
node scripts/ingest.ts recent pegelonline --hours 3
```

Fold the last whole UTC days of the recent window (`--days`, 1 by default, which is yesterday, and at most 6) into each station's year files under `obs/`, each row into its datum epoch's files, carrying `received`. Each year file is read, merged and written whole, so a failed run leaves the file it had, and a file the fold doesn't change isn't written. The window's level and flag win over the file's, except that a value the source hasn't finalized never replaces one it has, such as a verified backfill. Both are judged by the source's own flag, kept as `source_flag`, so QC marking a verified value suspect doesn't unfinalize it:

```bash
node scripts/ingest.ts compact pegelonline --days 6
```

Then it writes each station's first and last level, over all its epochs, to `stations/bounds/<source>.parquet`, which `stations.parquet` is built from on its next rebuild. It lists the source's files under `obs/` and reads only the end years it can't take from the fold or the bounds it has; `--rebuild-bounds` reads every station's end years again, as the first run does. Beside them it keeps each station's earliest value in its current epoch that the source sent as preliminary, which `backfill … preliminary` starts from: the one it knows, unless a file it folded holds an earlier one. A station new to the bounds, or every station with `--rebuild-bounds`, has its files read from three years before this one (`REFETCH_YEARS`, the refetch's cutoff) until one holds a preliminary value, at most four files. Bounds an older build wrote have no `preliminary` column, and compaction keeps them that way, since filling it in reads up to four files for every station, more than Compact daily's 50 minutes may hold at USGS. Run `compact <source> --rebuild-bounds` from the Ingest workflow, with a longer `timeout`, to fill it in; until then `backfill … preliminary` refuses to run, and other backfills leave the bounds alone.

Both print a summary (stations updated, stale, failed and waiting on a held datum change, and values written), and add it to the workflow run's page in Actions.

These environment variables choose where it writes:

| Variable                                                  | Means                                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WATER_LEVELS_LAKE`                                       | The lake: a directory, `data` by default, or an `s3://` URL.                                                                                              |
| `WATER_LEVELS_RESTRICTED_LAKE`                            | A separate, private lake for stations whose license bars commercial use. Ingest refuses to write one without it, and refuses one that is the public lake. |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credentials for an `s3://` lake such as R2, the same variables crowd-depth reads. `S3_REGION` defaults to `auto`.                                         |
| `WATER_LEVELS_CACHE`                                      | The response cache, `.cache` by default.                                                                                                                  |

Write to R2 only through the Ingest and Monthly workflows. A run from your own machine shares no concurrency group with the scheduled jobs, so it and Ingest hourly or Compact daily can each rewrite a file the other just read, and one's values are lost. That includes the bounds file, which backfill and compaction both rewrite whole.

If a source starts reporting a station in another datum, `ingest stations` opens a datum epoch for it and reports it. A change it holds for a person (soon after the last one, or back to an earlier reference) fails the run on every refresh until the source's `overrides` decide, and `backfill` and `recent` skip that station meanwhile. `backfill … all` skips inactive stations.

## TICON replacement

```bash
npm run ticon:inventory
```

Reads a tide-database checkout (`TIDE_DATABASE`, default `../slackwater-database`) and the lake's station lists (`WATER_LEVELS_LAKE`, default the public bucket over HTTPS, so a local lake needs every source refreshed), and writes [docs/ticon-replacement.md](docs/ticon-replacement.md): which lake source can replace each TICON record tide-database ships, and how far along each one is.

## Evaluations

```bash
npm run evaluate:bsh
```

```bash
npm run evaluate:rws
```

Each writes `docs/results/<source>.json` and prints a Markdown table for [docs/hroi-evaluation.md](docs/hroi-evaluation.md). The RWS one downloads about 50 years of 10-minute data in total the first time, which takes 20–30 minutes.

## Adding a source

Each source is a directory in `src/sources/` that exports a `Source` (defined in `src/schema.ts`), registered in `src/sources/index.ts`, with a README on the service's endpoints, limits, datums and license. Record real responses into `test/fixtures/` for its tests rather than calling the service. Check the source's license before writing anything to the public lake: a station whose license bars commercial use goes to the restricted lake, and its `commercial_use` must say so.

## Ingest on R2

The Ingest workflow runs `scripts/ingest.ts` against the public `water-levels` bucket. Only maintainers can start it, and its credentials live in the `lake` environment, which only runs on `main`. Two workflows run on a schedule from the same environment, each source a job of its own: Ingest hourly runs `recent --hours 12` at 12 minutes past each hour, and Compact daily runs `compact --days 6` at 00:40 UTC, so late values, revised flags and a missed night still reach the year files. Both can also be started by hand. Monthly refreshes each source's list on the 2nd at 01:25 UTC, each in a job of its own in the source's `lake-<source>` group, then publishes `stations.parquet` in the `lake` group. On the 9th at 03:35 UTC it refetches values the source may have finalized since, with `backfill <source> preliminary` for every source but PEGELONLINE, whose feed never finalizes a value: each station from its earliest preliminary value, from January three years back on, to this month, or for USGS to this year for a twelfth of its stations each month, by `--shard`, so each station comes round once a year, and a USGS refetch that stops partway needs a rerun within the month, before the shard moves on. Both can be started by hand, for some sources, with `refetch` checked for the second, which refuses `pegelonline`; the Ingest workflow refuses `stations`, so lists are refreshed only here, with `accept_epochs` checked to pass `--accept-epochs`. Ingest hourly starts a Monthly refresh of one source, at most once a day counting any dispatched refresh that includes the source (a scheduled Monthly, normally a backup that plans nothing, doesn't count), when `recent` fails a station with `DatumChanged`, which only PEGELONLINE's `levels` throws in `recent`; other sources' datum changes wait for the 2nd. Monthly also keeps the schedules alive: GitHub disables a public repo's scheduled workflows after 60 days without a commit, and enabling each one through the API every month restarts that count; one a maintainer turned off stays off. If GitHub ever disables them anyway, enable each one again from its page in Actions, Monthly first. Every job that writes one source's files, a manual `backfill`, `recent` or `compact` included, runs in that source's `lake-<source>` concurrency group, so no two rewrite one file at once. Station lists are refreshed only by Monthly, so a refresh never runs beside another refresh of the same list or the source's other jobs, and `stations.parquet` is published only in the `lake` group, by Monthly's `publish` job or an Ingest `publish`. Ingest's other commands without a source run in the `lake` group too. A run waiting in a group is cancelled when the next one arrives, so while a long backfill holds a source, its hourly runs skip until it's done, and the next one's 12 hours, plus the window's 6 days for compaction, catch up. That goes for a manual run too: one started while the source's scheduled job is running can be cancelled by the next hourly run, so start it when the group is free, and check that it started rather than show as cancelled.

GitHub's `schedule` trigger runs workflows hours late or not at all, so a Cloudflare Worker, [workers/cron](workers/cron/README.md), starts Ingest hourly, Compact daily and Monthly at those times, and Canary at 07:00 UTC on Mondays, through the `workflow_dispatch` API. Each workflow keeps its `schedule`, five minutes later, as a backup. A scheduled run first looks for a dispatched run that already started on `main` (in the last hour for Ingest hourly, 23 hours for Compact daily, the last day for a Monthly run of the same title, Monthly or Refetch for every source, and the last day for Canary) and runs nothing if it finds one, since a second run would wait in each source's group and cancel any job already waiting there. Bucket check stays on GitHub's schedule alone.

When a source's job fails in two runs of either workflow on `main` in a row, dispatched or scheduled, the workflow's `alert` job (`scripts/alert.sh`) opens an issue titled "Ingest hourly is failing for <source>" or "Compact daily is failing for <source>", and closes it when that job next succeeds. It opens one issue per workflow and source at a time. A job cancelled or skipped before its first step, such as one cancelled while it waited on its group, doesn't count either way; any other that didn't succeed, a timeout or a cancelled job that had started included, is a failure. It runs only on a run's first attempt, since a re-run would judge a source by an older result than its latest, and not on a backup that found a dispatched run and skipped.

## Canary

The Canary workflow runs `scripts/canary.ts` each Monday: one small request per adapter, through the adapter's own code and pacing, for a few days at a gauge that has run for years. It fails when an adapter returns no values, or when a response's shape (each JSON path and its types, or for BSH the code that starts each line) has lost a path or gained a type since the shape recorded in `src/sources/<source>/canary.json`. A field the source adds doesn't fail it, and neither does a null where the recording had a value or an object, or a value where it had only null. A source with no recording yet, USGS for now, prints its shape and has only to return values. USGS is skipped until `USGS_API_KEY` is set as a repository secret, since the canary doesn't run in the `lake` environment. Once the adapter handles a change, check the new shape and record it:

```bash
node scripts/canary.ts usgs --record
```

## Gotchas

- **Everything in the public lake is public.** The bucket serves every file in it, so restricted series go only to `WATER_LEVELS_RESTRICTED_LAKE`, and ingest refuses to write one without it. Don't work around that refusal.
- **A station's files keep one datum.** Adapters refuse values in any datum but the station's, and backfill refuses to write into a file recorded in another. When a source moves a station to another reference, the next `ingest stations` opens a datum epoch whose values go to files of their own; a change soon after the last one, or back to an earlier reference, is held, and the run exits nonzero, until a person decides in the source's `overrides` ([docs/stations.md](docs/stations.md)).
- **`.cache/` hides upstream changes.** A historical fetch is served from the cache once it has run, keyed by URL and request body, so delete `.cache/`, or point `WATER_LEVELS_CACHE` at an empty directory, when you need to see what the service returns now.

## Shared conventions

Open Waters' [repository standards](https://github.com/openwatersio/.github/blob/main/REPOSITORY_STANDARDS.md) and [marketing guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/marketing.md) apply here.
