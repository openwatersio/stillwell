# U.S. IOOS QARTOD: Manual for Real-Time Quality Control of Water Level Data, Version 2.1 (2021)

## Citation

U.S. Integrated Ocean Observing System, 2021. Manual for Real-Time Quality Control of Water Level Data Version 2.1: A Guide to Quality Control and Quality Assurance for Water Level Observations. Silver Spring, MD, 47 pp. March 2021. DOI: https://doi.org/10.25923/vpsx-dc82

- PDF: https://cdn.ioos.noaa.gov/media/2021/04/QARTOD_WaterLevelManual_Update_V2.1_Final.pdf
- Also at NOAA Institutional Repository: https://repository.library.noaa.gov/view/noaa/29274
- Version 2.1 is the latest version found (Ocean Best Practices lists Version 2.0 as superseded by it). Earlier versions: 1.0 (2014), 2.0 (2016).

## License and local copy

Treated as a U.S. Government work (NOAA/IOOS) in the public domain, but the front matter (pp. i to iv) carries no license statement and some figures are credited "courtesy of" others, so the PDF is linked, not copied.

## Scope

Eleven real-time tests for in situ water level from fixed platforms and GPS buoys; not for satellite data and "The tests do not include post processing" (p. 25). Section 3.0 (p. 13): real-time QC cannot detect or correct "gradual calibration changes or system responses (sensor drift)", and backfilled data "are not considered to be real time for purposes of QC checks." "Events such as storm surge, tsunamis, and strong winds can affect water levels and must be considered when determining acceptable data thresholds. Human involvement is therefore important". Datums and leveling are outside real-time QC (section 2.2.1).

## Flags (section 3.1, pp. 13-14, Table 3-1, from UNESCO 2013)

| Flag                            | Description                                                                                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pass = 1                        | Data have passed critical real-time QC tests and are deemed adequate for use as preliminary data.                                                                                    |
| Not Evaluated = 2               | Data have not been QC-tested, or the information on quality is not available.                                                                                                        |
| Suspect or Of High Interest = 3 | Data are considered to be either suspect or of high interest to data providers and users. They are flagged suspect to draw further attention to them by operators.                   |
| Fail = 4                        | Data are considered to have failed one or more critical real-time QC checks. If they are disseminated at all, it should be readily apparent that they are not of acceptable quality. |
| Missing Data = 9                | Data are missing; used as a placeholder.                                                                                                                                             |

Rules: "Flags set in real-time should not be changed, ensuring that historical documentation is preserved. Results from post processing should generate another set of flags corresponding to a revised version of the data." Detailed flags (for example "failed high") are allowed but beyond IOOS requirements; all flags must be defined in metadata. The newest point is n0; tests focus on n0, n-1 and n-2. When a multi-point test fails, only the newest point is flagged and earlier flags are not changed, except the spike test, where the newest point is "2 Not Evaluated" until the next point arrives (section 3.3.1, p. 15). Real-time QC'd water level "might be referred to as Level 1 data (UNESCO/IOC 2020)".

## Thresholds approach (section 3.3, p. 14-15; section 4.0, p. 25)

Thresholds are set by the operator: they "should not be determined arbitrarily but can be based on historical knowledge or statistics derived from recently acquired data", may "require multiple iterations of trial and error", should be published as metadata, and may depend on the application (for example chart datum or an inundation threshold). The example values below are examples, not standards.

## Tests (section 3.3.1, pp. 15-22, Table 3-2)

Group 1, Required

1. Timing/Gap Test (p. 15). Missing = 9 if NOW - TIM_STMP > TIM_INC. Example TIM_INC = 1 hour. "This test does not address all clock drift/jump issues." No suspect condition.
2. Syntax Test (p. 16). Fail = 4 if received characters differ from expected (or parity/CRC fails). Example NCHAR = 128.
3. Location Test (p. 16). Fail = 4 for impossible lat/long; Suspect = 3 if displacement > RANGEMAX (example 500 m for a GPS buoy). Does not apply to fixed stations that send no position.
4. Gross Range Test (p. 17). Fail = 4 outside sensor span (SENSOR_MIN/MAX); Suspect = 3 outside user span (USER_MIN/MAX). Examples: SENSOR_MAX 10.0 m, SENSOR_MIN -0.5 m, USER_MAX 5.0 m, USER_MIN -0.5 m.
5. Climatology Test (p. 17). Suspect = 3 outside a seasonal min/max matrix (monthly, seasonal or other TIM_TST). "Because of the potential for extreme water levels without regard to season, no fail flag is identified for this test." Example SPRING_MIN -2.0 m, SPRING_MAX 4.0 m.

