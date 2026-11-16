import { DatabaseSync } from "node:sqlite";

/** A job's command: argv after `node`, from the release it runs, such as `["scripts/ingest.ts", "compact", "ea"]`. */
export interface Job {
  id: number;
  command: string[];
  lane: string;
  timeout: number;
  key: string | null;
  /** `cancelling` while the service stops a running job someone cancelled. */
  state: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
  /** The release directory it ran from. */
  release: string | null;
  created: string;
  started: string | null;
  ended: string | null;
  /** Why it ended as it did. */
  result: string | null;
}

export interface MigrationRow {
  id: string;
  /** The index of the step running or next to run. */
  step: number;
  state: "running" | "done" | "failed";
  /** The job running the current step. */
  job: number | null;
  error: string | null;
  updated: string;
}

export function openQueue(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  // The command opens the database while the service has it open.
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 10000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY,
      command TEXT NOT NULL,
      lane TEXT NOT NULL,
      timeout INTEGER NOT NULL,
      key TEXT UNIQUE,
      state TEXT NOT NULL DEFAULT 'queued',
      release TEXT,
      created TEXT NOT NULL,
      started TEXT,
      ended TEXT,
      result TEXT
    );
    CREATE INDEX IF NOT EXISTS jobs_state ON jobs (state, id);
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      step INTEGER NOT NULL,
      state TEXT NOT NULL,
      job INTEGER,
      error TEXT,
      updated TEXT NOT NULL
    );
    -- The last migration done before this database's record began: '' when it began with none.
    CREATE TABLE IF NOT EXISTS baseline (id TEXT NOT NULL);
  `);
  return db;
}

type Row = Record<string, unknown>;

function toJob(row: Row): Job {
  return { ...(row as unknown as Job), command: JSON.parse(String(row.command)) as string[] };
}

export function enqueue(
  db: DatabaseSync,
  job: { command: string[]; lane: string; timeout: number; key?: string },
  now = new Date(),
): Job | null {
  const row = db
    .prepare(
      "INSERT INTO jobs (command, lane, timeout, key, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (key) DO NOTHING RETURNING *",
    )
    .get(JSON.stringify(job.command), job.lane, job.timeout, job.key ?? null, now.toISOString());
  return row ? toJob(row) : null;
}

export function getJob(db: DatabaseSync, id: number): Job | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  return row ? toJob(row) : null;
}

/** The most recent jobs in `states`, oldest of them first, for showing. */
export function jobs(db: DatabaseSync, states: Job["state"][], limit = 100): Job[] {
  return db
    .prepare(
      `SELECT * FROM jobs WHERE state IN (${states.map(() => "?").join(",")}) ORDER BY id DESC LIMIT ?`,
    )
    .all(...states, limit)
    .map(toJob)
    .reverse();
}

/** Every job in `states`, oldest first. */
export function allJobs(db: DatabaseSync, states: Job["state"][]): Job[] {
  return db
    .prepare(`SELECT * FROM jobs WHERE state IN (${states.map(() => "?").join(",")}) ORDER BY id`)
    .all(...states)
    .map(toJob);
}

/** A job that may run longer than an hour, which leaves a slot for the hourly and nightly ones. */
export const isLong = (job: Pick<Job, "timeout">) => job.timeout > 60;

/**
 * The queued jobs to start now: one per lane, none in a lane with a job
 * running or being cancelled, none `runs` refuses, at most `slots` running in
 * all, of them at most `longSlots` long. A lane's short jobs, such as a
 * source's hourly run, start before its long ones, oldest first within each,
 * so an hourly run waits behind at most the one long job running, never a
 * row of them queued; a job `runs` refuses holds the later jobs of its kind.
 */
export function startable(
  db: DatabaseSync,
  slots: number,
  runs: (job: Job) => boolean,
  longSlots = slots,
): Job[] {
  const running = allJobs(db, ["running", "cancelling"]);
  const busy = new Set(running.filter((j) => j.lane !== "check").map((j) => j.lane));
  let total = running.length;
  let long = running.filter(isLong).length;
  const out: Job[] = [];
  const queued = allJobs(db, ["queued"]);
  for (const job of [...queued.filter((j) => !isLong(j)), ...queued.filter(isLong)]) {
    if (total >= slots) break;
    if (busy.has(job.lane)) continue;
    if (isLong(job) && long >= longSlots) continue;
    if (job.lane !== "check") busy.add(job.lane);
    if (!runs(job)) continue;
    out.push(job);
    total++;
    if (isLong(job)) long++;
  }
  return out;
}

/** Cancels the queued jobs `keep` refuses, such as those of a source that has left the server, with `why`. */
export function cancelQueuedUnless(
  db: DatabaseSync,
  keep: (job: Job) => boolean,
  why: string,
  now = new Date(),
): Job[] {
  const dropped = allJobs(db, ["queued"]).filter((j) => !keep(j));
  for (const job of dropped)
    db.prepare(
      "UPDATE jobs SET state = 'cancelled', result = ?, ended = ? WHERE id = ? AND state = 'queued'",
    ).run(why, now.toISOString(), job.id);
  return dropped;
}

/** Claims a queued job to start; false when it's no longer queued, such as one just cancelled. */
export function markStarted(
  db: DatabaseSync,
  id: number,
  release: string,
  now = new Date(),
): boolean {
  return (
    db
      .prepare(
        "UPDATE jobs SET state = 'running', release = ?, started = ? WHERE id = ? AND state = 'queued'",
      )
      .run(release, now.toISOString(), id).changes > 0
  );
}

/** Ends a running job, or one being cancelled; one that has already ended keeps how it ended. */
export function markEnded(
  db: DatabaseSync,
  id: number,
  state: "succeeded" | "failed" | "cancelled",
  result: string,
  now = new Date(),
): void {
  db.prepare(
    "UPDATE jobs SET state = ?, result = ?, ended = ? WHERE id = ? AND state IN ('running', 'cancelling')",
  ).run(state, result, now.toISOString(), id);
}

/**
 * Cancels a job: a queued one at once, and a running one by marking it
 * `cancelling`, which keeps its lane until the service has stopped it and
 * marked it cancelled. Returns what it did, or null for a job that has ended.
 */
export function cancel(
  db: DatabaseSync,
  id: number,
  now = new Date(),
): "cancelled" | "cancelling" | null {
  const queued = db
    .prepare(
      "UPDATE jobs SET state = 'cancelled', result = 'cancelled before it started', ended = ? WHERE id = ? AND state = 'queued'",
    )
    .run(now.toISOString(), id).changes;
  if (queued) return "cancelled";
  const running = db
    .prepare("UPDATE jobs SET state = 'cancelling' WHERE id = ? AND state = 'running'")
    .run(id).changes;
  return running ? "cancelling" : null;
}

export function counts(db: DatabaseSync): {
  failed: number;
  queued: number;
  oldestQueued: string | null;
} {
  const row = db
    .prepare(
      "SELECT count(*) FILTER (WHERE state = 'failed') AS failed, count(*) FILTER (WHERE state = 'queued') AS queued, min(created) FILTER (WHERE state = 'queued') AS oldest FROM jobs",
    )
    .get() as Row;
  return {
    failed: Number(row.failed),
    queued: Number(row.queued),
    oldestQueued: (row.oldest as string | null) ?? null,
  };
}

/** Whether a job keyed `<kind>:…` waits to start. */
export function queuedKind(db: DatabaseSync, kind: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM jobs WHERE state = 'queued' AND key LIKE ? ESCAPE '\\'")
    .get(`${kind.replace(/[\\%_]/g, "\\$&")}:%`);
}
