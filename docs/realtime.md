# Realtime ingest and the levels API

How observed levels reach the API within minutes of a source publishing them. The Parquet files on R2 are the store's record. A Stillwell server polls the sources into ClickHouse, runs QC, exports to R2, and serves the API from what it holds. Everything on the server either is already on R2 or can be fetched or run again, so it needs no backups: a new server rebuilds from R2.

## Goals

- A value is in the API within one source interval of the source publishing it, plus a minute.
- Only the server asks sources for current values. The API never calls a source.
- R2 is the record. Losing the server loses nothing that can't be fetched again, and needs no backup to recover.
- Batch jobs (backfill, requalify, analysis) never hold up current values, and current values never hold up batch jobs.
- The public files on R2 keep their layout, so readers of the bulk data see no change.

## Why a server

Realtime levels for Slackwater need values minutes old, but the bigger reasons are the limits of building the store on GitHub Actions and Parquet alone:

- **Jobs queue behind each other.** Every job that writes a source's files shares its `store-<source>` concurrency group, so a long backfill or requalify holds up that source's hourly ingest, and runs waiting in the group get cancelled. ClickHouse takes concurrent inserts, so batch work and current values don't wait on each other.
- **Schedules are unreliable.** GitHub runs `schedule` workflows late or not at all, which takes a cron Worker dispatching every workflow, plus a monthly job to keep schedules from being disabled. A service on its own box keeps its own timers.
- **Rewriting files is the only way to change them.** The recent window and the year files are rewritten whole by several jobs, which is what forces the concurrency groups, and compaction's nightly rewrite of every current-year file grows through the year. In ClickHouse a change is an insert, and the export to Parquet is a single step.
- **Fresh values need something always running.** Polling on each source's interval, a minute for some, doesn't fit jobs that queue for a runner and start cold.

## The server

A Hetzner box of its own, `stillwell-1`, in the Ashburn site, nearest most of Slackwater's users and apart from aiscast's, so one site's bad day doesn't take down both. It's set up the way aiscast's is: `server/deploy/` in this repo with `apply.sh` and `deploy.sh`, CI deploying on every merge to `main`, Grafana Alloy sending metrics to Grafana Cloud, and the same SSH hardening and `ops` user. It runs:

- **ClickHouse**, on loopback only, with a database `stillwell` for public sources and `stillwell_restricted` for sources whose terms bar republishing.
- **`stillwell-ingest`**, a Node service running the poller: this repo's adapters and QC.
- **`stillwell-jobs`**, a Node service running the jobs: backfill, refetch, requalify, analysis, withhold, the station refresh and the export, each in a child process with a memory limit, so a job that fails or runs out of memory never stops the poller.
- **`stillwell-api`**, a Node service serving the API on loopback from ClickHouse and the station tables.
- **`cloudflared`**, publishing `stillwell-api` through a Cloudflare Tunnel behind Access, so no port is open and ClickHouse is never reachable from outside.

The store is about 7.3 billion rows at most across every station's span, and the live stations add about 0.9 million a day. With the codecs below, ClickHouse needs about 2 to 4 bytes a row for series like these, 15 to 30 GB in all, and 2 to 3 times that without them. The largest partition, a year of every station, is 1 to 2 GB, so the second copy a merge needs is small. The work is light: about 10 inserted rows a second, API reads of one station, and jobs that go station by station. So the box is a CPX31 (4 vCPU, 8 GB, 160 GB disk), with ClickHouse's `max_server_memory_usage` at about 5 GB and its merge limits set so the poller and the API keep their share, and the history loaded a source and a year at a time. Hetzner resizes a box in minutes, so it grows if the load says so.

## What lives where

R2 holds the record: the year files, the station lists and their history, the bounds, the analysis files and `stations.parquet`, as now. The server holds:

- **A copy of the history**, loaded from R2.
- **Values polled since the last export.** The sources still hold them, so a new server fetches them again.
- **Changes jobs are making.** A job finishes only once the station-years it changed are exported to R2, so a finished job's work is never only on the server. A job the server loses partway is run again.
- **Working state**: `polls`, the list of unexported changes and the job queue, which a new server starts empty.

The one thing a lost server can't get back is `received` for the values polled since the last export: fetched again, they arrive with `received` empty, as backfilled values do. Nothing reads `received` yet, and the forecast work that will can skip the gap.

