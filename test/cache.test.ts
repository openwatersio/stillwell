import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "stillwell-cache-"));
process.env.STILLWELL_CACHE = dir;
const { cachedText } = await import("../src/cache.ts");
const realFetch = globalThis.fetch;
afterEach(() => (globalThis.fetch = realFetch));

function answer(body: string): void {
  globalThis.fetch = async () => new Response(body);
}

const cached = () =>
  readdirSync(dir, { recursive: true }).filter((f) => !String(f).endsWith(".tmp"));

describe("cachedText", () => {
  it("keeps an answer and serves it again", async () => {
    answer("one");
    assert.equal(await cachedText("https://example.test/a"), "one");
    answer("two");
    assert.equal(await cachedText("https://example.test/a"), "one");
  });

  it("never keeps a fresh answer or an error body", async () => {
    const before = cached().length;
    answer("recent");
    await cachedText("https://example.test/fresh", { fresh: true });
    answer('{"error": {"message": "No data was found."}}');
    await cachedText("https://example.test/error");
    assert.equal(cached().length, before);
  });

  it("fetches again rather than replay an error body an older build cached", async () => {
    const url = "https://example.test/old-error";
    const key = createHash("sha256")
      .update(JSON.stringify([url, null]))
      .digest("hex");
    mkdirSync(join(dir, key.slice(0, 2)), { recursive: true });
    writeFileSync(join(dir, key.slice(0, 2), key), '{"error": {"message": "No data was found."}}');
    answer('{"data": []}');
    assert.equal(await cachedText(url), '{"data": []}');
  });

  it("doesn't keep an answer its request turns down, but still reads the cache", async () => {
    const before = cached().length;
    answer('{"approval_status": "Provisional"}');
    const keep = (text: string) => !text.includes("Provisional");
    await cachedText("https://example.test/provisional", { keep });
    assert.equal(cached().length, before);
    answer('{"approval_status": "Approved"}');
    await cachedText("https://example.test/provisional", { keep });
    answer("changed");
    assert.equal(
      await cachedText("https://example.test/provisional", { keep }),
      '{"approval_status": "Approved"}',
    );
  });

  it("fetches again rather than replay an answer an older build cached that keep turns down", async () => {
    const url = "https://example.test/old-provisional";
    const key = createHash("sha256")
      .update(JSON.stringify([url, null]))
      .digest("hex");
    mkdirSync(join(dir, key.slice(0, 2)), { recursive: true });
    writeFileSync(join(dir, key.slice(0, 2), key), '{"approval_status": "Provisional"}');
    answer('{"approval_status": "Approved"}');
    const keep = (text: string) => !text.includes("Provisional");
    assert.equal(await cachedText(url, { keep }), '{"approval_status": "Approved"}');
  });
});

describe("fetchText", () => {
  it("hands a long Retry-After to the caller rather than retrying at once", async () => {
    const { fetchText } = await import("../src/http.ts");
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("", { status: 429, headers: { "retry-after": "721" } });
    };
    await assert.rejects(
      fetchText("https://example.test/limited"),
      /returned 429 \(retry after 721 s\)/,
    );
    assert.equal(calls, 1);
  });

  it("tells the caller how long a short Retry-After holds it, then retries", async () => {
    const { fetchText } = await import("../src/http.ts");
    let calls = 0;
    globalThis.fetch = async () =>
      ++calls === 1
        ? new Response("", { status: 429, headers: { "retry-after": "1" } })
        : new Response("ok");
    const held: number[] = [];
    assert.equal(
      await fetchText("https://example.test/briefly", { throttled: (s) => held.push(s) }),
      "ok",
    );
    // The first retry backs off 2 seconds, longer than the 1 the API asked.
    assert.deepEqual(held, [2]);
  });
});
