# Contributing to Stillwell

This repo fetches water levels from each source's own service and writes them as Parquet to the store. The [README](README.md) covers what's in the store, and the [docs site](https://openwatersio.github.io/stillwell/docs/) covers how to read it. This file is for running and changing the code. The [roadmap](docs/plans/plan.md) has what comes next, and the [API design](docs/plans/api.md) the planned API.

## Rigor

Researchers use this data to study sea level, tides and floods. A wrong value that looks right does more harm than a gap, because nobody knows to distrust it. Bad data is worse than no data. Scientific accuracy, completeness and rigor come before speed, and a change isn't done until it's right, however long that takes. Every contributor, person or agent, works to these rules, and reviewers hold changes to them.

- **Check all of it, not a sample.** A spot check can find a problem but can't show there isn't one. A claim about every station, record, year or source rests on a check of every one. Where only a sample was possible, say how many of how many, and the claim stays "checked n of N", never "all". When one source, station or file turns out wrong, check every other one that could be wrong the same way before calling it isolated.
- **Verify against data, not code.** Tests passing and code that looks right don't show the store is right. Read back what a run wrote: the files, their years, their flags, a plot against a neighbor or a prediction. Before review, read back a local run; after merge, read back what the workflows wrote to R2, as a `check` step of the change's migration (see [Migrations](docs/contributing/operations.md#migrations)) or a step listed under `## After merge` in the pull request's description, or for a restricted source what a maintainer's run wrote to the restricted store. A change that writes to the store is done when both are.
- **Check science against an independent reference.** A new source, station type or conversion has its datums, units and time zone confirmed in the agency's own documentation, cited in the source's README, and its levels checked against something the source didn't produce. For levels that carry a tide, river gauges included, that's `clock-check` against another originator's TICON record where there is one (see [Clock check](docs/contributing/checks.md#clock-check)), which catches a clock that neighbors from the same agency would share. `cross-check` compares a gauge with its neighbors but leaves out stations whose `kind` is `river` or `lake`, so for those the comparison is with a neighboring gauge on the same water, or another agency's record of the same one, done by hand. Agreement with the source's own metadata isn't independent. Where no independent reference exists, the source's README says so, and which checks the data has had.
- **Research facts, don't guess them.** Agency names, datums, units, terms and station metadata come from the agency's own pages or data, cited. If a search, a page read or a data probe would settle a question, do it rather than ask or assume. If you can't confirm a fact, write "not confirmed" and treat it as a blocker until the steps in the last rule below are exhausted.
- **Policy decisions stand; precedent proves nothing.** A maintainer's decision on policy, such as a permission, a source's terms or how a license applies, stands; don't reopen it in each change. Everything else earlier work did, in code, `overrides` or errata, is not evidence that it's right. A change judges each value on its own evidence, and "it was done this way before" is never the justification. When the evidence shows an earlier choice was wrong, raise it and fix it, and check whatever else made the same choice. A decision that is genuinely open, such as a source's terms or a trade-off in the data, goes to a maintainer before the work is called done, and a pull request opened with one still open is a draft.
- **Finish the whole job.** Partial coverage, such as some stations, some years or some sources, leaves holes in the store that nobody knows about. Work the task needs isn't a follow-up. The history of a source that still publishes isn't complete without the current year. A backfill ending at the current year leaves it out, since end years are exclusive, so it gets a run of its own, split into shards where one run can't hold it (see [Running ingest](docs/contributing/ingest.md)). Only work that is genuinely blocked goes under a pull request's known limitations, naming what's missing and why.
- **Review until it's clean.** Verify every finding against the code or the data before fixing or dismissing it. Fixes from a review round get another round, so no fix ships unreviewed. If findings of high or medium severity remain after three rounds, the change goes back to a maintainer with the open findings, as a draft pull request at most.
- **Report what was done, as it was done.** Say what was checked, how and over what, and what wasn't. Never round "most" up to "all", or "should" up to "does".
- **Leave it out only as a last resort.** Work to get every value right first: research the source's documentation, check against independent references, compare with other records of the gauge, and ask the agency through its contact. A value whose clock, datum, unit, position or owner still can't be confirmed after all of that isn't published as if it were sound. Flag it, drop it or refuse it, record why in an erratum, and report it to the agency. A value can be kept with an erratum whose handling is `kept`, which tells users what's wrong with it, only where its own evidence supports keeping it. Never fill an unknown with a plausible default.

## Where facts live

Every fact has one home, and everything else links to it. A fact about one source lives in its directory, `src/sources/<source>/`: its metadata and `schedule` in `index.ts`, its decisions in `overrides`, its known errors in `errata.ts`, its canary probe in `canary.ts`, and the rest in its README. Shared code, workflows, server config, this file, its guides and the site's guides describe how a mechanism works for every source and read the source's part from its directory. They never list sources.

- **Adding a source touches its directory and nothing else**, apart from its entries in the registry ([`src/sources/index.ts`](src/sources/index.ts)), its tests and fixtures, and, for a source that needs a key, its secret in each workflow step that runs its adapter and, for an hourly source, in the live Worker's secrets (`workers/live/index.ts` and [its README](workers/live/README.md)). A change that needs anything more is missing a metadata field or a hook in the `Source` interface ([`src/schema.ts`](src/schema.ts)): add that first, move every source that needs it over, then use it.
- **Code outside `src/sources/` shouldn't branch on a source.** A shell `case` on a source, a `matrix.source == '<id>'`, an `if (id === …)` or a table keyed by source ID is a field the adapter should declare. Don't add one, and move one you touch into the adapter. Decision tables keyed by station ID, such as `KINDS` and `POSITIONS`, and tables about how sources relate, such as `same-as.ts`, are the exception.
- **Shared docs state the rule, not the cases.** "The monthly refetch reads each station from its earliest preliminary value, unless the source's `schedule` says otherwise" stays true when a source is added; "So does BODC… So does CRMS…" doesn't. One source as an example is fine; a list that tries to be complete belongs in each source's own files.
- **Durable text describes what is, not what's happening now.** A count that changes with every refresh, a status such as "until the poller reads another source" or "while permission is pending", or a plan for later goes in an issue or the pull request, where it can be closed.
- **Say it once.** When the same fact is in two places, delete one and link to the other, rather than update both.

[`test/facts.test.ts`](test/facts.test.ts) checks that this file, the guides in `docs/contributing/`, `site/README.md`, the workflows, `scripts/monthly.sh` name no more than two sources on a line, that `scripts/monthly.sh` and the workflows have no `case` arm or `==` test on a source ID, that no site guide gives sources bullets of their own, and that every source has its own canary probe. It doesn't read TypeScript outside `src/sources/`.

## Layout

```
src/sources/<source>/  one adapter per source, each with a README on that service's quirks
src/store/              Parquet writing, merging and paths, and the definition of every published file (files.ts)
src/hroi/              the harmonic representation of inequalities (HRoI), BSH's prediction method
src/realtime/          the poller's live store client, poll and schedule (workers/live/README.md)
src/jobs/              the migrations' format and the checks on the commands a step runs
src/migrations/        the store work each merged change needs, which the Migrations workflow runs (see docs/contributing/operations.md)
src/api/               the levels API's parameters, datum conversion and responses
server/                the poller (ingest.ts), its passes (pass.ts) and its daily-file export (export.ts), which run in workers/live's container
src/                   shared pieces: HTTP, anonymous FTP and the response cache, the schema, QC, station lists and datum epochs, harmonics
scripts/               ingest.ts, the weekly canary, the failure alerts, the TICON inventory, the clock check, the cross-station checks and the HRoI evaluations
test/                  node:test suites, with recorded responses in test/fixtures/
workers/cron/          the Cloudflare Worker that starts the scheduled workflows, Migrations included
workers/live/          the Cloudflare Worker and container that run the poller, with the D1 database of live values
workers/api/           the Cloudflare Worker that caches and serves levels at api.openwaters.io
docs/                  the contributing guides (docs/contributing/), the plan, the API design, the store's layout and the evaluations
site/                  the site for people using the data: its docs and a page per source (Astro)
.github/workflows/     CI (ci.yml), the manual ingest against R2 (ingest.yml), and the scheduled compact-daily.yml, monthly.yml (station lists, refetches, each source's own backfills, level matches for linking, the cross-station report and keeping the schedules enabled), bucket-check.yml (a weekly read of the public bucket, and a check of a sample of its files against their definitions), errata-check.yml (each erratum's check after every full Monthly run, with an issue for each that fails), site.yml (the site's build and its deploy to GitHub Pages) and canary.yml (a weekly live request per adapter)
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

| Command                           | Does                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run check`                   | Everything CI checks: lint, typecheck and tests. Run it before pushing.                                                                                                                                                  |
| `npm test`                        | The `node:test` suites in [`test/`](test/). They use recorded fixtures and make no network calls.                                                                                                                        |
| `npm run errata:check`            | Check that the store holds what each erratum says (see [Source errata](docs/contributing/sources.md#source-errata)).                                                                                                     |
| `npm run typecheck`               | `tsc --noEmit`.                                                                                                                                                                                                          |
| `npm run lint` / `npm run format` | Check / write formatting with Prettier.                                                                                                                                                                                  |
| `npm run ingest -- <args>`        | [`scripts/ingest.ts`](scripts/ingest.ts): `stations`, `publish`, `backfill`, `compact`, `requalify`, `analyze`, `withhold`, `drop`, `misplaced` and `years`, described in [Running ingest](docs/contributing/ingest.md). |
| `npm run ticon:inventory`         | Rewrite the [TICON inventory](docs/ticon-inventory.md) and its CSV from a slackwater-database checkout.                                                                                                                  |
| `npm run errata`                  | Draft the report to each agency of its errata not yet reported, and check the erratum IDs the code cites.                                                                                                                |
| `npm run uhslc:contributors`      | Rescan UHSLC's documentation files for each station's contributor and terms.                                                                                                                                             |
| `npm run gesla:contributors`      | Rewrite the [GESLA contributor terms](src/sources/gesla/contributors.md) from GESLA 4.1's metadata and each contributor's terms.                                                                                         |
| `npm run gesla:coverage`          | Rewrite the [GESLA coverage report](src/sources/gesla/coverage.md) and its CSV from the store: which GESLA records the store also has from their originator, and the years each side lacks.                              |
| `npm run evaluate:bsh` / `:rws`   | Rerun the HRoI evaluations into [`docs/results/`](docs/results/). The RWS one downloads about 50 years of data.                                                                                                          |
| `npm run clock-check -- <args>`   | [`scripts/clock-check.ts`](scripts/clock-check.ts): check a new series' clock against TICON, described in [Checks](docs/contributing/checks.md#clock-check).                                                             |
| `npm run cross-check -- <args>`   | [`scripts/cross-check.ts`](scripts/cross-check.ts): compare a region's gauges with each other and with their own tide, described in [Checks](docs/contributing/checks.md#cross-station-checks).                          |

CI also checks that [`package-lock.json`](package-lock.json) regenerates from [`package.json`](package.json) and that every package resolves from the npm registry.

## Guides

Read the guide for the task at hand before starting it:

- [Running ingest](docs/contributing/ingest.md): every `scripts/ingest.ts` command and its flags, and the environment variables that choose the store.
- [Sources](docs/contributing/sources.md): adding a source, recording a source's errata, and withholding stations.
- [Operations](docs/contributing/operations.md): the scheduled workflows that write to R2, live polling, migrations, and the weekly canary.
- [Checks](docs/contributing/checks.md): the TICON inventory, the clock check, the cross-station checks, the HRoI evaluations, and the definitions of published files.
- [Running the poller](docs/contributing/poller.md): the poller, and the levels API's tests.
- [Site](site/README.md): building and deploying the site.

## Gotchas

- **Everything in the public store is public.** The bucket serves every file in it, so a source whose terms bar republishing writes only to `STILLWELL_RESTRICTED_STORE`, and ingest refuses to write one without it. Don't work around that refusal.
- **A station's files keep one datum.** Adapters refuse values in any datum but the station's, and backfill refuses to write into a file recorded in another. When a source moves a station to another reference, the next `ingest stations` opens a datum epoch whose values go to files of their own; a change soon after the last one, or back to an earlier reference, is held, and the run exits nonzero, until it's confirmed or rejected in the source's `overrides`. A zero a source moved without saying gets a datum epoch from the day listed in the source's `overrides.splits` with its erratum ([when an epoch opens](docs/stations.md#when-an-epoch-opens)).
- **`.cache/` hides upstream changes.** A historical fetch is served from the cache once it has run, keyed by URL and request body, so delete `.cache/`, or point `STILLWELL_CACHE` at an empty directory, when you need to see what the service returns now.
- **Write to R2 only through the Ingest, Monthly and Migrations workflows, and the poller** (see [Migrations](docs/contributing/operations.md#migrations)). A run from your own machine shares no concurrency group with the scheduled jobs, so it and Compact daily can each rewrite a file the other just read, and one's values are lost. That includes the bounds file, which backfill and compaction both rewrite whole.

## License and CLA

The code is [AGPL-3.0](LICENSE). Every contributor signs the [Contributor License Agreement](CLA.md) before we merge their pull request; the CLA workflow asks on your first one. The CLA lets Open Water Software, LLC move code into MIT packages, such as shared math another project imports, and offer other licenses, while an OSI-approved license stays public. Code another project needs to import belongs in an MIT package, not here, or that project becomes AGPL.

## Review checks

The traps this project has fallen into, for the openwaters-review skill and anyone reviewing a change:

- A change holds to [Rigor](#rigor). A claim in its description or report about every station, record, year or source shows the check over all of them; a new source, station type or conversion has the independent check Rigor asks for, or its README says why none exists and which checks the data has had; and the work it leaves for later is genuinely blocked, not just unfinished.
- A change that works around something a source publishes wrong, such as a clock shift, a skipped or refused file, a fixed position or a flagged span, adds an erratum for it and cites its ID (see [Source errata](docs/contributing/sources.md#source-errata)). A workaround with no erratum hides the error from users of the store and from the agency.
- A store path built from a station ID is read with DuckDB's `read_parquet` or `glob`, which treat `*`, `?` and `[` as wildcards, and `encodeURIComponent` leaves `*` alone. A new read of such a path keeps only the rows or files from that exact path (`filename = true`, as `readObservationFile` and `readYearFiles` do), so an ID like `a*` doesn't read another station's files.
- QC has more than one flatline limit (`flatline_s`, and `centimeter_flatline_s` for a small tide that moves in whole centimeters). Code that reasons about how far a run can reach, such as the daily files' edge, uses the longest that applies, not the default.
- A date parsed from what a source or an errata file writes is checked by turning it back into text, as [`src/errata.ts`](src/errata.ts) does: `Date.parse` rolls `2019-02-31` over to 3 March rather than refusing it.
- A write changes only the values its run is about. Backfill rewrites the values it fetched and compaction the days it folds; QC that reads more of the year, for its medians or a run across the edge, leaves the flags of the rest as they were. Only `requalify` changes stored flags it didn't fetch. The one exception is a level outside −500 to 9,000 m (`SPAN_M`), which backfill drops from the whole year it writes and compaction from the rows it folds, since no gauge reads one. Each writer counts what it dropped and says why, and a year in which every level the source sent is outside the span is written as rows flagged `bad`; a fold that brings levels into such a file replaces the fill.
- A refresh's guards against the last run need a stored list. `shrankSharply` compares only once that list has 20 active stations, and its live-station check only once it has 20 live ones. The withheld-station limit counts only stations taken out of the stored list, so it limits nothing on a first refresh, and withheld stations in the fetch are dropped with no limit. A first refresh still refuses an empty fetch, a station from another source, a list with no station that has a datum, and more than five datum changes at once, such as epochs opened by `splits` overrides, unless run with `--accept-epochs`. It accepts any other fetch of the source's own stations. A change that adds a guard against the last run's state says what the first run, with nothing stored, accepts.
- Store listings (`listFiles`, and the globs in `highestEpochs`, `exists` and `anyFile`) give no sign that they're complete, and one that comes back short but not empty fails quietly. The years file drops the rows of files the listing missed; it refuses an empty listing only where a row with a year exists. The bounds keep a station the listing misses entirely, except under `--rebuild-bounds`, but narrow `first` and `last` when its end years are missing. A short `highestEpochs` can give a new epoch an id whose files already exist. A refresh with no stored list that misses the history in its glob starts a new list from the fetch instead of refusing. `withhold` finds directories in the listing as well as in rows and history, so a short listing can hide a station whose only trace is its directories. A change that reads a listing says what a short one would do.
- A source whose terms are stated per file or per station treats a missing statement as unknown, which needs a decision, never as the source's default. And where an adapter merges two feeds of one series, such as a history and a latest window, it decides per timestamp, not by the span one feed covers, so a coarser feed doesn't drop the finer one's values.
- Runs outside the workflows share no concurrency group with the scheduled jobs. A local store directory also has no AWS CLI deletes, and it always lists completely. Code that deletes refuses a store it can't delete from, as `withhold` refuses any store that isn't on S3 or a local directory.
- The monthly files measured from levels, `stations/links.parquet` and `stations/matches.parquet`, keep a pair's last row when a read fails, so one bad read never empties them. That holds for every read the run makes, the years files and lists read before the pairs as well as each pair's levels: a read that throws outside the per-pair `try` stops every store instead.
- A change holds to [Where facts live](#where-facts-live): a new source or a change to one touches only its own directory, and a fact found in two places is cut to one, with a link. Where a source README lists a decision table's stations, such as `KINDS`, `POSITIONS`, `LINKS` or the source's `overrides`, a change to the table updates that list or replaces it with a link to the table.
- A parser that tolerates a shape a source's files hold, such as a blank line or a date with no time, tolerates it only where the files hold it (the last line terminator, a file's first row), and the README says which rows fail. Anywhere else the shape fails the file, as it would have before the exception.

## Shared conventions

Open Waters' [repository standards](https://github.com/openwatersio/.github/blob/main/REPOSITORY_STANDARDS.md) and [marketing guidance](https://github.com/openwatersio/.github/blob/main/docs/agents/marketing.md) apply here.
