# Flagged Coruña hourly subset

Approved in chat on 18 November 2026: include Coruña’s reviewed hourly record for 2000–2023 with an explicit suspect clock flag.

## Approach and boundaries

The registered IGN source admits only `ign/ACOR1`, `procesados/horarios/200031_horarios_<year>_JM.txt`, for 2000–2023 inclusive. Each of those 24 files has the same NP-615 header, independently checked hourly timing, agency-documented millimeters and the station sheet’s 4.998 m NMMA height. Independent agreement does not establish IGN’s historical time convention. Every observation therefore stays suspect for clock uncertainty, with its original reviewed-source flag preserved and a dated erratum applied during requalification.

The alternative was to withhold all publication until IGN answers. The maintainer chose the flagged subset. A broad raw release remains unsupported by calibration evidence.

The public station list has one inactive, non-live hourly series and no internal links to excluded sensors. The candidate catalog and parsers remain research utilities, not the registered ingest path. Public observations refuse other IDs and datums and intersect requests with [2000-01-01, 2024-01-01). Only allowed hourly JM filenames are fetched; minute, raw, earlier and later files cannot enter through fallback or predecessor boundaries. Missing expected files fail rather than silently shorten the checked release. All 24 own-year files have complete on-the-hour grids including missing markers; refuse incomplete or shifted grids and fetch no predecessor. Omit the 840 source-specific -9999 hourly aggregates as unusable gaps, supported by the full hourly/minute comparison, while the generic parser’s treatment of other gauges remains unchanged.

Hourly polling and monthly refetch are disabled. Lists and normal publication remain registered for the historical subset. The canary uses the admitted hourly path. No production store write, agency email or merge is authorized by implementation. Issue #181 stays open to track all excluded coverage and the unsent agency questions.

## Verification

Tests cover the public one-station list, refusal of excluded IDs, date clipping, clock flags and their source flags, JM mark validation, excluded neighboring files, missing admitted files, boundary precedence, and scheduling. A full local ingest reads all 24 allowed annual files from the recorded bodies and checks actual Parquet rows, bounds, source/quality flags and dated credits. Run the full suite and Open Waters review, commit/push the reviewed changes and follow CI. The PR’s after-merge checklist covers R2 readback of precisely this subset.
