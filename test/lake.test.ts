import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { mergeFetched, mergeRange, sameRows } from "../src/lake/merge.ts";
import {
  readDatums,
  readExtremes,
  readObservations,
  checkRecent,
  readRecent,
  writeExtremes,
  writeObservations,
  writeRecent,
  writeStations,
} from "../src/lake/parquet.ts";
import { seriesPath } from "../src/lake/paths.ts";
import { qc } from "../src/qc.ts";
import { Flag, type Observation, type Station } from "../src/schema.ts";

const root = mkdtempSync(join(tmpdir(), "water-levels-test-"));
const T = Date.UTC(2026, 0, 1);
const MIN = 60_000;

describe("lake files", () => {
  it("round-trips observations, with and without arrival times", async () => {
    const rows: Observation[] = [
      { time: T + 10 * MIN, level: 1.234, flag: Flag.preliminary, received: T + 12 * MIN },
      { time: T, level: -0.5, flag: Flag.good },
    ];
    const path = seriesPath(root, "levels", "test", "a/b", 2026);
    assert.match(path, /obs\/test\/a%2Fb\/2026\.parquet$/);
    await writeObservations(path, rows, "NAP");
    assert.deepEqual(await readObservations(path), [rows[1], rows[0]]);
    assert.deepEqual(await readDatums(path), ["NAP"]);
  });

  it("reads a missing file as an empty series, in no datum", async () => {
    assert.deepEqual(await readObservations(join(root, "missing.parquet")), []);
    assert.deepEqual(await readDatums(join(root, "missing.parquet")), []);
  });

  it("round-trips extremes with BSH's transit and event", async () => {
    const path = join(root, "extremes.parquet");
    const rows = [
      {
        time: T,
        level: 3.1,
        type: "high" as const,
        flag: Flag.good,
        transit: 26818,
        event: 1 as const,
      },
    ];
    await writeExtremes(path, rows, "PNP");
    assert.deepEqual(await readExtremes(path), rows);
    assert.deepEqual(await readDatums(path), ["PNP"]);
  });

  it("keeps the recent window sorted by station, then time", async () => {
    const path = join(root, "recent.parquet");
    await writeRecent(path, [
      [
        { station: "b", time: T, level: 1, flag: Flag.preliminary },
        { station: "a", time: T + MIN, level: 2, flag: Flag.preliminary, received: T + 2 * MIN },
        { station: "a", time: T, level: 3, flag: Flag.preliminary },
      ],
    ]);
    assert.deepEqual(
      (await readRecent(path)).map((r) => `${r.station}${r.time - T}`),
      ["a0", `a${MIN}`, "b0"],
    );
  });

  it("writes the recent window in batches, and reads back the stations asked for", async () => {
    const path = join(root, "recent-batches.parquet");
    async function* batches() {
      yield [{ station: "b", time: T, level: 1, flag: Flag.preliminary }];
      // Reading between batches, as ingest does, reads the file being replaced.
      assert.deepEqual(await readRecent(path, ["b"]), []);
      yield [{ station: "a", time: T, level: 2, flag: Flag.good }];
    }
    await writeRecent(path, batches());
    assert.deepEqual(
      (await readRecent(path, ["b", "c"])).map((r) => r.station),
      ["b"],
    );
    assert.equal((await readRecent(path)).length, 2);
    assert.deepEqual(await readRecent(path, []), []);
  });

  it("checks a whole recent window can be read, and passes a missing one", async () => {
    const path = join(root, "recent-check.parquet");
    await checkRecent(path);
    await writeRecent(path, [[{ station: "a", time: T, level: 1, flag: Flag.good }]]);
    await checkRecent(path);
    writeFileSync(path, "not parquet");
    await assert.rejects(checkRecent(path));
  });

  it("writes stations with datums, products and links", async () => {
    const station: Station = {
      id: "test:1",
      source: "test",
      source_id: "1",
      name: "One",
      lat: 1,
      lon: 2,
      country_code: "NL",
      kind: null,
      interval_s: 600,
      datum: "NAP",
      datums: { MSL: 0.1 },
      products: ["levels"],
      first: null,
      last: null,
      license: "CC0-1.0",
      commercial_use: true,
      attribution: "Test",
      tide_station: null,
      same_as: ["other:1"],
      status: "active",
      live: true,
      min_interval_s: 300,
      source_url: null,
    };
    await writeStations(join(root, "stations.parquet"), [station]);
  });
});

