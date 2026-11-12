# Realtime ingest and the levels API

How observed levels reach the API within minutes of a source publishing them. A Stillwell server runs ClickHouse and a poller: the poller fetches each live station on its source's interval and inserts what it hasn't seen, QC flags it, and the API reads it straight from ClickHouse. The Parquet files on R2 stay the record and the public product: the server exports to them, and a new server rebuilds from them and ClickHouse's own backups.

## Goals

- A value is in the API within one source interval of the source publishing it, plus a minute.
- Only the server asks sources for current values. The API never calls a source.
- The server is disposable: R2 holds everything needed to rebuild it.
- Batch jobs (backfill, requalify, analysis) never hold up current values, and current values never hold up batch jobs.
- The public files on R2 keep their layout, so readers of the bulk data see no change.

## Why a server

Realtime levels for Slackwater need values minutes old, but the bigger reasons are the limits of building the store on GitHub Actions and Parquet alone:

- **Jobs queue behind each other.** Every job that writes a source's files shares its `store-<source>` concurrency group, so a long backfill or requalify holds up that source's hourly ingest, and runs waiting in the group get cancelled. ClickHouse takes concurrent inserts, so batch work and current values don't wait on each other.
- **Schedules are unreliable.** GitHub runs `schedule` workflows late or not at all, which takes a cron Worker dispatching every workflow, plus a monthly job to keep schedules from being disabled. A service on its own box keeps its own timers.
- **Rewriting files is the only way to change them.** The recent window and the year files are rewritten whole by several jobs, which is what forces the concurrency groups, and compaction's nightly rewrite of every current-year file grows through the year. In ClickHouse a change is an insert, and the export to Parquet is a single step that runs on a schedule.
- **Fresh values need something always running.** Polling on each source's interval, a minute for some, doesn't fit jobs that queue for a runner and start cold.

## The server

A Hetzner box of its own, `stillwell-1`, in the Ashburn site, nearest most of Slackwater's users and apart from aiscast's, so one site's bad day doesn't take down both. It's set up the way aiscast's is: `server/deploy/` in this repo with `apply.sh` and `deploy.sh`, CI deploying on every merge to `main`, Grafana Alloy sending metrics to Grafana Cloud, and the same SSH hardening and `ops` user. It runs:

- **ClickHouse**, on loopback only, with a database `stillwell` for public sources and `stillwell_restricted` for sources whose terms bar republishing.
- **`stillwell-ingest`**, a Node service running this repo's adapters, QC, jobs and export.
- **`cloudflared`**, publishing ClickHouse's HTTP interface through a Cloudflare Tunnel behind Access, so no port is open.

The store is about 7.3 billion rows at most across every station's span, and the live stations add about 0.9 million a day. With the codecs below, ClickHouse needs about 2 to 4 bytes a row for series like these, 15 to 30 GB in all, and 2 to 3 times that without them. A full load and the merges of year partitions need room for a second copy of a partition, so the box is a CPX41 (8 vCPU, 16 GB, 240 GB disk), with ClickHouse's `max_server_memory_usage` and merge limits set so the poller keeps its share.

## Tables

```sql
CREATE TABLE observations (
  station  LowCardinality(String),               -- `<source>/<source_id>`
  epoch    UInt16,                               -- datum epoch, as in stations/<source>.parquet
  time     DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD),
  level    Float32 CODEC(Gorilla, ZSTD),         -- meters, in the epoch's datum; FLOAT, as the files store it
  flag     UInt8,                                -- Flag: the worse of the source's and QC's
  source_flag Nullable(UInt8),
  received Nullable(DateTime64(3, 'UTC')) CODEC(DoubleDelta, ZSTD),
  checked  Bool,                                 -- QC has judged this value
  version  UInt64                                -- the insert's time; the highest wins
) ENGINE = ReplacingMergeTree(version)
PARTITION BY toYear(time)
ORDER BY (station, epoch, time);
```

