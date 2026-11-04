import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
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
});
