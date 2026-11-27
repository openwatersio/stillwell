# Constituent selection

Which tidal constituents a fit offers a station, and how it decides which to keep, is an open design question. This document surveys what agencies do, what the literature says, and what Stillwell's code can carry, then sets out the designs worth testing and the experiment that would choose between them. It proposes no default.

Each claim is marked by how it was checked: **[P]** read in a primary source (an agency document, source code or a peer-reviewed paper), **[S]** taken from a secondary source, **[I]** an inference, and **[M]** measured on Stillwell's code or store.

## Short answers

- **Why do agencies use the lists they do?** Mostly history and software. NOAA's 37 are what its tide-predicting machine could sum. Japan's earlier 38 were set by a 42-constituent machine. The UK's 115 is a table hard-wired in its software. No agency found publishes a derivation of its list from data across its stations.
- **Why does Rijkswaterstaat use 94?** No document says. The 94 are a fixed national set drawn from 195 defined in software from the 1970s, 58 of them third-diurnal or higher, recommended in a source comment "at least for data from the North Sea and surroundings". The one documented Rijkswaterstaat selection, at Hoek van Holland in 1984, kept components whose phase was stable from year to year and arrived at 105.
- **Why does SHOM use 143?** It is the standard list of SHOM's analysis software, a superset fitted everywhere: only 105 of the 143 exceed 1 mm at Brest. SHOM holds a second list of 541 lines for long records, and Brest's 2001–2007 analysis gave 182 constants. The names and the derivation of the 143 are in an internal document.
- **Why not fit every constituent?** There is no "every". The astronomical lines are finite but nearly all are far below gauge noise, and the shallow-water compounds are unbounded. What stops a long list is not the amount of data: it is lines that share or nearly share a frequency, energy near the tidal bands that does not recur from year to year, and a selection threshold that passes noise. Each of those can be designed for, and none has been tested across many gauges on held-out years by anyone.
- **Is a short fixed list defensible?** No. NOAA's own manual calls the 37 habit and advises against them, and every study of shallow or estuarine gauges finds a short list fails there.

## What agencies fit

| Body            | Count                                                            | Fixed or per station                                | How chosen                                                                  | Stated reason                                                                            |
| --------------- | ---------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| NOAA CO-OPS     | 37; 120 at Anchorage                                             | Fixed template                                      | The 37 are the capacity of Tide-Predicting Machine No. 2 (1910–1965)        | "Normally have the greatest effect"; Anchorage for its range and shallow water           |
| UKHO, NOC       | 58–63 for a year, up to 115                                      | Per site                                            | By record length and site, with analyst judgment                            | None published; the software's nodal table holds 115                                     |
| SHOM            | 143 standard; 541 for long records                               | Fixed superset, extended from the residual spectrum | Lines left in the residual are given a physical origin and added            | Fewer cost "tens of centimeters and tens of minutes"                                     |
| Rijkswaterstaat | 94 for a year, 88 for half, 21 for a month                       | Fixed national sets by record length                | Inherited lists; no derivation found                                        | "Recommended, at least for the North Sea"                                                |
| BSH             | Not harmonic: 39 long-period lines fitted to high and low waters | One set for all gauges                              | Periodograms at 111 gauges; kept where above noise at a third of them       | The harmonic method "would need a large number (≳60) of constituents or could even fail" |
| Kartverket      | 31–62 per gauge                                                  | Per gauge                                           | A signal-to-noise test; some inferred from a nearby station                 | None published                                                                           |
| CHS (Foreman)   | 69 standard, 146 possible                                        | Per record                                          | Rayleigh separation against a ranked neighbor; 77 compounds only on request | Cost grows as the square of the count; most compounds insignificant at most stations     |
| Australia BoM   | Up to 112                                                        | Per station by record length                        | Not published                                                               | None found                                                                               |
| Japan JMA, JHOD | 60                                                               | Fixed                                               | Not derived in any document found                                           | An earlier test against 110 found accuracy rose with the count                           |
| LINZ            | 13–38 published; 68 typical for a year                           | Per site                                            | Not published                                                               | "Meaningful values for the most significant 20 to 30"                                    |
| DMI             | Not found                                                        | Per station                                         | Tuned in 2022 by comparing one-year fits of long series                     | Not found                                                                                |

