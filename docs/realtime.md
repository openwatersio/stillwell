# Realtime ingest and the levels API

How observed levels reach the API within minutes of a source publishing them. A Stillwell server runs ClickHouse and a poller: the poller fetches each live station on its source's interval and inserts what it hasn't seen, QC flags it, and the API reads it straight from ClickHouse. The Parquet files on R2 stay the record and the public product: the server exports to them, and a new server rebuilds from them.

## Goals

- A value is in the API within one source interval of the source publishing it, plus a minute.
- Only the server asks sources for current values. The API never calls a source.
- The server is disposable: R2 holds everything that can't be fetched again.
- Batch jobs (backfill, requalify, analysis) never hold up current values, and current values never hold up batch jobs.
- The public files on R2 keep their layout, so readers of the bulk data see no change.

## The server

A Hetzner box of its own, `stillwell-1`, set up the way aiscast's is: `server/deploy/` in this repo with `apply.sh` and `deploy.sh`, CI deploying on every merge to `main`, Caddy only if something is served publicly, Grafana Alloy sending metrics to Grafana Cloud, and the same SSH hardening and `ops` user. It runs:

- **ClickHouse**, on loopback only, with a database `stillwell` for public sources and `stillwell_restricted` for sources whose terms bar republishing.
- **`stillwell-ingest`**, a Node service running this repo's adapters, QC and export.
- **`cloudflared`**, publishing ClickHouse's HTTP interface to the API Worker through a Cloudflare Tunnel behind Access, so no port is open.

The store is about 7.3 billion rows at most across every station's span, and the live stations add about 0.9 million a day. At the 2 to 4 bytes a row ClickHouse typically needs for series like these, all of it is 15 to 30 GB, so one box with a 160 GB disk holds the whole history. The box goes in Hetzner's Ashburn site, nearest most of Slackwater's users, as a CPX31 (4 vCPU, 8 GB).

## Tables

```sql
CREATE TABLE observations (
  station  String,                 -- `<source>/<source_id>`
  epoch    UInt16,                 -- datum epoch, as in stations/<source>.parquet
  time     DateTime64(3, 'UTC'),
  level    Float64,                -- meters, in the epoch's datum
  flag     UInt8,                  -- Flag: the worse of the source's and QC's
  source_flag Nullable(UInt8),
  received Nullable(DateTime64(3, 'UTC')),
  checked  Bool,                   -- QC has judged this value
  version  UInt64                  -- the insert's time; the highest wins
) ENGINE = ReplacingMergeTree(version)
PARTITION BY toYear(time)
ORDER BY (station, epoch, time);
```

A reader asks with `FINAL`, which is cheap for one station since its rows sort together. Extremes, predictions and predicted extremes get tables of the same shape when their jobs move in.

The other tables:

- `stations` and `epochs`: each source's list and datum epochs, as `stations/<source>.parquet` holds them, loaded from R2 whenever a refresh writes it.
- `polls`: one row per source pass, with which stations reported, failed or went stale, and why.
- `changes`: the station-years each insert touched since their last export, by job.

## The poller

For each source with `hourly` set in its metadata, `stillwell-ingest` runs passes at the source's `min_interval_s`, through the source's `recent` sweep where it has one (USGS), otherwise station by station with the source's own pacing:

1. It asks from a few intervals before the station's newest value, so a value the source fills in late still arrives.
2. It drops every value whose time and level it already holds, and inserts the rest with `checked` false. A value's first insert sets `received` to the pass's time, and later versions keep it. The API serves new values as soon as they're inserted.
3. QC then reads each station's last 7 days that changed, runs `qcFor` with the source's errata spans, as `updateRecent` does, and inserts the rows whose flag changed, with `checked` true. QC stays TypeScript, so the archive and the live values share one implementation.
4. It records the pass in `polls` and its metrics.

A station that leaves its source's list, stops being live or is withheld drops out of the next pass; the adapter's `withheld`, checked every pass, stops a withholding that reaches `main` before the next list refresh. When the adapter throws `DatumChanged`, the poller pauses the station, keeps its rows, and dispatches the Monthly refresh for that source through the GitHub API, at most once a day, as the hourly workflow does. Once the refresh opens the new epoch, the poller resumes the station in it; a station whose new epoch is held for a decision (`isHeld`) stays paused.

