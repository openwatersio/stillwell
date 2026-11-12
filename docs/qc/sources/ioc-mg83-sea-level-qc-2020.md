# IOC Manuals and Guides 83: Quality Control of in situ Sea Level Observations (2020)

## Citation

UNESCO/IOC, 2020. Quality Control of in situ Sea Level Observations: A Review and Progress towards Automated Quality Control, Vol. 1. Paris, UNESCO. IOC Manuals and Guides No. 83 (IOC/2020/MG/83Vol.1). Editing team chaired by Begoña Pérez Gómez (Puertos del Estado), with T. Aarup, E. Bradshaw, J. Illigner, A. Matthews, B. Mitchell, L. Rickards, P. Stone (NOAA) and M. Widlansky (UHSLC). 70 pp.

- DOI: https://doi.org/10.25607/OBP-854
- UNESCO record: https://unesdoc.unesco.org/ark:/48223/pf0000373566
- Copy read: https://cdn.ioos.noaa.gov/media/2021/04/IOC-MG-83_eo.pdf (also at https://nora.nerc.ac.uk/id/eprint/527869/)

## License and local copy

The PDF carries only "© UNESCO 2020" and no license statement. The NERC Open Research Archive record (NORA 527869) lists the file under Creative Commons Attribution Share Alike 4.0, but this could not be confirmed against a UNESCO statement (unesdoc.unesco.org returned HTTP 403). PDF not included; link only. If the NORA license is accepted as sufficient, the 2.7 MB PDF qualifies for inclusion.

## What it is

The GLOSS reference manual on tide gauge QC. It states that it is "the first time that detailed information on these quality control procedures has been assembled into one document" (p. 2), compiling earlier IOC Manual 14 volumes, ESEAS-RI, SeaDataNet, EuroGOOS, CMEMS and QARTOD material. It is the most complete single primary source for internal-consistency QC of one gauge's series.

## Error types it targets (section 1.4, p. 9; section 4.1, p. 37)

Section 1.4 lists random errors (transcription), electronic noise (spikes), communication problems (distortion or gaps), sensor calibration (datum changes), floating objects under radar sensors, clock malfunctions, drifts, and "stabilization (constant value)". Systematic inhomogeneities from changes of sensor, location or surroundings "require a more detailed analysis by a sea level expert".

Section 4.1 gives the test list for evaluating automatic software: constant values, near-constant values, out-of-range values, isolated spikes, clustered spikes, datum changes, drifts, time errors. It notes that "most of the existing automatic software packages do not deal or correct the last three (datum changes, drifts and time errors)". Real events that software must not flag: tsunami or meteotsunami events and extreme sea levels during storm surges.

## Data streams and QC levels (section 2.1, pp. 10-11)

- Real time (latency under 1 minute, tsunami use): "very little quality control is required or even possible". "Care must be taken to ensure that any quality control carried out on real time data does not remove tsunami signals by rejecting out of range data." Only simple checks such as detecting that the gauge stopped reporting.
- Near real time, Level 1 (L1), latency 15 minutes to several weeks: automatic detection of invalid characters, wrong date and hour, spikes, outliers, interpolation of short gaps, stability of the series, and optionally filtering to hourly values and non-tidal residuals.
- Delayed mode, Level 2 (L2), one or more years of data: harmonic constants, extremes, daily/monthly/annual means, buddy checks, altimetry or model comparison, drift and datum change detection, with station operational history. The L1/L2 split was "first defined within the ESEAS-RI European project (García et al., 2007)".
- Section 1.2 (p. 6) recommends that between L1 and L2 "the data are inspected every week or month, as the data come in, by a dedicated technician".

## Basic tests (section 2.3, pp. 11-12)

Recommended battery, applied in NRT or delayed mode:

