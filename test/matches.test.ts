import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  compare,
  compareStations,
  pairsToCompare,
  tooManyStopped,
  type DataMatch,
} from "../src/matches.ts";
import { linkGauges } from "../src/same-as.ts";
import { Flag, type Epoch, type Observation, type StoredStation } from "../src/schema.ts";
import { writeObservations } from "../src/store/parquet.ts";
import { seriesPath, yearsPath } from "../src/store/paths.ts";
import { writeYears } from "../src/store/years.ts";

const HOUR_MS = 3_600_000;
const START = Date.UTC(2025, 0, 1) / HOUR_MS;

const station = (id: string, fields: Partial<StoredStation> = {}): StoredStation => {
  const [source, source_id] = id.split("/") as [string, string];
  return {
    id,
    source,
    source_id,
    name: id,
    lat: 54,
    lon: 8,
    country_code: null,
    kind: null,
    interval_s: 3600,
    datum: "ZERO",
    datums: {},
    products: ["levels"],
    first: "2025-01-01T00:00:00Z",
    last: "2025-12-31T23:00:00Z",
    license: "CC0-1.0",
    commercial_use: true,
    attribution: "",
    tide_station: null,
    same_as: [],
    status: "active",
    live: false,
    min_interval_s: null,
    source_url: null,
    epochs: [epoch()],
    ...fields,
  };
};

const epoch = (fields: Partial<Epoch> = {}): Epoch => ({
  id: 1,
  datum: "ZERO",
  since: null,
  until: null,
  seen: null,
  reference: null,
  reference_since: null,
  datums: {},
  to_current: null,
  state: "open",
  ...fields,
});

/** A 1.5 m semidiurnal tide at hour `h` since 1970. */
const tide = (h: number) => 1.5 * Math.sin((2 * Math.PI * h) / 12.42);

/** `hours` hourly levels of the tide from `START`, `offset` above it and `lag` hours late. */
const hourly = (hours: number, offset = 0, lag = 0) => ({
  start: START,
  levels: Float64Array.from({ length: hours }, (_, i) => tide(START + i - lag) + offset),
});

const match = (a: string, b: string, fields: Partial<DataMatch> = {}): DataMatch => ({
  a,
  b,
  since: "2023-01-01T00:00:00.000Z",
  until: "2026-01-01T00:00:00.000Z",
  months: 24,
  hours: 17000,
  rms_m: 0.002,
  lag_h: 0,
  lag_rms_m: 0.002,
  ...fields,
});

describe("compare", () => {
  it("finds one gauge in two datums", () => {
    const m = compare(hourly(8760), hourly(8760, 4.9))!;
    assert.equal(m.months, 12);
    assert.equal(m.rms_m, 0);
    assert.equal(m.lag_h, 0);
  });

  it("finds a copy whose clock is an hour off", () => {
    const m = compare(hourly(8760), hourly(8760, 0, 1))!;
    assert.ok(m.rms_m > 0.5);
    // b's stamps run an hour late, so an hour comes off them.
    assert.equal(m.lag_h, -1);
    assert.equal(m.lag_rms_m, 0);
  });

  it("needs six months", () => {
    assert.equal(compare(hourly(24 * 150), hourly(24 * 150)), null);
  });

  it("counts no month of still water", () => {
    // Two gauges on a pool, a few millimeters of noise apart.
    const still = (seed: number) => ({
      start: START,
      levels: Float64Array.from({ length: 8760 }, (_, i) => 0.02 * Math.sin(i * seed)),
    });
    assert.equal(compare(still(0.7), still(1.3)), null);
  });
});

describe("pairsToCompare", () => {
  const km = (n: number) => n / 111.195;
  it("takes nearby pairs that levels could link, and every linked pair", () => {
    const pairs = pairsToCompare([
      station("a/1"),
      station("b/1", { lat: 54 + km(5) }),
      // Too far, unless linked.
      station("b/2", { lat: 54 + km(20) }),
      station("c/1", { lat: 54 - km(30), same_as: ["a/1"] }),
      // Separate instruments, unless linked.
      station("coops/1", { lat: 56 }),
      station("usgs/1", { lat: 56 }),
      station("coops/2", { lat: 57, same_as: ["usgs/2"] }),
      station("usgs/2", { lat: 57 }),
      // Two of an assembled source's records.
      station("gesla/x", { lat: 58 }),
      station("gesla/y", { lat: 58 }),
      // Records that never overlap.
      station("d/1", { lat: 59, last: "2000-01-01T00:00:00Z" }),
      station("e/1", { lat: 59 }),
    ]);
    assert.deepEqual(pairs.map(([a, b]) => `${a.id} ${b.id}`).sort(), [
      "a/1 b/1",
      "a/1 c/1",
      "coops/2 usgs/2",
      "gesla/x gesla/y",
    ]);
  });
});

