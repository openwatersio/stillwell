# NOAA Technical Report NOS CO-OPS 061: Limited Acceptance of the Design Analysis WaterLog H-3611i Microwave Radar Water Level Sensor (2011)

## Citation

NOAA, 2011. Ocean Systems Test and Evaluation Program, Test and Evaluation Report: Limited Acceptance of the Design Analysis WaterLog H-3611i Microwave Radar Water Level Sensor. NOAA Technical Report NOS CO-OPS 061. NOAA National Ocean Service, CO-OPS, Silver Spring, MD, March 2011. 97 pp.

- PDF: https://tidesandcurrents.noaa.gov/publications/Technical_Report_NOS_CO-OPS_061.pdf

## License and local copy

U.S. Government work, public domain. PDF included: [pdf/noaa-nos-co-ops-061-2011.pdf](pdf/noaa-nos-co-ops-061-2011.pdf) (7.0 MB).

## Why it matters for QC

Section 3 ("Data Quality Control Guidelines", pp. 21-31) is the clearest CO-OPS primary description of how its real-time flags fit into the data flow and how per-site thresholds are derived from data. It extends the flags of NOS CO-OPS 030 (see [noaa-co-ops-tr-030-qc-requirements.md](noaa-co-ops-tr-030-qc-requirements.md)) to radar sensors.

## Data flow (section 3.0, p. 21)

"The first step of the CO-OPS QC process involves applying simple logic to each 6-min water level observation during initial ingestion to determine whether a list of QC flags associated with each data point will be set. Setting a flag indicates that a particular 6-min water level value may be suspect or bad, and flag settings are taken into account during the next phase of data processing conducted by the Continuous Operational Real-time Monitoring System (CORMS) and the Oceanography Division's (OD) Data Processing Team." Flags default to 0 and are set to 1.

Delayed-mode verification (section 2.3, pp. 17-18): monthly products are generated under the CO-OPS tidal water level data processing SOP (internal, SOP #7.3.A.2.2, draft December 2009; not public). The analyst compares plots with the backup or reference sensor, runs a "DMS Offline QC Check to identify out-of-tolerance data and suspected problems", fills short gaps with the DMS linear fit routine, then tabulates hourly heights, highs and lows, and monthly means.

## Flags and thresholds (section 3.2, pp. 22-31)

Sensor table fields (Table 3, p. 22): INFERRED (interpolations that fill gaps), MW_SIGMA (SD of raw 1-Hz data), MW_OUTLIERS (1-Hz points outside ±3 SD), MW_FLAG (min/max), MW_SIGMA_FLAG, MW_OUTLIER_FLAG, MW_FLAT_FLAG, MW_ROFC_FLAG.

- Minimum/Maximum check (p. 22): station min and max tolerances; flag set if above max + 3 m or below min - 3 m (same as acoustic sensors).
- Standard deviation magnitude (pp. 22-29): flag when the 1-Hz SD exceeds a threshold that depends on the sensor's time response and the site. From Port Townsend data, "all 6-min sigma values should be 0.15 m or less"; OSTEP recommends 0.15 m for that site and similar sites.
- Number of outliers (p. 29): 6-minute value is the mean of 360 1-Hz samples after removing points outside ±3 SD (CO-OPS DQAP). Good data at Port Townsend "typically have fewer than 15 outliers"; flag if more than 15 (about 4% of samples).
- Flat line (pp. 29-30): set if MW_SIGMA = 0.0 m; otherwise set if "a 6-min water level data value is identical to the two values before and the two values after that value" (the NWLON primary sensor rule). Notes that an obstruction in the radar footprint can give constant values with small but non-zero SD.
- Rate of change (pp. 30-31): "If abs(WLi - WLi-1) > dWLmax, then the MW_ROFC_FLAG flag is set." dWLmax "depends on the water level characteristics at each measurement site", considering "typical rates of water level changes at an individual site resulting from processes on time scales ranging from those of tidal- and meteorological-forced water level changes" and "first difference distributions of historical 6-min water level records". Port Townsend first differences are mostly within ±0.1 m; Mobile Bay mostly within ±0.05 m with some to ±0.1 m, so "a reasonable rate of change threshold for Mobile Bay is ±0.15 m."

## Limits stated

The guidelines are for "fetch limited, semi-enclosed regions with a relatively small wave environment". For open-ocean exposure, results from Duck, NC "indicate possible advantages to applying summary order statistics rather than Gaussian statistics (which use sigma criteria)" (p. 21).
