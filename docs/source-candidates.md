# Source candidates

Every water level source researched for the store, with where it stands, so the same feed isn't researched twice. Each source is in one of four places: built, an open issue, researched without an issue yet, or not planned. Checked on 2026-11-15. Claims marked unverified come from search results or pages that blocked scripted requests.

A source goes in the public store when it allows republishing. Data that can't be republished stays out, or goes in the private store ([#190](https://github.com/openwatersio/stillwell/issues/190)). A new candidate is filed as an issue with the `source` label: what the source offers, its license, and a checklist of what to settle first.

## Built

Each has an adapter in `src/sources/<name>` and a README with its terms and datums. The [README](../README.md#sources) lists them with what each holds.

| Source                                                        | Covers                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| [bodc](../src/sources/bodc/README.md)                         | UK National Tide Gauge Network, quality controlled          |
| [bom](../src/sources/bom/README.md)                           | Australian Bureau of Meteorology, Australia and the Pacific |
| [bsh](../src/sources/bsh/README.md)                           | Germany, predictions                                        |
| [cdec](../src/sources/cdec/README.md)                         | California Delta and San Francisco Bay                      |
| [cmems](../src/sources/cmems/README.md)                       | Copernicus Marine in situ, about 65 national networks       |
| [coops](../src/sources/coops/README.md)                       | US National Water Level Observation Network                 |
| [crms](../src/sources/crms/README.md)                         | Louisiana coast                                             |
| [dmi](../src/sources/dmi/README.md)                           | Denmark                                                     |
| [dwr](../src/sources/dwr/README.md)                           | California Delta and Suisun Marsh                           |
| [ea](../src/sources/ea/README.md)                             | UK Environment Agency tide gauges                           |
| [gesla](../src/sources/gesla/README.md)                       | GESLA 4.1, a global archive from more than 40 agencies      |
| [jma](../src/sources/jma/README.md)                           | Japan Meteorological Agency                                 |
| [jodc](../src/sources/jodc/README.md)                         | Japan, Coast Guard, GSI and ports                           |
| [kartverket](../src/sources/kartverket/README.md)             | Norway                                                      |
| [linz](../src/sources/linz/README.md)                         | New Zealand tsunami gauges                                  |
| [marine-institute](../src/sources/marine-institute/README.md) | Irish National Tide Gauge Network                           |
| [pegelonline](../src/sources/pegelonline/README.md)           | German federal gauges                                       |
| [refmar](../src/sources/refmar/README.md)                     | France                                                      |
| [rws](../src/sources/rws/README.md)                           | Netherlands and the Caribbean Netherlands                   |
| [sfwmd](../src/sources/sfwmd/README.md)                       | South Florida                                               |
| [smhi](../src/sources/smhi/README.md)                         | Sweden                                                      |
| [uhslc](../src/sources/uhslc/README.md)                       | University of Hawaii Sea Level Center                       |
| [unam](../src/sources/unam/README.md)                         | Mexico, Servicio Mareográfico Nacional                      |
| [usace](../src/sources/usace/README.md)                       | US Army Corps of Engineers                                  |
| [usgs](../src/sources/usgs/README.md)                         | US Geological Survey                                        |

### In review

- Italy, ISPRA: [pull request 254](https://github.com/openwatersio/stillwell/pull/254), from [#241](https://github.com/openwatersio/stillwell/issues/241).
- England and Wales, Channel Coastal Observatory: [pull request 252](https://github.com/openwatersio/stillwell/pull/252), a draft that needs an API key, from [#244](https://github.com/openwatersio/stillwell/issues/244).

## Open issues

### Open license, checks left

| Issue                                                        | Source                                    | Stations and what's left                                                                                                            |
| ------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| [#181](https://github.com/openwatersio/stillwell/issues/181) | Spain: IGN                                | 10 gauges on an open HTTPS directory, citation requested.                                                                           |
| [#261](https://github.com/openwatersio/stillwell/issues/261) | Australia: Queensland tide gauges         | 9 live 1-minute files, CC BY 4.0. The archive downloads sit behind a bot challenge and need a browser to confirm. 27 GESLA records. |
| [#262](https://github.com/openwatersio/stillwell/issues/262) | Australia: Queensland coastal data system | 22 live estuary and island sites, 10-minute, CC BY 4.0. Datum and time zone unknown.                                                |
| [#264](https://github.com/openwatersio/stillwell/issues/264) | US: Hohonu community gauges               | About 100 live low-cost gauges on regional ERDDAP servers, "may be used and redistributed for free". The owners should confirm.     |
| [#267](https://github.com/openwatersio/stillwell/issues/267) | Scotland: SEPA                            | 13 tide gauges, 15-minute from 2016, Open Government Licence. Needs a registered key for the daily limit.                           |
| [#240](https://github.com/openwatersio/stillwell/issues/240) | Australia: BOM                            | The adapter is built. The issue tracks the held-back port, state and host-country gauges, and BOM's access and terms request.       |

### License question to settle

| Issue                                                        | Source                           | Stations and what's left                                                                                                      |
| ------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [#263](https://github.com/openwatersio/stillwell/issues/263) | Poland: IMGW                     | 17 Baltic gauges, 10-minute, no key. Business use needs a contract unless the data count as high-value.                       |
| [#265](https://github.com/openwatersio/stillwell/issues/265) | Hong Kong: tide stations         | 11 live stations. Commercial use allowed with attribution, but an indemnity clause. No history.                               |
| [#266](https://github.com/openwatersio/stillwell/issues/266) | Portugal: Instituto Hidrográfico | 35 live stations on an OGC API. CC BY-NC 4.0 and a 15-day window.                                                             |
| [#268](https://github.com/openwatersio/stillwell/issues/268) | Lithuania: LHMT                  | 3 stations, hourly, 30 days. CC BY-SA 4.0 needs checking against the store's terms.                                           |
| [#191](https://github.com/openwatersio/stillwell/issues/191) | Canada: ECCC hydrometric         | River and lake gauges under the Open Government Licence. Whether it covers the real-time files isn't confirmed.               |
| [#192](https://github.com/openwatersio/stillwell/issues/192) | Finland: FMI                     | Baltic gauges. The sea-level license hasn't been checked.                                                                     |
| [#241](https://github.com/openwatersio/stillwell/issues/241) | Italy: ISPRA                     | 39 GESLA records, CC BY 4.0, monthly 10-minute files for 2014 to 2022, unvalidated. License and datum confirmation requested. |

### Needs permission

| Issue                                                        | Source                                      | Why                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#47](https://github.com/openwatersio/stillwell/issues/47)   | Japan: JODC                                 | Its terms bar copying to third parties without permission.                                                                                        |
| [#48](https://github.com/openwatersio/stillwell/issues/48)   | Mexico: SMN                                 | The `unam` adapter reads the files, and the site allows only unaltered, non-profit reproduction, so republishing needs UNAM's written permission. |
| [#186](https://github.com/openwatersio/stillwell/issues/186) | Spain: Puertos del Estado                   | Terms limit use to the purpose of the download. 42 gauges, 1-minute.                                                                              |
| [#246](https://github.com/openwatersio/stillwell/issues/246) | Spain: IEO                                  | No public download. 12 GESLA records ending in 2016.                                                                                              |
| [#269](https://github.com/openwatersio/stillwell/issues/269) | Mexico: SEMAR                               | 1-minute monthly files, about two days behind, only recent months online, no license. 21 Mexican GESLA records have no originator series.         |
| [#51](https://github.com/openwatersio/stillwell/issues/51)   | North Carolina: FIMAN                       | 160 coastal gauges, latest reading only, site blocks scripts, no terms.                                                                           |
| [#52](https://github.com/openwatersio/stillwell/issues/52)   | Florida: NWFWMD                             | No public API, provisional data, no reuse terms.                                                                                                  |
| [#243](https://github.com/openwatersio/stillwell/issues/243) | Texas: Harris County Flood Control District | 17 GESLA records. No bulk download or license found.                                                                                              |
| [#245](https://github.com/openwatersio/stillwell/issues/245) | California: county flood agencies           | 12 GESLA records from five OneRain portals, no license.                                                                                           |
| [#247](https://github.com/openwatersio/stillwell/issues/247) | Ireland: Marine Institute river gauges      | A separate dataset with 3 tidal and 8 river gauges. One is an OPW station under CC BY 4.0.                                                        |
| [#248](https://github.com/openwatersio/stillwell/issues/248) | Iceland: Icelandic Coast Guard              | Reykjavik. The IOC feed stopped in March 2020, no public download.                                                                                |
| [#249](https://github.com/openwatersio/stillwell/issues/249) | Italy: Venice tide center                   | Hourly values since 1983. The pages block scripts and the license is unconfirmed.                                                                 |

### Not an observation feed or not republishable

| Issue                                                        | Source                                            | Why                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| [#190](https://github.com/openwatersio/stillwell/issues/190) | Global: IOC Sea Level Station Monitoring Facility | About 1,340 stations. Non-commercial and no republishing, so private store only. Chile, Taiwan, Indonesia and Peru have large uncovered counts. |
| [#193](https://github.com/openwatersio/stillwell/issues/193) | US: NWPS river forecasts                          | Forecasts and flood stages, which the schema doesn't hold yet.                                                                                  |

## Researched, no issue yet

Each of these lacks one fact, so there's no issue to file. The missing fact is in the last column.

| Source                                       | What's known                                                                                            | Missing                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Taiwan, Central Weather Administration       | 47 tide stations, free key, Open Government Data License 1.0 on a sibling dataset                       | The observation dataset ID and its interval                                    |
| South Korea, KHOA via data.go.kr             | About 54 stations, KOGL type 1, key                                                                     | The operation path, units and datum                                            |
| Turkey, TUDES                                | About 20 stations, 18 GESLA records with no originator                                                  | The site refused connections, so everything is unverified                      |
| Greece, HNHS                                 | 22 to 23 gauges, web only, 19 GESLA records that exist only through CMEMS                               | Terms, and a way to download                                                   |
| Greece, HCMR POSEIDON                        | A Swagger API, credentials by email to poseidon@hcmr.gr                                                 | License                                                                        |
| New Zealand regional councils                | Hilltop servers: Northland's Pouto Point (from 2001) and Wellington's Queens Wharf (from 1994) are live | License                                                                        |
| New South Wales, Manly Hydraulics Laboratory | About 30 GESLA records                                                                                  | The site blocks scripts, license "Not Specified"                               |
| Western Australia, Department of Transport   | 25 stations                                                                                             | Download needs a login, live data only as a map                                |
| Waikato Regional Council                     | 4 to 6 gauges                                                                                           | Files on request, no license                                                   |
| Ireland, OPW waterlevel.ie                   | CC BY 4.0, 15-minute, 2,032 features                                                                    | Which are tidal harbor gauges, and overlap with the Marine Institute           |
| Lower Saxony, NLWKN                          | 7 tidal gauges, 1-minute, DL-DE-BY 2.0                                                                  | Only 30 days of history                                                        |
| Schleswig-Holstein, LKN and LfU              | 102 North Sea gauge datasets, CC BY 4.0, back to 1984                                                   | The files hold only high and low water, and stop at the 2025 year-end          |
| Estonia, Latvia                              | About 21 and 9 coastal sites                                                                            | Web tables only, licenses unverified                                           |
| Belgium, Flanders                            | Meetnet Vlaamse Banken                                                                                  | Needs an account, returns 401                                                  |
| Spain, SOCIB Balearics                       | 6 to 7 gauges, two on Zenodo under CC BY 4.0                                                            | The API needs a key and its terms weren't read                                 |
| Romania, INFP GeoBS; Slovenia, ARSO          | Constanta at 10 seconds; Koper every 30 minutes                                                         | Reuse terms                                                                    |
| Alaska Water Level Watch                     | 18 non-NOAA stations on an Axiom portal                                                                 | License                                                                        |
| Hakai Institute, British Columbia            | 2 stations on ERDDAP, CC BY 4.0                                                                         | Whether it is still reporting, its ERDDAP didn't respond                       |
| Ocean Networks Canada                        | CC BY 4.0 per its own paper                                                                             | Needs a token, device list unchecked                                           |
| Colombia, DIMAR RedMPomm                     | 37 stations                                                                                             | No public API                                                                  |
| Chile SHOA, Brazil Navy BNDO                 | Their pages block scripts                                                                               | Take them through the IOC feed, #190                                           |
| Brazil IBGE RMPG                             | 6 to 7 tide gauges, 1-minute daily zips                                                                 | Files lag by weeks, terms unverified                                           |
| Argentina, INA                               | 1,144 gage-height series including the SHN's tide gauges                                                | No terms found                                                                 |
| Colombia IDEAM, Brazil ANA                   | Large open river-gauge networks: 395 and 5,474 stations                                                 | River stage rather than tide, so the store needs to decide whether it wants it |
| NDBC DART tsunameters                        | 45 reporting stations, 15-minute, open files                                                            | Deep-ocean bottom pressure, not a level above a datum, and no stated license   |

## Not planned

| Source                                                                                               | Reason                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| CHS and MEDS, Canada                                                                                 | The license forbids re-serving. 863 GESLA records have no originator series because of it.                                                 |
| IOC SLSMF                                                                                            | Non-commercial and no republishing, so it stays out of the public store, see [#190](https://github.com/openwatersio/stillwell/issues/190). |
| SONEL                                                                                                | No redistribution.                                                                                                                         |
| NERRS, US                                                                                            | Its page says the data "should not be archived by outside sources for distribution".                                                       |
| Panama Canal Authority, Gatun                                                                        | Redistribution needs written consent.                                                                                                      |
| Hydro-Québec                                                                                         | CC BY-NC, and the data are flows.                                                                                                          |
| TCOON, Texas                                                                                         | CO-OPS already serves the gauges.                                                                                                          |
| GSI Japan tide gauges                                                                                | Observation ended in December 2025, and the history is in [#47](https://github.com/openwatersio/stillwell/issues/47).                      |
| EMODnet Physics ERDDAP                                                                               | Stale since November 2024, CC BY-SA.                                                                                                       |
| JRC WebCritech TAD relay                                                                             | No license, and its Malta, NOA, Turkey and Indonesia data are stale.                                                                       |
| SmartAtlantic                                                                                        | The network has ended.                                                                                                                     |
| PSMSL monthly means and GNSS-IR                                                                      | Monthly means have no hourly values. GNSS-IR gives irregular ellipsoidal heights, license unverified.                                      |
| PSMSL CME Caribbean                                                                                  | 3 stations, stale since about 2018.                                                                                                        |
| SHELDA                                                                                               | It derives from IOC data, so the originators' terms apply.                                                                                 |
| NCEI PTWC and NTWC                                                                                   | A delayed archive of 13 Hawaii gauges plus NTWC, CC0. Too little to build.                                                                 |
| Antarctic data centers                                                                               | The licenses conflict and the records are historic.                                                                                        |
| GESLA's archival contributors DA_*, ESEAS, GLOSS and NOC                                             | Each holds one or two gauges and no feed.                                                                                                  |
| Greenland (Aasiaat, Maniitsoq) and Russia's Gulf of Finland (Kronstadt, St Petersburg, Hogland, S73) | GESLA holds them and no open source was found.                                                                                             |
