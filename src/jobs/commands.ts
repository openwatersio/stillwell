import { parseArgs } from "node:util";
import { INGEST_OPTIONS } from "../ingest-options.ts";
import { sourceOf } from "../sources/index.ts";

/** The commands a migration step runs, with the words each takes after the command: its source first where it has one. */
const ARITY: Record<string, number> = {
  publish: 0,
  links: 0,
  matches: 0,
  backfill: 4,
  requalify: 4,
  compact: 1,
  withhold: 1,
  drop: 1,
  misplaced: 1,
  years: 1,
  analyze: 1,
  stations: 1,
};

/** The ingest flags that take no value, which ingest.yml's group job must list too. */
export const FLAGS = new Set(
  Object.entries(INGEST_OPTIONS)
    .filter(([, option]) => option.type === "boolean")
    .map(([name]) => `--${name}`),
);

/** The longest a step may run, in minutes: a GitHub Actions job's limit. */
export const MAX_TIMEOUT = 360;

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

/** The concurrency group an ingest command runs in, as ingest.yml picks it. */
export function laneOf(args: string[]): string {
  const [command, source] = words(args);
  if (command === "links" || command === "matches") return command;
  return ARITY[command] > 0 && source ? `store-${source}` : "store";
}

/** Why ingest arguments can't run as a migration step, or nothing when they can. */
export function commandProblems(args: string[], timeout: number): string[] {
  const text = args.join(" ");
  const out: string[] = [];
  if (args.includes("--")) out.push(`${text}: a step's arguments can't hold --`);
  let positionals: string[] = [];
  try {
    // As scripts/ingest.ts parses them, so an unknown or misspelled option fails here, not in the job.
    positionals = parseArgs({ args, options: INGEST_OPTIONS, allowPositionals: true }).positionals;
  } catch (error) {
    out.push(`${text}: ${(error as Error).message}`);
  }
  const [command, ...rest] = positionals;
  if (!command || !(command in ARITY)) out.push(`${text}: not a command a step runs`);
  else {
    if (rest.length !== ARITY[command])
      out.push(`${text}: ${command} takes ${ARITY[command]} arguments, not ${rest.length}`);
    // Publishing writes stations.parquet and the offsets, which only the `store` group may write.
    if (command === "stations" && !args.includes("--no-publish"))
      out.push(`${text}: stations runs as a step only with --no-publish`);
    if (ARITY[command] > 0 && rest[0])
      try {
        sourceOf(rest[0]);
      } catch (error) {
        out.push((error as Error).message);
      }
  }
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT)
    out.push(`${text}: timeout ${timeout} isn't 1 to ${MAX_TIMEOUT} minutes`);
  return out;
}