describe("mergeRange", () => {
  const old: Observation[] = [
    { time: T, level: 1, flag: Flag.preliminary, received: T + MIN },
    { time: T + 10 * MIN, level: 2, flag: Flag.preliminary, received: T + 11 * MIN },
    { time: T + 20 * MIN, level: 3, flag: Flag.preliminary },
  ];

  it("replaces the range, keeps the rest, and keeps first arrival times", () => {
    const incoming: Observation[] = [
      { time: T + 10 * MIN, level: 2.1, flag: Flag.good },
      { time: T + 15 * MIN, level: 2.5, flag: Flag.good },
    ];
    const merged = mergeRange(old, incoming, T + 5 * MIN, T + 20 * MIN, T + 30 * MIN);
    assert.deepEqual(merged, [
      old[0],
      { time: T + 10 * MIN, level: 2.1, flag: Flag.good, received: T + 11 * MIN },
      { time: T + 15 * MIN, level: 2.5, flag: Flag.good, received: T + 30 * MIN },
      old[2],
    ]);
  });

  it("compares rows regardless of key order", () => {
    assert.ok(sameRows([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]));
    assert.ok(!sameRows([{ a: 1 }], [{ a: 2 }]));
  });
});

describe("qc", () => {
  const tide = (n: number, step = 10 * MIN) =>
    Array.from({ length: n }, (_, i) => ({
      time: T + i * step,
      level: 2 * Math.sin((2 * Math.PI * i * step) / (12.42 * 3_600_000)),
      flag: Flag.good,
    })) as Observation[];

  it("leaves a clean tide alone", () => {
    assert.ok(qc(tide(1000)).every((r) => r.flag === Flag.good));
  });

  it("flags a spike, a flatline, and a level far from the rest", () => {
    const rows = tide(1000);
    rows[100]!.level += 0.6;
    for (let i = 500; i < 540; i++) rows[i]!.level = 1.5;
    rows[800]!.level = 15;
    const flags = qc(rows).map((r) => r.flag);
    assert.equal(flags[100], Flag.suspect);
    assert.equal(flags[99], Flag.good);
    assert.ok(flags.slice(500, 540).every((f) => f === Flag.suspect));
    assert.equal(flags[800], Flag.suspect);
  });

  it("can leave out the outlier rule, for pools that sit flat and then flood", () => {
    // Six days flat at 4 m, then a 2 m rise.
    const rows = Array.from({ length: 7 * 24 }, (_, i) => ({
      time: T + i * 3_600_000,
      level: i < 6 * 24 ? 4 + (i % 2) * 0.01 : 4 + (i - 6 * 24) / 12,
      flag: Flag.good,
    })) as Observation[];
    assert.equal(qc(rows).at(-1)!.flag, Flag.suspect);
    assert.equal(qc(rows, { outliers: false }).at(-1)!.flag, Flag.good);
  });

  it("judges limits against the series, not zero, for gauges far above their datum", () => {
    const rows = tide(200).map((r) => ({ ...r, level: r.level + 250 }));
    rows[50]!.level = 300;
    const flags = qc(rows).map((r) => r.flag);
    assert.equal(flags[0], Flag.good);
    assert.equal(flags[50], Flag.bad);
  });

  it("sorts, drops repeated times, and never improves a flag", () => {
    const rows = [
      { time: T + MIN, level: 1, flag: Flag.suspect },
      { time: T, level: 1, flag: Flag.good },
      { time: T, level: 9, flag: Flag.good },
    ];
    assert.deepEqual(
      qc(rows).map((r) => [r.time - T, r.level, r.flag]),
      [
        [0, 1, Flag.good],
        [MIN, 1, Flag.suspect],
      ],
    );
  });
});

describe("mergeFetched", () => {
  it("keeps a stored month the fetch returned nothing for", () => {
    const jan = Date.UTC(2024, 0, 15);
    const feb = Date.UTC(2024, 1, 15);
    const mar = Date.UTC(2024, 2, 15);
    const row = (time: number, level: number) => ({ time, level, flag: Flag.good });
    const merged = mergeFetched(
      [row(jan, 1), row(feb, 2), row(mar, 3)],
      // February came back "No data"; January and March were re-fetched.
      [row(jan, 1.1), row(mar, 3.3)],
      Date.UTC(2024, 0, 1),
      Date.UTC(2025, 0, 1),
    );
    assert.deepEqual(
      merged.map((r) => r.level),
      [1.1, 2, 3.3],
    );
  });
});
