// The live Worker: runs the poller (server/ingest.ts) in a Container, answers the live store (store.ts) under /store/
// for it, and every minute makes sure it's running (README.md).

import { Container } from "@cloudflare/containers";
// The containers package starts a container through it.
export { ContainerProxy } from "@cloudflare/containers";
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
  /** This Worker's own address, where the container reaches /store/: its workers.dev URL. */
  ORIGIN: string;
  /** "1" lets passes withhold more stations than the limit allows (`tooManyWithheld`), as --accept-withheld does. */
  ACCEPT_WITHHELD?: string;
}

const REPO = "openwatersio/stillwell";
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
      STILLWELL_LIVE: `${env.ORIGIN}/store`,
      STILLWELL_LIVE_TOKEN: env.STORE_TOKEN,
      ...(env.ACCEPT_WITHHELD === "1" ? { STILLWELL_ACCEPT_WITHHELD: "1" } : {}),
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
    if (!url.pathname.startsWith("/store/") && url.pathname !== "/log")
      return new Response("Not found", { status: 404 });
    if (!env.STORE_TOKEN || request.headers.get("authorization") !== `Bearer ${env.STORE_TOKEN}`)
      return new Response("Forbidden", { status: 403 });
    // The poller's last lines, for whoever holds the token.
    if (url.pathname === "/log") return env.POLLER.getByName("poller").fetch("http://poller/log");
    url.pathname = url.pathname.slice("/store".length);
    return handleStore(new Request(url, request), env);
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const now = controller.scheduledTime;
    const minute = new Date(now).getUTCMinutes();
    // Each task runs whether or not the others fail, so a poller that won't start still raises its alert.
    const tasks: [string, () => Promise<void>][] = [
      ["health", () => health(env, minute)],
      ...(minute === 30 ? [["alert", () => alert(env, now)] as [string, () => Promise<void>]] : []),
      ...(minute === 45 && new Date(now).getUTCHours() === 3
        ? [
            [
              "prune",
              () =>
                prune(
                  env.LIVE,
                  new Date(now - 8 * DAY_MS).toISOString().slice(0, 10),
                  now - 30 * DAY_MS,
                ),
            ] as [string, () => Promise<void>],
          ]
        : []),
    ];
    const failed: string[] = [];
    for (const [name, task] of tasks)
      await task().catch((error: unknown) => {
        failed.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
      });
    // Thrown, so the cron event shows as failed in the Worker's events.
    if (failed.length) throw new Error(failed.join("; "));
  },
};

/** Start the container if it isn't running, and every 10 minutes log its last lines, so they reach the Worker's logs. */
async function health(env: Env, minute: number): Promise<void> {
  const poller = env.POLLER.getByName("poller");
  const answer = await poller.fetch("http://poller/health");
  if (!answer.ok) throw new Error(`${answer.status} ${await answer.text()}`);
  if (minute % 10 === 0)
    console.log((await (await poller.fetch("http://poller/log")).text()).slice(-6000));
}

/**
 * Open an issue for each source with no clean pass in `STALE_MS`, and one for the poller when no pass of any source
 * has finished in that time, and close each once that's no longer so: one issue each, found by its title, as
 * scripts/alert.sh does for the workflows. A source with no pass in the last week drops out, with its issue left open.
 */
async function alert(env: Env, now: number): Promise<void> {
  const { results: passes } = await env.LIVE.prepare(
    "SELECT source, max(finished) AS last, max(CASE WHEN ok = 1 THEN finished END) AS last_ok FROM polls WHERE finished > ? GROUP BY source",
  )
    .bind(now - 7 * DAY_MS)
    .all<{ source: string; last: number; last_ok: number | null }>();
  // Every source with live values too, so one whose passes never record still opens its issue.
  const { results: held } = await env.LIVE.prepare(
    "SELECT DISTINCT substr(station, 1, instr(station, '/') - 1) AS source FROM live",
  ).all<{ source: string }>();
  const results = [
    ...passes,
    ...held
      .filter((h) => !passes.some((p) => p.source === h.source))
      .map((h) => ({ source: h.source, last: 0, last_ok: null })),
  ];
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN isn't set, so stale sources open no issue");
  const github = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "User-Agent": "stillwell-live",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok)
      throw new Error(`GitHub ${path}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<unknown>;
  };
  const open: { number: number; title: string }[] = [];
  for (let page = 1; ; page++) {
    const issues = (await github(`issues?state=open&per_page=100&page=${page}`)) as typeof open;
    open.push(...issues);
    if (issues.length < 100) break;
  }
  const stopped = Math.max(0, ...results.map((r) => r.last)) < now - STALE_MS;
  const subjects: [string, boolean, string][] = [
    [
      "The live poller has stopped",
      stopped,
      "No poller pass of any source has finished for over 2 hours: the live Worker's container isn't running passes, or can't record them. The Worker's logs have its last lines every 10 minutes, and `GET /log` on it returns them to holders of `STORE_TOKEN`. This issue closes on its own after a pass finishes.",
    ],
    ...results.map((r): [string, boolean, string] => [
      `Live polling is failing for ${r.source}`,
      (r.last_ok ?? 0) < now - STALE_MS,
      `The live poller has had no clean pass of \`${r.source}\` for over 2 hours. The \`polls\` table in the \`stillwell-live\` D1 database has each pass's failures. This issue closes on its own after a clean pass.`,
    ]),
  ];
  for (const [title, failing, body] of subjects) {
    const issue = open.find((i) => i.title === title);
    if (failing && !issue)
      await github("issues", { method: "POST", body: JSON.stringify({ title, body }) });
    if (!failing && issue)
      await github(`issues/${issue.number}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed", state_reason: "completed" }),
      });
  }
}
