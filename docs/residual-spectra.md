# What a fit's residual spectrum says

Two questions about fitting more constituents only where a gauge needs them, measured on 56 gauges: whether the spectrum of a fit's residual tells which gauges gain from shallow-water compounds, and what the residual still holds once they are fitted. The tables, the method and six gauges' spectra are in [results/residual-spectra.md](results/residual-spectra.md), which `scripts/residual-spectra.ts` writes. Every figure on this page is from those tables as the run of engine 1.0.0-beta.15 wrote them, with 2023 to 2025 held out for NOAA's gauges and 2022 to 2024 for the others; most are in the "Totals" list. This page states what they show. It proposes no list and no rule.

Each gauge is fitted with the 79 candidates, and again with NOAA's 59 Anchorage compounds offered after them, over the 2, 5 and 19 years before three held-out years. The spectra are of observed minus predicted over the held-out years. A gauge "gains" where the compounds take 1 mm or more off the held-out residual's RMS: 18 of the 55 gauges with a 19-year fit do.

## Whether the residual tells which gauges gain

It does, on these gauges. The measure is the energy of the lines that stand above the continuum in the third-diurnal and higher species of the residual of the 79-candidate fit, given as its square root.

| Fit      | Cut     | Gaining gauges above it | False alarms | Wrong when each gauge is sorted by the others' cut |
| -------- | ------- | ----------------------- | ------------ | -------------------------------------------------- |
| 19 years | 10.2 mm | 18 of 18                | none         | 2                                                  |
| 5 years  | 9.8 mm  | 17 of 17                | 2            | 4                                                  |
| 2 years  | 10.8 mm | 16 of 16                | 1            | 3                                                  |

Counting only lines that lie beside no constituent the fit already holds, the 19-year cut is 9.8 mm with no gauge wrong, none wrong when left out, and none wrong when each agency's gauges are sorted by the cut the other three set. It is less steady from year to year than the measure above: four gauges change sides with the held-out year, against two.

Attempts to break it:

- **Shorter fits.** The 19-year cut applied to the 5-year and 2-year fits finds every gauge that gains, with Boston and Charleston as false alarms at 5 years and Narvik added at 2. Boston gains 1.07 mm from a 19-year fit and under 1 mm from the shorter ones, so it sits on the line by either count.
- **A year the gain doesn't share.** The measure and the gain above come from the same three years. Read from one held-out year alone, at a third of the resolution, the measure still sorts the gain over the later years: 17 of 17 with Boston as a false alarm for 19-year fits, and 16 of 16 with none for 2-year fits.
- **Another bar for gaining.** At 2 mm it finds 14 of 14 with no false alarm. At 0.5 mm it finds 26 of 28 with one false alarm.
- **Year to year.** At a few gauges near the cut the side changes with the held-out year: The Battery and Trondheim for 19-year fits, and Boston, Narvik and Stavanger for 2-year fits.

The measure is a scale and not a switch. Its rank correlation with the gain is 0.97, and the gauges on either side of the cut are close: The Battery at 9.2 mm gains 0.52 mm, Narvik at 10.3 mm gains 1.21 mm. The millimeter that defines "gains" is what places the cut.

Measures that don't sort the gauges: M4 over M2, the size of the fitted tide, and line energy in the diurnal band, where the gauges that gain score lower for 19-year and 5-year fits. The number of lines in the higher species sorts them less well, finding 15 of 18 with two false alarms, and so does all the energy there without the continuum taken out, which misses Eastport, Boston and Stavanger.

One measure needs no spectrum and comes close: the amplitudes the 79 candidates already fit in the third-diurnal and higher species. At 42.8 mm it finds 16 of 18, missing Boston and Stavanger, with Trondheim as a false alarm. It is less steady than the line energy: 7 gauges are wrong when each is sorted by the others' cut, against 2. The size of the residual finds 15 of 18.

## What is left after the compounds

