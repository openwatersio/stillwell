# Copernicus Marine In Situ TAC: Quality Control Procedure (2025)

## Citation

Copernicus In Situ TAC Data Management Team, 2025. Copernicus Marine In Situ TAC. Quality Control Procedure. Version 1.0.0, March 2025 (history lists 1.1, 30/04/2025, DOI inclusion). 39 pp. DOI: https://doi.org/10.13155/106219

- PDF: https://archimer.ifremer.fr/doc/00950/106219/119273.pdf

## License and local copy

No license in the document or DataCite metadata. Link only.

## What it covers

The common NRT QC rules and flag scale for all Copernicus Marine In Situ TAC products, including tide gauge sea level (SLEV) in the multiparameter NRT products. Parameter-specific tests are delegated to family documents; for sea level that is Pérez et al. (2010), https://doi.org/10.13155/74307 (see [myocean-sea-level-nrtqc-2010.md](myocean-sea-level-nrtqc-2010.md)).

## Flag scale (section II.1, p. 6, Table 1)

| Code | Meaning                                   | Comment                                                                                                                         |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 0    | No QC was performed                       |                                                                                                                                 |
| 1    | Good data                                 | All QC tests passed.                                                                                                            |
| 2    | Probably good data                        | No way to be sure if value is right or wrong                                                                                    |
| 3    | Bad data although potentially correctable | These data must not be used without scientific correction. In delayed mode these data can be used to provide PARAMETER_ADJUSTED |
| 4    | Bad data                                  | Data did not pass one or more of the tests.                                                                                     |
| 5    | Value changed                             | Considered as good data                                                                                                         |
| 6    | Value below detection/quantification      | Not applied by In Situ TAC tests                                                                                                |
| 7    | Nominal value                             | Considered as good data but data were not observed but reported                                                                 |
| 8    | Interpolated value                        | Considered as good data; missing data interpolated from neighbouring data in space or time.                                     |
| 9    | Missing value                             | No data, the value is missing                                                                                                   |

Ingestion policy: the TAC keeps provider QC where it trusts the provider, preserves provider "bad" (4) flags, applies further tests that can only degrade a flag, and should not disseminate data with flag 0. New bad flags are fed back to providers where possible. "In general, a failed test marks data as bad and the latter are disseminated with a QC 4."

## Sea level tests applied in NRT (Table 2c, p. 8)

The sea level column marks: regional range test, global range test, spike test, stuck value test. Rate of change in time and missing value tests are marked for other families but not for sea level. Metadata tests that apply to all families include impossible date (no future dates, valid month/day/hour/minute), impossible location, and, for moorings, a drifting test.
