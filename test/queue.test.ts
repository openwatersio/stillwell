import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { parse } from "yaml";
import { FLAGS, commandProblems, laneOf, serverRuns } from "../src/jobs/commands.ts";
import {
  type Migration,
  advance,
  baseline,
  loadMigrations,
  migrationRows,
  problems,
  retry,
  setBaseline,
  skip,
  stuck,
  waiting,
} from "../src/jobs/migrations.ts";
import {
  cancel,
  cancelQueuedUnless,
  counts,
  enqueue,
  getJob,
  jobs,
  markEnded,
  markStarted,
  openQueue,
  startable,
} from "../src/jobs/queue.ts";
import { PHASES, SERVER_SOURCES, sourcesFor, type Phase } from "../src/sources/jobs.ts";
import { sources } from "../src/sources/index.ts";
import { due, refreshFor } from "../src/jobs/schedule.ts";
import { ALL, writing } from "../src/jobs/actions.ts";
import { NODE, endedFrom, runArgs } from "../src/jobs/units.ts";

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

  it("puts a command in the lane ingest.yml gives it", () => {
    assert.equal(laneOf(words("requalify usace 01,02 1982 2027")), "store-usace");
    assert.equal(laneOf(words("backfill usgs all 2026 2027 --shard 1/3")), "store-usgs");
    assert.equal(laneOf(words("analyze --concurrency 8 cmems --all")), "store-cmems");
    assert.equal(laneOf(words("publish")), "store");
    assert.equal(laneOf(words("matches --accept-matches --concurrency 16")), "matches");
  });

  it("runs on the server only checks and the lanes of its sources", () => {
    assert.equal(serverRuns("check"), true);
    assert.equal(serverRuns("store-gesla"), PHASES.get("gesla") === "server");
    assert.equal(serverRuns("store"), false);
  });

  it("leaves a source in any phase out of Actions, and runs its lane only in the server phase", () => {
    const phases = PHASES as Map<string, Phase>;
    const sources = SERVER_SOURCES as Set<string>;
    const before = phases.get("ea");
    try {
      for (const phase of ["server", "returning"] as const) {
        phases.set("ea", phase);
        sources.add("ea");
        for (const job of ["hourly", "compact", "lists"] as const)
          assert.ok(!sourcesFor(job).includes("ea"), `${phase} ${job}`);
        assert.equal(serverRuns("store-ea"), phase === "server", phase);
      }
    } finally {
      if (before) phases.set("ea", before);
      else {
        phases.delete("ea");
        sources.delete("ea");
      }
    }
  });

  it("lists only public sources in server.json, in a phase, and never SFWMD, which refuses the box", () => {
    const list = JSON.parse(readFileSync("src/sources/server.json", "utf8")) as Record<
      string,
      string
    >;
    assert.ok(list && typeof list === "object" && !Array.isArray(list));
    for (const [id, phase] of Object.entries(list)) {
      assert.ok(["server", "returning"].includes(phase), `${id}: ${phase}`);
      assert.ok(sources[id]?.metadata.license.redistribution, id);
      assert.notEqual(id, "sfwmd");
    }
  });

  it("refuses what a job can't run", () => {
    assert.match(commandProblems(words("teleport ea"), 180)[0], /not a command/);
    assert.match(commandProblems(words("compact --days 6"), 180)[0], /takes 1 arguments, not 0/);
    assert.match(commandProblems(words("compact nope"), 180)[0], /Unknown source/);
    assert.match(commandProblems(words("publish"), 0)[0], /timeout/);
    assert.deepEqual(commandProblems(words("compact ea --days 6"), 180), []);
    assert.match(commandProblems(words("drop gesla -- --dry-run"), 180)[0], /can't hold --/);
    assert.match(commandProblems(words("withhold ea"), 180)[0], /aws CLI/);
    assert.match(commandProblems(words("drop gesla --dry-run"), 180)[0], /aws CLI/);
    assert.equal(laneOf(words("misplaced rws --dry-run")), "store-rws");
    assert.match(commandProblems(words("misplaced rws"), 180)[0], /aws CLI/);
    assert.match(commandProblems(words("requalify ea all"), 180)[0], /takes 4 arguments, not 2/);
    assert.match(commandProblems(words("compact ea --rebuild-bound"), 180)[0], /Unknown option/);
    assert.match(commandProblems(words("stations ea"), 180)[0], /--no-publish/);
    assert.deepEqual(commandProblems(words("stations ea --no-publish --accept-epochs"), 180), []);
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
    assert.match(one({ ingest: "--concurrency 8 analyze ea --requalify" })[0], /--budget/);
    assert.deepEqual(
      one({ ingest: "analyze ea --all --requalify --budget 240", timeout: 240 }),
      [],
    );
  });

  it("finds every migration in src/migrations runnable on the server now", async () => {
    for (const [id, migration] of await loadMigrations()) {
      assert.deepEqual(problems(migration), [], id);
      // A step the server can't run yet would hold every migration after it: keep it in ## After merge.
      assert.deepEqual(waiting(migration), [], id);
    }
  });

  it("holds a migration's checks unless the server runs every other step", () => {
    const check = { check: "c", verify: ok };
    const phases = PHASES as Map<string, Phase>;
    const before = phases.get("ea");
    phases.set("ea", "server");
    try {
      assert.deepEqual(waiting(steps(check)), ["check c"]);
      assert.deepEqual(waiting(steps({ ingest: "compact ea" }, check)), []);
      assert.deepEqual(waiting(steps({ ingest: "compact ea" }, { ingest: "compact bom" }, check)), [
        "compact bom",
        "check c",
      ]);
    } finally {
      if (before) phases.set("ea", before);
      else phases.delete("ea");
    }
  });

  it("orders migrations by ID, as advance compares them", async () => {
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
        await writeFile(join(dir, ".DS_Store"), "");
        await writeFile(join(dir, name), "export default {}");
        await assert.rejects(loadMigrations(pathToFileURL(`${dir}/`), NOW), new RegExp(name));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });
});

