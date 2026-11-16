/**
 * stillwell-jobs: runs the store's jobs from the queue in /var/lib/stillwell-jobs/jobs.db,
 * one per lane, each as a systemd unit of its own, queues the scheduled runs of
 * the sources on the server, and moves the migrations in src/migrations/ on
 * (docs/plans/jobs.md).
 *
 *   node server/jobs.ts
 *
 * STILLWELL_JOBS_DB is the database, STILLWELL_JOBS_ENV the environment file
 * each job reads (the store and its credentials), STILLWELL_JOBS_METRICS the
 * file it writes its metrics to, in Prometheus's text format, and GITHUB_TOKEN
 * reads Actions' runs and main's server.json.
 */
import { execFileSync } from "node:child_process";
import {
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { totalmem } from "node:os";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL, actionsWriting, mainPhases } from "../src/jobs/actions.ts";
import { dryDrop, serverRuns } from "../src/jobs/commands.ts";
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
import { REFRESH_REQUESTS, due, refreshFor, type Planned } from "../src/jobs/schedule.ts";
import { envOf, jobDir, systemd } from "../src/jobs/units.ts";
import { sources } from "../src/sources/index.ts";
import { PHASES, runsJob } from "../src/sources/jobs.ts";

/** Jobs running at once, across lanes, of which at most LONG_SLOTS run over an hour, so a source's hourly run always has one. */
const SLOTS = 3;
const LONG_SLOTS = 2;
const TICK_MS = 10_000;
/**
 * The memory a box needs before store jobs run on it: three jobs at a fifth
 * each beside the poller's, ClickHouse's and the API's caps, about 4 GB.
 * A smaller box runs checks only.
 */
const STORE_JOBS_MEMORY = 15e9;
/** How long an answer from GitHub stands before it's asked again. */
const GITHUB_MS = 5 * 60_000;

const db = openQueue(process.env.STILLWELL_JOBS_DB ?? "/var/lib/stillwell-jobs/jobs.db");
const envFile = process.env.STILLWELL_JOBS_ENV ?? "/etc/stillwell-jobs.env";
const units = systemd(process.execPath, envFile, Math.floor(totalmem() / 5));
const metricsPath = process.env.STILLWELL_JOBS_METRICS;
// The release this service runs, which deploys point /opt/stillwell at; each job keeps the one it started with.
const release = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
let lastReadiness: string | null = null;
let github: { at: number; writing: Set<string>; onServer: Set<string> } = {
  at: 0,
  writing: new Set([ALL]),
  onServer: new Set(),
};
const loggedRequests = new Set<string>();
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
  for (const planned of refreshRequests(now))
    console.log(
      !queuedKind(db, planned.kind) && enqueue(db, planned, now)
        ? `queued ${planned.key}, as the poller asked`
        : `refresh of ${planned.kind.slice("refresh:".length)} asked for again; one today already`,
    );
  // A source that left the server phase takes its waiting jobs with it, so none starts if it comes back.
  for (const job of cancelQueuedUnless(
    db,
    (j) => !j.lane.startsWith("store-") || serverRuns(j.lane, j.command.slice(1)),
    "its source left the server",
    now,
  ))
    console.log(`job ${job.id} cancelled, as its source left the server: ${job.command.join(" ")}`);

  const { writing, onServer } = await askGithub();
  const noStore = storeMissing();
  const notReady = smallBox() ?? noStore;
  if (notReady !== lastReadiness) console.log(notReady ?? "store jobs can run");
  lastReadiness = notReady;
  const runs = (j: Job) => {
    // A check reads the store, so it waits for the store's credentials too; only the selftest doesn't.
    if (j.lane === "check") return j.command[1] === "selftest" || !noStore;
    const source = j.lane.slice("store-".length);
    return (
      !notReady &&
      serverRuns(j.lane, j.command.slice(1)) &&
      // main's server.json too, so a box deployed from a branch, or one a failed deploy left behind, writes
      // only what main gives it, as Actions writes only what main doesn't.
      (onServer.has(source) || !j.lane.startsWith("store-") || dryDrop(j.command.slice(1))) &&
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
  process.setegid!(gid);
  process.seteuid!(uid);
  try {
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

/** Why the box is too small for store jobs, which leaves it checks, or null. */
function smallBox(): string | null {
  return totalmem() < STORE_JOBS_MEMORY
    ? `store jobs wait for a box with ${STORE_JOBS_MEMORY / 1e9} GB; this one runs checks only`
    : null;
}

/**
 * Why the jobs can't reach the store now, or null when they can: an environment file without the store's
 * credentials, in which a job would write a local directory that's deleted when it ends.
 */
function storeMissing(): string | null {
  let env: Record<string, string>;
  try {
    env = envOf(readFileSync(envFile, "utf8"));
  } catch (error) {
    return `store jobs wait for ${envFile}: ${(error as Error).message}`;
  }
  if (!env.STILLWELL_STORE?.startsWith("s3://"))
    return `store jobs wait for STILLWELL_STORE in ${envFile} to name an s3:// store`;
  const missing = ["S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter(
    (k) => !env[k],
  );
  if (missing.length) return `store jobs wait for ${missing.join(", ")} in ${envFile}`;
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
      const phases = await mainPhases(token, "openwatersio/stillwell");
      answer = {
        writing: await actionsWriting(token, "openwatersio/stillwell"),
        onServer: new Set([...phases].filter(([, p]) => p === "server").map(([s]) => s)),
      };
    } catch (error) {
      console.error(`can't read GitHub: ${(error as Error).message}`);
    }
  github = { at: Date.now(), ...answer };
  return answer;
}

/**
 * The list refreshes the poller asked for on a datum change, one a day per source. The directory is root's,
 * with only the stillwell group allowed to add to it, so a request is removed once read, and one for a source
 * not on the server is left and reported once.
 */
function refreshRequests(now: Date): Planned[] {
  let names: string[];
  try {
    names = readdirSync(REFRESH_REQUESTS);
  } catch {
    return [];
  }
  const out: Planned[] = [];
  for (const name of names) {
    const source = sources[name];
    if (PHASES.get(name) !== "server" || !source || !runsJob("lists", source)) {
      if (!loggedRequests.has(name))
        console.error(`refresh request ${name}: not a source on the server; left`);
      loggedRequests.add(name);
      continue;
    }
    try {
      rmSync(`${REFRESH_REQUESTS}/${name}`, { force: true });
    } catch (error) {
      if (!loggedRequests.has(name))
        console.error(`refresh request ${name}: ${(error as Error).message}`);
      loggedRequests.add(name);
      continue;
    }
    out.push(refreshFor(name, now));
  }
  return out;
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
