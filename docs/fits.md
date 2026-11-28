# Harmonic fits

How the store fits harmonic constants to a station's water levels, and why each choice was made. [Running ingest](contributing/ingest.md) covers the `fit` command, [`src/store/files.ts`](../src/store/files.ts) defines every column of the four files it writes, and the code is in [`src/fit/`](../src/fit/).

A fit is a measurement. It is published whatever its size, with what a reader needs to judge it: the window, the files read, each constituent's confidence interval and signal-to-noise ratio, the scatter between years, and a score on a year the fit didn't read. Nothing here decides whether a gauge has enough tide to predict.

## What a fit reads

- **Final values.** A fit reads values the source won't revise again: verified values, and preliminary ones from before the station's `source_qc_start`, which the source will never check. A source that never marks values final declares how long after a year ends its values are read as final (`settles_after_months`), and its README says what the figure rests on.
- **Flags decide.** A fit reads what the store's flags allow. A value is `kept` under an erratum only where its own evidence supports keeping it, and a value no reader should use is `flagged`, which marks it suspect. The fit records every erratum touching the years it read.
- **Values stamped on the hour, read as instantaneous.** Hourly sampling resolves every constituent below twelve cycles a day and keeps a 19-year fit to about 166,000 values. A fit can't tell an instant from a mean. Where a source's hourly values are means, its amplitudes come out low: a one-hour mean scales a constituent by sinc(f · 1 h), which is 0.989 for M2, 0.958 for M4 and 0.907 for M6. Where a mean is stamped away from the middle of its interval, its phases shift too: a one-hour mean stamped at the start of its hour reads 30 minutes early, which is 14.5° of M2 and 7.5° of K1. Such a series has an erratum or a note in its source's README, and its fit isn't corrected for it.
- **One datum.** Every datum epoch's levels are moved into the station's current datum by the epoch's `to_current`, and an epoch that can't be converted is left out.

## Window

A fit reads up to 19 years, one cycle of the Moon's node (18.6 years) rounded to whole years, as NOAA's tidal datum epoch is ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), pp. 22 and 46). Over a full cycle the nodal modulation of each constituent averages out of the fitted amplitude, whatever the nodal corrections assume about it.

The year after the window is held out. It is the latest year of final values in which half the station's hours can be scored, and the fit never reads it. A record with under 183 days before that year isn't fitted, since under half a year can't separate P1 from K1 or K2 from S2 ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), §3.3, pp. 85–86).

## Method

One least-squares fit over the whole window, with each constituent's nodal factors and equilibrium argument evaluated at each sample's time inside the design matrix. [Foreman, Cherniawsky and Ballantyne (2009)](https://doi.org/10.1175/2008JTECHO615.1) introduced this for long records: holding the nodal factors constant over a 12-year analysis at Tofino put errors of about 8% in O1, 5% in K1, 2% in M2 and 15% in K2, which evaluating them in the matrix removed. UTide does the same ([Codiga 2011](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf), pp. 4 and 6).

NOAA evaluates the factors once a year, at mid-year, for convenience ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), p. 148). Measured on two gauges, that mode makes the 19-year fit about 12 seconds faster of 100 and moves most constants by under 0.3 mm, but lambda2 by 2.1 mm at Cuxhaven. The fits evaluate at every sample.

**Robust weights.** The fit is iteratively reweighted with Cauchy weights, so surges and spikes that QC passes don't pull it, as UTide does by default, after Leffler and Jay (2009) ([Codiga 2011](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf), pp. 5 and 20). It costs about four times a plain fit. On the held-out year it lowers the tidal-band RMS by 0.2 mm at Kungsvik and 1.3 mm at Cuxhaven. The [calibration](results/fit-calibration.md#where-the-differences-come-from) measures what the weights do to each constant and to the held-out score at its CO-OPS gauges.

