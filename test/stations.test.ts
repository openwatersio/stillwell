import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Station } from "../src/schema.ts";
import { seriesPath } from "../src/lake/paths.ts";
import { linkBothWays, mergeStationList } from "../src/stations.ts";

const base = {
  source: "rws",
  name: "",
  lat: 0,
  lon: 0,
  country_code: "NL",
  kind: null,
  interval_s: 600,
  datum: "NAP",
  datums: {},
  products: ["levels"],
  first: null,
  last: null,
  license: "CC0-1.0",
  commercial_use: true,
  attribution: "",
  tide_station: null,
  same_as: [],
  status: "active",
  live: true,
  min_interval_s: 300,
  source_url: null,
} satisfies Omit<Station, "id" | "source_id">;

const station = (id: string, fields: Partial<Station> = {}): Station => ({
  ...base,
  id: `rws/${id}`,
  source_id: id,
  ...fields,
});

describe("mergeStationList", () => {
  it("keeps stations the source dropped, inactive, and the committed tide_station", () => {
    const previous = [station("a", { tide_station: "ticon/a" }), station("b")];
    const { stations } = mergeStationList(previous, [station("a")]);
    assert.deepEqual(
      stations.map((s) => [s.id, s.status, s.tide_station]),
      [
        ["rws/a", "active", "ticon/a"],
        ["rws/b", "inactive", null],
      ],
    );
  });

  it("leaves first and last to the lake", () => {
    const filled = { first: "2000-01-01T00:00:00Z", last: "2026-01-01T00:00:00Z" };
    const { stations } = mergeStationList(
      [station("a", filled), station("b", filled), station("c", filled)],
      [station("a", filled), station("b", { datum: "MSL" })],
    );
    assert.deepEqual(
      stations.map((s) => [s.id, s.first, s.last]),
      [
        ["rws/a", null, null],
        ["rws/b", null, null],
        ["rws/c", null, null],
      ],
    );
  });

  it("marks a station inactive when its datum changes, and brings it back when it returns", () => {
    const previous = [station("a", { datums: { LAT: -1.2 } })];
    const moved = mergeStationList(previous, [station("a", { datum: "MSL", datums: {} })]);
    assert.deepEqual(moved.changed, [{ id: "rws/a", from: "NAP", to: "MSL" }]);
    assert.deepEqual(
      moved.stations.map((s) => [s.id, s.datum, s.datums, s.status]),
      [["rws/a", "NAP", { LAT: -1.2 }, "inactive"]],
    );
    const back = mergeStationList(moved.stations, [station("a")]);
    assert.deepEqual([back.stations[0]!.status, back.changed], ["active", []]);
  });

  it("keeps the committed datum when the source leaves it out, and skips new stations without one", () => {
    const { stations, changed } = mergeStationList(
      [station("a", { datum: "SKN", datums: { NHN: -5 } })],
      [
        { ...station("a"), datum: null, datums: {} },
        { ...station("b"), datum: null },
      ],
    );
    assert.deepEqual(changed, []);
    assert.deepEqual(
      stations.map((s) => [s.id, s.datum, s.datums, s.status]),
      [["rws/a", "SKN", { NHN: -5 }, "active"]],
    );
  });

  it("keeps committed offsets when the source sends none this time", () => {
    const { stations } = mergeStationList(
      [station("a", { datums: { MLLW: -2.4 } })],
      [station("a", { datums: {} })],
    );
    assert.deepEqual(stations[0]!.datums, { MLLW: -2.4 });
  });

  it("refuses an ID that isn't <source>/<source_id>", () => {
    assert.throws(() => mergeStationList([], [station("a", { id: "rws:a" })]), /rws:a/);
  });
});

describe("seriesPath", () => {
  it("puts each station's files under its source code", () => {
    assert.equal(
      seriesPath("data", "levels", "rws", "hoekvanholland", 2026),
      "data/obs/rws/hoekvanholland/2026.parquet",
    );
  });
});

describe("linkBothWays", () => {
  it("adds the reverse of every link", () => {
    const linked = linkBothWays([station("a", { same_as: ["pegelonline/1"] }), station("b")]);
    assert.deepEqual(linked[0]!.same_as, ["pegelonline/1"]);
    const reverse = linkBothWays([station("a", { same_as: ["rws/b"] }), station("b")]);
    assert.deepEqual(reverse[1]!.same_as, ["rws/a"]);
  });
});
