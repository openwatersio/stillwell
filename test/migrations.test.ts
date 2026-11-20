import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { FLAGS, commandProblems, laneOf } from "../src/jobs/commands.ts";
import {
  type Migration,
  type Record,
  done,
  fail,
  loadMigrations,
  next,
  problems,
  retry,
  skip,
} from "../src/jobs/migrations.ts";

const NOW = new Date("2026-11-16T00:00:00Z");
const words = (s: string) => s.split(" ");
const steps = (...s: Migration["steps"]): Migration => ({ description: "", steps: s });
const ok = async () => {};

describe("commands", () => {
  it("skips the flags ingest.yml's group job knows take no value", () => {
    const script: string = parse(readFileSync(".github/workflows/ingest.yml", "utf8")).jobs.group
      .steps[0].run;
    const listed = /^\s*(--[a-z-]+(?: \| --[a-z-]+)*) \| --\*=\*/m.exec(script)?.[1].split(" | ");
    assert.deepEqual(listed?.toSorted(), [...FLAGS].toSorted());
  });

  it("puts a command in the concurrency group ingest.yml gives it", () => {
    assert.equal(laneOf(words("requalify usace 01,02 1982 2027")), "store-usace");
    assert.equal(laneOf(words("backfill usgs all 2026 2027 --shard 1/3")), "store-usgs");
    assert.equal(laneOf(words("analyze --concurrency 8 cmems --all")), "store-cmems");
    assert.equal(laneOf(words("publish")), "store");
    assert.equal(laneOf(words("matches --accept-matches --concurrency 16")), "matches");
  });

  it("refuses what a step can't run", () => {
    assert.match(commandProblems(words("teleport ea"), 180)[0], /not a command/);
    assert.match(commandProblems(words("compact --days 6"), 180)[0], /takes 1 arguments, not 0/);
    assert.match(commandProblems(words("compact nope"), 180)[0], /Unknown source/);
    assert.match(commandProblems(words("publish"), 0)[0], /timeout/);
    assert.match(commandProblems(words("publish"), 361)[0], /timeout/);
    assert.deepEqual(commandProblems(words("compact ea --days 6"), 180), []);
    assert.match(commandProblems(words("drop gesla -- --dry-run"), 180)[0], /can't hold --/);
    assert.deepEqual(commandProblems(words("withhold ea"), 180), []);
    assert.match(commandProblems(words("requalify ea all"), 180)[0], /takes 4 arguments, not 2/);
    assert.match(commandProblems(words("compact ea --rebuild-bound"), 180)[0], /Unknown option/);
  });
});

describe("migration problems", () => {
  const one = (step: Migration["steps"][number]) => problems(steps(step));
  it("refuses decisions and dry runs a step can't make", () => {
    assert.deepEqual(problems(steps()), ["no steps"]);
    assert.match(
      problems(steps({ check: "c", verify: ok }, { ingest: "compact ea" }))[0],
      /first step is a check/,
    );
    assert.match(one({ ingest: "withhold ea --accept-withheld" })[0], /--accept-withheld/);
    assert.match(one({ ingest: "drop gesla --dry-run" })[0], /--dry-run/);
  });

  it("refuses a budget that can end a requalify before it's done", () => {
    assert.deepEqual(one({ ingest: "requalify ea all 2020 2027" }), []);
    assert.match(one({ ingest: "requalify ea all 2020 2027 --budget 0" })[0], /--budget/);
    assert.match(one({ ingest: "analyze ea --all --requalify" })[0], /--budget/);
    assert.deepEqual(
      one({ ingest: "analyze ea --all --requalify --budget 240", timeout: 240 }),
      [],
    );
  });

  it("finds every migration in src/migrations runnable", async () => {
    for (const [id, migration] of await loadMigrations())
      assert.deepEqual(problems(migration), [], id);
  });

  it("orders migrations by ID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrations-"));
    try {
      for (const name of ["20261116-fix-usace.ts", "20261116-fix.ts"])
        await writeFile(join(dir, name), "export default { description: '', steps: [] }");
      assert.deepEqual(
        (await loadMigrations(pathToFileURL(`${dir}/`), NOW)).map(([id]) => id),
        ["20261116-fix", "20261116-fix-usace"],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a file in src/migrations that isn't named to run", async () => {
    for (const name of ["20261116_fix-ea.ts", "20261131-fix.ts", "20271116-fix.ts"]) {
      const dir = await mkdtemp(join(tmpdir(), "migrations-"));
      try {
        await writeFile(join(dir, "README.md"), "");
        await writeFile(join(dir, name), "export default {}");
        await assert.rejects(loadMigrations(pathToFileURL(`${dir}/`), NOW), new RegExp(name));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});

describe("the record", () => {
  const all: [string, Migration][] = [
    ["20261101-a", steps({ ingest: "compact ea" }, { check: "c", verify: ok, timeout: 10 })],
    ["20261102-b", steps({ ingest: "requalify usgs all 2026 2027", timeout: 300 })],
  ];
  const empty: Record = { baseline: "", migrations: [] };

  it("runs each step of each migration in order, then nothing", () => {
    let record = empty;
    assert.deepEqual(next(all, record), {
      id: "20261101-a",
      step: 0,
      kind: "ingest",
      args: ["compact", "ea"],
      lane: "store-ea",
      timeout: 180,
    });
    record = done(record, all, "20261101-a", 0, NOW);
    assert.deepEqual(next(all, record), {
      id: "20261101-a",
      step: 1,
      kind: "check",
      lane: "check",
      timeout: 10,
    });
    record = done(record, all, "20261101-a", 1, NOW);
    assert.equal(record.migrations.find((r) => r.id === "20261101-a")?.state, "done");
    assert.equal((next(all, record) as { lane: string }).lane, "store-usgs");
    record = done(record, all, "20261102-b", 0, NOW);
    assert.equal(next(all, record), null);
  });

  it("skips migrations up to the baseline", () => {
    assert.equal(
      (next(all, { baseline: "20261101-a", migrations: [] }) as { id: string }).id,
      "20261102-b",
    );
    assert.equal(next(all, { baseline: "20261102-b", migrations: [] }), null);
  });

  it("stops at a failed step until it's retried, then runs it again, or until it's skipped", () => {
    const failed = fail(empty, "20261101-a", 0, "exit 1", NOW);
    assert.deepEqual(next(all, failed), { stopped: "20261101-a failed: exit 1" });
    assert.equal((next(all, retry(failed, "20261101-a", NOW)) as { step: number }).step, 0);
    assert.equal((next(all, skip(failed, "20261101-a", NOW)) as { id: string }).id, "20261102-b");
    assert.throws(() => retry(empty, "20261101-a", NOW), /hasn't failed/);
  });

  it("stops at a migration that sorts before one already started", () => {
    const started: Record = {
      baseline: "",
      migrations: [{ id: "20261102-b", step: 0, state: "running", error: null, updated: "" }],
    };
    assert.match((next(all, started) as { stopped: string }).stopped, /sorts before 20261102-b/);
  });

  it("stops at a migration that can't run", () => {
    const bad: [string, Migration][] = [["20261101-a", steps({ ingest: "teleport ea" })]];
    assert.match((next(bad, empty) as { stopped: string }).stopped, /can't run/);
  });
});