**Confidence intervals** come from the residual spectrum around each constituent's frequency, so correlated noise doesn't shrink them ([Pawlowicz, Beardsley and Lentz 2002](<https://doi.org/10.1016/S0098-3004(02)00013-4>), §4.1). Those authors find the linearized intervals adequate for a signal-to-noise ratio above 10 and "probably not bad" down to 2 or 3.

## Constituents

Every fit starts from the same candidates in the same priority order, defined in [`src/fit/candidates.ts`](../src/fit/candidates.ts) by their Doodson numbers:

1. Foreman's standard set of 45 astronomical and 24 shallow-water constituents, in his order of selection, which follows decreasing amplitude in the tidal potential ([Foreman 1977](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf), p. 16 and pp. 18–19). Of the 69, the mean (Z0) is fitted as `z0_m`, H1 and H2 enter under the IHO names of the same lines, MA2 and MB2, and OQ2 is left out, which leaves 65 under his names.
2. The constituents NOAA's standard 37 add.
3. The constituents TICON-4's 50 add ([TICON-4 manual](https://doi.org/10.17882/109129)).

Starting from one list makes fits comparable between gauges, and including NOAA's and TICON's names lets a fit be compared with either name for name.

A candidate is kept when it passes two tests:

- **Rayleigh criterion.** The record separates it from every stronger candidate already kept by at least one cycle ([Foreman 1977](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf), §2.1.2, p. 17). Where a record can't separate two candidates, the one earlier in the list stays.
- **Signal to noise.** In a fit without robust weights, its amplitude squared is at least twice its variance, UTide's default for including a constituent ([Codiga 2011](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf), pp. 35–36 and 40).

The kept candidates are then fitted together with robust weights, and their published signal-to-noise ratio is from that fit. Every candidate has a row in `constituents/<source>.parquet`, kept or not, with the reason and, for a Rayleigh rejection, the constituent it conflicts with. A reader who wants a stricter or looser set has what is needed to choose one.

**Sa and Ssa** are judged differently, because they are mostly weather, steric change and river flow and vary from year to year ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), §3.7.1, p. 119). They are fitted over the whole window, and each year is also fitted by itself. They are kept when the whole-window amplitude is at least twice the standard error of the mean of the yearly fits. The yearly standard error is published either way.

**Yearly scatter.** Each calendar year with two thirds of its hours is fitted by itself with one fixed set of constituents, and the standard deviation of M2's, S2's, K1's and O1's amplitude and phase between years is published. Parker's test of harmonic constants is how consistent they are between independent analyses ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), pp. 86–87). Large scatter marks a river-influenced or changing gauge.

## Nodal corrections

The fits use **Schureman's nodal corrections** ([Schureman 1958](https://tidesandcurrents.noaa.gov/publications/SpecialPubNo98.pdf)), and each fit's row names them in `node_corrections`. A constant means what it was fitted to mean only when a prediction applies the same corrections.

Three families are in use:

| Family    | What it is                                                                                              | Used by                                          |
| --------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Schureman | Closed forms in the lunar orbit's inclination for every astronomical constituent                        | NOAA, the FES tide models, hatyan's default      |
| IHO       | Series for eight constituents in Annex A of the IHO standard list, with rules for compounds             | `@slackwater/engine`'s default                   |
| Foreman   | Sums of each constituent's satellites, with third-degree ones scaled by latitude; none for long periods | t_tide, UTide, the Canadian Hydrographic Service |

### What was measured

Five gauges, each fitted on 19 years under each family and scored on a held-out year, with the engine's fit and predictor for all three:

| Gauge                            | Latitude | Tide                        |
| -------------------------------- | -------- | --------------------------- |
| Kwajalein (`coops/1820000`)      | 8.7°N    | Semidiurnal, M2 0.47 m      |
| Honolulu (`coops/1612340`)       | 21.3°N   | Mixed, M2 0.17 m, K1 0.15 m |
| Pensacola (`coops/8729840`)      | 30.4°N   | Diurnal, K1 and O1 0.12 m   |
| Cuxhaven (`pegelonline/5990020`) | 53.9°N   | Semidiurnal, M2 1.38 m      |
| Kungsvik (`smhi/2130`)           | 59.0°N   | Semidiurnal, M2 0.12 m      |

Sa, Ssa and S1 were left out, since t_tide defines SA and S1 on lines that include the solar perigee.

**No family predicts best everywhere, and the differences are about 1% of the residual at most.** Tidal-band RMS of observed minus predicted levels on the held-out year, fitted and predicted under the same family:

| Gauge     | Schureman | IHO       | Foreman   |
| --------- | --------- | --------- | --------- |
| Kwajalein | 24.66 mm  | 24.57 mm  | 24.57 mm  |
| Honolulu  | 23.28 mm  | 23.18 mm  | 23.05 mm  |
| Pensacola | 30.68 mm  | 30.65 mm  | 30.36 mm  |
| Cuxhaven  | 180.73 mm | 180.64 mm | 181.23 mm |
| Kungsvik  | 59.03 mm  | 59.03 mm  | 58.97 mm  |

