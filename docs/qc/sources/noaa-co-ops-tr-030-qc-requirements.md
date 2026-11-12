# NOAA Technical Report NOS CO-OPS 030: NWLON/DMS Quality Control Software Functional Requirements (2004)

## Citation

Nault, J., 2004. NWLON/DMS Quality Control Software (QC): Functional Requirements Document. NOAA Technical Report NOS CO-OPS 030. NOAA National Ocean Service, Center for Operational Oceanographic Products and Services, Silver Spring, MD. June 2000, revised February 2002, September 2004, November 2004. 21 pp.

- PDF: https://tidesandcurrents.noaa.gov/publications/NOAA_Technical_Report_NOS_CO-OPS_030_QC_requirements_doc(revised)-11102004.pdf
- NOAA repository record: https://repository.library.noaa.gov/view/noaa/14407 (listed as public domain)

## License and local copy

U.S. Government work, public domain. PDF included: [pdf/noaa-nos-co-ops-030-2004.pdf](pdf/noaa-nos-co-ops-030-2004.pdf) (0.2 MB).

## What it is

The requirements for the automatic QC CO-OPS applies to each 6-minute National Water Level Observation Network (NWLON) value as it is ingested, before it enters the Data Management System (DMS) and the real-time products (Tides Online, NWS CREX and SHEF bulletins). QARTOD's water level manual and CO-OPS Technical Report 061 both cite it as the source of CO-OPS real-time flags. It is the origin of the limit, flat, and rate-of-change flags seen in CO-OPS data. Each flag is 0 by default and set to 1 when tripped; flags do not change the value. Later review is done by CORMS (24/7 monitoring) and CO-OPS data processing staff (see [noaa-co-ops-tr-061-microwave-qc.md](noaa-co-ops-tr-061-microwave-qc.md)).

## Per-station parameters (section 2.2, p. 5)

An hourly station information file holds per-station tolerances, including water level min and max, water level sigma max, rate-of-change, primary versus predicted tolerance, primary versus backup tolerance, accepted backup gain and offset, datum and sensor offsets, and accepted harmonic constituents.

## Checks on each 6-minute value (section 3.1, pp. 5-11)

- Datum offset check: incoming datum offset compared with the stored value; mismatches written to an error file.
- Sensor offset check: if the incoming offset differs from the stored one by less than 0.010 m a new record is added; if by more, the stored value is used (Figure 2 flow chart).
- Water Level Maximum/Minimum flag (p. 7): set if the 6-minute value "is above the maximum tolerance plus 3 m or is below the minimum tolerance minus 3 m". Tolerances: "Default values for tide stations were originally derived from the maximum and minimum observed water levels for the time period of record at each station. These defaults have been refined over time to narrow the maximum and minimum tolerances, in order to catch more than just the most severe problems. Operationally, these flags typically get set when sensor or datum offset problems occur and when abnormally high and/or low waters occur due to tsunami or storm events."
- Water Level Flat flag (p. 7): set when "the water level data value is identical to the two values before and two values after the current value."
- Water Level Third Difference (rate of change) flag (pp. 7-8): Diff(I) = H(I-3) - 3 H(I-2) + 3 H(I-1) - H(I), set "on the first water level value which is greater than the tolerance". "Tolerances are determined from looking at the distribution and standard deviations of these third differences over time. The offline QC check program provides a suggested third difference limit by computing a value of 5 times the standard deviation of the differences. Operationally, third difference flags get set when the 6-minute data are abnormally 'noisy' due to sensor problems or due to local sea state and waves from storm, tsunami, or seiche events. Open coast stations with high energy wave environments generally have higher third difference tolerances than inside 'quiet' stations."
- Outlier flag (p. 10): set when the count of 1-second samples rejected by the 3-sigma criterion during averaging exceeds the station's stored outlier limit.
- Sigma flag (p. 10): set when the standard deviation of the 1-second samples exceeds the station's stored sigma.
- Acoustic sensor temperature checks (pp. 8-10): thermistor gradient flags (TEMP_GRAD_TOL1 default 5, TEMP_GRAD_TOL2 default 20), height correction tolerance default 5 cm, conditional temperature correction.
- Primary versus backup (p. 10-11): flag if the difference between primary and backup (with accepted gain and offset applied, "should remain nearly constant for a given station") exceeds a tolerance.
- Predicted value check (p. 11): flag if the primary water level differs from the predicted tide on station datum by more than a tolerance. Similar checks for single and dual pressure (N1 versus predicted, N1 versus T1).
- Ancillary sensors (air temperature, pressure, wind, etc.) get only max/min checks.

## Outputs (section 3.2, pp. 13-15)

Each QC'd 6-minute record carries: value, max/min flag, flat flag, rate-of-change flag, sigma, sigma flag, outlier count, outlier flag, temperature flags, primary-versus-backup flag, primary-versus-predicted flag. A separate real-time file carries MLLW water level, residual against prediction, and predicted value for NWS bulletins.

## Real-time vs delayed

This document covers only the automatic ingest stage. Data are QC'd "even if the database is not available" so near-real-time products are not delayed (section 3.3). Thresholds are station-specific and set offline from historical data.
