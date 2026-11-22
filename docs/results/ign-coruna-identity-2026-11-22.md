# Coruña identity and clock validation

The admitted IGN Coruña hourly record, 2000–2023, is retained with a suspect clock flag over its entire interval (`ign-coruna-clock`). IGN has not confirmed the historical time convention, and independent comparisons show timing discrepancies beyond isolated monthly warnings. Labels are stored as UTC without a shift. This implements the approved flagged-subset policy; no statistical lag is applied as a timestamp correction.

## Instrument identity

Coruña has three instruments. [PSMSL 763](https://psmsl.org/data/obtaining/stations/763.php) identifies IGN’s La Coruña II; [PSMSL 484](https://psmsl.org/data/obtaining/stations/484.php) identifies IEO’s La Coruña I; [PSMSL 1808](https://psmsl.org/data/obtaining/stations/1808.php) identifies Puertos del Estado’s La Coruña III. [JERICO’s inventory](https://www.jerico-ri.eu/download/filebase/jerico_fp7/deliverables/D2.3_version1_1.pdf) identifies `CorunaTG` as Puertos del Estado’s at 43.357, −8.389. CMEMS names `Coruna2TG` “A Coruña ACOR1 TG tide gauge”. [UHSLC qa830a.dmt](https://uhslc.soest.hawaii.edu/rqds/atlantic/doc/qa830a.dmt) names IEO as contributor and originator, code 005. This establishes declared provenance, not an uninterrupted instrument history beyond its documented interval.

[The identity table](../../src/coruna-gauges.ts) includes the documented copies and the possible direct RQ alias `uhslc/830a`, absent from today’s store. Explicit links and 31 cross-instrument separations in [same-as.ts](../../src/same-as.ts) prevent copies from bridging instruments even when other members are absent. Similar tides alone do not establish identity. The source-owned verifier in src/sources/ign/check.ts is exercised through both the admission migration and `ign-release-coverage`: it rejects split groups, cross-instrument membership, conflicting preference, another instrument’s prediction and inherited computed MSL/LAT offsets on the IGN group.

| Instrument | Preferred without direct IGN | Preferred with direct IGN |
| --- | --- | --- |
| IGN / Coruna2TG | `cmems/Coruna2TG` | `cmems/Coruna2TG` |
| REDMAR / CorunaTG | `cmems/CorunaTG` | unchanged |
| IEO / UHSLC 830 | `uhslc/830` | unchanged |

The commercial CMEMS copy remains preferred because it extends beyond the clock-suspect historical interval; the copies retain their own independently checked clock windows, rather than inheriting the direct archive’s format uncertainty (`PREFER`, citing `ign-coruna-clock`). This preserves usable preferred-series queries without clearing the direct series’ uncertainty.

## Publication readback

[Group readback](ign-coruna-identity-2026-11-22/group-readback.json) uses source-owned lists, bounds, analysis, usable year shares and measured matches, with [input receipts](ign-coruna-identity-2026-11-22/input-receipts.json). It covers all eight published records in 43.34–43.39 N, 8.42–8.37 W, plus direct IGN. Published inferred `same_as` is not reused as an adapter assertion. It runs grouping with and without IGN, then `publishStations` locally for CMEMS, GESLA, UHSLC and IGN and exercises the actual migration verifier. Its normalized station reader omits first/last dates; null bounds in this JSON do not describe the actual publication bounds. The full original 24-year ingest validation remains the date and numeric-content evidence.

The prediction guard consults explicit `UNLINKS` decisions, including a replacement absent from the store. [All-station guard replay](ign-coruna-identity-2026-11-22/prediction-audit.json) holds grouping fixed over 29,452 published records plus IGN and clears previous prediction fields. Only the three IGN-family predictions change to null. This isolates the guard; it is not a full-store publication replay. REDMAR keeps its CorunaTG prediction, and IEO/UHSLC keeps its UHSLC FD prediction.

Both Coruna2TG records lose inherited MSL −0.298 m and LAT +1.854 m offsets from another instrument. Their chart datum becomes null and frame unknown. Default API levels change from LAT to source ZERO, numerically 1.854 m lower; explicit LAT requests become unavailable. Historical caches can retain the older reference for up to a day. The shared identity check asserts the old computed MSL/LAT offsets are gone. Direct IGN retains surveyed NMMA 4.998 m. Production GESLA coverage and TICON inventory snapshots remain unchanged until the admission migration publishes IGN’s list. Their regeneration is an explicit deployment step; pre-deployment generation must not claim a ready IGN list that does not exist.

Reproduce the local group/publication check with `node docs/results/ign-coruna-identity-2026-11-22/group-readback.mjs <snapshot-root> <validated-ign-store>`. Reproduce the guard-only replay with `node docs/results/ign-coruna-identity-2026-11-22/prediction-audit.mjs <public-stations.parquet> <group-readback.json> <output.json>`. Both write local evidence only. Upstream changes can change a new run’s receipts and results.

## Clock evidence and limits

[Monthly harmonic fits](ign-coruna-identity-2026-11-22/monthly-clock.json) cover all 288 months and 209,544 numeric observations, without selecting on QC flags. Best lags are 0 in 216 months, −10 in 19, +10 in 46 and +20 in seven. Day coverage fails the CLI’s rule in March–April 2007, July 2013 and November 2013. These counts describe calculated fits, not 288 passed checks or UTC certification. The generator uses the same prediction and Pearson formula as the CLI but deliberately includes flagged numeric values. Coverage fields were appended separately to the original fit output, so JSON key ordering differs from a fresh generator run.

Harmonic runs include September 2000–January 2001, October 2003–November 2004, July 2005–October 2008 and October 2011–May 2012. [Observed IEO comparisons](ign-coruna-identity-2026-11-22/observed-clock.json) attempt all 204 overlapping months of 2000–2016. October–November 2004 have no zero-lag pairs; 11 months have fewer than 445 pairs, so 193 have at least 445. Of those, 42 favor nonzero lags with zero-lag RMS at least 1.5 times the best tested lag. Some optima lie at the tested ±20-minute boundary. Neither reference is presumed faultless, and these results do not locate complete IGN clock-fault boundaries.

For the seven harmonic warning months, best tested near-zero observed residual RMS is 0.0375–0.0763 m; the better ±12-hour alternative is 0.1569–0.2057 m. A 12-hour displacement fits substantially worse. Harmonic and observed comparisons have opposite lag sign conventions. This narrows one ambiguity but does not justify marking other months good. The whole interval remains suspect until a reviewed dated convention or independent validation supports narrowing its flags.

Reproduce the numeric harmonic fits with `node docs/results/ign-coruna-identity-2026-11-22/monthly-clock.mjs <ign-store> <slackwater-database> <output.json>`. Reproduce observed residuals with `node docs/results/ign-coruna-identity-2026-11-22/observed-clock.mjs <ign-store> <local-cache> <output.json>`. The latter records receipts for all 17 overlapping IEO year files. The annual 72-fit report predates the clock flags; the CLI now excludes those flags, so the CLI cannot directly replay the historical annual fits. The monthly generator avoids that circular exclusion.

## Stored flags and rollout

Real requalification retains all 209,544 numeric observations: every quality flag is suspect, every reviewed source flag is 0. [Stored-flag readback](ign-coruna-identity-2026-11-22/stored-flags.json) records these totals. No timestamp or height changes. A future explicit source withdrawal can retain a prior number with bad quality/source flags; the verifier accepts that designed state.

The admission migration requalifies before publishing, checks all 24 source-file numeric digests, reviewed flags, coverage, attribution and shared identities. It does not run a store-wide links measurement. Existing cross-group offset rows cannot propagate through separated groups. Operational queue state and any required retry are recorded in the PR’s deployment checklist. No retry, migration-record edit, agency message or production ingest was performed.

## Related records outside the admitted source

[The Spanish IEO inventory](ign-coruna-identity-2026-11-22/spanish-ieo-group-audit.json) covers all 12 public records. Ten other ports have CMEMS peers: Arrecife, Cádiz, Ceuta, Cruz, Málaga, Palma, Pluz/Las Palmas, Santander, Tarifa and Vigo; Algeciras has none. The present change does not alter those groups, and the all-station prediction replay changes only Coruña. Membership across providers is not proof of a different instrument. Dated originator/relay/instrument lineage for each is separate research in #181; it cannot safely be replaced with a blanket agency-name separation. This report makes no whole-network identity-validation claim.

## Native-product timing controls

The native CMEMS product declares UTC and has its own processing; it is not the same file format as IGN’s unqualified hourly labels. Both CMEMS and its GESLA copy are compared over their entire stored 2019–2024 span against REDMAR and UHSLC in [copy-controls.json](ign-coruna-identity-2026-11-22/copy-controls.json). All additional UHSLC and REDMAR year files over 2000–2023 are recorded in [independent-clock.json](ign-coruna-identity-2026-11-22/independent-clock.json). The earlier IEO-only statement does not mean no other independent observations exist after 2016.

REDMAR supplies a distinct instrument control. UHSLC diverges from both other instruments after mid-2020 and is not sole ground truth; interpreting that record’s interval labels/provenance is a separate follow-up. No reference is presumed faultless. Empty or insufficiently paired windows remain explicit, not passes.

[Weekly controls](ign-coruna-identity-2026-11-22/copy-windows.json) cover 636 calendar windows for both copies; 426 satisfy day coverage and at least 72 zero-lag pairs. Strong nonzero-lag improvements occur only in the two conservatively flagged windows: July–August 2020 and June–September 2022. The flags include padding around the observed episodes; they are not inferred exact correction epochs. For the recorded 2020 probe, testing −60 minutes reduces residual RMS from 0.413 m to 0.186 m; the 2022 probe at −20 reduces it from 0.215 m to 0.117 m. These are tested comparisons, not time corrections or claims of uniquely correct lags.

The CMEMS-owned errata `cmems-coruna-clock-2020` and `cmems-coruna-clock-2022` flag the native record and its identical GESLA copy. Their checks verify the flags, look immediately outside the windows for spill, and reproduce independent control improvements. The migration requalifies both copied histories and verifies both errata before finishing. Outside these windows the native product retains ordinary provider/store QC, including its shorter 2024 tail. Available 2024 controls show no comparable strong timing pattern; incomplete windows are not certified. Direct IGN retains its conservative archive-wide flag because its file convention and complete historical fault boundaries remain unconfirmed.

[Copy readback](ign-coruna-identity-2026-11-22/copy-readback.json) checks all 32,927 timestamps, numeric levels and source flags per historical copy against the public inputs, and confirms that the two copies are identical. Every uncertainty-window value is suspect or worse. No native timestamps, heights or source flags change. Reproduce with `copy-clock.mjs`, `independent-clock.mjs`, `copy-controls.mjs`, `copy-windows.mjs` and `copy-readback.mjs` in this directory; each script prints its argument usage when called without them. Run downloads only in isolated local stores.

The verifier deliberately refuses any new computed MSL/LAT datum on this bounded IGN group until it is independently validated. Its current admitted sources and catalog records provide no validated MSL/LAT donor, so even a future legitimate same-instrument computed datum requires an explicit validation update. This is an admission invariant, not a general claim that every computed datum crosses instruments.
