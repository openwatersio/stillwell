import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deleteYears } from "../src/delete-years.ts";
import { problems, type Migration } from "../src/jobs/migrations.ts";
import migration from "../src/migrations/20261121-usace-placeholder-years.ts";
import { Flag, type Observation } from "../src/schema.ts";
import { writeObservations, writeRows, writeStationBounds } from "../src/store/parquet.ts";
import { boundsPath, seriesPath, stationsPath } from "../src/store/paths.ts";
import { reconcileYears } from "../src/store/years.ts";
import { removePrefixes } from "../src/withhold.ts";

const HOUR = 3_600_000;
const FILES: Record<string, number[]> = {
  "LRN.CTHT1-CumberlandR-CarthageTN": [1984, 1985, 1986],
  "MVS.Bethany-Marrowbone_Cr": [2025, 2026],
  "MVS.Chesterville-Kaskaskia": [2025, 2026],
  "MVS.Sullivan-Jonathan_Cr": [2025, 2026],
  "MVS.Greenville-St_Francis": [2026],
};
// Each station's other years, with readings.
const KEPT: Record<string, number[]> = {
  "LRN.CTHT1-CumberlandR-CarthageTN": [1982, 1987, 2026],
  "MVS.Bethany-Marrowbone_Cr": [2022, 2024],
  "MVS.Chesterville-Kaskaskia": [1995, 2024],
  "MVS.Sullivan-Jonathan_Cr": [2022, 2024],
  "MVS.Greenville-St_Francis": [2020, 2025],
};

const rows = (year: number, flag: Flag, level: number): Observation[] =>
  Array.from({ length: 3 }, (_, i) => ({ time: Date.UTC(year, 5, 1) + i * HOUR, level, flag }));
const iso = (t: number) => new Date(t).toISOString().slice(0, 19) + "Z";

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "usace-placeholder-"));
});
afterEach(() => rm(store, { recursive: true, force: true }));

const file = (id: string, year: number) => seriesPath(store, "levels", "usace", id, year);
const verify = async () => {
  const check = migration.steps.find((s) => "check" in s)!;
  await ("verify" in check ? check.verify(store) : undefined);
};

/** The store as the steps leave it: the ten deleted, bounds and stations rebuilt from what remains. */
async function afterSteps(missing = (id: string) => FILES[id]!): Promise<void> {
  for (const [id, years] of Object.entries(FILES)) {
    for (const y of years)
      await writeObservations(file(id, y), rows(y, Flag.bad, 30479.695), "NGVD29");
    for (const y of KEPT[id]!)
      await writeObservations(file(id, y), rows(y, Flag.preliminary, 2), "NGVD29");
  }
  await reconcileYears(store, "usace", { start: true });
  for (const [id, years] of Object.entries(FILES))
    await deleteYears(store, "usace", id, 1, years, removePrefixes);
  await writeStationBounds(
    boundsPath(store, "usace"),
    Object.entries(KEPT).map(([id, years]) => ({
      id: `usace/${id}`,
      first: iso(rows(Math.min(...years), Flag.good, 0)[0]!.time),
      last: iso(rows(Math.max(...years), Flag.good, 0)[2]!.time),
      preliminary: null,
      screened: false,
    })),
    true,
  );
  await writeRows(
    stationsPath(store),
    Object.keys(FILES).map((id) => ({ id: `usace/${id}`, missing_years: missing(id) })),
    { id: "VARCHAR", missing_years: "INTEGER[]" },
    "id",
  );
}

describe("20261121-usace-placeholder-years", () => {
  it("is a migration a step can run", () => {
    assert.deepEqual(problems(migration as Migration), []);
  });

  it("passes on a store the steps left", async () => {
    await afterSteps();
    await verify();
  });

  it("fails while a placeholder file stands", async () => {
    await afterSteps();
    await writeObservations(
      file("MVS.Bethany-Marrowbone_Cr", 2025),
      rows(2025, Flag.bad, 30479.695),
      "NGVD29",
    );
    await assert.rejects(verify, /still holds only placeholders/);
  });

  it("fails when a deleted year isn't missing", async () => {
    await afterSteps((id) => (id.startsWith("MVS.Bethany") ? [2026] : FILES[id]!));
    await assert.rejects(verify, /2025 has no file and isn't in missing_years/);
  });

  it("fails when a publish left a station's missing_years null", async () => {
    await afterSteps();
    await writeRows(
      stationsPath(store),
      Object.keys(FILES).map((id) => ({ id: `usace/${id}`, missing_years: null })),
      { id: "VARCHAR", missing_years: "INTEGER[]" },
      "id",
    );
    await assert.rejects(verify, /missing_years is null/);
  });

  it("fails when the bounds still reach a deleted file", async () => {
    await afterSteps();
    await writeStationBounds(
      boundsPath(store, "usace"),
      Object.keys(KEPT).map((id) => ({
        id: `usace/${id}`,
        first: "1982-06-01T00:00:00Z",
        last: "2026-06-01T02:00:00Z",
        preliminary: null,
        screened: false,
      })),
      true,
    );
    await assert.rejects(verify, /bounds/);
  });
});
