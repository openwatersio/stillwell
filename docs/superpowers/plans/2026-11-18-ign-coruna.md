# Flagged Coruña Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release only the maintainer-approved, clock-flagged Coruña hourly subset and track excluded IGN coverage in issue #181.

**Architecture:** Keep the candidate catalog/parser separate from the registered public Source. A closed filename/year admission path supplies only one historical series; errata preserve its suspect clock status through QC and requalification.

**Tech Stack:** Node 24+, TypeScript, existing Parquet/DuckDB and source registry. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-ign-coruna-design.md`

## Global Constraints

- Only ACOR1 hourly JM, 2000–2023 inclusive; all observations suspect for unconfirmed clock labels.
- No live polling, monthly refetch, guessed corrections, production ingest or agency email.
- Preserve original source flags, NP-615/JM and surveyed NMMA 4.998 m.

## Review Focus

- Candidate parser called instead of the public admission path: tests inspect the registered source and canary.
- Boundary files outside the admitted years: tests include 1999 and 2024 inventory entries and detect unwanted requests.
- Source outage mistaken for deliberate exclusion: a missing expected hourly file must throw.
- QC removes the clock flag: test registered errata and local Parquet readback.
- Future catalog expansion silently widens release: public list and observation tests enforce exact ID/year admission.

## Task 1: Admit the historical subset

Files: `src/sources/ign/index.ts`, `src/sources/ign/errata.json`, `test/ign.test.ts`, `test/jobs.test.ts`, `scripts/{canary.ts,monthly.sh}`.

- [x] Add failing tests for the exact public list and hourly/year/JM admission, suspect flags, missing files and disabled live/refetch schedules.
- [x] Implement the bounded hourly fetch and public Source wrappers; add the clock and withheld-coverage errata.
- [x] Run targeted tests and confirm all new cases pass.

## Task 2: Validate and publish the change

Files: source/root READMEs, CONTRIBUTING, QC guide, validation report, PR #257 and issue #181.

- [x] Document the actual release and track blocked coverage and agency questions on issue #181; preserve historical research.
- [x] Ingest and read back all 24 files locally, including flags, datum, bounds and attribution.
- [ ] Run full checks and standard Open Waters review; verify/fix real findings.
- [ ] Commit and push, follow CI, and update the PR’s scope, review record and bounded R2 after-merge checklist.

Review fixes: complete own-year grids and unusable aggregates are checked before storage; no predecessor is fetched. Requalification spans are tied by regression to `CORUNA_PERIOD`. Assembled identity clashes are symmetric. All unused recent-retention plumbing is removed. Full guard-suite and input/output evidence are recorded in the scoped validation report and PR #257.