A new server deploys, loads the year files from R2 with `INSERT ... SELECT FROM s3('obs/**/*.parquet')`, marks them `loaded`, and the poller fetches the days since the last export.

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
- `offsets`: for each station epoch and datum, the meters to add to a level in that epoch to refer it to that datum, `to_current` included, from `stations/offsets.parquet`, which `src/datums.ts` writes beside `stations.parquet` on every publish and the server reloads on every publish. An epoch that doesn't convert (`to_current` null, held epochs included) has rows only for its own datum, so a request in any other datum leaves it out. A station's default datum is `coalesce(chart_datum, datum)`, and datum names in requests must match the table's keys exactly.
- `polls`: one row per source pass, with which stations reported, failed or went stale, and why.
- `changes`: the station-years each insert touched since their last export.
- `loaded`: the station-years whose whole history ClickHouse holds, which the year export requires.

## The poller

For each source with `hourly` set in its metadata, `stillwell-ingest` runs passes at the source's `min_interval_s`, through the source's `recent` sweep where it has one (USGS), otherwise station by station with the source's own pacing:

1. It asks from a few intervals before the station's newest value, so a value the source fills in late still arrives.
2. It drops every value whose time, level and `source_flag` it already holds, comparing levels as the 32-bit floats the table stores, and inserts the rest with `checked` false. So a revised level and a source's new flag on an old value both arrive. A value's first insert sets `received` to the pass's time, and later versions keep it. The API serves new values as soon as they're inserted.
3. QC then reads the last 7 days of each station that changed, runs `qcFor` with the source's errata spans, as `updateRecent` does, and inserts every row it judged with `checked` true, its flag set by QC. QC stays TypeScript, so the archive and the live values share one implementation.
4. It records the pass in `polls` and its metrics.

Every writer of a station's rows, the poller, QC and every job, holds that station's lock in the job queue's database from reading the rows to inserting them, so QC never writes back a level a pass has since revised. Jobs work station by station, so a requalify of a whole source holds up the poller by one station's work at most.

A station that leaves its source's list or stops being live drops out of the next pass. The adapter's `withheld` is checked every pass, so a withholding stops the station as soon as it deploys, and the poller then deletes the station's rows. The export also leaves out every withheld station, so a withheld station's values can't reach R2 again from rows not yet deleted, and the restricted database never exports to the public bucket.

When the adapter throws `DatumChanged`, the poller pauses the station, keeps its rows, and dispatches the Monthly refresh for that source through the GitHub API, at most once a day, as the hourly workflow does. Once the refresh opens the new epoch, the poller resumes the station in it; a station whose new epoch is held for a decision (`isHeld`) stays paused.

## Exporting to R2

ClickHouse writes Parquet to R2 itself (`INSERT INTO FUNCTION s3(...) SELECT ...`), in the files' current schema, levels as FLOAT:

- **Every 15 minutes, until step 2:** `recent/<source>.parquet`, the 7-day window `compact` reads, so `compact` and everything after it keeps working unchanged.
- **From step 2 on:** every station-year in `changes` that is in `loaded` becomes `obs/<source>/<station>/[<epoch>/]<year>.parquet`, in the layout and sort order it has now, written whole, then the bounds, `stations.parquet` and `stations/analysis/<source>.parquet` with its `rules`, `judge` and `requalified` columns. Polled values export nightly, after each UTC day closes: about 14,000 files a night, about 1 million PUTs a month. A job's changes export when the job ends, before it reports success. A station-year that isn't in `loaded` is never exported, so a partial history can't overwrite a year file.

The restricted database exports to `STILLWELL_RESTRICTED_STORE`, never the public bucket.

## Jobs

From step 2, backfill, the monthly refetch, requalify, analysis, withhold and the export are jobs, and from step 3 the station refresh and `publish` too. `stillwell-jobs` runs them from a queue in SQLite (`node:sqlite`, built into Node), a file on the server in WAL mode that both services open:

- **Queue:** each job with its kind, source, arguments, state, attempts, progress and result. A worker claims a job in a transaction and holds a lease it renews while the job runs, so a job runs once, and one whose worker died is claimed again when its lease runs out.
- **Concurrency:** one job at a time per source, so a source's rate limits hold, and a few sources at once.
- **Retries:** a failed job is retried with backoff, a few times, then stays failed for a maintainer to see.
- **Schedules:** in code. A recurring job is queued under a key for its run, such as `export:2026-11-12` or `refetch:2026-11`, so a restart or a late timer never queues the same run twice.
- **Locks:** the per-station locks every writer of a station's rows holds, with leases, so a process that dies holding one doesn't block the station.

