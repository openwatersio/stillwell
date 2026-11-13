# Levels API Worker

Serves `GET /water-levels/stations/{source}/{id}/levels` at api.openwaters.io ([docs/plans/api.md](../../docs/plans/api.md)). The api.openwaters.io gateway in openwatersio/openwaters.io binds it as `WATER_LEVELS` on `/water-levels*`. It answers from Cloudflare's cache when it can, and otherwise asks `stillwell-api` on the server ([server/deploy](../../server/deploy/README.md)) through a Cloudflare Tunnel behind Access, sending an Access service token. Other paths under `/water-levels` are a 404 until their endpoints exist.

- **Cache keys.** The Worker keeps the parameters `levels` takes, in one order, and drops the rest. A range relative to now becomes the 7 days up to now rounded up to the step, or to the minute at `raw`, so everyone asking within the same step shares a key. A start and end given together round inward to the step, which keeps the same step times, and a start alone, as Slackwater asks, rounds up to the step, or to the minute at `raw`. A 404 or 451, for a station withheld or no longer served, drops the last good copy of that request. A response is cached for as long as its `Cache-Control` says: the station's interval, at most 5 minutes, for a range within the last 7 days.
- **When the server doesn't answer.** The Worker passes on only `stillwell-api`'s own JSON answers: a 200, or a 4xx such as an unknown station or a bad parameter, uncached. Anything else, such as a 5xx, Access's 401 or 403, a redirect to Access's login page when the service token has expired, or no answer within 10 seconds, serves the last good copy of the same request, kept for a day, with `status` set to `stale`. With no copy it's a 503. Only the body and its `Cache-Control` are kept, so headers Access adds, such as its cookie, never reach a client or the cache.

[`index.ts`](index.ts) is the Worker and [`wrangler.jsonc`](wrangler.jsonc) its config, with `ORIGIN`, the Tunnel's hostname. It takes the steps, the window and the date parsing from [`src/api/levels.ts`](../../src/api/levels.ts), as the server does, so the two never disagree on a key. [`test/worker-api.test.ts`](../../test/worker-api.test.ts) tests it with the cache and the server faked.

## Setup

These steps change Cloudflare and the gateway, so they need a maintainer with access to the Cloudflare account that holds `openwaters.io`.

1. **The Tunnel.** In Cloudflare's Zero Trust dashboard, under Networks, Tunnels, create a Cloudflared tunnel named `stillwell-1`. Copy its token into `/etc/cloudflared.env` on the box as `TUNNEL_TOKEN`, and run `server/deploy/deploy.sh` again. Give the tunnel a public hostname, `stillwell-api.openwaters.io`, to the service `http://127.0.0.1:8787`. That adds the DNS record.
2. **Access.** Under Access, Service Auth, create a service token named `water-levels-api`, with the longest duration offered, and note its Client ID and Client Secret. Under Access, Applications, add a self-hosted application on `stillwell-api.openwaters.io` with one policy whose action is Service Auth and whose rule includes that service token. No one else gets in, and a request without the token never reaches the box.
3. **The Worker.** From this directory, log in with `npx wrangler@4 login`, then store the token's halves and deploy:

   ```bash
   npx wrangler@4 secret put ACCESS_CLIENT_ID
   npx wrangler@4 secret put ACCESS_CLIENT_SECRET
   npx wrangler@4 deploy
   ```

4. **The gateway.** In openwatersio/openwaters.io, add `{ "binding": "WATER_LEVELS", "service": "water-levels-api" }` to the gateway's `services` in `gateway/wrangler.jsonc`, and route `/water-levels` and `/water-levels/*` to `env.WATER_LEVELS.fetch(request)` in `gateway/src/index.ts`, as `TIDES` is.

Then `curl -s 'https://api.openwaters.io/water-levels/stations/coops/9447130/levels?step=1h'` returns Seattle's last 7 days.

A replacement box reuses the Tunnel's token, so nothing else changes. To rotate the service token, create a new one, add it to the Access policy, put its halves in the Worker's secrets, then remove the old one.
