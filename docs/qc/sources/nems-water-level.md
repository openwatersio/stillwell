# New Zealand NEMS Water Level standard and National Quality Code Schema

## Citation

- National Environmental Monitoring Standards (NEMS), "Water Level: Measurement, Processing and Archiving of Water Level Data," Version 2.0, July 2016, 120 pp. https://www.lawa.org.nz/media/2982093/NEMS-Water-Level.pdf (an index of NEMS documents is at https://www.lawa.org.nz/learn/factsheets/national-environmental-monitoring-standards-nems)
- NEMS, "National Quality Code Schema," Version 1.0, June 2013, 21 pp. https://www.lawa.org.nz/media/16580/nems-quality-code-schema-2013-06-1-.pdf (the NEMS site may hold a newer version; not checked)

Prepared by the Local Authorities Environmental Monitoring Group for regional councils and the Ministry for the Environment, with NIWA and electricity generators. Normative references include ISO 4373 and Sauer and Turnipseed (2010) (see [usgs-tm3a7.md](usgs-tm3a7.md)).

## License and local copy

No license or reuse statement appears in either document, and the front matter disclaims liability only. License unverified, so no PDF is stored; link only.

## Accuracy and timing requirements for the top quality code (Water Level, pp. xi to xiii)

- Rivers and lakes: accuracy the greater of 3 mm or 0.2 percent of effective stage (adopted from the USGS approach). Sea level and groundwater: greater of 10 mm or 0.2 percent. Resolution 1 mm.
- Maximum recording interval: 5 minutes for rivers and lakes, 15 minutes for groundwater, 1 minute for sea. Rivers and lakes record instantaneous values (no more than 20 seconds of averaging). Timing accuracy for rivers and lakes is plus or minus 90 seconds, in New Zealand Standard Time with no daylight time.
- Stationarity of record must be maintained: variability comes only from natural processes, and "ceases when variability is caused or affected by other processes, moving the station, or adjusting the recording zero height" (1.3). An external reference, a staff gauge tied to a constant vertical datum through benchmarks, is always used to check the continuous record. The primary reference gauge's recording-zero reduced level must be shown constant over time to plus or minus 3 mm.
- Annual calibration for pressure transducers; barometric pressure required for unvented transducers; salinity required for pressure transducers in estuaries.

## Quality code flowchart for water level (p. xiv, read from the figure)

- QC 100 Missing record.
- QC 200 No quality or non-verified: raw, of unknown quality, not assigned a final code, or external and not coded to the schema. Telemetered data are QC 200 until verified (6.4).
- QC 300 Synthetic: estimated from relationships, calculations or models, or limited measured data.
- QC 400 Poor quality: measured data compromised in ability to represent the parameter and/or significantly modified. For freshwater, measurement uncertainty greater than plus or minus 10 mm or 0.5 percent of effective stage, or a recording interval inadequate for the rate of change.
- QC 500 Fair quality: does not meet operational standards or best practice, or is significantly modified. Freshwater uncertainty greater than plus or minus 3 mm or 0.2 percent of effective stage, or a recording interval that is adequate but not optimal for the rate of change.
- QC 600 Good quality: measured using best practice, meets operational standards, site meets the NEMS requirements.

The schema document (pp. 3 to 5) sets six "zones" (100 to 600, higher is better), says missing record is the poorest zone, requires agencies to publish a map from in-house codes to the national codes, and defines optional child codes such as 200-150 (no known quality) and 200-200 (non-verified). Suggested display colors are in its Table 1. Meanings of QC 100 and QC 300 beyond the flowchart wording come from the flowchart only.

## Verification and validation (5.5 to 5.6, pp. 62 to 66)

- Visits at intervals that keep the data "free of error and bias, both in level and time." Suggested maximum interval of three months between visits, and at least monthly for troublesome sites (unstable ratings, bubbler systems needing attention).
- Each inspection record has site, logger and reference times, reference readings with uncertainty (for example 756 mm plus or minus 5 mm; an electric plumb bob is plus or minus 1 mm unless noted), and a concurrent logger value. Complete the inspection as close to a logged time stamp as possible.
- When a logger is reset after a fault, set it to the primary site reference and confirm at a later visit during stable water level.
- Sensor validation at least annually and whenever there is a major discrepancy, a trend outside tolerance across inspections, or "at any two consecutive visits" the recorder differs from the reference gauge by more than the sensor's tolerance.

## Processing, gaps and metadata (section 6, pp. 67 to 75)

- Correct data for level when it falls outside the standard against one or more references, and for time against an accurate timepiece. All changes to the raw record are documented. Modifications must be "conservative, traceable, documented, performed or approved by experienced personnel," time-stamped and quality coded.
- Missing record: goal zero, and a recommended target of fewer than five missing days in only one of two consecutive years. Fill gaps in order of preference: backup data from the site, interpolation at the site, checked adjacent-station data, then modeled or correlated estimates. Filled data are distinguished from primary data by quality code and described with an uncertainty. Refer to WMO-No. 1044 Volume II.
- Telemetry: automatic features and any ad hoc rescaling at the base must be documented as carefully as an on-site change; check time at each station routinely.

## Site considerations for lakes (1.6, p. 7)

Operating a lake or reservoir recorder "properly requires consideration of wind effects, seiche and rating curve uncertainties." Stratification affects sensor depth in lakes (1.4.4).

## Not covered

No numeric screening thresholds for range, spike, rate of change or flat line. The standard is about how to collect and code, and says quality assurance and auditing requirements are "under development."
