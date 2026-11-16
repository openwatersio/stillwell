import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Flag, type Epoch, type StoredStation } from "../src/schema.ts";
import { misplaced, seriesFileKey } from "../src/store/misplaced.ts";
import { readObservations, writeObservations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import { readYears, writeYears } from "../src/store/years.ts";
import { removePrefixes } from "../src/withhold.ts";

const epoch = (id: number, since: string | null, until: string | null): Epoch =>
  ({
    id,
    datum: "NAP",
    since,
    until,
    state: until ? "closed" : "open",
    reference: null,
    reference_since: null,
    datums: {},
    to_current: null,
    seen: "2026-11-06T00:00:00Z",
  }) as Epoch;

// RWS's kampen.ijssel: epoch 1 ends at the 2005 NAP revision, after compaction had put 2026-11-05 in its files.
const kampen = {
  id: "rws/kampen.ijssel",
  source: "rws",
  source_id: "kampen.ijssel",
  epochs: [epoch(1, null, "2005-01-01T00:00:00Z"), epoch(2, "2005-01-01T00:00:00Z", null)],
} as unknown as StoredStation;

const at = (iso: string, level: number) => ({
  time: Date.parse(iso),
  level,
  flag: Flag.preliminary,
});

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "misplaced-"));
});
afterEach(() => rm(store, { recursive: true, force: true }));