describe("schedule", () => {
  const phases = new Map([
    ["ea", "server"],
    ["bom", "returning"],
  ]);
  const at = (iso: string) => due(new Date(iso), phases).map((p) => p.key);

  it("queues a server source's runs as Actions schedules them, keyed by their period", () => {
    // EA is hourly, has observations and finalizes nothing.
    assert.deepEqual(at("2026-11-16T05:11:00Z"), ["compact:ea:2026-11-16"]);
    assert.deepEqual(at("2026-11-16T05:12:00Z"), [
      "hourly:ea:2026-11-16T05",
      "compact:ea:2026-11-16",
    ]);
    assert.deepEqual(at("2026-11-16T00:39:00Z"), ["hourly:ea:2026-11-16T00"]);
    assert.deepEqual(at("2026-11-02T01:30:00Z"), [
      "hourly:ea:2026-11-02T01",
      "compact:ea:2026-11-02",
      "lists:ea:2026-11",
    ]);
    // Three days on, a source that moved since waits for next month's.
    assert.ok(!at("2026-11-05T01:30:00Z").includes("lists:ea:2026-11"));
  });

  it("runs the shared Monthly script, in the source's lane", () => {
    const lists = due(new Date("2026-11-02T02:00:00Z"), phases).find((p) => p.kind === "lists:ea");
    assert.deepEqual(lists?.command, ["scripts/monthly.sh", "lists", "ea", "--full"]);
    assert.equal(lists?.lane, "store-ea");
    assert.deepEqual(refreshFor("ea", new Date("2026-11-16T09:00:00Z")).command, [
      "scripts/monthly.sh",
      "lists",
      "ea",
    ]);
  });
});

