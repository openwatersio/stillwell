import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import worker, { normalize } from "../workers/api/index.ts";

const NOW = Date.parse("2026-11-13T12:03:30Z");
const PATH = "https://api.openwaters.io/water-levels/stations/coops/9447130/levels";
// The binding's fetch, through the global one the tests mock.
const env = { STILLWELL: { fetch: (url: string, init?: RequestInit) => fetch(url, init) } };

describe("normalize", () => {
  it("puts a range relative to now at the 7 days to now, rounded up to the step", () => {
    const { canonical, last } = normalize(new URLSearchParams("units=feet&step=1h"), NOW);
    assert.equal(
      canonical,
      "end=2026-11-13T13%3A00%3A00Z&start=2026-11-06T13%3A00%3A00Z&step=1h&units=feet",
    );
    assert.equal(last, "step=1h&units=feet");
  });

  it("rounds a start alone down to the step, and keys its last good copy by how far back it reaches", () => {
    const lone = normalize(new URLSearchParams("start=2026-11-09T12:03:29.5Z&end="), NOW);
    assert.equal(lone.canonical, "start=2026-11-09T12%3A00%3A00Z");
    assert.equal(lone.last, `ago=${96 * 3_600_000}`);
    // A later request, 96 hours back from a later now, finds the same copy.
    const later = normalize(new URLSearchParams("start=2026-11-09T12:05:01Z"), NOW + 90_000);
    assert.equal(later.last, lone.last);
    assert.equal(
      normalize(new URLSearchParams("start=2026-11-09T12:03:29Z&step=raw"), NOW).canonical,
      "start=2026-11-09T12%3A03%3A00Z&step=raw",
    );
    // At 1d, today's midnight is never in the future, and a start that rounding would push past the window stays.
    assert.equal(
      normalize(new URLSearchParams("start=2026-11-13T06:00:00Z&step=1d"), NOW).canonical,
      "start=2026-11-13T00%3A00%3A00Z&step=1d",
    );
    assert.equal(
      normalize(new URLSearchParams("start=2026-11-06T13:00:00Z&step=1d"), NOW).canonical,
      "start=2026-11-06T13%3A00%3A00Z&step=1d",
    );
  });

  it("rounds a given range inward to the step, and leaves alone what the server must judge", () => {
    const given = normalize(
      new URLSearchParams("start=2026-11-13T10:01:00Z&end=2026-11-13T11:59:00Z&step=15m"),
      NOW,
    );
    assert.equal(
      given.canonical,
      "end=2026-11-13T11%3A45%3A00Z&start=2026-11-13T10%3A15%3A00Z&step=15m",
    );
    for (const search of [
      "start=2026-11-13T10:01:00Z&end=2026-11-13T10:02:00Z", // no step time between
      "start=nope&end=2026-11-13T10:02:00Z",
      "step=5m",
      "foo=1&step=raw&start=2026-11-13T10:01:07Z&end=2026-11-13T10:02:00Z",
      "step=constructor", // not a step, though every object has one
      "start=2026-11-31T00:00:00Z&end=2026-12-02T00:00:00Z", // rolled into December, the server refuses it
    ]) {
      const kept = new URLSearchParams(search);
      kept.delete("foo");
      kept.sort();
      assert.equal(normalize(new URLSearchParams(search), NOW).canonical, kept.toString(), search);
    }
  });
});

