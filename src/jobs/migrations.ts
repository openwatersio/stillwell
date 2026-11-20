import { readdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { INGEST_OPTIONS } from "../ingest-options.ts";
import { MAX_TIMEOUT, commandProblems, laneOf, words } from "./commands.ts";

/**
 * The work a merged change needs done to the store, which the Migrations
 * workflow runs once, one step at a time, in the order of the files in
 * src/migrations/ (src/migrations/README.md).
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
  out.push(...unpruned(migration.steps ?? []));
  return out;
}

/**
 * A `withhold` or `drop` leaves its stations' rows in stations/matches.parquet and stations/links.parquet until a
 * `matches --prune` and a `links --prune` after it take them out, as the Ingest workflow's prune jobs do.
 */
function unpruned(steps: Step[]): string[] {
  const ingest = steps.map((s) => ("ingest" in s ? argsOf(s) : []));
  const last = ingest.findLastIndex((args) => ["withhold", "drop"].includes(words(args)[0]!));
  if (last < 0) return [];
  const after = ingest.slice(last + 1);
  return ["matches", "links"]
    .filter((c) => !after.some((args) => words(args)[0] === c && args.includes("--prune")))
    .map(
      (c) =>
        `${(steps[last] as { ingest: string }).ingest}: follow it with a \`${c} --prune\` step`,
    );
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

/** One migration's progress, as `migrations.json` in the store holds it. */
export interface Progress {
  id: string;
  /** The next step to run, or the number of steps once done. */
  step: number;
  state: "running" | "done" | "failed";
  error: string | null;
  updated: string;
}

/**
 * The record: the last migration done before it began, '' for none, and each migration's progress, those up to the
 * baseline included as done, so one merged later under an earlier name is caught as sorting before them.
 */
export interface Record {
  baseline: string;
  migrations: Progress[];
}

/** What runs next: a step, a stop with why, or nothing. */
export type Next =
  | { id: string; step: number; kind: "ingest"; args: string[]; lane: string; timeout: number }
  | { id: string; step: number; kind: "check"; lane: "check"; timeout: number }
  | { stopped: string }
  | null;

/**
 * The next step to run: the first unfinished step of the first migration after the baseline that isn't done. A
 * failed migration stops every one after it until it's retried or skipped, and one that sorts before a migration
 * already started stops them until it's renamed to sort after.
 */
export function next(migrations: [string, Migration][], record: Record): Next {
  const rows = new Map(record.migrations.map((r) => [r.id, r]));
  const last = [...rows.keys()].sort().at(-1);
  for (const [id, migration] of migrations) {
    const row = rows.get(id);
    if (row?.state === "done") continue;
    if (row?.state === "failed") return { stopped: `${id} failed: ${row.error}` };
    if (!row && last !== undefined && id < last)
      return { stopped: `${id} sorts before ${last}, which has started; rename it to sort after` };
    const found = problems(migration);
    if (found.length) return { stopped: `${id} can't run: ${found.join("; ")}` };
    const index = row?.step ?? 0;
    const step = migration.steps[index];
    if (!step)
      return {
        stopped: `${id} has ${migration.steps.length} steps, but its record is at step ${index}`,
      };
    if ("check" in step)
      return { id, step: index, kind: "check", lane: "check", timeout: step.timeout ?? 30 };
    const args = argsOf(step);
    return {
      id,
      step: index,
      kind: "ingest",
      args,
      lane: laneOf(args),
      timeout: step.timeout ?? 180,
    };
  }
  return null;
}

function put(record: Record, row: Progress): Record {
  return { ...record, migrations: [...record.migrations.filter((r) => r.id !== row.id), row] };
}

/** A new record whose baseline is `id` ('' for none), with every migration up to it done. */
export function begin(migrations: [string, Migration][], id: string, now = new Date()): Record {
  if (id && !migrations.some(([m]) => m === id)) throw new Error(`no migration ${id}`);
  return {
    baseline: id,
    migrations: migrations
      .filter(([m]) => id && m <= id)
      .map(([m, migration]) => ({
        id: m,
        step: migration.steps.length,
        state: "done",
        error: "done before the record began",
        updated: now.toISOString(),
      })),
  };
}

/** The record after step `step` of `id` succeeded: the next step, or done after the last. */
export function done(
  record: Record,
  migrations: [string, Migration][],
  id: string,
  step: number,
  now = new Date(),
): Record {
  const migration = migrations.find(([m]) => m === id)?.[1];
  if (!migration) throw new Error(`no migration ${id}`);
  const last = step + 1 >= migration.steps.length;
  return put(record, {
    id,
    step: step + 1,
    state: last ? "done" : "running",
    error: null,
    updated: now.toISOString(),
  });
}

/** The record after step `step` of `id` failed, which stops every migration after it. */
export function fail(
  record: Record,
  id: string,
  step: number,
  error: string,
  now = new Date(),
): Record {
  return put(record, { id, step, state: "failed", error, updated: now.toISOString() });
}

/** The record with a failed migration set to run its failed step again. */
export function retry(record: Record, id: string, now = new Date()): Record {
  const row = record.migrations.find((r) => r.id === id);
  if (row?.state !== "failed") throw new Error(`${id} hasn't failed`);
  return put(record, { ...row, state: "running", error: null, updated: now.toISOString() });
}

/** The record with a migration that failed or hasn't finished marked done without its remaining steps. */
export function skip(
  record: Record,
  migrations: [string, Migration][],
  id: string,
  now = new Date(),
): Record {
  if (!migrations.some(([m]) => m === id)) throw new Error(`no migration ${id}`);
  const row = record.migrations.find((r) => r.id === id);
  if (row?.state === "done") throw new Error(`${id} is done`);
  return put(record, {
    id,
    step: row?.step ?? 0,
    state: "done",
    error: "skipped",
    updated: now.toISOString(),
  });
}
