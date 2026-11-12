# USGS Office of Surface Water memoranda on processing, approving and correcting time-series records

## Citations

- Office of Groundwater Technical Memorandum 2017.03 / Office of Surface Water (OSW) Technical Memorandum 2017.10 / Office of Water Quality Technical Memorandum 2017.07, "Procedures for Processing, Approving, Publishing, and Auditing Time-Series Records for Water Data," August 28, 2017, 5 pp. https://water.usgs.gov/osw/time-series-guidance/SW_2017.10+GW_2017.03+WQ_2017.07.pdf
- OSW Technical Memorandum 2014.08, "Policy for the timely correction of time-series data displayed on the NWISWeb," July 14, 2014, 5 pp. https://water.usgs.gov/admin/memo/SW/sw1408.pdf
- OSW Technical Memorandum 2006.05, "Approval and Revision of Time-Series Data in ADAPS 4.6," September 28, 2006. https://water.usgs.gov/admin/memo/SW/sw06.05.html (the 2017 memos define the current data states; the 2006 memo is the source of the stage revision criteria below).
- Underlying policy: WRD Policy Memorandum 2010.02, "Continuous Records Processing of all Water Time Series Data," https://water.usgs.gov/admin/memo/policy/wrdpolicy10.02.html (read only through the summary in the memos above; not opened in full).
- Memo index: https://water.usgs.gov/osw/ and https://water.usgs.gov/osw/time-series-guidance/

## License and local copies

U.S. government works, public domain.

- 2017.10 (136 KB): [pdf/usgs-osw-2017-10-processing-approving-auditing.pdf](pdf/usgs-osw-2017-10-processing-approving-auditing.pdf)
- 2014.08 (233 KB): [pdf/usgs-osw-2014-08-timely-correction.pdf](pdf/usgs-osw-2014-08-timely-correction.pdf)
- 2006.05: HTML page only, link only.

## Data states: provisional versus approved

2017.10 (pp. 2 to 3) defines three internal states, with the public label on NWISWeb:

- Working (shown as Provisional): "as accurate as possible following current best practices," not yet fully analyzed.
- Analyzed (shown as Provisional): fully processed with a complete station analysis. Analysis starts as soon as practical after field data are collected. If data are insufficient the state stays Working.
- Approved (shown as Approved): "completely analyzed time-series data, including examination for errors and proper interpretation," set by a second hydrographer. Approved data are "published."

Roles: Operator (site visits, often also the Analyst), Analyst, and Approver (a second hydrographer who either approves or returns the analysis). Publication through NWIS requires processing by these steps.

2006.05 (older, three states used before the 2017 terms): Approved, In-Review (analysis complete, "can not be fully supported without caveat," shown as provisional) and Working (shown as provisional).

## Audits (2017.10, p. 3)

After approval any further examination is an audit. Routine audits happen at preset intervals. Non-routine audits can occur at any time (for example a user question about gage height for two months two years earlier). Levels: 1 (same depth as approval), 2 (general review, such as a periodic technical review), 3 (one specific aspect). Results: no issues; minor issues below revision criteria; revision needed because of an error before approval; revision needed because new data became available. For the stage-specific audit rate see [usgs-stage-approval-guidance.md](usgs-stage-approval-guidance.md).

## Revision criteria for approved stage (2006.05)

Changes to Approved stage or elevation data are revised when they exceed:

- Extremes: more than 0.2 ft
- Daily means: more than 0.2 ft
- Unit (instantaneous) values: more than 0.5 ft

Smaller changes may be revised at the Water Science Center's discretion. Stage, elevation and discharge must stay consistent in the database: revising stage unit values means revising dependent discharge values, and extremes must match the unit values that define them. For discharge the criteria are 10 percent for peaks, minimums and monthly means and about 50 percent for daily and unit values. Later memos (SW2017.07, "Procedures for Identifying and Documenting Revisions to USGS Water Data") supersede the process; that memo was not opened.

## Timely correction of provisional data (2014.08)

- Stage and discharge data are corrected (datum, data and variable shift corrections) within 2 business days of a field measurement if the computed real-time data on NWISWeb do not match the measurement within its rated accuracy. Other measurements are entered within 7 business days.
- "Stage and discharge data not corrected per policy shall be removed from public display." Discharge known to be wrong is corrected or removed.
- Ice: time-series discharge is masked with an "ice" setting as soon as the record is considered affected by ice backwater, and the mask stays until the backwater ends. Masking blocks display of estimates until approval, so a preliminary estimate has to be applied to the instantaneous values and the mask removed for that period.
- Automated shift programs do not replace visual inspection of real-time hydrographs.
- The memo says an OSW script ("NWISWeb Automated Quality Assurance Report") emails Water Science Centers when unit-value thresholds are exceeded or not set, and refers to WRD memos 97.17 (daily review of instantaneous values) and 99.34 (threshold screening). See [usgs-wrd-99-34-realtime-qa.md](usgs-wrd-99-34-realtime-qa.md).

## Not covered

No automated numeric screening limits for stage. Provisional stage is whatever the Working and Analyzed states contain; the memos do not describe flags on individual values (see [usgs-value-qualifiers.md](usgs-value-qualifiers.md)).
