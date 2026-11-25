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
  begin,
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
    assert.match(commandProblems(words("stations ea"), 180)[0], /--no-publish/);
    assert.deepEqual(commandProblems(words("stations ea --no-publish"), 180), []);
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

  it("refuses a withhold or drop with no prune of both files after it", () => {
    const prunes: Migration["steps"] = [{ ingest: "matches --prune" }, { ingest: "links --prune" }];
    assert.deepEqual(problems(steps({ ingest: "withhold ea" }, ...prunes)), []);
    assert.deepEqual(problems(steps({ ingest: "drop gesla" }, ...prunes.toReversed())), []);
    assert.deepEqual(problems(steps({ ingest: "compact ea" })), []);
    assert.deepEqual(one({ ingest: "withhold ea" }), [
      "withhold ea: follow it with a `matches --prune` step",
      "withhold ea: follow it with a `links --prune` step",
    ]);
    assert.deepEqual(problems(steps(...prunes, { ingest: "drop gesla" })).length, 2);
    assert.deepEqual(
      problems(steps({ ingest: "withhold ea" }, { ingest: "matches" }, prunes[1]!)),
      ["withhold ea: follow it with a `matches --prune` step"],
    );
    assert.deepEqual(
      problems(steps({ ingest: "withhold ea" }, ...prunes, { ingest: "drop gesla" }, prunes[0]!)),
      ["drop gesla: follow it with a `links --prune` step"],
    );
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

  it("refuses --with-inactive on named stations, as ingest does", () => {
    assert.match(
      one({ ingest: "backfill coops 8574680 1990 1991 --refetch --with-inactive" })[0],
      /--with-inactive goes with `all`/,
    );
    assert.deepEqual(one({ ingest: "backfill coops all 1990 1991 --refetch --with-inactive" }), []);
  });

  it("finds every migration in src/migrations runnable", async () => {
    for (const [id, migration] of await loadMigrations())
      assert.deepEqual(problems(migration), [], id);
  });

  it("orders migrations by ID", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrations-"));
    try {
      // A date long after today loads too: a name's date only has to be a real one.
      for (const name of ["20261116-fix-usace.ts", "20261116-fix.ts", "29991231-later.ts"])
        await writeFile(join(dir, name), "export default { description: '', steps: [] }");
      assert.deepEqual(
        (await loadMigrations(pathToFileURL(`${dir}/`))).map(([id]) => id),
        ["20261116-fix", "20261116-fix-usace", "29991231-later"],
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a file in src/migrations that isn't named to run", async () => {
    for (const name of ["20261116_fix-ea.ts", "20261131-fix.ts", "fix-ea.ts"]) {
      const dir = await mkdtemp(join(tmpdir(), "migrations-"));
      try {
        await writeFile(join(dir, "README.md"), "");
        await writeFile(join(dir, name), "export default {}");
        await assert.rejects(loadMigrations(pathToFileURL(`${dir}/`)), new RegExp(name));
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

  it("begins with the migrations up to the baseline done, and runs one merged later under an earlier name", () => {
    assert.equal((next(all, begin(all, "20261101-a", NOW)) as { id: string }).id, "20261102-b");
    assert.equal(next(all, begin(all, "20261102-b", NOW)), null);
    assert.equal((next(all, begin(all, "", NOW)) as { id: string }).id, "20261101-a");
    const late: [string, Migration][] = [
      ["20261100-late", steps({ ingest: "compact ea" })],
      ...all,
    ];
    // One merged after the record began, under an earlier name, runs.
    assert.equal((next(late, begin(all, "20261102-b", NOW)) as { id: string }).id, "20261100-late");
  });

  it("stops at a migration with fewer steps than its record", () => {
    const shorter: [string, Migration][] = [["20261101-a", steps({ ingest: "compact ea" })]];
    const record = done(empty, all, "20261101-a", 0, NOW);
    assert.match((next(shorter, record) as { stopped: string }).stopped, /record is at step 1/);
  });

  it("stops at a failed step until it's retried, then runs it again, or until it's skipped", () => {
    const failed = fail(empty, "20261101-a", 0, "exit 1", NOW);
    assert.deepEqual(next(all, failed), { stopped: "20261101-a failed: exit 1" });
    assert.equal((next(all, retry(failed, "20261101-a", NOW)) as { step: number }).step, 0);
    assert.equal(
      (next(all, skip(failed, all, "20261101-a", NOW)) as { id: string }).id,
      "20261102-b",
    );
    assert.throws(() => retry(empty, "20261101-a", NOW), /hasn't failed/);
    assert.throws(() => skip(failed, all, "20261130-typo", NOW), /no migration/);
  });

  it("runs a migration merged after one named later has run", () => {
    const later = done(empty, all, "20261102-b", 0, NOW);
    assert.equal((next(all, later) as { id: string }).id, "20261101-a");
  });

  it("finishes a migration partway through its steps before starting one merged since", () => {
    const late: [string, Migration][] = [
      ["20261100-late", steps({ ingest: "compact ea" })],
      ...all,
    ];
    const partway = done(empty, all, "20261101-a", 0, NOW);
    assert.deepEqual(next(late, partway), {
      id: "20261101-a",
      step: 1,
      kind: "check",
      lane: "check",
      timeout: 10,
    });
  });

  it("stops every migration not yet done while one has failed, whatever its name", () => {
    const late: [string, Migration][] = [
      ["20261100-late", steps({ ingest: "compact ea" })],
      ...all,
    ];
    const failed = fail(empty, "20261102-b", 0, "exit 1", NOW);
    assert.deepEqual(next(late, failed), { stopped: "20261102-b failed: exit 1" });
  });

  it("stops every migration while a failed or unfinished one's file is gone", () => {
    const renamed = fail(empty, "20261099-old-name", 0, "exit 1", NOW);
    assert.match((next(all, renamed) as { stopped: string }).stopped, /20261099-old-name failed/);
    const partway: Record = {
      baseline: "",
      migrations: [
        { id: "20261099-old-name", step: 1, state: "running", error: null, updated: "" },
      ],
    };
    assert.match((next(all, partway) as { stopped: string }).stopped, /no such file/);
    // Skipping it clears the stop, though its file is gone.
    assert.equal(
      (next(all, skip(partway, all, "20261099-old-name", NOW)) as { id: string }).id,
      "20261101-a",
    );
    // A done migration whose file is gone is history, and stops nothing.
    const gone: Record = {
      baseline: "",
      migrations: [{ id: "20261099-old-name", step: 1, state: "done", error: null, updated: "" }],
    };
    assert.equal((next(all, gone) as { id: string }).id, "20261101-a");
  });

  it("stops at a migration that can't run", () => {
    const bad: [string, Migration][] = [["20261101-a", steps({ ingest: "teleport ea" })]];
    assert.match((next(bad, empty) as { stopped: string }).stopped, /can't run/);
  });
});
