# Instituto Geográfico Nacional, Spain (`ign`)

IGN’s [tide-gauge network](https://www.ign.es/web/gds-red-mareografos) publishes observations and reviewed records through an [open HTTPS directory](https://datos-geodesia.ign.es/Red_de_Mareografos/). The current release contains **one historical series: Coruña’s reviewed hourly JM record, 2000–2023 inclusive**. Other gauges, raw instruments, minute products and periods are excluded pending the work tracked in [issue #181](https://github.com/openwatersio/stillwell/issues/181).

- **Coverage:** only `ign/ACOR1`, `procesados/horarios/200031_horarios_<year>_JM.txt`, for 2000–2023. The series is inactive and non-live in Stillwell because this admitted interval is closed; that does not mean the physical gauge stopped. Candidate catalog and parser exports support research but are not the registered ingest path. New filenames, years and gauges cannot widen admission automatically.
- **Units and reference:** the server README documents millimeters. All 24 admitted file headers name ACOR1, hourly millimeters and JM NP-615. The [ACOR1 sheet](https://datos-geodesia.ign.es/Red_de_Mareografos/fichas/ACOR1.pdf) gives the mark’s 4.998 m NMMA height. Stored levels are meters relative to that mark, with the surveyed offset available separately.
- **Times:** labels are stored as UTC with no shift. IGN has not confirmed its historical clock convention. Its server README describes temporal-phase correction without naming UTC (erratum `ign-coruna-clock`).
- **Flags:** the entire admitted interval carries a suspect clock flag (`ign-coruna-clock`). Reviewed numeric readings preserve source flag 0; a source withdrawal retains the prior numeric value with bad quality and source flags. Numeric -9999 hourly aggregates are unusable gaps (`ign-coruna-hourly-gaps`).
- **Independent check:** monthly harmonic fits and observed IEO comparisons with gaps explicitly reported in the evidence use IEO’s neighboring instrument. They show timing discrepancies without establishing IGN’s convention or complete fault boundaries. UHSLC’s contributor documentation names IEO, so it belongs to the same reference family. CMEMS Coruna2TG is IGN’s own copy and provides processing-consistency evidence. The evidence and coverage limits are recorded in `ign-coruna-clock`, with the native CMEMS/GESLA product’s independently identified timing windows handled by `cmems-coruna-clock-2020` and `cmems-coruna-clock-2022`. The preferred CMEMS series has a shorter history, with usable coverage beyond that interval; the flagged direct archive remains available by its own ID.
- **Copies:** [Identity decisions](../../same-as.ts) distinguish IGN’s ACOR1 and its copies from IEO’s and REDMAR’s neighboring gauges. Similar tides and proximity do not establish instrument identity.

## Running ingest

Requests start at least 350 ms apart and files are read fresh. Only the 24 admitted hourly filenames may contribute. Missing expected files, invalid named marks and malformed rows fail the fetch. Each admitted body must contain its complete on-the-hour calendar-year grid, including explicit missing markers. Truncation, an interior missing hour or a half-hour timestamp refuses the file. Each year supplies its own first hour, so no predecessor or fallback is fetched. Missing markers never create numeric observations. One final LF or CRLF terminates the last row; extra blank or whitespace-only lines, including at either edge, refuse the file. A body that repeats a row, has a blank line, or holds more or fewer rows than the year’s hours plus an optional closing midnight is refused, as is a header that names another station, product or unit.

Hourly polling and monthly refetch are disabled: the source sets `hourly` and `finalizes` false. Nightly compaction runs but has no recent window to fold. Monthly list refresh and ordinary publication may expose only the admitted historical series. The canary reads this same bounded hourly path. Store work goes through a migration in [`src/migrations/`](../../migrations/README.md); its ingest steps run in the source’s `store-ign` concurrency group.

### Backfill

```bash
node scripts/ingest.ts stations ign --no-publish
node scripts/ingest.ts backfill ign all 2000 2025 --with-inactive --refetch
node scripts/ingest.ts compact ign --rebuild-bounds
```

The end year is exclusive. The run deliberately includes empty 2024 to record the end of the inactive archive for completeness bookkeeping; the source still admits observations only through 2023. Requests are clipped to the admitted interval. Other source IDs refuse with the coverage erratum. Current-year and full-network ingest remain blocked and are tracked in issue #181; no live or daily-history campaign is part of this release.

### Forward rollback

Do not revert registration while its observation files remain public. To withdraw the source, a forward change makes `withheld()` return a rollback reason for ACOR1 as well as the excluded IDs, keeping the adapter and its dated credits registered, and carries a migration with a `withhold ign` step, then `matches --prune`, `links --prune` and `publish` steps, and a check that the store holds no IGN levels. The decision is recorded in the adapter’s `withheld` list. The adapter is removed only after that migration has run and its check has passed. Retain `check.ts` and its shared identity table while historical migrations import them. A plain revert before the files are deleted is not the rollback procedure. Withdrawal doesn’t reset the record of completed migrations, so restoring the series afterward takes a new migration following the order and checks in [the admission migration](../../migrations/20261121-ign-coruna-hourly.ts). The levels API caches a historical response for a day, so withdrawn levels can still be served from its cache until that expires.