describe("the Worker", () => {
  let cache: Map<string, Response>;
  let waits: Promise<unknown>[];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
  const get = async (url: string, headers?: Record<string, string>) => {
    const response = await worker.fetch(new Request(url, { headers }), env, ctx);
    await Promise.all(waits);
    return response;
  };

  beforeEach(() => {
    cache = new Map();
    waits = [];
    mock.timers.enable({ apis: ["Date"], now: NOW });
    (globalThis as Record<string, unknown>).caches = {
      default: {
        match: async (key: Request) => cache.get(key.url)?.clone(),
        put: async (key: Request, response: Response) => void cache.set(key.url, response),
        delete: async (key: Request) => cache.delete(key.url),
      },
    };
  });
  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
  });

  it("asks the server through its binding once, then answers from the cache", async () => {
    const calls: Request[] = [];
    mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      calls.push(new Request(url, init));
      return Response.json(
        { status: "reporting", levels: [] },
        { headers: { "Cache-Control": "public, max-age=300" } },
      );
    });
    assert.equal((await get(PATH, { "User-Agent": "Slackwater/1.0" })).status, 200);
    assert.equal((await get(PATH)).status, 200);
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0]!.url.startsWith(
        "http://stillwell-api/water-levels/stations/coops/9447130/levels?end=",
      ),
    );
    assert.equal(calls[0]!.headers.get("User-Agent"), "Slackwater/1.0");
  });

  it("gives a cached copy only the time it has left, whatever the cache says", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json(
        { status: "reporting", levels: [] },
        { headers: { "Cache-Control": "public, max-age=300" } },
      ),
    );
    assert.equal((await get(PATH)).headers.get("Cache-Control"), "public, max-age=300");
    // Cloudflare's zone settings rewrite a cached response's Cache-Control.
    for (const [url, kept] of cache) {
      const rewritten = new Response(kept.body, kept);
      rewritten.headers.set("Cache-Control", "public, max-age=14400");
      cache.set(url, rewritten);
    }
    mock.timers.setTime(NOW + 100_000);
    const hit = await get(PATH);
    assert.equal(hit.headers.get("Cache-Control"), "public, max-age=200");
    assert.equal(hit.headers.get("X-Levels-Expires"), null);
    assert.deepEqual(await hit.json(), { status: "reporting", levels: [] });
    // Past its expiry, the copy is a miss, though the cache still holds it.
    mock.timers.setTime(NOW + 301_000);
    await get(PATH);
    assert.equal(
      (globalThis.fetch as unknown as { mock: { callCount(): number } }).mock.callCount(),
      2,
    );
  });

  it("asks the server when a cached copy has no expiry", async () => {
    const answer = mock.method(globalThis, "fetch", async () =>
      Response.json(
        { status: "reporting", levels: [] },
        { headers: { "Cache-Control": "public, max-age=300" } },
      ),
    );
    await get(PATH);
    const [url] = [...cache.keys()].filter((k) => !k.includes("last-good"));
    cache.set(url!, Response.json({ status: "reporting", levels: [] })); // cached before expiries were kept
    await get(PATH);
    assert.equal(answer.mock.callCount(), 2);
  });

  it("serves the last good copy as stale when the server doesn't answer, and 503 without one", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ status: "reporting", levels: [1] }),
    );
    await get(PATH);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => {
      throw new Error("down");
    });
    mock.timers.setTime(NOW + 10 * 60_000); // a new minute, so a new key
    const stale = await get(PATH);
    assert.equal(stale.status, 200);
    assert.deepEqual(await stale.json(), { status: "stale", levels: [1] });
    assert.equal((await get(`${PATH}?step=1h`)).status, 503);
  });

  it("treats a redirect, an HTML page, a refusal and a server error as no answer", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ status: "reporting", levels: [1] }),
    );
    await get(PATH);
    for (const answer of [
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: "https://example.test/login" },
        }),
      () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }),
      () => Response.json({ message: "forbidden" }, { status: 403 }),
      () => Response.json({ message: "unavailable" }, { status: 503 }),
    ]) {
      mock.restoreAll();
      mock.method(globalThis, "fetch", async () => answer());
      mock.timers.setTime(NOW + 10 * 60_000);
      const response = await get(PATH);
      assert.equal(response.status, 200);
      assert.equal(((await response.json()) as { status: string }).status, "stale");
    }
  });

  it("serves Slackwater's start-only request its last good copy, though its start moved", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ status: "reporting", levels: [1] }),
    );
    await get(`${PATH}?start=2026-11-09T12:03:29.512Z`);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => {
      throw new Error("down");
    });
    // Four minutes on, in the next step, so not the cached copy.
    mock.timers.setTime(NOW + 4 * 60_000);
    const stale = await get(`${PATH}?start=2026-11-09T12:07:31.020Z`);
    assert.equal(stale.status, 200);
    assert.equal(((await stale.json()) as { status: string }).status, "stale");
  });

  it("never serves an older copy of a station the server has since withheld", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ status: "reporting", levels: [1] }),
    );
    await get(PATH);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () =>
      Response.json({ message: "Unknown station" }, { status: 404 }),
    );
    mock.timers.setTime(NOW + 10 * 60_000);
    assert.equal((await get(PATH)).status, 404);
    mock.restoreAll();
    mock.method(globalThis, "fetch", async () => {
      throw new Error("down");
    });
    mock.timers.setTime(NOW + 20 * 60_000);
    assert.equal((await get(PATH)).status, 503);
  });

  it("passes on only the body and its Cache-Control, never another header", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json(
        { status: "reporting", levels: [] },
        {
          headers: {
            "Cache-Control": "public, max-age=60",
            "Set-Cookie": "CF_Authorization=secret",
          },
        },
      ),
    );
    const response = await get(PATH);
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
    for (const kept of cache.values()) assert.equal(kept.headers.get("Set-Cookie"), null);
  });

  it("passes the server's 4xx through and serves nothing but levels", async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ message: "bad" }, { status: 400 }),
    );
    assert.equal((await get(`${PATH}?step=5m`)).status, 400);
    assert.equal(cache.size, 0);
    assert.equal((await get("https://api.openwaters.io/water-levels/stations")).status, 404);
    const post = await worker.fetch(new Request(PATH, { method: "POST" }), env, ctx);
    assert.equal(post.status, 405);
  });
});
