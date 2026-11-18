# Instituto Geográfico Nacional, Spain (`ign`)

IGN’s [tide-gauge network](https://www.ign.es/web/gds-red-mareografos) publishes observations and reviewed records through an [open HTTPS directory](https://datos-geodesia.ign.es/Red_de_Mareografos/). The current release contains **one historical series: Coruña’s reviewed hourly JM record, 2000–2023 inclusive**. Every released observation carries a suspect clock flag. Other gauges, raw instruments, minute products and periods are excluded pending the work tracked in [issue #181](https://github.com/openwatersio/stillwell/issues/181).

- **License:** [CC BY 4.0](https://www.ign.es/resources/licencia/Condiciones_licenciaUso_IGN.pdf), including commercial use and redistribution, [confirmed by IGN on 17 November 2026](https://github.com/openwatersio/stillwell/issues/181#issuecomment-6945552785). Source-only metadata cites the known product period (2000–2023), without setting observation bounds. Dated station output credits use `Obra derivada de Red de Mareógrafos <first–last date> CC-BY 4.0 ign.es; Área de Geodesia, Instituto Geográfico Nacional (IGN)`. Dates come from actual stored observations.
- **Contact:** ign@transportes.gob.es; the [server README](https://datos-geodesia.ign.es/Red_de_Mareografos/Leeme.txt) also gives buzon-geodesia@fomento.es.
- **Coverage:** only `ign/ACOR1`, `procesados/horarios/200031_horarios_<year>_JM.txt`, for 2000–2023. The series is inactive and non-live in Stillwell because this admitted interval is closed; that does not mean the physical gauge stopped. Candidate catalog and parser exports support research but are not the registered ingest path. New filenames, years and gauges cannot widen admission automatically.
- **Units and reference:** the server README documents millimeters. All 24 admitted file headers name ACOR1, hourly millimeters and JM NP-615. The [ACOR1 sheet](https://datos-geodesia.ign.es/Red_de_Mareografos/fichas/ACOR1.pdf) gives the mark’s 4.998 m NMMA height. Stored levels are meters relative to that mark, with the surveyed offset available separately.
- **Time and flags:** labels are provisionally represented as UTC; IGN’s historical convention is not confirmed. Every admitted numeric observation is at least `suspect`, including after QC/requalification, while `source_flag` preserves IGN’s reviewed-source status. This is an explicitly uncertain archive, not a certified UTC record. Coruña’s numeric -9999 hourly aggregates are omitted as unusable gaps rather than retained as heights; this does not change other gauges’ treatment. The published errata describe the evidence, clock uncertainty and excluded coverage. A single flag does not distinguish all QC reasons: accepting suspect clocks also accepts any other suspect concerns, so these records need application-specific checks.
- **Independent check:** all 24 hourly annual records were compared against an IEO-origin Coruña harmonic prediction, independent of IGN. Zero-lag correlation was 0.98686–0.99501, best lag −10 to +10 minutes and K1 −4.87 to +15.90 minutes. The [validation report](../../../docs/results/ign-validation-2026-11-17.md) records the broader audit and its limits. Agreement supports keeping the flagged subset, not removing the uncertainty or extrapolating to other products. Standard clock-check, cross-check and tidal fitting exclude the all-suspect release; the independent evidence is the full hourly snapshot check recorded here.
- **Copies:** the ACOR1 link to `gesla/coruna2tg-cor-esp-cmems` is admitted. Eight other IGN–GESLA CMEMS decisions remain recorded for excluded gauges; absent endpoints do not create public series. IGN is not grouped with GESLA, CMEMS or UHSLC by proximity or tidal agreement: verified IDs or explicit links must establish identity, keeping independent same-port references separate. No raw series can win preferred-series selection or receive computed datums through this release.

## Running ingest

Requests start at least 350 ms apart and files are read fresh. Only the 24 admitted hourly filenames may contribute. Missing expected files, invalid named marks and malformed rows fail the fetch. Each admitted body must contain its complete on-the-hour calendar-year grid, including explicit missing markers. Truncation, an interior missing hour or a half-hour timestamp refuses the file. Each year supplies its own first hour, so no predecessor or fallback is fetched. Missing markers never create numeric observations, and omitted timestamps preserve stored readings.

Hourly polling and monthly refetch are disabled. Monthly list refresh and ordinary publication may expose only the admitted historical series. The canary reads this same bounded hourly path. Use a separate local store for diagnostics; production writers must use the existing workflow concurrency group.

### Backfill

```bash
node scripts/ingest.ts stations ign --no-publish
node scripts/ingest.ts backfill ign all 2000 2025 --with-inactive --refetch
node scripts/ingest.ts compact ign --rebuild-bounds
```

The end year is exclusive. The run deliberately includes empty 2024 to record the end of the inactive archive for completeness bookkeeping; the source still admits observations only through 2023. Requests are clipped to the admitted interval. Other source IDs refuse with the coverage erratum. Current-year and full-network ingest remain blocked and are tracked in issue #181; no live or daily-history campaign is part of this release.

### Forward rollback

Do not revert registration while its observation files remain public. Pause publication while withdrawing this source. First deploy a small forward patch making `withheld()` return a rollback reason for ACOR1 as well as the already excluded IDs, keeping the adapter and its dated credits registered. Run `withhold ign --accept-withheld` through the source’s Ingest workflow/concurrency group and verify that the IGN observation files and station rows were deleted. Run `publish` only after that verification. Then remove the adapter and resume publication. This is an operational rollback procedure, not an automatic deletion step in this PR.
