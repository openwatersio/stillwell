// The live Worker: runs the poller (server/ingest.ts) in a Container, answers the live store (store.ts) under /store/
// for it, and every minute makes sure it's running (README.md).

import { Container } from "@cloudflare/containers";
// The containers package starts a container through it.
export { ContainerProxy } from "@cloudflare/containers";
import { alert } from "./alert.ts";
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

const DAY_MS = 86_400_000;

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
      ...(minute === 30
        ? [["alert", () => alert(env.LIVE, env.GITHUB_TOKEN, now)] as [string, () => Promise<void>]]
        : []),
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
