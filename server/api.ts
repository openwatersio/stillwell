/**
 * stillwell-api: serves `GET /water-levels/stations/{source}/{id}/levels`
 * from ClickHouse on loopback, for the Worker in workers/api
 * (docs/plans/realtime.md, The levels API).
 *
 *   node server/api.ts
 *
 * Listens on 127.0.0.1 at STILLWELL_API_PORT (default 8787). Reads the
 * database `stillwell` only, as CLICKHOUSE_USER with CLICKHOUSE_PASSWORD at
 * CLICKHOUSE_URL, and the public stations and their offsets from
 * STILLWELL_STORE, through ClickHouse, again every 10 minutes. Until it has
 * read them once, it answers 503 and tries again every 30 seconds. With
 * STILLWELL_API_METRICS set, it writes when it last read them to that file,
 * in Prometheus's text format, 0 until it has.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { loadCatalog, type Catalog } from "../src/api/catalog.ts";
import { apiHandler } from "../src/api/handler.ts";
import { clickhouse } from "../src/realtime/clickhouse.ts";
import { slots } from "../src/realtime/schedule.ts";

const RELOAD_MS = 10 * 60_000;
/**
 * Requests answered at once: each runs three ClickHouse queries, and its user
 * may run 8 at once, two of which a reload of the station list takes.
 */
const REQUESTS_AT_ONCE = 2;
/** How long a request may wait for its turn: the Worker gives up after 10 seconds. */
const WAIT_MS = 10_000;
/** How many may wait at once; past that a request is refused at once rather than queue behind ones the Worker will drop. */
const MAX_WAITING = 8;
const RETRY_MS = 30_000;
const store = process.env.STILLWELL_STORE?.replace(/\/$/, "");
if (!store) throw new Error("set STILLWELL_STORE to the public store");
const port = Number(process.env.STILLWELL_API_PORT ?? 8787);

const ch = clickhouse("stillwell");
let catalog: Catalog | null = null;
const metrics = process.env.STILLWELL_API_METRICS;
/** When the station list was last read, in seconds, for the alert on a list that stops reloading. */
function writeMetrics(loaded: number): void {
  if (!metrics) return;
  try {
    mkdirSync(dirname(metrics), { recursive: true });
    writeFileSync(
      `${metrics}.tmp`,
      `# HELP stillwell_api_catalog_loaded_timestamp_seconds When stillwell-api last read the station list, 0 for never.\n# TYPE stillwell_api_catalog_loaded_timestamp_seconds gauge\nstillwell_api_catalog_loaded_timestamp_seconds ${loaded}\n`,
    );
    renameSync(`${metrics}.tmp`, metrics);
  } catch (error) {
    // Serving goes on without them.
    console.error(`metrics not written: ${(error as Error).message}`);
  }
}
writeMetrics(0);
// A failed read keeps the last list serving, or none, and tries again sooner.
function load(): void {
  loadCatalog(ch, store!).then(
    (next) => {
      if (!catalog) console.log(`loaded ${next.size} stations`);
      catalog = next;
      writeMetrics(Date.now() / 1000);
      setTimeout(load, RELOAD_MS).unref();
    },
    (error: Error) => {
      console.error(`station list not read: ${error.message}`);
      setTimeout(load, catalog ? RELOAD_MS : RETRY_MS).unref();
    },
  );
}
load();

const handle = apiHandler({ ch, catalog: () => catalog });

const turns = slots(REQUESTS_AT_ONCE);
const BUSY = {
  status: 503,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: '{"message":"Busy; try again shortly"}',
};
let waiting = 0;
async function answer(method: string, url: string) {
  // Health needs no ClickHouse, so it never waits behind requests.
  if (url === "/health") return handle(method, url);
  const arrived = Date.now();
  if (waiting >= MAX_WAITING) return BUSY;
  waiting++;
  try {
    await turns.acquire();
  } finally {
    waiting--;
  }
  try {
    if (Date.now() - arrived > WAIT_MS) return BUSY;
    return await handle(method, url);
  } finally {
    turns.release();
  }
}

const server = createServer((request, response) => {
  answer(request.method ?? "GET", request.url ?? "/").then(
    (answer) => {
      response.writeHead(answer.status, answer.headers);
      response.end(request.method === "HEAD" ? undefined : answer.body);
    },
    (error: Error) => {
      console.error(error);
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ message: "Internal error" }));
    },
  );
});
server.listen(port, "127.0.0.1", () => console.log(`listening on 127.0.0.1:${port}`));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
