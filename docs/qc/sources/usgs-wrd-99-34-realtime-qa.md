# USGS WRD Policy Memorandum 99.34, real-time data quality assurance

## Citation

U.S. Geological Survey, Water Resources Division, Policy Memorandum No. 99.34, "Quality Assurance Measures for Serving Real-time Water Data on the World Wide Web," February 28, 2000 (signed by R.M. Hirsch, Chief Hydrologist). Stated sunset date February 28, 2005. https://water.usgs.gov/admin/memo/policy/wrdpolicy99.34.html

Related memos named in it: WRD 95.19 (provisional data identification), WRD 97.17 (rt_www software and daily review), OSW Technical Memorandum 99.07 and Open-File Report 94-382 (workbook for surface-water QA plans). The 2014 memo in [usgs-osw-records-policy.md](usgs-osw-records-policy.md) describes 99.34 as the policy that required basic thresholds for screening erroneous data from display.

## License and local copy

U.S. government work, public domain. HTML only on the USGS site; no PDF copy is stored here. The memo carries a sunset date, and whether a successor replaced it was not verified.

## Prescribed QC

The memo sets a two-part approach: automatic screening to keep bad data from being served, plus frequent visual review and prompt deletion.

Thresholds set in ADAPS for each station with data on the web (the ADAPS-flagged values are masked from public display, and a small black triangle appears on the graph's top axis when any value for the day is masked):

- Very-high-value (required): above the highest value the site's sensing and recording equipment can measure. Suggested 0.10 units above that maximum; the streamgaging example given is "0.01 feet higher than the bottom of the instrument shelf."
- Very-low-value (required): below the lowest possible value. Suggested 0.10 units below the lowest measurable value; the streamgaging example is "0.10 feet below the point-of-zero flow of a stable control."
- Very-rapid-increase and very-rapid-decrease (optional): alert on a possibly erroneous jump between successive unit values. "Because there is no standard method to determine valid rapid increases and decreases these thresholds are not required"; a knowledgeable streamgager can derive them from the historical unit-values record.
- Threshold values "must be defined by individuals that are knowledgeable about the hydrologic and historical flow characteristics of each site."

Review cadence:

- Review served data at least once per work day. During floods and droughts check more often.
- "A completely spurious data spike during a flood should not be displayed on the WWW for more than 24 hours." In normal conditions a spike should not persist beyond the first few hours of the next work day.
- "It is far better for us to indicate that the data are missing, and that we are aware of the problem and will work to resolve it, than it is to continue to serve the bad data."
- Visual review via a quick-view utility catches "subtle errors that may pass through the threshold filters."

## Not covered

No flat-line test, no neighbor comparison, no datum handling. Numeric limits are per site, not national.
