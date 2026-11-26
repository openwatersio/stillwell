# Harmonic fits

How the store fits harmonic constants to a station's water levels, and why each choice was made. [Running ingest](contributing/ingest.md) covers the `fit` command, [`src/store/files.ts`](../src/store/files.ts) defines every column of the two files it writes, and the code is in [`src/fit/`](../src/fit/).

A fit is a measurement. It is published whatever its size, with what a reader needs to judge it: the window, the files read, each constituent's confidence interval and signal-to-noise ratio, the scatter between years, and a score on a year the fit didn't read. Nothing here decides whether a gauge has enough tide to predict.

## What a fit reads

- **Final values.** A fit reads values the source won't revise again: verified values, and preliminary ones from before the station's `source_qc_start`, which the source will never check. A source that never marks values final declares how long after a year ends its values are read as final (`settles_after_months`), with its evidence in its README.
- **Flags decide.** A fit reads what the store's flags allow. A value is `kept` under an erratum only where its own evidence supports keeping it, and a value no reader should use is `flagged`, which marks it suspect. The fit records every erratum touching the years it read.
- **Values stamped on the hour, read as instantaneous.** Hourly sampling resolves every constituent below twelve cycles a day and keeps a 19-year fit to about 166,000 values. A fit can't tell an instant from a mean. Where a source's hourly values are means, its amplitudes come out low: a one-hour mean scales a constituent by sinc(f · 1 h), which is 0.989 for M2, 0.958 for M4 and 0.907 for M6. Such a series has an erratum or a note in its source's README, and its fit isn't corrected for it.
- **One datum.** Every datum epoch's levels are moved into the station's current datum by the epoch's `to_current`, and an epoch that can't be converted is left out.

## Window

A fit reads up to 19 years, one cycle of the Moon's node (18.6 years) rounded to whole years, as NOAA's tidal datum epoch is ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), pp. 22 and 46). Over a full cycle the nodal modulation of each constituent averages out of the fitted amplitude, whatever the nodal corrections assume about it.

The year after the window is held out. It is the latest year of final values in which half the station's hours can be scored, and the fit never reads it. A record with under 183 days before that year isn't fitted, since under half a year can't separate P1 from K1 or K2 from S2 ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), §3.3, pp. 85–86).

## Method

One least-squares fit over the whole window, with each constituent's nodal factors and equilibrium argument evaluated at each sample's time inside the design matrix. [Foreman, Cherniawsky and Ballantyne (2009)](https://doi.org/10.1175/2008JTECHO615.1) introduced this for long records: holding the nodal factors constant over a 12-year analysis at Tofino put errors of about 8% in O1, 5% in K1, 2% in M2 and 15% in K2, which evaluating them in the matrix removed. UTide does the same ([Codiga 2011](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf), pp. 4 and 6).

NOAA evaluates the factors once a year, at mid-year, for convenience ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), p. 148). Measured on two gauges, that mode makes the 19-year fit about 12 seconds faster of 100 and moves most constants by under 0.3 mm, but lambda2 by 2.1 mm at Cuxhaven. The fits evaluate at every sample.

**Robust weights.** The fit is iteratively reweighted with Cauchy weights, so surges and spikes that QC passes don't pull it, as UTide does by default, after Leffler and Jay (2009) ([Codiga 2011](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf), pp. 5 and 20). It costs about four times a plain fit. On the held-out year it lowers the tidal-band RMS by 0.2 mm at Kungsvik and 1.3 mm at Cuxhaven.