describe("linkGauges with levels", () => {
  const near = (id: string, fields: Partial<StoredStation> = {}) =>
    station(id, { first: null, last: null, ...fields });

  it("links a pair whose levels agree, whatever their names", () => {
    const { stations, report } = linkGauges(
      [near("a/1", { name: "Harbor" }), near("b/1", { name: "Pier 7", lat: 54.04 })],
      new Date(),
      new Map(),
      [match("a/1", "b/1")],
    );
    assert.deepEqual(stations[0]!.same_as, ["b/1"]);
    assert.deepEqual(report.pairs, { "a~b": { data: 1 } });
  });

  it("links the copy that agrees best, not the nearest", () => {
    // CMEMS's copy of a barrier's outer gauge, which the inner one tracks while the barrier is open.
    const { stations } = linkGauges(
      [
        near("cmems/x"),
        near("pegelonline/ap", { lat: 54.004 }),
        near("pegelonline/bp", { lat: 54.002 }),
      ],
      new Date(),
      new Map(),
      [
        match("cmems/x", "pegelonline/ap", { rms_m: 0 }),
        match("cmems/x", "pegelonline/bp", { rms_m: 0.008 }),
      ],
    );
    assert.deepEqual(stations[0]!.same_as, ["pegelonline/ap"]);
  });

  it("never links two gauges on water that measures non-tidal", () => {
    const { stations } = linkGauges(
      [near("usace/pool", { tidal: false }), near("usgs/dam", { tidal: false, lat: 54.04 })],
      new Date(),
      new Map(),
      [match("usace/pool", "usgs/dam")],
    );
    assert.equal(stations[0]!.same_as.length, 0);
  });

  it("never links a pair more than MATCH_KM apart, as one that moved away is", () => {
    const { stations } = linkGauges(
      [near("a/1"), near("b/1", { lat: 54.2 })],
      new Date(),
      new Map(),
      [match("a/1", "b/1")],
    );
    assert.equal(stations[0]!.same_as.length, 0);
  });

  it("never links separate instruments, or a pair with too few months", () => {
    const { stations } = linkGauges(
      [near("coops/1"), near("usgs/1"), near("c/1", { lat: 55 }), near("d/1", { lat: 55 })],
      new Date(),
      new Map(),
      [match("coops/1", "usgs/1"), match("c/1", "d/1", { months: 5 })],
    );
    assert.ok(stations.every((s) => s.same_as.length === 0));
  });

  it("reports a link whose levels disagree, and a copy an hour off", () => {
    const { stations, report } = linkGauges(
      [
        near("a/1", { same_as: ["b/1"] }),
        near("b/1"),
        near("c/1", { lat: 55 }),
        near("d/1", { lat: 55 }),
      ],
      new Date(),
      new Map(),
      [
        match("a/1", "b/1", { rms_m: 0.08, lag_rms_m: 0.08 }),
        match("c/1", "d/1", { rms_m: 0.6, lag_h: -1, lag_rms_m: 0.001 }),
      ],
    );
    assert.deepEqual(stations[0]!.same_as, ["b/1"]);
    assert.deepEqual(
      report.disagree.map((d) => [d.a, d.b, d.how]),
      [["a/1", "b/1", "id"]],
    );
    assert.deepEqual(
      report.shifted.map((d) => [d.a, d.b, d.lag_h]),
      [["c/1", "d/1", -1]],
    );
    assert.equal(stations[2]!.same_as.length, 0);
  });
});

