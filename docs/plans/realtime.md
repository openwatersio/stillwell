# Realtime ingest and the levels API

How observed levels reach the API within minutes of a source publishing them. The Parquet files on R2 are the store's record. A Stillwell server polls the sources into ClickHouse, runs QC, exports to R2, and serves the API from what it holds. Everything on the server either is already on R2 or can be fetched or run again, so it needs no backups: a new server rebuilds from R2.

## Goals

- A value is in ClickHouse within one of its station's intervals of the source publishing it, plus the pass's time, and reaches a client within 5 minutes more, the longest the Worker caches a range that reaches the present.
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

A Hetzner box of its own, `stillwell-1`, at a site apart from aiscast's, so one site's bad day doesn't take down both. It's set up the way aiscast's is: `server/deploy/` in this repo with `apply.sh` and `deploy.sh`, CI deploying on every merge to `main`, Grafana Alloy sending metrics to Grafana Cloud, and the same SSH hardening and `ops` user. It runs:

- **ClickHouse**, on loopback only, with a database `stillwell` for public sources and `stillwell_restricted` for sources whose terms bar republishing.
- **`stillwell-ingest`**, a Node service running the poller: this repo's adapters and QC.
- **`stillwell-jobs`**, a Node service running the jobs: backfill, refetch, requalify, analysis, withhold, the station refresh and the export, each in a child process with a memory limit, so a job that fails or runs out of memory never stops the poller.
- **`stillwell-api`**, a Node service serving the API on loopback from ClickHouse and the station tables.
- **`cloudflared`**, publishing `stillwell-api` through a Cloudflare Tunnel behind Access, so no port is open and ClickHouse is never reachable from outside.

The store is about 7.3 billion rows at most across every station's span, and the live stations add about 0.9 million a day. With the codecs below, ClickHouse needs about 2 to 4 bytes a row for series like these, 15 to 30 GB in all, and 2 to 3 times that without them. The largest partition, a year of every station, is 1 to 2 GB, so the second copy a merge needs is small. The work is light: about 10 inserted rows a second, API reads of one station, and jobs that go station by station. So the box is a CPX31 (4 vCPU, 8 GB, 160 GB disk), with ClickHouse's `max_server_memory_usage` at 4 GB while it holds only the recent window, raised as the history moves in, and its merge limits set so the poller and the API keep their share, and the history loaded a source and a year at a time. Hetzner resizes a box in minutes, so it grows if the load says so.

## What lives where

R2 holds the record: the year files, the station lists and their history, the bounds, the analysis files and `stations.parquet`, as now. The server holds:

- **A copy of the history**, loaded from R2.
- **Values polled since the last export.** The sources still hold them, so a new server fetches them again.
- **Changes jobs are making.** A job finishes only once the station-years it changed are exported to R2, so a finished job's work is never only on the server. A job the server loses partway is run again.
- **Working state**: `polls`, the list of unexported changes and the job queue, which a new server starts empty.

The one thing a lost server can't get back is `received` for the values polled since the last export: fetched again, they arrive with `received` empty, as backfilled values do. Nothing reads `received` yet, and the forecast work that will can skip the gap.

