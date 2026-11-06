# Harmonic representation of inequalities

An evaluation of the harmonic representation of inequalities (HRoI), the method BSH uses for German tide predictions, against the harmonic method that Slackwater uses everywhere else. Two questions:

1. Can we reproduce BSH's published predictions from the data BSH publishes, which is a year or two of predictions and no constants? This is what [slackwater-database#335](https://github.com/openwatersio/slackwater-database/issues/335) needs.
2. Fitted to observations, does HRoI predict real high and low waters better than harmonics?

## Summary

- **BSH's predictions are HRoI, and we reproduce them exactly in sample.** BSH's files carry the lunar transit number and event index of every high and low water. Our transit computation matches BSH's numbering for every event at Cuxhaven, and fitting BSH's 39 partial tides to a year of its high and low waters reproduces that year to 0.1 minutes and 0.25 cm RMS, which is BSH's rounding.
- **A year of BSH predictions is enough to predict the next year with HRoI, not with harmonics.** Fitted to 2026 and scored on 2027 at 15 gauges, HRoI is within 5.4–6.9 minutes and 2.9–5.3 cm RMS of BSH's high and low waters. An 89-term harmonic fit to the 2026 10-minute curves is within 8–38 minutes and 11–23 cm, and can't fit BSH's curves even in sample (9–19 cm RMS). The gap is widest in the rivers.
- **One year needs regularization.** Several pairs in BSH's set, such as Mm and the 27.32-day term, are 8.85 or 18.6 years apart, and BSH fits 19 years. An unpenalized one-year fit reproduces its own year but extrapolates by hours and meters. A small ridge penalty (1e-4) fixes that; it was tuned at Cuxhaven and is the best of the four values tried at all 15 gauges.
- **On observed water levels, HRoI times high and low waters better than harmonics, and slightly better than RWS's own prediction.** Fitted to 2016–2023 observations at six Dutch gauges and scored on 2024, HRoI has the lowest event-time error for both high and low water at every gauge but two cases: Den Helder high water, where every method is around 50 minutes, and Delfzijl high water, where RWS is 0.3 minutes better. At Vlissingen and Bath it's 7.5–9.2 minutes RMS against 10–13 for the harmonic fit and 9–12 for RWS's astronomical tide. Heights are dominated by surge (22–39 cm RMS for every method), and between extremes the harmonic curve is as good or slightly better.

## Method

HRoI predicts high and low waters directly, not a curve. Each high and low water is assigned to a lunar transit at Greenwich and given one of four event indices: high or low water, after an upper or a lower transit. For each index, the lunitidal interval (time after the transit) and the height are each modeled as a mean plus long-period harmonics of the transit number,

```
y(n) = a0 + Σ a_l cos(ω_l n) + b_l sin(ω_l n)
```

where the angular velocities ω come from combinations of the rates of s, h, p and N′. That gives eight small least-squares fits. Prediction evaluates them at every future transit, so it gives exactly one high and one low water per half lunar day, with no double low waters or shoulders. BSH draws its 10-minute curves by fitting a mean observed tide curve between those extremes ("HDdU (HW/NW) mit mittlerer beob. Tidenkurve" in the file headers).

The implementation is in [src/hroi](../src/hroi):

