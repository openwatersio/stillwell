# Datum steps in British Isles tide gauge records (Hogarth et al. 2020)

## Citation

Hogarth, P., Hughes, C.W., Williams, S.D.P., and Wilson, C., 2020, Improved and extended tide gauge records for the British Isles leading to more consistent estimates of sea level rise and acceleration since 1958, Progress in Oceanography, 184, article 102333.

- DOI: https://doi.org/10.1016/j.pocean.2020.102333
- Copy read: https://nora.nerc.ac.uk/id/eprint/527541/ (publisher version)

## License and local copy

Open access under CC BY 4.0 (stated on p. 1). The PDF is 17 MB, over the 10 MB the folder keeps copies of, so it is linked, not copied. Page numbers below are PDF pages.

## What it is

A step-by-step method for finding and correcting datum steps in about 100 monthly mean sea level records around the British Isles, 1958 to 2018. It combines neighbor differences, model-based removal of weather effects, a regional "common mode," statistical changepoint detection, and archival records of gauge changes. It is the most detailed published workflow found for long-record homogeneity of tide gauges.

## Workflow (section 1, p. 3)

1. Add levelling information and newly found data to the PSMSL Metric records to get an RLR-quality extended set.
2. Buddy check against nearby gauges to show that undetected datum steps are visible and estimate their times.
3. Reduce variability so steps stand out: subtract modeled glacial isostatic adjustment and the local weather response from a tide-surge model (CS3X), then subtract an "Initial Common Mode," the average of all quadratically detrended records.
4. Identify "events": times where a detected step coincides with a documented gauge change or, occasionally, a step found by buddy checks against two other gauges.
5. Offset each segment between events, using independent datum (levelling) information where it exists; otherwise fit "free floating" segments to the quadratic trend of the levelled segments.

## Buddy checking (section 4.2, p. 4)

Immingham was compared with North Shields (about 173 km away) and Lowestoft (about 182 km) using differences of monthly MSL. "Taking differences of records from nearby sites effectively removes any additional coherent 'common mode' variability ... revealing several clear steps." A maximum likelihood changepoint method (MATLAB, after Lavielle 2005 and Killick et al. 2012) was run on each difference series. "If the time and magnitude of any detected changes are the same in both comparisons (within some defined tolerance), then the change probably originates from the shared time series." The tolerance is not given. Limits: "independent information is needed to confirm the timing of the steps, and the 'buddy' checking relies on having good quality and near complete data from neighbouring sites."

## Model and common-mode reduction (section 4.3, p. 4 to 5)

Subtracting the tide-surge model's monthly mean removes much of the weather-driven high-frequency variability but not interannual signals. Those were coherent across sites, so a common mode (the average detrended record) was also removed. "Unlike buddy checking, this two-step process effectively separates far field ocean effects from local meteorological effects." With variability reduced, "a number of clear datum steps emerge."

## Step detection and confirmation (section 4.4, pp. 5 to 6)

Simpler changepoint tests (Mann-Whitney and basic differencing) "showed false detect issues." The maximum likelihood method found nine changepoints at Immingham. Many matched recorded physical changes (from a data archaeology exercise) and buddy-check steps; the buddy checks also found unrecorded steps (for example late 1983). High-rate (15-minute) records showed steps "were usually associated with breaks in data continuity, implying a physical change." Rule: "We only consider detected jumps which are confirmed by at least one other source of information." A short 1966 excursion also seen at nearby gauges was kept as real.

## Correction and cross-validation (sections 4.5 and 4.6, pp. 6 to 7)

Where levelling or tide gauge zero checks (Van de Casteele tests) exist, the offset for each segment is the average of the calibrations over that segment. For the December 2014 step at Immingham, independent estimates agreed closely: changepoint 136 mm, two buddy checks 130 and 139 mm, surge-model difference and regression both 133 mm, and the more distant Newlyn 105 mm. Over 1993 onward, the adjusted gauge minus local altimetry trend was 0.025 mm/yr against -3.7 mm/yr unadjusted, showing how datum steps bias land-motion estimates from gauge minus altimetry.

## Results (sections 5 and 6)

Final offsets "can in some cases exceed 100 mm." Steps were not correlated between sites, so the regional mean trend changed by only about 0.1 mm/yr, but individual site trends became much more consistent. Some apparent subsidence previously reported could be reassessed as datum shifts. Altimetry comparisons used both the nearest 0.25° grid cell and an average of nearby cells.

## Errors found

Datum steps from instrument changes, relocations, and re-levelling, typically tens of mm to over 100 mm, in monthly means.
