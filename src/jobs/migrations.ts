import { readdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { INGEST_OPTIONS } from "../ingest-options.ts";
import type { DatabaseSync } from "node:sqlite";
import { MAX_TIMEOUT, commandProblems, laneOf, serverRuns, words } from "./commands.ts";
import { enqueue, getJob, type MigrationRow } from "./queue.ts";

/**
 * The work a merged change needs done to the store, which the job service
 * runs once, one step at a time, in the order of the files in src/migrations/
 * (docs/plans/jobs.md).
 */
export interface Migration {
  description: string;
  steps: Step[];
}

export type Step =
  /** ingest.ts arguments, separated by spaces; `timeout` in minutes, 180 by default. */
  | { ingest: string; timeout?: number }
  /** A read-back of the store, which throws when it finds something wrong; `timeout` in minutes, 30 by default. */
  | { check: string; verify: (store: string) => Promise<void>; timeout?: number };

/** Flags a step can't pass: the `--accept-*` ones accept whatever the source reports when the step runs, long after the review. */
const REFUSED = ["--accept-epochs", "--accept-withheld", "--accept-matches", "--dry-run"];

export function argsOf(step: { ingest: string }): string[] {
  return step.ingest.split(/\s+/).filter(Boolean);
}

/** An option's value as scripts/ingest.ts reads it: the last one given, or none where the arguments don't parse. */
function option(args: string[], name: string): string | undefined {
  try {
    const value = parseArgs({ args, options: INGEST_OPTIONS, allowPositionals: true }).values[
      name as keyof typeof INGEST_OPTIONS
    ];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Why a migration can't run unattended, or nothing when it can. */
export function problems(migration: Migration): string[] {
  const out: string[] = [];
  if (!migration.steps?.length) out.push("no steps");
  // A check reads back what the steps before it wrote, so one with none before it reads the store unchanged.
  else if ("check" in migration.steps[0])
    out.push("its first step is a check, with nothing yet to check");
  for (const step of migration.steps ?? []) {
    if ("check" in step) {
      if (typeof step.verify !== "function") out.push(`check ${step.check}: no verify`);
      const timeout = step.timeout ?? 30;
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT)
        out.push(`check ${step.check}: timeout ${timeout} isn't 1 to ${MAX_TIMEOUT} minutes`);
      continue;
    }
    const args = argsOf(step);
    const timeout = step.timeout ?? 180;
    out.push(...commandProblems(args, timeout));
    for (const flag of REFUSED.filter((f) => args.includes(f)))
      out.push(`${step.ingest}: a step can't pass ${flag}`);
    // A requalify that stops at its budget leaves stations for a later run and still succeeds.
    const [command] = words(args);
    const budget = option(args, "budget");
    const requalifies =
      command === "requalify" || (command === "analyze" && args.includes("--requalify"));
    if (
      requalifies &&
      (command === "analyze" || budget !== undefined) &&
      !(Number(budget) >= timeout)
    )
      out.push(`${step.ingest}: pass a --budget of at least the timeout, ${timeout}`);
  }
  return out;
}

/** Every migration in src/migrations/, by ID (its file name), in order. */
export async function loadMigrations(
  dir = new URL("../migrations/", import.meta.url),
  now = new Date(),
): Promise<[string, Migration][]> {
  const names = (await readdir(dir)).filter((f) => f !== "README.md" && !f.startsWith("."));
  // A date after today would sort after every migration written until then, which would then be refused.
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  const bad = names.filter((f) => {
    const m = /^(\d{4})(\d{2})(\d{2})-[a-z0-9-]+\.ts$/.exec(f);
    const date = m && `${m[1]}-${m[2]}-${m[3]}`;
    const valid =
      date && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().startsWith(date);
    return !valid || date > tomorrow;
  });
  if (bad.length)
    throw new Error(
      `src/migrations/ holds ${bad.join(", ")}, not named YYYYMMDD-name.ts with a date up to today`,
    );
  // By ID, the name without .ts, as advance and setBaseline compare them: "-" sorts before "." in a name.
  const byId = names.map((f) => f.replace(/\.ts$/, "")).sort();
  return Promise.all(
    byId.map(async (id) => {
      const f = `${id}.ts`;
      const { default: migration } = (await import(new URL(f, dir).href)) as {
        default: Migration;
      };
      return [id, migration] as [string, Migration];
    }),
  );
}

/** The last migration done before the database's record began, '' for none, or null with no baseline yet. */
export function baseline(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT id FROM baseline").get() as { id: string } | undefined;
  return row ? row.id : null;
}

/**
 * Begins the record: marks done every migration in `ids` up to `id` ('' for
 * none), so a migration merged afterwards with an earlier name is caught as
 * sorting before them, rather than taken as done.
 */
export function setBaseline(db: DatabaseSync, id: string, ids: string[], now = new Date()): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM baseline");
    db.prepare("INSERT INTO baseline (id) VALUES (?)").run(id);
    for (const done of ids.filter((m) => m <= id))
      db.prepare(
        "INSERT INTO migrations (id, step, state, job, error, updated) VALUES (?, 0, 'done', NULL, 'done before the baseline', ?) ON CONFLICT (id) DO NOTHING",
      ).run(done, now.toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/**
 * The steps of a migration the server can't run yet, which would hold every
 * migration after it. Its checks count too unless the server runs every other
 * step, since they'd read the store before the work they check.
 */
export function waiting(migration: Migration): string[] {
  const ingest = migration.steps.filter((s) => "ingest" in s);
  const out = ingest.flatMap((step) => (serverRuns(laneOf(argsOf(step))) ? [] : [step.ingest]));
  if (out.length || !ingest.length)
    out.push(...migration.steps.flatMap((s) => ("check" in s ? [`check ${s.check}`] : [])));
  return out;
}

export function migrationRows(db: DatabaseSync): MigrationRow[] {
  return db.prepare("SELECT * FROM migrations ORDER BY id").all() as unknown as MigrationRow[];
}

function save(db: DatabaseSync, row: MigrationRow): void {
  db.prepare(
    "INSERT INTO migrations (id, step, state, job, error, updated) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET step = excluded.step, state = excluded.state, job = excluded.job, error = excluded.error, updated = excluded.updated",
  ).run(row.id, row.step, row.state, row.job, row.error, row.updated);
}

/**
 * Moves the migrations on: the first not done, and the ones after it once it
 * is. It notes the job of its current step and, once that has succeeded,
 * queues the next step, so one step of one migration runs at a time. It stops
 * at a failed migration, at a step in a lane the server doesn't run yet, and
 * before a migration that sorts before one already started, which it doesn't
 * record. With no baseline it runs none. Returns why it stopped, if not done.
 */
export function advance(
  db: DatabaseSync,
  migrations: [string, Migration][],
  now = new Date(),
  runs: (lane: string) => boolean = serverRuns,
): string | null {
  if (baseline(db) === null)
    return "no baseline: run `stillwell-jobs baseline` with the last migration done";
  const updated = now.toISOString();
  const rows = new Map(migrationRows(db).map((r) => [r.id, r]));
  const last = [...rows.keys()].sort().at(-1);

  for (const [id, migration] of migrations) {
    let row = rows.get(id);
    if (row?.state === "done") continue;
    if (row?.state === "failed") return `${id} failed: ${row.error}`;
    if (!row) {
      if (last !== undefined && id < last)
        return `${id} sorts before ${last}, which has started; rename it to sort after`;
      row = { id, step: 0, state: "running", job: null, error: null, updated };
    }
    const fail = (error: string) => {
      save(db, { ...row!, state: "failed", error, updated });
      return `${id} failed: ${error}`;
    };
    const found = problems(migration);
    if (found.length) return fail(found.join("; "));

    for (;;) {
      if (row.job !== null) {
        const job = getJob(db, row.job);
        if (!job) return fail(`its job ${row.job} is gone`);
        if (job.state === "queued" || job.state === "running" || job.state === "cancelling")
          return `${id} waits on job ${job.id}`;
        if (job.state !== "succeeded") return fail(`job ${job.id} ${job.state}: ${job.result}`);
        row = { ...row, step: row.step + 1, job: null, updated };
      }
      if (row.step >= migration.steps.length) {
        save(db, { ...row, state: "done", updated });
        break;
      }
      const step = migration.steps[row.step];
      const [command, lane, timeout] =
        "check" in step
          ? [["server/check.ts", id, String(row.step)], "check", step.timeout ?? 30]
          : [["scripts/ingest.ts", ...argsOf(step)], laneOf(argsOf(step)), step.timeout ?? 180];
      if (!runs(lane)) {
        save(db, row);
        return `${id} waits for the server to run ${lane}`;
      }
      // One transaction, so a crash between them never leaves a step queued that the record doesn't name.
      db.exec("BEGIN IMMEDIATE");
      try {
        const job = enqueue(db, { command, lane, timeout }, now)!;
        save(db, { ...row, job: job.id });
        db.exec("COMMIT");
        return `${id} waits on job ${job.id}`;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }
  return null;
}

/** Sets a failed migration running again from the step it failed at. */
export function retry(db: DatabaseSync, id: string, now = new Date()): void {
  const changed = db
    .prepare(
      "UPDATE migrations SET state = 'running', job = NULL, error = NULL, updated = ? WHERE id = ? AND state = 'failed'",
    )
    .run(now.toISOString(), id).changes;
  if (!changed) throw new Error(`${id} hasn't failed`);
}

/** Marks a failed migration done without its remaining steps, for a step a person has decided can't or needn't pass. */
export function skip(db: DatabaseSync, id: string, now = new Date()): void {
  const changed = db
    .prepare(
      "UPDATE migrations SET state = 'done', job = NULL, error = 'skipped by hand: ' || error, updated = ? WHERE id = ? AND state = 'failed'",
    )
    .run(now.toISOString(), id).changes;
  if (!changed) throw new Error(`${id} hasn't failed`);
}

/** Whether `advance` stopped for something a person must fix, rather than to wait on a job. */
export function stuck(stopped: string | null): boolean {
  return (
    !!stopped &&
    / failed: | sorts before | waits for the server |^no baseline|^migrations can't load/.test(
      stopped,
    )
  );
}
