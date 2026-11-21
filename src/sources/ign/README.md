# Instituto Geográfico Nacional, Spain (`ign`)

IGN’s [tide-gauge network](https://www.ign.es/web/gds-red-mareografos) publishes observations and reviewed records through an [open HTTPS directory](https://datos-geodesia.ign.es/Red_de_Mareografos/). The current release contains **one historical series: Coruña’s reviewed hourly JM record, 2000–2023 inclusive**. Every released observation carries a suspect clock flag. Other gauges, raw instruments, minute products and periods are excluded pending the work tracked in [issue #181](https://github.com/openwatersio/stillwell/issues/181).

- **Coverage:** only `ign/ACOR1`, `procesados/horarios/200031_horarios_<year>_JM.txt`, for 2000–2023. The series is inactive and non-live in Stillwell because this admitted interval is closed; that does not mean the physical gauge stopped. Candidate catalog and parser exports support research but are not the registered ingest path. New filenames, years and gauges cannot widen admission automatically.
- **Units and reference:** the server README documents millimeters. All 24 admitted file headers name ACOR1, hourly millimeters and JM NP-615. The [ACOR1 sheet](https://datos-geodesia.ign.es/Red_de_Mareografos/fichas/ACOR1.pdf) gives the mark’s 4.998 m NMMA height. Stored levels are meters relative to that mark, with the surveyed offset available separately.
- **Times:** labels are represented as UTC; IGN’s historical convention is not confirmed, and no inferred shift is applied. This is an explicitly uncertain archive, not a certified UTC record.
- **Flags:** every admitted numeric observation is at least `suspect`, including after requalification, while `source_flag` preserves IGN’s reviewed-source status. Coruña’s numeric -9999 hourly aggregates are omitted as unusable gaps rather than kept as heights; this does not change other gauges’ treatment. A single flag does not distinguish all QC reasons: accepting suspect clocks also accepts any other suspect concerns, so these records need application-specific checks.
- **Independent check:** all 24 hourly annual records were compared against an IEO-origin Coruña harmonic prediction, independent of IGN. Zero-lag correlation was 0.98686–0.99501, best lag −10 to +10 minutes and K1 −4.87 to +15.90 minutes. Agreement supports keeping the flagged subset, not removing the uncertainty or extrapolating to other products. Standard clock-check, cross-check and tidal fitting exclude the all-suspect release; the independent evidence is the full hourly snapshot check recorded here.
- **Copies:** the ACOR1 link to `gesla/coruna2tg-cor-esp-cmems` is admitted. Eight other IGN–GESLA CMEMS decisions remain recorded for excluded gauges; absent endpoints do not create public series. IGN is not grouped with GESLA, CMEMS or UHSLC by proximity or tidal agreement: verified IDs or explicit links must establish identity, keeping independent same-port references separate. No raw series can win preferred-series selection or receive computed datums through this release.

## Running ingest

Requests start at least 350 ms apart and files are read fresh. Only the 24 admitted hourly filenames may contribute. Missing expected files, invalid named marks and malformed rows fail the fetch. Each admitted body must contain its complete on-the-hour calendar-year grid, including explicit missing markers. Truncation, an interior missing hour or a half-hour timestamp refuses the file. Each year supplies its own first hour, so no predecessor or fallback is fetched. Missing markers never create numeric observations. A body that repeats a row, has a blank line, or holds more or fewer rows than the year’s hours plus an optional closing midnight is refused, as is a header that names another station, product or unit.

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
