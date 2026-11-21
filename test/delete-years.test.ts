import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { deleteYears } from "../src/delete-years.ts";
import { Flag, type Observation } from "../src/schema.ts";
import { writeObservations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import { readYears, reconcileYears } from "../src/store/years.ts";
import { removePrefixes } from "../src/withhold.ts";

const HOUR = 3_600_000;
const rows = (year: number, flag: Flag, level: number): Observation[] =>
  Array.from({ length: 4 }, (_, i) => ({ time: Date.UTC(year, 0, 1) + i * HOUR, level, flag }));

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "delete-years-"));
});
afterEach(() => rm(store, { recursive: true, force: true }));

const file = (id: string, year: number, epoch = 1) =>
  seriesPath(store, "levels", "usace", id, year, epoch);

/** Station `a` with bad placeholders in 2025 and 2026 and readings in 2024; `b` with placeholders in 2025. */
async function seed(): Promise<void> {
  await writeObservations(file("a", 2024), rows(2024, Flag.preliminary, 1.5), "NGVD29");
  await writeObservations(file("a", 2025), rows(2025, Flag.bad, 30479.695), "NGVD29");
  await writeObservations(file("a", 2026), rows(2026, Flag.bad, 30479.695), "NGVD29");
  await writeObservations(file("b", 2025), rows(2025, Flag.bad, 30479.695), "NGVD29");
  await reconcileYears(store, "usace", { start: true });
}

describe("deleteYears", () => {
  it("deletes the named files and their years rows, and no other", async () => {
    await seed();
    const done = await deleteYears(store, "usace", "a", 1, [2026, 2025], removePrefixes);
    assert.deepEqual(done.files, [file("a", 2025), file("a", 2026)]);
    assert.equal(done.rows, 8);
    assert.equal(existsSync(file("a", 2025)), false);
    assert.equal(existsSync(file("a", 2026)), false);
    assert.equal(existsSync(file("a", 2024)), true);
    assert.equal(existsSync(file("b", 2025)), true);
    const left = [...(await readYears(store, "usace"))!.keys()].sort();
    assert.deepEqual(left, ["usace/a 1 2024", "usace/b 1 2025"]);
  });

  it("leaves the years file as reconcile would find it", async () => {
    await seed();
    await deleteYears(store, "usace", "a", 1, [2025], removePrefixes);
    const had = [...(await readYears(store, "usace"))!.values()];
    await reconcileYears(store, "usace", { rebuild: true });
    assert.deepEqual([...(await readYears(store, "usace"))!.values()], had);
  });

  it("deletes nothing when any year holds a value not flagged bad", async () => {
    await seed();
    await assert.rejects(
      deleteYears(store, "usace", "a", 1, [2025, 2024], removePrefixes),
      /holds 4 of 4 values that aren't flagged bad or lie inside the span/,
    );
    assert.equal(existsSync(file("a", 2025)), true);
    assert.equal((await readYears(store, "usace"))!.size, 4);
  });

  it("refuses a bad value inside the span, since it may be a reading", async () => {
    await seed();
    await writeObservations(
      file("a", 2026),
      [
        ...rows(2026, Flag.bad, 30479.695),
        { time: Date.UTC(2026, 1, 1), level: 2, flag: Flag.bad },
      ],
      "NGVD29",
    );
    await assert.rejects(
      deleteYears(store, "usace", "a", 1, [2025, 2026], removePrefixes),
      /holds 1 of 5 values/,
    );
    assert.equal(existsSync(file("a", 2025)), true);
  });

  it("finishes a run that stopped after deleting a file, and a year it has no file for", async () => {
    await seed();
    await rm(file("a", 2025));
    const done = await deleteYears(store, "usace", "a", 1, [2025, 2026, 2023], removePrefixes);
    assert.deepEqual(done.files, [file("a", 2026)]);
    assert.deepEqual(done.gone, [file("a", 2023), file("a", 2025)]);
    assert.deepEqual([...(await readYears(store, "usace"))!.keys()].sort(), [
      "usace/a 1 2024",
      "usace/b 1 2025",
    ]);
  });

  it("skips an epoch with no file, and refuses an ID with a wildcard", async () => {
    await seed();
    // A later epoch with no file is a run with nothing to do; it touches no file of epoch 1.
    const none = await deleteYears(store, "usace", "a", 2, [2025], removePrefixes);
    assert.deepEqual(none.files, []);
    assert.equal(existsSync(file("a", 2025)), true);
    await assert.rejects(deleteYears(store, "usace", "*", 1, [2025], removePrefixes), /Refusing/);
    await assert.rejects(deleteYears(store, "usace", "a", 0, [2025], removePrefixes), /epoch/);
    await assert.rejects(deleteYears(store, "usace", "a", 1, [], removePrefixes), /years/);
  });

  it("works for a source with no years file", async () => {
    await writeObservations(file("a", 2025), rows(2025, Flag.bad, 30479.695), "NGVD29");
    await deleteYears(store, "usace", "a", 1, [2025], removePrefixes);
    assert.equal(existsSync(file("a", 2025)), false);
    assert.equal(await readYears(store, "usace"), null);
  });

  it("deletes a later epoch's file", async () => {
    await writeObservations(file("a", 2025, 2), rows(2025, Flag.bad, 30479.695), "NGVD29");
    await writeObservations(file("a", 2025), rows(2025, Flag.good, 1), "NGVD29");
    await deleteYears(store, "usace", "a", 2, [2025], removePrefixes);
    assert.equal(existsSync(file("a", 2025, 2)), false);
    assert.equal(existsSync(file("a", 2025)), true);
  });
});
