# Digitization and timing errors in tidal constants at Split (Vilibić 2006)

## Citation

Vilibić, I., 2006, The influence of digitisation and timing errors on the estimation of tidal components at Split (Adriatic Sea), Annales Geophysicae, 24, 1483 to 1491.

- DOI: https://doi.org/10.5194/angeo-24-1483-2006
- Article page: https://angeo.copernicus.org/articles/24/1483/2006/

## License and local copy

"© European Geosciences Union 2006." No Creative Commons license is printed on the article, so the PDF is not included; link only.

## What it is

A long-record study of one chart-recorder gauge (Split, 1957 to 2001, hourly values digitized from weekly charts) that uses year-by-year harmonic analysis to find timing errors, and simulations to show what clock drift and clock shift do to tidal constants and residuals.

## Method: annual tidal constants as a long-record check (sections 2 and 3.1, pp. 1484 to 1486)

Harmonic constants for seven constituents (M2, S2, K2, N2, K1, O1, P1) were computed for each year with the TASK package and compared across years and across periods with different chart handling and digitizing software. Nodal modulation is handled with nodal factors, so it should not appear in the yearly constants, and no harbor works were reported that could change the tide. The year-to-year changes were "stronger in phases than in amplitudes." Between periods, the M2 amplitude and phase changed by 22% (1.31 cm) and 24.9°, and K1 by 6% (0.50 cm) and 12.7°. "One can suspect that the drift and shift errors occurred at the charts or during the digitising process, as semidiurnal tides are more sensitive to such errors than the diurnal ones, due to their smaller period."

Redigitizing the 1986 to 1995 charts with newer software gave M2 and K1 amplitudes 3 to 4 mm larger and standard deviations 60 to 70% smaller (abstract; p. 1486). In 1995 the two digitizations differ by about 12° in M2 phase and 6° in K1 phase.

## Error types named (section 2, p. 1484)

Operators reported "clock errors (drift in time), wrong positioning of the pen and the broad trace of the pen line when replacing charts (shift in time), and ... the elongation of the charts due to different atmospheric conditions (drift in time)." Vertical shift and the tide gauge constant were checked every year, so the problems are mainly in time.

## Simulations (section 3.2, pp. 1486 to 1488)

Two synthetic error types were applied to weekly segments, reset every 4 weeks to mimic monthly digitizing: a drift (each week stretched or shrunk by -120 to +120 min) and a shift (each week offset by -120 to +120 min).

- Phase changes much more than amplitude, "almost linearly shifted in the same direction as the constructed time series."
- Drift of ±120 min lowers semidiurnal amplitudes by about 4% (about 3 mm for M2). Shift of ±120 min lowers M2 and S2 by about 10% (8 mm and 5 mm); ±60 min lowers them by 3 to 4%. Diurnal amplitudes change by up to 4% (3 mm for K1).
- N2 under shifts varies from 200% down to 10% of its true value, because of leakage from the much larger M2. P1 grows at the expense of K1 under negative drift because their periods are close.

## What timing errors do to residuals (pp. 1488; conclusions)

With random (variable) drift or shift rates, "the tidal energy is not recognized by the harmonic analysis ... and the remaining residual sea level series has a maximum exactly on the tidal periods (12.42 – M2 tide, 23.83 – K1 tide)." "Artificial errors usually decrease the amplitudes of a tide, as some of the tidal energy is transferred to the residual (de-tided) sea level series." Energy at the M2 period in de-tided series, previously attributed to nonlinear coupling, "may be caused, at least partly, by timing errors."

## Errors found

Clock drift and clock shift (minutes to two hours) in chart-derived hourly data, seen as year-to-year phase jumps and as tidal-band energy left in the residuals.

## Not covered

No neighbor comparison and no automated threshold; the diagnosis is by comparing periods and software versions at one gauge.
