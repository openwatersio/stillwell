import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoredStation, ListedStation, Station } from "../src/schema.ts";
import { seriesPath } from "../src/store/paths.ts";
import { mergeStationList } from "../src/stations.ts";

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

/** A station as the store holds it, with one open epoch in its datum. */
const held = (id: string, fields: Partial<StoredStation> = {}): StoredStation => {
  const s = station(id, fields);
  return {
    ...s,
    epochs: [
      {
        id: 1,
        datum: s.datum,
        since: null,
        until: null,
        seen: "2026-01-01T00:00:00Z",
        reference: null,
        reference_since: null,
        datums: s.datums,
        to_current: 0,
        state: "open",
      },
    ],
    ...fields,
  };
};

const options = {
  now: "2026-06-01T00:00:00Z",
  offsets: [0, 0] as [number, number],
  decisions: {},
};

describe("mergeStationList", () => {
  it("names the earlier epoch as the one to decide on when a station's history splits", () => {
    const listed: ListedStation = {
      ...station("a"),
      reference: { id: "NAP 2005", since: "2005-01-01" },
    };
    const { changes } = mergeStationList([held("a")], [listed], {
      ...options,
      archive: "previous",
    });
    // A to_current under this key converts the old-NAP epoch.
    assert.deepEqual(
      changes.map((c) => [c.event, c.key]),
      [["opened", "rws/a start"]],
    );
  });

  it("reports a new station's split, with the earlier epoch's key", () => {
    const { changes } = mergeStationList([], [station("a")], {
      ...options,
      splits: { "rws/a": [{ since: "2020-03-06", note: "the zero moved" }] },
    });
    assert.deepEqual(
      changes.map((c) => [c.event, c.key]),
      [["opened", "rws/a start"]],
    );
    assert.match(changes[0]!.reason!, /backfill the station from 2020-03-06/);
  });

  it("keeps stations the source dropped, inactive, and the committed tide_station", () => {
    const previous = [held("a", { tide_station: "ticon/a" }), held("b")];
    const { stations } = mergeStationList(previous, [station("a")], options);
    assert.deepEqual(
      stations.map((s) => [s.id, s.status, s.tide_station]),
      [
        ["rws/a", "active", "ticon/a"],
        ["rws/b", "inactive", null],
      ],
    );
  });

  it("leaves first and last to the store", () => {
    const filled = { first: "2000-01-01T00:00:00Z", last: "2026-01-01T00:00:00Z" };
    const { stations } = mergeStationList(
      [held("a", filled), held("b", filled), held("c", filled)],
      [station("a", filled), station("b", { datum: "MSL" })],
      options,
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

  it("keeps a station active in a new epoch when its datum changes", () => {
    const previous = [held("a", { datums: { LAT: -1.2 } })];
    const moved = mergeStationList(
      previous,
      [station("a", { datum: "MSL", datums: { LAT: -1.5 } })],
      options,
    );
    assert.deepEqual(moved.changes, [
      {
        id: "rws/a",
        event: "opened",
        from: "NAP",
        to: "MSL",
        reason: undefined,
        key: `rws/a ${options.now}`,
      },
    ]);
    const [a] = moved.stations;
    assert.deepEqual([a!.datum, a!.datums, a!.status], ["MSL", { LAT: -1.5 }, "active"]);
    assert.deepEqual(
      a!.epochs.map((e) => [e.id, e.datum, e.datums, e.state]),
      [
        [1, "NAP", { LAT: -1.2 }, "closed"],
        [2, "MSL", { LAT: -1.5 }, "open"],
      ],
    );
  });

  it("opens an epoch when the source says the series moved under the same datum", () => {
    const previous = [held("a", { datums: { NAVD88: 1.2 } }), held("b")];
    const moved = (old: Station, listed: ListedStation) =>
      old.id === "rws/a" && listed.datums.NAVD88 !== old.datums.NAVD88
        ? `gage datum is now ${listed.datums.NAVD88} m above NAVD88`
        : null;
    const merged = mergeStationList(
      previous,
      [station("a", { datums: { NAVD88: 1.5 } }), station("b")],
      { ...options, seriesChanged: moved },
    );
    assert.deepEqual(merged.changes, [
      {
        id: "rws/a",
        event: "opened",
        from: "NAP",
        to: "NAP",
        reason: "gage datum is now 1.5 m above NAVD88",
        key: `rws/a ${options.now}`,
      },
    ]);
    const [a, b] = merged.stations;
    assert.deepEqual(
      a!.epochs.map((e) => [e.id, e.since, e.datums, e.state, e.to_current]),
      [
        [1, null, { NAVD88: 1.2 }, "closed", null],
        [2, options.now, { NAVD88: 1.5 }, "open", 0],
      ],
    );
    assert.equal(a!.status, "active");
    assert.equal(b!.epochs.length, 1);

    // Rejecting that change carries the station on in epoch 1, and doesn't
    // block a different move later.
    const decisions = { [`rws/a ${options.now}`]: { reject: true, note: "a misread altitude" } };
    const later = { ...options, now: "2027-06-01T00:00:00Z", decisions, seriesChanged: moved };
    const rejected = mergeStationList(
      merged.stations,
      [station("a", { datums: { NAVD88: 1.5 } })],
      later,
    );
    assert.deepEqual(
      rejected.stations[0]!.epochs.map((e) => e.state),
      ["open", "rejected"],
    );
    const again = mergeStationList(rejected.stations, [station("a", { datums: { NAVD88: 1.9 } })], {
      ...later,
      now: "2028-06-01T00:00:00Z",
    });
    assert.deepEqual(
      again.changes.map((c) => [c.event, c.reason]),
      [["opened", "gage datum is now 1.9 m above NAVD88"]],
    );
  });

  it("never gives a new datum the old one's offsets", () => {
    const { stations } = mergeStationList(
      [held("a", { datum: "PNP", datums: { NN: 5.2 } })],
      [station("a", { datum: "NN", datums: {} })],
      options,
    );
    assert.deepEqual(stations[0]!.datums, {});
    assert.deepEqual(stations[0]!.epochs[0]!.datums, { NN: 5.2 });
  });

  it("gives a moved zero under the same label only the offsets sent with it", () => {
    const { stations } = mergeStationList(
      [held("a", { datum: "GZ", datums: { NGVD29: 10 } })].map((s) => ({
        ...s,
        epochs: s.epochs.map((e) => ({ ...e, reference: "2001-01-01" })),
      })),
      [
        {
          ...station("a", { datum: "GZ", datums: {} }),
          reference: { id: "2026-01-01", since: "2026-01-01" },
        },
      ],
      options,
    );
    assert.deepEqual(
      stations[0]!.epochs.map((e) => e.datums),
      [{ NGVD29: 10 }, {}],
    );
    assert.deepEqual(stations[0]!.datums, {});
  });

  it("starts a new station's epoch where its source says the reference does", () => {
    const { stations } = mergeStationList(
      [],
      [{ ...station("a"), reference: { id: "2019-11-01", since: "2019-11-02" } }],
      options,
    );
    assert.equal(stations[0]!.epochs[0]!.since, "2019-11-02T00:00:00Z");
    assert.equal("reference" in stations[0]!, false);
  });

  it("keeps the committed datum when the source leaves it out, and skips new stations without one", () => {
    const { stations, changes } = mergeStationList(
      [held("a", { datum: "SKN", datums: { NHN: -5 } })],
      [
        { ...station("a"), datum: null, datums: {} },
        { ...station("b"), datum: null },
      ],
      options,
    );
    assert.deepEqual(changes, []);
    assert.deepEqual(
      stations.map((s) => [s.id, s.datum, s.datums, s.status]),
      [["rws/a", "SKN", { NHN: -5 }, "active"]],
    );
  });

  it("keeps committed offsets when the source sends none this time", () => {
    const { stations } = mergeStationList(
      [held("a", { datums: { MLLW: -2.4 } })],
      [station("a", { datums: {} })],
      options,
    );
    assert.deepEqual(stations[0]!.datums, { MLLW: -2.4 });
  });

  it("refuses an ID that isn't <source>/<source_id>", () => {
    assert.throws(() => mergeStationList([], [station("a", { id: "rws:a" })], options), /rws:a/);
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
