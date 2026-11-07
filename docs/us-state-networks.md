# US state networks

TICON carries records from five US state networks: Louisiana's CRMS (164 records), California's Department of Water Resources (131, 75 accepted), the South Florida (43) and Northwest Florida (8) water management districts, and North Carolina Emergency Management (22). This page ranks them by value and effort and says what each needs before it can be an adapter. Findings are from November 2026.

| Rank | Network        | Status            | Value                                                            | Effort                            |
| ---- | -------------- | ----------------- | ---------------------------------------------------------------- | --------------------------------- |
| 1    | SFWMD          | Adapter (`sfwmd`) | 43 tidal gauges, NAVD88, real-time, reviewed record back to 1974 | Moderate                          |
| 2    | California DWR | Adapter (`dwr`)   | 51 Delta gauges, 15-minute, back to 1975; 16 in NAVD88           | Moderate                          |
| 3    | CRMS           | Needs a decision  | About 570 hourly NAVD88 marsh gauges back to 1996                | High, through a 1.3 GB weekly zip |
| 4    | NCDEM (FIMAN)  | Blocked           | 68 coastal gauges of its own, real-time                          | No history service found          |
| 5    | NWFWMD         | Blocked           | A handful of tidal river gauges                                  | No public API                     |

## SFWMD

See [the adapter's README](../src/sources/sfwmd/README.md). DBHYDRO states no license, as Florida public records with a no-warranty disclaimer. The adapter reads the unauthenticated API behind DBHYDRO Insights. The documented Hydro Data Service needs a client ID from datarequests@sfwmd.gov, and is the fallback if the Insights API closes.

## California DWR

See [the adapter's README](../src/sources/dwr/README.md). The Water Data Library has 71 of TICON's 131 California records, the ones TICON names by DWR station number (B95325). The adapter reads 51 of them; the others have no position or an empty file. They're DWR's own gauges, in NAVD88 at 16 and above gauge zero at the rest, PST all year, and a day to months behind real time, so the source is refetched monthly rather than polled hourly.

## CDEC

TICON's other California records are CDEC stations named by three-letter code (BDL, MRZ, HOL). CDEC's `CSVDataServlet` serves their 15-minute stage in feet, near real time, and its station search names each station's operator: about 16% of Delta stations are USGS's or shared with USGS, and those would be left out as copies. Its stage datum varies by station (NGVD29, NAVD88 or none given), and its clock keeps daylight saving although its pages say PST. Its terms are DWR's. An adapter for the stations DWR runs is the next step for California.

## CRMS

- **Access:** no per-station API. CPRA's [CIMS](https://cims.coastal.la.gov/FullTableExports.aspx) publishes `CRMS_Continuous_Hydrographic.zip` every Sunday, 1.29 GB, with every station's hourly record; range requests work. A web form emails a per-station CSV. An open ArcGIS layer lists stations (`cimsgeo3.coastal.louisiana.gov/.../monitoring_stations/MapServer/0`).
- **Data:** hourly, Central Standard Time all year, feet. "Adjusted Water Elevation to Datum" is NAVD88, with the geoid model per row (GEOID99 to GEOID18); the raw and adjusted water level columns are relative to the sensor. Adjusted values are corrected for drift and fouling after the fact, with no provisional flag. Records start in 1996; about 890 hourly water-level stations, 570 of them CRMS.
- **Overlap:** 12 CRMS sites with real-time telemetry are also in NWIS (`CRMS####-H01-RT`); the rest are CPRA's alone.
- **Terms:** a disclaimer only ("intended for general informational purposes only… CPRA does not warrant or guarantee its accuracy") and a requested citation. No license and no restriction on reuse. But `cims.coastal.la.gov/robots.txt` disallows all automated access.
- **Decision needed:** whether to read the weekly zip despite `robots.txt`, or ask CPRA (cpra-cims@usgs.gov) first. A weekly 1.3 GB download in Actions is workable; the data arrives weeks to months late, so the source would not run hourly.

## NCDEM (FIMAN)

- **Access:** fiman.nc.gov refuses automated requests (403). An open ArcGIS layer (`spartagis.ncem.org/arcgis/rest/services/FIMAN/GAGES_ALL/MapServer/0`) lists 889 gauges with owner and coastal flags and each gauge's latest reading, but no history. No history service was found.
- **Coverage:** 160 coastal gauges, of which NCEM owns 68, USGS 20 and NOAA 6; owner is a field, so copies can be filtered out.
- **Datum:** mixed and per gauge: the layer has `GAGE_DATUM` and an NGVD29-to-NAVD88 field, and its NAVD88 elevations are empty at the coastal gauges checked.
- **Terms:** none found. FIMAN's own pages couldn't be read.
- **Next:** ask fimanhelp@ncdps.gov for a history service and terms.

## NWFWMD

- **Access:** an AQUARIUS WebPortal behind a provisional-data click-through; the AQUARIUS Publish API answers 401. No public service.
- **Data:** times in UTC, real-time stage in NAVD88 since July 2023, provisional. The district's USGS-run gauges are in NWIS already.
- **Terms:** "Data are provisional and subject to revision… intended for resource management use", with no statement on redistribution.
- **Next:** ask the district, through the data-request contact its portal names, for access and terms.
