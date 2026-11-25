# Harmonic fits

How the store fits harmonic constants to a station's water levels, and why each choice was made. [Running ingest](contributing/ingest.md) covers the `fit` command, [`src/store/files.ts`](../src/store/files.ts) defines every column of the two files it writes, and the code is in [`src/fit/`](../src/fit/).

A fit is a measurement. It is published whatever its size, with what a reader needs to judge it: the window, the files read, each constituent's confidence interval and signal-to-noise ratio, the scatter between years, and a score on a year the fit didn't read. Nothing here decides whether a gauge has enough tide to predict.

## What a fit reads

- **Final values.** A fit reads values the source won't revise again: verified values, and preliminary ones from before the station's `source_qc_start`, which the source will never check. A source that never marks values final declares how long after a year ends its values are read as final (`settles_after_months`), with its evidence in its README.
- **Flags decide.** A fit reads what the store's flags allow. A value is `kept` under an erratum only where its own evidence supports keeping it, and a value no reader should use is `flagged`, which marks it suspect. The fit records every erratum touching the years it read.
- **Instantaneous values on the hour.** Hourly sampling resolves every constituent below twelve cycles a day and keeps a 19-year fit to about 166,000 values. Hourly means are not used: a one-hour mean scales a constituent by sinc(f · 1 h), which is 0.989 for M2, 0.958 for M4 and 0.907 for M6.
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

1. Foreman's standard set of 45 astronomical and 24 shallow-water constituents, in his order of selection, which follows decreasing amplitude in the tidal potential ([Foreman 1977](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf), p. 16 and pp. 18–19).
2. The constituents NOAA's standard 37 add.
3. The constituents TICON-4's 50 add ([TICON-4 manual](https://doi.org/10.17882/109129)).

Starting from one list makes fits comparable between gauges, and including NOAA's and TICON's names lets a fit be compared with either name for name. Foreman's H1 and H2 enter under the IHO names of the same lines, MA2 and MB2.

A candidate is kept when it passes two tests:

- **Rayleigh criterion.** The record separates it from every stronger candidate already kept by at least one cycle ([Foreman 1977](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf), §2.1.2, p. 17). Where a record can't separate two candidates, the one earlier in the list stays.
- **Signal to noise.** Its amplitude squared is at least twice its variance, UTide's default for including a constituent ([Codiga 2011](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf), pp. 35–36 and 40).

Every candidate has a row in `constituents/<source>.parquet`, kept or not, with the reason and, for a Rayleigh rejection, the constituent it conflicts with. A reader who wants a stricter or looser set has what is needed to choose one.

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

Two gauges, each fitted on 19 years under each family and scored on a held-out year: Kungsvik (`smhi/2130`, 59°N, mean range 0.27 m) and Cuxhaven (`pegelonline/5990020`, 54°N, mean range 2.8 m). Sa, Ssa and S1 were left out, since t_tide defines SA and S1 on lines that include the solar perigee.

**No family predicts better.** Tidal-band RMS of observed minus predicted levels on the held-out year, fitted and predicted under the same family:

| Gauge    | Schureman | IHO       | Foreman   |
| -------- | --------- | --------- | --------- |
| Kungsvik | 59.03 mm  | 59.03 mm  | 58.97 mm  |
| Cuxhaven | 180.73 mm | 180.64 mm | 181.23 mm |

The spread is under 0.4% of the score at either gauge. Each family's fit reproduces its own data, so the families differ in which amplitudes are published, and in how far a prediction moves when the constants are used under another family.

**Using the constants under another family.** RMS difference between the curve predicted under the fit's family and the curve the same constants give under another, over the held-out year:

| Fitted under | Predicted under | Kungsvik | Cuxhaven |
| ------------ | --------------- | -------- | -------- |
| Schureman    | IHO             | 1.4 mm   | 1.6 mm   |
| Schureman    | Foreman         | 7.2 mm   | 7.7 mm   |
| IHO          | Foreman         | 8.1 mm   | 8.0 mm   |
| Foreman      | Schureman       | 6.8 mm   | 7.3 mm   |
| Foreman      | IHO             | 7.8 mm   | 7.6 mm   |

Most of the difference from Foreman is in Mf and Mm, which Foreman's set gives no nodal modulation.