describe("compareStations", () => {
  /** A store holding a year of hourly tide for each station, `offset` above it. */
  const store = async (dir: string, pairs: [StoredStation, number][]) => {
    for (const [s, offset] of pairs) {
      const rows: Observation[] = Array.from({ length: 8760 }, (_, i) => ({
        time: (START + i) * HOUR_MS,
        level: tide(START + i) + offset,
        flag: Flag.good,
      }));
      await writeObservations(seriesPath(dir, "levels", s.source, s.source_id, 2025), rows, "ZERO");
      await writeYears(dir, s.source, [
        { id: s.id, epoch: 1, year: 2025, hours: 8760, version: "v" },
      ]);
    }
  };
  const pair = () => [station("a/1"), station("b/1", { lat: 54.03 })] as const;

  it("compares two series in a store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matches-"));
    try {
      const [a, b] = pair();
      await store(dir, [
        [a, 0],
        [b, 4.9],
      ]);
      const { rows, failed } = await compareStations(dir, [a, b], 2);
      assert.equal(failed, 0);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.months, 12);
      assert.equal(rows[0]!.rms_m, 0);
      assert.equal(rows[0]!.since, "2025-01-01T00:00:00.000Z");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads an epoch's file only within the epoch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matches-"));
    try {
      // Epoch 1 closed on 1 May, though its file holds the whole year.
      const a = station("a/1", {
        epochs: [epoch({ until: "2025-05-01T00:00:00Z", state: "closed" })],
      });
      const b = station("b/1", { lat: 54.03 });
      await store(dir, [
        [a, 0],
        [b, 0],
      ]);
      assert.deepEqual((await compareStations(dir, [a, b], 2)).rows, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps last month's row when a file or years file is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matches-"));
    try {
      const [a, b] = pair();
      const previous = [match("a/1", "b/1")];
      // b's years file lists a file the store doesn't hold.
      await store(dir, [[a, 0]]);
      await writeYears(dir, "b", [{ id: "b/1", epoch: 1, year: 2025, hours: 8760, version: "v" }]);
      assert.deepEqual((await compareStations(dir, [a, b], 2, previous)).rows, previous);
      // c has no years file at all.
      const c = station("c/1", { lat: 54.03 });
      const kept = [match("a/1", "c/1")];
      assert.deepEqual((await compareStations(dir, [a, c], 2, kept)).rows, kept);
      // A station missing from the lists keeps its row too.
      assert.deepEqual((await compareStations(dir, [a], 2, kept)).rows, kept);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps last month's row, as a failed read, when a years file can't be read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matches-"));
    try {
      const [a, b] = pair();
      await store(dir, [
        [a, 0],
        [b, 0],
      ]);
      await writeFile(yearsPath(dir, "b"), "not parquet");
      const previous = [match("a/1", "b/1")];
      const { rows, failed } = await compareStations(dir, [a, b], 2, previous);
      assert.deepEqual(rows, previous);
      assert.equal(failed, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps last month's row when the years file shares no year with the record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matches-"));
    try {
      const [a, b] = pair();
      await store(dir, [
        [a, 0],
        [b, 0],
      ]);
      // A short listing left b's years file with 2024 only.
      await writeYears(dir, "b", [{ id: "b/1", epoch: 1, year: 2024, hours: 8760, version: "v" }]);
      const previous = [match("a/1", "b/1")];
      assert.deepEqual((await compareStations(dir, [a, b], 2, previous)).rows, previous);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps last month's row when a year it compared has gone from the years file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matches-"));
    try {
      const [a, b] = pair();
      await store(dir, [
        [a, 0],
        [b, 0],
      ]);
      // Last month compared 2025 and 2026; the years files now hold 2025 only.
      const previous = [
        match("a/1", "b/1", {
          since: "2025-01-01T00:00:00.000Z",
          until: "2027-01-01T00:00:00.000Z",
        }),
      ];
      assert.deepEqual((await compareStations(dir, [a, b], 2, previous)).rows, previous);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads only values within a minute of the hour", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matches-"));
    try {
      const [a, b] = pair();
      await store(dir, [[a, 0]]);
      // b's readings are ten minutes past each hour, so none counts, and its row goes.
      const rows: Observation[] = Array.from({ length: 8760 }, (_, i) => ({
        time: (START + i) * HOUR_MS + 600_000,
        level: tide(START + i),
        flag: Flag.good,
      }));
      await writeObservations(seriesPath(dir, "levels", "b", "1", 2025), rows, "ZERO");
      await writeYears(dir, "b", [{ id: "b/1", epoch: 1, year: 2025, hours: 8760, version: "v" }]);
      assert.deepEqual((await compareStations(dir, [a, b], 2, [match("a/1", "b/1")])).rows, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops last month's row when the levels were read and no longer compare", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matches-"));
    try {
      const [a, b] = pair();
      await store(dir, [[a, 0]]);
      // Four months of b's levels, under MIN_MONTHS.
      const rows: Observation[] = Array.from({ length: 2880 }, (_, i) => ({
        time: (START + i) * HOUR_MS,
        level: tide(START + i),
        flag: Flag.good,
      }));
      await writeObservations(seriesPath(dir, "levels", "b", "1", 2025), rows, "ZERO");
      await writeYears(dir, "b", [{ id: "b/1", epoch: 1, year: 2025, hours: 2880, version: "v" }]);
      assert.deepEqual((await compareStations(dir, [a, b], 2, [match("a/1", "b/1")])).rows, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("tooManyStopped", () => {
  it("stops a run where at least 20, and more than 5%, stop agreeing", () => {
    assert.equal(tooManyStopped(20, 100), true);
    assert.equal(tooManyStopped(21, 410), true);
    assert.equal(tooManyStopped(19, 100), false);
    assert.equal(tooManyStopped(20, 400), false);
  });
});
