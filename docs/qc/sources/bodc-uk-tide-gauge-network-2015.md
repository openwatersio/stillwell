# BODC/NOC: UK Coastal Monitoring and Forecasting Annual Report for 2015 for the UK National Tide Gauge Network

## Citation

McGarrigle, P. (ed.), with E. Bradshaw and others (BODC and NOC). UK Coastal Monitoring and Forecasting: Annual Report for 2015 for the UK National Tide Gauge Network. British Oceanographic Data Centre and National Oceanography Centre. 147 pp.

- PDF: https://www.bodc.ac.uk/data/hosted_data_systems/sea_level/uk_tide_gauge_network/reports/documents/2015annualreport.pdf

Other years (2011, 2012) are at the same path. The 2015 report was read; the QC section is assumed to be similar in other years but this was not checked.

## License and local copy

Carries Crown copyright and NERC map copyright notices; no open license. 9.4 MB. Link only.

## QC procedure (pp. 7-10 of the report)

BODC is the delayed-mode centre for the UK National Tide Gauge Network. Gauges have two full-tide channels and some sites also have a mid-tide channel.

- Cadence: "Data are quality-controlled weekly, monthly and annually using in-house software. This involves inspecting both recorded values and non-tidal residuals. Examining residuals is especially useful for detecting instrument faults (timing errors, datum shifts, spikes)." Fresh tidal constants from recent data (Doodson analysis) because constants are corrupted at nonlinear, riverine or estuarine sites.
- Weekly: screen for "spikes, gaps, timing errors and datum shifts"; compare with previous series from the same site and with neighbouring stations; display sea temperature and atmospheric pressure.
- Monthly: compare statistics such as mean sea level with previous years.
- Annually: tidal analysis, comparing M2, S2, N2, K1, O1 and Z0 with previous series, adjacent sites and the Admiralty Tide Tables.
- Threshold: "Data values are considered suspicious if the measured value differs by more than approximately 20mm (for a site of average tidal range) from either the mid-tide channel (if one exists at the site) or the predicted value. The person screening the data will often have to use their own judgement."
- Flags: "Suspicious data points are flagged 'M' and any timing errors or datum shifts are noted. An 'N' flag is assigned to those values that are null. No data values are changed." Data quality percentages per channel are reported against "GLOSS delayed mode data standards (with discrepancies of over 20mm flagged, depending on site)".
- Auditing: scripts check headers against metadata and that "timing errors, out-of-range values and nulls have been dealt with"; a second data scientist audits before banking.
- Derived statistics: gaps longer than 4.1 hours in the primary channel are recorded as gaps; monthly extremes and surges exclude interpolated and flagged values; MSL from Vassie 03B plus Doodson X0 filters; no monthly mean if more than 15 days missing; no annual mean if more than two months missing.

## Tide gauge specifics

Per-site notes in the report show how flags are used in practice, for example a channel "blocking", or full-tide channels "lagging on most falling tides" and flagged against the mid-tide channel.