describe("actions", () => {
  const job = (name: string, status = "in_progress") => ({ name, status });
  it("reads which sources a run may still write", () => {
    assert.deepEqual(
      writing("ingest.yml", { id: 1, display_title: "Ingest backfill ea all 2020 2027" }, []),
      ["ea"],
    );
    assert.deepEqual(writing("ingest.yml", { id: 1, display_title: "Ingest publish" }, []), []);
    // A re-run of one from before run-name names its arguments nowhere.
    assert.deepEqual(writing("ingest.yml", { id: 1, display_title: "Ingest" }, []), [ALL]);
    assert.deepEqual(
      writing("ingest-hourly.yml", { id: 1, display_title: "Ingest hourly" }, [
        job("gate", "completed"),
        job("recent (ea)"),
        job("recent (bom)", "completed"),
      ]),
      ["ea"],
    );
    // Before its matrix expands, a run may write any source.
    assert.deepEqual(writing("monthly.yml", { id: 1, display_title: "Monthly" }, [job("plan")]), [
      ALL,
    ]);
  });
});

describe("job service", () => {
  it("declares nothing below a service's loop, which never returns", () => {
    for (const [file, loopStart] of [
      ["server/jobs.ts", "while (!stopping)"],
      ["server/ingest.ts", "await Promise.all(["],
    ]) {
      const lines = readFileSync(file, "utf8").split("\n");
      const loop = lines.findIndex((l) => l.startsWith(loopStart));
      assert.ok(loop > 0, file);
      assert.deepEqual(
        lines.slice(loop).filter((l) => /^(export )?(let|const|var|class|enum) /.test(l)),
        [],
        file,
      );
    }
  });
});

describe("workflows", () => {
  it("runs the ownership guard before every job that writes one source does anything", () => {
    for (const [file, job] of [
      ["ingest-hourly.yml", "recent"],
      ["compact-daily.yml", "compact"],
      ["monthly.yml", "lists"],
      ["monthly.yml", "refetch"],
      ["ingest.yml", "ingest"],
    ]) {
      const steps: { run?: string }[] = parse(readFileSync(`.github/workflows/${file}`, "utf8"))
        .jobs[job].steps;
      const guard = steps.findIndex((s) => s.run?.includes("scripts/server-owns.sh"));
      const first = steps.findIndex(
        (s) => /ingest\.ts|monthly\.sh/.test(s.run ?? "") && !s.run?.includes("server-owns"),
      );
      assert.ok(guard >= 0 && guard < first, `${file} ${job}`);
    }
  });
});

describe("units", () => {
  it("gives a job the write store on its command, where the env file can't override it", () => {
    const db = openQueue(":memory:");
    const job = enqueue(db, {
      command: ["scripts/monthly.sh", "lists", "ea"],
      lane: "store-ea",
      timeout: 360,
    })!;
    const args = runArgs(job, "/opt/stillwell-releases/r1", "s3://water-levels", 4 * 2 ** 30);
    const envAt = args.indexOf("/usr/bin/env");
    assert.ok(args.indexOf("--property=EnvironmentFile=/etc/stillwell.env") < envAt);
    assert.ok(args.slice(envAt).includes("STILLWELL_STORE=s3://water-levels"));
    assert.ok(!args.some((a) => a.startsWith("--property=Environment=")));
    assert.ok(args.slice(envAt).includes(`PATH=/opt/node/bin:/usr/bin:/bin`));
    assert.deepEqual(args.slice(-4), [
      "/bin/bash",
      "/opt/stillwell-releases/r1/scripts/monthly.sh",
      "lists",
      "ea",
    ]);
    assert.equal(NODE, "/opt/node/bin/node");
  });

  const show = (props: Record<string, string>) =>
    Object.entries({ LoadState: "loaded", ...props })
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
  it("reads how a job's unit ended, and nothing while it runs or stops", () => {
    assert.equal(endedFrom(show({ ActiveState: "active", SubState: "running" })), null);
    assert.equal(
      endedFrom(
        show({
          ActiveState: "deactivating",
          SubState: "stop-sigterm",
          Result: "success",
          ExecMainStatus: "0",
        }),
      ),
      null,
    );
    assert.deepEqual(
      endedFrom(
        show({ ActiveState: "active", SubState: "exited", Result: "success", ExecMainStatus: "0" }),
      ),
      { ok: true, result: "exit 0" },
    );
    assert.deepEqual(
      endedFrom(
        show({
          ActiveState: "failed",
          SubState: "failed",
          Result: "exit-code",
          ExecMainStatus: "1",
        }),
      ),
      { ok: false, result: "exit-code, exit 1" },
    );
    assert.deepEqual(
      endedFrom(
        show({ ActiveState: "failed", SubState: "failed", Result: "timeout", ExecMainStatus: "0" }),
      ),
      { ok: false, result: "stopped at its timeout" },
    );
    assert.deepEqual(endedFrom("LoadState=not-found\nActiveState=inactive"), {
      ok: false,
      result: "its unit is gone",
    });
  });
});

