import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { problems } from "../src/jobs/migrations.ts";
import migration from "../src/migrations/20261124-usace-longitude-sign.ts";
import { POSITIONS } from "../src/positions.ts";

describe("the USACE longitude-sign migration", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "usace-sign-"));
  });
  afterEach(() => rm(store, { recursive: true, force: true }));

  it("is a migration the workflow can run", () => {
    assert.deepEqual(problems(migration), []);
  });

  it("names the three stations POSITIONS moves", () => {
    for (const id of [
      "usace/MVK.Pine_Bluff",
      "usace/LRL.BuckCreek",
      "usace/LRH.PleasantHill-Outflow",
    ])
      assert.ok(POSITIONS[id]!.at.lon < 0 && POSITIONS[id]!.served.lon > 0, id);
  });

  it("fails its check while the store lists none of them", async () => {
    const check = migration.steps.find((s) => "check" in s);
    assert.ok(check && "verify" in check);
    await assert.rejects(async () => check.verify!(store));
  });
});
