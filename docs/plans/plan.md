# Implementation plan

How this repo becomes the water-level store and API ([api.md](api.md) has the API design): observed, predicted, residual and modeled water levels for tide, lake and river gauges, in one schema with a datum and a license per station, stored as Parquet on R2, served at `api.openwaters.io` and published as open bulk snapshots.

It also becomes slackwater-database's source of harmonic constants and tidal datums, fitted here from each originator's record rather than taken from TICON, which was fitted to GESLA's copies. TICON's constants and GESLA's records have carried too many errors (local time labeled as UTC at WSV and RWS, Hong Kong an hour early, JODC year-end truncation, swapped constituent definitions), and they update about once a year. This repo fits harmonics and reduces datums from records fetched from each originator, with correct UTC clocks, QC flags and provenance, and publishes them as files in the store. slackwater-database reads those files, decides which fits ship, and packages them.

## Where it stands

- Adapters for the 19 sources the [README](../../README.md#sources) lists, writing to the store on R2, with each source's station list, datum epochs and links between sources in the store ([stations.md](../stations.md)).
- A poller on Cloudflare writing live values to D1 and the daily files under `recent/`, and scheduled jobs in GitHub Actions: a nightly fold into the year files, a monthly refresh of station lists and refetch of values sources finalize, and a weekly canary. [Operations](../contributing/operations.md) covers them.
- Offsets to MSL, LAT and chart datum from slackwater-database or a linked series of the gauge ([where offsets come from](https://openwatersio.github.io/stillwell/docs/guides/datums/#where-offsets-come-from)).
- QC with per-station tidal analysis and errata per source ([qc/](../qc/README.md)).
- An HRoI implementation and evaluation against BSH predictions and RWS observations ([hroi-evaluation.md](../hroi-evaluation.md)).
- No API yet.

What the existing Open Waters pieces give us, and don't:

- **Gateway.** `api.openwaters.io` routes by path prefix to each service (`/tides*`, `/bathymetry*`), with no `/v1` prefix. Tokens and plans exist only for AIS, so the entitlements the architecture doc assumed don't exist yet.
- **Predictions.** The tides worker bundles `@slackwater/engine` and `@slackwater/database`. Residual code is on the unmerged `slackwater` branch `engine/hourly-water-level-residuals` ([slackwater#394](https://github.com/openwatersio/slackwater/issues/394), [#396](https://github.com/openwatersio/slackwater/issues/396)).
- **slackwater-database** has per-record `license: {type, commercial_use, url, notes}`, per-source `metadata.yaml` (credit, license, terms, modifications), datums per station (`datums`, `chart_datum`, `epoch`), the GESLA mirror on R2 and the GESLA clock fixes ([`sources/ticon/samples.ts`](https://github.com/openwatersio/slackwater-database/blob/main/sources/ticon/samples.ts): WSV in Europe/Berlin, RWS in Europe/Amsterdam with a 1 h shift, Hong Kong UHSLC +1 h). Station IDs are `source/id`.
- **crowd-depth** reduces soundings with predicted tide from the nearest commercial-use station plus a CO-OPS residual from a gauge within 100 km ([`packages/grid/src/grid/tide.py`](https://github.com/openwatersio/crowd-depth/blob/main/packages/grid/src/grid/tide.py), cache in [`cache.py`](https://github.com/openwatersio/crowd-depth/blob/main/packages/grid/src/grid/cache.py)). It reads R2 with DuckDB through `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Its plan wants a slow residual from a gauge within a few hundred km and a fast one within about 100 km.

## Use cases

Each consumer, what it needs from the store, and which path serves it. "Live" is the realtime levels the Stillwell server polls, decision 9; "archive" is the scheduled Parquet on R2.

| Use case                                                                                                                                                    | Freshness              | Window                            | Datum                                  | Licenses                                 | Path                                          | Phase    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------- | -------------------------------------- | ---------------------------------------- | --------------------------------------------- | -------- |
| crowd-depth sounding reduction                                                                                                                              | Days                   | Years, a point and time           | Chart datum                            | Commercial only                          | Archive through DuckDB, then `at`             | 3, 10    |
| Harmonic fits and tidal datums, which slackwater-database packages (decision 7)                                                                             | Monthly                | Whole record, up to 19 years      | Gauge zero, consistent over the record | Restricted allowed for derived constants | Archive, then the fit files                   | 5, 6     |
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

1. **Non-commercial data, such as JODC's and UNAM's, stays out of the API until tokens exist.** Data a source lets anyone republish goes in the public store whatever its commercial terms, as does data whose permission to republish has been asked for, and `stations.parquet` carries `commercial_use` per station for the API and products to filter on; only data whose source bars republishing goes in a separate private store for research and QC. That removes the entitlement dependency from the first public API, and the predicate is already in the data when tokens arrive.
2. **The API is open and unauthenticated at launch**, like tides, with the same per-IP rate limits. Tokens and the commercial tier come when the tides API gets them, not before.
3. **Paths follow the gateway's convention**: `/water-levels/...`, not `/v1/water-levels/...`.
4. **IDs are `<source>/<source_id>`** (`coops/9447130`, `usgs/07022000`, `rws/hoekvanholland`), the same form as slackwater-database's station IDs and the API's `/stations/{source}/{id}` paths. Station lists, datum epochs and links between sources live in the store, as [stations.md](../stations.md) describes. Each station carries `tide_station` with the slackwater-database `source/id` when one exists, and the link also runs the other way: slackwater-database station records carry their store series ID, and subordinate stations their reference gauge's, so an offline app knows which stations have observations without asking. Links join the same physical gauge, never the nearest one.
5. **Bulk snapshots ship with the public API**, quarterly, with a Zenodo DOI, in two parts: the stations with `commercial_use` true, and the rest, leaving out any station with data, in any epoch, from a contributor that hasn't answered a permission request, or whose terms are unknown (`unscanned` or `unreviewed`), since a published deposit can't be withdrawn. The commercial part is CC BY 4.0, with `sources.json` in the deposit so each source's license and terms travel with it, and a link to each source's page on the site, which describes the source's own changes to its data; the rest's Zenodo license is "other", pointing to the README's license section, since each of its stations keeps its contributor's terms.
6. **The API lives in this repo**: a Worker bound into the gateway as `WATER_LEVELS`, so adapters, schema and reader change together.
7. **Decided: this repo fits harmonic constants and reduces tidal datums from its own series, and publishes them in the store. slackwater-database packages them** (Brandon, 2026-11-25). GESLA has TICON, constants fitted from its records and published as a dataset of their own; the store has its fits. The split:
   - **The fits are for any prediction engine**, UTide and XTide as much as `@slackwater/engine`. The method is the published one (least squares with nodal corrections in the design matrix, the Rayleigh and SNR rules), stated in the docs with its references, and the candidate list is data in this repo, by Doodson number.
   - **`@slackwater/engine` runs the fit while it is the best tool for it**, which the calibration shows against UTide on the same series, and not because it is ours.
   - **A fit carries the definitions it was fitted under, in terms any engine can read**: each constituent's speed, Doodson numbers and phase constant, phases as Greenwich lags in UTC, and the family of nodal corrections used (IHO's, Schureman's or Foreman's satellites). That is the contract between a fit and whatever predicts from it. No engine's catalog names or version are part of it; the tool and version that fitted are recorded as provenance.
   - **The fits use Schureman's nodal corrections**, as NOAA's analyses and the FES tide models do (Brandon, 2026-11-25). Engines differ in their corrections, so constants fitted under one family predict slightly differently under another, and for a few constituents, M1 among them, by a lot. Compared at five gauges from 9°N to 59°N, no family predicts a held-out year best everywhere, and every difference is about 1% of the residual or less, so the choice rests on Schureman's having a form for every astronomical constituent, being the same at every latitude, and lining up with the largest sets of constants to compare with. Each fit names its corrections, and constants under another family, such as Foreman's for t_tide and UTide, can be published beside these where a use calls for them.
   - **This repo decides what a fit reads and whether it can be trusted.** Which values count as final, each source's revision window, which flagged spans stay out, the checks before fitting, the fit's window, its score on a held-out year, and the datums reduced from the same series are all facts about a source and its data, so they live with the adapters, errata and QC.
   - **This repo measures, and sets no threshold for publishing.** Every series with enough final record is fitted and published with its measurements, whether or not anyone ships it. How much tide a station needs before it is worth predicting has no single answer: agencies publish tables at some gauges where the tide explains under a fifth of the tidal band's variance and none at others.
   - **slackwater-database decides what ships.** It reads the fit files, as it reads TICON's, and keeps its own gates on range and quality, the gate against TICON on the held-out scores, merges, the choice of chart datum, its license vocabulary, constituent definitions in the database format, and the TCD export. It reads no observations.
   - **Code another project imports goes in an MIT package**, in this repo or the engine's, as [CONTRIBUTING.md](../../CONTRIBUTING.md#license-and-cla) says. The fit files are data, under each station's own terms.
   - **A fit never checks the series it came from.** A clock or datum check needs a reference that doesn't share the series' clock: another originator's record of the gauge, a neighbor from another agency, or constants fitted elsewhere. Those checks run here, without slackwater-database's constants (phase 5).
8. **Constants fitted from restricted observations can still ship** where the operator agrees, as VLIZ did for IOC-derived constituents. So restricted series feed the fits even though the API doesn't serve them, and such a fit goes in the public store only once its operator has agreed.
9. **Current levels are polled continuously by one container into D1, and the API reads D1 for the last 8 days.** A poller in a Cloudflare Container polls every live station at its source's interval, merges the values it hasn't seen, runs QC, and writes D1 and the daily files `recent/<source>/<YYYY-MM-DD>.parquet` on R2; the API Worker reads D1 and the year files on R2, and never calls a source on a request. The Parquet files on R2 are the record and the public product. Store jobs run in GitHub Actions, and a Migrations workflow runs the store work each merged change needs. See [workers/live](../../workers/live/README.md) and [Operations](../contributing/operations.md).
10. **Apps compute residuals themselves.** The API returns observed levels in the bundled prediction's frame, and Slackwater computes the residual against the constants it ships, as slackwater-ios#705 plans, so the number always matches the curve on screen. The API's own residual is for the website, alerts and API customers, and names the database version it used.
11. **Observations keep their arrival time** (`received`) wherever we saw them arrive, because forecast correction needs to know what was available when, not just when it was measured.
12. **Decided: TypeScript for adapters, the store, QC and the API; Python only for NetCDF model extraction** (Brandon, 2026-11-03). Adapters, QC and the API share types and code, and predictions come from `@slackwater/engine`, so one language serves ingest and the API. Model output (GTSM, STOFS) is NetCDF, which Node handles poorly, so phase 11 may use a small Python step that writes the same Parquet layout. Analysis in any language reads the store directly.

## Repo shape

[CONTRIBUTING.md](../../CONTRIBUTING.md) has the layout as it stands, and [`src/schema.ts`](../../src/schema.ts) the `Source` interface every adapter implements. The plan adds:

```
workers/api/           the levels API's Worker, bound into the gateway (phases 9 and 10)
workers/live/          the poller's Worker, container and D1 database (phase 9)
server/                the poller, its passes and its daily-file export (phase 9)
src/fit/               which values a fit reads, the checks before it, the fit, its scores and the datums (phase 6)
scripts/snapshot.ts    quarterly bulk snapshots (phase 12)
.github/workflows/     the fits, as a step of Monthly's list job (phase 6); snapshot-quarterly (phase 12)
```

Adapters run in Node, in Actions and on the Stillwell server. Adapter code uses only `fetch` and plain TypeScript, with the store's pieces (DuckDB, the disk cache) kept in `src/store/` and `scripts/`.

## Data layout

[Files reference](https://openwatersio.github.io/stillwell/docs/reference/files/) has the store's layout and columns. The plan adds:

```
fits/<source>.parquet                            a row per fit: its window, the year files read and its scores (phase 6)
constituents/<source>.parquet                    a row per fit and candidate constituent, kept or not, with why (phase 6)
fits/references/<source>.parquet                 a row per fit and slackwater-database record of its gauge: the record's scores on the held-out year (phase 6)
fits/datums/<source>.parquet                     a row per fit with constants: its observed tidal datums and those of a prediction from its constants (phase 6)
models/stofs2d/<cycle>.parquet                   station-point nowcast and forecast (phase 11)
models/gtsm/<point>.parquet                      surge reanalysis at coastal points (phase 11)
bulk/<snapshot>/<source>.parquet                 quarterly, Hive-partitioned by year (phase 12)
```

Series whose source bars republishing go in a separate private bucket, since everything in the public one is public; ingest writes such a source only to `STILLWELL_RESTRICTED_STORE` and refuses without it.

## Phases

Ordered so crowd-depth and slackwater-database get what they need first, then the public product. Estimates are one person's working days, about 73 in all.

### Phase 0: Update the internal evaluation

Estimate: 1 day.

The internal evaluation describes a smaller system than this plan, so bring it in line before building, and keep it in line when a decision changes: re-fitting from originators' records and live Slackwater levels, fitting constants here rather than in slackwater-database, the build estimate (about 73 days, not four to six weeks), the realtime path and why, the gateway's lack of tokens and the `/water-levels` paths, the `received` column, the private store for restricted series, and the two-way station links with slackwater-database.

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
- [ ] `tide_station` and series pins in each source's `overrides`, which holds epoch decisions, splits and restarts only.

### Phase 2: TICON inventory

Estimate: 2 days.

The [TICON inventory](https://openwatersio.github.io/stillwell/reports/ticon-inventory/) gives the store source for the originator of each of slackwater-database's TICON records, where there is one, written by `npm run ticon:inventory` when the site builds, with one row per record in its CSV, and orders the work by accepted records per source.

- [x] Generate the inventory from slackwater-database's own provenance rules ([`sources/ticon/provenance.ts`](https://github.com/openwatersio/slackwater-database/blob/main/sources/ticon/provenance.ts)), the codes TICON ids carry, position and name matches against the store's station lists (never by name alone), and slackwater-database's station files, which group records of the same gauge.
- [x] Order the work by accepted records per source.
- [ ] The years each originator holds for each record. That comes from each adapter's backfill in phases 3 and 5; the CSV carries TICON's own fit period to compare against.

### Phase 3: US sources

Estimate: 6 days.

- [x] [CO-OPS](../../src/sources/coops/README.md), [USGS](../../src/sources/usgs/README.md) and [USACE](../../src/sources/usace/README.md) adapters.
- [x] Resumable backfill: `--skip-written`, `--first <file>` and `--shard i/n` ([Running ingest](../contributing/ingest.md)).
- [ ] Backfill: CO-OPS's full history, and USGS and USACE river history for the crowd-depth basins, as a GitHub Actions matrix sharded by a hash of station IDs. Each process paces CO-OPS at a request a second and USGS at its key's rate, so shards running at once have to split those. Each also rewrites the source's bounds after every 100 stations, so shards running at once would lose each other's preliminary values; the matrix has to keep them from writing the bounds at once. The [CO-OPS](../../src/sources/coops/README.md) and [USGS](../../src/sources/usgs/README.md) READMEs have the request budgets.
- [ ] Dated NAVD88 and LWRP offsets for the lower-Mississippi gauges ([#10](https://github.com/openwatersio/stillwell/issues/10)). `datums` holds each MVN gauge's latest NAVD88 adjustment and LWRP offset from its description, for its whole record, but the adjustment changes with each survey, and the sources disagree on it. A data request to MVN asks for each gauge's dated datum history; with it, store an offset that can change on a date.

Done when crowd-depth can read observed stage and coastal levels for its Mississippi, Ohio and US coastal soundings from the store, and the 1,166 NOAA and USGS TICON records have their originator series.

### Phase 4: Scheduled ingest

Estimate: 3 days.

- [x] Hourly ingest into `recent/`, the nightly fold into year files with each station's bounds, the monthly refresh and refetch, run summaries, automatic issues for repeated failures, and the weekly canary ([Operations](../contributing/operations.md)). Measured against a logging S3 server, a year file costs DuckDB one PUT and four HEAD or GET requests, and USGS's 7-day recent file a five-request multipart upload, so the hourly and nightly jobs make about 430,000 Class A and 1.8 million Class B requests a month: inside R2's free tier, or under $3 a month without it. Folding rewrites each year file whole, so the work grows through the year: on year-end-sized files on local disk it took 27 ms a file for 15-minute series and 0.45 s for 1-minute ones at 16 connections, peaking at 2.5 GB of heap (4.1 GB resident).
- [ ] Now and then refetch approved USGS years and verified CO-OPS months too, with `--refetch`: USGS still fills gaps and revises values after approval, and the disk cache keeps an approved page for good. Nothing in the store says which approved years changed, so this is a whole-record campaign, about 200,000 USGS requests or nine days at USGS's rate, and it stays a manual Ingest run until there's a cheaper signal.

Done when every source's `recent/` is under 2 hours old and the year files fill in daily without anyone touching them.

### Phase 5: Originator records for TICON stations

Estimate: 12 days.

In the order phase 2 sets. Every adapter backfills the whole record its originator publishes, so a fit can use 19 years where they exist.

- [x] Adapters, backfilled through the Ingest workflow: [UHSLC](../../src/sources/uhslc/README.md), [Kartverket](../../src/sources/kartverket/README.md), [SMHI](../../src/sources/smhi/README.md), the [Marine Institute](../../src/sources/marine-institute/README.md), [REFMAR](../../src/sources/refmar/README.md), the [Environment Agency](../../src/sources/ea/README.md), [BODC](../../src/sources/bodc/README.md), [SFWMD](../../src/sources/sfwmd/README.md), [California DWR](../../src/sources/dwr/README.md), [CDEC](../../src/sources/cdec/README.md), [CRMS](../../src/sources/crms/README.md), [JMA](../../src/sources/jma/README.md), [PEGELONLINE](../../src/sources/pegelonline/README.md)'s raw-data download, and [GESLA 4.1](../../src/sources/gesla/README.md) as a fallback for the years and gauges no originator covers.
- [x] Deduplicate across sources with `same_as` and `preferred` ([stations.md](../stations.md#gauges-in-more-than-one-source)).
- [ ] **RWS** history at the 52 stations with no year files, and a `--refetch` of year files before 2026 in each NAP station's current epoch, so values from before the 2005 NAP revision sit in their own epoch ([RWS README](../../src/sources/rws/README.md)).
- [ ] **DMI** (`dmi`): refresh its list and backfill it ([its README](../../src/sources/dmi/README.md)), then check its records in the [TICON inventory](https://openwatersio.github.io/stillwell/reports/ticon-inventory/).
- [ ] **CRMS** 2026: `backfill crms all 2026 2027` after CPRA's 15 November export.
- [ ] **GESLA**: confirm its backfill covers every record, and refetch its 40 CRMS records that are an hour early (erratum `gesla-crms-hour-early`), so the store holds them on CPRA's clock: `backfill gesla <the 40 IDs> 2006 2027 --refetch`, since `--skip-written` skips their written years.
- [ ] New sources, tracked as [issues labeled `source`](https://github.com/openwatersio/stillwell/issues?q=is%3Aissue%20state%3Aopen%20label%3Asource), each with what has to be settled before it can be built.
- [x] **JODC** (`jodc`): hourly levels above each station's zero at the 126 gauges of the Japan Coast Guard, GSI and port authorities JODC serves, back to 1910, in JST (UTC+3 at Syowa) converted to UTC, read from each station's zip, so the year-end hours TICON's copies lose are kept. JODC serves them openly, so they're in the public store, with `commercial_use` false: its terms ask for permission before its data is passed to third parties, which has been asked for ([#47](https://github.com/openwatersio/stillwell/issues/47)). See [the adapter's README](../../src/sources/jodc/README.md).
- [ ] Backfill JODC through the Ingest workflow (two runs, in its README), and again whenever JODC adds a year.
- [x] **BOM** (`bom`): hourly levels above each tide gauge zero at 31 gauges of the National Tidal Centre (16 Australian, 13 Pacific, Suva and Christmas Island), back to 1996, in UTC, from the yearly archives on BOM's anonymous FTP server, since its website refuses scripted requests. BOM's reply of 12 November 2026 ([#80](https://github.com/openwatersio/stillwell/issues/80)) allows use under its conditions of use, which are shown with the data; the store reads it as covering commercial use, as for UHSLC's copies of the same gauges, so they're in the public store with `commercial_use` true. They link to UHSLC's and GESLA's copies of the same gauges. See [the adapter's README](../../src/sources/bom/README.md).
- [ ] Backfill BOM through the Ingest workflow (two runs, in its README), and ask BOM to allow its website's ABSLMP CSVs and station sheets, which add the AHD offsets and Thursday Island ([#240](https://github.com/openwatersio/stillwell/issues/240)).
- [x] **UNAM** (`unam`): one-minute levels from each sensor at 26 of the Servicio Mareográfico Nacional's 27 gauges, a series per sensor above its own zero, in UTC, from the 5 days SMN serves, running hourly. SMN serves them openly but its site allows only non-profit, unaltered reproduction, so they're in the public store with `commercial_use` false while permission and the historical records are asked for ([#48](https://github.com/openwatersio/stillwell/issues/48)). The record starts when ingest starts reading; TICON's `unam_hist` records wait on SMN's answer. See [the adapter's README](../../src/sources/unam/README.md).
- [ ] **WSV history before 2000**, and gauges with a later start or no download: GESLA 4.1's WSV records cover them for now. Ask WSV or BfG for the archive where GESLA has gaps.
- [ ] Restricted series into the private store, for sources whose terms bar republishing.
- [ ] Clock check on every new series, before anything fits to it: cross-correlate against the station's TICON prediction and against neighbors, and flag whole-hour offsets. This is how the WSV, RWS and Hong Kong errors showed up. [`scripts/clock-check.ts`](../../scripts/clock-check.ts) does the TICON half for a station at a time, with K1's phase to catch 12-hour errors, and has checked 13 UHSLC series; neighbors, and running it on every new series, are still to do. A constant offset over a whole record shows in no yearly fit, so the check needs a reference from outside the series.
- [ ] A clock reference that needs no constants from slackwater-database: another originator's record of the gauge (`pair-check`), the phase a neighbor from another agency implies, and where neither exists an ocean tide model's constants at the gauge (see open questions). Constants fitted here never check the series they were fitted from. This is its own piece of work, and the fits in phase 6 don't wait for it.
- [ ] Readers outside this repo that read series paths directly, such as crowd-depth, read `epochs`, or they stop at epoch 1.

### Phase 6: Fits from the store

Estimate: 14 days here, and 4 in slackwater-database.

One pipeline fits every gauge that carries a tide, with a source's differences declared by its adapter. [Harmonic fits](../fits.md) has the method and its references: what a fit reads, the window, the candidate list, the Rayleigh and SNR rules, Sa and Ssa, nodal corrections, and the scores on a held-out year. The scoring is ported from slackwater-database's verification code, and that repo's side of this phase, reading the fit files and deciding what ships, is in its [plan for constituents](https://github.com/openwatersio/slackwater-database/blob/main/docs/plans/stillwell-constituents.md).

Definitions, before a fit is published:

- [ ] A definition format that names the nodal correction each constituent was fitted under, so a reader with another engine knows what it has ([slackwater-database#238](https://github.com/openwatersio/slackwater-database/issues/238)). slackwater-database's stored definitions can't carry M1's correction, so data fitted with it needs a pinned engine there. A fit's definitions are the contract only once that gap is closed.
- [ ] The candidate list as data in `src/fit/`, in priority order and by Doodson number: Foreman's, then the constituents NOAA's 37 and TICON's 50 add, with IHO's names and the spellings other tools use. A candidate the fitting engine can't fit, as `@slackwater/engine` can't Foreman's H1 and H2, is reported as left out.

What a fit reads:

- [ ] Each source that never finalizes its values declares its revision window, measured or stated by the source ([#526](https://github.com/openwatersio/stillwell/issues/526)), so "values the source won't revise again" has one definition, in the adapter. Until #526 gives PEGELONLINE a measured or stated window, its adapter declares a year settled once it ended 12 months before the run, on the evidence of erratum `pegelonline-cuxhaven-2025-revised`.
- [ ] A fit reads what the store's flags allow, and records every erratum touching the years it read. A value is `kept` only where its own evidence supports keeping it, and one no reader should use is `flagged`, so no consumer decides per erratum.
- [ ] One reader for fits in `src/fit/`: every epoch in the current datum, final values for constants and every measured value for datums, hourly instantaneous samples, and the version of each year file read. It reads the restricted store too.
- [ ] The filter behind any source's hourly values, and where each value is stamped in its interval, as source metadata, so a fit can correct amplitude and phase for it.
- [ ] Years another series of the same gauge holds and the originator's lacks, such as GESLA's older years. The reason the originator lacks them is found first. Only years the originator can't supply are joined, at an offset measured where the two series overlap ([slackwater-database#400](https://github.com/openwatersio/slackwater-database/issues/400)), and the fit names both series.
- [ ] A level comparison in `stations/matches.parquet` for every linked pair. A fit and a TICON record count as the same gauge only where their levels agree within 1 cm with no lag, and 142 linked pairs of PEGELONLINE and GESLA series, Brake's among them, have no comparison, so those fits can't be scored against or merged with TICON's records of the gauge.

Checks before fitting, which stop a fit or cut its series:

- [ ] A fit of each calendar year by itself, with one fixed set of constituents. M2's and K1's phase from year to year finds a whole-hour jump, a 12-hour error and a drifting clock inside one record. The scatter of M2, S2, K1 and O1 marks a river-influenced or changing gauge, and is kept with the fit.
- [ ] Datum steps, from yearly and monthly means against neighbors ([#112](https://github.com/openwatersio/stillwell/issues/112)). A step no epoch boundary explains stops the fit.

The fit:

- [ ] `src/fit/`: the whole window, up to 19 years before the held-out year, through the engine's `fit()` with robust weights, and the Rayleigh and SNR selection over the candidate list, which [`src/harmonic.ts`](../../src/harmonic.ts)'s `STANDARD` and `SHALLOW` lists give way to. QC, the tidal judgment and the cross-check then read a station's fit where it has one.
- [ ] More shallow-water candidates where the tide needs them. NOAA fits more than 100 constituents at Anchorage, HATYAN's set has 94, and Foreman lists 77 optional shallow-water constituents. The calibration measures a longer list at every gauge against one added only where the residual has energy in the quarter-diurnal and higher bands, and what either does to the constants of gauges with little shallow-water tide. [Residual spectra](../residual-spectra.md) measures whether that energy tells the gauges that gain.
- [ ] Measure two rules the fits don't apply: keeping a constituent under the signal-to-noise limit where its amplitude and phase agree between the yearly fits ([Parker 2007](https://tidesandcurrents.noaa.gov/publications/Tidal_Analysis_and_Predictions.pdf), pp. 165 and 308), and keeping M2, S2, K1 and O1 whatever their ratio.
- [ ] Measure fits of records under 183 days with P1 and K2 inferred from a neighbor's ratios ([Foreman 1977](https://waves-vagues.dfo-mpo.gc.ca/Library/54866.pdf)) against a longer record at the same gauges. Until then such a record gets a row with its reason and no constants.
- [ ] Sa and Ssa from the whole window and from each year, kept only where the mean is at least twice its standard error, with the spread recorded either way.
- [x] Observed tidal datums from the same series, into `fits/datums/<source>.parquet` ([Tidal datums](../fits.md#tidal-datums)), reduced by [`@slackwater/datums`](https://www.npmjs.com/package/@slackwater/datums) over the longest run of whole years of complete months each gauge has within the fit's window and the held-out year, the latest on a tie, which the row records. The store has no shared epoch for observed datums, since a gauge's latest years are the ones its current levels sit in and few gauges share any one span. The row names the series, the gauge zero and the epoch they were reduced in. HAT, LAT and the package's other datums of a prediction come from a synthesis of the fit's constants over 19 years, which anything holding the fit and its definitions can run. Another 19 years gives other extremes, so the synthesis runs over the epoch the package pins (`DATUM_EPOCH`, 2007 through 2025), and the row records it. Which datum is a station's chart datum, by country and by sea, stays in slackwater-database.
- [ ] Scores on the held-out year: tidal-band RMS, the share of the tidal band's variance the fit explains, energy by band, and the time and height of high and low waters, with one extremum picker.
- [x] The same code scores the constants slackwater-database holds for the gauge on the same year, from the pinned `@slackwater/database` release each score names, into `fits/references/<source>.parquet` ([Reference scores](../fits.md#reference-scores)). Those are slackwater-database's records, which include its own refits of mislabeled clocks, not TICON as published. Each score stores a digest of the constants it scored, and a new release that changes a linked record's digest scores it again, without fitting.
- [ ] Every series with enough final record is fitted, and its row carries what a consumer needs to set its own threshold: mean range, variance explained, each constituent's SNR and the yearly scatter. On one-off fits of 2021 to 2023 with a fixed set of 24 constituents, scored on 2024 as one minus the residual's variance over the observed levels', both after the Godin filter, the tide explains 92 to 95% of the tidal band's variance at NOAA's Gulf gauges, 31 to 38% in the Kattegat, 18% at Gedser, where DMI publishes tables, and 4 to 18% at German Baltic gauges, where BSH publishes none. A screen run here to save compute is named for its cost and never as a judgment that a gauge has no tide.
- [ ] A record too short to fit, or one a check stopped, gets a row that says why, and no constants.

What is published:

- [ ] `fits/<source>.parquet` and `constituents/<source>.parquet`, defined in [`src/store/files.ts`](../../src/store/files.ts) with the other published files: the window, the year files and their versions, which values counted as final, the engine's version, each candidate's amplitude, phase, intervals, SNR and selection verdict, the definition each constituent was fitted under, the yearly scatter and every held-out score, with the datums in a file of their own. A fit's terms are its station's, in `stations.parquet` by `id`: its license, commercial use and attribution.
- [ ] A superseded fit stays readable by its version, as year files do, so a database release can name the fit it shipped.
- [ ] A fit from a restricted series stays in the restricted store until its operator agrees to the constants being published (decision 8), as a field the source declares. slackwater-database reads only the public store.
- [ ] A page in the site's docs on reading the fits, and what each column means.
- [x] Calibration against NOAA: CO-OPS reference stations over NOAA's own analysis years and over the standard window against NOAA's published constants, in the [fit calibration](../results/fit-calibration.md), which is checked in and rerun when the method changes ([Checks](../contributing/checks.md#fit-calibration)).
- [ ] Calibration before any fit is published: the same against Kartverket's and JCG's constants, and RWS and PEGELONLINE against RWS's astronomical tide and BSH's tables, in the same report.
- [ ] What the [calibration against NOAA](../results/fit-calibration.md#summary) found, settled before any fit is published: the candidate list predicts worse than NOAA's own constituents at Anchorage, a large shallow-water tide, and the calibration measures what offering every fit NOAA's shallow-water compounds would do: it lowers the 19-year fit's held-out RMS at most gauges and raises it at a few over a window of five years, where a test of each compound's stability between yearly fits, as Sa and Ssa have, is the rule to try; robust weights raise amplitudes without a consistent gain on the held-out year; the lines NOAA calls M1 and 2MK3 are held as NO1 and MO3, with those names' node factors; L2 depends on whether the years are fitted together, which a measure of 2MN2 at the shallow gauges would explain or rule out; NOAA's own method doesn't give NOAA's constants at Boston, and the calibration doesn't find why; and `@slackwater/engine`'s catalog reads NOAA's 4MSL12 as 6MSN12, half a cycle away, so that constituent is left out of what the calibration fits and predicts as NOAA's.
- [ ] The same calibration series fitted with UTide, and the constants and held-out scores compared with `@slackwater/engine`'s. Where UTide fits better, the fit moves to it or the engine is fixed first. UTide is Python, so this check is a Python step beside the one decision 12 allows.
- [ ] Each published fit's constants predicted over the held-out year with UTide and with XTide, from the fit files alone, and the difference from `@slackwater/engine`'s prediction reported per station. UTide predicts only the constituents in its own table, with Foreman's corrections, so its comparison covers the constituents it defines as the fit does, and the rest are listed by name with the fit and not counted as differences. XTide reads each constituent's speed, equilibrium arguments and node factors from a TCD file, so its comparison tests the tables built from the fit's definitions, within libtcd's limit of 255 constituents a file.
- [ ] The calibration report also gives the variance explained at gauges across regimes, from the Gulf of Mexico to the Great Lakes and the Baltic, so those figures come from checked-in code. The [fit calibration](../results/fit-calibration.md#variance-explained) gives it for its CO-OPS gauges, the Gulf of Mexico's among them.

Running:

- [x] A step of Monthly's list job that fits the stations whose fit is due, when a year file it read has a new version, its record has grown by a year or anything else it depends on has changed, so constants follow the store instead of a TICON release. It works within a budget, the largest tides first, and only at a source with a station that has constants.
- [ ] A first fit of each source from the Ingest workflow, once the calibration covers it. A source with more stations than a month's budget reaches takes several runs.
- [ ] A monthly residual report: observed minus predicted at every station with constants, from a fit here or from slackwater-database through `tide_station`. Tidal-band energy in the residual means wrong constants; a step means a datum shift; a whole-hour phase lag means a clock error.

In slackwater-database:

- [ ] `sources/stillwell` reads the fit files into station records, in place of fitting. Its reader of observations, its errata decisions and its settle cutoff go away.
- [ ] Each record pins the version of the fit it was built from, and the monthly update arrives as a pull request to review, as the NOAA import's does.
- [ ] It applies its own gates to the fit's measurements, such as its 2 cm range gate, and keeps the gate against TICON: a fit replaces a TICON record of the same gauge when the published scores say it predicts the held-out year no worse, by `decideHeldOut`, and TICON stays where a score was taken against constants that have since changed.
- [ ] Convert contributor by contributor, in phase 2's order, with `report:merges` reviewing the result each time. A contributor whose records all convert drops out of the TICON import.
- [ ] Link stations both ways: slackwater-database records gain the store series ID (subordinate stations take their reference gauge's), `@slackwater/database` exposes it, and the store's `tide_station` is filled from the same table.

Done when Monthly fits every source with tidal gauges, slackwater-database's monthly update builds from the fit files without reading an observation, and TICON supplies only the contributors whose originators phase 2 finds the store can't serve yet.

### Phase 7: Datums

Estimate: 3 days.

- [x] [`src/datums.ts`](../../src/datums.ts): join each station to slackwater-database by provider ID and distance (never by name alone), and take MSL and LAT from its `datums` when the station has harmonics; otherwise use the source's own offsets.
- [x] Record where each offset came from (`datums_source`: source, slackwater-database, computed) and its epoch.
- [x] Per source: CO-OPS datums API; RWS NAP and MSL; BSH and PEGELONLINE PNP, NHN and SKN; USGS gage datum to NAVD88; USACE series datums.
- [x] Tests that convert a known level at a few stations to each datum and compare with the operator's published value.
- [x] Offsets measured between linked series from their overlapping levels, in their own monthly job, so a series that shares a gauge's zero with a slackwater-database record, such as PEGELONLINE with WSV's GESLA files, gets its MSL and LAT. PEGELONLINE publishes only mean high and low tide for its tidal gauges, not a mean water level.
- [ ] Official harmonic constants, with the datums and epochs the agency publishes with them, imported beside the fits, CO-OPS first ([Datums go with their harmonics](#datums-go-with-their-harmonics)).
- [ ] A station's `datums` from the set of constants it's published with, its fit first, and each agency's chart datum named with its epoch ([Datums go with their harmonics](#datums-go-with-their-harmonics)).

#### Datums go with their harmonics

A set of datums belongs to the constants it was reduced or predicted with, and the two are published together. The store's own fit and its datums (`fits/<source>.parquet`, `constituents/<source>.parquet`, `fits/datums/<source>.parquet`) are the primary set for every fitted station. An agency's harmonic constants, where it publishes any, are imported and listed beside the fit with the datums and epochs the agency publishes with them. No value crosses from one set to the other. Every set is in heights on the zero of the station's stored levels, so the difference between any two is a translation between them: our MLLW less NOAA's 1983–2001 MLLW, for instance.

**Official constants.** `fits/official/<source>.parquet` holds one row per station an agency publishes constants for: the agency's analysis period, its datums as heights on the station's zero with each datum's epoch, when it was published, and the agency's terms. `constituents/official/<source>.parquet` holds the constants. Each source's adapter reads its agency's own publication, as it reads its levels. The agencies behind the store's sources that publish constants:

- **CO-OPS**: harmonic constituents and datums for its harmonic stations, the datums on the 1983–2001 National Tidal Datum Epoch.
- **Kartverket**: constituents analysed over 2006–2020 for its 33 public stations, and `stationlevels`, whose MSL is the 1996–2014 mean.
- **LINZ**: one analysis per site, every year at major ports and every three years at the rest.
- **JMA**: 60-constituent tables for 70 stations, reissued each year.
- **The Japan Coast Guard (JHOD)**: 60-constituent tables for 20 of its gauges, which are `jodc` stations with `HD` codes.

DMI publishes predictions, not constants, and slackwater-database's RWS and WSV records are its own fits. slackwater-database's importers for these agencies are the reference for each adapter's reader.

**What `datums` holds.** A station's `datums` in `stations.parquet` holds one set of tidal datums, from the constants the station is published with, taken whole:

1. its fit, where it has one with observed datums (`reason` null) on its current epoch (`datums_source: fit`);
2. otherwise the agency's official set (`official`);
3. otherwise its slackwater-database record's, which are reduced and predicted with that record's constants (`slackwater-database`);
4. otherwise the datums the source gives without constants, as CO-OPS does for some water-level stations (`source`);
5. otherwise the set of a linked series of the gauge, carried whole (`computed`), as [`src/links.ts`](../../src/links.ts) carries MSL and LAT today.

Height systems, the names outside `TIDAL_DATUMS` in [`src/datums.ts`](../../src/datums.ts) such as NAVD88, NN2000, NHN and AHD, come from the source beside whichever set the station has. `datums_epoch` gives each value's years: a fit's observed window for its observed datums and the synthesis's years for HAT and LAT, an agency's epoch for its own. A station with no set has only its height systems, as today. `fits/official` lists the agency's set beside every station's, whichever set `datums` holds.

**Chart datum.** Charts are drawn on the agency's chart datum as the agency fixed it, so `chart_datum` names that surface and `datums` carries it as a named reference, beside the set and not a member of it. Where the agency's chart datum shares its name with a datum in the set, its name carries the agency's epoch, as `NAVD88(...)` carries a realization: `MLLW(1983-2001)` at a CO-OPS gauge, beside the fit's `MLLW`, or the source's ID where the agency gives no epoch, as `LAT(marine-institute)`. Where the chart datum is a fixed surface with a name of its own, such as Kartverket's CD, which is also the zero of its levels, BSH's SKN or REFMAR's ZH, it keeps its name. So `datums[chart_datum] − datums.MLLW` at a fitted CO-OPS gauge is the translation from our MLLW to the chart's, and at an unfitted one it's zero. Where no agency fixes a chart datum's height, `chart_datum` names the datum slackwater-database's country policy picks, as today, and its value is the set's.

**What each reader sees.**

- **Levels API**: its default is `chart_datum`, through `stations/offsets.parquet`, so default levels stay on the surface charts use at every station that has one. `?datum=MLLW` at a fitted CO-OPS gauge gives levels above our MLLW, and `?datum=MLLW(1983-2001)` above NOAA's. Offsets rows for the named references come from `offsetRows` as every other name's do.
- **crowd-depth**: in Stillwell mode it reads `datums[chart_datum]` and MHHW less MLLW for each CO-OPS gauge, and takes its residuals in MLLW, or MSL where there's none, taking a final month again whenever a station's datums change. `datums[chart_datum]` follows the rename on its own. Its residuals in `MLLW` would move to our MLLW as each gauge is fitted, and be taken again each time a refit moves the fit's window, so crowd-depth takes them in `chart_datum` instead, a change in crowd-depth.
- **`src/links.ts`**: `own()` counts `fit` and `official` as the station's own. A station takes a linked series' set only where it has none, whole, with its chart datum reference.
- **`frameOf`**: counts a chart datum whose value comes from the station's fit or official set as the gauge's frame, as it does one from slackwater-database.
- **`src/store/analysis.ts` and pair-check**: read the source's list, where the named references never appear, so pair-check never takes `MLLW(1983-2001)` for a shared reference between two gauges.
- **Site**: the station page's Datums table prints the set with its provider, and a second table lists the official set beside it with its epochs, with the translation between each pair of names. LevelChart lists the names in `datums` and needs nothing new.
- **slackwater-database**: reads `fits`, `constituents` and `fits/datums` directly (decision 7), so the published `datums` changes nothing it reads. It can read `fits/official` for the agencies it imports itself today.

**Upgrade.** `datums_source`, `datums_epoch` and `chart_datum` are derived when `publish` builds `stations.parquet` (`NOT_IN_LISTS` in [`src/store/files.ts`](../../src/store/files.ts)), so no list or migration changes. The first publish after this renames each CO-OPS gauge's chart datum to `MLLW(1983-2001)` and adds its offsets rows. Each station's set moves to its fit at the first publish after it's fitted. In the `stations.parquet` of 26 November, 3,758 GESLA stations and 1,237 CO-OPS stations take MSL or LAT from slackwater-database, and about 3,300 stations carry MSL, LAT or a chart datum from a linked series.

**How close the fits are.** Measured in #667 on a local mirror, and on SMHI in the public store:

- **CO-OPS**, 20 gauges: over the same months as NOAA's own tabulation, MSL within 1 mm, MHHW and MHW within an RMS of 4 mm, MLW and MLLW 9 mm, with Anchorage's MLLW 34 mm high and Galveston Pier 21's MLW 18 mm low unexplained. Against the 1983–2001 datums, MSL is 46 mm lower to 156 mm higher, the change in relative sea level since; the mean range is within 20 mm at 16 of the 20.
- **Kartverket**, 24 gauges: MSL differs by an RMS of 18 mm at 23 of them. A regional rise of 3.75 mm a year, fitted to these gauges, less the land uplift Kartverket gives for each, times the years between the 1996–2014 window and the fit's, leaves an RMS of 5.5 mm and at most 13 mm. HAT and LAT differ by an RMS of 23 and 24 mm. Kartverket's MHW, MLW, MHWS, MLWS and MHWN are MSL plus or minus M2, or M2 and S2, to within 1 cm at all 33 of its stations, though its descriptions call MHW and MLW the means of all high and low waters. Ny-Ålesund is 59 to 85 mm below Kartverket on every datum, which would take about 12 mm a year of uplift to explain, and Kartverket gives no rate there.
- **SMHI**, 61 gauges: SMHI publishes no tidal datums, but its mean water level in RH 2000 is a regression line over each gauge's record. The fits' MSL is 52 mm above it on average, 21 mm for windows centered 2000–2013 and 71 mm from 2020 on, since recent years sit above the line.
- **Every other source with official constants or datums** (LINZ, JMA, JHOD, the Marine Institute, BSH, PEGELONLINE, BODC) needs its first full fit before it can be measured.

The differences are the agencies' epochs, which the translation in `datums` and the official files carries.

### Phase 8: Remaining real-time feeds

Estimate: 3 days.

Most European originators arrive in phase 5. This adds UK EA river levels and the real-time sources TICON doesn't need, tracked as [issues labeled `source`](https://github.com/openwatersio/stillwell/issues?q=is%3Aissue%20state%3Aopen%20label%3Asource).

### Phase 9: Realtime levels for Slackwater

Estimate: 8 days.

The first public endpoint, because the apps need it before anything else in the API. It needs only phases 1 and 4 to start, so it can move ahead of phases 5 to 8; the datum-frame item waits for phase 6.

- [x] The live Worker ([`workers/live`](../../workers/live/README.md)) runs the poller in a container, with the D1 database `stillwell-live` and a cron that keeps the container up. R2 stays the record.
- [x] The poller (`server/ingest.ts`): polls every public hourly source's live stations at `min_interval_s`, runs `qcFor` over each 7-day window in the same step and writes only the values that changed (in level, flag, source flag, `received` or epoch) with `received`, deletes a withheld station's rows, records each pass in `polls`, writes each source's daily files, and on `DatumChanged` dispatches its source's refresh.
- [x] Issues titled "Live polling is failing for <source>" for each source with no clean pass in 2 hours, opened and closed by the live Worker's cron.
- [x] `GET /water-levels/stations/{source}/{id}/levels` ([api.md](api.md#get-water-levelsstationssourceidlevels)) served by `workers/api`, a Worker bound into the gateway as `WATER_LEVELS` on `/water-levels*`: the last 8 days from D1 and older ranges from the year files on R2. Levels in the requested datum (chart datum by default), `flag`, `received`, the datum offsets, `as_of`, `updated` and `status` (reporting, stale, offline). Cached per station for `min_interval_s`, with the last good copy served as `stale` when D1 or R2 can't be read.
- [ ] Datum frame: return the offset behind the datums of the station's constants (a fit in phase 6 names the series and zero they were reduced in), so the app's residual is observed minus prediction in one frame. Stations whose datums are in the constituent frame (TICON's MSL = 0 fallback) get `frame: unknown`, and the app shows the trend only.
- [ ] Slackwater: replace the per-provider fetchers in slackwater-ios#705 (NOAA now, more later) with this one call, keeping CHS on the device. Tracked in that issue.

Done when a Slackwater station page for a CO-OPS, RWS or PEGELONLINE gauge shows a level under 15 minutes old.

Later: rate limits, as generic limits in the api.openwaters.io gateway for every API rather than anything specific to this one.

### Phase 10: API

Estimate: 8 days.

The rest of the API in `workers/api`, reading the year files on R2 for any range ([workers/api](../../workers/api/README.md)). Gated on a go or no-go decision on a public API, 90 days in; the realtime levels in phase 9 aren't, since Slackwater needs it either way.

- [ ] `GET /water-levels/stations` with the tides API's `query`, `latitude`, `longitude`, `maxDistance`, `maxResults` and `bbox`, plus `kind`, `source` and `tide_station`, from `stations.parquet` held in memory.
- [ ] `GET /water-levels/stations/{source}/{id}`: metadata, datums, license, attribution and freshness.
- [ ] `GET /water-levels/stations/{source}/{id}/levels` and `/extremes`, with `start`, `end`, `datum` (chart datum by default, as in the tides API), `units` and `include=predicted,residual,received`. Any range, from D1 and the year files; converts datums, adds Slackwater predictions with `@slackwater/engine` and `@slackwater/database` when `tide_station` is set, and the residual (observed minus predicted).
- [ ] `GET /water-levels/at?latitude&longitude&time`: best estimate with `method` and `uncertainty_m`. Nearest gauge with data at that time; else prediction plus residual from gauges within crowd-depth's distances (fast within about 100 km, slow within a few hundred); else prediction plus modeled surge; else model. Same rules crowd-depth uses today, so crowd-depth can switch to it.
- [ ] Every response carries per-station attribution and the "not for navigation, preliminary data" notice; until tokens exist, responses never include `commercial_use: false` stations. The API docs and the `/water-levels` root response link to the source, as AGPL section 13 requires.
- [ ] Ranges that ended more than 7 days ago cached for a day with the Cache API.
- [ ] Latest levels for many stations in one call, by station IDs or `tide_station`, for Slackwater's favorites and the alerts cron.
- [ ] Alerts groundwork: a Worker cron that reads the latest levels and residual for a list of stations and reports the ones beyond a threshold. Who subscribes, and how notifications reach the phone, belongs in slackwater#394.
- [ ] OpenAPI document and a docs page on the website next to the tides API.
- [ ] The Worker's tests with `@cloudflare/vitest-pool-workers`.

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

### HRoI track

In parallel with the phases above.

The harmonic representation of inequalities (HRoI; Horn 1960, [Boesch and Müller-Navarra 2019](https://doi.org/10.5194/os-15-1363-2019)) predicts high and low waters directly from lunar transits. The [evaluation](../hroi-evaluation.md) found it times high and low waters better than a harmonic curve fit at BSH gauges and at most Dutch gauges, and it gives one event per semidiurnal cycle, which is the event-selection problem slackwater-database hit with RWS. slackwater-database's validator against BSH's tables ([slackwater-database#391](https://github.com/openwatersio/slackwater-database/pull/391)) finds its German stations, all TICON fits, predicting early at every one of 96 matched gauges, by a median of 12 minutes and by up to 75 at low waters far up the rivers.

An HRoI fit is a fit under decision 7: this repo fits it from the store's observations and publishes it with its scores, slackwater-database decides what ships, and the engine predicts from it.

What BSH asked, in its emails of 2 and 3 November 2026 (recorded in slackwater-database#391's research notes):

- Fits are trained on WSV's observed water levels, never on BSH's predictions.
- Predictions from those fits are Open Waters' own, and nothing names BSH as their source. Docs and comments describe HRoI as a published method.
- BSH doesn't release its HRoI constants. Its tables are a yardstick: reference data in `predictions/bsh/` and `predicted-extremes/bsh/` that fits are scored against.

The track covers German and Dutch gauges on the North Sea and its tidal rivers (Brandon, 2026-11-26). The Dutch gauges are the about 180 where the store holds RWS's observed high and low waters; HRoI timed those better there than the harmonic fit and RWS's own astronomical tide, and one event per cycle would settle [slackwater-database#152](https://github.com/openwatersio/slackwater-database/issues/152). The four Baltic gauges in BSH's tables keep harmonic fits: their tide is too small and weather-driven for one high and one low water per half lunar day to mean much, and at Kiel-Holtenau slackwater-database's event count already differs from BSH's by 18.

Reference data:

- [ ] Wait for BSH's answer on the 1 August rule ([slackwater-database#335](https://github.com/openwatersio/slackwater-database/issues/335)) before publishing anything fitted to BSH predictions.
- [x] Ingest BSH predictions into `predictions/bsh/` and `predicted-extremes/bsh/` as reference data: Monthly's BSH refresh fetches this year's, and from August next year's.
- [ ] A reviewed crosswalk from BSH's places to PEGELONLINE's gauges. Each of BSH's `DE_<number>_tides.json` files names a `pegelonline_uuid`, which PEGELONLINE's station list resolves to a gauge number. Places without one, and pairs more than a few hundred meters apart, are checked by hand.

Observed extremes:

- [ ] Observed high and low waters for PEGELONLINE's tidal gauges in `extremes/pegelonline/`, taken from the stored levels by a documented rule (smoothing, then a turning-point search), since PEGELONLINE publishes none. Every turning point is kept, both highs or lows of a double among them ([slackwater-database#152](https://github.com/openwatersio/slackwater-database/issues/152) shows they are real).
- [ ] RWS's observed extremes are used as RWS selects them. Where a tide has a double low water, as at about a third of tides at Hoek van Holland, the store keeps both lows, and the choice of training events takes the deeper.
- [ ] Training events chosen in a separate documented step: one high and one low water per half lunar day, assigned to transits as [`src/hroi`](../../src/hroi) does. Each fit records, per year, the share of half days where the choice dropped a turning point. A gauge where that share passes a limit set before the evaluation gets no HRoI fit, because forcing its events would bias one.

Evaluation, as a section of [hroi-evaluation.md](../hroi-evaluation.md), first at the 15 gauges it already covers and then at every gauge with enough record:

- [ ] Fit to observed extremes over 19 years (2005 to 2023 where the record allows, 9 years where it is shorter), and score on the observed extremes of 2024 and 2025. German fits are also scored on BSH's tables for 2026 and 2027, and Dutch fits beside RWS's astronomical extremes for the same held-out years.
- [ ] Four predictors on the same held-out events: HRoI on the moon's true transits, HRoI on a uniform grid of mean transits, the gauge's harmonic fit (phase 6) and its TICON constants. Mean transits would spare each engine a lunar ephemeris accurate to seconds, if the long-period terms absorb the difference.
- [ ] The curve between extremes, on held-out 1-minute levels: the harmonic curve warped in time and height to pass through the HRoI extremes, mean curves by tidal range or by event index (as BSH appears to use, and the gap at Husum, Büsum and Papenburg), and the single mean curve the evaluation has.
- [ ] The measures are written into the evaluation before any fit is scored: RMS of event time in minutes and of event height in centimeters, each beside the gauge's own spread between its 2024 and 2025 scores, so a difference between methods can be told from year-to-year noise.

Publishing:

- [ ] HRoI fits in the store beside `fits/` and `constituents/`, in a file defined with the first fit: the set of partial tides by name, the mean lunitidal intervals, the coefficients of interval and height for each of the four event series, the curve data the evaluation chooses, the window, and the scores. That is about 650 numbers a gauge.
- [ ] Refit each year on the latest 19 years, as BSH does, because rivers change after dredging.
- [ ] Mean high and low water, and their spring and neap values, reduced from the observed extremes over a stated 19-year window (phase 7), counting only years where at least 90% of half lunar days have a chosen high and low. The reduction is from observations, never from the fit.
- [ ] Move the implementation in [`src/hroi`](../../src/hroi) to `@slackwater/engine`, fitting and prediction together, so the store's fits and every app's predictions share one implementation under the MIT license. This repo then imports it.

slackwater-database's side, in that repo: an HRoI table on a station in the database format, a set of harmonic constants on every HRoI station so readers that predate the table and the TCD export still predict, the rank of a PEGELONLINE fit against TICON's record of the gauge, and a release order of engine, apps and then database.

## Out of scope

- **Water levels from vessels at rest** ([slackwater-database#331](https://github.com/openwatersio/slackwater-database/pull/331)). A boat's sounder at anchor tracks the tide where the range is large, but it isn't a gauge: it reads depth under a hull that swings around its anchor over a sloping bottom, with unknown draft, sensor offsets and settling, and no datum. Turning it into a water level means modeling the bottom and the vessel, which is crowd-depth's work, and scoring vessels, which the PR lists as a follow-up. The data is also personal (where someone anchors or lives aboard) and covered by crowd-depth's contributor terms, not an open license, and the stations move, which the station schema assumes they don't. What the PR proposes produces subordinate stations for slackwater-database, fitted against a reference gauge, not water-level series. So the store serves it as a consumer: observed levels at the reference gauge, so surge drops out of the fits (the PR's limitation that every fit is against a prediction). Revisit if validated crowd-derived stations need live or archived series of their own.
- **CHS data**, until CHS grants a commercial license (see open questions).
- **Full model grids.** Model output is stored at points only; grids stay where NOAA and Copernicus host them.

## Running costs and limits

As the architecture estimates: about $7 a month in year one on R2 and Workers, plus about $20 a month for the Stillwell server, GitHub Actions free on a public repo, and a one-time backfill of $20–60 if GTSM and the USGS history need a rented box. Watch the CO-OPS throttle, RWS's 160,000-value limit, and that GitHub disables schedules on a repo with 60 days of no activity.

## Open questions

- BSH's answer on the 1 August rule.
- Whether SHOM will license its predictions as reference data for scoring fits at French gauges, as BSH's and RWS's are used.
- Which reference checks a gauge's clock where no other originator holds its record and no neighbor is close: an ocean tide model's constants at the gauge would share no gauge's clock, and the choice turns on which model's license allows it. EOT20 is the first to check; FES's and TPXO's terms are restrictive.
- STOFS-2D station count and file sizes.
- PSMSL's reply on commercial redistribution (request sent 2026-11-01).
- Whether WSV or BfG will supply PEGELONLINE's archive before 2000, and whether they're content with scripted use of the raw-data download for a full backfill.
- Terms or permission for each new source, settled in its [`source` issue](https://github.com/openwatersio/stillwell/issues?q=is%3Aissue%20state%3Aopen%20label%3Asource).
- CHS: its reply on [slackwater-database#320](https://github.com/openwatersio/slackwater-database/issues/320) says any commercial use, derivatives included, needs a separate license, and it isn't taking new commercial requests while its licensing program (including the Value-Added Reseller Licence) is reviewed. Apply when the new options appear.
- The 304 TICON `meds` records are Canadian gauge data that slackwater-database marks CC BY 4.0 with commercial use, on TICON's label. Check whether CHS's terms reach them, the same question GESLA's license page raises.
