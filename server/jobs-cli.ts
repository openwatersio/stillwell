/**
 * stillwell-jobs: the job queue's command, run on the box as root
 * (docs/plans/jobs.md).
 *
 *   stillwell-jobs enqueue [--timeout minutes] <ingest args...>
 *   stillwell-jobs list
 *   stillwell-jobs show <id>
 *   stillwell-jobs cancel <id>
 *   stillwell-jobs migrations
 *   stillwell-jobs retry <migration>
 *   stillwell-jobs skip <migration>
 *   stillwell-jobs baseline <migration|none>
 *   stillwell-jobs selftest [fail]
 *
 * `enqueue` queues one `scripts/ingest.ts` run in its source's lane, and
 * refuses one in a lane the server doesn't run yet. `cancel` stops a running
 * job. `skip` marks a failed migration done without its remaining steps, a
 * decision to make only once they can't or needn't run. `baseline` records
 * the last migration already done on a database that has no record, marking it
 * and every earlier one done, so the service runs only those after it. `selftest` queues a
 * job that runs through the whole path and writes nothing, failing with `fail`.
 */
import { commandProblems, laneOf, serverRuns } from "../src/jobs/commands.ts";
import {
  baseline,
  loadMigrations,
  migrationRows,
  retry,
  setBaseline,
  skip,
} from "../src/jobs/migrations.ts";
import { cancel, enqueue, getJob, jobs, openQueue } from "../src/jobs/queue.ts";
import { unitOf } from "../src/jobs/units.ts";

const db = openQueue(process.env.STILLWELL_JOBS_DB ?? "/var/lib/stillwell-jobs/jobs.db");
const [command, ...rest] = process.argv.slice(2);

switch (command) {
  case "enqueue": {
    // Only a leading --timeout is the job's; everything after is the ingest run's own.
    const [timeout, args] =
      rest[0] === "--timeout" ? [Number(rest[1]), rest.slice(2)] : [180, rest];
    const lane = laneOf(args);
    const problems = commandProblems(args, timeout);
    if (!serverRuns(lane, args))
      problems.push(
        `the server doesn't run ${lane} yet: use the Ingest workflow (docs/plans/jobs.md)`,
      );
    if (problems.length) fail(problems.join("\n"));
    const job = enqueue(db, { command: ["scripts/ingest.ts", ...args], lane, timeout })!;
    console.log(`queued job ${job.id} in ${lane}: ${args.join(" ")}`);
    console.log(`follow it with: journalctl -fu ${unitOf(job.id)}`);
    break;
  }
  case "selftest": {
    const job = enqueue(db, {
      command: ["server/check.ts", "selftest", ...(rest[0] === "fail" ? ["fail"] : [])],
      lane: "check",
      timeout: 5,
    })!;
    console.log(`queued job ${job.id}; see it with: stillwell-jobs show ${job.id}`);
    break;
  }
  case "list":
    for (const job of jobs(
      db,
      ["queued", "running", "cancelling", "succeeded", "failed", "cancelled"],
      50,
    ))
      console.log(
        [
          job.id,
          job.state,
          job.lane,
          job.started ?? job.created,
          job.command.slice(1).join(" "),
          job.result ?? "",
        ].join("\t"),
      );
    break;
  case "show": {
    const job = getJob(db, Number(rest[0]));
    if (!job) fail(`no job ${rest[0]}`);
    console.log(JSON.stringify(job, null, 2));
    console.log(`its log: journalctl -u ${unitOf(job!.id)}`);
    break;
  }
  case "cancel": {
    const done = cancel(db, Number(rest[0]));
    if (!done) fail(`no job ${rest[0]} that is queued or running`);
    console.log(
      done === "cancelled"
        ? `cancelled job ${rest[0]}`
        : `job ${rest[0]} stops within seconds: the service stops it and marks it cancelled`,
    );
    break;
  }
  case "migrations": {
    console.log(`baseline: ${baseline(db) === null ? "none recorded" : baseline(db) || "none"}`);
    const rows = new Map(migrationRows(db).map((r) => [r.id, r]));
    for (const [id, migration] of await loadMigrations()) {
      const row = rows.get(id);
      console.log(
        [
          id,
          row ? `${row.state}, step ${row.step + 1} of ${migration.steps.length}` : "not started",
          row?.error ?? "",
        ].join("\t"),
      );
    }
    break;
  }
  case "skip":
    skip(db, rest[0]);
    console.log(`${rest[0]} is marked done without its remaining steps`);
    break;
  case "retry":
    retry(db, rest[0]);
    console.log(`${rest[0]} runs again from the step that failed`);
    break;
  case "baseline": {
    if (!rest[0]) fail("usage: stillwell-jobs baseline <migration|none>");
    const id = rest[0] === "none" ? "" : rest[0];
    if (id && !(await loadMigrations()).some(([m]) => m === id)) fail(`no migration ${rest[0]}`);
    setBaseline(
      db,
      id,
      (await loadMigrations()).map(([m]) => m),
    );
    console.log(`the service runs only migrations after ${rest[0]}`);
    break;
  }
  default:
    fail(
      "usage: stillwell-jobs enqueue [--timeout minutes] <ingest args...> | list | show <id> | cancel <id> | migrations | retry <migration> | skip <migration> | baseline <migration|none> | selftest [fail]",
    );
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
