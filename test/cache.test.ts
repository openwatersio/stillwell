import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

const dir = mkdtempSync(join(tmpdir(), "water-levels-cache-"));
process.env.WATER_LEVELS_CACHE = dir;
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
});
