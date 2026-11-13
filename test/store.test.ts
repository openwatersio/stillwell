import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { mergeFetched, mergeRange, sameRows, upsert } from "../src/store/merge.ts";
import {
  readDatums,
  readExtremes,
  readObservations,
  checkRecent,
  foldObservationFile,
  readObservationFile,
  readRecent,
  readYearStats,
  writeExtremes,
  writeObservations,
  writeRecent,
  readStationBounds,
  readStationList,
  writeStationList,
  writeOffsets,
  writeStations,
} from "../src/store/parquet.ts";
import { seriesPath, yearsPath } from "../src/store/paths.ts";
import { writeYears } from "../src/store/years.ts";
import { qc, withSourceFlag } from "../src/qc.ts";
import { Flag, type StoredStation, type Observation, type Station } from "../src/schema.ts";

const root = mkdtempSync(join(tmpdir(), "stillwell-test-"));

const epoch = {
  id: 1,
  datum: "NAP",
  since: null,
  until: null,
  seen: "2026-01-01T00:00:00Z",
  reference: null,
  reference_since: null,
  datums: { MSL: 0.1 },
  to_current: 0,
  state: "open" as const,
};

const listed: Station = {
  id: "test/1",
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
  same_as: [],
  status: "active",
  live: true,
  min_interval_s: 300,
  source_url: null,
};
const T = Date.UTC(2026, 0, 1);
const MIN = 60_000;

