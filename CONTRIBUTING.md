# Contributing to water-levels

This repo fetches water levels from each source's own service and writes them as Parquet to the lake. The [README](README.md) covers what's in the lake and how to run ingest, and [docs/data.md](docs/data.md) covers how to read it. This file is for changing the code.

## Layout

```
src/sources/<source>/  one adapter per source, each with a README on that service's quirks
src/lake/              Parquet writing, merging and paths
src/hroi/              the harmonic representation of inequalities (HRoI), BSH's prediction method
src/                   shared pieces: HTTP and the response cache, the schema, QC, station files, harmonics
scripts/               ingest.ts, the TICON inventory and the HRoI evaluations
stations/              each source's committed station list, refreshed by `ingest stations`
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
| `npm run ingest -- <args>`        | `scripts/ingest.ts`: `stations`, `backfill` and `recent`, as the README describes.             |
| `npm run ticon:inventory`         | Rewrite `docs/ticon-replacement.md` and its CSV from a tide-database checkout.                 |
| `npm run evaluate:bsh` / `:rws`   | Rerun the HRoI evaluations into `docs/results/`. The RWS one downloads about 50 years of data. |

CI also checks that `package-lock.json` regenerates from `package.json` and that every package resolves from the npm registry.

## Adding a source

Each source is a directory in `src/sources/` that exports a `Source` (defined in `src/schema.ts`), registered in `src/sources/index.ts`, with a README on the service's endpoints, limits, datums and license. Record real responses into `test/fixtures/` for its tests rather than calling the service. Check the source's license before writing anything to the public lake: a station whose license bars commercial use goes to the restricted lake, and its `commercial_use` must say so.

## Running ingest against R2

The Ingest workflow runs `scripts/ingest.ts` against the public `water-levels` bucket. Only maintainers can start it, and its credentials live in the `lake` environment, which only runs on `main`. Nothing runs on a schedule yet.

## Gotchas

- **Everything in the public lake is public.** The bucket serves every file in it, so restricted series go only to `WATER_LEVELS_RESTRICTED_LAKE`, and ingest refuses to write one without it. Don't work around that refusal.
- **A station keeps one datum.** Adapters refuse values in any other datum, and backfill refuses to write into a file recorded in another. If a source changes a station's datum, `ingest stations` exits nonzero so a person can decide what to do.
- **`.cache/` hides upstream changes.** A historical fetch is served from the cache once it has run, keyed by URL and request body, so delete `.cache/`, or point `WATER_LEVELS_CACHE` at an empty directory, when you need to see what the service returns now.

## Shared conventions

Open Waters' [repository standards](https://github.com/openwatersio/.github/blob/main/REPOSITORY_STANDARDS.md) and [marketing guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/marketing.md) apply here.
