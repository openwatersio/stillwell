# Constituent selection

Which tidal constituents a fit offers a station, and how it decides which to keep, is an open design question. This document states what is known that bears on it, where Stillwell's fit stands, the designs worth testing and the experiment that would choose between them. It proposes no default.

## What is known

**Agency lists are mostly history and software.** NOAA's 37 are the set its tide-predicting machine summed ([NOAA](https://tidesandcurrents.noaa.gov/predmach.html)), and its manual says "one should not feel it necessary to stick with the standard 37 constituents" ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), §4.4, p. 165). UK practice tops out at 115 because the analysis software's nodal table is hard-wired ([NOC R&C Report 62](https://nora.nerc.ac.uk/id/eprint/519017/1/NOC_R%26C_62.pdf), appendix C). Rijkswaterstaat fits a standard set of 94, of which 58 are fourth-diurnal or higher, recommended "at least for data from the North Sea and surroundings" ([hatyan](https://github.com/Deltares/hatyan), `get_const_list_hatyan`). SHOM fits a standard list of 143 ([SHOM 2024](https://refmar.shom.fr/sites/default/files/fiches_data/Fiche_Prediction_maree_mai_2024.pdf), p. 11). No derivation of the 94 or the 143 is published.

**Where a list was chosen from data, two tests were used.** One is the residual spectrum: fit, find the peaks left above the continuum, name them and refit. Zetler and Cummings found 114 lines for Anchorage that way ([1967](https://elischolar.library.yale.edu/journal_of_marine_research/1089/)), and BSH keeps a long-period line where it stands above a noise level in at least a third of the periodograms of 111 gauges ([Boesch and Müller-Navarra 2019](https://doi.org/10.5194/os-15-1363-2019)). The other is stability from year to year: at Hoek van Holland in 1984 Rijkswaterstaat kept components whose yearly phases fell 90% within 45° of their mean, and arrived at 105 ([Rijkswaterstaat 1984](https://open.rijkswaterstaat.nl/publish/pages/83835/760086.pdf)). Parker recommends the same test.

**Independent searches disagree on the compounds.** The Anchorage and Thames studies each chose 114 lines, and 74 are shared (Parker 2007, §4.1). At Philadelphia, six of the lines added for Anchorage failed a stability check until they were renamed from K2+N2 products to M2+L2 products 0.009°/h away (Zetler and Cummings 1967, pp. 110–112).

**The set of possible constituents has no end.** The tidal potential is finite only for a chosen cutoff: Doodson's 1921 development keeps 386 terms above a ten-thousandth of the largest, and the 1995 catalog of Hartmann and Wenzel has 12,935, most far below gauge noise. Shallow-water compounds are not in the potential. Every integer combination of parent frequencies is a candidate, and several combinations land on one frequency. Pugh puts practice at 60 to 100 constituents for a year of data and "more than 300" for 19 years ([Pugh 1987](https://nora.nerc.ac.uk/id/eprint/119157/), §4.2.5).

**What limits a long list is not the amount of data.**

- Lines that share a frequency. L2 and 2MN2 do, with different nodal factors, so under 18.6 years the data cannot say which is present, yet the name changes every later prediction (Parker 2007, §4.1.1).
- Lines too close to separate. Fitted together they can cancel inside the record and add outside it ([Leffler and Jay 2009](https://doi.org/10.1016/j.csr.2008.04.011), §5).
- Energy that does not recur. Weather spreads energy into a band around each main line ([Munk, Zetler and Groves 1965](https://doi.org/10.1111/j.1365-246X.1965.tb03062.x)), and river flow modulates the tide ([Matte, Jay and Zaron 2013](https://doi.org/10.1175/JTECH-D-12-00016.1)). A line fitted there takes up energy another year will not repeat.
- A threshold that admits noise. With the ratio defined as amplitude squared over the amplitude's variance, a candidate with no signal exceeds 2 with probability e⁻¹, about 37%, assuming Gaussian noise and an unbiased variance. With t_tide's definition, which divides by the 95% half-width, the same threshold admits about 2%.
- Nodal corrections for compounds are built from their parents' and are an assumption. Observed modulation in shallow water departs from the formulas ([Amin 1976](https://doi.org/10.1111/j.1365-246X.1976.tb03658.x)), and Rijkswaterstaat holds empirical scaling factors for 12 constituents for that reason.

**Pruning has a cost too.** Rejecting small constituents loses energy that "can add up", leaving predicted high waters too low (Parker 2007, §4.1.2).

**Long lists help shallow gauges and hardly matter elsewhere.** Around Australia a fixed 146 against a fixed 68, scored on later years, improves shallow estuaries and changes open coasts by under a centimeter ([Richet et al. 2026](https://doi.org/10.1080/1755876X.2026.2631282)). At Avonmouth 62 constituents reproduce a tide-only model run to a standard deviation of 20 cm and 115 to 10 cm (NOC R&C Report 62). Past that the error is not stationary: at Avonmouth a correction from recent high waters cut the high-water error from 19.6 to 11.6 cm ([Hibbert et al. 2015](https://doi.org/10.1080/1755876X.2015.1014641)). SHOM predicts the Gironde by species concordance with a reference port, and BSH has never used the harmonic method in the German Bight.

**No published study compares selection rules across many gauges on held-out years with record length controlled.**

## Where Stillwell stands

- **Candidates.** A fit offers 79: Foreman's standard 69 less four, plus what NOAA's 37 and TICON's 50 add ([`src/fit/candidates.ts`](../../src/fit/candidates.ts)). Of these, 77 are separable over 19 years, 70 over one year and 57 over half a year.
- **Catalog.** `@slackwater/engine` defines 405 constituents. About 317 are distinct lines separable over 19 years. A line the catalog lacks can be defined from Doodson numbers or from its parents.
- **Selection.** A candidate is dropped if it sits within one cycle over the record of one already kept. The survivors are fitted together, and any with a ratio under 2 are dropped in one pass. The engine's ratio is amplitude squared over the amplitude's variance, the 37% case above.
- **Shared frequencies.** Where two names share a speed, the candidate order decides which is kept. Nothing in the data is consulted.
- **No safeguards for a long list.** The fit has no condition-number check, no pivoting and no regularization, and the cut is not stepwise, so weak collinear candidates can lower each other's ratios.
- **Cost.** A 19-year fit takes 108 s with 79 candidates and 271 s with 138.
- **Consumers.** The published files carry any number of constituents. The TCD format XTide reads allows 255. A reader that does not know a name drops it.

An experiment on 56 gauges offered NOAA's 59 Anchorage compounds after the 79. Over 19 years, 49 of 55 gauges improved on later years and none worsened: Anchorage by 41.7 mm (20% of its residual), seven Dutch gauges by 8.5 to 20.9 mm, five German Bight gauges by 4.1 to 20.4 mm, and 37 gauges by under 1 mm. Thresholds of 2, 4 and 10 and a year-to-year stability filter gave the same gain within a millimeter. Keeping only compounds whose parents predict a detectable size kept a median 26 of the 59 and gave up a quarter of the gain at Anchorage. The experiment tested no list longer than 138, no gap between the fit and the scored year, and no record under two years.

## Designs

**A. A fixed list.** The 79, or the 79 with a set of compounds. Simple, and comparable with agencies' constants. The short list fails estuaries. A long one carries noise lines at open coasts, cheaply on long records and less cheaply on short ones, and still names shared-frequency lines by list order.

**B. A large candidate list under a validated per-gauge rule.** Candidates are every distinct line the catalog can supply. Selection combines separation, a threshold set for the number of candidates and for colored noise, and stability across yearly fits. This is the direction of the Hoek van Holland study and of Parker's advice. Its risks are false positives from testing hundreds of candidates, and a ranking for inseparable neighbors that has no basis for compounds.

**C. Lists tiered by record length.** Rijkswaterstaat's practice: 94 for a year, 88 for half a year, 21 for a month. It follows the separation rule and ignores the site.

**D. A regularized fit.** Every candidate is fitted with a penalty or a prior scaled to its expected size, which handles near-collinear lines smoothly. Shrinkage biases amplitudes low, which is Parker's lost-energy concern.

**E. Another method where the residual is not stationary.** For the Elbe, Weser and river gauges, lines added to a stationary model cannot follow a tide that river flow modulates. The roadmap's HRoI track is this for German and Dutch gauges. It complements any of A to D.

Two questions cut across the designs: how a shared-frequency line gets its name, and whether a 19-year fit should resolve nodal satellites directly where the formulas are known to be wrong.

## Experiment

- **Gauges.** Several hundred, stratified by class: open coast, shelf, estuary, river.
- **Record lengths.** 0.5, 1, 2, 4, 10 and 19 years, made by truncating long records, so each rule is scored where it is weakest.
- **Scoring.** Fit on years before a cutoff and score each of several later years, at gaps of one to five years. Report paired differences per gauge, the residual within each tidal species, the times and heights of high and low water, and the spread of each constant across disjoint windows.
- **Arms.** The 79; the 79 with NOAA's 59; every separable catalog line under thresholds of 2, 4 and 6, with and without a stability filter; stepwise selection; a regularized fit; lists tiered by record length. The robust weights are a factor in each arm, since they change the variance every threshold rests on.
- **Synthetic check.** Inject known lines into real residuals to measure each rule's false-positive and false-negative rates.
- **Prerequisites in the fit.** A condition-number diagnostic and a stepwise cut, each of which stands on its own.

## Not established

- The names and derivation of SHOM's 143, and any derivation of Rijkswaterstaat's 94. Both appear to be in internal documents.
- How wrong compound nodal corrections are in practice, and whether fitting satellites directly does better.
- Whether any selection rule beats a long fixed list on later years once record length is accounted for.
