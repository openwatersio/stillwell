# SHELDA: sub-hourly European quality controlled sea level dataset (Balić and Šepić 2026)

## Citation

Balić, M., and Šepić, J., 2026, SHELDA: sub-hourly European quality controlled sea level dataset, Earth System Science Data, 18, 7143 to 7179.

- DOI: https://doi.org/10.5194/essd-18-7143-2026
- Dataset: https://doi.org/10.14284/764

## License and local copy

CC BY 4.0 for both paper (p. 7143) and data. PDF included: [pdf/shelda-balic-sepic-2026.pdf](pdf/shelda-balic-sepic-2026.pdf) (5.0 MB).

## What it is

A compilation of 257 European tide gauge records sampled every 1 to 15 minutes, taken from the IOC Sea Level Station Monitoring Facility (which does no QC), cleaned, and published with tidal residuals. Records run from one month to 13 years. It documents a multi-step QC including buddy checks and a clock error found through residual analysis, and it says which corrections it did not attempt.

## Error types (section 2.2, pp. 7146 to 7148)

Raw data showed "out-of-range values, gaps, flat lines, isolated and clustered spikes, drifts, vertical shifts, time errors, and datum changes," caused by "electronic noise in measurements, problems in sensor calibration, stabilization, clock failures, instrumental drifts, transmission mistakes." A drift is a gradual change (attenuation, rise or fall of background level); a vertical shift is a sudden change in the mean. Because the IOC portal lacks metadata to confirm benchmark changes, "all sudden changes in the mean value are referred to as vertical shifts."

## Five-step QC (section 2.2.2, pp. 7148 to 7149)

1. Major vertical shifts were found visually and removed by subtracting the mean of the affected period. The authors note this "does not completely remove" the shift, since the two parts may not share a mean.
2. Out-of-range values: for 1-minute data, values differing by 50 cm from one neighboring value and by 30 cm from both neighbors are removed (thresholds from earlier IOC-data studies). For coarser sampling, a 1 m jump from the neighboring value is used.
3. Spike detection (1-minute records only): the Williams et al. (2019) algorithm, run twice, removes values more than three standard deviations from a least squares spline. Left over: spikes near other spikes, spike clusters, "minor vertical shifts and constant sea level values over time."
4. Visual inspection of every record in consecutive 10-day windows.
5. Buddy checking for 11 records, mostly 10- and 15-minute data, where visual checks showed "attenuated signals, and variations in phase and amplitude." Because these could not be judged "false" from one series alone, "measurements were compared with those from the two nearest tide gauges." The comparison decided whether oscillations "were caused by an event that propagated along a coastline or were they non-physical." Example: Den Helder, Harlingen, and Terschelling in the Netherlands (Fig. 3).

## Clock error found from residuals (section 2.2.3, p. 7149)

After tidal analysis with T_Tide, "analysis of the residual signal ... revealed that the tidal signal was not estimated/removed properly at seven Norwegian stations," which also showed a vertical offset. The cause was a time-zone error: data labeled UTC on the IOC portal "were in reality in UTC+1 during standard time and UTC+2 during Daylight Saving Time." Timestamps were corrected (−2 h in daylight saving time, −1 h otherwise) up to 17 March 2020, when the provider began sending true UTC, and checked against data downloaded directly from the provider (Kartverket).

## QC statistics (section 2.2.4, pp. 7149 to 7151)

On average 79.64% of data are high quality, 18.75% missing, and 1.61% removed. Of removed data, visual control (including buddy checks) accounts for 55.31%, spike detection 23.38%, and out-of-range detection 21.31%. "Visual inspection remains essential despite automated procedures." Flat lines and clustered spikes were the hardest for automatic methods.

## Flags (section 3, p. 7152)

The NetCDF files hold the QC'd series, the residual, and a QC flag variable: 1 high-quality data, 2 missing data, 3 removed data. There is no separate flag for interpolated or suspect-but-kept values.

## Not done

Datum shifts were not corrected, only large vertical shifts adjusted by mean subtraction; the abstract lists "corrections of datum shifts" among procedures "not implemented."
