// Serves `levels` for the api.openwaters.io gateway, bound to it as WATER_LEVELS:
// answers from Cloudflare's cache when it can, otherwise asks stillwell-api on
// the server through its Tunnel, and when the server doesn't answer serves the
// last good copy marked stale (docs/plans/realtime.md, The levels API).

import { parseInstant, STEPS, WINDOW_MS } from "../../src/api/levels.ts";

export interface Env {
  /** stillwell-api's Tunnel hostname, such as https://stillwell-api.openwaters.io. */
  ORIGIN: string;
  /** The Access service token the Tunnel's Access application lets through. */
  ACCESS_CLIENT_ID: string;
  ACCESS_CLIENT_SECRET: string;
}

interface Context {
  waitUntil(promise: Promise<unknown>): void;
}

interface Cache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
  delete(key: Request): Promise<boolean>;
}

const MINUTE = 60_000;
const PARAMS = ["datum", "end", "include", "includeBad", "start", "step", "units"];
const LEVELS = /^\/water-levels\/stations\/[^/]+\/[^/]+\/levels$/;
/** How long the last good copy of a range is kept for when the server doesn't answer. */
const LAST_GOOD_S = 86_400;
const ORIGIN_TIMEOUT_MS = 10_000;

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD")
      return json(405, { message: "Only GET is served" });
    const url = new URL(request.url);
    if (!LEVELS.test(url.pathname)) return json(404, { message: "Not found" });

    const { canonical, relative } = normalize(url.searchParams, Date.now());
    const cache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
    const key = new Request(`${url.origin}${url.pathname}?${canonical}`);
    const hit = await cache.match(key);
    if (hit) return hit;

    // A range relative to now keeps one last good copy, whatever minute it was asked in.
    const lastKey = new Request(`${url.origin}${url.pathname}?${relative}&last-good`);
    const answer = await ask(`${env.ORIGIN}${url.pathname}?${canonical}`, env, request);
    if (answer) {
      const reply = json(answer.status, answer.body, answer.cacheControl);
      if (answer.status === 200) {
        ctx.waitUntil(cache.put(key, reply.clone()));
        ctx.waitUntil(cache.put(lastKey, json(200, answer.body, `public, max-age=${LAST_GOOD_S}`)));
      }
      // A station withheld or no longer served is never served from an older copy.
      if (answer.status === 404 || answer.status === 451) ctx.waitUntil(cache.delete(lastKey));
      return reply;
    }

    const last = await cache.match(lastKey);
    const kept = last && ((await last.json().catch(() => null)) as object | null);
    if (!kept) return json(503, { message: "Levels are unavailable; try again shortly" });
    return json(200, { ...kept, status: "stale" }, "public, max-age=60");
  },
};

/**
 * stillwell-api's answer, when it gave one of its own: a 200 or a 4xx other
 * than Access's 401 and 403, as JSON. Anything else, such as a redirect to
 * Access's login page when the service token has expired, a 5xx or no answer
 * in time, is undefined, so the last good copy is served. Only the body and
 * its Cache-Control are kept: headers Access adds, such as its cookie, never
 * reach a client or the cache.
 */
async function ask(
  url: string,
  env: Env,
  request: Request,
): Promise<{ status: number; body: object; cacheControl: string } | undefined> {
  try {
    const answer = await fetch(url, {
      headers: {
        "CF-Access-Client-Id": env.ACCESS_CLIENT_ID,
        "CF-Access-Client-Secret": env.ACCESS_CLIENT_SECRET,
        "User-Agent": request.headers.get("User-Agent") ?? "",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS),
    });
    const own =
      (answer.status === 200 ||
        (answer.status >= 400 &&
          answer.status < 500 &&
          answer.status !== 401 &&
          answer.status !== 403)) &&
      answer.headers.get("Content-Type")?.startsWith("application/json");
    if (!own) {
      console.error(
        `stillwell-api answered ${answer.status} ${answer.headers.get("Content-Type")}`,
      );
      return undefined;
    }
    return {
      status: answer.status,
      body: (await answer.json()) as object,
      cacheControl: answer.headers.get("Cache-Control") ?? "no-store",
    };
  } catch (error) {
    console.error(`stillwell-api didn't answer: ${(error as Error).message}`);
    return undefined;
  }
}

/**
 * The request's parameters in one order, so every client asking for the same
 * thing shares a cache key. A start and end given together round inward to
 * the step, which keeps the same step times, and a start alone rounds up to
 * the step, or to the minute at `raw`. A range relative to now becomes the 7 days to
 * now rounded up to the step, or to the minute at `raw`. `relative` leaves
 * out the start and end that came from now.
 */
export function normalize(
  params: URLSearchParams,
  now: number,
): { canonical: string; relative: string } {
  const out = new URLSearchParams();
  // An empty value is no value, to the server too.
  for (const name of PARAMS) for (const v of params.getAll(name)) if (v) out.append(name, v);
  const relative = out.toString();
  const stepName = out.get("step") ?? "6m";
  const step = Object.hasOwn(STEPS, stepName) ? STEPS[stepName] : undefined;
  if (step === undefined || out.getAll("start").length > 1 || out.getAll("end").length > 1)
    return { canonical: relative, relative };
  const unit = step || MINUTE;
  const start = parse(out.get("start"));
  const end = parse(out.get("end"));
  if (!out.has("start") && !out.has("end")) {
    const to = Math.ceil(now / unit) * unit;
    out.set("start", iso(to - WINDOW_MS));
    out.set("end", iso(to));
  } else if (step && start !== null && end !== null) {
    const [from, to] = [Math.ceil(start / step) * step, Math.floor(end / step) * step];
    if (from <= to) {
      out.set("start", iso(from));
      out.set("end", iso(to));
    }
  } else if (start !== null && !out.has("end")) {
    // A start alone, as Slackwater asks: the server ends the range 7 days on, which moves by less than a step.
    out.set("start", iso(Math.ceil(start / unit) * unit));
  }
  out.sort();
  return { canonical: out.toString(), relative };
}

function parse(value: string | null): number | null {
  return value ? parseInstant(value) : null;
}

function iso(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function json(status: number, body: object, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cacheControl,
    },
  });
}