describe("store files", () => {
  it("round-trips observations, with and without arrival times", async () => {
    const rows: Observation[] = [
      { time: T + 10 * MIN, level: 1.234, flag: Flag.preliminary, received: T + 12 * MIN },
      { time: T, level: -0.5, flag: Flag.suspect, source_flag: Flag.good },
    ];
    const path = seriesPath(root, "levels", "test", "a/b", 2026);
    assert.match(path, /obs\/test\/a%2Fb\/2026\.parquet$/);
    await writeObservations(path, rows, "NAP");
    assert.deepEqual(await readObservations(path), [rows[1], rows[0]]);
    assert.deepEqual(await readDatums(path), ["NAP"]);
  });

  it("reads a series file written before source flags were kept", async () => {
    const path = join(root, "obs-old.parquet");
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    await db.run(
      `COPY (SELECT TIMESTAMPTZ '2026-01-01 00:00:00+00' AS time, 1.5::FLOAT AS level_m, 0::UTINYINT AS flag, NULL::TIMESTAMPTZ AS received, 'NAP' AS datum) TO '${path}' (FORMAT parquet)`,
    );
    assert.deepEqual(await readObservations(path), [{ time: T, level: 1.5, flag: Flag.good }]);
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
        {
          station: "b",
          time: T,
          level: 1,
          flag: Flag.suspect,
          source_flag: Flag.preliminary,
          epoch: 2,
        },
        {
          station: "a",
          time: T + MIN,
          level: 2,
          flag: Flag.preliminary,
          received: T + 2 * MIN,
          epoch: 1,
        },
        { station: "a", time: T, level: 3, flag: Flag.preliminary, epoch: 1 },
      ],
    ]);
    assert.deepEqual(
      (await readRecent(path)).map((r) => `${r.station}${r.time - T}@${r.epoch}`),
      ["a0@1", `a${MIN}@1`, "b0@2"],
    );
    const b = (await readRecent(path, ["b"]))[0]!;
    assert.deepEqual([b.flag, b.source_flag], [Flag.suspect, Flag.preliminary]);
  });

  it("reads a recent window written before epochs as epoch 1", async () => {
    const path = join(root, "recent-old.parquet");
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    await db.run(
      `COPY (SELECT 'a' AS station, TIMESTAMPTZ '2026-01-01 00:00:00+00' AS time, 1.5::FLOAT AS level_m, 2::UTINYINT AS flag, NULL::TIMESTAMPTZ AS received) TO '${path}' (FORMAT parquet)`,
    );
    const old = [{ station: "a", time: T, level: 1.5, flag: Flag.preliminary, epoch: 1 }];
    assert.deepEqual(await readRecent(path), old);
    assert.deepEqual(await readRecent(path, ["a"]), old);
  });

  it("writes the recent window in batches, and reads back the stations asked for", async () => {
    const path = join(root, "recent-batches.parquet");
    async function* batches() {
      yield [{ station: "b", time: T, level: 1, flag: Flag.preliminary, epoch: 1 }];
      // Reading between batches, as ingest does, reads the file being replaced.
      assert.deepEqual(await readRecent(path, ["b"]), []);
      yield [{ station: "a", time: T, level: 2, flag: Flag.good, epoch: 1 }];
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
    await writeRecent(path, [[{ station: "a", time: T, level: 1, flag: Flag.good, epoch: 1 }]]);
    await checkRecent(path);
    writeFileSync(path, "not parquet");
    await assert.rejects(checkRecent(path));
  });

  it("writes stations with datums, products, links and epochs", async () => {
    const station: StoredStation = {
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
      epochs: [epoch],
    };
    await writeStations(join(root, "stations.parquet"), [station]);
  });

  it("round-trips a source's list, with its own fields and epochs", async () => {
    const path = join(root, "stations/test.parquet");
    assert.equal(await readStationList(path), null);
    const station = {
      ...listed,
      series: "Venice.Stage.Inst.1Hour.0.rev",
      established: "1899-01-01T00:00:00Z",
      epochs: [
        { ...epoch, state: "closed", until: "2015-06-28T04:00:00Z", to_current: null },
        {
          ...epoch,
          id: 2,
          since: "2015-06-29T04:00:00Z",
          seen: "2026-11-04T00:00:00Z",
          reference: "2015-06-29",
          reference_since: null,
          datums: { NGVD29: 1.2 },
        },
      ],
    } as StoredStation;
    await writeStationList(path, [station]);
    assert.deepEqual(await readStationList(path), [station]);
  });

  it("keeps a source's QC start in a list, absent where the adapter hasn't asked", async () => {
    const path = join(root, "stations/test.parquet");
    const asked = {
      ...listed,
      epochs: [epoch],
      source_qc_start: "2019-07-01T00:00:00Z",
      source_qc_start_inferred: true,
    };
    const none = { ...asked, id: "test:2", source_qc_start: null, source_qc_start_inferred: null };
    const unasked = { ...listed, id: "test:3", epochs: [epoch] };
    await writeStationList(path, [asked, none, unasked] as StoredStation[]);
    const read = await readStationList(path);
    assert.deepEqual(
      read!.map((s) => ["source_qc_start" in s, s.source_qc_start, s.source_qc_start_inferred]),
      [
        [true, "2019-07-01T00:00:00Z", true],
        [true, null, null],
        [false, undefined, undefined],
      ],
    );
  });

  it("reads back the first and last the store filled in, and an unknown preliminary from a file without one", async () => {
    const path = join(root, "bounds/stations.parquet");
    assert.deepEqual(await readStationBounds(path), new Map());
    const station = {
      id: "test:1",
      source: "test",
      source_id: "1",
      first: "2001-02-03T04:05:06Z",
      last: null,
      epochs: [],
    } as unknown as StoredStation;
    await writeStations(path, [station, { ...station, id: "test:2", first: null }]);
    assert.deepEqual(
      await readStationBounds(path),
      new Map([
        // Undefined, not null: a file without the column doesn't say there are none.
        [
          "test:1",
          { first: "2001-02-03T04:05:06Z", last: null, preliminary: undefined, screened: null },
        ],
        ["test:2", { first: null, last: null, preliminary: undefined, screened: null }],
      ]),
    );
  });
});

