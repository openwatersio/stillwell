import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  flaggedSpan,
  impossibleDropped,
  medianGap,
  utcDay,
  type StoreReader,
} from "../src/errata.ts";
import { Flag, type Observation, type StoredStation } from "../src/schema.ts";
import { errataReader, StoreReadError } from "../src/store/errata-reader.ts";
import { writeObservations, writeStationList } from "../src/store/parquet.ts";
import { seriesPath, stationListPath } from "../src/store/paths.ts";

const at = (iso: string) => Date.parse(`${iso}Z`);
const epoch = (id: number, since: string | null, until: string | null) => ({
  id,
  datum: "STND",
  since,
  until,
  seen: null,
  reference: null,
  reference_since: null,
  datums: {},
  to_current: 0,
  state: until ? "closed" : "open",
});

describe("errataReader", () => {
  it("reads a station's levels across its epochs and years, in the span only", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-errata-"));
    await writeStationList(stationListPath(store, "coops"), [
      {
        id: "coops/1",
        source: "coops",
        source_id: "1",
        datum: "STND",
        products: ["levels"],
        status: "active",
        live: false,
        interval_s: 3600,
        kind: "coastal",
        commercial_use: true,
        epochs: [epoch(1, null, "2021-01-01T00:00:00Z"), epoch(2, "2021-01-01T00:00:00Z", null)],
      } as unknown as StoredStation,
    ]);
    const rows = (times: string[], level: number): Observation[] =>
      times.map((t) => ({ time: at(t), level, flag: Flag.good }));
    await writeObservations(
      seriesPath(store, "levels", "coops", "1", 2020, 1),
      rows(["2020-12-30T23:00", "2020-12-31T12:00"], 1),
      "STND",
    );
    // Left in epoch 1's files past its end, as a split leaves them until `ingest misplaced` runs.
    await writeObservations(
      seriesPath(store, "levels", "coops", "1", 2021, 1),
      rows(["2021-01-01T03:00"], 9),
      "STND",
    );
    await writeObservations(
      seriesPath(store, "levels", "coops", "1", 2021, 2),
      rows(["2021-01-01T06:00", "2021-01-02T00:00"], 2),
      "STND",
    );
    const reader = errataReader(() => store, store);
    const read = await reader.levels("coops/1", "2020-12-31", "2021-01-02");
    assert.deepEqual(
      read.map((o) => [new Date(o.time).toISOString().slice(0, 16), o.level, o.epoch]),
      [
        ["2020-12-31T12:00", 1, 1],
        ["2021-01-01T06:00", 2, 2],
      ],
    );
    assert.equal((await reader.station("coops/1"))?.source_id, "1");
    assert.equal(await reader.station("coops/2"), null);
    await assert.rejects(reader.levels("coops/2", "2021-01-01", "2021-01-02"), /doesn't list/);
    await assert.rejects(reader.levels("coops/1", "2021-01-02", "2021-01-01"), /span/);
    await assert.rejects(reader.station("coops"), /station ID/);
  });

  it("reads a rejected epoch's files as the epoch before's, which wins a time they share", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-errata-"));
    await writeStationList(stationListPath(store, "usgs"), [
      {
        id: "usgs/1",
        source: "usgs",
        source_id: "1",
        datum: "GAGE",
        products: ["levels"],
        status: "active",
        live: false,
        interval_s: 900,
        kind: "river",
        commercial_use: true,
        epochs: [
          { ...epoch(1, null, null), state: "open" },
          { ...epoch(2, "2021-01-01T00:00:00Z", null), state: "rejected" },
        ],
      } as unknown as StoredStation,
    ]);
    const rows = (times: string[], level: number): Observation[] =>
      times.map((t) => ({ time: at(t), level, flag: Flag.good }));
    await writeObservations(
      seriesPath(store, "levels", "usgs", "1", 2021, 1),
      rows(["2021-01-01T03:00", "2021-01-01T06:00"], 1),
      "GAGE",
    );
    await writeObservations(
      seriesPath(store, "levels", "usgs", "1", 2021, 2),
      rows(["2021-01-01T06:00", "2021-01-02T00:00"], 2),
      "GAGE",
    );
    const read = await errataReader(() => store, store).levels(
      "usgs/1",
      "2021-01-01",
      "2021-01-03",
    );
    assert.deepEqual(
      read.map((o) => [new Date(o.time).toISOString().slice(0, 16), o.level, o.epoch]),
      [
        ["2021-01-01T03:00", 1, 1],
        ["2021-01-01T06:00", 1, 1],
        ["2021-01-02T00:00", 2, 2],
      ],
    );
  });

  it("marks a store it can't read, and reads a missing file as empty", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-errata-"));
    mkdirSync(join(store, "stations"), { recursive: true });
    writeFileSync(stationListPath(store, "coops"), "not parquet");
    const reader = errataReader(() => store, store);
    await assert.rejects(reader.station("coops/1"), StoreReadError);
    assert.deepEqual(await reader.rows("missing.parquet"), []);
  });
});

