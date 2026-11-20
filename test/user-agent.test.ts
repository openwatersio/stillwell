import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { USER_AGENT } from "../src/http.ts";
import { readRows } from "../src/store/parquet.ts";

// The Open Waters User-Agent policy asks for a name, a version and a contact.
describe("User-Agent", () => {
  it("names the project, its version and a contact", () => {
    assert.match(USER_AGENT, /^[^/ ]+\/[^ ]+ .*https?:\/\//);
  });

  it("is sent on reads of the store over HTTP", async () => {
    const seen: (string | undefined)[] = [];
    const server = createServer((request, response) => {
      seen.push(request.headers["user-agent"]);
      response.statusCode = 404;
      response.end();
    }).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      assert.deepEqual(await readRows(`http://127.0.0.1:${port}/stations.parquet`), []);
    } finally {
      server.close();
    }
    assert.ok(seen.length > 0);
    for (const ua of seen) assert.ok(ua?.includes(USER_AGENT), `sent ${ua}`);
  });
});
