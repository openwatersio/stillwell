/**
 * stillwell-jobs: runs the store's jobs from the queue in /var/lib/stillwell-jobs/jobs.db,
 * one per lane, each as a systemd unit of its own, queues the scheduled runs of
 * the sources on the server, and moves the migrations in src/migrations/ on
 * (docs/plans/jobs.md).
 *
 *   node server/jobs.ts
 *
 * STILLWELL_JOBS_DB is the database, STILLWELL_WRITE_STORE the store jobs write,
 * with the S3_* credentials to write it, STILLWELL_JOBS_METRICS the
 * file it writes its metrics to, in Prometheus's text format, and GITHUB_TOKEN
 * reads Actions' runs and main's server.json.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { totalmem } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL, actionsWriting, mainPhases } from "../src/jobs/actions.ts";
import { serverRuns } from "../src/jobs/commands.ts";
import { advance, baseline, loadMigrations, setBaseline, stuck } from "../src/jobs/migrations.ts";
import {
  allJobs,
  cancelQueuedUnless,
  counts,
  enqueue,
  markEnded,
  markStarted,
  openQueue,
  queuedKind,
  startable,
  type Job,
} from "../src/jobs/queue.ts";
import { due, refreshFor, type Planned } from "../src/jobs/schedule.ts";
import { clickhouse } from "../src/realtime/clickhouse.ts";
import { jobDir, systemd } from "../src/jobs/units.ts";
import { PHASES } from "../src/sources/jobs.ts";

/** Jobs running at once, across lanes, of which at most LONG_SLOTS run over an hour, so a source's hourly run always has one. */
const SLOTS = 3;
const LONG_SLOTS = 2;
const TICK_MS = 10_000;
/** How long an answer from GitHub stands before it's asked again. */
const GITHUB_MS = 5 * 60_000;

const db = openQueue(process.env.STILLWELL_JOBS_DB ?? "/var/lib/stillwell-jobs/jobs.db");
const writeStore = process.env.STILLWELL_WRITE_STORE ?? "";
const units = systemd(writeStore, Math.floor(totalmem() / 5));
const metricsPath = process.env.STILLWELL_JOBS_METRICS;
// The release this service runs, which deploys point /opt/stillwell at; each job keeps the one it started with.
const release = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
let lastReadiness: string | null = null;
let github: { at: number; writing: Set<string>; onServer: Set<string> } = {
  at: 0,
  writing: new Set([ALL]),
  onServer: new Set(),
};
let lastPollsError = "";
let lastStopped: string | null = null;
let lastMetricsError = "";
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => (stopping = true));

while (!stopping) {
  try {
    await tick();
  } catch (error) {
    console.error(`tick: ${(error as Error).stack}`);
  }
  await new Promise((resolve) => setTimeout(resolve, TICK_MS));
}

