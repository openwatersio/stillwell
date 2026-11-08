# Source errata

Errors in what a source publishes, and what the lake does about each one. `stations.parquet` lists the errata that affect each station in `errata`, and [`errata.json`](https://water-levels.openwaters.io/errata.json) has this list. Each links to an issue that tracks the report to the agency. This file is generated from [src/errata.ts](../src/errata.ts) by `npm run errata`; see [CONTRIBUTING.md](../CONTRIBUTING.md#source-errata) to add one.

| Erratum | Source | Stations | Values | Lake | Reported | Issue |
| --- | --- | --- | --- | --- | --- | --- |
| [dwr-b95580-another-header](#dwr-b95580-another-header) | dwr | none listed | all | dropped | no | [#67](https://github.com/openwatersio/water-levels/issues/67) |
| [jma-saigo-1980-day-stamp](#jma-saigo-1980-day-stamp) | jma | `jma/SA` | 1980-10-21 to 1980-10-23 | corrected | no | [#58](https://github.com/openwatersio/water-levels/issues/58) |
| [pegelonline-download-api-differ](#pegelonline-download-api-differ) | pegelonline | `pegelonline/5990020`, `pegelonline/9530020` | all | kept | no | [#26](https://github.com/openwatersio/water-levels/issues/26) |
| [pegelonline-cuxhaven-2025-revised](#pegelonline-cuxhaven-2025-revised) | pegelonline | `pegelonline/5990020` | 2025-05-13 to 2025-06-25 | kept | no | [#26](https://github.com/openwatersio/water-levels/issues/26) |
| [marine-institute-coverage-start](#marine-institute-coverage-start) | marine-institute | every station | all | avoided | no | [#59](https://github.com/openwatersio/water-levels/issues/59) |
| [marine-institute-lat-2026](#marine-institute-lat-2026) | marine-institute | `marine-institute/aranmore-island-leabgarrow`, `marine-institute/ballycotton-harbour`, `marine-institute/ballyglass-harbour`, `marine-institute/buncranna`, `marine-institute/castletownbere-port`, `marine-institute/dingle-harbour`, `marine-institute/dublin-port`, `marine-institute/dunmore-east-harbour`, `marine-institute/galway-port`, `marine-institute/howth-water-level-1`, `marine-institute/inishmore`, `marine-institute/killybegs-port`, `marine-institute/kilrush-lough`, `marine-institute/malin-head-portmore-pier`, `marine-institute/rosslare`, `marine-institute/skerries-harbour`, `marine-institute/sligo`, `marine-institute/union-hall-harbor`, `marine-institute/wexford-harbour` | 2026-03-24 to now | kept | no | [#60](https://github.com/openwatersio/water-levels/issues/60) |
| [uhslc-hong-kong-hour-early](#uhslc-hong-kong-hour-early) | uhslc | `uhslc/329`, `uhslc/329a` | all | corrected | no | [#63](https://github.com/openwatersio/water-levels/issues/63) |
| [refmar-pointe-a-pitre-clock](#refmar-pointe-a-pitre-clock) | refmar | `refmar/125` | 2020-01-01 to 2025-01-01 | flagged | no | [#61](https://github.com/openwatersio/water-levels/issues/61) |
| [rws-ameland-westgat-twice](#rws-ameland-westgat-twice) | rws | `rws/ameland.westgat`, `rws/amelandwestgat` | all | kept | no | [#62](https://github.com/openwatersio/water-levels/issues/62) |
| [usace-baton-rouge-position](#usace-baton-rouge-position) | usace | `usace/MVN.Baton_Rouge` | all | kept | no | [#64](https://github.com/openwatersio/water-levels/issues/64) |
| [usace-placeholder-positions](#usace-placeholder-positions) | usace | none listed | all | dropped | no | [#65](https://github.com/openwatersio/water-levels/issues/65) |
| [usace-zero-elevation](#usace-zero-elevation) | usace | `usace/MVK.Baton_Rouge` | all | avoided | no | [#66](https://github.com/openwatersio/water-levels/issues/66) |
| [usace-lwrp-corrections-disagree](#usace-lwrp-corrections-disagree) | usace | none listed | all | avoided | no | [#10](https://github.com/openwatersio/water-levels/issues/10) |

## dwr-b95580-another-header

WDL's raw level file for San Joaquin River at Venice Island (B95580) carries the header of another station, B95500 (Middle River at Union Point).

**Lake:** A station is left out of the list when none of its files is usable, and a file that names another station isn't, so B95580 isn't in the lake until WDL fixes it.

## jma-saigo-1980-day-stamp

JMA's historical file for Saigo in October 1980 stamps its 22nd line as the 20th, between lines stamped the 21st and 23rd.

**Lake:** The line is read as the 22nd, since the lines on either side are stamped the 21st and 23rd.

## pegelonline-download-api-differ

At Cuxhaven Steubenhöft and Husum, PEGELONLINE's raw-data download and its REST API give different levels for the same minutes, by up to 6 and 8 cm, though both are labeled unchecked raw data on the same gauge zero.

**Lake:** History comes from the download and the last 31 days from the REST API, so the series can step by a few centimeters where one hands over to the other.

## pegelonline-cuxhaven-2025-revised

PEGELONLINE's download for Cuxhaven sits 4 to 6 cm above GESLA's copy from 13 May to 24 June 2025, so the WSV changed values it still labels raw and unchecked.

**Lake:** Kept as the download serves it.

## marine-institute-coverage-start

The dataset's `time_coverage_start` says 2000, but no gauge has values before October 2006.

**Lake:** Backfills start from each gauge's first value, not the dataset's coverage.

## marine-institute-lat-2026

On 24 March 2026 the network moved LAT by 1 to 5 cm at its gauges without noting it in the dataset; OD Malin is unbroken.

**Lake:** Levels are in OD Malin, unaffected. `datums` gives only the current LAT, so a level from before 24 March 2026 converted with it is on the new LAT, not the one in use then.

## uhslc-hong-kong-hour-early

UHSLC stamps its Hong Kong (Quarry Bay) hourly heights an hour early in every version and the fast-delivery series: the height labeled T was measured at T + 1 h UTC (tide-database#360, confirmed by the clock check).

**Lake:** Every value is moved an hour later.

## refmar-pointe-a-pitre-clock

SHOM's Pointe-à-Pitre levels run 60 to 70 minutes late in 2023 against UHSLC's, CMEMS's and REFMAR's own TICON records, and hardly fit at all in 2020 and 2024, with no steady offset; 2025 fits again.

**Lake:** 2020 to 2024 is flagged `suspect`, keeping SHOM's own flag as `source_flag`.

## rws-ameland-westgat-twice

RWS lists the Ameland Westgat gauge twice, as `ameland.westgat` and `amelandwestgat`, a few meters apart.

**Lake:** Both are kept as served, and linked in `same_as` as one gauge.

## usace-baton-rouge-position

The New Orleans District places its Baton Rouge gauge at 29.43° N, about 110 km south of the gauge, which the Vicksburg District places at 30.45° N.

**Lake:** Kept at MVN's position, so it isn't linked to MVK's copy.

## usace-placeholder-positions

Some CWMS locations sit at 0,0 or at a placeholder such as 9.09,9.09 (Anoka), and a few have the longitude's sign dropped (Buck Creek, Pine Bluff), which puts them in Asia.

**Lake:** Locations outside the contiguous US are left out.

## usace-zero-elevation

Some districts give an elevation of 0 to locations they have no elevation for, the same as a gauge set at the datum: MVK gives Baton Rouge 0, where MVN's description puts it 0.71 ft off. CWMS doesn't say which other zeros are real, so only Baton Rouge is listed.

**Lake:** An elevation of exactly 0 is ignored, so those gauges have no NGVD29 or NAVD88 offset.

## usace-lwrp-corrections-disagree

The New Orleans District's NAVD88 corrections for lower Mississippi gauges disagree between sources: at Donaldsonville the description gives −0.74 ft, rivergages −1.18 ft and the `rev-NAVD88` series −0.70 ft. Which of the district's gauges carry a correction is in prose only, so none is listed.

**Lake:** No LWRP or NAVD88 correction is published for these gauges until the district confirms which is right.
