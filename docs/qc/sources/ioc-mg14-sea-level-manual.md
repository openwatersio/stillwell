# IOC Manuals and Guides 14: Manual on Sea Level Measurement and Interpretation (Volumes I, III, IV, V)

## Citations

- Volume I, Basic Procedures. IOC Manuals and Guides 14, UNESCO, 1985. https://psmsl.org/train_and_info/training/manuals/ioc_14i.pdf (UNESCO: https://unesdoc.unesco.org/ark:/48223/pf0000065061)
- Volume III, Reappraisals and Recommendations as of the year 2000. IOC Manuals and Guides 14, UNESCO, 2002. Copy read: https://web.archive.org/web/2017/http://unesdoc.unesco.org/images/0012/001251/125129e.pdf (UNESCO: https://unesdoc.unesco.org/ark:/48223/pf0000125129)
- Volume IV, An Update to 2006. IOC Manuals and Guides 14, UNESCO, 2006. Copy read: https://psmsl.org/train_and_info/training/manuals/manual_14_final_21_09_06.pdf (UNESCO: https://unesdoc.unesco.org/ark:/48223/pf0000147773)
- Volume V, Radar Gauges, with a Supplement on Practical Experiences. Woodworth, P.L. et al. (eds), IOC Manuals and Guides 14, JCOMM Technical Report 89, UNESCO, 2016. Copy read: https://web.archive.org/web/2017/http://unesdoc.unesco.org/images/0024/002469/246981E.pdf (UNESCO: https://unesdoc.unesco.org/ark:/48223/pf0000246981)
- Index of all volumes: https://psmsl.org/train_and_info/training/manuals/

Volume II (Emerging Technologies, 1994) was not read; IOC MG 83 cites it for the rule that gaps under 24 hours may be filled.

## License and local copy

Volumes IV and V carry "© UNESCO 2006" and "© UNESCO 2016" with no open license statement; Volumes I and III carry none either. UNESCO record pages were unreachable (HTTP 403). Volume V is also 39 MB. No PDFs included; links only.

## What the series says about QC

The series is the GLOSS reference for tide gauge operation. Volumes IV and V explicitly defer detailed QC to earlier volumes and to IOC MG 83 (see [ioc-mg83-sea-level-qc-2020.md](ioc-mg83-sea-level-qc-2020.md)).

### Volume I (1985), chapter 4, pp. 46-50 (analogue chart reduction)

Describes faults in chart records and what may be repaired:

- Clock stoppages appear as vertical lines; a profile may be sketched in only if "not more than one high tide and one low tide have lapsed"; with storms, omit the record.
- Ink run-out or pen off record: sketch "No more than six to seven hours"; never guess high and low waters.
- Float jamming shows as steps; up to an hour can be interpolated.
- Silt in the well delays the tide and can show as "flats" at high and low water; leave a gap until the well is cleared.
- "Nothing is achieved by filling a gap in observations with predicted values, or artistic impressions when there is a likelihood of storms or high winds" and "meteorological effects should never be nullified."
- Check suspect profiles against a nearby site to separate mechanical faults from weather.

### Volume III (2002), section 5.2, pp. 38-40

"There is still a need to check for timings, data spikes and gaps etc. by, for example, 'buddy checking' with respect to predicted sea level time series (determined from historical tidal constants) or to data from a nearby gauge." Names the three GLOSS QC packages (UHSLC by Patrick Caldwell, POL TASK-2000, Australian NTF) and warns that tidal constants "should never be mixed between packages". Section 5.2.2 covers tidal filters for daily and monthly means (Doodson X0, monthly MSL).

### Volume IV (2006), section 6, pp. 42-43

States that delayed-mode QC methods "are well established and will not be repeated here" (they are in Volume III and earlier). Describes WOCE's split of UHSLC as "fast delivery" DAC (within several weeks) and BODC as "delayed mode" DAC (18-24 months), and the GLOSS shift to near-real-time delivery "typically within an hour". Notes that real-time systems must not be "perturbed when bad data are recorded (e.g. data spikes)", via either continuous human oversight (the UK Storm Tide Forecasting Service) or real-time QC software, citing Puertos del Estado's automatic detection of "spikes, gaps, etc." before public display and storm surge assimilation.

### Volume V (2016), section 8.2, pp. 77-81

- 8.2.1 Real time QC: the IOC Sea Level Station Monitoring Facility "does not apply a QC to any of the data it receives". Cites Puertos del Estado's automatic QC of 1-minute data with tsunami and seiche detection, and IOOS QARTOD's 11 tests. Defines "fast data" as data needing "only mild QC" for use within weeks; records can stay "fast" until delayed-mode QC or metadata questions (datums, timing) are resolved.
- 8.2.2 Delayed mode QC: performed by national Data Assembly Centres, then again by international centres. Main step is tidal analysis to separate tidal and non-tidal parts, "with inspection of the non-tidal component (or 'tidal residuals') being especially useful in identifying data problems such as spikes and datum shifts."
- 8.2.2.1 One-minute data: archive the original 1-minute data; reject outliers in noisy radar data, "for example ... rejection of 1-minute measurements that are 3-sigma outliers within a moving half-hour window", though the method "may depend on the location"; then low-pass to hourly or average to 6 or 15 minutes. For short event records, QC a longer (about one year) record first, derive tidal constants, and subtract predicted tide at 1-minute sampling. "We cannot see within GLOSS the need for, or indeed the possibility of, undertaking a complete QC of all 1-minute data."
- 8.2.2.2 Altimetry as a datum check: JASL routinely compares daily tide gauge data with altimeter proxy data; a step in the difference series (Kaohsiung, 2009) exposed a datum error.
- 8.2.3 QC packages: the UHSLC package (Foreman tidal analysis) and NOC TASK-Windows ("auto flagging of data, gap detection, spike detection, unit conversion, time shifting").
- 8.3 Data provider obligations: real-time data to the SLSMF; fast data with partial QC to the GLOSS Fast Centre, released within 4-6 weeks; fully QC'd delayed-mode data to BODC or UHSLC by September of the following year; monthly and annual MSL with datum information to PSMSL.

## Thresholds and flags

The series gives no numeric thresholds beyond the Volume I manual-reduction rules, the 3-sigma half-hour outlier example in Volume V, and the monthly-mean rules. No flag scheme is defined in these volumes; see IOC MG 83.
