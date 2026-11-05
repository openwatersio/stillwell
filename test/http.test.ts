import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchText } from "../src/http.ts";

const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

describe("fetchText", () => {
  it("retries a dropped connection", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      if (++calls === 1) throw new TypeError("fetch failed", { cause: new Error("ECONNRESET") });
      // The second drops partway through the body.
      if (calls === 2)
        return new Response(
          new ReadableStream({
            start: (c) => c.error(new TypeError("terminated", { cause: new Error("socket") })),
          }),
        );
      return new Response("ok");
    }) as typeof fetch;
    assert.equal(await fetchText("https://example.test/"), "ok");
    assert.equal(calls, 3);
  });

  it("doesn't retry a request that can't be made", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      // As Node's fetch rejects an unparseable URL.
      throw new TypeError("Failed to parse URL from not a url", {
        cause: new TypeError("Invalid URL"),
      });
    }) as typeof fetch;
    await assert.rejects(fetchText("https://example.test/"), /Failed to parse URL/);
    assert.equal(calls, 1);
  });

  it("doesn't retry a client error", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    await assert.rejects(fetchText("https://example.test/"), /returned 404/);
    assert.equal(calls, 1);
  });
});