/** Notes the jobs that ended, stops cancelled ones, moves migrations on, queues what's due, starts what can start, and writes the metrics. */
async function tick(): Promise<void> {
  for (const job of allJobs(db, ["running"])) {
    const ended = units.ended(job.id);
    if (!ended) continue;
    markEnded(db, job.id, ended.ok ? "succeeded" : "failed", ended.result);
    // One left by a failed read is swept on a later pass, below.
    units.clear(job.id);
    console.log(
      `job ${job.id} ${ended.ok ? "succeeded" : "failed"} (${ended.result}): ${job.command.join(" ")}`,
    );
  }
  // Only the service stops a job, so its lane stays taken until the job has stopped.
  for (const job of allJobs(db, ["cancelling"])) {
    // One that ended before the cancel reached it ends as it did.
    const ended = units.ended(job.id);
    if (!units.clear(job.id)) {
      console.error(`job ${job.id}: not stopped yet; its lane stays taken until it is`);
      continue;
    }
    if (ended?.ok) markEnded(db, job.id, "succeeded", `${ended.result}, before its cancel`);
    else markEnded(db, job.id, "cancelled", "stopped by hand");
    console.log(`job ${job.id} ended on its cancel: ${job.command.join(" ")}`);
  }

  // A migration file that won't load stops migrations, not the jobs already queued.
  let stopped: string | null;
  try {
    const migrations = await loadMigrations();
    // The first start, with src/migrations/ empty, begins the record; any other database without one runs none.
    if (baseline(db) === null && !migrations.length) setBaseline(db, "", []);
    stopped = advance(db, migrations);
  } catch (error) {
    stopped = `migrations can't load: ${(error as Error).message}`;
  }
  if (stopped !== lastStopped && stopped) console.log(`migrations: ${stopped}`);
  lastStopped = stopped;
  sweepRuns();

  const now = new Date();
  for (const planned of due(now))
    // A run waiting behind a long job in its lane isn't joined by the next one of the same kind.
    if (!queuedKind(db, planned.kind) && enqueue(db, planned, now))
      console.log(`queued ${planned.key}`);
  for (const planned of await datumChanges(now))
    if (!queuedKind(db, planned.kind) && enqueue(db, planned, now))
      console.log(`queued ${planned.key}, as a datum changed`);
  // A source that left the server phase takes its waiting jobs with it, so none starts if it comes back.
  for (const job of cancelQueuedUnless(
    db,
    (j) => !j.lane.startsWith("store-") || serverRuns(j.lane),
    "its source left the server",
    now,
  ))
    console.log(`job ${job.id} cancelled, as its source left the server: ${job.command.join(" ")}`);

  const { writing, onServer } = await askGithub();
  const noStore = storeMissing();
  const notReady = noStore;
  if (notReady !== lastReadiness) console.log(notReady ?? "store jobs can run");
  lastReadiness = notReady;
  const runs = (j: Job) => {
    // A check reads the store, so it waits for the store's credentials too; only the selftest doesn't.
    if (j.lane === "check") return j.command[1] === "selftest" || !noStore;
    const source = j.lane.slice("store-".length);
    return (
      !notReady &&
      serverRuns(j.lane) &&
      // main's server.json too, so a box deployed from a branch, or one a failed deploy left behind, writes
      // only what main gives it, as Actions writes only what main doesn't.
      onServer.has(source) &&
      !writing.has(ALL) &&
      !writing.has(source)
    );
  };
  for (const job of startable(db, SLOTS, runs, LONG_SLOTS)) {
    // Claimed first, so a job cancelled since it was picked never starts, and a failed start never repeats.
    if (!markStarted(db, job.id, release)) continue;
    try {
      units.start(job, release);
      console.log(`job ${job.id} started: ${job.command.join(" ")}`);
    } catch (error) {
      // Left running: systemd may have made the unit before the call failed, so the next pass reads
      // it, and ends the job as failed only once the unit has ended or is gone.
      console.error(`job ${job.id}: starting it failed: ${(error as Error).message}`);
    }
  }
  writeMetrics(stopped);
}

function writeMetrics(stopped: string | null): void {
  if (!metricsPath) return;
  const { failed, queued, oldestQueued } = counts(db);
  const oldest = oldestQueued ? (Date.now() - Date.parse(oldestQueued)) / 1000 : 0;
  const lines = [
    "# HELP stillwell_jobs_failed_total Jobs that have failed, ever.",
    "# TYPE stillwell_jobs_failed_total counter",
    `stillwell_jobs_failed_total ${failed}`,
    "# HELP stillwell_jobs_queued Jobs waiting to start.",
    "# TYPE stillwell_jobs_queued gauge",
    `stillwell_jobs_queued ${queued}`,
    "# HELP stillwell_jobs_oldest_queued_seconds How long the oldest waiting job has waited.",
    "# TYPE stillwell_jobs_oldest_queued_seconds gauge",
    `stillwell_jobs_oldest_queued_seconds ${Math.round(oldest)}`,
    "# HELP stillwell_migrations_stuck Whether migrations have stopped for something a person must fix.",
    "# TYPE stillwell_migrations_stuck gauge",
    `stillwell_migrations_stuck ${stuck(stopped) ? 1 : 0}`,
    "# HELP stillwell_jobs_tick_timestamp_seconds When the service last went round its loop.",
    "# TYPE stillwell_jobs_tick_timestamp_seconds gauge",
    `stillwell_jobs_tick_timestamp_seconds ${Math.round(Date.now() / 1000)}`,
  ];
  // The directory is the stillwell user's, so the file is written with that user's rights: a link a stillwell
  // process put in the path can lead the write only where that user could write anyway.
  const [uid, gid] = stillwellIds();
  try {
    process.setegid!(gid);
    process.seteuid!(uid);
    writeFileSync(`${metricsPath}.tmp`, `${lines.join("\n")}\n`);
    renameSync(`${metricsPath}.tmp`, metricsPath);
  } catch (error) {
    const message = `metrics not written: ${(error as Error).message}`;
    if (message !== lastMetricsError) console.error(message);
    lastMetricsError = message;
  } finally {
    process.seteuid!(0);
    process.setegid!(0);
  }
}

