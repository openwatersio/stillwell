# Implementation plan

How this repo becomes the water-level store and API ([api.md](api.md) has the API design): observed, predicted, residual and modeled water levels for tide, lake and river gauges, in one schema with a datum and a license per station, stored as Parquet on R2, served at `api.openwaters.io` and published as open bulk snapshots.

It also replaces GESLA and TICON as slackwater-database's source of observations. TICON's constants and GESLA's records have carried too many errors (local time labeled as UTC at WSV and RWS, Hong Kong an hour early, JODC year-end truncation, swapped constituent definitions), and they update about once a year. slackwater-database should re-fit harmonics and reduce datums from records fetched from each originator, with correct UTC clocks, QC flags and provenance, refreshed continuously.

## Where it stands

- Adapters for the 19 sources the [README](../../README.md#sources) lists, writing to the store on R2, with each source's station list, datum epochs and links between sources in the store ([stations.md](../stations.md)).
- Scheduled jobs in GitHub Actions: hourly ingest into `recent/`, a nightly fold into the year files, a monthly refresh of station lists and refetch of values sources finalize, and a weekly canary. [CONTRIBUTING.md](../../CONTRIBUTING.md) covers them.
- Offsets to MSL, LAT and chart datum from slackwater-database or a linked series of the gauge ([data.md](../data.md#stations)).
- QC with per-station tidal analysis and errata per source ([qc/](../qc/README.md)).
- An HRoI implementation and evaluation against BSH predictions and RWS observations ([hroi-evaluation.md](../hroi-evaluation.md)).
- No API yet.

What the existing Open Waters pieces give us, and don't:

- **Gateway.** `api.openwaters.io` routes by path prefix to each service (`/tides*`, `/bathymetry*`), with no `/v1` prefix. Tokens and plans exist only for AIS, so the entitlements the architecture doc assumed don't exist yet.
- **Predictions.** The tides worker bundles `@slackwater/engine` and `@slackwater/database`. Residual code is on the unmerged `slackwater` branch `engine/hourly-water-level-residuals` ([slackwater#394](https://github.com/openwatersio/slackwater/issues/394), [#396](https://github.com/openwatersio/slackwater/issues/396)).
- **slackwater-database** has per-record `license: {type, commercial_use, url, notes}`, per-source `metadata.yaml` (credit, license, terms, modifications), datums per station (`datums`, `chart_datum`, `epoch`), the GESLA mirror on R2 and the GESLA clock fixes ([`sources/ticon/samples.ts`](https://github.com/openwatersio/slackwater-database/blob/main/sources/ticon/samples.ts): WSV in Europe/Berlin, RWS in Europe/Amsterdam with a 1 h shift, Hong Kong UHSLC +1 h). Station IDs are `source/id`.
- **crowd-depth** reduces soundings with predicted tide from the nearest commercial-use station plus a CO-OPS residual from a gauge within 100 km ([`packages/grid/src/grid/tide.py`](https://github.com/openwatersio/crowd-depth/blob/main/packages/grid/src/grid/tide.py), cache in [`cache.py`](https://github.com/openwatersio/crowd-depth/blob/main/packages/grid/src/grid/cache.py)). It reads R2 with DuckDB through `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Its plan wants a slow residual from a gauge within a few hundred km and a fast one within about 100 km.

## Use cases

Each consumer, what it needs from the store, and which path serves it. "Live" is the on-request path in decision 9; "archive" is the scheduled Parquet on R2.

| Use case                                                                                                                                                    | Freshness              | Window                            | Datum                                  | Licenses                                 | Path                                          | Phase    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------- | -------------------------------------- | ---------------------------------------- | --------------------------------------------- | -------- |
| crowd-depth sounding reduction                                                                                                                              | Days                   | Years, a point and time           | Chart datum                            | Commercial only                          | Archive through DuckDB, then `at`             | 3, 10    |
| slackwater-database re-fits and datums (decision 7)                                                                                                         | Monthly                | Whole record, up to 19 years      | Gauge zero, consistent over the record | Restricted allowed for derived constants | Archive through DuckDB                        | 5, 6     |
| Slackwater iOS and Android: observed level and residual on a tide station ([slackwater-ios#705](https://github.com/openwatersio/slackwater-ios/issues/705)) | Minutes                | Last 96 h                         | The bundled prediction's frame         | Commercial only; CHS stays on the device | Live, by slackwater-database ID               | 9        |
| Anomaly and surge alerts at favorite stations ([slackwater#394](https://github.com/openwatersio/slackwater/issues/394))                                     | Minutes, on a schedule | Last 96 h                         | Same as the app                        | Commercial only                          | The live fetch, run from a cron               | 10       |
| signalk-tides `heightNow`, Home Assistant                                                                                                                   | Minutes                | Last hours                        | Chart datum                            | Commercial only until tokens exist       | Live                                          | 9        |
| Website station pages, including rivers and lakes                                                                                                           | Minutes                | Days                              | Station and chart datum                | Commercial only                          | Live and archive                              | 10       |
| Correcting future tides from recent residuals ([slackwater#397](https://github.com/openwatersio/slackwater/issues/397), noaa-water-level-research)          | Minutes                | Weeks to years                    | Prediction frame                       | Commercial only                          | Archive, with each observation's arrival time | 4        |
| Public API customers, later the paid tier                                                                                                                   | Minutes                | Any                               | Any supported                          | By token, later                          | Live and archive                              | 10       |
| Crowd-derived tide stations from boats at rest ([slackwater-database#331](https://github.com/openwatersio/slackwater-database/pull/331))                    | Days                   | The hours of each at-rest episode | The reference gauge's datum            | Commercial only                          | Archive, by nearby gauge or `at`              | 3, 10    |
| Researchers                                                                                                                                                 | Quarterly              | Everything cleared                | Station datum with offsets             | Cleared                                  | Bulk snapshots with a DOI                     | 12       |
| BSH and RWS predictions as reference data (HRoI)                                                                                                            | Yearly                 | A year ahead                      | Gauge zero                             | Per source                               | Archive                                       | Parallel |

## Decisions

Recommended answers. The plan below assumes them; each can change without reshaping the work.

1. **Non-commercial data, such as the UHSLC gauges whose contributors bar commercial use, stays out of the API until tokens exist.** Data a source lets anyone republish goes in the public store whatever its commercial terms, and `stations.parquet` carries `commercial_use` per station for the API and products to filter on; only data whose source bars republishing goes in a separate private store for research and QC. That removes the entitlement dependency from the first public API, and the predicate is already in the data when tokens arrive.
2. **The API is open and unauthenticated at launch**, like tides, with the same per-IP rate limits. Tokens and the commercial tier come when the tides API gets them, not before.
3. **Paths follow the gateway's convention**: `/water-levels/...`, not `/v1/water-levels/...`.
4. **IDs are `<source>/<source_id>`** (`coops/9447130`, `usgs/07022000`, `rws/hoekvanholland`), the same form as slackwater-database's station IDs and the API's `/stations/{source}/{id}` paths. Station lists, datum epochs and links between sources live in the store, as [stations.md](../stations.md) describes. Each station carries `tide_station` with the slackwater-database `source/id` when one exists, and the link also runs the other way: slackwater-database station records carry their store series ID, and subordinate stations their reference gauge's, so an offline app knows which stations have observations without asking. Links join the same physical gauge, never the nearest one.
5. **Bulk snapshots ship with the public API**, quarterly, with a Zenodo DOI, in two parts: the stations with `commercial_use` true, and the rest, leaving out any station with data, in any epoch, from a contributor that hasn't answered a permission request, or whose terms are unknown (`unscanned` or `unreviewed`), since a published deposit can't be withdrawn. The commercial part is CC BY 4.0, with `sources.json` in the deposit so each source's license and terms travel with it; the rest's Zenodo license is "other", pointing to the README's license section, since each of its stations keeps its contributor's terms.
6. **The API worker lives in this repo** and is bound into the gateway as `WATER_LEVELS`, so adapters, schema and reader change together.
7. **Decided: slackwater-database keeps the harmonic fitting and datum reduction, and reads the store instead of GESLA.** Its fitting ([`packages/harmonic-analysis`](https://github.com/openwatersio/slackwater-database/tree/main/packages/harmonic-analysis)), constituent-name handling and datum rules ([`docs/datums.md`](https://github.com/openwatersio/slackwater-database/blob/main/docs/datums.md)) are already validated; porting them here would duplicate them. This repo's job is to be a better GESLA: originator records, fresh, in UTC, flagged, with provenance. Residuals from the store against slackwater-database's published constants then flag stations whose constants or clocks are wrong.
8. **Constants fitted from restricted observations can still ship** where the operator agrees, as VLIZ did for IOC-derived constituents. So restricted series feed slackwater-database fits even though the API doesn't serve them.
9. **Live levels are fetched on request, not polled into R2.** For the last 96 h of one station, the Worker calls the originator and caches the answer for the source's minimum interval (5 minutes for most, 15 for UK EA). Polling every linked gauge into per-station R2 objects every 10 minutes would be about 13 million writes a month (about $58), against $4 for the whole archive, and would mostly refresh stations nobody is looking at. The scheduled jobs build the archive; the same fetch code serves both.
10. **Apps compute residuals themselves.** The API returns observed levels in the bundled prediction's frame, and Slackwater computes the residual against the constants it ships, as slackwater-ios#705 plans, so the number always matches the curve on screen. The API's own residual is for the website, alerts and API customers, and names the database version it used.
11. **Observations keep their arrival time** (`received`) wherever we saw them arrive, because forecast correction needs to know what was available when, not just when it was measured.
12. **Decided: TypeScript for adapters, the store, QC and the API; Python only for NetCDF model extraction** (Brandon, 2026-11-03). Adapters must run in the Worker for live levels, and predictions come from `@slackwater/engine`, so one language serves ingest, live and the API. Model output (GTSM, STOFS) is NetCDF, which Node handles poorly, so phase 11 may use a small Python step that writes the same Parquet layout. Analysis in any language reads the store directly.

## Repo shape

[CONTRIBUTING.md](../../CONTRIBUTING.md) has the layout as it stands, and [`src/schema.ts`](../../src/schema.ts) the `Source` interface every adapter implements. The plan adds:

```
worker/                the API Worker: wrangler.jsonc, src/, test/ (phases 9 and 10)
scripts/snapshot.ts    quarterly bulk snapshots (phase 12)
.github/workflows/     snapshot-quarterly (phase 12)
```

Adapters run in two places: Node in Actions, and the Worker for live levels. So adapter code uses only `fetch` and plain TypeScript, with Node-only pieces (DuckDB, the disk cache) kept in [`src/store/`](../../src/store/) and [`scripts/`](../../scripts/). Live levels call `observations` for a short window; a bulk "latest" method for sources that offer one can come if per-station fetching is too slow.

## Data layout

[data.md](../data.md#layout) has the store's layout and columns. The plan adds:

```
models/stofs2d/<cycle>.parquet                   station-point nowcast and forecast (phase 11)
models/gtsm/<point>.parquet                      surge reanalysis at coastal points (phase 11)
bulk/<snapshot>/<source>.parquet                 quarterly, Hive-partitioned by year (phase 12)
```

Series whose source bars republishing go in a separate private bucket, since everything in the public one is public; ingest writes such a source only to `STILLWELL_RESTRICTED_STORE` and refuses without it.

## Phases

Ordered so crowd-depth and slackwater-database get what they need first, then the public product. Estimates are one person's working days, about 61 in all.

### Phase 0: Update the internal evaluation

Estimate: 1 day.

The internal evaluation describes a smaller system than this plan, so bring it in line before building, and keep it in line when a decision changes: the TICON replacement and live Slackwater levels, the build estimate (about 60 days, not four to six weeks), the live path and why, the gateway's lack of tokens and the `/water-levels` paths, the `received` column, the private store for restricted series, and the two-way station links with slackwater-database.

### Phase 1: Foundations

Estimate: 4 days.

- [x] [`src/schema.ts`](../../src/schema.ts) with the station and observation types, the `datums` map, and per-station license, commercial use and attribution.
- [x] The `Source` interface, with an adapter and README per source in `src/sources/<source>/`, fetching through [`src/http.ts`](../../src/http.ts) so it runs in a Worker.
- [x] [`src/store/`](../../src/store/): Parquet reader and writer for a directory or `s3://` URL, path helpers, and range merging that keeps first arrival times.
- [x] [`scripts/ingest.ts`](../../scripts/ingest.ts) with `stations`, `recent` and `backfill`; idempotent, so a rerun writes nothing.
- [x] Station lists in the store, one file per source with datum epochs, and `stations.parquet` built from them with `same_as` links made two-way ([stations.md](../stations.md)).
- [x] R2: the `water-levels` bucket, public at `stillwell.openwaters.io`, with a bucket-scoped token in the `lake` environment, which only runs on main.
- [x] QC v1 ([`src/qc.ts`](../../src/qc.ts)), with rules chosen per station by its measured tide ([stations.md](../stations.md#analysis)) and `requalify` to rerun QC over stored years without fetching again. On 127 tidal station-years from every public source ([qc/scripts/jumps.ts](../qc/scripts/jumps.ts)), residual jumps add 76 flags at 4: Jersey's 0.0 m before a gap, Kilrush Lough's four hours near −5.8 m, Este's 3.20 m before a gap and Bangor's clipped levels in 2005, with 11 values of water Este's barrier held between dropouts and 5 of Kilrush's noise; none in the storms and hurricanes the sample holds, nor at Hoek van Holland's seiches. On RWS 2024 at six tide gauges the rules before held levels add 14 flags, all real (a stuck sensor at Vlissingen, jumps at Bath), and none on a clean year. Held levels, on a year at each of 295 stations from every source: at Wangerooge's CMEMS copy in 2024 and 2025 they flag 105 of the 134 values QC passed that PEGELONLINE's copy shows more than 0.2 m off, and none of the rest; elsewhere 7 values at 2 stations, both a reading held while the level moved.
- [x] Tests: each adapter parses a committed fixture; the writer round-trips through DuckDB; merge and QC cases.
- [ ] A `restore` command for a station-list snapshot ([stations.md](../stations.md#a-refresh) has the steps by hand).
- [ ] `tide_station` and series pins in each source's `overrides`, which holds epoch decisions and splits only.

### Phase 2: TICON inventory

Estimate: 2 days.

[ticon-replacement.md](../ticon-replacement.md) gives the store source that can replace each of slackwater-database's TICON records, generated by `npm run ticon:inventory` from a slackwater-database checkout, with one row per record in [ticon-replacement.csv](../ticon-replacement.csv), and orders the work by accepted records per source.

- [x] Generate the inventory from slackwater-database's own provenance rules ([`sources/ticon/provenance.ts`](https://github.com/openwatersio/slackwater-database/blob/main/sources/ticon/provenance.ts)), the codes TICON ids carry, position and name matches against the store's station lists (never by name alone), and slackwater-database's station files, which group records of the same gauge.
- [x] Order the work by accepted records per source.
- [ ] The years each originator holds for each record. That comes from each adapter's backfill in phases 3 and 5; the CSV carries TICON's own fit period to compare against.

### Phase 3: US sources

Estimate: 6 days.

- [x] [CO-OPS](../../src/sources/coops/README.md), [USGS](../../src/sources/usgs/README.md) and [USACE](../../src/sources/usace/README.md) adapters.
- [x] Resumable backfill: `--skip-written`, `--first <file>` and `--shard i/n` ([CONTRIBUTING.md](../../CONTRIBUTING.md#running-ingest)).
- [ ] Backfill: CO-OPS's full history, and USGS and USACE river history for the crowd-depth basins, as a GitHub Actions matrix sharded by a hash of station IDs. Each process paces CO-OPS at a request a second and USGS at its key's rate, so shards running at once have to split those. Each also rewrites the source's bounds after every 100 stations, so shards running at once would lose each other's preliminary values; the matrix has to keep them from writing the bounds at once. The [CO-OPS](../../src/sources/coops/README.md) and [USGS](../../src/sources/usgs/README.md) READMEs have the request budgets.
- [ ] Dated NAVD88 and LWRP offsets for the lower-Mississippi gauges ([#10](https://github.com/openwatersio/stillwell/issues/10)). `datums` holds each MVN gauge's latest NAVD88 adjustment and LWRP offset from its description, for its whole record, but the adjustment changes with each survey, and the sources disagree on it. A data request to MVN asks for each gauge's dated datum history; with it, store an offset that can change on a date.

Done when crowd-depth can read observed stage and coastal levels for its Mississippi, Ohio and US coastal soundings from the store, and the 1,166 NOAA and USGS TICON records have their originator series.

### Phase 4: Scheduled ingest

Estimate: 3 days.

- [x] Hourly ingest into `recent/`, the nightly fold into year files with each station's bounds, the monthly refresh and refetch, run summaries, automatic issues for repeated failures, and the weekly canary ([CONTRIBUTING.md](../../CONTRIBUTING.md)). Measured against a logging S3 server, a year file costs DuckDB one PUT and four HEAD or GET requests, and USGS's 7-day recent file a five-request multipart upload, so the hourly and nightly jobs make about 430,000 Class A and 1.8 million Class B requests a month: inside R2's free tier, or under $3 a month without it. Folding rewrites each year file whole, so the work grows through the year: on year-end-sized files on local disk it took 27 ms a file for 15-minute series and 0.45 s for 1-minute ones at 16 connections, peaking at 2.5 GB of heap (4.1 GB resident).
- [ ] Now and then refetch approved USGS years and verified CO-OPS months too, with `--refetch`: USGS still fills gaps and revises values after approval, and the disk cache keeps an approved page for good. Nothing in the store says which approved years changed, so this is a whole-record campaign, about 200,000 USGS requests or nine days at USGS's rate, and it stays a manual Ingest run until there's a cheaper signal.

Done when every source's `recent/` is under 2 hours old and the year files fill in daily without anyone touching them.

### Phase 5: Originator records for TICON stations

Estimate: 12 days.

In the order phase 2 sets. Every adapter backfills the whole record its originator publishes, so a fit can use 19 years where they exist.

- [x] Adapters, backfilled through the Ingest workflow: [UHSLC](../../src/sources/uhslc/README.md), [Kartverket](../../src/sources/kartverket/README.md), [SMHI](../../src/sources/smhi/README.md), the [Marine Institute](../../src/sources/marine-institute/README.md), [REFMAR](../../src/sources/refmar/README.md), the [Environment Agency](../../src/sources/ea/README.md), [BODC](../../src/sources/bodc/README.md), [SFWMD](../../src/sources/sfwmd/README.md), [California DWR](../../src/sources/dwr/README.md), [CDEC](../../src/sources/cdec/README.md), [CRMS](../../src/sources/crms/README.md), [JMA](../../src/sources/jma/README.md), [PEGELONLINE](../../src/sources/pegelonline/README.md)'s raw-data download, and [GESLA 4.1](../../src/sources/gesla/README.md) as a fallback for the years and gauges no originator covers.
- [x] Deduplicate across sources with `same_as` and `preferred` ([stations.md](../stations.md#gauges-in-more-than-one-source)).
- [ ] **RWS** history at the 52 stations with no year files, and a `--refetch` of year files before 2026 in each NAP station's current epoch, so values from before the 2005 NAP revision sit in their own epoch ([RWS README](../../src/sources/rws/README.md)).
- [ ] **DMI** (`dmi`): register the source, refresh its list and backfill it ([its README](../../src/sources/dmi/README.md)). DMI's station endpoint lists every gauge; the adapter waits on handling stations whose owner changes between metadata periods. Then rerun `npm run ticon:inventory`.
- [ ] **CRMS** 2026: `backfill crms all 2026 2027` after CPRA's 15 November export.
- [ ] **GESLA**: confirm its backfill covers every record, and refetch its 40 CRMS records that are an hour early (erratum `gesla-crms-hour-early`), so the store holds them on CPRA's clock: `backfill gesla <the 40 IDs> 2006 2027 --refetch`, since `--skip-written` skips their written years.
- [ ] **Other US state networks**: FIMAN ([#51](https://github.com/openwatersio/stillwell/issues/51)) and NWFWMD ([#52](https://github.com/openwatersio/stillwell/issues/52)), whose terms or access need settling first.
- [ ] **JODC** and **UNAM**: both need permission before their data can be republished. JODC's terms forbid passing its data to third parties without permission, and UNAM's site allows only non-profit, unaltered reproduction, publishes only a 5-day window and names no datum. Then the case-by-case rest.
- [ ] **WSV history before 2000**, and gauges with a later start or no download: GESLA 4.1's WSV records cover them for now. Ask WSV or BfG for the archive where GESLA has gaps.
- [ ] Restricted series (Copernicus in situ, IOC) into the private store.
- [ ] Clock check on every new series: cross-correlate against the station's TICON prediction and against neighbors, and flag whole-hour offsets before anything fits to it. This is how the WSV, RWS and Hong Kong errors showed up. [`scripts/clock-check.ts`](../../scripts/clock-check.ts) does the TICON half for a station at a time, with K1's phase to catch 12-hour errors, and has checked 13 UHSLC series; neighbors, and running it on every new series, are still to do.
- [ ] Readers outside this repo that read series paths directly, slackwater-database and crowd-depth, read `epochs`, or they stop at epoch 1.

### Phase 6: slackwater-database reads the store

Estimate: 6 days, in slackwater-database.

- [ ] A sample reader in [`packages/harmonic-analysis`](https://github.com/openwatersio/slackwater-database/tree/main/packages/harmonic-analysis) that takes a store series ID and a period and returns samples, replacing `parseGeslaSamplesInZone` for converted contributors. DuckDB over `stillwell.openwaters.io` (and the private bucket for restricted series), cached like the GESLA zip.
- [ ] A `sources/water-levels` importer (or a switch inside `sources/ticon`) that re-fits a converted record from its store series and reduces datums from the same series, under the rules in [`docs/datums.md`](https://github.com/openwatersio/slackwater-database/blob/main/docs/datums.md).
- [ ] Gate each swap: fit on all but the last year, score the held-out year against the store, and swap only when the re-fit's RMS is no worse than TICON's published constants on the same year. Record both scores in the station's provenance.
- [ ] Convert contributor by contributor, in phase 2's order, with `report:merges` reviewing the result each time. A contributor whose records all convert drops out of the TICON import.
- [ ] A monthly residual report here: observed minus slackwater-database's prediction at every converted and unconverted station. Tidal-band energy in the residual means wrong constants; a step means a datum shift; a whole-hour phase lag means a clock error. Open an issue in slackwater-database for each.
- [ ] Link stations both ways: slackwater-database records gain the store series ID (subordinate stations take their reference gauge's), `@slackwater/database` exposes it, and the store's `tide_station` is filled from the same table.
- [ ] Record, per station, which store series and gauge zero its datums were reduced from, so the live path can return observations in the same frame as the prediction.
- [ ] Re-fit on a schedule (yearly, or when a station's record has grown by a year), so constants improve as the store grows instead of waiting for a TICON release.

Done when slackwater-database's monthly update re-fits from the store, and TICON supplies only the contributors that phase 2 marks as not replaceable yet.

### Phase 7: Datums

Estimate: 3 days.

- [x] [`src/datums.ts`](../../src/datums.ts): join each station to slackwater-database by provider ID and distance (never by name alone), and take MSL and LAT from its `datums` when the station has harmonics; otherwise use the source's own offsets.
- [x] Record where each offset came from (`datums_source`: source, slackwater-database, computed) and its epoch.
- [x] Per source: CO-OPS datums API; RWS NAP and MSL; BSH and PEGELONLINE PNP, NHN and SKN; USGS gage datum to NAVD88; USACE series datums.
- [x] Tests that convert a known level at a few stations to each datum and compare with the operator's published value.
- [ ] Offsets measured between linked series from their overlapping hourly values, run in `analyze`, so a series that shares a gauge's zero with a slackwater-database record, such as PEGELONLINE with WSV's GESLA files, gets its MSL and LAT. PEGELONLINE publishes only mean high and low tide for its tidal gauges, not a mean water level.

### Phase 8: Remaining real-time feeds

Estimate: 3 days.

Most European originators arrive in phase 5. This adds the real-time sources TICON doesn't need: UK EA river levels, **ECCC** hydrometric (OGL-Canada; confirm the datamart endpoint's license), and NWPS forecast metadata. FMI waits for a license check.

### Phase 9: Live levels for Slackwater

Estimate: 5 days.

The first public endpoint, because the apps need it before anything else in the API. It needs only phases 1 and 4 to start, so it can move ahead of phases 5 to 8; the datum-frame item waits for phase 6. It starts the Worker in `worker/`, bound into the gateway as `WATER_LEVELS` on `/water-levels*`.

- [ ] `GET /water-levels/stations/{source}/{id}/live` ([api.md](api.md#get-water-levelsstationssourceidlive)): observations in the requested datum (chart datum by default), `flag`, `received`, the offsets to MSL and chart datum, `as_of`, and `status` (reporting, stale, offline). Small JSON, gzipped, a few KB.
- [ ] `live()` for each source whose stations slackwater-database links to, starting with CO-OPS, RWS, PEGELONLINE, UK EA, Kartverket and the other European feeds. Each call runs the source's adapter in the Worker.
- [ ] Cache per station for `min_interval_s` with the Cache API, so a thousand phones on one station make one upstream call. Serve a stale copy with `status: stale` when the source fails, rather than an error.
- [ ] Quick QC on the window (spikes, flatlines, a gauge that stopped reporting) using the same [`src/qc.ts`](../../src/qc.ts) the archive uses.
- [ ] Datum frame: return the offset slackwater-database used for the station's datums (phase 6 records which series and zero those came from), so the app's residual is observed minus prediction in one frame. Stations whose datums are in the constituent frame (TICON's MSL = 0 fallback) get `frame: unknown`, and the app shows the trend only.
- [ ] Rate limits: phones on mobile networks share IP addresses, so give Slackwater's User-Agent its own allowance in the gateway rather than the open API's 100 a minute per IP.
- [ ] Slackwater: replace the per-provider fetchers in slackwater-ios#705 (NOAA now, more later) with this one call, keeping CHS on the device. Tracked in that issue.

Done when a Slackwater station page for a CO-OPS, RWS or PEGELONLINE gauge shows a level under 15 minutes old.

### Phase 10: API

Estimate: 8 days.

The rest of the API in the same Worker, reading R2 through a binding with `hyparquet` (pure JavaScript, range reads). Gated on a go or no-go decision on a public API, 90 days in; the live endpoint in phase 9 isn't, since Slackwater needs it either way.

- [ ] `GET /water-levels/stations` with the tides API's `query`, `latitude`, `longitude`, `maxDistance`, `maxResults` and `bbox`, plus `kind`, `source` and `tide_station`, from `stations.parquet` held in memory.
- [ ] `GET /water-levels/stations/{source}/{id}`: metadata, datums, license, attribution and freshness.
- [ ] `GET /water-levels/stations/{source}/{id}/levels` and `/extremes`, with `start`, `end`, `datum` (chart datum by default, as in the tides API), `units` and `include=predicted,residual,received`. Reads one file per year plus `recent/`, converts datums, adds Slackwater predictions with `@slackwater/engine` and `@slackwater/database` when `tide_station` is set, and the residual (observed minus predicted).
- [ ] `GET /water-levels/at?latitude&longitude&time`: best estimate with `method` and `uncertainty_m`. Nearest gauge with data at that time; else prediction plus residual from gauges within crowd-depth's distances (fast within about 100 km, slow within a few hundred); else prediction plus modeled surge; else model. Same rules crowd-depth uses today, so crowd-depth can switch to it.
- [ ] Every response carries per-station attribution and the "not for navigation, preliminary data" notice; until tokens exist, responses never include `commercial_use: false` stations. The API docs and the `/water-levels` root response link to the source, as AGPL section 13 requires.
- [ ] Historical years cached with the Cache API; `recent/` cached for 5 minutes.
- [ ] Alerts groundwork: a Worker cron that runs the live fetch and residual for a list of stations and reports the ones beyond a threshold. Who subscribes, and how notifications reach the phone, belongs in slackwater#394.
- [ ] OpenAPI document and a docs page on the website next to the tides API.
- [ ] Tests with `@cloudflare/vitest-pool-workers` against a small fixture store.

### Phase 11: Models

Estimate: 5 days.

- [ ] **STOFS-2D-Global** station output from `noaa-gestofs-pds` every 6 hours, nowcast and forecast. First list a day's files to size it.
- [ ] **GTSM** surge reanalysis at about 18,000 coastal points, 1950–2024, hourly (about 35 GB), from the CDS API: one-time backfill on a rented box.
- [ ] Map model points to stations and to the `at` endpoint's fallback.

### Phase 12: Bulk and launch

Estimate: 3 days.

- [ ] `snapshot-quarterly.yml`: cleared data into `bulk/<YYYY-Qn>/`, a manifest with checksums, and a Zenodo deposit for a DOI. Each row carries its datum epoch, and only rows inside their epoch's span go in.
- [ ] Data README: schema, flags, datums, licenses per source, how to query with DuckDB, Polars and pandas.
- [ ] Observed levels on the website's station pages, and `heightNow` in signalk-tides (in those repos).

### HRoI and the BSH track

In parallel with the phases above.

The [evaluation](../hroi-evaluation.md) found HRoI times high and low waters better than a harmonic curve fit at BSH gauges and at most Dutch gauges, and gives one event per semidiurnal cycle, which is the event-selection problem slackwater-database hit with RWS.

- [ ] Wait for BSH's answer on the 1 August rule ([slackwater-database#335](https://github.com/openwatersio/slackwater-database/issues/335)) before publishing anything fitted to BSH predictions.
- [ ] Ingest BSH predictions yearly from August into `predictions/bsh/` as reference data.
- [ ] Test HRoI against observed German levels from PEGELONLINE's history in the store, which reaches 2000 at most gauges.
- [ ] Learn BSH's per-gauge curve shapes instead of one mean curve (the Husum, Büsum and Papenburg gap).
- [ ] Propose HRoI extremes to `@slackwater/engine` as an event method for stations with a long extremes record, in a separate issue there.

## Out of scope

- **Water levels from vessels at rest** ([slackwater-database#331](https://github.com/openwatersio/slackwater-database/pull/331)). A boat's sounder at anchor tracks the tide where the range is large, but it isn't a gauge: it reads depth under a hull that swings around its anchor over a sloping bottom, with unknown draft, sensor offsets and settling, and no datum. Turning it into a water level means modeling the bottom and the vessel, which is crowd-depth's work, and scoring vessels, which the PR lists as a follow-up. The data is also personal (where someone anchors or lives aboard) and covered by crowd-depth's contributor terms, not an open license, and the stations move, which the station schema assumes they don't. What the PR proposes produces subordinate stations for slackwater-database, fitted against a reference gauge, not water-level series. So the store serves it as a consumer: observed levels at the reference gauge, so surge drops out of the fits (the PR's limitation that every fit is against a prediction). Revisit if validated crowd-derived stations need live or archived series of their own.
- **CHS data**, until CHS grants a commercial license (see open questions).
- **Full model grids.** Model output is stored at points only; grids stay where NOAA and Copernicus host them.

## Running costs and limits

As the architecture estimates: about $7 a month in year one on R2 and Workers, GitHub Actions free on a public repo, and a one-time backfill of $20–60 if GTSM and the USGS history need a rented box. Watch the CO-OPS throttle, RWS's 160,000-value limit, and that GitHub disables schedules on a repo with 60 days of no activity.

## Open questions

- BSH's answer on the 1 August rule.
- ECCC datamart license; FMI sea-level license.
- STOFS-2D station count and file sizes.
- PSMSL's reply on commercial redistribution (request sent 2026-11-01).
- Permission to republish from the UHSLC contributors whose own terms are stricter than UHSLC's: the Bureau of Meteorology and CSIRO, the Tide Gauge Inspectorate and DMI ([uhslc-contributors.md](../../src/sources/uhslc/contributors.md)). Their stations are public on UHSLC's terms until they answer. A refusal marks the contributor's notice `refused`, which withholds its stations, as SANHO's are ([#80](https://github.com/openwatersio/stillwell/issues/80)): never listed or fetched again, and their files and rows deleted ([CONTRIBUTING.md](../../CONTRIBUTING.md#withheld-stations)). Their `history/` snapshots still name them.
- Whether WSV or BfG will supply PEGELONLINE's archive before 2000, and whether they're content with scripted use of the raw-data download for a full backfill.
- Terms for FIMAN ([#51](https://github.com/openwatersio/stillwell/issues/51)) and NWFWMD ([#52](https://github.com/openwatersio/stillwell/issues/52)), BOM, and permission from JODC and UNAM.
- CHS: its reply on [slackwater-database#320](https://github.com/openwatersio/slackwater-database/issues/320) says any commercial use, derivatives included, needs a separate license, and it isn't taking new commercial requests while its licensing program (including the Value-Added Reseller Licence) is reviewed. Apply when the new options appear.
- The 304 TICON `meds` records are Canadian gauge data that slackwater-database marks CC BY 4.0 with commercial use, on TICON's label. Check whether CHS's terms reach them, the same question GESLA's license page raises.
