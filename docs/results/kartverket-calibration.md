# Calibration of the harmonic fits against Kartverket's constants

Kartverket, the Norwegian Mapping Authority's Hydrographic Service, publishes harmonic constants for its gauges, analyzed from its own observations of them, which the store holds as `kartverket`. This report fits 24 of those gauges, every one in the store's list whose constants are from a period that ends with 2020 and starts before 2011, from the store the way that reproduces Kartverket's analysis, and compares the constants with Kartverket's, constituent by constituent. It is written by [`scripts/calibrate-kartverket.ts`](../../scripts/calibrate-kartverket.ts) (`npm run calibrate:kartverket`), with every number in [kartverket-calibration.json](kartverket-calibration.json), and is run again whenever the method changes. [Checks](../contributing/checks.md#kartverket) says how to run it, and the [calibration against NOAA](fit-calibration.md) is its companion. Kartverket's constants, which each gauge's table and the JSON carry, are © Norwegian Mapping Authority, Hydrographic Service, under [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/), from [its tide and water-level data](https://kartverket.no/en/api-and-data/tides-and-water-level-data). Amplitudes are in meters where Kartverket gives centimeters, and phases are moved to UTC as the report says.

These fits ran with @slackwater/engine@1.0.0-beta.15, method 1 of [`src/fit/`](../../src/fit/), and 2024 as the source's last year of final values.

## What is compared

Kartverket's constants are from its tide API's `constituents` request, which gives amplitudes in centimeters, to a hundredth, and phases to a hundredth of a degree against UTC+1, with the period of observations analyzed ([Kartverket](../../src/sources/kartverket/README.md)). The API doesn't describe the analysis. The fit compared here is the one that reproduces it from the store's values: one least-squares fit over Kartverket's period, without robust weights, of Kartverket's own constituents, with Foreman's nodal corrections at the gauge's latitude evaluated at each sample. It reads the store's final values on the hour, which for Kartverket are every value a year old or more that isn't flagged suspect or bad, since Kartverket marks none as checked. With robust weights, as the store's own fits have, the same fit is a median 0.190 mm from Kartverket's constants over a gauge's short-period constituents, against 0.036 mm without them.

Two corrections bring Kartverket's constants and the fit's to the same terms. Kartverket has answered on the clock, as far as it can see. The filter isn't documented and is taken from the comparison itself, so on it the comparison shows consistency and is no independent check; it is a question for Kartverket ([questions](../../src/sources/kartverket/errata.ts)):

- **The filter.** Kartverket's constants are smaller than the fit's above four cycles a day, as the gain of a low-pass filter would make them, which they would be if its analysis read a series filtered beyond the 10-minute values its API serves. The fit's amplitudes and their intervals are scaled by the gain of a zero-phase Butterworth filter of order 4 with a cutoff of 2.98 hours, which [The filter](#the-filter) estimates from the constants at 67.5° an hour and faster. Below that speed the gain is within 0.94% of one, and at four cycles a day it is within 0.37%, so the diurnal, semidiurnal and third-diurnal constants are compared very nearly as fitted.
- **The clock.** Kartverket's phases are moved to UTC by the constituent's speed over one hour, which Kartverket states, and over terrestrial time minus UTC, 67.2 to 67.9 s in these periods: Kartverket answered on 27 November 2026 that, as far as it can see, its analysis runs in terrestrial time (question [`kartverket-constants-clock`](../../src/sources/kartverket/errata.ts)). [Gauges](#gauges) gives the seconds each gauge's fitted phases ask for, with their intervals.

A constituent is **outside** where its amplitude or phase differs from Kartverket's by more than the fit's 95% interval, widened in quadrature by half of Kartverket's last digit (0.05 mm and 0.005°). Constituents slower than 2.5° an hour are counted apart.

Kartverket's constants, the fit compared with them and the store's own fit of each gauge are each scored on the store's held-out year, in [The held-out year](#the-held-out-year). Kartverket's and the compared fit's are predicted under Foreman's corrections at the gauge's latitude, and the store's own under Schureman's.

## Summary

|  | All | Under 67.5° an hour | 67.5° an hour and faster |
| --- | ---: | ---: | ---: |
| Constituents compared | 1241 | 1009 | 232 |
| Outside the fit's interval | 11 of 1241 (0.9%) | 10 of 1009 (1.0%) | 1 of 232 (0.4%) |
| Outside and over 1 mm apart | 0 | 0 | 0 |
| Median vector difference | 0.035 mm | 0.037 mm | 0.030 mm |
| Largest vector difference | 0.56 mm | 0.56 mm | 0.18 mm |

- **The major constituents.** 169 of M2, S2, N2, K2, K1, O1, P1, Q1 are 1 cm or more. Their amplitudes differ from Kartverket's by a median of 0.038% and at most 1.34%, and their phases by a median of 0.014° and at most 0.90°. 1 of them is outside.
- **Outside.** 11 constants at Hammerfest (10), Stavanger (1). [Outside the interval](#outside-the-interval) lists them.
- **Without the filter's gain** the constants at 67.5° an hour and faster are a median 0.118 mm from Kartverket's, and with it 0.030 mm.

## The filter

Over the 165 constants at 67.5° an hour and faster of 0.5 mm or more, the RMS difference between the fit's amplitude and Kartverket's is 0.433 mm with no filter. For each even order, the cutoff that leaves the least, searched from 1.50 to 5.00 hours by hundredths:

| Order | Cutoff (hours) | RMS difference (mm) |
| --- | ---: | ---: |
| 2 | 2.21 | 0.1281 |
| 4 | 2.98 | 0.0366 |
| 6 | 3.27 | 0.1514 |
| 8 | 3.46 | 0.2577 |

The comparison uses order 4 and 2.98 hours, which leaves 0.0366 mm. That is the least of all. The filter is estimated from the constants it is then used to compare, so agreement at these speeds says the constants are consistent with one such filter at every gauge, and nothing more.

The other way to allow for the filter is to run the store's 10-minute values through it and fit what comes out. That was done for 24 of the 24 gauges, from the values on the 10-minute grid, with gaps of up to 1 hour filled in a straight line, runs of 4 days or under left out, 1 day dropped at each end of a run, and the result read on the hour. The median vector difference from Kartverket's constants is 0.035 mm by the gain and 0.037 mm by the filter in time over all short-period constituents, and 0.030 mm by the gain and 0.028 mm by the filter in time at 67.5° an hour and faster. The two ways differ by 0.002 mm in that median. The comparison scales by the gain, which needs no rule for gaps and keeps the fit's intervals.

## Gauges

Each gauge's period as Kartverket gives it, the hourly values the fit read, how many constituents are compared and outside, the one furthest outside, and the seconds past one hour its phases ask Kartverket's to be moved by, from the constituents faster than 10° an hour and of 5 mm or more, weighted by amplitude squared, with the half-width of its 95% interval from the fit's phase intervals. The last column is the window of the store's own fit of the gauge.

| Gauge | Name | Latitude | Period | Hourly values | Compared | Outside | Largest ratio | Phases ask for (s) | The store's fit |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `kartverket/AES` | Ålesund | 62.5°N | 2006-01-01 to 2020-12-31 | 131,250 | 53 | 0 | M2 0.51 | 68.8 ± 2.8 | 2005–2023 |
| `kartverket/ANX` | Andenes | 69.3°N | 2006-01-01 to 2020-12-31 | 131,459 | 56 | 0 | M8 0.91 | 68.2 ± 2.4 | 2005–2023 |
| `kartverket/BGO` | Bergen | 60.4°N | 2006-01-01 to 2020-12-31 | 131,284 | 52 | 0 | M3 0.38 | 68.0 ± 4.6 | 2005–2023 |
| `kartverket/BOO` | Bodø | 67.3°N | 2006-01-01 to 2020-12-31 | 131,133 | 53 | 0 | 2MK6 0.88 | 67.7 ± 2.7 | 2005–2023 |
| `kartverket/HAR` | Harstad | 68.8°N | 2006-01-01 to 2020-12-31 | 131,338 | 56 | 0 | SO3 0.53 | 68.0 ± 2.5 | 2005–2023 |
| `kartverket/HEI` | Heimsjøen | 63.4°N | 2006-01-01 to 2020-12-31 | 130,924 | 52 | 0 | 2MK5 0.79 | 68.3 ± 2.5 | 2005–2023 |
| `kartverket/HFT` | Hammerfest | 70.7°N | 2006-01-01 to 2020-12-31 | 131,227 | 57 | 10 | OQ2 1.42 | 67.8 ± 2.8 | 2005–2023 |
| `kartverket/HRO` | Helgeroa | 59.0°N | 2006-01-01 to 2020-12-31 | 131,356 | 44 | 0 | MSK6 0.41 | 68.0 ± 50.0 | 2005–2023 |
| `kartverket/HVG` | Honningsvåg | 71.0°N | 2006-01-01 to 2020-12-31 | 131,222 | 59 | 0 | M6 0.59 | 68.0 ± 3.0 | 2005–2023 |
| `kartverket/KAB` | Kabelvåg | 68.2°N | 2006-01-01 to 2020-12-31 | 131,434 | 55 | 0 | 2MK6 0.44 | 68.2 ± 2.7 | 2005–2023 |
| `kartverket/KSU` | Kristiansund | 63.1°N | 2006-01-01 to 2020-12-31 | 131,375 | 53 | 0 | M8 0.93 | 68.2 ± 2.5 | 2005–2023 |
| `kartverket/MAY` | Måløy | 61.9°N | 2006-01-01 to 2020-12-31 | 131,384 | 53 | 0 | M8 0.76 | 69.1 ± 2.8 | 2005–2023 |
| `kartverket/MSU` | Mausund | 63.9°N | 2010-10-20 to 2020-12-31 | 89,284 | 53 | 0 | 3MK7 0.60 | 69.5 ± 2.8 | 2010–2023 |
| `kartverket/NVK` | Narvik | 68.4°N | 2006-01-01 to 2020-12-31 | 130,414 | 54 | 0 | M2 0.39 | 68.3 ± 2.6 | 2005–2023 |
| `kartverket/NYA` | Ny-Ålesund | 78.9°N | 2006-01-01 to 2020-12-31 | 131,232 | 54 | 0 | MSK6 0.93 | 68.1 ± 2.2 | 2005–2023 |
| `kartverket/OSC` | Oscarsborg | 59.7°N | 2006-01-01 to 2020-12-31 | 131,060 | 44 | 0 | M8 0.45 | 68.2 ± 46.9 | 2005–2023 |
| `kartverket/OSL` | Oslo | 59.9°N | 2006-01-01 to 2020-12-31 | 122,163 | 42 | 0 | SN4 0.51 | 79.5 ± 45.7 | 2006–2023 |
| `kartverket/RVK` | Rørvik | 64.9°N | 2006-01-01 to 2020-12-31 | 130,905 | 53 | 0 | M6 0.95 | 68.4 ± 2.8 | 2005–2023 |
| `kartverket/SVG` | Stavanger | 59.0°N | 2006-01-01 to 2020-12-31 | 131,246 | 49 | 1 | M8 1.04 | 68.7 ± 11.6 | 2005–2023 |
| `kartverket/TOS` | Tromsø | 69.6°N | 2006-01-01 to 2020-12-31 | 131,027 | 55 | 0 | M8 0.87 | 68.0 ± 2.9 | 2005–2023 |
| `kartverket/TRD` | Trondheim | 63.4°N | 2006-01-01 to 2020-12-31 | 131,138 | 53 | 0 | 2MK6 0.72 | 67.7 ± 2.6 | 2005–2023 |
| `kartverket/TRG` | Tregde | 58.0°N | 2006-01-01 to 2020-12-31 | 131,203 | 41 | 0 | 2SM6 0.65 | 66.3 ± 51.8 | 2005–2023 |
| `kartverket/VAW` | Vardø | 70.4°N | 2006-01-01 to 2020-12-31 | 131,386 | 58 | 0 | M6 0.83 | 67.8 ± 3.1 | 2005–2023 |
| `kartverket/VIK` | Viker | 59.0°N | 2006-01-01 to 2020-12-31 | 131,222 | 42 | 0 | M8 0.98 | 67.3 ± 48.3 | 2005–2023 |

Terrestrial time minus UTC over these periods is 67.2 to 67.9 s. The fitted phases ask for a median of 68.1 s, from 66.3 to 79.5 s, the furthest from it at Oslo. Terrestrial time minus UTC is inside the interval at 24 of the 24 gauges.

Kartverket publishes no constant for K1 at Viker.

Of the part of each year that is in the period, the store holds under two thirds of the hours of 2006 at Oslo. The fit reads those years as they are, as one fit of the whole period does.

## The held-out year

Three sets of constants for each gauge, scored on the year the store's own fit holds out: Kartverket's published constants; the fit compared with them above, which is Kartverket's method on the store's values over Kartverket's period, as fitted and without the filter's gain; and the store's own fit, of up to 19 years with Schureman's corrections and its own constituents. Each is predicted under the corrections it was fitted with. The score is the share of the tidal band's variance explained and the tidal-band RMS of what is left, both after the Godin filter ([Scores](../fits.md#scores)).

| Gauge | Held-out year | Kartverket's constants | Kartverket's method | The store's fit | Kartverket's constants RMS (mm) | Kartverket's method RMS (mm) | The store's fit RMS (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `kartverket/AES` Ålesund | 2024 | 98.70% | 98.70% | 98.71% | 53.7 | 53.7 | 53.4 |
| `kartverket/ANX` Andenes | 2024 | 99.52% | 99.52% | 99.53% | 34.5 | 34.5 | 34.2 |
| `kartverket/BGO` Bergen | 2024 | 98.60% | 98.60% | 98.62% | 40.7 | 40.7 | 40.5 |
| `kartverket/BOO` Bodø | 2024 | 99.25% | 99.25% | 99.26% | 56.4 | 56.4 | 56.2 |
| `kartverket/HAR` Harstad | 2024 | 99.58% | 99.58% | 99.59% | 34.0 | 34.0 | 33.7 |
| `kartverket/HEI` Heimsjøen | 2024 | 99.40% | 99.40% | 99.41% | 45.4 | 45.4 | 45.0 |
| `kartverket/HFT` Hammerfest | 2024 | 99.65% | 99.65% | 99.66% | 38.7 | 38.7 | 38.4 |
| `kartverket/HRO` Helgeroa | 2024 | 65.24% | 65.23% | 65.54% | 68.5 | 68.5 | 68.2 |
| `kartverket/HVG` Honningsvåg | 2024 | 99.68% | 99.68% | 99.69% | 35.9 | 35.9 | 35.3 |
| `kartverket/KAB` Kabelvåg | 2024 | 99.24% | 99.24% | 99.25% | 61.1 | 61.1 | 60.7 |
| `kartverket/KSU` Kristiansund | 2024 | 99.20% | 99.20% | 99.22% | 45.7 | 45.7 | 45.3 |
| `kartverket/MAY` Måløy | 2024 | 98.89% | 98.89% | 98.90% | 46.3 | 46.3 | 46.0 |
| `kartverket/MSU` Mausund | 2024 | 99.40% | 99.40% | 99.42% | 42.8 | 42.8 | 42.2 |
| `kartverket/NVK` Narvik | 2024 | 99.27% | 99.27% | 99.28% | 64.4 | 64.4 | 63.9 |
| `kartverket/NYA` Ny-Ålesund | 2024 | 99.51% | 99.51% | 99.52% | 24.3 | 24.3 | 24.0 |
| `kartverket/OSC` Oscarsborg | 2024 | 68.48% | 68.48% | 68.81% | 76.1 | 76.1 | 75.7 |
| `kartverket/OSL` Oslo | 2024 | 68.71% | 68.62% | 69.01% | 80.6 | 80.7 | 80.2 |
| `kartverket/RVK` Rørvik | 2024 | 99.31% | 99.31% | 99.32% | 49.2 | 49.2 | 48.9 |
| `kartverket/SVG` Stavanger | 2024 | 87.92% | 87.98% | 88.01% | 47.0 | 46.9 | 46.8 |
| `kartverket/TOS` Tromsø | 2024 | 99.64% | 99.64% | 99.66% | 37.3 | 37.2 | 36.6 |
| `kartverket/TRD` Trondheim | 2024 | 99.47% | 99.47% | 99.49% | 50.4 | 50.4 | 49.6 |
| `kartverket/TRG` Tregde | 2024 | 61.48% | 61.49% | 61.79% | 58.3 | 58.3 | 58.1 |
| `kartverket/VAW` Vardø | 2024 | 99.69% | 99.69% | 99.70% | 41.8 | 41.8 | 41.1 |
| `kartverket/VIK` Viker | 2024 | 65.66% | 65.67% | 65.96% | 70.3 | 70.3 | 70.0 |

Against Kartverket's constants, the RMS of Kartverket's method on the store's values is lower at 1 and higher at 1 of 24 gauges, from −0.1 to +0.1 mm, and the RMS of the store's own fit is lower at 24 and higher at 0 of 24 gauges, from −0.8 to −0.2 mm. A change under 0.1 mm counts as neither.

## Outside the interval

Every short-period constant outside the fit's interval, with the differences the fit's minus Kartverket's.

| Gauge | Constituent | Kartverket A (mm) | ΔA (mm) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `kartverket/HFT` | OQ2 | 3.30 | −0.51 | −2.13 | 0.52 | 0.35 | 7.30 | **1.4** |
| `kartverket/HFT` | GAM2 | 2.80 | +0.04 | −10.33 | 0.51 | 0.37 | 7.51 | **1.4** |
| `kartverket/HFT` | L2 | 24.30 | −0.01 | −1.20 | 0.51 | 0.38 | 0.89 | **1.3** |
| `kartverket/HFT` | 2N2 | 25.40 | −0.06 | −1.04 | 0.46 | 0.36 | 0.83 | **1.3** |
| `kartverket/HFT` | H1 | 11.10 | −0.44 | −0.77 | 0.47 | 0.38 | 2.03 | **1.2** |
| `kartverket/HFT` | MU2 | 23.50 | −0.43 | −0.39 | 0.46 | 0.38 | 0.94 | **1.1** |
| `kartverket/HFT` | NU2 | 37.30 | −0.21 | −0.65 | 0.47 | 0.38 | 0.59 | **1.1** |
| `kartverket/HFT` | MKS2 | 4.90 | −0.21 | −5.02 | 0.47 | 0.38 | 4.70 | **1.1** |
| `kartverket/SVG` | M8 | 2.60 | −0.07 | +0.02 | 0.07 | 0.05 | 1.07 | **1.0** |
| `kartverket/HFT` | S2 | 275.20 | −0.24 | −0.08 | 0.46 | 0.38 | 0.08 | **1.0** |
| `kartverket/HFT` | T2 | 13.70 | −0.10 | −1.63 | 0.40 | 0.38 | 1.61 | **1.0** |

Hammerfest has 10 outside and a mean vector difference of 0.250 mm, so it was fitted again with each year of the period left out in turn, and with each two years running. One year out leaves 5 to 14 outside and a mean vector difference of 0.240 to 0.294 mm; two leave 6 to 18 outside and a mean vector difference of 0.259 to 0.340 mm. No year or pair of years accounts for the difference. The largest of its constants outside is S2, of 275.2 mm, which the fit of Hammerfest's own record is 0.46 mm from. Kartverket's protocol says some constants come from a nearby station without saying which, and whether any of these do is a question for Kartverket ([questions](../../src/sources/kartverket/errata.ts)). This report doesn't find why Hammerfest's constants differ.

## Constituents across gauges

For each of Kartverket's constituents, over the gauges where the fit has it: the filter's gain at its speed, the median differences from Kartverket's without sign, how many are outside, for the short-period ones, and the median vector difference without the gain.

| Constituent | Gauges | Gain | Amplitude (mm) | Amplitude (%) | Phase (°) | Vector (mm) | Outside | Without the gain: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 24 | 1.0000 | 5.734 | 4.61 | 3.34 | 10.634 |  | 10.634 |
| SSA | 12 | 1.0000 | 0.038 | 0.18 | 0.08 | 0.057 |  | 0.057 |
| MM | 24 | 1.0000 | 0.034 | 0.12 | 0.10 | 0.055 |  | 0.055 |
| MF | 24 | 1.0000 | 0.042 | 0.26 | 0.10 | 0.057 |  | 0.057 |
| ALP1 | 9 | 1.0000 | 0.014 | 1.60 | 0.52 | 0.023 | 0 | 0.023 |
| 2Q1 | 18 | 1.0000 | 0.032 | 0.99 | 0.19 | 0.043 | 0 | 0.043 |
| SIG1 | 23 | 1.0000 | 0.031 | 0.70 | 0.36 | 0.044 | 0 | 0.044 |
| Q1 | 24 | 1.0000 | 0.029 | 0.18 | 0.06 | 0.038 | 0 | 0.038 |
| RHO1 | 21 | 1.0000 | 0.023 | 0.78 | 0.36 | 0.034 | 0 | 0.034 |
| O1 | 24 | 1.0000 | 0.038 | 0.10 | 0.02 | 0.040 | 0 | 0.040 |
| TAU1 | 7 | 1.0000 | 0.020 | 2.26 | 0.43 | 0.028 | 0 | 0.028 |
| BET1 | 1 | 1.0000 | 0.352 | 29.37 | 7.56 | 0.377 | 0 | 0.377 |
| NO1 | 19 | 1.0000 | 0.039 | 1.24 | 0.43 | 0.047 | 0 | 0.047 |
| PI1 | 20 | 1.0000 | 0.025 | 1.84 | 0.60 | 0.029 | 0 | 0.029 |
| P1 | 24 | 1.0000 | 0.039 | 0.25 | 0.05 | 0.048 | 0 | 0.048 |
| S1 | 24 | 1.0000 | 0.036 | 0.48 | 0.26 | 0.057 | 0 | 0.057 |
| K1 | 23 | 1.0000 | 0.032 | 0.07 | 0.02 | 0.045 | 0 | 0.045 |
| PSI1 | 8 | 1.0000 | 0.025 | 1.49 | 0.61 | 0.034 | 0 | 0.034 |
| PHI1 | 14 | 1.0000 | 0.036 | 2.02 | 0.68 | 0.044 | 0 | 0.044 |
| THE1 | 6 | 1.0000 | 0.036 | 3.84 | 1.09 | 0.041 | 0 | 0.041 |
| J1 | 18 | 1.0000 | 0.022 | 0.57 | 0.18 | 0.040 | 0 | 0.040 |
| SO1 | 7 | 1.0000 | 0.036 | 2.00 | 0.71 | 0.041 | 0 | 0.041 |
| OO1 | 21 | 1.0000 | 0.021 | 1.10 | 0.45 | 0.029 | 0 | 0.029 |
| OQ2 | 19 | 1.0000 | 0.036 | 1.37 | 0.29 | 0.039 | 1 | 0.039 |
| EPS2 | 24 | 1.0000 | 0.042 | 0.76 | 0.12 | 0.044 | 0 | 0.044 |
| 2N2 | 24 | 1.0000 | 0.028 | 0.13 | 0.04 | 0.030 | 1 | 0.030 |
| MU2 | 24 | 1.0000 | 0.033 | 0.14 | 0.03 | 0.038 | 1 | 0.038 |
| N2 | 24 | 1.0000 | 0.031 | 0.02 | 0.01 | 0.050 | 0 | 0.049 |
| NU2 | 24 | 1.0000 | 0.023 | 0.09 | 0.05 | 0.032 | 1 | 0.032 |
| GAM2 | 19 | 1.0000 | 0.037 | 1.68 | 0.35 | 0.050 | 1 | 0.050 |
| H1 | 24 | 1.0000 | 0.030 | 0.54 | 0.15 | 0.034 | 1 | 0.034 |
| M2 | 24 | 1.0000 | 0.026 | 0.01 | 0.01 | 0.101 | 0 | 0.100 |
| H2 | 22 | 1.0000 | 0.033 | 1.03 | 0.25 | 0.045 | 0 | 0.045 |
| MKS2 | 20 | 1.0000 | 0.025 | 1.73 | 0.71 | 0.036 | 1 | 0.036 |
| LDA2 | 24 | 1.0000 | 0.027 | 0.44 | 0.13 | 0.037 | 0 | 0.037 |
| L2 | 24 | 1.0000 | 0.028 | 0.13 | 0.05 | 0.034 | 1 | 0.034 |
| T2 | 24 | 1.0000 | 0.029 | 0.31 | 0.12 | 0.038 | 1 | 0.038 |
| S2 | 24 | 1.0000 | 0.029 | 0.01 | 0.01 | 0.046 | 1 | 0.047 |
| R2 | 23 | 1.0000 | 0.030 | 1.90 | 0.48 | 0.034 | 0 | 0.034 |
| K2 | 24 | 1.0000 | 0.025 | 0.04 | 0.02 | 0.030 | 0 | 0.030 |
| MSN2 | 24 | 1.0000 | 0.025 | 1.85 | 0.79 | 0.032 | 0 | 0.032 |
| ETA2 | 19 | 1.0000 | 0.018 | 0.64 | 0.24 | 0.026 | 0 | 0.026 |
| MO3 | 24 | 0.9997 | 0.025 | 0.57 | 0.28 | 0.036 | 0 | 0.036 |
| M3 | 24 | 0.9997 | 0.026 | 1.71 | 0.47 | 0.039 | 0 | 0.039 |
| SO3 | 24 | 0.9997 | 0.030 | 2.37 | 0.43 | 0.039 | 0 | 0.039 |
| MK3 | 24 | 0.9997 | 0.024 | 1.73 | 0.54 | 0.034 | 0 | 0.034 |
| SK3 | 19 | 0.9996 | 0.018 | 0.79 | 0.31 | 0.027 | 0 | 0.026 |
| MN4 | 24 | 0.9974 | 0.015 | 0.32 | 0.17 | 0.031 | 0 | 0.045 |
| M4 | 23 | 0.9972 | 0.029 | 0.24 | 0.05 | 0.035 | 0 | 0.042 |
| SN4 | 23 | 0.9970 | 0.025 | 2.27 | 0.21 | 0.025 | 0 | 0.033 |
| MS4 | 23 | 0.9968 | 0.023 | 0.26 | 0.09 | 0.027 | 0 | 0.041 |
| MK4 | 23 | 0.9967 | 0.024 | 0.86 | 0.34 | 0.029 | 0 | 0.035 |
| S4 | 22 | 0.9963 | 0.029 | 3.40 | 1.01 | 0.033 | 0 | 0.038 |
| SK4 | 11 | 0.9963 | 0.018 | 2.51 | 2.04 | 0.022 | 0 | 0.020 |
| 2MK5 | 24 | 0.9825 | 0.025 | 1.53 | 0.51 | 0.029 | 0 | 0.032 |
| 2SK5 | 21 | 0.9783 | 0.025 | 9.76 | 2.21 | 0.031 | 0 | 0.033 |
| 2MN6 | 24 | 0.9359 | 0.031 | 1.02 | 0.16 | 0.034 | 0 | 0.199 |
| M6 | 24 | 0.9328 | 0.017 | 0.46 | 0.11 | 0.028 | 0 | 0.365 |
| 2MS6 | 24 | 0.9267 | 0.024 | 0.36 | 0.10 | 0.029 | 0 | 0.414 |
| 2MK6 | 24 | 0.9262 | 0.031 | 2.87 | 0.62 | 0.034 | 0 | 0.126 |
| 2SM6 | 24 | 0.9203 | 0.026 | 2.11 | 0.49 | 0.032 | 0 | 0.144 |
| MSK6 | 24 | 0.9197 | 0.019 | 1.81 | 0.85 | 0.029 | 0 | 0.083 |
| 3MK7 | 19 | 0.7948 | 0.022 | 12.11 | 0.99 | 0.024 | 0 | 0.064 |
| M8 | 24 | 0.5815 | 0.025 | 6.21 | 0.92 | 0.026 | 1 | 0.301 |

Kartverket doesn't say which years its long-period constants are from. SA fitted over the gauge's period is a median 11.1 mm from Kartverket's, and fitted over 1991 to 2020, at the 19 gauges the store holds at least two thirds of each of those years for, 0.9 mm. The long-period constituents are in each gauge's table and in no count.

## Each gauge

Kartverket's constants, with phases moved to UTC, then the fit's difference from them, the fit's minus Kartverket's, with the fit's amplitude scaled by the gain. ±A and ±g are the half-widths of the fit's 95% intervals. A ratio in bold is outside the interval.

### Ålesund (`kartverket/AES`)

2006-01-01 to 2020-12-31: 131,250 hourly values. SA over 1991 to 2020 is 140.3 mm at 323.4°, 0.8 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 139.90 | 323.71 | 1.0000 | +6.90 | +4.93 | −4.77 | 13.78 | 11.53 | 4.51 | **1.1** | 13.78 | 13.92 |
| MM | 26.90 | 177.74 | 1.0000 | −0.03 | −0.10 | −0.18 | 0.09 | 11.54 | 24.60 | 0.0 | 0.09 | 0.71 |
| MF | 19.50 | 189.51 | 1.0000 | +0.01 | +0.05 | −0.23 | 0.08 | 11.54 | 33.89 | 0.0 | 0.08 | 0.76 |
| 2Q1 | 4.20 | 273.15 | 1.0000 | +0.01 | +0.15 | −0.41 | 0.03 | 0.89 | 12.12 | 0.0 | 0.03 | 0.21 |
| SIG1 | 4.00 | 243.75 | 1.0000 | +0.02 | +0.58 | +0.69 | 0.05 | 0.91 | 12.90 | 0.1 | 0.05 | 0.14 |
| Q1 | 21.40 | 313.40 | 1.0000 | −0.07 | −0.31 | +0.01 | 0.07 | 0.90 | 2.42 | 0.1 | 0.07 | 0.04 |
| RHO1 | 4.30 | 329.71 | 1.0000 | −0.01 | −0.25 | +0.20 | 0.02 | 0.91 | 12.18 | 0.0 | 0.02 | 0.07 |
| O1 | 60.50 | 8.92 | 1.0000 | −0.05 | −0.07 | −0.01 | 0.05 | 0.91 | 0.86 | 0.0 | 0.05 | 0.03 |
| NO1 | 3.20 | 96.19 | 1.0000 | +0.07 | +2.22 | −0.65 | 0.08 | 0.81 | 14.23 | 0.1 | 0.08 | 0.05 |
| PI1 | 1.30 | 106.80 | 1.0000 | −0.05 | −3.97 | +0.57 | 0.05 | 0.89 | 41.03 | 0.1 | 0.05 | 0.07 |
| P1 | 15.20 | 138.58 | 1.0000 | +0.10 | +0.62 | +0.24 | 0.11 | 0.89 | 3.35 | 0.1 | 0.11 | 0.03 |
| S1 | 8.20 | 266.36 | 1.0000 | −0.03 | −0.41 | −0.32 | 0.06 | 1.27 | 8.91 | 0.0 | 0.06 | 0.07 |
| K1 | 57.60 | 153.81 | 1.0000 | +0.04 | +0.08 | −0.03 | 0.06 | 0.90 | 0.90 | 0.0 | 0.06 | 0.11 |
| PHI1 | 2.20 | 158.80 | 1.0000 | +0.01 | +0.36 | +0.12 | 0.01 | 0.90 | 23.24 | 0.0 | 0.01 | 0.08 |
| J1 | 3.10 | 189.67 | 1.0000 | −0.02 | −0.70 | −0.68 | 0.04 | 0.88 | 16.38 | 0.0 | 0.04 | 0.06 |
| OO1 | 1.90 | 283.02 | 1.0000 | +0.02 | +1.10 | −0.60 | 0.03 | 0.80 | 24.00 | 0.0 | 0.03 | 0.13 |
| OQ2 | 1.70 | 218.48 | 1.0000 | −0.04 | −2.54 | −1.68 | 0.07 | 0.24 | 8.42 | 0.2 | 0.07 | 0.02 |
| EPS2 | 3.40 | 218.27 | 1.0000 | +0.05 | +1.48 | −0.53 | 0.06 | 0.25 | 4.21 | 0.2 | 0.06 | 0.06 |
| 2N2 | 16.20 | 245.16 | 1.0000 | +0.07 | +0.41 | −0.04 | 0.07 | 0.25 | 0.88 | 0.3 | 0.07 | 0.06 |
| MU2 | 15.80 | 243.17 | 1.0000 | −0.01 | −0.08 | −0.02 | 0.01 | 0.26 | 0.93 | 0.0 | 0.01 | 0.03 |
| N2 | 125.40 | 266.98 | 1.0000 | −0.01 | −0.01 | −0.00 | 0.01 | 0.26 | 0.12 | 0.0 | 0.01 | 0.03 |
| NU2 | 24.60 | 270.77 | 1.0000 | +0.05 | +0.19 | +0.06 | 0.05 | 0.26 | 0.60 | 0.2 | 0.05 | 0.03 |
| GAM2 | 1.90 | 291.43 | 1.0000 | +0.03 | +1.62 | −0.57 | 0.04 | 0.25 | 7.52 | 0.1 | 0.04 | 0.06 |
| H1 | 3.20 | 285.37 | 1.0000 | −0.05 | −1.51 | −0.59 | 0.06 | 0.26 | 4.68 | 0.2 | 0.06 | 0.03 |
| M2 | 620.60 | 289.95 | 1.0000 | −0.01 | −0.00 | −0.01 | 0.14 | 0.26 | 0.02 | 0.5 | 0.14 | 0.13 |
| H2 | 2.00 | 116.78 | 1.0000 | +0.05 | +2.33 | −0.89 | 0.06 | 0.26 | 7.26 | 0.2 | 0.06 | 0.07 |
| MKS2 | 1.10 | 259.70 | 1.0000 | −0.03 | −3.06 | +0.82 | 0.04 | 0.26 | 14.10 | 0.1 | 0.04 | 0.02 |
| LDA2 | 5.40 | 309.21 | 1.0000 | −0.00 | −0.02 | +0.20 | 0.02 | 0.26 | 2.74 | 0.1 | 0.02 | 0.03 |
| L2 | 17.60 | 312.73 | 1.0000 | −0.05 | −0.30 | −0.03 | 0.05 | 0.26 | 0.84 | 0.2 | 0.05 | 0.01 |
| T2 | 11.10 | 322.90 | 1.0000 | +0.04 | +0.33 | −0.02 | 0.04 | 0.26 | 1.34 | 0.1 | 0.04 | 0.01 |
| S2 | 211.60 | 326.80 | 1.0000 | +0.06 | +0.03 | −0.02 | 0.09 | 0.26 | 0.07 | 0.3 | 0.09 | 0.06 |
| R2 | 1.70 | 2.30 | 1.0000 | +0.01 | +0.77 | +1.27 | 0.04 | 0.21 | 7.05 | 0.2 | 0.04 | 0.03 |
| K2 | 59.80 | 324.49 | 1.0000 | +0.01 | +0.01 | −0.02 | 0.03 | 0.26 | 0.25 | 0.1 | 0.03 | 0.03 |
| MSN2 | 1.00 | 207.81 | 1.0000 | +0.01 | +0.56 | +0.92 | 0.02 | 0.26 | 14.63 | 0.1 | 0.02 | 0.05 |
| ETA2 | 2.70 | 337.90 | 1.0000 | −0.03 | −1.02 | +0.15 | 0.03 | 0.24 | 5.12 | 0.1 | 0.03 | 0.04 |
| MO3 | 3.00 | 212.27 | 0.9997 | +0.01 | +0.31 | +0.13 | 0.01 | 0.15 | 2.80 | 0.1 | 0.01 | 0.01 |
| M3 | 2.00 | 159.16 | 0.9997 | −0.05 | −2.46 | +0.91 | 0.06 | 0.14 | 4.22 | 0.3 | 0.06 | 0.04 |
| SO3 | 1.30 | 310.00 | 0.9997 | −0.02 | −1.49 | −0.92 | 0.03 | 0.15 | 6.59 | 0.1 | 0.03 | 0.01 |
| MK3 | 1.50 | 333.44 | 0.9997 | +0.04 | +2.95 | +0.03 | 0.04 | 0.15 | 5.43 | 0.3 | 0.05 | 0.03 |
| SK3 | 1.80 | 79.25 | 0.9996 | −0.03 | −1.37 | −0.02 | 0.03 | 0.15 | 4.73 | 0.2 | 0.02 | 0.04 |
| MN4 | 3.20 | 94.29 | 0.9974 | −0.01 | −0.35 | −0.44 | 0.03 | 0.12 | 2.12 | 0.2 | 0.03 | 0.02 |
| M4 | 6.20 | 137.89 | 0.9972 | +0.02 | +0.37 | +0.11 | 0.03 | 0.12 | 1.08 | 0.2 | 0.04 | 0.02 |
| SN4 | 0.90 | 186.16 | 0.9970 | +0.03 | +3.48 | −0.48 | 0.03 | 0.12 | 7.31 | 0.2 | 0.03 | 0.02 |
| MS4 | 2.10 | 226.53 | 0.9968 | −0.01 | −0.47 | +0.08 | 0.01 | 0.12 | 3.26 | 0.1 | 0.00 | 0.02 |
| MK4 | 0.50 | 228.32 | 0.9967 | +0.04 | +7.50 | −0.62 | 0.04 | 0.12 | 12.84 | 0.3 | 0.04 | 0.05 |
| S4 | 0.50 | 107.74 | 0.9963 | +0.04 | +8.11 | +3.26 | 0.05 | 0.12 | 12.68 | 0.3 | 0.05 | 0.00 |
| 2MK5 | 1.80 | 153.86 | 0.9825 | +0.03 | +1.40 | +0.36 | 0.03 | 0.08 | 2.44 | 0.3 | 0.06 | 0.02 |
| 2SK5 | 0.10 | 110.89 | 0.9783 | +0.03 | +34.63 | −4.64 | 0.04 | 0.08 | 33.22 | 0.4 | 0.04 | 0.03 |
| 2MN6 | 3.80 | 296.57 | 0.9359 | −0.02 | −0.43 | +0.17 | 0.02 | 0.10 | 1.47 | 0.2 | 0.24 | 0.01 |
| M6 | 7.80 | 328.73 | 0.9328 | +0.02 | +0.22 | −0.04 | 0.02 | 0.10 | 0.71 | 0.2 | 0.58 | 0.05 |
| 2MS6 | 9.60 | 28.61 | 0.9267 | −0.00 | −0.01 | −0.06 | 0.01 | 0.10 | 0.58 | 0.1 | 0.76 | 0.02 |
| 2MK6 | 2.80 | 28.43 | 0.9262 | −0.01 | −0.18 | −0.03 | 0.01 | 0.10 | 2.04 | 0.0 | 0.22 | 0.02 |
| 2SM6 | 2.70 | 89.09 | 0.9203 | −0.01 | −0.29 | −0.16 | 0.01 | 0.10 | 2.07 | 0.1 | 0.23 | 0.01 |
| MSK6 | 1.70 | 91.52 | 0.9197 | −0.02 | −1.30 | +0.02 | 0.02 | 0.10 | 3.37 | 0.2 | 0.12 | 0.02 |
| 3MK7 | 0.30 | 85.14 | 0.7948 | +0.04 | +12.49 | +1.24 | 0.04 | 0.07 | 11.98 | 0.4 | 0.13 | 0.04 |
| M8 | 0.40 | 293.25 | 0.5815 | −0.03 | −7.32 | +1.78 | 0.03 | 0.04 | 6.84 | 0.4 | 0.24 | 0.05 |

### Andenes (`kartverket/ANX`)

2006-01-01 to 2020-12-31: 131,459 hourly values.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 138.30 | 331.09 | 1.0000 | +3.85 | +2.79 | −1.78 | 5.82 | 11.26 | 4.54 | 0.4 | 5.82 | 5.72 |
| MM | 26.80 | 181.77 | 1.0000 | −0.01 | −0.04 | −0.08 | 0.04 | 11.25 | 24.08 | 0.0 | 0.04 | 0.26 |
| MF | 17.50 | 191.83 | 1.0000 | +0.02 | +0.13 | −0.04 | 0.03 | 11.25 | 36.80 | 0.0 | 0.03 | 0.23 |
| ALP1 | 0.90 | 306.93 | 1.0000 | −0.01 | −1.60 | +0.52 | 0.02 | 0.49 | 31.58 | 0.0 | 0.02 | 0.01 |
| 2Q1 | 4.10 | 295.76 | 1.0000 | −0.05 | −1.23 | −0.16 | 0.05 | 0.48 | 6.83 | 0.1 | 0.05 | 0.01 |
| SIG1 | 3.60 | 305.66 | 1.0000 | −0.04 | −1.06 | +0.32 | 0.04 | 0.49 | 7.91 | 0.1 | 0.04 | 0.07 |
| Q1 | 17.60 | 348.41 | 1.0000 | +0.03 | +0.18 | +0.07 | 0.04 | 0.49 | 1.59 | 0.1 | 0.04 | 0.03 |
| RHO1 | 3.20 | 2.07 | 1.0000 | +0.01 | +0.31 | −0.36 | 0.02 | 0.50 | 8.85 | 0.0 | 0.02 | 0.05 |
| O1 | 42.30 | 45.24 | 1.0000 | +0.02 | +0.04 | +0.00 | 0.02 | 0.49 | 0.67 | 0.0 | 0.02 | 0.04 |
| TAU1 | 0.70 | 203.77 | 1.0000 | +0.03 | +4.40 | −0.07 | 0.03 | 0.46 | 35.94 | 0.1 | 0.03 | 0.06 |
| NO1 | 2.60 | 154.01 | 1.0000 | −0.05 | −2.08 | −0.51 | 0.06 | 0.44 | 9.88 | 0.1 | 0.06 | 0.07 |
| PI1 | 1.20 | 160.48 | 1.0000 | −0.00 | −0.10 | +0.35 | 0.01 | 0.49 | 23.21 | 0.0 | 0.01 | 0.04 |
| P1 | 17.50 | 181.12 | 1.0000 | +0.05 | +0.28 | +0.05 | 0.05 | 0.49 | 1.58 | 0.1 | 0.05 | 0.04 |
| S1 | 6.40 | 307.78 | 1.0000 | −0.06 | −1.00 | +0.10 | 0.06 | 0.69 | 6.24 | 0.1 | 0.06 | 0.05 |
| K1 | 64.90 | 191.82 | 1.0000 | −0.04 | −0.07 | +0.03 | 0.05 | 0.49 | 0.43 | 0.1 | 0.05 | 0.06 |
| PSI1 | 1.80 | 341.97 | 1.0000 | +0.00 | +0.24 | +1.33 | 0.04 | 0.49 | 15.49 | 0.1 | 0.04 | 0.01 |
| PHI1 | 1.10 | 160.75 | 1.0000 | +0.01 | +1.21 | −0.65 | 0.02 | 0.49 | 25.04 | 0.0 | 0.02 | 0.03 |
| THE1 | 0.60 | 263.49 | 1.0000 | +0.02 | +3.25 | −1.90 | 0.03 | 0.49 | 45.37 | 0.0 | 0.03 | 0.02 |
| J1 | 3.80 | 232.17 | 1.0000 | +0.02 | +0.57 | −0.10 | 0.02 | 0.48 | 7.15 | 0.0 | 0.02 | 0.04 |
| OO1 | 2.00 | 306.78 | 1.0000 | −0.01 | −0.58 | +0.35 | 0.02 | 0.44 | 12.60 | 0.0 | 0.02 | 0.03 |
| OQ2 | 2.00 | 265.91 | 1.0000 | +0.01 | +0.32 | −0.71 | 0.03 | 0.23 | 6.52 | 0.1 | 0.03 | 0.02 |
| EPS2 | 4.20 | 263.91 | 1.0000 | +0.01 | +0.19 | +0.06 | 0.01 | 0.24 | 3.25 | 0.0 | 0.01 | 0.02 |
| 2N2 | 18.20 | 294.34 | 1.0000 | −0.03 | −0.18 | −0.02 | 0.03 | 0.23 | 0.74 | 0.1 | 0.03 | 0.03 |
| MU2 | 18.80 | 288.77 | 1.0000 | +0.05 | +0.24 | −0.03 | 0.05 | 0.24 | 0.74 | 0.2 | 0.05 | 0.03 |
| N2 | 137.20 | 317.51 | 1.0000 | −0.03 | −0.02 | +0.01 | 0.03 | 0.24 | 0.10 | 0.1 | 0.03 | 0.03 |
| NU2 | 26.70 | 321.86 | 1.0000 | −0.00 | −0.01 | −0.04 | 0.02 | 0.24 | 0.52 | 0.1 | 0.02 | 0.01 |
| GAM2 | 1.90 | 337.37 | 1.0000 | −0.01 | −0.70 | +0.12 | 0.01 | 0.24 | 7.24 | 0.1 | 0.01 | 0.01 |
| H1 | 2.00 | 356.03 | 1.0000 | +0.03 | +1.63 | +0.06 | 0.03 | 0.24 | 6.84 | 0.1 | 0.03 | 0.03 |
| M2 | 665.20 | 341.51 | 1.0000 | +0.04 | +0.01 | −0.01 | 0.11 | 0.24 | 0.02 | 0.4 | 0.12 | 0.11 |
| H2 | 1.30 | 102.22 | 1.0000 | −0.03 | −2.56 | −0.13 | 0.03 | 0.24 | 11.05 | 0.1 | 0.03 | 0.04 |
| MKS2 | 0.90 | 333.58 | 1.0000 | +0.01 | +1.30 | +0.66 | 0.02 | 0.25 | 15.53 | 0.0 | 0.02 | 0.01 |
| LDA2 | 5.00 | 2.27 | 1.0000 | −0.01 | −0.11 | +0.01 | 0.01 | 0.24 | 2.79 | 0.0 | 0.01 | 0.01 |
| L2 | 17.90 | 5.12 | 1.0000 | +0.01 | +0.03 | −0.01 | 0.01 | 0.24 | 0.77 | 0.0 | 0.01 | 0.02 |
| T2 | 12.30 | 16.15 | 1.0000 | +0.06 | +0.53 | −0.09 | 0.07 | 0.24 | 1.14 | 0.3 | 0.07 | 0.04 |
| S2 | 225.10 | 20.82 | 1.0000 | +0.02 | +0.01 | −0.01 | 0.04 | 0.24 | 0.06 | 0.1 | 0.04 | 0.04 |
| R2 | 1.50 | 35.10 | 1.0000 | −0.03 | −1.98 | −0.61 | 0.03 | 0.20 | 7.74 | 0.1 | 0.03 | 0.01 |
| K2 | 63.80 | 18.76 | 1.0000 | −0.02 | −0.03 | −0.02 | 0.03 | 0.25 | 0.22 | 0.1 | 0.03 | 0.01 |
| MSN2 | 0.80 | 262.68 | 1.0000 | +0.02 | +2.46 | +0.65 | 0.02 | 0.24 | 16.90 | 0.1 | 0.02 | 0.02 |
| ETA2 | 2.80 | 36.13 | 1.0000 | −0.02 | −0.65 | −0.36 | 0.03 | 0.22 | 4.62 | 0.1 | 0.03 | 0.02 |
| MO3 | 1.90 | 307.10 | 0.9997 | −0.00 | −0.15 | +0.28 | 0.01 | 0.08 | 2.43 | 0.1 | 0.01 | 0.01 |
| M3 | 0.70 | 332.70 | 0.9997 | +0.04 | +5.67 | −0.12 | 0.04 | 0.08 | 6.08 | 0.4 | 0.04 | 0.04 |
| SO3 | 0.90 | 27.02 | 0.9997 | +0.04 | +4.89 | −0.42 | 0.05 | 0.08 | 4.88 | 0.5 | 0.05 | 0.03 |
| MK3 | 1.30 | 49.02 | 0.9997 | +0.02 | +1.73 | −0.25 | 0.02 | 0.08 | 3.46 | 0.2 | 0.02 | 0.01 |
| SK3 | 1.60 | 142.05 | 0.9996 | +0.02 | +1.15 | −0.94 | 0.03 | 0.08 | 2.83 | 0.3 | 0.03 | 0.00 |
| MN4 | 1.60 | 203.84 | 0.9974 | +0.01 | +0.42 | +0.09 | 0.01 | 0.06 | 2.12 | 0.1 | 0.01 | 0.01 |
| M4 | 3.50 | 229.07 | 0.9972 | −0.04 | −1.14 | −0.05 | 0.04 | 0.06 | 0.98 | 0.5 | 0.03 | 0.05 |
| SN4 | 0.20 | 265.19 | 0.9970 | +0.01 | +4.97 | +0.38 | 0.01 | 0.06 | 16.35 | 0.1 | 0.01 | 0.01 |
| MS4 | 1.60 | 271.91 | 0.9968 | +0.01 | +0.28 | −0.15 | 0.01 | 0.06 | 2.14 | 0.1 | 0.01 | 0.01 |
| MK4 | 0.50 | 264.81 | 0.9967 | +0.01 | +1.46 | −0.63 | 0.01 | 0.06 | 6.86 | 0.1 | 0.01 | 0.02 |
| SK4 | 0.20 | 212.33 | 0.9963 | +0.01 | +2.46 | +4.79 | 0.02 | 0.06 | 16.92 | 0.3 | 0.02 | 0.02 |
| 2MK5 | 0.50 | 323.55 | 0.9825 | +0.04 | +7.60 | +0.81 | 0.04 | 0.04 | 4.68 | 0.6 | 0.05 | 0.05 |
| 2SK5 | 0.10 | 57.22 | 0.9783 | −0.00 | −1.30 | −18.64 | 0.03 | 0.04 | 25.60 | 0.7 | 0.03 | 0.00 |
| 2MN6 | 0.10 | 282.91 | 0.9359 | +0.03 | +26.26 | +5.98 | 0.03 | 0.05 | 21.79 | 0.4 | 0.04 | 0.03 |
| M6 | 0.40 | 324.00 | 0.9328 | −0.00 | −0.54 | +0.69 | 0.01 | 0.05 | 6.89 | 0.1 | 0.03 | 0.01 |
| 2MS6 | 1.00 | 20.57 | 0.9267 | +0.00 | +0.21 | +0.43 | 0.01 | 0.05 | 2.74 | 0.2 | 0.08 | 0.01 |
| 2MK6 | 0.30 | 18.17 | 0.9262 | −0.01 | −2.78 | +5.35 | 0.03 | 0.05 | 9.65 | 0.6 | 0.03 | 0.00 |
| 2SM6 | 0.50 | 88.96 | 0.9203 | −0.01 | −1.89 | +1.83 | 0.02 | 0.05 | 5.61 | 0.3 | 0.04 | 0.02 |
| MSK6 | 0.30 | 95.17 | 0.9197 | −0.04 | −12.52 | −2.14 | 0.04 | 0.05 | 10.63 | 0.5 | 0.02 | 0.04 |
| M8 | 0.50 | 128.64 | 0.5815 | −0.05 | −9.44 | +0.66 | 0.05 | 0.01 | 1.70 | 0.9 | 0.28 | 0.04 |

### Bergen (`kartverket/BGO`)

2006-01-01 to 2020-12-31: 131,284 hourly values. SA over 1991 to 2020 is 107.8 mm at 311.0°, 1.0 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 107.20 | 311.40 | 1.0000 | +6.59 | +6.14 | −4.65 | 11.13 | 9.42 | 4.74 | 1.0 | 11.13 | 11.04 |
| MM | 26.30 | 178.90 | 1.0000 | +0.07 | +0.28 | −0.64 | 0.30 | 9.42 | 20.47 | 0.0 | 0.30 | 0.13 |
| MF | 18.70 | 186.52 | 1.0000 | −0.12 | −0.66 | −1.00 | 0.35 | 9.42 | 29.05 | 0.0 | 0.35 | 0.37 |
| 2Q1 | 2.30 | 281.42 | 1.0000 | +0.03 | +1.07 | +0.96 | 0.05 | 0.73 | 18.04 | 0.1 | 0.05 | 0.05 |
| Q1 | 9.40 | 317.14 | 1.0000 | +0.08 | +0.83 | −0.17 | 0.08 | 0.74 | 4.47 | 0.1 | 0.08 | 0.07 |
| RHO1 | 2.40 | 322.53 | 1.0000 | −0.05 | −1.89 | −1.03 | 0.06 | 0.75 | 18.24 | 0.1 | 0.06 | 0.03 |
| O1 | 30.90 | 11.32 | 1.0000 | −0.12 | −0.39 | −0.13 | 0.14 | 0.75 | 1.39 | 0.2 | 0.14 | 0.07 |
| NO1 | 1.50 | 97.82 | 1.0000 | −0.00 | −0.17 | −3.53 | 0.09 | 0.67 | 25.58 | 0.1 | 0.09 | 0.09 |
| PI1 | 0.80 | 110.13 | 1.0000 | −0.02 | −2.09 | +2.42 | 0.04 | 0.73 | 53.74 | 0.0 | 0.04 | 0.06 |
| P1 | 10.30 | 153.16 | 1.0000 | −0.08 | −0.75 | +0.27 | 0.09 | 0.73 | 4.11 | 0.1 | 0.09 | 0.11 |
| S1 | 6.40 | 266.09 | 1.0000 | +0.06 | +0.90 | +1.14 | 0.14 | 1.04 | 9.26 | 0.1 | 0.14 | 0.13 |
| K1 | 33.90 | 163.66 | 1.0000 | −0.05 | −0.14 | −0.00 | 0.05 | 0.74 | 1.26 | 0.1 | 0.05 | 0.06 |
| PHI1 | 1.00 | 172.94 | 1.0000 | +0.05 | +5.10 | +1.49 | 0.06 | 0.74 | 40.12 | 0.1 | 0.06 | 0.03 |
| J1 | 1.50 | 199.67 | 1.0000 | +0.00 | +0.07 | +1.21 | 0.03 | 0.72 | 27.63 | 0.0 | 0.03 | 0.11 |
| OO1 | 0.80 | 308.56 | 1.0000 | −0.05 | −6.12 | −5.80 | 0.09 | 0.66 | 50.46 | 0.1 | 0.09 | 0.12 |
| OQ2 | 1.20 | 221.45 | 1.0000 | +0.01 | +0.63 | −0.13 | 0.01 | 0.30 | 14.40 | 0.0 | 0.01 | 0.03 |
| EPS2 | 3.30 | 243.50 | 1.0000 | −0.06 | −1.75 | +0.15 | 0.06 | 0.32 | 5.58 | 0.2 | 0.06 | 0.06 |
| 2N2 | 11.50 | 241.73 | 1.0000 | −0.01 | −0.07 | +0.08 | 0.02 | 0.31 | 1.55 | 0.1 | 0.02 | 0.02 |
| MU2 | 14.60 | 264.89 | 1.0000 | −0.05 | −0.36 | +0.00 | 0.05 | 0.32 | 1.26 | 0.2 | 0.05 | 0.03 |
| N2 | 88.50 | 261.31 | 1.0000 | −0.06 | −0.07 | −0.02 | 0.06 | 0.32 | 0.21 | 0.2 | 0.06 | 0.04 |
| NU2 | 17.20 | 259.95 | 1.0000 | −0.02 | −0.13 | +0.05 | 0.03 | 0.32 | 1.07 | 0.1 | 0.03 | 0.00 |
| GAM2 | 1.00 | 311.58 | 1.0000 | −0.05 | −5.24 | −1.63 | 0.06 | 0.32 | 19.08 | 0.2 | 0.06 | 0.04 |
| H1 | 9.10 | 260.41 | 1.0000 | −0.03 | −0.34 | +0.08 | 0.03 | 0.32 | 2.02 | 0.1 | 0.03 | 0.02 |
| M2 | 453.60 | 282.99 | 1.0000 | +0.01 | +0.00 | −0.01 | 0.05 | 0.32 | 0.04 | 0.1 | 0.05 | 0.08 |
| H2 | 1.70 | 96.81 | 1.0000 | +0.01 | +0.40 | +0.05 | 0.01 | 0.32 | 10.84 | 0.0 | 0.01 | 0.03 |
| MKS2 | 1.40 | 300.38 | 1.0000 | −0.00 | −0.28 | +0.76 | 0.02 | 0.33 | 13.40 | 0.1 | 0.02 | 0.02 |
| LDA2 | 4.80 | 285.39 | 1.0000 | −0.02 | −0.32 | −0.07 | 0.02 | 0.32 | 3.85 | 0.0 | 0.02 | 0.00 |
| L2 | 14.70 | 295.56 | 1.0000 | −0.00 | −0.02 | +0.08 | 0.02 | 0.32 | 1.25 | 0.1 | 0.02 | 0.02 |
| T2 | 7.00 | 323.99 | 1.0000 | +0.03 | +0.43 | −0.21 | 0.04 | 0.32 | 2.64 | 0.1 | 0.04 | 0.07 |
| S2 | 163.10 | 323.27 | 1.0000 | −0.04 | −0.02 | −0.01 | 0.05 | 0.32 | 0.11 | 0.1 | 0.05 | 0.05 |
| R2 | 1.30 | 15.20 | 1.0000 | +0.01 | +0.74 | −0.00 | 0.01 | 0.26 | 11.48 | 0.0 | 0.01 | 0.03 |
| K2 | 46.70 | 321.05 | 1.0000 | −0.01 | −0.02 | +0.02 | 0.02 | 0.33 | 0.40 | 0.0 | 0.02 | 0.01 |
| MSN2 | 1.30 | 156.83 | 1.0000 | +0.01 | +0.36 | +1.57 | 0.04 | 0.32 | 14.03 | 0.1 | 0.04 | 0.02 |
| ETA2 | 1.90 | 338.97 | 1.0000 | +0.04 | +2.19 | +1.21 | 0.06 | 0.30 | 8.79 | 0.1 | 0.06 | 0.06 |
| MO3 | 3.30 | 187.27 | 0.9997 | +0.04 | +1.24 | +0.21 | 0.04 | 0.19 | 3.26 | 0.2 | 0.04 | 0.02 |
| M3 | 4.20 | 204.25 | 0.9997 | +0.07 | +1.72 | +0.12 | 0.07 | 0.19 | 2.49 | 0.4 | 0.07 | 0.06 |
| SO3 | 1.90 | 287.31 | 0.9997 | −0.02 | −1.03 | −0.20 | 0.02 | 0.19 | 5.80 | 0.1 | 0.02 | 0.01 |
| MK3 | 3.20 | 323.99 | 0.9997 | −0.03 | −1.06 | +0.26 | 0.04 | 0.19 | 3.42 | 0.2 | 0.04 | 0.05 |
| SK3 | 1.30 | 62.44 | 0.9996 | −0.05 | −3.61 | +0.51 | 0.05 | 0.19 | 8.66 | 0.2 | 0.05 | 0.02 |
| MN4 | 1.70 | 216.54 | 0.9974 | +0.05 | +3.14 | −0.12 | 0.05 | 0.29 | 9.54 | 0.2 | 0.06 | 0.06 |
| M4 | 9.60 | 252.24 | 0.9972 | −0.00 | −0.02 | +0.01 | 0.00 | 0.29 | 1.74 | 0.0 | 0.03 | 0.01 |
| SN4 | 1.30 | 65.64 | 0.9970 | −0.05 | −3.43 | −0.21 | 0.05 | 0.29 | 13.43 | 0.1 | 0.04 | 0.03 |
| MS4 | 10.00 | 9.00 | 0.9968 | +0.02 | +0.19 | +0.02 | 0.02 | 0.29 | 1.68 | 0.1 | 0.05 | 0.01 |
| MK4 | 3.30 | 14.80 | 0.9967 | −0.02 | −0.73 | −0.34 | 0.03 | 0.30 | 5.22 | 0.1 | 0.02 | 0.03 |
| S4 | 2.70 | 156.54 | 0.9963 | −0.01 | −0.29 | −0.22 | 0.01 | 0.30 | 6.30 | 0.0 | 0.01 | 0.05 |
| SK4 | 1.30 | 150.18 | 0.9963 | −0.01 | −0.87 | −0.85 | 0.02 | 0.30 | 13.22 | 0.1 | 0.02 | 0.01 |
| 2MK5 | 1.50 | 32.73 | 0.9825 | −0.01 | −0.56 | −0.11 | 0.01 | 0.13 | 4.84 | 0.1 | 0.02 | 0.01 |
| 2SK5 | 0.30 | 305.81 | 0.9783 | +0.02 | +4.84 | +0.49 | 0.02 | 0.13 | 23.05 | 0.1 | 0.02 | 0.02 |
| 2MN6 | 2.60 | 86.28 | 0.9359 | +0.02 | +0.78 | −0.01 | 0.02 | 0.15 | 3.23 | 0.1 | 0.20 | 0.02 |
| M6 | 3.80 | 111.04 | 0.9328 | +0.06 | +1.52 | +0.02 | 0.06 | 0.15 | 2.19 | 0.4 | 0.34 | 0.05 |
| 2MS6 | 1.80 | 95.95 | 0.9267 | +0.00 | +0.06 | +0.13 | 0.00 | 0.15 | 4.70 | 0.0 | 0.14 | 0.01 |
| 2MK6 | 0.40 | 63.99 | 0.9262 | +0.05 | +12.42 | +2.72 | 0.05 | 0.15 | 19.27 | 0.3 | 0.09 | 0.05 |
| 2SM6 | 1.90 | 94.71 | 0.9203 | +0.02 | +1.19 | −0.23 | 0.02 | 0.15 | 4.41 | 0.1 | 0.19 | 0.03 |
| MSK6 | 1.10 | 90.15 | 0.9197 | +0.03 | +3.18 | −0.50 | 0.04 | 0.15 | 7.56 | 0.2 | 0.13 | 0.04 |
| M8 | 0.40 | 184.55 | 0.5815 | +0.01 | +2.13 | +0.92 | 0.01 | 0.03 | 4.93 | 0.2 | 0.30 | 0.01 |

### Bodø (`kartverket/BOO`)

2006-01-01 to 2020-12-31: 131,133 hourly values. SA over 1991 to 2020 is 147.9 mm at 330.8°, 0.2 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 147.70 | 330.85 | 1.0000 | +3.23 | +2.19 | −4.09 | 11.14 | 12.20 | 4.64 | 0.9 | 11.14 | 10.76 |
| SSA | 21.50 | 132.10 | 1.0000 | −0.03 | −0.17 | +0.03 | 0.04 | 12.21 | 32.58 | 0.0 | 0.04 | 0.19 |
| MM | 26.80 | 176.80 | 1.0000 | +0.04 | +0.15 | −0.03 | 0.04 | 12.21 | 26.07 | 0.0 | 0.04 | 0.24 |
| MF | 17.90 | 185.16 | 1.0000 | +0.05 | +0.30 | −0.05 | 0.06 | 12.21 | 38.96 | 0.0 | 0.06 | 0.12 |
| ALP1 | 1.90 | 256.01 | 1.0000 | −0.01 | −0.60 | −0.19 | 0.01 | 0.85 | 25.73 | 0.0 | 0.01 | 0.12 |
| 2Q1 | 3.40 | 301.02 | 1.0000 | +0.02 | +0.62 | −0.17 | 0.02 | 0.84 | 14.05 | 0.0 | 0.02 | 0.09 |
| SIG1 | 5.30 | 307.96 | 1.0000 | −0.02 | −0.30 | +0.18 | 0.02 | 0.85 | 9.27 | 0.0 | 0.02 | 0.14 |
| Q1 | 17.10 | 343.07 | 1.0000 | +0.03 | +0.17 | −0.00 | 0.03 | 0.85 | 2.84 | 0.0 | 0.03 | 0.03 |
| RHO1 | 3.40 | 359.20 | 1.0000 | −0.03 | −0.78 | +0.40 | 0.03 | 0.86 | 14.62 | 0.0 | 0.03 | 0.03 |
| O1 | 36.40 | 41.83 | 1.0000 | +0.03 | +0.09 | −0.01 | 0.03 | 0.86 | 1.35 | 0.0 | 0.03 | 0.09 |
| NO1 | 3.60 | 154.52 | 1.0000 | +0.05 | +1.27 | −0.17 | 0.05 | 0.76 | 12.01 | 0.1 | 0.05 | 0.06 |
| PI1 | 1.80 | 168.50 | 1.0000 | +0.01 | +0.68 | −0.01 | 0.01 | 0.84 | 26.67 | 0.0 | 0.01 | 0.03 |
| P1 | 28.80 | 184.72 | 1.0000 | −0.01 | −0.04 | −0.02 | 0.01 | 0.84 | 1.68 | 0.0 | 0.01 | 0.06 |
| S1 | 7.20 | 290.62 | 1.0000 | +0.01 | +0.20 | −0.10 | 0.02 | 1.20 | 9.52 | 0.0 | 0.02 | 0.09 |
| K1 | 103.90 | 193.77 | 1.0000 | −0.02 | −0.02 | −0.00 | 0.02 | 0.85 | 0.47 | 0.0 | 0.02 | 0.07 |
| PSI1 | 1.60 | 39.12 | 1.0000 | −0.06 | −3.84 | +0.73 | 0.06 | 0.85 | 31.55 | 0.1 | 0.06 | 0.03 |
| J1 | 6.00 | 229.05 | 1.0000 | +0.03 | +0.54 | +0.18 | 0.04 | 0.83 | 7.87 | 0.0 | 0.04 | 0.03 |
| OO1 | 2.90 | 299.04 | 1.0000 | +0.03 | +0.88 | −0.32 | 0.03 | 0.76 | 14.87 | 0.0 | 0.03 | 0.02 |
| OQ2 | 2.40 | 257.64 | 1.0000 | 0.00 | −0.01 | −0.29 | 0.01 | 0.34 | 8.12 | 0.0 | 0.01 | 0.03 |
| EPS2 | 6.00 | 256.14 | 1.0000 | −0.04 | −0.61 | −0.13 | 0.04 | 0.35 | 3.41 | 0.1 | 0.04 | 0.04 |
| 2N2 | 23.40 | 283.48 | 1.0000 | +0.00 | +0.00 | −0.01 | 0.00 | 0.35 | 0.85 | 0.0 | 0.00 | 0.04 |
| MU2 | 26.00 | 281.23 | 1.0000 | +0.02 | +0.08 | +0.02 | 0.02 | 0.36 | 0.79 | 0.1 | 0.02 | 0.01 |
| N2 | 178.20 | 306.79 | 1.0000 | +0.00 | +0.00 | −0.00 | 0.01 | 0.36 | 0.12 | 0.0 | 0.01 | 0.03 |
| NU2 | 34.50 | 310.90 | 1.0000 | −0.04 | −0.11 | −0.03 | 0.04 | 0.36 | 0.60 | 0.1 | 0.04 | 0.05 |
| GAM2 | 2.30 | 312.39 | 1.0000 | −0.05 | −2.27 | +0.07 | 0.05 | 0.35 | 9.05 | 0.1 | 0.05 | 0.04 |
| H1 | 4.20 | 354.08 | 1.0000 | −0.01 | −0.12 | +0.36 | 0.03 | 0.36 | 4.93 | 0.1 | 0.03 | 0.02 |
| M2 | 873.70 | 330.54 | 1.0000 | −0.05 | −0.01 | −0.00 | 0.08 | 0.36 | 0.02 | 0.2 | 0.07 | 0.09 |
| H2 | 1.10 | 42.68 | 1.0000 | +0.03 | +3.00 | +0.24 | 0.03 | 0.36 | 18.39 | 0.1 | 0.03 | 0.03 |
| MKS2 | 1.50 | 317.29 | 1.0000 | +0.04 | +2.96 | +0.11 | 0.05 | 0.37 | 13.64 | 0.1 | 0.05 | 0.05 |
| LDA2 | 6.10 | 350.22 | 1.0000 | +0.06 | +1.07 | −0.10 | 0.07 | 0.36 | 3.36 | 0.2 | 0.07 | 0.08 |
| L2 | 22.90 | 353.14 | 1.0000 | +0.05 | +0.20 | −0.02 | 0.05 | 0.36 | 0.90 | 0.1 | 0.05 | 0.05 |
| T2 | 16.20 | 4.51 | 1.0000 | +0.04 | +0.23 | −0.02 | 0.04 | 0.36 | 1.29 | 0.1 | 0.04 | 0.02 |
| S2 | 304.70 | 9.63 | 1.0000 | −0.04 | −0.01 | −0.00 | 0.04 | 0.36 | 0.07 | 0.1 | 0.04 | 0.07 |
| R2 | 1.40 | 30.65 | 1.0000 | +0.04 | +2.89 | −0.11 | 0.04 | 0.29 | 11.75 | 0.1 | 0.04 | 0.05 |
| K2 | 85.80 | 7.40 | 1.0000 | +0.03 | +0.03 | −0.01 | 0.03 | 0.37 | 0.24 | 0.1 | 0.03 | 0.01 |
| MSN2 | 0.70 | 265.93 | 1.0000 | −0.06 | −8.30 | −1.75 | 0.06 | 0.36 | 32.11 | 0.2 | 0.06 | 0.05 |
| ETA2 | 3.90 | 25.48 | 1.0000 | +0.02 | +0.44 | +0.05 | 0.02 | 0.33 | 4.89 | 0.1 | 0.02 | 0.01 |
| MO3 | 5.00 | 277.87 | 0.9997 | +0.03 | +0.55 | +0.26 | 0.04 | 0.19 | 2.21 | 0.1 | 0.04 | 0.02 |
| M3 | 1.10 | 248.68 | 0.9997 | −0.02 | −1.82 | +0.22 | 0.02 | 0.19 | 10.04 | 0.1 | 0.02 | 0.01 |
| SO3 | 1.80 | 0.31 | 0.9997 | −0.04 | −1.99 | −0.15 | 0.04 | 0.19 | 6.30 | 0.2 | 0.04 | 0.02 |
| MK3 | 1.10 | 52.36 | 0.9997 | −0.03 | −2.66 | −0.41 | 0.03 | 0.19 | 10.30 | 0.1 | 0.03 | 0.01 |
| SK3 | 3.70 | 144.33 | 0.9996 | +0.00 | +0.09 | +0.12 | 0.01 | 0.19 | 2.99 | 0.0 | 0.01 | 0.01 |
| MN4 | 12.40 | 228.64 | 0.9974 | +0.02 | +0.12 | −0.03 | 0.02 | 0.47 | 2.16 | 0.0 | 0.05 | 0.02 |
| M4 | 26.70 | 265.65 | 0.9972 | +0.05 | +0.19 | −0.04 | 0.06 | 0.47 | 1.00 | 0.1 | 0.13 | 0.03 |
| SN4 | 3.80 | 349.22 | 0.9970 | +0.02 | +0.60 | +0.01 | 0.02 | 0.47 | 7.08 | 0.0 | 0.03 | 0.02 |
| MS4 | 14.00 | 359.97 | 0.9968 | +0.08 | +0.58 | +0.07 | 0.08 | 0.47 | 1.92 | 0.2 | 0.13 | 0.05 |
| MK4 | 3.80 | 4.62 | 0.9967 | −0.05 | −1.22 | +0.18 | 0.05 | 0.48 | 7.31 | 0.1 | 0.04 | 0.06 |
| S4 | 2.00 | 209.81 | 0.9963 | −0.01 | −0.40 | −0.03 | 0.01 | 0.48 | 13.66 | 0.0 | 0.00 | 0.01 |
| 2MK5 | 2.00 | 31.91 | 0.9825 | −0.02 | −1.22 | −0.13 | 0.03 | 0.10 | 2.85 | 0.2 | 0.01 | 0.02 |
| 2SK5 | 0.20 | 305.11 | 0.9783 | −0.01 | −5.58 | −0.53 | 0.01 | 0.10 | 29.90 | 0.1 | 0.01 | 0.02 |
| 2MN6 | 0.30 | 237.64 | 0.9359 | −0.03 | −9.53 | −2.71 | 0.03 | 0.04 | 7.74 | 0.5 | 0.02 | 0.01 |
| M6 | 0.30 | 286.99 | 0.9328 | +0.04 | +13.89 | +0.98 | 0.04 | 0.04 | 6.13 | 0.7 | 0.07 | 0.06 |
| 2MS6 | 0.30 | 79.54 | 0.9267 | +0.01 | +3.90 | −2.69 | 0.02 | 0.04 | 6.74 | 0.4 | 0.04 | 0.02 |
| 2MK6 | 0.10 | 85.99 | 0.9262 | +0.06 | +54.77 | +0.07 | 0.06 | 0.04 | 13.90 | 0.9 | 0.07 | 0.03 |
| 2SM6 | 0.10 | 170.85 | 0.9203 | +0.02 | +17.08 | +8.68 | 0.02 | 0.04 | 17.97 | 0.5 | 0.03 | 0.03 |
| MSK6 | 0.10 | 156.22 | 0.9197 | −0.02 | −16.35 | −6.28 | 0.02 | 0.04 | 25.48 | 0.3 | 0.01 | 0.02 |
| M8 | 0.40 | 113.98 | 0.5815 | +0.03 | +8.67 | +1.75 | 0.04 | 0.02 | 2.29 | 0.8 | 0.35 | 0.04 |

### Harstad (`kartverket/HAR`)

2006-01-01 to 2020-12-31: 131,338 hourly values. SA over 1991 to 2020 is 128.1 mm at 329.8°, 0.4 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 127.80 | 329.93 | 1.0000 | +3.34 | +2.61 | −2.16 | 5.92 | 10.87 | 4.75 | 0.5 | 5.92 | 5.67 |
| SSA | 19.70 | 167.45 | 1.0000 | −0.06 | −0.29 | +0.09 | 0.06 | 10.88 | 31.72 | 0.0 | 0.06 | 0.68 |
| MM | 26.20 | 180.92 | 1.0000 | +0.01 | +0.04 | −0.11 | 0.05 | 10.87 | 23.78 | 0.0 | 0.05 | 0.47 |
| MF | 17.10 | 192.51 | 1.0000 | −0.04 | −0.24 | +0.09 | 0.05 | 10.88 | 36.53 | 0.0 | 0.05 | 0.84 |
| ALP1 | 0.90 | 304.45 | 1.0000 | +0.01 | +0.65 | +1.44 | 0.02 | 0.47 | 29.68 | 0.0 | 0.02 | 0.09 |
| 2Q1 | 4.00 | 294.87 | 1.0000 | −0.02 | −0.41 | +0.32 | 0.03 | 0.46 | 6.67 | 0.0 | 0.03 | 0.03 |
| SIG1 | 3.70 | 306.90 | 1.0000 | −0.06 | −1.67 | −0.60 | 0.07 | 0.47 | 7.45 | 0.1 | 0.07 | 0.03 |
| Q1 | 17.90 | 347.85 | 1.0000 | −0.02 | −0.12 | +0.05 | 0.03 | 0.47 | 1.50 | 0.0 | 0.03 | 0.06 |
| RHO1 | 3.30 | 1.09 | 1.0000 | +0.01 | +0.36 | −0.56 | 0.03 | 0.48 | 8.24 | 0.1 | 0.03 | 0.06 |
| O1 | 42.40 | 42.90 | 1.0000 | +0.01 | +0.02 | −0.01 | 0.01 | 0.47 | 0.64 | 0.0 | 0.01 | 0.04 |
| NO1 | 2.30 | 156.80 | 1.0000 | +0.02 | +0.84 | +0.63 | 0.03 | 0.42 | 10.43 | 0.1 | 0.03 | 0.01 |
| PI1 | 0.80 | 139.48 | 1.0000 | +0.03 | +3.77 | +0.02 | 0.03 | 0.47 | 32.23 | 0.1 | 0.03 | 0.03 |
| P1 | 15.30 | 186.17 | 1.0000 | +0.05 | +0.30 | +0.03 | 0.05 | 0.47 | 1.74 | 0.1 | 0.05 | 0.03 |
| S1 | 6.20 | 310.47 | 1.0000 | −0.01 | −0.16 | +0.25 | 0.03 | 0.66 | 6.14 | 0.0 | 0.03 | 0.04 |
| K1 | 59.30 | 197.53 | 1.0000 | −0.07 | −0.11 | +0.01 | 0.07 | 0.47 | 0.46 | 0.1 | 0.07 | 0.05 |
| PSI1 | 1.50 | 216.89 | 1.0000 | +0.02 | +0.98 | −0.22 | 0.02 | 0.47 | 17.74 | 0.0 | 0.02 | 0.06 |
| PHI1 | 1.30 | 171.67 | 1.0000 | −0.05 | −3.81 | +0.86 | 0.05 | 0.47 | 21.43 | 0.1 | 0.05 | 0.07 |
| THE1 | 0.70 | 274.43 | 1.0000 | +0.07 | +10.49 | +0.87 | 0.07 | 0.47 | 34.93 | 0.2 | 0.07 | 0.06 |
| J1 | 3.70 | 234.70 | 1.0000 | −0.06 | −1.54 | +0.17 | 0.06 | 0.46 | 7.21 | 0.1 | 0.06 | 0.05 |
| SO1 | 0.70 | 172.30 | 1.0000 | −0.06 | −9.25 | −0.61 | 0.06 | 0.47 | 42.76 | 0.1 | 0.06 | 0.08 |
| OO1 | 2.00 | 311.38 | 1.0000 | +0.04 | +2.04 | −0.03 | 0.04 | 0.42 | 11.80 | 0.1 | 0.04 | 0.05 |
| OQ2 | 2.10 | 268.62 | 1.0000 | −0.02 | −0.72 | +0.36 | 0.02 | 0.24 | 6.75 | 0.1 | 0.02 | 0.05 |
| EPS2 | 4.40 | 268.00 | 1.0000 | −0.02 | −0.53 | +0.02 | 0.02 | 0.26 | 3.36 | 0.1 | 0.02 | 0.02 |
| 2N2 | 19.10 | 295.84 | 1.0000 | +0.01 | +0.05 | +0.05 | 0.02 | 0.25 | 0.76 | 0.1 | 0.02 | 0.02 |
| MU2 | 19.80 | 291.35 | 1.0000 | −0.02 | −0.12 | −0.10 | 0.04 | 0.26 | 0.76 | 0.1 | 0.04 | 0.02 |
| N2 | 144.40 | 318.78 | 1.0000 | +0.01 | +0.01 | −0.00 | 0.01 | 0.26 | 0.10 | 0.0 | 0.01 | 0.03 |
| NU2 | 28.00 | 323.21 | 1.0000 | +0.03 | +0.09 | −0.02 | 0.03 | 0.26 | 0.53 | 0.1 | 0.03 | 0.05 |
| GAM2 | 2.00 | 336.40 | 1.0000 | +0.03 | +1.77 | −0.50 | 0.04 | 0.26 | 7.22 | 0.1 | 0.04 | 0.04 |
| H1 | 4.10 | 341.84 | 1.0000 | −0.01 | −0.15 | −0.17 | 0.01 | 0.26 | 3.65 | 0.0 | 0.01 | 0.01 |
| M2 | 702.00 | 342.68 | 1.0000 | −0.07 | −0.01 | −0.01 | 0.10 | 0.26 | 0.02 | 0.3 | 0.09 | 0.09 |
| H2 | 1.10 | 188.88 | 1.0000 | −0.00 | −0.24 | +0.92 | 0.02 | 0.26 | 13.71 | 0.1 | 0.02 | 0.02 |
| MKS2 | 0.80 | 305.27 | 1.0000 | +0.03 | +3.20 | +0.77 | 0.03 | 0.27 | 18.43 | 0.1 | 0.03 | 0.06 |
| LDA2 | 5.30 | 1.50 | 1.0000 | −0.03 | −0.54 | −0.55 | 0.06 | 0.26 | 2.84 | 0.2 | 0.06 | 0.03 |
| L2 | 19.00 | 5.87 | 1.0000 | +0.06 | +0.29 | +0.09 | 0.06 | 0.26 | 0.78 | 0.2 | 0.06 | 0.01 |
| T2 | 12.30 | 17.81 | 1.0000 | +0.02 | +0.12 | +0.10 | 0.03 | 0.26 | 1.23 | 0.1 | 0.03 | 0.03 |
| S2 | 238.90 | 22.10 | 1.0000 | −0.01 | −0.00 | −0.02 | 0.07 | 0.26 | 0.06 | 0.3 | 0.07 | 0.06 |
| R2 | 1.70 | 52.48 | 1.0000 | +0.03 | +2.00 | +0.96 | 0.05 | 0.21 | 7.05 | 0.2 | 0.05 | 0.03 |
| K2 | 67.30 | 19.48 | 1.0000 | −0.05 | −0.08 | +0.04 | 0.07 | 0.26 | 0.23 | 0.2 | 0.06 | 0.05 |
| MSN2 | 0.80 | 254.64 | 1.0000 | +0.02 | +2.36 | +1.09 | 0.02 | 0.26 | 18.18 | 0.1 | 0.02 | 0.01 |
| ETA2 | 2.90 | 37.19 | 1.0000 | +0.03 | +1.02 | −0.30 | 0.03 | 0.24 | 4.71 | 0.1 | 0.03 | 0.03 |
| MO3 | 2.00 | 306.31 | 0.9997 | +0.05 | +2.29 | +0.79 | 0.05 | 0.11 | 3.07 | 0.4 | 0.05 | 0.02 |
| M3 | 0.80 | 332.30 | 0.9997 | +0.02 | +2.11 | −3.32 | 0.05 | 0.11 | 7.51 | 0.4 | 0.05 | 0.01 |
| SO3 | 0.80 | 39.30 | 0.9997 | +0.06 | +7.95 | +0.07 | 0.06 | 0.11 | 7.28 | 0.5 | 0.06 | 0.02 |
| MK3 | 0.90 | 86.96 | 0.9997 | −0.00 | −0.41 | +1.61 | 0.03 | 0.11 | 6.96 | 0.2 | 0.03 | 0.03 |
| SK3 | 1.90 | 154.38 | 0.9996 | +0.03 | +1.51 | +0.15 | 0.03 | 0.11 | 3.24 | 0.2 | 0.03 | 0.02 |
| MN4 | 2.20 | 208.88 | 0.9974 | −0.03 | −1.29 | +0.93 | 0.05 | 0.10 | 2.69 | 0.3 | 0.04 | 0.04 |
| M4 | 4.70 | 235.23 | 0.9972 | +0.03 | +0.53 | +0.30 | 0.03 | 0.10 | 1.24 | 0.2 | 0.05 | 0.03 |
| SN4 | 0.30 | 293.14 | 0.9970 | +0.04 | +13.87 | −0.11 | 0.04 | 0.10 | 17.27 | 0.4 | 0.04 | 0.02 |
| MS4 | 2.00 | 285.19 | 0.9968 | +0.02 | +1.15 | +1.30 | 0.05 | 0.10 | 2.91 | 0.4 | 0.05 | 0.03 |
| MK4 | 0.60 | 287.73 | 0.9967 | −0.00 | −0.42 | +0.28 | 0.00 | 0.10 | 10.00 | 0.0 | 0.00 | 0.03 |
| SK4 | 0.20 | 207.82 | 0.9963 | +0.02 | +9.07 | +2.06 | 0.02 | 0.10 | 27.29 | 0.2 | 0.02 | 0.03 |
| 2MK5 | 1.00 | 335.28 | 0.9825 | +0.01 | +1.29 | −0.67 | 0.02 | 0.07 | 4.15 | 0.2 | 0.03 | 0.02 |
| 2SK5 | 0.20 | 53.32 | 0.9783 | +0.02 | +9.49 | −1.08 | 0.02 | 0.07 | 19.24 | 0.2 | 0.02 | 0.01 |
| 2MN6 | 0.30 | 307.58 | 0.9359 | −0.05 | −16.22 | +2.65 | 0.05 | 0.10 | 22.74 | 0.4 | 0.03 | 0.03 |
| M6 | 0.80 | 345.02 | 0.9328 | +0.00 | +0.47 | −0.34 | 0.01 | 0.10 | 7.08 | 0.0 | 0.06 | 0.04 |
| 2MS6 | 2.00 | 37.15 | 0.9267 | −0.03 | −1.77 | +0.31 | 0.04 | 0.10 | 2.91 | 0.3 | 0.12 | 0.02 |
| 2MK6 | 0.60 | 31.22 | 0.9262 | +0.03 | +5.03 | +1.54 | 0.03 | 0.10 | 9.28 | 0.3 | 0.08 | 0.02 |
| 2SM6 | 0.90 | 103.94 | 0.9203 | +0.03 | +3.68 | +1.08 | 0.04 | 0.10 | 6.13 | 0.3 | 0.12 | 0.05 |
| MSK6 | 0.50 | 108.02 | 0.9197 | +0.06 | +11.41 | +0.86 | 0.06 | 0.10 | 10.40 | 0.5 | 0.11 | 0.04 |
| M8 | 1.90 | 157.60 | 0.5815 | +0.02 | +1.18 | +0.33 | 0.03 | 0.03 | 0.99 | 0.4 | 1.41 | 0.04 |

### Heimsjøen (`kartverket/HEI`)

2006-01-01 to 2020-12-31: 130,924 hourly values. SA over 1991 to 2020 is 137.4 mm at 325.7°, 1.0 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 136.90 | 326.05 | 1.0000 | +5.92 | +4.32 | −5.47 | 14.59 | 11.34 | 4.55 | **1.2** | 14.59 | 14.74 |
| MM | 27.80 | 177.98 | 1.0000 | +0.04 | +0.14 | −0.03 | 0.04 | 11.35 | 23.35 | 0.0 | 0.04 | 0.41 |
| MF | 19.50 | 186.56 | 1.0000 | −0.05 | −0.28 | −0.05 | 0.06 | 11.35 | 33.42 | 0.0 | 0.06 | 0.15 |
| 2Q1 | 4.00 | 293.76 | 1.0000 | −0.00 | −0.04 | +0.19 | 0.01 | 0.68 | 9.70 | 0.0 | 0.01 | 0.05 |
| SIG1 | 5.10 | 288.64 | 1.0000 | +0.04 | +0.70 | −0.29 | 0.04 | 0.69 | 7.69 | 0.1 | 0.04 | 0.09 |
| Q1 | 20.20 | 340.61 | 1.0000 | −0.00 | −0.01 | +0.00 | 0.00 | 0.68 | 1.94 | 0.0 | 0.00 | 0.08 |
| RHO1 | 3.90 | 352.48 | 1.0000 | −0.01 | −0.19 | −0.34 | 0.02 | 0.69 | 10.22 | 0.0 | 0.02 | 0.05 |
| O1 | 54.10 | 34.31 | 1.0000 | −0.01 | −0.03 | −0.03 | 0.03 | 0.69 | 0.73 | 0.0 | 0.03 | 0.11 |
| NO1 | 3.00 | 123.36 | 1.0000 | +0.05 | +1.52 | +0.15 | 0.05 | 0.62 | 11.63 | 0.1 | 0.05 | 0.06 |
| PI1 | 1.30 | 136.33 | 1.0000 | −0.02 | −1.59 | +0.07 | 0.02 | 0.68 | 30.50 | 0.0 | 0.02 | 0.04 |
| P1 | 17.70 | 150.14 | 1.0000 | −0.00 | −0.01 | +0.05 | 0.01 | 0.68 | 2.20 | 0.0 | 0.01 | 0.03 |
| S1 | 7.30 | 277.93 | 1.0000 | −0.02 | −0.21 | −0.16 | 0.03 | 0.97 | 7.61 | 0.0 | 0.03 | 0.08 |
| K1 | 61.60 | 165.57 | 1.0000 | −0.01 | −0.01 | +0.02 | 0.02 | 0.69 | 0.64 | 0.0 | 0.02 | 0.07 |
| PHI1 | 1.70 | 179.56 | 1.0000 | +0.04 | +2.43 | +0.96 | 0.05 | 0.68 | 22.44 | 0.1 | 0.05 | 0.06 |
| J1 | 3.70 | 206.35 | 1.0000 | −0.02 | −0.42 | −0.19 | 0.02 | 0.67 | 10.41 | 0.0 | 0.02 | 0.04 |
| OO1 | 1.90 | 294.19 | 1.0000 | −0.01 | −0.72 | −0.66 | 0.03 | 0.61 | 18.58 | 0.0 | 0.03 | 0.03 |
| OQ2 | 2.10 | 228.78 | 1.0000 | +0.05 | +2.33 | −0.03 | 0.05 | 0.28 | 7.36 | 0.2 | 0.05 | 0.02 |
| EPS2 | 4.60 | 230.14 | 1.0000 | +0.02 | +0.46 | −0.12 | 0.02 | 0.29 | 3.57 | 0.1 | 0.02 | 0.02 |
| 2N2 | 20.40 | 255.37 | 1.0000 | −0.01 | −0.03 | +0.03 | 0.01 | 0.28 | 0.80 | 0.0 | 0.01 | 0.05 |
| MU2 | 20.70 | 253.89 | 1.0000 | −0.01 | −0.03 | −0.02 | 0.01 | 0.29 | 0.81 | 0.0 | 0.01 | 0.01 |
| N2 | 157.50 | 277.76 | 1.0000 | −0.04 | −0.02 | −0.02 | 0.06 | 0.29 | 0.11 | 0.2 | 0.06 | 0.05 |
| NU2 | 30.60 | 281.47 | 1.0000 | +0.01 | +0.03 | −0.03 | 0.02 | 0.29 | 0.55 | 0.1 | 0.02 | 0.04 |
| GAM2 | 2.60 | 301.08 | 1.0000 | −0.06 | −2.28 | +0.34 | 0.06 | 0.29 | 6.49 | 0.2 | 0.06 | 0.05 |
| H1 | 3.60 | 301.05 | 1.0000 | +0.02 | +0.62 | +0.05 | 0.02 | 0.29 | 4.63 | 0.1 | 0.02 | 0.05 |
| M2 | 779.40 | 300.87 | 1.0000 | −0.03 | −0.00 | −0.01 | 0.13 | 0.29 | 0.02 | 0.4 | 0.13 | 0.12 |
| H2 | 2.30 | 130.06 | 1.0000 | −0.08 | −3.60 | −0.25 | 0.08 | 0.29 | 7.61 | 0.3 | 0.08 | 0.04 |
| LDA2 | 6.30 | 317.34 | 1.0000 | +0.02 | +0.32 | −0.13 | 0.03 | 0.29 | 2.66 | 0.1 | 0.03 | 0.02 |
| L2 | 21.30 | 322.64 | 1.0000 | +0.02 | +0.09 | −0.05 | 0.03 | 0.29 | 0.78 | 0.1 | 0.03 | 0.04 |
| T2 | 14.10 | 333.94 | 1.0000 | +0.03 | +0.18 | +0.04 | 0.03 | 0.30 | 1.20 | 0.1 | 0.03 | 0.02 |
| S2 | 269.50 | 338.38 | 1.0000 | +0.01 | +0.00 | −0.01 | 0.03 | 0.30 | 0.06 | 0.1 | 0.03 | 0.04 |
| R2 | 2.00 | 19.25 | 1.0000 | −0.03 | −1.35 | −0.13 | 0.03 | 0.24 | 6.95 | 0.1 | 0.03 | 0.05 |
| K2 | 75.70 | 335.84 | 1.0000 | −0.02 | −0.03 | −0.00 | 0.02 | 0.30 | 0.22 | 0.1 | 0.02 | 0.01 |
| MSN2 | 1.10 | 217.80 | 1.0000 | +0.04 | +3.25 | +0.63 | 0.04 | 0.29 | 14.71 | 0.1 | 0.04 | 0.03 |
| ETA2 | 3.50 | 351.76 | 1.0000 | −0.01 | −0.37 | −0.10 | 0.01 | 0.27 | 4.45 | 0.0 | 0.01 | 0.02 |
| MO3 | 4.30 | 231.92 | 0.9997 | +0.02 | +0.35 | −0.29 | 0.03 | 0.19 | 2.54 | 0.1 | 0.03 | 0.03 |
| M3 | 2.30 | 166.85 | 0.9997 | −0.02 | −1.02 | −0.18 | 0.03 | 0.19 | 4.70 | 0.1 | 0.02 | 0.01 |
| SO3 | 1.60 | 321.15 | 0.9997 | +0.03 | +1.80 | +0.01 | 0.03 | 0.19 | 6.73 | 0.1 | 0.03 | 0.03 |
| MK3 | 1.60 | 353.44 | 0.9997 | −0.02 | −1.22 | +0.78 | 0.03 | 0.19 | 6.88 | 0.1 | 0.03 | 0.00 |
| SK3 | 3.10 | 102.54 | 0.9996 | −0.02 | −0.75 | +0.04 | 0.02 | 0.19 | 3.55 | 0.1 | 0.02 | 0.02 |
| MN4 | 8.60 | 168.00 | 0.9974 | +0.05 | +0.54 | −0.01 | 0.05 | 0.31 | 2.03 | 0.1 | 0.07 | 0.02 |
| M4 | 20.00 | 207.80 | 0.9972 | +0.07 | +0.37 | +0.03 | 0.07 | 0.31 | 0.87 | 0.2 | 0.13 | 0.05 |
| SN4 | 2.40 | 286.53 | 0.9970 | +0.00 | +0.12 | −0.32 | 0.01 | 0.31 | 7.36 | 0.0 | 0.02 | 0.01 |
| MS4 | 11.40 | 302.41 | 0.9968 | +0.00 | +0.04 | −0.00 | 0.00 | 0.31 | 1.55 | 0.0 | 0.04 | 0.02 |
| MK4 | 3.40 | 302.84 | 0.9967 | +0.01 | +0.19 | −0.38 | 0.02 | 0.31 | 5.26 | 0.1 | 0.03 | 0.02 |
| S4 | 1.30 | 146.78 | 0.9963 | −0.05 | −3.50 | −0.18 | 0.05 | 0.31 | 14.19 | 0.1 | 0.04 | 0.05 |
| 2MK5 | 1.40 | 244.55 | 0.9825 | +0.07 | +4.79 | +1.08 | 0.07 | 0.07 | 2.68 | 0.8 | 0.10 | 0.04 |
| 2SK5 | 0.20 | 155.69 | 0.9783 | +0.01 | +5.50 | −1.65 | 0.01 | 0.07 | 18.72 | 0.1 | 0.02 | 0.02 |
| 2MN6 | 2.20 | 50.85 | 0.9359 | +0.04 | +1.75 | −0.13 | 0.04 | 0.06 | 1.60 | 0.5 | 0.19 | 0.02 |
| M6 | 4.00 | 78.90 | 0.9328 | +0.01 | +0.30 | −0.34 | 0.03 | 0.06 | 0.89 | 0.4 | 0.30 | 0.02 |
| 2MS6 | 4.20 | 129.01 | 0.9267 | +0.05 | +1.18 | +0.08 | 0.05 | 0.06 | 0.84 | 0.6 | 0.38 | 0.04 |
| 2MK6 | 1.10 | 128.70 | 0.9262 | +0.03 | +2.96 | −0.84 | 0.04 | 0.06 | 3.22 | 0.4 | 0.12 | 0.04 |
| 2SM6 | 1.10 | 174.82 | 0.9203 | −0.01 | −1.13 | +0.82 | 0.02 | 0.06 | 3.29 | 0.2 | 0.08 | 0.01 |
| MSK6 | 0.70 | 181.01 | 0.9197 | +0.00 | +0.49 | +1.59 | 0.02 | 0.06 | 5.14 | 0.3 | 0.07 | 0.03 |
| 3MK7 | 0.30 | 165.23 | 0.7948 | +0.01 | +3.93 | −0.43 | 0.01 | 0.07 | 12.18 | 0.1 | 0.09 | 0.02 |
| M8 | 0.70 | 358.67 | 0.5815 | −0.04 | −6.00 | +1.69 | 0.05 | 0.05 | 4.29 | 0.6 | 0.43 | 0.04 |

### Hammerfest (`kartverket/HFT`)

2006-01-01 to 2020-12-31: 131,227 hourly values. SA over 1991 to 2020 is 130.5 mm at 331.5°, 0.6 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 131.00 | 331.33 | 1.0000 | −2.61 | −1.99 | −1.82 | 4.88 | 10.90 | 4.87 | 0.4 | 4.88 | 4.41 |
| MM | 23.40 | 185.09 | 1.0000 | +0.22 | +0.95 | +2.07 | 0.88 | 10.89 | 26.47 | 0.1 | 0.88 | 0.63 |
| MF | 15.00 | 190.76 | 1.0000 | +0.12 | +0.80 | +3.61 | 0.96 | 10.90 | 41.31 | 0.1 | 0.96 | 0.92 |
| ALP1 | 1.00 | 283.83 | 1.0000 | +0.11 | +11.02 | +14.64 | 0.29 | 0.51 | 26.37 | 0.6 | 0.29 | 0.20 |
| 2Q1 | 4.20 | 303.34 | 1.0000 | −0.18 | −4.21 | −3.04 | 0.28 | 0.51 | 7.19 | 0.4 | 0.28 | 0.30 |
| SIG1 | 4.40 | 308.52 | 1.0000 | −0.30 | −6.88 | +1.92 | 0.33 | 0.52 | 7.20 | 0.6 | 0.33 | 0.33 |
| Q1 | 17.00 | 353.02 | 1.0000 | +0.03 | +0.15 | −0.90 | 0.27 | 0.51 | 1.72 | 0.5 | 0.27 | 0.39 |
| RHO1 | 3.20 | 359.30 | 1.0000 | −0.37 | −11.48 | −1.27 | 0.37 | 0.52 | 10.50 | 0.7 | 0.37 | 0.37 |
| O1 | 32.60 | 50.41 | 1.0000 | +0.19 | +0.59 | −0.44 | 0.32 | 0.52 | 0.90 | 0.5 | 0.32 | 0.26 |
| TAU1 | 1.20 | 213.87 | 1.0000 | −0.30 | −25.07 | +5.81 | 0.32 | 0.48 | 30.56 | 0.6 | 0.32 | 0.36 |
| BET1 | 1.20 | 169.92 | 1.0000 | −0.35 | −29.37 | +7.56 | 0.38 | 0.52 | 34.82 | 0.7 | 0.38 | 0.38 |
| NO1 | 2.70 | 173.01 | 1.0000 | +0.14 | +5.21 | +2.08 | 0.17 | 0.46 | 9.27 | 0.3 | 0.17 | 0.17 |
| PI1 | 1.40 | 156.52 | 1.0000 | +0.13 | +9.17 | +11.03 | 0.31 | 0.51 | 19.06 | 0.6 | 0.31 | 0.33 |
| P1 | 21.80 | 206.47 | 1.0000 | +0.29 | +1.34 | +0.40 | 0.33 | 0.51 | 1.32 | 0.6 | 0.33 | 0.28 |
| S1 | 6.00 | 304.91 | 1.0000 | +0.37 | +6.20 | −1.78 | 0.42 | 0.72 | 6.49 | 0.5 | 0.42 | 0.42 |
| K1 | 79.70 | 214.07 | 1.0000 | +0.30 | +0.38 | +0.10 | 0.33 | 0.51 | 0.37 | 0.6 | 0.33 | 0.40 |
| PHI1 | 1.50 | 214.75 | 1.0000 | −0.09 | −5.89 | −12.28 | 0.32 | 0.51 | 20.66 | 0.6 | 0.32 | 0.28 |
| THE1 | 1.10 | 237.73 | 1.0000 | −0.31 | −27.89 | +2.99 | 0.31 | 0.51 | 37.10 | 0.6 | 0.31 | 0.28 |
| J1 | 5.50 | 240.12 | 1.0000 | −0.02 | −0.34 | +3.18 | 0.31 | 0.50 | 5.21 | 0.6 | 0.31 | 0.23 |
| SO1 | 0.80 | 223.19 | 1.0000 | +0.04 | +4.50 | −19.22 | 0.28 | 0.52 | 35.39 | 0.5 | 0.28 | 0.31 |
| OO1 | 2.10 | 313.43 | 1.0000 | +0.09 | +4.04 | −0.45 | 0.09 | 0.46 | 12.02 | 0.2 | 0.09 | 0.11 |
| OQ2 | 3.30 | 300.98 | 1.0000 | −0.51 | −15.49 | −2.13 | 0.52 | 0.35 | 7.30 | **1.4** | 0.52 | 0.46 |
| EPS2 | 5.30 | 290.08 | 1.0000 | −0.32 | −6.04 | +3.72 | 0.46 | 0.37 | 4.28 | 0.9 | 0.46 | 0.49 |
| 2N2 | 25.40 | 329.34 | 1.0000 | −0.06 | −0.23 | −1.04 | 0.46 | 0.36 | 0.83 | **1.3** | 0.46 | 0.46 |
| MU2 | 23.50 | 318.71 | 1.0000 | −0.43 | −1.84 | −0.39 | 0.46 | 0.38 | 0.94 | **1.1** | 0.46 | 0.49 |
| N2 | 188.40 | 353.49 | 1.0000 | +0.36 | +0.19 | −0.08 | 0.44 | 0.38 | 0.12 | 0.9 | 0.44 | 0.42 |
| NU2 | 37.30 | 359.11 | 1.0000 | −0.21 | −0.57 | −0.65 | 0.47 | 0.38 | 0.59 | **1.1** | 0.47 | 0.43 |
| GAM2 | 2.80 | 25.43 | 1.0000 | +0.04 | +1.32 | −10.33 | 0.51 | 0.37 | 7.51 | **1.4** | 0.51 | 0.46 |
| H1 | 11.10 | 30.64 | 1.0000 | −0.44 | −3.97 | −0.77 | 0.47 | 0.38 | 2.03 | **1.2** | 0.47 | 0.47 |
| M2 | 885.60 | 19.33 | 1.0000 | +0.14 | +0.02 | +0.01 | 0.18 | 0.38 | 0.02 | 0.4 | 0.18 | 0.52 |
| H2 | 6.70 | 279.00 | 1.0000 | −0.22 | −3.23 | +3.28 | 0.43 | 0.38 | 3.37 | 1.0 | 0.43 | 0.42 |
| MKS2 | 4.90 | 352.51 | 1.0000 | −0.21 | −4.21 | −5.02 | 0.47 | 0.38 | 4.70 | **1.1** | 0.47 | 0.34 |
| LDA2 | 7.20 | 52.02 | 1.0000 | +0.37 | +5.08 | −1.35 | 0.40 | 0.38 | 2.87 | 1.0 | 0.40 | 0.39 |
| L2 | 24.30 | 49.92 | 1.0000 | −0.01 | −0.05 | −1.20 | 0.51 | 0.38 | 0.89 | **1.3** | 0.51 | 0.50 |
| T2 | 13.70 | 48.04 | 1.0000 | −0.10 | −0.72 | −1.63 | 0.40 | 0.38 | 1.61 | **1.0** | 0.40 | 0.41 |
| S2 | 275.20 | 58.23 | 1.0000 | −0.24 | −0.09 | −0.08 | 0.46 | 0.38 | 0.08 | **1.0** | 0.46 | 0.35 |
| K2 | 77.60 | 55.71 | 1.0000 | +0.18 | +0.23 | +0.26 | 0.39 | 0.38 | 0.28 | 0.9 | 0.39 | 0.43 |
| MSN2 | 1.50 | 317.73 | 1.0000 | +0.21 | +13.70 | +12.30 | 0.40 | 0.38 | 12.66 | 1.0 | 0.40 | 0.37 |
| ETA2 | 3.50 | 61.99 | 1.0000 | −0.21 | −5.91 | +3.35 | 0.29 | 0.35 | 6.08 | 0.6 | 0.29 | 0.30 |
| MO3 | 0.90 | 310.17 | 0.9997 | +0.06 | +6.36 | −4.31 | 0.09 | 0.12 | 7.33 | 0.6 | 0.09 | 0.05 |
| M3 | 1.30 | 25.16 | 0.9997 | +0.03 | +2.33 | −1.73 | 0.05 | 0.12 | 5.14 | 0.3 | 0.05 | 0.05 |
| SO3 | 0.50 | 189.65 | 0.9997 | +0.05 | +9.03 | −5.04 | 0.06 | 0.12 | 12.87 | 0.4 | 0.06 | 0.06 |
| MK3 | 1.40 | 157.32 | 0.9997 | +0.02 | +1.73 | +0.31 | 0.03 | 0.12 | 4.89 | 0.2 | 0.03 | 0.06 |
| SK3 | 2.30 | 203.74 | 0.9996 | −0.10 | −4.43 | +0.98 | 0.11 | 0.12 | 3.18 | 0.8 | 0.11 | 0.08 |
| MN4 | 4.20 | 223.51 | 0.9974 | +0.06 | +1.34 | −0.09 | 0.06 | 0.16 | 2.11 | 0.3 | 0.07 | 0.06 |
| M4 | 12.30 | 255.18 | 0.9972 | −0.01 | −0.07 | −0.15 | 0.03 | 0.16 | 0.73 | 0.2 | 0.04 | 0.04 |
| SN4 | 0.80 | 315.01 | 0.9970 | −0.06 | −6.93 | −1.18 | 0.06 | 0.16 | 12.19 | 0.3 | 0.06 | 0.02 |
| MS4 | 8.00 | 328.24 | 0.9968 | −0.02 | −0.18 | +0.07 | 0.02 | 0.16 | 1.14 | 0.1 | 0.02 | 0.02 |
| MK4 | 2.40 | 333.16 | 0.9967 | −0.05 | −2.24 | −1.04 | 0.07 | 0.16 | 3.92 | 0.3 | 0.06 | 0.06 |
| S4 | 0.80 | 132.54 | 0.9963 | −0.07 | −8.51 | +2.76 | 0.08 | 0.16 | 12.48 | 0.4 | 0.07 | 0.04 |
| 2MK5 | 0.90 | 25.29 | 0.9825 | +0.06 | +6.21 | −1.20 | 0.06 | 0.09 | 5.64 | 0.5 | 0.08 | 0.03 |
| 2SK5 | 0.20 | 165.35 | 0.9783 | +0.03 | +13.79 | +7.18 | 0.04 | 0.09 | 23.77 | 0.3 | 0.04 | 0.02 |
| 2MN6 | 3.40 | 228.34 | 0.9359 | +0.07 | +2.03 | +0.10 | 0.07 | 0.10 | 1.70 | 0.6 | 0.31 | 0.05 |
| M6 | 5.80 | 261.34 | 0.9328 | −0.03 | −0.44 | +0.19 | 0.03 | 0.10 | 1.02 | 0.2 | 0.39 | 0.02 |
| 2MS6 | 5.20 | 315.47 | 0.9267 | +0.03 | +0.57 | −0.06 | 0.03 | 0.10 | 1.13 | 0.3 | 0.44 | 0.04 |
| 2MK6 | 1.20 | 324.36 | 0.9262 | +0.06 | +4.63 | −1.13 | 0.06 | 0.11 | 4.82 | 0.5 | 0.16 | 0.04 |
| 2SM6 | 0.80 | 7.38 | 0.9203 | +0.07 | +9.31 | −2.83 | 0.09 | 0.10 | 6.77 | 0.6 | 0.16 | 0.06 |
| MSK6 | 0.60 | 11.82 | 0.9197 | +0.00 | +0.69 | −0.34 | 0.01 | 0.10 | 9.93 | 0.0 | 0.06 | 0.01 |
| 3MK7 | 0.10 | 276.27 | 0.7948 | +0.01 | +7.45 | −0.64 | 0.01 | 0.04 | 23.92 | 0.1 | 0.03 | 0.01 |
| M8 | 0.60 | 230.06 | 0.5815 | −0.03 | −4.09 | +0.54 | 0.03 | 0.03 | 3.40 | 0.4 | 0.39 | 0.02 |

### Helgeroa (`kartverket/HRO`)

2006-01-01 to 2020-12-31: 131,356 hourly values. SA over 1991 to 2020 is 82.8 mm at 289.0°, 1.3 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 81.50 | 288.99 | 1.0000 | +10.17 | +12.47 | −2.63 | 10.91 | 13.00 | 8.12 | 0.8 | 10.91 | 10.88 |
| SSA | 25.80 | 197.74 | 1.0000 | −0.06 | −0.22 | −0.06 | 0.06 | 12.99 | 28.91 | 0.0 | 0.06 | 0.32 |
| MM | 28.60 | 177.33 | 1.0000 | −0.03 | −0.11 | −0.10 | 0.06 | 12.99 | 26.06 | 0.0 | 0.06 | 0.62 |
| MF | 15.30 | 177.96 | 1.0000 | +0.06 | +0.39 | +0.12 | 0.07 | 12.99 | 48.45 | 0.0 | 0.07 | 0.51 |
| SIG1 | 3.70 | 68.81 | 1.0000 | −0.06 | −1.54 | −0.45 | 0.06 | 1.19 | 18.70 | 0.0 | 0.06 | 0.13 |
| Q1 | 5.90 | 208.57 | 1.0000 | +0.04 | +0.72 | −0.18 | 0.05 | 1.18 | 11.40 | 0.0 | 0.05 | 0.12 |
| RHO1 | 1.60 | 205.66 | 1.0000 | +0.02 | +1.21 | −0.09 | 0.02 | 1.20 | 42.36 | 0.0 | 0.02 | 0.03 |
| O1 | 21.50 | 280.68 | 1.0000 | −0.05 | −0.23 | −0.04 | 0.05 | 1.19 | 3.18 | 0.0 | 0.05 | 0.12 |
| P1 | 3.50 | 123.05 | 1.0000 | +0.03 | +0.80 | −0.25 | 0.03 | 1.17 | 19.04 | 0.0 | 0.03 | 0.08 |
| S1 | 9.10 | 290.88 | 1.0000 | +0.04 | +0.41 | +0.51 | 0.09 | 1.67 | 10.45 | 0.0 | 0.09 | 0.12 |
| K1 | 1.90 | 90.80 | 1.0000 | −0.00 | −0.08 | −0.91 | 0.03 | 1.19 | 35.80 | 0.0 | 0.03 | 0.15 |
| OO1 | 1.10 | 318.48 | 1.0000 | +0.03 | +2.41 | +0.59 | 0.03 | 1.06 | 53.69 | 0.0 | 0.03 | 0.11 |
| EPS2 | 6.00 | 240.56 | 1.0000 | −0.05 | −0.78 | −0.07 | 0.05 | 0.92 | 8.87 | 0.1 | 0.05 | 0.02 |
| 2N2 | 4.30 | 18.51 | 1.0000 | +0.02 | +0.49 | +0.13 | 0.02 | 0.91 | 12.03 | 0.0 | 0.02 | 0.07 |
| MU2 | 23.60 | 275.99 | 1.0000 | +0.03 | +0.14 | −0.06 | 0.04 | 0.93 | 2.27 | 0.0 | 0.04 | 0.07 |
| N2 | 28.70 | 61.61 | 1.0000 | −0.01 | −0.02 | +0.00 | 0.01 | 0.94 | 1.87 | 0.0 | 0.01 | 0.03 |
| NU2 | 10.60 | 96.44 | 1.0000 | +0.04 | +0.35 | −0.12 | 0.04 | 0.94 | 5.05 | 0.0 | 0.04 | 0.01 |
| H1 | 12.40 | 221.02 | 1.0000 | +0.05 | +0.39 | −0.01 | 0.05 | 0.93 | 4.30 | 0.1 | 0.05 | 0.09 |
| M2 | 119.10 | 108.09 | 1.0000 | −0.02 | −0.01 | −0.00 | 0.02 | 0.94 | 0.45 | 0.0 | 0.02 | 0.09 |
| H2 | 9.60 | 356.04 | 1.0000 | +0.04 | +0.45 | +0.12 | 0.05 | 0.94 | 5.59 | 0.0 | 0.05 | 0.01 |
| MKS2 | 4.10 | 19.50 | 1.0000 | +0.02 | +0.42 | −0.65 | 0.05 | 0.95 | 13.25 | 0.0 | 0.05 | 0.09 |
| LDA2 | 6.30 | 201.52 | 1.0000 | −0.03 | −0.49 | −0.00 | 0.03 | 0.94 | 8.57 | 0.0 | 0.03 | 0.06 |
| L2 | 12.10 | 200.99 | 1.0000 | −0.04 | −0.34 | +0.07 | 0.04 | 0.93 | 4.43 | 0.0 | 0.04 | 0.04 |
| T2 | 3.90 | 59.30 | 1.0000 | +0.06 | +1.45 | −0.25 | 0.06 | 0.94 | 13.69 | 0.1 | 0.06 | 0.10 |
| S2 | 27.80 | 51.97 | 1.0000 | +0.03 | +0.11 | −0.03 | 0.03 | 0.94 | 1.95 | 0.0 | 0.03 | 0.03 |
| R2 | 1.60 | 196.94 | 1.0000 | −0.03 | −2.21 | −1.00 | 0.05 | 0.76 | 28.01 | 0.0 | 0.05 | 0.05 |
| K2 | 6.70 | 46.36 | 1.0000 | +0.03 | +0.42 | −0.03 | 0.03 | 0.95 | 8.08 | 0.0 | 0.03 | 0.03 |
| MSN2 | 2.30 | 112.95 | 1.0000 | −0.03 | −1.44 | +0.24 | 0.03 | 0.93 | 23.54 | 0.0 | 0.03 | 0.05 |
| MO3 | 1.80 | 320.61 | 0.9997 | +0.05 | +2.61 | −1.29 | 0.06 | 0.28 | 8.66 | 0.2 | 0.06 | 0.03 |
| M3 | 2.70 | 19.58 | 0.9997 | +0.05 | +1.83 | −0.14 | 0.05 | 0.27 | 5.68 | 0.2 | 0.05 | 0.03 |
| SO3 | 1.20 | 116.08 | 0.9997 | +0.02 | +1.34 | −0.31 | 0.02 | 0.28 | 13.16 | 0.1 | 0.02 | 0.06 |
| MK3 | 2.30 | 143.82 | 0.9997 | +0.02 | +0.88 | −0.69 | 0.03 | 0.28 | 6.85 | 0.1 | 0.03 | 0.02 |
| MN4 | 3.40 | 242.41 | 0.9974 | −0.00 | −0.08 | +0.03 | 0.00 | 0.27 | 4.61 | 0.0 | 0.01 | 0.03 |
| M4 | 10.60 | 280.28 | 0.9972 | +0.00 | +0.04 | −0.04 | 0.01 | 0.27 | 1.48 | 0.0 | 0.03 | 0.03 |
| SN4 | 0.60 | 154.09 | 0.9970 | −0.00 | −0.32 | +2.41 | 0.03 | 0.28 | 26.40 | 0.1 | 0.03 | 0.02 |
| MS4 | 3.50 | 355.15 | 0.9968 | +0.02 | +0.46 | +0.04 | 0.02 | 0.28 | 4.49 | 0.1 | 0.03 | 0.04 |
| MK4 | 0.90 | 354.10 | 0.9967 | −0.01 | −1.58 | +0.10 | 0.01 | 0.28 | 18.07 | 0.1 | 0.01 | 0.02 |
| S4 | 0.40 | 321.00 | 0.9963 | +0.03 | +6.59 | −0.70 | 0.03 | 0.28 | 37.26 | 0.1 | 0.03 | 0.02 |
| 2MK5 | 0.70 | 338.12 | 0.9825 | −0.03 | −4.20 | +0.22 | 0.03 | 0.07 | 5.75 | 0.4 | 0.02 | 0.03 |
| 2SK5 | 0.10 | 277.35 | 0.9783 | +0.03 | +31.50 | −2.69 | 0.03 | 0.07 | 29.40 | 0.4 | 0.03 | 0.02 |
| 2MN6 | 2.30 | 237.42 | 0.9359 | −0.03 | −1.51 | −0.49 | 0.04 | 0.10 | 2.46 | 0.3 | 0.12 | 0.03 |
| M6 | 4.30 | 273.03 | 0.9328 | +0.03 | +0.81 | −0.36 | 0.04 | 0.10 | 1.28 | 0.3 | 0.35 | 0.06 |
| 2MS6 | 4.50 | 346.62 | 0.9267 | +0.01 | +0.30 | +0.13 | 0.02 | 0.10 | 1.24 | 0.1 | 0.37 | 0.04 |
| 2MK6 | 1.30 | 348.20 | 0.9262 | −0.01 | −0.47 | +1.03 | 0.02 | 0.10 | 4.41 | 0.2 | 0.10 | 0.01 |
| 2SM6 | 1.00 | 58.25 | 0.9203 | +0.02 | +2.31 | −1.22 | 0.03 | 0.10 | 5.46 | 0.2 | 0.11 | 0.04 |
| MSK6 | 0.60 | 56.49 | 0.9197 | +0.05 | +7.62 | +0.66 | 0.05 | 0.10 | 8.77 | 0.4 | 0.10 | 0.05 |
| 3MK7 | 0.10 | 112.70 | 0.7948 | −0.00 | −3.21 | +6.24 | 0.01 | 0.04 | 26.06 | 0.2 | 0.03 | 0.02 |
| M8 | 0.20 | 346.49 | 0.5815 | −0.01 | −3.06 | −1.61 | 0.01 | 0.02 | 5.22 | 0.3 | 0.13 | 0.01 |

### Honningsvåg (`kartverket/HVG`)

2006-01-01 to 2020-12-31: 131,222 hourly values. SA over 1991 to 2020 is 123.7 mm at 331.1°, 0.9 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 122.90 | 330.83 | 1.0000 | −2.00 | −1.63 | −1.31 | 3.43 | 10.76 | 5.10 | 0.3 | 3.43 | 3.61 |
| MM | 22.60 | 186.33 | 1.0000 | −0.02 | −0.09 | −0.21 | 0.09 | 10.76 | 27.32 | 0.0 | 0.09 | 0.33 |
| MF | 15.90 | 192.32 | 1.0000 | −0.03 | −0.18 | +0.01 | 0.03 | 10.76 | 38.84 | 0.0 | 0.03 | 0.38 |
| ALP1 | 1.10 | 305.92 | 1.0000 | −0.02 | −1.61 | +0.24 | 0.02 | 0.50 | 26.61 | 0.0 | 0.02 | 0.02 |
| 2Q1 | 4.30 | 308.24 | 1.0000 | +0.04 | +0.90 | −0.11 | 0.04 | 0.50 | 6.56 | 0.1 | 0.04 | 0.14 |
| SIG1 | 4.40 | 320.25 | 1.0000 | −0.01 | −0.20 | −0.25 | 0.02 | 0.51 | 6.61 | 0.0 | 0.02 | 0.13 |
| Q1 | 17.70 | 359.86 | 1.0000 | +0.02 | +0.10 | −0.11 | 0.04 | 0.50 | 1.63 | 0.1 | 0.04 | 0.03 |
| RHO1 | 3.10 | 5.54 | 1.0000 | +0.04 | +1.24 | +0.81 | 0.06 | 0.51 | 9.32 | 0.1 | 0.06 | 0.09 |
| O1 | 29.70 | 57.36 | 1.0000 | +0.02 | +0.06 | −0.00 | 0.02 | 0.51 | 0.98 | 0.0 | 0.02 | 0.06 |
| TAU1 | 1.20 | 225.39 | 1.0000 | +0.01 | +0.80 | −0.09 | 0.01 | 0.47 | 22.35 | 0.0 | 0.01 | 0.03 |
| NO1 | 3.40 | 191.35 | 1.0000 | +0.01 | +0.39 | −0.31 | 0.02 | 0.45 | 7.58 | 0.0 | 0.02 | 0.02 |
| PI1 | 1.80 | 189.27 | 1.0000 | +0.06 | +3.36 | +0.64 | 0.06 | 0.50 | 15.40 | 0.1 | 0.06 | 0.04 |
| P1 | 25.30 | 224.31 | 1.0000 | −0.01 | −0.05 | +0.02 | 0.02 | 0.50 | 1.13 | 0.0 | 0.02 | 0.01 |
| S1 | 7.30 | 318.74 | 1.0000 | +0.00 | +0.05 | −0.32 | 0.04 | 0.71 | 5.57 | 0.1 | 0.04 | 0.05 |
| K1 | 91.00 | 230.29 | 1.0000 | −0.01 | −0.01 | −0.01 | 0.02 | 0.51 | 0.32 | 0.0 | 0.02 | 0.05 |
| PSI1 | 1.00 | 252.68 | 1.0000 | +0.04 | +3.98 | −0.83 | 0.04 | 0.50 | 27.67 | 0.1 | 0.04 | 0.07 |
| PHI1 | 1.60 | 218.50 | 1.0000 | −0.04 | −2.67 | −0.71 | 0.05 | 0.50 | 18.42 | 0.1 | 0.05 | 0.03 |
| THE1 | 0.90 | 261.15 | 1.0000 | +0.04 | +4.44 | −0.42 | 0.04 | 0.51 | 30.78 | 0.1 | 0.04 | 0.05 |
| J1 | 6.30 | 256.52 | 1.0000 | +0.01 | +0.11 | −0.10 | 0.01 | 0.49 | 4.46 | 0.0 | 0.01 | 0.02 |
| SO1 | 1.30 | 228.12 | 1.0000 | −0.02 | −1.78 | −1.36 | 0.04 | 0.51 | 22.79 | 0.1 | 0.04 | 0.05 |
| OO1 | 2.50 | 320.57 | 1.0000 | +0.01 | +0.55 | +0.10 | 0.01 | 0.45 | 10.26 | 0.0 | 0.01 | 0.01 |
| OQ2 | 2.90 | 326.93 | 1.0000 | +0.04 | +1.27 | +0.14 | 0.04 | 0.36 | 7.10 | 0.1 | 0.04 | 0.07 |
| EPS2 | 4.60 | 325.87 | 1.0000 | +0.06 | +1.24 | −0.06 | 0.06 | 0.38 | 4.69 | 0.1 | 0.06 | 0.02 |
| 2N2 | 25.70 | 359.88 | 1.0000 | +0.03 | +0.12 | −0.02 | 0.03 | 0.37 | 0.83 | 0.1 | 0.03 | 0.01 |
| MU2 | 21.50 | 350.25 | 1.0000 | +0.01 | +0.07 | +0.06 | 0.03 | 0.39 | 1.03 | 0.1 | 0.03 | 0.02 |
| N2 | 189.50 | 25.99 | 1.0000 | −0.05 | −0.03 | −0.00 | 0.05 | 0.39 | 0.12 | 0.1 | 0.05 | 0.03 |
| NU2 | 37.40 | 31.30 | 1.0000 | −0.01 | −0.03 | −0.05 | 0.03 | 0.39 | 0.59 | 0.1 | 0.03 | 0.05 |
| GAM2 | 2.60 | 46.57 | 1.0000 | +0.03 | +1.12 | −0.03 | 0.03 | 0.38 | 8.29 | 0.1 | 0.03 | 0.04 |
| H1 | 8.60 | 46.53 | 1.0000 | −0.03 | −0.32 | +0.03 | 0.03 | 0.39 | 2.59 | 0.1 | 0.03 | 0.02 |
| M2 | 870.40 | 53.10 | 1.0000 | +0.02 | +0.00 | −0.01 | 0.10 | 0.39 | 0.03 | 0.3 | 0.11 | 0.13 |
| H2 | 8.30 | 313.43 | 1.0000 | −0.02 | −0.19 | −0.08 | 0.02 | 0.39 | 2.70 | 0.0 | 0.02 | 0.07 |
| MKS2 | 4.40 | 15.08 | 1.0000 | +0.07 | +1.70 | −0.41 | 0.08 | 0.39 | 5.05 | 0.2 | 0.08 | 0.02 |
| LDA2 | 8.00 | 86.06 | 1.0000 | −0.05 | −0.62 | +0.06 | 0.05 | 0.39 | 2.80 | 0.1 | 0.05 | 0.02 |
| L2 | 24.40 | 83.38 | 1.0000 | +0.06 | +0.24 | −0.08 | 0.07 | 0.39 | 0.90 | 0.2 | 0.07 | 0.03 |
| T2 | 12.60 | 80.61 | 1.0000 | −0.04 | −0.29 | +0.11 | 0.04 | 0.39 | 1.78 | 0.1 | 0.04 | 0.07 |
| S2 | 251.00 | 92.63 | 1.0000 | −0.05 | −0.02 | −0.01 | 0.06 | 0.39 | 0.09 | 0.1 | 0.06 | 0.07 |
| R2 | 0.90 | 270.02 | 1.0000 | −0.02 | −1.90 | −0.10 | 0.02 | 0.32 | 20.56 | 0.1 | 0.02 | 0.02 |
| K2 | 70.90 | 90.78 | 1.0000 | −0.03 | −0.05 | +0.02 | 0.04 | 0.39 | 0.32 | 0.1 | 0.04 | 0.04 |
| MSN2 | 1.90 | 1.10 | 1.0000 | −0.02 | −1.04 | +0.18 | 0.02 | 0.39 | 11.75 | 0.1 | 0.02 | 0.06 |
| ETA2 | 2.90 | 97.87 | 1.0000 | +0.04 | +1.33 | +0.27 | 0.04 | 0.36 | 6.97 | 0.1 | 0.04 | 0.08 |
| MO3 | 0.80 | 244.43 | 0.9997 | +0.02 | +3.05 | +0.81 | 0.03 | 0.12 | 8.22 | 0.2 | 0.03 | 0.02 |
| M3 | 1.30 | 66.12 | 0.9997 | +0.02 | +1.33 | +0.70 | 0.02 | 0.11 | 5.02 | 0.1 | 0.02 | 0.01 |
| SO3 | 1.30 | 244.04 | 0.9997 | −0.06 | −4.51 | −0.45 | 0.06 | 0.12 | 5.46 | 0.5 | 0.06 | 0.04 |
| MK3 | 1.80 | 202.60 | 0.9997 | −0.00 | −0.21 | +0.56 | 0.02 | 0.12 | 3.75 | 0.1 | 0.02 | 0.02 |
| SK3 | 1.80 | 242.97 | 0.9996 | −0.00 | −0.05 | −0.07 | 0.00 | 0.12 | 3.75 | 0.0 | 0.00 | 0.03 |
| MN4 | 1.90 | 245.84 | 0.9974 | −0.03 | −1.74 | +0.23 | 0.03 | 0.11 | 3.43 | 0.3 | 0.03 | 0.01 |
| M4 | 7.10 | 279.04 | 0.9972 | −0.04 | −0.57 | −0.25 | 0.05 | 0.11 | 0.91 | 0.3 | 0.04 | 0.06 |
| SN4 | 0.50 | 23.84 | 0.9970 | −0.02 | −3.77 | −0.65 | 0.02 | 0.11 | 13.42 | 0.2 | 0.02 | 0.03 |
| MS4 | 5.30 | 5.67 | 0.9968 | +0.01 | +0.21 | −0.12 | 0.02 | 0.11 | 1.22 | 0.1 | 0.03 | 0.03 |
| MK4 | 1.50 | 4.49 | 0.9967 | +0.01 | +0.31 | −0.23 | 0.01 | 0.11 | 4.35 | 0.1 | 0.01 | 0.01 |
| S4 | 1.00 | 172.23 | 0.9963 | −0.05 | −5.39 | −1.48 | 0.06 | 0.11 | 6.87 | 0.4 | 0.06 | 0.05 |
| SK4 | 0.20 | 193.24 | 0.9963 | −0.02 | −8.82 | −6.10 | 0.03 | 0.11 | 35.77 | 0.2 | 0.03 | 0.05 |
| 2MK5 | 0.40 | 77.77 | 0.9825 | +0.03 | +7.46 | +0.56 | 0.03 | 0.09 | 11.80 | 0.3 | 0.04 | 0.02 |
| 2SK5 | 0.20 | 235.01 | 0.9783 | −0.01 | −5.48 | +3.24 | 0.02 | 0.09 | 26.92 | 0.1 | 0.01 | 0.01 |
| 2MN6 | 1.10 | 191.01 | 0.9359 | −0.01 | −0.54 | +0.11 | 0.01 | 0.09 | 4.77 | 0.1 | 0.07 | 0.02 |
| M6 | 2.10 | 209.56 | 0.9328 | +0.06 | +2.92 | +0.11 | 0.06 | 0.09 | 2.41 | 0.6 | 0.22 | 0.04 |
| 2MS6 | 4.70 | 253.67 | 0.9267 | +0.00 | +0.08 | −0.07 | 0.01 | 0.09 | 1.11 | 0.1 | 0.38 | 0.03 |
| 2MK6 | 1.40 | 247.36 | 0.9262 | −0.02 | −1.39 | +1.09 | 0.03 | 0.09 | 3.87 | 0.3 | 0.10 | 0.02 |
| 2SM6 | 1.70 | 319.81 | 0.9203 | +0.04 | +2.41 | −0.04 | 0.04 | 0.09 | 3.00 | 0.4 | 0.19 | 0.06 |
| MSK6 | 1.10 | 328.26 | 0.9197 | −0.02 | −1.66 | −0.03 | 0.02 | 0.09 | 4.90 | 0.2 | 0.08 | 0.03 |
| 3MK7 | 0.20 | 232.51 | 0.7948 | +0.04 | +18.53 | −0.82 | 0.04 | 0.05 | 12.22 | 0.5 | 0.10 | 0.06 |
| M8 | 0.20 | 186.04 | 0.5815 | +0.01 | +6.73 | +0.15 | 0.01 | 0.02 | 5.40 | 0.2 | 0.17 | 0.02 |

### Kabelvåg (`kartverket/KAB`)

2006-01-01 to 2020-12-31: 131,434 hourly values. SA over 1991 to 2020 is 152.7 mm at 335.1°, 0.3 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 152.40 | 335.13 | 1.0000 | +4.06 | +2.67 | −3.53 | 10.35 | 11.87 | 4.35 | 0.8 | 10.35 | 10.33 |
| SSA | 20.60 | 147.29 | 1.0000 | +0.03 | +0.14 | +0.06 | 0.04 | 11.87 | 32.97 | 0.0 | 0.04 | 0.46 |
| MM | 27.70 | 176.06 | 1.0000 | −0.04 | −0.14 | −0.07 | 0.05 | 11.87 | 24.60 | 0.0 | 0.05 | 0.36 |
| MF | 18.50 | 184.44 | 1.0000 | −0.01 | −0.03 | +0.08 | 0.03 | 11.87 | 36.78 | 0.0 | 0.03 | 0.25 |
| ALP1 | 2.00 | 257.16 | 1.0000 | −0.00 | −0.04 | −0.71 | 0.03 | 0.89 | 25.60 | 0.0 | 0.03 | 0.02 |
| 2Q1 | 3.40 | 302.71 | 1.0000 | +0.04 | +1.28 | −0.26 | 0.05 | 0.88 | 14.69 | 0.0 | 0.05 | 0.05 |
| SIG1 | 5.20 | 311.01 | 1.0000 | +0.00 | +0.07 | +0.52 | 0.05 | 0.90 | 9.91 | 0.1 | 0.05 | 0.05 |
| Q1 | 17.00 | 344.61 | 1.0000 | −0.03 | −0.17 | +0.04 | 0.03 | 0.89 | 3.02 | 0.0 | 0.03 | 0.05 |
| RHO1 | 3.50 | 1.37 | 1.0000 | −0.04 | −1.19 | −0.53 | 0.05 | 0.91 | 15.02 | 0.0 | 0.05 | 0.05 |
| O1 | 36.00 | 45.62 | 1.0000 | +0.05 | +0.13 | −0.00 | 0.05 | 0.90 | 1.43 | 0.1 | 0.05 | 0.03 |
| NO1 | 3.80 | 156.30 | 1.0000 | −0.04 | −1.03 | −0.25 | 0.04 | 0.80 | 12.25 | 0.0 | 0.04 | 0.05 |
| PI1 | 1.80 | 179.58 | 1.0000 | +0.06 | +3.59 | +0.44 | 0.07 | 0.89 | 27.30 | 0.1 | 0.07 | 0.07 |
| P1 | 30.10 | 186.91 | 1.0000 | −0.02 | −0.05 | −0.07 | 0.04 | 0.89 | 1.69 | 0.0 | 0.04 | 0.08 |
| S1 | 7.00 | 291.77 | 1.0000 | −0.01 | −0.11 | +0.28 | 0.03 | 1.26 | 10.34 | 0.0 | 0.03 | 0.05 |
| K1 | 108.80 | 195.74 | 1.0000 | −0.03 | −0.03 | +0.02 | 0.04 | 0.90 | 0.47 | 0.0 | 0.04 | 0.03 |
| PSI1 | 1.60 | 42.95 | 1.0000 | −0.03 | −2.00 | −0.26 | 0.03 | 0.89 | 32.60 | 0.0 | 0.03 | 0.10 |
| THE1 | 1.20 | 242.32 | 1.0000 | −0.03 | −2.60 | −1.31 | 0.04 | 0.90 | 43.98 | 0.0 | 0.04 | 0.04 |
| J1 | 6.20 | 230.30 | 1.0000 | +0.04 | +0.69 | −0.18 | 0.05 | 0.87 | 8.01 | 0.0 | 0.05 | 0.06 |
| OO1 | 2.90 | 297.07 | 1.0000 | +0.01 | +0.43 | +0.35 | 0.02 | 0.80 | 15.73 | 0.0 | 0.02 | 0.03 |
| OQ2 | 2.70 | 263.06 | 1.0000 | −0.06 | −2.03 | −0.17 | 0.06 | 0.36 | 7.79 | 0.2 | 0.06 | 0.05 |
| EPS2 | 6.50 | 260.91 | 1.0000 | +0.05 | +0.79 | −0.24 | 0.06 | 0.38 | 3.29 | 0.1 | 0.06 | 0.05 |
| 2N2 | 24.90 | 287.48 | 1.0000 | +0.03 | +0.12 | +0.04 | 0.03 | 0.37 | 0.85 | 0.1 | 0.03 | 0.01 |
| MU2 | 28.50 | 285.74 | 1.0000 | +0.01 | +0.04 | −0.02 | 0.02 | 0.38 | 0.77 | 0.0 | 0.02 | 0.02 |
| N2 | 189.80 | 310.88 | 1.0000 | −0.02 | −0.01 | −0.01 | 0.05 | 0.38 | 0.12 | 0.1 | 0.05 | 0.04 |
| NU2 | 36.60 | 315.05 | 1.0000 | +0.03 | +0.09 | +0.05 | 0.05 | 0.38 | 0.60 | 0.1 | 0.05 | 0.03 |
| GAM2 | 2.40 | 327.29 | 1.0000 | −0.02 | −0.74 | −0.96 | 0.04 | 0.37 | 9.03 | 0.1 | 0.04 | 0.02 |
| H1 | 3.50 | 351.91 | 1.0000 | −0.03 | −0.71 | +0.40 | 0.03 | 0.38 | 6.29 | 0.1 | 0.03 | 0.04 |
| M2 | 931.10 | 334.78 | 1.0000 | −0.08 | −0.01 | −0.01 | 0.15 | 0.38 | 0.02 | 0.3 | 0.15 | 0.13 |
| MKS2 | 2.20 | 302.91 | 1.0000 | −0.00 | −0.08 | −0.80 | 0.03 | 0.39 | 10.14 | 0.1 | 0.03 | 0.02 |
| LDA2 | 6.30 | 355.86 | 1.0000 | +0.02 | +0.27 | +0.12 | 0.02 | 0.38 | 3.47 | 0.0 | 0.02 | 0.02 |
| L2 | 24.20 | 357.17 | 1.0000 | −0.03 | −0.11 | −0.11 | 0.05 | 0.38 | 0.90 | 0.1 | 0.05 | 0.05 |
| T2 | 17.60 | 9.69 | 1.0000 | −0.02 | −0.13 | −0.15 | 0.05 | 0.39 | 1.26 | 0.1 | 0.05 | 0.04 |
| S2 | 326.90 | 14.13 | 1.0000 | −0.04 | −0.01 | −0.01 | 0.05 | 0.39 | 0.07 | 0.1 | 0.05 | 0.05 |
| R2 | 1.80 | 46.24 | 1.0000 | +0.02 | +0.83 | −0.62 | 0.03 | 0.31 | 9.87 | 0.1 | 0.03 | 0.03 |
| K2 | 92.30 | 11.72 | 1.0000 | −0.04 | −0.05 | −0.01 | 0.05 | 0.39 | 0.24 | 0.1 | 0.05 | 0.03 |
| MSN2 | 0.60 | 280.10 | 1.0000 | +0.02 | +3.74 | +1.55 | 0.03 | 0.38 | 35.03 | 0.1 | 0.03 | 0.02 |
| ETA2 | 4.30 | 30.83 | 1.0000 | −0.03 | −0.64 | +0.13 | 0.03 | 0.35 | 4.73 | 0.1 | 0.03 | 0.02 |
| MO3 | 5.70 | 282.99 | 0.9997 | −0.03 | −0.59 | +0.15 | 0.04 | 0.23 | 2.29 | 0.1 | 0.03 | 0.02 |
| M3 | 1.30 | 258.15 | 0.9997 | −0.02 | −1.49 | +1.31 | 0.03 | 0.22 | 9.89 | 0.1 | 0.03 | 0.02 |
| SO3 | 1.80 | 6.26 | 0.9997 | +0.02 | +1.15 | +0.11 | 0.02 | 0.23 | 7.13 | 0.1 | 0.02 | 0.05 |
| MK3 | 1.30 | 65.21 | 0.9997 | −0.06 | −4.85 | −0.07 | 0.06 | 0.22 | 10.42 | 0.3 | 0.06 | 0.04 |
| SK3 | 4.40 | 152.27 | 0.9996 | −0.01 | −0.31 | +0.31 | 0.03 | 0.23 | 2.95 | 0.1 | 0.03 | 0.01 |
| MN4 | 16.50 | 240.96 | 0.9974 | +0.01 | +0.09 | +0.02 | 0.02 | 0.62 | 2.15 | 0.0 | 0.06 | 0.01 |
| M4 | 35.90 | 278.60 | 0.9972 | +0.01 | +0.03 | −0.01 | 0.01 | 0.62 | 0.99 | 0.0 | 0.11 | 0.05 |
| SN4 | 5.30 | 0.71 | 0.9970 | +0.02 | +0.32 | +0.07 | 0.02 | 0.62 | 6.73 | 0.0 | 0.03 | 0.02 |
| MS4 | 19.80 | 12.77 | 0.9968 | −0.02 | −0.08 | +0.05 | 0.02 | 0.62 | 1.81 | 0.0 | 0.05 | 0.02 |
| MK4 | 5.30 | 17.67 | 0.9967 | +0.01 | +0.21 | +0.08 | 0.01 | 0.63 | 6.83 | 0.0 | 0.03 | 0.01 |
| S4 | 2.70 | 217.85 | 0.9963 | +0.04 | +1.41 | +0.28 | 0.04 | 0.63 | 13.15 | 0.1 | 0.05 | 0.05 |
| SK4 | 0.60 | 244.34 | 0.9963 | +0.02 | +2.51 | +0.10 | 0.02 | 0.63 | 58.72 | 0.0 | 0.02 | 0.02 |
| 2MK5 | 3.60 | 61.22 | 0.9825 | −0.03 | −0.96 | −0.18 | 0.04 | 0.17 | 2.79 | 0.2 | 0.03 | 0.05 |
| 2SK5 | 0.30 | 331.09 | 0.9783 | +0.03 | +9.76 | +0.09 | 0.03 | 0.17 | 30.29 | 0.2 | 0.04 | 0.03 |
| 2MN6 | 2.50 | 316.40 | 0.9359 | +0.03 | +1.11 | +0.18 | 0.03 | 0.07 | 1.53 | 0.3 | 0.20 | 0.04 |
| M6 | 4.50 | 355.01 | 0.9328 | +0.02 | +0.37 | −0.05 | 0.02 | 0.07 | 0.85 | 0.2 | 0.34 | 0.02 |
| 2MS6 | 4.00 | 68.91 | 0.9267 | −0.01 | −0.18 | +0.03 | 0.01 | 0.07 | 0.97 | 0.1 | 0.31 | 0.02 |
| 2MK6 | 1.10 | 74.50 | 0.9262 | +0.04 | +3.38 | +0.49 | 0.04 | 0.07 | 3.48 | 0.4 | 0.13 | 0.03 |
| 2SM6 | 0.80 | 148.31 | 0.9203 | +0.02 | +2.99 | −0.43 | 0.03 | 0.07 | 4.70 | 0.3 | 0.10 | 0.00 |
| MSK6 | 0.50 | 152.61 | 0.9197 | +0.01 | +1.67 | −0.84 | 0.01 | 0.07 | 7.73 | 0.1 | 0.05 | 0.00 |
| 3MK7 | 0.10 | 213.78 | 0.7948 | +0.00 | +2.95 | −4.60 | 0.01 | 0.03 | 18.32 | 0.3 | 0.03 | 0.01 |
| M8 | 0.10 | 248.83 | 0.5815 | −0.00 | −4.46 | +3.06 | 0.01 | 0.02 | 10.11 | 0.3 | 0.06 | 0.00 |

### Kristiansund (`kartverket/KSU`)

2006-01-01 to 2020-12-31: 131,375 hourly values. SA over 1991 to 2020 is 141.1 mm at 324.6°, 1.0 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 141.70 | 324.87 | 1.0000 | +5.85 | +4.13 | −4.69 | 13.20 | 11.46 | 4.45 | **1.1** | 13.20 | 13.14 |
| MM | 27.40 | 178.92 | 1.0000 | −0.15 | −0.53 | −0.09 | 0.15 | 11.47 | 24.11 | 0.0 | 0.15 | 0.46 |
| MF | 19.50 | 187.76 | 1.0000 | +0.07 | +0.36 | +0.28 | 0.12 | 11.46 | 33.58 | 0.0 | 0.12 | 0.49 |
| 2Q1 | 4.20 | 289.31 | 1.0000 | −0.05 | −1.18 | +0.62 | 0.07 | 0.67 | 9.30 | 0.1 | 0.07 | 0.03 |
| SIG1 | 5.00 | 279.89 | 1.0000 | +0.06 | +1.30 | +0.09 | 0.06 | 0.68 | 7.75 | 0.1 | 0.06 | 0.19 |
| Q1 | 21.20 | 335.72 | 1.0000 | −0.02 | −0.08 | −0.07 | 0.03 | 0.68 | 1.84 | 0.0 | 0.03 | 0.09 |
| RHO1 | 4.20 | 347.24 | 1.0000 | −0.06 | −1.38 | −0.06 | 0.06 | 0.69 | 9.55 | 0.1 | 0.06 | 0.07 |
| O1 | 58.10 | 29.58 | 1.0000 | +0.08 | +0.14 | +0.01 | 0.08 | 0.69 | 0.68 | 0.1 | 0.08 | 0.09 |
| NO1 | 3.20 | 118.86 | 1.0000 | +0.09 | +2.69 | −0.66 | 0.09 | 0.61 | 10.71 | 0.1 | 0.09 | 0.05 |
| PI1 | 1.40 | 135.62 | 1.0000 | +0.01 | +0.49 | −0.71 | 0.02 | 0.68 | 27.55 | 0.0 | 0.02 | 0.05 |
| P1 | 16.90 | 150.69 | 1.0000 | +0.07 | +0.40 | −0.02 | 0.07 | 0.68 | 2.28 | 0.1 | 0.07 | 0.08 |
| S1 | 6.70 | 279.04 | 1.0000 | −0.01 | −0.17 | −0.27 | 0.03 | 0.96 | 8.23 | 0.0 | 0.03 | 0.01 |
| K1 | 59.40 | 167.38 | 1.0000 | −0.04 | −0.07 | +0.02 | 0.05 | 0.68 | 0.66 | 0.1 | 0.05 | 0.06 |
| PHI1 | 1.70 | 184.70 | 1.0000 | −0.03 | −1.44 | +1.10 | 0.04 | 0.68 | 23.17 | 0.0 | 0.04 | 0.03 |
| J1 | 3.30 | 208.29 | 1.0000 | +0.02 | +0.57 | −0.73 | 0.05 | 0.67 | 11.49 | 0.1 | 0.05 | 0.03 |
| OO1 | 1.90 | 295.76 | 1.0000 | −0.01 | −0.68 | −0.34 | 0.02 | 0.61 | 18.49 | 0.0 | 0.02 | 0.08 |
| OQ2 | 1.90 | 223.20 | 1.0000 | −0.01 | −0.71 | −0.43 | 0.02 | 0.25 | 7.51 | 0.1 | 0.02 | 0.03 |
| EPS2 | 4.10 | 222.57 | 1.0000 | −0.02 | −0.49 | +0.16 | 0.02 | 0.26 | 3.62 | 0.1 | 0.02 | 0.03 |
| 2N2 | 17.80 | 249.72 | 1.0000 | +0.06 | +0.32 | −0.04 | 0.06 | 0.25 | 0.81 | 0.2 | 0.06 | 0.08 |
| MU2 | 18.00 | 246.58 | 1.0000 | +0.02 | +0.12 | +0.01 | 0.02 | 0.26 | 0.83 | 0.1 | 0.02 | 0.02 |
| N2 | 137.70 | 271.77 | 1.0000 | −0.03 | −0.02 | −0.02 | 0.06 | 0.26 | 0.11 | 0.2 | 0.05 | 0.02 |
| NU2 | 26.80 | 275.65 | 1.0000 | +0.02 | +0.08 | +0.05 | 0.03 | 0.26 | 0.56 | 0.1 | 0.03 | 0.02 |
| GAM2 | 2.20 | 290.82 | 1.0000 | +0.01 | +0.61 | +0.14 | 0.02 | 0.26 | 6.67 | 0.1 | 0.02 | 0.04 |
| H1 | 2.70 | 304.09 | 1.0000 | −0.00 | −0.09 | −0.13 | 0.01 | 0.26 | 5.56 | 0.0 | 0.01 | 0.03 |
| M2 | 680.40 | 294.81 | 1.0000 | +0.05 | +0.01 | −0.01 | 0.10 | 0.26 | 0.02 | 0.3 | 0.11 | 0.11 |
| H2 | 1.50 | 117.76 | 1.0000 | +0.03 | +2.11 | +0.38 | 0.03 | 0.26 | 9.86 | 0.1 | 0.03 | 0.06 |
| MKS2 | 1.00 | 258.93 | 1.0000 | −0.02 | −2.42 | −0.97 | 0.03 | 0.27 | 15.66 | 0.1 | 0.03 | 0.04 |
| LDA2 | 5.60 | 313.69 | 1.0000 | −0.05 | −0.88 | −0.09 | 0.05 | 0.26 | 2.71 | 0.2 | 0.05 | 0.04 |
| L2 | 18.90 | 317.34 | 1.0000 | +0.01 | +0.06 | −0.07 | 0.03 | 0.26 | 0.79 | 0.1 | 0.03 | 0.01 |
| T2 | 12.60 | 326.99 | 1.0000 | −0.04 | −0.34 | −0.13 | 0.05 | 0.26 | 1.21 | 0.2 | 0.05 | 0.03 |
| S2 | 233.60 | 331.82 | 1.0000 | +0.01 | +0.01 | −0.01 | 0.05 | 0.26 | 0.06 | 0.2 | 0.05 | 0.03 |
| R2 | 1.60 | 5.03 | 1.0000 | −0.01 | −0.45 | +0.70 | 0.02 | 0.21 | 7.71 | 0.1 | 0.02 | 0.01 |
| K2 | 65.90 | 329.45 | 1.0000 | −0.03 | −0.04 | −0.03 | 0.04 | 0.27 | 0.23 | 0.1 | 0.04 | 0.02 |
| MSN2 | 1.00 | 210.75 | 1.0000 | +0.02 | +1.82 | +0.39 | 0.02 | 0.26 | 14.68 | 0.1 | 0.02 | 0.02 |
| ETA2 | 3.00 | 343.91 | 1.0000 | +0.01 | +0.40 | −0.16 | 0.02 | 0.24 | 4.62 | 0.0 | 0.02 | 0.04 |
| MO3 | 3.30 | 221.22 | 0.9997 | +0.03 | +1.07 | +0.21 | 0.04 | 0.16 | 2.69 | 0.2 | 0.04 | 0.01 |
| M3 | 2.00 | 155.84 | 0.9997 | +0.03 | +1.70 | −0.46 | 0.04 | 0.15 | 4.31 | 0.2 | 0.04 | 0.04 |
| SO3 | 1.30 | 314.99 | 0.9997 | +0.02 | +1.17 | +0.19 | 0.02 | 0.16 | 6.83 | 0.1 | 0.02 | 0.03 |
| MK3 | 1.40 | 335.49 | 0.9997 | +0.02 | +1.20 | −1.11 | 0.03 | 0.16 | 6.30 | 0.2 | 0.03 | 0.02 |
| SK3 | 2.20 | 89.09 | 0.9996 | −0.01 | −0.33 | +0.38 | 0.02 | 0.16 | 4.08 | 0.1 | 0.02 | 0.02 |
| MN4 | 5.20 | 130.65 | 0.9974 | −0.00 | −0.06 | +0.02 | 0.00 | 0.17 | 1.83 | 0.0 | 0.01 | 0.01 |
| M4 | 11.80 | 169.63 | 0.9972 | +0.00 | +0.02 | −0.13 | 0.03 | 0.17 | 0.81 | 0.2 | 0.05 | 0.06 |
| SN4 | 1.40 | 238.37 | 0.9970 | +0.02 | +1.35 | −0.07 | 0.02 | 0.17 | 6.76 | 0.1 | 0.02 | 0.03 |
| MS4 | 6.20 | 258.05 | 0.9968 | +0.00 | +0.03 | −0.09 | 0.01 | 0.17 | 1.55 | 0.1 | 0.02 | 0.02 |
| MK4 | 1.80 | 259.51 | 0.9967 | −0.02 | −0.86 | +0.78 | 0.03 | 0.17 | 5.45 | 0.1 | 0.03 | 0.02 |
| S4 | 0.60 | 108.39 | 0.9963 | +0.02 | +3.88 | +0.86 | 0.03 | 0.17 | 15.48 | 0.1 | 0.03 | 0.01 |
| 2MK5 | 2.30 | 198.84 | 0.9825 | −0.03 | −1.41 | −0.45 | 0.04 | 0.09 | 2.27 | 0.3 | 0.02 | 0.05 |
| 2SK5 | 0.30 | 124.44 | 0.9783 | −0.02 | −5.26 | +3.80 | 0.03 | 0.09 | 18.17 | 0.2 | 0.02 | 0.02 |
| 2MN6 | 2.70 | 359.69 | 0.9359 | +0.06 | +2.17 | −0.18 | 0.06 | 0.08 | 1.76 | 0.6 | 0.25 | 0.06 |
| M6 | 5.40 | 27.36 | 0.9328 | +0.00 | +0.07 | +0.00 | 0.00 | 0.08 | 0.89 | 0.0 | 0.39 | 0.02 |
| 2MS6 | 6.30 | 82.35 | 0.9267 | +0.00 | +0.06 | +0.06 | 0.01 | 0.08 | 0.77 | 0.1 | 0.50 | 0.02 |
| 2MK6 | 1.80 | 81.74 | 0.9262 | −0.02 | −1.12 | −0.49 | 0.03 | 0.09 | 2.79 | 0.2 | 0.12 | 0.03 |
| 2SM6 | 1.70 | 137.91 | 0.9203 | +0.03 | +1.86 | +0.14 | 0.03 | 0.08 | 2.80 | 0.3 | 0.18 | 0.02 |
| MSK6 | 1.10 | 141.98 | 0.9197 | −0.01 | −1.01 | −0.13 | 0.01 | 0.09 | 4.51 | 0.1 | 0.08 | 0.01 |
| 3MK7 | 0.40 | 160.05 | 0.7948 | +0.03 | +7.53 | +0.02 | 0.03 | 0.07 | 9.76 | 0.3 | 0.14 | 0.04 |
| M8 | 0.70 | 10.41 | 0.5815 | +0.05 | +7.29 | −0.93 | 0.05 | 0.02 | 1.68 | 0.9 | 0.59 | 0.04 |

### Måløy (`kartverket/MAY`)

2006-01-01 to 2020-12-31: 131,384 hourly values. SA over 1991 to 2020 is 132.9 mm at 319.0°, 1.1 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 132.40 | 319.45 | 1.0000 | +7.80 | +5.89 | −4.82 | 13.87 | 11.02 | 4.50 | **1.1** | 13.87 | 14.14 |
| MM | 26.10 | 179.11 | 1.0000 | −0.05 | −0.19 | +0.04 | 0.05 | 11.02 | 24.24 | 0.0 | 0.05 | 0.17 |
| MF | 19.60 | 192.49 | 1.0000 | −0.09 | −0.43 | +0.01 | 0.09 | 11.02 | 32.35 | 0.0 | 0.09 | 0.02 |
| 2Q1 | 3.50 | 269.98 | 1.0000 | −0.09 | −2.55 | −0.18 | 0.09 | 0.84 | 14.03 | 0.1 | 0.09 | 0.05 |
| SIG1 | 2.40 | 233.04 | 1.0000 | +0.03 | +1.26 | +0.05 | 0.03 | 0.85 | 20.04 | 0.0 | 0.03 | 0.10 |
| Q1 | 17.00 | 307.75 | 1.0000 | +0.01 | +0.07 | −0.07 | 0.02 | 0.85 | 2.84 | 0.0 | 0.02 | 0.05 |
| RHO1 | 3.70 | 321.17 | 1.0000 | −0.03 | −0.67 | −0.15 | 0.03 | 0.86 | 13.34 | 0.0 | 0.03 | 0.08 |
| O1 | 49.60 | 3.93 | 1.0000 | −0.01 | −0.02 | −0.03 | 0.03 | 0.85 | 0.98 | 0.0 | 0.03 | 0.03 |
| NO1 | 2.70 | 90.39 | 1.0000 | −0.02 | −0.82 | −0.66 | 0.04 | 0.76 | 16.31 | 0.0 | 0.04 | 0.09 |
| PI1 | 1.10 | 113.04 | 1.0000 | +0.03 | +2.68 | +1.47 | 0.04 | 0.84 | 42.55 | 0.0 | 0.04 | 0.04 |
| P1 | 13.00 | 138.82 | 1.0000 | +0.03 | +0.25 | +0.16 | 0.05 | 0.84 | 3.69 | 0.0 | 0.05 | 0.05 |
| S1 | 7.60 | 260.51 | 1.0000 | +0.00 | +0.05 | −0.04 | 0.01 | 1.19 | 8.98 | 0.0 | 0.01 | 0.03 |
| K1 | 48.80 | 151.79 | 1.0000 | +0.02 | +0.03 | +0.05 | 0.04 | 0.85 | 1.00 | 0.0 | 0.04 | 0.06 |
| PHI1 | 1.80 | 143.06 | 1.0000 | +0.00 | +0.07 | +0.54 | 0.02 | 0.84 | 26.73 | 0.0 | 0.02 | 0.02 |
| J1 | 2.40 | 184.06 | 1.0000 | +0.11 | +4.44 | +0.67 | 0.11 | 0.83 | 18.88 | 0.1 | 0.11 | 0.09 |
| OO1 | 1.40 | 281.84 | 1.0000 | +0.01 | +0.38 | −1.13 | 0.03 | 0.76 | 30.78 | 0.0 | 0.03 | 0.08 |
| OQ2 | 1.60 | 214.27 | 1.0000 | −0.01 | −0.51 | −1.77 | 0.05 | 0.23 | 8.33 | 0.2 | 0.05 | 0.03 |
| EPS2 | 3.20 | 219.96 | 1.0000 | −0.03 | −0.92 | +0.09 | 0.03 | 0.24 | 4.36 | 0.1 | 0.03 | 0.08 |
| 2N2 | 15.20 | 241.01 | 1.0000 | −0.04 | −0.26 | +0.11 | 0.05 | 0.24 | 0.90 | 0.2 | 0.05 | 0.04 |
| MU2 | 14.50 | 243.36 | 1.0000 | +0.04 | +0.26 | −0.12 | 0.05 | 0.24 | 0.96 | 0.1 | 0.05 | 0.04 |
| N2 | 117.30 | 262.62 | 1.0000 | +0.06 | +0.05 | −0.02 | 0.07 | 0.25 | 0.12 | 0.2 | 0.07 | 0.03 |
| NU2 | 23.20 | 265.74 | 1.0000 | −0.03 | −0.14 | −0.10 | 0.05 | 0.24 | 0.61 | 0.2 | 0.05 | 0.06 |
| GAM2 | 1.70 | 280.17 | 1.0000 | +0.05 | +2.71 | +0.85 | 0.05 | 0.24 | 7.90 | 0.2 | 0.05 | 0.06 |
| H1 | 3.30 | 284.46 | 1.0000 | −0.07 | −2.01 | −0.84 | 0.08 | 0.24 | 4.33 | 0.3 | 0.08 | 0.03 |
| M2 | 582.90 | 285.64 | 1.0000 | +0.01 | +0.00 | −0.02 | 0.15 | 0.25 | 0.02 | 0.6 | 0.15 | 0.14 |
| H2 | 2.00 | 94.16 | 1.0000 | +0.02 | +0.88 | −1.28 | 0.05 | 0.25 | 7.00 | 0.2 | 0.05 | 0.03 |
| MKS2 | 0.60 | 266.02 | 1.0000 | +0.07 | +10.97 | +1.59 | 0.07 | 0.25 | 21.44 | 0.3 | 0.07 | 0.06 |
| LDA2 | 5.20 | 303.22 | 1.0000 | +0.03 | +0.63 | −0.15 | 0.03 | 0.24 | 2.69 | 0.1 | 0.03 | 0.03 |
| L2 | 16.90 | 307.33 | 1.0000 | +0.03 | +0.18 | +0.01 | 0.03 | 0.24 | 0.82 | 0.1 | 0.03 | 0.02 |
| T2 | 10.60 | 318.58 | 1.0000 | −0.03 | −0.27 | −0.07 | 0.03 | 0.25 | 1.34 | 0.1 | 0.03 | 0.02 |
| S2 | 199.10 | 323.00 | 1.0000 | −0.01 | −0.00 | −0.01 | 0.05 | 0.25 | 0.07 | 0.2 | 0.05 | 0.05 |
| R2 | 1.60 | 353.37 | 1.0000 | −0.02 | −1.30 | +0.90 | 0.03 | 0.20 | 7.26 | 0.1 | 0.03 | 0.03 |
| K2 | 56.40 | 320.61 | 1.0000 | −0.03 | −0.04 | −0.03 | 0.04 | 0.25 | 0.25 | 0.1 | 0.04 | 0.03 |
| MSN2 | 1.10 | 199.56 | 1.0000 | −0.03 | −2.85 | +1.93 | 0.05 | 0.24 | 13.07 | 0.1 | 0.05 | 0.03 |
| ETA2 | 2.50 | 333.95 | 1.0000 | +0.02 | +0.85 | −0.24 | 0.02 | 0.23 | 5.16 | 0.1 | 0.02 | 0.03 |
| MO3 | 2.80 | 202.69 | 0.9997 | +0.05 | +1.84 | −0.14 | 0.05 | 0.14 | 2.75 | 0.4 | 0.05 | 0.03 |
| M3 | 2.20 | 172.81 | 0.9997 | −0.02 | −0.89 | +0.78 | 0.04 | 0.13 | 3.51 | 0.2 | 0.03 | 0.02 |
| SO3 | 1.30 | 303.42 | 0.9997 | −0.05 | −3.61 | +0.65 | 0.05 | 0.14 | 6.26 | 0.3 | 0.05 | 0.02 |
| MK3 | 1.70 | 329.28 | 0.9997 | +0.05 | +2.75 | +1.32 | 0.06 | 0.14 | 4.46 | 0.3 | 0.06 | 0.02 |
| SK3 | 1.60 | 73.74 | 0.9996 | −0.00 | −0.12 | −0.84 | 0.02 | 0.14 | 4.89 | 0.2 | 0.02 | 0.01 |
| MN4 | 1.80 | 79.92 | 0.9974 | −0.06 | −3.12 | −0.80 | 0.06 | 0.12 | 4.01 | 0.4 | 0.06 | 0.03 |
| M4 | 2.30 | 146.32 | 0.9972 | −0.03 | −1.46 | −0.75 | 0.05 | 0.12 | 3.08 | 0.3 | 0.04 | 0.03 |
| SN4 | 0.60 | 143.14 | 0.9970 | −0.03 | −4.13 | −0.43 | 0.03 | 0.12 | 12.26 | 0.2 | 0.02 | 0.01 |
| MS4 | 1.40 | 7.09 | 0.9968 | +0.00 | +0.11 | +0.62 | 0.02 | 0.12 | 5.03 | 0.1 | 0.02 | 0.02 |
| MK4 | 0.50 | 15.15 | 0.9967 | +0.05 | +10.85 | −0.50 | 0.05 | 0.12 | 12.90 | 0.4 | 0.06 | 0.03 |
| S4 | 0.70 | 128.77 | 0.9963 | +0.04 | +5.58 | +1.16 | 0.04 | 0.12 | 9.60 | 0.3 | 0.04 | 0.03 |
| SK4 | 0.30 | 159.24 | 0.9963 | +0.06 | +18.77 | +2.04 | 0.06 | 0.12 | 19.98 | 0.4 | 0.06 | 0.03 |
| 2MK5 | 1.10 | 117.59 | 0.9825 | −0.03 | −2.27 | −0.70 | 0.03 | 0.07 | 3.83 | 0.3 | 0.02 | 0.03 |
| 2MN6 | 2.50 | 274.88 | 0.9359 | +0.02 | +0.92 | −0.62 | 0.04 | 0.10 | 2.16 | 0.3 | 0.20 | 0.03 |
| M6 | 5.40 | 308.38 | 0.9328 | −0.04 | −0.76 | +0.18 | 0.04 | 0.10 | 1.01 | 0.4 | 0.35 | 0.01 |
| 2MS6 | 7.30 | 10.21 | 0.9267 | +0.03 | +0.42 | +0.10 | 0.03 | 0.10 | 0.74 | 0.3 | 0.61 | 0.09 |
| 2MK6 | 2.20 | 10.74 | 0.9262 | +0.00 | +0.14 | −0.27 | 0.01 | 0.10 | 2.53 | 0.1 | 0.18 | 0.02 |
| 2SM6 | 2.40 | 72.93 | 0.9203 | −0.02 | −0.69 | +0.35 | 0.02 | 0.10 | 2.29 | 0.2 | 0.19 | 0.01 |
| MSK6 | 1.50 | 74.58 | 0.9197 | −0.03 | −1.81 | +0.56 | 0.03 | 0.10 | 3.76 | 0.2 | 0.10 | 0.03 |
| 3MK7 | 0.20 | 21.98 | 0.7948 | +0.03 | +15.49 | +0.89 | 0.03 | 0.05 | 12.81 | 0.4 | 0.09 | 0.04 |
| M8 | 0.30 | 244.60 | 0.5815 | −0.04 | −14.49 | +1.59 | 0.04 | 0.03 | 6.12 | 0.8 | 0.14 | 0.03 |

### Mausund (`kartverket/MSU`)

2010-10-20 to 2020-12-31: 89,284 hourly values.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 134.80 | 324.98 | 1.0000 | +4.02 | +2.98 | −4.53 | 11.53 | 13.25 | 5.55 | 0.8 | 11.53 | 11.36 |
| MM | 28.30 | 184.27 | 1.0000 | +0.04 | +0.13 | −0.00 | 0.04 | 13.34 | 26.99 | 0.0 | 0.04 | 0.39 |
| MF | 14.50 | 189.21 | 1.0000 | −0.04 | −0.26 | +0.20 | 0.06 | 13.34 | 52.86 | 0.0 | 0.06 | 0.33 |
| 2Q1 | 3.70 | 285.96 | 1.0000 | −0.02 | −0.48 | −0.27 | 0.03 | 0.77 | 12.01 | 0.0 | 0.03 | 0.09 |
| SIG1 | 5.00 | 296.88 | 1.0000 | −0.02 | −0.40 | −0.48 | 0.05 | 0.77 | 8.90 | 0.1 | 0.05 | 0.06 |
| Q1 | 19.40 | 338.91 | 1.0000 | +0.04 | +0.21 | −0.01 | 0.04 | 0.77 | 2.28 | 0.1 | 0.04 | 0.04 |
| RHO1 | 3.90 | 350.13 | 1.0000 | +0.02 | +0.60 | +0.06 | 0.02 | 0.78 | 11.33 | 0.0 | 0.02 | 0.03 |
| O1 | 51.10 | 36.43 | 1.0000 | +0.00 | +0.00 | +0.01 | 0.01 | 0.77 | 0.87 | 0.0 | 0.01 | 0.07 |
| NO1 | 3.90 | 129.20 | 1.0000 | +0.01 | +0.34 | −0.00 | 0.01 | 0.66 | 9.69 | 0.0 | 0.01 | 0.04 |
| PI1 | 1.40 | 128.73 | 1.0000 | −0.02 | −1.16 | +0.42 | 0.02 | 0.70 | 28.87 | 0.0 | 0.02 | 0.04 |
| P1 | 18.80 | 149.73 | 1.0000 | −0.02 | −0.12 | +0.01 | 0.02 | 0.70 | 2.12 | 0.0 | 0.02 | 0.03 |
| S1 | 5.80 | 282.55 | 1.0000 | −0.03 | −0.58 | +0.09 | 0.03 | 0.98 | 9.71 | 0.0 | 0.03 | 0.02 |
| K1 | 64.90 | 163.50 | 1.0000 | −0.07 | −0.11 | +0.00 | 0.07 | 0.74 | 0.66 | 0.1 | 0.07 | 0.08 |
| PHI1 | 1.90 | 191.68 | 1.0000 | +0.00 | +0.09 | +0.30 | 0.01 | 0.69 | 20.74 | 0.0 | 0.01 | 0.03 |
| J1 | 3.40 | 210.12 | 1.0000 | +0.02 | +0.71 | +0.11 | 0.03 | 0.76 | 12.71 | 0.0 | 0.03 | 0.03 |
| OO1 | 1.40 | 296.58 | 1.0000 | +0.03 | +1.79 | −0.92 | 0.03 | 0.89 | 35.62 | 0.0 | 0.03 | 0.03 |
| OQ2 | 2.20 | 231.59 | 1.0000 | −0.04 | −1.69 | +0.29 | 0.04 | 0.30 | 8.09 | 0.1 | 0.04 | 0.03 |
| EPS2 | 4.50 | 231.56 | 1.0000 | +0.06 | +1.25 | −0.04 | 0.06 | 0.31 | 3.92 | 0.2 | 0.06 | 0.06 |
| 2N2 | 20.20 | 254.75 | 1.0000 | +0.01 | +0.05 | +0.01 | 0.01 | 0.31 | 0.88 | 0.0 | 0.01 | 0.02 |
| MU2 | 20.00 | 254.49 | 1.0000 | +0.07 | +0.35 | +0.02 | 0.07 | 0.31 | 0.89 | 0.2 | 0.07 | 0.05 |
| N2 | 149.50 | 278.02 | 1.0000 | −0.03 | −0.02 | −0.01 | 0.04 | 0.31 | 0.12 | 0.1 | 0.04 | 0.06 |
| NU2 | 29.20 | 282.14 | 1.0000 | −0.01 | −0.03 | +0.01 | 0.01 | 0.31 | 0.61 | 0.0 | 0.01 | 0.02 |
| GAM2 | 2.10 | 294.55 | 1.0000 | +0.00 | +0.07 | −0.12 | 0.01 | 0.31 | 8.55 | 0.0 | 0.01 | 0.02 |
| H1 | 4.00 | 289.34 | 1.0000 | +0.03 | +0.74 | −0.15 | 0.03 | 0.31 | 4.48 | 0.1 | 0.03 | 0.02 |
| M2 | 737.20 | 301.23 | 1.0000 | −0.05 | −0.01 | −0.01 | 0.18 | 0.31 | 0.02 | 0.5 | 0.17 | 0.18 |
| H2 | 2.70 | 135.30 | 1.0000 | −0.04 | −1.56 | −0.35 | 0.05 | 0.32 | 6.80 | 0.1 | 0.05 | 0.04 |
| MKS2 | 1.70 | 271.28 | 1.0000 | −0.02 | −1.37 | +0.30 | 0.03 | 0.36 | 12.41 | 0.1 | 0.03 | 0.02 |
| LDA2 | 5.90 | 317.40 | 1.0000 | +0.01 | +0.17 | +0.04 | 0.01 | 0.31 | 3.02 | 0.0 | 0.01 | 0.01 |
| L2 | 20.00 | 324.21 | 1.0000 | −0.02 | −0.09 | −0.09 | 0.03 | 0.31 | 0.90 | 0.1 | 0.03 | 0.03 |
| T2 | 13.30 | 335.73 | 1.0000 | +0.02 | +0.18 | −0.05 | 0.03 | 0.32 | 1.37 | 0.1 | 0.03 | 0.05 |
| S2 | 252.70 | 338.72 | 1.0000 | +0.05 | +0.02 | −0.01 | 0.06 | 0.32 | 0.07 | 0.2 | 0.07 | 0.07 |
| R2 | 2.30 | 15.20 | 1.0000 | −0.03 | −1.42 | −0.44 | 0.04 | 0.26 | 6.51 | 0.1 | 0.04 | 0.02 |
| K2 | 71.40 | 336.55 | 1.0000 | +0.02 | +0.02 | +0.00 | 0.02 | 0.37 | 0.30 | 0.0 | 0.02 | 0.03 |
| MSN2 | 0.90 | 213.09 | 1.0000 | +0.00 | +0.37 | −0.83 | 0.01 | 0.31 | 19.42 | 0.0 | 0.01 | 0.02 |
| ETA2 | 3.30 | 358.72 | 1.0000 | −0.01 | −0.24 | −0.63 | 0.04 | 0.38 | 6.70 | 0.1 | 0.04 | 0.02 |
| MO3 | 3.80 | 234.94 | 0.9997 | +0.05 | +1.22 | −0.21 | 0.05 | 0.19 | 2.88 | 0.2 | 0.05 | 0.04 |
| M3 | 2.00 | 167.04 | 0.9997 | +0.02 | +1.14 | −0.70 | 0.03 | 0.17 | 4.89 | 0.1 | 0.03 | 0.03 |
| SO3 | 1.70 | 320.55 | 0.9997 | +0.03 | +1.63 | −0.02 | 0.03 | 0.20 | 6.54 | 0.1 | 0.03 | 0.01 |
| MK3 | 1.30 | 347.50 | 0.9997 | +0.02 | +1.68 | +0.16 | 0.02 | 0.19 | 8.05 | 0.1 | 0.02 | 0.04 |
| SK3 | 2.70 | 96.85 | 0.9996 | −0.06 | −2.05 | +0.29 | 0.06 | 0.19 | 4.11 | 0.3 | 0.06 | 0.03 |
| MN4 | 6.60 | 157.38 | 0.9974 | +0.01 | +0.07 | −0.26 | 0.03 | 0.19 | 1.61 | 0.2 | 0.04 | 0.03 |
| M4 | 15.10 | 194.66 | 0.9972 | +0.04 | +0.24 | −0.08 | 0.04 | 0.19 | 0.70 | 0.2 | 0.08 | 0.04 |
| SN4 | 1.70 | 269.52 | 0.9970 | +0.03 | +1.90 | −0.19 | 0.03 | 0.19 | 6.30 | 0.2 | 0.04 | 0.02 |
| MS4 | 7.90 | 283.14 | 0.9968 | +0.05 | +0.57 | −0.13 | 0.05 | 0.19 | 1.37 | 0.2 | 0.07 | 0.04 |
| MK4 | 2.30 | 283.73 | 0.9967 | +0.03 | +1.34 | +0.03 | 0.03 | 0.22 | 5.43 | 0.1 | 0.04 | 0.03 |
| S4 | 0.70 | 137.35 | 0.9963 | +0.02 | +3.42 | −1.73 | 0.03 | 0.19 | 15.41 | 0.1 | 0.03 | 0.04 |
| 2MK5 | 1.90 | 230.98 | 0.9825 | −0.02 | −0.90 | +0.02 | 0.02 | 0.09 | 2.88 | 0.2 | 0.02 | 0.03 |
| 2SK5 | 0.30 | 126.16 | 0.9783 | −0.04 | −12.85 | −0.15 | 0.04 | 0.10 | 21.55 | 0.3 | 0.03 | 0.05 |
| 2MN6 | 2.50 | 69.14 | 0.9359 | −0.05 | −1.91 | −0.14 | 0.05 | 0.07 | 1.64 | 0.6 | 0.12 | 0.03 |
| M6 | 4.40 | 99.26 | 0.9328 | −0.01 | −0.30 | +0.12 | 0.02 | 0.07 | 0.91 | 0.2 | 0.30 | 0.02 |
| 2MS6 | 4.10 | 151.53 | 0.9267 | +0.04 | +0.90 | −0.43 | 0.05 | 0.07 | 0.99 | 0.4 | 0.36 | 0.04 |
| 2MK6 | 1.10 | 149.84 | 0.9262 | +0.04 | +3.81 | +0.14 | 0.04 | 0.08 | 4.15 | 0.4 | 0.13 | 0.05 |
| 2SM6 | 0.90 | 193.48 | 0.9203 | +0.05 | +5.08 | +0.60 | 0.05 | 0.07 | 4.39 | 0.5 | 0.13 | 0.03 |
| MSK6 | 0.60 | 196.03 | 0.9197 | +0.00 | +0.09 | +1.45 | 0.02 | 0.08 | 8.00 | 0.2 | 0.06 | 0.01 |
| 3MK7 | 0.20 | 156.26 | 0.7948 | −0.04 | −21.59 | −2.55 | 0.04 | 0.05 | 18.68 | 0.6 | 0.01 | 0.04 |
| M8 | 0.30 | 346.50 | 0.5815 | +0.03 | +9.47 | −0.18 | 0.03 | 0.02 | 3.23 | 0.5 | 0.27 | 0.03 |

### Narvik (`kartverket/NVK`)

2006-01-01 to 2020-12-31: 130,414 hourly values. SA over 1991 to 2020 is 144.4 mm at 331.3°, 0.4 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 144.10 | 331.18 | 1.0000 | +2.37 | +1.64 | −3.30 | 8.69 | 12.52 | 4.86 | 0.7 | 8.69 | 8.96 |
| SSA | 20.00 | 146.32 | 1.0000 | −0.04 | −0.21 | +0.01 | 0.04 | 12.50 | 35.72 | 0.0 | 0.04 | 0.13 |
| MM | 26.20 | 175.25 | 1.0000 | 0.00 | −0.00 | −0.02 | 0.01 | 12.47 | 27.28 | 0.0 | 0.01 | 0.47 |
| MF | 17.50 | 184.66 | 1.0000 | +0.04 | +0.25 | −0.12 | 0.06 | 12.47 | 40.73 | 0.0 | 0.06 | 0.62 |
| ALP1 | 2.00 | 256.52 | 1.0000 | +0.00 | +0.16 | −0.46 | 0.02 | 0.89 | 25.40 | 0.0 | 0.02 | 0.04 |
| 2Q1 | 3.40 | 302.24 | 1.0000 | +0.05 | +1.45 | −0.03 | 0.05 | 0.88 | 14.58 | 0.1 | 0.05 | 0.06 |
| SIG1 | 5.10 | 310.49 | 1.0000 | −0.02 | −0.46 | −0.21 | 0.03 | 0.90 | 10.10 | 0.0 | 0.03 | 0.04 |
| Q1 | 17.00 | 342.98 | 1.0000 | +0.01 | +0.06 | −0.10 | 0.03 | 0.89 | 2.99 | 0.0 | 0.03 | 0.03 |
| RHO1 | 3.10 | 359.99 | 1.0000 | +0.01 | +0.31 | +0.00 | 0.01 | 0.90 | 16.61 | 0.0 | 0.01 | 0.10 |
| O1 | 33.60 | 43.76 | 1.0000 | +0.05 | +0.14 | −0.04 | 0.05 | 0.90 | 1.53 | 0.1 | 0.05 | 0.06 |
| NO1 | 3.70 | 160.34 | 1.0000 | +0.06 | +1.71 | +0.04 | 0.06 | 0.80 | 12.20 | 0.1 | 0.06 | 0.10 |
| PI1 | 2.10 | 179.35 | 1.0000 | +0.03 | +1.50 | −0.50 | 0.04 | 0.88 | 23.75 | 0.0 | 0.04 | 0.02 |
| P1 | 30.30 | 188.18 | 1.0000 | −0.05 | −0.15 | −0.06 | 0.05 | 0.88 | 1.67 | 0.1 | 0.05 | 0.05 |
| S1 | 9.40 | 282.36 | 1.0000 | −0.06 | −0.65 | +0.01 | 0.06 | 1.26 | 7.70 | 0.0 | 0.06 | 0.11 |
| K1 | 112.00 | 197.06 | 1.0000 | −0.01 | −0.01 | −0.01 | 0.03 | 0.89 | 0.46 | 0.0 | 0.03 | 0.03 |
| J1 | 6.50 | 230.65 | 1.0000 | +0.07 | +1.08 | −0.02 | 0.07 | 0.87 | 7.56 | 0.1 | 0.07 | 0.06 |
| SO1 | 1.20 | 160.18 | 1.0000 | −0.01 | −1.03 | +0.34 | 0.01 | 0.90 | 43.29 | 0.0 | 0.01 | 0.06 |
| OO1 | 3.00 | 296.25 | 1.0000 | +0.01 | +0.25 | +0.15 | 0.01 | 0.80 | 15.16 | 0.0 | 0.01 | 0.01 |
| OQ2 | 2.80 | 261.86 | 1.0000 | +0.03 | +0.89 | +0.13 | 0.03 | 0.37 | 7.46 | 0.1 | 0.03 | 0.03 |
| EPS2 | 6.90 | 261.90 | 1.0000 | +0.04 | +0.63 | +0.06 | 0.04 | 0.38 | 3.17 | 0.1 | 0.04 | 0.03 |
| 2N2 | 26.80 | 287.45 | 1.0000 | −0.01 | −0.05 | +0.02 | 0.02 | 0.38 | 0.81 | 0.0 | 0.02 | 0.01 |
| MU2 | 30.50 | 285.87 | 1.0000 | +0.06 | +0.19 | −0.01 | 0.06 | 0.39 | 0.73 | 0.1 | 0.06 | 0.04 |
| N2 | 203.70 | 310.82 | 1.0000 | +0.01 | +0.01 | −0.01 | 0.02 | 0.39 | 0.11 | 0.0 | 0.02 | 0.01 |
| NU2 | 39.30 | 314.97 | 1.0000 | +0.02 | +0.06 | −0.01 | 0.03 | 0.39 | 0.57 | 0.1 | 0.03 | 0.01 |
| GAM2 | 2.80 | 324.28 | 1.0000 | +0.05 | +1.68 | −0.35 | 0.05 | 0.38 | 7.73 | 0.1 | 0.05 | 0.04 |
| H1 | 3.70 | 347.70 | 1.0000 | −0.05 | −1.23 | +0.11 | 0.05 | 0.39 | 6.13 | 0.1 | 0.05 | 0.06 |
| M2 | 1001.80 | 334.69 | 1.0000 | +0.04 | +0.00 | −0.01 | 0.16 | 0.39 | 0.02 | 0.4 | 0.17 | 0.17 |
| MKS2 | 2.50 | 308.29 | 1.0000 | −0.00 | −0.15 | −0.19 | 0.01 | 0.40 | 9.14 | 0.0 | 0.01 | 0.02 |
| LDA2 | 6.80 | 355.09 | 1.0000 | +0.02 | +0.26 | +0.07 | 0.02 | 0.39 | 3.29 | 0.0 | 0.02 | 0.03 |
| L2 | 26.10 | 357.07 | 1.0000 | −0.01 | −0.02 | −0.05 | 0.02 | 0.39 | 0.85 | 0.1 | 0.02 | 0.03 |
| T2 | 19.00 | 10.18 | 1.0000 | −0.01 | −0.07 | −0.08 | 0.03 | 0.39 | 1.19 | 0.1 | 0.03 | 0.05 |
| S2 | 353.60 | 14.12 | 1.0000 | +0.04 | +0.01 | −0.01 | 0.07 | 0.39 | 0.06 | 0.2 | 0.08 | 0.08 |
| R2 | 2.20 | 42.88 | 1.0000 | −0.05 | −2.37 | −0.00 | 0.05 | 0.32 | 8.54 | 0.2 | 0.05 | 0.04 |
| K2 | 99.80 | 11.76 | 1.0000 | +0.02 | +0.02 | −0.01 | 0.03 | 0.40 | 0.23 | 0.1 | 0.03 | 0.01 |
| MSN2 | 0.70 | 277.94 | 1.0000 | −0.03 | −3.99 | −0.59 | 0.03 | 0.39 | 33.22 | 0.1 | 0.03 | 0.05 |
| ETA2 | 4.60 | 31.01 | 1.0000 | −0.01 | −0.12 | +0.04 | 0.01 | 0.36 | 4.51 | 0.0 | 0.01 | 0.01 |
| MO3 | 6.80 | 284.12 | 0.9997 | +0.01 | +0.18 | −0.03 | 0.01 | 0.27 | 2.23 | 0.0 | 0.02 | 0.03 |
| M3 | 1.50 | 257.53 | 0.9997 | +0.04 | +2.42 | −0.95 | 0.04 | 0.26 | 9.67 | 0.1 | 0.05 | 0.03 |
| SO3 | 2.30 | 8.46 | 0.9997 | −0.05 | −2.28 | −0.19 | 0.05 | 0.27 | 6.77 | 0.2 | 0.05 | 0.06 |
| MK3 | 1.50 | 74.57 | 0.9997 | +0.02 | +1.62 | −0.43 | 0.03 | 0.26 | 9.91 | 0.1 | 0.03 | 0.05 |
| SK3 | 5.40 | 154.17 | 0.9996 | −0.04 | −0.80 | +0.07 | 0.04 | 0.26 | 2.83 | 0.2 | 0.04 | 0.04 |
| MN4 | 23.40 | 243.60 | 0.9974 | +0.05 | +0.23 | −0.02 | 0.05 | 0.87 | 2.13 | 0.1 | 0.12 | 0.08 |
| M4 | 51.80 | 281.05 | 0.9972 | +0.04 | +0.07 | −0.01 | 0.04 | 0.87 | 0.97 | 0.0 | 0.18 | 0.10 |
| SN4 | 7.70 | 2.81 | 0.9970 | −0.03 | −0.34 | +0.01 | 0.03 | 0.88 | 6.58 | 0.0 | 0.00 | 0.01 |
| MS4 | 29.40 | 13.56 | 0.9968 | −0.03 | −0.11 | +0.01 | 0.03 | 0.88 | 1.72 | 0.0 | 0.06 | 0.03 |
| MK4 | 7.90 | 18.31 | 0.9967 | +0.03 | +0.34 | +0.07 | 0.03 | 0.89 | 6.46 | 0.0 | 0.05 | 0.03 |
| S4 | 3.70 | 217.70 | 0.9963 | +0.05 | +1.46 | −0.24 | 0.06 | 0.89 | 13.53 | 0.1 | 0.07 | 0.00 |
| SK4 | 0.80 | 245.86 | 0.9963 | −0.02 | −2.30 | +1.27 | 0.03 | 0.89 | 65.22 | 0.0 | 0.02 | 0.02 |
| 2MK5 | 6.50 | 64.90 | 0.9825 | −0.03 | −0.41 | −0.04 | 0.03 | 0.31 | 2.71 | 0.1 | 0.09 | 0.04 |
| 2SK5 | 0.60 | 334.82 | 0.9783 | +0.06 | +10.23 | +0.00 | 0.06 | 0.31 | 26.60 | 0.2 | 0.08 | 0.04 |
| 2MN6 | 6.50 | 314.09 | 0.9359 | +0.06 | +0.90 | +0.00 | 0.06 | 0.16 | 1.41 | 0.3 | 0.51 | 0.07 |
| M6 | 11.60 | 351.40 | 0.9328 | −0.01 | −0.09 | +0.05 | 0.01 | 0.16 | 0.80 | 0.1 | 0.82 | 0.04 |
| 2MS6 | 10.10 | 64.94 | 0.9267 | +0.03 | +0.31 | −0.06 | 0.03 | 0.16 | 0.91 | 0.2 | 0.83 | 0.07 |
| 2MK6 | 2.90 | 70.01 | 0.9262 | +0.01 | +0.21 | −0.42 | 0.02 | 0.16 | 3.26 | 0.1 | 0.24 | 0.02 |
| 2SM6 | 2.00 | 147.69 | 0.9203 | −0.02 | −1.00 | −0.13 | 0.02 | 0.16 | 4.68 | 0.1 | 0.15 | 0.01 |
| MSK6 | 1.20 | 151.67 | 0.9197 | +0.06 | +4.75 | −0.54 | 0.06 | 0.16 | 7.47 | 0.3 | 0.17 | 0.05 |
| 3MK7 | 0.30 | 205.44 | 0.7948 | −0.04 | −12.11 | +2.54 | 0.04 | 0.10 | 22.22 | 0.3 | 0.03 | 0.01 |
| M8 | 1.70 | 279.36 | 0.5815 | +0.00 | +0.20 | +0.08 | 0.00 | 0.07 | 2.33 | 0.0 | 1.23 | 0.01 |

### Ny-Ålesund (`kartverket/NYA`)

2006-01-01 to 2020-12-31: 131,232 hourly values.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 87.60 | 307.70 | 1.0000 | +5.52 | +6.30 | −3.61 | 7.93 | 7.02 | 4.32 | 0.8 | 7.93 | 7.51 |
| SSA | 17.90 | 221.95 | 1.0000 | −0.04 | −0.22 | +0.09 | 0.05 | 7.02 | 22.51 | 0.0 | 0.05 | 0.41 |
| MM | 17.90 | 188.90 | 1.0000 | −0.03 | −0.20 | −0.22 | 0.08 | 7.02 | 22.51 | 0.0 | 0.08 | 0.38 |
| MF | 14.60 | 190.39 | 1.0000 | −0.03 | −0.23 | +0.00 | 0.03 | 7.02 | 27.60 | 0.0 | 0.03 | 0.37 |
| ALP1 | 1.20 | 298.71 | 1.0000 | +0.08 | +6.55 | −0.36 | 0.08 | 0.40 | 18.09 | 0.2 | 0.08 | 0.04 |
| 2Q1 | 2.90 | 324.44 | 1.0000 | +0.06 | +2.04 | −0.40 | 0.06 | 0.40 | 7.72 | 0.1 | 0.06 | 0.10 |
| SIG1 | 3.40 | 329.13 | 1.0000 | +0.02 | +0.43 | +0.45 | 0.03 | 0.41 | 6.83 | 0.1 | 0.03 | 0.02 |
| Q1 | 11.80 | 14.74 | 1.0000 | +0.05 | +0.44 | +0.05 | 0.05 | 0.40 | 1.95 | 0.1 | 0.05 | 0.05 |
| RHO1 | 2.20 | 23.64 | 1.0000 | −0.04 | −1.66 | +0.49 | 0.04 | 0.41 | 10.86 | 0.1 | 0.04 | 0.03 |
| O1 | 22.10 | 91.03 | 1.0000 | +0.01 | +0.06 | −0.02 | 0.02 | 0.41 | 1.06 | 0.0 | 0.02 | 0.10 |
| TAU1 | 0.90 | 251.18 | 1.0000 | −0.01 | −0.91 | −0.39 | 0.01 | 0.38 | 24.37 | 0.0 | 0.01 | 0.07 |
| NO1 | 2.70 | 210.85 | 1.0000 | +0.01 | +0.37 | +0.10 | 0.01 | 0.36 | 7.65 | 0.0 | 0.01 | 0.03 |
| PI1 | 0.80 | 248.41 | 1.0000 | +0.02 | +2.62 | +1.47 | 0.03 | 0.40 | 28.05 | 0.1 | 0.03 | 0.05 |
| P1 | 17.40 | 244.81 | 1.0000 | +0.04 | +0.24 | −0.00 | 0.04 | 0.40 | 1.32 | 0.1 | 0.04 | 0.02 |
| S1 | 7.40 | 346.38 | 1.0000 | −0.06 | −0.86 | −0.14 | 0.07 | 0.57 | 4.46 | 0.1 | 0.07 | 0.06 |
| K1 | 62.80 | 248.79 | 1.0000 | +0.03 | +0.05 | −0.04 | 0.05 | 0.41 | 0.37 | 0.1 | 0.05 | 0.08 |
| PSI1 | 2.70 | 72.30 | 1.0000 | +0.03 | +0.97 | −0.49 | 0.03 | 0.40 | 8.48 | 0.1 | 0.03 | 0.03 |
| J1 | 3.20 | 275.80 | 1.0000 | +0.05 | +1.46 | +0.08 | 0.05 | 0.39 | 6.94 | 0.1 | 0.05 | 0.06 |
| SO1 | 0.70 | 200.66 | 1.0000 | −0.06 | −7.91 | −0.71 | 0.06 | 0.41 | 36.28 | 0.1 | 0.06 | 0.06 |
| OO1 | 1.40 | 330.71 | 1.0000 | +0.04 | +2.84 | +0.38 | 0.04 | 0.36 | 14.41 | 0.1 | 0.04 | 0.04 |
| OQ2 | 1.20 | 288.13 | 1.0000 | −0.04 | −3.56 | +0.83 | 0.05 | 0.14 | 7.18 | 0.3 | 0.05 | 0.06 |
| EPS2 | 3.00 | 290.27 | 1.0000 | +0.01 | +0.15 | −0.12 | 0.01 | 0.15 | 2.90 | 0.0 | 0.01 | 0.02 |
| 2N2 | 11.40 | 314.66 | 1.0000 | −0.01 | −0.04 | +0.03 | 0.01 | 0.15 | 0.75 | 0.0 | 0.01 | 0.04 |
| MU2 | 13.30 | 316.97 | 1.0000 | −0.03 | −0.24 | +0.06 | 0.03 | 0.15 | 0.67 | 0.2 | 0.03 | 0.05 |
| N2 | 89.70 | 338.32 | 1.0000 | +0.03 | +0.03 | −0.03 | 0.05 | 0.16 | 0.10 | 0.3 | 0.05 | 0.05 |
| NU2 | 17.30 | 341.44 | 1.0000 | +0.01 | +0.07 | −0.08 | 0.03 | 0.15 | 0.51 | 0.2 | 0.03 | 0.08 |
| GAM2 | 0.80 | 0.41 | 1.0000 | +0.01 | +1.24 | +1.40 | 0.02 | 0.15 | 10.76 | 0.1 | 0.02 | 0.06 |
| H1 | 0.90 | 195.83 | 1.0000 | +0.00 | +0.46 | −2.66 | 0.04 | 0.15 | 9.81 | 0.3 | 0.04 | 0.06 |
| M2 | 457.10 | 3.39 | 1.0000 | +0.01 | +0.00 | −0.01 | 0.05 | 0.16 | 0.02 | 0.3 | 0.05 | 0.14 |
| H2 | 4.70 | 148.63 | 1.0000 | +0.03 | +0.63 | −0.28 | 0.04 | 0.16 | 1.89 | 0.2 | 0.04 | 0.06 |
| LDA2 | 3.40 | 10.31 | 1.0000 | +0.03 | +0.92 | +0.38 | 0.04 | 0.15 | 2.59 | 0.2 | 0.04 | 0.10 |
| L2 | 12.80 | 22.82 | 1.0000 | +0.03 | +0.23 | +0.01 | 0.03 | 0.15 | 0.69 | 0.2 | 0.03 | 0.02 |
| T2 | 9.40 | 49.13 | 1.0000 | +0.03 | +0.33 | −0.10 | 0.03 | 0.16 | 0.95 | 0.2 | 0.03 | 0.04 |
| S2 | 170.60 | 49.05 | 1.0000 | +0.05 | +0.03 | −0.01 | 0.05 | 0.16 | 0.05 | 0.3 | 0.06 | 0.06 |
| R2 | 2.70 | 72.55 | 1.0000 | +0.03 | +1.12 | −0.32 | 0.03 | 0.13 | 2.66 | 0.2 | 0.03 | 0.03 |
| K2 | 48.60 | 47.01 | 1.0000 | −0.03 | −0.05 | −0.01 | 0.03 | 0.16 | 0.19 | 0.2 | 0.03 | 0.09 |
| MSN2 | 0.70 | 235.86 | 1.0000 | +0.00 | +0.49 | −2.37 | 0.03 | 0.15 | 12.57 | 0.2 | 0.03 | 0.07 |
| ETA2 | 2.10 | 72.01 | 1.0000 | +0.01 | +0.26 | +1.34 | 0.05 | 0.14 | 3.88 | 0.3 | 0.05 | 0.01 |
| MO3 | 2.20 | 12.93 | 0.9997 | +0.00 | +0.15 | +0.55 | 0.02 | 0.07 | 1.84 | 0.3 | 0.02 | 0.02 |
| M3 | 0.80 | 347.65 | 0.9997 | −0.04 | −5.07 | +0.01 | 0.04 | 0.07 | 5.20 | 0.5 | 0.04 | 0.01 |
| SO3 | 0.80 | 79.63 | 0.9997 | +0.02 | +2.45 | +2.54 | 0.04 | 0.07 | 4.94 | 0.5 | 0.04 | 0.04 |
| MK3 | 0.40 | 185.74 | 0.9997 | +0.06 | +15.54 | −3.14 | 0.07 | 0.07 | 8.69 | 0.7 | 0.07 | 0.04 |
| SK3 | 0.70 | 203.32 | 0.9996 | +0.01 | +0.72 | −3.00 | 0.04 | 0.07 | 5.71 | 0.5 | 0.04 | 0.03 |
| MN4 | 0.50 | 51.96 | 0.9974 | −0.06 | −11.93 | −0.46 | 0.06 | 0.05 | 6.06 | 0.9 | 0.06 | 0.04 |
| M4 | 1.60 | 101.26 | 0.9972 | −0.01 | −0.86 | −0.38 | 0.02 | 0.05 | 1.68 | 0.2 | 0.01 | 0.01 |
| SN4 | 0.20 | 227.40 | 0.9970 | −0.01 | −4.33 | +1.33 | 0.01 | 0.05 | 14.05 | 0.1 | 0.01 | 0.02 |
| MS4 | 1.30 | 198.90 | 0.9968 | −0.06 | −4.39 | +0.40 | 0.06 | 0.05 | 2.16 | 0.8 | 0.05 | 0.04 |
| MK4 | 0.40 | 198.46 | 0.9967 | −0.05 | −12.05 | −0.97 | 0.05 | 0.05 | 7.75 | 0.7 | 0.05 | 0.01 |
| S4 | 0.10 | 39.40 | 0.9963 | +0.01 | +6.34 | +11.80 | 0.02 | 0.05 | 25.45 | 0.5 | 0.02 | 0.01 |
| SK4 | 0.10 | 213.75 | 0.9963 | 0.00 | +0.43 | −11.53 | 0.02 | 0.05 | 27.04 | 0.4 | 0.02 | 0.01 |
| 2MK5 | 0.30 | 349.45 | 0.9825 | +0.02 | +5.73 | +3.16 | 0.02 | 0.04 | 6.40 | 0.5 | 0.03 | 0.03 |
| 2MN6 | 0.60 | 169.67 | 0.9359 | −0.03 | −5.85 | +1.76 | 0.04 | 0.04 | 3.82 | 0.6 | 0.02 | 0.03 |
| M6 | 1.00 | 198.30 | 0.9328 | −0.01 | −1.08 | +0.99 | 0.02 | 0.04 | 2.18 | 0.5 | 0.06 | 0.01 |
| 2MS6 | 0.80 | 248.18 | 0.9267 | +0.01 | +1.76 | +0.43 | 0.02 | 0.04 | 2.65 | 0.2 | 0.08 | 0.01 |
| 2MK6 | 0.20 | 250.23 | 0.9262 | +0.01 | +6.22 | +2.74 | 0.02 | 0.04 | 10.41 | 0.3 | 0.03 | 0.01 |
| 2SM6 | 0.10 | 275.14 | 0.9203 | −0.01 | −4.92 | +4.70 | 0.01 | 0.04 | 22.75 | 0.2 | 0.01 | 0.01 |
| MSK6 | 0.10 | 284.98 | 0.9197 | −0.06 | −58.66 | +11.26 | 0.06 | 0.04 | 53.03 | 0.9 | 0.06 | 0.04 |
| M8 | 0.30 | 228.62 | 0.5815 | +0.02 | +5.87 | −1.47 | 0.02 | 0.04 | 6.70 | 0.3 | 0.25 | 0.02 |

### Oscarsborg (`kartverket/OSC`)

2006-01-01 to 2020-12-31: 131,060 hourly values. SA over 1991 to 2020 is 87.9 mm at 281.8°, 1.3 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 86.70 | 281.34 | 1.0000 | +12.84 | +14.81 | −2.66 | 13.54 | 16.46 | 9.50 | 0.8 | 13.54 | 13.52 |
| SSA | 32.00 | 206.70 | 1.0000 | +0.06 | +0.20 | +0.15 | 0.10 | 16.50 | 29.44 | 0.0 | 0.10 | 0.63 |
| MM | 30.70 | 174.69 | 1.0000 | −0.02 | −0.06 | +0.12 | 0.06 | 16.49 | 30.78 | 0.0 | 0.06 | 0.33 |
| MF | 16.60 | 172.17 | 1.0000 | +0.12 | +0.70 | +0.31 | 0.15 | 16.49 | 56.50 | 0.0 | 0.15 | 0.40 |
| SIG1 | 3.50 | 76.67 | 1.0000 | +0.01 | +0.40 | +0.44 | 0.03 | 1.28 | 20.96 | 0.0 | 0.03 | 0.09 |
| Q1 | 6.40 | 214.86 | 1.0000 | +0.06 | +0.91 | +0.29 | 0.07 | 1.28 | 11.33 | 0.0 | 0.07 | 0.10 |
| O1 | 22.90 | 282.67 | 1.0000 | +0.02 | +0.11 | −0.05 | 0.03 | 1.29 | 3.22 | 0.0 | 0.03 | 0.08 |
| P1 | 5.40 | 127.61 | 1.0000 | −0.03 | −0.48 | +0.02 | 0.03 | 1.27 | 13.51 | 0.0 | 0.03 | 0.01 |
| S1 | 12.90 | 304.37 | 1.0000 | −0.05 | −0.38 | +0.31 | 0.09 | 1.80 | 8.03 | 0.0 | 0.09 | 0.03 |
| K1 | 3.00 | 139.64 | 1.0000 | −0.03 | −0.82 | +0.19 | 0.03 | 1.28 | 24.69 | 0.0 | 0.03 | 0.03 |
| SO1 | 1.20 | 347.18 | 1.0000 | +0.01 | +0.96 | −1.47 | 0.03 | 1.29 | 60.92 | 0.0 | 0.03 | 0.05 |
| EPS2 | 7.00 | 253.51 | 1.0000 | +0.09 | +1.33 | +0.29 | 0.10 | 1.12 | 9.02 | 0.1 | 0.10 | 0.13 |
| 2N2 | 5.00 | 34.74 | 1.0000 | +0.05 | +1.04 | +0.06 | 0.05 | 1.10 | 12.46 | 0.0 | 0.05 | 0.08 |
| MU2 | 27.90 | 289.44 | 1.0000 | +0.07 | +0.24 | −0.16 | 0.10 | 1.13 | 2.32 | 0.1 | 0.10 | 0.10 |
| N2 | 33.70 | 76.11 | 1.0000 | +0.05 | +0.13 | −0.06 | 0.06 | 1.14 | 1.93 | 0.0 | 0.06 | 0.05 |
| NU2 | 12.60 | 110.75 | 1.0000 | −0.05 | −0.36 | +0.12 | 0.05 | 1.14 | 5.18 | 0.0 | 0.05 | 0.08 |
| GAM2 | 1.50 | 141.40 | 1.0000 | +0.07 | +4.61 | −0.74 | 0.07 | 1.11 | 40.72 | 0.1 | 0.07 | 0.07 |
| H1 | 13.80 | 231.29 | 1.0000 | +0.02 | +0.17 | −0.14 | 0.04 | 1.13 | 4.69 | 0.0 | 0.04 | 0.07 |
| M2 | 142.20 | 123.31 | 1.0000 | +0.02 | +0.02 | +0.00 | 0.02 | 1.14 | 0.46 | 0.0 | 0.02 | 0.10 |
| H2 | 14.50 | 14.54 | 1.0000 | −0.03 | −0.21 | −0.15 | 0.05 | 1.14 | 4.52 | 0.0 | 0.05 | 0.04 |
| MKS2 | 5.60 | 33.54 | 1.0000 | +0.01 | +0.16 | −0.91 | 0.09 | 1.15 | 11.79 | 0.1 | 0.09 | 0.08 |
| LDA2 | 7.30 | 217.55 | 1.0000 | −0.02 | −0.30 | −0.50 | 0.07 | 1.14 | 8.94 | 0.1 | 0.07 | 0.05 |
| L2 | 14.10 | 215.82 | 1.0000 | −0.04 | −0.31 | +0.20 | 0.06 | 1.13 | 4.60 | 0.0 | 0.06 | 0.06 |
| T2 | 3.70 | 81.51 | 1.0000 | −0.03 | −0.79 | +0.38 | 0.04 | 1.14 | 17.87 | 0.0 | 0.04 | 0.13 |
| S2 | 33.30 | 68.20 | 1.0000 | +0.00 | +0.00 | −0.01 | 0.01 | 1.15 | 1.97 | 0.0 | 0.01 | 0.10 |
| R2 | 2.20 | 190.76 | 1.0000 | −0.07 | −3.04 | +0.48 | 0.07 | 0.93 | 24.90 | 0.1 | 0.07 | 0.04 |
| K2 | 8.10 | 62.98 | 1.0000 | −0.00 | −0.01 | +0.16 | 0.02 | 1.15 | 8.14 | 0.0 | 0.02 | 0.12 |
| MSN2 | 2.80 | 135.41 | 1.0000 | −0.01 | −0.41 | −1.48 | 0.07 | 1.13 | 23.19 | 0.1 | 0.07 | 0.02 |
| MO3 | 2.50 | 347.73 | 0.9997 | +0.01 | +0.22 | +0.57 | 0.03 | 0.38 | 8.65 | 0.1 | 0.03 | 0.04 |
| M3 | 3.70 | 44.32 | 0.9997 | +0.00 | +0.04 | −0.28 | 0.02 | 0.37 | 5.71 | 0.0 | 0.02 | 0.03 |
| SO3 | 1.80 | 142.10 | 0.9997 | 0.00 | −0.00 | −1.08 | 0.03 | 0.38 | 12.04 | 0.1 | 0.03 | 0.02 |
| MK3 | 3.00 | 173.35 | 0.9997 | −0.01 | −0.43 | −0.79 | 0.04 | 0.38 | 7.20 | 0.1 | 0.04 | 0.02 |
| MN4 | 6.40 | 285.32 | 0.9974 | +0.02 | +0.27 | +0.31 | 0.04 | 0.52 | 4.66 | 0.1 | 0.05 | 0.06 |
| M4 | 19.70 | 324.26 | 0.9972 | +0.03 | +0.15 | −0.04 | 0.03 | 0.52 | 1.51 | 0.1 | 0.09 | 0.03 |
| SN4 | 1.20 | 209.23 | 0.9970 | +0.05 | +3.99 | +0.10 | 0.05 | 0.53 | 24.16 | 0.1 | 0.05 | 0.04 |
| MS4 | 6.50 | 36.34 | 0.9968 | −0.10 | −1.57 | −0.13 | 0.10 | 0.53 | 4.71 | 0.2 | 0.08 | 0.04 |
| MK4 | 1.70 | 37.72 | 0.9967 | +0.00 | +0.20 | +0.70 | 0.02 | 0.53 | 17.96 | 0.0 | 0.02 | 0.01 |
| S4 | 1.00 | 9.89 | 0.9963 | −0.05 | −5.30 | −2.85 | 0.07 | 0.53 | 32.04 | 0.1 | 0.07 | 0.03 |
| 2MK5 | 1.40 | 55.28 | 0.9825 | −0.06 | −4.12 | +0.26 | 0.06 | 0.13 | 5.56 | 0.4 | 0.03 | 0.10 |
| 2SK5 | 0.20 | 353.92 | 0.9783 | −0.02 | −8.45 | +3.01 | 0.02 | 0.13 | 40.88 | 0.1 | 0.02 | 0.01 |
| 2MN6 | 3.80 | 340.85 | 0.9359 | +0.00 | +0.08 | −0.02 | 0.00 | 0.16 | 2.43 | 0.0 | 0.26 | 0.05 |
| M6 | 7.10 | 17.01 | 0.9328 | +0.02 | +0.26 | −0.06 | 0.02 | 0.16 | 1.29 | 0.1 | 0.53 | 0.05 |
| 2MS6 | 7.30 | 92.84 | 0.9267 | −0.01 | −0.10 | +0.06 | 0.01 | 0.16 | 1.27 | 0.0 | 0.57 | 0.01 |
| 2MK6 | 2.10 | 97.06 | 0.9262 | +0.02 | +0.84 | −1.08 | 0.04 | 0.17 | 4.47 | 0.2 | 0.19 | 0.01 |
| 2SM6 | 1.70 | 167.37 | 0.9203 | +0.03 | +1.66 | −0.55 | 0.03 | 0.16 | 5.36 | 0.2 | 0.18 | 0.05 |
| MSK6 | 1.00 | 164.47 | 0.9197 | +0.02 | +1.94 | +0.78 | 0.02 | 0.16 | 9.21 | 0.1 | 0.11 | 0.04 |
| 3MK7 | 0.10 | 251.61 | 0.7948 | +0.01 | +14.17 | +0.14 | 0.01 | 0.05 | 27.45 | 0.2 | 0.04 | 0.05 |
| M8 | 0.20 | 143.26 | 0.5815 | −0.02 | −12.21 | +0.01 | 0.02 | 0.02 | 6.40 | 0.5 | 0.10 | 0.02 |

### Oslo (`kartverket/OSL`)

2006-01-01 to 2020-12-31: 122,163 hourly values.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 86.40 | 281.51 | 1.0000 | +8.10 | +9.38 | −2.26 | 8.85 | 15.84 | 9.60 | 0.5 | 8.85 | 8.39 |
| SSA | 32.90 | 210.42 | 1.0000 | +2.72 | +8.28 | +16.27 | 10.06 | 15.80 | 25.54 | 0.6 | 10.06 | 10.49 |
| MM | 30.70 | 172.53 | 1.0000 | +1.33 | +4.33 | +0.96 | 1.43 | 15.85 | 28.32 | 0.1 | 1.43 | 1.29 |
| MF | 17.90 | 173.20 | 1.0000 | −1.39 | −7.77 | +3.23 | 1.69 | 15.84 | 54.96 | 0.1 | 1.69 | 1.68 |
| SIG1 | 3.60 | 81.04 | 1.0000 | +0.10 | +2.78 | −0.36 | 0.10 | 1.41 | 21.77 | 0.1 | 0.10 | 0.07 |
| Q1 | 6.90 | 215.53 | 1.0000 | +0.06 | +0.92 | +0.05 | 0.06 | 1.40 | 11.49 | 0.0 | 0.06 | 0.05 |
| O1 | 23.40 | 283.62 | 1.0000 | −0.07 | −0.32 | −0.06 | 0.08 | 1.41 | 3.46 | 0.1 | 0.08 | 0.14 |
| P1 | 6.00 | 123.87 | 1.0000 | +0.14 | +2.25 | −0.52 | 0.15 | 1.36 | 12.74 | 0.1 | 0.15 | 0.09 |
| S1 | 15.30 | 302.83 | 1.0000 | +0.17 | +1.08 | −0.22 | 0.18 | 1.94 | 7.17 | 0.1 | 0.18 | 0.08 |
| K1 | 4.00 | 135.53 | 1.0000 | −0.04 | −0.95 | +3.54 | 0.25 | 1.40 | 20.17 | 0.2 | 0.25 | 0.20 |
| EPS2 | 7.50 | 258.53 | 1.0000 | −0.07 | −0.90 | −0.47 | 0.09 | 1.24 | 9.59 | 0.1 | 0.09 | 0.15 |
| 2N2 | 5.30 | 39.60 | 1.0000 | +0.26 | +4.81 | +3.57 | 0.42 | 1.22 | 12.60 | 0.3 | 0.42 | 0.46 |
| MU2 | 29.20 | 293.51 | 1.0000 | −0.15 | −0.53 | +0.00 | 0.15 | 1.26 | 2.49 | 0.1 | 0.15 | 0.12 |
| N2 | 35.30 | 80.08 | 1.0000 | −0.21 | −0.60 | +0.27 | 0.27 | 1.27 | 2.07 | 0.2 | 0.27 | 0.26 |
| NU2 | 12.90 | 114.96 | 1.0000 | −0.21 | −1.61 | +1.24 | 0.35 | 1.27 | 5.72 | 0.2 | 0.35 | 0.34 |
| H1 | 17.20 | 232.15 | 1.0000 | −0.50 | −2.89 | +0.89 | 0.56 | 1.26 | 4.33 | 0.4 | 0.56 | 0.59 |
| M2 | 148.20 | 127.73 | 1.0000 | −0.28 | −0.19 | −0.17 | 0.51 | 1.27 | 0.49 | 0.3 | 0.51 | 0.49 |
| H2 | 17.40 | 26.26 | 1.0000 | −0.22 | −1.25 | −1.24 | 0.43 | 1.27 | 4.25 | 0.3 | 0.43 | 0.45 |
| MKS2 | 6.20 | 47.89 | 1.0000 | −0.47 | −7.63 | −0.99 | 0.48 | 1.32 | 13.23 | 0.4 | 0.48 | 0.53 |
| LDA2 | 7.50 | 220.86 | 1.0000 | +0.16 | +2.18 | +3.23 | 0.46 | 1.27 | 9.47 | 0.3 | 0.46 | 0.46 |
| L2 | 14.70 | 220.00 | 1.0000 | −0.36 | −2.48 | −1.19 | 0.47 | 1.24 | 4.97 | 0.3 | 0.47 | 0.49 |
| T2 | 3.90 | 72.82 | 1.0000 | −0.17 | −4.25 | −2.02 | 0.21 | 1.28 | 19.67 | 0.1 | 0.21 | 0.24 |
| S2 | 35.10 | 72.26 | 1.0000 | +0.34 | +0.98 | +0.24 | 0.37 | 1.28 | 2.07 | 0.3 | 0.37 | 0.30 |
| R2 | 2.80 | 197.24 | 1.0000 | +0.21 | +7.68 | +2.65 | 0.25 | 1.04 | 19.70 | 0.2 | 0.25 | 0.25 |
| K2 | 8.80 | 65.89 | 1.0000 | +0.27 | +3.09 | +0.56 | 0.29 | 1.32 | 8.36 | 0.2 | 0.29 | 0.24 |
| MSN2 | 2.90 | 137.65 | 1.0000 | −0.09 | −2.98 | +4.82 | 0.26 | 1.26 | 25.58 | 0.2 | 0.26 | 0.30 |
| MO3 | 2.80 | 350.44 | 0.9997 | +0.01 | +0.51 | −1.07 | 0.05 | 0.51 | 10.38 | 0.1 | 0.05 | 0.06 |
| M3 | 4.20 | 49.51 | 0.9997 | +0.02 | +0.48 | +0.70 | 0.06 | 0.49 | 6.64 | 0.1 | 0.06 | 0.04 |
| SO3 | 2.00 | 147.10 | 0.9997 | −0.09 | −4.68 | +0.99 | 0.10 | 0.51 | 15.38 | 0.2 | 0.10 | 0.11 |
| MK3 | 3.30 | 177.13 | 0.9997 | −0.01 | −0.32 | +0.89 | 0.05 | 0.50 | 8.76 | 0.1 | 0.05 | 0.08 |
| MN4 | 7.70 | 293.53 | 0.9974 | −0.02 | −0.20 | +1.05 | 0.14 | 0.47 | 3.52 | 0.3 | 0.14 | 0.15 |
| M4 | 24.10 | 332.00 | 0.9972 | −0.16 | −0.66 | −0.17 | 0.18 | 0.47 | 1.13 | 0.3 | 0.12 | 0.14 |
| SN4 | 1.40 | 210.80 | 0.9970 | +0.03 | +2.27 | +9.67 | 0.24 | 0.48 | 19.13 | 0.5 | 0.24 | 0.23 |
| MS4 | 8.50 | 47.95 | 0.9968 | −0.02 | −0.26 | −0.13 | 0.03 | 0.48 | 3.23 | 0.0 | 0.02 | 0.04 |
| MK4 | 2.10 | 48.44 | 0.9967 | −0.21 | −9.91 | −0.73 | 0.21 | 0.50 | 15.08 | 0.4 | 0.20 | 0.24 |
| S4 | 1.20 | 19.43 | 0.9963 | +0.04 | +3.37 | −3.77 | 0.09 | 0.48 | 22.30 | 0.2 | 0.09 | 0.02 |
| 2MK5 | 1.90 | 68.67 | 0.9825 | −0.04 | −2.13 | −1.27 | 0.06 | 0.20 | 6.02 | 0.2 | 0.04 | 0.08 |
| 2SK5 | 0.30 | 14.76 | 0.9783 | +0.07 | +23.53 | −2.31 | 0.07 | 0.20 | 30.51 | 0.3 | 0.08 | 0.04 |
| 2MN6 | 6.50 | 357.37 | 0.9359 | −0.01 | −0.09 | +0.24 | 0.03 | 0.31 | 2.70 | 0.1 | 0.44 | 0.06 |
| M6 | 12.30 | 34.02 | 0.9328 | −0.05 | −0.38 | −0.23 | 0.07 | 0.30 | 1.42 | 0.2 | 0.84 | 0.08 |
| 2MS6 | 12.70 | 109.92 | 0.9267 | +0.03 | +0.22 | −0.19 | 0.05 | 0.31 | 1.38 | 0.1 | 1.03 | 0.06 |
| 2MK6 | 3.70 | 112.67 | 0.9262 | −0.15 | −4.16 | +1.57 | 0.18 | 0.32 | 5.20 | 0.5 | 0.17 | 0.17 |
| 2SM6 | 2.80 | 181.70 | 0.9203 | +0.03 | +1.09 | +0.25 | 0.03 | 0.31 | 6.23 | 0.1 | 0.28 | 0.05 |
| MSK6 | 1.80 | 181.35 | 0.9197 | +0.03 | +1.82 | +0.95 | 0.05 | 0.32 | 10.01 | 0.1 | 0.20 | 0.04 |
| 3MK7 | 0.20 | 258.36 | 0.7948 | +0.05 | +23.75 | −3.77 | 0.05 | 0.11 | 25.24 | 0.4 | 0.11 | 0.03 |
| M8 | 0.80 | 154.76 | 0.5815 | −0.02 | −2.48 | +0.68 | 0.02 | 0.04 | 2.76 | 0.3 | 0.54 | 0.03 |

### Rørvik (`kartverket/RVK`)

2006-01-01 to 2020-12-31: 130,905 hourly values. SA over 1991 to 2020 is 137.2 mm at 327.6°, 0.6 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 136.80 | 327.82 | 1.0000 | +5.36 | +3.91 | −4.65 | 12.52 | 11.87 | 4.77 | 1.0 | 12.52 | 12.29 |
| MM | 28.70 | 179.56 | 1.0000 | −0.04 | −0.12 | +0.03 | 0.04 | 11.84 | 23.70 | 0.0 | 0.04 | 0.15 |
| MF | 18.80 | 188.04 | 1.0000 | −0.01 | −0.05 | −0.03 | 0.01 | 11.85 | 36.14 | 0.0 | 0.01 | 0.44 |
| 2Q1 | 3.70 | 299.06 | 1.0000 | −0.08 | −2.26 | +0.18 | 0.09 | 0.77 | 12.22 | 0.1 | 0.09 | 0.10 |
| SIG1 | 5.40 | 294.83 | 1.0000 | −0.03 | −0.46 | −0.64 | 0.06 | 0.79 | 8.37 | 0.1 | 0.06 | 0.10 |
| Q1 | 18.30 | 344.58 | 1.0000 | −0.03 | −0.14 | −0.06 | 0.03 | 0.78 | 2.45 | 0.0 | 0.03 | 0.08 |
| RHO1 | 3.70 | 355.65 | 1.0000 | +0.01 | +0.35 | −0.38 | 0.03 | 0.79 | 12.21 | 0.0 | 0.03 | 0.03 |
| O1 | 46.70 | 39.70 | 1.0000 | +0.06 | +0.14 | −0.05 | 0.07 | 0.79 | 0.96 | 0.1 | 0.07 | 0.05 |
| NO1 | 3.10 | 130.72 | 1.0000 | −0.03 | −1.07 | −0.64 | 0.05 | 0.70 | 13.14 | 0.0 | 0.05 | 0.03 |
| PI1 | 1.40 | 137.87 | 1.0000 | −0.01 | −1.02 | −0.78 | 0.02 | 0.78 | 32.04 | 0.0 | 0.02 | 0.04 |
| P1 | 20.70 | 155.87 | 1.0000 | −0.04 | −0.20 | −0.07 | 0.05 | 0.77 | 2.15 | 0.1 | 0.05 | 0.05 |
| S1 | 6.50 | 280.17 | 1.0000 | −0.04 | −0.55 | +0.39 | 0.06 | 1.10 | 9.76 | 0.0 | 0.06 | 0.06 |
| K1 | 73.00 | 168.43 | 1.0000 | −0.05 | −0.06 | +0.00 | 0.05 | 0.78 | 0.62 | 0.1 | 0.05 | 0.02 |
| PHI1 | 1.50 | 185.25 | 1.0000 | −0.00 | −0.16 | −0.18 | 0.01 | 0.78 | 29.70 | 0.0 | 0.01 | 0.07 |
| J1 | 4.40 | 207.27 | 1.0000 | +0.01 | +0.26 | +0.26 | 0.02 | 0.76 | 9.90 | 0.0 | 0.02 | 0.06 |
| OO1 | 2.20 | 292.51 | 1.0000 | −0.03 | −1.30 | −0.45 | 0.03 | 0.70 | 18.43 | 0.0 | 0.03 | 0.04 |
| OQ2 | 2.20 | 237.69 | 1.0000 | −0.05 | −2.08 | −0.14 | 0.05 | 0.31 | 8.37 | 0.1 | 0.05 | 0.03 |
| EPS2 | 4.90 | 233.68 | 1.0000 | −0.07 | −1.35 | −0.24 | 0.07 | 0.33 | 3.89 | 0.2 | 0.07 | 0.05 |
| 2N2 | 21.00 | 263.27 | 1.0000 | −0.00 | −0.01 | −0.02 | 0.01 | 0.32 | 0.88 | 0.0 | 0.01 | 0.02 |
| MU2 | 22.20 | 258.30 | 1.0000 | −0.02 | −0.07 | −0.02 | 0.02 | 0.33 | 0.86 | 0.0 | 0.02 | 0.05 |
| N2 | 160.80 | 285.86 | 1.0000 | −0.05 | −0.03 | −0.01 | 0.06 | 0.33 | 0.12 | 0.1 | 0.06 | 0.04 |
| NU2 | 31.00 | 289.97 | 1.0000 | −0.00 | −0.01 | −0.01 | 0.01 | 0.33 | 0.62 | 0.0 | 0.01 | 0.02 |
| GAM2 | 2.20 | 308.21 | 1.0000 | +0.06 | +2.53 | −0.04 | 0.06 | 0.33 | 8.32 | 0.2 | 0.06 | 0.04 |
| H1 | 4.40 | 322.75 | 1.0000 | +0.03 | +0.67 | +0.21 | 0.03 | 0.33 | 4.31 | 0.1 | 0.03 | 0.06 |
| M2 | 791.90 | 309.29 | 1.0000 | +0.02 | +0.00 | −0.01 | 0.14 | 0.33 | 0.02 | 0.4 | 0.14 | 0.15 |
| H2 | 1.60 | 345.40 | 1.0000 | +0.03 | +2.22 | −0.82 | 0.04 | 0.34 | 11.76 | 0.1 | 0.04 | 0.03 |
| MKS2 | 1.00 | 299.95 | 1.0000 | +0.04 | +4.08 | +0.96 | 0.04 | 0.34 | 18.69 | 0.1 | 0.04 | 0.04 |
| LDA2 | 6.30 | 328.85 | 1.0000 | −0.03 | −0.40 | +0.38 | 0.05 | 0.33 | 3.05 | 0.1 | 0.05 | 0.03 |
| L2 | 21.60 | 332.45 | 1.0000 | −0.01 | −0.05 | +0.01 | 0.01 | 0.33 | 0.88 | 0.0 | 0.01 | 0.01 |
| T2 | 14.10 | 341.47 | 1.0000 | +0.03 | +0.19 | +0.13 | 0.04 | 0.34 | 1.37 | 0.1 | 0.04 | 0.02 |
| S2 | 273.00 | 347.08 | 1.0000 | +0.04 | +0.01 | −0.00 | 0.04 | 0.34 | 0.07 | 0.1 | 0.04 | 0.02 |
| R2 | 1.00 | 22.80 | 1.0000 | +0.01 | +0.80 | +0.99 | 0.02 | 0.27 | 15.50 | 0.1 | 0.02 | 0.01 |
| K2 | 76.80 | 344.75 | 1.0000 | −0.04 | −0.05 | −0.00 | 0.04 | 0.34 | 0.25 | 0.1 | 0.03 | 0.02 |
| MSN2 | 1.10 | 234.07 | 1.0000 | −0.04 | −3.69 | −0.21 | 0.04 | 0.33 | 17.95 | 0.1 | 0.04 | 0.01 |
| ETA2 | 3.40 | 0.05 | 1.0000 | +0.01 | +0.20 | −0.44 | 0.03 | 0.31 | 5.20 | 0.1 | 0.03 | 0.06 |
| MO3 | 3.70 | 244.90 | 0.9997 | +0.02 | +0.43 | +0.18 | 0.02 | 0.17 | 2.70 | 0.1 | 0.02 | 0.05 |
| M3 | 1.60 | 183.62 | 0.9997 | −0.01 | −0.36 | −0.48 | 0.02 | 0.17 | 6.13 | 0.1 | 0.01 | 0.02 |
| SO3 | 1.40 | 341.73 | 0.9997 | −0.06 | −4.49 | +0.99 | 0.07 | 0.17 | 7.50 | 0.3 | 0.07 | 0.03 |
| MK3 | 1.00 | 19.73 | 0.9997 | −0.04 | −3.76 | +0.52 | 0.04 | 0.17 | 10.34 | 0.2 | 0.04 | 0.03 |
| SK3 | 3.10 | 113.34 | 0.9996 | −0.04 | −1.16 | −0.28 | 0.04 | 0.17 | 3.26 | 0.2 | 0.04 | 0.02 |
| MN4 | 7.00 | 175.51 | 0.9974 | +0.01 | +0.20 | −0.34 | 0.04 | 0.26 | 2.09 | 0.2 | 0.05 | 0.01 |
| M4 | 15.60 | 212.76 | 0.9972 | −0.03 | −0.18 | −0.07 | 0.03 | 0.26 | 0.94 | 0.1 | 0.03 | 0.03 |
| SN4 | 2.20 | 292.19 | 0.9970 | +0.01 | +0.65 | −0.14 | 0.02 | 0.26 | 6.67 | 0.1 | 0.02 | 0.03 |
| MS4 | 8.90 | 304.56 | 0.9968 | +0.02 | +0.26 | +0.08 | 0.03 | 0.26 | 1.65 | 0.1 | 0.05 | 0.03 |
| MK4 | 2.60 | 305.67 | 0.9967 | +0.00 | +0.13 | −0.06 | 0.00 | 0.26 | 5.75 | 0.0 | 0.01 | 0.02 |
| S4 | 0.80 | 134.89 | 0.9963 | +0.02 | +2.99 | −1.46 | 0.03 | 0.26 | 18.03 | 0.1 | 0.03 | 0.00 |
| 2MK5 | 2.70 | 245.91 | 0.9825 | +0.02 | +0.72 | −1.04 | 0.05 | 0.10 | 2.08 | 0.5 | 0.08 | 0.01 |
| 2SK5 | 0.40 | 146.82 | 0.9783 | −0.05 | −11.18 | −0.56 | 0.05 | 0.10 | 16.01 | 0.4 | 0.04 | 0.02 |
| 2MN6 | 5.00 | 109.67 | 0.9359 | −0.04 | −0.84 | +0.13 | 0.04 | 0.08 | 0.92 | 0.4 | 0.30 | 0.02 |
| M6 | 9.00 | 143.36 | 0.9328 | +0.09 | +1.00 | −0.01 | 0.09 | 0.08 | 0.50 | 1.0 | 0.74 | 0.09 |
| 2MS6 | 8.60 | 202.92 | 0.9267 | +0.06 | +0.76 | −0.06 | 0.07 | 0.08 | 0.53 | 0.7 | 0.75 | 0.10 |
| 2MK6 | 2.30 | 202.88 | 0.9262 | +0.01 | +0.28 | +0.05 | 0.01 | 0.08 | 2.04 | 0.1 | 0.19 | 0.01 |
| 2SM6 | 1.80 | 257.81 | 0.9203 | −0.04 | −2.41 | −0.10 | 0.04 | 0.08 | 2.61 | 0.5 | 0.11 | 0.03 |
| MSK6 | 1.10 | 261.92 | 0.9197 | +0.00 | +0.06 | −0.48 | 0.01 | 0.08 | 4.23 | 0.1 | 0.10 | 0.02 |
| 3MK7 | 0.20 | 260.31 | 0.7948 | +0.01 | +3.54 | −5.03 | 0.02 | 0.04 | 12.27 | 0.4 | 0.06 | 0.01 |
| M8 | 0.30 | 103.80 | 0.5815 | −0.02 | −6.41 | +0.91 | 0.02 | 0.03 | 5.51 | 0.3 | 0.18 | 0.03 |

### Stavanger (`kartverket/SVG`)

2006-01-01 to 2020-12-31: 131,246 hourly values. SA over 1991 to 2020 is 101.8 mm at 308.7°, 0.8 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 101.50 | 309.07 | 1.0000 | +6.92 | +6.81 | −3.39 | 9.29 | 9.26 | 4.89 | 0.7 | 9.29 | 9.25 |
| MM | 23.20 | 178.44 | 1.0000 | +0.00 | +0.00 | −0.08 | 0.03 | 9.26 | 22.86 | 0.0 | 0.03 | 0.38 |
| MF | 15.80 | 191.75 | 1.0000 | −0.02 | −0.12 | +0.08 | 0.03 | 9.26 | 33.61 | 0.0 | 0.03 | 0.40 |
| SIG1 | 1.70 | 56.14 | 1.0000 | +0.03 | +1.85 | −0.75 | 0.04 | 0.77 | 25.55 | 0.0 | 0.04 | 0.03 |
| Q1 | 3.90 | 314.62 | 1.0000 | −0.02 | −0.56 | −0.22 | 0.03 | 0.77 | 11.34 | 0.0 | 0.03 | 0.04 |
| O1 | 17.00 | 7.34 | 1.0000 | −0.05 | −0.32 | +0.00 | 0.05 | 0.77 | 2.62 | 0.1 | 0.05 | 0.07 |
| NO1 | 0.80 | 60.71 | 1.0000 | +0.03 | +3.49 | −0.46 | 0.03 | 0.69 | 48.03 | 0.0 | 0.03 | 0.04 |
| PI1 | 1.00 | 98.10 | 1.0000 | +0.03 | +3.32 | +0.39 | 0.03 | 0.76 | 42.25 | 0.0 | 0.03 | 0.15 |
| P1 | 5.90 | 164.28 | 1.0000 | +0.02 | +0.26 | −0.03 | 0.02 | 0.76 | 7.37 | 0.0 | 0.02 | 0.08 |
| S1 | 2.20 | 275.19 | 1.0000 | +0.04 | +1.82 | −0.53 | 0.05 | 1.08 | 27.68 | 0.0 | 0.05 | 0.22 |
| K1 | 16.50 | 173.36 | 1.0000 | +0.05 | +0.27 | −0.00 | 0.05 | 0.77 | 2.67 | 0.1 | 0.05 | 0.03 |
| OO1 | 0.70 | 333.71 | 1.0000 | +0.02 | +2.68 | −1.22 | 0.02 | 0.69 | 54.65 | 0.0 | 0.02 | 0.04 |
| OQ2 | 0.60 | 251.83 | 1.0000 | +0.01 | +2.18 | +0.27 | 0.01 | 0.35 | 32.84 | 0.0 | 0.01 | 0.01 |
| EPS2 | 3.40 | 247.77 | 1.0000 | −0.02 | −0.63 | −0.02 | 0.02 | 0.37 | 6.20 | 0.1 | 0.02 | 0.02 |
| 2N2 | 3.60 | 249.99 | 1.0000 | +0.03 | +0.93 | +0.09 | 0.03 | 0.36 | 5.67 | 0.1 | 0.03 | 0.02 |
| MU2 | 14.10 | 276.37 | 1.0000 | +0.05 | +0.32 | −0.04 | 0.05 | 0.37 | 1.50 | 0.1 | 0.05 | 0.05 |
| N2 | 27.60 | 258.21 | 1.0000 | −0.01 | −0.04 | +0.03 | 0.02 | 0.37 | 0.77 | 0.0 | 0.02 | 0.01 |
| NU2 | 4.60 | 231.79 | 1.0000 | −0.01 | −0.21 | −0.10 | 0.01 | 0.37 | 4.64 | 0.0 | 0.01 | 0.03 |
| H1 | 5.00 | 242.12 | 1.0000 | +0.04 | +0.87 | −0.03 | 0.04 | 0.37 | 4.21 | 0.1 | 0.04 | 0.07 |
| M2 | 157.70 | 272.92 | 1.0000 | −0.03 | −0.02 | −0.01 | 0.05 | 0.37 | 0.14 | 0.1 | 0.05 | 0.04 |
| H2 | 2.90 | 7.74 | 1.0000 | +0.01 | +0.41 | −0.03 | 0.01 | 0.37 | 7.35 | 0.0 | 0.01 | 0.04 |
| MKS2 | 1.20 | 347.20 | 1.0000 | +0.02 | +1.76 | +0.26 | 0.02 | 0.38 | 17.72 | 0.1 | 0.02 | 0.06 |
| LDA2 | 3.50 | 245.62 | 1.0000 | −0.01 | −0.23 | −0.37 | 0.02 | 0.37 | 6.10 | 0.1 | 0.02 | 0.03 |
| L2 | 8.00 | 262.85 | 1.0000 | +0.03 | +0.42 | −0.04 | 0.03 | 0.37 | 2.64 | 0.1 | 0.03 | 0.03 |
| T2 | 3.20 | 321.92 | 1.0000 | +0.03 | +0.88 | +0.21 | 0.03 | 0.37 | 6.65 | 0.1 | 0.03 | 0.03 |
| S2 | 70.10 | 323.93 | 1.0000 | +0.00 | +0.00 | −0.01 | 0.01 | 0.37 | 0.31 | 0.0 | 0.01 | 0.02 |
| R2 | 0.50 | 323.14 | 1.0000 | −0.01 | −2.16 | −0.21 | 0.01 | 0.30 | 35.54 | 0.0 | 0.01 | 0.02 |
| K2 | 20.20 | 320.53 | 1.0000 | +0.03 | +0.15 | −0.02 | 0.03 | 0.38 | 1.07 | 0.1 | 0.03 | 0.03 |
| MSN2 | 1.50 | 126.48 | 1.0000 | +0.04 | +2.47 | −0.75 | 0.04 | 0.37 | 13.77 | 0.1 | 0.04 | 0.03 |
| ETA2 | 0.70 | 353.01 | 1.0000 | +0.02 | +2.66 | +1.47 | 0.03 | 0.34 | 27.50 | 0.1 | 0.03 | 0.02 |
| MO3 | 1.60 | 142.07 | 0.9997 | +0.00 | +0.14 | −0.49 | 0.01 | 0.18 | 6.56 | 0.1 | 0.01 | 0.03 |
| M3 | 3.50 | 207.62 | 0.9997 | +0.05 | +1.42 | −0.12 | 0.05 | 0.18 | 2.89 | 0.3 | 0.05 | 0.07 |
| SO3 | 1.20 | 267.92 | 0.9997 | +0.06 | +4.79 | −0.44 | 0.06 | 0.18 | 8.36 | 0.3 | 0.06 | 0.05 |
| MK3 | 2.10 | 304.82 | 0.9997 | −0.04 | −1.79 | −0.16 | 0.04 | 0.18 | 5.06 | 0.2 | 0.04 | 0.01 |
| SK3 | 0.50 | 50.28 | 0.9996 | −0.05 | −9.41 | −0.79 | 0.05 | 0.18 | 23.12 | 0.2 | 0.05 | 0.03 |
| MN4 | 2.40 | 222.85 | 0.9974 | −0.02 | −0.81 | +0.24 | 0.02 | 0.26 | 6.31 | 0.1 | 0.02 | 0.04 |
| M4 | 8.30 | 237.80 | 0.9972 | −0.06 | −0.76 | −0.01 | 0.06 | 0.26 | 1.82 | 0.2 | 0.04 | 0.05 |
| SN4 | 1.40 | 0.68 | 0.9970 | +0.01 | +0.75 | −0.10 | 0.01 | 0.26 | 10.73 | 0.0 | 0.02 | 0.02 |
| MS4 | 8.20 | 344.90 | 0.9968 | +0.01 | +0.08 | −0.15 | 0.02 | 0.26 | 1.84 | 0.1 | 0.04 | 0.04 |
| MK4 | 2.60 | 349.81 | 0.9967 | −0.02 | −0.63 | +0.23 | 0.02 | 0.27 | 5.94 | 0.1 | 0.01 | 0.03 |
| S4 | 2.00 | 147.66 | 0.9963 | +0.01 | +0.31 | +0.10 | 0.01 | 0.27 | 7.59 | 0.0 | 0.01 | 0.01 |
| SK4 | 0.90 | 126.33 | 0.9963 | −0.04 | −4.26 | +0.06 | 0.04 | 0.27 | 17.74 | 0.1 | 0.03 | 0.01 |
| 2MK5 | 1.00 | 291.79 | 0.9825 | +0.01 | +0.90 | +0.62 | 0.01 | 0.12 | 6.63 | 0.1 | 0.03 | 0.04 |
| 2SK5 | 0.20 | 34.32 | 0.9783 | +0.05 | +24.40 | +2.21 | 0.05 | 0.12 | 26.98 | 0.4 | 0.06 | 0.03 |
| 2MN6 | 12.00 | 38.12 | 0.9359 | −0.02 | −0.18 | +0.08 | 0.03 | 0.20 | 0.98 | 0.1 | 0.80 | 0.03 |
| M6 | 22.90 | 69.38 | 0.9328 | −0.02 | −0.06 | −0.06 | 0.03 | 0.20 | 0.51 | 0.1 | 1.63 | 0.02 |
| 2MS6 | 22.90 | 127.20 | 0.9267 | −0.06 | −0.26 | −0.03 | 0.06 | 0.20 | 0.51 | 0.3 | 1.75 | 0.01 |
| 2MK6 | 6.40 | 128.92 | 0.9262 | −0.03 | −0.53 | −0.01 | 0.03 | 0.21 | 1.89 | 0.2 | 0.47 | 0.03 |
| 2SM6 | 4.50 | 179.17 | 0.9203 | +0.01 | +0.19 | +0.17 | 0.02 | 0.21 | 2.61 | 0.1 | 0.40 | 0.02 |
| MSK6 | 2.70 | 181.89 | 0.9197 | +0.01 | +0.48 | +0.91 | 0.05 | 0.21 | 4.40 | 0.2 | 0.25 | 0.04 |
| 3MK7 | 0.70 | 157.32 | 0.7948 | −0.00 | −0.44 | −0.90 | 0.01 | 0.09 | 7.48 | 0.1 | 0.18 | 0.02 |
| M8 | 2.60 | 319.24 | 0.5815 | −0.07 | −2.77 | +0.02 | 0.07 | 0.05 | 1.07 | **1.0** | 1.75 | 0.08 |

### Tromsø (`kartverket/TOS`)

2006-01-01 to 2020-12-31: 131,027 hourly values. SA over 1991 to 2020 is 129.0 mm at 330.5°, 0.7 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 128.60 | 330.20 | 1.0000 | +1.45 | +1.12 | −1.69 | 4.07 | 10.95 | 4.83 | 0.3 | 4.07 | 4.04 |
| SSA | 20.60 | 158.98 | 1.0000 | −0.02 | −0.11 | +0.06 | 0.03 | 10.95 | 30.51 | 0.0 | 0.03 | 0.34 |
| MM | 26.30 | 183.83 | 1.0000 | −0.02 | −0.08 | −0.04 | 0.03 | 10.95 | 23.89 | 0.0 | 0.03 | 0.30 |
| MF | 16.60 | 195.10 | 1.0000 | −0.05 | −0.31 | +0.08 | 0.06 | 10.95 | 37.93 | 0.0 | 0.06 | 0.40 |
| ALP1 | 0.90 | 307.11 | 1.0000 | +0.02 | +2.22 | −2.04 | 0.04 | 0.43 | 26.80 | 0.1 | 0.04 | 0.00 |
| 2Q1 | 4.00 | 303.97 | 1.0000 | −0.02 | −0.50 | +0.06 | 0.02 | 0.42 | 6.12 | 0.0 | 0.02 | 0.08 |
| SIG1 | 3.70 | 314.09 | 1.0000 | −0.01 | −0.23 | +0.10 | 0.01 | 0.43 | 6.73 | 0.0 | 0.01 | 0.02 |
| Q1 | 17.50 | 354.31 | 1.0000 | +0.03 | +0.18 | −0.02 | 0.03 | 0.43 | 1.41 | 0.1 | 0.03 | 0.08 |
| RHO1 | 3.20 | 3.57 | 1.0000 | −0.03 | −0.90 | −0.34 | 0.03 | 0.44 | 7.89 | 0.1 | 0.03 | 0.04 |
| O1 | 38.80 | 51.17 | 1.0000 | +0.02 | +0.05 | −0.02 | 0.02 | 0.43 | 0.64 | 0.0 | 0.02 | 0.02 |
| TAU1 | 1.40 | 244.80 | 1.0000 | −0.00 | −0.19 | +0.62 | 0.02 | 0.40 | 16.55 | 0.0 | 0.02 | 0.03 |
| NO1 | 2.30 | 180.32 | 1.0000 | +0.01 | +0.62 | +0.03 | 0.01 | 0.39 | 9.58 | 0.0 | 0.01 | 0.03 |
| PI1 | 1.50 | 157.99 | 1.0000 | +0.05 | +2.98 | −1.12 | 0.05 | 0.43 | 15.87 | 0.1 | 0.05 | 0.02 |
| P1 | 19.20 | 198.63 | 1.0000 | −0.00 | −0.00 | −0.01 | 0.00 | 0.43 | 1.28 | 0.0 | 0.00 | 0.04 |
| S1 | 5.80 | 293.62 | 1.0000 | +0.05 | +0.91 | +0.18 | 0.06 | 0.61 | 5.95 | 0.1 | 0.06 | 0.04 |
| K1 | 70.50 | 208.70 | 1.0000 | +0.00 | +0.00 | −0.01 | 0.01 | 0.43 | 0.35 | 0.0 | 0.01 | 0.05 |
| PSI1 | 0.90 | 208.56 | 1.0000 | −0.02 | −2.57 | −0.76 | 0.03 | 0.43 | 28.08 | 0.1 | 0.03 | 0.01 |
| PHI1 | 1.40 | 206.10 | 1.0000 | +0.05 | +3.56 | +0.17 | 0.05 | 0.43 | 16.94 | 0.1 | 0.05 | 0.07 |
| J1 | 4.50 | 248.22 | 1.0000 | −0.02 | −0.41 | −0.25 | 0.03 | 0.42 | 5.37 | 0.0 | 0.03 | 0.05 |
| OO1 | 2.40 | 320.46 | 1.0000 | +0.01 | +0.38 | −0.69 | 0.03 | 0.39 | 9.18 | 0.1 | 0.03 | 0.07 |
| OQ2 | 2.40 | 288.16 | 1.0000 | −0.07 | −2.77 | +0.16 | 0.07 | 0.35 | 8.68 | 0.2 | 0.07 | 0.06 |
| EPS2 | 4.70 | 337.71 | 1.0000 | +0.02 | +0.34 | −0.16 | 0.02 | 0.37 | 4.49 | 0.0 | 0.02 | 0.07 |
| 2N2 | 22.20 | 315.31 | 1.0000 | +0.02 | +0.09 | −0.05 | 0.03 | 0.36 | 0.94 | 0.1 | 0.03 | 0.04 |
| MU2 | 20.60 | 343.27 | 1.0000 | −0.03 | −0.13 | −0.08 | 0.04 | 0.38 | 1.05 | 0.1 | 0.04 | 0.05 |
| N2 | 171.90 | 336.92 | 1.0000 | +0.03 | +0.01 | −0.01 | 0.04 | 0.38 | 0.13 | 0.1 | 0.04 | 0.04 |
| NU2 | 33.70 | 338.48 | 1.0000 | −0.06 | −0.18 | −0.05 | 0.07 | 0.38 | 0.64 | 0.2 | 0.07 | 0.04 |
| GAM2 | 3.00 | 347.30 | 1.0000 | +0.05 | +1.71 | −0.17 | 0.05 | 0.37 | 6.93 | 0.1 | 0.05 | 0.04 |
| H1 | 8.60 | 28.47 | 1.0000 | −0.02 | −0.27 | +0.13 | 0.03 | 0.38 | 2.51 | 0.1 | 0.03 | 0.05 |
| M2 | 842.50 | 0.02 | 1.0000 | +0.02 | +0.00 | −0.01 | 0.09 | 0.38 | 0.03 | 0.2 | 0.09 | 0.01 |
| H2 | 2.60 | 265.15 | 1.0000 | +0.06 | +2.37 | +0.01 | 0.06 | 0.38 | 8.14 | 0.2 | 0.06 | 0.05 |
| LDA2 | 9.90 | 353.62 | 1.0000 | +0.05 | +0.48 | +0.04 | 0.05 | 0.38 | 2.17 | 0.1 | 0.05 | 0.05 |
| L2 | 27.00 | 11.52 | 1.0000 | +0.05 | +0.17 | −0.05 | 0.05 | 0.37 | 0.79 | 0.1 | 0.05 | 0.09 |
| T2 | 13.80 | 32.15 | 1.0000 | −0.01 | −0.07 | −0.02 | 0.01 | 0.38 | 1.58 | 0.0 | 0.01 | 0.03 |
| S2 | 275.40 | 42.76 | 1.0000 | −0.01 | −0.00 | −0.01 | 0.05 | 0.38 | 0.08 | 0.1 | 0.05 | 0.08 |
| R2 | 1.20 | 89.80 | 1.0000 | −0.07 | −5.92 | +0.52 | 0.07 | 0.31 | 15.60 | 0.2 | 0.07 | 0.05 |
| K2 | 77.40 | 40.16 | 1.0000 | +0.01 | +0.01 | −0.05 | 0.06 | 0.38 | 0.28 | 0.2 | 0.06 | 0.05 |
| MSN2 | 3.80 | 204.91 | 1.0000 | +0.05 | +1.33 | −0.56 | 0.06 | 0.37 | 5.57 | 0.1 | 0.06 | 0.03 |
| ETA2 | 2.90 | 71.59 | 1.0000 | −0.02 | −0.67 | +0.06 | 0.02 | 0.35 | 6.91 | 0.1 | 0.02 | 0.02 |
| MO3 | 2.00 | 317.33 | 0.9997 | −0.00 | −0.12 | −0.46 | 0.02 | 0.12 | 3.41 | 0.1 | 0.02 | 0.02 |
| M3 | 1.20 | 14.93 | 0.9997 | +0.03 | +2.89 | −0.60 | 0.04 | 0.12 | 5.39 | 0.3 | 0.04 | 0.01 |
| SO3 | 0.30 | 50.98 | 0.9997 | +0.01 | +4.18 | −0.05 | 0.01 | 0.12 | 21.82 | 0.1 | 0.01 | 0.02 |
| MK3 | 0.40 | 167.56 | 0.9997 | +0.03 | +7.14 | −1.69 | 0.03 | 0.12 | 15.79 | 0.2 | 0.03 | 0.02 |
| SK3 | 2.20 | 199.02 | 0.9996 | +0.01 | +0.59 | −0.31 | 0.02 | 0.12 | 3.07 | 0.1 | 0.02 | 0.01 |
| MN4 | 3.10 | 175.81 | 0.9974 | −0.03 | −0.90 | −0.09 | 0.03 | 0.15 | 2.89 | 0.2 | 0.02 | 0.00 |
| M4 | 7.30 | 217.01 | 0.9972 | −0.03 | −0.38 | −0.05 | 0.03 | 0.15 | 1.22 | 0.2 | 0.01 | 0.06 |
| SN4 | 1.40 | 138.45 | 0.9970 | +0.01 | +0.33 | +0.24 | 0.01 | 0.16 | 6.38 | 0.0 | 0.01 | 0.03 |
| MS4 | 2.50 | 237.54 | 0.9968 | −0.03 | −1.25 | +0.14 | 0.03 | 0.16 | 3.63 | 0.2 | 0.02 | 0.02 |
| MK4 | 0.80 | 202.51 | 0.9967 | −0.04 | −5.11 | −0.64 | 0.04 | 0.16 | 11.97 | 0.2 | 0.04 | 0.02 |
| S4 | 2.00 | 190.86 | 0.9963 | −0.06 | −2.88 | +0.72 | 0.06 | 0.16 | 4.64 | 0.3 | 0.06 | 0.04 |
| SK4 | 1.30 | 212.59 | 0.9963 | +0.05 | +3.71 | +0.42 | 0.05 | 0.16 | 6.71 | 0.3 | 0.05 | 0.06 |
| 2MK5 | 1.30 | 112.99 | 0.9825 | +0.01 | +1.06 | −0.19 | 0.01 | 0.09 | 4.04 | 0.1 | 0.04 | 0.01 |
| 2MN6 | 9.00 | 311.35 | 0.9359 | +0.07 | +0.73 | −0.08 | 0.07 | 0.22 | 1.37 | 0.3 | 0.69 | 0.09 |
| M6 | 16.80 | 341.92 | 0.9328 | +0.04 | +0.22 | +0.03 | 0.04 | 0.22 | 0.73 | 0.2 | 1.25 | 0.12 |
| 2MS6 | 13.30 | 33.51 | 0.9267 | +0.06 | +0.47 | −0.09 | 0.07 | 0.22 | 0.93 | 0.3 | 1.12 | 0.12 |
| 2MK6 | 3.60 | 34.05 | 0.9262 | +0.02 | +0.60 | +0.43 | 0.03 | 0.22 | 3.50 | 0.1 | 0.31 | 0.04 |
| 2SM6 | 2.00 | 87.44 | 0.9203 | +0.04 | +1.91 | +0.30 | 0.04 | 0.22 | 6.09 | 0.2 | 0.21 | 0.05 |
| MSK6 | 1.30 | 85.21 | 0.9197 | −0.03 | −2.13 | +0.02 | 0.03 | 0.22 | 9.88 | 0.1 | 0.08 | 0.04 |
| 3MK7 | 0.50 | 207.21 | 0.7948 | −0.03 | −6.65 | +0.48 | 0.03 | 0.05 | 6.15 | 0.5 | 0.09 | 0.02 |
| M8 | 1.40 | 69.59 | 0.5815 | +0.01 | +0.99 | +1.34 | 0.04 | 0.04 | 1.54 | 0.9 | 1.03 | 0.01 |

### Trondheim (`kartverket/TRD`)

2006-01-01 to 2020-12-31: 131,138 hourly values. SA over 1991 to 2020 is 117.3 mm at 325.6°, 1.2 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 116.20 | 325.92 | 1.0000 | +6.00 | +5.17 | −5.65 | 13.19 | 11.02 | 5.17 | **1.1** | 13.19 | 12.64 |
| SSA | 19.00 | 149.13 | 1.0000 | +0.03 | +0.14 | +0.20 | 0.07 | 11.01 | 33.24 | 0.0 | 0.07 | 0.54 |
| MM | 27.00 | 177.15 | 1.0000 | −0.00 | −0.01 | −0.12 | 0.06 | 11.03 | 23.39 | 0.0 | 0.06 | 0.24 |
| MF | 17.90 | 186.03 | 1.0000 | −0.01 | −0.05 | −0.11 | 0.04 | 11.03 | 35.32 | 0.0 | 0.04 | 0.37 |
| 2Q1 | 3.90 | 296.12 | 1.0000 | +0.01 | +0.22 | +0.19 | 0.02 | 0.68 | 9.91 | 0.0 | 0.02 | 0.09 |
| SIG1 | 5.10 | 293.11 | 1.0000 | +0.05 | +0.98 | +0.16 | 0.05 | 0.69 | 7.66 | 0.1 | 0.05 | 0.03 |
| Q1 | 19.90 | 343.50 | 1.0000 | +0.04 | +0.20 | +0.14 | 0.06 | 0.68 | 1.96 | 0.1 | 0.06 | 0.04 |
| RHO1 | 3.80 | 355.93 | 1.0000 | −0.00 | −0.05 | +0.69 | 0.05 | 0.69 | 10.46 | 0.1 | 0.05 | 0.02 |
| O1 | 52.00 | 36.49 | 1.0000 | −0.05 | −0.09 | +0.02 | 0.05 | 0.69 | 0.76 | 0.1 | 0.05 | 0.06 |
| TAU1 | 0.90 | 168.87 | 1.0000 | +0.02 | +2.26 | +1.23 | 0.03 | 0.64 | 39.93 | 0.0 | 0.03 | 0.02 |
| NO1 | 3.00 | 128.17 | 1.0000 | +0.04 | +1.36 | −0.43 | 0.05 | 0.62 | 11.62 | 0.1 | 0.05 | 0.06 |
| PI1 | 1.50 | 136.40 | 1.0000 | +0.01 | +0.75 | −0.64 | 0.02 | 0.68 | 25.76 | 0.0 | 0.02 | 0.04 |
| P1 | 18.70 | 150.58 | 1.0000 | −0.04 | −0.19 | −0.20 | 0.07 | 0.68 | 2.08 | 0.1 | 0.07 | 0.09 |
| S1 | 10.30 | 273.93 | 1.0000 | −0.04 | −0.35 | +0.01 | 0.04 | 0.97 | 5.39 | 0.0 | 0.04 | 0.02 |
| K1 | 65.40 | 166.62 | 1.0000 | +0.03 | +0.04 | +0.00 | 0.03 | 0.69 | 0.60 | 0.0 | 0.03 | 0.08 |
| PHI1 | 1.80 | 174.40 | 1.0000 | −0.08 | −4.41 | +0.76 | 0.08 | 0.68 | 22.67 | 0.1 | 0.08 | 0.01 |
| J1 | 4.10 | 209.32 | 1.0000 | +0.05 | +1.17 | +0.14 | 0.05 | 0.67 | 9.23 | 0.1 | 0.05 | 0.04 |
| OO1 | 2.10 | 288.91 | 1.0000 | +0.03 | +1.26 | −0.70 | 0.04 | 0.61 | 16.46 | 0.0 | 0.04 | 0.03 |
| OQ2 | 2.60 | 233.62 | 1.0000 | −0.04 | −1.37 | −0.37 | 0.04 | 0.34 | 7.54 | 0.1 | 0.04 | 0.05 |
| EPS2 | 5.30 | 243.53 | 1.0000 | −0.04 | −0.74 | −0.01 | 0.04 | 0.35 | 3.83 | 0.1 | 0.04 | 0.02 |
| 2N2 | 24.10 | 261.01 | 1.0000 | −0.02 | −0.10 | −0.03 | 0.03 | 0.35 | 0.82 | 0.1 | 0.03 | 0.07 |
| MU2 | 24.20 | 264.32 | 1.0000 | −0.04 | −0.15 | −0.03 | 0.04 | 0.36 | 0.85 | 0.1 | 0.04 | 0.05 |
| N2 | 185.90 | 282.95 | 1.0000 | −0.02 | −0.01 | −0.02 | 0.06 | 0.36 | 0.11 | 0.2 | 0.06 | 0.02 |
| NU2 | 36.30 | 286.44 | 1.0000 | −0.02 | −0.05 | −0.07 | 0.05 | 0.36 | 0.57 | 0.1 | 0.05 | 0.02 |
| GAM2 | 3.10 | 298.43 | 1.0000 | −0.05 | −1.68 | −0.39 | 0.06 | 0.35 | 6.61 | 0.1 | 0.06 | 0.01 |
| H1 | 4.50 | 318.73 | 1.0000 | −0.09 | −1.90 | +0.29 | 0.09 | 0.36 | 4.64 | 0.2 | 0.09 | 0.07 |
| M2 | 926.00 | 305.88 | 1.0000 | +0.02 | +0.00 | −0.00 | 0.05 | 0.36 | 0.02 | 0.1 | 0.06 | 0.08 |
| H2 | 3.70 | 124.23 | 1.0000 | −0.04 | −1.19 | +0.37 | 0.05 | 0.36 | 5.64 | 0.1 | 0.05 | 0.00 |
| LDA2 | 7.60 | 315.97 | 1.0000 | −0.04 | −0.47 | −0.37 | 0.06 | 0.36 | 2.71 | 0.1 | 0.06 | 0.05 |
| L2 | 25.90 | 325.35 | 1.0000 | +0.01 | +0.02 | −0.07 | 0.03 | 0.36 | 0.79 | 0.1 | 0.03 | 0.03 |
| T2 | 16.40 | 339.42 | 1.0000 | +0.01 | +0.07 | −0.14 | 0.04 | 0.36 | 1.26 | 0.1 | 0.04 | 0.04 |
| S2 | 323.50 | 344.13 | 1.0000 | +0.03 | +0.01 | −0.01 | 0.04 | 0.36 | 0.06 | 0.1 | 0.04 | 0.04 |
| R2 | 2.50 | 15.08 | 1.0000 | −0.03 | −1.04 | −0.38 | 0.03 | 0.29 | 6.77 | 0.1 | 0.03 | 0.04 |
| K2 | 91.10 | 341.55 | 1.0000 | 0.00 | +0.00 | −0.00 | 0.01 | 0.36 | 0.23 | 0.0 | 0.01 | 0.06 |
| MSN2 | 1.30 | 190.29 | 1.0000 | −0.00 | −0.22 | +0.64 | 0.02 | 0.36 | 15.73 | 0.0 | 0.02 | 0.02 |
| ETA2 | 4.00 | 0.04 | 1.0000 | −0.00 | −0.07 | +0.04 | 0.00 | 0.33 | 4.75 | 0.0 | 0.00 | 0.06 |
| MO3 | 6.50 | 246.14 | 0.9997 | −0.01 | −0.21 | +0.24 | 0.03 | 0.27 | 2.41 | 0.1 | 0.03 | 0.03 |
| M3 | 3.20 | 178.47 | 0.9997 | −0.06 | −1.79 | −0.03 | 0.06 | 0.27 | 4.86 | 0.2 | 0.06 | 0.05 |
| SO3 | 2.70 | 332.86 | 0.9997 | +0.03 | +1.14 | +0.66 | 0.04 | 0.27 | 5.74 | 0.1 | 0.04 | 0.04 |
| MK3 | 2.20 | 4.01 | 0.9997 | +0.06 | +2.92 | +0.20 | 0.06 | 0.27 | 6.87 | 0.2 | 0.06 | 0.06 |
| SK3 | 4.90 | 113.09 | 0.9996 | 0.00 | −0.01 | +0.04 | 0.00 | 0.27 | 3.18 | 0.0 | 0.00 | 0.03 |
| MN4 | 21.70 | 196.58 | 0.9974 | +0.01 | +0.04 | −0.02 | 0.01 | 0.78 | 2.05 | 0.0 | 0.06 | 0.02 |
| M4 | 53.80 | 236.59 | 0.9972 | +0.03 | +0.06 | −0.02 | 0.04 | 0.78 | 0.83 | 0.0 | 0.19 | 0.03 |
| SN4 | 7.10 | 314.44 | 0.9970 | +0.05 | +0.67 | −0.13 | 0.05 | 0.78 | 6.28 | 0.1 | 0.07 | 0.03 |
| MS4 | 35.00 | 328.77 | 0.9968 | +0.04 | +0.11 | −0.06 | 0.05 | 0.78 | 1.28 | 0.1 | 0.16 | 0.01 |
| MK4 | 10.30 | 327.28 | 0.9967 | +0.04 | +0.39 | +0.06 | 0.04 | 0.79 | 4.40 | 0.1 | 0.07 | 0.02 |
| S4 | 3.40 | 170.11 | 0.9963 | +0.02 | +0.70 | −0.39 | 0.03 | 0.79 | 13.19 | 0.0 | 0.04 | 0.04 |
| 2MK5 | 6.70 | 5.95 | 0.9825 | +0.02 | +0.32 | −0.19 | 0.03 | 0.23 | 1.97 | 0.1 | 0.14 | 0.03 |
| 2SK5 | 0.70 | 279.64 | 0.9783 | −0.00 | −0.20 | −0.15 | 0.00 | 0.23 | 19.05 | 0.0 | 0.01 | 0.02 |
| 2MN6 | 3.60 | 227.25 | 0.9359 | +0.01 | +0.16 | +0.02 | 0.01 | 0.08 | 1.31 | 0.1 | 0.25 | 0.00 |
| M6 | 6.10 | 257.43 | 0.9328 | +0.00 | +0.06 | +0.16 | 0.02 | 0.08 | 0.77 | 0.2 | 0.44 | 0.05 |
| 2MS6 | 5.20 | 305.94 | 0.9267 | +0.06 | +1.20 | −0.20 | 0.06 | 0.08 | 0.90 | 0.6 | 0.48 | 0.04 |
| 2MK6 | 1.40 | 308.11 | 0.9262 | −0.07 | −5.04 | +0.51 | 0.07 | 0.08 | 3.63 | 0.7 | 0.04 | 0.04 |
| 2SM6 | 1.10 | 343.08 | 0.9203 | +0.04 | +3.38 | +0.73 | 0.04 | 0.08 | 4.15 | 0.4 | 0.14 | 0.05 |
| MSK6 | 0.70 | 350.62 | 0.9197 | −0.02 | −2.73 | −1.89 | 0.03 | 0.08 | 7.02 | 0.3 | 0.05 | 0.03 |
| 3MK7 | 0.10 | 323.61 | 0.7948 | −0.02 | −18.35 | −5.33 | 0.02 | 0.04 | 25.04 | 0.3 | 0.01 | 0.01 |
| M8 | 0.20 | 169.33 | 0.5815 | −0.03 | −17.46 | +1.96 | 0.03 | 0.03 | 9.61 | 0.6 | 0.08 | 0.02 |

### Tregde (`kartverket/TRG`)

2006-01-01 to 2020-12-31: 131,203 hourly values. SA over 1991 to 2020 is 83.2 mm at 298.7°, 1.4 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 82.10 | 299.33 | 1.0000 | +7.01 | +8.54 | −1.66 | 7.44 | 8.63 | 5.55 | 0.8 | 7.44 | 7.40 |
| SSA | 16.10 | 179.60 | 1.0000 | +0.01 | +0.05 | +0.03 | 0.01 | 8.63 | 30.71 | 0.0 | 0.01 | 0.07 |
| MM | 24.50 | 180.47 | 1.0000 | +0.03 | +0.11 | −0.06 | 0.04 | 8.63 | 20.16 | 0.0 | 0.04 | 0.15 |
| MF | 15.50 | 187.91 | 1.0000 | +0.04 | +0.26 | +0.14 | 0.06 | 8.63 | 31.82 | 0.0 | 0.06 | 0.26 |
| SIG1 | 3.60 | 67.55 | 1.0000 | −0.05 | −1.45 | −0.03 | 0.05 | 1.09 | 17.58 | 0.0 | 0.05 | 0.09 |
| Q1 | 4.60 | 190.12 | 1.0000 | +0.01 | +0.16 | −0.04 | 0.01 | 1.08 | 13.46 | 0.0 | 0.01 | 0.11 |
| RHO1 | 1.50 | 193.43 | 1.0000 | +0.05 | +3.40 | −0.12 | 0.05 | 1.10 | 40.49 | 0.0 | 0.05 | 0.09 |
| O1 | 15.60 | 277.73 | 1.0000 | −0.00 | −0.02 | +0.07 | 0.02 | 1.09 | 4.01 | 0.0 | 0.02 | 0.04 |
| PI1 | 1.40 | 64.83 | 1.0000 | +0.01 | +0.80 | +0.82 | 0.02 | 1.07 | 43.62 | 0.0 | 0.02 | 0.05 |
| P1 | 2.00 | 106.98 | 1.0000 | +0.05 | +2.55 | +0.61 | 0.06 | 1.07 | 29.99 | 0.0 | 0.06 | 0.06 |
| S1 | 3.20 | 267.21 | 1.0000 | +0.05 | +1.48 | +0.93 | 0.07 | 1.53 | 26.93 | 0.0 | 0.07 | 0.01 |
| K1 | 4.30 | 35.75 | 1.0000 | +0.07 | +1.63 | −0.23 | 0.07 | 1.09 | 14.24 | 0.1 | 0.07 | 0.09 |
| OO1 | 1.10 | 333.16 | 1.0000 | +0.10 | +9.29 | +0.65 | 0.10 | 0.97 | 46.06 | 0.1 | 0.10 | 0.06 |
| EPS2 | 4.70 | 236.43 | 1.0000 | +0.06 | +1.32 | −0.06 | 0.06 | 0.74 | 8.89 | 0.1 | 0.06 | 0.03 |
| 2N2 | 3.70 | 13.88 | 1.0000 | +0.04 | +1.14 | +0.19 | 0.04 | 0.73 | 11.14 | 0.1 | 0.04 | 0.08 |
| MU2 | 18.90 | 272.24 | 1.0000 | +0.02 | +0.08 | −0.04 | 0.02 | 0.75 | 2.27 | 0.0 | 0.02 | 0.04 |
| N2 | 23.70 | 55.30 | 1.0000 | +0.01 | +0.06 | +0.00 | 0.01 | 0.75 | 1.82 | 0.0 | 0.02 | 0.05 |
| NU2 | 8.30 | 90.84 | 1.0000 | −0.00 | −0.02 | +0.11 | 0.02 | 0.75 | 5.19 | 0.0 | 0.02 | 0.03 |
| H1 | 9.50 | 217.75 | 1.0000 | 0.00 | +0.00 | −0.17 | 0.03 | 0.75 | 4.52 | 0.0 | 0.03 | 0.03 |
| M2 | 94.30 | 99.97 | 1.0000 | −0.01 | −0.01 | +0.01 | 0.01 | 0.75 | 0.46 | 0.0 | 0.01 | 0.00 |
| H2 | 7.60 | 351.01 | 1.0000 | −0.01 | −0.12 | +0.01 | 0.01 | 0.75 | 5.70 | 0.0 | 0.01 | 0.01 |
| MKS2 | 3.10 | 17.32 | 1.0000 | +0.02 | +0.73 | −0.51 | 0.04 | 0.76 | 14.01 | 0.0 | 0.04 | 0.03 |
| LDA2 | 4.90 | 196.38 | 1.0000 | −0.01 | −0.19 | −0.32 | 0.03 | 0.75 | 8.80 | 0.0 | 0.03 | 0.04 |
| L2 | 9.10 | 195.83 | 1.0000 | +0.01 | +0.10 | −0.01 | 0.01 | 0.75 | 4.70 | 0.0 | 0.01 | 0.02 |
| T2 | 3.10 | 59.01 | 1.0000 | +0.04 | +1.16 | −0.18 | 0.04 | 0.76 | 13.84 | 0.0 | 0.04 | 0.05 |
| S2 | 23.80 | 44.78 | 1.0000 | −0.03 | −0.12 | +0.04 | 0.03 | 0.76 | 1.83 | 0.0 | 0.03 | 0.08 |
| R2 | 1.00 | 203.55 | 1.0000 | +0.05 | +4.65 | +0.56 | 0.05 | 0.61 | 33.58 | 0.1 | 0.05 | 0.05 |
| K2 | 5.90 | 41.68 | 1.0000 | −0.02 | −0.36 | +0.09 | 0.02 | 0.76 | 7.42 | 0.0 | 0.02 | 0.00 |
| MSN2 | 1.80 | 109.34 | 1.0000 | −0.03 | −1.89 | −1.13 | 0.05 | 0.75 | 24.23 | 0.0 | 0.05 | 0.03 |
| MO3 | 0.90 | 323.70 | 0.9997 | −0.06 | −6.37 | −0.03 | 0.06 | 0.13 | 8.54 | 0.4 | 0.06 | 0.05 |
| M3 | 1.20 | 11.47 | 0.9997 | −0.01 | −0.47 | +0.07 | 0.01 | 0.12 | 5.88 | 0.0 | 0.01 | 0.01 |
| SO3 | 0.50 | 118.43 | 0.9997 | −0.02 | −4.49 | −3.43 | 0.04 | 0.13 | 15.07 | 0.2 | 0.04 | 0.03 |
| MK3 | 1.00 | 142.06 | 0.9997 | −0.02 | −1.83 | −0.03 | 0.02 | 0.12 | 7.28 | 0.1 | 0.02 | 0.03 |
| MN4 | 0.10 | 262.36 | 0.9974 | +0.00 | +0.86 | −9.88 | 0.02 | 0.05 | 26.76 | 0.4 | 0.02 | 0.02 |
| S4 | 0.10 | 173.66 | 0.9963 | +0.03 | +28.55 | −3.84 | 0.03 | 0.05 | 21.30 | 0.4 | 0.03 | 0.03 |
| 2MK5 | 0.50 | 177.81 | 0.9825 | −0.02 | −4.75 | +0.61 | 0.02 | 0.06 | 6.68 | 0.3 | 0.02 | 0.03 |
| 2SK5 | 0.10 | 120.54 | 0.9783 | −0.01 | −8.40 | −21.34 | 0.04 | 0.06 | 34.82 | 0.6 | 0.04 | 0.01 |
| 2MN6 | 1.10 | 63.46 | 0.9359 | −0.03 | −2.78 | +0.18 | 0.03 | 0.05 | 2.67 | 0.4 | 0.04 | 0.04 |
| M6 | 2.10 | 96.01 | 0.9328 | −0.01 | −0.65 | +0.06 | 0.01 | 0.05 | 1.36 | 0.2 | 0.14 | 0.01 |
| 2MS6 | 2.40 | 163.11 | 0.9267 | +0.02 | +0.89 | +0.40 | 0.03 | 0.05 | 1.18 | 0.3 | 0.21 | 0.07 |
| 2MK6 | 0.70 | 164.01 | 0.9262 | −0.03 | −4.52 | −0.24 | 0.03 | 0.05 | 4.38 | 0.4 | 0.02 | 0.01 |
| 2SM6 | 0.60 | 226.97 | 0.9203 | +0.04 | +6.68 | −2.89 | 0.05 | 0.05 | 4.47 | 0.6 | 0.10 | 0.05 |
| MSK6 | 0.40 | 226.60 | 0.9197 | +0.02 | +5.56 | −2.79 | 0.03 | 0.05 | 6.86 | 0.4 | 0.06 | 0.01 |
| 3MK7 | 0.10 | 219.58 | 0.7948 | −0.02 | −15.97 | +11.01 | 0.02 | 0.04 | 26.27 | 0.4 | 0.02 | 0.00 |
| M8 | 0.50 | 247.27 | 0.5815 | −0.00 | −0.69 | +1.25 | 0.01 | 0.03 | 2.87 | 0.4 | 0.35 | 0.01 |

### Vardø (`kartverket/VAW`)

2006-01-01 to 2020-12-31: 131,386 hourly values.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 114.70 | 329.36 | 1.0000 | −5.61 | −4.89 | −1.31 | 6.17 | 10.86 | 5.71 | 0.5 | 6.17 | 6.30 |
| MM | 20.30 | 185.09 | 1.0000 | +0.05 | +0.24 | −0.10 | 0.06 | 10.86 | 30.59 | 0.0 | 0.06 | 0.31 |
| MF | 16.80 | 191.84 | 1.0000 | +0.06 | +0.33 | −0.05 | 0.06 | 10.86 | 36.92 | 0.0 | 0.06 | 0.45 |
| 2Q1 | 5.10 | 322.85 | 1.0000 | −0.01 | −0.27 | +0.00 | 0.01 | 0.54 | 6.11 | 0.0 | 0.01 | 0.06 |
| SIG1 | 5.20 | 332.82 | 1.0000 | −0.03 | −0.66 | +0.17 | 0.04 | 0.55 | 6.14 | 0.1 | 0.04 | 0.09 |
| Q1 | 19.60 | 10.49 | 1.0000 | +0.05 | +0.23 | −0.03 | 0.05 | 0.55 | 1.60 | 0.1 | 0.05 | 0.07 |
| RHO1 | 3.70 | 14.54 | 1.0000 | −0.02 | −0.53 | −0.36 | 0.03 | 0.56 | 8.68 | 0.0 | 0.03 | 0.02 |
| O1 | 24.50 | 68.87 | 1.0000 | −0.02 | −0.10 | +0.06 | 0.03 | 0.56 | 1.30 | 0.0 | 0.03 | 0.09 |
| TAU1 | 1.40 | 247.79 | 1.0000 | +0.04 | +2.95 | +0.43 | 0.04 | 0.52 | 20.50 | 0.1 | 0.04 | 0.04 |
| NO1 | 4.50 | 219.08 | 1.0000 | −0.06 | −1.24 | −0.05 | 0.06 | 0.49 | 6.37 | 0.1 | 0.06 | 0.03 |
| PI1 | 2.30 | 215.82 | 1.0000 | +0.03 | +1.23 | +0.05 | 0.03 | 0.55 | 13.45 | 0.1 | 0.03 | 0.05 |
| P1 | 34.10 | 247.76 | 1.0000 | +0.04 | +0.12 | −0.01 | 0.04 | 0.55 | 0.92 | 0.1 | 0.04 | 0.07 |
| S1 | 9.40 | 344.90 | 1.0000 | +0.06 | +0.66 | +0.14 | 0.07 | 0.78 | 4.70 | 0.1 | 0.07 | 0.03 |
| K1 | 121.50 | 252.61 | 1.0000 | +0.02 | +0.01 | +0.01 | 0.03 | 0.55 | 0.26 | 0.0 | 0.03 | 0.03 |
| PSI1 | 0.90 | 331.84 | 1.0000 | −0.00 | −0.50 | −0.22 | 0.01 | 0.55 | 35.11 | 0.0 | 0.01 | 0.05 |
| PHI1 | 1.90 | 246.15 | 1.0000 | −0.03 | −1.60 | +0.36 | 0.03 | 0.55 | 16.77 | 0.1 | 0.03 | 0.07 |
| THE1 | 1.40 | 280.97 | 1.0000 | +0.03 | +2.02 | −0.63 | 0.03 | 0.55 | 22.14 | 0.1 | 0.03 | 0.01 |
| J1 | 7.90 | 276.63 | 1.0000 | −0.01 | −0.06 | −0.04 | 0.01 | 0.54 | 3.89 | 0.0 | 0.01 | 0.04 |
| SO1 | 1.80 | 246.95 | 1.0000 | +0.04 | +2.00 | +0.62 | 0.04 | 0.56 | 17.32 | 0.1 | 0.04 | 0.08 |
| OO1 | 3.10 | 331.61 | 1.0000 | −0.01 | −0.27 | −0.14 | 0.01 | 0.49 | 9.11 | 0.0 | 0.01 | 0.02 |
| OQ2 | 3.50 | 10.59 | 1.0000 | −0.02 | −0.59 | +0.41 | 0.03 | 0.44 | 7.27 | 0.1 | 0.03 | 0.02 |
| EPS2 | 5.50 | 9.30 | 1.0000 | −0.03 | −0.54 | +0.05 | 0.03 | 0.46 | 4.84 | 0.1 | 0.03 | 0.07 |
| 2N2 | 30.20 | 45.56 | 1.0000 | −0.04 | −0.14 | −0.02 | 0.04 | 0.45 | 0.86 | 0.1 | 0.04 | 0.06 |
| MU2 | 24.30 | 36.94 | 1.0000 | −0.03 | −0.10 | −0.04 | 0.03 | 0.47 | 1.11 | 0.1 | 0.03 | 0.01 |
| N2 | 223.30 | 73.51 | 1.0000 | −0.04 | −0.02 | −0.02 | 0.08 | 0.47 | 0.12 | 0.1 | 0.08 | 0.08 |
| NU2 | 44.10 | 78.85 | 1.0000 | −0.02 | −0.05 | −0.01 | 0.02 | 0.47 | 0.61 | 0.0 | 0.02 | 0.06 |
| GAM2 | 3.10 | 93.17 | 1.0000 | +0.00 | +0.04 | −0.21 | 0.01 | 0.46 | 8.53 | 0.0 | 0.01 | 0.04 |
| H1 | 14.20 | 92.24 | 1.0000 | +0.05 | +0.33 | +0.04 | 0.05 | 0.47 | 1.89 | 0.1 | 0.05 | 0.04 |
| M2 | 1024.40 | 102.98 | 1.0000 | −0.01 | −0.00 | −0.00 | 0.07 | 0.47 | 0.03 | 0.2 | 0.07 | 0.08 |
| H2 | 13.50 | 0.36 | 1.0000 | −0.09 | −0.63 | +0.04 | 0.09 | 0.47 | 2.02 | 0.2 | 0.09 | 0.05 |
| MKS2 | 5.80 | 70.04 | 1.0000 | −0.03 | −0.49 | −0.05 | 0.03 | 0.48 | 4.75 | 0.1 | 0.03 | 0.05 |
| LDA2 | 10.20 | 135.74 | 1.0000 | −0.02 | −0.22 | −0.00 | 0.02 | 0.47 | 2.65 | 0.0 | 0.02 | 0.00 |
| L2 | 29.40 | 134.73 | 1.0000 | −0.03 | −0.11 | +0.00 | 0.03 | 0.47 | 0.91 | 0.1 | 0.03 | 0.06 |
| T2 | 12.30 | 133.35 | 1.0000 | +0.00 | +0.02 | −0.11 | 0.02 | 0.47 | 2.21 | 0.0 | 0.02 | 0.03 |
| S2 | 284.90 | 147.84 | 1.0000 | −0.01 | −0.00 | −0.01 | 0.07 | 0.47 | 0.10 | 0.1 | 0.07 | 0.06 |
| R2 | 3.00 | 290.75 | 1.0000 | −0.01 | −0.32 | +0.35 | 0.02 | 0.38 | 7.36 | 0.0 | 0.02 | 0.03 |
| K2 | 80.80 | 146.42 | 1.0000 | +0.01 | +0.01 | +0.00 | 0.01 | 0.48 | 0.34 | 0.0 | 0.01 | 0.03 |
| MSN2 | 2.60 | 51.45 | 1.0000 | −0.03 | −1.02 | −0.25 | 0.03 | 0.47 | 10.42 | 0.1 | 0.03 | 0.05 |
| ETA2 | 3.10 | 150.89 | 1.0000 | +0.02 | +0.52 | +0.12 | 0.02 | 0.43 | 7.98 | 0.0 | 0.02 | 0.04 |
| MO3 | 2.50 | 254.89 | 0.9997 | −0.03 | −1.38 | −0.61 | 0.04 | 0.13 | 3.07 | 0.2 | 0.04 | 0.03 |
| M3 | 1.40 | 151.23 | 0.9997 | −0.02 | −1.58 | +0.14 | 0.02 | 0.13 | 5.36 | 0.2 | 0.02 | 0.02 |
| SO3 | 2.40 | 311.48 | 0.9997 | −0.03 | −1.16 | +0.33 | 0.03 | 0.13 | 3.19 | 0.2 | 0.03 | 0.03 |
| MK3 | 1.70 | 290.85 | 0.9997 | −0.00 | −0.14 | +0.58 | 0.02 | 0.13 | 4.43 | 0.1 | 0.02 | 0.01 |
| SK3 | 1.10 | 337.94 | 0.9996 | −0.01 | −0.79 | −0.59 | 0.01 | 0.13 | 6.91 | 0.1 | 0.01 | 0.02 |
| MN4 | 5.00 | 36.82 | 0.9974 | −0.01 | −0.28 | −0.03 | 0.01 | 0.16 | 1.83 | 0.1 | 0.00 | 0.02 |
| M4 | 14.00 | 67.70 | 0.9972 | −0.01 | −0.05 | −0.03 | 0.01 | 0.16 | 0.65 | 0.0 | 0.03 | 0.01 |
| SN4 | 1.20 | 99.50 | 0.9970 | +0.05 | +3.84 | −0.06 | 0.05 | 0.16 | 7.40 | 0.3 | 0.05 | 0.05 |
| MS4 | 11.10 | 135.67 | 0.9968 | +0.04 | +0.37 | +0.10 | 0.05 | 0.16 | 0.83 | 0.2 | 0.08 | 0.03 |
| MK4 | 3.10 | 137.43 | 0.9967 | +0.02 | +0.79 | +0.09 | 0.03 | 0.16 | 2.99 | 0.1 | 0.03 | 0.03 |
| S4 | 1.20 | 258.21 | 0.9963 | −0.03 | −2.45 | +0.30 | 0.03 | 0.16 | 7.92 | 0.2 | 0.03 | 0.02 |
| SK4 | 0.30 | 230.66 | 0.9963 | +0.00 | +1.45 | +2.79 | 0.02 | 0.16 | 30.58 | 0.1 | 0.02 | 0.02 |
| 2MK5 | 0.90 | 163.31 | 0.9825 | −0.02 | −1.65 | −0.46 | 0.02 | 0.09 | 5.58 | 0.1 | 0.01 | 0.02 |
| 2SK5 | 0.10 | 90.21 | 0.9783 | +0.03 | +25.36 | −5.26 | 0.03 | 0.09 | 39.52 | 0.3 | 0.03 | 0.03 |
| 2MN6 | 2.30 | 323.99 | 0.9359 | −0.04 | −1.92 | +0.44 | 0.05 | 0.06 | 1.62 | 0.5 | 0.11 | 0.03 |
| M6 | 4.30 | 3.52 | 0.9328 | +0.07 | +1.57 | −0.23 | 0.07 | 0.06 | 0.84 | 0.8 | 0.38 | 0.07 |
| 2MS6 | 3.20 | 53.15 | 0.9267 | +0.05 | +1.53 | −0.01 | 0.05 | 0.06 | 1.13 | 0.6 | 0.31 | 0.07 |
| 2MK6 | 0.90 | 48.39 | 0.9262 | +0.06 | +6.62 | −1.89 | 0.07 | 0.07 | 3.91 | 0.7 | 0.14 | 0.05 |
| 2SM6 | 0.90 | 82.00 | 0.9203 | +0.00 | +0.32 | −0.23 | 0.01 | 0.06 | 4.06 | 0.1 | 0.08 | 0.01 |
| MSK6 | 0.50 | 83.10 | 0.9197 | 0.00 | −0.07 | −2.32 | 0.02 | 0.07 | 7.44 | 0.3 | 0.05 | 0.02 |
| 3MK7 | 0.20 | 43.67 | 0.7948 | +0.02 | +11.09 | −0.52 | 0.02 | 0.03 | 7.70 | 0.4 | 0.08 | 0.03 |
| M8 | 0.50 | 142.70 | 0.5815 | −0.03 | −7.05 | −0.11 | 0.03 | 0.02 | 2.17 | 0.7 | 0.30 | 0.03 |

### Viker (`kartverket/VIK`)

2006-01-01 to 2020-12-31: 131,222 hourly values. SA over 1991 to 2020 is 82.4 mm at 285.2°, 1.5 mm from Kartverket's.

| Constituent | Kartverket A (mm) | Kartverket g (°) | Gain | ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Without the gain: vector (mm) | Filtered in time: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 80.90 | 285.16 | 1.0000 | +10.96 | +13.55 | −3.06 | 11.89 | 15.08 | 9.40 | 0.7 | 11.89 | 11.25 |
| SSA | 31.40 | 205.66 | 1.0000 | −0.02 | −0.06 | +0.18 | 0.10 | 15.07 | 27.54 | 0.0 | 0.10 | 0.76 |
| MM | 29.30 | 174.93 | 1.0000 | −0.01 | −0.03 | −0.20 | 0.10 | 15.08 | 29.49 | 0.0 | 0.10 | 0.45 |
| MF | 16.90 | 171.23 | 1.0000 | +0.03 | +0.17 | −0.35 | 0.11 | 15.08 | 51.03 | 0.0 | 0.11 | 0.36 |
| SIG1 | 3.50 | 71.68 | 1.0000 | −0.03 | −1.01 | +0.40 | 0.04 | 1.20 | 19.90 | 0.0 | 0.04 | 0.07 |
| Q1 | 6.20 | 207.92 | 1.0000 | −0.03 | −0.43 | +0.45 | 0.06 | 1.20 | 11.10 | 0.0 | 0.06 | 0.05 |
| RHO1 | 1.70 | 205.73 | 1.0000 | +0.02 | +1.17 | −0.49 | 0.03 | 1.21 | 40.35 | 0.0 | 0.03 | 0.02 |
| O1 | 22.70 | 278.40 | 1.0000 | +0.10 | +0.45 | −0.01 | 0.10 | 1.21 | 3.03 | 0.1 | 0.10 | 0.14 |
| P1 | 3.50 | 138.23 | 1.0000 | −0.01 | −0.24 | −1.03 | 0.06 | 1.19 | 19.47 | 0.1 | 0.06 | 0.11 |
| S1 | 8.90 | 304.18 | 1.0000 | −0.02 | −0.21 | +0.59 | 0.09 | 1.69 | 10.88 | 0.1 | 0.09 | 0.12 |
| EPS2 | 6.30 | 239.53 | 1.0000 | −0.03 | −0.43 | +0.32 | 0.04 | 0.96 | 8.80 | 0.0 | 0.04 | 0.04 |
| 2N2 | 4.40 | 18.64 | 1.0000 | −0.02 | −0.45 | +0.16 | 0.02 | 0.95 | 12.40 | 0.0 | 0.02 | 0.10 |
| MU2 | 24.60 | 275.01 | 1.0000 | −0.03 | −0.13 | +0.04 | 0.04 | 0.98 | 2.28 | 0.0 | 0.04 | 0.09 |
| N2 | 29.60 | 60.65 | 1.0000 | −0.05 | −0.17 | +0.00 | 0.05 | 0.98 | 1.90 | 0.1 | 0.05 | 0.10 |
| NU2 | 10.90 | 95.38 | 1.0000 | −0.08 | −0.75 | −0.00 | 0.08 | 0.98 | 5.19 | 0.1 | 0.08 | 0.04 |
| H1 | 12.80 | 219.16 | 1.0000 | −0.01 | −0.10 | −0.09 | 0.02 | 0.98 | 4.38 | 0.0 | 0.02 | 0.06 |
| M2 | 122.80 | 107.68 | 1.0000 | −0.04 | −0.03 | −0.01 | 0.04 | 0.98 | 0.46 | 0.0 | 0.04 | 0.08 |
| H2 | 9.70 | 355.08 | 1.0000 | −0.03 | −0.30 | +0.20 | 0.05 | 0.98 | 5.83 | 0.0 | 0.05 | 0.06 |
| MKS2 | 4.10 | 19.89 | 1.0000 | −0.07 | −1.77 | −0.48 | 0.08 | 0.99 | 14.16 | 0.1 | 0.08 | 0.04 |
| LDA2 | 6.60 | 201.10 | 1.0000 | +0.06 | +0.92 | −0.12 | 0.06 | 0.98 | 8.43 | 0.1 | 0.06 | 0.07 |
| L2 | 12.50 | 199.45 | 1.0000 | −0.02 | −0.15 | +0.05 | 0.02 | 0.97 | 4.47 | 0.0 | 0.02 | 0.04 |
| T2 | 3.80 | 63.39 | 1.0000 | −0.02 | −0.62 | −0.37 | 0.03 | 0.99 | 14.99 | 0.0 | 0.03 | 0.04 |
| S2 | 28.50 | 49.83 | 1.0000 | −0.02 | −0.07 | +0.03 | 0.03 | 0.99 | 1.99 | 0.0 | 0.03 | 0.05 |
| R2 | 1.40 | 199.97 | 1.0000 | −0.08 | −5.97 | −0.16 | 0.08 | 0.80 | 34.81 | 0.1 | 0.08 | 0.07 |
| K2 | 6.80 | 46.04 | 1.0000 | +0.06 | +0.89 | −0.21 | 0.06 | 0.99 | 8.29 | 0.1 | 0.07 | 0.09 |
| MSN2 | 2.50 | 114.01 | 1.0000 | +0.00 | +0.06 | +0.37 | 0.02 | 0.97 | 22.30 | 0.0 | 0.02 | 0.11 |
| MO3 | 2.10 | 319.72 | 0.9997 | −0.04 | −2.11 | −0.55 | 0.05 | 0.31 | 8.67 | 0.1 | 0.05 | 0.03 |
| M3 | 3.00 | 18.67 | 0.9997 | −0.07 | −2.31 | +0.75 | 0.08 | 0.30 | 5.94 | 0.2 | 0.08 | 0.07 |
| SO3 | 1.40 | 114.89 | 0.9997 | −0.07 | −4.88 | −0.63 | 0.07 | 0.31 | 13.39 | 0.2 | 0.07 | 0.03 |
| MK3 | 2.50 | 143.62 | 0.9997 | +0.06 | +2.52 | +0.91 | 0.07 | 0.31 | 6.91 | 0.2 | 0.07 | 0.03 |
| MN4 | 4.20 | 244.10 | 0.9974 | −0.00 | −0.04 | −0.44 | 0.03 | 0.34 | 4.64 | 0.1 | 0.03 | 0.04 |
| M4 | 13.00 | 281.93 | 0.9972 | +0.05 | +0.41 | +0.07 | 0.06 | 0.34 | 1.49 | 0.2 | 0.09 | 0.06 |
| SN4 | 0.70 | 159.20 | 0.9970 | +0.03 | +4.06 | +0.97 | 0.03 | 0.34 | 26.98 | 0.1 | 0.03 | 0.08 |
| MS4 | 4.40 | 356.81 | 0.9968 | −0.04 | −0.98 | −0.01 | 0.04 | 0.34 | 4.51 | 0.1 | 0.03 | 0.06 |
| MK4 | 1.10 | 357.55 | 0.9967 | +0.06 | +5.88 | −0.91 | 0.07 | 0.35 | 17.10 | 0.2 | 0.07 | 0.06 |
| S4 | 0.60 | 324.37 | 0.9963 | −0.01 | −0.98 | +1.76 | 0.02 | 0.34 | 33.28 | 0.1 | 0.02 | 0.06 |
| 2MK5 | 0.90 | 342.47 | 0.9825 | −0.04 | −4.90 | +0.70 | 0.05 | 0.09 | 5.69 | 0.4 | 0.03 | 0.02 |
| 2SK5 | 0.20 | 285.79 | 0.9783 | −0.03 | −15.65 | −0.14 | 0.03 | 0.09 | 28.95 | 0.3 | 0.03 | 0.04 |
| 2MN6 | 3.30 | 244.36 | 0.9359 | −0.03 | −0.93 | −0.04 | 0.03 | 0.14 | 2.44 | 0.2 | 0.19 | 0.01 |
| M6 | 6.20 | 279.20 | 0.9328 | +0.07 | +1.16 | +0.03 | 0.07 | 0.14 | 1.27 | 0.5 | 0.52 | 0.08 |
| 2MS6 | 6.60 | 352.95 | 0.9267 | +0.01 | +0.16 | −0.19 | 0.03 | 0.14 | 1.20 | 0.2 | 0.53 | 0.04 |
| 2MK6 | 1.90 | 354.25 | 0.9262 | −0.04 | −2.15 | +0.73 | 0.05 | 0.14 | 4.39 | 0.3 | 0.11 | 0.04 |
| 2SM6 | 1.50 | 64.04 | 0.9203 | +0.06 | +3.95 | −0.62 | 0.06 | 0.14 | 5.11 | 0.4 | 0.20 | 0.05 |
| MSK6 | 1.00 | 62.49 | 0.9197 | −0.01 | −1.00 | +2.49 | 0.04 | 0.14 | 8.16 | 0.3 | 0.09 | 0.04 |
| 3MK7 | 0.20 | 119.15 | 0.7948 | −0.03 | −12.88 | −0.99 | 0.03 | 0.07 | 21.85 | 0.3 | 0.02 | 0.03 |
| M8 | 0.40 | 9.62 | 0.5815 | +0.06 | +13.89 | −0.44 | 0.06 | 0.03 | 3.37 | 1.0 | 0.38 | 0.07 |
