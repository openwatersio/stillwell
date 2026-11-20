/**
 * The poller: polls every public hourly source's live stations into the live
 * store, each station at its `min_interval_s`, hourly where it gives none, and
 * writes each source's daily files from it (docs/plans/cloudflare.md). It runs
 * in the live Worker's container (workers/live). Each pass runs in a process of
 * its own (server/pass.ts), as does each source's export (server/export.ts).
 *
 *   node server/ingest.ts [source...]
 *
 * STILLWELL_LIVE is the live store's endpoint (src/realtime/live.ts), and
 * STILLWELL_STORE the store it reads the station lists from. With PORT set, it
 * answers `GET /health` there, which the Worker asks to know it's up. With
 * GITHUB_TOKEN set, a source reporting a station in another datum starts the
 * Monthly refresh of that source, unless one started in the last day; for a
 * source on the server's job queue, the job service does. With
 * STILLWELL_METRICS set, it writes each source's pass metrics to that file
 * after every pass, in Prometheus's text format.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sources, sourceOf } from "../src/sources/index.ts";
import { PHASES, SERVER_SOURCES } from "../src/sources/jobs.ts";
import type { Source } from "../src/schema.ts";
import { recentDays } from "../src/store/paths.ts";
import { PassError, schedule, slots, type PassResult } from "../src/realtime/schedule.ts";
import {
  metricsText,
  readSaved,
  recordPass,
  startMetrics,
  type SourceMetrics,
} from "../src/realtime/metrics.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** How long a pass may run before it's stopped, as the hourly workflow's 50-minute limit stopped a run. */
const PASS_TIMEOUT_MS = 50 * MINUTE_MS;
const PASS = fileURLToPath(new URL("pass.ts", import.meta.url));
const EXPORT = fileURLToPath(new URL("export.ts", import.meta.url));
/** Minutes past each hour when the daily files are written: today's every hour, the 6 days before after midnight. */
const EXPORT_MINUTE = 5;
/** How many passes run at once: each is a process of its own, holding up to about 800 MB. */
const PASSES_AT_ONCE = 2;

const names = process.argv.slice(2);
// The live store and the daily files are public, so a source whose terms bar republishing isn't polled.
const chosen = (names.length ? names.map(sourceOf) : Object.values(sources)).filter(
  (s) => s.metadata.hourly && s.metadata.license.redistribution,
);
if (!chosen.length) throw new Error("no hourly source named");
// Unset, the store would be a local `data` with no lists, and every pass would find none.
if (!process.env.STILLWELL_STORE) throw new Error("set STILLWELL_STORE to the store");

const health = process.env.PORT
  ? createServer((request, response) => {
      response.writeHead(request.url === "/health" ? 200 : 404).end();
    }).listen(Number(process.env.PORT))
  : null;

let stopping = false;
const wake = new Set<() => void>();
// Running passes, stopped with the service so none outlives it beside the next one.
const running = new Set<ReturnType<typeof spawn>>();
const passSlots = slots(PASSES_AT_ONCE);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    stopping = true;
    for (const child of running) child.kill("SIGTERM");
    for (const resume of wake) resume();
  });

// Each source keeps its last success and interval from before a restart, so restarts never reset the
// stale-source alert.
const saved = readSaved(readMetrics());
const metrics = new Map<string, SourceMetrics>();
for (const { metadata } of chosen)
  metrics.set(metadata.id, startMetrics(Date.now(), saved.get(metadata.id)));
writeMetrics();

// Started a few seconds apart, so a restart doesn't run every source's first pass at once.
await Promise.all([
  ...chosen.map((source, i) => sleep(i * 20_000).then(() => run(source))),
  exports(),
]);
// The loops end only when the process is told to stop; the health server would keep it running.
health?.close();

/**
 * Write the daily files until the process stops: the last 7 days at start, so a restart misses none, then today's
 * every hour at `EXPORT_MINUTE`, and the 7 days up to today after midnight, so a day's late values reach its file.
 */
async function exports(): Promise<void> {
  // After the first passes, so a start doesn't export an empty today.
  await sleep(10 * MINUTE_MS);
  for (let first = true; !stopping; first = false) {
    const now = Date.now();
    const days =
      first || new Date(now).getUTCHours() === 0 ? recentDays(now, 7) : recentDays(now, 1);
    for (const { metadata } of chosen) if (!stopping) await exportSource(metadata.id, days);
    const next =
      Math.ceil((Date.now() - EXPORT_MINUTE * MINUTE_MS) / HOUR_MS) * HOUR_MS +
      EXPORT_MINUTE * MINUTE_MS;
    await sleep(next - Date.now());
  }
}

