# GESLA-2: Towards a global higher-frequency sea level dataset (Woodworth et al. 2016)

## Citation

Woodworth, P.L., Hunter, J.R., Marcos, M., Caldwell, P., Menéndez, M., and Haigh, I., 2016, Towards a global higher-frequency sea level dataset, Geoscience Data Journal, 3(2), 50 to 59. The PDF page footer reads "Geoscience Data Journal 3: 50–59 (2017)"; GESLA-3 and TICON cite it as Woodworth et al. (2017).

- DOI: https://doi.org/10.1002/gdj3.42
- Copy read: https://archimer.ifremer.fr/doc/00488/60015/63265.pdf (publisher version)

## License and local copy

Open access under the Creative Commons Attribution License (stated on p. 50). PDF included: [pdf/gesla2-woodworth-2016.pdf](pdf/gesla2-woodworth-2016.pdf) (0.5 MB).

## What it is

The data paper for GESLA-2, a compilation of hourly or faster tide gauge records from about 30 providers. It is mostly about assembly and format. It is useful here for what it says about how much QC the compilation itself does, which is very little, and for its description of the UHSLC research quality dataset as the place where comparative QC happens.

## Delayed-mode data and why QC needs a delay (p. 50 to 51)

The paper separates sea level data by latency into real time, "fast" (days to weeks), and delayed mode. Delayed-mode data reach users "from days to years" after recording. "This delay enables data centres to perform a thorough inspection and quality control, including the assignment of flags to show subsequent users whether data are good, suspect or bad. Delayed-mode processing is essential to ensure the quality of data used in scientific research." Real-time data have "no requirement for, or possibility of, rigorous quality control," and fast data "may have been subjected to some quality control."

## UHSLC research quality dataset as the comparative check (p. 52)

The JASL (Joint Archive for Sea Level, the UHSLC research quality dataset) "acquires hourly datasets ... that have received a final quality assessment from the data originators. JASL provides an independent check of the data, primarily to identify any remaining outliers, timing issues or datum shifts." Problems go back to the originators. JASL then assembles one hourly series per station, "or a series of subrecords if datum changes occur over time." The paper contrasts two treatments of bad data:

- JASL is a "data product" in which "problematic data points are not simply flagged and left in the records ... but are actually changed to best assessed values by JASL. Any changes are documented in the metadata information."
- The BODC GLOSS delayed-mode dataset flags problems and leaves the values in place.

## QC done by GESLA-2 itself (p. 56)

"The records in GESLA-2 will have had some form of quality control undertaken by the data providers. However, the extent to which that control will have been undertaken will inevitably vary between providers and probably with time." Large tsunami signals have probably been removed or flagged, but small ones remain. "In most cases, no further quality control has been made beyond that already undertaken by the data providers." For NOAA stations GESLA-2 uses the "verified hourly values" rather than the 6-minute data.

## Flags (Table 1, p. 56)

Each value carries a QC flag taken from the provider: 0 no quality control, 1 correct value, 2 interpolated value, 3 doubtful value, 4 isolated spike or wrong value, 5 missing value. A second column flags whether the value was used in the extremes analysis (1 used, 0 not used). Interpolated values have their own flag code and are kept distinct from measured values.

## Not covered

No neighbor comparison, timing check, residual test, or step detection is done by GESLA-2. No thresholds.
