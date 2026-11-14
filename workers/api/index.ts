// Serves `levels` for the api.openwaters.io gateway, bound to it as WATER_LEVELS:
// answers from Cloudflare's cache when it can, otherwise asks stillwell-api on
// the server through its Workers VPC binding, and when the server doesn't
// answer serves the last good copy marked stale (docs/plans/realtime.md, The
// levels API).

import { parseInstant, STEPS, WINDOW_MS } from "../../src/api/levels.ts";

export interface Env {
  /** stillwell-api on the server, reached through the Tunnel as a Workers VPC service. */
  STILLWELL: { fetch(url: string, init?: RequestInit): Promise<Response> };
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
/** When a cached copy expires, in epoch milliseconds, stored with it. */
const EXPIRES = "X-Levels-Expires";

export default {
  async fetch(request: Request, env: Env, ctx: Context): Promise<Response> {
    if (request.method !== "GET" && request.method !== "HEAD")
      return json(405, { message: "Only GET is served" });
    const url = new URL(request.url);
    if (!LEVELS.test(url.pathname)) return json(404, { message: "Not found" });

    const { canonical, last: lastParams } = normalize(url.searchParams, Date.now());
    const cache = (globalThis as unknown as { caches: { default: Cache } }).caches.default;
    const key = new Request(`${url.origin}${url.pathname}?${canonical}`);
    const hit = await cache.match(key);
    // Rebuilt, not passed on: the zone's Browser Cache TTL raises a cached
    // response's max-age to 4 hours, and may keep it that long, so a copy
    // past its own expiry, or without one, is a miss, and a hit tells the
    // client only the time it has left.
    const left = hit && Math.ceil((Number(hit.headers.get(EXPIRES)) - Date.now()) / 1000);
    if (hit && left && left > 0)
      return new Response(hit.body, { headers: headers(`public, max-age=${left}`) });

    const lastKey = new Request(`${url.origin}${url.pathname}?${lastParams}&last-good`);
    const answer = await ask(`${url.pathname}?${canonical}`, env, request);
    if (answer) {
      const reply = json(answer.status, answer.body, answer.cacheControl);
      if (answer.status === 200) {
        const kept = reply.clone();
        const maxAge = Number(/max-age=(\d+)/.exec(answer.cacheControl)?.[1] ?? 0);
        kept.headers.set(EXPIRES, String(Date.now() + maxAge * 1000));
        ctx.waitUntil(cache.put(key, kept));
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
 * than 401 and 403, which it never sends, as JSON. Anything else, such as a
 * refusal from Cloudflare, a 5xx or no answer in time, is undefined, so the
 * last good copy is served. Only the body and its Cache-Control are kept.
 */
async function ask(
  path: string,
  env: Env,
  request: Request,
): Promise<{ status: number; body: object; cacheControl: string } | undefined> {
  try {
    // The binding routes to its configured host and port; the URL's host only sets the Host header.
    const answer = await env.STILLWELL.fetch(`http://stillwell-api${path}`, {
      headers: { "User-Agent": request.headers.get("User-Agent") ?? "" },
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
 * thing shares a cache key (`canonical`), and the key of its last good copy
 * (`last`).
 *
 * - A range relative to now becomes the 7 days to now rounded up to the
 *   step, or to the minute at `raw`; its last good copy leaves the range out.
 * - A start and end given together round inward to the step, which keeps the
 *   same step times.
 * - A start alone, as Slackwater asks, rounds down to the step, or to the
 *   minute at `raw`, which adds at most a value before it, unless that would
 *   cross the 7-day window; its last good copy is keyed by how far back it
 *   reaches, rounded the same way, so the next request finds it.
 */
export function normalize(
  params: URLSearchParams,
  now: number,
): { canonical: string; last: string } {
  const out = new URLSearchParams();
  // An empty value is no value, to the server too.
  for (const name of PARAMS) for (const v of params.getAll(name)) if (v) out.append(name, v);
  const given = out.toString();
  const stepName = out.get("step") ?? "6m";
  const step = Object.hasOwn(STEPS, stepName) ? STEPS[stepName] : undefined;
  if (step === undefined || out.getAll("start").length > 1 || out.getAll("end").length > 1)
    return { canonical: given, last: given };
  const unit = step || MINUTE;
  const start = parse(out.get("start"));
  const end = parse(out.get("end"));
  if (!out.has("start") && !out.has("end")) {
    const to = Math.ceil(now / unit) * unit;
    out.set("start", iso(to - WINDOW_MS));
    out.set("end", iso(to));
    out.sort();
    return { canonical: out.toString(), last: given };
  }
  if (step && start !== null && end !== null) {
    const [from, to] = [Math.ceil(start / step) * step, Math.floor(end / step) * step];
    if (from <= to) {
      out.set("start", iso(from));
      out.set("end", iso(to));
    }
  } else if (start !== null && !out.has("end")) {
    const from = Math.floor(start / unit) * unit;
    if (from >= now - WINDOW_MS) out.set("start", iso(from));
    const back = new URLSearchParams(out);
    back.delete("start");
    back.set("ago", String(Math.round((now - start) / unit) * unit));
    back.sort();
    out.sort();
    return { canonical: out.toString(), last: back.toString() };
  }
  out.sort();
  return { canonical: out.toString(), last: out.toString() };
}

function parse(value: string | null): number | null {
  return value ? parseInstant(value) : null;
}

function iso(time: number): string {
  return new Date(time).toISOString().replace(".000Z", "Z");
}

function json(status: number, body: object, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(cacheControl) });
}

function headers(cacheControl: string): HeadersInit {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": cacheControl,
  };
}
