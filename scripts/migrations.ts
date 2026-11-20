/**
 * The Migrations workflow's steps (.github/workflows/migrations.yml): which step of src/migrations/ runs next, a
 * check's read-back, and the record of what's done, `migrations.json` in the store.
 *
 *   node scripts/migrations.ts next            the next step, as GitHub outputs: id, step, kind, args, lane, timeout
 *   node scripts/migrations.ts check <id> <step>
 *   node scripts/migrations.ts done <id> <step>
 *   node scripts/migrations.ts fail <id> <step> <error>
 *   node scripts/migrations.ts retry|skip <id>
 *   node scripts/migrations.ts baseline <id|none>
 *   node scripts/migrations.ts list
 *
 * STILLWELL_STORE and its credentials are the store's, as for scripts/ingest.ts.
 */
import { appendFileSync } from "node:fs";
import {
  begin,
  done,
  fail,
  loadMigrations,
  next,
  retry,
  skip,
  type Migration,
  type Record,
} from "../src/jobs/migrations.ts";
import { readJson, writeJson } from "../src/store/parquet.ts";
import { STORE } from "../src/store/stores.ts";

const path = `${STORE}/migrations.json`;

async function read(): Promise<Record | null> {
  return (await readJson(path)) as Record | null;
}

async function write(record: Record): Promise<void> {
  await writeJson(path, {
    ...record,
    migrations: [...record.migrations].sort((a, b) => (a.id < b.id ? -1 : 1)),
  });
}

function output(values: { [key: string]: string | number }): void {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

const [command, id, step, ...rest] = process.argv.slice(2);
const migrations = await loadMigrations();
const record = await read();
const need = (r: Record | null): Record => {
  if (!r)
    throw new Error(`no record at ${path}: run \`node scripts/migrations.ts baseline <id|none>\``);
  return r;
};

switch (command) {
  case "next": {
    if (!record) {
      const stopped = `no record at ${path}, so no migration runs until \`node scripts/migrations.ts baseline <id|none>\` begins it`;
      console.error(stopped);
      output({ id: "", stopped });
      break;
    }
    const found = next(migrations, record);
    if (!found) output({ id: "" });
    else if ("stopped" in found) {
      console.error(found.stopped);
      output({ id: "", stopped: found.stopped.replace(/\n/g, " ") });
    } else
      output({
        id: found.id,
        step: found.step,
        kind: found.kind,
        args: "args" in found ? found.args.join(" ") : "",
        lane: found.lane,
        timeout: found.timeout,
      });
    break;
  }
  case "check": {
    const migration = migrations.find(([m]) => m === id)?.[1] as Migration | undefined;
    const found = migration?.steps[Number(step)];
    if (!found || !("check" in found)) throw new Error(`${id} has no check at step ${step}`);
    await found.verify(STORE);
    console.log(`${id}: ${found.check}: passed`);
    break;
  }
  case "done":
    await write(done(need(record), migrations, id!, Number(step)));
    break;
  case "fail":
    await write(fail(need(record), id!, Number(step), rest.join(" ") || "the step failed"));
    break;
  case "retry":
    await write(retry(need(record), id!));
    break;
  case "skip":
    await write(skip(need(record), migrations, id!));
    break;
  case "baseline": {
    if (record) throw new Error(`${path} already has a baseline, ${record.baseline || "none"}`);
    await write(begin(migrations, id === "none" ? "" : id!));
    break;
  }
  case "list":
    console.log(`baseline: ${record ? record.baseline || "none" : "no record"}`);
    for (const [m] of migrations) {
      const row = record?.migrations.find((r) => r.id === m);
      const state = row
        ? `${row.state}, step ${row.step}${row.error ? `: ${row.error}` : ""}`
        : "not started";
      console.log(`${m}\t${state}`);
    }
    break;
  default:
    throw new Error(
      "usage: migrations.ts next | check <id> <step> | done|fail <id> <step> | retry|skip <id> | baseline <id|none> | list",
    );
}