describe("misplaced", () => {
  it("reads a series file's product, station, epoch and year", () => {
    assert.deepEqual(seriesFileKey("rws", `${store}/obs/rws/kampen.ijssel/2026.parquet`), {
      product: "levels",
      sourceId: "kampen.ijssel",
      epoch: 1,
      year: 2026,
    });
    assert.deepEqual(
      seriesFileKey("rws", `${store}/predicted-extremes/rws/kampen.ijssel/2/2026.parquet`),
      { product: "predicted_extremes", sourceId: "kampen.ijssel", epoch: 2, year: 2026 },
    );
    // A station named like its source is still read by its own directory.
    assert.deepEqual(seriesFileKey("rws", `${store}/obs/rws/rws/2/2026.parquet`), {
      product: "levels",
      sourceId: "rws",
      epoch: 2,
      year: 2026,
    });
  });

  it("drops rows a closed epoch's files hold past its end where the next epoch has them", async () => {
    const file = (year: number, e: number) =>
      seriesPath(store, "levels", "rws", "kampen.ijssel", year, e);
    // Epoch 2 has every time, one with RWS's later, revised level.
    await writeObservations(
      file(2026, 2),
      [at("2026-11-05T07:50:00Z", -0.1), at("2026-11-05T23:30:00Z", 1.05)],
      "NAP",
    );
    await writeObservations(
      file(2026, 1),
      [at("2026-11-05T07:50:00Z", -0.1), at("2026-11-05T23:30:00Z", 1.07)],
      "NAP",
    );
    // Epoch 1's own years stay as they are.
    await writeObservations(file(2004, 1), [at("2004-12-31T23:50:00Z", 0.2)], "NAP");
    await writeYears(store, "rws", []);

    const dry = await misplaced(store, "rws", [kampen], removePrefixes, { dryRun: true });
    assert.deepEqual(
      dry.files.map((f) => [f.year, f.epoch, f.dropped, f.kept.length, f.emptied]),
      [[2026, 1, 2, 0, true]],
    );
    assert.ok(existsSync(file(2026, 1)), "a dry run changes nothing");

    await writeObservations(file(2005, 1), [at("2005-01-01T00:00:00Z", 0.3)], "NAP");
    await writeObservations(file(2005, 2), [at("2005-01-01T00:00:00Z", 0.3)], "NAP");
    const { files } = await misplaced(store, "rws", [kampen], removePrefixes);
    assert.deepEqual(
      files.map((f) => [f.year, f.epoch, f.dropped, f.kept.length, f.emptied]),
      [
        [2005, 1, 1, 0, true],
        [2026, 1, 2, 0, true],
      ],
    );
    assert.ok(!existsSync(file(2026, 1)));
    assert.ok(!existsSync(file(2005, 1)));
    // Epoch 2's files and epoch 1's own years stay as they were.
    assert.deepEqual(
      (await readObservations(file(2026, 2))).map((r) => r.level),
      [-0.1, 1.05],
    );
    assert.equal((await readObservations(file(2004, 1))).length, 1);
    // The years file follows the files.
    const years = [...(await readYears(store, "rws"))!.values()].map((r) => [r.epoch, r.year]);
    assert.ok(!years.some(([e, y]) => e === 1 && y! >= 2005), JSON.stringify(years));
  });

  it("keeps a row the right epoch lacks, and one in no epoch's span", async () => {
    const station = {
      ...kampen,
      epochs: [epoch(1, null, "2020-03-05T00:00:00Z"), epoch(2, "2020-03-06T00:00:00Z", null)],
    } as StoredStation;
    const file = (e: number) => seriesPath(store, "levels", "rws", "kampen.ijssel", 2020, e);
    await writeObservations(
      file(1),
      [
        at("2020-03-04T23:00:00Z", 0.1),
        at("2020-03-05T23:00:00Z", 0.2),
        at("2020-03-07T00:00:00Z", 0.3),
        at("2020-03-08T00:00:00Z", 0.4),
      ],
      "NAP",
    );
    await writeObservations(file(2), [at("2020-03-08T00:00:00Z", 0.4)], "NAP");
    const { files } = await misplaced(store, "rws", [station], removePrefixes);
    assert.deepEqual(
      files.map((f) => [f.dropped, f.kept.map((k) => [new Date(k.time).toISOString(), k.epoch])]),
      [
        [
          1,
          [
            ["2020-03-05T23:00:00.000Z", null],
            ["2020-03-07T00:00:00.000Z", 2],
          ],
        ],
      ],
    );
    assert.deepEqual(
      (await readObservations(file(1))).map((r) => r.level),
      [0.1, 0.2, 0.3],
    );
  });

  it("reads only a station's own files where its ID holds a glob character", async () => {
    // `a*` would glob `ab`'s file, which holds the time `a*`'s epoch 2 lacks.
    const glob = { ...kampen, id: "rws/a*", source_id: "a*" } as StoredStation;
    const sibling = { ...kampen, id: "rws/ab", source_id: "ab" } as StoredStation;
    const time = "2026-11-05T07:50:00Z";
    await writeObservations(
      seriesPath(store, "levels", "rws", "a*", 2026, 1),
      [at(time, 1)],
      "NAP",
    );
    await writeObservations(seriesPath(store, "levels", "rws", "a*", 2026, 2), [], "NAP");
    await writeObservations(
      seriesPath(store, "levels", "rws", "ab", 2026, 2),
      [at(time, 1)],
      "NAP",
    );
    const { files } = await misplaced(store, "rws", [glob, sibling], removePrefixes);
    assert.deepEqual(
      files.map((f) => [f.id, f.dropped, f.kept.length]),
      [["rws/a*", 0, 1]],
    );
    assert.equal(
      (await readObservations(seriesPath(store, "levels", "rws", "a*", 2026, 1))).length,
      1,
    );
  });

  it("drops a year of minutes from a file and keeps the rest", async () => {
    const station = {
      ...kampen,
      epochs: [epoch(1, null, "2026-07-01T00:00:00Z"), epoch(2, "2026-07-01T00:00:00Z", null)],
    } as StoredStation;
    const minutes = (from: string, to: string) => {
      const rows = [];
      for (let t = Date.parse(from); t < Date.parse(to); t += 60_000)
        rows.push({ time: t, level: 0.1, flag: Flag.good });
      return rows;
    };
    const file = (e: number) => seriesPath(store, "levels", "rws", "kampen.ijssel", 2026, e);
    await writeObservations(
      file(1),
      minutes("2026-06-01T00:00:00Z", "2026-12-01T00:00:00Z"),
      "NAP",
    );
    await writeObservations(
      file(2),
      minutes("2026-07-01T00:00:00Z", "2026-12-01T00:00:00Z"),
      "NAP",
    );
    const { files } = await misplaced(store, "rws", [station], removePrefixes);
    assert.equal(files[0]!.dropped, 220_320);
    const left = await readObservations(file(1));
    assert.equal(left.length, 43_200);
    assert.equal(new Date(left.at(-1)!.time).toISOString(), "2026-06-30T23:59:00.000Z");
  });
});
