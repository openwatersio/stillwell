# Copernicus Marine In Situ TAC: Quality Information Document for the delayed-mode sea level product INSITU_GLO_PHY_SSH_DISCRETE_MY_013_053 (QUID v1.3, 2025)

## Citation

Lin Ye, J. and Pérez Gómez, B., 2025. Quality Information Document. In Situ TAC INSITU_GLO_PHY_SSH_DISCRETE_MY_013_053. And Synthetic Quality Overview document (SQO). Ref CMEMS-INS-QUID-013-053, Issue 1.3, 16 May 2025, approved 13/11/2025. Copernicus Marine In Situ TAC. 32 pp. DOI: https://doi.org/10.13155/99217 (DataCite lists creators Pérez Gómez, Lin-Ye and Hibbert; earlier issues 1.1 of 2023 and 1.2 are obsolete).

- PDF read: https://archimer.ifremer.fr/doc/00880/99217/123974.pdf (identical text to https://documentation.marine.copernicus.eu/QUID/CMEMS-INS-QUID-013-053.pdf)

## License and local copy

No license in the document or DataCite metadata. Link only.

## What it is

The most detailed published description of an operational delayed-mode (L2) tide gauge QC with explicit thresholds. Applied by Puertos del Estado and Nologin twice a year to the global multi-year sea level product, starting from a frozen copy of the NRT product plus UHSLC and VLIZ (IOC SLSMF) GLOSS data. Visual inspection validates all automatic flags. Flag scale: Copernicus In Situ TAC scale (see [cmems-insitu-qc-procedure-2025.md](cmems-insitu-qc-procedure-2025.md)).

## NRT tests that precede it (section III, p. 12)

Invalid characters, wrong date/time, out-of-range (station-dependent thresholds), spline-fit spikes, constant values (stuck value or stability test). "To date (November 2025), none of the regions compute the non-tidal residuals in near-real time, despite the fact that the application of automatic quality control procedures to this sea level component would significantly improve the detection of incorrect data."

## Which tests run on which series (Table 3, p. 13)

| Test               | Raw data | Non-tidal residuals | Hourly | Monthly means |
| ------------------ | -------- | ------------------- | ------ | ------------- |
| Strange characters | X        |                     |        |               |
| Date and time      | X        |                     |        |               |
| Out of range       | X        | X                   |        |               |
| Stability/flatline | X        | X                   | X      |               |
| Attenuated signal  |          |                     | X      |               |
| Spike detection    | X        | X                   |        |               |
| Buddy checking     |          | X                   |        | X             |
| Clock malfunction  |          | X (visual)          |        |               |
| Datum change       |          | X                   |        | X             |

## By-products (section III.1.1, pp. 14-16)

- Resampling: interpolate isolated flagged spikes and gaps of "10-25 min, configurable depending on the tidal range" into a clean 5-minute series.
- Hourly values: 54-term symmetric filter on 5-minute data (Pugh 1987), 4.5-hour filter length.
- Harmonic analysis: UTide on hourly data, yearly, 67 constituents. A year is used only if gaps longer than 0.5 week total less than 1 month and, for all months, log10(max(A)/min(A)) ≤ 0.7 where A is the monthly M2 amplitude; otherwise constants are borrowed from a complete year within three years. Non-tidal residuals are low-pass filtered (Butterworth, 15-hour cutoff for distributed residuals) to remove tidal remnants.

## Automatic delayed-mode tests and thresholds (section III.1.2, pp. 16-19)

Tests run with each value centred in its window, which is not possible in real time. If the datum is unstable, the series is adjusted first so range tests work.

- Out of range: limits per station "from the 99th percentile (q99) of historical data, as ±3 q99". Same for non-tidal residuals. Rationale: tidal range varies from about 16 m (Bay of Fundy) to near zero in much of the Mediterranean, and with datum choice.
- Stability (flat line): limit_stuck = 10 + C_precision + C_series + C_visual consecutive equal values. C_precision = 15 if data are in cm, else 0. C_series = 10 if over 50% of the historical series has stuck data (same value for at least two intervals), else 0. C_visual = 0 initially, raised to 20 (sampling ≥ 10 min) or 40 (sampling < 10 min) if visual inspection finds many false flags, which "may happen in stations with very small sea level signal and precision (cm)".
- Attenuated signal: on hourly values, 12-hour window centred on value i; flag when (slev(i) minus rolling mean) < q75 / C_att,1 and rolling std(i) < std / C_att,2, with q75 and std from the historical series. Constants depend on tidal range and even spring/neap phase; for macrotidal spring tides (q75 > 1.0 m above MSL) C_att,1 = 2 and C_att,2 = 3 work well.
- Spikes, spline fit (defaults, adjustable per station):
  - Total sea level: degree 2, n-sigma 3, window 500 points (sampling < 5 min), 100 points (5 to < 15 min), 40 points (≥ 15 min).
  - Non-tidal residuals: degree 3, n-sigma 5, window 1000, 200, 80 points for the same sampling classes.
- Persistent spikes (added November 2023): after the spline test, compute forward and backward gradients; start flagging QC = 4 when the gradient exceeds a tolerance and |slev(i) - median| > 2 x q99; stop when the deviation falls below 3 x q99 and the backward gradient is within tolerance. (The gradient tolerance value is not given.)
- Buddy check: two neighbours within 0.1° to 0.5°; flag de-tided series where differences exceed 1.0 m and monthly means where they exceed 0.5 m. Datum check on monthly means: if the difference in monthly gradient between target and neighbour exceeds 100 mm/month for over three months, the period is flagged as a potential datum problem and confirmed visually.

## Datum adjustment (section III.1.3, p. 19)

For stations with obviously unstable datums and no provider metadata, the median of each datum period is shifted to a "standard datum" (that of December 2024) and published as SLEV_ADJUSTED, with original SLEV kept. More than 50 of 822 stations affected. These adjusted series "cannot be considered reliable for estimating sea level trends".

## Visual inspection (section III.1.4, pp. 19-20)

"Visual inspection of non-tidal residuals and differences with nearby stations is particularly important for detecting clock malfunction or datum changes, as these types of errors, very common in tide gauges timeseries, are difficult to detect or correct with existing automatic procedures." Clock malfunction periods (oscillations in residuals) are flagged manually QC = 3 (bad, potentially correctable); "For now, this type of error is not flagged automatically." Flags found on residuals are propagated to total sea level as QC = 4.

## Accuracy (section I.3, p. 8)

Expected accuracy after validation for good-flagged data: < 1 cm for instantaneous and filtered hourly values.
