# EuroGOOS DATA-MEQ: Recommendations for in-situ data Near Real Time Quality Control (2010)

## Citation

EuroGOOS DATA-MEQ Working Group, 2010. Recommendations for in-situ data Near Real Time Quality Control. EG10.19, December 2010. 23 pp. DOI: https://doi.org/10.13155/36230 (Ocean Best Practices lists Version 1.2 under DOI 10.25607/OBP-214).

- PDF: https://archimer.ifremer.fr/doc/00251/36230/34790.pdf
- Also: https://cdn.ioos.noaa.gov/media/2017/12/recommendations_in_situ_data_real_time_qc.pdf

## License and local copy

No license in the document, on the Archimer record, or in DataCite metadata (empty rightsList). Link only.

## Flag scheme (section 2, p. 6)

Shared with SeaDataNet delayed-mode flags. Codes 0, 1, 4 and 9 are mandatory after real-time QC.

| Code | Definition                                |
| ---- | ----------------------------------------- |
| 0    | No QC was performed                       |
| 1    | Good data                                 |
| 2    | Probably good data                        |
| 3    | Bad data that are potentially correctable |
| 4    | Bad data                                  |
| 5    | Value changed                             |
| 6    | Below detection limit                     |
| 7    | In excess of quoted value                 |
| 8    | Interpolated value                        |
| 9    | Missing value                             |
| A    | Incomplete information                    |

Policy: "The QC flag value assigned by a test cannot override a higher value from a previous test." Values flagged 4 or 3 are ignored by later tests. Users: only flag 1 is safe without further analysis; 4 should be rejected; 2 "may be good for some applications"; 3 is "not usable but the data centre has some hope to be able to correct them in delayed mode"; 0 should not be used without the user's own QC.

## Sea level (section 6, pp. 19-22)

- Delivery timelines from GLOSS/ESEAS: real time (under 1 minute, tsunami; "quality control does not remove tsunami events by rejecting out-of-range data"; only stopped-gauge detection), near real time (1 hour to several weeks, automatic L1 QC), delayed mode (L2: tidal analysis, residual inspection, extremes, means, neighbour and model comparison, reference change detection).
- RTQC1, "highly recommended": strange character detection (record discarded); out-of-range flagging "based on extremes included in the metadata for each station"; spike detection; stability test ("A typical value, for example, is 3 for 5 minute data", that is, flag after 3 unchanged 5-minute values); date control.
- Spike algorithm: spline fit to a moving window "of around 12-16 hours", spline degree normally 2, flag values more than N sigma from the fit, "normally N=3". The long window is why it "can not be applied in real time" without flagging "seiches" or tsunamis. Re-run on non-tidal residuals to catch less obvious spikes; at Puertos del Estado it detected "more than the 95% of the wrong values of a very 'bad' series".
- Interpolation module: adjust time interval, interpolate flagged values, fill gaps with null records, interpolate gaps "smaller than 10-25 minutes, depending on the tidal range".
- RTQC2, "highly desirable": hourly filter (54-point symmetric filter for 5-minute data, Pugh 1987, removes frequencies above 0.5 cycles per hour) and tide-surge module (Foreman predictions from constants of about one year of data).
- Metadata needed for QC2 (section 6.3): one year of data or harmonic constants (at least 68 constituents), maximum and minimum expected levels (for out-of-range detection), maximum and minimum expected surge.

The sea level section matches Pérez et al. (2010) for MyOcean (see [myocean-sea-level-nrtqc-2010.md](myocean-sea-level-nrtqc-2010.md)) almost word for word.