**The constants themselves.** Against Schureman's at Cuxhaven, IHO's O1 and Q1 are 0.8% smaller, Mf 3.9% smaller and J1 8.3% smaller, and M2 agrees within 0.04%. Foreman's Mf is 13% smaller and 2N2 4% smaller. The same differences appear in a synthetic series fitted under each family.

### Why Schureman

- **It is complete.** Schureman gives a closed form for every astronomical constituent in one public-domain manual. The IHO list gives series for eight, and treats the rest as unity or by rules for compound names.
- **The IHO list isn't meant for this.** It says it "is not intended to be used to produce accurate tidal predictions" ([IHO TWCWG 2017](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/MISC/TWCWG_Constituent_list.pdf)).
- **It sits between the other two.** Schureman's and IHO's constants give curves 1.4 to 1.6 mm apart, and of those two Schureman's are the closer to Foreman's, at 7.2 to 7.7 mm against 8.0 to 8.1 mm.
- **It doesn't depend on the gauge.** Foreman's third-degree satellites scale with latitude, and the factor is singular at the equator, where t_tide applies "a crude limiting" ([Pawlowicz, Beardsley and Lentz 2002](<https://doi.org/10.1016/S0098-3004(02)00013-4>), p. 932). One family for every gauge keeps fits comparable.
- **It is what the largest publisher of constants uses.** NOAA's constants and predictions use Schureman's factors, and [Parker (2007)](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf) gives NOAA's reasons for node factors over satellite sums on p. 149.

### What it costs

- **Comparison with TICON.** TICON's constants were fitted under IHO factors ([Piccioni et al. 2019](https://doi.org/10.1002/gdj3.72)), so a fit's O1 reads 0.8% above TICON's for the same tide, and its Mf 4% above. A comparison of constants across the two has to allow for the family.
- **Use in t_tide or UTide.** Those predict under Foreman's set, and a Schureman fit used there differs by about 7 mm RMS at these gauges. A user who needs exact agreement refits the series under Foreman's set, which the store's levels allow.
- **A limit every family shares.** All three assume the nodal modulation the equilibrium tide has. Observed modulation departs from it in shallow water ([Amin 1985](https://doi.org/10.1111/j.1365-246X.1985.tb05138.x); [Feng, Tsimplis and Woodworth 2015](https://doi.org/10.1002/2014JC010312)). A 19-year window averages the modulation out of the fitted amplitude, but a prediction for one year carries the assumption.
- **M1 and L2.** M1 is several lines, defined and corrected differently in each family ([Woodworth 2019](https://os.copernicus.org/articles/15/431/2019/)), and L2 shares its frequency with 2MN2, whose node factor differs ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), pp. 59–60). Their constants depend on the family more than any others.

### What is still to measure

Both gauges are above 53°N. Foreman's latitude terms matter most near the equator, so a low-latitude gauge belongs in this comparison, as does a gauge with a large diurnal tide, where O1, K1 and M1 carry more of the signal.

## Scores

The held-out year is scored the same way for any constants:

- **Tidal-band RMS.** Observed minus predicted, hourly, after a Godin filter (running means of 24, 24 and 25 hours) removes everything slower than a day. The filter also removes the long-period constituents, so this score can't see them.
- **Variance explained.** One minus the residual's variance over the observed levels', both after the same filter.
- **Bands.** The residual's RMS in the diurnal, semidiurnal, quarter-diurnal and sixth-diurnal bands.
- **High and low waters.** One picker finds the turns of the observed and the predicted hourly series, so both are picked the same way, and the time and height differences of matched turns are reported.

One year decides each score, so an unusual year can move it.

## What the IHO asks a publisher to state

IHO Resolution 2/1977 asks for the station's position, the source, dates, time zone and duration of the data analyzed, the datum connection, amplitudes in meters and Greenwich phase lags in degrees, and the organization responsible. [Resolution 1/2019](https://iho.int/uploads/user/Services%20and%20Standards/TWCWG/TWCWG5/TWCWG5_2020_3.2.1_EN_IHO_Reslution_1-2019_v1.0.pdf) adds the dates of the series analyzed and the name of the analysis program. Neither asks for the nodal corrections. The fit files carry all of these, and the nodal corrections as well.
