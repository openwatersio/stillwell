# SeaDataNet: Data Quality Control Procedures, Version 2.0 (2010)

## Citation

SeaDataNet, 2010. Data Quality Control Procedures. Version 2.0, 14 May 2010. 6th Framework of EC DG Research, SeaDataNet project. 78 pp.

- PDF: https://www.seadatanet.org/content/download/596/3118/file/SeaDataNet_QC_procedures_V2_(May_2010).pdf
- Landing page: https://seadatanet.org/Publications/Technical-documentation/Data-Quality-Control

## License and local copy

No license or redistribution statement in the document. Link only.

## What it is

The European NODC delayed-mode QC manual. Section 5.4 (sea level) is the source text that IOC MG 83 section 2.3.2 later updated, and section 6 defines the SeaDataNet L201 flag vocabulary used by EuroGOOS, MyOcean and Copernicus.

## Sea level, delayed mode (section 5.4.1)

- L2 QC works on about one year: filtering to hourly values, annual harmonic constants, residuals, extremes, means. "The primary quality control of sea level is based on the inspection of both recorded data and residuals (i.e. observed – predicted values); inspection of residuals is especially useful for detecting instrumental faults such as timing errors, datum shifts and spikes."
- Tidal predictions are unreliable where tides are "highly nonlinear", with "influence of rivers or estuaries and particularly complex basin configuration"; compute fresh constants from recent data; never mix constants between packages.
- Buddy checking of suspect tidal profiles against a nearby site; operate more than one sensor per site.
- Hourly filtering: compares Godin and Pugh filters; Godin removes part of the semidiurnal signal (differences of about ±5 cm), so computing extremes or ranges from Godin-filtered hourly values is "not recommended".
- Yearly harmonic constants plotted as vectors; select constituents whose year-to-year variability stays within "a fixed and reasonable tolerance" (no value given).
- Clock malfunction: residual oscillations; constant lag found by lag correlation or M2 phase comparison; shift and interpolate. Not automatic in any package except the UHSLC tool for whole-interval constant lags.
- Gap filling: short gaps of several minutes linearly interpolated in high-frequency data; UHSLC residual-interpolation method for hourly gaps; "The maximum length of data that is reasonable to fill should not be more than 24 hours depending on the station"; flag interpolated values.
- Reference changes: visible in hourly residuals if large; confirm with tide staff or electric sounding scatter diagrams; also by differences of daily and monthly means with adjacent stations or redundant sensors. "As a rule, the UHSLC considers changes greater than 1.5 cm as significant and worthy of an investigation". Correct only "when firm confirmation has been established".
- Statistics for QC: historical extremes (range check), tidal and observed ranges, means and SDs of hourly values and residuals, monthly and annual extremes, density functions.

## Historical records (section 5.4.2)

Daily or monthly means from nearby stations; correlation of residual series and regression gap filling where correlation exceeds 0.7 (not at series ends); SNHT; EOF analysis. Expert judgement before correcting.

## Flag scale (section 6, SeaDataNet L201)

"Quality flags are used to describe the data value; no changes are made to the data values."

| Key | Term                       | Definition                                                                                                                                                                                                                          |
| --- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | no quality control         | No quality control procedures have been applied to the data value. This is the initial status for all data values entering the working archive.                                                                                     |
| 1   | good value                 | Good quality data value that is not part of any identified malfunction and has been verified as consistent with real phenomena during the quality control process.                                                                  |
| 2   | probably good value        | Data value that is probably consistent with real phenomena but this is unconfirmed or data value forming part of a malfunction that is considered too small to affect the overall quality of the data object of which it is a part. |
| 3   | probably bad value         | Data value recognised as unusual during quality control that forms part of a feature that is probably inconsistent with real phenomena.                                                                                             |
| 4   | bad value                  | An obviously erroneous data value.                                                                                                                                                                                                  |
| 5   | changed value              | Data value adjusted during quality control. Best practice strongly recommends that the value before the change be preserved in the data or its accompanying metadata.                                                               |
| 6   | value below detection      | The level of the measured phenomenon was too small to be quantified by the technique employed to measure it.                                                                                                                        |
| 7   | value in excess            | The level of the measured phenomenon was too large to be quantified by the technique employed to measure it.                                                                                                                        |
| 8   | interpolated value         | This value has been derived by interpolation from other values in the data object.                                                                                                                                                  |
| 9   | missing value              | The data value is missing. Any accompanying value will be a magic number representing absent data.                                                                                                                                  |
| A   | value phenomenon uncertain | There is uncertainty in the description of the measured phenomenon associated with the value.                                                                                                                                       |

The scale is based on the GTSPP scheme with additions. The document also describes BODC's general time-series screening with "M" (suspect) and "N" (null) flags.
