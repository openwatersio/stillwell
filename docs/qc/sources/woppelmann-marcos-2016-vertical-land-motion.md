# Vertical land motion at tide gauges from GPS and altimetry (Wöppelmann and Marcos 2016)

## Citation

Wöppelmann, G., and Marcos, M., 2016, Vertical land motion as a key to understanding sea level change and variability, Reviews of Geophysics, 54(1), 64 to 92.

- DOI: https://doi.org/10.1002/2015RG000502
- Copy read: https://igppweb.ucsd.edu/~fialko/insar/Woppelmann_RevG.pdf (publisher layout); also deposited at https://hal.science/hal-01283016

## License and local copy

"©2015. American Geophysical Union." Free to read on the publisher site but not under an open license. No PDF; link only.

## What it is

A review of how to measure vertical land motion (VLM) at tide gauges, mainly with GPS at or near the gauge and with satellite altimetry minus tide gauge differences. For QC purposes it shows how the long-record comparisons are set up, what selection and screening rules are used, and what accuracy can be expected.

## Why it matters for long records (sections 1 and 2, pp. 64 to 68)

A tide gauge measures sea level relative to the land its benchmarks sit on. For climate studies, VLM should be known with standard errors about one order of magnitude below the 1 to 3 mm/yr signals, about 0.5 mm/yr at 95% confidence. Satellite altimetry minus tide gauge gives an estimate of VLM, but its accuracy "is usually in excess of 1 mm/yr."

## GPS at tide gauges and the geodetic tie (section 2, pp. 68 to 73)

- Equipment or site changes "have proven to introduce millimeter- to centimeter-level offsets in GPS position time series"; continuous observation with good equipment logs lets these offsets be detected and modeled.
- Only 120 of 289 GLOSS core gauges had a permanent GPS antenna within 1 km (citing Gravelle et al. 2015). Fewer than 14% had GPS on the gauge structure itself, and only 22% of nearby GPS stations had levelling to the gauge available. Without a measured tie, users must assume no differential motion between antenna and gauge benchmark; otherwise that motion "must be monitored either by periodical leveling or by other geodetic means."
- On average about 12 years of GPS data were needed for the velocity error to drop below 0.5 mm/yr.

## Altimetry minus tide gauge setup (section 3.1, pp. 74 to 77)

- Input: PSMSL RLR monthly means with at least 15 years of valid data in 1993 to 2014, between ±66° latitude, giving 598 records.
- Screening: "All records were first visually inspected to detect the remaining datum shifts, outliers, or the signature of nonlinear processes such as earthquakes or river discharges." Affected series were dropped. Japanese data after February 2011 within 500 km of the Tohoku epicenter were removed.
- Pairing with altimetry: three variants, the closest grid point, the most correlated grid point within 4° (using deseasoned, detrended series), and the average within 1° of the gauge.
- The difference series were inspected again and those "clearly nonlinear" were dropped, as were gauges in rivers or small basins with no matching altimetry. At most 478 stations remained.
- Atmospheric effects (inverse barometer or the dynamic atmospheric correction) were removed from the gauge data to match the altimetry.
- Standard deviations of monthly altimetry minus gauge differences are mapped; the annual cycle left in the differences had a median under 2 cm for most products.

## Uncertainty (section 3.2, pp. 78 to 79)

Rate uncertainties were computed with a power law plus white noise model, since assuming white noise alone underestimates them (by a factor of 2.4 for the lowest-uncertainty product). Altimetry minus gauge rate uncertainties ranged from 0.3 to 3.0 mm/yr; GPS uncertainties were much smaller. At 107 sites with both, GPS minus altimetry-gauge VLM had a median difference of 0.25 mm/yr and RMS of 1.47 mm/yr.

## Selection criteria for long records (section 4, p. 83)

The 485 sites used for coastal sea level change passed "the standard quality control selection criteria ... in particular the requirements of 70% of valid data over a given period, datum continuity, and visual inspection of the time series for detection of nonlinear behavior."

## Errors found

Vertical land motion and its changes (earthquakes), residual datum shifts, and gauge drift relative to an independent geocentric reference. Detection here is visual, not by threshold.
