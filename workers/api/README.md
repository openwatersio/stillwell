# Levels API Worker

Serves `GET /water-levels/stations/{source}/{id}/levels` at api.openwaters.io ([docs/plans/api.md](../../docs/plans/api.md)). The api.openwaters.io gateway in openwatersio/openwaters.io binds it as `WATER_LEVELS` on `/water-levels*`. It answers from Cloudflare's cache when it can, and otherwise reads the levels itself. Other paths under `/water-levels` are a 404 until their endpoints exist.

- **Where levels come from.** The last 8 days come from the D1 database `stillwell-live`, bound as `LIVE`, which the poller writes ([`workers/live/schema.sql`](../live/schema.sql)): one indexed read of the station's days in the range, each from its first value on. Any time of the range D1 doesn't hold, older, not polled, or before a day's first value in D1, as when the poller came back from an outage longer than its 12-hour lookback, comes from the station's year files in the store, the R2 bucket `water-levels` bound as `STORE`, read with [hyparquet](https://github.com/hyparam/hyparquet) and [fzstd](https://github.com/101arrowz/fzstd): only the files of the years and epochs the range meets, and only their row groups inside it. `as_of` and `updated` come from D1.
- **Limits.** A range is at most 31 days at `raw` and 366 days at a step. At a step, the Worker keeps only the value nearest each step time as it reads, so a year of 1-minute values fits a Worker's 128 MB. A request that would decode more than 1.1 million stored values, or hold more than 270,000, is a 400 that asks for a shorter range: a year of 1-minute values is about 525,000.
- **Checks, datums and steps.** The handler ([`src/api`](../../src/api)) checks the `step`, the range and the datum, and converts each value by its epoch's offset to the requested datum, leaving out `bad` values, values outside their epoch's span and values whose epoch has no offset; at a step it keeps the value nearest each step time within half a step, with its own time. `updated` is when the last clean pass in `polls` that asked for the station's interval group finished.
- **Stations.** Each isolate reads `stations.parquet` and `stations/offsets.parquet` from R2 when it first answers, and again in the background every 10 minutes, one row group at a time; a failed read keeps the list it has and is tried again after 30 seconds. Every public station with observed levels is served; one the poller doesn't poll has nothing in D1, so its levels come from the year files and its `status` is `offline`.
- **Cache keys.** The Worker keeps the parameters `levels` takes, in one order, and drops the rest. A range relative to now becomes the 7 days up to now rounded up to the step, or to the minute at `raw`, so everyone asking within the same step shares a key. A start and end given together round inward to the step, which keeps the same step times, and a start alone, as Slackwater asks, rounds down to the step, or to the minute at `raw`, when it then starts within the last 7 days. A 404 or 451, for a station withheld or no longer served, drops the last good copy of that request. A response is cached for as long as its `Cache-Control` says: the station's interval, at most 5 minutes, for a range ending within the last 7 days, and a day for one before. The Worker keeps that expiry with the cached copy and answers a hit with only the time left, since the zone's Browser Cache TTL raises a cached response's `max-age` to 4 hours; a copy past its expiry is read again.
- **When levels can't be read.** The Worker serves a 200, or a 4xx such as an unknown station or a bad parameter, as the handler gives it. When D1, R2 or the station list can't be read, it serves the last good copy of the same request, kept for a day, with `status` set to `stale`. A start alone keys its copy by how far back it reaches, so the next such request finds it. With no copy it's a 503.

[`index.ts`](index.ts) is the Worker, [`store.ts`](store.ts) its reads of D1 and R2, and [`wrangler.jsonc`](wrangler.jsonc) its config. The checks, sampling and response are [`src/api`](../../src/api)'s. [`test/worker-api.test.ts`](../../test/worker-api.test.ts) tests it with the cache faked, D1 as SQLite and R2 as a directory of Parquet files the store's writers write.

## Setup

These steps change Cloudflare and the gateway, so they need a maintainer with access to the Cloudflare account that holds `openwaters.io`. Run them from this directory after `npx wrangler@4 login`.

1. **D1.** Create the database and its tables, and put the ID it prints in [`wrangler.jsonc`](wrangler.jsonc)'s `d1_databases`:

   ```bash
   npx wrangler@4 d1 create stillwell-live
   npx wrangler@4 d1 execute stillwell-live --remote --file ../live/schema.sql
   ```

2. **R2.** The Worker binds the store's bucket, `water-levels`, which exists, as `STORE`.
3. **The Worker.** `npx wrangler@4 deploy`.
4. **The gateway.** In openwatersio/openwaters.io, add `{ "binding": "WATER_LEVELS", "service": "water-levels-api" }` to the gateway's `services` in `gateway/wrangler.jsonc`, and route `/water-levels` and `/water-levels/*` to `env.WATER_LEVELS.fetch(request)` in `gateway/src/index.ts`, as `TIDES` is.

Then `curl -s 'https://api.openwaters.io/water-levels/stations/coops/9447130/levels?step=1h'` returns Seattle's last 7 days, and `curl -s 'https://api.openwaters.io/water-levels/stations/coops/9447130/levels?start=2025-01-01&end=2026-01-01&step=1d'` its 2025.
