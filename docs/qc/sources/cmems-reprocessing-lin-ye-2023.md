# Delayed-mode reprocessing of Copernicus Marine tide gauge data (Lin-Ye et al. 2023)

## Citation

Lin-Ye, J., Pérez Gómez, B., Gallardo, A., Manzano, F., de Alfonso, M., Bradshaw, E., and Hibbert, A., 2023, Delayed-mode reprocessing of in situ sea level data for the Copernicus Marine Service, Ocean Science, 19, 1743 to 1751.

- DOI: https://doi.org/10.5194/os-19-1743-2023
- Product: https://doi.org/10.48670/moi-00307 (INSITU_GLO_PHY_SSH_DISCRETE_MY_013_053)

## License and local copy

CC BY 4.0 (p. 1743). PDF included: [pdf/cmems-reprocessing-lin-ye-2023.pdf](pdf/cmems-reprocessing-lin-ye-2023.pdf) (3.3 MB).

## What it is

The paper describing the Copernicus Marine In Situ TAC delayed-mode (reprocessed) tide gauge product and the upgraded SELENE QC software from Puertos del Estado. It is included here for its multi-station (buddy) check, its residual-based checks, and its comparison of near-real-time and delayed-mode flagging. The Copernicus near-real-time QC manual itself is outside this note.

## Near-real-time versus delayed mode (sections 3 and 4, pp. 1745 to 1746)

Near-real-time QC runs every 15 minutes on "a short moving time window (a few days)" and applies IOC level 1 checks: out-of-range, spike, and stability (stuck) tests. Short gaps up to 27 minutes are interpolated in an intermediate 5-minute series before a Pugh filter makes hourly values. The delayed-mode product (first released November 2022, data to December 2020, 639 stations, records under 1 year excluded) adds tests and "visual inspection of the whole time series by an expert." Result: "the reprocessing flags 1.9 % of the sea level data as bad or dubious data, whereas the NRT automated quality control flagged about 0.3 %." Where a national provider already reprocessed its data, "the original flagging is assumed to be correct," with further checks run by default.

## Residual-based QC (pp. 1746 to 1747)

"The de-tided sea level observations facilitate quality controlling since tidal variations often dominate a sea level record, making subtle errors more difficult to detect. On the contrary, bad data can easily present as abrupt changes in the non-tidal residual while being told apart from the real extreme surges, which evolve more gradually." Tides are computed with UTide. Yearly constants are computed only for years where gaps longer than half a week add up to less than a month and log10(max monthly M2 amplitude / min monthly M2 amplitude) ≤ 0.7. Otherwise constants are borrowed from up to 3 years before or after. "Other issues detectable with de-tided sea levels are clock malfunction and datum changes when combined with visual inspection."

## Buddy checking (p. 1747)

"A new module added to the SELENE software is the buddy checking, applied to hourly de-tided sea levels and monthly mean sea levels. It has been implemented to compare the target station to neighbouring stations within a range of 0.01° (approximately 1 km)." The radius is very small; the paper does not say what statistic or threshold decides a failure.

## Other checks and thresholds (p. 1747)

- Range limits: mean water level plus or minus the 99th percentile of total sea level over the whole series; the same for de-tided levels with mean set to zero.
- Spikes: second-degree polynomial fit in a moving window, maximum standard deviation for non-spikes equal to 3; the de-tided window is twice the total-level window. In delayed mode the spike search only starts where the step at time t exceeds 100 mm and exceeds a fraction of the series range |slevmax − slevmin| (the formula involves the constants 1/50 and 3, but its exact form did not survive text extraction and is unverified; see p. 1747 of the PDF).
- Stuck values: "data that keep being constant for an abnormally long time." The limit "starts with 10 points" and is relaxed for centimeter-precision data or when more than 50% of a series is flagged as stuck, "commonplace for older tide gauges"; series can be classed as having "many stuck" or "too many stuck" (details in the Product User Manual).
- Attenuated data: a new test to tell attenuation (oscillation around a level far from the mean) from neap tides (centered on the mean).
- In the earlier NRT sensitivity test on 1-minute Puertos del Estado data, the best settings were a 200-point window with maximum standard deviation 4 for total levels, a 500-point window with 5 for de-tided levels, and a stuck limit of 10 points (p. 1745).

## Planned (p. 1748)

Comparing monthly mean sea levels with altimetry and a feasibility study of GNSS-based vertical land motion corrections.

## Errors found

Spikes, stuck values, attenuation, and (with visual inspection of residuals) clock malfunction and datum changes; buddy checks against co-located gauges.