describe("queue", () => {
  const job = (args: string, key?: string) => ({
    command: ["scripts/ingest.ts", ...words(args)],
    lane: laneOf(words(args)),
    timeout: 60,
    key,
  });

  it("starts one job per lane, oldest first, up to the slots", () => {
    const db = openQueue(":memory:");
    const a = enqueue(db, job("compact ea"))!;
    enqueue(db, job("requalify ea all 2020 2027"));
    const c = enqueue(db, job("compact bom"))!;
    const d = enqueue(db, job("compact rws"))!;
    const all = () => true;
    assert.deepEqual(
      startable(db, 2, all).map((j) => j.id),
      [a.id, c.id],
    );
    markStarted(db, a.id, "/opt/r1");
    assert.deepEqual(
      startable(db, 3, all).map((j) => j.id),
      [c.id, d.id],
    );
    // A job the server doesn't run yet holds its lane's later jobs, not other lanes'.
    enqueue(db, job("compact bom --days 6"));
    assert.deepEqual(
      startable(db, 3, (j) => j.id !== c.id).map((j) => j.id),
      [d.id],
    );
  });

  it("keeps a slot for short jobs while long ones run", () => {
    const db = openQueue(":memory:");
    const long = (args: string) => ({ ...job(args), timeout: 360 });
    const a = enqueue(db, long("backfill ea all 2020 2027"))!;
    const b = enqueue(db, long("backfill bom all 2020 2027"))!;
    enqueue(db, long("backfill rws all 2020 2027"));
    const d = enqueue(db, job("recent smhi --hours 12"))!;
    assert.deepEqual(
      startable(db, 3, () => true, 2).map((j) => j.id),
      [d.id, a.id, b.id],
    );
  });

  it("lets a short job start ahead of a long one in its lane that waits for a long slot", () => {
    const db = openQueue(":memory:");
    const long = (args: string) => ({ ...job(args), timeout: 360 });
    enqueue(db, long("backfill ea all 2020 2027"));
    enqueue(db, long("backfill bom all 2020 2027"));
    markStarted(db, 1, "/opt/r1");
    markStarted(db, 2, "/opt/r1");
    enqueue(db, long("requalify rws all 2020 2027"));
    const hourly = enqueue(db, job("recent rws --hours 12"))!;
    assert.deepEqual(
      startable(db, 3, () => true, 2).map((j) => j.id),
      [hourly.id],
    );
  });

  it("starts a lane's hourly run before a row of long jobs queued ahead of it", () => {
    const db = openQueue(":memory:");
    const long = (args: string) => ({ ...job(args), timeout: 360 });
    enqueue(db, long("backfill usgs all 2026 2027 --shard 2/3"));
    enqueue(db, long("backfill usgs all 2026 2027 --shard 3/3"));
    const hourly = enqueue(db, job("recent usgs --hours 12"))!;
    assert.deepEqual(
      startable(db, 3, () => true, 2).map((j) => j.id),
      [hourly.id],
    );
  });

  it("cancels the waiting jobs of a source that left the server", () => {
    const db = openQueue(":memory:");
    const a = enqueue(db, job("compact ea"))!;
    const b = enqueue(db, job("compact bom"))!;
    assert.deepEqual(
      cancelQueuedUnless(db, (j) => j.lane !== "store-ea", "its source left the server").map(
        (j) => j.id,
      ),
      [a.id],
    );
    assert.equal(getJob(db, a.id)?.result, "its source left the server");
    assert.equal(getJob(db, b.id)?.state, "queued");
  });

  it("starts the oldest jobs however many wait, and counts them all", () => {
    const db = openQueue(":memory:");
    for (let i = 0; i < 1100; i++) enqueue(db, job(`compact s${i}`), new Date(NOW.getTime() + i));
    assert.deepEqual(
      startable(db, 2, () => true).map((j) => j.id),
      [1, 2],
    );
    assert.deepEqual(counts(db), { failed: 0, queued: 1100, oldestQueued: NOW.toISOString() });
  });

  it("queues a keyed job once, and never starts one cancelled after it was picked", () => {
    const db = openQueue(":memory:");
    const a = enqueue(db, job("compact ea", "compact:ea:2026-11-16"))!;
    assert.equal(enqueue(db, job("compact ea", "compact:ea:2026-11-16")), null);
    assert.equal(cancel(db, a.id), "cancelled");
    assert.equal(markStarted(db, a.id, "/opt/r1"), false);
    assert.equal(getJob(db, a.id)?.state, "cancelled");
  });

  it("keeps a running job's lane while it's cancelled, and how it ended once it has", () => {
    const db = openQueue(":memory:");
    const a = enqueue(db, job("compact ea"))!;
    const b = enqueue(db, job("compact ea --days 6"))!;
    assert.equal(markStarted(db, a.id, "/opt/r1"), true);
    assert.equal(cancel(db, a.id), "cancelling");
    assert.deepEqual(
      startable(db, 2, () => true),
      [],
    );
    markEnded(db, a.id, "cancelled", "stopped by hand");
    // A tick that read the unit before the cancel doesn't turn it into a failure.
    markEnded(db, a.id, "failed", "signal");
    assert.equal(getJob(db, a.id)?.state, "cancelled");
    assert.equal(cancel(db, a.id), null);
    assert.deepEqual(
      startable(db, 2, () => true).map((j) => j.id),
      [b.id],
    );
  });
});

