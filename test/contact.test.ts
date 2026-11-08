import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";
import type { SourceMetadata } from "../src/schema.ts";

const dir = new URL("../src/sources/", import.meta.url);
const adapters = readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe("source contacts", () => {
  it("can't be empty", () => {
    // @ts-expect-error A contact needs an email or a URL.
    const none: SourceMetadata["contact"] = {};
    assert.deepEqual(none, {});
  });

  for (const id of adapters)
    it(`${id} says where to report an error`, async () => {
      const { metadata } = (await import(new URL(`${id}/index.ts`, dir).href)) as {
        metadata: SourceMetadata;
      };
      const { email, url } = metadata.contact;
      assert.ok(email || url, "an email or a contact page");
      if (email) assert.match(email, /^[^@\s]+@[^@\s]+\.[a-z]+$/i);
      if (url) assert.match(url, /^https:\/\/\S+$/);
    });
});
