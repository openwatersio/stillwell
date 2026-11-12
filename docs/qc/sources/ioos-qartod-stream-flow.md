# U.S. IOOS QARTOD Manual for Real-Time Quality Control of Stream Flow Observations

## Citation

U.S. Integrated Ocean Observing System, 2018, Manual for Real-Time Quality Control of Stream Flow Observations: A Guide to Quality Control and Quality Assurance for Stream Flow Observations in Rivers and Streams, Version 1.0, September 2018, 46 pp. DOI 10.25923/gszc-ha43. https://cdn.ioos.noaa.gov/attachments/2018/09/StreamFlow_v1.0_final.pdf

The manual is about discharge ("SF"), not stage, and says stream flow QC is dynamic and hard to bound. It is included because it is the only U.S. federal real-time QC test suite written for rivers, because it was reviewed by USGS, USACE and Water Survey of Canada staff, and because its tests carry over to a stage series. Water level in oceans and lakes has its own manual (QARTOD Manual for Real-Time Quality Control of Water Level Data, Version 2.1, 2021, https://cdn.ioos.noaa.gov/media/2021/04/QARTOD_WaterLevelManual_Update_V2.1_Final.pdf; it states its scope as "oceans and lakes" and is covered in the tide-gauge notes, not here).

## License and local copy

Published by NOAA IOOS; treated as a U.S. government work in the public domain. The document has no explicit license statement (the only reproduction notice is an endorsement disclaimer on page vi), so that status is an assumption, and the PDF is linked, not copied.

Page references use the manual's own numbering (A-n).

## Flags (3.1, p. A-12 to A-13)

IODE and IOC 2013 flags: 1 Pass, 2 Not evaluated, 3 Suspect or of high interest, 4 Fail, 9 Missing. Flags set in real time keep their original values; later processing can differ, but the real-time flag is retained to preserve history. The one exception is the spike test, where the newest point stays "2 Not evaluated" until the next point arrives. When a multi-point test fails, only the current point is flagged and earlier flags are not changed.

## Test hierarchy (3.2, Table 3-2)

- Required: 1 Gap, 2 Syntax, 3 Gross range.
- Strongly recommended: 4 Climatology, 5 Spike, 6 Rate of change, 7 Flat line.
- Suggested: 8 Multi-variate, 9 Neighbor.

The manual refuses to give generic thresholds: they "are determined at the local level and may require multiple iterations of trial and error," based on historical data, documented, and published as metadata. If a group 2 or 3 test is not applied, the operator documents why.

## Tests and examples (3.3, pp. A-14 to A-22)

- Gap: data not received within the expected interval (TIM_INC) fails.
- Gross range: fail outside the sensor span (min and max the sensor can output, or the rating limit for flow); suspect outside an operator-selected span. Example: sensor max 10,000 ft3/s, user max 6,000, user min 500.
- Climatology: suspect outside seasonal min and max (monthly or seasonal). No fail flag, "because of the dynamic nature" of flow.
- Spike: single value n-1 compared with the average of its neighbors. Fail above THRSHLD_HIGH, suspect between THRSHLD_LOW and THRSHLD_HIGH. Example 500 and 1,000 ft3/s. Multi-point spikes "are notoriously difficult to capture"; the rate-of-change test may flag their onset.
- Rate of change: suspect if |change between consecutive values| exceeds a threshold (example 1,000 ft3/s); no fail flag. A threshold too low "triggers too many false alarms."
- Flat line: suspect when the 3 most recent values are equal within a tolerance, fail when 5 are equal (REP_CNT_SUSPECT = 3, REP_CNT_FAIL = 5), applied when the value is not zero. Test exception: after a sensor failure a repeated zero, last valid value or other fixed output is possible, "however, repeated zero or other SF values may be accurate," so operators "must carefully choose how to flag data under these conditions."
- Multi-variate: suspect if flow jumps while a second variable such as rainfall does not (rainfall rate-of-change example 1 in/hr). The committee notes full covariance testing "remains a research project."
- Neighbor: suspect if the site jumps while a nearby sensor does not. The worked example uses the St. Johns River near Christmas, Florida, and a gage about 15 miles (23 km) upstream near Cocoa. The spike appears at both sites with a time offset that "may be positive or negative" (here the upstream gage lagged), so "only the first spike might be used to validate the second spike in real-time" and tests with distant neighbors "can quickly become complex."

## Scope notes (3.0, p. A-12)

Drift often cannot be detected or corrected in real time without reference points, and backfilled data are not considered real-time for these tests. The summary (p. A-23) names USGS and USACE as programs with very rigorous QC.

## Not covered

Nothing on ice, datum changes, or constant-stage regimes beyond the flat-line exception above.