let ids: [number, number] | undefined;
function stillwellIds(): [number, number] {
  ids ??= [
    Number(execFileSync("id", ["-u", "stillwell"], { encoding: "utf8" })),
    Number(execFileSync("id", ["-g", "stillwell"], { encoding: "utf8" })),
  ];
  return ids;
}

/**
 * Why jobs can't write the store now, or null when they can: without STILLWELL_WRITE_STORE naming an s3://
 * store and the credentials for it in /etc/stillwell.env, a job would write a local directory that's deleted
 * when it ends.
 */
function storeMissing(): string | null {
  if (!writeStore.startsWith("s3://"))
    return "store jobs wait for STILLWELL_WRITE_STORE in /etc/stillwell.env to name an s3:// store";
  const missing = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) return `store jobs wait for ${missing.join(", ")} in /etc/stillwell.env`;
  return null;
}

/**
 * The sources an Actions run may still write, and those main's server.json puts in the server phase, asked of
 * GitHub every few minutes while a source is on the server. When GitHub can't answer, or without a token, every
 * source is being written and none is on the server, so the server writes none.
 */
async function askGithub(): Promise<{ writing: Set<string>; onServer: Set<string> }> {
  if (![...PHASES.values()].includes("server")) return { writing: new Set(), onServer: new Set() };
  if (Date.now() - github.at < GITHUB_MS) return github;
  const token = process.env.GITHUB_TOKEN;
  let answer = { writing: new Set([ALL]), onServer: new Set<string>() };
  if (!token)
    console.error("store jobs wait for GITHUB_TOKEN, to read Actions' runs and main's server.json");
  else
    try {
      // A slow GitHub holds the loop for at most two minutes, after which it counts as unknown.
      const [phases, writing] = await Promise.race([
        Promise.all([
          mainPhases(token, "openwatersio/stillwell"),
          actionsWriting(token, "openwatersio/stillwell"),
        ]),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("no answer in two minutes")), 120_000).unref(),
        ),
      ]);
      answer = {
        writing,
        onServer: new Set([...phases].filter(([, p]) => p === "server").map(([s]) => s)),
      };
    } catch (error) {
      console.error(`can't read GitHub: ${(error as Error).message}`);
    }
  github = { at: Date.now(), ...answer };
  return answer;
}

/**
 * The list refreshes datum changes ask for: the sources on the server whose passes in the last hour reported a
 * station in another datum, from the poller's polls table, each refreshed once a day (refreshFor's key).
 */
async function datumChanges(now: Date): Promise<Planned[]> {
  const sources = [...PHASES].filter(([, phase]) => phase === "server").map(([id]) => id);
  if (!sources.length) return [];
  try {
    const rows = await clickhouse("stillwell").query<{ source: string }>(
      "SELECT DISTINCT source FROM polls WHERE datum_changed AND finished > now() - INTERVAL 1 HOUR AND has({sources:Array(String)}, source)",
      { sources },
    );
    return rows.map((r) => refreshFor(r.source, now));
  } catch (error) {
    const message = `can't read datum changes from polls: ${(error as Error).message}`;
    if (message !== lastPollsError) console.error(message);
    lastPollsError = message;
    return [];
  }
}

/** Removes the units and directories of ended jobs that a failed clear left behind. */
function sweepRuns(): void {
  let ids: number[];
  try {
    ids = readdirSync(dirname(jobDir(0)))
      .map(Number)
      .filter(Number.isInteger);
  } catch {
    return;
  }
  const live = new Set(allJobs(db, ["running", "cancelling"]).map((j) => j.id));
  for (const id of ids) if (!live.has(id)) units.clear(id);
}