1. Invalid characters and syntax test (file conforms to format, expected size).
2. Out-of-range values, "based on predefined upper and lower limits dependent on the station and included in the metadata for each station".
3. Spline-fit spike detection: fit a spline to a moving window "usually a few hours long" and discard values exceeding n-sigma from the fit.
4. Stability/flat line test: flag when sea level does not change after a number of time steps. "The number of similar consecutive data points allowed depends on the location of the gauge, the point within the tidal cycle and the sampling interval of the data", and on units (mm or cm) and natural variability.
5. Date and time check: time grows chronologically, preferably at a regular interval; check for gaps.
6. Comparison of observations with tide predictions and QC of non-tidal residuals ("timing errors appear as tides in non-tidal residuals").
7. Rate of change test against a per-site threshold. The manual warns it "may also be difficult to apply to high-frequency sea level data (e.g. 1 minute sampling) due to the large natural variability of sea level at these time scales."
8. Attenuated signal: signal that "diminishes over a number of cycles", for example a blocked well orifice or a failed bubbler compressor.
9. Multivariate test against a secondary parameter (atmospheric pressure, wind).
10. Neighbour test or "buddy checking" against a second sensor or nearby station.

National practice noted on p. 12: the Australian National Tidal Unit NRT QC compares predictions with observations plus "elementary range checking", with 1-minute predictions computed a year ahead; Spain applies the spline fit iteratively to sea levels and non-tidal residuals.

On-site checks (section 2.2, p. 11): the Van de Casteele test during maintenance; on-site outlier rejection inside the sensor before averaging (NOAA rejects samples outside a 3-sigma band before forming the 6-minute value; Australia discards 1-second values outside 2 sigma before forming 1-minute means; REDMAR radars discard values outside a configurable x-sigma band in 2 Hz data).

## Near real time algorithm, SELENE/Puertos del Estado (section 2.3.1, pp. 13-17)

Used to illustrate L1; adopted by MyOcean and CMEMS.

- QC module, spike detection: spline fit over a moving window "of around 12-16 hours". It "cannot be applied in real time (latencies of 1 minute) because the procedure needs a long moving window to be able to detect spikes correctly, and not flag real phenomena such as sudden high frequency oscillations due to 'seiches' or tsunamis." Spline degree normally 2; values more than N standard deviations from the fit are flagged, "normally N=3". Window and degree depend on the tide and sampling.
- Interpolation module: adjust the time interval, interpolate flagged values, fill gaps with correctly dated null records, and interpolate "very short gaps (less than 10-25 minutes, ideally configurable depending on the tidal range)". 1-minute data are averaged to 5 to 10 minute series.
- Filter module (optional): hourly values from a symmetric filter (for 5-minute data, M = 54 terms, Pugh 1987); any filter that removes frequencies above 0.5 cycles per hour is acceptable.
- Tide-surge module (optional): Foreman tidal prediction from harmonic constants "obtained in delayed mode from ideally 1 year of data". The QC module is then re-run on the non-tidal residuals to catch "less obvious spikes", and newly flagged values are propagated back to the total sea level. Figures 6 and 7 show a reference change on 29 September 2019 that the first pass only partly flagged and the residual pass flagged completely; the software flags but does not correct the reference change.

## Delayed mode, L2 (section 2.3.2, pp. 18-21)

- "The primary quality control of sea level is based on the visual inspection of both recorded data and non-tidal residuals, especially useful for detecting instrumental faults such as timing errors, datum shifts and spikes."
- Tidal prediction quality caveat: "the harmonic constants may be severely corrupted if the site is characterized by highly nonlinear tides, influence of rivers or estuaries and particularly complex basin configuration." Recommends fresh tidal constants each year; never mix constants between tidal packages.
- Buddy checking without predictions; recommends "ideally at least three" sensors per site (Canadian Hydrographic Service practice).
- UHSLC "switch data": each station has a mechanical switch triggered daily at a surveyed elevation; sensor level at switch times reveals timing errors, sensor drift or switch faults.
- Review of yearly harmonic constants (vector plots of M2, K1, MSF) to spot clock errors and site changes.
- Clock malfunction: residual oscillations; constant lags found by lag correlation with predictions or by M2 phase before and after; shift data, interpolating if the lag is not a multiple of the interval. "These types of corrections are not typically implemented by automatic software packages."
- Gap filling: gaps under 24 hours may be filled from auxiliary gauges or interpolation (from GLOSS Manual II); glitches of 1 to 6 points likewise. UHSLC interpolates gaps under 24 hours by linearly interpolating the residual across the gap and adding back the prediction. Short gaps of a few minutes in 1-minute data should be interpolated before hourly filtering, with flags.
- Reference level changes: abrupt or gradual; large abrupt ones are visible in hourly residuals; smaller or gradual ones need months-to-years comparison with neighbours, GNSS, or altimetry. "Comparisons of monthly mean water level data are typically sufficient for identifying long-term changes of the order of a few centimetres." No fixed tolerance: "the tolerance for what magnitude of reference level shift is unacceptable depends on the configuration and robustness of the tide gauge station."
- Statistics used to set thresholds, updated annually: upper and lower historical limits (for the range check), tidal and observed ranges, extremes, mean and standard deviation of hourly values and residuals, monthly and annual extremes, density functions of hourly values, predictions and residuals.

