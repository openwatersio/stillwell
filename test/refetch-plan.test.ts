import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sourceOf, sources } from "../src/sources/index.ts";
import { planFor } from "../src/sources/schedule.ts";

const NOV_9 = new Date("2026-11-09T03:35:00Z");
const plan = (job: "lists" | "refetch", id: string, today = NOV_9) =>
  planFor(job, sourceOf(id), today);

describe("planFor", () => {
  it("refetches each station from its earliest preliminary value by default", async () => {
    assert.deepEqual(await plan("refetch", "coops"), [["preliminary", "2023", "2026-11-01"]]);
    assert.deepEqual(await plan("lists", "coops"), []);
  });

  it("takes a source's own runs from its schedule", async () => {
    assert.deepEqual(await plan("refetch", "usgs"), [
      ["preliminary", "2023", "2026", "--shard", "11/12"],
    ]);
    assert.deepEqual(await plan("refetch", "dwr"), [["all", "2025", "2026-11-09", "--refetch"]]);
    assert.deepEqual(await plan("refetch", "linz"), [
      ["all", "2026-09-01", "2026-12-01"],
      ["ROBT", "2025", "2026", "--refetch"],
      ["preliminary", "2023", "2026-12-01"],
    ]);
    assert.deepEqual(await plan("refetch", "cmems"), [
      ["all", "2026-05-01", "2026-12-01", "--with-inactive"],
    ]);
    assert.deepEqual(await plan("refetch", "cco"), [
      ["all", "2025-11-01", "2026-11-01", "--refetch"],
    ]);
    assert.deepEqual(await plan("refetch", "bodc"), [["all", "2024", "2027", "--refetch"]]);
    assert.deepEqual(await plan("refetch", "bom"), [["all", "2024", "2027", "--refetch"]]);
    assert.deepEqual(await plan("refetch", "jma"), [
      ["all", "2026-09-01", "2026-12-01"],
      ["preliminary", "2023", "2026-11-01"],
    ]);
    assert.deepEqual(await plan("refetch", "crms"), [
      ["all", "2024", "2027", "--refetch", "--with-inactive"],
    ]);
  });

  it("gives a refetch only to a source that finalizes, since only those refetch", () => {
    for (const [id, source] of Object.entries(sources))
      if (source.schedule?.refetch) assert.ok(source.metadata.finalizes, id);
  });

  it("refuses a refetch that plans no run", async () => {
    const source = { ...sourceOf("coops"), schedule: { refetch: () => [] } };
    await assert.rejects(planFor("refetch", source, NOV_9), /coops's refetch plans no run/);
  });

  it("skips unscreened stations but in January", async () => {
    assert.deepEqual(await plan("refetch", "usace"), [
      ["preliminary", "2023", "2026-11-01", "--skip-unscreened"],
    ]);
    assert.deepEqual(await plan("refetch", "refmar", new Date("2026-01-09Z")), [
      ["preliminary", "2023", "2026-01-01"],
    ]);
  });

  it("fetches BSH's next year's predictions from August", async () => {
    assert.deepEqual(await plan("lists", "bsh", new Date("2026-07-31Z")), [
      ["all", "2026", "2027"],
    ]);
    assert.deepEqual(await plan("lists", "bsh", new Date("2026-08-01Z")), [
      ["all", "2026", "2028"],
    ]);
  });
});

describe("scripts/monthly.sh", () => {
  // A `node` ahead of the real one on PATH that prints each ingest call, failing LINZ's Cape Roberts run.
  const shim = mkdtempSync(join(tmpdir(), "stillwell-monthly-"));
  writeFileSync(
    join(shim, "node"),
    `#!/bin/bash\ncase "$1" in */ingest.ts) echo "ingest \${*:2}"; [ "$4" = ROBT ] && exit 1; exit 0 ;; esac\nexec "${process.execPath}" "$@"\n`,
  );
  chmodSync(join(shim, "node"), 0o755);
  const run = (...args: string[]) =>
    spawnSync("bash", ["scripts/monthly.sh", ...args], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${shim}:${process.env.PATH}` },
    });

  it("runs each backfill the plan gives, the rest after one fails, and fails the step", () => {
    const linz = run("refetch", "linz");
    assert.deepEqual(
      linz.stdout
        .trim()
        .split("\n")
        .map((l) => l.split(" ").slice(0, 4).join(" ")),
      ["ingest backfill linz all", "ingest backfill linz ROBT", "ingest backfill linz preliminary"],
    );
    assert.equal(linz.status, 1);
  });

  it("runs nothing for a source with no list backfills", () => {
    const coops = run("list-backfills", "coops");
    assert.equal(coops.stdout, "");
    assert.equal(coops.status, 0);
    assert.match(run("list-backfills", "bsh").stdout, /^ingest backfill bsh all \d{4} \d{4}\n$/);
  });

  it("fits for at most two hours, and for none once the job has run five and a half", () => {
    const budget = (started: number) =>
      spawnSync("bash", ["scripts/monthly.sh", "fit", "smhi"], {
        encoding: "utf8",
        env: { ...process.env, PATH: `${shim}:${process.env.PATH}`, STARTED: String(started) },
      }).stdout.trim();
    const now = Math.floor(Date.now() / 1000);
    assert.equal(budget(now), "ingest fit smhi --budget 120 --only-fitted");
    // Four and a half hours in, an hour is left before none may start.
    assert.match(budget(now - 270 * 60), /^ingest fit smhi --budget (59|60) --only-fitted$/);
    assert.equal(budget(now - 340 * 60), "ingest fit smhi --budget 0 --only-fitted");
  });

  it("fails for a source it doesn't know", () => {
    assert.notEqual(run("refetch", "nope").status, 0);
  });
});