A new server deploys and fills ClickHouse from R2: each source's first pass after every start adds the values in `recent/<source>.parquet` that ClickHouse lacks, `received` included, so the API has the last 7 days at once. It adds only what ClickHouse lacks, since ClickHouse is usually the newer of the two, so a value the source revised or withdrew while the server was down, more than 12 hours before it restarts, keeps ClickHouse's copy until it ages out; from step 2, it also loads the year files with `INSERT ... SELECT ... FROM s3('obs/**/*.parquet')`, projecting each file's columns onto the table's and taking `station` and `epoch` from the file's path (`_path`), at version 0, so a value the poller has already written wins, and marks them `loaded`. The poller then fetches up to 12 hours back, as the hourly workflow does, and anything older than that and missing from R2 waits for a backfill.

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
  version  UInt64                                -- the highest wins: the pass's start in step 1, a counter in the job queue's database from step 2
) ENGINE = ReplacingMergeTree(version)
PARTITION BY toYear(time)
ORDER BY (station, time)
TTL toDateTime(time) + INTERVAL 8 DAY;  -- step 1 only: step 2 runs ALTER TABLE observations REMOVE TTL, and creates the table without it, before it loads the history
```

A value is keyed by station and time, not epoch, so a value a refresh moves to a new epoch replaces its row in the old one. A reader asks with `FINAL`, which is cheap for one station since its rows sort together, and with `do_not_merge_across_partitions_select_final`, since a station's rows for one time never span two years. Extremes, predictions and predicted extremes get tables of the same shape when their jobs move in.

The other tables:

- `stations` and `epochs`: each source's list and datum epochs, as `stations/<source>.parquet` holds them, loaded from R2 whenever a refresh writes it.
- `offsets`: for each station epoch and named datum it converts to, the meters to add to a level in that epoch to refer it to that datum, `to_current` included, from `stations/offsets.parquet`, which `publish` writes beside `stations.parquet` (openwatersio/stillwell#168) and the server reloads on every publish. It holds only real conversions: a station's own label, such as NAP, STND or RWS's own MSL on its offshore platforms, has a row only where it is the station's `chart_datum`, as at Kartverket, so `datum=MSL` finds no row for RWS's MSL and is a 400, as api.md says. `datum=station` needs no row: it's the epoch's own reference, converted only through `to_current`. An epoch that doesn't convert (`to_current` null, held epochs included) has no rows, so a request in a named datum leaves it out. A station's default datum is `coalesce(chart_datum, datum)`, and datum names in requests must match the table's keys exactly. The table carries no credits or terms: a response joins `stations.parquet` for `datums_attribution`, the credits owed for its offsets, and `commercial_use`.
- `polls`: one row per source pass: which interval groups it asked for and whether it ended cleanly, how many stations it asked and how many sent new values, how many values were new, which stations failed and why, which went stale, and whether the source blocked the client or reported a datum change.
- `changes`: the station-years each insert or delete touched since their last export. A station-year whose last value was deleted exports as a deleted file.
- `loaded`: the station-years whose whole history ClickHouse holds, which the year export requires.

## The poller

For each source with `hourly` set in its metadata, `stillwell-ingest` (`server/ingest.ts`) asks each live station at its own `min_interval_s`, or hourly where it gives none, as the hourly workflow did. It groups a source's stations by that interval and runs one pass at a time per source over the groups that are due, so the source's pacing holds; a source with a short-interval group and a long pass of another waits for that pass, which a source's mix of intervals keeps rare, through the source's `recent` sweep where it has one (USGS), otherwise station by station. Each pass reads the list again, so a station added at a new interval is fetched in the next pass. Sources start 20 seconds apart, so a restart doesn't run every source's first pass at once. Each pass runs in a process of its own (`server/pass.ts`), so an adapter's state, such as CO-OPS's block after repeated refusals or Kartverket's cached datum check, lasts one pass, as it lasts one workflow run. Three passes run at a time across all sources, each holding up to about 600 MB, so a pass can wait for a slot behind other sources' passes; its intervals count from when it begins, and rests and retries from when it ends. A pass that fails waits for its groups' intervals like one that succeeds, so a failure never asks a source sooner; one that fails before the source's groups are known is tried again in 5 minutes, and a source with no list yet, or nothing to poll, is read again hourly. A pass the source blocked rests the source for an hour rather than probe the block every pass. A pass is stopped after 50 minutes, as the hourly workflow's runs were, and every ClickHouse request after 10. Every pass that ends, failed or not, adds a row to `polls`; one stopped, or killed by the machine, leaves none, which Grafana's alert on a source with no row for three intervals catches. A pass:

1. It reads each station's last 7 days from ClickHouse, and asks the source for the last 12 hours, as the hourly workflow does, or two of the station's intervals where those are longer, so a value the source sends hours late, or one sent while the source or the station was down, still arrives.
2. It merges what it fetched into those 7 days and runs QC over them, `qcFor` with the source's errata spans, the steps `updateRecent` takes for recent/ (`refreshStation` in `src/store/recent.ts`, which both call). A value first seen gets `received` set to the pass's time, and later versions keep it. QC runs in memory per station in the same step, so a value is QC'd before it's written.
3. It writes only the values that differ from what ClickHouse held, in level, flag, `source_flag`, `received` or epoch, comparing levels as the 32-bit floats the table stores, so a revised level and a source's new flag on an old value both arrive, and a pass that brings nothing new writes nothing. Values the source no longer sends are deleted.
4. It records the pass in `polls`.

From step 2, every writer of a station's rows, the poller and every job, holds that station's lock in the job queue's database from reading the rows to writing them, so a job never writes back a level a pass has since revised. Jobs work station by station, so a requalify of a whole source holds up the poller by one station's work at most.

A station that leaves its source's list or stops being live drops out of the next pass. The adapter's `withheld` is checked every pass, so a withholding stops the station as soon as it deploys, and the poller then deletes the station's rows. The export also leaves out every withheld station, so a withheld station's values can't reach R2 again from rows not yet deleted, and the restricted database never exports to the public bucket. Its files already on R2 are deleted by the withhold job, as `ingest withhold` deletes them in Actions until step 2 moves it to the server, where it takes the station's lock so no export of the station runs meanwhile.

Deleting withheld stations' rows keeps the limit every other withholding keeps (`tooManyWithheld`): a rule that suddenly matches more stations than that fails the source's passes and deletes nothing, until the rule is fixed or `STILLWELL_ACCEPT_WITHHELD=1` accepts it, as `--accept-withheld` does for the other withholdings.

When the adapter throws `DatumChanged`, the station fails that pass and keeps its rows, and the poller dispatches the Monthly refresh for that source through the GitHub API unless a refresh of it started on `main` in the last day, as the hourly workflow checks. It asks at most once a day, or an hour after one it couldn't start. The station fails every pass until the refresh opens the new epoch, and is then fetched in it; a station whose new epoch is held for a decision (`isHeld`) isn't fetched.

## Exporting to R2

Exports keep the files' current schema, levels as FLOAT:

- **Until step 2**, the hourly workflow keeps writing `recent/<source>.parquet` and Compact daily keeps folding it into the year files, unchanged and in their `store-<source>` groups. The server only reads `recent/`, to seed ClickHouse, and writes nothing to R2, so it never races them.
- **From step 2 on:** ClickHouse writes Parquet to R2 itself (`INSERT INTO FUNCTION s3(...) SELECT ... FINAL`, so each value is written once, at its latest version): every station-year in `changes` that is in `loaded` becomes `obs/<source>/<station>/[<epoch>/]<year>.parquet`, in the layout and sort order it has now, written whole, then the bounds, `stations.parquet` and `stations/analysis/<source>.parquet` with its `rules`, `judge` and `requalified` columns. Polled values export nightly, after each UTC day closes: about 14,000 files a night, about 1 million PUTs a month. A job's changes export when the job ends, before it reports success. A station-year that isn't in `loaded` is never exported, so a partial history can't overwrite a year file.

The restricted database exports to `STILLWELL_RESTRICTED_STORE`, never the public bucket.

## Jobs

From step 2, backfill, the monthly refetch, requalify, analysis, withhold and the export are jobs, and from step 3 the station refresh and `publish` too. `stillwell-jobs` runs them from a queue in SQLite (`node:sqlite`, built into Node), a file on the server in WAL mode that both services open:

- **Queue:** each job with its kind, source, arguments, state, attempts, progress and result. A worker claims a job in a transaction and holds a lease it renews while the job runs, so only one worker runs a job at a time, and one whose worker died is claimed again when its lease runs out. That makes a run at least once, not exactly once: a job that died after writing runs again, which its idempotency and the export's per-station-year checkpoints make safe.
- **Concurrency:** at most one job of each kind per source. Jobs that fetch from the source (backfill, refetch, the station refresh) also run one at a time per source, and they and the poller take the source's request slots from the queue's database, since an adapter's pacing holds only within its own process, so its rate limits hold. Jobs that don't fetch (requalify, analysis, withhold, the export) run beside them, since the station locks keep writers apart, so a withhold or the nightly export never waits for a multi-hour backfill or requalify.
- **Retries:** a failed job is retried with backoff, a few times, then stays failed for a maintainer to see.
- **Schedules:** in code. A recurring job is queued under a key for its run, such as `export:2026-11-12` or `refetch:2026-11`, so a restart or a late timer never queues the same run twice.
- **Locks:** the per-station locks every writer of a station's rows holds, with leases, so a process that dies holding one doesn't block the station.

Jobs are idempotent and resume where they stopped, as requalify does now with its per-station budget, and a job finishes only once its changes are on R2. So losing the queue loses nothing a schedule can't queue again; a job started by hand that was unfinished is started again by whoever started it.

A job is started for one source, or for one station and its years, through an admin endpoint of `stillwell-api` behind its own Access service token, from a workflow or a maintainer's machine. The same endpoint shows when a job ran, how far it got and whether it succeeded, and Grafana gets queue depth, running jobs, failures and run times per kind.

A deploy that changes a source's `errata.json` queues a requalify of the station-years the changed entries cover.

A full requalify under new rules inserts a new version of most rows, which doubles those partitions until ClickHouse merges them. It runs one year partition at a time and runs `OPTIMIZE ... PARTITION ... FINAL` after each, so `FINAL` reads stay fast and disk use stays bounded.

## The levels API

`GET /water-levels/stations/{source}/{id}/levels` serves the last hours and the archive alike; there is no separate `live` endpoint. Two pieces serve it:

- **`workers/api`**, bound into the api.openwaters.io gateway as `WATER_LEVELS` on `/water-levels*`. It normalizes the request into a cache key, answers from the Cache API when it can, and otherwise forwards to `stillwell-api` through the Tunnel with an Access service token held as a Worker secret. It caches what comes back by its `Cache-Control`, keeps the last good copy longer, and serves that with `status: stale` when the server doesn't answer.
- **`stillwell-api`** on the server, which does the work:

1. Check the parameters: a known `step`, a range within the limits, and in step 1 within the last 7 days, a datum the station has an offset to, and a station in the public database with `commercial_use` true, since only those are served until tokens exist ([api.md](api.md#conventions)). `stillwell-api` never reads `stillwell_restricted`.
2. Query ClickHouse on loopback, with parameters bound (`{station:String}`), never built into the SQL: the sample nearest each step time, plus the epoch's offset to the requested datum from `offsets`, leaving out `bad` values unless `includeBad`. Station metadata comes from the station tables it holds in memory, and `updated` from `polls`: when the last pass that ended cleanly (`ok`: it ran to the end and the source answered for some station) and asked for the station's interval group (`intervals`, empty for every station) finished. A station whose new epoch is held isn't fetched, so its `updated` says only that its source was asked.
3. Build the response in [api.md](api.md)'s shape: `as_of`, `updated`, `status`, `datum`, `datums`, `frame` (the station's column in `stations.parquet`), `attribution`, `notice`, and the levels with their flags.
4. Set `Cache-Control`: a day for a range that ended more than 7 days ago, past which the poller changes nothing, otherwise the station's `min_interval_s`, at most 5 minutes.

The Worker rounds `start` and `end` to the step, and a range relative to now, such as the default 7 days, to the station's interval, so every client asking for the same thing shares one cache key. A 1-minute station gets a new key every minute, which matches its `max-age`.

`stillwell-api` reuses this repo's TypeScript: the schema, the flags and the datum code. The Worker is a cache and a proxy of a few dozen lines. `stillwell-api`'s tests run against a ClickHouse service container in CI, and the Worker's with `@cloudflare/vitest-pool-workers` and the server faked.

## Order of work

1. **Phase 9: realtime.** The server, ClickHouse, the poller and QC for every hourly source, `stillwell-api` and the Worker serving `levels` for ranges inside the poller's window, ClickHouse keeping the 7 days the poller keeps current, which covers Slackwater's 96 hours. The server writes nothing to R2: the hourly workflow keeps writing `recent/`, and backfill, refetch, requalify, analysis, withhold and `compact` stay in Actions, unchanged, so fixes to them, such as USGS compaction's growing run time, still land there. Grafana alerts on `polls` watch the server, including a source with no row for three of its intervals. Until step 2 the hourly workflow also fetches each source once an hour, so the server has its own USGS API key rather than share the budget a backfill paces itself to, and a source's Monthly refresh can be started by either; both check for a refresh started in the last day, and a rare second one only repeats the refresh.
2. **History moves in, one source at a time.** For each source: stop its Actions jobs that write `recent/` or year files, the hourly `recent` job included, load its year files into ClickHouse and mark them `loaded`, move its backfill, refetch, requalify, analysis and withhold to jobs on the server, then let the export own its files. A source's Actions writers and the export never run side by side, since each would overwrite the other's year files. A source waits for its running backfills, its current-year backfill included, to finish before it moves. Once every source has moved, `compact`, `recent/` and the `store-<source>` concurrency groups go, and `levels` serves any range, which phase 10 needs.
3. **Lists and publishing move in.** The station refresh and `publish` run on the server. Actions keeps CI, deploys and the canary, and the cron Worker retires.

## Costs

The CPX31 is about $20 a month at Hetzner's US prices, to confirm when ordering, and R2's writes a few dollars, against the GitHub Actions minutes and R2 rewrites the hourly and daily jobs use now.
