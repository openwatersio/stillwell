import { parseArgs } from "node:util";
import { INGEST_OPTIONS } from "../ingest-options.ts";
import { sourceOf } from "../sources/index.ts";
import { PHASES } from "../sources/jobs.ts";

/** The commands a job runs, with the words each takes after the command: its source first where it has one. */
const ARITY: Record<string, number> = {
  publish: 0,
  links: 0,
  matches: 0,
  backfill: 4,
  requalify: 4,
  recent: 1,
  compact: 1,
  withhold: 1,
  drop: 1,
  years: 1,
  analyze: 1,
  stations: 1,
};

/** Commands that delete through the `aws` CLI (src/withhold.ts), which the box doesn't have. */
const NEEDS_AWS = new Set(["drop", "withhold"]);

/** The ingest flags that take no value, which ingest.yml's group job must list too. */
export const FLAGS = new Set(
  Object.entries(INGEST_OPTIONS)
    .filter(([, option]) => option.type === "boolean")
    .map(([name]) => `--${name}`),
);

/** The longest a job may run, in minutes: under the 12 hours a source's next hourly `recent` catches up after waiting behind it. */
export const MAX_TIMEOUT = 600;

/** The command and its source: the words of ingest arguments that aren't an option or its value. */
export function words(args: string[]): string[] {
  const out: string[] = [];
  let skip = false;
  for (const arg of args) {
    if (skip) skip = false;
    else if (FLAGS.has(arg) || arg === "--" || /^--.+=/.test(arg)) continue;
    else if (arg.startsWith("--")) skip = true;
    else out.push(arg);
  }
  return out;
}

/** The lane an ingest command runs in, as ingest.yml picks its concurrency group. */
export function laneOf(args: string[]): string {
  const [command, source] = words(args);
  if (command === "links" || command === "matches") return command;
  return ARITY[command] > 0 && source ? `store-${source}` : "store";
}

/** Whether the run is `drop --dry-run`, which writes nothing. */
export function dryDrop(args: string[]): boolean {
  // After `--`, ingest reads --dry-run as a word and drops for real; commandProblems refuses it too.
  return words(args)[0] === "drop" && args.includes("--dry-run") && !args.includes("--");
}

/** Whether the server runs jobs in `lane` now: its source is in the `server` phase, or the job writes nothing. */
export function serverRuns(lane: string, args: string[] = []): boolean {
  if (lane === "check" || dryDrop(args)) return true;
  return lane.startsWith("store-") && PHASES.get(lane.slice("store-".length)) === "server";
}

/** Why ingest arguments can't run as a job, or nothing when they can. */
export function commandProblems(args: string[], timeout: number): string[] {
  const text = args.join(" ");
  const out: string[] = [];
  if (args.includes("--")) out.push(`${text}: a job's arguments can't hold --`);
  let positionals: string[] = [];
  try {
    // As scripts/ingest.ts parses them, so an unknown or misspelled option fails here, not in the job.
    positionals = parseArgs({ args, options: INGEST_OPTIONS, allowPositionals: true }).positionals;
  } catch (error) {
    out.push(`${text}: ${(error as Error).message}`);
  }
  const [command, ...rest] = positionals;
  if (!command || !(command in ARITY)) out.push(`${text}: not a command a job runs`);
  else {
    if (rest.length !== ARITY[command])
      out.push(`${text}: ${command} takes ${ARITY[command]} arguments, not ${rest.length}`);
    // stations.parquet is published in Actions until every source has moved (docs/plans/jobs.md).
    if (command === "stations" && !args.includes("--no-publish"))
      out.push(`${text}: stations runs on the server only with --no-publish`);
    if (NEEDS_AWS.has(command) && !dryDrop(args))
      out.push(`${text}: ${command} deletes with the aws CLI, which the server doesn't have yet`);
    if (ARITY[command] > 0 && rest[0])
      try {
        // The server has no restricted store.
        if (!sourceOf(rest[0]).metadata.license.redistribution)
          out.push(`${text}: ${rest[0]} is restricted`);
      } catch (error) {
        out.push((error as Error).message);
      }
  }
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT)
    out.push(`${text}: timeout ${timeout} isn't 1 to ${MAX_TIMEOUT} minutes`);
  return out;
}
