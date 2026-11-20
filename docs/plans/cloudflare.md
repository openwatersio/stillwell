# Live data on Cloudflare, store jobs on Actions

Stillwell runs in two places. Live data runs on Cloudflare: a poller in a Container writes D1 and the daily `recent/` files, and the levels API is a Worker. Store jobs run in GitHub Actions: compaction, the Monthly refresh and refetch, backfills, and a migrations workflow that runs the store work each merged change needs. R2's Parquet files are the store's record.

## Goals

- **Migrations run themselves.** A change that needs store work after it merges carries it in `src/migrations/`, and a workflow runs it, for every source.
- **One writer of each kind.** The poller is the only writer of live values, and Actions the only writer of year files, so no source is split between two systems and no handover guard is needed.
- **Live values within minutes**, from every source, SFWMD included.
- **No machine to keep up.** No OS, no deploy scripts, nothing to restart after a reboot.
- **R2 stays the record**, and the year files keep their layout.

## What the spike showed

A spike on 2026-11-20 deployed a Worker and a container, ran every source's canary from each, and ran CCO's monthly job in the container. The Hetzner server that ran the poller until then is the baseline for its measurements.

- **Reach.** From a Container, every source answered except DWR and BSH's `kuestendaten`, which fail from every network. SFWMD, which refuses the Hetzner server and Cloudflare Workers, answered from the container. Workers can't reach SFWMD, which is why the poller runs in a container.
- **Batch speed.** CCO's `monthly.sh lists cco --full` took 5 min 55 s in a 4 vCPU container at concurrency 2, against 5 min 34 s on the Hetzner server.
- **Start.** The container answered its first request 1.5 seconds after it was asked to start.

## The poller

The poller is [`server/ingest.ts`](../../server/ingest.ts), with its per-source timers, interval groups, passes in child processes ([`server/pass.ts`](../../server/pass.ts)) and adapter pacing, in one always-on container. Its passes hold up to 1.76 GB between them, more than a Worker's 128 MB, so it stays a Node process. Cloudflare doesn't guarantee how long a container runs, so a cron Worker asks the poller's Durable Object to start it every minute; one that was stopped is back within a minute, and a pass fetches 12 hours back, so nothing is lost.

It polls every public hourly source: CCO, whose key covers one read of each site an hour, hourly (`poller: "hourly"` in its metadata), and SFWMD at its stations' intervals. When a source reports a station in another datum, the poller starts that source's Monthly refresh through the GitHub API, at most once a day. It answers `GET /health`, which the cron Worker asks to start it, and `GET /log`, its recent output, which the Worker serves to holders of the token and logs every 10 minutes.

The poller writes two things:

- **D1**, for the API: the last 8 days, one row per station-day.
- **`recent/<source>/<YYYY-MM-DD>.parquet`** on R2, for everything else: one file per source per UTC day, with every live station's values.

### D1

```sql
CREATE TABLE live (
  station TEXT NOT NULL,   -- `<source>/<source_id>`
  day     TEXT NOT NULL,   -- UTC date
  rows    TEXT NOT NULL,   -- a JSON array of the day's values: epoch, time, level, flag, source_flag and received
  PRIMARY KEY (station, day)
) WITHOUT ROWID;

CREATE TABLE polls ( ... );  -- one row per pass: its source, times, interval groups, outcome and counts
```

The full schema is [workers/live/schema.sql](../../workers/live/schema.sql).

A pass reads the station-days it covers, merges and QCs as `refreshStation` does, and writes back only the station-days that changed. One pass at a time runs per source, so no two writers update one station-day. A day older than 8 days is deleted, one row per station.

The live window is about 15 million values: 1.92 million a day from 13,642 stations. That's a few hundred MB, under D1's 10 GB limit for a database. D1 bills a row written for every insert, update and delete. Live stations' intervals come to about 1.92 million station polls a day, most of them USGS's 13,983 gages every 15 minutes, so each write carries about one value either way; a row per value would also delete every value as it ages out, about 116 million writes a month, where a row per station-day is at most about 58 million.