describe("flaggedSpan", () => {
  // Two levels on each day given, flagged as each day says.
  const reader = (days: Record<string, Partial<Observation>>): StoreReader => ({
    async levels(_id, since) {
      const day = days[since];
      return day
        ? [0, 12].map((h) => ({
            time: at(`${since}T${String(h).padStart(2, "0")}:00`),
            level: 1,
            flag: Flag.good,
            epoch: 1,
            ...day,
          }))
        : [];
    },
    station: async () => null,
    rows: async () => [],
  });
  const entry = { id: "coops-x", stations: ["coops/1"], since: "2020-01-01", until: "2020-02-01" };
  const suspect = { flag: Flag.suspect };

  it("passes a span flagged at both ends and clear either side", async () => {
    await flaggedSpan(
      reader({ "2020-01-01": suspect, "2020-01-31": suspect, "2019-12-31": {}, "2020-02-01": {} }),
      entry,
    );
  });

  it("reads the span's middle day too", async () => {
    await assert.rejects(
      flaggedSpan(
        reader({ "2020-01-01": suspect, "2020-01-16": {}, "2020-01-31": suspect }),
        entry,
      ),
      /2020-01-16/,
    );
  });

  it("leaves the source's own suspect flags outside the span to the source", async () => {
    await flaggedSpan(
      reader({
        "2020-01-01": suspect,
        "2020-01-31": suspect,
        "2020-02-01": { flag: Flag.suspect, source_flag: Flag.suspect },
        // Stored before source_flag was kept.
        "2019-12-31": { flag: Flag.suspect },
      }),
      entry,
    );
  });

  it("fails an end left unflagged, a span flagged past its end, or no values at all", async () => {
    await assert.rejects(
      flaggedSpan(reader({ "2020-01-01": suspect, "2020-01-31": {} }), entry),
      /aren't suspect/,
    );
    await assert.rejects(
      flaggedSpan(
        reader({
          "2020-01-01": suspect,
          "2020-01-31": suspect,
          "2020-02-01": { flag: Flag.suspect, source_flag: Flag.good },
        }),
        entry,
      ),
      /outside the span/,
    );
    await assert.rejects(flaggedSpan(reader({}), entry), /no coops/);
    await assert.rejects(
      flaggedSpan(reader({}), { ...entry, since: null, until: null }),
      /no span/,
    );
  });
});

describe("utcDay", () => {
  it("refuses a day that doesn't exist", () => {
    assert.equal(utcDay("2024-02-29"), at("2024-02-29T00:00"));
    assert.throws(() => utcDay("2023-04-31"), /isn't a UTC day/);
    assert.throws(() => utcDay("2023-4-1"), /isn't a UTC day/);
    assert.throws(() => utcDay("2023-13-01"), /isn't a UTC day/);
  });
});

describe("impossibleDropped", () => {
  const year = (levels: [number, Flag][]): StoreReader => ({
    levels: async () =>
      levels.map(([level, flag], i) => ({
        time: at("2020-01-01T00:00") + i * 3_600_000,
        level,
        flag,
        epoch: 1,
      })),
    station: async () => null,
    rows: async () => [],
  });

  it("passes a year without impossible levels, or one of nothing else flagged bad", async () => {
    await impossibleDropped(year([[1, Flag.good]]), "cdec/DLC", 2020);
    await impossibleDropped(year([[-30479.695, Flag.bad]]), "cdec/DLC", 2020);
  });

  it("fails one kept beside possible levels, one not flagged bad, or an empty year", async () => {
    await assert.rejects(
      impossibleDropped(
        year([
          [1, Flag.good],
          [-30479.695, Flag.bad],
        ]),
        "cdec/DLC",
        2020,
      ),
      /beside possible/,
    );
    await assert.rejects(
      impossibleDropped(year([[-30479.695, Flag.good]]), "cdec/DLC", 2020),
      /not flagged bad/,
    );
    await assert.rejects(impossibleDropped(year([]), "cdec/DLC", 2020), /no cdec/);
  });
});

describe("medianGap", () => {
  // `n` hourly levels from 2020-01-01 for each station, the first `level`, the second that plus `by`.
  const reader = (n: number, by: number): StoreReader => ({
    async levels(id) {
      return Array.from({ length: n }, (_, i) => ({
        time: at("2020-01-01T00:00") + i * 3_600_000,
        level: 1 + (id === "b" ? by : 0),
        flag: Flag.good,
        epoch: 1,
      }));
    },
    station: async () => null,
    rows: async () => [],
  });

  it("is the other station's level minus the first's", async () => {
    assert.equal(
      Math.round((await medianGap(reader(300, -0.05), "a", "b", "2020-01-01", "2020-02-01")) * 100),
      -5,
    );
  });

  it("refuses fewer than 300 shared hours", async () => {
    await assert.rejects(
      medianGap(reader(299, 0), "a", "b", "2020-01-01", "2020-02-01"),
      /share only 299 hours/,
    );
  });
});