A reader asks with `FINAL`, which is cheap for one station since its rows sort together, and with `do_not_merge_across_partitions_select_final`, since a station's rows for one time never span two years. Extremes, predictions and predicted extremes get tables of the same shape when their jobs move in.

The other tables:

- `stations` and `epochs`: each source's list and datum epochs, as `stations/<source>.parquet` holds them, loaded from R2 whenever a refresh writes it.
- `offsets`: for each station epoch and datum, the meters to add to a level in that epoch to refer it to that datum, `to_current` included. The code that builds `stations.parquet` writes it, so the API's SQL only joins and adds, and the datum arithmetic stays in one TypeScript implementation.
- `polls`: one row per source pass, with which stations reported, failed or went stale, and why.
- `jobs`: each backfill, refetch, requalify or other job, with its arguments, state, progress and result.
- `changes`: the station-years each insert touched since their last export.
- `loaded`: the station-years whose whole history ClickHouse holds, which the year export requires.

## The poller

For each source with `hourly` set in its metadata, `stillwell-ingest` runs passes at the source's `min_interval_s`, through the source's `recent` sweep where it has one (USGS), otherwise station by station with the source's own pacing:

1. It asks from a few intervals before the station's newest value, so a value the source fills in late still arrives.
2. It drops every value whose time, level and `source_flag` it already holds, comparing levels as the 32-bit floats the table stores, and inserts the rest with `checked` false. So a revised level and a source's new flag on an old value both arrive. A value's first insert sets `received` to the pass's time, and later versions keep it. The API serves new values as soon as they're inserted.
3. QC then reads the last 7 days of each station that changed, runs `qcFor` with the source's errata spans, as `updateRecent` does, and inserts every row it judged with `checked` true, its flag set by QC. QC stays TypeScript, so the archive and the live values share one implementation.
4. It records the pass in `polls` and its metrics.

Every writer of a station's rows, the poller, QC and every job, holds that station's lock in `stillwell-ingest` from reading the rows to inserting them, so QC never writes back a level a pass has since revised. Jobs work station by station, so a requalify of a whole source holds up the poller by one station's work at most.

A station that leaves its source's list or stops being live drops out of the next pass. The adapter's `withheld` is checked every pass, so a withholding stops the station as soon as it deploys, and the poller then deletes the station's rows. The export also leaves out every withheld station, so a withheld station's values can't reach R2 again from rows not yet deleted, and the restricted database never exports to the public bucket.

When the adapter throws `DatumChanged`, the poller pauses the station, keeps its rows, and dispatches the Monthly refresh for that source through the GitHub API, at most once a day, as the hourly workflow does. Once the refresh opens the new epoch, the poller resumes the station in it; a station whose new epoch is held for a decision (`isHeld`) stays paused.

## Exporting to R2

ClickHouse writes Parquet to R2 itself (`INSERT INTO FUNCTION s3(...) SELECT ...`), in the files' current schema, levels as FLOAT:

- **Every 15 minutes, until step 2:** `recent/<source>.parquet`, the 7-day window `compact` reads, so `compact` and everything after it keeps working unchanged.
- **Nightly, from step 2 on:** every station-year in `changes` that is in `loaded` becomes `obs/<source>/<station>/[<epoch>/]<year>.parquet`, in the layout and sort order it has now, written whole, then the bounds, `stations.parquet` and `stations/analysis/<source>.parquet` with its `rules`, `judge` and `requalified` columns. That's about 14,000 files a night from the live stations, plus whatever jobs changed: about 1 million PUTs a month. A station-year that isn't in `loaded` is never exported, so a partial history can't overwrite a year file.

The restricted database exports to `STILLWELL_RESTRICTED_STORE`, never the public bucket.

ClickHouse also backs itself up to R2 every night, as aiscast's does, a full backup at the start of each month and an incremental one every other night, because `received` can't be fetched again. A new server restores the latest backup, loads any year files written since, and the poller refetches the hours since.

## Jobs