describe("advance", () => {
  const all = () => true;
  const fresh = (base: string | null = "") => {
    const db = openQueue(":memory:");
    if (base !== null) setBaseline(db, base, []);
    return db;
  };
  const finish = (db: ReturnType<typeof openQueue>, id: number, ok = true) => {
    markStarted(db, id, "/opt/r1");
    markEnded(db, id, ok ? "succeeded" : "failed", ok ? "exit 0" : "failed, exit 1");
  };

  it("runs none without a baseline", () => {
    const db = fresh(null);
    assert.match(
      advance(db, [["20261116-a", steps({ check: "c", verify: ok })]], NOW, all) ?? "",
      /no baseline/,
    );
    assert.equal(baseline(db), null);
    assert.deepEqual(jobs(db, ["queued"]), []);
  });

  it("runs one step of one migration at a time, in order, to the end", () => {
    const db = fresh();
    const migrations: [string, Migration][] = [
      ["20261116-a", steps({ ingest: "compact ea" }, { check: "c", verify: ok })],
      ["20261117-b", steps({ ingest: "compact bom" })],
    ];
    assert.match(advance(db, migrations, NOW, all) ?? "", /20261116-a waits on job 1/);
    assert.deepEqual(
      jobs(db, ["queued"]).map((j) => j.command),
      [["scripts/ingest.ts", "compact", "ea"]],
    );
    finish(db, 1);
    advance(db, migrations, NOW, all);
    assert.deepEqual(getJob(db, 2)?.command, ["server/check.ts", "20261116-a", "1"]);
    assert.equal(getJob(db, 2)?.lane, "check");
    finish(db, 2);
    assert.match(advance(db, migrations, NOW, all) ?? "", /20261117-b waits on job 3/);
    finish(db, 3);
    assert.equal(advance(db, migrations, NOW, all), null);
    assert.deepEqual(
      migrationRows(db).map((r) => [r.id, r.state]),
      [
        ["20261116-a", "done"],
        ["20261117-b", "done"],
      ],
    );
  });

  it("waits at a step in a lane the server doesn't run yet", () => {
    const db = fresh();
    const stopped = advance(
      db,
      [["20261116-a", steps({ ingest: "compact ea" })]],
      NOW,
      (lane) => lane !== "store-ea",
    );
    assert.match(stopped ?? "", /waits for the server to run store-ea/);
    assert.deepEqual(jobs(db, ["queued"]), []);
  });

  it("stops at a failed step until retried, then runs it again", () => {
    const db = fresh();
    const migrations: [string, Migration][] = [
      ["20261116-a", steps({ ingest: "compact ea" })],
      ["20261117-b", steps({ ingest: "compact bom" })],
    ];
    advance(db, migrations, NOW, all);
    finish(db, 1, false);
    assert.match(advance(db, migrations, NOW, all) ?? "", /20261116-a failed: job 1 failed/);
    assert.match(advance(db, migrations, NOW, all) ?? "", /20261116-a failed/);
    assert.equal(jobs(db, ["queued"]).length, 0);
    retry(db, "20261116-a", NOW);
    assert.match(advance(db, migrations, NOW, all) ?? "", /20261116-a waits on job 2/);
    assert.throws(() => retry(db, "20261116-a"), /hasn't failed/);
  });

  it("doesn't run or record a migration that sorts before one already started", () => {
    const db = fresh();
    advance(db, [["20261120-first", steps({ ingest: "compact ea" })]], NOW, all);
    const late: [string, Migration][] = [
      ["20261110-late", steps({ ingest: "compact bom" })],
      ["20261120-first", steps({ ingest: "compact ea" })],
    ];
    assert.match(advance(db, late, NOW, all) ?? "", /20261110-late sorts before 20261120-first/);
    assert.deepEqual(
      migrationRows(db).map((r) => r.id),
      ["20261120-first"],
    );
  });

  it("marks done the migrations up to the baseline, and catches one merged after with an earlier name", () => {
    const db = openQueue(":memory:");
    setBaseline(db, "20261116-a", ["20261110-z", "20261116-a", "20261117-b"], NOW);
    const migrations: [string, Migration][] = [
      ["20261110-z", steps({ ingest: "compact rws" })],
      ["20261116-a", steps({ ingest: "compact ea" })],
      ["20261117-b", steps({ ingest: "compact bom" })],
    ];
    advance(db, migrations, NOW, all);
    assert.deepEqual(
      jobs(db, ["queued"]).map((j) => j.lane),
      ["store-bom"],
    );
    const later: [string, Migration][] = [
      ["20261112-y", steps({ ingest: "compact smhi" })],
      ...migrations,
    ];
    assert.match(advance(db, later, NOW, all) ?? "", /20261112-y sorts before/);
  });

  it("waits on a step whose job is being cancelled, and marks a failed migration done when skipped", () => {
    const db = fresh();
    const migrations: [string, Migration][] = [
      ["20261116-a", steps({ ingest: "compact ea" }, { ingest: "compact ea --days 6" })],
    ];
    advance(db, migrations, NOW, all);
    markStarted(db, 1, "/opt/r1");
    cancel(db, 1);
    assert.match(advance(db, migrations, NOW, all) ?? "", /waits on job 1/);
    markEnded(db, 1, "cancelled", "stopped by hand");
    assert.match(advance(db, migrations, NOW, all) ?? "", /failed: job 1 cancelled/);
    skip(db, "20261116-a", NOW);
    assert.equal(advance(db, migrations, NOW, all), null);
    assert.match(migrationRows(db)[0].error ?? "", /^skipped by hand: /);
  });

  it("tells a stop someone must fix from a wait on a job", () => {
    assert.equal(stuck(null), false);
    assert.equal(stuck("20261116-a waits on job 3"), false);
    for (const stopped of [
      "20261116-a failed: job 1 failed",
      "20261110-a sorts before 20261120-b, which has started",
      "20261116-a waits for the server to run store-ea",
      "no baseline: run it",
      "migrations can't load: bad name",
    ])
      assert.equal(stuck(stopped), true, stopped);
  });

  it("fails a migration that can't run unattended", () => {
    const db = fresh();
    assert.match(
      advance(db, [["20261116-a", steps({ ingest: "teleport ea" })]], NOW, all) ?? "",
      /20261116-a failed: .*not a command/,
    );
  });
});
