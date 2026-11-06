# Implementation plan

How this repo becomes the water-level lake and API ([api.md](api.md) has the API design) described in the [planning evaluation](https://github.com/openwatersio/planning/tree/main/water-levels) ([architecture](https://github.com/openwatersio/planning/blob/main/water-levels/architecture.md), [sources](https://github.com/openwatersio/planning/blob/main/water-levels/research/sources.md)): observed, predicted, residual and modeled water levels for tide, lake and river gauges, in one schema with a datum and a license per station, stored as Parquet on R2, served at `api.openwaters.io` and published as open bulk snapshots. Links to `openwatersio/planning` go to Open Waters' internal planning repo, which isn't public.

It also replaces GESLA and TICON as tide-database's source of observations. TICON's constants and GESLA's records have carried too many errors (local time labeled as UTC at WSV and RWS, Hong Kong an hour early, JODC year-end truncation, swapped constituent definitions), and they update about once a year. tide-database should re-fit harmonics and reduce datums from records fetched from each originator, with correct UTC clocks, QC flags and provenance, refreshed continuously.

## Where it stands

- Adapters for Rijkswaterstaat, BSH and PEGELONLINE that write Parquet to local `data/`, with a response cache.
- An HRoI implementation and evaluation against BSH predictions and RWS observations ([hroi-evaluation.md](hroi-evaluation.md)).
- CI for lint, typecheck and tests, hourly ingest into `recent/` and a daily fold into the year files. There is no API yet.

What the existing Open Waters pieces give us, and don't:

- **Gateway.** `api.openwaters.io` routes by path prefix to each service (`/tides*`, `/bathymetry*`), with no `/v1` prefix. Tokens and plans exist only for AIS, so the entitlements the architecture doc assumed don't exist yet.
- **Predictions.** The tides worker bundles `@slackwater/engine` and `@slackwater/database`. Residual code is on the unmerged `slackwater` branch `engine/hourly-water-level-residuals` ([slackwater#394](https://github.com/openwatersio/slackwater/issues/394), [#396](https://github.com/openwatersio/slackwater/issues/396)).
- **tide-database** (`slackwater-database`) has per-record `license: {type, commercial_use, url, notes}`, per-source `metadata.yaml` (credit, license, terms, modifications), datums per station (`datums`, `chart_datum`, `epoch`), the GESLA mirror on R2 and the GESLA clock fixes (`sources/ticon/samples.ts`: WSV in Europe/Berlin, RWS in Europe/Amsterdam with a 1 h shift, Hong Kong UHSLC +1 h). Station IDs are `source/id`.
- **crowd-depth** reduces soundings with predicted tide from the nearest commercial-use station plus a CO-OPS residual from a gauge within 100 km (`packages/grid/src/grid/tide.py`, cache in `cache.py`). It reads R2 with DuckDB through `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Its plan wants a slow residual from a gauge within a few hundred km and a fast one within about 100 km.

## Use cases

Each consumer, what it needs from the lake, and which path serves it. "Live" is the on-request path in decision 9; "archive" is the scheduled Parquet on R2.

| Use case                                                                                                                                                    | Freshness              | Window                            | Datum                                  | Licenses                                 | Path                                          | Phase    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------- | -------------------------------------- | ---------------------------------------- | --------------------------------------------- | -------- |
| crowd-depth sounding reduction                                                                                                                              | Days                   | Years, a point and time           | Chart datum                            | Commercial only                          | Archive through DuckDB, then `at`             | 3, 10    |
| tide-database re-fits and datums (decision 7)                                                                                                               | Monthly                | Whole record, up to 19 years      | Gauge zero, consistent over the record | Restricted allowed for derived constants | Archive through DuckDB                        | 5, 6     |
| Slackwater iOS and Android: observed level and residual on a tide station ([slackwater-ios#705](https://github.com/openwatersio/slackwater-ios/issues/705)) | Minutes                | Last 96 h                         | The bundled prediction's frame         | Commercial only; CHS stays on the device | Live, by tide-database ID                     | 9        |
| Anomaly and surge alerts at favorite stations ([slackwater#394](https://github.com/openwatersio/slackwater/issues/394))                                     | Minutes, on a schedule | Last 96 h                         | Same as the app                        | Commercial only                          | The live fetch, run from a cron               | 10       |
| signalk-tides `heightNow`, Home Assistant                                                                                                                   | Minutes                | Last hours                        | Chart datum                            | Commercial only until tokens exist       | Live                                          | 9        |
| Website station pages, including rivers and lakes                                                                                                           | Minutes                | Days                              | Station and chart datum                | Commercial only                          | Live and archive                              | 10       |
| Correcting future tides from recent residuals ([slackwater#397](https://github.com/openwatersio/slackwater/issues/397), noaa-water-level-research)          | Minutes                | Weeks to years                    | Prediction frame                       | Commercial only                          | Archive, with each observation's arrival time | 4        |
| Public API customers, later the paid tier                                                                                                                   | Minutes                | Any                               | Any supported                          | By token, later                          | Live and archive                              | 10       |
| Crowd-derived tide stations from boats at rest ([tide-database#331](https://github.com/openwatersio/slackwater-database/pull/331))                          | Days                   | The hours of each at-rest episode | The reference gauge's datum            | Commercial only                          | Archive, by nearby gauge or `at`              | 3, 10    |
| Researchers                                                                                                                                                 | Quarterly              | Everything cleared                | Station datum with offsets             | Cleared                                  | Bulk snapshots with a DOI                     | 12       |
| BSH and RWS predictions as reference data (HRoI)                                                                                                            | Yearly                 | A year ahead                      | Gauge zero                             | Per source                               | Archive                                       | Parallel |

## Decisions

Recommended answers. The plan below assumes them; each can change without reshaping the work.

1. **Non-commercial sources (IOC, restricted GESLA contributors, BODC) stay out of the API until tokens exist.** They go in a separate private lake for research and QC, and `stations.parquet` carries `commercial_use`. That removes the entitlement dependency from the first public API, and the predicate is already in the data when tokens arrive.
2. **The API is open and unauthenticated at launch**, like tides, with the same per-IP rate limits. Tokens and the commercial tier come with the tides plan from [planning#31](https://github.com/openwatersio/planning/pull/31), not before.
3. **Paths follow the gateway's convention**: `/water-levels/...`, not `/v1/water-levels/...`.
4. **IDs are `<source>/<source_id>`** (`coops/9447130`, `usgs/07022000`, `rws/hoekvanholland`), the same form as tide-database's station IDs and the API's `/stations/{source}/{id}` paths. Source codes never contain a slash; a station's own code may, and is URL-encoded in file paths. Each source's station list lives in the lake, `stations/<source>.parquet`, with a snapshot and report of every refresh in `history/`, so a new source adds only code and no ingest run changes the repo; decisions a person makes about a source's stations live in its adapter's `overrides`. A station the source stops listing stays, inactive. A station's levels are kept per datum epoch: when the source moves it to another reference, its new values go to files of their own, and `stations.parquet` says how each epoch converts into the current one ([stations.md](stations.md)). Adapters refuse values in any datum but the station's, and each series file records its datum so backfill never writes into a file in another. Each station carries `tide_station` with the tide-database `source/id` when one exists. The link also runs the other way: tide-database station records carry their lake series ID, and subordinate stations their reference gauge's, so an offline app knows which stations have observations without asking. Links join the same physical gauge, never the nearest one.
5. **Bulk snapshots ship with the public API**, quarterly, with a Zenodo DOI.
6. **The API worker lives in this repo** and is bound into the gateway as `WATER_LEVELS`, so adapters, schema and reader change together.
7. **Decided: tide-database keeps the harmonic fitting and datum reduction, and reads the lake instead of GESLA.** Its fitting (`packages/harmonic-analysis`), constituent-name handling and datum rules (`docs/datums.md`) are already validated; porting them here would duplicate them. This repo's job is to be a better GESLA: originator records, fresh, in UTC, flagged, with provenance. Residuals from the lake against tide-database's published constants then flag stations whose constants or clocks are wrong.
8. **Constants fitted from restricted observations can still ship** where the operator agrees, as VLIZ did for IOC-derived constituents. So restricted series feed tide-database fits even though the API doesn't serve them.
9. **Live levels are fetched on request, not polled into R2.** For the last 96 h of one station, the Worker calls the originator and caches the answer for the source's minimum interval (5 minutes for most, 15 for UK EA). Polling every linked gauge into per-station R2 objects every 10 minutes would be about 13 million writes a month (about $58), against $4 for the whole archive, and would mostly refresh stations nobody is looking at. The scheduled jobs build the archive; the same fetch code serves both.
10. **Apps compute residuals themselves.** The API returns observed levels in the bundled prediction's frame, and Slackwater computes the residual against the constants it ships, as slackwater-ios#705 plans, so the number always matches the curve on screen. The API's own residual is for the website, alerts and API customers, and names the database version it used.
11. **Observations keep their arrival time** (`received`) wherever we saw them arrive, because forecast correction needs to know what was available when, not just when it was measured.
12. **Decided: TypeScript for adapters, the lake, QC and the API; Python only for NetCDF model extraction** (Brandon, 2026-11-03). Adapters must run in the Worker for live levels, and predictions come from `@slackwater/engine`, so one language serves ingest, live and the API. Model output (GTSM, STOFS) is NetCDF, which Node handles poorly, so phase 11 may use a small Python step that writes the same Parquet layout. Analysis in any language reads the lake directly.

## Repo shape

```
src/
  schema.ts            Station, Observation, flag codes, source metadata types
  sources/<source>/    one adapter per source: index.ts (with its metadata) and README.md
  lake/                write and read the R2 layout (DuckDB for writes, paths, compaction)
  qc.ts                flags: duplicates, flatlines, spikes, clock checks
  datums.ts            offsets to MSL, LAT, NAVD88; joins to tide-database
  hroi/                as now
scripts/
  ingest.ts stations|backfill|recent|compact <source>
  compact.ts, snapshot.ts, report.ts
worker/                the API: wrangler.jsonc, src/, test/
.github/workflows/     ci, ingest-hourly, compact-daily, monthly, snapshot-quarterly, canary
```

Every adapter implements one interface, so ingest, compaction, QC and the API never branch on source:

```ts
interface Source {
  metadata: SourceMetadata; // id, name, url, license, attribution, terms, qc
  stations(previous?: Station[]): Promise<ListedStation[]>; // datum null when the source didn't say; previous is the lake's list
  observations?(station: Station, start: Date, end: Date): Promise<Observation[]>;
  extremes?(station: Station, start: Date, end: Date): Promise<PublishedExtreme[]>; // RWS observed
  predictions?(station: Station, start: Date, end: Date): Promise<Observation[]>; // RWS astronomisch, BSH
  predictedExtremes?(station: Station, start: Date, end: Date): Promise<PublishedExtreme[]>;
}
```

`src/schema.ts` defines these. Live levels (phase 9) call `observations` for a short window; a bulk "latest" method for sources that offer one can come with phase 4 if per-station fetching is too slow.

The writer takes a URL, so `data/` locally and `s3://water-levels/` in Actions run the same code, through DuckDB's `httpfs` with an R2 secret.

Adapters run in two places: Node in Actions, and the Worker for `live`. So adapter code uses only `fetch` and plain TypeScript, with Node-only pieces (DuckDB, the disk cache) kept in `src/lake/` and `scripts/`.

## Data layout and schema

Bucket `water-levels`, public read at `water-levels.openwaters.io`. Non-commercial series go in a separate private bucket, since everything in this one is public; ingest writes a restricted source only to `WATER_LEVELS_RESTRICTED_LAKE` and refuses without it.

```
stations.parquet                                 one row per series
sources.json                                     license and attribution per source
recent/<source>.parquet                          last 7 days, every live public station and any since retired, sorted by station then time
obs/<source>/<station>/<year>.parquet            time, level_m, flag, source_flag, received, datum
extremes/<source>/<station>/<year>.parquet       the source's observed high and low waters: time, level_m, type, flag, datum
predictions/<source>/<station>/<year>.parquet    published predictions (RWS, BSH), same columns as obs
predicted-extremes/<source>/<station>/<year>.parquet  published predicted extremes, plus transit and event for BSH
models/stofs2d/<cycle>.parquet                   station-point nowcast and forecast
models/gtsm/<point>.parquet                      surge reanalysis at coastal points
bulk/<snapshot>/<source>.parquet                 quarterly, Hive-partitioned by year
```

`stations.parquet` columns follow the architecture: `id`, `name`, `lat`, `lon`, `country_code`, `kind` (coastal, estuary, lake, river), `interval_s`, `datum`, `datums` (a map from datum name to the meters to add, such as `NHN`, `SKN`, `MSL`; phase 7 adds MSL, LAT and NAVD88 where tide-database or the source has them), `products`, `first`, `last`, `license`, `commercial_use`, `attribution`, `tide_station`, `same_as`, `source_url`, plus `status` (active, inactive), `live` (whether the live path supports it) and `min_interval_s` (how often the source lets us ask). `first` and `last` will come from the lake: until compaction fills them in they're null. `license`, `commercial_use` and `attribution` come from the adapter's metadata unless the source lists a station with its own. Every other column comes from each source's list in the lake, which holds what the source says, what a refresh carries forward and the station's datum epochs, so only the station refresh changes them, never the hourly or daily jobs.

Observation files are `time` (TIMESTAMPTZ), `level_m` (FLOAT), `flag` (UTINYINT, ordered best to worst: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad), `source_flag` (UTINYINT, the source's flag before QC, null where it wasn't kept), `received` (TIMESTAMPTZ, null for backfilled history), and `datum` (VARCHAR, the same on every row, so a file can't mix two; backfill refuses to write into a file in another datum). Source flags fold into these; QC can only make a flag worse.

## Phases

Ordered so crowd-depth and tide-database get what they need first, as the evaluation's [What to build first](https://github.com/openwatersio/planning/blob/main/water-levels/architecture.md#what-to-build-first) asks, then the public product. Estimates are one person's working days, about 61 in all.

### Phase 0: Update the planning docs (1 day)

The planning evaluation describes a smaller system than this plan, so bring it in line before building, and keep it in line when a decision changes.

- [ ] `planning/water-levels/README.md`: add the TICON replacement and live Slackwater levels to the internal value, the build estimate (about 60 days, not four to six weeks), the decisions this plan settles, and a link to this repo.
- [ ] `planning/water-levels/architecture.md`: the live path and why (the R2 write cost of polling per station), the gateway's lack of tokens and the `/water-levels` paths, the `received` column, the private lake for restricted series, the two-way station links with tide-database, what's out of scope, and a link to [api.md](api.md) in place of its API section.
- [ ] From then on, a decision that changes this plan updates the planning docs in the same week.

### Phase 1: Foundations (4 days)

- [x] `src/schema.ts` with the station and observation types above, the `datums` map in place of `offsets`, and per-station license, commercial use and attribution.
- [x] The `Source` interface; `rws`, `bsh` and `pegelonline` in `src/sources/<source>/` with typed metadata and a README each. Adapters fetch through `src/http.ts`, so they run in a Worker; scripts swap in the disk cache.
- [x] `src/lake/`: Parquet reader and writer for a directory or `s3://` URL, path helpers, and range merging that keeps first arrival times.
- [x] `scripts/ingest.ts` with `stations`, `recent` and `backfill <source> <stations> <start> <end>`; idempotent, so a rerun writes nothing.
- [x] Station lists (691 RWS, 691 PEGELONLINE, 172 BSH); `stations.parquet` built from them, with `same_as` links made two-way. They now live in the lake, one file per source with datum epochs ([stations.md](stations.md)).
- [x] R2: the `water-levels` bucket, public at `water-levels.openwaters.io`, with a bucket-scoped token in the `lake` environment, which only runs on main. The manual Ingest workflow runs any ingest command against it; Hoek van Holland's 2024 backfill on R2 matches a local run row for row and reads back over HTTPS.
- [x] QC v1 (`src/qc.ts`): drop repeated times; `bad` beyond 20 m of the series' median; `suspect` for flatlines of 6 hours or more (48 at river and lake stations, which pooled water holds still for a day or more), spikes from the two-sided neighbor median beyond max(0.25 m, 8·MAD of those residuals), and outliers beyond max(10·MAD, 1 m) (off at river and lake stations, which sit flat for months and then rise meters in a flood, and at any source that turns it off, as USACE does). On RWS 2024 at six tide gauges it adds 14 flags, all real (a stuck sensor at Vlissingen, jumps at Bath), and none on a clean year.
- [x] Tests: each adapter parses a committed fixture; the writer round-trips through DuckDB; merge and QC cases.

Done when `node scripts/ingest.ts backfill rws hoekvanholland 2024 2025` writes the same files locally and to R2, and DuckDB reads them over `https://water-levels.openwaters.io/`.

### Phase 2: TICON inventory (2 days)

tide-database ships 4,838 TICON records from 46 GESLA contributors. All are listed in its station files, and its quality evaluation accepts 2,527; the rest still get a route, marked rejected, mostly as duplicates of a better record. [ticon-replacement.md](ticon-replacement.md) gives the lake source that can replace each one, generated by `npm run ticon:inventory` from a tide-database checkout, with one row per record in [ticon-replacement.csv](ticon-replacement.csv). Of the accepted records, 715 are ready (an adapter exists and the record matched one of its stations, including all 67 CO-OPS records and 431 USGS ones), 180 go to cleared sources with adapters in this plan, 89 are CMEMS copies in countries whose feed has a planned adapter and still have to be matched to its stations, 1,131 wait on a source's terms, 391 stay on TICON (CHS, BODC and UK gauges, the research-only CMEMS records, GESLA's `cv` and `uz`), and 21 need a look by hand: two platforms RWS no longer publishes (Aukfield, North Cormorant), two with no station nearby (Kalkgrund, L9), 13 whose positions sit between two gauges of the same name, among them Hoek van Holland, Den Helder and Rotterdam, and four USGS sites with no instantaneous water-level series (two on the Hudson, the Passaic at Newark, and a Merrimack code USGS doesn't have).

- [x] Generate the inventory from tide-database's own provenance rules (`sources/ticon/provenance.ts`), the codes TICON ids carry, position and name matches against the lake's station lists (never by name alone), and tide-database's station files, which group records of the same gauge.
- [x] Order the work by accepted records per source. The largest are USGS (435), UHSLC (421, license pending), CHS (256, restricted), CRMS (164, terms to check), PEGELONLINE (146 ready) and REFMAR (124). CO-OPS covers only 67: tide-database already takes NOAA gauges from NOAA, so most TICON copies of them are rejected as duplicates.
- [ ] The years each originator holds for each record. That comes from each adapter's backfill in phases 3 and 5; the CSV carries TICON's own fit period to compare against.

### Phase 3: US sources (6 days)

- [x] **CO-OPS** (`coops`): the historical and current station lists and each station's datums from the metadata API; 6-minute `water_level`, with `application=openwaters`, and `hourly_height` for months without it (before about 1996); verified `high_low` extremes. Levels are in station datum (STND) rather than MLLW, since MLLW moves against the gauge with each tidal epoch; `datums` gives MLLW, MSL, NAVD88 and the rest from it. Verified data replaces preliminary when it appears; the Monthly workflow refetches last year and this year to date. See [the adapter's README](../src/sources/coops/README.md).
- [x] **USGS** (`usgs`): OGC API v1 (`api.waterdata.usgs.gov/ogcapi/v1`), never the legacy waterservices (retired 2027-02-22). Every USGS-run site with a water-level series, about 14,000, live or not; `kind` comes only from USGS's own site type and tidal series, and which sites a consumer needs decides only the backfill order. Each is one instantaneous series from `time-series-metadata`, gage height (00065) in the gage datum (`GAGE`) with `datums` from the gage's altitude in `monitoring-locations`, else a NAVD88 or NGVD29 elevation; `continuous` a year per request. `continuous` mostly starts in October 2007 (2001 at St. Louis); older history is only daily statistics, not fetched. Keyless clients get 1,000 requests a rolling hour per IP, and every client on the IP shares them, so a backfill (about 203,000 requests) needs an api.data.gov key for a budget of its own, and runs as a series of resumable runs. `recent` sweeps all sites with one time-filtered query per parameter, which `continuous` answers with paging, through the new `Source.recent`. 431 of the 435 accepted TICON USGS records are ready; the other four have no instantaneous water-level series at USGS. See [the adapter's README](../src/sources/usgs/README.md).
- [x] **USACE CWMS** (`usace`): `Stage.Inst` series from the Mississippi, Ohio, Missouri and tributary offices (MVS, MVK, MVM, MVN, LRL, LRP, LRH, LRN, LRC), one observed series per location (about 1,350), in meters above gauge zero (`GZ`). `datums` gives the gauge zero in NGVD29 or NAVD88 where the location has an elevation. CWMS has no MVD datum for stage (`MVDhist` is a version name, the Mississippi Valley Division's daily history) and gives LWRP only in prose for 12 MVN gauges, so LWRP offsets are still to do. At 33 gauges the zero was reset partway through the series; backfill starts at each one's current zero. See [the adapter's README](../src/sources/usace/README.md).
- [x] Resumable backfill: `backfill` skips a year whose file is complete (a past year, asked for whole, with values in every month through its last week and no preliminary values), so a run cut short doesn't fetch those again, and `--skip-written` skips any ended year with a file, for a campaign of runs. `--first <file>` runs a list of stations first (`docs/ticon-replacement.csv` as it is, or crowd-depth's basins once there's a file of them), and `--shard i/n` takes one of n sets of stations, split by a hash of their IDs. The Ingest workflow runs one job at a time per source, in the group it shares with that source's hourly and compaction runs, so a matrix of shards needs its own workflow, and shards sharing one USGS key must split its pace. Compaction creates current-year files from a few days, so from 2026 on `--skip-written` counts a year as written only if its file has values in every month or holds values backfill wrote.
- [ ] Backfill: CO-OPS (2,930 stations; about 90,600 monthly requests for the 302 current stations' 6-minute records, plus hourly heights for months before 1996 and a `high_low` request per year, bounded by each station's established and removed dates) and USGS and USACE river history for the crowd-depth basins, as a GitHub Actions matrix sharded by a hash of station IDs. Each process paces CO-OPS at a request a second and USGS at its key's rate, so shards running at once have to split those.
- [x] Confirm USACE terms and request limits (sources.md open question 4): public domain as a federal work, and 33 U.S.C. § 2342 has the Corps publish its water data; no published limit, none seen in 40 requests in a row. Details in [the adapter's README](../src/sources/usace/README.md).
- [x] USACE gauges whose zero moved partway through the series: 33, entered by hand from the location descriptions in `src/sources/usace/zeros.ts`, with backfill bounded to each station's current zero (`zero_since`).
- [ ] LWRP offsets for the lower-Mississippi gauges: check the 12 MVN location descriptions that give them in prose (signs, and adjustments that apply only after a date) against the Corps' published LWRP tables, then add them to `datums`.

Done when crowd-depth can read observed stage and coastal levels for its Mississippi, Ohio and US coastal soundings from the lake, and the 1,166 NOAA and USGS TICON records have their originator series.

### Phase 4: Scheduled ingest (3 days)

- [x] `ingest-hourly.yml`: a matrix over sources, each with its own concurrency group. Each run merges the fetch into the existing `recent/<source>.parquet` (so sources with short windows don't lose data), trims to 7 days and writes it back. Values first seen in this run get `received` set to the fetch time; compaction carries it into the year files.
- [x] `compact-daily.yml`: fold yesterday from `recent/` into each station's current-year file, each row into its datum epoch's files (every whole day the window holds, six, so late values, revised QC flags and a missed night still land). Year files are written whole, so a failed run leaves the previous file. That's one rewrite a day per live station that reported, about 14,000 (11,100 USGS, 1,200 USACE, 690 each RWS and PEGELONLINE, 300 CO-OPS), not the 30,000 first estimated. Measured against a logging S3 server, a year file costs DuckDB one PUT and four HEAD or GET requests, and USGS's 7-day recent file a five-request multipart upload, so the two jobs make about 430,000 Class A and 1.8 million Class B requests a month: inside R2's free tier, or under $3 a month without it. Folding rewrites each year file whole, so the work grows through the year: on year-end-sized files on local disk it took 27 ms a file for 15-minute series and 0.45 s for 1-minute ones at 16 connections, peaking at 2.5 GB of heap (4.1 GB resident), so USGS's 11,100 files take about 5 minutes and PEGELONLINE's 223 one-minute gauges under 2, before R2's round trips.
- [ ] Compaction also writes each source's `first` and `last` per station to `stations/bounds/<source>.parquet`, which `stations.parquet` is built with.
- [x] `monthly.yml`: refresh station lists, datums and license pages, one job per source in a `lake-<source>` group, then rebuild `stations.parquet`; re-fetch verified CO-OPS months and USGS years that still hold provisional values (USGS approves months to years later). Also run `stations` daily for a source whose `recent` failed on a datum change. A scheduled workflow needs a commit every 60 days to stay alive on a public repo, which no longer comes from the station lists.
- [ ] Now and then refetch approved USGS years and verified CO-OPS months too, with `--refetch`: USGS still fills gaps and revises values after approval, and the disk cache keeps an approved page for good.
- [x] A run summary per job (stations updated, stale, failed, values written) on the run's page in Actions.
- [ ] An issue opened automatically when a source fails twice in a row.
- [ ] `canary.yml`, weekly: one small live request per adapter against a recorded shape, so upstream changes show up as a failing check instead of silent gaps.

Done when every source's `recent/` is under 2 hours old and the year files fill in daily without anyone touching them.

### Phase 5: Originator records for TICON stations (12 days)

In the order phase 2 sets. Every adapter backfills the whole record its originator publishes, so a fit can use 19 years where they exist.

- [ ] **UHSLC** research-quality and fast-delivery, from ERDDAP (968 records). Carry the Hong Kong +1 h correction until UHSLC fixes it, and exclude SANHO stations.
- [ ] **RWS** history back to 1990 at tide gauges, plus extremes (`GETETM2`, `GETETBRKD2`).
- [ ] **European originators**: REFMAR, SMHI, Kartverket, Marine Institute, DMI, UK EA (archive for the 88 `TideGauge` stations). These also run hourly from phase 4 on.
- [ ] **US state networks**: CRMS, CDEC, SFWMD, NWFWMD, NCDEM.
- [ ] **JMA and JODC**, **UNAM**, then the case-by-case rest.
- [ ] **WSV history**: backfill PEGELONLINE from its raw-data download, which goes back to 2000 at 94 of the 137 gauges on the North Sea and tidal rivers (each station's `history_since`). For years before 2000, and gauges with a later start or no history, ask WSV or BfG for the archive, or use GESLA's WSV years with tide-database's Europe/Berlin correction.
- [ ] **GESLA 4.1** as the fallback for years an originator can't supply, from the existing R2 mirror, with tide-database's clock fixes and per-contributor licenses. Never where the originator has the same years.
- [ ] Restricted series (Copernicus in situ, IOC, restricted GESLA contributors) into the private lake.
- [ ] Clock check on every new series: cross-correlate against the station's TICON prediction and against neighbors, and flag whole-hour offsets before anything fits to it. This is how the WSV, RWS and Hong Kong errors showed up.
- [ ] Deduplicate across sources: when two series share a gauge, `stations.parquet` links them (`same_as`) and says which is preferred.

### Phase 6: tide-database reads the lake (6 days, in tide-database)

- [ ] A sample reader in `packages/harmonic-analysis` that takes a lake series ID and a period and returns samples, replacing `parseGeslaSamplesInZone` for converted contributors. DuckDB over `water-levels.openwaters.io` (and the private bucket for restricted series), cached like the GESLA zip.
- [ ] A `sources/water-levels` importer (or a switch inside `sources/ticon`) that re-fits a converted record from its lake series and reduces datums from the same series, under the rules in `docs/datums.md`.
- [ ] Gate each swap: fit on all but the last year, score the held-out year against the lake, and swap only when the re-fit's RMS is no worse than TICON's published constants on the same year. Record both scores in the station's provenance.
- [ ] Convert contributor by contributor, in phase 2's order, with `report:merges` reviewing the result each time. A contributor whose records all convert drops out of the TICON import.
- [ ] A monthly residual report here: observed minus tide-database's prediction at every converted and unconverted station. Tidal-band energy in the residual means wrong constants; a step means a datum shift; a whole-hour phase lag means a clock error. Open an issue in tide-database for each.
- [ ] Link stations both ways: tide-database records gain the lake series ID (subordinate stations take their reference gauge's), `@slackwater/database` exposes it, and the lake's `tide_station` is filled from the same table.
- [ ] Record, per station, which lake series and gauge zero its datums were reduced from, so the live path can return observations in the same frame as the prediction.
- [ ] Re-fit on a schedule (yearly, or when a station's record has grown by a year), so constants improve as the lake grows instead of waiting for a TICON release.

Done when tide-database's monthly update re-fits from the lake, and TICON supplies only the contributors that phase 2 marks as not replaceable yet.

### Phase 7: Datums (3 days)

- [ ] `src/datums.ts`: join each station to tide-database by provider ID and distance (never by name alone), and take MSL and LAT from its `datums` when the station has harmonics; otherwise use the source's own offsets.
- [ ] Record where each offset came from (`datums_source`: source, tide-database, computed) and its epoch.
- [ ] Per source: CO-OPS datums API; RWS NAP and MSL; BSH and PEGELONLINE PNP, NHN and SKN; USGS gage datum to NAVD88; USACE series datums.
- [ ] Tests that convert a known level at a few stations to each datum and compare with the operator's published value.

### Phase 8: Remaining real-time feeds (3 days)

Most European originators arrive in phase 5. This adds the real-time sources TICON doesn't need: UK EA river levels, **ECCC** hydrometric (OGL-Canada; confirm the datamart endpoint's license), and NWPS forecast metadata. FMI waits for a license check.

### Phase 9: Live levels for Slackwater (5 days)

The first public endpoint, because the apps need it before anything else in the API. It needs only phases 1 and 4 to start, so it can move ahead of phases 5 to 8; the datum-frame item waits for phase 6. It starts the Worker in `worker/`, bound into the gateway as `WATER_LEVELS` on `/water-levels*`.

- [ ] `GET /water-levels/stations/{source}/{id}/live` ([api.md](api.md#get-water-levelsstationssourceidlive)): observations in the requested datum (chart datum by default), `flag`, `received`, the offsets to MSL and chart datum, `as_of`, and `status` (reporting, stale, offline). Small JSON, gzipped, a few KB.
- [ ] `live()` for each source whose stations tide-database links to, starting with CO-OPS, RWS, PEGELONLINE, UK EA, Kartverket and the other European feeds. Each call runs the source's adapter in the Worker.
- [ ] Cache per station for `min_interval_s` with the Cache API, so a thousand phones on one station make one upstream call. Serve a stale copy with `status: stale` when the source fails, rather than an error.
- [ ] Quick QC on the window (spikes, flatlines, a gauge that stopped reporting) using the same `src/qc.ts` the archive uses.
- [ ] Datum frame: return the offset tide-database used for the station's datums (phase 6 records which series and zero those came from), so the app's residual is observed minus prediction in one frame. Stations whose datums are in the constituent frame (TICON's MSL = 0 fallback) get `frame: unknown`, and the app shows the trend only.
- [ ] Rate limits: phones on mobile networks share IP addresses, so give Slackwater's User-Agent its own allowance in the gateway rather than the open API's 100 a minute per IP.
- [ ] Slackwater: replace the per-provider fetchers in slackwater-ios#705 (NOAA now, more later) with this one call, keeping CHS on the device. Tracked in that issue.

Done when a Slackwater station page for a CO-OPS, RWS or PEGELONLINE gauge shows a level under 15 minutes old.

### Phase 10: API (8 days)

The rest of the API in the same Worker, reading R2 through a binding with `hyparquet` (pure JavaScript, range reads). Gated on the evaluation's [day-90 go or no-go](https://github.com/openwatersio/planning/blob/main/water-levels/README.md#next-90-days) on a public API; the live endpoint in phase 9 isn't, since Slackwater needs it either way.

- [ ] `GET /water-levels/stations` with the tides API's `query`, `latitude`, `longitude`, `maxDistance`, `maxResults` and `bbox`, plus `kind`, `source` and `tide_station`, from `stations.parquet` held in memory.
- [ ] `GET /water-levels/stations/{source}/{id}`: metadata, datums, license, attribution and freshness.
- [ ] `GET /water-levels/stations/{source}/{id}/levels` and `/extremes`, with `start`, `end`, `datum` (chart datum by default, as in the tides API), `units` and `include=predicted,residual,received`. Reads one file per year plus `recent/`, converts datums, adds Slackwater predictions with `@slackwater/engine` and `@slackwater/database` when `tide_station` is set, and the residual (observed minus predicted).
- [ ] `GET /water-levels/at?latitude&longitude&time`: best estimate with `method` and `uncertainty_m`. Nearest gauge with data at that time; else prediction plus residual from gauges within crowd-depth's distances (fast within about 100 km, slow within a few hundred); else prediction plus modeled surge; else model. Same rules crowd-depth uses today, so crowd-depth can switch to it.
- [ ] Every response carries per-station attribution and the "not for navigation, preliminary data" notice; responses never include `commercial_use: false` stations.
- [ ] Historical years cached with the Cache API; `recent/` cached for 5 minutes.
- [ ] Alerts groundwork: a Worker cron that runs the live fetch and residual for a list of stations and reports the ones beyond a threshold. Who subscribes, and how notifications reach the phone, belongs in slackwater#394.
- [ ] OpenAPI document and a docs page on the website next to the tides API.
- [ ] Tests with `@cloudflare/vitest-pool-workers` against a small fixture lake.

### Phase 11: Models (5 days)

- [ ] **STOFS-2D-Global** station output from `noaa-gestofs-pds` every 6 hours, nowcast and forecast. First list a day's files to size it (sources.md open question 7).
- [ ] **GTSM** surge reanalysis at about 18,000 coastal points, 1950–2024, hourly (about 35 GB), from the CDS API: one-time backfill on a rented box.
- [ ] Map model points to stations and to the `at` endpoint's fallback.

### Phase 12: Bulk and launch (3 days)

- [ ] `snapshot-quarterly.yml`: cleared data into `bulk/<YYYY-Qn>/`, a manifest with checksums, and a Zenodo deposit for a DOI. Each row carries its datum epoch, and only rows inside their epoch's span go in.
- [ ] Data README: schema, flags, datums, licenses per source, how to query with DuckDB, Polars and pandas.
- [ ] Observed levels on the website's station pages, and `heightNow` in signalk-tides (in those repos).

### HRoI and the BSH track (parallel)

The [evaluation](hroi-evaluation.md) found HRoI times high and low waters better than a harmonic curve fit at BSH gauges and at most Dutch gauges, and gives one event per semidiurnal cycle, which is the event-selection problem tide-database hit with RWS.

- [ ] Wait for BSH's answer on the 1 August rule ([tide-database#335](https://github.com/openwatersio/slackwater-database/issues/335)) before publishing anything fitted to BSH predictions.
- [ ] Ingest BSH predictions yearly from August into `predictions/bsh/` as reference data.
- [ ] Test HRoI against observed German levels from a PEGELONLINE backfill, which reaches 2000 at most gauges.
- [ ] Learn BSH's per-gauge curve shapes instead of one mean curve (the Husum, Büsum and Papenburg gap).
- [ ] Propose HRoI extremes to `@slackwater/engine` as an event method for stations with a long extremes record, in a separate issue there.

## Out of scope

- **Water levels from vessels at rest** ([tide-database#331](https://github.com/openwatersio/slackwater-database/pull/331)). A boat's sounder at anchor tracks the tide where the range is large, but it isn't a gauge: it reads depth under a hull that swings around its anchor over a sloping bottom, with unknown draft, sensor offsets and settling, and no datum. Turning it into a water level means modeling the bottom and the vessel, which is crowd-depth's work, and scoring vessels, which the PR lists as a follow-up. The data is also personal (where someone anchors or lives aboard) and covered by crowd-depth's contributor terms, not an open license, and the stations move, which the station schema assumes they don't. What the PR proposes produces subordinate stations for tide-database, fitted against a reference gauge, not water-level series. So the lake serves it as a consumer: observed levels at the reference gauge, so surge drops out of the fits (the PR's limitation that every fit is against a prediction). Revisit if validated crowd-derived stations need live or archived series of their own.
- **CHS data**, until CHS grants a commercial license (see open questions).
- **Full model grids.** Model output is stored at points only; grids stay where NOAA and Copernicus host them.

## Running costs and limits

As the architecture estimates: about $7 a month in year one on R2 and Workers, GitHub Actions free on a public repo, and a one-time backfill of $20–60 if GTSM and the USGS history need a rented box. Watch the CO-OPS throttle, RWS's 160,000-value limit, and that GitHub disables schedules on a repo with 60 days of no activity.

## Open questions

- BSH's answer on the 1 August rule.
- ECCC datamart license; FMI sea-level license.
- STOFS-2D station count and file sizes.
- UHSLC and PSMSL replies on commercial redistribution (PSMSL request sent 2026-11-01). UHSLC now matters most: it covers 968 TICON records.
- Whether WSV or BfG will supply PEGELONLINE's archive before 2000, and whether they're content with scripted use of the raw-data download for a full backfill.
- Terms for the US state networks, JMA and JODC, UNAM and BOM.
- CHS: its reply on [tide-database#320](https://github.com/openwatersio/slackwater-database/issues/320) says any commercial use, derivatives included, needs a separate license, and it isn't taking new commercial requests while its licensing program (including the Value-Added Reseller Licence) is reviewed. Apply when the new options appear.
- The 304 TICON `meds` records are Canadian gauge data that tide-database marks CC BY 4.0 with commercial use, on TICON's label. Check whether CHS's terms reach them, the same question GESLA's license page raises.
