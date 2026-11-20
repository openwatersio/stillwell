# Live Worker

Runs the poller ([server/ingest.ts](../../server/ingest.ts)) in a Cloudflare Container and gives it the live store ([docs/plans/cloudflare.md](../../docs/plans/cloudflare.md)).

- **The container.** `Poller`, a `standard-1` instance (½ vCPU, 4 GiB), built from [Dockerfile](Dockerfile) with the repository as its context. It polls every public hourly source's live stations, each at its `min_interval_s`, writes them to D1, and writes each source's daily files, `recent/<source>/<YYYY-MM-DD>.parquet`: today's every hour at 5 past, and the 7 days up to today after midnight and whenever it starts.
- **The store.** The container reaches D1 and R2 through this Worker, which answers [store.ts](store.ts) under `/store/` on its workers.dev address to requests bearing `STORE_TOKEN`, so the container holds no D1 token or R2 key. D1's `stillwell-live` database holds the last 8 days, one row per station-day, and every pass in `polls` ([schema.sql](schema.sql)). The levels API ([workers/api](../api/README.md)) reads the same database.
- **The cron.** Every minute it asks the container's `/health`, which starts it if it isn't running. At 30 past each hour it opens an issue for each source with no clean pass in 2 hours, titled `Live polling is failing for <source>`, and closes it after a clean one. At 03:45 UTC it deletes station-days older than 8 days and passes older than 30.

## Setup

Run these from this directory after `npx wrangler@4 login`. The build needs Docker.

1. **The database.** `npx wrangler@4 d1 create stillwell-live`, put its ID in [wrangler.jsonc](wrangler.jsonc), then `npx wrangler@4 d1 execute stillwell-live --remote --file schema.sql`.
2. **The secrets.** `npx wrangler@4 secret put <name>` for `CCO_API_KEY`, `CCO_REFERER` and `USGS_API_KEY`, the sources' keys, and `GITHUB_TOKEN`, a token that may start the Monthly workflow and write issues in openwatersio/stillwell, and `STORE_TOKEN`, any long random string, such as `openssl rand -hex 32`.
3. **The lifecycle rule.** `npx wrangler@4 r2 bucket lifecycle add water-levels recent-days recent/ --expire-days 30`, so the daily files go after 30 days.
4. **Deploy.** `npx wrangler@4 deploy`. The cron starts the container within a minute.

The container's output is in the Worker's logs, which `npx wrangler@4 tail` streams.
