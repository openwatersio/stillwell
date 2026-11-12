# NOAA CO-OPS data flags and verification process (web documentation)

## Citations

- NOAA CO-OPS. The Data API Response Help. https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html (read 2026-11-11).
- NOAA NOS CO-OPS. NOAA Water Levels for Coastal, Estuaries and Great Lakes regions. NOAA Fisheries InPort metadata record 64567, updated 2026-08-19. https://www.fisheries.noaa.gov/inport/item/64567/full-list
- CO-OPS ERDDAP dataset metadata for verified and raw water level, for example https://opendap.co-ops.nos.noaa.gov/erddap/info/IOOS_SixMin_Verified_Water_Level/index.html

## License and local copy

U.S. Government web pages, public domain. No PDF (web pages only).

## Flags in delivered data (API Response Help)

Preliminary (real-time) six-minute water level, field `f`, "in order of listing":

- (O) "Count of number of 1 second samples that fall outside a 3-sigma band about the mean"
- (F) "A flag that when set to 1 indicates that the flat tolerance limit was exceeded"
- (R) "A flag that when set to 1 indicates that the rate of change tolerance limit was exceeded"
- (L) "A flag that when set to 1 indicates that either the maximum or minimum expected water level height limit was exceeded"
- Field `s`: "Standard deviation of 1 second samples used to compute the water level height"
- Field `q`: "Quality Assurance/Quality Control level -- p = preliminary -- v = verified"

Verified six-minute water level, field `f`: (I) "the water level value has been inferred", (F) flat tolerance, (R) rate of change tolerance, (T) "either the maximum or minimum expected water level height limit was exceeded" (the help page labels this flag T for verified data and L for preliminary).

Hourly heights, high/low, daily mean: (I) inferred and (L) limit.

These are the same 0/1 flags specified in NOS CO-OPS 030: limit = station max/min tolerance ±3 m, flat = value equal to two before and two after, rate of change = third-difference (030) or first-difference (061) tolerance. The help page does not give threshold values.

## Verification (InPort record 64567)

- "Raw data have not been subjected to the National Ocean Service's (NOS) quality control or quality assurance procedures"; "Verified data have been subjected to the NOS quality control or quality assurance procedures".
- "Processing and verifying CO-OPS water level data is a two-person process." "Each month, an analyst reviews a station's data (filling data gaps, removing erroneous spikes, etc.)" for the previous calendar month; a second person confirms the work and "marks the data in the database as 'verified.'"
- "In most cases, the raw 6-minute data points end up becoming the verified 6-minute data, minus spikes and gaps."
- Stations are processed "in random order" each month.

## Not verified

The internal CO-OPS SOP for tidal water level data processing (SOP #7.3.A.2.2, cited in NOS CO-OPS 061) is not public. Exact per-station flat, rate-of-change and limit tolerances are not published in these pages.
