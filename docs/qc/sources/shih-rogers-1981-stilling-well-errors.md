# Error Analysis for Tide Measurement Systems Utilizing Stilling Wells

## Citation

Shih, H. H. and Rogers, D. Error Analysis for Tide Measurement Systems Utilizing Stilling Wells. NOAA Office of Ocean Technology and Engineering Services, March 1981. 121 pp. Cited elsewhere as an unpublished internal report.

- NOAA Institutional Repository: https://repository.library.noaa.gov/view/noaa/50297
- PDF: https://repository.library.noaa.gov/view/noaa/50297/noaa_50297_DS1.pdf (a 2023 scan with an OCR text layer)

## License and local copy

U.S. Government work, public domain. Link only: the scan is 24 MB, over the 10 MB cap. A shorter conference version is in [shih-porter-1981-stilling-well-error-models.md](shih-porter-1981-stilling-well-error-models.md), with its PDF.

## What it says

The report models the errors of NOAA's ADR gauge, a float in a stilling well with an orifice, NOAA's standard tide gauge until the acoustic systems of the 1990s. It is about the instrument, not about QC of the record, and gives no thresholds for flagging values.

- Error sources: wind waves, currents, float response, density difference between the well and the water outside, and marine fouling (executive summary, p. vi).
- Waves both oscillate the level in the well and set its mean down below the level outside; currents across the orifice draw it down further by the Bernoulli effect (p. vi; sections 3.1 and 3.2, pp. 9-29).
- These errors, except float motion, "are systematic and could, depending upon the environmental conditions, produce significant changes in water level inside the stilling well" (p. vi).
- Density: in estuaries and river mouths the well holds a stratified column lighter than the water outside, and the error changes through the tidal cycle (section 3.4, pp. 38-43, with the Columbia River mouth as the example).
- Fouling: growth or silt in the orifice attenuates the recorded tide and delays it, progressively when fouling is gradual; the model reproduces gradual and irregular fouling seen at Indian River (section 3.5, pp. 44-49, figures 29-32).
- Case studies at ten NOAA primary stations on the Atlantic, Gulf and Pacific coasts: the probable total error "could reach up to minus eight inches (below mean tide level)", ranked current, wave, float response, density; fouling is left out "due to its variability and progressive nature" (p. vii; section 4, pp. 50-71). One worked case gives −4.35 ± 2.47 inches at 68.3% confidence (p. 67).

## Relevance to Stillwell

- The errors are biases in the level, not bad values, so per-value QC cannot see them. Only a comparison with a collocated or neighboring gauge, or with levelling, finds them.
- Historical CO-OPS records from float gauges can sit low by centimeters where currents or waves are strong, and the bias can change at the switch to another sensor.
- Fouling has a signature a neighbor or prediction comparison can find: a tidal range that shrinks and a phase that lags more over days to weeks, then recovers when the well is cleaned.