Three things, which the spectra keep apart as [Zetler and Cummings (1967)](https://elischolar.library.yale.edu/journal_of_marine_research/1089/) kept the peaks from the energy between the line groups.

**Lines beside no fitted constituent.** The gauges that gain keep a median of 19.5 such lines with the compounds fitted (4 to 192), down from 54. The other gauges have a median of 3, and 8 of 37 have none. Removing every one exactly would take 1 mm or more off the residual at seven gauges: Anchorage (20.5 mm), Hamburg (5.6), Delfzijl (4.1), Rilland Bath (1.4), Philadelphia, Vlissingen and Hoek van Holland (1.3 each). At the open-coast controls Honolulu has no such line and San Diego has five, worth 0.2 mm. The same lines recur across the gauges that gain: one at 86.872°/h (the catalog's 3MSK6) at 14 of the 18, up to 21 mm, and others the catalog calls 3MSK10, 4MNS8, M12, 4MSK12, 2SML8 and 2(MN)S6. Anchorage's largest is at 43.009°/h (2MP3), 29 mm. Of the 598 such lines at the gauges that gain, 301 have a catalog line within a bin, 190 match only a combination built from six parents, and 107 match nothing.

**Lines beside a fitted constituent.** These hold more energy than the first kind: over the gauges that gain, 70 mm against 27 mm in the semidiurnal and higher species. Three years can't separate a constituent from a neighbor one or two perigee cycles away, so the 19 fitted years were read again at six gauges. They show three different things:

- _Lines the fit lacks._ The observed levels hold a line at 27.886°/h, 0.009°/h below 2N2, at all five gauges with a large tide: 56 mm at Anchorage, 41 at Cuxhaven, 40 at Delfzijl, 19 at Eastport and 15 at Philadelphia, where the prediction has 0 to 9 mm. The catalog names it 2MK2. The same holds 0.009°/h below N4, 2NM6, 2NMK7 and 2NS2 (the catalog's 3MK4, 4MK6, 4MK7 and 3M(SK)2): 3MK4 at three of the gauges, 4MK7 and 3M(SK)2 at two, and 4MK6 at Anchorage. A fit of 4.4 years or more can separate each from its neighbor.
- _Lines the prediction adds._ At 29.5375°/h, 0.009°/h above L2, the prediction holds 18 to 46 mm at those five gauges and the observed levels 2 to 9 mm. A prediction from L2's constant alone holds 18 to 47 mm there, so it is L2's nodal correction that carries the line and not 3L2, which the fit also holds and which lies nearer. The observed line has no such satellite. [Parker (2007)](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf) describes the cause: 2MN2 shares L2's frequency with a different node factor, and "use of the L2 node factor for (in reality) the 2MN2 constituent can lead to the effect of this constituent being doubled or halved in predictions for other years" (§2.3.2). At Anchorage five compounds with L2 as a parent (MLN2S2, 2MLNS6, MSL6, 2NMLS6 and SL4) have a predicted line above them that the levels lack, and MSL6 has one at Cuxhaven. Three others at Anchorage (2ML6, 2MLS4 and 3MLS6) have a line in both. What puts those there was not isolated.
- _The constituent itself._ For M2 at all five gauges, and for S2, K1, M4 and M6 at some, the largest residual is at the constituent's own frequency, 16 to 31 mm for M2. Its size or phase over the fitted years is not what its constants say. A satellite a node cycle away falls in the same bins at this resolution, so whether the nodal correction or a change over the years is behind it is not shown.

**A broad rise with no lines.** Around the line groups of the even species the continuum rises above its level between the species. Over the gauges that gain, the rise in the semidiurnal and higher species is 60 mm against a floor of 52 mm, and over the other gauges 13 mm against 17 mm. The compounds lower it from 64 mm. The eighth-diurnal band loses more than half its rise energy (13.6 to 9.0 mm) and the semidiurnal band, which holds most of the rise, a fourteenth of its (50.7 to 48.9 mm). So part of what reads as rise is lines too small or too close together to stand over the bar. What the rest is was not tested. [Munk, Zetler and Groves (1965)](https://doi.org/10.1111/j.1365-246X.1965.tb03062.x) describe such a rise around the main lines as the tide's interaction with the slow continuum, which would not recur at a fixed frequency and which no constituent would take up.

Of the energy above the floor at the gauges that gain, 39% is the rise, 53% is lines beside a fitted constituent and 8% is lines beside none. At the other gauges the shares are 82%, 15% and 3%.

So the answer is both. Lines stand over the continuum that lists longer than the 59 could name at Anchorage, Hamburg and Delfzijl, worth at most the figures above if they keep their phase, and a millimeter or so at the Scheldt and Rhine gauges and Philadelphia. The K2 compounds beside fitted constituents are on top of that and are not in those figures. The L2 lines are a naming question and not a longer list. The rise is two fifths of the energy above the floor at the gauges that gain, and the semidiurnal part of it was all but untouched by 59 more lines.

## Not established

What the measurement does not show:

- **Whether the lines left would predict.** A line in three years' residual is not shown to keep its phase. No year-to-year stability test was run, which [Parker](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf) prefers to variance as the test (§4.4). "More to gain" is an upper bound.
- **A cut for other gauges.** The measure reported is the best of 17 tried, and each cut is the one that sorts these same gauges best. Sorting each gauge by the others' cut, and each agency's by the other agencies', are the only checks on that. 18 gauges gain, from four coasts: 4 of NOAA's, 2 of Kartverket's, the 7 Dutch and the 5 German. The gauges nearest the bar are Tromsø, at 0.98 mm of gain, and Boston, at 1.07 mm.
- **What the lines are.** Names are the nearest within one bin of 0.0137°/h. 48% of all bins lie within a bin of some catalog or built line, so a built name alone is weak evidence.
- **The trigger from the years a fit read.** Everything in the first section is from held-out years, so a fit that used the trigger would have to set years aside. The residual of the fitted years was not tried as the trigger.
- **Other settings.** The continuum's window (0.04 cycles per day for three years, 0.08 for one), the taper and the bar were not varied. The bar is set on white noise without gaps. Inside a rise the continuum changes within the window, and a record with a year missing has a wider taper response, so lines in either may be over-called or under-called.
- **Above 12 cycles per day.** The values are hourly, so the twelfth species is half a band and anything faster folds back into the spectrum.
- **Gauges with a year missing.** Six of the seven Dutch gauges have two held-out years with half their hours, and Rilland Bath has 47% of its held-out hours. The store holds their 2022 values as preliminary, and the fits and scores read final values only, so the year is a gap. The spectra there leak more through the gap, which the line test allows for.
- **The fitted-years view.** It covers six gauges and the years the fit read, so it shows what the constants hold and lack and not how they predict.
