# UHSLC Joint Archive for Sea Level: comparative checks in the station quality assessments

## Citation

Caldwell, P.C., Merrifield, M.A., and Thompson, P.R., 2001 (continuously updated), Sea level measured by tide gauges from global oceans as part of the Joint Archive for Sea Level (JASL) since 1846, NOAA National Centers for Environmental Information, dataset.

- DOI: https://doi.org/10.7289/v5v40s7w
- NCEI metadata page: https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.nodc%3AJIMAR-JASL

Station quality assessment files read (one per record, "QUALITY ASSESSMENT OF SEA LEVEL DATA by the UH SEA LEVEL CENTER/NATIONAL OCEANOGRAPHIC DATA CENTER JOINT ARCHIVE FOR SEA LEVEL"):

- Quepos-A, Costa Rica (087A): https://uhslc.soest.hawaii.edu/rqds/pacific/doc/qa087a.dmt
- Pago Pago, American Samoa (056A), updated 28 Aug 2020: https://uhslc.soest.hawaii.edu/rqds/pacific/doc/qa056a.dmt
- Paita-B, Peru (678B), updated 15 Jun 2017: https://uhslc.soest.hawaii.edu/rqds/pacific/doc/qa678b.dmt
- Cilacap-A, Indonesia (162A), updated 3 Jun 2005: https://uhslc.soest.hawaii.edu/rqds/indian/doc/qa162a.dmt
- Las Palmas-C, Canary Islands (217C): https://uhslc.soest.hawaii.edu/rqds/atlantic/doc/qa217c.dmt

This note covers only what these documents show about comparison with other information. UHSLC's general processing and QC software are outside its scope.

## License and local copy

NCEI lists the dataset as partly CC BY 4.0 and partly CC0. The quality assessment files are plain text web documents with no separate license. No PDF; links only.

## Stated policy (NCEI metadata, Description)

"The data are inspected and obvious errors such as data spikes and time shifts are corrected. Gaps less than 25 hours are interpolated. Reference level problems are referred back to the originator. If the originators can not resolve the reference level shift, comparisons with neighboring sites or examination of the hourly residuals may warrant an adjustment. Descriptive station information and quality assessments are prepared."

So the split is: timing shifts and spikes are fixed by JASL; datum (reference level) problems go first to the operator, and only then are adjusted by JASL using neighbors and residuals.

## Methods seen in the station assessments

Two comparisons recur, almost always together:

- Hourly residuals (observed minus tidal prediction): reference level shifts appear as step changes. Quepos-A: "All suspected shifts showed step function jumps in the plots of hourly residuals and of differences of daily values with the nearest stations."
- Differences of daily values with the nearest stations. Paita-B: shifts "were adjusted based on examination of residuals and daily data of neighboring sites." Pago Pago: "Reference level corrections based on analysis of residuals, daily values, and comparisons with neighboring stations were applied," and "The daily and monthly means in comparison with neighboring sites suggest the calibration to a fixed datum has been successful."

Paita-B also compares with satellite altimetry: "Difference with AVISO altimeter suggest 2001-2005 is ~10 cm high."

The files name the neighbors used (Paita-B: La Libertad, Lobos, and Callao) but state no distance limit and no numeric threshold for declaring a shift.

## Corrections and their stated uncertainty

Adjustments are listed as an amount in mm added to the original values over a period given to the hour. Examples:

- Quepos-A: nine segments with corrections from -180 to +260 mm; "These adjustments contain uncertainty to a few centimeters." The analog gauge "showed many distinct shifts at the beginning of some months," and "the long-term reference level stability is uncertain."
- Paita-B: -575 mm (14 to 31 Aug 1990) and +100 mm (9 Jan to 2 Feb 1997), "uncertain to a few cm." Neighbor differences suggest parts of 1988 are about 10 cm low and high; these are noted but not corrected.
- Pago Pago: -50 mm (Feb 1975) and -100 mm (Aug 1993 to Dec 1994).
- Cilacap-A: periods with an unstable reference level (1991 to 1992, 1998 to 2002) "were removed from the JASL series," and "The mean level of 2003-2004 was estimated to be low based on comparisons with the nearest stations. A temporary correction was made."

When two segments cannot be tied to one zero, they become separate records: "087A is separate from 087B because they are not related to the same reference level zero"; "Series 678B has not been linked to 678A which has a mean level about 30 cm lower."

## Telling a real change from an instrument problem

Las Palmas-C shows "a downward trend of about 21 cm per year ... from 1985-1988. No obvious step-function jumps could be identified in plots of hourly residuals and the decrease appears to be gradual for the most part. Plots of the detrended daily and monthly data for 1985-1988 show a realistic signature. Historic monthly data for stations in the Canary Islands show similar trends." The neighbor agreement is the evidence used to keep the trend.

## Timing errors

Timing problems are recorded in the comments, usually with a size: Quepos-A, "Severe timing errors associated with gauge problems occurred from Sep - Nov 1985. The timing has an uncertainty of about +/- 7 minutes"; Las Palmas-C, "Timing drifts of about 7 to 20 minutes occur off and on"; Cilacap-A, "Large gaps and timing errors are frequent." The files read do not say how timing errors were detected. Residual noise is also noted as a quality signal: Quepos-A, "The hourly residuals of the ADR data show considerable noise; thus the hourly ADR data are of less quality than the daily or monthly ADR data"; Cilacap-A, "Unknown source of high frequency noise is seen in the residuals."

## Per-year table

Each file ends with a yearly table: completeness index (percent), missing days, "replaced gaps or bad data" (hour and day ranges), and "questionable fluctuations" (days). Replaced and interpolated stretches are therefore listed separately from questionable ones.

## Not covered

No distance rule for neighbors, no numeric step or timing thresholds, and no description of how timing errors are found. See [pan-2025-timing-errors.md](pan-2025-timing-errors.md) and [thompson-2025-timing-errors-reply.md](thompson-2025-timing-errors-reply.md) for a published dispute about undetected timing errors in this dataset.
