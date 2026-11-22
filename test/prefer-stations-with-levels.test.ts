import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import migration from "../src/migrations/20261120-prefer-stations-with-levels.ts";
import { writeRows } from "../src/store/parquet.ts";
import { stationsPath } from "../src/store/paths.ts";

const GROUP = ["dwr/B95580", "coops/9415105", "gesla/venice_island-vne-usa-cdwr"];

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "prefer-levels-"));
});
afterEach(() => rm(store, { recursive: true, force: true }));

type Row = { id: string; preferred: string; first: string | null; same_as: string[] };
const write = (rows: Row[]) =>
  writeRows(
    stationsPath(store),
    rows,
    {
      id: "VARCHAR",
      preferred: "VARCHAR",
      first: "VARCHAR",
      last: "VARCHAR",
      same_as: "VARCHAR[]",
    },
    "id",
  );
const group = (change: (r: Row) => Row = (r) => r): Row[] =>
  GROUP.map((id) =>
    change({
      id,
      preferred: "coops/9415105",
      first: id === "dwr/B95580" ? null : "2000-01-01",
      same_as: GROUP.filter((g) => g !== id),
    }),
  ).map((r) => ({ ...r, last: r.first }) as Row);
const verify = async () => {
  const check = migration.steps.find((s) => "check" in s)!;
  await ("verify" in check ? check.verify?.(store) : undefined);
};

describe("20261120-prefer-stations-with-levels", () => {
  it("passes when the whole group prefers a station holding levels", async () => {
    await write(group());
    await verify();
  });

  it("fails on a preferred station with no levels, a member preferring another or missing, or no group", async () => {
    await write(group((r) => ({ ...r, preferred: "dwr/B95580" })));
    await assert.rejects(verify, /holds no levels/);
    await write(group((r) => (r.id === GROUP[2] ? { ...r, preferred: GROUP[2] } : r)));
    await assert.rejects(verify, /prefers another station/);
    await write(group((r) => ({ ...r, same_as: [] })));
    await assert.rejects(verify, /in no group/);
    await write(group((r) => ({ ...r, same_as: [...r.same_as, "coops/0"] })));
    await assert.rejects(verify, /coops\/0, in dwr\/B95580's group, isn't listed/);
  });
});
