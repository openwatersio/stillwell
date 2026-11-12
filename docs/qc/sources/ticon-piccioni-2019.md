# TICON: tidal constants from GESLA records (Piccioni et al. 2019, with TICON-3)

## Citation

Piccioni, G., Dettmering, D., Bosch, W., and Seitz, F., 2019, TICON: TIdal CONstants based on GESLA sea-level records from globally located tide gauges, Geoscience Data Journal, 6(2), 97 to 104.

- DOI: https://doi.org/10.1002/gdj3.72
- Copy read: https://archimer.ifremer.fr/doc/00838/94993/102598.pdf (publisher version)

Companion documents read:

- TICON User Manual, version 1.0, November 2018 (Piccioni et al.), attached to the dataset https://doi.org/10.1594/PANGAEA.896587, file https://store.pangaea.de/Publications/Seitz-etal_2018/TICON_userManual.pdf
- Hart-Davis, M., Dettmering, D., and Seitz, F., TICON-3 User Manual, attached to the dataset https://doi.org/10.1594/PANGAEA.951610, file https://download.pangaea.de/reference/116264/attachments/TICON_3_UserManual.pdf

## License and local copy

The paper is open access under the Creative Commons Attribution License (p. 97). PDF included: [pdf/ticon-piccioni-2019.pdf](pdf/ticon-piccioni-2019.pdf) (0.5 MB). The two PANGAEA datasets are CC BY 4.0, but the user manuals carry no license statement of their own, so they are linked only.

## What it is

A table of harmonic constants (40 constituents, amplitude and Greenwich phase lag with standard errors) for each GESLA record. It is not a QC procedure, but it is the main published per-station set of tidal constants from the GESLA compilations, the kind of reference a phase-lag comparison for clock errors would use. The selection rules show how GESLA flags are used downstream.

## How GESLA flags are used (p. 99)

"Only measurements assigned as 'correct' or 'interpolated value' were selected as valid." Interpolated values are kept as valid input to the harmonic analysis.

## Record selection (section 3.1, p. 102)

- Minimum span: the observation period "must be larger than 1 year," based on the Rayleigh criterion for separating constituents. Span is measured after dropping flagged values, since flagged data at the ends shorten a record. 44 records (3.45%) failed this.
- Completeness: "a threshold of 70% of valid observations was set, above which the records are processed for their full length." 87 records failed.
- In total 131 records (10.3%) were dropped; 1,145 remained.

## Harmonic fit (section 3.2, p. 102)

Least squares fit of mean level, a linear trend, and 40 constituents with nodal corrections (IHO 2006 values, Tamura 1987 astronomical arguments), over the full record. Amplitude and phase standard errors come from the regression standard errors, so "for longer time series smaller errors may be computed." The output also lists percent missing data, number of observations, longest gap in days, and first and last dates.

## Comparisons in the 2018 user manual (section 4, pp. 3 to 7 of the manual)

- Against the FES2014 tide model, as RMS and root-sum-square differences over the main constituents (M2, S2, N2, K2, K1, P1, O1, Q1), using 923 gauges not assimilated in FES2014. Larger differences are expected near large rivers, in shelf seas, and where bathymetry or coastline is complex.
- Between "duplicate" records at the same location from different GESLA sources (different periods, providers, or sampling rates), compared for M2 and K1 (Table 8).
- Against an external coastal constants set from Stammer et al. (2014) at Providenya and Newlyn. The manual notes "a slight change of phase lag was observed according to the observation period," and it inferred the external constants dated from about 1986 to 1989 from the phase agreement.

The manual does not state a threshold for calling a difference a problem.

## TICON-3 (TICON-3 manual, sections 1 and 4)

TICON-3 repeats the method on GESLA-3: least squares on every record, removing gauges with less than 70% valid data or less than 1 year of valid data, giving 3,471 gauges. It adds the GESLA-3 gauge type (coastal, river, lake) as a column. Comparing gauges common to TICON and TICON-3, the manual shows mean amplitude and phase changes, larger in places like the northwest of America and the Baltic, which it ties to changes in record length.

## Not covered

No timing-error detection, neighbor comparison, or residual test. The EGU 2022 GESLA-3 abstract (see [gesla3-haigh-2023.md](gesla3-haigh-2023.md)) says DGFI-TUM co-authors applied datum-jump and time-shift adjustments before tidal analysis, but the TICON-3 manual does not describe this.
