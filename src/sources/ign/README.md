# Instituto Geográfico Nacional, Spain (`ign`)

IGN’s [tide-gauge network](https://www.ign.es/web/gds-red-mareografos) publishes observations and reviewed records through an [open HTTPS directory](https://datos-geodesia.ign.es/Red_de_Mareografos/). The current release contains **one historical series: Coruña’s reviewed hourly JM record, 2000–2023 inclusive**. Other gauges, raw instruments, minute products and periods are excluded pending the work tracked in [issue #181](https://github.com/openwatersio/stillwell/issues/181).

- **Coverage:** only `ign/ACOR1`, `procesados/horarios/200031_horarios_<year>_JM.txt`, for 2000–2023. The series is inactive and non-live in Stillwell because this admitted interval is closed; that does not mean the physical gauge stopped. Candidate catalog and parser exports support research but are not the registered ingest path. New filenames, years and gauges cannot widen admission automatically.
- **Units and reference:** the server README documents millimeters. All 24 admitted file headers name ACOR1, hourly millimeters and JM NP-615. The [ACOR1 sheet](https://datos-geodesia.ign.es/Red_de_Mareografos/fichas/ACOR1.pdf) gives the mark’s 4.998 m NMMA height. Stored levels are meters relative to that mark, with the surveyed offset available separately.
- **Times:** labels are stored as UTC with no shift. IGN hasn't confirmed its historical clock convention: its server README says reviewed processing corrects temporal phase and doesn't name UTC, and its 17 November 2026 reply didn't address it (erratum `ign-coruna-clock`).
- **Flags:** QC's flags apply as for any source, and `source_flag` keeps IGN's reviewed-source status (0 for every admitted value). Coruña's numeric -9999 hourly aggregates are omitted as unusable gaps rather than kept as heights; this does not change other gauges' treatment.
- **Independent check:** each of the 24 years was cross-correlated with the TICON constants of IEO's Coruña gauge, UHSLC's La Coruña and CMEMS's Coruna2TG ([results](../../../docs/results/ign-coruna-clock-check-2026-11-21.md)). The best lag is 0 minutes in 57 of the 72 fits and ±10 minutes in the rest, with K1 phase −9 to +16 minutes. IEO's gauge, 0.7 km away, is the independent reference; the CMEMS copy may be IGN's own data and UHSLC's may come from IEO. The erratum's check compares the levels with the CMEMS copy's in the store, which fit at zero lag and not an hour either way.
- **Copies:** the ACOR1 link to `gesla/coruna2tg-cor-esp-cmems` is admitted. Eight other IGN–GESLA CMEMS decisions remain recorded for excluded gauges; absent endpoints do not create public series. IGN is not grouped with GESLA, CMEMS or UHSLC by proximity or tidal agreement: verified IDs or explicit links must establish identity, keeping independent same-port references separate. No raw series can win preferred-series selection or receive computed datums through this release.

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

Do not revert registration while its observation files remain public. To withdraw the source, a forward change makes `withheld()` return a rollback reason for ACOR1 as well as the excluded IDs, keeping the adapter and its dated credits registered, and carries a migration with a `withhold ign` step, then `matches --prune`, `links --prune` and `publish` steps, and a check that the store holds no IGN levels. The decision is recorded in the adapter’s `withheld` list. The adapter is removed only after that migration has run and its check has passed. A plain revert before the files are deleted is not the rollback procedure. Withdrawal doesn’t reset the record of completed migrations, so restoring the series afterward takes a new migration with the same backfill, bounds, publish and requalify steps. The levels API caches a historical response for a day, so withdrawn levels can still be served from its cache until that expires.