## Exporting to R2

ClickHouse writes Parquet to R2 itself (`INSERT INTO FUNCTION s3(...) SELECT ...`):

- **Nightly**, after the last UTC day closes: every station-year in `changes` becomes `obs/<source>/<station>/[<epoch>/]<year>.parquet`, in the layout and sort order it has now, written whole, then the bounds and `stations.parquet`. That's about 14,000 files a night from the live stations, plus whatever batch jobs changed: about 1 million PUTs a month.
- **While batch jobs still run in Actions** (step 1 below): every 15 minutes, `recent/<source>.parquet`, the 7-day window `compact` reads, so `compact` and everything after it keeps working unchanged.

The restricted database exports to `STILLWELL_RESTRICTED_STORE`, never the public bucket.

A new server deploys, loads the history from R2 with `INSERT ... SELECT FROM s3('obs/**/*.parquet')`, and the poller refetches the hours since the last export. Nothing needs a ClickHouse backup.

## The levels API

`workers/api`, bound into the api.openwaters.io gateway as `WATER_LEVELS` on `/water-levels*`. `GET /water-levels/stations/{source}/{id}/levels` serves the last hours and the archive alike; there is no separate `live` endpoint.

1. Check the parameters: a known `step`, a range within the limits, a datum the station has an offset to.
2. Round `start` and `end` to the step, and a range relative to now, such as the default 7 days, to the station's interval, so every client asking for the same thing shares one cache key.
3. Answer from the Cache API when it holds the key.
4. Otherwise send ClickHouse one query, with parameters bound through its HTTP interface (`{station:String}`), never built into the SQL. It takes the sample nearest each step time, converts each epoch through `to_current` and then to the requested datum by joining `epochs` and `stations`, leaves out `bad` values unless `includeBad`, converts units, and returns the station's metadata and its source's last pass from `polls` in the same round trip.
5. Build the response in [api.md](api.md)'s shape: `as_of`, `updated`, `status`, `datum`, `datums`, `frame`, `attribution`, `notice`, and the levels with their flags, a value QC hasn't judged yet marked `"checked": false`.
6. Cache it: a range that ended before today for a day, one that reaches now for the station's `min_interval_s`. The Worker keeps the last good copy longer, and serves it with `status: stale` when ClickHouse doesn't answer.

The Worker reaches ClickHouse as a read-only user (`readonly=1`), with a short `max_execution_time`, row limits and a quota, through the Tunnel with an Access service token held as a Worker secret. It has no adapters, no Parquet reader and no DuckDB: a router, the parameter checks, the SQL, a `fetch`, and the response. Its tests use `@cloudflare/vitest-pool-workers` with ClickHouse's answers faked, and the SQL has tests of its own against a ClickHouse service container in CI.

## Order of work

1. **Phase 9: realtime.** The server, ClickHouse, the poller and QC for every hourly source, the `recent/` export, and the Worker serving `levels` for ranges inside the poller's window, ClickHouse keeping 30 days until step 2 loads the history. The hourly workflow's `recent` jobs stop, and its alert job becomes Grafana alerts on `polls`. Backfill, refetch, requalify, analysis, withhold and `compact` stay in Actions, unchanged.
2. **History moves in.** ClickHouse loads every year file. Backfill, the monthly refetch, requalify, analysis and withhold become commands on the server, each writing ClickHouse and `changes`, one per PR. The nightly export takes over the year files, and `compact`, `recent/` and the `store-<source>` concurrency groups go. The Worker serves `levels` over any range, which phase 10 needs.
3. **Lists and publishing move in.** The station refresh and `publish` run on the server. Actions keeps CI, deploys and the canary, and the cron Worker retires.

## Costs

The CPX31 is about $20 a month and R2's writes a few dollars, against the GitHub Actions minutes and R2 rewrites the hourly and daily jobs use now.

## Open decisions

1. ClickHouse's window in step 1: 30 days (recommended), or the 7 days `recent/` holds.
2. The box's site: Ashburn (recommended, nearest Slackwater's users) or Falkenstein beside aiscast (nearer the European sources, but the poller's latency to them doesn't matter).
