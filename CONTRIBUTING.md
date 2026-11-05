# Contributing to water-levels

This repo fetches water levels from each source's own service and writes them as Parquet to the lake. The [README](README.md) covers what's in the lake, and [docs/data.md](docs/data.md) covers how to read it. This file is for running and changing the code. [docs/plan.md](docs/plan.md) has the plan, and [docs/api.md](docs/api.md) the API design.

## Layout

```
src/sources/<source>/  one adapter per source, each with a README on that service's quirks
src/lake/              Parquet writing, merging and paths
src/hroi/              the harmonic representation of inequalities (HRoI), BSH's prediction method
src/                   shared pieces: HTTP and the response cache, the schema, QC, station lists and datum epochs, harmonics
scripts/               ingest.ts, the TICON inventory and the HRoI evaluations
test/                  node:test suites, with recorded responses in test/fixtures/
docs/                  the plan, the API design, the lake's layout and the evaluations
.github/workflows/     CI (ci.yml), the manual ingest against R2 (ingest.yml), and the scheduled ingest-hourly.yml and compact-daily.yml
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

| Command                           | Does                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run check`                   | Everything CI checks: lint, typecheck and tests. Run it before pushing.                        |
| `npm test`                        | The `node:test` suites in `test/`. They use recorded fixtures and make no network calls.       |
| `npm run typecheck`               | `tsc --noEmit`.                                                                                |
| `npm run lint` / `npm run format` | Check / write formatting with Prettier.                                                        |
| `npm run ingest -- <args>`        | `scripts/ingest.ts`: `stations`, `backfill`, `recent` and `compact`, described below.          |
| `npm run ticon:inventory`         | Rewrite `docs/ticon-replacement.md` and its CSV from a tide-database checkout.                 |
| `npm run evaluate:bsh` / `:rws`   | Rerun the HRoI evaluations into `docs/results/`. The RWS one downloads about 50 years of data. |

CI also checks that `package-lock.json` regenerates from `package.json` and that every package resolves from the npm registry.

## Running ingest

`scripts/ingest.ts` has four commands: `stations`, `backfill`, `recent` and `compact`. `stations` refreshes each source's list in the lake, `stations/<source>.parquet`, for every source or the ones named, then writes `stations.parquet` and `sources.json`; it changes no file in the repo. Before writing a list it copies the previous one to `history/stations/<source>/`, with a report of the stations added, retired and changed, which it also prints and adds to a GitHub job summary. It keeps the previous list when the fetch fails, comes back empty or shrinks by half, when a station's terms differ from its source's, when the lake has history for the source but no list, or when more stations changed datum at once than an adapter bug would explain (rerun with `--accept-epochs` after checking them). A station the source stops listing stays, marked inactive. A new source's first refresh starts its list; a source with series in the lake but no list or history is refused rather than started over. A station's datum epochs, and the decisions a person makes about them in the source's `overrides`, are described in [docs/stations.md](docs/stations.md).

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

Merge the last hours from every live station into the source's recent window, which keeps 7 days by default (`--keep-days`). A value seen for the first time gets `received` set to the time of the fetch, and a station whose fetch fails or brings nothing keeps what it had:

```bash
node scripts/ingest.ts recent pegelonline --hours 3
```

Fold the last whole UTC days of the recent window (`--days`, 1 by default, which is yesterday, and at most 6) into each station's year files under `obs/`, each row into its datum epoch's files, carrying `received`. Each year file is read, merged and written whole, so a failed run leaves the file it had, and a file the fold doesn't change isn't written. The window's level and flag win over the file's, except that a value the source hasn't finalized never replaces one it has, such as a verified backfill. Both are judged by the source's own flag, kept as `source_flag`, so QC marking a verified value suspect doesn't unfinalize it:

```bash
node scripts/ingest.ts compact pegelonline --days 6
```

Both print a summary (stations updated, stale and failed, and values written), and add it to the workflow run's page in Actions.

These environment variables choose where it writes:

| Variable                                                  | Means                                                                                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WATER_LEVELS_LAKE`                                       | The lake: a directory, `data` by default, or an `s3://` URL.                                                                                              |
| `WATER_LEVELS_RESTRICTED_LAKE`                            | A separate, private lake for stations whose license bars commercial use. Ingest refuses to write one without it, and refuses one that is the public lake. |
| `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credentials for an `s3://` lake such as R2, the same variables crowd-depth reads. `S3_REGION` defaults to `auto`.                                         |
| `WATER_LEVELS_CACHE`                                      | The response cache, `.cache` by default.                                                                                                                  |

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

The Ingest workflow runs `scripts/ingest.ts` against the public `water-levels` bucket. Only maintainers can start it, and its credentials live in the `lake` environment, which only runs on `main`. Two workflows run on a schedule from the same environment, each source a job of its own: Ingest hourly runs `recent --hours 12` at 17 minutes past each hour, and Compact daily runs `compact --days 6` at 00:45 UTC, so late values, revised flags and a missed night still reach the year files. Both can also be started by hand. Every job that writes one source's files, a manual `backfill`, `recent` or `compact` included, runs in that source's `lake-<source>` concurrency group, so no two rewrite one file at once. `stations` runs in the `lake` group whatever its sources, since every run rebuilds `stations.parquet` from all the lists. It can run beside a source's jobs: one that read the list before a refresh opened an epoch writes the new epoch's rows into the old epoch's files, past its `until`, where readers ignore them, and the next run puts them in the new epoch's files. A run waiting in a group is cancelled when the next one arrives, so while a long backfill holds a source, its hourly runs skip until it's done, and the next one's 12 hours, plus the window's 6 days for compaction, catch up. That goes for a manual run too: one started while the source's scheduled job is running can be cancelled by the next hourly run, so start it when the group is free, and check that it started rather than show as cancelled.

## Gotchas

- **Everything in the public lake is public.** The bucket serves every file in it, so restricted series go only to `WATER_LEVELS_RESTRICTED_LAKE`, and ingest refuses to write one without it. Don't work around that refusal.
- **A station's files keep one datum.** Adapters refuse values in any datum but the station's, and backfill refuses to write into a file recorded in another. When a source moves a station to another reference, the next `ingest stations` opens a datum epoch whose values go to files of their own; a change soon after the last one, or back to an earlier reference, is held, and the run exits nonzero, until a person decides in the source's `overrides` ([docs/stations.md](docs/stations.md)).
- **`.cache/` hides upstream changes.** A historical fetch is served from the cache once it has run, keyed by URL and request body, so delete `.cache/`, or point `WATER_LEVELS_CACHE` at an empty directory, when you need to see what the service returns now.

## Shared conventions

Open Waters' [repository standards](https://github.com/openwatersio/.github/blob/main/REPOSITORY_STANDARDS.md) and [marketing guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/marketing.md) apply here.
