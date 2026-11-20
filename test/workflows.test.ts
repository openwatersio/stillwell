import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parse } from "yaml";

type Step = { uses?: string; with?: Record<string, string> };

describe("publishing jobs", () => {
  // A run's own checkout can predate a source's registration, and publishing
  // from it would drop that source's stations from stations.parquet.
  for (const [file, job] of [
    ["monthly.yml", "publish"],
    ["compact-daily.yml", "publish"],
  ] as const)
    it(`${file} ${job} checks out main as it is when the job starts`, () => {
      const workflow = parse(readFileSync(`.github/workflows/${file}`, "utf8"));
      const steps: Step[] | undefined = workflow.jobs[job]?.steps;
      assert.ok(steps, `${file} has a ${job} job`);
      const checkouts = steps.filter((s) => s.uses?.startsWith("actions/checkout@"));
      assert.deepEqual(
        checkouts.map((s) => s.with?.ref),
        ["main"],
      );
    });
});

describe("Ingest", () => {
  it("checks out main as it is when the job starts for a publish only", () => {
    const workflow = parse(readFileSync(".github/workflows/ingest.yml", "utf8"));
    const steps: Step[] = workflow.jobs.ingest.steps;
    const checkouts = steps.filter((s) => s.uses?.startsWith("actions/checkout@"));
    assert.deepEqual(
      checkouts.map((s) => s.with?.ref),
      ["${{ inputs.args == 'publish' && 'main' || github.sha }}"],
    );
  });
});

describe("pruning the link and match files", () => {
  type Job = {
    if?: string;
    needs?: string[];
    concurrency?: { group: string; queue?: string };
    strategy?: { matrix: { command: string[] } };
    steps: { id?: string; run?: string; env?: Record<string, string> }[];
  };
  const jobs = (file: string): Record<string, Job> =>
    parse(readFileSync(`.github/workflows/${file}`, "utf8")).jobs;

  it("follows an Ingest withhold or drop, but not a dry run, with both prunes in their groups", () => {
    const { group, prune } = jobs("ingest.yml");
    const script = group!.steps.find((s) => s.id === "group")!.run!;
    const outputs = (args: string) => {
      const dir = mkdtempSync(join(tmpdir(), "ingest-group-"));
      try {
        const file = join(dir, "output");
        writeFileSync(file, "");
        const run = spawnSync("bash", ["-e", "-c", script], {
          encoding: "utf8",
          env: { ...process.env, ARGS: args, GITHUB_OUTPUT: file },
        });
        assert.equal(run.status, 0, run.stderr);
        return readFileSync(file, "utf8");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    assert.match(outputs("withhold gesla"), /^prune=true$/m);
    assert.match(outputs("drop gesla"), /^prune=true$/m);
    // withhold takes no --dry-run, and deletes either way.
    assert.match(outputs("withhold gesla --dry-run"), /^prune=true$/m);
    assert.doesNotMatch(outputs("drop gesla --dry-run"), /prune=/);
    assert.doesNotMatch(outputs("backfill gesla all 2020 2021"), /prune=/);
    assert.doesNotMatch(outputs("matches --concurrency 16"), /prune=/);
    assert.deepEqual(prune!.needs, ["group", "ingest"]);
    assert.equal(prune!.if, "needs.group.outputs.prune == 'true'");
    assert.deepEqual(prune!.strategy!.matrix.command, ["matches", "links"]);
    assert.equal(prune!.concurrency!.group, "${{ matrix.command }}");
    assert.equal(prune!.concurrency!.queue, "max");
    assert.match(prune!.steps.at(-1)!.run!, /ingest\.ts "\$COMMAND" --prune$/);
  });
});
