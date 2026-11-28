# Calibration of the harmonic fits against NOAA's constants

NOAA CO-OPS publishes harmonic constants for its own gauges, analyzed from its own observations of them, which the store holds as `coops`, under Schureman's nodal corrections, which the [fits](../fits.md) use too. This report fits 20 of those gauges from the store and compares the constants with NOAA's, constituent by constituent. It is written by [`scripts/calibrate-fits.ts`](../../scripts/calibrate-fits.ts) (`npm run calibrate:fits`), with every number in [fit-calibration.json](fit-calibration.json), and is run again whenever the method changes. [Checks](../contributing/checks.md#fit-calibration) says how to run it.

These fits ran with @slackwater/engine@1.0.0-beta.15, method 1 of [`src/fit/`](../../src/fit/), Schureman's nodal corrections, and 2025 as the source's last year of final values.

## What is compared

NOAA's constants are from the CO-OPS metadata API (`/mdapi/prod/webapi/stations/<id>/harcon.json?units=metric`), which gives amplitudes in meters, to the millimeter, and Greenwich phase lags in UTC (`phase_GMT`), to a tenth of a degree. Each station's constants carry a comment naming the years they were analyzed from, which is the harmonic analysis period and not the station's tidal datum epoch. NOAA fits each year by itself by least squares, with the equilibrium argument taken at the start of the year and the node factors at mid-year, and publishes the vector average of the years ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), pp. 41 and 94). Its long-period constituents come from other spans, or are left out, as each comment says.

Three fits of the store's hourly final values are compared with them:

- **NOAA's years.** The store's method, [`fitSamples`](../../src/fit/window.ts), over the years NOAA analyzed. The years are the same, so the differences are the method's: one fit over all the years with node factors at each sample, robust weights, and the candidate list in place of NOAA's constituents.
- **Standard.** The fit the store publishes, `fitStation`: the 19 years before the held-out year. Its differences also hold whatever the tide has changed by between the two periods.
- **NOAA's method.** Each of NOAA's years fitted by itself, without robust weights, with NOAA's constituents and the node factors at mid-year, and the years vector averaged. It is a diagnostic: where it agrees with NOAA and the store's method doesn't, the method is the cause and not the data.

A constituent is **outside** where its amplitude or phase differs from NOAA's by more than the fit's 95% interval, widened in quadrature by half of NOAA's last digit (0.5 mm and 0.05°). NOAA publishes no intervals, so the test has only the fit's. The ratio in the tables is the difference over that widened half-width, the larger of amplitude's and phase's. The vector difference is the length of the difference of the two constants as vectors, which is the amplitude of the curve the two would predict apart. Constituents slower than 2.5° an hour are counted apart, since NOAA's are from other years.

## Summary

|  | NOAA's years | Standard, 19 years |
| --- | ---: | ---: |
| Constituents compared | 639 | 647 |
| Outside the fit's interval | 126 of 639 (19.7%) | 436 of 647 (67.4%) |
| Outside and over 1 mm apart | 85 | 251 |
| Median vector difference | 0.50 mm | 0.72 mm |
| Major constituents of 1 cm or more | 147, 31 outside | 147, 124 outside |
| Their amplitude difference, median and largest | 0.49% and 13.69% | 1.05% and 12.20% |
| Their phase difference, median and largest | 0.22° and 5.73° | 0.59° and 8.78° |

The major constituents are M2, S2, N2, K2, K1, O1, P1, Q1. Long-period constituents are left out of these counts and are in each station's table.

### What agrees

- **NOAA's method on the store's values gives NOAA's constants.** Fitted NOAA's way, 523 of 618 short-period constants are within 0.5 mm of NOAA's as vectors, which is half of NOAA's last digit, and 603 are within 1 mm. The major constituents of 1 cm or more differ by a median of 0.28% in amplitude and 0.04° in phase, and at most by 4.75% and 1.13°. Those constants score within 0.2 mm RMS of NOAA's own on the held-out year at each of the 20 stations. The comparison reads the store's hourly values with Schureman's corrections as the engine has them and Greenwich phase lags in UTC, so an error in any of the three would show here as a difference from NOAA.
- **The store's method over NOAA's years, on the major constituents.** Their amplitudes differ by a median of 0.49% and their phases by 0.22°. 31 of 147 are outside the fit's interval, and the next section says which steps of the method move them.
- **The standard fit predicts the held-out year better than NOAA's constants at 17 of 18 stations** whose NOAA analysis didn't read that year; the rest: Anchorage. It explains 71.9% to 99.9% of the tidal band's variance, the least at Baltimore.

- **The shallow-water compounds.** With the compounds, over the standard window and on the held-out year, the RMS is lower at 12 and higher at 0 of 20 stations, and falls most at Anchorage, by 43.0 mm. On the year before the window the RMS is lower at 12 and higher at 1 of 20 stations (Honolulu +0.2 mm), and falls most at Anchorage, by 45.3 mm. Over NOAA's years, 5 or 6 at a station, on the held-out year the RMS is lower at 10 and higher at 3 of 18 stations (Honolulu +0.5 mm, Kwajalein, Marshall Islands +0.1 mm, Pago Pago, American Samoa +0.6 mm), and falls most at Anchorage, by 40.6 mm. A change under 0.1 mm counts as neither. [The shallow-water compounds](#the-shallow-water-compounds) has each station.

### What differs, and why

In the fit of NOAA's years, 126 of 639 short-period constants are outside the fit's interval, counting the 27 NOAA publishes as zero, which the counts by constituent here leave out. The constituents most often outside are M1 (17), S1 (11), M2 (11), M4 (8), L2 (8), 2MK3 (7), P1 (6). [Where the differences come from](#where-the-differences-come-from) takes the method apart one step at a time, and the counts here are of the step that moves a constant furthest:

- **Robust weights.** With them the amplitude is higher than in the same fit without them for M2 at 15 of 20 (median +0.16%), S2 at 15 of 20 (median +0.16%), O1 at 15 of 20 (median +0.42%), M4 at 17 of 20 (median +2.79%). M2 moves most at Philadelphia (11.4 mm of 826), Anchorage (6.4 mm of 3505), The Battery (6.2 mm of 671). They are the largest of the four steps for 10 of M2's 11 outside and 7 of M4's 8 outside. On the held-out year they leave the tidal-band RMS lower at 7 and higher at 6 of 18, from −1.9 to +0.8 mm, a change under 0.1 mm counting as neither. NOAA's analysis has no such weights.
- **M1 is held as NO1.** The candidate list has the line under both names, and selection keeps the earlier one, with the node factor the engine gives that name and not NOAA's for M1. 17 of 20 are outside, and the step to the candidate list is the largest for 13 of M1's 17 outside. That step changes the rest of the list too, so the fit of NOAA's years was run again with only the name changed back: as M1, 18 of 20 are outside. The name alone doesn't account for the difference.
- **2MK3 is held as MO3.** The candidate list has the line under both names, and selection keeps the earlier one, with the node factor the engine gives that name and not NOAA's for 2MK3. 7 of 17 are outside, and the step to the candidate list is the largest for 6 of 2MK3's 7 outside. That step changes the rest of the list too, so the fit of NOAA's years was run again with only the name changed back: as 2MK3, 2 of 17 are outside. The name accounts for most of the difference.
- **Node factors at each sample.** K1's node factor changes within a year. Held at its mid-year value, as NOAA holds it, a K1 of 1 m alone leaves 5.7 to 8.3 mm in S1 and 3.0 to 4.2 mm in P1 in a one-year fit, depending on the year, and a K2 of 1 m leaves 12.7 to 18.9 mm in R2. With node factors at each sample the same fits leave at most 0.00 mm. A year fitted NOAA's way therefore puts that part of K1 and K2 into S1, P1 and R2. It is the largest step for 10 of S1's 11 outside, 3 of P1's 6 outside and 2 of R2's 3 outside: most of S1's and R2's, and half or fewer of P1's, which it doesn't account for.
- **One fit of all years.** Fitting the years together in place of averaging yearly fits is the largest step for 7 of L2's 8 outside. L2 shares its frequency with 2MN2, whose node factor differs ([M1 and L2](../fits.md#what-it-costs)), and a line that doesn't follow L2's factor from year to year would give this. The report doesn't measure 2MN2, so that cause isn't shown.
- **The standard fit reads other years.** 436 of 647 of its constants are outside the interval, which 19 years make narrow. [Constituents across stations](#constituents-across-stations) gives how far the standard fit is from the store's own fit of NOAA's years, which is what the two periods differ by under one method: M2 is a median 2.5 mm from one period's fit to the other's and K1 1.4 mm.
- **Long-period constituents.** NOAA takes Sa, Ssa, Mm, Msf and Mf from other spans than its analysis years, as each station's comment says, or publishes zero for them. They are in each station's table and in no count.
- **NOAA's method misses NOAA's constants by over 1 mm for 15 constants:** 11 at Boston, 3 at Anchorage, 1 at South Beach. At Boston it is five or more, and this report doesn't find why. The least complete of Boston's years in the store is 2017, with 8,580 of 8,760 hours. It misses SIGMA1 at Anchorage by 7.8 mm of 47, over 5 mm, and this report doesn't find why either.

### Defects

- **Over NOAA's years the candidate list and its selection predict worse than NOAA's constituents at Anchorage.** NOAA publishes 120 constituents there, 65 of which the candidate list doesn't have. Fitted by the store's method with NOAA's constituents, NOAA's years predict the held-out year to 171.6 mm RMS. With the candidate list they give 208.9 mm, of 71 constituents kept. The standard fit, of 19 years, gives 202.3 mm, and NOAA's constants 175.5 mm. With the shallow-water compounds after the candidates the standard fit gives 159.3 mm.
- **Lines held under another name take that name's node factor.** M1 is fitted as NO1 and 2MK3 is fitted as MO3, under Schureman's corrections as the engine gives them for those names. With NOAA's names in their place and nothing else changed, the fit of NOAA's years scores the held-out year lower at 9 and higher at 0 of 18, from −2.0 to +0.1 mm, a change under 0.1 mm counting as neither.
- **None shown in the engine's solver, in Schureman's corrections for the names NOAA uses, or in the phase convention.** NOAA's method run through them gives NOAA's constants, as above, except at Boston and for SIGMA1 at Anchorage, which are open. Each step from it to the store's method is a choice [Harmonic fits](../fits.md) makes, with its effect in the tables here.

## Stations

| Station | Name | Latitude | Tide | M2 (m) | K1 (m) | NOAA's years | Why it is here |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `coops/1612340` | Honolulu | 21.3°N | mixed, mainly semidiurnal (1.01) | 0.171 | 0.149 | 2014–2018 | Mixed tide in the open Pacific at 21°N; a gauge of the nodal comparison in docs/fits.md |
| `coops/1820000` | Kwajalein, Marshall Islands | 8.7°N | semidiurnal (0.23) | 0.467 | 0.101 | 2014–2018 | Semidiurnal tide on an atoll at 9°N, the lowest latitude; a gauge of the nodal comparison |
| `coops/1770000` | Pago Pago, American Samoa | 14.3°S | semidiurnal (0.16) | 0.377 | 0.043 | 2016–2019, 2022 | The only gauge south of the equator, at 14°S; NOAA's years aren't consecutive |
| `coops/8410140` | Eastport | 44.9°N | semidiurnal (0.09) | 2.648 | 0.155 | 2015–2019 | Large semidiurnal tide at the mouth of the Bay of Fundy, M2 2.6 m |
| `coops/8443970` | Boston | 42.4°N | semidiurnal (0.16) | 1.371 | 0.143 | 2015–2019 | Semidiurnal tide, M2 1.4 m, on a record from 1921 |
| `coops/8518750` | The Battery | 40.7°N | semidiurnal (0.19) | 0.671 | 0.103 | 2018–2022 | Semidiurnal tide in a harbor at a river's mouth |
| `coops/8545240` | Philadelphia | 39.9°N | semidiurnal (0.20) | 0.826 | 0.105 | 2016–2020 | Tidal river 160 km from the sea, with large shallow-water constituents |
| `coops/8574680` | Baltimore | 39.3°N | mixed, mainly semidiurnal (0.67) | 0.152 | 0.064 | 2017–2021 | Small tide at the head of an estuary, M2 0.15 m, under large weather-driven levels |
| `coops/8638610` | Sewells Point | 36.9°N | semidiurnal (0.22) | 0.350 | 0.051 | 2015–2019 | Semidiurnal tide at the mouth of Chesapeake Bay |
| `coops/8665530` | Charleston | 32.8°N | semidiurnal (0.21) | 0.767 | 0.105 | 2017–2021 | Semidiurnal tide on the South Atlantic Bight, on a record from 1901 |
| `coops/8724580` | Key West | 24.6°N | mixed, mainly semidiurnal (0.76) | 0.179 | 0.086 | 2018–2022 | Small mixed tide between the Atlantic and the Gulf of Mexico |
| `coops/8729840` | Pensacola | 30.4°N | diurnal (11.23) | 0.017 | 0.125 | 2018–2022 | Diurnal tide in the Gulf of Mexico; a gauge of the nodal comparison |
| `coops/8761724` | Grand Isle | 29.3°N | diurnal (9.31) | 0.017 | 0.122 | 2021–2025 | Diurnal tide on the Mississippi delta; NOAA's years run to the latest |
| `coops/8771450` | Galveston Pier 21 | 29.3°N | mixed, mainly diurnal (2.33) | 0.085 | 0.130 | 2021–2025 | Mixed, mainly diurnal tide in a bay on the western Gulf of Mexico |
| `coops/9410170` | San Diego | 32.7°N | mixed, mainly semidiurnal (0.72) | 0.542 | 0.337 | 2017–2021 | Mixed tide on the Pacific coast at 33°N, on a record from 1906 |
| `coops/9435380` | South Beach | 44.6°N | mixed, mainly semidiurnal (0.62) | 0.887 | 0.434 | 2007–2012 | Mixed tide on the open Pacific coast at 45°N; an earlier analysis, of six years |
| `coops/9449880` | Friday Harbor | 48.5°N | mixed, mainly diurnal (1.73) | 0.557 | 0.760 | 2011–2016 | Mixed, mainly diurnal tide in the Salish Sea, K1 0.76 m |
| `coops/9455920` | Anchorage | 61.2°N | semidiurnal (0.23) | 3.505 | 0.671 | 2012–2016 | The largest tide, M2 3.5 m at 61°N, with ice in winter; NOAA publishes 120 constituents |
| `coops/9462620` | Unalaska | 53.9°N | mixed, mainly diurnal (1.91) | 0.269 | 0.335 | 2020–2024 | Mixed, mainly diurnal tide in the Aleutians at 54°N |
| `coops/9751639` | Charlotte Amalie | 18.3°N | mixed, mainly diurnal (2.80) | 0.041 | 0.080 | 2007–2012 | Small mixed, mainly diurnal tide in the Caribbean, K1 0.08 m |

The tide is named from the form number, (K1 + O1) / (M2 + S2) of NOAA's amplitudes, in brackets: under 0.25 semidiurnal, to 1.5 mixed and mainly semidiurnal, to 3 mixed and mainly diurnal, and diurnal above.

The copy of the store these fits read marked `coops/9410170`, `coops/9435380`, `coops/9449880` as being written, which the fit's reader refuses. The script checks for every station that each year file in the copy has a row in the copy's years file with that file's version, and stops where one doesn't. With that shown, it drops the marker and reads those stations as it reads the rest.

## Variance explained

The share of the tidal band's variance each set of constants explains on the standard fit's held-out year, and the tidal-band RMS of what is left, both after the Godin filter ([Scores](../fits.md#scores)). NOAA's constants are predicted with the same predictor and Schureman's corrections. A figure in brackets is from constants whose analysis read the held-out year.

| Station | Held-out year | Standard | NOAA's years | NOAA's constants | Standard RMS (mm) | NOAA's years RMS (mm) | NOAA's constants RMS (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `coops/1612340` Honolulu | 2025 | 98.57% | 98.46% | 98.49% | 23.0 | 23.9 | 23.6 |
| `coops/1820000` Kwajalein, Marshall Islands | 2025 | 99.61% | 99.56% | 99.55% | 24.4 | 25.9 | 26.3 |
| `coops/1770000` Pago Pago, American Samoa | 2025 | 99.61% | 99.59% | 99.59% | 17.3 | 17.7 | 17.8 |
| `coops/8410140` Eastport | 2025 | 99.81% | 99.81% | 99.76% | 83.1 | 82.6 | 93.8 |
| `coops/8443970` Boston | 2025 | 99.62% | 99.62% | 99.58% | 61.1 | 60.9 | 64.1 |
| `coops/8518750` The Battery | 2025 | 97.90% | 97.84% | 97.69% | 72.4 | 73.3 | 75.9 |
| `coops/8545240` Philadelphia | 2025 | 97.33% | 97.26% | 96.57% | 103.9 | 105.2 | 117.6 |
| `coops/8574680` Baltimore | 2025 | 71.95% | 71.71% | 71.58% | 77.5 | 77.8 | 78.0 |
| `coops/8638610` Sewells Point | 2025 | 97.13% | 97.07% | 96.98% | 44.4 | 44.9 | 45.6 |
| `coops/8665530` Charleston | 2025 | 99.02% | 98.97% | 98.71% | 55.5 | 56.9 | 63.6 |
| `coops/8724580` Key West | 2025 | 98.60% | 98.60% | 98.48% | 20.1 | 20.1 | 20.9 |
| `coops/8729840` Pensacola | 2025 | 95.61% | 95.68% | 95.53% | 30.8 | 30.5 | 31.0 |
| `coops/8761724` Grand Isle | 2025 | 96.14% | (96.32%) | (96.18%) | 28.9 | (28.2) | (28.7) |
| `coops/8771450` Galveston Pier 21 | 2025 | 91.30% | (91.49%) | (91.33%) | 50.5 | (49.9) | (50.4) |
| `coops/9410170` San Diego | 2025 | 99.88% | 99.87% | 99.80% | 18.6 | 19.4 | 23.5 |
| `coops/9435380` South Beach | 2025 | 99.83% | 99.82% | 99.78% | 31.7 | 31.9 | 36.0 |
| `coops/9449880` Friday Harbor | 2025 | 99.71% | 99.69% | 99.52% | 44.6 | 46.6 | 57.6 |
| `coops/9455920` Anchorage | 2025 | 99.43% | 99.39% | 99.57% | 202.3 | 208.9 | 175.5 |
| `coops/9462620` Unalaska | 2025 | 99.23% | 99.09% | 99.00% | 34.2 | 37.2 | 39.1 |
| `coops/9751639` Charlotte Amalie | 2025 | 96.62% | 96.53% | 96.31% | 16.6 | 16.9 | 17.4 |

## Constituents across stations

For each of NOAA's constituents, over the stations where NOAA's amplitude is above zero and the fit kept the constituent: the median differences from NOAA's, without sign, and how many are outside the fit's interval. The last two columns are the standard fit against the store's own fit of NOAA's years, which is what the two periods differ by under one method, and NOAA's method on the store's values against NOAA's constants.

| Constituent | NOAA's years: stations | Amplitude (mm) | Amplitude (%) | Phase (°) | Vector (mm) | Outside | Standard: stations | Vector (mm) | Outside | Standard against NOAA's years: vector (mm) | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 17 | 8.27 | 9.0 | 3.89 | 13.78 | 11 | 18 | 9.17 | 16 | 10.57 | 12.24 |
| SSA | 13 | 3.02 | 9.1 | 2.62 | 5.54 | 3 | 16 | 5.59 | 7 | 7.35 | 5.64 |
| MM | 5 | 0.67 | 13.3 | 4.84 | 2.27 | 0 | 7 | 1.08 | 1 | 4.00 | 1.45 |
| MSF | 2 | 4.51 | 10.7 | 0.61 | 5.00 | 0 | 3 | 4.90 | 0 | 4.64 | 2.23 |
| MF | 8 | 1.14 | 8.2 | 5.88 | 3.11 | 0 | 9 | 3.01 | 1 | 5.53 | 1.39 |
| 2Q1 | 18 | 0.50 | 17.2 | 8.45 | 0.69 | 0 | 19 | 0.89 | 10 | 0.78 | 0.17 |
| SIGMA1 | 1 | 6.02 | 12.8 | 10.61 | 10.11 | 1 | 1 | 9.58 | 1 | 1.38 | 7.83 |
| Q1 | 20 | 0.45 | 2.3 | 0.83 | 0.65 | 2 | 20 | 0.93 | 15 | 0.70 | 0.24 |
| RHO | 20 | 0.37 | 7.2 | 4.21 | 0.55 | 0 | 20 | 0.61 | 10 | 0.33 | 0.30 |
| O1 | 20 | 0.44 | 0.5 | 0.14 | 0.53 | 4 | 20 | 1.03 | 17 | 0.94 | 0.36 |
| M1 (as NO1) | 20 | 2.00 | 41.3 | 17.80 | 2.92 | 17 | 20 | 3.14 | 20 | 1.07 | 0.28 |
| CHI1 | 1 | 1.07 | 15.3 | 21.05 | 2.95 | 1 | 1 | 4.71 | 1 | 1.77 | 0.25 |
| P1 | 20 | 0.43 | 1.2 | 0.53 | 0.85 | 6 | 20 | 0.84 | 13 | 0.77 | 0.38 |
| S1 | 20 | 0.75 | 9.6 | 4.89 | 1.26 | 11 | 20 | 1.57 | 17 | 0.88 | 0.27 |
| K1 | 20 | 0.26 | 0.2 | 0.22 | 0.67 | 2 | 20 | 1.62 | 17 | 1.42 | 0.26 |
| THETA1 | 1 | 1.67 | 13.9 | 1.89 | 1.71 | 0 | 1 | 4.66 | 1 | 3.49 | 0.25 |
| J1 | 20 | 0.44 | 6.2 | 1.45 | 0.50 | 0 | 20 | 0.73 | 13 | 0.67 | 0.26 |
| SO1 | 1 | 0.57 | 0.8 | 3.71 | 4.85 | 1 | 1 | 0.40 | 0 | 5.22 | 0.25 |
| OO1 | 20 | 0.34 | 5.2 | 2.52 | 0.46 | 1 | 20 | 0.59 | 8 | 0.57 | 0.31 |
| 2N2 | 19 | 0.27 | 2.2 | 0.65 | 0.41 | 0 | 19 | 1.40 | 13 | 1.02 | 0.28 |
| MU2 | 20 | 0.37 | 3.7 | 1.89 | 0.48 | 3 | 20 | 0.66 | 14 | 0.35 | 0.19 |
| N2 | 20 | 0.21 | 0.3 | 0.18 | 0.34 | 1 | 20 | 1.19 | 17 | 1.28 | 0.24 |
| NU2 | 20 | 0.48 | 3.5 | 0.62 | 0.54 | 3 | 20 | 0.65 | 11 | 0.32 | 0.25 |
| M2 | 20 | 0.83 | 0.2 | 0.09 | 1.10 | 11 | 20 | 2.05 | 20 | 2.50 | 0.37 |
| MKS2 | 1 | 2.92 | 18.2 | 2.77 | 3.00 | 0 | 1 | 3.64 | 1 | 5.68 | 0.53 |
| LAM2 | 19 | 0.30 | 5.3 | 4.08 | 0.45 | 1 | 19 | 0.51 | 12 | 0.52 | 0.18 |
| L2 | 19 | 0.49 | 5.3 | 0.95 | 0.72 | 8 | 19 | 1.87 | 17 | 1.04 | 0.26 |
| T2 | 20 | 0.34 | 5.4 | 1.52 | 0.41 | 2 | 20 | 0.80 | 11 | 0.55 | 0.25 |
| S2 | 20 | 0.39 | 0.6 | 0.18 | 0.50 | 4 | 20 | 1.20 | 17 | 1.19 | 0.27 |
| R2 | 18 | 0.44 | 31.2 | 12.06 | 0.60 | 3 | 18 | 0.72 | 12 | 0.44 | 0.36 |
| K2 | 20 | 0.32 | 0.9 | 0.64 | 0.43 | 1 | 20 | 1.10 | 15 | 0.96 | 0.27 |
| MSN2 | 1 | 5.47 | 10.9 | 0.45 | 5.49 | 1 | 1 | 2.19 | 0 | 3.61 | 0.15 |
| 2SM2 | 16 | 0.29 | 19.1 | 3.74 | 0.42 | 2 | 16 | 0.49 | 6 | 0.29 | 0.32 |
| 2MK3 (as MO3) | 17 | 0.50 | 11.2 | 3.04 | 0.57 | 7 | 17 | 0.58 | 15 | 0.43 | 0.34 |
| M3 | 17 | 0.32 | 12.6 | 2.63 | 0.34 | 0 | 17 | 0.61 | 13 | 0.47 | 0.26 |
| SO3 | 1 | 1.94 | 3.7 | 2.77 | 3.18 | 0 | 1 | 9.47 | 1 | 6.40 | 0.39 |
| MK3 | 18 | 0.33 | 11.9 | 1.48 | 0.33 | 3 | 18 | 0.37 | 9 | 0.30 | 0.21 |
| SK3 | 1 | 1.09 | 2.6 | 6.40 | 4.75 | 1 | 1 | 5.98 | 1 | 1.47 | 0.38 |
| N4 | 1 | 1.89 | 10.5 | 4.49 | 2.31 | 0 | 1 | 2.80 | 1 | 0.66 | 0.10 |
| MN4 | 19 | 0.20 | 5.1 | 0.70 | 0.30 | 3 | 19 | 0.36 | 11 | 0.28 | 0.15 |
| M4 | 20 | 0.34 | 5.0 | 1.42 | 0.48 | 8 | 20 | 0.58 | 17 | 0.51 | 0.22 |
| SN4 | 1 | 2.47 | 11.2 | 9.81 | 4.32 | 0 | 1 | 3.52 | 1 | 0.81 | 0.04 |
| MS4 | 20 | 0.23 | 8.0 | 1.50 | 0.27 | 3 | 20 | 0.51 | 15 | 0.33 | 0.25 |
| MK4 | 1 | 0.70 | 1.6 | 4.80 | 3.70 | 0 | 1 | 2.35 | 1 | 3.69 | 0.12 |
| S4 | 17 | 0.37 | 17.0 | 4.28 | 0.37 | 1 | 18 | 0.43 | 10 | 0.22 | 0.26 |
| 2MO5 | 1 | 3.30 | 9.4 | 0.92 | 3.34 | 1 | 1 | 6.29 | 1 | 3.97 | 0.18 |
| 2MK5 | 1 | 0.61 | 1.0 | 1.51 | 1.71 | 0 | 1 | 4.74 | 1 | 3.38 | 0.19 |
| 2MN6 | 1 | 2.82 | 3.5 | 0.76 | 3.01 | 0 | 1 | 2.41 | 0 | 2.80 | 0.46 |
| M6 | 17 | 0.22 | 2.8 | 1.18 | 0.28 | 2 | 17 | 0.53 | 13 | 0.15 | 0.23 |
| 2MS6 | 1 | 7.78 | 5.4 | 0.79 | 8.01 | 1 | 1 | 3.96 | 1 | 8.50 | 0.42 |
| 2MK6 | 1 | 2.07 | 5.4 | 2.12 | 2.48 | 0 | 1 | 2.19 | 0 | 3.99 | 0.40 |
| 2SM6 | 1 | 4.73 | 17.5 | 0.27 | 4.73 | 1 | 1 | 2.53 | 0 | 2.59 | 0.35 |
| MSK6 | 1 | 0.03 | 0.1 | 1.50 | 0.45 | 0 | 1 | 2.33 | 0 | 2.22 | 0.15 |
| S6 | 9 | 0.49 | 36.3 | 4.86 | 0.50 | 3 | 9 | 0.46 | 5 | 0.08 | 0.38 |
| M8 | 11 | 0.43 | 18.1 | 2.88 | 0.44 | 3 | 11 | 0.36 | 8 | 0.12 | 0.23 |

## Where the differences come from

The store's fit of NOAA's years differs from NOAA's method in four ways, taken here one at a time on the store's values, the first three with NOAA's own constituents. Each of the four middle columns is how far that step moves the constant from the step before, as the median vector difference over the stations where NOAA's amplitude is above zero. The first column is where the chain starts: NOAA's method against NOAA's constants, which is what the data and NOAA's rounding leave. The last is where it ends.

| Constituent | Stations | NOAA's method against NOAA (mm) | Node factors at each sample (mm) | One fit of all years (mm) | Robust weights (mm) | The store's constituents (mm) | The store's fit against NOAA (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 17 | 11.76 | 0.01 | 0.23 | 5.03 | 0.33 | 13.78 |
| SSA | 13 | 4.92 | 0.01 | 0.24 | 2.52 | 0.18 | 5.54 |
| MM | 5 | 1.45 | 0.02 | 0.95 | 1.04 | 0.07 | 2.27 |
| MSF | 2 | 5.17 | 0.09 | 0.71 | 4.31 | 1.68 | 5.00 |
| MF | 8 | 1.16 | 0.15 | 1.01 | 1.48 | 0.11 | 3.11 |
| 2Q1 | 18 | 0.17 | 0.03 | 0.13 | 0.59 | 0.12 | 0.69 |
| SIGMA1 | 1 | 7.83 | 0.17 | 1.06 | 1.33 | 2.03 | 10.11 |
| Q1 | 20 | 0.24 | 0.04 | 0.13 | 0.45 | 0.10 | 0.65 |
| RHO | 20 | 0.30 | 0.02 | 0.13 | 0.27 | 0.11 | 0.55 |
| O1 | 20 | 0.36 | 0.07 | 0.15 | 0.68 | 0.11 | 0.53 |
| M1 | 20 | 0.28 | 1.63 | 0.32 | 0.27 | 1.94 | 2.92 |
| CHI1 | 1 | 0.25 | 1.56 | 2.83 | 0.38 | 0.65 | 2.95 |
| P1 | 20 | 0.38 | 0.39 | 0.03 | 0.55 | 0.29 | 0.85 |
| S1 | 20 | 0.27 | 0.76 | 0.03 | 0.52 | 0.21 | 1.26 |
| K1 | 20 | 0.26 | 0.06 | 0.16 | 0.43 | 0.21 | 0.67 |
| THETA1 | 1 | 0.25 | 0.13 | 0.38 | 0.43 | 1.26 | 1.71 |
| J1 | 20 | 0.26 | 0.03 | 0.11 | 0.39 | 0.16 | 0.50 |
| SO1 | 1 | 0.25 | 0.30 | 0.40 | 2.45 | 2.25 | 4.85 |
| OO1 | 20 | 0.31 | 0.07 | 0.30 | 0.26 | 0.09 | 0.46 |
| 2N2 | 19 | 0.28 | 0.02 | 0.07 | 0.35 | 0.12 | 0.41 |
| MU2 | 20 | 0.19 | 0.01 | 0.18 | 0.44 | 0.11 | 0.48 |
| N2 | 20 | 0.24 | 0.01 | 0.10 | 0.39 | 0.08 | 0.34 |
| NU2 | 20 | 0.25 | 0.04 | 0.15 | 0.47 | 0.09 | 0.54 |
| M2 | 20 | 0.37 | 0.06 | 0.08 | 1.61 | 0.60 | 1.10 |
| MKS2 | 1 | 0.53 | 3.89 | 0.78 | 1.80 | 4.04 | 3.00 |
| LAM2 | 19 | 0.18 | 0.28 | 0.32 | 0.32 | 0.06 | 0.45 |
| L2 | 19 | 0.26 | 0.13 | 0.46 | 0.28 | 0.08 | 0.72 |
| T2 | 20 | 0.25 | 0.08 | 0.04 | 0.29 | 0.10 | 0.41 |
| S2 | 20 | 0.27 | 0.13 | 0.04 | 0.29 | 0.11 | 0.50 |
| R2 | 18 | 0.33 | 0.34 | 0.03 | 0.27 | 0.09 | 0.60 |
| K2 | 20 | 0.27 | 0.04 | 0.10 | 0.24 | 0.11 | 0.43 |
| MSN2 | 1 | 0.15 | 0.15 | 0.07 | 0.69 | 4.59 | 5.49 |
| 2SM2 | 16 | 0.30 | 0.02 | 0.05 | 0.31 | 0.08 | 0.42 |
| 2MK3 | 17 | 0.34 | 0.00 | 0.03 | 0.27 | 0.28 | 0.57 |
| M3 | 17 | 0.26 | 0.00 | 0.02 | 0.13 | 0.06 | 0.34 |
| SO3 | 1 | 0.39 | 0.38 | 0.33 | 0.87 | 3.41 | 3.18 |
| MK3 | 18 | 0.21 | 0.01 | 0.02 | 0.21 | 0.07 | 0.33 |
| SK3 | 1 | 0.38 | 0.10 | 0.14 | 0.37 | 4.52 | 4.75 |
| N4 | 1 | 0.10 | 0.04 | 0.11 | 0.64 | 2.77 | 2.31 |
| MN4 | 19 | 0.15 | 0.00 | 0.02 | 0.23 | 0.04 | 0.30 |
| M4 | 20 | 0.22 | 0.00 | 0.03 | 0.31 | 0.07 | 0.48 |
| SN4 | 1 | 0.04 | 0.49 | 0.44 | 0.25 | 5.31 | 4.32 |
| MS4 | 20 | 0.25 | 0.00 | 0.01 | 0.13 | 0.05 | 0.27 |
| MK4 | 1 | 0.12 | 0.27 | 0.17 | 0.47 | 3.02 | 3.70 |
| S4 | 17 | 0.26 | 0.00 | 0.01 | 0.15 | 0.03 | 0.37 |
| 2MO5 | 1 | 0.18 | 0.08 | 0.23 | 1.57 | 2.09 | 3.34 |
| 2MK5 | 1 | 0.19 | 0.12 | 0.03 | 0.87 | 1.45 | 1.71 |
| 2MN6 | 1 | 0.46 | 0.48 | 0.32 | 0.68 | 3.05 | 3.01 |
| M6 | 17 | 0.23 | 0.00 | 0.01 | 0.12 | 0.05 | 0.28 |
| 2MS6 | 1 | 0.42 | 0.23 | 0.09 | 0.75 | 7.39 | 8.01 |
| 2MK6 | 1 | 0.40 | 0.42 | 0.21 | 0.48 | 2.26 | 2.48 |
| 2SM6 | 1 | 0.35 | 0.09 | 0.03 | 0.42 | 4.78 | 4.73 |
| MSK6 | 1 | 0.15 | 0.01 | 0.22 | 1.03 | 1.24 | 0.45 |
| S6 | 9 | 0.38 | 0.00 | 0.01 | 0.12 | 0.05 | 0.50 |
| M8 | 11 | 0.23 | 0.01 | 0.02 | 0.15 | 0.05 | 0.44 |

The same steps scored on the held-out year: the tidal-band RMS of observed minus predicted, in millimeters, for the constants each step gives. The steps before the last hold every constituent NOAA publishes for the station that the engine's catalog has, and the last two columns hold the candidate list's. A figure in brackets is from constants fitted from years that include the held-out one.

| Station | NOAA's constants | NOAA's method | Node factors at each sample | One fit of all years | Robust weights | The store's constituents | Standard, 19 years |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `coops/1612340` Honolulu | 23.6 | 23.5 | 23.4 | 23.4 | 23.2 | 23.9 | 23.0 |
| `coops/1820000` Kwajalein, Marshall Islands | 26.3 | 26.2 | 26.2 | 26.2 | 26.3 | 25.9 | 24.4 |
| `coops/1770000` Pago Pago, American Samoa | 17.8 | 17.7 | 17.7 | 17.7 | 18.0 | 17.7 | 17.3 |
| `coops/8410140` Eastport | 93.8 | 93.9 | 93.8 | 93.6 | 92.7 | 82.6 | 83.1 |
| `coops/8443970` Boston | 64.1 | 64.3 | 64.1 | 64.0 | 63.8 | 60.9 | 61.1 |
| `coops/8518750` The Battery | 75.9 | 75.8 | 75.7 | 75.7 | 75.7 | 73.3 | 72.4 |
| `coops/8545240` Philadelphia | 117.6 | 117.5 | 117.5 | 117.4 | 115.5 | 105.2 | 103.9 |
| `coops/8574680` Baltimore | 78.0 | 78.0 | 77.9 | 77.9 | 78.2 | 77.8 | 77.5 |
| `coops/8638610` Sewells Point | 45.6 | 45.4 | 45.4 | 45.4 | 45.6 | 44.9 | 44.4 |
| `coops/8665530` Charleston | 63.6 | 63.7 | 63.6 | 63.3 | 62.9 | 56.9 | 55.5 |
| `coops/8724580` Key West | 20.9 | 20.9 | 20.8 | 20.9 | 20.9 | 20.1 | 20.1 |
| `coops/8729840` Pensacola | 31.0 | 31.1 | 31.1 | 30.9 | 31.0 | 30.5 | 30.8 |
| `coops/8761724` Grand Isle | (28.7) | (28.6) | (28.6) | (28.6) | (28.6) | (28.2) | 28.9 |
| `coops/8771450` Galveston Pier 21 | (50.4) | (50.4) | (50.3) | (50.3) | (50.4) | (49.9) | 50.5 |
| `coops/9410170` San Diego | 23.5 | 23.5 | 22.3 | 22.2 | 22.2 | 19.4 | 18.6 |
| `coops/9435380` South Beach | 36.0 | 35.8 | 34.7 | 34.7 | 35.0 | 31.9 | 31.7 |
| `coops/9449880` Friday Harbor | 57.6 | 57.8 | 56.3 | 56.1 | 56.9 | 46.6 | 44.6 |
| `coops/9455920` Anchorage | 175.5 | 175.5 | 173.7 | 172.5 | 171.6 | 208.9 | 202.3 |
| `coops/9462620` Unalaska | 39.1 | 39.1 | 38.4 | 38.6 | 38.6 | 37.2 | 34.2 |
| `coops/9751639` Charlotte Amalie | 17.4 | 17.3 | 17.4 | 17.5 | 17.3 | 16.9 | 16.6 |

From each step to the next, over the 18 stations whose NOAA years don't include the held-out one, the RMS is: with node factors at each sample, lower at 7 and higher at 1, from −1.8 to +0.1 mm; with one fit of all years, lower at 8 and higher at 1, from −1.2 to +0.2 mm; with robust weights, lower at 7 and higher at 6, from −1.9 to +0.8 mm; and with the store's constituents, lower at 16 and higher at 2, from −10.3 to +37.3 mm. A change under 0.1 mm counts as neither.

## The shallow-water compounds

No fit starts from the shallow-water compounds NOAA publishes for Anchorage beyond its 37 ([`SHALLOW`](../../src/fit/candidates.ts)). Here each gauge is fitted again with them after the candidate list, over the standard window and over NOAA's years, so the report shows what they would change. The held-out year is the evidence they were proposed on, so it can't also test them. The year before the window was read by neither fit and has judged no choice of candidates. A figure in brackets is from constants fitted from years that include the held-out one.

| Station | Standard: kept without | Kept with | Held-out year: without (mm) | With (mm) | Year before | Without (mm) | With (mm) | NOAA's years: kept without | Kept with | Held-out year: without (mm) | With (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `coops/1612340` Honolulu | 71 | 112 | 23.0 | 23.1 | 2005 | 23.4 | 23.6 | 60 | 90 | 23.9 | 24.4 |
| `coops/1820000` Kwajalein, Marshall Islands | 67 | 102 | 24.4 | 24.5 | 2005 | 25.0 | 24.8 | 61 | 88 | 25.9 | 26.1 |
| `coops/1770000` Pago Pago, American Samoa | 66 | 98 | 17.3 | 17.2 | 2005 | 20.9 | 20.9 | 54 | 81 | 17.7 | 18.3 |
| `coops/8410140` Eastport | 70 | 124 | 83.1 | 81.2 | 2005 | 81.0 | 78.5 | 63 | 113 | 82.6 | 81.3 |
| `coops/8443970` Boston | 73 | 128 | 61.1 | 59.9 | 2005 | 62.0 | 60.7 | 62 | 112 | 60.9 | 60.0 |
| `coops/8518750` The Battery | 74 | 127 | 72.4 | 71.8 | 2005 | 74.0 | 73.4 | 65 | 112 | 73.3 | 72.7 |
| `coops/8545240` Philadelphia | 71 | 128 | 103.9 | 99.8 | 2005 | 104.0 | 98.6 | 61 | 117 | 105.2 | 101.2 |
| `coops/8574680` Baltimore | 65 | 103 | 77.5 | 77.5 | 2005 | 81.1 | 81.1 | 57 | 91 | 77.8 | 77.8 |
| `coops/8638610` Sewells Point | 69 | 120 | 44.4 | 44.3 | 2005 | 48.1 | 48.1 | 63 | 107 | 44.9 | 44.8 |
| `coops/8665530` Charleston | 71 | 128 | 55.5 | 55.1 | 2005 | 60.0 | 59.4 | 66 | 113 | 56.9 | 56.7 |
| `coops/8724580` Key West | 73 | 127 | 20.1 | 19.9 | 2005 | 23.3 | 23.2 | 67 | 118 | 20.1 | 19.9 |
| `coops/8729840` Pensacola | 73 | 109 | 30.8 | 30.7 | 2005 | 41.0 | 41.0 | 61 | 93 | 30.5 | 30.4 |
| `coops/8761724` Grand Isle | 67 | 102 | 28.9 | 28.9 | 2005 | 33.2 | 33.2 | 61 | 86 | (28.2) | (28.2) |
| `coops/8771450` Galveston Pier 21 | 68 | 109 | 50.5 | 50.4 | 2005 | 53.6 | 53.6 | 59 | 89 | (49.9) | (49.9) |
| `coops/9410170` San Diego | 72 | 124 | 18.6 | 18.2 | 2005 | 19.1 | 18.7 | 69 | 109 | 19.4 | 19.0 |
| `coops/9435380` South Beach | 73 | 129 | 31.7 | 31.0 | 2005 | 31.4 | 30.6 | 70 | 122 | 31.9 | 31.3 |
| `coops/9449880` Friday Harbor | 73 | 128 | 44.6 | 44.0 | 2005 | 43.2 | 42.4 | 69 | 124 | 46.6 | 46.1 |
| `coops/9455920` Anchorage | 75 | 131 | 202.3 | 159.3 | 2005 | 206.3 | 161.0 | 71 | 129 | 208.9 | 168.2 |
| `coops/9462620` Unalaska | 73 | 119 | 34.2 | 34.0 | 2005 | 32.9 | 32.7 | 69 | 109 | 37.2 | 37.1 |
| `coops/9751639` Charlotte Amalie | 74 | 108 | 16.6 | 16.5 | 2005 | 17.0 | 17.0 | 66 | 98 | 16.9 | 16.8 |

With the compounds, over the standard window and on the held-out year, the RMS is lower at 12 and higher at 0 of 20 stations, and falls most at Anchorage, by 43.0 mm. On the year before the window the RMS is lower at 12 and higher at 1 of 20 stations (Honolulu +0.2 mm), and falls most at Anchorage, by 45.3 mm. Over NOAA's years, 5 or 6 at a station, on the held-out year the RMS is lower at 10 and higher at 3 of 18 stations (Honolulu +0.5 mm, Kwajalein, Marshall Islands +0.1 mm, Pago Pago, American Samoa +0.6 mm), and falls most at Anchorage, by 40.6 mm. A change under 0.1 mm counts as neither.

## Each station

NOAA's constants, then each fit's difference from them, the fit's minus NOAA's. ±A and ±g are the half-widths of the fit's 95% intervals. A ratio in bold is outside the interval. Where a fit holds a line under another name, the name is in brackets. A fit without the constituent says why: `snr` is under the signal-to-noise limit, `rayleigh` names the constituent the record can't separate it from, and `seasonal` is Sa or Ssa under twice the standard error of its yearly fits.

### Honolulu (`coops/1612340`)

NOAA: "Vector Average of 5 years, 2014-2018. Sa, Mm, and Mf from 17 years (1998-2018)." NOAA's years, 2014–2018: 43,820 hourly values, 60 constituents kept. Standard, 2006 to 2024: 166,490 hourly values, 71 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 48 | 177.7 | −2.5 | −5.3 | −5.4 | 5.1 | 4.3 | 5.4 | 1.0 | +4.9 | +3.4 | 5.7 | **1.7** | 6.8 |
| SSA | 0 | 0.0 | +15.0 |  |  | 15.0 | 4.3 | 16.7 | **3.5** | +8.7 |  | 8.7 | **2.9** | 16.1 |
| MM | 5 | 43.4 | −0.7 | −13.3 | −13.3 | 1.3 | 3.9 | 51.6 | 0.3 | −1.0 | −4.9 | 1.1 | 0.3 | 1.5 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 1.6 |
| MF | 6 | 44.3 | snr |  |  |  |  |  |  | +0.2 | −6.9 | 0.8 | 0.3 | 1.4 |
| 2Q1 | 1 | 231.0 | −0.1 | −9.6 | +8.8 | 0.2 | 0.5 | 31.8 | 0.3 | −0.0 | +3.8 | 0.1 | 0.3 | 0.1 |
| Q1 | 14 | 209.6 | −0.5 | −3.6 | +0.6 | 0.5 | 0.5 | 2.1 | 0.7 | −1.2 | −0.3 | 1.2 | **2.2** | 0.4 |
| RHO | 2 | 195.4 | +0.5 | +27.2 | +3.7 | 0.6 | 0.5 | 11.3 | 0.8 | +0.4 | +10.7 | 0.6 | **2.2** | 0.6 |
| O1 | 81 | 215.9 | −0.3 | −0.3 | −0.1 | 0.3 | 0.5 | 0.4 | 0.4 | +0.0 | −0.2 | 0.3 | **1.2** | 0.0 |
| M1 | 5 | 232.5 | +2.0 (NO1) | +39.5 | −21.4 | 2.9 | 0.5 | 4.0 | **5.3** | +2.4 (NO1) | −14.0 | 2.8 | **8.7** | 0.3 |
| P1 | 45 | 224.9 | +1.0 | +2.2 | −0.5 | 1.0 | 0.4 | 0.5 | **1.5** | +0.1 | +0.2 | 0.2 | 0.8 | 0.6 |
| S1 | 2 | 210.0 | −1.4 | −67.6 | −20.4 | 1.4 | 0.4 | 37.4 | **2.1** | −1.5 | +14.4 | 1.5 | **2.8** | 0.1 |
| K1 | 149 | 226.8 | −0.1 | −0.1 | −0.0 | 0.1 | 0.5 | 0.2 | 0.1 | +0.3 | −0.2 | 0.7 | **2.5** | 0.2 |
| J1 | 10 | 238.3 | −0.6 | −5.9 | −0.7 | 0.6 | 0.5 | 3.0 | 0.8 | −0.6 | +0.6 | 0.7 | **1.2** | 0.5 |
| OO1 | 5 | 251.7 | +0.5 | +9.9 | −3.7 | 0.6 | 0.7 | 7.7 | 0.6 | +0.9 | +4.4 | 1.0 | **2.6** | 0.4 |
| 2N2 | 4 | 39.9 | −0.1 | −2.2 | −0.4 | 0.1 | 1.0 | 14.0 | 0.1 | +0.2 | −2.4 | 0.2 | 0.3 | 0.0 |
| MU2 | 4 | 7.8 | +0.2 | +4.3 | −0.2 | 0.2 | 1.0 | 13.1 | 0.2 | +0.2 | +0.9 | 0.2 | 0.3 | 0.4 |
| N2 | 33 | 48.8 | +0.6 | +1.8 | +0.8 | 0.8 | 1.0 | 1.6 | 0.6 | +0.4 | −0.4 | 0.5 | 0.6 | 0.2 |
| NU2 | 7 | 56.0 | −0.5 | −7.3 | +1.2 | 0.5 | 1.0 | 8.4 | 0.5 | −0.4 | −0.5 | 0.4 | 0.5 | 0.1 |
| M2 | 171 | 59.4 | +0.6 | +0.3 | +0.3 | 1.0 | 1.0 | 0.3 | 0.9 | −1.0 | +0.0 | 1.0 | **1.4** | 0.2 |
| LAM2 | 1 | 76.2 | −0.2 | −23.8 | +10.4 | 0.3 | 1.0 | 71.8 | 0.2 | −0.2 | −38.4 | 0.6 | **1.0** | 0.1 |
| L2 | 4 | 49.3 | −0.4 | −9.4 | +9.2 | 0.7 | 0.9 | 14.8 | 0.6 | −0.4 | +10.9 | 0.8 | **1.3** | 0.5 |
| T2 | 4 | 43.6 | −0.3 | −7.7 | +1.2 | 0.3 | 1.0 | 15.3 | 0.3 | −0.7 | +8.4 | 0.9 | 0.9 | 0.1 |
| S2 | 56 | 54.7 | −0.6 | −1.0 | −0.2 | 0.6 | 1.0 | 1.0 | 0.5 | −0.8 | +1.2 | 1.4 | **2.2** | 0.2 |
| R2 | 1 | 357.3 | −0.5 | −47.7 | −21.4 | 0.5 | 1.0 | 107.8 | 0.4 | −0.2 | +32.4 | 0.5 | 0.9 | 0.2 |
| K2 | 16 | 45.7 | −0.3 | −1.7 | +0.7 | 0.3 | 1.3 | 4.6 | 0.2 | +0.2 | −2.3 | 0.7 | **1.2** | 0.2 |
| 2SM2 | 1 | 199.8 | −0.1 | −7.5 | −1.7 | 0.1 | 1.0 | 59.1 | 0.1 | −0.1 | +21.8 | 0.4 | 0.6 | 0.2 |
| 2MK3 | 0 | 0.0 | rayleigh (MO3) |  |  |  |  |  |  | +0.3 (MO3) |  | 0.3 | 0.5 | 0.1 |
| M3 | 1 | 164.1 | +0.1 | +12.6 | +3.8 | 0.1 | 0.2 | 11.0 | 0.3 | +0.2 | +2.6 | 0.2 | 0.5 | 0.1 |
| MK3 | 1 | 342.6 | +0.3 | +28.3 | −1.2 | 0.3 | 0.2 | 10.8 | 0.5 | −0.2 | +5.1 | 0.2 | 0.7 | 0.2 |
| MN4 | 1 | 92.9 | +0.1 | +12.2 | +0.6 | 0.1 | 0.2 | 12.7 | 0.2 | −0.1 | +2.6 | 0.1 | 0.3 | 0.0 |
| M4 | 1 | 195.3 | −0.3 | −25.6 | −8.0 | 0.3 | 0.2 | 19.1 | 0.5 | +0.4 | −35.3 | 0.8 | **5.7** | 0.3 |
| MS4 | 1 | 104.0 | +0.2 | +21.8 | +7.2 | 0.3 | 0.3 | 12.0 | 0.6 | −0.1 | −0.3 | 0.1 | 0.1 | 0.2 |
| S4 | 0 | 0.0 | +0.3 |  |  | 0.3 | 0.3 | 47.2 | 0.6 | +0.3 |  | 0.3 | 0.6 | 0.4 |
| M6 | 1 | 229.7 | −0.5 | −48.2 | −0.1 | 0.5 | 0.1 | 15.9 | 0.9 | −0.6 | −1.1 | 0.6 | **1.2** | 0.6 |
| S6 | 0 | 0.0 | +0.3 |  |  | 0.3 | 0.2 | 35.7 | 0.5 | +0.2 |  | 0.2 | 0.4 | 0.2 |
| M8 | 0 | 0.0 | +0.1 |  |  | 0.1 | 0.1 | 42.0 | 0.2 | +0.2 |  | 0.2 | 0.4 | 0.1 |

### Kwajalein, Marshall Islands (`coops/1820000`)

NOAA: "Vector Averaged from 5 years 2014-2018. Sa, Mm, and Mf from average of 15 years (2000-2018)" NOAA's years, 2014–2018: 43,823 hourly values, 61 constituents kept. Standard, 2006 to 2024: 163,455 hourly values, 67 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 47 | 48.8 | seasonal |  |  |  |  |  |  | −23.2 | +29.0 | 28.6 | **10.4** | 21.9 |
| SSA | 0 | 0.0 | +31.8 |  |  | 31.8 | 3.5 | 6.3 | **9.0** | +16.4 |  | 16.4 | **7.4** | 30.1 |
| MM | 8 | 15.7 | +0.3 | +3.4 | +1.2 | 0.3 | 3.1 | 21.8 | 0.1 | −0.1 | −1.8 | 0.3 | 0.1 | 0.7 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 3.1 |
| MF | 11 | 16.5 | −0.4 | −3.4 | +4.1 | 0.9 | 5.1 | 27.3 | 0.2 | +0.5 | −2.5 | 0.7 | 0.3 | 2.0 |
| 2Q1 | 2 | 352.7 | −0.0 | −0.3 | +6.0 | 0.2 | 0.5 | 13.8 | 0.4 | −0.2 | +12.5 | 0.5 | **1.7** | 0.1 |
| Q1 | 13 | 26.0 | +0.2 | +1.6 | −0.7 | 0.3 | 0.5 | 2.1 | 0.4 | +0.6 | +0.8 | 0.7 | **1.2** | 0.2 |
| RHO | 3 | 29.2 | −0.3 | −11.5 | −1.4 | 0.4 | 0.5 | 10.3 | 0.5 | −0.6 | −0.4 | 0.6 | **1.1** | 0.3 |
| O1 | 65 | 39.6 | −0.2 | −0.4 | +0.2 | 0.3 | 0.5 | 0.4 | 0.5 | +0.1 | −0.5 | 0.6 | **2.5** | 0.4 |
| M1 | 4 | 84.2 | +1.7 (NO1) | +42.1 | −20.1 | 2.4 | 0.5 | 4.7 | **4.3** | +1.1 (NO1) | −26.4 | 2.3 | **10.2** | 0.1 |
| P1 | 32 | 67.0 | +0.5 | +1.7 | +0.3 | 0.6 | 0.4 | 0.7 | 0.9 | +0.4 | −0.7 | 0.6 | **1.8** | 0.1 |
| S1 | 5 | 249.8 | +1.2 | +24.1 | −1.8 | 1.2 | 0.4 | 3.7 | **1.9** | +0.5 | −3.9 | 0.6 | **1.6** | 0.2 |
| K1 | 101 | 65.9 | +0.2 | +0.2 | +0.0 | 0.2 | 0.4 | 0.3 | 0.3 | +0.3 | +1.2 | 2.2 | **8.6** | 0.1 |
| J1 | 6 | 87.5 | −0.6 | −9.4 | −0.0 | 0.6 | 0.5 | 4.9 | 0.8 | −1.0 | +2.1 | 1.0 | **1.8** | 0.6 |
| OO1 | 4 | 126.6 | +0.0 | +0.9 | −4.5 | 0.3 | 0.7 | 10.1 | 0.4 | −0.5 | +1.4 | 0.5 | 0.8 | 0.2 |
| 2N2 | 12 | 119.0 | +0.1 | +0.5 | +0.1 | 0.1 | 0.9 | 4.4 | 0.1 | +0.5 | +0.3 | 0.5 | 0.7 | 0.4 |
| MU2 | 16 | 129.5 | +0.1 | +0.3 | −0.5 | 0.1 | 0.9 | 3.3 | 0.1 | +0.0 | −1.0 | 0.3 | 0.6 | 0.3 |
| N2 | 88 | 126.9 | +0.2 | +0.2 | −0.0 | 0.2 | 0.9 | 0.6 | 0.2 | +1.1 | +0.1 | 1.1 | **1.6** | 0.1 |
| NU2 | 16 | 126.1 | −0.5 | −3.4 | −0.1 | 0.5 | 0.9 | 3.4 | 0.5 | +0.6 | −2.0 | 0.8 | **1.2** | 0.1 |
| M2 | 467 | 128.0 | −1.0 | −0.2 | +0.1 | 1.4 | 0.9 | 0.1 | **1.0** | −0.0 | −0.5 | 3.8 | **5.9** | 0.6 |
| LAM2 | 4 | 122.3 | −0.9 | −21.5 | −6.3 | 0.9 | 0.9 | 16.7 | 0.8 | +0.2 | −0.8 | 0.3 | 0.3 | 0.1 |
| L2 | 15 | 125.0 | +0.2 | +1.0 | +1.0 | 0.3 | 0.9 | 3.4 | 0.3 | +0.4 | +1.9 | 0.6 | **1.0** | 0.3 |
| T2 | 18 | 138.3 | +0.3 | +1.6 | +0.1 | 0.3 | 0.9 | 3.0 | 0.3 | −0.8 | +3.2 | 1.2 | **1.9** | 0.3 |
| S2 | 262 | 148.6 | +0.1 | +0.1 | +0.0 | 0.2 | 0.9 | 0.2 | 0.1 | +2.3 | −0.3 | 2.8 | **3.3** | 0.3 |
| R2 | 2 | 114.6 | +1.0 | +48.2 | +1.2 | 1.0 | 0.9 | 18.3 | 0.9 | −0.4 | −18.1 | 0.7 | **1.0** | 0.4 |
| K2 | 72 | 144.9 | +0.4 | +0.6 | +0.1 | 0.5 | 1.2 | 1.0 | 0.3 | +1.6 | −1.7 | 2.6 | **4.5** | 0.6 |
| 2SM2 | 1 | 9.7 | +0.7 | +70.7 | −0.0 | 0.7 | 0.9 | 30.7 | 0.7 | +0.6 | +3.6 | 0.6 | 0.9 | 0.4 |
| 2MK3 | 1 | 9.4 | −0.5 (MO3) | −50.4 | −5.5 | 0.5 | 0.3 | 36.0 | 0.9 | −0.8 (MO3) | −43.8 | 0.9 | **1.6** | 0.6 |
| M3 | 2 | 320.4 | +0.3 | +15.0 | +2.0 | 0.3 | 0.3 | 6.4 | 0.5 | +0.4 | −3.5 | 0.4 | **1.1** | 0.2 |
| MK3 | 0 | 0.0 | snr |  |  |  |  |  |  | +0.2 |  | 0.2 | 0.4 | 0.2 |
| MN4 | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 0.1 |
| M4 | 1 | 46.0 | +0.2 | +16.0 | +11.1 | 0.3 | 0.4 | 19.3 | 0.6 | −0.2 | −14.6 | 0.3 | 0.9 | 0.1 |
| MS4 | 1 | 129.1 | +0.4 | +43.6 | −2.2 | 0.4 | 0.4 | 16.1 | 0.7 | +0.7 | −24.5 | 0.9 | **3.5** | 0.4 |
| S4 | 0 | 0.0 | +0.5 |  |  | 0.5 | 0.4 | 52.8 | 0.7 | +0.2 |  | 0.2 | 0.5 | 0.3 |
| M6 | 1 | 276.1 | +0.0 | +1.5 | +2.7 | 0.1 | 0.2 | 12.5 | 0.2 | −0.1 | +9.3 | 0.2 | **1.2** | 0.1 |
| S6 | 0 | 0.0 | +0.3 |  |  | 0.3 | 0.2 | 48.3 | 0.5 | +0.4 |  | 0.4 | 0.7 | 0.3 |
| M8 | 0 | 0.0 | +0.1 |  |  | 0.1 | 0.1 | 57.8 | 0.3 | snr |  |  |  | 0.2 |

### Pago Pago, American Samoa (`coops/1770000`)

NOAA: "Vector Averaged of 5 years (2016-2019, 2022). MM, MF from 18 year average (2000-2022) Sa and SSa from 20 year monthly means" NOAA's years, 2016–2019, 2022: 43,793 hourly values, 54 constituents kept. Standard, 2006 to 2024: 151,869 hourly values, 66 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 12 | 205.0 | seasonal |  |  |  |  |  |  | seasonal |  |  |  | 14.4 |
| SSA | 2 | 104.1 | seasonal |  |  |  |  |  |  | seasonal |  |  |  | 1.4 |
| MM | 6 | 17.3 | −0.1 | −1.1 | +21.9 | 2.3 | 3.5 | 34.0 | 0.6 | +1.0 | −3.3 | 1.1 | 0.3 | 2.2 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 0.7 |
| MF | 10 | 23.8 | +0.5 | +5.4 | −5.8 | 1.2 | 4.0 | 22.0 | 0.3 | −0.8 | −0.6 | 0.8 | 0.3 | 0.4 |
| 2Q1 | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 0.3 |
| Q1 | 6 | 53.4 | −0.4 | −6.5 | −1.0 | 0.4 | 0.4 | 4.5 | 0.6 | −0.4 | −3.7 | 0.5 | **1.6** | 0.4 |
| RHO | 1 | 44.2 | +0.3 | +34.0 | +14.8 | 0.5 | 0.4 | 18.9 | 0.8 | +0.2 | +2.7 | 0.2 | 0.4 | 0.3 |
| O1 | 29 | 67.2 | +0.5 | +1.6 | +0.0 | 0.5 | 0.4 | 0.9 | 0.7 | −0.3 | +1.0 | 0.6 | **2.2** | 0.0 |
| M1 | 1 | 96.9 | +0.7 (NO1) | +71.5 | −23.8 | 0.9 | 0.4 | 14.5 | **1.6** | +1.2 (NO1) | −29.8 | 1.4 | **5.3** | 0.5 |
| P1 | 13 | 73.2 | −0.2 | −1.4 | −1.7 | 0.4 | 0.4 | 1.9 | 0.9 | −0.8 | −1.2 | 0.8 | **1.4** | 0.5 |
| S1 | 3 | 240.2 | −0.2 | −7.1 | +2.8 | 0.3 | 0.4 | 8.6 | 0.3 | −0.0 | −6.1 | 0.3 | **1.4** | 0.3 |
| K1 | 43 | 81.9 | +0.6 | +1.5 | −0.5 | 0.8 | 0.4 | 0.6 | 1.0 | +0.6 | −0.6 | 0.7 | **2.0** | 0.3 |
| J1 | 2 | 64.2 | −0.2 | −9.7 | +1.9 | 0.2 | 0.4 | 13.9 | 0.3 | −0.1 | +7.9 | 0.3 | **1.2** | 0.2 |
| OO1 | 1 | 127.6 | +0.1 | +5.8 | +1.9 | 0.1 | 0.5 | 24.4 | 0.1 | −0.1 | −5.1 | 0.1 | 0.4 | 0.2 |
| 2N2 | 16 | 139.9 | −0.4 | −2.2 | −0.7 | 0.4 | 0.8 | 2.9 | 0.4 | +0.0 | +0.2 | 0.1 | 0.1 | 0.2 |
| MU2 | 18 | 139.8 | +0.2 | +1.4 | +1.0 | 0.4 | 0.8 | 2.5 | 0.4 | +0.5 | +0.8 | 0.5 | 0.7 | 0.1 |
| N2 | 106 | 160.4 | +0.3 | +0.3 | +0.2 | 0.4 | 0.8 | 0.4 | 0.4 | −0.8 | +0.0 | 0.8 | **1.1** | 0.3 |
| NU2 | 20 | 161.3 | +0.5 | +2.3 | +0.6 | 0.5 | 0.8 | 2.2 | 0.5 | −0.5 | +1.3 | 0.6 | 1.0 | 0.2 |
| M2 | 377 | 179.8 | +1.2 | +0.3 | +0.4 | 2.8 | 0.8 | 0.1 | **2.9** | −1.6 | +0.1 | 1.7 | **2.3** | 0.3 |
| LAM2 | 1 | 216.4 | +0.3 | +33.0 | −8.2 | 0.4 | 0.8 | 34.5 | 0.3 | +0.5 | +9.0 | 0.5 | 0.7 | 0.1 |
| L2 | 6 | 182.1 | −0.8 | −13.5 | +0.4 | 0.8 | 0.7 | 7.9 | 0.9 | −0.6 | +10.8 | 1.2 | **2.2** | 0.5 |
| T2 | 3 | 157.5 | +0.6 | +18.5 | +1.4 | 0.6 | 0.8 | 13.1 | 0.6 | +0.6 | −9.3 | 0.8 | **1.3** | 0.3 |
| S2 | 60 | 164.9 | −0.8 | −1.4 | −0.1 | 0.8 | 0.8 | 0.8 | 0.9 | +0.1 | −0.8 | 0.8 | **1.7** | 0.6 |
| R2 | 1 | 183.9 | snr |  |  |  |  |  |  | −0.5 | −4.6 | 0.5 | 0.8 | 0.6 |
| K2 | 16 | 154.1 | −0.1 | −0.4 | −1.4 | 0.4 | 0.9 | 3.2 | 0.4 | +0.0 | −1.9 | 0.5 | **1.2** | 0.0 |
| 2SM2 | 1 | 203.1 | snr |  |  |  |  |  |  | −0.4 | +3.1 | 0.4 | 0.5 | 0.4 |
| 2MK3 | 0 | 0.0 | rayleigh (MO3) |  |  |  |  |  |  | +0.5 (MO3) |  | 0.5 | **1.0** | 0.2 |
| M3 | 4 | 19.5 | +0.2 | +4.0 | +0.8 | 0.2 | 0.2 | 3.0 | 0.3 | +0.1 | −0.8 | 0.1 | 0.5 | 0.2 |
| MK3 | 0 | 0.0 | +0.3 |  |  | 0.3 | 0.2 | 40.6 | 0.6 | +0.3 |  | 0.3 | 0.7 | 0.3 |
| MN4 | 1 | 13.8 | +0.1 | +8.6 | +17.0 | 0.3 | 0.2 | 11.1 | **1.5** | −0.3 | +5.3 | 0.4 | 0.7 | 0.2 |
| M4 | 3 | 80.6 | +0.5 | +17.6 | +3.8 | 0.6 | 0.2 | 3.4 | **1.1** | −0.1 | +8.1 | 0.4 | **2.9** | 0.1 |
| MS4 | 1 | 174.3 | +0.7 | +69.3 | +8.3 | 0.7 | 0.2 | 7.3 | **1.3** | +0.3 | +30.2 | 0.7 | **4.8** | 0.4 |
| S4 | 1 | 53.2 | −0.5 | −50.4 | −10.7 | 0.5 | 0.2 | 25.1 | 0.9 | −0.3 | −1.3 | 0.3 | 0.5 | 0.4 |
| M6 | 0 | 0.0 | +0.5 |  |  | 0.5 | 0.2 | 17.6 | **1.0** | +0.5 |  | 0.5 | 0.9 | 0.4 |
| S6 | 0 | 0.0 | +0.4 |  |  | 0.4 | 0.2 | 24.0 | 0.8 | +0.4 |  | 0.4 | 0.9 | 0.4 |
| M8 | 0 | 0.0 | snr |  |  |  |  |  |  | +0.0 |  | 0.0 | 0.1 | 0.1 |

### Eastport (`coops/8410140`)

NOAA: "Vector Average of 5 years (2015-2019). Sa and SSa from 20 year analysis." NOAA's years, 2015–2019: 43,738 hourly values, 63 constituents kept. Standard, 2006 to 2024: 165,931 hourly values, 70 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 10 | 171.5 | seasonal |  |  |  |  |  |  | seasonal |  |  |  | 0.7 |
| SSA | 13 | 126.4 | +3.0 | +23.0 | +8.6 | 3.7 | 7.9 | 28.2 | 0.4 | −3.1 | +3.2 | 3.1 | 0.7 | 1.6 |
| MM | 0 | 0.0 | +10.3 |  |  | 10.3 | 7.2 | 40.0 | **1.4** | +7.3 |  | 7.3 | **1.7** | 9.8 |
| MSF | 0 | 0.0 | +9.7 |  |  | 9.7 | 7.7 | 45.4 | **1.3** | +7.3 |  | 7.3 | **1.7** | 12.3 |
| MF | 0 | 0.0 | +10.8 |  |  | 10.8 | 10.6 | 56.3 | **1.0** | +3.7 |  | 3.7 | 0.9 | 11.7 |
| 2Q1 | 2 | 225.8 | +0.7 | +36.2 | +18.4 | 1.0 | 2.1 | 44.5 | 0.4 | −0.4 | −67.9 | 2.1 | **2.2** | 0.1 |
| Q1 | 21 | 157.9 | −1.2 | −5.5 | +1.8 | 1.3 | 2.1 | 6.1 | 0.5 | −1.3 | +3.3 | 1.8 | **1.3** | 0.8 |
| RHO | 3 | 157.8 | +0.8 | +25.6 | +4.7 | 0.8 | 2.1 | 32.3 | 0.4 | +0.5 | +5.0 | 0.6 | 0.5 | 0.5 |
| O1 | 118 | 176.3 | +0.5 | +0.4 | −0.2 | 0.6 | 2.1 | 1.0 | 0.2 | −0.8 | +1.0 | 2.2 | **2.2** | 0.4 |
| M1 | 5 | 212.9 | +2.0 (NO1) | +40.7 | −25.5 | 3.3 | 2.1 | 16.8 | **1.5** | +3.5 (NO1) | −21.3 | 4.2 | **3.5** | 0.2 |
| P1 | 51 | 196.4 | +1.5 | +2.9 | +0.7 | 1.6 | 1.8 | 2.0 | 0.8 | −0.1 | −0.8 | 0.7 | 0.8 | 0.4 |
| S1 | 7 | 124.9 | +0.6 | +8.2 | −11.6 | 1.6 | 1.8 | 14.0 | 0.8 | +1.3 | −11.5 | 2.0 | **1.8** | 0.4 |
| K1 | 155 | 195.5 | −0.7 | −0.5 | +0.5 | 1.5 | 2.0 | 0.7 | 0.6 | −2.5 | +0.4 | 2.7 | **2.4** | 0.9 |
| J1 | 7 | 207.5 | +1.5 | +21.8 | +3.0 | 1.6 | 2.1 | 14.0 | 0.7 | +1.2 | −4.0 | 1.3 | **1.1** | 0.5 |
| OO1 | 6 | 234.3 | +0.3 | +4.6 | −6.3 | 0.7 | 2.9 | 26.0 | 0.2 | −0.5 | −6.8 | 0.8 | 0.9 | 0.9 |
| 2N2 | 67 | 44.7 | −0.1 | −0.1 | −0.4 | 0.4 | 2.3 | 2.0 | 0.2 | −1.4 | +3.0 | 3.7 | **2.8** | 0.4 |
| MU2 | 15 | 166.5 | +1.8 | +11.8 | +3.5 | 2.0 | 2.3 | 7.8 | 0.8 | +4.5 | +4.8 | 4.7 | **3.5** | 0.1 |
| N2 | 542 | 67.0 | +0.5 | +0.1 | +0.2 | 1.5 | 2.3 | 0.2 | 0.6 | +6.4 | +1.3 | 13.9 | **9.7** | 0.8 |
| NU2 | 125 | 73.6 | +1.1 | +0.9 | +0.8 | 2.0 | 2.3 | 1.0 | 0.7 | +2.6 | +0.7 | 3.0 | **2.0** | 0.5 |
| M2 | 2648 | 98.4 | +3.0 | +0.1 | −0.0 | 3.3 | 2.3 | 0.0 | **1.3** | +20.1 | +0.1 | 20.7 | **15.5** | 0.5 |
| LAM2 | 51 | 122.4 | −1.5 | −3.0 | +0.7 | 1.6 | 2.3 | 2.7 | 0.7 | +1.3 | +2.3 | 2.4 | **1.7** | 0.1 |
| L2 | 157 | 141.0 | −2.4 | −1.5 | −0.2 | 2.5 | 2.3 | 0.8 | **1.0** | −15.4 | −5.1 | 20.2 | **12.1** | 0.5 |
| T2 | 36 | 115.8 | −0.6 | −1.6 | −0.5 | 0.6 | 2.4 | 3.8 | 0.2 | −1.1 | +1.2 | 1.3 | 0.8 | 0.2 |
| S2 | 415 | 138.8 | −0.4 | −0.1 | +0.0 | 0.4 | 2.4 | 0.3 | 0.1 | +2.6 | +0.3 | 3.2 | **2.0** | 0.2 |
| R2 | 8 | 348.5 | +0.3 | +3.7 | +8.1 | 1.2 | 2.4 | 16.3 | 0.5 | −0.4 | +6.0 | 0.9 | 0.7 | 0.2 |
| K2 | 116 | 138.3 | +0.4 | +0.3 | +0.1 | 0.5 | 2.9 | 1.4 | 0.1 | −0.8 | +0.3 | 1.1 | 0.7 | 0.5 |
| 2SM2 | 7 | 70.0 | −0.5 | −7.6 | +3.9 | 0.7 | 2.3 | 20.3 | 0.2 | −0.4 | +0.9 | 0.5 | 0.3 | 0.1 |
| 2MK3 | 5 | 327.1 | +0.6 (MO3) | +11.5 | −1.2 | 0.6 | 0.5 | 5.0 | 0.8 | +0.6 (MO3) | +1.7 | 0.6 | **1.0** | 0.1 |
| M3 | 2 | 216.5 | +0.6 | +29.7 | +6.0 | 0.6 | 0.4 | 9.2 | 0.9 | −0.4 | +4.4 | 0.4 | 0.7 | 0.3 |
| MK3 | 2 | 74.1 | +0.0 | +1.8 | +1.4 | 0.1 | 0.5 | 12.9 | 0.1 | +0.0 | −8.7 | 0.3 | **1.2** | 0.1 |
| MN4 | 22 | 51.7 | +0.4 | +2.0 | −0.2 | 0.4 | 0.6 | 1.6 | 0.5 | +0.9 | +2.1 | 1.2 | **4.0** | 0.1 |
| M4 | 58 | 84.8 | +0.7 | +1.2 | +0.2 | 0.7 | 0.6 | 0.6 | 0.9 | +2.0 | +0.5 | 2.1 | **3.6** | 0.3 |
| MS4 | 18 | 129.2 | +0.1 | +0.4 | +0.1 | 0.1 | 0.6 | 2.0 | 0.1 | +0.7 | +1.5 | 0.8 | **2.3** | 0.1 |
| S4 | 1 | 117.1 | +0.4 | +37.0 | +9.1 | 0.4 | 0.6 | 27.0 | 0.5 | +0.8 | +5.6 | 0.8 | **1.5** | 0.1 |
| M6 | 48 | 274.0 | +0.0 | +0.0 | +0.3 | 0.3 | 1.3 | 1.5 | 0.2 | +2.2 | +1.2 | 2.4 | **2.4** | 0.0 |
| S6 | 1 | 331.0 | snr |  |  |  |  |  |  | snr |  |  |  | 0.6 |
| M8 | 5 | 250.0 | +0.5 | +9.3 | +1.2 | 0.5 | 0.1 | 1.5 | 0.9 | +0.8 | +2.0 | 0.8 | **3.1** | 0.2 |

### Boston (`coops/8443970`)

NOAA: "Vector Average of 5 years (2015-2019). Sa and SSa from 20 year Analysis (2000-2019)" NOAA's years, 2015–2019: 43,644 hourly values, 62 constituents kept. Standard, 2006 to 2024: 166,141 hourly values, 73 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 49 | 136.3 | +9.4 | +19.3 | +3.3 | 9.9 | 9.1 | 8.9 | **1.0** | −2.7 | −0.0 | 2.7 | 0.5 | 4.6 |
| SSA | 22 | 97.5 | +0.4 | +1.7 | +0.0 | 0.4 | 9.1 | 23.3 | 0.0 | −5.2 | +0.4 | 5.2 | 1.0 | 4.4 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 9.7 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | +6.1 |  | 6.1 | **1.1** | 9.4 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | +4.8 |  | 4.8 | 1.0 | 12.2 |
| 2Q1 | 2 | 211.3 | +0.6 | +29.9 | −20.1 | 1.0 | 1.7 | 37.3 | 0.5 | +0.0 | −40.8 | 1.4 | **1.9** | 0.5 |
| Q1 | 19 | 172.1 | +0.6 | +3.1 | −2.6 | 1.1 | 1.7 | 5.0 | 0.5 | +0.8 | −1.4 | 0.9 | 0.9 | 0.4 |
| RHO | 5 | 179.3 | −0.1 | −1.5 | −5.1 | 0.4 | 1.7 | 19.7 | 0.3 | −0.9 | −3.3 | 1.0 | **1.1** | 0.5 |
| O1 | 116 | 187.1 | −0.6 | −0.5 | −0.4 | 1.0 | 1.7 | 0.8 | 0.5 | −0.8 | +0.2 | 0.9 | 0.9 | 0.8 |
| M1 | 5 | 223.2 | +1.7 (NO1) | +34.5 | −40.2 | 4.3 | 1.6 | 14.1 | **2.9** | +3.0 (NO1) | −28.6 | 4.3 | **5.3** | 0.4 |
| P1 | 47 | 204.8 | +0.7 | +1.6 | −0.6 | 0.9 | 1.5 | 1.8 | 0.5 | −0.2 | −1.6 | 1.3 | **1.7** | 1.1 |
| S1 | 5 | 131.6 | −2.3 | −46.6 | −9.3 | 2.4 | 1.5 | 31.7 | **1.5** | −2.3 | −16.6 | 2.5 | **2.5** | 2.0 |
| K1 | 143 | 205.6 | −0.8 | −0.6 | −0.6 | 1.8 | 1.6 | 0.6 | 1.0 | −2.3 | −0.6 | 2.7 | **2.6** | 1.9 |
| J1 | 10 | 210.0 | −0.9 | −8.7 | −3.8 | 1.1 | 1.7 | 10.4 | 0.5 | −1.5 | −2.3 | 1.6 | **1.7** | 1.3 |
| OO1 | 4 | 218.7 | +2.0 | +49.7 | +16.9 | 2.5 | 2.3 | 21.8 | 0.9 | +1.0 | +14.5 | 1.5 | **2.0** | 1.8 |
| 2N2 | 41 | 53.7 | +0.1 | +0.3 | +0.0 | 0.1 | 1.1 | 1.6 | 0.1 | −0.6 | +2.5 | 1.9 | **2.6** | 0.3 |
| MU2 | 10 | 53.3 | +0.1 | +1.4 | +6.3 | 1.1 | 1.1 | 6.5 | 1.0 | −0.6 | +9.0 | 1.6 | **2.2** | 1.2 |
| N2 | 305 | 76.7 | +0.8 | +0.3 | +0.2 | 1.5 | 1.1 | 0.2 | **1.1** | +4.1 | +1.4 | 8.5 | **10.4** | 1.5 |
| NU2 | 66 | 84.0 | +0.4 | +0.6 | +0.9 | 1.1 | 1.1 | 1.0 | 0.9 | +0.9 | +1.6 | 2.1 | **2.8** | 0.8 |
| M2 | 1371 | 109.2 | −0.4 | −0.0 | −0.0 | 1.2 | 1.2 | 0.0 | 0.6 | +5.1 | +0.1 | 6.0 | **6.2** | 2.0 |
| LAM2 | 20 | 140.1 | +0.4 | +1.8 | +2.8 | 1.0 | 1.1 | 3.2 | 0.9 | +1.7 | +4.1 | 2.3 | **2.3** | 0.8 |
| L2 | 68 | 160.4 | −1.9 | −2.7 | −0.8 | 2.1 | 1.1 | 1.0 | **1.5** | −9.1 | −5.3 | 10.8 | **11.1** | 1.2 |
| T2 | 18 | 120.1 | +0.1 | +0.7 | +2.3 | 0.7 | 1.2 | 3.7 | 0.6 | −0.0 | +4.7 | 1.5 | **2.2** | 1.1 |
| S2 | 208 | 146.2 | +1.4 | +0.7 | −0.2 | 1.5 | 1.2 | 0.3 | **1.1** | +1.7 | −0.0 | 1.7 | **2.0** | 1.0 |
| R2 | 4 | 13.1 | +0.6 | +14.6 | +3.2 | 0.6 | 1.2 | 14.8 | 0.5 | +0.8 | +2.1 | 0.8 | 0.9 | 0.1 |
| K2 | 59 | 146.1 | −0.7 | −1.3 | −0.2 | 0.8 | 1.4 | 1.4 | 0.5 | −1.2 | −0.6 | 1.3 | **1.5** | 0.6 |
| 2SM2 | 3 | 110.3 | −0.1 | −1.7 | +1.9 | 0.1 | 1.1 | 22.3 | 0.1 | +0.3 | −6.3 | 0.4 | 0.5 | 0.2 |
| 2MK3 | 7 | 204.7 | +0.8 (MO3) | +11.8 | −0.2 | 0.8 | 0.5 | 3.5 | **1.2** | +0.4 (MO3) | +2.6 | 0.5 | **2.0** | 0.3 |
| M3 | 2 | 149.2 | −0.2 | −9.5 | +1.9 | 0.2 | 0.4 | 12.9 | 0.3 | −0.5 | −20.6 | 0.8 | **3.2** | 0.1 |
| MK3 | 6 | 231.8 | −0.3 | −4.8 | +0.8 | 0.3 | 0.5 | 4.5 | 0.4 | −0.7 | +0.0 | 0.7 | **1.3** | 0.4 |
| MN4 | 11 | 13.7 | +0.3 | +2.7 | −0.2 | 0.3 | 0.4 | 2.0 | 0.5 | +0.3 | −0.6 | 0.4 | 0.7 | 0.1 |
| M4 | 23 | 29.0 | +0.0 | +0.2 | +0.3 | 0.1 | 0.4 | 1.0 | 0.3 | +0.3 | −1.9 | 0.8 | **4.7** | 0.3 |
| MS4 | 9 | 74.0 | −0.2 | −2.1 | +1.0 | 0.2 | 0.4 | 2.6 | 0.4 | −0.2 | −3.4 | 0.6 | **3.2** | 0.2 |
| S4 | 2 | 119.3 | +0.0 | +1.6 | +0.3 | 0.0 | 0.4 | 11.6 | 0.0 | −0.2 | −4.8 | 0.2 | 0.9 | 0.2 |
| M6 | 29 | 281.3 | +0.5 | +1.6 | +0.9 | 0.7 | 0.9 | 1.7 | 0.5 | +2.5 | +1.5 | 2.6 | **3.5** | 0.5 |
| S6 | 2 | 246.8 | −0.5 | −26.9 | −0.5 | 0.5 | 1.0 | 37.9 | 0.5 | −0.5 | +2.0 | 0.5 | 0.7 | 0.2 |
| M8 | 6 | 241.3 | −0.2 | −3.1 | −1.1 | 0.2 | 0.2 | 2.3 | 0.5 | +0.1 | −0.5 | 0.1 | 0.4 | 0.2 |

### The Battery (`coops/8518750`)

NOAA: "Vector Average of 5 years 2018-2022. SA and SSA from an average of 16 years 2002-2022." NOAA's years, 2018–2022: 43,798 hourly values, 65 constituents kept. Standard, 2006 to 2024: 166,526 hourly values, 74 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 94 | 144.6 | −2.9 | −3.1 | −0.9 | 3.3 | 11.5 | 7.3 | 0.3 | −5.3 | −6.7 | 11.9 | **1.6** | 0.1 |
| SSA | 32 | 55.3 | −5.5 | −17.2 | +1.2 | 5.5 | 11.5 | 24.8 | 0.5 | −0.4 | −0.4 | 0.5 | 0.1 | 0.8 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | +12.9 |  | 12.9 | **2.0** | 0.7 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 6.3 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | +5.4 |  | 5.4 | 0.9 | 7.6 |
| 2Q1 | 4 | 234.6 | −1.2 | −30.6 | −19.4 | 1.7 | 1.5 | 30.2 | 0.8 | −2.1 | −24.1 | 2.4 | **2.3** | 0.3 |
| Q1 | 11 | 196.6 | −0.2 | −2.1 | −5.7 | 1.1 | 1.5 | 7.8 | 0.7 | +0.2 | −7.8 | 1.5 | **2.0** | 0.5 |
| RHO | 2 | 143.9 | −0.7 | −36.5 | +17.2 | 0.9 | 1.5 | 65.9 | 0.5 | +0.0 | +50.3 | 1.7 | **2.4** | 0.1 |
| O1 | 51 | 176.3 | +0.4 | +0.7 | −1.1 | 1.0 | 1.5 | 1.6 | 0.7 | +0.6 | −1.8 | 1.8 | **2.2** | 0.1 |
| M1 | 4 | 247.4 | +1.0 (NO1) | +24.7 | −25.2 | 2.2 | 1.5 | 16.8 | **1.5** | +0.3 (NO1) | −28.1 | 2.0 | **2.8** | 0.3 |
| P1 | 33 | 178.8 | +0.2 | +0.5 | −0.3 | 0.2 | 1.5 | 2.6 | 0.1 | −1.0 | +1.4 | 1.2 | **1.0** | 0.5 |
| S1 | 13 | 132.1 | −1.2 | −9.4 | +1.9 | 1.3 | 1.5 | 7.3 | 0.8 | −0.3 | +0.4 | 0.3 | 0.3 | 0.1 |
| K1 | 103 | 178.5 | +0.6 | +0.6 | −0.5 | 1.1 | 1.5 | 0.8 | 0.6 | −0.1 | −0.1 | 0.2 | 0.2 | 0.4 |
| J1 | 4 | 196.6 | −0.3 | −6.6 | −1.5 | 0.3 | 1.5 | 22.3 | 0.2 | −0.5 | −6.1 | 0.7 | 0.6 | 0.3 |
| OO1 | 3 | 209.5 | −0.1 | −3.0 | −6.2 | 0.3 | 1.3 | 25.9 | 0.2 | +0.6 | +2.6 | 0.6 | 0.7 | 0.2 |
| 2N2 | 22 | 347.7 | −0.3 | −1.2 | −0.1 | 0.3 | 1.2 | 3.2 | 0.2 | −1.6 | −0.7 | 1.6 | **2.4** | 0.4 |
| MU2 | 23 | 10.0 | −1.1 | −4.6 | −1.0 | 1.1 | 1.2 | 3.1 | 0.8 | −1.1 | −0.4 | 1.1 | **1.7** | 0.2 |
| N2 | 156 | 0.5 | −0.2 | −0.1 | −0.3 | 1.0 | 1.2 | 0.4 | 0.8 | −3.6 | −0.7 | 4.0 | **5.4** | 0.4 |
| NU2 | 26 | 359.7 | +1.1 | +4.1 | −1.2 | 1.2 | 1.2 | 2.5 | 0.8 | +1.6 | +0.2 | 1.6 | **2.4** | 0.3 |
| M2 | 671 | 18.2 | +1.7 | +0.3 | −0.4 | 5.1 | 1.2 | 0.1 | **3.6** | +0.9 | −0.1 | 2.0 | **2.4** | 0.5 |
| LAM2 | 8 | 10.5 | −0.4 | −4.8 | +7.8 | 1.1 | 1.2 | 9.0 | 0.9 | +0.2 | +5.9 | 0.8 | **1.9** | 0.5 |
| L2 | 23 | 21.0 | −2.0 | −8.7 | −0.5 | 2.0 | 1.1 | 3.0 | **1.6** | −3.6 | +4.4 | 3.9 | **5.4** | 0.2 |
| T2 | 12 | 32.4 | +1.6 | +13.6 | −3.2 | 1.8 | 1.2 | 5.0 | **1.3** | +0.9 | −3.6 | 1.2 | **1.8** | 0.2 |
| S2 | 128 | 42.9 | +2.5 | +1.9 | −0.5 | 2.7 | 1.2 | 0.5 | **1.9** | +1.9 | −0.1 | 1.9 | **2.9** | 0.1 |
| R2 | 2 | 299.9 | +0.8 | +41.7 | −25.6 | 1.3 | 1.2 | 24.2 | **1.1** | +1.3 | −32.8 | 1.9 | **4.2** | 0.7 |
| K2 | 36 | 44.5 | +0.1 | +0.4 | −1.8 | 1.1 | 1.2 | 1.8 | 1.0 | −0.2 | −2.8 | 1.8 | **4.2** | 0.5 |
| 2SM2 | 2 | 357.9 | −0.2 | −9.0 | +4.9 | 0.2 | 1.2 | 37.6 | 0.1 | −0.9 | +16.5 | 1.0 | **1.4** | 0.3 |
| 2MK3 | 6 | 44.7 | +0.0 (MO3) | +0.7 | −2.2 | 0.2 | 0.8 | 7.5 | 0.3 | −0.4 (MO3) | +11.8 | 1.2 | **3.3** | 0.5 |
| M3 | 10 | 66.1 | −0.3 | −2.5 | +0.1 | 0.3 | 0.8 | 4.7 | 0.3 | −0.2 | +8.4 | 1.5 | **4.1** | 0.1 |
| MK3 | 8 | 69.5 | +1.3 | +16.6 | +1.1 | 1.3 | 0.8 | 4.9 | **1.4** | +0.6 | +6.9 | 1.2 | **2.9** | 0.7 |
| MN4 | 11 | 265.9 | +0.2 | +1.8 | −0.6 | 0.2 | 0.9 | 4.7 | 0.2 | −0.2 | +3.5 | 0.7 | **1.7** | 0.2 |
| M4 | 24 | 264.1 | +1.1 | +4.5 | +0.5 | 1.1 | 0.9 | 2.1 | **1.0** | +1.4 | +2.0 | 1.7 | **2.3** | 0.1 |
| MS4 | 15 | 258.9 | −0.2 | −1.6 | −0.2 | 0.2 | 0.9 | 3.6 | 0.2 | −1.1 | −0.1 | 1.1 | **1.7** | 0.3 |
| S4 | 11 | 20.8 | −0.9 | −8.2 | −2.7 | 1.0 | 0.9 | 5.2 | 0.9 | −0.7 | −0.5 | 0.7 | **1.1** | 0.3 |
| M6 | 23 | 150.4 | +0.1 | +0.4 | −0.9 | 0.4 | 0.5 | 1.3 | 0.7 | +0.8 | −0.6 | 0.8 | **1.4** | 0.1 |
| S6 | 1 | 272.0 | −0.1 | −8.3 | +11.1 | 0.2 | 0.5 | 33.0 | 0.3 | +0.1 | +5.3 | 0.2 | 0.4 | 0.1 |
| M8 | 2 | 332.2 | +0.6 | +28.3 | +0.9 | 0.6 | 0.2 | 3.8 | **1.1** | +0.9 | +1.6 | 0.9 | **1.7** | 0.6 |

### Philadelphia (`coops/8545240`)

NOAA: "Vector Average of 5 LSHQA (2016-2020). MM, SSA, Sa, MSF from average of 20 years (2001-2020)" NOAA's years, 2016–2020: 43,845 hourly values, 61 constituents kept. Standard, 2006 to 2024: 166,457 hourly values, 71 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 112 | 126.7 | −4.5 | −4.0 | −1.7 | 5.6 | 14.5 | 7.8 | 0.3 | −14.7 | +0.8 | 14.8 | **2.0** | 7.0 |
| SSA | 50 | 52.4 | −5.7 | −11.3 | −11.7 | 11.2 | 14.5 | 18.7 | 0.6 | −10.0 | −0.9 | 10.0 | **1.4** | 9.7 |
| MM | 30 | 37.8 | snr |  |  |  |  |  |  | −4.2 | +13.4 | 7.7 | 0.8 | 16.2 |
| MSF | 29 | 20.6 | −5.5 | −18.8 | −0.0 | 5.5 | 14.2 | 34.6 | 0.4 | −3.9 | +14.9 | 8.0 | 0.9 | 6.3 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 5.9 |
| 2Q1 | 1 | 221.2 | snr |  |  |  |  |  |  | +1.0 | +69.3 | 1.9 | **2.3** | 0.3 |
| Q1 | 13 | 271.5 | −1.2 | −9.1 | −5.2 | 1.6 | 2.5 | 12.2 | 0.5 | −0.3 | +2.3 | 0.6 | 0.5 | 0.2 |
| RHO | 5 | 229.5 | −0.0 | −0.6 | +21.5 | 1.9 | 2.5 | 29.1 | 0.7 | −0.9 | +3.1 | 1.0 | 0.8 | 0.2 |
| O1 | 80 | 264.9 | +0.4 | +0.5 | +0.3 | 0.6 | 2.5 | 1.8 | 0.2 | +3.9 | −2.0 | 4.8 | **3.3** | 0.3 |
| M1 | 2 | 291.3 | −0.8 (NO1) | −42.0 | −1.3 | 0.8 | 2.5 | 122.5 | 0.3 | +3.7 (NO1) | +60.8 | 5.1 | **5.7** | 0.0 |
| P1 | 32 | 273.5 | +0.4 | +1.1 | +1.6 | 1.0 | 2.3 | 4.1 | 0.4 | −0.2 | +0.7 | 0.4 | 0.3 | 0.2 |
| S1 | 18 | 236.5 | +1.4 | +7.7 | −0.2 | 1.4 | 2.3 | 6.8 | 0.6 | +2.8 | −3.1 | 3.0 | **2.3** | 0.1 |
| K1 | 105 | 281.1 | −0.5 | −0.5 | −0.4 | 0.9 | 2.4 | 1.3 | 0.3 | +1.0 | −0.5 | 1.3 | 0.9 | 0.1 |
| J1 | 4 | 340.7 | −1.8 | −44.2 | −19.7 | 2.0 | 2.5 | 63.7 | 0.7 | −2.8 | +2.7 | 2.8 | **2.4** | 0.1 |
| OO1 | 5 | 323.0 | −0.6 | −12.2 | −7.1 | 0.8 | 3.0 | 38.6 | 0.2 | −3.8 | −14.6 | 3.9 | **3.8** | 0.5 |
| 2N2 | 15 | 151.2 | −0.6 | −3.7 | −1.2 | 0.6 | 1.5 | 5.8 | 0.4 | −1.1 | +7.9 | 2.3 | **2.2** | 0.2 |
| MU2 | 43 | 305.5 | +2.5 | +5.8 | +1.9 | 2.9 | 1.5 | 1.8 | **1.6** | +4.6 | −0.0 | 4.6 | **4.5** | 0.2 |
| N2 | 138 | 166.5 | −0.5 | −0.4 | −0.2 | 0.7 | 1.5 | 0.6 | 0.3 | −0.4 | +0.8 | 1.9 | **2.1** | 0.4 |
| NU2 | 45 | 163.5 | +0.7 | +1.6 | −1.9 | 1.7 | 1.5 | 1.8 | **1.0** | +1.3 | −3.2 | 2.9 | **3.0** | 0.1 |
| M2 | 826 | 184.2 | +5.9 | +0.7 | −0.4 | 7.9 | 1.5 | 0.1 | **3.8** | +16.3 | −0.2 | 16.6 | **16.2** | 0.6 |
| LAM2 | 26 | 196.8 | −0.1 | −0.3 | −0.8 | 0.4 | 1.5 | 3.2 | 0.2 | +1.0 | −2.4 | 1.5 | **1.3** | 0.0 |
| L2 | 92 | 198.9 | −6.6 | −7.1 | +0.1 | 6.6 | 1.5 | 1.0 | **4.3** | −11.2 | −1.5 | 11.4 | **11.3** | 0.5 |
| T2 | 8 | 211.2 | −1.0 | −12.2 | +2.4 | 1.0 | 1.5 | 12.2 | 0.6 | −0.2 | +6.9 | 1.0 | **1.1** | 0.1 |
| S2 | 91 | 224.3 | +0.3 | +0.3 | −0.2 | 0.4 | 1.5 | 0.9 | 0.2 | +2.0 | −0.4 | 2.1 | **2.0** | 0.4 |
| R2 | 2 | 197.3 | +0.3 | +16.1 | −17.6 | 0.7 | 1.5 | 36.9 | 0.5 | snr |  |  |  | 0.4 |
| K2 | 30 | 223.0 | +0.1 | +0.2 | +1.0 | 0.6 | 1.7 | 3.3 | 0.3 | −0.9 | −0.2 | 0.9 | 1.0 | 0.0 |
| 2SM2 | 3 | 105.4 | −1.3 | −41.8 | −16.2 | 1.4 | 1.5 | 48.0 | 0.8 | −0.7 | −20.7 | 1.2 | 0.9 | 0.1 |
| 2MK3 | 24 | 294.8 | +1.6 (MO3) | +6.7 | +1.2 | 1.7 | 1.1 | 2.5 | **1.3** | +1.1 (MO3) | +0.1 | 1.1 | **1.9** | 0.5 |
| M3 | 2 | 287.7 | −0.3 | −16.9 | +18.8 | 0.7 | 1.0 | 35.0 | 0.5 | +0.8 | +52.4 | 2.2 | **8.3** | 0.3 |
| MK3 | 23 | 331.1 | +0.8 | +3.5 | −2.0 | 1.1 | 1.1 | 2.6 | 0.8 | +1.6 | −2.1 | 1.8 | **3.0** | 0.2 |
| MN4 | 31 | 235.9 | +0.2 | +0.5 | +0.2 | 0.2 | 1.8 | 3.3 | 0.1 | +0.4 | +0.8 | 0.6 | **1.2** | 0.1 |
| M4 | 83 | 252.5 | +1.9 | +2.3 | −1.5 | 2.9 | 1.8 | 1.2 | **1.3** | +3.3 | −1.0 | 3.7 | **5.3** | 0.2 |
| MS4 | 22 | 300.6 | −0.1 | −0.5 | +0.8 | 0.3 | 1.8 | 4.7 | 0.2 | +0.7 | −0.4 | 0.8 | **1.2** | 0.1 |
| S4 | 1 | 262.9 | snr |  |  |  |  |  |  | −0.1 | −11.1 | 0.2 | 0.5 | 0.3 |
| M6 | 50 | 246.2 | +1.9 | +3.9 | −1.8 | 2.5 | 1.4 | 1.6 | **1.3** | +3.7 | −1.8 | 4.1 | **3.3** | 0.2 |
| S6 | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 0.3 |
| M8 | 16 | 327.0 | +0.7 | +4.2 | −3.5 | 1.2 | 0.3 | 0.9 | **3.9** | +1.2 | −0.9 | 1.2 | **2.3** | 0.2 |

### Baltimore (`coops/8574680`)

NOAA: "Vector Average of 5 years (2017-2021). Sa and SSa from average of 19 years (2001-2021). Other long period constituents are not stable." NOAA's years, 2017–2021: 43,794 hourly values, 57 constituents kept. Standard, 2006 to 2024: 166,328 hourly values, 65 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 133 | 132.6 | −7.1 | −5.4 | +5.7 | 14.7 | 12.0 | 5.5 | **1.0** | −12.7 | +0.4 | 12.7 | **2.0** | 11.8 |
| SSA | 39 | 49.5 | −1.9 | −4.9 | +0.5 | 1.9 | 12.1 | 18.6 | 0.2 | −0.6 | +4.7 | 3.2 | 0.5 | 0.9 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | +10.1 |  | 10.1 | **1.6** | 1.2 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 13.6 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 1.2 |
| 2Q1 | 3 | 277.2 | −0.9 | −28.9 | +24.3 | 1.4 | 1.9 | 51.9 | 0.5 | −0.5 | +40.6 | 2.0 | **2.0** | 0.3 |
| Q1 | 13 | 358.5 | −1.8 | −13.7 | −4.8 | 2.0 | 1.9 | 9.9 | 0.9 | −1.2 | −8.8 | 2.2 | **2.1** | 0.2 |
| RHO | 2 | 339.1 | +0.5 | +26.4 | +10.5 | 0.7 | 1.9 | 43.8 | 0.3 | +0.5 | +9.9 | 0.6 | 0.5 | 0.6 |
| O1 | 54 | 14.0 | +1.1 | +2.0 | +2.5 | 2.6 | 1.9 | 2.0 | **1.2** | +1.2 | +2.0 | 2.3 | **2.2** | 0.3 |
| M1 | 3 | 67.7 | +0.9 (NO1) | +29.6 | −24.6 | 1.7 | 1.9 | 28.2 | 0.9 | +0.0 (NO1) | −25.6 | 1.3 | **1.5** | 0.2 |
| P1 | 20 | 2.2 | −0.1 | −0.3 | −1.3 | 0.5 | 1.9 | 5.4 | 0.2 | −0.0 | +0.1 | 0.0 | 0.0 | 0.1 |
| S1 | 18 | 291.6 | −0.4 | −2.0 | +3.3 | 1.1 | 1.9 | 6.1 | 0.5 | +1.5 | +5.6 | 2.4 | **2.1** | 0.4 |
| K1 | 64 | 7.0 | +0.5 | +0.7 | −0.7 | 0.9 | 1.9 | 1.7 | 0.4 | +1.8 | −1.1 | 2.3 | **1.8** | 0.1 |
| J1 | 3 | 341.2 | +0.7 | +24.1 | +22.8 | 1.5 | 1.9 | 29.4 | 0.8 | −0.2 | +5.2 | 0.3 | 0.3 | 0.2 |
| OO1 | 3 | 26.3 | −0.4 | −12.1 | +7.0 | 0.5 | 2.0 | 42.8 | 0.2 | −0.2 | +10.8 | 0.6 | 0.7 | 0.3 |
| 2N2 | 4 | 294.9 | +0.6 | +16.2 | −2.8 | 0.7 | 0.7 | 8.2 | 0.8 | −0.2 | −0.2 | 0.2 | 0.4 | 0.2 |
| MU2 | 3 | 310.3 | −0.7 | −24.5 | +4.3 | 0.8 | 0.7 | 16.8 | 0.9 | −1.0 | +11.2 | 1.1 | **1.8** | 0.5 |
| N2 | 35 | 313.1 | +0.2 | +0.6 | −0.4 | 0.3 | 0.7 | 1.1 | 0.4 | −1.1 | −0.9 | 1.2 | **1.9** | 0.1 |
| NU2 | 6 | 311.4 | +0.3 | +4.5 | −3.3 | 0.4 | 0.7 | 6.1 | 0.5 | +0.7 | −4.0 | 0.8 | **1.6** | 0.1 |
| M2 | 152 | 336.3 | +2.8 | +1.8 | +0.0 | 2.8 | 0.7 | 0.2 | **3.3** | +1.6 | −0.1 | 1.6 | **2.7** | 0.4 |
| LAM2 | 4 | 12.9 | −0.5 | −12.9 | +0.0 | 0.5 | 0.7 | 10.9 | 0.6 | −0.8 | −10.0 | 1.0 | **1.9** | 0.4 |
| L2 | 8 | 357.6 | −0.2 | −2.5 | +1.9 | 0.3 | 0.6 | 4.7 | 0.4 | −1.1 | +2.2 | 1.1 | **1.8** | 0.2 |
| T2 | 2 | 333.3 | +0.1 | +6.3 | +5.9 | 0.2 | 0.7 | 18.1 | 0.3 | +0.0 | +20.4 | 0.7 | **2.4** | 0.2 |
| S2 | 24 | 8.3 | −0.2 | −0.6 | +0.5 | 0.3 | 0.7 | 1.6 | 0.3 | −0.4 | +0.4 | 0.4 | 0.7 | 0.4 |
| R2 | 1 | 90.0 | +0.1 | +6.7 | −8.3 | 0.2 | 0.7 | 36.2 | 0.2 | +0.3 | +3.5 | 0.3 | 0.5 | 0.1 |
| K2 | 9 | 8.9 | −0.4 | −4.1 | +1.6 | 0.4 | 0.7 | 4.7 | 0.4 | −1.2 | −5.6 | 1.5 | **2.6** | 0.6 |
| 2SM2 | 0 | 0.0 | snr |  |  |  |  |  |  | +0.4 |  | 0.4 | 0.8 | 0.5 |
| 2MK3 | 4 | 160.1 | +0.6 (MO3) | +15.5 | +5.2 | 0.7 | 0.3 | 4.3 | **1.2** | +0.5 (MO3) | +6.3 | 0.7 | **3.2** | 0.3 |
| M3 | 1 | 101.5 | +0.5 | +46.2 | +2.0 | 0.5 | 0.3 | 13.1 | 0.8 | −0.3 | +27.5 | 0.5 | **2.1** | 0.4 |
| MK3 | 5 | 180.2 | +0.0 | +0.8 | +1.9 | 0.2 | 0.3 | 3.9 | 0.5 | +0.3 | −1.1 | 0.3 | 0.7 | 0.1 |
| MN4 | 4 | 212.6 | −0.4 | −10.4 | +4.3 | 0.5 | 0.3 | 4.3 | **1.0** | −0.8 | +3.4 | 0.8 | **1.5** | 0.5 |
| M4 | 9 | 243.7 | +0.1 | +1.5 | +0.2 | 0.1 | 0.3 | 1.7 | 0.2 | −0.6 | +6.9 | 1.2 | **7.7** | 0.3 |
| MS4 | 2 | 277.0 | +0.5 | +25.0 | +1.0 | 0.5 | 0.3 | 6.2 | 0.9 | +0.5 | +6.2 | 0.5 | **2.0** | 0.5 |
| S4 | 1 | 39.5 | −0.3 | −25.3 | −3.0 | 0.3 | 0.3 | 21.1 | 0.4 | −0.4 | +1.4 | 0.4 | 0.8 | 0.3 |
| M6 | 3 | 356.4 | +0.0 | +0.5 | −1.2 | 0.1 | 0.2 | 3.7 | 0.3 | −0.1 | −0.7 | 0.1 | 0.3 | 0.2 |
| S6 | 1 | 130.4 | −0.7 | −73.0 | +2.6 | 0.7 | 0.2 | 42.1 | **1.4** | −0.8 | +13.8 | 0.8 | **1.6** | 0.6 |
| M8 | 1 | 197.5 | −0.3 | −27.9 | +0.6 | 0.3 | 0.2 | 12.0 | 0.5 | −0.3 | +8.1 | 0.3 | **1.9** | 0.4 |

### Sewells Point (`coops/8638610`)

NOAA: "Vector Average of 5 years LSQHA (2015-2019). Sa and SSa from 19 vector average of 19 years (2000-2019)." NOAA's years, 2015–2019: 43,815 hourly values, 63 constituents kept. Standard, 2006 to 2024: 166,547 hourly values, 69 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 87 | 150.1 | +18.1 | +20.8 | +7.0 | 21.6 | 15.5 | 8.4 | **1.2** | −8.0 | +2.6 | 8.8 | **1.1** | 28.4 |
| SSA | 60 | 45.4 | −5.1 | −8.5 | +5.6 | 7.6 | 15.4 | 16.2 | 0.3 | −6.4 | +4.7 | 7.9 | 0.9 | 4.9 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | +13.0 |  | 13.0 | **1.8** | 9.1 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 9.4 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 14.3 |
| 2Q1 | 2 | 171.7 | −0.7 | −35.6 | +13.9 | 0.8 | 1.4 | 63.3 | 0.5 | −0.3 | +4.9 | 0.3 | 0.4 | 0.1 |
| Q1 | 11 | 209.5 | +0.3 | +2.7 | +0.1 | 0.3 | 1.4 | 7.2 | 0.2 | −1.3 | −5.1 | 1.6 | **1.7** | 0.0 |
| RHO | 3 | 189.5 | +0.9 | +29.3 | −3.1 | 0.9 | 1.4 | 21.0 | 0.6 | −1.1 | +11.2 | 1.2 | **1.3** | 0.0 |
| O1 | 40 | 223.8 | +0.2 | +0.4 | +0.6 | 0.4 | 1.4 | 2.0 | 0.3 | +0.6 | +0.8 | 0.8 | 0.9 | 0.3 |
| M1 | 3 | 243.3 | +0.4 (NO1) | +13.4 | −17.1 | 1.0 | 1.4 | 23.4 | 0.7 | +1.3 (NO1) | −21.2 | 1.9 | **2.5** | 0.6 |
| P1 | 15 | 198.0 | +0.3 | +1.7 | +0.6 | 0.3 | 1.2 | 4.7 | 0.2 | −0.3 | −1.2 | 0.4 | 0.5 | 0.5 |
| S1 | 11 | 101.6 | −0.4 | −3.9 | −5.8 | 1.2 | 1.2 | 6.7 | 0.9 | −0.7 | −7.2 | 1.5 | **2.0** | 0.2 |
| K1 | 51 | 199.8 | −0.2 | −0.4 | −1.1 | 1.0 | 1.3 | 1.5 | 0.7 | −0.9 | −0.9 | 1.2 | **1.2** | 0.2 |
| J1 | 3 | 230.8 | −0.6 | −19.5 | −12.0 | 0.8 | 1.4 | 33.1 | 0.4 | −0.5 | −13.9 | 0.8 | 1.0 | 0.0 |
| OO1 | 2 | 197.2 | +0.3 | +12.6 | −23.6 | 0.9 | 1.9 | 48.6 | 0.5 | +0.2 | +31.4 | 1.1 | **2.2** | 0.3 |
| 2N2 | 11 | 11.3 | −0.4 | −4.0 | +0.7 | 0.5 | 0.7 | 3.6 | 0.5 | −1.1 | +6.4 | 1.6 | **2.9** | 0.1 |
| MU2 | 10 | 47.6 | −0.3 | −2.6 | +2.1 | 0.5 | 0.7 | 3.9 | 0.5 | +0.2 | +5.3 | 1.0 | **2.4** | 0.1 |
| N2 | 80 | 27.5 | +0.7 | +0.8 | −0.2 | 0.7 | 0.7 | 0.5 | 0.8 | −0.2 | +1.2 | 1.7 | **4.3** | 0.2 |
| NU2 | 14 | 23.2 | +1.1 | +7.8 | +0.7 | 1.1 | 0.7 | 2.5 | **1.3** | +1.2 | +1.2 | 1.3 | **2.0** | 0.4 |
| M2 | 350 | 47.1 | +1.8 | +0.5 | −0.3 | 2.5 | 0.7 | 0.1 | **2.3** | +4.8 | −0.2 | 4.9 | **7.6** | 0.6 |
| LAM2 | 6 | 57.2 | −0.1 | −1.8 | −2.9 | 0.3 | 0.7 | 6.4 | 0.4 | −0.1 | −5.2 | 0.6 | **1.4** | 0.2 |
| L2 | 15 | 61.2 | −0.2 | −1.1 | −1.5 | 0.4 | 0.7 | 2.5 | 0.6 | −1.1 | −13.7 | 3.6 | **8.8** | 0.2 |
| T2 | 6 | 72.0 | −0.3 | −4.3 | +0.0 | 0.3 | 0.7 | 6.8 | 0.3 | −0.5 | −6.0 | 0.8 | **1.5** | 0.3 |
| S2 | 64 | 76.2 | −0.4 | −0.6 | +0.0 | 0.4 | 0.7 | 0.6 | 0.4 | −0.6 | +0.5 | 0.8 | **1.5** | 0.4 |
| R2 | 1 | 322.8 | +0.4 | +39.0 | −12.3 | 0.5 | 0.7 | 28.0 | 0.5 | +0.8 | −5.6 | 0.8 | **1.3** | 0.1 |
| K2 | 17 | 71.8 | −0.4 | −2.1 | −0.7 | 0.4 | 0.8 | 2.9 | 0.4 | −0.6 | +0.4 | 0.6 | 0.9 | 0.0 |
| 2SM2 | 1 | 62.3 | −0.2 | −17.9 | −18.9 | 0.3 | 0.7 | 46.1 | 0.4 | −0.2 | −31.2 | 0.5 | **1.1** | 0.1 |
| 2MK3 | 4 | 102.1 | +0.5 (MO3) | +12.9 | +3.4 | 0.6 | 0.4 | 5.6 | 0.8 | −0.3 (MO3) | −7.2 | 0.6 | **2.6** | 0.1 |
| M3 | 3 | 113.2 | −0.2 | −5.5 | −0.6 | 0.2 | 0.4 | 7.7 | 0.3 | −0.6 | +4.7 | 0.6 | **1.1** | 0.1 |
| MK3 | 3 | 74.4 | +0.4 | +11.9 | −0.7 | 0.4 | 0.4 | 7.1 | 0.5 | +0.4 | −0.6 | 0.4 | 0.8 | 0.5 |
| MN4 | 3 | 294.5 | +0.1 | +3.9 | −1.8 | 0.2 | 0.3 | 5.8 | 0.3 | −0.1 | +2.8 | 0.2 | 1.0 | 0.1 |
| M4 | 4 | 308.9 | −0.4 | −10.1 | +3.3 | 0.5 | 0.3 | 5.0 | 0.7 | −0.3 | +3.3 | 0.4 | **1.5** | 0.4 |
| MS4 | 2 | 221.7 | −0.6 | −30.7 | +3.0 | 0.6 | 0.3 | 13.5 | **1.0** | −0.6 | −2.3 | 0.6 | **1.1** | 0.6 |
| S4 | 2 | 360.0 | −0.3 | −14.6 | −0.7 | 0.3 | 0.3 | 11.2 | 0.5 | +0.1 | +1.1 | 0.1 | 0.3 | 0.2 |
| M6 | 2 | 3.2 | +0.3 | +14.1 | −2.2 | 0.3 | 0.2 | 4.2 | 0.5 | +0.6 | +2.7 | 0.6 | **1.5** | 0.2 |
| S6 | 1 | 254.3 | −0.2 | −21.5 | +3.9 | 0.2 | 0.2 | 13.2 | 0.4 | −0.2 | +5.9 | 0.2 | **1.0** | 0.2 |
| M8 | 1 | 81.7 | −0.4 | −42.7 | +7.7 | 0.4 | 0.1 | 9.0 | 0.9 | −0.5 | +12.9 | 0.5 | **2.5** | 0.5 |

### Charleston (`coops/8665530`)

NOAA: "Vector Average of 5 years LSQHA (2017-2021). Sa and SSa from average of 18 years (2001-2021)." NOAA's years, 2017–2021: 43,817 hourly values, 66 constituents kept. Standard, 2006 to 2024: 166,550 hourly values, 71 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 101 | 173.2 | −1.0 | −1.0 | +8.2 | 14.5 | 12.5 | 7.2 | **1.2** | +0.8 | +4.6 | 8.2 | **1.4** | 13.3 |
| SSA | 76 | 49.2 | −3.0 | −4.0 | −4.5 | 6.6 | 12.5 | 9.8 | 0.5 | −4.9 | +5.4 | 8.5 | **1.1** | 7.2 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 3.8 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 3.8 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 3.5 |
| 2Q1 | 1 | 142.7 | +1.4 | +139.1 | +22.9 | 1.5 | 1.3 | 31.6 | 1.0 | +1.5 | +42.5 | 1.9 | **3.1** | 0.2 |
| Q1 | 16 | 199.2 | −0.3 | −1.9 | +0.6 | 0.3 | 1.3 | 4.8 | 0.2 | +1.0 | −0.1 | 1.0 | **1.2** | 0.1 |
| RHO | 2 | 191.2 | +0.4 | +19.6 | +15.0 | 0.7 | 1.3 | 31.5 | 0.5 | +1.2 | −2.5 | 1.2 | **1.5** | 0.4 |
| O1 | 79 | 202.0 | −0.4 | −0.6 | −0.1 | 0.5 | 1.3 | 1.0 | 0.3 | −1.2 | +0.5 | 1.3 | **1.5** | 0.3 |
| M1 | 5 | 219.1 | +2.4 (NO1) | +47.8 | −16.6 | 3.0 | 1.3 | 10.1 | **1.7** | +1.3 (NO1) | −3.4 | 1.3 | **1.6** | 0.5 |
| P1 | 34 | 197.5 | +0.4 | +1.3 | −0.6 | 0.6 | 1.3 | 2.1 | 0.3 | +0.3 | −0.0 | 0.3 | 0.4 | 0.1 |
| S1 | 19 | 171.6 | −0.3 | −1.4 | +3.1 | 1.1 | 1.3 | 3.9 | 0.8 | −0.5 | +3.1 | 1.1 | **1.6** | 0.3 |
| K1 | 105 | 198.4 | −0.3 | −0.3 | −0.2 | 0.5 | 1.3 | 0.7 | 0.3 | −0.8 | −0.0 | 0.8 | **1.0** | 0.2 |
| J1 | 7 | 212.8 | −0.3 | −3.6 | −0.4 | 0.3 | 1.3 | 11.1 | 0.2 | −0.7 | +0.9 | 0.7 | 0.9 | 0.3 |
| OO1 | 4 | 227.4 | +0.3 | +8.7 | −2.3 | 0.4 | 1.3 | 17.7 | 0.2 | +0.0 | −5.3 | 0.4 | 0.7 | 0.3 |
| 2N2 | 24 | 345.5 | +0.5 | +2.2 | −1.0 | 0.7 | 1.7 | 4.0 | 0.3 | −1.8 | +0.9 | 1.8 | **2.3** | 0.3 |
| MU2 | 23 | 38.1 | +0.3 | +1.4 | +2.0 | 0.9 | 1.7 | 4.2 | 0.5 | +1.0 | +2.8 | 1.5 | **2.0** | 0.1 |
| N2 | 175 | 354.9 | +0.1 | +0.1 | −0.2 | 0.7 | 1.7 | 0.6 | 0.4 | −4.2 | +0.2 | 4.3 | **5.5** | 0.4 |
| NU2 | 34 | 351.5 | +0.1 | +0.2 | +0.1 | 0.1 | 1.7 | 2.9 | 0.0 | +0.1 | −0.7 | 0.4 | 0.7 | 0.0 |
| M2 | 767 | 10.1 | +2.4 | +0.3 | −0.3 | 4.2 | 1.7 | 0.1 | **1.9** | +3.3 | −0.3 | 5.0 | **4.3** | 0.7 |
| LAM2 | 15 | 358.8 | +0.1 | +0.6 | −4.1 | 1.1 | 1.7 | 6.5 | 0.6 | −1.1 | −3.5 | 1.4 | **1.4** | 0.6 |
| L2 | 42 | 3.5 | −3.4 | −8.0 | +0.2 | 3.4 | 1.7 | 2.5 | **1.9** | −6.0 | −4.0 | 6.6 | **7.9** | 0.3 |
| T2 | 13 | 16.8 | −0.3 | −2.6 | +0.8 | 0.4 | 1.7 | 7.8 | 0.2 | +0.1 | +4.3 | 1.0 | **1.7** | 0.3 |
| S2 | 116 | 36.0 | +0.5 | +0.5 | −0.0 | 0.5 | 1.7 | 0.8 | 0.3 | +2.3 | +0.2 | 2.4 | **3.0** | 0.3 |
| R2 | 8 | 275.7 | −1.1 | −13.2 | −3.8 | 1.2 | 1.7 | 14.2 | 0.6 | −1.3 | −7.5 | 1.6 | **1.7** | 0.4 |
| K2 | 30 | 36.0 | +0.9 | +2.9 | −0.3 | 0.9 | 1.8 | 3.4 | 0.5 | +1.4 | −2.2 | 1.8 | **2.1** | 0.3 |
| 2SM2 | 2 | 79.4 | +0.3 | +12.7 | +8.9 | 0.4 | 1.7 | 43.3 | 0.2 | −0.0 | −5.9 | 0.2 | 0.3 | 0.5 |
| 2MK3 | 11 | 28.3 | +0.5 (MO3) | +4.1 | +1.5 | 0.5 | 0.7 | 3.7 | 0.5 | −2.1 (MO3) | −3.1 | 2.2 | **3.5** | 0.4 |
| M3 | 14 | 116.7 | −0.3 | −2.4 | −2.6 | 0.7 | 0.7 | 3.0 | 0.9 | +1.2 | −2.5 | 1.4 | **2.0** | 0.4 |
| MK3 | 9 | 10.6 | +0.7 | +7.5 | +1.5 | 0.7 | 0.7 | 4.3 | 0.8 | −0.1 | −0.5 | 0.1 | 0.2 | 0.4 |
| MN4 | 16 | 198.8 | +0.4 | +2.3 | −0.1 | 0.4 | 0.7 | 2.6 | 0.4 | −0.2 | −0.1 | 0.2 | 0.4 | 0.3 |
| M4 | 38 | 207.8 | +0.5 | +1.4 | −1.1 | 0.9 | 0.7 | 1.1 | **1.0** | +0.4 | −0.5 | 0.5 | **1.4** | 0.1 |
| MS4 | 11 | 239.7 | +0.0 | +0.4 | −0.1 | 0.1 | 0.7 | 3.8 | 0.1 | −0.1 | +1.6 | 0.3 | **1.2** | 0.2 |
| S4 | 3 | 333.8 | −0.5 | −15.4 | −9.5 | 0.7 | 0.7 | 16.9 | 0.6 | −0.5 | −5.8 | 0.6 | 1.0 | 0.2 |
| M6 | 8 | 129.1 | −0.7 | −8.5 | +1.6 | 0.7 | 0.3 | 2.1 | **1.2** | −0.7 | +2.0 | 0.7 | **1.8** | 0.5 |
| S6 | 1 | 284.2 | −0.5 | −49.1 | −6.8 | 0.5 | 0.3 | 31.5 | 0.9 | −0.4 | +16.3 | 0.5 | **1.2** | 0.5 |
| M8 | 1 | 123.8 | −0.5 | −50.7 | −8.4 | 0.5 | 0.2 | 18.1 | 1.0 | −0.3 | +5.9 | 0.3 | **1.0** | 0.6 |

### Key West (`coops/8724580`)

NOAA: "Vector Average of 5 years (2018-2022). Sa and Ssa from 20 year monthly means analysis (2002-2022), Mf from average of 20 year annual analysis." NOAA's years, 2018–2022: 43,822 hourly values, 67 constituents kept. Standard, 2006 to 2024: 165,970 hourly values, 73 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 95 | 183.1 | +1.1 | +1.2 | +9.2 | 15.3 | 7.0 | 4.1 | **2.2** | +0.8 | +4.1 | 6.9 | **1.8** | 16.4 |
| SSA | 51 | 57.6 | +0.8 | +1.7 | −4.3 | 3.9 | 7.0 | 7.7 | 0.6 | −0.1 | +6.2 | 5.5 | **1.5** | 3.9 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | +5.0 |  | 5.0 | **1.3** | 5.4 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 2.7 |
| MF | 14 | 355.6 | −1.5 | −11.1 | −1.6 | 1.6 | 6.5 | 30.0 | 0.2 | −3.7 | −7.9 | 4.0 | **1.0** | 1.9 |
| 2Q1 | 2 | 324.4 | +0.3 | +14.8 | −5.3 | 0.4 | 0.5 | 13.0 | 0.4 | +0.9 | −1.6 | 0.9 | **1.7** | 0.2 |
| Q1 | 21 | 342.0 | −0.5 | −2.5 | −0.5 | 0.5 | 0.5 | 1.5 | 0.7 | +0.1 | −1.0 | 0.4 | **1.6** | 0.4 |
| RHO | 4 | 337.8 | +0.4 | +8.9 | −1.9 | 0.4 | 0.5 | 6.9 | 0.5 | +0.1 | +6.0 | 0.4 | **1.7** | 0.3 |
| O1 | 89 | 351.9 | −0.2 | −0.2 | +0.1 | 0.2 | 0.5 | 0.3 | 0.2 | −0.2 | +0.2 | 0.4 | **1.1** | 0.1 |
| M1 | 4 | 11.6 | +1.6 (NO1) | +39.5 | −15.6 | 2.0 | 0.5 | 5.4 | **2.9** | +0.9 (NO1) | −16.9 | 1.6 | **5.9** | 0.1 |
| P1 | 28 | 357.8 | −0.4 | −1.5 | −0.2 | 0.4 | 0.5 | 1.1 | 0.6 | −0.4 | −0.7 | 0.5 | **1.3** | 0.4 |
| S1 | 7 | 4.3 | +0.7 | +9.8 | +4.0 | 0.9 | 0.5 | 4.0 | **1.0** | −0.5 | +4.2 | 0.7 | **1.9** | 0.3 |
| K1 | 86 | 354.8 | −0.2 | −0.3 | −0.2 | 0.4 | 0.5 | 0.4 | 0.6 | −0.4 | +0.1 | 0.5 | 0.8 | 0.1 |
| J1 | 4 | 353.4 | +0.2 | +5.1 | −1.4 | 0.2 | 0.5 | 7.1 | 0.3 | −0.1 | +2.7 | 0.2 | 0.7 | 0.1 |
| OO1 | 2 | 2.1 | +0.4 | +18.3 | +5.4 | 0.4 | 0.5 | 11.4 | 0.5 | +0.3 | +4.5 | 0.4 | 0.9 | 0.5 |
| 2N2 | 4 | 34.7 | +0.5 | +13.4 | −0.5 | 0.5 | 0.3 | 4.2 | 0.9 | +0.3 | +0.2 | 0.3 | 0.7 | 0.5 |
| MU2 | 5 | 9.1 | −0.4 | −7.9 | −0.3 | 0.4 | 0.3 | 4.2 | 0.7 | −0.6 | −1.4 | 0.6 | **1.1** | 0.4 |
| N2 | 36 | 48.9 | +0.2 | +0.5 | +0.0 | 0.2 | 0.3 | 0.5 | 0.3 | −0.1 | −0.7 | 0.5 | **2.7** | 0.1 |
| NU2 | 7 | 54.1 | +0.3 | +4.8 | +0.0 | 0.3 | 0.3 | 2.6 | 0.6 | +0.4 | −0.1 | 0.4 | 0.7 | 0.3 |
| M2 | 179 | 66.9 | +0.2 | +0.1 | +0.1 | 0.3 | 0.3 | 0.1 | 0.6 | −0.6 | −0.3 | 1.2 | **4.6** | 0.0 |
| LAM2 | 2 | 110.3 | −0.1 | −6.0 | −1.1 | 0.1 | 0.3 | 10.2 | 0.2 | −0.1 | −6.6 | 0.3 | **1.4** | 0.1 |
| L2 | 6 | 85.6 | −0.5 | −8.1 | +1.2 | 0.5 | 0.3 | 3.3 | 0.8 | −0.7 | +6.3 | 0.9 | **3.7** | 0.1 |
| T2 | 4 | 80.8 | −0.4 | −10.4 | −0.4 | 0.4 | 0.3 | 5.4 | 0.7 | −0.4 | −1.0 | 0.4 | 0.7 | 0.2 |
| S2 | 51 | 89.4 | +0.4 | +0.8 | +0.3 | 0.5 | 0.3 | 0.4 | 0.8 | −0.7 | −0.9 | 1.1 | **4.7** | 0.4 |
| R2 | 1 | 312.4 | −0.5 | −45.3 | +11.9 | 0.5 | 0.3 | 35.1 | 0.8 | −0.4 | −2.5 | 0.4 | 0.7 | 0.7 |
| K2 | 15 | 92.0 | −0.3 | −1.7 | +0.1 | 0.3 | 0.3 | 1.3 | 0.4 | −0.4 | −2.0 | 0.7 | **3.3** | 0.2 |
| 2SM2 | 0 | 0.0 | +0.3 |  |  | 0.3 | 0.3 | 73.6 | 0.4 | +0.4 |  | 0.4 | 0.8 | 0.4 |
| 2MK3 | 2 | 118.8 | +0.6 (MO3) | +31.6 | +4.5 | 0.7 | 0.2 | 4.0 | **1.2** | +0.5 (MO3) | +1.4 | 0.5 | 0.9 | 0.6 |
| M3 | 1 | 294.6 | −0.5 | −47.1 | −17.2 | 0.5 | 0.2 | 20.4 | 0.9 | −0.3 | −48.4 | 0.8 | **8.1** | 0.5 |
| MK3 | 2 | 122.7 | +0.4 | +18.8 | +1.3 | 0.4 | 0.2 | 4.5 | 0.7 | +0.3 | +1.1 | 0.3 | 0.6 | 0.3 |
| MN4 | 5 | 223.9 | +0.1 | +1.3 | +0.3 | 0.1 | 0.2 | 2.2 | 0.1 | −0.1 | +2.5 | 0.2 | **2.1** | 0.1 |
| M4 | 10 | 243.3 | +0.2 | +2.0 | +0.4 | 0.2 | 0.2 | 1.1 | 0.4 | −0.1 | +1.6 | 0.3 | **2.7** | 0.2 |
| MS4 | 5 | 246.6 | −0.4 | −7.8 | −0.1 | 0.4 | 0.2 | 2.5 | 0.7 | −0.4 | −2.9 | 0.5 | **2.2** | 0.5 |
| S4 | 1 | 338.7 | +0.4 | +37.4 | −1.1 | 0.4 | 0.2 | 8.3 | 0.7 | +0.6 | −3.9 | 0.6 | **1.1** | 0.4 |
| M6 | 1 | 237.0 | +0.2 | +21.8 | +3.2 | 0.2 | 0.1 | 5.8 | 0.6 | +0.3 | −1.1 | 0.3 | 0.6 | 0.1 |
| S6 | 0 | 0.0 | +0.2 |  |  | 0.2 | 0.1 | 35.4 | 0.4 | +0.2 |  | 0.2 | 0.5 | 0.2 |
| M8 | 0 | 0.0 | +0.3 |  |  | 0.3 | 0.1 | 24.4 | 0.5 | +0.3 |  | 0.3 | 0.5 | 0.3 |

### Pensacola (`coops/8729840`)

NOAA: "Vector average of 5 years (2018-2022). Sa and Ssa from 20 year monthly analysis (2002-2022)." NOAA's years, 2018–2022: 43,806 hourly values, 61 constituents kept. Standard, 2006 to 2024: 164,139 hourly values, 73 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 113 | 150.4 | −8.3 | −7.3 | +5.8 | 13.8 | 10.6 | 5.9 | 1.0 | −6.9 | +1.8 | 7.7 | **1.3** | 12.7 |
| SSA | 54 | 49.1 | +4.9 | +9.1 | +2.5 | 5.5 | 10.7 | 10.3 | 0.5 | +1.3 | +6.4 | 6.2 | **1.2** | 5.6 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | +5.5 |  | 5.5 | **1.1** | 12.1 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | +7.4 |  | 7.4 | **1.4** | 3.0 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | +5.8 |  | 5.8 | **1.2** | 13.1 |
| 2Q1 | 2 | 33.1 | +0.0 | +1.0 | +20.6 | 0.7 | 0.9 | 24.6 | 0.8 | +1.4 | −20.1 | 1.7 | **3.5** | 0.1 |
| Q1 | 26 | 37.9 | −0.6 | −2.2 | −1.8 | 1.0 | 0.9 | 2.0 | 0.9 | +0.4 | −1.8 | 0.9 | **2.5** | 0.7 |
| RHO | 5 | 33.3 | +0.5 | +9.2 | +4.7 | 0.6 | 0.9 | 9.1 | 0.5 | +0.5 | +2.7 | 0.5 | 0.7 | 0.6 |
| O1 | 122 | 47.9 | +0.6 | +0.5 | +0.1 | 0.7 | 0.9 | 0.4 | 0.6 | +2.2 | −0.2 | 2.2 | **3.6** | 0.5 |
| M1 | 5 | 96.4 | +2.3 (NO1) | +47.0 | −15.9 | 2.9 | 0.9 | 6.8 | **2.3** | +1.3 (NO1) | −15.3 | 2.0 | **4.9** | 0.2 |
| P1 | 37 | 63.8 | −0.3 | −0.7 | +0.0 | 0.3 | 0.9 | 1.4 | 0.3 | +0.6 | −1.6 | 1.2 | **3.0** | 0.1 |
| S1 | 1 | 169.6 | +0.1 | +5.3 | +25.0 | 0.4 | 0.9 | 48.6 | 0.5 | +1.3 | +28.9 | 1.5 | **3.4** | 0.5 |
| K1 | 125 | 58.2 | +0.2 | +0.2 | +0.0 | 0.2 | 0.9 | 0.4 | 0.2 | +1.8 | −0.6 | 2.2 | **3.8** | 0.4 |
| J1 | 5 | 89.8 | +0.2 | +4.4 | −4.7 | 0.5 | 0.9 | 9.5 | 0.5 | −0.3 | +0.4 | 0.3 | 0.4 | 0.1 |
| OO1 | 11 | 34.8 | −0.5 | −4.5 | +1.1 | 0.5 | 0.8 | 4.2 | 0.5 | −0.7 | +7.5 | 1.5 | **4.7** | 0.1 |
| 2N2 | 0 | 0.0 | +0.6 |  |  | 0.6 | 0.3 | 32.3 | 1.0 | +0.5 |  | 0.5 | 1.0 | 0.5 |
| MU2 | 1 | 300.2 | −0.4 | −35.1 | −25.7 | 0.5 | 0.3 | 30.0 | 0.9 | −0.5 | −5.4 | 0.5 | 0.9 | 0.0 |
| N2 | 3 | 195.9 | −0.1 | −1.8 | −1.2 | 0.1 | 0.3 | 6.6 | 0.2 | +0.1 | −0.8 | 0.1 | 0.2 | 0.2 |
| NU2 | 1 | 173.1 | −0.1 | −11.2 | +6.0 | 0.1 | 0.3 | 21.9 | 0.3 | −0.4 | +6.8 | 0.4 | 0.7 | 0.3 |
| M2 | 17 | 172.1 | +0.3 | +1.5 | −0.0 | 0.3 | 0.3 | 1.1 | 0.4 | +1.0 | −1.2 | 1.0 | **2.2** | 0.1 |
| LAM2 | 1 | 153.8 | −0.1 | −11.4 | −26.6 | 0.4 | 0.3 | 22.0 | **1.2** | −0.4 | +15.4 | 0.4 | 1.0 | 0.4 |
| L2 | 1 | 163.9 | −0.1 | −9.8 | +11.9 | 0.2 | 0.3 | 20.1 | 0.6 | +0.1 | +5.9 | 0.1 | 0.7 | 0.2 |
| T2 | 1 | 131.5 | −0.0 | −3.2 | +3.1 | 0.1 | 0.3 | 20.1 | 0.2 | −0.1 | +3.0 | 0.1 | 0.3 | 0.0 |
| S2 | 5 | 175.9 | +0.5 | +9.2 | +1.8 | 0.5 | 0.3 | 3.6 | 0.8 | +0.4 | −0.1 | 0.4 | 0.8 | 0.3 |
| R2 | 1 | 314.1 | −0.4 | −42.3 | +16.5 | 0.5 | 0.3 | 33.7 | 0.7 | −0.3 | −16.2 | 0.4 | **1.2** | 0.5 |
| K2 | 6 | 186.2 | +0.0 | +0.0 | −0.1 | 0.0 | 0.3 | 3.1 | 0.0 | +0.0 | −1.8 | 0.2 | **1.2** | 0.1 |
| 2SM2 | 1 | 23.4 | −0.7 | −68.9 | +10.8 | 0.7 | 0.3 | 62.5 | **1.1** | −0.6 | +3.3 | 0.6 | **1.1** | 0.6 |
| 2MK3 | 2 | 171.7 | −0.2 (MO3) | −11.2 | +4.6 | 0.3 | 0.2 | 5.1 | 0.9 | −0.3 (MO3) | +3.8 | 0.3 | **1.6** | 0.2 |
| M3 | 0 | 0.0 | +0.3 |  |  | 0.3 | 0.2 | 36.5 | 0.5 | +0.1 |  | 0.1 | 0.3 | 0.3 |
| MK3 | 2 | 186.2 | −0.2 | −12.0 | +2.1 | 0.3 | 0.2 | 5.2 | 0.5 | −0.2 | +1.3 | 0.2 | 0.6 | 0.3 |
| MN4 | 1 | 297.0 | −0.1 | −14.6 | +2.6 | 0.2 | 0.1 | 8.0 | 0.3 | −0.2 | +4.6 | 0.2 | **1.2** | 0.2 |
| M4 | 2 | 320.0 | −0.5 | −25.9 | +1.5 | 0.5 | 0.1 | 4.6 | **1.0** | −0.4 | +2.8 | 0.4 | **1.3** | 0.5 |
| MS4 | 1 | 324.3 | −0.2 | −22.7 | −3.1 | 0.2 | 0.1 | 8.9 | 0.4 | −0.2 | +3.0 | 0.2 | 0.7 | 0.2 |
| S4 | 1 | 92.7 | −0.6 | −57.9 | −2.7 | 0.6 | 0.1 | 16.2 | **1.1** | −0.7 | −0.5 | 0.7 | **1.3** | 0.5 |
| M6 | 1 | 105.8 | −0.2 | −21.8 | +1.3 | 0.2 | 0.1 | 6.7 | 0.4 | −0.2 | −1.7 | 0.2 | 0.5 | 0.2 |
| S6 | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 0.1 |
| M8 | 0 | 0.0 | snr |  |  |  |  |  |  | +0.1 |  | 0.1 | 0.2 | 0.0 |

### Grand Isle (`coops/8761724`)

NOAA: "Vector Average of 5 years (2021-2025). Sa and SSa from average of 16 years (2006-2025)." NOAA's years, 2021–2025: 43,789 hourly values, 61 constituents kept. Standard, 2006 to 2024: 162,866 hourly values, 67 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 96 | 150.7 | −11.5 | −12.0 | −1.0 | 11.6 | 9.6 | 6.5 | **1.2** | −2.0 | +2.7 | 4.9 | 0.9 | 8.5 |
| SSA | 67 | 57.1 | +10.4 | +15.5 | −0.2 | 10.4 | 9.7 | 7.1 | **1.1** | +0.4 | +2.5 | 3.0 | 0.6 | 7.3 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 7.1 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 7.1 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | +6.8 |  | 6.8 | **1.4** | 5.2 |
| 2Q1 | 4 | 351.2 | −0.4 | −9.5 | +8.1 | 0.7 | 0.6 | 9.8 | 0.8 | −0.3 | +4.2 | 0.4 | 0.7 | 0.3 |
| Q1 | 28 | 11.4 | −0.3 | −1.2 | −1.0 | 0.6 | 0.6 | 1.3 | 0.8 | −1.3 | +2.0 | 1.6 | **2.5** | 0.1 |
| RHO | 5 | 17.9 | −0.1 | −2.5 | +2.5 | 0.2 | 0.6 | 7.3 | 0.3 | 0.0 | −3.3 | 0.3 | 0.8 | 0.3 |
| O1 | 120 | 27.9 | +0.1 | +0.1 | +0.2 | 0.4 | 0.6 | 0.3 | 0.6 | −3.4 | +0.9 | 3.8 | **5.4** | 0.4 |
| M1 | 5 | 60.1 | +2.0 (NO1) | +40.6 | −13.0 | 2.4 | 0.6 | 5.2 | **2.5** | +2.0 (NO1) | −26.9 | 3.4 | **8.8** | 0.2 |
| P1 | 39 | 34.4 | −1.1 | −2.8 | −0.1 | 1.1 | 0.7 | 1.1 | **1.3** | −1.8 | −0.4 | 1.8 | **2.9** | 0.3 |
| S1 | 4 | 344.8 | +0.8 | +20.0 | +10.4 | 1.1 | 0.7 | 8.5 | **1.2** | −0.0 | +2.2 | 0.2 | 0.4 | 0.0 |
| K1 | 122 | 34.8 | +0.2 | +0.2 | −0.0 | 0.2 | 0.7 | 0.3 | 0.2 | −2.6 | +0.8 | 3.1 | **4.3** | 0.1 |
| J1 | 6 | 24.4 | +0.1 | +1.2 | −2.0 | 0.2 | 0.6 | 5.9 | 0.3 | +0.3 | +11.4 | 1.3 | **3.4** | 0.2 |
| OO1 | 4 | 40.9 | +1.0 | +23.8 | −0.6 | 1.0 | 0.4 | 5.1 | **1.4** | +1.0 | +5.2 | 1.1 | **1.7** | 0.7 |
| 2N2 | 1 | 161.6 | −0.2 | −20.3 | +8.7 | 0.2 | 0.3 | 18.0 | 0.5 | −0.1 | +13.2 | 0.2 | **1.6** | 0.3 |
| MU2 | 1 | 137.3 | +0.0 | +3.8 | −5.0 | 0.1 | 0.3 | 13.8 | 0.4 | +0.2 | −1.7 | 0.2 | 0.4 | 0.2 |
| N2 | 5 | 169.2 | +0.0 | +1.0 | +2.1 | 0.2 | 0.3 | 2.8 | 0.8 | −0.2 | +5.7 | 0.5 | **3.7** | 0.1 |
| NU2 | 1 | 190.3 | −0.1 | −6.9 | −0.6 | 0.1 | 0.3 | 15.4 | 0.1 | −0.2 | +2.9 | 0.2 | 0.3 | 0.1 |
| M2 | 17 | 160.9 | −0.3 | −1.9 | +1.1 | 0.5 | 0.3 | 0.9 | **1.3** | −2.0 | +2.6 | 2.2 | **5.2** | 0.3 |
| LAM2 | 0 | 0.0 | +0.4 |  |  | 0.4 | 0.3 | 38.8 | 0.7 | +0.1 |  | 0.1 | 0.3 | 0.3 |
| L2 | 0 | 0.0 | +0.2 |  |  | 0.2 | 0.2 | 81.5 | 0.3 | +0.1 |  | 0.1 | 0.2 | 0.3 |
| T2 | 1 | 78.0 | −0.3 | −34.5 | +14.6 | 0.4 | 0.2 | 21.3 | 0.7 | −0.6 | +11.8 | 0.6 | **1.2** | 0.2 |
| S2 | 9 | 147.8 | −0.1 | −0.6 | −1.5 | 0.2 | 0.2 | 1.6 | 1.0 | −1.6 | +2.4 | 1.6 | **3.1** | 0.2 |
| R2 | 1 | 304.1 | −0.4 | −41.1 | +13.2 | 0.4 | 0.2 | 23.7 | 0.7 | −0.6 | −22.8 | 0.7 | **1.2** | 0.5 |
| K2 | 1 | 146.2 | −0.5 | −45.6 | −16.5 | 0.5 | 0.2 | 20.6 | 0.8 | −0.6 | −0.2 | 0.6 | **1.2** | 0.5 |
| 2SM2 | 1 | 94.8 | −0.6 | −63.9 | −12.9 | 0.7 | 0.3 | 39.7 | **1.1** | snr |  |  |  | 0.5 |
| 2MK3 | 2 | 202.2 | −0.1 (MO3) | −7.2 | −3.0 | 0.2 | 0.2 | 5.8 | 0.5 | −0.4 (MO3) | +2.2 | 0.4 | 0.7 | 0.2 |
| M3 | 0 | 0.0 | snr |  |  |  |  |  |  | +0.2 |  | 0.2 | 0.4 | 0.2 |
| MK3 | 2 | 205.0 | −0.3 | −13.3 | −1.8 | 0.3 | 0.2 | 6.6 | 0.5 | −0.3 | +8.2 | 0.4 | **2.0** | 0.2 |
| MN4 | 2 | 335.2 | −0.5 | −23.4 | +5.2 | 0.5 | 0.2 | 7.5 | 0.9 | −0.7 | +1.6 | 0.7 | **1.4** | 0.5 |
| M4 | 3 | 1.6 | −0.1 | −2.9 | +1.4 | 0.1 | 0.2 | 4.0 | 0.3 | −0.4 | +4.0 | 0.4 | **1.7** | 0.2 |
| MS4 | 2 | 6.4 | −0.3 | −17.4 | +3.1 | 0.4 | 0.2 | 6.8 | 0.6 | −0.6 | +1.9 | 0.6 | **1.1** | 0.5 |
| S4 | 1 | 115.7 | −0.4 | −39.5 | +0.5 | 0.4 | 0.2 | 18.0 | 0.7 | −0.1 | +16.1 | 0.3 | **2.3** | 0.3 |
| M6 | 1 | 16.0 | −0.1 | −13.8 | +14.2 | 0.3 | 0.2 | 15.1 | 0.9 | −0.2 | +15.8 | 0.3 | **1.9** | 0.2 |
| S6 | 0 | 0.0 | snr |  |  |  |  |  |  | +0.1 |  | 0.1 | 0.2 | 0.2 |
| M8 | 0 | 0.0 | snr |  |  |  |  |  |  | +0.1 |  | 0.1 | 0.1 | 0.1 |

### Galveston Pier 21 (`coops/8771450`)

NOAA: "Vector average of 5 years (2021-2025). Ssa and Sa from 19 one-year LSQHA analyses between 2006-2025." NOAA's years, 2021–2025: 43,338 hourly values, 59 constituents kept. Standard, 2006 to 2024: 165,797 hourly values, 68 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 88 | 154.9 | −25.6 | −29.1 | +3.9 | 26.1 | 12.6 | 11.6 | **2.0** | −7.2 | +4.3 | 9.6 | **1.1** | 15.1 |
| SSA | 92 | 61.3 | +15.9 | +17.2 | +2.6 | 16.5 | 12.7 | 6.7 | **1.2** | +1.8 | +0.7 | 2.1 | 0.3 | 13.3 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 14.3 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 10.8 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 10.4 |
| 2Q1 | 4 | 21.4 | −0.8 | −19.6 | +3.8 | 0.8 | 1.0 | 17.4 | 0.7 | −0.3 | −12.7 | 0.9 | **1.4** | 0.2 |
| Q1 | 27 | 26.7 | +0.7 | +2.7 | −0.4 | 0.8 | 1.0 | 2.0 | 0.7 | +0.1 | −0.1 | 0.1 | 0.1 | 0.3 |
| RHO | 5 | 39.2 | −0.2 | −3.6 | −6.2 | 0.6 | 1.0 | 11.6 | 0.5 | +0.1 | −7.0 | 0.6 | **1.0** | 0.8 |
| O1 | 124 | 45.0 | +1.3 | +1.1 | +0.1 | 1.3 | 1.0 | 0.4 | **1.2** | +0.6 | +0.4 | 1.0 | **1.4** | 0.4 |
| M1 | 4 | 71.9 | +2.6 (NO1) | +64.5 | −18.2 | 3.0 | 1.0 | 8.7 | **2.3** | +2.8 (NO1) | −25.1 | 3.6 | **5.0** | 0.5 |
| P1 | 38 | 46.8 | −0.4 | −1.1 | +1.1 | 0.8 | 1.1 | 1.7 | 0.7 | −0.3 | +0.2 | 0.3 | 0.4 | 0.8 |
| S1 | 9 | 326.6 | +0.7 | +7.9 | +1.0 | 0.7 | 1.1 | 6.6 | 0.6 | +0.7 | +9.0 | 1.6 | **2.5** | 0.3 |
| K1 | 130 | 53.3 | +0.2 | +0.1 | +0.2 | 0.5 | 1.0 | 0.5 | 0.5 | +0.3 | +0.6 | 1.5 | **2.4** | 0.2 |
| J1 | 6 | 37.2 | +0.7 | +11.2 | −6.0 | 0.9 | 1.0 | 8.5 | 0.7 | +0.6 | +3.3 | 0.7 | 0.7 | 0.5 |
| OO1 | 7 | 82.0 | +0.1 | +2.1 | −2.8 | 0.4 | 0.7 | 5.5 | 0.5 | −0.0 | −0.2 | 0.0 | 0.1 | 0.0 |
| 2N2 | 4 | 224.2 | −0.6 | −13.8 | −0.7 | 0.6 | 0.8 | 12.5 | 0.6 | −0.6 | +29.2 | 2.0 | **5.2** | 0.5 |
| MU2 | 4 | 227.9 | −0.4 | −10.9 | +1.4 | 0.4 | 0.8 | 12.1 | 0.5 | −0.4 | +6.0 | 0.5 | **1.1** | 0.2 |
| N2 | 22 | 269.5 | −0.3 | −1.4 | +0.1 | 0.3 | 0.8 | 2.0 | 0.3 | +0.2 | +2.9 | 1.1 | **3.3** | 0.5 |
| NU2 | 4 | 277.8 | +0.5 | +13.0 | −5.4 | 0.7 | 0.8 | 9.6 | 0.6 | +0.6 | −4.3 | 0.7 | **1.0** | 0.4 |
| M2 | 85 | 293.5 | +0.0 | +0.1 | −0.2 | 0.2 | 0.8 | 0.5 | 0.3 | −0.7 | +1.2 | 1.9 | **5.0** | 0.2 |
| LAM2 | 1 | 44.9 | −0.1 | −5.3 | −5.6 | 0.1 | 0.8 | 45.6 | 0.1 | +0.2 | +10.0 | 0.3 | 0.6 | 0.3 |
| L2 | 2 | 28.5 | −0.0 | −1.2 | −5.7 | 0.2 | 0.7 | 20.6 | 0.3 | −0.1 | +0.9 | 0.1 | 0.2 | 0.2 |
| T2 | 3 | 315.4 | −0.3 | −11.2 | −10.9 | 0.6 | 0.7 | 15.8 | 0.7 | +0.0 | −15.6 | 0.8 | **2.4** | 0.3 |
| S2 | 24 | 295.4 | +0.2 | +0.9 | −1.5 | 0.7 | 0.7 | 1.7 | 0.9 | +0.5 | −2.2 | 1.1 | **2.8** | 0.1 |
| R2 | 1 | 166.3 | +0.5 | +50.3 | −10.6 | 0.6 | 0.7 | 28.0 | 0.6 | +0.5 | −14.4 | 0.6 | **1.1** | 0.1 |
| K2 | 3 | 4.1 | +0.0 | +1.2 | −2.5 | 0.1 | 0.6 | 11.1 | 0.2 | +0.7 | +15.3 | 1.1 | **3.1** | 0.1 |
| 2SM2 | 1 | 298.0 | −0.3 | −33.2 | −4.6 | 0.3 | 0.8 | 64.7 | 0.4 | +0.1 | +44.1 | 0.8 | **2.6** | 0.4 |
| 2MK3 | 1 | 218.2 | −0.6 (MO3) | −58.2 | −2.2 | 0.6 | 0.4 | 52.9 | 0.9 | −0.3 (MO3) | −28.4 | 0.5 | **1.8** | 0.5 |
| M3 | 1 | 33.3 | −0.3 | −31.7 | +2.7 | 0.3 | 0.4 | 37.7 | 0.5 | −0.6 | +9.8 | 0.6 | **1.2** | 0.3 |
| MK3 | 1 | 193.8 | −0.7 | −66.9 | −35.9 | 0.8 | 0.4 | 70.3 | **1.0** | −0.3 | −26.1 | 0.5 | **1.6** | 0.5 |
| MN4 | 2 | 209.0 | +0.2 | +9.3 | −1.7 | 0.2 | 0.5 | 12.5 | 0.3 | −0.1 | +8.2 | 0.3 | **1.5** | 0.1 |
| M4 | 5 | 256.9 | −0.4 | −8.3 | +3.4 | 0.5 | 0.5 | 6.0 | 0.6 | −0.6 | +0.4 | 0.6 | **1.2** | 0.5 |
| MS4 | 2 | 265.9 | +0.3 | +12.9 | +2.7 | 0.3 | 0.5 | 11.8 | 0.4 | +0.3 | +8.5 | 0.4 | **1.8** | 0.3 |
| S4 | 1 | 343.1 | +0.1 | +8.1 | −6.9 | 0.1 | 0.5 | 23.9 | 0.3 | +0.2 | +16.0 | 0.4 | **1.8** | 0.1 |
| M6 | 1 | 273.5 | −0.4 | −40.8 | −3.9 | 0.4 | 0.4 | 35.8 | 0.7 | −0.3 | +13.9 | 0.4 | **1.0** | 0.5 |
| S6 | 0 | 0.0 | +0.4 |  |  | 0.4 | 0.3 | 51.3 | 0.6 | +0.4 |  | 0.4 | 0.7 | 0.4 |
| M8 | 0 | 0.0 | +0.3 |  |  | 0.3 | 0.2 | 39.0 | 0.6 | +0.2 |  | 0.2 | 0.4 | 0.2 |

### San Diego (`coops/9410170`)

NOAA: "Vector Average of 5 years (2017-2021). Sa from average of 20 years (2002-2021), other long period constituents are unstable." NOAA's years, 2017–2021: 43,820 hourly values, 69 constituents kept. Standard, 2006 to 2024: 166,465 hourly values, 72 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 76 | 180.5 | −8.8 | −11.6 | +2.7 | 9.4 | 4.8 | 4.1 | **1.8** | −1.1 | −3.0 | 4.2 | **1.4** | 10.0 |
| SSA | 0 | 0.0 | +13.0 |  |  | 13.0 | 4.9 | 21.3 | **2.7** | +11.8 |  | 11.8 | **4.2** | 14.1 |
| MM | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 2.9 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 4.2 |
| MF | 0 | 0.0 | snr |  |  |  |  |  |  | +6.6 |  | 6.6 | **2.5** | 7.9 |
| 2Q1 | 5 | 186.1 | +0.1 | +2.1 | +0.6 | 0.1 | 0.4 | 4.0 | 0.2 | −0.2 | −1.8 | 0.3 | 0.8 | 0.2 |
| Q1 | 39 | 185.4 | +0.3 | +0.8 | −0.1 | 0.3 | 0.4 | 0.5 | 0.5 | +0.3 | −0.9 | 0.7 | **3.1** | 0.1 |
| RHO | 8 | 184.9 | −0.4 | −5.6 | +2.2 | 0.5 | 0.4 | 2.7 | 0.8 | −0.3 | +0.4 | 0.3 | 0.5 | 0.3 |
| O1 | 214 | 192.6 | +0.3 | +0.1 | +0.0 | 0.3 | 0.4 | 0.1 | 0.4 | +1.0 | −0.1 | 1.0 | **1.9** | 0.5 |
| M1 | 13 | 225.1 | +4.3 (NO1) | +33.4 | −18.3 | 6.5 | 0.4 | 1.2 | **15.6** | +4.3 (NO1) | −24.4 | 7.7 | **38.7** | 0.6 |
| P1 | 106 | 205.9 | +0.6 | +0.6 | −0.5 | 1.1 | 0.3 | 0.2 | **2.5** | +0.4 | −1.4 | 2.7 | **12.5** | 0.4 |
| S1 | 5 | 329.0 | +1.5 | +30.6 | −3.8 | 1.6 | 0.3 | 3.0 | **2.5** | +1.7 | −1.8 | 1.7 | **3.1** | 0.3 |
| K1 | 337 | 208.4 | −0.1 | −0.0 | −0.0 | 0.1 | 0.4 | 0.1 | 0.1 | +1.0 | −0.4 | 2.3 | **5.9** | 0.3 |
| J1 | 19 | 220.9 | −0.2 | −0.9 | +0.6 | 0.2 | 0.4 | 1.1 | 0.5 | +0.6 | +0.6 | 0.6 | **1.0** | 0.1 |
| OO1 | 11 | 241.9 | −0.2 | −1.4 | −0.3 | 0.2 | 0.4 | 1.9 | 0.3 | −0.1 | −0.8 | 0.2 | 1.0 | 0.3 |
| 2N2 | 16 | 95.4 | +0.2 | +1.2 | +0.5 | 0.2 | 0.5 | 1.7 | 0.3 | +0.1 | +1.4 | 0.4 | **2.5** | 0.1 |
| MU2 | 15 | 92.0 | −0.2 | −1.1 | −0.1 | 0.2 | 0.5 | 1.8 | 0.2 | +0.1 | −0.3 | 0.1 | 0.5 | 0.0 |
| N2 | 126 | 123.1 | −0.1 | −0.1 | +0.1 | 0.2 | 0.5 | 0.2 | 0.4 | +1.7 | +0.4 | 2.0 | **4.9** | 0.1 |
| NU2 | 25 | 129.7 | −0.7 | −2.7 | +0.1 | 0.7 | 0.5 | 1.1 | 1.0 | −0.5 | −0.5 | 0.5 | **1.4** | 0.4 |
| M2 | 542 | 143.3 | +0.1 | +0.0 | +0.0 | 0.3 | 0.5 | 0.0 | 0.5 | +0.9 | +0.1 | 1.1 | **1.8** | 0.3 |
| LAM2 | 3 | 134.0 | −0.3 | −11.1 | −8.9 | 0.6 | 0.5 | 10.1 | 0.9 | −0.4 | −5.1 | 0.5 | **1.5** | 0.1 |
| L2 | 12 | 124.5 | +0.6 | +5.3 | +4.7 | 1.2 | 0.5 | 2.1 | **2.3** | −0.8 | +16.5 | 3.4 | **21.1** | 0.1 |
| T2 | 14 | 128.1 | −0.8 | −5.8 | +1.1 | 0.9 | 0.5 | 2.1 | **1.2** | −0.5 | +0.9 | 0.5 | **1.3** | 0.7 |
| S2 | 225 | 140.4 | −0.5 | −0.2 | +0.2 | 0.8 | 0.5 | 0.1 | **1.1** | −0.1 | +0.1 | 0.4 | **1.7** | 0.4 |
| R2 | 2 | 155.6 | −0.3 | −14.0 | −28.7 | 1.0 | 0.5 | 15.9 | **1.8** | −0.4 | −20.6 | 0.8 | **3.6** | 0.3 |
| K2 | 66 | 134.5 | +0.3 | +0.4 | +0.1 | 0.3 | 0.5 | 0.4 | 0.4 | +0.0 | −1.0 | 1.2 | **7.4** | 0.3 |
| 2SM2 | 2 | 312.3 | +0.4 | +21.3 | +1.7 | 0.4 | 0.5 | 11.1 | 0.6 | +0.2 | +0.7 | 0.2 | 0.4 | 0.5 |
| 2MK3 | 3 | 192.8 | +0.0 (MO3) | +0.5 | +4.8 | 0.3 | 0.2 | 4.2 | **1.1** | −0.2 (MO3) | −10.4 | 0.6 | **5.0** | 0.0 |
| M3 | 3 | 356.5 | +0.3 | +11.5 | −0.3 | 0.3 | 0.2 | 3.6 | 0.6 | +0.4 | −3.0 | 0.4 | **1.8** | 0.3 |
| MK3 | 2 | 215.5 | +0.2 | +8.0 | −4.7 | 0.2 | 0.2 | 5.7 | 0.8 | +0.1 | −0.5 | 0.1 | 0.2 | 0.1 |
| MN4 | 2 | 213.1 | −0.4 | −22.0 | −0.5 | 0.4 | 0.2 | 7.0 | 0.8 | −0.4 | +3.2 | 0.4 | 1.0 | 0.4 |
| M4 | 3 | 255.5 | −0.3 | −9.3 | −0.8 | 0.3 | 0.2 | 4.0 | 0.5 | −0.3 | +5.3 | 0.4 | **2.6** | 0.2 |
| MS4 | 2 | 203.2 | −0.2 | −11.4 | −0.2 | 0.2 | 0.2 | 6.2 | 0.4 | −0.1 | −6.1 | 0.2 | **2.1** | 0.3 |
| S4 | 1 | 230.2 | +0.1 | +8.0 | −4.2 | 0.1 | 0.2 | 10.3 | 0.4 | +0.1 | +9.0 | 0.2 | **1.9** | 0.0 |
| M6 | 4 | 62.2 | +0.1 | +2.8 | −0.5 | 0.1 | 0.3 | 3.7 | 0.2 | +0.2 | +0.7 | 0.2 | 0.3 | 0.1 |
| S6 | 1 | 68.1 | −0.4 | −36.3 | −4.9 | 0.4 | 0.3 | 24.9 | 0.6 | −0.4 | −11.6 | 0.4 | 0.8 | 0.4 |
| M8 | 0 | 0.0 | +0.2 |  |  | 0.2 | 0.1 | 32.4 | 0.4 | +0.2 |  | 0.2 | 0.3 | 0.2 |

### South Beach (`coops/9435380`)

NOAA: "Mean of six 1-year LSQHA (2007-2012). Sa and Ssa from 20 years of MSL (1994-2013). Mf from mean of six LSQHA (2007-2012)." NOAA's years, 2007–2012: 52,569 hourly values, 70 constituents kept. Standard, 2006 to 2024: 166,282 hourly values, 73 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 122 | 285.9 | −25.4 | −20.8 | −2.6 | 25.9 | 13.1 | 7.7 | **1.9** | −17.5 | −6.5 | 21.7 | **2.5** | 16.3 |
| SSA | 27 | 234.0 | seasonal |  |  |  |  |  |  | −11.1 | +6.3 | 11.3 | **1.6** | 12.2 |
| MM | 0 | 0.0 | +15.6 |  |  | 15.6 | 13.5 | 49.9 | **1.2** | +11.1 |  | 11.1 | **1.6** | 20.0 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 6.3 |
| MF | 25 | 183.0 | −0.7 | −2.9 | −18.5 | 8.0 | 10.9 | 25.9 | 0.7 | −6.0 | −13.9 | 8.0 | 0.9 | 0.2 |
| 2Q1 | 5 | 214.4 | +0.5 | +10.2 | −2.4 | 0.6 | 0.6 | 5.9 | 0.7 | +0.5 | +2.4 | 0.5 | 0.8 | 0.5 |
| Q1 | 46 | 214.2 | +0.8 | +1.8 | −0.1 | 0.8 | 0.6 | 0.7 | **1.1** | +0.4 | −0.4 | 0.5 | 0.9 | 0.4 |
| RHO | 9 | 211.9 | −0.0 | −0.5 | +0.9 | 0.1 | 0.6 | 3.7 | 0.2 | −0.4 | +1.4 | 0.4 | 0.6 | 0.1 |
| O1 | 263 | 221.4 | +2.2 | +0.8 | −0.1 | 2.2 | 0.6 | 0.1 | **2.9** | +1.0 | −0.1 | 1.0 | **1.6** | 0.6 |
| M1 | 15 | 257.9 | +7.1 (NO1) | +47.5 | −16.6 | 8.8 | 0.6 | 1.5 | **11.0** | +7.4 (NO1) | −24.6 | 10.8 | **29.1** | 0.4 |
| P1 | 134 | 233.9 | +0.2 | +0.2 | +0.7 | 1.7 | 0.6 | 0.3 | **2.7** | +0.9 | +1.2 | 3.0 | **8.1** | 0.3 |
| S1 | 12 | 5.4 | −2.0 | −16.6 | +1.3 | 2.0 | 0.6 | 3.5 | **2.5** | −2.4 | +3.5 | 2.5 | **4.0** | 0.1 |
| K1 | 434 | 238.1 | +0.6 | +0.1 | −0.1 | 0.8 | 0.6 | 0.1 | 0.8 | −0.3 | +0.1 | 0.6 | **1.0** | 0.5 |
| J1 | 24 | 256.0 | +0.4 | +1.8 | −0.7 | 0.5 | 0.6 | 1.3 | 0.6 | +0.6 | −1.1 | 0.8 | **1.5** | 0.1 |
| OO1 | 14 | 274.4 | −0.1 | −0.4 | −0.3 | 0.1 | 0.5 | 1.9 | 0.2 | +0.5 | −1.1 | 0.5 | **1.0** | 0.0 |
| 2N2 | 21 | 182.5 | −0.3 | −1.2 | −0.5 | 0.3 | 0.4 | 1.2 | 0.4 | −0.2 | +1.2 | 0.5 | **1.7** | 0.2 |
| MU2 | 15 | 203.9 | −0.5 | −3.5 | +2.5 | 0.8 | 0.4 | 1.7 | **1.4** | −1.2 | +4.2 | 1.6 | **4.0** | 0.0 |
| N2 | 184 | 207.5 | +0.0 | +0.0 | −0.1 | 0.2 | 0.4 | 0.1 | 0.4 | −0.6 | +0.3 | 1.0 | **2.8** | 0.0 |
| NU2 | 37 | 210.4 | −0.0 | −0.0 | +0.2 | 0.1 | 0.4 | 0.7 | 0.2 | −0.1 | +0.3 | 0.3 | 0.9 | 0.3 |
| M2 | 887 | 231.2 | +1.0 | +0.1 | −0.0 | 1.0 | 0.4 | 0.0 | **1.5** | −1.5 | +0.2 | 3.2 | **3.5** | 1.1 |
| LAM2 | 7 | 223.2 | −0.3 | −4.3 | +2.5 | 0.4 | 0.4 | 3.7 | 0.7 | −0.1 | +3.2 | 0.4 | **1.5** | 0.3 |
| L2 | 22 | 235.9 | +0.1 | +0.4 | +0.5 | 0.2 | 0.4 | 1.1 | 0.5 | +0.8 | +4.3 | 1.9 | **6.9** | 0.4 |
| T2 | 15 | 251.7 | −0.0 | −0.2 | −1.5 | 0.4 | 0.4 | 1.6 | 0.9 | +0.1 | −0.5 | 0.1 | 0.5 | 0.1 |
| S2 | 242 | 259.3 | +0.2 | +0.1 | −0.1 | 0.5 | 0.4 | 0.1 | 0.9 | −0.9 | −0.0 | 0.9 | **1.5** | 0.2 |
| R2 | 2 | 213.6 | −0.7 | −33.8 | +24.9 | 1.0 | 0.4 | 18.6 | **1.3** | −0.2 | +29.0 | 1.0 | **3.6** | 0.4 |
| K2 | 64 | 250.6 | +0.3 | +0.5 | −0.1 | 0.4 | 0.4 | 0.3 | 0.5 | +1.2 | +0.3 | 1.2 | **2.1** | 0.4 |
| 2SM2 | 2 | 54.2 | +0.5 | +22.5 | −3.3 | 0.5 | 0.4 | 10.1 | 0.7 | +0.6 | −6.9 | 0.6 | **1.2** | 0.3 |
| 2MK3 | 2 | 349.0 | −0.2 (MO3) | −7.6 | +4.8 | 0.2 | 0.2 | 6.1 | 0.8 | +0.2 (MO3) | +13.6 | 0.5 | **5.2** | 0.2 |
| M3 | 0 | 0.0 | +0.6 |  |  | 0.6 | 0.2 | 20.3 | **1.1** | +1.1 |  | 1.1 | **2.1** | 0.5 |
| MK3 | 3 | 196.9 | +0.4 | +13.9 | −4.8 | 0.5 | 0.2 | 3.4 | **1.4** | +0.1 | −6.1 | 0.3 | **3.3** | 0.1 |
| MN4 | 5 | 180.3 | +0.3 | +5.1 | −3.6 | 0.4 | 0.3 | 3.3 | **1.1** | +0.1 | −5.1 | 0.5 | **3.7** | 0.0 |
| M4 | 12 | 198.8 | +1.3 | +10.7 | −1.3 | 1.3 | 0.3 | 1.3 | **2.2** | +0.9 | −0.5 | 0.9 | **1.8** | 0.6 |
| MS4 | 7 | 239.9 | +0.1 | +1.3 | −1.4 | 0.2 | 0.3 | 2.5 | 0.6 | −0.4 | +0.8 | 0.4 | 0.7 | 0.2 |
| S4 | 1 | 349.7 | +0.3 | +33.3 | +4.3 | 0.3 | 0.3 | 12.9 | 0.6 | +0.5 | −1.6 | 0.5 | 0.9 | 0.1 |
| M6 | 8 | 298.3 | +0.0 | +0.1 | +0.2 | 0.0 | 0.2 | 1.6 | 0.2 | +0.4 | +2.3 | 0.5 | **2.2** | 0.3 |
| S6 | 1 | 123.6 | −0.3 | −34.7 | +7.0 | 0.4 | 0.2 | 18.6 | 0.6 | −0.4 | +0.9 | 0.4 | 0.8 | 0.2 |
| M8 | 2 | 260.4 | −0.4 | −18.1 | −2.9 | 0.4 | 0.1 | 4.6 | 0.7 | −0.3 | −1.4 | 0.3 | 0.6 | 0.5 |

### Friday Harbor (`coops/9449880`)

NOAA: "6 Year Vector Averaged (2011-2016). Sa, SSa, and MF from 20 years (1997-2016)." NOAA's years, 2011–2016: 52,604 hourly values, 69 constituents kept. Standard, 2006 to 2024: 166,551 hourly values, 73 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 76 | 274.5 | −24.8 | −32.6 | −11.8 | 27.9 | 12.1 | 13.4 | **2.0** | −13.2 | −0.8 | 13.2 | **2.1** | 14.9 |
| SSA | 22 | 227.5 | seasonal |  |  |  |  |  |  | +0.9 | −0.9 | 1.0 | 0.1 | 26.6 |
| MM | 9 | 168.8 | snr |  |  |  |  |  |  | +3.8 | +14.0 | 4.6 | 0.6 | 0.0 |
| MSF | 7 | 265.1 | snr |  |  |  |  |  |  | snr |  |  |  | 0.2 |
| MF | 21 | 156.4 | +3.0 | +14.4 | +10.7 | 5.2 | 15.6 | 37.4 | 0.3 | −2.9 | +2.1 | 3.0 | 0.5 | 3.8 |
| 2Q1 | 8 | 253.5 | −0.4 | −4.7 | +2.0 | 0.5 | 1.4 | 10.8 | 0.2 | +0.7 | −0.4 | 0.7 | 0.9 | 0.2 |
| Q1 | 73 | 250.7 | −0.0 | −0.0 | −0.3 | 0.3 | 1.4 | 1.1 | 0.2 | +0.3 | −1.1 | 1.5 | **2.2** | 0.1 |
| RHO | 13 | 245.9 | +0.4 | +3.2 | +2.8 | 0.8 | 1.4 | 6.2 | 0.5 | +1.2 | +2.1 | 1.3 | **1.4** | 0.1 |
| O1 | 434 | 258.7 | +0.5 | +0.1 | +0.3 | 2.4 | 1.4 | 0.2 | **1.6** | −1.7 | −0.4 | 3.8 | **4.5** | 0.4 |
| M1 | 25 | 298.0 | +10.9 (NO1) | +43.7 | −17.4 | 14.2 | 1.4 | 2.2 | **7.8** | +12.3 (NO1) | −16.4 | 15.1 | **16.2** | 0.6 |
| P1 | 235 | 278.0 | +1.9 | +0.8 | +0.3 | 2.3 | 1.3 | 0.3 | **1.4** | +2.4 | +0.6 | 3.6 | **3.8** | 0.5 |
| S1 | 24 | 26.8 | −0.6 | −2.3 | +10.7 | 4.5 | 1.3 | 3.1 | **3.4** | +0.3 | +9.6 | 4.0 | **6.0** | 0.3 |
| K1 | 760 | 280.4 | −1.6 | −0.2 | −0.0 | 1.6 | 1.4 | 0.1 | **1.1** | +0.0 | −0.4 | 5.7 | **6.0** | 0.7 |
| J1 | 42 | 315.1 | −0.5 | −1.1 | +0.2 | 0.5 | 1.4 | 2.0 | 0.3 | −0.8 | −3.9 | 3.0 | **4.3** | 0.3 |
| OO1 | 30 | 325.7 | −1.0 | −3.2 | +1.6 | 1.3 | 1.9 | 3.7 | 0.5 | −0.5 | +0.9 | 0.7 | 0.8 | 0.0 |
| 2N2 | 13 | 309.4 | −0.2 | −1.9 | +1.4 | 0.4 | 0.6 | 2.7 | 0.5 | +0.8 | +4.8 | 1.4 | **3.5** | 0.2 |
| MU2 | 17 | 266.6 | −0.5 | −3.1 | +0.9 | 0.6 | 0.6 | 2.1 | 0.7 | +0.1 | −1.2 | 0.4 | **1.1** | 0.2 |
| N2 | 120 | 343.0 | −0.1 | −0.1 | +0.0 | 0.1 | 0.6 | 0.3 | 0.1 | +0.3 | −0.5 | 1.1 | **3.2** | 0.2 |
| NU2 | 24 | 350.1 | −0.2 | −0.8 | −0.6 | 0.3 | 0.6 | 1.5 | 0.4 | −0.2 | −0.2 | 0.2 | 0.3 | 0.0 |
| M2 | 557 | 10.6 | +0.4 | +0.1 | −0.1 | 0.8 | 0.6 | 0.1 | 0.8 | +1.9 | −0.0 | 1.9 | **3.1** | 0.1 |
| LAM2 | 8 | 60.0 | −0.1 | −1.8 | +2.6 | 0.4 | 0.6 | 4.5 | 0.6 | −0.1 | +1.3 | 0.2 | 0.5 | 0.2 |
| L2 | 21 | 52.4 | −0.0 | −0.2 | −0.8 | 0.3 | 0.6 | 1.7 | 0.5 | −1.0 | −1.1 | 1.1 | **1.7** | 0.0 |
| T2 | 11 | 39.9 | −0.1 | −1.3 | +0.0 | 0.1 | 0.6 | 3.3 | 0.2 | −0.2 | −0.6 | 0.2 | 0.3 | 0.1 |
| S2 | 132 | 35.7 | −0.6 | −0.4 | −0.1 | 0.6 | 0.6 | 0.3 | 0.7 | +1.2 | −0.1 | 1.3 | **2.0** | 0.1 |
| R2 | 2 | 313.6 | −0.0 | −0.3 | +12.3 | 0.4 | 0.6 | 18.1 | 0.7 | +0.1 | +18.3 | 0.7 | **2.0** | 0.1 |
| K2 | 35 | 44.0 | −0.1 | −0.2 | −0.6 | 0.4 | 0.8 | 1.2 | 0.5 | +1.4 | −2.4 | 2.0 | **4.8** | 0.2 |
| 2SM2 | 2 | 289.1 | +0.2 | +11.6 | −3.5 | 0.3 | 0.6 | 15.7 | 0.3 | +0.4 | −4.9 | 0.5 | 0.7 | 0.3 |
| 2MK3 | 9 | 19.5 | +0.3 (MO3) | +3.8 | −3.7 | 0.7 | 0.4 | 2.3 | **1.6** | +0.3 (MO3) | −5.1 | 0.9 | **8.4** | 0.5 |
| M3 | 1 | 127.1 | +0.6 | +55.7 | +1.9 | 0.6 | 0.3 | 12.1 | 0.9 | −0.2 | −45.4 | 0.7 | **6.3** | 0.3 |
| MK3 | 12 | 27.5 | +0.4 | +3.2 | +0.6 | 0.4 | 0.4 | 1.7 | 0.6 | +0.4 | −0.5 | 0.4 | 1.0 | 0.2 |
| MN4 | 7 | 92.0 | −0.1 | −1.9 | +0.7 | 0.2 | 0.3 | 2.7 | 0.3 | −0.1 | −1.2 | 0.2 | 1.0 | 0.2 |
| M4 | 16 | 124.6 | +0.9 | +5.5 | +2.2 | 1.1 | 0.3 | 1.1 | **2.0** | +1.1 | −1.3 | 1.2 | **2.5** | 0.2 |
| MS4 | 10 | 134.0 | −0.4 | −3.7 | +1.6 | 0.5 | 0.3 | 2.0 | 0.8 | +0.1 | +0.6 | 0.2 | 0.7 | 0.6 |
| S4 | 2 | 157.0 | −0.3 | −17.0 | −4.7 | 0.4 | 0.3 | 11.6 | 0.6 | −0.3 | −11.2 | 0.5 | **2.2** | 0.3 |
| M6 | 5 | 237.2 | +0.0 | +0.2 | −0.1 | 0.0 | 0.2 | 2.0 | 0.1 | +0.0 | −1.7 | 0.2 | **1.3** | 0.1 |
| S6 | 1 | 255.9 | −0.6 | −60.2 | +14.3 | 0.6 | 0.2 | 27.7 | **1.1** | −0.6 | −7.0 | 0.6 | **1.2** | 0.5 |
| M8 | 1 | 105.2 | −0.0 | −3.3 | +2.0 | 0.0 | 0.1 | 4.9 | 0.4 | +0.1 | +2.4 | 0.1 | 0.9 | 0.1 |

### Anchorage (`coops/9455920`)

NOAA: "5-year (2012-2016) Vector Averaged. Mm, Msf, Mf from average of 20 years (1996-2016). Sa and SSa from 20year analysis." NOAA's years, 2012–2016: 43,825 hourly values, 71 constituents kept. Standard, 2006 to 2024: 164,045 hourly values, 75 kept. The engine's catalog has no line that is NOAA's 4MSL12, which no fit or prediction here holds as NOAA's. NOAA also publishes 65 constituents the candidate list doesn't have, which aren't compared.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 96 | 217.4 | −11.3 | −11.8 | −8.4 | 17.4 | 14.6 | 9.9 | 0.8 | +6.0 | −10.3 | 18.8 | **2.3** | 14.4 |
| SSA | 24 | 283.0 | seasonal |  |  |  |  |  |  | −4.9 | −21.2 | 9.3 | 0.9 | 6.9 |
| MM | 51 | 36.1 | −7.1 | −13.9 | −2.6 | 7.4 | 13.2 | 17.3 | 0.5 | +0.4 | −1.1 | 1.1 | 0.1 | 7.5 |
| MSF | 135 | 39.6 | +3.6 | +2.6 | −1.2 | 4.5 | 14.2 | 5.9 | 0.3 | +1.7 | +0.6 | 2.2 | 0.2 | 4.1 |
| MF | 25 | 94.7 | −7.1 | −28.4 | −6.7 | 7.5 | 20.5 | 65.6 | 0.3 | +0.2 | +16.2 | 7.1 | 1.0 | 11.8 |
| 2Q1 | 5 | 328.4 | −1.3 | −25.4 | −24.5 | 2.2 | 2.6 | 39.2 | 0.6 | +0.9 | +0.0 | 0.9 | 0.9 | 0.1 |
| SIGMA1 | 47 | 24.4 | −6.0 | −12.8 | +10.6 | 10.1 | 2.6 | 3.6 | **3.0** | −6.8 | +9.0 | 9.6 | **7.8** | 7.8 |
| Q1 | 60 | 330.6 | −3.2 | −5.3 | −3.8 | 5.0 | 2.6 | 2.6 | **1.5** | +1.7 | −5.3 | 5.9 | **7.1** | 0.4 |
| RHO | 14 | 296.2 | −0.5 | −3.5 | −0.5 | 0.5 | 2.6 | 10.8 | 0.2 | +2.8 | −6.2 | 3.2 | **2.9** | 0.1 |
| O1 | 371 | 325.0 | −2.2 | −0.6 | +0.1 | 2.4 | 2.6 | 0.4 | 0.9 | +4.0 | −1.9 | 13.3 | **14.6** | 0.5 |
| M1 | 30 | 40.2 | +13.5 (NO1) | +45.0 | −15.9 | 16.8 | 2.5 | 3.3 | **5.3** | +12.9 (NO1) | −19.2 | 17.6 | **17.7** | 0.3 |
| CHI1 | 7 | 278.4 | +1.1 | +15.3 | +21.1 | 2.9 | 2.5 | 17.7 | **1.2** | +2.3 | +29.6 | 4.7 | **6.0** | 0.2 |
| P1 | 176 | 340.9 | +0.8 | +0.5 | +0.1 | 0.9 | 2.2 | 0.7 | 0.4 | −4.1 | +2.7 | 9.2 | **9.7** | 0.4 |
| S1 | 3 | 74.2 | +2.5 | +84.6 | +55.0 | 4.5 | 2.2 | 22.6 | **2.4** | +2.9 | +64.3 | 5.3 | **8.0** | 0.1 |
| K1 | 671 | 342.1 | −0.2 | −0.0 | −0.3 | 3.1 | 2.4 | 0.2 | **1.3** | +7.9 | −0.9 | 12.9 | **10.2** | 0.4 |
| THETA1 | 12 | 310.7 | −1.7 | −13.9 | −1.9 | 1.7 | 2.5 | 13.9 | 0.7 | −2.3 | −21.7 | 4.7 | **4.6** | 0.2 |
| J1 | 25 | 65.2 | +1.1 | +4.5 | +0.3 | 1.1 | 2.5 | 5.5 | 0.4 | +0.9 | −10.4 | 4.7 | **5.8** | 0.3 |
| SO1 | 74 | 151.1 | +0.6 | +0.8 | +3.7 | 4.8 | 2.6 | 2.0 | **1.9** | −0.2 | −0.3 | 0.4 | 0.4 | 0.2 |
| OO1 | 18 | 79.3 | −0.3 | −1.8 | −0.4 | 0.4 | 3.6 | 11.7 | 0.1 | +2.9 | −11.5 | 4.9 | **6.1** | 0.1 |
| 2N2 | 57 | 48.1 | +0.4 | +0.7 | +0.8 | 0.9 | 3.7 | 3.7 | 0.2 | −3.3 | +2.7 | 4.2 | **1.4** | 0.3 |
| MU2 | 212 | 234.0 | +1.2 | +0.6 | +1.9 | 7.2 | 3.7 | 1.0 | **1.9** | +3.7 | +3.6 | 13.8 | **5.7** | 0.5 |
| N2 | 597 | 79.2 | −0.2 | −0.0 | +0.2 | 2.2 | 3.7 | 0.4 | 0.6 | +6.5 | −0.3 | 7.1 | **2.7** | 0.4 |
| NU2 | 172 | 82.3 | −1.8 | −1.0 | −0.5 | 2.3 | 3.7 | 1.3 | 0.5 | +0.1 | +1.5 | 4.4 | **1.9** | 0.2 |
| M2 | 3505 | 105.2 | +1.4 | +0.0 | −0.0 | 3.0 | 3.8 | 0.1 | 0.6 | +20.4 | +0.1 | 21.9 | **8.5** | 1.3 |
| MKS2 | 16 | 300.1 | −2.9 | −18.2 | −2.8 | 3.0 | 4.7 | 20.5 | 0.6 | +2.5 | −8.7 | 3.6 | **1.2** | 0.5 |
| LAM2 | 93 | 111.1 | +2.3 | +2.4 | −0.3 | 2.3 | 3.7 | 2.2 | 0.6 | +2.9 | −1.7 | 4.1 | **1.2** | 0.5 |
| L2 | 211 | 125.2 | −11.3 | −5.3 | −0.1 | 11.3 | 3.6 | 1.0 | **3.1** | −10.4 | +0.1 | 10.4 | **4.4** | 0.1 |
| T2 | 54 | 128.7 | −2.6 | −4.9 | +1.6 | 3.0 | 3.8 | 4.3 | 0.7 | −1.0 | +2.0 | 2.1 | 0.8 | 0.4 |
| S2 | 977 | 147.4 | −4.4 | −0.5 | +0.0 | 4.4 | 3.9 | 0.2 | **1.1** | +11.9 | −0.2 | 12.5 | **5.0** | 1.2 |
| R2 | 11 | 233.5 | +0.4 | +3.2 | −3.3 | 0.7 | 3.8 | 19.4 | 0.2 | −2.0 | −15.1 | 3.3 | **1.0** | 0.3 |
| K2 | 271 | 138.1 | −0.7 | −0.3 | +1.1 | 5.4 | 4.8 | 1.0 | **1.1** | +10.0 | +0.9 | 10.9 | **4.4** | 0.5 |
| MSN2 | 50 | 335.1 | −5.5 | −10.9 | −0.5 | 5.5 | 3.6 | 4.7 | **1.5** | −2.0 | +0.9 | 2.2 | 0.9 | 0.1 |
| 2SM2 | 57 | 348.6 | +0.2 | +0.4 | +0.6 | 0.7 | 3.7 | 3.7 | 0.2 | +3.2 | +0.5 | 3.2 | **1.3** | 0.5 |
| 2MK3 | 99 | 21.2 | +9.1 (MO3) | +9.2 | −0.3 | 9.1 | 4.4 | 2.4 | **2.0** | −0.5 (MO3) | +1.9 | 3.4 | **7.3** | 0.6 |
| M3 | 18 | 148.0 | +2.9 | +16.1 | +3.3 | 3.1 | 3.7 | 10.2 | 0.8 | −10.4 | +69.5 | 16.9 | **20.5** | 0.1 |
| SO3 | 53 | 31.4 | −1.9 | −3.7 | +2.8 | 3.2 | 4.6 | 5.1 | 0.5 | −3.5 | +9.9 | 9.5 | **19.2** | 0.4 |
| MK3 | 82 | 8.8 | −1.4 | −1.7 | +0.3 | 1.5 | 4.2 | 3.0 | 0.3 | −5.7 | −0.4 | 5.7 | **8.5** | 0.1 |
| SK3 | 42 | 67.6 | −1.1 | −2.6 | +6.4 | 4.8 | 4.3 | 6.0 | **1.1** | −0.4 | +8.2 | 6.0 | **13.3** | 0.4 |
| N4 | 18 | 36.4 | −1.9 | −10.5 | +4.5 | 2.3 | 3.6 | 12.9 | 0.5 | −1.9 | +6.8 | 2.8 | **1.2** | 0.1 |
| MN4 | 96 | 60.0 | −0.8 | −0.8 | −0.4 | 1.0 | 3.6 | 2.2 | 0.2 | +0.7 | −1.7 | 3.0 | **1.8** | 0.3 |
| M4 | 271 | 80.7 | −0.3 | −0.1 | −1.1 | 5.4 | 3.7 | 0.8 | **1.5** | +6.0 | −2.2 | 12.0 | **6.6** | 0.5 |
| SN4 | 22 | 146.9 | −2.5 | −11.2 | +9.8 | 4.3 | 3.7 | 11.0 | 0.9 | −2.2 | +7.6 | 3.5 | **1.7** | 0.0 |
| MS4 | 175 | 128.2 | −5.2 | −3.0 | +0.1 | 5.3 | 3.8 | 1.3 | **1.4** | −0.8 | −1.4 | 4.4 | **2.7** | 0.2 |
| MK4 | 43 | 122.2 | +0.7 | +1.6 | +4.8 | 3.7 | 4.7 | 6.2 | 0.8 | +2.3 | +0.5 | 2.4 | **1.4** | 0.1 |
| S4 | 20 | 207.0 | −2.6 | −13.0 | +9.4 | 4.0 | 3.9 | 12.7 | 0.7 | −1.7 | +5.1 | 2.4 | **1.0** | 0.1 |
| 2MO5 | 35 | 268.3 | −3.3 | −9.4 | −0.9 | 3.3 | 2.0 | 3.6 | **1.6** | −4.3 | −8.0 | 6.3 | **4.0** | 0.2 |
| 2MK5 | 61 | 256.3 | −0.6 | −1.0 | −1.5 | 1.7 | 1.9 | 1.8 | 0.8 | +0.9 | −4.3 | 4.7 | **4.4** | 0.2 |
| 2MN6 | 81 | 352.7 | −2.8 | −3.5 | −0.8 | 3.0 | 3.5 | 2.6 | 0.8 | −0.3 | −1.7 | 2.4 | 0.8 | 0.5 |
| M6 | 154 | 18.2 | +2.4 | +1.6 | −0.8 | 3.2 | 3.5 | 1.3 | 0.7 | +7.5 | −1.1 | 8.1 | **2.5** | 0.4 |
| 2MS6 | 144 | 59.4 | −7.8 | −5.4 | −0.8 | 8.0 | 3.6 | 1.5 | **2.1** | +0.5 | −1.6 | 4.0 | **1.3** | 0.4 |
| 2MK6 | 38 | 46.7 | −2.1 | −5.4 | +2.1 | 2.5 | 4.6 | 7.3 | 0.5 | +1.9 | +1.6 | 2.2 | 0.6 | 0.4 |
| 2SM6 | 27 | 114.6 | −4.7 | −17.5 | −0.3 | 4.7 | 3.7 | 9.6 | **1.3** | −2.3 | −2.4 | 2.5 | 0.8 | 0.4 |
| MSK6 | 17 | 91.8 | +0.0 | +0.1 | +1.5 | 0.4 | 4.7 | 15.8 | 0.1 | +2.2 | +2.1 | 2.3 | 0.8 | 0.2 |
| S6 | 2 | 278.4 | snr |  |  |  |  |  |  | snr |  |  |  | 0.1 |
| M8 | 45 | 346.2 | +1.7 | +3.8 | −3.4 | 3.2 | 0.6 | 0.7 | **4.5** | +3.1 | −4.7 | 5.0 | **11.0** | 0.2 |

### Unalaska (`coops/9462620`)

NOAA: "Vector Average of 5 years (2020-2024). Sa and Mf from mean of 18 years (2005-2024)." NOAA's years, 2020–2024: 43,840 hourly values, 69 constituents kept. Standard, 2006 to 2024: 166,111 hourly values, 73 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 72 | 265.0 | +1.5 | +2.1 | +0.3 | 1.5 | 14.8 | 11.4 | 0.1 | +5.9 | +7.3 | 11.3 | **1.3** | 0.0 |
| SSA | 67 | 201.7 | +0.1 | +0.2 | −1.1 | 1.3 | 14.8 | 12.5 | 0.1 | −31.2 | −4.9 | 31.5 | **4.2** | 0.5 |
| MM | 19 | 160.8 | +2.7 | +14.3 | −4.8 | 3.2 | 15.9 | 41.9 | 0.2 | −11.0 | −16.0 | 11.5 | **1.5** | 0.5 |
| MSF | 9 | 119.5 | snr |  |  |  |  |  |  | −1.9 | −32.8 | 4.9 | 0.5 | 0.4 |
| MF | 23 | 207.9 | +3.9 | +16.8 | +5.9 | 4.6 | 11.4 | 24.4 | 0.3 | +4.3 | −7.0 | 5.3 | 0.6 | 0.3 |
| 2Q1 | 5 | 307.6 | +0.1 | +2.4 | +5.3 | 0.5 | 0.7 | 8.0 | 0.7 | +0.5 | −2.5 | 0.6 | 0.8 | 0.0 |
| Q1 | 43 | 300.5 | −0.2 | −0.4 | −0.9 | 0.7 | 0.7 | 1.0 | 1.0 | +0.5 | −0.2 | 0.5 | 0.7 | 0.1 |
| RHO | 8 | 303.9 | +0.2 | +2.1 | +0.6 | 0.2 | 0.7 | 5.0 | 0.2 | +0.1 | −1.7 | 0.3 | 0.6 | 0.5 |
| O1 | 226 | 307.1 | +0.1 | +0.1 | −0.1 | 0.4 | 0.7 | 0.2 | 0.6 | +0.4 | +0.1 | 0.5 | 0.8 | 0.4 |
| M1 | 13 | 331.3 | +7.4 (NO1) | +56.8 | −22.8 | 9.8 | 0.7 | 2.1 | **11.1** | +7.0 (NO1) | −19.8 | 9.0 | **16.3** | 0.3 |
| P1 | 107 | 318.4 | −0.4 | −0.4 | +0.0 | 0.4 | 0.8 | 0.4 | 0.4 | −0.8 | −0.2 | 0.9 | **1.2** | 0.4 |
| S1 | 10 | 121.8 | −1.3 | −13.1 | −5.9 | 1.6 | 0.8 | 5.3 | **1.4** | −1.8 | −22.8 | 4.0 | **7.5** | 0.2 |
| K1 | 335 | 318.9 | +0.0 | +0.0 | +0.1 | 0.3 | 0.7 | 0.1 | 0.4 | +0.5 | +0.3 | 1.7 | **3.1** | 0.1 |
| J1 | 21 | 337.6 | −0.4 | −1.9 | +0.3 | 0.4 | 0.7 | 2.0 | 0.5 | −1.3 | −1.1 | 1.4 | **2.0** | 0.3 |
| OO1 | 12 | 336.4 | −0.1 | −0.7 | −0.7 | 0.2 | 0.5 | 2.6 | 0.3 | +0.1 | +1.6 | 0.4 | 1.0 | 0.1 |
| 2N2 | 20 | 352.0 | −0.5 | −2.6 | −0.1 | 0.5 | 0.4 | 1.2 | 0.8 | −1.5 | −0.5 | 1.5 | **2.6** | 0.5 |
| MU2 | 17 | 331.6 | +0.2 | +1.0 | −0.1 | 0.2 | 0.4 | 1.4 | 0.3 | −0.3 | +1.3 | 0.5 | **1.3** | 0.2 |
| N2 | 107 | 32.5 | +0.3 | +0.3 | −0.1 | 0.4 | 0.4 | 0.2 | 0.5 | −3.9 | +0.8 | 4.2 | **6.7** | 0.4 |
| NU2 | 20 | 42.3 | −0.7 | −3.7 | +1.0 | 0.8 | 0.4 | 1.2 | **1.1** | −0.7 | +0.6 | 0.7 | **1.1** | 0.3 |
| M2 | 269 | 80.1 | −0.5 | −0.2 | −0.0 | 0.5 | 0.4 | 0.1 | 0.8 | −0.7 | +0.6 | 2.9 | **7.3** | 0.3 |
| LAM2 | 2 | 154.6 | −0.3 | −16.3 | −12.6 | 0.5 | 0.4 | 14.0 | 0.9 | −0.2 | −1.4 | 0.2 | 0.3 | 0.3 |
| L2 | 7 | 197.1 | +0.5 | +7.0 | +11.7 | 1.6 | 0.4 | 3.1 | **3.8** | −4.2 | −36.7 | 5.1 | **7.3** | 0.3 |
| T2 | 4 | 337.8 | +0.0 | +0.6 | −1.7 | 0.1 | 0.4 | 5.7 | 0.3 | +0.2 | −2.1 | 0.2 | 0.5 | 0.3 |
| S2 | 24 | 308.6 | +0.1 | +0.5 | −0.3 | 0.2 | 0.4 | 1.0 | 0.4 | +0.6 | +2.4 | 1.1 | **3.3** | 0.1 |
| R2 | 2 | 296.4 | −0.6 | −28.6 | +2.0 | 0.6 | 0.4 | 16.1 | 0.9 | −1.0 | −11.7 | 1.0 | **1.7** | 0.7 |
| K2 | 9 | 340.6 | +0.5 | +5.3 | −0.3 | 0.5 | 0.3 | 2.0 | 0.8 | −0.1 | +0.8 | 0.1 | 0.4 | 0.3 |
| 2SM2 | 1 | 282.4 | +0.2 | +20.2 | +2.8 | 0.2 | 0.4 | 19.5 | 0.3 | −0.0 | −5.5 | 0.1 | 0.3 | 0.1 |
| 2MK3 | 2 | 218.5 | +0.3 (MO3) | +13.6 | +1.1 | 0.3 | 0.2 | 5.7 | 0.5 | +0.5 (MO3) | −11.4 | 0.7 | **4.7** | 0.3 |
| M3 | 4 | 170.2 | −0.3 | −8.0 | −3.1 | 0.4 | 0.3 | 4.0 | 0.8 | −0.1 | −1.4 | 0.1 | 0.9 | 0.4 |
| MK3 | 2 | 221.1 | +0.3 | +15.1 | −0.8 | 0.3 | 0.2 | 5.9 | 0.5 | +0.2 | +1.1 | 0.2 | 0.4 | 0.2 |
| MN4 | 1 | 64.0 | −0.2 | −16.4 | +1.7 | 0.2 | 0.3 | 17.5 | 0.3 | −0.3 | −9.7 | 0.3 | **1.0** | 0.1 |
| M4 | 1 | 88.8 | +0.1 | +13.0 | +3.7 | 0.1 | 0.3 | 13.0 | 0.3 | +0.3 | −0.6 | 0.3 | 0.5 | 0.1 |
| MS4 | 2 | 210.1 | −0.2 | −8.2 | +1.6 | 0.2 | 0.3 | 7.8 | 0.3 | −0.4 | −1.5 | 0.4 | 0.7 | 0.2 |
| S4 | 1 | 315.5 | −0.1 | −14.6 | −9.1 | 0.2 | 0.2 | 16.5 | 0.6 | −0.3 | −5.1 | 0.3 | 0.6 | 0.3 |
| M6 | 0 | 0.0 | +0.3 |  |  | 0.3 | 0.2 | 45.7 | 0.5 | snr |  |  |  | 0.2 |
| S6 | 1 | 0.1 | −0.6 | −57.0 | +3.8 | 0.6 | 0.2 | 27.1 | **1.1** | −0.6 | −8.4 | 0.6 | **1.2** | 0.4 |
| M8 | 1 | 72.6 | −0.2 | −21.8 | +8.4 | 0.3 | 0.2 | 11.8 | 0.7 | −0.3 | +12.8 | 0.4 | **2.4** | 0.2 |

### Charlotte Amalie (`coops/9751639`)

NOAA: "Average of 6 LSQHA (2007-2012). Sa and SSa from 20 year analyses (1993-2012). Mm and Msf are not used." NOAA's years, 2007–2012: 52,011 hourly values, 66 constituents kept. Standard, 2006 to 2024: 154,631 hourly values, 74 kept.

| Constituent | NOAA A (mm) | NOAA g (°) | NOAA's years: ΔA (mm) | ΔA (%) | Δg (°) | Vector (mm) | ±A (mm) | ±g (°) | Ratio | Standard: ΔA (mm) | Δg (°) | Vector (mm) | Ratio | NOAA's method: vector (mm) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| SA | 64 | 181.2 | −5.8 | −9.0 | +2.4 | 6.3 | 3.7 | 3.5 | **1.6** | −6.9 | +3.7 | 7.9 | **3.3** | 8.0 |
| SSA | 16 | 46.0 | −2.4 | −15.0 | +21.0 | 5.9 | 3.6 | 15.3 | **1.4** | −0.8 | +20.9 | 5.7 | **2.8** | 6.3 |
| MM | 0 | 0.0 | +5.8 |  |  | 5.8 | 3.8 | 37.5 | **1.5** | +6.7 |  | 6.7 | **3.3** | 6.2 |
| MSF | 0 | 0.0 | snr |  |  |  |  |  |  | snr |  |  |  | 1.2 |
| MF | 14 | 358.7 | +0.5 | +3.9 | +0.9 | 0.6 | 3.0 | 12.0 | 0.2 | −0.0 | −0.7 | 0.2 | 0.1 | 0.4 |
| 2Q1 | 1 | 196.8 | +0.5 | +47.9 | +7.3 | 0.5 | 0.4 | 14.6 | 0.8 | +0.3 | −2.8 | 0.3 | 0.5 | 0.6 |
| Q1 | 11 | 208.8 | +0.1 | +0.5 | −0.7 | 0.1 | 0.4 | 2.0 | 0.3 | +0.1 | −3.6 | 0.7 | **3.1** | 0.0 |
| RHO | 2 | 214.8 | +0.1 | +3.0 | −9.0 | 0.3 | 0.4 | 10.5 | 0.9 | +0.3 | −4.7 | 0.3 | 0.8 | 0.2 |
| O1 | 60 | 221.6 | +0.4 | +0.6 | −0.0 | 0.4 | 0.4 | 0.4 | 0.6 | +0.3 | +0.4 | 0.5 | **2.0** | 0.3 |
| M1 | 4 | 240.8 | +1.0 (NO1) | +24.6 | −11.2 | 1.3 | 0.4 | 4.4 | **2.5** | +0.6 (NO1) | −10.6 | 1.0 | **3.8** | 0.4 |
| P1 | 24 | 231.2 | +0.8 | +3.4 | +0.6 | 0.9 | 0.4 | 0.9 | **1.3** | +1.3 | +0.9 | 1.4 | **2.4** | 0.3 |
| S1 | 3 | 201.1 | −0.4 | −14.8 | −9.9 | 0.7 | 0.4 | 9.1 | **1.1** | −0.5 | −4.1 | 0.6 | 1.0 | 0.5 |
| K1 | 80 | 229.5 | +0.5 | +0.7 | +0.2 | 0.6 | 0.4 | 0.3 | 0.8 | +0.8 | +1.0 | 1.6 | **5.8** | 0.5 |
| J1 | 5 | 235.1 | +0.4 | +8.2 | −1.1 | 0.4 | 0.4 | 4.0 | 0.7 | +0.1 | −4.4 | 0.4 | **1.8** | 0.5 |
| OO1 | 4 | 236.2 | −0.5 | −12.9 | +1.7 | 0.5 | 0.3 | 5.0 | 0.9 | −0.5 | −0.5 | 0.5 | 0.9 | 0.5 |
| 2N2 | 1 | 9.1 | +0.1 | +12.8 | −4.2 | 0.1 | 0.3 | 14.4 | 0.3 | +0.2 | −1.6 | 0.2 | 0.3 | 0.3 |
| MU2 | 2 | 80.8 | −0.4 | −22.3 | +2.5 | 0.5 | 0.3 | 10.5 | 0.8 | −0.7 | +1.8 | 0.7 | **1.4** | 0.6 |
| N2 | 9 | 13.7 | −0.2 | −2.4 | +0.8 | 0.2 | 0.3 | 1.9 | 0.4 | −0.3 | +0.1 | 0.3 | 0.6 | 0.2 |
| NU2 | 2 | 6.6 | +0.3 | +15.4 | −0.5 | 0.3 | 0.3 | 7.1 | 0.5 | −0.0 | −1.3 | 0.0 | 0.3 | 0.2 |
| M2 | 41 | 23.1 | +0.6 | +1.6 | +0.7 | 0.8 | 0.3 | 0.4 | **1.7** | +1.2 | +1.6 | 1.7 | **7.1** | 0.3 |
| LAM2 | 1 | 27.4 | −0.3 | −27.0 | +5.5 | 0.3 | 0.3 | 22.3 | 0.5 | −0.3 | −0.0 | 0.3 | 0.6 | 0.1 |
| L2 | 2 | 41.6 | −0.4 | −18.1 | −3.0 | 0.4 | 0.3 | 9.5 | 0.6 | −0.2 | −9.0 | 0.4 | **1.7** | 0.5 |
| T2 | 1 | 306.1 | −0.4 | −42.1 | +3.6 | 0.4 | 0.3 | 27.8 | 0.7 | −0.4 | −13.7 | 0.5 | 0.8 | 0.5 |
| S2 | 9 | 9.9 | −0.1 | −0.8 | +0.7 | 0.1 | 0.3 | 1.8 | 0.4 | +0.0 | −0.2 | 0.0 | 0.2 | 0.1 |
| R2 | 0 | 0.0 | +0.6 |  |  | 0.6 | 0.3 | 26.7 | **1.1** | +0.8 |  | 0.8 | **1.5** | 0.3 |
| K2 | 3 | 5.0 | −0.3 | −10.7 | −2.4 | 0.3 | 0.3 | 5.4 | 0.6 | −0.3 | +2.0 | 0.3 | 0.6 | 0.3 |
| 2SM2 | 0 | 0.0 | +0.4 |  |  | 0.4 | 0.3 | 46.1 | 0.6 | +0.2 |  | 0.2 | 0.4 | 0.3 |
| 2MK3 | 0 | 0.0 | +0.3 (MO3) |  |  | 0.3 | 0.1 | 23.9 | 0.6 | +0.4 (MO3) |  | 0.4 | 0.8 | 0.3 |
| M3 | 1 | 38.6 | +0.1 | +10.4 | −4.7 | 0.1 | 0.1 | 7.6 | 0.6 | +0.1 | −8.0 | 0.2 | **1.9** | 0.1 |
| MK3 | 1 | 179.6 | −0.3 | −25.5 | −3.9 | 0.3 | 0.1 | 10.8 | 0.5 | −0.5 | −9.8 | 0.5 | **1.1** | 0.3 |
| MN4 | 1 | 203.6 | −0.5 | −49.8 | +5.8 | 0.5 | 0.1 | 17.1 | 1.0 | −0.3 | −2.2 | 0.4 | 0.7 | 0.4 |
| M4 | 2 | 302.0 | −0.0 | −1.6 | −1.9 | 0.1 | 0.1 | 4.4 | 0.4 | +0.1 | −0.3 | 0.1 | 0.1 | 0.1 |
| MS4 | 1 | 3.2 | +0.0 | +2.2 | +2.2 | 0.0 | 0.1 | 8.3 | 0.3 | +0.1 | +5.1 | 0.1 | **1.1** | 0.0 |
| S4 | 1 | 106.3 | −0.4 | −39.1 | +9.2 | 0.4 | 0.1 | 13.8 | 0.7 | −0.5 | +24.7 | 0.6 | **2.3** | 0.4 |
| M6 | 0 | 0.0 | +0.2 |  |  | 0.2 | 0.1 | 40.4 | 0.4 | +0.3 |  | 0.3 | 0.7 | 0.2 |
| S6 | 0 | 0.0 | +0.2 |  |  | 0.2 | 0.1 | 45.0 | 0.3 | snr |  |  |  | 0.2 |
| M8 | 0 | 0.0 | +0.1 |  |  | 0.1 | 0.1 | 73.9 | 0.2 | +0.2 |  | 0.2 | 0.4 | 0.1 |