Sources and detail for each row are under [Agency sources](#agency-sources). All rows are [P] except where that section says otherwise.

Four things stand out.

**The counts are artifacts as often as choices.** NOAA's public page lists exactly the 37 its machine summed, S6 and M1 included, and 1,341 of 1,374 NOAA stations carry at least one of them at zero amplitude [M]. Zetler and Cummings wrote in 1967 that until computers arrived "there was a constraint to work only with a fixed set of constituents" [P]. NOC's 2018 report says going past 115 "would require a careful rewrite of the code" [P]. BSH says of its earlier lists that "no documentation of the methods and specific water level records that were used to prepare these lists exists" [P].

**Where an agency did choose from data, it used one of two tests.** The first is the residual spectrum: fit, look for peaks left standing above the continuum, name them and refit. Zetler and Cummings found Anchorage's 114 that way, SHOM does it today, and BSH's 39 come from periodograms. The second is stability from year to year: Rijkswaterstaat at Hoek van Holland kept components whose phase scattered by 28° or less over ten yearly fits, DMI retuned its criterion in 2022 by comparing one-year fits, and Parker's manual for NOAA recommends the same test.

**Independent searches do not agree on the compounds.** Zetler and Cummings chose 114 lines for Anchorage and Rossiter and Lennon 114 for the Thames in the same years. Only 74 are shared [P, via Parker]. At Philadelphia, six of Zetler's added lines failed a stability check until they were renamed from K2+N2 products to M2+L2 products 0.009°/h away [P].

**The agencies with the hardest gauges left the method.** SHOM predicts the Gironde by species concordance against a reference port, after reaching "several hundred" constituents there. BSH has never used the harmonic method in the German Bight. Both classes of gauge are in Stillwell's store.

## What "every constituent" means

The tide-generating potential has a finite expansion for any amplitude cutoff: about 388 lines in Doodson's (1921), 505 in Cartwright, Tayler and Edden's, 12,935 in Hartmann and Wenzel's (1995) [S for the first two counts, P for the last]. The ocean scales those lines but cannot lift one at a hundred-thousandth of M2 above a centimeter of noise.

Shallow-water compounds are not in the potential. They arise at sums and differences of the main lines' frequencies, so every integer combination of parents is a candidate, and many combinations land on one frequency. The lists in use are curated by hand: Foreman's 101, NOAA's 149 in Parker's appendix, the IHO register's 400-odd names, SHOM's 541. The IHO's list says of itself that it "is not intended to be used to produce accurate tidal predictions" [P]. SHOM calls the number of waves "unlimited" [P]. Pugh (1987) puts the practical scale at 60 to 100 for a year of data and "more than 300" for 19 years [P].

So "every constituent" is a choice of generator (which parents, to what order, up to which species) and a cutoff. Nothing found generates compounds systematically and cuts them by predicted size.

## What limits a long list

**Lines that collide.** Two lines closer than one cycle over the record cannot be separated by the Rayleigh rule, and a least-squares fit of both is ill-conditioned: the fitted pair can cancel inside the record and add outside it ([Kachelein et al. 2022](https://doi.org/10.1175/JTECH-D-21-0034.1)) [P]. Some lines share a frequency exactly. L2 and 2MN2 do, with different nodal factors, so with under 18.6 years the data cannot say which is present, yet the name changes every future prediction ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), §4.1.1) [P]. The engine's catalog holds 45 groups of names at one speed [M].

**Energy that does not recur.** Weather and river flow modulate the tide and spread energy into a band around each main line, the "cusps" of Munk, Zetler and Groves (1965). A line fitted inside a cusp takes up energy that another year will not repeat. Rossiter and Lennon read the Thames residual that way and raised "the possibility that tides are not strictly a time-stationary phenomenon" [P, abstract].

**A threshold that passes noise.** A constituent helps a prediction of another year only if its true signal-to-noise power ratio exceeds 2 [I, a standard bias-variance result]. The estimated ratio is biased high by 2, and for a candidate with no signal it exceeds 2 with probability e⁻¹, about 37% [I]. The correction for this is known: an Akaike criterion corresponds to an estimated ratio near 4 and a Bayesian one, at 19 years of hourly values, to about 24 [I].

**Record length sets the price.** With white noise and a 0.2 m residual, 500 noise lines add about 0.3% to the residual of a 19-year fit, and 300 add 6 to 7% to a half-year fit [I, an estimate]. Colored noise near the tidal bands makes both worse.

**Nodal corrections for compounds are an assumption.** A compound's correction is built from its parents'. Amin (1976) at Southend and Parker in the Delaware both found that observed modulation in shallow water departs from the equilibrium formulas [P, abstract; P]. Rijkswaterstaat replaces the formulas with empirical factors for 12 constituents for that reason [P]. With 18.6 years or more the satellites can be fitted directly, which adds lines and removes the assumption.

**Against pruning.** Parker warns that rejecting small constituents loses energy that "can add up", leaving predicted high waters too low, and that agencies which pruned too far then patched predictions with scaling factors [P]. Shrinkage methods carry the same risk.

## What is known about long lists

- **Estuaries gain a great deal.** Anchorage's 114 improved the times, heights and shape of the curve [P, abstract]. At Avonmouth 62 constituents reproduce a tide-only model to 20 cm and 115 to 10 cm [P]. At Port Tudy 12 constituents are 10 cm and 50 minutes off [P]. Richet et al. (2026) compared a fixed 68 with a fixed 146 around Australia, scored on later years: the long list "significantly improves" predictions at shallow estuaries and changes them by under 1 cm on open coasts [S, from the abstract and excerpts].
- **Open coasts gain almost nothing**, in every study that reports both.
- **Returns end at non-stationarity.** In the Bristol Channel an extended harmonic prediction had 26 cm RMS error, and a correction from recent high waters halved it (Hibbert et al. 2015) [P, abstract]. Amin (1977) found the extended harmonic method, the response method and Doodson's shallow-water corrections comparable at high and low water [S, via Parker].
- **No study varies the list across many gauges and scores held-out years**, and none selects constituents by cross-validation. No agency was found using information criteria, penalized regression or held-out years to choose a list.

## Where Stillwell stands

- **Candidates.** A fit offers 79: Foreman's standard 69 less four, plus what NOAA's 37 and TICON's 50 add ([`src/fit/candidates.ts`](../../src/fit/candidates.ts)). Of these 77 are separable over 19 years, 70 over one year and 57 over half a year [M].
- **Catalog.** `@slackwater/engine` defines 405 constituents, built from the IHO register with NOAA's, TICON's and Kartverket's additions. About 317 are distinct lines separable over 19 years [M]. A line the catalog lacks can be defined from Doodson numbers or from its parents.
- **Selection.** Candidates are taken in list order. One is dropped if it sits within one cycle over the record of a candidate already kept, then all survivors are fitted together and any with a power ratio under 2 are dropped in one pass. That threshold is the 37% case above, to be confirmed against the engine's definition of its variance. Where two names share a speed, list order decides which is kept: nothing in the data is consulted.
- **No safeguards for a long list.** The fit has no condition-number check, no pivoting and no regularization, and the cut is not stepwise, so weak collinear candidates can lower each other's ratios [M].
- **Cost.** A 19-year fit takes 108 s with 79 candidates and 271 s with 138 [M]. Extrapolated between linear and quadratic growth, 300 candidates would take 7 to 30 minutes.
- **Consumers.** The published files carry any number of constituents. The XTide export allows 255 across the whole file, and agency constants already use 154 [M]. A reader that does not know a name drops it silently.
- **Agencies' own constants** in slackwater-database use 154 distinct lines; 75 are not among the 79 candidates, most of them Anchorage's compounds [M].

An experiment on 56 gauges offered NOAA's 59 Anchorage compounds after the 79. Over 19 years 49 of 55 gauges improved on held-out years and none worsened: Anchorage by 41.7 mm (20% of its residual), seven Dutch gauges by 8.5 to 20.9 mm, five German Bight gauges by 4.1 to 20.4 mm, and 37 gauges by under 1 mm [M, first run; a rerun after two corrections to the rule comparisons is pending]. It tested no list longer than 138, no gap between the fit and the scored year, and no record under two years.

A separate defect is known: on a record under a year the selection keeps S1, T2, π1 and R2 over K1, S2, P1 and K2, because the smaller neighbor comes first in the list.

## Designs

**A. A fixed list.** The 79, or the 79 with a set of compounds. Simple, and comparable with agencies' constants. With the short list it fails estuaries. With a long one it carries noise lines at open coasts, cheaply on long records and less cheaply on short ones, and it still names shared-frequency lines by list order.

**B. A large candidate list with a per-gauge selection rule that has been validated.** Candidates are every distinct line the catalog can supply, and perhaps generated compounds beyond it. Selection combines separation, a threshold corrected for the number of candidates and for colored noise, and stability across yearly fits. This is what Rijkswaterstaat did at Hoek van Holland and what Parker recommends. Its risks are false positives from testing hundreds of candidates, and a ranking for inseparable neighbors that has no basis for compounds. No validation across many gauges is published.

**C. Lists tiered by record length.** Rijkswaterstaat's and NOC's practice. It follows the separation rule and ignores the site, so it is too strict at a quiet gauge and too lax at a noisy one.

**D. A regularized fit.** Every candidate is fitted with a penalty or a prior scaled to its expected size, which handles near-collinear lines smoothly. Shrinkage biases amplitudes low, which is Parker's lost-energy concern, and the one careful comparison found no gain over ordinary least squares for coherent, low-noise records (Kachelein et al. 2022) [P].

**E. Another method where the residual is not stationary.** For the Elbe, Weser, Gironde and river gauges, lines added to a stationary model cannot follow a tide that river flow modulates. The roadmap's HRoI track is this for German and Dutch gauges. It complements any of A to D and replaces none.

Two questions cut across the designs: how a shared-frequency line gets its name, and whether a 19-year fit should resolve nodal satellites directly where the formulas are known to be wrong.

## Experiment

The experiment that would choose is, as far as this survey found, unpublished work.

- **Gauges.** Stratified by class: open coast, shelf, estuary, river. Several hundred, not 56, drawn from the sources with long final records.
- **Record lengths.** 0.5, 1, 2, 4, 10 and 19 years, made by truncating long records, so each rule is scored where it is weakest.
- **Scoring.** Fit on years before a cutoff and score each of several later years, at gaps of one to five years, so a gain that fades is seen to fade. Report paired differences per gauge, the residual within each tidal species, the times and heights of high and low water, and the spread of each constant across disjoint windows.
- **Arms.** The 79; the 79 with NOAA's 59; every separable catalog line under thresholds of 2, 4 and 6 with and without a stability filter; stepwise selection under the Akaike and Bayesian criteria; a regularized fit; lists tiered by record length. The robust weights are a factor in each arm, since they change the error estimate every threshold rests on.
- **Synthetic check.** Inject known lines into real residuals to measure each rule's false-positive and false-negative rates directly.
- **Prerequisites in the fit.** A condition-number diagnostic, a stepwise cut, and the fix for the selection order on short records, each of which stands on its own merits.

## Not established

- The names in SHOM's 143 and how they were chosen. The MAS documentation is internal.
- Any derivation of Rijkswaterstaat's 94. hatyan credits correspondence with Koos Doekes, which was not found.
- UKHO's count or rule. The Admiralty Manual of Tides was not read.
- What CHS fits per station today; BoM's 112 and its rule; DMI's count; Kartverket's software, threshold and nodal handling.
- Why NOAA lists 120 at Anchorage against the 114 its manual gives.
- Whether any selection rule beats a long fixed list on held-out years once record length is accounted for.
- How wrong compound nodal corrections are in practice, and whether fitting satellites directly does better.
- Richet et al. (2026) and Rossiter and Lennon (1968) were read in abstract or excerpt only, and Munk and Hasselmann (1964) through Parker's and Codiga's accounts.

## Agency sources

- **NOAA.** [The tide-predicting machine](https://tidesandcurrents.noaa.gov/predmach.html) and its 37 constituents. [Parker (2007)](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), §4.1.5 and Appendix A. [Zetler and Cummings (1967)](https://elischolar.library.yale.edu/journal_of_marine_research/1089/), read in full. Station counts from the CO-OPS harmonic constants API on 2026-11-27.
- **UK.** [TASK-2000's documentation](https://psmsl.org/train_and_info/software/task2k.rtf). [NOC Research and Consultancy Report 62](https://nora.nerc.ac.uk/id/eprint/519017/1/NOC_R%26C_62.pdf), appendix C. [UKHO's algorithmic transparency record](https://www.gov.uk/algorithmic-transparency-records/ukho-tidal-harmonic-analysis-and-prediction).
- **SHOM.** [The 2024 tide prediction fact sheet](https://refmar.shom.fr/sites/default/files/fiches_data/Fiche_Prediction_maree_mai_2024.pdf). [Pouvreau (2008)](https://www.sonel.org/IMG/pdf/ThesePOUVREAU.pdf), §1.3.2.2, for the 143, the 541 and Brest's 182. [Simon, Coastal Tides](https://iho.int/iho_pubs/CB/C-33/C-33_maree_simon_en.pdf), for species concordance. The 105 above 1 mm at Brest is from [IMCCE](https://promenade.imcce.fr/fr/pages5/525.html) [S].
- **Rijkswaterstaat.** [hatyan](https://github.com/Deltares/hatyan), `get_const_list_hatyan` and its user manual. [Pasmanter (1979)](https://open.rijkswaterstaat.nl/publish/pages/80887/79-fa-001.pdf) on Vlissingen. [The 1984 Hoek van Holland study](https://open.rijkswaterstaat.nl/publish/pages/83835/760086.pdf).
- **BSH.** [Boesch and Müller-Navarra (2019)](https://doi.org/10.5194/os-15-1363-2019).
- **Kartverket.** [The tide API's protocol](https://vannstand.kartverket.no/API%20for%20water%20level%20and%20tides%20-%20communication%20protocol_revJune2025.pdf) and [report 19-04811-3](https://www.kartverket.no/globalassets/forskning-og-utvikling/rapporter/felles-referanseramme-fase2.pdf), §2.
- **CHS.** [Foreman (1977, revised 2004)](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf).
- **Australia.** The Australian Tides Manual SP9, version 6.0 (2021), §3.3.
- **Japan.** [JMA's explanation of its predictions](https://www.data.jma.go.jp/kaiyou/db/tide/suisan/explanation.html) and [Ino and Tsuchiya (2022)](https://www1.kaiho.mlit.go.jp/kenkyu/report/rhr60/rhr60_r_01.pdf).
- **LINZ.** [Analysis and prediction of tides](https://www.linz.govt.nz/guidance/marine-information/tides/analysis-and-prediction-tides).
- **DMI.** [Its 2022 note on tide tables](https://www.dmi.dk/nyheder/2022/tidevand-for-danmark-groenland-og-faeroeerne-frem-til-2023).
- **IHO.** [The standard list of tidal constituents](https://iho.int/mtg_docs/com_wg/IHOTC/IHOTC_Misc/TWCWG_Constituent_list.pdf), updated 2017.

## Other references

- Amin, M. (1976). [The fine resolution of tidal harmonics](https://doi.org/10.1111/j.1365-246X.1976.tb03658.x). Geophys. J. R. astr. Soc. 44, 293–310.
- Codiga, D. L. (2011). [Unified tidal analysis and prediction using the UTide Matlab functions](https://www.po.gso.uri.edu/~codiga/utide/2011Codiga-UTide-Report.pdf).
- Hartmann, T. and Wenzel, H.-G. (1995). [The HW95 tidal potential catalogue](https://doi.org/10.1029/95GL03324). Geophys. Res. Lett. 22, 3553–3556.
- Hibbert, A. et al. (2015). [An empirical approach to improving tidal predictions using recent real-time tide gauge data](https://doi.org/10.1080/1755876X.2015.1014641). J. Oper. Oceanogr. 8, 40–51.
- Munk, W., Zetler, B. and Groves, G. W. (1965). [Tidal cusps](https://doi.org/10.1111/j.1365-246X.1965.tb03062.x). Geophys. J. R. astr. Soc. 10, 211–219.
- Pawlowicz, R., Beardsley, B. and Lentz, S. (2002). [Classical tidal harmonic analysis including error estimates in MATLAB using T_TIDE](<https://doi.org/10.1016/S0098-3004(02)00013-4>). Comput. Geosci. 28, 929–937.
- Pugh, D. T. (1987). Tides, Surges and Mean Sea-Level, §4.2.5.
- Richet, O. et al. (2026). [What makes a good tide prediction? A comprehensive study along the Australian coastline](https://doi.org/10.1080/1755876X.2026.2631282). J. Oper. Oceanogr. 19, 11–29.
- Rossiter, J. R. and Lennon, G. W. (1968). [An intensive analysis of shallow water tides](https://doi.org/10.1111/j.1365-246X.1968.tb00223.x). Geophys. J. R. astr. Soc. 16, 275–293.