Whether a difference is more than one year's noise was tested by the difference of the two residual variances against twice its standard error, taken from 30-day blocks:

| Gauge     | Schureman against IHO | Schureman against Foreman |
| --------- | --------------------- | ------------------------- |
| Kwajalein | within noise          | within noise              |
| Honolulu  | IHO better            | Foreman better            |
| Pensacola | within noise          | Foreman better            |
| Cuxhaven  | IHO better            | Schureman better          |
| Kungsvik  | within noise          | within noise              |

Foreman's corrections fit the two gauges with a large diurnal tide measurably better than Schureman's, and Schureman's fit Cuxhaven measurably better than Foreman's. IHO's are measurably better than Schureman's at two gauges and never worse. The largest of these differences is 0.5 mm of RMS, at Cuxhaven, on a residual of 181 mm. What weather, seiches and river flow leave in the residual is a hundred times any difference between the families, or more.

**Using the constants under another family.** RMS difference between the curve predicted under the fit's family and the curve the same constants give under another, over the held-out year:

| Fitted under | Predicted under | Kwajalein | Honolulu | Pensacola | Cuxhaven | Kungsvik |
| ------------ | --------------- | --------- | -------- | --------- | -------- | -------- |
| Schureman    | IHO             | 1.8 mm    | 1.3 mm   | 1.7 mm    | 1.6 mm   | 1.4 mm   |
| Schureman    | Foreman         | 4.6 mm    | 3.1 mm   | 3.6 mm    | 7.7 mm   | 7.2 mm   |
| IHO          | Foreman         | 4.8 mm    | 3.5 mm   | 4.2 mm    | 8.0 mm   | 8.1 mm   |

At the two northern gauges most of the difference from Foreman is in Mf and Mm, which Foreman's set gives no nodal modulation. The held-out score above can't see that difference, since its filter removes everything slower than a day: Mf's modulation is about 40% of its amplitude over the nodal cycle ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), p. 41), which Schureman's and IHO's corrections follow and Foreman's don't.

**The constants themselves.** Against Schureman's, IHO's O1 and Q1 are 0.8% smaller, Mf 3.5 to 5% smaller and J1 8% smaller at every gauge, and M2 agrees within 0.04%. Foreman's differ most in Mf, by 2 to 13%, and in the M1 line, which t_tide calls NO1. The same differences appear in a synthetic series fitted under each family.

### Why Schureman

Prediction skill doesn't settle the choice: each family is measurably best somewhere, by about 1% of the residual at most. These do:

