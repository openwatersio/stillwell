# Running the poller

[`server/ingest.ts`](../../server/ingest.ts) is the poller: it polls every public hourly source's live stations into the live store, each at its `min_interval_s` or hourly where it gives none, and writes each source's daily files, `recent/<source>/<YYYY-MM-DD>.parquet` ([docs/plans/cloudflare.md](../plans/cloudflare.md)). Each pass runs in a process of its own, [`server/pass.ts`](../../server/pass.ts), two at a time, and each that ends adds a row to the `polls` table. [`server/export.ts`](../../server/export.ts) writes a source's daily files. In production it runs in the container of the live Worker ([workers/live](../../workers/live/README.md)), which holds the D1 database `stillwell-live` and the store behind its `/store/` URL. It reads station lists from `STILLWELL_STORE`, as `scripts/ingest.ts` does, and doesn't use the response cache, so every pass asks the sources.

To poll one source on your own machine, give it a live store: the Worker's, with its token, or a local one. `STILLWELL_LIVE` is the live store's URL and `STILLWELL_LIVE_TOKEN` its bearer token ([`src/realtime/live.ts`](../../src/realtime/live.ts)):

```bash
STILLWELL_STORE=https://stillwell.openwaters.io STILLWELL_LIVE=<url> STILLWELL_LIVE_TOKEN=<token> node server/ingest.ts kartverket
```

Set `USGS_API_KEY` for USGS and `CCO_API_KEY` and `CCO_REFERER` for CCO, as for `scripts/ingest.ts`, and `STILLWELL_ACCEPT_WITHHELD=1` only to accept a withholding past the limit (see [Withheld stations](sources.md#withheld-stations)). With `GITHUB_TOKEN` set, it starts a source's Monthly refresh on a datum change, unless one started in the last day. With `PORT` set, it answers `GET /health` and `GET /log`, its recent output, there. `STILLWELL_METRICS` names a file it writes each source's pass metrics to.

[`workers/api`](../../workers/api/README.md) serves `GET /water-levels/stations/{source}/{id}/levels` ([docs/plans/api.md](../plans/api.md)) from D1 for the last 8 days and from the year files on R2 for older ranges. Its tests run under `node:test` with the cache faked, D1 as SQLite and R2 as a directory of Parquet files.
