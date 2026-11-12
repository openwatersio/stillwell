# PSMSL data checks, RLR datum continuity, and buddy checking

## Citation

Permanent Service for Mean Sea Level (PSMSL), National Oceanography Centre, Liverpool. Web documentation read 11 November 2026:

- PSMSL help file (psmsl.hel), section "PSMSL DATA CHECKS": https://psmsl.org/data/obtaining/psmsl.hel
- Revised Local Reference (RLR) definition: https://psmsl.org/data/obtaining/rlr.php
- Individual station data and plot notes (file formats and flags): https://psmsl.org/data/obtaining/notes.php
- Contributing data to the PSMSL: https://psmsl.org/data/supplying/

The help file points to Woodworth, P.L., Spencer, N.E., and Alcock, G.A., 1990, International Hydrographic Review, 67(1), 131 to 146, and IOC (1992) for the original description of the checks. Neither was read.

The PSMSL overview paper, Holgate, S.J., et al., 2013, New data systems and products at the Permanent Service for Mean Sea Level, Journal of Coastal Research, 29(3), 493 to 504, https://doi.org/10.2112/JCOASTRES-D-12-00175.1, could not be read: it is not open access and the NORA copy is restricted. Its content is not summarized here.

## License and local copy

Web pages, no license statement found. No PDF; links only.

## Datum continuity: Metric versus RLR (rlr.php; psmsl.hel)

Data are entered as received into the "Metric" file. Within one year values must share a datum, "although, at this stage, datum continuity between years is not essential." To build a time series, PSMSL reduces monthly and annual means to a common datum using the tide gauge datum history from the supplying authority. The RLR datum is about 7,000 mm below mean sea level. About two thirds of stations are RLR.

"Without the provision of full benchmark datum history information, records generally remain as 'Metric only' ... In general, 'Metric' records should NEVER be used for time series analysis or for the computation of secular trends. Without datum continuity their only use is in studies of the seasonal cycle of mean sea level."

Records tied to national levelling networks are usually not RLR because re-levelling can introduce datum shifts. PSMSL made exceptions for some German records (relative to Normal Null) and for most Dutch records, where a 2005 re-levelling of NAP introduced a small shift; those now carry separate RLR factors before and after 2005.

What PSMSL asks of suppliers (supplying page): the datum the values refer to, its measured depth below the primary tide gauge benchmark (TGBM), any changes in datums, benchmarks, or procedures since the last batch, and an indication of incomplete or interpolated data.

## The seven PSMSL data checks (psmsl.hel, "PSMSL DATA CHECKS")

Designed to catch "gross errors in the dataset such as transcription errors or large unrecorded datum changes." Some are "common sense," others "statistical":

1. The average of the monthly means must agree with the quoted annual mean.
2. Datum information must be consistent with previous knowledge, using back correspondence and simple time series plots.
3. Outliers: for each calendar month separately, and for annual means, "for all possible time-spans containing at least 20 years of data," a linear fit is made and "any individual monthly mean value more than 4.5 standard deviations from the fitted line is flagged."
4. Wrong datum information: regressions of RLR annual means against the supplied datum correction factors ("RLR factors") over all possible 20-year spans. "A correctly adjusted RLR time series should be uncorrelated with the RLR factors."
5. Jumps: for each calendar month separately and for annual means, "the difference between a mean value and the corresponding value for the next year of data is histogrammed and any outlier more than 4.5 standard deviations from the mean-difference is flagged."
6. "Upside down" data (values given as distance below a benchmark): the seasonal cycle would look opposite to neighboring records and to oceanographic and meteorological expectations.
7. Buddy checking: "the RLR data from one station is subtracted from that of a neighbouring station (or 'buddy') which is less than 400km away. Over this short distance most of the MSL variability due to oceanographic and meteorological forcings in the two records should be similar and will cancel out giving a difference time series primarily composed of relative vertical land movements, instrumental and datum errors and any small spatially varying ocean and weather influences. The previous tests are then applied to the difference time series and any discrepancies are flagged."

"These tests have been applied to the entire dataset and inconsistencies have been referred back to the national authorities."

What each check finds (a summary of the stated aims, not PSMSL wording): checks 4, 5, and 7 target datum shifts and level steps; check 3 targets outliers; check 7 also exposes relative land motion and instrument drift between neighbors; check 6 targets sign errors.

## Flags and gap handling (notes.php; psmsl.hel; supplying page)

- Monthly files give the number of missing days per month; the value 99 means the month was interpolated.
- A monthly mean is computed if 15 or fewer days are missing. Annual means are dropped if more than one month is missing; the annual flag "Y" means one month is missing or at least 30 days are missing in the year.
- "Flag for attention" 001 means "the data should be treated with caution and that the associated documentation file should be read." Flag 010 marks a mean tide level value in a mean sea level series (adjusted to an MSL estimate in RLR); PSMSL recommends values flagged 011 "not be used in analysis of long-term trends."
- A station-level quality flag (Y/N) in filelist.txt points users to the documentation.
- Advice to suppliers on gaps: interpolate small gaps early. "One principle to adopt is that of a comparison with the complete records from a nearby station. However we would stress that predicted values are not suitable for interpolation because of meteorological effects." No monthly mean if more than 15 days are missing; interpolated or missing-day counts must be reported with each value.

## Not covered

No timing checks (PSMSL holds monthly and annual means). No treatment of stuck values. The full Holgate et al. (2013) paper was not read.