- Transit numbers follow Boesch and Müller-Navarra (2019): upper transits at Greenwich since the one on 1949-12-31, with a lower transit taking the number of the upper transit before it. The original evaluation used Astronomy Engine for transit times. The implementation now uses [Almanac](https://github.com/openwatersio/almanac), with prediction windows starting on or after 1 January 1950 UTC and ending on or before 1 January 2101 UTC (exclusive end).
- The partial tides are Table 2 of [Boesch and Müller-Navarra (2019)](https://doi.org/10.5194/os-15-1363-2019). BSH has used the 39-tide set since its 2020 tables, and its 2026 files say "39 39".
- Extremes without transit numbers are assigned to the transit whose mean lunitidal interval puts them closest. The high-water interval is taken in [0, 12.42) hours, and a low water goes with the high water before it.
- The curve between predicted extremes uses mean rising and falling branches, normalized in time and height, averaged over the training record.

The harmonic baseline is `@slackwater/engine`'s `fit` and `createTidePredictor`, with the 69 constituents of t_tide's standard set plus 50 shallow-water compound tides, dropping whatever the record can't separate (Rayleigh criterion, major constituents first). A year of record keeps 89. Its extremes are scored two ways: every turning point, as Slackwater reports them, and one high and one low water per transit picked from the curve the same way HRoI selects them ("canonical").

## Reproducing BSH predictions

[scripts/evaluate-bsh.ts](../scripts/evaluate-bsh.ts) fits each method to BSH's 2026 predictions and scores it against BSH's 2027 predictions. Full results are in [results/bsh.json](results/bsh.json).

BSH's 2027 file uses a newer analysis epoch (2006–2024) than 2026's (2005–2023), so part of each hold-out error is BSH's own update, not fit error. There's no way to separate the two until BSH publishes 2028 in August 2027.

| Gauge                                | Range (m) | HRoI time RMS / max (min) | HRoI height RMS / max (cm) | HRoI curve RMS (cm) | Harmonic canonical time RMS / max (min) | Harmonic canonical height RMS / max (cm) | Harmonic curve RMS (cm) |
| ------------------------------------ | --------: | ------------------------: | -------------------------: | ------------------: | --------------------------------------: | ---------------------------------------: | ----------------------: |
| Helgoland, Binnenhafen (509A)        |       3.2 |                  5.4 / 17 |                 3.1 / 11.6 |                 4.7 |                                8.3 / 32 |                              11.3 / 35.5 |                    10.6 |
| List, Sylt, Hafen (617P)             |       2.5 |                  5.5 / 18 |                  2.9 / 9.2 |                 4.0 |                               10.0 / 41 |                              12.2 / 35.3 |                    11.7 |
| Husum, Schleuse (510P)               |       4.4 |                  6.1 / 21 |                 4.0 / 13.4 |                 9.8 |                               13.8 / 52 |                              16.0 / 53.2 |                    15.1 |
| Büsum, Schleuse (505P)               |       4.1 |                  6.3 / 20 |                 3.6 / 10.0 |                12.9 |                               12.8 / 39 |                              13.6 / 41.4 |                    15.0 |
| Norderney, Riffgat (111P)            |       3.4 |                  5.6 / 17 |                  3.2 / 9.6 |                 6.0 |                               11.7 / 40 |                              11.3 / 33.6 |                    10.7 |
| Borkum, Fischerbalje (101P)          |       3.2 |                  5.6 / 17 |                 3.3 / 11.7 |                 5.5 |                               11.7 / 44 |                              11.2 / 33.3 |                    10.9 |
| Emden, Große Seeschleuse (507P)      |       4.2 |                  5.6 / 17 |                 3.8 / 12.3 |                 7.0 |                               15.6 / 63 |                              15.9 / 62.1 |                    14.9 |
| Papenburg, Ems (814P)                |       4.4 |                  6.9 / 23 |                  3.1 / 9.4 |                10.4 |                               37.6 / 98 |                              22.3 / 80.9 |                    22.8 |
| Wilhelmshaven, Alter Vorhafen (512P) |       4.9 |                  5.5 / 17 |                 3.9 / 11.5 |                 7.5 |                               10.5 / 37 |                              14.7 / 46.8 |                    13.9 |
| Bremerhaven, Alter Leuchtturm (103P) |       4.8 |                  5.6 / 17 |                 3.6 / 10.3 |                 7.7 |                               11.4 / 42 |                              15.5 / 56.7 |                    14.3 |
| Bremen, Wilhelm-Kaisen-Brücke (751P) |       5.3 |                  5.9 / 18 |                 4.0 / 13.9 |                 9.1 |                               22.4 / 80 |                              21.2 / 72.6 |                    19.4 |
| Cuxhaven, Steubenhöft (506P)         |       3.9 |                  5.7 / 18 |                 3.5 / 11.2 |                 6.7 |                               14.4 / 48 |                              13.4 / 43.3 |                    12.6 |
| Glückstadt, Elbe (695P)              |       3.7 |                  5.4 / 16 |                  3.4 / 9.5 |                 6.3 |                               16.8 / 62 |                              14.5 / 56.7 |                    12.6 |
| Hamburg, St. Pauli (508P)            |       4.5 |                  5.5 / 17 |                 3.3 / 11.8 |                 7.5 |                               20.8 / 81 |                              17.7 / 63.0 |                    16.2 |
| Hamburg, Zollenspieker (731P)        |       3.6 |                  5.8 / 15 |                 5.3 / 12.6 |                 6.6 |                               24.0 / 79 |                              23.5 / 67.3 |                    20.2 |

Harmonic extremes reported as every turning point give the same counts as BSH at these gauges (1,410 ± 1 a year), so the canonical selection changes little here; the harmonic error is in the curve itself.

Ridge penalty, as HRoI time / height RMS on 2027, at Cuxhaven: none 81 min / 32 m; 1e-5 6.7 min / 4.1 cm; 1e-4 5.7 min / 3.5 cm; 1e-3 6.7 min / 4.4 cm. The other 14 gauges follow the same pattern.

The HRoI curve is the weak part. Drawn from BSH's own 2026 extremes, our single mean curve reproduces BSH's 2026 curve to 0.9–3.1 cm RMS at most gauges, but 5.2–9.7 cm at Husum, Papenburg and Büsum. BSH evidently uses more than one curve shape there, perhaps by tidal range or by event index. Curve errors on 2027 (4–13 cm) are about twice the event errors for that reason.

## Observed water levels at Dutch gauges

[scripts/evaluate-rws.ts](../scripts/evaluate-rws.ts) fits both methods to eight years of RWS observations (2016–2023): HRoI to the observed high and low waters RWS publishes, the harmonic method (101 terms) to the 10-minute series. Both predict 2024, which is scored against the observed high and low waters and 10-minute levels. RWS's astronomical prediction is scored the same way as a reference. RWS hadn't published checked observed extremes for 2025. Full results are in [results/rws.json](results/rws.json).

Observed levels include surge, so no method gets close to zero. The comparison is between methods.

Errors against observed 2024 extremes, as HRoI / harmonic (canonical) / harmonic (all turning points) / RWS astronomical.

| Location            | HW time RMS (min)         | LW time RMS (min)         | HW height RMS (cm)        | LW height RMS (cm)        | Unmatched observed | Predicted events          | Curve RMS (cm), HRoI / harmonic / RWS |
| ------------------- | ------------------------- | ------------------------- | ------------------------- | ------------------------- | ------------------ | ------------------------- | ------------------------------------- |
| vlissingen          | 7.7 / 13.3 / 13.0 / 11.7  | 9.2 / 12.5 / 12.4 / 9.7   | 21.9 / 26.7 / 26.7 / 25.2 | 26.1 / 25.1 / 25.2 / 27.3 | 0 / 2 / 0 / 0      | 1414 / 1412 / 1414 / 1414 | 27.2 / 27.1 / 27.9                    |
| rilland.bath        | 7.5 / 10.4 / 10.2 / 9.0   | 9.1 / 12.9 / 12.8 / 10.3  | 23.4 / 30.8 / 30.7 / 28.6 | 27.8 / 27.9 / 27.9 / 28.4 | 0 / 1 / 0 / 0      | 1414 / 1413 / 1414 / 1414 | 29.1 / 30.8 / 31.6                    |
| hoekvanholland      | 12.8 / 22.8 / 22.5 / 21.1 | 60.4 / 73.8 / 64.0 / 64.3 | 25.3 / 27.1 / 27.1 / 28.1 | 28.1 / 24.4 / 24.4 / 26.3 | 2 / 13 / 2 / 10    | 1414 / 1413 / 2050 / 1415 | 30.6 / 25.5 / 26.8                    |
| denhelder.marsdiep  | 51.9 / 56.2 / 49.2 / 55.4 | 19.5 / 24.1 / 23.9 / 21.5 | 26.8 / 27.4 / 27.4 / 29.5 | 27.6 / 27.3 / 27.3 / 29.7 | 5 / 24 / 7 / 21    | 1414 / 1412 / 1770 / 1414 | 28.5 / 27.3 / 29.5                    |
| harlingen.waddenzee | 24.9 / 26.6 / 26.5 / 27.6 | 14.1 / 18.4 / 18.3 / 16.6 | 32.8 / 32.5 / 32.4 / 34.7 | 35.3 / 33.1 / 33.1 / 34.1 | 0 / 1 / 0 / 0      | 1414 / 1413 / 1414 / 1414 | 32.8 / 31.4 / 33.6                    |
| delfzijl            | 16.8 / 20.3 / 20.2 / 16.5 | 14.1 / 15.8 / 15.7 / 14.6 | 31.9 / 32.9 / 32.9 / 33.5 | 39.2 / 37.7 / 37.7 / 37.2 | 0 / 2 / 0 / 0      | 1415 / 1413 / 1415 / 1415 | 33.6 / 32.2 / 33.4                    |

- **Times.** HRoI has the lowest RMS time error for both high and low water at every gauge except Den Helder high water, where every method is around 50 minutes, and Delfzijl high water, where RWS is 0.3 minutes better. Its biases are small (under 5 minutes, apart from Hoek van Holland low water), while RWS's astronomical high waters run 8–16 minutes late at Vlissingen, Harlingen and Hoek van Holland.
- **Ambiguous extremes.** Hoek van Holland's double low water and Den Helder's flat high water make the observed event time itself uncertain, and every method is 50–74 minutes RMS there. RWS's observed record has about 250 fewer extremes at Hoek van Holland in 2024 than one high and one low water per cycle would give. Reporting every turning point (Slackwater's current behavior) gives 2,050 events at Hoek van Holland and 1,770 at Den Helder, against 1,414 from HRoI.
- **Heights** are within a few centimeters across methods. HRoI is better for high waters in the Western Scheldt (22–23 cm against 25–31 cm) and slightly worse for low waters at Hoek van Holland and Harlingen.
- **Curves.** The harmonic curve is as good as HRoI's mean-curve construction or up to 5 cm better, except at Bath.

## What this means

- **BSH gauges should be imported with HRoI, not harmonics.** Fitting harmonics to BSH's curves, as slackwater-database#335 planned, can't reproduce them: 11–23 cm and 8–38 minutes off at the extremes after a year, and worst in the rivers. HRoI from the same data is 3–5 cm and 5–7 minutes off, and some of that is BSH's own epoch update. This needs a new station type in slackwater-database and support in `@slackwater/engine`: eight series of 39 coefficients per gauge, the mean tide curve, and a transit ephemeris. It also bears on BSH's 1 August rule, since HRoI constants predict any year just like harmonic ones.
- **HRoI is a candidate for other shallow-water gauges.** On Dutch observations it times extremes better than both our harmonic fit and RWS's own prediction, and it gives one high and one low water per cycle by construction, which is the event-selection problem [slackwater-database#152](https://github.com/openwatersio/slackwater-database/issues/152) couldn't solve with a provider-neutral rule. It needs a long record of observed extremes (about nine years to separate the main pairs), which RWS has and BSH doesn't publish.
- **Harmonics stay better for the curve between extremes**, at least with a single mean curve. A curve keyed to tidal range or event index, as BSH appears to use, is the obvious next step, as is Müller-Navarra's generalization of HRoI to fractions of the lunar day.

Still open:

- Score BSH-derived HRoI against observed German levels, from a PEGELONLINE backfill, which reaches 2000 at most gauges.
- Check the one-year ridge fit against a third year of BSH predictions when 2028 is published (August 2027).
- Mean tide curves by tidal range and event index, to bring the HRoI curve closer to BSH's (5–10 cm off at Husum, Büsum and Papenburg).

## References

- Boesch, A. and Müller-Navarra, S.: Reassessment of long-period constituents for tidal predictions along the German North Sea coast and its tidally influenced rivers, Ocean Sci., 15, 1363–1379, https://doi.org/10.5194/os-15-1363-2019, 2019.
