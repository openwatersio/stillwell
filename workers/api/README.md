# Levels API Worker

Serves `GET /water-levels/stations/{source}/{id}/levels` at api.openwaters.io ([docs/plans/api.md](../../docs/plans/api.md)). The api.openwaters.io gateway in openwatersio/openwaters.io binds it as `WATER_LEVELS` on `/water-levels*`. It answers from Cloudflare's cache when it can, and otherwise asks `stillwell-api` on the server ([server/deploy](../../server/deploy/README.md)) through its `STILLWELL` binding, a [Workers VPC](https://developers.cloudflare.com/workers-vpc/) service that reaches it through the box's Cloudflare Tunnel. The API has no public hostname, so only Workers in the Open Waters Cloudflare account can reach it. Other paths under `/water-levels` are a 404 until their endpoints exist.

- **Cache keys.** The Worker keeps the parameters `levels` takes, in one order, and drops the rest. A range relative to now becomes the 7 days up to now rounded up to the step, or to the minute at `raw`, so everyone asking within the same step shares a key. A start and end given together round inward to the step, which keeps the same step times, and a start alone, as Slackwater asks, rounds down to the step, or to the minute at `raw`, unless that would cross the 7-day window. A 404 or 451, for a station withheld or no longer served, drops the last good copy of that request. A response is cached for as long as its `Cache-Control` says: the station's interval, at most 5 minutes, for a range within the last 7 days. The Worker keeps that expiry with the cached copy and answers a hit with only the time left, since the zone's Browser Cache TTL raises a cached response's `max-age` to 4 hours; a copy past its expiry is asked for again.
- **When the server doesn't answer.** The Worker passes on only `stillwell-api`'s own JSON answers: a 200, or a 4xx such as an unknown station or a bad parameter, uncached. Anything else, such as a 401 or 403, which only Cloudflare sends, a 5xx or no answer within 10 seconds, serves the last good copy of the same request, kept for a day, with `status` set to `stale`. A start alone keys its copy by how far back it reaches, so the next such request finds it. With no copy it's a 503. Only the body, its `Cache-Control` and its expiry are kept.

[`index.ts`](index.ts) is the Worker and [`wrangler.jsonc`](wrangler.jsonc) its config, with the VPC service's ID. It takes the steps, the window and the date parsing from [`src/api/levels.ts`](../../src/api/levels.ts), as the server does, so the two never disagree on a key. [`test/worker-api.test.ts`](../../test/worker-api.test.ts) tests it with the cache and the server faked.

## Setup

These steps change Cloudflare and the gateway, so they need a maintainer with access to the Cloudflare account that holds `openwaters.io`. Run them from this directory after `npx wrangler@4 login`.

1. **The Tunnel.** Create a Cloudflared tunnel named `stillwell-1`, in the dashboard under Networks, Tunnels, or through the API. It needs no public hostname. Put its token in `/etc/cloudflared.env` on the box as `TUNNEL_TOKEN`, and run `server/deploy/deploy.sh` again.
2. **The VPC service.** Point a Workers VPC service at the API through the Tunnel, and put the ID it prints in [`wrangler.jsonc`](wrangler.jsonc)'s `vpc_services`:

   ```bash
   npx wrangler@4 vpc service create stillwell-api --type http --tunnel-id <the tunnel's ID> --ipv4 127.0.0.1 --http-port 8787
   ```

3. **The Worker.** `npx wrangler@4 deploy`.
4. **The gateway.** In openwatersio/openwaters.io, add `{ "binding": "WATER_LEVELS", "service": "water-levels-api" }` to the gateway's `services` in `gateway/wrangler.jsonc`, and route `/water-levels` and `/water-levels/*` to `env.WATER_LEVELS.fetch(request)` in `gateway/src/index.ts`, as `TIDES` is.

Then `curl -s 'https://api.openwaters.io/water-levels/stations/coops/9447130/levels?step=1h'` returns Seattle's last 7 days.

A replacement box reuses the Tunnel's token, so nothing else changes. Workers VPC is in beta, free on every Workers plan while it lasts.
