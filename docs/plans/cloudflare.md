# Stillwell on Cloudflare

Everything that runs Stillwell moves onto Cloudflare: the poller and every store job in Containers, the live window in D1, the levels API in Workers, and the job queue in a Durable Object. The Parquet files on R2 stay the store's record, in their current layout. Nothing runs on a server of our own or in scheduled GitHub Actions workflows; Actions keeps CI, deploys and the canary.

This replaces the Stillwell server in [realtime.md](realtime.md) and [jobs.md](jobs.md): the Hetzner box, ClickHouse, `stillwell-api`, the Cloudflare Tunnel and the systemd job units. The job queue's design carries over unchanged, with lanes, migrations and schedules; only where it runs changes.

## Goals

- **One place runs everything.** The poller, every job that writes the store, and the API run on one platform, so no source is split between two systems and no handover guard is needed.
- **Migrations run themselves**, as [jobs.md](jobs.md#migrations) describes, for every source.
- **Monthly runs in parallel.** Each source's list and refetch jobs run in containers of their own, as Actions runs them, not queued behind a few slots.
- **No machine to keep up.** No OS, no deploy scripts, nothing to restart after a reboot.
- **R2 stays the record**, and the public files keep their layout.

## What the spike showed

A spike on 2026-11-20 deployed a Worker and a 4 vCPU, 12 GiB container, ran every source's canary from each, and ran CCO's monthly job in the container against a copy of its store.

- **Reach.** From a Container, every source answered except DWR and BSH's `kuestendaten`, which fail from every network. SFWMD, which refuses the Hetzner box and Cloudflare Workers, answered from the container. BOM's FTP and CRMS's range requests worked. Workers can't reach SFWMD, which is why the poller runs in a container, not in Workers.
- **Batch speed.** CCO's `monthly.sh lists cco --full` took 5 min 55 s at concurrency 2 with a 1.17 GB peak, against 5 min 34 s on the box, and 3 min 39 s at concurrency 8 with a 2.7 GB peak.
- **Start.** The container answered its first request 1.5 seconds after it was asked to start.
- **R2 access.** Copying CCO's 268 files, 75 MB, through a Worker's R2 binding took 3 seconds.

## Live ingest

The poller is `server/ingest.ts` as it runs on the box, with its per-source timers, interval groups, passes in child processes and adapter pacing, in one always-on container. Its passes hold up to 1.76 GB between them on the box, more than a Worker's 128 MB, and a Worker can't reach SFWMD, so it stays a Node process. Cloudflare doesn't guarantee how long a container runs, so a cron Worker asks the poller's Durable Object to start it every minute; one that was stopped is back within a minute, and a pass fetches 12 hours back, so nothing is lost.

The poller writes to D1 instead of ClickHouse. The live window is the last 8 days: 1.92 million values from 13,642 stations in a day on the box, about 15 million in all.

```sql
CREATE TABLE live (
  station TEXT NOT NULL,   -- `<source>/<source_id>`
  day     TEXT NOT NULL,   -- UTC date
  rows    BLOB NOT NULL,   -- the day's values, each with its epoch, time, level, flag, source_flag and received
  PRIMARY KEY (station, day)
) WITHOUT ROWID;

CREATE TABLE polls ( ... );  -- one row per pass, as in realtime.md
```

A station-day is one row, so a pass writes one row per station it brought new values for, and a day leaves the window as one delete per station. D1 bills a row written for every insert, update and delete. Live stations' intervals come to about 1.92 million station polls a day, most of them USGS's 13,983 gages every 15 minutes, so each write carries about one value either way; a row per value would also delete every value as it ages out, about 116 million writes a month, where a row per station-day is at most about 58 million. The window is a few hundred MB, under D1's 10 GB limit for a database. A pass reads the station-days it covers, merges and QCs as `refreshStation` does now, and writes back only the station-days that changed. One pass at a time per source holds as it does now, so no two writers update one station-day.

`recent/<source>.parquet` goes away: D1 is the live window. Its readers move to D1 through the API or the nightly job:

- Compaction folds closed days from D1 into the year files, instead of from `recent/`.
- The site's level chart and source page read the levels API.
- The station refresh's epoch discovery and withholding read D1.
- `scripts/check-files.ts`, the files reference and the guides drop it.

The hourly `recent` jobs go with it, so the poller is the only writer of live values.

Containers have no bindings of their own. A container reaches D1 and R2 through its Durable Object's outbound handler, which intercepts requests to an internal host and runs them in the Workers runtime with the bindings, so no D1 token or R2 key sits in the container. Jobs that read and write R2 through DuckDB keep the S3 API with an R2 key in the container's environment, as on the box.

## The levels API

The whole API is Workers. `workers/api` stays the gateway's `WATER_LEVELS` binding, and does what `stillwell-api` does now:

- **The last 8 days** come from D1: the station's station-days for the range, one indexed read of up to 8 rows.
- **Older ranges** come from the station's year files on R2, through the Worker's bucket binding, read with a pure-JavaScript Parquet reader. A station-year is a few MB, inside a Worker's 128 MB. That serves any range, which the box reaches only once ClickHouse holds the history.
- **Stations and offsets** come from `stations.parquet` and `stations/offsets.parquet`, read once per isolate and refreshed every 10 minutes.
- **Datums, steps, flags and caching** work as [realtime.md](realtime.md#the-levels-api) describes, moved from `stillwell-api` into the Worker.

## Store jobs

The queue in [jobs.md](jobs.md) moves into a Durable Object, `Queue`, with its SQLite holding the same tables: jobs, migrations and the baseline. Lanes, the short-first rule, schedule keys and migrations work as they do on the box. What changes is how a job runs:

- **Each job is a container of its own**, started by the queue for the job and stopped when it ends. Its size fits the job: `basic` (1 GiB) for a backfill that waits on a source's pacing, `standard-2` (6 GiB) for compaction, `standard-4` (12 GiB, 4 vCPU) for a monthly list job at concurrency 8.
- **No slot limit.** Lanes still run one job per source at a time, but jobs in different lanes run at once, so Monthly's list jobs for every source start together on the 2nd, as on Actions.
- **Long jobs resume.** A container can stop at any time, so the queue runs a job whose container stopped again. Backfill's `--skip-written`, requalify's saved progress and analysis's pending list already make that safe; a job that can't resume isn't a job yet.
- **Schedules** come from the cron Worker, which asks the queue to run `due()` every minute in place of dispatching workflows.
- **Migrations** run from the queue after each deploy, which the deploy workflow tells the queue about.
- **`drop` and `withhold`** run as jobs, deleting through the S3 API instead of the aws CLI.
- **`publish`, `links` and `matches`** run in the `store` lanes as jobs too, so no store writer is left in Actions.

## Costs

Per month, from Cloudflare's published prices on 2026-11-20 and the box's and Actions' measurements. Memory and disk are billed as provisioned while a container runs, and CPU only while in use.

| Item                        | Size and use                                                                            |   Estimate |
| --------------------------- | --------------------------------------------------------------------------------------- | ---------: |
| Workers Paid plan           | Account minimum, shared with the account's other Workers                                |         $5 |
| Poller                      | `standard-1` (½ vCPU, 4 GiB, 8 GB disk), always on, 0.26 vCPU on average                |        $41 |
| Nightly compaction          | `standard-2`, about 30 minutes a night                                                  |         $2 |
| Monthly list jobs, the 2nd  | `standard-4`, 15 to 40 container-hours                                                  |      $5–13 |
| Monthly refetch, the 9th    | `standard-2` to `standard-4`, 10 to 30 container-hours                                  |      $1–10 |
| Migrations and one-off jobs | a few container-hours                                                                   |       $1–3 |
| D1                          | up to 58 million rows written, against 50 million included, and a few hundred MB stored |      $0–10 |
| Levels API                  | Workers requests and CPU inside the plan's 10 million requests and 30 million CPU ms    |         $0 |
| Queue Durable Object        | inside the plan's 1 million requests                                                    |         $0 |
| R2                          | 46 GB stored and the same operations as now                                             |       $1–5 |
| Logs                        | inside 20 million events now; Observability pricing applies from 2026-12-01             |       $0–5 |
| **Total**                   |                                                                                         | **$56–94** |

A backfill campaign adds about $0.20 for each 10 hours on a `basic` container, so a lane running all month is about $15.

For comparison, the box costs $69.49 a month, and Actions is free for a public repository, so Cloudflare costs about the same as the box. The poller is two thirds of the Cloudflare cost, because a container is billed for its memory all month, so a leaner poller would bring Cloudflare under the box. A larger poller, `standard-2` with 1 vCPU and 6 GiB, would be about $55 instead of $41.

### Assumptions

- **Poller memory.** It holds two passes at once, as on the box, whose peak was 1.76 GB. Passes run one at a time would fit `basic`, with 1 GiB and a quarter of a vCPU, for about $20, though its CPU is under the poller's average.
- **Poller CPU.** The 0.26 vCPU average is the box's, without ClickHouse's 0.16 vCPU, since D1 does that work. A pass on half a vCPU is slower than on the box's shared 8 cores.
- **Monthly hours.** These are estimates. Only CCO's list job has been measured in a container, and the one-off list runs in Actions took up to 5.5 hours for the largest sources after QC rule changes.
- **D1 writes.** At most one per station poll, about 1.92 million a day from each live station's `min_interval_s`, fewer where a poll brings nothing new, as when a gage sends its values hourly.
- **Logs.** Their cost under Observability pricing isn't published in what we've read.

## Risks

- **Container stops.** Cloudflare doesn't promise a run time. The poller restarts within a minute and catches up 12 hours; jobs run again and resume. A job that can't resume can lose up to its whole run.
- **Egress.** Containers' outbound address (104.28.166.198 in the spike) isn't documented as fixed. A source that starts refusing it fails like any outage, and its canary shows it.
- **D1's 10 GB limit** can't be raised. The live window is a few hundred MB, and a longer window or more sources still fit, but the history never moves into D1.
- **The store stays files.** Requalify and backfill keep rewriting whole year files, as they do now. A store that takes inserts would be Iceberg tables in Basin Catalog, a separate decision that changes the public format.

## Order of work

1. **The levels API.** The Worker reads the year files from R2 for ranges older than 8 days, and serves the rest from the box, until step 2.
2. **The poller.** It runs in a container, writing D1, beside the box's poller, until the two agree for a week. The API then reads D1, and the box's poller, ClickHouse, `stillwell-api` and the tunnel stop.
3. **The queue.** The queue Durable Object and per-job containers take the sources the box runs, MI and CCO, then the rest, a few at a time, each after its running campaigns finish, with the PM told before each. Compaction folds from D1 as each source's `recent/` goes.
4. **The cross-source jobs.** `publish`, `links`, `matches`, `drop` and `withhold` move, the scheduled ingest workflows and the box retire, and the cron Worker becomes the queue's clock.