describe("files read by station", () => {
  // Shuffled so the sort is the writer's, and enough rows for several groups.
  const ids = Array.from(
    { length: 5000 },
    (_, i) => `test/${String((i * 7919) % 5000).padStart(4, "0")}`,
  );

  async function groups(
    path: string,
    column = "id",
  ): Promise<{ min: string; max: string; rows: number }[]> {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    const reader = await db.runAndReadAll(
      `SELECT stats_min_value, stats_max_value, row_group_num_rows FROM parquet_metadata('${path}') WHERE path_in_schema = '${column}' ORDER BY row_group_id`,
    );
    return reader
      .getRows()
      .map(([min, max, rows]) => ({ min: String(min), max: String(max), rows: Number(rows) }));
  }

  // A station's rows may cross into the next group, so a group may start with the last one's station.
  function assertSorted(found: { min: string; max: string; rows: number }[], total: number) {
    assert.equal(
      found.reduce((sum, g) => sum + g.rows, 0),
      total,
    );
    assert.ok(found.length > 1, `${found.length} row group`);
    for (let i = 1; i < found.length; i++) assert.ok(found[i - 1]!.max <= found[i]!.min);
    for (const { rows } of found.slice(0, -1)) assert.equal(rows, 2048);
  }

  it("writes stations.parquet sorted by ID in row groups of 2,048", async () => {
    const path = join(root, "sorted/stations.parquet");
    await writeStations(
      path,
      ids.map((id) => ({ ...listed, id, epochs: [epoch] }) as StoredStation),
    );
    assertSorted(await groups(path), 5000);
  });

  it("writes stations/offsets.parquet sorted by station in row groups of 2,048", async () => {
    const path = join(root, "sorted/offsets.parquet");
    await writeOffsets(
      path,
      ids.flatMap((station) =>
        ["MSL", "LAT"].map((datum) => ({ station, epoch: 1, datum, offset_m: 0.1 })),
      ),
    );
    assertSorted(await groups(path, "station"), 10000);
  });

  it("writes a source's year files sorted by station in row groups of 2,048", async () => {
    const store = join(root, "sorted");
    await writeYears(
      store,
      "test",
      ids.flatMap((id) => [2026, 2025, 2024].map((year) => ({ id, epoch: 1, year, hours: 1 }))),
    );
    assertSorted(await groups(yearsPath(store, "test")), 15000);
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

  it("flags a reading held for an hour or two while the tide moves", () => {
    // As GESLA's CMEMS copy of Wangerooge holds −7.45 m, and 2.27 or 2.28 m at high water.
    const rows = tide(1000);
    for (let i = 300; i < 308; i++) rows[i]!.level = -7.45;
    // High water, 2 m, is at the 615th value. 2.49 − 2.48 is a hair over 0.01 in floating point.
    for (let i = 611; i < 620; i++) rows[i]!.level = i % 2 ? 2.49 : 2.48;
    const flags = qc(rows).map((r) => r.flag);
    assert.ok(flags.slice(300, 308).every((f) => f === Flag.suspect));
    assert.ok(flags.slice(611, 620).every((f) => f === Flag.suspect));
    assert.equal(flags[296], Flag.good);
    assert.equal(flags[623], Flag.good);
  });

  it("flags Wangerooge's high water held at 2.27 and 2.28 m", () => {
    // GESLA's CMEMS copy, 2024-02-14 from 23:00 the day before, every 10 minutes.
    // PEGELONLINE's copy of the gauge falls from 1.82 to 1.18 m over the held hour.
    const levels = [
      0.66, 0.79, 0.9, 1.03, 1.14, 1.25, 1.35, 1.48, 1.57, 1.66, 1.75, 1.81, 1.86, 1.9, 1.94, 2.06,
      2.08, 2.07, 1.99, 1.99, 2.1, 2.27, 2.27, 2.28, 2.28, 2.28, 2.27, 2.27, 2.28, 1.08, 0.97, 0.84,
      0.73, 0.6, 0.49, 0.36, 0.25, 0.15, 0.02, -0.09, -0.19, -0.27, -0.39, -0.5, -0.6, -0.71, -0.81,
      -0.92,
    ];
    const rows = levels.map((level, i) => ({
      time: T + i * 10 * MIN,
      level,
      flag: Flag.good as Flag,
    }));
    const flags = qc(rows).map((r) => r.flag);
    assert.ok(flags.slice(21, 29).every((f) => f === Flag.suspect));
    assert.ok(flags.slice(0, 15).every((f) => f === Flag.good));
    assert.ok(flags.slice(31).every((f) => f === Flag.good));
    // A value just before the hold, within a centimeter of it, doesn't hide it.
    levels[20] = 2.26;
    assert.ok(
      qc(rows.map((r, i) => ({ ...r, level: levels[i]! })))
        .slice(21, 29)
        .every((r) => r.flag === Flag.suspect),
    );
  });

  it("leaves two values level at a high water", () => {
    // 15-minute values of a tide 4 to 12 m in range, as at Avonmouth, with a
    // spring high water halfway between two of them.
    const level = (i: number) => {
      const t = i - 1441.5;
      return (
        (4 + 2 * Math.cos((2 * Math.PI * t) / (14.77 * 96))) * Math.cos((2 * Math.PI * t) / 49.68)
      );
    };
    const rows = Array.from({ length: 2800 }, (_, i) => ({
      time: T + i * 15 * MIN,
      level: level(i),
      flag: Flag.good,
    })) as Observation[];
    assert.ok(
      qc(rows)
        .filter((r) => r.level > 5)
        .every((r) => r.flag === Flag.good),
    );
  });

  const steps = (...held: [number, number][]) =>
    held
      .flatMap(([level, hours]) => Array.from({ length: hours }, () => level))
      .map((level, i) => ({
        time: T + i * 3_600_000,
        level: level + (i % 2) * 0.01,
        flag: Flag.good,
      })) as Observation[];

  it("leaves a held level between steps the same way", () => {
    const flags = qc(steps([3, 24], [4, 5], [5, 24])).map((r) => r.flag);
    assert.equal(flags[26], Flag.good);
  });

  it("can leave out the held-level rule, for pools let up for a few hours", () => {
    const flags = qc(steps([3, 24], [3.5, 5], [3, 24]), { held: false }).map((r) => r.flag);
    assert.equal(flags[26], Flag.good);
    assert.equal(qc(steps([3, 24], [3.5, 5], [3, 24]))[26]!.flag, Flag.suspect);
  });

  describe("residual jumps", () => {
    // 60 days of a 2 m semidiurnal tide with a fortnightly spring-neap, every 10 minutes.
    const year = () =>
      Array.from({ length: 60 * 144 }, (_, i) => {
        const h = i / 6;
        return {
          time: T + i * 10 * MIN,
          level: 2 * Math.cos((2 * Math.PI * h) / 12.4206) + 0.5 * Math.cos((2 * Math.PI * h) / 12),
          flag: Flag.good,
        };
      }) as Observation[];

    it("flags a run that jumps from the tide and back, as Kilrush Lough's sensor reading near its zero", () => {
      const rows = year();
      // Four hours at about −5.8 m, as on 9 January 2025.
      for (let i = 3000; i < 3024; i++) rows[i]!.level = -5.8 + (i % 3) * 0.1;
      const on = qc(rows, { jumps: true }).map((r) => r.flag);
      const off = qc(rows).map((r) => r.flag);
      assert.ok(on.slice(3000, 3024).every((f) => f === Flag.suspect));
      assert.ok(off.slice(3002, 3022).every((f) => f === Flag.good));
      // Outside the run, the flags are the other rules'.
      assert.deepEqual(on.slice(0, 3000), off.slice(0, 3000));
      assert.deepEqual(on.slice(3024), off.slice(3024));
    });

    it("flags a wrong value just before a gap, which has no neighbors on one side", () => {
      // As Jersey's 0.0 m on 14 October 2025, between a rising tide and an hour's gap.
      const rows = year();
      const i = rows.findIndex((r, k) => k > 2000 && r.level > 1.8);
      rows[i]!.level = 0;
      rows.splice(i + 1, 6);
      assert.equal(qc(rows, { jumps: true })[i]!.flag, Flag.suspect);
      assert.equal(qc(rows)[i]!.flag, Flag.good);
    });

    it("leaves a storm surge of 3 m over a day alone", () => {
      const rows = year().map((r) => {
        const h = (r.time - T) / 3_600_000 - 30 * 24;
        return { ...r, level: r.level + 3 * Math.exp(-((h / 8) ** 2)) };
      });
      assert.ok(qc(rows, { jumps: true }).every((r) => r.flag === Flag.good));
    });

    it("leaves a day of waves alone, which raise the bar near them", () => {
      // Every 5 minutes, with a day of ±0.45 m waves, as at Dunmore East in Storm Herminia.
      let seed = 1;
      const wave = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.9;
      const rows = Array.from({ length: 60 * 288 }, (_, i) => {
        const h = i / 12;
        return {
          time: T + i * 5 * MIN,
          level:
            2 * Math.cos((2 * Math.PI * h) / 12.4206) +
            0.5 * Math.cos((2 * Math.PI * h) / 12) +
            (i >= 6000 && i < 6288 ? wave() : 0),
          flag: Flag.good,
        };
      }) as Observation[];
      assert.deepEqual(
        qc(rows, { jumps: true }).map((r) => r.flag),
        qc(rows).map((r) => r.flag),
      );
    });

    it("leaves a run that moves with the tide, as water a barrier holds", () => {
      // A jump of 1.5 m, then three hours whose residual swings by more than half that.
      const rows = year();
      for (let i = 3000; i < 3018; i++) rows[i]!.level += i < 3009 ? 1.5 : 3.5;
      assert.deepEqual(
        qc(rows, { jumps: true }).map((r) => r.flag),
        qc(rows).map((r) => r.flag),
      );
    });

    it("leaves the water between two dips, which sits on the tide", () => {
      // As at Inishmore on 18 January 2025: a dip of 0.45 m, under the bar, then a
      // wave 0.2 m up, so the step back to the tide is over it, and another dip of 0.6 m.
      const rows = year();
      rows[3000]!.level -= 0.45;
      rows[3001]!.level += 0.2;
      rows[3004]!.level -= 0.6;
      assert.deepEqual(
        qc(rows, { jumps: true })
          .slice(3001, 3004)
          .map((r) => r.flag),
        qc(rows)
          .slice(3001, 3004)
          .map((r) => r.flag),
      );
    });

    it("leaves a jump before an outage of more than a day", () => {
      // A gauge that reads a tsunami's first wave and fails, or one wrong value, can't be told apart.
      const rows = year();
      const i = rows.findIndex((r, k) => k > 2000 && r.level > 1.8);
      rows[i]!.level = 0;
      rows.splice(i + 1, 2 * 144);
      assert.equal(qc(rows, { jumps: true })[i]!.flag, qc(rows)[i]!.flag);
    });

    it("leaves a level that changes and stays changed across a gap", () => {
      // Moved up 1 m, as a gauge serviced and set again, with a two-hour dropout soon after.
      const rows = year().map((r, k) => (k >= 7000 ? { ...r, level: r.level + 1 } : r));
      rows.splice(7018, 12);
      assert.deepEqual(
        qc(rows, { jumps: true }).map((r) => r.flag),
        qc(rows).map((r) => r.flag),
      );
    });

    it("fits around a suspect value at the top of each hour", () => {
      const rows = year().map((r, k) =>
        k % 6 ? r : { ...r, flag: Flag.suspect, source_flag: Flag.suspect },
      );
      for (let i = 3000; i < 3024; i++) rows[i]!.level = -5.8 + (i % 3) * 0.1;
      const on = qc(rows, { jumps: true });
      const off = qc(rows);
      // The run's values that were usable: QC passes them without the rule.
      const inRun = [...Array(24).keys()].map((k) => 3000 + k).filter((k) => k % 6);
      assert.ok(inRun.slice(2, -2).every((k) => off[k]!.flag === Flag.good));
      assert.ok(inRun.every((k) => on[k]!.flag === Flag.suspect));
    });

    it("judges nothing where a year is too sparse or coarse to fit", () => {
      const tide = (h: number) =>
        2 * Math.cos((2 * Math.PI * h) / 12.4206) + 0.5 * Math.cos((2 * Math.PI * h) / 12);
      // Two days at each end of a year, which can't fit the standard set.
      const sparse = [...Array(48).keys(), ...Array.from({ length: 48 }, (_, h) => 330 * 24 + h)];
      // Every 3 hours for 120 days, where S4 can't be told from its own alias.
      const coarse = Array.from({ length: 960 }, (_, k) => 3 * k);
      for (const hours of [sparse, coarse]) {
        const rows = hours.map((h) => ({
          time: T + h * 3_600_000,
          level: tide(h),
          flag: Flag.good,
        })) as Observation[];
        assert.deepEqual(
          qc(rows, { jumps: true }).map((r) => r.flag),
          qc(rows).map((r) => r.flag),
        );
      }
    });
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

  it("keeps the flag a source sent apart from QC's marks", () => {
    const rows = withSourceFlag(tide(200));
    rows[100]!.level += 0.6;
    const marked = qc(rows);
    assert.deepEqual([marked[100]!.flag, marked[100]!.source_flag], [Flag.suspect, Flag.good]);
    // A stored row's flag may hold QC's marks, so QC never takes it for the source's.
    assert.equal(qc(tide(10))[0]!.source_flag, undefined);
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

describe("the store's environment", () => {
  for (const [old, now] of [
    ["WATER_LEVELS_LAKE", "STILLWELL_STORE"],
    ["WATER_LEVELS_RESTRICTED_LAKE", "STILLWELL_RESTRICTED_STORE"],
    ["WATER_LEVELS_CACHE", "STILLWELL_CACHE"],
  ]) {
    it(`refuses ${old}, now ${now}`, () => {
      const run = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", 'await import("./src/store/parquet.ts")'],
        {
          env: { ...process.env, [old]: "x" },
          encoding: "utf8",
        },
      );
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, new RegExp(`${old} is set; it's now ${now}`));
    });
  }
});

describe("foldObservationFile", () => {
  const H = 3_600_000;
  const T = Date.UTC(2026, 0, 1);
  // Varied levels, flags, source flags and arrivals, so a row the fold rewrites wrongly shows.
  const existing: Observation[] = Array.from({ length: 48 }, (_, i) => {
    const r: Observation = { time: T + i * H, level: 0.1234 + i / 7, flag: (i % 5) as Flag };
    if (i % 3) r.source_flag = ((i + 1) % 5) as Flag;
    if (i % 4) r.received = T + i * H + 60_000;
    return r;
  });
  // A negative zero, and a level that rounds to one, which the version hashes apart from zero.
  existing[5]!.level = -0;
  existing[6]!.level = -0.00004;
  const incoming: Observation[] = [
    // A value it had, one it had with a new level, and new ones.
    { ...existing[40]! },
    { time: T + 41 * H, level: 9.5, flag: Flag.preliminary, source_flag: Flag.preliminary },
    { time: T + 48 * H, level: 1.25, flag: Flag.preliminary, received: T + 49 * H },
    { time: T + 49 * H, level: -0.5, flag: Flag.preliminary },
  ];
  const window: [number, number] = [T + 2 * H, T + 60 * H];

  /** The file and bounds a whole read, merge and rewrite gives, beside foldObservationFile's. */
  async function both(name: string, write: (path: string) => Promise<void>) {
    const whole = join(root, "fold", name, "whole.parquet");
    const fold = join(root, "fold", name, "fold.parquet");
    await write(whole);
    await write(fold);
    const had = await readObservationFile(whole);
    const merged = upsert(had.rows, incoming);
    const wholeStats = await writeObservations(whole, merged, "NAP");
    const from = Math.min(...incoming.map((r) => r.time));
    let seen: { rows: Observation[]; datums: string[] } | undefined;
    const { before, stats } = await foldObservationFile(
      fold,
      from,
      "NAP",
      window,
      async (rows, datums) => {
        seen = { rows, datums };
        return upsert(rows, incoming);
      },
    );
    assert.deepEqual(
      seen!.rows,
      had.rows.filter((r) => r.time >= from),
    );
    assert.deepEqual(seen!.datums, had.datums);
    assert.deepEqual(await readObservations(fold), await readObservations(whole));
    assert.deepEqual(stats, wholeStats);
    assert.deepEqual(stats, (await readYearStats([fold])).get(fold));
    return { before, merged };
  }

  it("writes the file a whole read, merge and rewrite would, reading only the rows it can change", async () => {
    const { before, merged } = await both("current", (path) =>
      writeObservations(path, existing, "NAP").then(() => undefined),
    );
    // The rows before the fold's inside the window: hours 2 to 39.
    const inside = existing.filter((r) => r.time >= window[0] && r.time < T + 40 * H);
    const preliminary = inside.find((r) => (r.source_flag ?? r.flag) === Flag.preliminary)!;
    assert.deepEqual(before, [T + 2 * H, T + 39 * H, preliminary.time, true]);
    assert.equal(merged.length, 50);
  });

  it("writes a file from before source_flag was kept as a rewrite would", async () => {
    await both("legacy", async (path) => {
      mkdirSync(dirname(path), { recursive: true });
      const db = await (await DuckDBInstance.create(":memory:")).connect();
      await db.run(
        `COPY (SELECT make_timestamptz(${T * 1000}::BIGINT + i * ${H * 1000}::BIGINT) AS time, (CASE WHEN i = 5 THEN -0.00004 WHEN i = 6 THEN 0.000049999999999999996 WHEN i = 7 THEN NULL ELSE 0.12345 + i / 7 END)::DOUBLE AS level_m, (i % 3)::UTINYINT AS flag, NULL::TIMESTAMPTZ AS received, 'NAP' AS datum FROM range(48) t(i)) TO '${path}' (FORMAT parquet)`,
      );
    });
  });

  it("writes a missing file with the fold's rows alone", async () => {
    const { before } = await both("missing", async () => {});
    assert.equal(before, null);
  });

  it("reads only its own file when its path has a glob character", async () => {
    const dir = join(root, "fold", "glob");
    // A neighbor written before `source_flag`, whose columns differ from the station's own.
    mkdirSync(join(dir, "ab"), { recursive: true });
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    await db.run(
      `COPY (SELECT make_timestamptz(${T * 1000}::BIGINT + i * ${H * 1000}::BIGINT) AS time, 1.5::FLOAT AS level_m, 0::UTINYINT AS flag, NULL::TIMESTAMPTZ AS received, 'NAP' AS datum FROM range(48) t(i)) TO '${join(dir, "ab", "2026.parquet")}' (FORMAT parquet)`,
    );
    const fold = async (rows: Observation[]) => {
      seen = rows;
      return upsert(rows, incoming);
    };
    let seen: Observation[] = [];
    // Its own file is missing, so `a*` matches only its neighbor's.
    const missing = join(dir, "a*", "2026.parquet");
    const { before } = await foldObservationFile(missing, T, "NAP", window, fold);
    assert.deepEqual(seen, []);
    assert.equal(before, null);
    assert.deepEqual(
      (await readObservations(missing)).map((r) => r.time),
      upsert([], incoming).map((r) => r.time),
    );
    // Now it has one, beside a neighbor it also matches.
    const own = await readObservations(missing);
    await foldObservationFile(missing, T, "NAP", window, fold);
    assert.deepEqual(seen, own);
  });

  it("leaves the file as it is when the fold returns null", async () => {
    const path = join(root, "fold", "kept.parquet");
    await writeObservations(path, existing, "NAP");
    const was = await readYearStats([path]);
    const { stats } = await foldObservationFile(path, T, "NAP", null, async () => null);
    assert.equal(stats, null);
    assert.deepEqual(await readYearStats([path]), was);
  });
});