Group 2, Strongly Recommended

6. Spike Test (p. 18). Tests point n-1 against SPK_REF = mean of n-2 and n0. Fail = 4 if |WL(n-1) - SPK_REF| > THRSHLD_HIGH; Suspect = 3 if above THRSHLD_LOW. Thresholds fixed or dynamic ("a multiple of the standard deviation over an operator-selected period"). Alternative third-difference test: Diff(n) = WL(n-3) - 3 WL(n-2) + 3 WL(n-1) - WL(n). Multi-point spikes are hard to catch; their onset may trip the rate of change test. Example THRSHLD_LOW 0.1 m, THRSHLD_HIGH 0.2 m.
7. Rate of Change Test (p. 18). Suspect = 3 if |WL(n) - WL(n-1)| > N_DEV x SD; no fail flag. SD computed over the previous 25 hours ("to accommodate cyclical diurnal and other tidal fluctuations"); alternative threshold "0.1 meter +2SD". Example N_DEV = 3, TIM_DEV = 25 h. "Some operators use station-specific values, ranging from about 0.02 meter/6-minute sample, to about 0.50 meter/6-minute sample." Notes that "WL values can change substantially over short periods in some locations" and "Upon failure, it is unknown which point is bad."
8. Flat Line Test (p. 19). Fail = 4 when the five most recent values are equal within EPS; Suspect = 3 when the three most recent are equal. Example REP_CNT_FAIL = 5, REP_CNT_SUSPECT = 3, EPS = 0.001 m. Exception: "Some lakes or estuaries may experience prolonged invariant water level observations."

Group 3, Suggested

9. Multi-Variate Test (p. 20). Suspect = 3 if water level fails a tighter rate-of-change test (N_WLMV_DEV x SD_WL) while wind speed does not change (below N_WS_DEV x SD_WS); Pass if both change. Example N_WLMV_DEV = 2, N_WS_DEV = 2, TIM_DEV = 25 h. "It is doubtful that anyone is conducting tests such as these in real time."
10. Attenuated Signal Test (p. 21). Over TST_TIM, Fail = 4 if SD or (MAX - MIN) < MIN_VAR_FAIL; Suspect = 3 if < MIN_VAR_WARN. Example TST_TIM = 12 h, MIN_VAR_WARN = 0.5 m, MIN_VAR_FAIL = 0.1 m. Targets a series "nearly but not exactly a flat line (e.g., if a well orifice becomes wrapped in debris)".
11. Neighbor or Forecast Test (p. 22). Compare with a nearby sensor, second sensor, or "a water level forecast (tide predictions or model output)". Fail = 4 if |WL1 - WL2| > WL_FAIL_DIFF; Suspect = 3 above WL_SUSPECT_DIFF. Example 3 cm suspect, 5 cm fail. Exception when no adequate neighbor or forecast exists.

## Worked example (section 3.3.2, p. 23)

Wachapreague, VA (NWLON 8631044), 2 October 2015: clipped high tides at the gauge's upper limit caught by gross range, climatology, flat line (needing a suitable EPS because of small superimposed signal), attenuated signal, and forecast tests; a negative spike on switching to the redundant sensor caught by the spike test and the recovery step by rate of change; a short gap by the timing test.

## Instrument notes (sections 2.2.2, 2.2.4, 3.3.3)

Many sensors average high-rate samples (1 Hz) and can transmit sample standard deviation and outlier counts as QC parameters. CO-OPS embeds its Data Quality and Assurance Procedure (DQAP) in field equipment (p. 24). Failure modes per sensor type: radar (ice, insect nests), acoustic (sound speed gradients, obstructed tubes), float wells (clogged intakes; stilling wells err in high waves and currents), pressure (density, barometric correction, drift), lasers (fog, rain), GPS buoys.