## Entire records and monthly data (sections 2.4 and 2.5, pp. 21-25)

- Correlations between residual series; gap filling by regression if correlation with a neighbour exceeds 0.7.
- Standard Normal Homogeneity Test (Alexanderson 1986) for breakpoints, corrected only after comparison with other series and station history.
- EOF analysis across stations.
- Monthly means from daily means (Doodson X0, Demerliac, or UHSLC filter); PSMSL discards a month with more than 15 missing days; annual mean not computed if more than one month is missing.
- Altimetry comparison of daily or monthly means for gross datum errors (JASL routinely does this; PSMSL sometimes).
- Instrument-specific issues: pressure sensors and density assumptions, B-gauge datum checks, radar Point of Zero Range and objects or boats under the antenna, clogged stilling wells.

## Limits of automatic QC (section 4, pp. 34-40)

- SELENE flags constant values, out-of-range values, isolated and clustered spikes, and temporary datum changes "lasting less than approximately 30 min" (objects under a radar). "Longer persisting problems are more likely to be considered correct by the software." It cannot detect datum jumps, drifts or time errors.
- Figure 12: a radar obstruction was missed with spline windows of 1 to 5 hours and caught with an 8.3-hour (500-point, 1-minute) window.
- Figure 13: at NOAA Clearwater Beach (6-minute data) during Hurricane Michael, a single-point extreme was flagged as a spike by both SELENE and the NOC software; "Only reducing the time window of the algorithm to an hour would prevent the individual data to be flagged."
- None of the reviewed packages has a "doubt" flag (p. 40).
- Section 4 lists national practice: Australia BoM (prediction comparison plus range checks on 1-minute data), Canada CHS (three-sensor intercomparison plus forecasts), Italy ISPRA, Mexico UNAM, NIWA (NTR-based despiking, timing including daylight saving, interpolation up to 24 hours, datum shift checks), Kartverket, KHOA (variance-based automatic step then manual), SANHO (Lagrange polynomial fit), Spain SELENE, Sweden SMA, Rijkswaterstaat (delta, min/max, reference checks, M2 tide control), NOC (MATLAB software at psmsl.org/cme), NOAA (QARTOD).

## Flag scheme (section 2.7, pp. 26-27, Table 2)

| Flag | Meaning                                       | Definition                                                                                                                                                         |
| ---- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | No quality control                            | No quality control procedures have been applied to the data value.                                                                                                 |
| 1    | Good                                          | Good quality data value that is not part of any identified malfunction and has been verified as consistent with real phenomena during the quality control process. |
| 3    | Probably bad (previously "doubtful")          | Data value recognised as unusual during quality control that forms part of a feature that is probably inconsistent with real phenomena.                            |
| 4    | Bad (previously isolate spike or wrong value) | An obviously erroneous data value.                                                                                                                                 |
| 9    | Missing                                       | The data value is missing.                                                                                                                                         |

Codes 1, 4 and 9 are mandatory in NRT QC; unchecked data get 0. Flags 2 and 8 are deliberately left out because schemes disagree: "quality flag 2 is defined as 'interpolated value' for GESLA and ESEAS-RI, but as 'probably good' in the other schemes, some of which use quality flag 8 for 'interpolated value'." GESLA uses 5 for missing. Additional flags are allowed if clearly defined. The original series must always be preserved alongside any modified series (section 2, p. 10).

## Tide gauge specifics

Tsunami signals must survive real-time QC; seiches and tsunamis drive the long spike window; interpolation limits are tied to tidal range; tidal predictions degrade in nonlinear, riverine and estuarine sites; extreme single-point surges in 6-minute data are misflagged by spline methods; recommended practice is to average 1-minute data to the institution's usual sampling rather than fully QC all 1-minute data (p. 13).
