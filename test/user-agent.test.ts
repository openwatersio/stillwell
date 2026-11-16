import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { loadCatalog } from "../src/api/catalog.ts";
import { USER_AGENT } from "../src/http.ts";
import { clickhouse, type ClickHouse } from "../src/realtime/clickhouse.ts";
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

  it("is sent on stillwell-api's reads of the station list", async () => {
    const queries: { sql: string; params: Record<string, unknown> }[] = [];
    const ch = {
      query: async (sql: string, params: Record<string, unknown>) => {
        queries.push({ sql, params });
        return [{}];
      },
    } as unknown as ClickHouse;
    // The fake rows aren't a station list; only the queries matter here.
    await loadCatalog(ch, "https://stillwell.example").catch(() => {});
    assert.equal(queries.length, 2);
    for (const { sql, params } of queries) {
      assert.match(sql, /headers\('User-Agent' = \{ua:String\}\)/);
      assert.equal(params.ua, USER_AGENT);
    }
  });
});

// Runs against a real ClickHouse only when CLICKHOUSE_URL names one, as CI's service does.
describe("User-Agent on ClickHouse", { skip: !process.env.CLICKHOUSE_URL }, () => {
  it("accepts the station list's url() with its headers", async () => {
    // Nothing listens there, so the query parses and fails only on the connection.
    const error = await loadCatalog(clickhouse("default"), "http://127.0.0.1:9").then(
      () => assert.fail("read a store that isn't there"),
      (e: Error) => e,
    );
    assert.doesNotMatch(
      error.message,
      /SYNTAX_ERROR|BAD_ARGUMENTS|UNKNOWN_QUERY_PARAMETER|ILLEGAL/,
    );
    assert.match(error.message, /Connection refused|NETWORK_ERROR|POCO_EXCEPTION|RECEIVED_ERROR/i);
  });
});