**Confidence intervals** come from the residual spectrum around each constituent's frequency, so correlated noise doesn't shrink them ([Pawlowicz, Beardsley and Lentz 2002](<https://doi.org/10.1016/S0098-3004(02)00013-4>), §4.1). Those authors find the linearized intervals adequate for a signal-to-noise ratio above 10 and "probably not bad" down to 2 or 3.

## Constituents

Every fit starts from the same candidates in the same priority order, defined in [`src/fit/candidates.ts`](../src/fit/candidates.ts) by their Doodson numbers:

1. Foreman's standard set of 45 astronomical and 24 shallow-water constituents, in his order of selection, which follows decreasing amplitude in the tidal potential ([Foreman 1977](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf), p. 16 and pp. 18–19). Of the 69, the mean (Z0) is fitted as `z0_m`, H1 and H2 enter under the IHO names of the same lines, MA2 and MB2, and OQ2 is left out, which leaves 65 under his names.
2. The constituents NOAA's standard 37 add.
3. The constituents TICON-4's 50 add ([TICON-4 manual](https://doi.org/10.17882/109129)).

Starting from one list makes fits comparable between gauges, and including NOAA's and TICON's names lets a fit be compared with either name for name.

**Names that share a line.** NO1 and M1 are one line, as are MO3 and 2MK3: the same Doodson numbers under two names, each with its own nodal correction. A line has one constant, so the two names can't both be kept, and the name decides the correction. The list keeps one order, and each set of nodal formulas names the lines it holds under the other name (`PREFERRED` in [`src/fit/candidates.ts`](../src/fit/candidates.ts)), which then takes the first name's place in the order:

- **M1 for NO1, under Schureman's and the IHO's formulas.** Both define a correction for M1 and none for NO1, which they treat as a compound of N2 and O1. Foreman's define NO1's line and call it NO1.
- **2MK3 for MO3, under Schureman's.** Neither name has a formula of its own there: each takes its correction from its members, M2 twice less K1, or M2 and O1. NOAA publishes the line as 2MK3.

The [calibration against NOAA's constants](results/fit-calibration.md) measured the two together, on fits of the years NOAA analyzed: with NOAA's names and nothing else changed, the held-out year is predicted better at 9 and worse at none of the 18 stations whose NOAA analysis didn't read that year, counting a change of 0.1 mm or more, from −2.0 to +0.1 mm. The gain is in the prediction. M1's own constant is no closer to NOAA's under its name, since NOAA's comes from node factors held for a year at a time. The preference for M1 under the IHO's formulas follows from the formulas and hasn't been measured.

The preferred name gets the first chance to be kept. Where it fails the signal-to-noise test, neither name is kept, and the other's row names it as the conflict.

Holding the line as M1 has a cost for anyone predicting with other software. M1's Doodson numbers include the lunar perigee, p, and so does Schureman's correction for M1 as he writes it for the argument without p (his equation 202). The constants here are on the argument with p (equation 194), whose correction is u = −ν − Qa (equation 196). Applying equation 202's correction to these Doodson numbers counts p twice, and the phase drifts about 40° a year. 2MK3 isn't among the shallow-water lines t_tide and UTide define, while MO3 is, so those can't predict it. slackwater-database's stored constituent definitions can't carry M1's correction either ([slackwater-database#238](https://github.com/openwatersio/slackwater-database/issues/238)), so it predicts a fit that keeps M1 only with an engine that has it.

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
| IHO       | Series for eight constituents in Annex A of the IHO standard list, with rules for compounds             | TICON, which cites the IHO's 2006 factors        |
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

Sa, Ssa and S1 were left out, since t_tide defines SA and S1 on lines that include the solar perigee. Each family's fit chose from the candidates in its own order, so the two shared lines were held as M1 and 2MK3 under Schureman's corrections, M1 and MO3 under the IHO's, and NO1 and MO3 under Foreman's.

**No family predicts best everywhere, and the differences are about 1% of the residual at most.** Tidal-band RMS of observed minus predicted levels on the held-out year, fitted and predicted under the same family:

| Gauge     | Schureman | IHO       | Foreman   |
| --------- | --------- | --------- | --------- |
| Kwajalein | 24.57 mm  | 24.48 mm  | 24.57 mm  |
| Honolulu  | 23.23 mm  | 23.13 mm  | 23.05 mm  |
| Pensacola | 30.46 mm  | 30.43 mm  | 30.36 mm  |
| Cuxhaven  | 180.72 mm | 180.64 mm | 181.29 mm |
| Kungsvik  | 59.03 mm  | 59.03 mm  | 58.98 mm  |

Whether a difference is more than one year's noise was tested by the difference of the two residual variances against twice its standard error, taken from 30-day blocks:

| Gauge     | Schureman against IHO | Schureman against Foreman |
| --------- | --------------------- | ------------------------- |
| Kwajalein | within noise          | within noise              |
| Honolulu  | IHO better            | Foreman better            |
| Pensacola | within noise          | within noise              |
| Cuxhaven  | IHO better            | Schureman better          |
| Kungsvik  | within noise          | within noise              |

Foreman's corrections fit Honolulu measurably better than Schureman's, and Schureman's fit Cuxhaven measurably better than Foreman's. IHO's are measurably better than Schureman's at two gauges and never worse. The largest of these differences is 0.6 mm of RMS, at Cuxhaven, on a residual of 181 mm. What weather, seiches and river flow leave in the residual is a hundred times any difference between the families, or more. The name a shared line is held under matters as much as the family: with those lines as NO1 and MO3 under Schureman's corrections, its residual is 0.2 mm higher at Pensacola and 0.1 mm at Kwajalein, and Foreman's fit of Pensacola is then measurably better.

**Using the constants under another family.** RMS difference between the curve predicted under the fit's family and the curve the same constants give under another, over the held-out year, from fits that held the shared lines as NO1 and MO3 under every family:

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

- **Comparison with TICON.** TICON's constants were fitted under IHO factors ([Piccioni et al. 2019](https://doi.org/10.1002/gdj3.72)), so a fit's O1 reads 0.8% above TICON's for the same tide, and its Mf 4% above. A comparison of constants across the two has to allow for the family.
- **Honolulu.** Foreman's corrections leave 0.2 mm less RMS in the held-out residual there than Schureman's, about 1% of it.
- **Use in t_tide or UTide.** Those predict under Foreman's set, and a Schureman fit used there differs by 3 to 8 mm RMS at these gauges. Direct reuse there would also need t_tide's own definitions of SA, S1 and M1, and only the constituents in its table. A user who needs exact agreement refits the series under Foreman's set, which the store's levels allow.
- **A limit every family shares.** All three assume the nodal modulation the equilibrium tide has. Observed modulation departs from it in shallow water ([Amin 1985](https://doi.org/10.1111/j.1365-246X.1985.tb05138.x); [Feng, Tsimplis and Woodworth 2015](https://doi.org/10.1002/2014JC010312)). A 19-year window averages the modulation out of the fitted amplitude, but a prediction for one year carries the assumption.
- **M1 and L2.** M1 is several lines, defined and corrected differently in each family ([Woodworth 2019](https://os.copernicus.org/articles/15/431/2019/)), and L2 shares its frequency with 2MN2, whose node factor differs ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), pp. 59–60). Their constants depend on the family more than any others.

### Other families

The fit's row names its corrections so that constants fitted under another family can be published beside these where a use calls for them, such as Foreman's for t_tide and UTide. The 19-year fit is about a third of a station's work, so a second family adds about that much.

### What is still to measure

Five gauges and one held-out year each. A gauge on the equator, where Foreman's latitude factor is held at 5°, and a second year at each gauge would show how far these results carry.

## Scores

The held-out year is scored the same way for any constants:

- **Tidal-band RMS.** Observed minus predicted, hourly, after a Godin filter (running means of 24, 24 and 25 hours) removes everything slower than a day. The filter also removes the long-period constituents, so this score can't see them.
- **Variance explained.** One minus the residual's variance over the observed levels', both after the same filter.
- **Bands.** The residual's RMS in the diurnal, semidiurnal, quarter-diurnal and sixth-diurnal bands.
- **High and low waters.** One picker finds the turns of the observed and the predicted hourly series, so both are picked the same way, and the time and height differences of matched turns are reported.

One year decides each score, so an unusual year can move it.

## What the IHO asks a publisher to state

IHO Resolution 2/1977 asks for the station's position, the source, dates, time zone and duration of the data analyzed, the datum connection, amplitudes in meters and Greenwich phase lags in degrees, and the organization responsible. The fit gives the mean level its constants ride on (`z0_m`) in the station's datum, and `stations.parquet` gives that datum's offsets to others. [Resolution 1/2019](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/TWCWG5/TWCWG5_2020_3.2.1_EN_IHO_Reslution_1-2019_v1.0.pdf) adds the dates of the series analyzed and the name of the analysis program. Neither asks for the nodal corrections, which the fit files also give.