/** Run server/export.ts for one source, in a pass slot so it shares the passes' memory budget. */
async function exportSource(id: string, days: string[]): Promise<void> {
  await passSlots.acquire();
  try {
    await new Promise<void>((resolve) => {
      const child = spawn(process.execPath, [EXPORT, id, days.join(",")], { stdio: "inherit" });
      running.add(child);
      const timer = setTimeout(() => child.kill("SIGKILL"), PASS_TIMEOUT_MS);
      child.on("close", (code) => {
        clearTimeout(timer);
        running.delete(child);
        if (code !== 0) console.error(`${id}: export ended with ${code}`);
        resolve();
      });
    });
  } finally {
    passSlots.release();
  }
}

/** Poll one source until the process stops (`schedule`). */
async function run(source: Source): Promise<void> {
  const id = source.metadata.id;
  await schedule({
    pass: async (due, seeding) => {
      let result: PassResult | null = null;
      try {
        return (result = await pass(id, due, seeding));
      } finally {
        if (!stopping) report(id, result);
      }
    },
    refresh: () => refresh(id),
    sleep,
    stopped: () => stopping,
    log: (message) => console.error(`${id}: ${message}`),
  });
}

/**
 * Record a source's pass for Grafana: at STILLWELL_METRICS, when it's set, the
 * file Alloy's textfile collector reads, replaced whole so it's never read half-written.
 */
function report(id: string, result: PassResult | null): void {
  metrics.set(id, recordPass(metrics.get(id), Date.now(), result));
  writeMetrics();
}

function readMetrics(): string {
  const path = process.env.STILLWELL_METRICS;
  try {
    return path ? readFileSync(path, "utf8") : "";
  } catch {
    return "";
  }
}

function writeMetrics(): void {
  const path = process.env.STILLWELL_METRICS;
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, metricsText(metrics));
    renameSync(`${path}.tmp`, path);
  } catch (error) {
    console.error(`metrics not written: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Run server/pass.ts for one source and read its result, stopping it after
 * `PASS_TIMEOUT_MS`. It waits for a slot while `PASSES_AT_ONCE` others run,
 * and fetches up to the time it gets one.
 */
async function pass(id: string, intervals: number[] | null, seeding: boolean): Promise<PassResult> {
  const asked = Date.now();
  await passSlots.acquire();
  // A wait this long is a source going unpolled behind others' passes.
  if (Date.now() - asked > MINUTE_MS)
    console.error(`${id}: waited ${Math.round((Date.now() - asked) / 1000)}s for a pass slot`);
  if (stopping) {
    passSlots.release();
    throw new Error("stopping");
  }
  const started = Date.now();
  return new Promise<PassResult>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        process.execPath,
        [PASS, id, String(started), intervals?.join(",") || "all", seeding ? "1" : "0"],
        { stdio: ["ignore", "pipe", "inherit"] },
      );
    } catch (error) {
      passSlots.release();
      throw new PassError(error instanceof Error ? error.message : String(error), started);
    }
    running.add(child);
    const timer = setTimeout(() => child.kill("SIGKILL"), PASS_TIMEOUT_MS);
    let out = "";
    child.stdout!.on("data", (chunk) => (out += chunk));
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      running.delete(child);
      passSlots.release();
    };
    child.on("error", (error) => {
      finish();
      reject(new PassError(error.message, started));
    });
    child.on("close", (code, signal) => {
      finish();
      // The result is the last line; an adapter's own output can come before it.
      const last = out.trim().split("\n").at(-1);
      try {
        const result = JSON.parse(last ?? "") as Omit<PassResult, "ok">;
        resolve({ ...result, ok: code === 0, started });
      } catch {
        reject(new PassError(`pass ended with ${signal ?? `exit ${code}`} and no result`, started));
      }
    });
  });
}

/**
 * Start the Monthly refresh of one source, as the hourly workflow does on a
 * datum change: unless one that refreshes it started on `main` in the last day.
 * For a source on the server's job queue, the job service queues one a day from
 * the pass's row in polls. Returns whether a refresh started or one already had,
 * which a source moving back to Actions has neither of.
 */
async function refresh(source: string): Promise<boolean> {
  // A source on the server's job queue is refreshed there: the job service reads the change from polls. One
  // moving back is refreshed by neither until it leaves server.json, which the log says.
  if (SERVER_SOURCES.has(source)) {
    if (PHASES.get(source) === "server") return true;
    console.error(
      `${source}: a datum changed while it moves back to Actions; its list waits for Actions' next refresh of it`,
    );
    return false;
  }
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
  // A source that comes back from a stopped pass after the signal ends at once, rather than hold the stop.
  if (stopping) return Promise.resolve();
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