Jobs are idempotent and resume where they stopped, as requalify does now with its per-station budget, and a job finishes only once its changes are on R2. So losing the queue loses nothing: a new server queues anything unfinished again.

A job is started for one source, or for one station and its years, through an admin endpoint of `stillwell-api` behind its own Access service token, from a workflow or a maintainer's machine. The same endpoint shows when a job ran, how far it got and whether it succeeded, and Grafana gets queue depth, running jobs, failures and run times per kind.

A deploy that changes a source's `errata.json` queues a requalify of the station-years the changed entries cover.

A full requalify under new rules inserts a new version of most rows, which doubles those partitions until ClickHouse merges them. It runs one year partition at a time and runs `OPTIMIZE ... PARTITION ... FINAL` after each, so `FINAL` reads stay fast and disk use stays bounded.

## The levels API

`GET /water-levels/stations/{source}/{id}/levels` serves the last hours and the archive alike; there is no separate `live` endpoint. Two pieces serve it:

- **`workers/api`**, bound into the api.openwaters.io gateway as `WATER_LEVELS` on `/water-levels*`. It normalizes the request into a cache key, answers from the Cache API when it can, and otherwise forwards to `stillwell-api` through the Tunnel with an Access service token held as a Worker secret. It caches what comes back by its `Cache-Control`, keeps the last good copy longer, and serves that with `status: stale` when the server doesn't answer.
- **`stillwell-api`** on the server, which does the work:

1. Check the parameters: a known `step`, a range within the limits, a datum the station has an offset to.
2. Query ClickHouse on loopback, with parameters bound (`{station:String}`), never built into the SQL: the sample nearest each step time, plus the epoch's offset to the requested datum from `offsets`, leaving out `bad` values unless `includeBad`. Station metadata comes from the station tables it holds in memory, and `updated` from the source's last pass in `polls`.
3. Build the response in [api.md](api.md)'s shape: `as_of`, `updated`, `status`, `datum`, `datums`, `frame`, `attribution`, `notice`, and the levels with their flags, a value QC hasn't judged yet marked `"checked": false`.
4. Set `Cache-Control`: a day for a range that ended before today, the station's `min_interval_s` for one that reaches now.

The Worker rounds `start` and `end` to the step, and a range relative to now, such as the default 7 days, to the station's interval, so every client asking for the same thing shares one cache key. A 1-minute station gets a new key every minute, which matches its `max-age`.

`stillwell-api` reuses this repo's TypeScript: the schema, the flags and the datum code. The Worker is a cache and a proxy of a few dozen lines. `stillwell-api`'s tests run against a ClickHouse service container in CI, and the Worker's with `@cloudflare/vitest-pool-workers` and the server faked.

## Order of work

1. **Phase 9: realtime.** The server, ClickHouse, the poller and QC for every hourly source, the `recent/` export, `stillwell-api` and the Worker serving `levels` for ranges inside the poller's window, ClickHouse keeping 30 days, which covers Slackwater's 96 hours and the 7 days `recent/` needs. The hourly workflow's `recent` jobs stop, and its alert job becomes Grafana alerts on `polls`. Backfill, refetch, requalify, analysis, withhold and `compact` stay in Actions, unchanged, so fixes to them, such as USGS compaction's growing run time, still land there.
2. **History moves in, one source at a time.** For each source: stop its Actions jobs that write year files, load its year files into ClickHouse and mark them `loaded`, move its backfill, refetch, requalify, analysis and withhold to jobs on the server, then let the export own its files. A source's Actions writers and the export never run side by side, since each would overwrite the other's year files. A source waits for its running backfills, its current-year backfill included, to finish before it moves. Once every source has moved, `compact`, `recent/` and the `store-<source>` concurrency groups go, and `levels` serves any range, which phase 10 needs.
3. **Lists and publishing move in.** The station refresh and `publish` run on the server. Actions keeps CI, deploys and the canary, and the cron Worker retires.

## Costs

The CPX31 is about $20 a month at Hetzner's US prices, to confirm when ordering, and R2's writes a few dollars, against the GitHub Actions minutes and R2 rewrites the hourly and daily jobs use now.
