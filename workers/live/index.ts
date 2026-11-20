// The live Worker: runs the poller (server/ingest.ts) in a Container, answers the live store (store.ts) under /store/
// for it, and every minute makes sure it's running (docs/plans/cloudflare.md).

import { Container } from "@cloudflare/containers";
import { handleStore, prune, type StoreEnv } from "./store.ts";

export interface Env extends StoreEnv {
  POLLER: DurableObjectNamespace<Poller>;
  /** The bearer token the poller sends to /store/, so only it reads and writes the live store. */
  STORE_TOKEN: string;
  /** Starts a source's Monthly refresh on a datum change, and opens and closes the stale-source issues. */
  GITHUB_TOKEN?: string;
  CCO_API_KEY?: string;
  CCO_REFERER?: string;
  USGS_API_KEY?: string;
}

const REPO = "openwatersio/stillwell";
/** Where the container reaches this Worker. */
const ORIGIN = "https://stillwell-live.brandon-782.workers.dev";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A source with no clean pass for this long has an issue open. */
const STALE_MS = 2 * HOUR_MS;

export class Poller extends Container<Env> {
  defaultPort = 8080;
  // The cron asks every minute, so it sleeps only if the cron stops.
  sleepAfter = "15m";
  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    const secrets = ["GITHUB_TOKEN", "CCO_API_KEY", "CCO_REFERER", "USGS_API_KEY"] as const;
    this.envVars = {
      PORT: "8080",
      STILLWELL_STORE: "https://stillwell.openwaters.io",
      STILLWELL_LIVE: `${ORIGIN}/store`,
      STILLWELL_LIVE_TOKEN: env.STORE_TOKEN,
      ...Object.fromEntries(secrets.flatMap((k) => (env[k] ? [[k, env[k]!]] : []))),
    };
  }

  override onError(error: unknown): void {
    console.error(`poller: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/store/")) return new Response("Not found", { status: 404 });
    if (!env.STORE_TOKEN || request.headers.get("authorization") !== `Bearer ${env.STORE_TOKEN}`)
      return new Response("Forbidden", { status: 403 });
    url.pathname = url.pathname.slice("/store".length);
    return handleStore(new Request(url, request), env);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    // Starts the container if it isn't running; its health answer means the poller is up.
    const health = await env.POLLER.getByName("poller").fetch("http://poller/health");
    if (!health.ok) console.error(`poller health: ${health.status} ${await health.text()}`);
    // Every 10 minutes, the poller's last lines, so its output reaches the Worker's logs.
    else if (new Date(controller.scheduledTime).getUTCMinutes() % 10 === 0)
      console.log(
        (await (await env.POLLER.getByName("poller").fetch("http://poller/log")).text()).slice(
          -6000,
        ),
      );
    const now = controller.scheduledTime;
    const minute = new Date(now).getUTCMinutes();
    if (minute === 30) await alert(env, now);
    if (minute === 45 && new Date(now).getUTCHours() === 3)
      await prune(
        env.LIVE,
        new Date(now - 8 * DAY_MS).toISOString().slice(0, 10),
        now - 30 * DAY_MS,
      );
  },
};

/**
 * Open an issue for each source with no clean pass in `STALE_MS`, and close it once one has, one issue per source
 * found by its title, as scripts/alert.sh does for the workflows.
 */
async function alert(env: Env, now: number): Promise<void> {
  const { results } = await env.LIVE.prepare(
    "SELECT source, max(CASE WHEN ok = 1 THEN finished END) AS last_ok FROM polls WHERE finished > ? GROUP BY source",
  )
    .bind(now - 7 * DAY_MS)
    .all<{ source: string; last_ok: number | null }>();
  if (!env.GITHUB_TOKEN) {
    console.error("GITHUB_TOKEN isn't set, so stale sources open no issue");
    return;
  }
  const github = (path: string, init: RequestInit = {}) =>
    fetch(`https://api.github.com/repos/${REPO}/${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "User-Agent": "stillwell-live",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  const open = (await (await github("issues?state=open&per_page=100")).json()) as {
    number: number;
    title: string;
  }[];
  // Every source polled in the last week, and the poller itself when no pass has finished.
  const stale = new Set(
    results.filter((r) => (r.last_ok ?? 0) < now - STALE_MS).map((r) => r.source),
  );
  for (const { source } of results) {
    const title = `Live polling is failing for ${source}`;
    const issue = open.find((i) => i.title === title);
    if (stale.has(source) && !issue)
      await github("issues", {
        method: "POST",
        body: JSON.stringify({
          title,
          body: `The live poller has had no clean pass of \`${source}\` for over 2 hours. The \`polls\` table in the \`stillwell-live\` D1 database has each pass's failures. This issue closes on its own after a clean pass.`,
        }),
      });
    if (!stale.has(source) && issue)
      await github(`issues/${issue.number}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed", state_reason: "completed" }),
      });
  }
}
