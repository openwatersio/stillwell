# Running the poller

`server/ingest.ts` is stillwell-ingest: it polls every hourly source's live stations into ClickHouse, each at its `min_interval_s` or hourly where it gives none ([docs/plans/realtime.md](../plans/realtime.md)). Each pass runs in a process of its own, `server/pass.ts`, two at a time, and each that ends adds a row to the `polls` table. [server/deploy/](../../server/deploy/README.md) sets up the box it runs on. It reads ClickHouse at `CLICKHOUSE_URL` (default `http://127.0.0.1:8123`, with `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD` if set), creating the `stillwell` database, and `stillwell_restricted` for sources that bar republishing, and their tables on start. It reads station lists and `recent/<source>.parquet` from the stores, as `scripts/ingest.ts` does, and writes nothing to them: the hourly run, in Actions or on the job queue, keeps writing `recent/` until the history moves into ClickHouse. A source's first pass after a start adds what ClickHouse lacks from `recent/`. It doesn't use the response cache, so every pass asks the sources.

Run ClickHouse in Docker, on loopback only, then poll one source, with lists from the public store:

```bash
docker run -d --rm --name stillwell-ch -p 127.0.0.1:8123:8123 -e CLICKHOUSE_SKIP_USER_SETUP=1 clickhouse/clickhouse-server:26.8
```

```bash
STILLWELL_STORE=https://stillwell.openwaters.io node server/ingest.ts kartverket
```

Set `USGS_API_KEY` for USGS, as for `scripts/ingest.ts`, the same key Actions uses, and `STILLWELL_ACCEPT_WITHHELD=1` only to accept a withholding past the limit (see [Withheld stations](sources.md#withheld-stations)). With `GITHUB_TOKEN` set, it starts a source's Monthly refresh on a datum change, unless one started in the last day. For a source on the server's job queue it starts nothing: the job service reads the change from `polls` and refreshes the source's list. `STILLWELL_METRICS` names a file it writes each source's pass metrics to, and `STILLWELL_FROM_RECENT` lists sources it fills hourly from `recent/` rather than ask, besides those whose metadata sets `poller: "recent"`; the unit names those that refuse the box's address. `test/clickhouse.test.ts` and the ClickHouse part of `test/api.test.ts` run against the ClickHouse at `CLICKHOUSE_URL` when it's set, as in CI, and are skipped otherwise.

`server/api.ts` is stillwell-api: it serves `GET /water-levels/stations/{source}/{id}/levels` ([docs/plans/api.md](../plans/api.md)) from the database `stillwell` for the last 7 days, on 127.0.0.1 at `STILLWELL_API_PORT` (default 8787), for the Worker in [workers/api](../../workers/api/README.md). It reads `stations.parquet` and `stations/offsets.parquet` from `STILLWELL_STORE` through ClickHouse's `url()`, which needs a store over HTTPS, when it starts and every 10 minutes. With the poller above running:

```bash
STILLWELL_STORE=https://stillwell.openwaters.io node server/api.ts
```

```bash
curl -s 'http://127.0.0.1:8787/water-levels/stations/kartverket/BGO/levels?step=1h'
```
