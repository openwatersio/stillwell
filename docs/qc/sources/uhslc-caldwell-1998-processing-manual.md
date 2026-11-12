# UHSLC: Sea Level Data Processing on IBM-PC Compatible Computers, Version 3.0 (Caldwell 1998)

## Citation

Caldwell, P., 1998. Sea Level Data Processing On IBM-PC Compatible Computers, Version 3.0 (Year 2000 Compliant). Joint Archive for Sea Level of the National Oceanographic Data Center and University of Hawaii Sea Level Center. JIMAR Contribution No. 98-319, December 28, 1998. Report pursuant to NOAA Award No. NA67RJ0154. About 80 pp.

- Manual (PostScript): https://ftp.soest.hawaii.edu/caldwell/sealev/software/slman2.ps
- Announcement: https://ftp.soest.hawaii.edu/caldwell/sealev/software/slread2.me
- Version history: https://ftp.soest.hawaii.edu/caldwell/sealev/software/ver3hist.txt

The package (SLPR2) is the "UHSLC package" referenced by IOC Manual 14 Volumes III and V and IOC MG 83. IOC Volume V (2016) says it was later updated for 64-bit Windows and Linux; that update was not found. IOC MG 83 (2020) says UHSLC has since adopted UTide for delayed-mode QC.

## License and local copy

University of Hawaii report under a NOAA award; no license statement found. Not a PDF and not included; link only. Text was read by extracting strings from the PostScript file as data (it was not rendered), so equations and figures were not seen.

## QC method (chapter 5, pp. 18-29)

"Quality control ensures the scientific validity of the data. Three main aspects are emphasized: 1) the linking of the data to a reference level (tidal datum), 2) the inspection of the timing quality, and 3) the replacement of short gaps and spikes." Work is on hourly data, interactive and visual. Original files must be preserved and a log of edits kept.

- 5.1 Hourly residuals: "The basis of quality control is the inspection of residuals, defined as observed data minus predicted tides" (Foreman tidal analysis). Residual plots are inspected year by year. Where tides are highly non-linear ("shallow waters, influence of rivers or estuaries, or complex basin configurations") unresolved tidal species remain in the residuals and "quality control is limited at this site. Only grossly extreme spikes in the residuals could potentially be identified." Refresh harmonic constants from a time span close to the year under review.
- 5.2 Reference level stability: monthly tide staff versus gauge pairs (scatter plot, slope near 1; random scatter suggests a clogged well; an offset suggests a reset gauge zero). Monthly calibration constants are logged but not applied month to month; one value is assigned per period between technical visits unless there is a clear cause. "As a rule of thumb, for float/well analog and punched paper type gauges, the UHSLC considers changes greater than 0.05 feet (1.5 cm) as significant and worthy of an investigation into the level stability." Shifts are located in residual plots and in differences of daily or monthly values with nearby stations or redundant sensors; UHSLC switch data are mentioned as an automated calibration aid.
- 5.3 Timing errors: appear "in the plot of residuals as periodic fluctuations". Magnitude found by comparing residual and observed peaks or observed and predicted peaks; the package shifts only in whole hours. Start and end hours of a shifted period are set to missing and later interpolated. Small drifting clock errors that cannot be corrected are noted in the station documentation.
- 5.4 Short gaps and spikes: best fill is quality-controlled data from an auxiliary gauge on the same datum; otherwise the "predicted tide method": shift predictions to match the observed timing, linearly interpolate the residual across the gap, and add it to the prediction. "The UHSLC recommends using this procedure only for gaps less than or equal to 24 hours." Interpolated gaps longer than six hours are listed in the station documentation. Missing values are 9999.

## Flags

No flag scheme. UHSLC research quality data are corrected (shifted, interpolated, re-levelled) rather than flagged, with changes documented, and missing values set to 9999.