- **It is complete.** Schureman gives a closed form for every astronomical constituent in one public-domain manual. The IHO list gives series for eight, and treats the rest as unity or by rules for compound names.
- **The IHO list isn't meant for this.** It says it "is not intended to be used to produce accurate tidal predictions" ([IHO TWCWG 2017](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/MISC/TWCWG_Constituent_list.pdf)).
- **It sits between the other two.** Schureman's and IHO's constants give curves 1.3 to 1.8 mm apart, and at every gauge Schureman's are closer to Foreman's than IHO's are.
- **It doesn't depend on the gauge.** Foreman's third-degree satellites scale with latitude, and the factor is singular at the equator, where t_tide applies "a crude limiting" ([Pawlowicz, Beardsley and Lentz 2002](<https://doi.org/10.1016/S0098-3004(02)00013-4>), p. 932). One family for every gauge keeps fits comparable.
- **It is what the largest sets to compare with use.** NOAA's constants and predictions use Schureman's factors, as the FES tide models do, so a fit can be compared with either without a term for the family. [Parker (2007)](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf) gives NOAA's reasons for node factors over satellite sums on p. 149.
- **Fitting costs the same.** The 19-year fit takes 24 to 31 seconds under Schureman's or IHO's corrections and 29 to 40 under Foreman's, and the residuals agree within 0.1 mm.

### What it costs

- **Comparison with TICON.** TICON's constants match no one family ([Reference scores](#reference-scores)): its O1, Q1 and Mf agree with a Schureman fit of the same levels, and its J1 reads 8% below one. Its M1 and OO1 agree with none. A comparison of constants across the two has to allow for that, constituent by constituent.
- **Diurnal gauges.** At Honolulu and Pensacola, Foreman's corrections leave 0.2 to 0.3 mm less RMS in the held-out residual than Schureman's, about 1% of it.
- **Use in t_tide or UTide.** Those predict under Foreman's set, and a Schureman fit used there differs by 3 to 8 mm RMS at these gauges. Direct reuse there would also need t_tide's own definitions of SA, S1 and M1, and only the constituents in its table. A user who needs exact agreement refits the series under Foreman's set, which the store's levels allow.
- **A limit every family shares.** All three assume the nodal modulation the equilibrium tide has. Observed modulation departs from it in shallow water ([Amin 1985](https://doi.org/10.1111/j.1365-246X.1985.tb05138.x); [Feng, Tsimplis and Woodworth 2015](https://doi.org/10.1002/2014JC010312)). A 19-year window averages the modulation out of the fitted amplitude, but a prediction for one year carries the assumption.
- **M1 and L2.** M1 is several lines, defined and corrected differently in each family ([Woodworth 2019](https://os.copernicus.org/articles/15/431/2019/)), and L2 shares its frequency with 2MN2, whose node factor differs ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), pp. 59–60). Their constants depend on the family more than any others. The [calibration](results/fit-calibration.md) shows both against NOAA's constants.

### Other families

The fit's row names its corrections so that constants fitted under another family can be published beside these where a use calls for them, such as Foreman's for t_tide and UTide. The 19-year fit is about a third of a station's work, so a second family adds about that much.

### What is still to measure

Five gauges and one held-out year each. A gauge on the equator, where Foreman's latitude factor is held at 5°, and a second year at each gauge would show how far these results carry.

## Scores

The held-out year is scored the same way for any constants:

- **Tidal-band RMS.** Observed minus predicted, hourly, after a Godin filter (running means of 24, 24 and 25 hours) removes everything slower than a day. The filter also removes the long-period constituents, so this score can't see them.
- **Variance explained.** One minus the residual's variance over the observed levels', both after the same filter.
- **Bands.** The residual's RMS in the diurnal, semidiurnal, quarter-diurnal and sixth-diurnal bands.
- **High and low waters.** One picker finds the turns of the observed and the predicted hourly series, so both are picked the same way, as [Parker (2007)](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf) requires of such a comparison (§3.9.1, pp. 129–130), and the time and height differences of matched turns are reported.

One year decides each score, so an unusual year can move it.

### Reference scores

The constants [slackwater-database](https://github.com/openwatersio/slackwater-database) holds for the same gauge are scored on the fit's held-out year by the same code, on the same hours, into `fits/references/<source>.parquet`: a row per fit and record. A reader comparing the two has the fit's score in `fits/<source>.parquet`, the record's here, and the standard error of the difference of their residual variances, taken from 30-day blocks as in [What was measured](#what-was-measured). No row says which is better.

**Which records.** A record counts as the station's gauge on what the store records, never on position or name alone ([`src/fit/reference-links.ts`](../src/fit/reference-links.ts)):

- `id`: the record carries the station's own ID in its source and is within 10 km of it, as a NOAA record does for a CO-OPS station, and a TICON record for the GESLA file it was analyzed from.
- `levels`: the record carries the ID of another series of the gauge (`same_as`) whose hourly levels agree with the station's within 1 cm RMS with no lag in `stations/matches.parquet` ([Stations](stations.md#gauges-in-more-than-one-source)). That comparison covers the latest years both series hold, so it shows the two are one series now. It doesn't cover the years the record was analyzed over.

A record reached only through a link nothing has compared isn't scored, since series linked along one estuary can be different gauges. That includes a station's `tide_station` where it was taken from such a link. A record linked either way is scored where the database accepts it or keeps it only as another's duplicate, and one it rejects for its constants, clock, datum or range isn't. A record of a GESLA file whose values are another gauge's has none, and neither does a record of a database source whose IDs name no series in the store (`seriesOf` in [`src/datums.ts`](../src/datums.ts)). A withheld series links nothing.

**Under its own corrections.** Each record is predicted under the nodal corrections its constants were fitted with, where those are known: Schureman's for NOAA. The fit is predicted under its own. Where they aren't known, the record is predicted under the IHO's, which slackwater-database's predictions use by default, and the row says the corrections are assumed (`node_corrections_assumed`). The reference scores predict under Schureman's and the IHO's corrections only, so a record fitted under Foreman's is scored under an assumption.

**TICON's corrections are assumed.** TICON-4's manual names none and refers for its method to [Piccioni et al. (2019)](https://doi.org/10.1002/gdj3.72). Four TICON records, each refitted from its own GESLA file over the span the record gives with the record's constituents ([`scripts/ticon-corrections.ts`](../scripts/ticon-corrections.ts)), come back under no one family:

| Gauge                                                    | Latitude | Span         |
| -------------------------------------------------------- | -------- | ------------ |
| Mornington Island (`mornington_island-h074011a-aus-bom`) | 16.7°S   | 2007 to 2016 |
| Vung Tau (`vung_tau-383a-vnm-uhslc_rq`)                  | 10.3°N   | 1986 to 2002 |
| Winchelsea Island (`winchelsea_is_bc-7935-can-meds`)     | 49.3°N   | 1967 to 1982 |
| Sandy Cove (`sandy_cove_bc-7786-can-meds`)               | 49.3°N   | 2009 to 2025 |

Refitted amplitude over TICON's, across the four:

| Constituent | IHO            | Schureman      | Foreman        |
| ----------- | -------------- | -------------- | -------------- |
| O1          | 0.991 to 0.992 | 0.999 to 1.000 | 0.999 to 1.000 |
| Q1          | 0.990 to 0.992 | 0.998 to 1.000 | 0.995 to 1.007 |
| Mf          | 0.935 to 0.970 | 0.976 to 1.001 | 0.859 to 1.181 |
| J1          | 0.999 to 1.001 | 1.085 to 1.092 | 1.054 to 1.105 |
| M2          | 0.999          | 0.999 to 1.000 | 0.999 to 1.000 |

O1, Q1 and Mf come back under Schureman's corrections and J1 under the IHO's. M1's phase is 65° to 95° from TICON's under every family, though TICON's manual gives M1 the Doodson number the engine's has, and OO1's is up to 24° off. So no family the engine predicts under reproduces a TICON record, and the M1 line costs one the most: over a year, the curve of TICON's diurnal and faster constants is 16 to 44 mm RMS from the curve of the same family's refit at these gauges, and 3.5 to 7.8 mm without M1 and OO1. The choice between the two families moves that by under 1 mm. These four gauges have a diurnal tide of 0.45 to 0.88 m in K1 and O1; where the diurnal tide is small, as at Kungsvik and Cuxhaven, M1 is too.

**What a row carries.** The record's ID and source, the `@slackwater/database` release its constants were read from, a digest of those constants, how the record is linked, the corrections it was predicted under, and whether the span it says it was analyzed over includes the held-out year (`seen`), which then favors it over the fit. A score describes a record only while its constants have the row's digest. It holds none of the record's values, and is measured against them, so each row also carries the record's license, whether its terms allow commercial use, and its credit.

**When they are taken again.** With the fit, whenever the station is fitted. Without fitting, when a release changes a linked record's constants, its terms or whether its analysis covers the held-out year, a record joins or leaves the gauge, or the link to one changes: the held-out year is read as the fit read it, and the scoring stops if the fit's own score no longer comes out as its row says. Each row carries its fit's `version` and `fitted`, a reader joins on both with `id`, and rows that don't match the fit's are taken again.

## Tidal datums

Each fit with constants has a row of tidal datums in `fits/datums/<source>.parquet`, reduced by [`@slackwater/datums`](https://www.npmjs.com/package/@slackwater/datums) ([`src/fit/datums.ts`](../src/fit/datums.ts)). A row joins its fit on `id`, `version` and `fitted`, and gives every datum as a height in meters above the station's zero: its `datum` in its current epoch, which the fit moved every epoch's levels into. The package's README lists what it computes, which of its rules are its own and which are an agency's, and its limitations. Which datum is a station's chart datum stays with slackwater-database, and `stations.parquet` doesn't read the file.

**Observed datums** are NOAA's first reduction ([Computational Techniques for Tidal Datums Handbook](https://tidesandcurrents.noaa.gov/publications/Computational_Techniques_for_Tidal_Datums_handbook.pdf), §2.6 and §3.1): MHHW, MHW, MSL, MTL, MLW and MLLW, each a mean over one window, with high and low waters tabulated by the method of NOAA's Tidal Analysis Datum Calculator ([NOAA Technical Report NOS CO-OPS 085](https://tidesandcurrents.noaa.gov/publications/techrpt085.pdf), §2.2).

- **What it reads.** Every measured value from the start of the fit's window to the end of its held-out year, final or not: values flagged good or preliminary. Interpolated, suspect and bad values stay out, so a gap a source filled is a gap here, and the package fills it or not by its own bounds rather than counting the source's fill as observed. Flags combine to the worse of the source's and QC's, and preliminary is worse than interpolated, so a value a source marks both provisional and estimated, as USGS can, is stored as preliminary and read as measured, outside the package's bounds.
- **At what spacing.** Every value at least 4½ minutes after the one before it in its year file, which leaves a 5-, 6- or 10-minute series whole, with each stamp within 15 seconds of its mark, and thins a 1-minute one to every fifth value. Each epoch's files are thinned on their own, so where a rejected epoch's values overlap another's, as they rarely do, both can be read. NOAA tabulates from 6-minute values, and the package takes a tide's height from a cubic over 2.5 to 6.5 hours of a series finer than 15 minutes. Thinning keeps 19 years of a 1-minute gauge within a fit's worker, where the whole series would take about 4 GB.
- **Window.** The longest run of complete UTC calendar months that is a whole number of years, the latest on a tie, within the 19 years up to the last complete month read. A month is complete when every hour has a value, measured or filled. The row gives the window, its months, and its observed and filled hours. The store has no shared epoch: each gauge's window is its own, and none is brought to a National Tidal Datum Epoch through a control station, as NOAA does for a series shorter than 19 years.
- **Gaps.** The fit's constants, predicted under the corrections they were fitted with, fill gaps of up to 23 hours from the prediction plus the residual interpolated across the gap, within the package's bounds: the residual at the two edges agreeing within 0.1 m, and no more than 72 such hours a month.
- **Too little record.** A station with no whole year of complete months, or none with a high and a low water, has a row with its `reason` and no observed datums. That is the package's rule, and no other threshold applies.

**Predicted datums** come from the fit's constants predicted over 19 years, the epoch the package pins (`DATUM_EPOCH`, 2007 through 2025), on top of the fit's `z0_m`, under Schureman's corrections: HAT and LAT, the Large Tide levels HHWLT and LLWLT, MHHW to MLLW of the predicted turns, MHWS and MLWS, NLLW and ALLW, and TLT. Those are the datums slackwater-database chooses a station's chart datum among, by country. Another 19 years gives other extremes, so the epoch is the same for every station, and the row records it. The prediction rides on the fit window's mean level, so its MSL is `z0_m`, which differs from the observed MSL by the change in mean level between the two windows.

**When they are reduced again.** With the fit, whenever the station is fitted, since a row belongs to one fit. Without fitting, when the version of `@slackwater/datums` or the step's method changes. A fit read under other epochs than the station has now, as one whose refit failed after the source moved the station's zero, has its datums wait for the next fit, since its mean level was read under the old conversions. Reducing a station's 19 years of 6-minute values takes a few seconds, and its heap peaks between 400 and 600 MB; a 1-minute gauge's, thinned to every fifth value, peaks near 750 MB.

### What was measured

Twenty CO-OPS gauges, fitted on 2006 through 2024 and held out on 2025, from Kwajalein and Honolulu to Anchorage and Eastport.

**Against NOAA on the same months.** NOAA publishes each month's MHHW, MHW, MSL, MTL, MLW and MLLW from its own tabulation of the same gauge. Averaged over each station's observed window, the reduction here agrees with them as follows, in millimeters (here minus NOAA):

| Datum | Mean | RMS | Largest |
| ----- | ---- | --- | ------- |
| MHHW  | 0    | 4   | 10      |
| MHW   | 0    | 4   | 8       |
| MSL   | 0    | 1   | 1       |
| MTL   | 1    | 4   | 11      |
| MLW   | 1    | 9   | 30      |
| MLLW  | 2    | 9   | 34      |

The largest are at Anchorage (`coops/9455920`), whose mean range is about 8 m, with MLW and MLLW 30 and 34 mm high, and Galveston's Pier 21 (`coops/8771450`), with MLW 18 mm low. Neither is explained. Every other datum at every other gauge is within 10 mm. The windows run from 7 to 19 years.

**Against NOAA's National Tidal Datum Epoch.** NOAA's published datums are for 1983 through 2001, and each gauge's window here is its own latest years, so they differ mostly by the change in mean level: MSL is 3 to 156 mm higher at 18 of the gauges, and 46 and 9 mm lower at Anchorage and Unalaska (`coops/9462620`). The mean range, MHW minus MLW, is within 20 mm of NOAA's at 16 gauges; it is 118 and 121 mm larger at Eastport (`coops/8410140`) and Anchorage, 47 mm larger at Philadelphia (`coops/8545240`) and 36 mm smaller at Boston (`coops/8443970`).

**HAT and LAT.** Predicted from NOAA's own constants over the same 19 years with the same code, HAT and LAT fall within 25 mm of those predicted from the fit's constants at 12 of the 20 gauges. Seven differ by 26 to 70 mm, the most at Eastport, Philadelphia and Boston, where the fit's M2 is 20, 16 and 5 mm larger than NOAA's. At Anchorage the fit's LAT is 176 mm higher; NOAA's constants there have 120 constituents and the fit's 75, and which difference accounts for it isn't measured.

**Against Kartverket.** Twenty-four Kartverket gauges, fitted on up to 19 years before 2025 and held out on 2025, against the datums Kartverket's `stationlevels` gives, as heights above chart datum. Kartverket's MSL is the mean over 1996 to 2014, and its other datums come from constants analysed over 2006 to 2020. MSL here is 5 to 32 mm higher at most gauges and up to 10 mm lower where the land rises fastest (RMS 18 mm at the 23 gauges other than Ny-Ålesund). The difference is sea level change between the two windows: a regional rise of 3.75 mm a year, fitted to these gauges, less the land uplift Kartverket gives for each gauge, times the years between the windows' centers, leaves an RMS of 5.5 mm and at most 13 mm. HAT, LAT, MHWS and MLWS from the prediction differ by an RMS of 23, 24, 18 and 17 mm. Ny-Ålesund (`kartverket/NYA`) is 59 to 85 mm below Kartverket on every datum. Kartverket gives no uplift rate there, and closing the gap in MSL would take about 12 mm a year, so it isn't explained. Kartverket's MHW, MLW, MHWS, MLWS and MHWN are MSL plus or minus M2, or M2 and S2, to within 1 cm at all 33 of its stations, though its descriptions call MHW and MLW the means of all high and low waters over 19 years. They aren't compared.

**Thinning.** At two LINZ gauges recorded every minute, Port Chalmers and Wellington, four years read whole and thinned to every 5 minutes give the same window and the same observed datums within 1 mm.

## Calibration

The [fit calibration](results/fit-calibration.md) fits NOAA CO-OPS reference stations from the store and compares the constants with the ones NOAA publishes for the same gauges, which NOAA analyzed from its own observations of them under Schureman's corrections. It is the fits' independent reference, and it is run again whenever the method changes ([Checks](contributing/checks.md#fit-calibration)). It compares NOAA's own analysis years and the standard 19-year window, takes the method apart one step at a time between NOAA's and the store's, and scores every set of constants on the held-out year. Its summary says what agrees, which constituents differ and why, and what it found wrong.

The [Kartverket calibration](results/kartverket-calibration.md) does the same against the constants Kartverket publishes for its gauges, fitted Kartverket's way: Foreman's corrections at the gauge's latitude, without robust weights, over Kartverket's period. It is a second agency's constants and a second family of nodal corrections through the same engine.

The calibration against NOAA also fits each gauge with the 59 shallow-water compounds NOAA publishes for Anchorage after the candidate list ([`SHALLOW`](../src/fit/candidates.ts)), which no fit starts from, and reports what they change on the held-out year and on a year neither fit read. A large tide in shallow water has energy on those lines that the candidates leave in the residual.

## What the IHO asks a publisher to state

IHO Resolution 2/1977 asks for the station's position, the source, dates, time zone and duration of the data analyzed, the datum connection, amplitudes in meters and Greenwich phase lags in degrees, and the organization responsible. The fit gives the mean level its constants ride on (`z0_m`) in the station's datum, and `stations.parquet` gives that datum's offsets to others. [Resolution 1/2019](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/TWCWG5/TWCWG5_2020_3.2.1_EN_IHO_Reslution_1-2019_v1.0.pdf) adds the dates of the series analyzed and the name of the analysis program. Neither asks for the nodal corrections, which the fit files also give.