Containers have no bindings of their own, so the poller reaches D1 and R2 through the live Worker's URL, which answers the store under `/store/` with its bindings, to requests bearing the bearer token `STORE_TOKEN`, a secret of the Worker and of the container. No D1 token or R2 key sits in the container.

### The daily files

`recent/<source>/<YYYY-MM-DD>.parquet` holds a source's live stations' values for one UTC day, with the year files' columns plus `station` and `epoch`. They're public and documented:

- **Today's file** is rewritten hourly, so it's up to an hour behind the API.
- **The 6 days before** are rewritten each night after 00:00 UTC, so values a source revises late reach them. A day is final once it's 6 days old.
- **Files older than 30 days** are deleted by an R2 lifecycle rule. The year files are the archive.

Readers read the last few daily files:

- Compaction folds them into the year files.
- The site's level chart and source page.
- The station refresh's epoch discovery and withholding.
- `scripts/check-files.ts`, the files reference and the guides.

The poller is the only writer of live values.

## The levels API

The whole API is Workers. [`workers/api`](../../workers/api/README.md) is the gateway's `WATER_LEVELS` binding on `/water-levels*`, and `GET /water-levels/stations/{source}/{id}/levels` serves the last hours and the archive alike, with no separate `live` endpoint:

- **The last 8 days** come from D1: the station's station-days for the range, one indexed read of up to 8 rows.
- **Older ranges** come from the station's year files on R2, through the Worker's bucket binding, read with a pure-JavaScript Parquet reader. A station-year is a few MB, inside a Worker's 128 MB. That serves any range.
- **Stations and offsets** come from `stations.parquet` and `stations/offsets.parquet`, read once per isolate and refreshed every 10 minutes.
- **Checks.** A known `step`, a range within the limits, a datum the station has an offset to, and a station in the public database.
- **Datums and steps.** Each value converts by its epoch's offset to the requested datum, leaving out `bad` values, values outside their epoch's span and values whose epoch has no offset. At a step, the value nearest each step time within half a step is kept, with its own time.
- **The response** has the shape in [api.md](api.md): `as_of`, `updated`, `status`, `datum`, `datums`, `frame`, `attribution`, `notice` and the levels with their flags. `updated` comes from the last clean pass in `polls` that asked for the station's interval group.
- **Caching.** The Worker caches by `Cache-Control`: a day for a range that ended more than 7 days ago, otherwise the station's `min_interval_s`, at most 5 minutes. It rounds `start` and `end` to the step so clients asking for the same thing share a key, and serves the last good copy with `status: stale` when it can't read D1, R2 or the station list.

## Store jobs

Compaction, the Monthly refresh and refetch, backfills, requalify, analysis, `publish`, `links`, `matches`, `drop` and `withhold` run in Actions, in their `store-<source>` concurrency groups, dispatched by the cron Worker. Compact daily folds the daily files at 00:40 UTC, after the poller's nightly rewrite.

### Migrations

A change that needs store work after it merges carries it as a migration in [`src/migrations/`](../../src/migrations/README.md): steps of `scripts/ingest.ts` arguments, `drop`, `withhold` and `misplaced` included, and checks that read the store and throw when it's wrong. The [Migrations workflow](../../.github/workflows/migrations.yml) runs them:

- **When.** On each push to `main`, from the cron Worker's dispatch at 20 past each hour, and from a GitHub schedule at 25 past as its backup, so a step held up by a cancelled run is tried again. A run takes one step and starts the next run when it succeeds. The workflow's own concurrency group runs one at a time.
- **Record.** `migrations.json` in the store holds the baseline, the last migration done before the record began, and each migration's next step and state. `node scripts/migrations.ts baseline <id|none>` begins it; until it exists no migration runs. A migration that sorts before the baseline or one already recorded isn't run.
- **Steps.** The workflow runs the next step of the first unfinished migration as a job in the source's `store-<source>` group, with the step's timeout, up to 360 minutes, records it, and runs the next. A check runs as a job of its own.
- **Cancellation.** GitHub keeps one running and one waiting run per concurrency group, and a new waiting run cancels the older one. A step that's cancelled before it starts stays where it is, and the next trigger runs it.
- **Failure.** A step that fails stops every migration after it, and opens an issue titled "Migration <id> failed". Dispatching the workflow with `retry` or `skip` and the migration's name runs the step again or marks the migration done without its remaining steps.

`npm test` checks each migration's steps by parsing them as `scripts/ingest.ts` would.

## Costs

Per month, from Cloudflare's published prices on 2026-11-20 and the Hetzner server's measurements. Memory and disk are billed as provisioned while a container runs, and CPU only while in use.

| Item              | Size and use                                                                            |   Estimate |
| ----------------- | --------------------------------------------------------------------------------------- | ---------: |
| Workers Paid plan | Account minimum, shared with the account's other Workers                                |         $5 |
| Poller            | `standard-1` (½ vCPU, 4 GiB, 8 GB disk), always on, 0.26 vCPU on average                |        $41 |
| D1                | up to 58 million rows written, against 50 million included, and a few hundred MB stored |       $0–8 |
| Levels API        | Workers requests and CPU inside the plan's 10 million requests and 30 million CPU ms    |         $0 |
| R2                | 46 GB stored; the daily files add about 14,000 writes a month                           |       $1–5 |
| Logs              | inside 20 million events; Observability pricing applies from 2026-12-01                 |       $0–5 |
| Store jobs        | GitHub Actions, free for a public repository                                            |         $0 |
| **Total**         |                                                                                         | **$46–64** |

The Hetzner server cost $69.49 a month. The poller is most of the Cloudflare cost, because a container is billed for its memory all month. One that ran a pass at a time would fit `basic`, with 1 GiB and a quarter of a vCPU, for about $20, bringing the total to about $25–43.

### Assumptions

- **Poller memory.** It holds two passes at once, whose peak was 1.76 GB on the Hetzner server.
- **Poller CPU.** The 0.26 vCPU average is the Hetzner server's, without ClickHouse's 0.16 vCPU, since D1 does that work. A pass on half a vCPU is slower than on that server's shared 8 cores.
- **D1 writes.** At most one per station poll, about 1.92 million a day from each live station's `min_interval_s`, fewer where a poll brings nothing new, as when a gage sends its values hourly.
- **Logs.** Their cost under Observability pricing isn't published in what we've read.

## Risks

- **Container stops.** Cloudflare doesn't promise a run time. The poller restarts within a minute and catches up 12 hours.
- **Egress.** Containers' outbound address (104.28.166.198 in the spike) isn't documented as fixed. A source that starts refusing it fails like any outage, and its canary shows it.
- **D1's 10 GB limit** can't be raised. The live window is a few hundred MB, and a longer window or more sources still fit, but the history never moves into D1.
- **The store is files.** Requalify and backfill keep rewriting whole year files. A store that takes inserts would be Iceberg tables in Basin Catalog, a separate decision that changes the public format.
- **Actions' limits.** Runs stop at 6 hours, Monthly runs within Actions' concurrency, and the migrations workflow inherits the concurrency groups' cancellations, which it tolerates by trying again.

## Order of work

1. **CI deploys.** The deploy job in [ci.yml](../../.github/workflows/ci.yml) deploys `workers/live`, `workers/api` and `workers/cron` on each push to `main` once the `cloudflare` environment holds the secret `CLOUDFLARE_API_TOKEN` and the repository variable `CLOUDFLARE_ACCOUNT_ID` is set. Until then the Workers are deployed by hand from their directories.
2. **The Hetzner server.** It is shut down once the poller's daily files and D1 agree with it.
