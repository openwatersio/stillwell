/**
 * stillwell-ingest: polls every hourly source's live stations into ClickHouse,
 * each station at its `min_interval_s`, hourly where it gives none
 * (docs/realtime.md). Each pass runs in a process of its own (server/pass.ts).
 *
 *   node server/ingest.ts [source...]
 *
 * CLICKHOUSE_URL (default http://127.0.0.1:8123), CLICKHOUSE_USER and
 * CLICKHOUSE_PASSWORD reach ClickHouse; public sources go to the database
 * `stillwell` and sources that bar republishing to `stillwell_restricted`.
 * STILLWELL_STORE and STILLWELL_RESTRICTED_STORE are the stores, as for
 * scripts/ingest.ts; the server reads them and never writes them. With
 * GITHUB_TOKEN set, a source reporting a station in another datum starts the
 * Monthly refresh of that source, unless one started in the last day.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sources, sourceOf } from "../src/sources/index.ts";
import { storeOfSource } from "../src/store/stores.ts";
import type { Source } from "../src/schema.ts";
import { clickhouse, databaseFor, migrate } from "../src/realtime/clickhouse.ts";
import { schedule, type PassResult } from "../src/realtime/schedule.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** How long a pass may run before it's stopped, as the hourly workflow's 50-minute limit stopped a run. */
const PASS_TIMEOUT_MS = 50 * MINUTE_MS;
const PASS = fileURLToPath(new URL("pass.ts", import.meta.url));

const names = process.argv.slice(2);
const chosen = (names.length ? names.map(sourceOf) : Object.values(sources)).filter(
  (s) => s.metadata.hourly,
);
if (!chosen.length) throw new Error("no hourly source named");
// Unset, the store would be a local `data` with no lists, and every pass would find none.
if (!process.env.STILLWELL_STORE) throw new Error("set STILLWELL_STORE to the store");

for (const source of chosen) storeOfSource(source.metadata); // a restricted source with no restricted store fails now
for (const name of new Set(chosen.map(databaseFor))) await migrate(clickhouse(name));

let stopping = false;
const wake = new Set<() => void>();
// Running passes, stopped with the service so none outlives it beside the next one.
const running = new Set<ReturnType<typeof spawn>>();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    for (const child of running) child.kill("SIGTERM");
    for (const resume of wake) resume();
  });

// Started a few seconds apart, so a restart doesn't run every source's first pass, with its seed, at once.
await Promise.all(chosen.map((source, i) => sleep(i * 20_000).then(() => run(source))));

/** Poll one source until the process stops (`schedule`). */
async function run(source: Source): Promise<void> {
  const id = source.metadata.id;
  await schedule({
    pass: (due, seeding, now) => pass(id, now, due, seeding),
    refresh: () => refresh(id),
    sleep,
    stopped: () => stopping,
    log: (message) => console.error(`${id}: ${message}`),
  });
}

/** Run server/pass.ts for one source and read its result, stopping it after `PASS_TIMEOUT_MS`. */
function pass(
  id: string,
  now: number,
  intervals: number[] | null,
  seeding: boolean,
): Promise<PassResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [PASS, id, String(now), intervals?.join(",") || "all", seeding ? "1" : "0"],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    running.add(child);
    const timer = setTimeout(() => child.kill("SIGKILL"), PASS_TIMEOUT_MS);
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      running.delete(child);
      // The result is the last line; an adapter's own output can come before it.
      const last = out.trim().split("\n").at(-1);
      try {
        const result = JSON.parse(last ?? "") as Omit<PassResult, "ok">;
        resolve({ ...result, ok: code === 0 });
      } catch {
        reject(new Error(`pass ended with ${signal ?? `exit ${code}`} and no result`));
      }
    });
  });
}

/**
 * Start the Monthly refresh of one source, as the hourly workflow does on a
 * datum change: unless one that refreshes it started on `main` in the last day.
 * Returns whether a refresh started or one already had.
 */
async function refresh(source: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error(`${source}: a datum changed; set GITHUB_TOKEN to start its refresh`);
    return false;
  }
  const api = "https://api.github.com/repos/openwatersio/stillwell/actions/workflows/monthly.yml";
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "stillwell-ingest",
  };
  const since = new Date(Date.now() - 24 * HOUR_MS).toISOString();
  const runs = await fetch(
    `${api}/runs?branch=main&event=workflow_dispatch&per_page=100&created=${encodeURIComponent(`>=${since}`)}`,
    { headers, signal: AbortSignal.timeout(30_000) },
  );
  if (!runs.ok) {
    console.error(`${source}: can't list refreshes: ${await runs.text()}`);
    return false;
  }
  const { workflow_runs } = (await runs.json()) as {
    workflow_runs: { display_title: string; conclusion: string | null }[];
  };
  // The titles monthly.yml gives a refresh, as the hourly workflow matches them.
  const refreshes = new RegExp(`^(Monthly|Refresh( [a-z-]+)* ${source}( [a-z-]+)*)$`);
  if (workflow_runs.some((r) => r.conclusion !== "cancelled" && refreshes.test(r.display_title)))
    return true;
  const response = await fetch(`${api}/dispatches`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ref: "main", inputs: { sources: source } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) console.error(`${source}: refresh not started: ${await response.text()}`);
  return response.ok;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      wake.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    wake.add(done);
  });
}
