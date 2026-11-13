import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