From step 2, backfill, the monthly refetch, requalify, analysis and withhold are jobs `stillwell-ingest` runs. A job is started by a row in `jobs`, inserted through the Tunnel by a ClickHouse user that can write only that table, or by a workflow that does the same, for one source or for one station and its years. `jobs` shows when it ran, how far it got and whether it succeeded. Requalify keeps its per-station budget and resumes where it stopped.

A deploy that changes a source's `errata.json` queues a requalify of the station-years the changed entries cover.

A full requalify under new rules inserts a new version of most rows, which doubles those partitions until ClickHouse merges them. It runs one year partition at a time and runs `OPTIMIZE ... PARTITION ... FINAL` after each, so `FINAL` reads stay fast and disk use stays bounded.

## The levels API

`workers/api`, bound into the api.openwaters.io gateway as `WATER_LEVELS` on `/water-levels*`. `GET /water-levels/stations/{source}/{id}/levels` serves the last hours and the archive alike; there is no separate `live` endpoint.

1. Check the parameters: a known `step`, a range within the limits, a datum the station has an offset to.
2. Round `start` and `end` to the step, and a range relative to now, such as the default 7 days, to the station's interval, so every client asking for the same thing shares one cache key. A 1-minute station gets a new key every minute, which matches its `max-age`.
3. Answer from the Cache API when it holds the key.
4. Otherwise send ClickHouse one query, with parameters bound through its HTTP interface (`{station:String}`), never built into the SQL. It takes the sample nearest each step time, adds the epoch's offset to the requested datum from `offsets`, leaves out `bad` values unless `includeBad`, converts units, and returns the station's metadata and its source's last pass from `polls` in the same round trip.
5. Build the response in [api.md](api.md)'s shape: `as_of`, `updated`, `status`, `datum`, `datums`, `frame`, `attribution`, `notice`, and the levels with their flags, a value QC hasn't judged yet marked `"checked": false`.
6. Cache it: a range that ended before today for a day, one that reaches now for the station's `min_interval_s`. The Worker keeps the last good copy longer, and serves it with `status: stale` when ClickHouse doesn't answer.

The Worker reaches ClickHouse as a read-only user (`readonly=1`), with a short `max_execution_time`, row limits and a quota, through the Tunnel with an Access service token held as a Worker secret. It has no adapters, no Parquet reader and no DuckDB: a router, the parameter checks, the SQL, a `fetch`, and the response. Its tests use `@cloudflare/vitest-pool-workers` with ClickHouse's answers faked, and the SQL has tests of its own against a ClickHouse service container in CI.

## Order of work

1. **Phase 9: realtime.** The server, ClickHouse, the poller and QC for every hourly source, the `recent/` export, the nightly backup, and the Worker serving `levels` for ranges inside the poller's window, ClickHouse keeping 30 days, which covers Slackwater's 96 hours and the 7 days `recent/` needs. The hourly workflow's `recent` jobs stop, and its alert job becomes Grafana alerts on `polls`. Backfill, refetch, requalify, analysis, withhold and `compact` stay in Actions, unchanged, so fixes to them, such as USGS compaction's growing run time, still land there.
2. **History moves in, one source at a time.** For each source: stop its Actions jobs that write year files, load its year files into ClickHouse and mark them `loaded`, move its backfill, refetch, requalify, analysis and withhold to jobs on the server, then let the nightly export own its files. A source's Actions writers and the export never run side by side, since each would overwrite the other's year files. A source waits for its running backfills, its current-year backfill included, to finish before it moves. Once every source has moved, `compact`, `recent/` and the `store-<source>` concurrency groups go, and the Worker serves `levels` over any range, which phase 10 needs.
3. **Lists and publishing move in.** The station refresh and `publish` run on the server. Actions keeps CI, deploys and the canary, and the cron Worker retires.

## Costs

The CPX41 is about $35 a month at Hetzner's US prices, to confirm when ordering, and R2's writes and backups a few dollars, against the GitHub Actions minutes and R2 rewrites the hourly and daily jobs use now.
