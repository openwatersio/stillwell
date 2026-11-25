# Live Worker

Runs the poller ([server/ingest.ts](../../server/ingest.ts)) in a Cloudflare Container, gives it the live store, a D1 database the levels API ([workers/api](../api/README.md)) reads, and makes sure it keeps running. Live values reach the year files on R2 through the daily files the poller writes, which Compact daily folds in ([Operations](../../docs/contributing/operations.md)).

## The poller

The container, `Poller`, is a `standard-1` instance (½ vCPU, 4 GiB) built from [Dockerfile](Dockerfile) with the repository as its context, running `server/ingest.ts`. It polls every public hourly source's live stations, each at its `min_interval_s`, hourly where it gives none, one pass at a time per source and two passes at once, each in a process of its own ([server/pass.ts](../../server/pass.ts)) that holds up to about 800 MB. A pass fetches 12 hours back, so a value a source sends late still arrives. For a source whose adapter sets `fillsLate`, days a gauge sends at once after an outage arrive too:

- **Turns:** each station has a turn every 6 hours, at a time of its own ([`gapsDue`](../../src/realtime/poll.ts)), and the first pass after it fetches the station from the first gap between its values, or from its newest value when that is older than 12 hours ([`gapStart`](../../src/store/recent.ts)). A gap is a break longer than three of the station's intervals and half an hour.
- **Reach:** the fetch starts no earlier than the start of the fourth UTC day before today, which leaves two nightly folds for a value to reach its year file. A gap the source fills after the station's last turn inside those days, up to 6 hours before they end, stays in the store.
- **Deletes:** a fetch that reaches back adds and replaces values and deletes none.
- **Load:** a pass so asks only a few stations for days of values. The first pass after the poller was down for more than 6 hours asks every station, where the last pass's time is known.
- **Repeats:** a gap the source never fills, and the days before a new station's first value, are fetched again each turn until they are older than the reach. A pass that fails, or fails the station, uses up the turn it was past.

Every pass that ends writes a row to `polls`, clean when it ran to the end, wasn't blocked, and some station it asked had new values.

- **A source whose metadata sets `poller: "hourly"`**, as CCO does, whose key covers one read of each site an hour, has every station in one hourly group, and after a restart waits for the hour since its last recorded pass.
- **A station in another datum** fails its pass, and the poller starts that source's Monthly refresh through the GitHub API, at most once a day.
- **A station a source withholds** has its live values deleted, within the limit every other withholding keeps; the Worker's `ACCEPT_WITHHELD` variable set to `1` accepts more, as `--accept-withheld` does.
- **Its output.** It answers `GET /health` and `GET /log`, its last 300 lines. The Worker serves `/log` to holders of `STORE_TOKEN`, and logs it every 10 minutes.

## The live store

D1's `stillwell-live` database ([schema.sql](schema.sql)) holds the last 8 days, one row per station per UTC day, the day's values as a JSON array, and a row per pass in `polls`. A pass reads the station-days it covers, merges and QCs them as `refreshStation` does, and writes back only those that changed. A day leaves as one delete per station. The window is about 15 million values, a few hundred MB against D1's 10 GB limit: the live stations send about 1.92 million values a day, most from USGS's gages every 15 minutes.

Containers have no bindings of their own, so the poller reaches D1 and R2 through this Worker, which answers [store.ts](store.ts) under `/store/` on its workers.dev address to requests bearing `STORE_TOKEN`, so no D1 token or R2 key sits in the container. The store puts only daily files on R2.

## The daily files

`recent/<source>/<YYYY-MM-DD>.parquet` holds a source's live stations' values for one UTC day, with the year files' columns plus `station` and `epoch`, written from D1 by [server/export.ts](../../server/export.ts):

- **Today's file** is rewritten at 5 past each hour, so it's up to an hour behind the API.
- **The 7 days up to today** are rewritten on the first run after midnight UTC, and when the poller starts, so values a source revises late reach them. A day is final once it's 6 days old. A day with no values writes an empty file.
- **Files older than 30 days** are deleted by an R2 lifecycle rule. The year files are the archive.

Compaction folds them into the year files, and the site's level chart and source page, the station refresh's epoch discovery, withholding and `scripts/check-files.ts` read them. The whole export of 7 days for every source takes about 12 minutes.

## The cron

- **Every minute** it asks the container's `/health`, which starts it if it isn't running. Cloudflare doesn't promise a container a run time, so one that stopped is back within a minute, and its first passes catch up 12 hours. A source that sets `fillsLate` catches up a longer stop on each station's next turn.
- **At 30 past each hour** it opens an issue titled "Live polling is failing for <source>" for each source with live values or a pass in the last week but no clean pass in 2 hours, and "The live poller has stopped" when no pass has finished in 2 hours, and closes each once that's no longer so, carrying on past a GitHub call that fails or stalls for one of them.
- **At 03:45 UTC** it deletes station-days older than 8 days and passes older than 30.

## Limits

- **Egress.** The container's outbound address isn't documented as fixed. A source that starts refusing it fails like any outage, and its canary shows it. Workers can't reach SFWMD, which is why the poller runs in a container.
- **D1's 10 GB** can't be raised. A longer window or more sources still fit, but the history doesn't.
- **Schema changes** are applied by hand with `wrangler d1 execute`; nothing migrates D1 on deploy.
- **A CCO pass that dies before it records itself** lets a restart read CCO again within the hour.

## Cost

About $41 a month for the container, billed for its memory all month, $26, and for the CPU it uses, $13 at the poller's 0.26 vCPU, plus disk. D1 writes come to at most about 58 million rows a month, one per station poll, against the 50 million the Workers Paid plan includes, so $0–8. [Operations](../../docs/contributing/operations.md#costs) has the whole project's.

## Setup

Run these from this directory after `npx wrangler@4 login`. The build needs Docker.

1. **The database.** `npx wrangler@4 d1 create stillwell-live`, put its ID in [wrangler.jsonc](wrangler.jsonc), then `npx wrangler@4 d1 execute stillwell-live --remote --file schema.sql`.
2. **The secrets.** `npx wrangler@4 secret put <name>` for `CCO_API_KEY`, `CCO_REFERER` and `USGS_API_KEY`, the sources' keys, and `GITHUB_TOKEN`, a token that may start the Monthly workflow and write issues in openwatersio/stillwell, and `STORE_TOKEN`, any long random string, such as `openssl rand -hex 32`. A new hourly source with a key adds it here and to the list in [index.ts](index.ts).
3. **The lifecycle rule.** `npx wrangler@4 r2 bucket lifecycle add water-levels recent-days recent/ --expire-days 30`, so the daily files go after 30 days.
4. **The address.** Set `ORIGIN` in [wrangler.jsonc](wrangler.jsonc)'s `vars` to this Worker's workers.dev URL on the account it deploys to, where the container reaches `/store/`.
5. **Deploy.** `npx wrangler@4 deploy`. The cron starts the container within a minute.

The container's output is in the Worker's logs, which `npx wrangler@4 tail` streams.
