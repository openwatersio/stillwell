# Errata runbook

An agent follows this runbook on a schedule, after each full Monthly run and the Errata check run that follows it, to bring the errata in line with the store. It works the errata report that run writes, lists the copies each flagged erratum misses, and opens pull requests for a maintainer to review. Every rule in [CONTRIBUTING.md](../../CONTRIBUTING.md) applies, [Rigor](../../CONTRIBUTING.md#rigor) above all: a wrong flag is a wrong value that looks right.

## What it may do

- Read the public store, the repository, workflow runs and their artifacts, and GitHub issues and pull requests.
- Change errata files, the code that handles an erratum, [`src/cross-check-reviewed.ts`](../../src/cross-check-reviewed.ts), migrations and docs on a branch of its own, and open a pull request for each change. A pull request that writes to the store has a migration ([Migrations](operations.md#migrations)).
- Run [openwaters-review](https://github.com/openwatersio/.github/tree/main/skills/openwaters-review) before each pull request is first pushed, and handle the review threads of GitHub Copilot on it.
- Draft reports and questions to agencies with `npm run errata`.

## What it never does

- Open, comment on or close an issue, merge a pull request, or send a report to an agency. The errata report is the list of work: an item leaves it once its check passes, the next run no longer finds it, or a reviewed entry settles it.
- Write to the store from its own machine, or dispatch a workflow that writes to it. Store changes go through a migration after a maintainer merges.
- Change an erratum or a check to make an item leave the report without evidence from the data that the change is right. A check that fails is a finding, not an obstacle.
- Decide a matter of policy, such as a source's terms, or a judgment the evidence leaves open. Those go to a maintainer, as below.

## Before starting

1. Work in a fresh worktree from `main`, run `npm ci`, and set `STILLWELL_STORE=https://stillwell.openwaters.io` for every command that reads the store.
2. Read the [Source errata](sources.md#source-errata) section, the [cross-station checks](checks.md#cross-station-checks), and the README of each source the report names.
3. Download the latest report:

   ```bash
   gh run list --workflow errata-check.yml --branch main --limit 30 --json databaseId,createdAt,conclusion,event
   ```

   ```bash
   gh run download <run ID> --name "errata report" --dir report
   ```

   Take the newest run whose `event` is `workflow_run` and that has the artifact; a run whose Monthly run did no work has none. `report/errata-report.md` is the report and `report/report.json` the checks' results. Before working it:

   - A run whose `conclusion` isn't `success` says why in its log: checks that couldn't read the store, problems in the errata files, or cross-check findings missing. Report it as a Stillwell issue (below), and work what the report holds. With no `errata-report.md`, the report failed: work nothing, and report it.
   - The report names the Monthly run its findings came from. One older than the latest full Monthly run means that run's cross-check jobs failed; say so in the run report.
   - The report has a section for each region in the `cross-check` matrix of [`.github/workflows/monthly.yml`](../../.github/workflows/monthly.yml): a missing region's findings are unknown, not gone.

4. List the open pull requests that change errata, and leave alone an item one of them already addresses:

   ```bash
   gh pr list --state open --search "errata" --json number,title,headRefName
   ```

## A failing erratum check

The report quotes each failing check's message. Find out what changed in the store, then which of these it is:

1. **The source fixed its data**, and ingest stored the fix: the values the erratum describes are gone. Remove the workaround, retire the entry (its ID moves to `retired`), and add a migration that requalifies the span, so flags it set clear.
2. **The source changed the data another way**, such as a span that moved, grew or shrank. Read the store over the old span and a few weeks either side, compare with the record's neighbors and other records of the gauge, and rewrite the entry's span, `error`, `evidence` and check to match what the store holds. Add a migration that requalifies the old and new spans together.
3. **The store doesn't hold what the erratum says it did**, such as a span never requalified after the erratum changed. The erratum is right and the store is behind: add the migration the earlier change left out.
4. **The check is wrong**, such as one that samples a day the record has no values on. Fix the check, and say in the pull request why the store is right and the check wasn't, with the read that shows it.

A check listed under "couldn't read the store" says nothing about its erratum. Run it again with `npm run errata:check -- <erratum ID>`, and report it as a Stillwell issue (below) when it still can't read.

## A cross-check finding

Each finding names a kind, a station and a span ([Cross-station checks](checks.md#cross-station-checks)). A finding changes nothing in the store. Which findings leave the next report once an erratum answers them, and which need a reviewed entry, is in [Cross-station checks](checks.md#cross-station-checks).

1. Read the station's errata over the span, and those of every record of the gauge `same_as` links: the `errata` column of `stations.parquet`, and the errata files. Where one already answers the finding, write no new erratum; add a reviewed entry that names it, as below.
2. Read the station's daily means over the span and 60 days either side, against at least two neighboring gauges and every other record of the gauge `same_as` links. The finding's dates come from 30-day medians or 15-day windows, so its edges are days off.
3. Decide what the data shows:
   - **An error in the source's values**, such as an offset, a clock that runs off, a stuck gauge or another gauge's data: write a `flagged` erratum, or one handled otherwise where the store can do better (a datum epoch for a change of zero, a correction for a measured clock offset), with the span set from the daily values, not the finding's dates, its `stations` listing the station, a `check` ([Source errata](sources.md#source-errata)), and a migration that requalifies it. Unless the erratum is `flagged` or `dropped` and lists the finding's station, add a reviewed entry too, as below, whose reason names the erratum.
   - **Nothing wrong in the source's values**: real water a neighbor doesn't share, such as a storm surge, a river flood or a sluice operation, or a step at the start of a datum epoch the source declared. Add an entry to [`src/cross-check-reviewed.ts`](../../src/cross-check-reviewed.ts) with the finding's kind and station (for `copied`, both of the pair, as `station` and `other`), the span the values show, and a reason that says what the water or the epoch did and how that was confirmed, such as from a neighbor upstream, the agency's own notice or the station's epochs in `stations.parquet`. Never write an erratum for it: an erratum is reported to the agency as an error.
   - **An offset still going on**: a `step` within 400 days of the end of the years checked may be the start of an offset that comes back later. Leave it, and say so in the run report; a later run finds the offset whole.
   - **Not enough to tell**: write nothing, and put it to a maintainer (below) with what would settle it.
4. For a `copied` finding, find which record holds the other's data, from which one departs from its own usual levels against a third gauge, and write the erratum for that one.
5. For a `flagged` erratum, run `npm run errata:copies -- <erratum ID>` and list the copies it finds (below).

## Copies

Run `npm run errata:copies` over every flagged erratum once a run, and work each row:

- `copy`, with no erratum of the record's own over the span, and the original's error handled by the span flag alone: add the record to the original's `stations`, with a sentence in `evidence` that says what was compared, quoting the row's days compared (all of the span, or how many of how many days). A copy of an original handled by a datum epoch or a correction gets an entry of its own in its source's file.
- `copy` where the record has an erratum of its own over the span: compare the two entries. Where the copy's entry only restates the original's, merge it as above and retire its ID; where it handles the error differently, leave both.
- `own`: nothing to add; the record has values of its own over the span.
- `unclear`, `no control` or `too few`: read the pair yourself over the span and the days either side before deciding, and say how in the evidence. Leave it out where the data can't settle it.

A copy of a record that `same_as` doesn't link isn't compared; check any the evidence names by hand.

## Reports to agencies

Run `npm run errata` and put the drafts for errata not yet reported and questions not yet asked in the pull request's description, for a maintainer to approve and send when it merges. Before sending, the maintainer drafts the message again with `npm run errata -- <source>` on `main`, so an entry another pull request's message already sent isn't sent twice. A question for an agency that isn't an error goes in the source's `questions` ([Source errata](sources.md#source-errata)), never in a message of its own, and no work waits on its answer: record what the store does meanwhile and carry on.

## Pull requests

- Group the work by source, so each pull request is one agency's errata and the copies they list, with its migration.
- Follow the repository's rules for pull requests: a plain title, a description of the change as it stands, `## After merge` with the migration's checks to confirm, and `## Review`.
- After the merge, confirm the migration ran and the items it addresses left the next errata report.

## Decisions for a maintainer

Before putting a decision to a maintainer, follow every lead first (see [Rigor](../../CONTRIBUTING.md#rigor)). Put a decision the agent can't make in its run report, and in the pull request as an open question where one is open, leaving that pull request as a draft. That includes a finding the data can't settle, an agency's answer that contradicts the data, a source's terms, and a change to a QC rule or to `cross-check` itself. A finding put to a maintainer stays in the report until it's settled; say so in the next run report rather than working it again, unless a lead that couldn't be followed before now can be.

## The run report

End each run with a short report:

- Each item worked, with the pull request that addresses it or why it was left.
- The copies added, and the rows left out with the reason.
- The decisions waiting for a maintainer, with each lead left unfollowed and why, and the drafts waiting to be sent.
- A "Stillwell issues" list: anything in the store's data, docs, access or performance that got in the way, such as a store that couldn't be read, a gap or a flag that looked wrong.
