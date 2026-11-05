# Contributing to water-levels

This repo fetches water levels from each source's own service and writes them as Parquet to the lake. The [README](README.md) covers what's in the lake, and [docs/data.md](docs/data.md) covers how to read it. This file is for running and changing the code. [docs/plan.md](docs/plan.md) has the plan, and [docs/api.md](docs/api.md) the API design.

## Layout

```
src/sources/<source>/  one adapter per source, each with a README on that service's quirks
src/lake/              Parquet writing, merging and paths
src/hroi/              the harmonic representation of inequalities (HRoI), BSH's prediction method
src/                   shared pieces: HTTP and the response cache, the schema, QC, station lists and datum epochs, harmonics
scripts/               ingest.ts, the TICON inventory and the HRoI evaluations
stations/<source>/     the committed station files `ingest seed-stations` starts each lake list from; removed once the lake is seeded
test/                  node:test suites, with recorded responses in test/fixtures/
docs/                  the plan, the API design, the lake's layout and the evaluations
.github/workflows/     CI (ci.yml) and the manual ingest against R2 (ingest.yml)
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
| `npm run ingest -- <args>`        | `scripts/ingest.ts`: `stations`, `seed-stations`, `backfill` and `recent`, described below.    |
| `npm run ticon:inventory`         | Rewrite `docs/ticon-replacement.md` and its CSV from a tide-database checkout.                 |
| `npm run evaluate:bsh` / `:rws`   | Rerun the HRoI evaluations into `docs/results/`. The RWS one downloads about 50 years of data. |

CI also checks that `package-lock.json` regenerates from `package.json` and that every package resolves from the npm registry.

## Running ingest

`scripts/ingest.ts` has four commands. `stations` refreshes each source's list in the lake, `stations/<source>.parquet`, for every source or the ones named, then writes `stations.parquet` and `sources.json`; it changes no file in the repo. Before writing a list it copies the previous one to `history/stations/<source>/`, with a report of the stations added, retired and changed, which it also prints and adds to a GitHub job summary. It keeps the previous list when the fetch fails, comes back empty or shrinks by half, when a station's terms differ from its source's, when the lake has history for the source but no list, or when more stations changed datum at once than an adapter bug would explain (rerun with `--accept-epochs` after checking them). A station the source stops listing stays, marked inactive. `seed-stations` writes a source's first list from its committed station files, and refuses when the lake already has one. A station's datum epochs, and the decisions a person makes about them in the source's `overrides`, are described in [docs/stations.md](docs/stations.md).

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

Backfill skips a year whose file is already complete: a past year, asked for whole, whose file has values in every month, runs into the year's last week and holds no preliminary values (`yearDone` in `src/backfill.ts`). So a run cut short, such as by the Ingest workflow's 6-hour cap, doesn't fetch those years again, and `--refetch` fetches every year anyway. A station's first and last years, and years with a missing month, are never complete, so they're fetched every run too. That rule still fetches every year with preliminary values on each run, so a campaign of many runs, such as the USGS record, passes `--skip-written` to skip every whole, ended year that has a file at all, from a listing of each station's files without reading them, and ends at the current year so it never fetches a year still under way. It skips a file whatever it holds, so a year an earlier run wrote only part of, such as `backfill bsh 506P 2026 2028` above, needs `--refetch` or a run without `--skip-written` to fill in. A year a source returns nothing for writes no file, so it's fetched again each run; USGS and CO-OPS ask only within each series' dates, but USACE doesn't yet, so start a USACE backfill near its series' first year.

`--first <file>` runs the stations a file names before the rest: one ID per line, or a CSV with a `replacement_id`, `id` or `station` column, such as `docs/ticon-replacement.csv`, which lists the station matched to every TICON record, accepted or not. A file that names none of the stations stops the run.

```bash
node scripts/ingest.ts backfill usgs all 2007 2026 --skip-written --first docs/ticon-replacement.csv
```

`--shard 2/8` takes the second of eight sets of stations, split by a hash of their IDs so a station's shard never changes, for separate jobs. The Ingest workflow runs one job at a time (`concurrency: lake` keeps one pending and cancels the rest), so there dispatch each shard after the last one finishes. That's how the current year gets backfilled: both modes fetch a year still under way in full on every run, so a run over it never resumes, and it has to be split into shards that each fit in one run, such as `backfill usgs all 2026 2027 --shard 1/3`, then `2/3` and `3/3`. Shards running at once need a matrix workflow, which doesn't exist yet.

Merge the last hours from every live station into the source's recent window, which keeps 7 days by default (`--keep-days`):

```bash
node scripts/ingest.ts recent pegelonline --hours 3
```

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

Reads a tide-database checkout (`TIDE_DATABASE`, default `../slackwater-database`) and the lake's station lists (`WATER_LEVELS_LAKE`, default the public bucket over HTTPS, so a local lake needs every source seeded), and writes [docs/ticon-replacement.md](docs/ticon-replacement.md): which lake source can replace each TICON record tide-database ships, and how far along each one is.

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

The Ingest workflow runs `scripts/ingest.ts` against the public `water-levels` bucket. Only maintainers can start it, and its credentials live in the `lake` environment, which only runs on `main`. Nothing runs on a schedule yet.

## Gotchas

- **Everything in the public lake is public.** The bucket serves every file in it, so restricted series go only to `WATER_LEVELS_RESTRICTED_LAKE`, and ingest refuses to write one without it. Don't work around that refusal.
- **A station's files keep one datum.** Adapters refuse values in any datum but the station's, and backfill refuses to write into a file recorded in another. When a source moves a station to another reference, the next `ingest stations` opens a datum epoch whose values go to files of their own; a change soon after the last one, or back to an earlier reference, is held, and the run exits nonzero, until a person decides in the source's `overrides` ([docs/stations.md](docs/stations.md)).
- **`.cache/` hides upstream changes.** A historical fetch is served from the cache once it has run, keyed by URL and request body, so delete `.cache/`, or point `WATER_LEVELS_CACHE` at an empty directory, when you need to see what the service returns now.

## Shared conventions

Open Waters' [repository standards](https://github.com/openwatersio/.github/blob/main/REPOSITORY_STANDARDS.md) and [marketing guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/marketing.md) apply here.
