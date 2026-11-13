# GESLA Version 3 (Haigh et al. 2023)

## Citation

Haigh, I.D., Marcos, M., Talke, S.A., Woodworth, P.L., Hunter, J.R., Hague, B.S., Arns, A., Bradshaw, E., and Thompson, P., 2023, GESLA Version 3: A major update to the global higher-frequency sea-level dataset, Geoscience Data Journal, 10(3), 293 to 314. First published online in 2022, so it is also cited as Haigh et al. (2022).

- DOI: https://doi.org/10.1002/gdj3.174
- Copy read: https://nora.nerc.ac.uk/id/eprint/533200/ (publisher version, 22 pages; page references below are journal pages)

## License and local copy

Open access under the Creative Commons Attribution License (stated on p. 293). PDF included: [pdf/gesla3-haigh-2023.pdf](pdf/gesla3-haigh-2023.pdf) (3.7 MB).

## What it is

The data paper for GESLA-3: 5,119 records, 91,021 station-years, from 36 providers, at hourly or faster sampling. Like GESLA-2 it mostly relies on provider QC, but it adds a visual record-level grade and describes how it handles time zones, duplicates, and homogenized records.

## Comparative QC it relies on: UHSLC (p. 294)

The UHSLC Joint Archive for Sea Level data "have been inspected for outliers, timing issues, and datum shifts, and efforts have been made to reconcile quality issues with the data originators." UHSLC leaves out many records in dense regions "to balance global coverage with the time-intensive process of quality assessment," with an update cycle of about two years.

## Records split at datum jumps (p. 295)

One station can have several records "because sometimes sea-level time series for the same station is split into different records when there are datum jumps or changes in the location or instrument (i.e., the UHSLC dataset contains such records, and these are denoted by letters, A, B, C, etc. after the station code)."

## Homogenized versus raw data (p. 303)

For Australia, the ANCHORS project "applied statistical techniques to remove stepwise changes in annual means resulting, for example, from datum shifts and tide gauge relocations." GESLA-3 deliberately took the unhomogenized ANCHORS data "so that quality control processes applied in GESLA-3 are internally consistent."

## Time handling (p. 303)

All records are converted to UTC. USGS and CDWR data were in daylight saving time in summer and were shifted to standard time first, "however, the times of annual shifts between Daylight Savings Time and Standard Time are imperfectly documented, some errors may remain." Sub-hourly data from some providers were averaged to hourly using all values within plus or minus 30 minutes of the hour. When providers offered several sampling rates, GESLA-3 took the hourly series, partly because "the higher-frequency records are generally much shorter, and the quality control is often less rigorous."

## Record-level grade from visual inspection (p. 304)

A new header line gives an "overall record quality" from "a brief, qualitative expert judgement assessment ... made by visually inspecting every record." Categories and counts:

- no obvious issues: 4,747
- possible datum issues: 149
- possible quality control issues: 179
- possible datum and quality control issues: 46

The paper suggests users studying trends in extremes "only use long records identified to have no obvious issues."

## Record removal and gauge type (p. 305)

"If a record had no clear tidal signal, for at least part of the year, it was removed." Each record is also classed as coastal (4,159), river (784), or lake (178) by visual inspection, based on whether the signal is dominated by tides or by river influence.

## Value flags and their use (p. 305 to 306)

Column 4 holds the provider's QC flag mapped to the GESLA codes: 0 no quality control, 1 correct value, 2 interpolated value, 3 doubtful value, 4 isolated spike or wrong value, 5 missing value. "Due to the huge effort it would require, we did not undertake further extensive quality control of our own. However, we did visually inspect each record individually, and we manually flagged suspect values that were clearly outside of the normal range or were isolated spikes. It is clear that data quality is poor for some sources, and datum jumps do exist."

Column 5 is a use-in-analysis flag: flags 0, 1, and 2 (including interpolated values) become 1 (use); flags 3, 4, and 5 become 0 (do not use).

## Duplicates and advice to users (p. 310)

Some sites have records from several providers that may differ in length and QC. The authors advise using the longest and most up to date record, or the agency "giving the most attention to data quality (e.g., UHSLC in many cases)." They "recommend, therefore, that researchers do due diligence and carry out additional quality assurance that is commensurate with their goals and needs."

## Related material not verified

An EGU 2022 abstract by Marcos, Haigh, Talke, Hart-Davis, Dettmering, Woodworth, and Hunter ("The new GESLA-3 tide gauge data set and its quality control for tidal studies," https://meetingorganizer.copernicus.org/EGU22/EGU22-3944.html) describes tools that homogenize and quality control raw GESLA files "including adjustments of datum jumps and time shifts." A search snippet of the slides reported datum jumps in 219 of 1,022 records (21%), "a non-negligible number" of stations with timing problems, and M2 amplitude changes of about 1 cm after timing corrections. The slides could not be opened (bot protection on the host), so the detection method and these figures are unverified.

## Not covered

No neighbor comparison, automated timing check, or step detection is applied by GESLA-3 itself. The paper does not describe a rule for preliminary versus verified data. It notes only that record counts drop in the most recent years "because the 'delayed mode' or 'research quality' data become available with a typical delay of a few years during which data centres perform quality control" (p. 303).
