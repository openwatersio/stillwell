# MyOcean: Near Real Time Quality Control and validation of Sea Level in-situ data (Pérez et al., 2010)

## Citation

Pérez, B., De Alfonso, M., Huess, V. and Rickards, L., 2010. Near Real Time Quality Control and validation of Sea Level in-situ data within MyOcean. Ref MYO-INS-SL_QC, Issue 2.0, 20 May 2010. 14 pp. DOI: https://doi.org/10.13155/74307

- PDF: https://archimer.ifremer.fr/doc/00631/74307/73931.pdf

## License and local copy

Each page carries "© My Ocean – Confidential"; DataCite rights field says only "Copernicus In Situ TAC". Not redistributable as far as can be determined. Link only.

## Status

This is the sea level RTQC reference that the Copernicus Marine In Situ TAC still cites in 2025 (see [cmems-insitu-qc-procedure-2025.md](cmems-insitu-qc-procedure-2025.md)). It adopts the 2009 GLOSS report "Quality control of Sea Level Observations", adapted from the ESEAS Data Quality Manual (García, Pérez Gómez, Raicich, Rickards, Bradshaw; version 0.5), which was not found online.

## QC levels (section I.2, pp. 5-6; section II, p. 7)

- QC1, mandatory for all regions: QC module plus interpolation module.
- QC2, voluntary but recommended: adds filter and tide-surge modules.
- Validation: human inspection and reference-level adjustments, mostly by data providers in delayed mode.
- At Puertos del Estado the software runs on "a moving window of two weeks of raw data with the original data sampling, normally between 1 and 15 minutes", because the storm surge forecast needs recent weeks for bias adjustment.

## Tests (section II.1, pp. 8-10)

Same as EuroGOOS 2010 section 6: strange characters (record discarded); out-of-range "based on extremes included in the metadata for each station"; stability test ("A typical value, for example, is 3 for 5 minute data"); date control; spline-fit spike detection over a 12-16 hour window, degree 2, N = 3 sigma, repeated on non-tidal residuals; interpolation of gaps "smaller than 10-25 minutes, depending on the tidal range".

QC2 metadata (section II.3): one year of data or harmonic constants (at least 68 constituents), max/min expected levels, max/min expected surge.

## Flag scheme (section II.4, p. 12)

"The GLOSS QC recommendations include a flag system which is in agreement with the SeaDataNet suggested QC flag system."

| Flag | Meaning                                          | Definition                                                                                                                                                         |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | No quality control                               | No quality control procedures have been applied to the data value.                                                                                                 |
| 1    | Good                                             | Good quality data value that is not part of any identified malfunction and has been verified as consistent with real phenomena during the quality control process. |
| 2    | Probably good (previously "correct but extreme") | Data value that is probably consistent with real phenomena but this is unconfirmed.                                                                                |
| 3    | Probably bad (previously "doubtful")             | Data value recognized as unusual during quality control that forms part of a feature that is probably inconsistent with real phenomena.                            |
| 4    | Bad (previously isolate spike or wrong value)    | An obviously erroneous data value.                                                                                                                                 |
| 8    | Interpolated                                     | This value has been derived by interpolation from other values in the data object.                                                                                 |
| 9    | Missing                                          | The data value is missing.                                                                                                                                         |

"All the flags except flag=8 can be assigned after the first module (QC module) whereas after the Interpolation module, data can only have flags: 1, 8 or 9."

## Validation (section III, p. 13)

"human inspection of data and checks in clock problems and reference changes", relying mostly on data providers, followed by L2 processing (tidal analysis, residuals, extremes, means, neighbour and model comparison).
