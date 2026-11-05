import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { epochKey } from "../src/epochs.ts";
import {
  exists,
  readStationList,
  writeObservations,
  writeStationList,
  writeStations,
} from "../src/lake/parquet.ts";
import { boundsPath, seriesPath, stationListPath, stationsPath } from "../src/lake/paths.ts";
import { publishStations, Refused, refreshSource, seedSource } from "../src/refresh.ts";
import {
  Flag,
  type ListedStation,
  type Overrides,
  type Source,
  type SourceMetadata,
} from "../src/schema.ts";

const metadata: SourceMetadata = {
  id: "test",
  name: "Test",
  url: "https://example.org",
  license: { id: "CC0-1.0", name: "CC0", url: "https://example.org", commercial_use: true },
  attribution: "Test",
};

const listed = (code: string, fields: Partial<ListedStation> = {}): ListedStation => ({
  id: `test/${code}`,
  source: "test",
  source_id: code,
  name: code,
  lat: 1,
  lon: 2,
  country_code: null,
  kind: null,
  interval_s: 600,
  datum: "NAP",
  datums: {},
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
  min_interval_s: null,
  source_url: null,
  ...fields,
});

const sourceOf = (stations: ListedStation[], overrides?: Overrides): Source => ({
  metadata,
  overrides,
  stations: async () => stations,
});

const NOW = "2026-11-05T00:00:00Z";
const LATER = "2026-12-05T00:00:00Z";

describe("refreshSource", () => {
  let lake: string;
  beforeEach(async () => {
    lake = await mkdtemp(join(tmpdir(), "lake-"));
  });
  afterEach(() => rm(lake, { recursive: true }));

  it("writes a source's first list, then snapshots it before the next", async () => {
    const first = await refreshSource(lake, sourceOf([listed("a"), listed("b")]), { now: NOW });
    assert.deepEqual(first.report.added, ["test/a", "test/b"]);
    assert.equal((await readStationList(stationListPath(lake, "test")))!.length, 2);

    const next = await refreshSource(lake, sourceOf([listed("a", { name: "Ay" })]), {
      now: LATER,
    });
    assert.deepEqual(next.report.retired, ["test/b"]);
    assert.deepEqual(next.report.changed, [
      { id: "test/a", fields: ["name"] },
      { id: "test/b", fields: ["status"] },
    ]);
    const history = (await readdir(join(lake, "history/stations/test"))).sort();
    assert.deepEqual(history, ["2026-12-05T000000Z.json", "2026-12-05T000000Z.parquet"]);
    // The snapshot is the list as the refresh started.
    const snapshot = await readStationList(join(lake, "history/stations/test", history[1]!));
    assert.deepEqual(
      snapshot!.map((s) => [s.id, s.name, s.status]),
      [
        ["test/a", "a", "active"],
        ["test/b", "b", "active"],
      ],
    );
  });

  it("refuses to start over when the list is gone but its history isn't", async () => {
    await refreshSource(lake, sourceOf([listed("a")]), { now: NOW });
    await refreshSource(lake, sourceOf([listed("a")]), { now: LATER });
    await rm(stationListPath(lake, "test"));
    await assert.rejects(
      refreshSource(lake, sourceOf([listed("a")]), { now: LATER }),
      (e) => e instanceof Refused && /history for test but no list/.test(e.message),
    );
  });

  it("refuses a list that shrank sharply or came back empty", async () => {
    const many = Array.from({ length: 30 }, (_, i) => listed(String(i)));
    await refreshSource(lake, sourceOf(many), { now: NOW });
    await assert.rejects(
      refreshSource(lake, sourceOf(many.slice(0, 10)), { now: LATER }),
      /lists 10 stations, down from 30/,
    );
    await assert.rejects(refreshSource(lake, sourceOf([]), { now: LATER }), /listed no stations/);
  });

  it("refuses a station from another source", async () => {
    await assert.rejects(
      refreshSource(lake, sourceOf([listed("a", { source: "rws", id: "rws/a" })]), { now: NOW }),
      /rws\/a isn't a test station/,
    );
  });

  it("refuses a station whose terms differ from its source's", async () => {
    await assert.rejects(
      refreshSource(lake, sourceOf([listed("a", { commercial_use: false })]), { now: NOW }),
      /split the source in two/,
    );
  });

  it("refuses many datum changes at once until a person accepts them", async () => {
    const stations = Array.from({ length: 10 }, (_, i) => listed(String(i)));
    await refreshSource(lake, sourceOf(stations), { now: NOW });
    const moved = stations.map((s) => ({ ...s, datum: "MSL" }));
    await assert.rejects(
      refreshSource(lake, sourceOf(moved), { now: LATER }),
      /10 stations changed datum at once \(limit 5\)/,
    );
    const { report } = await refreshSource(lake, sourceOf(moved), {
      now: LATER,
      acceptEpochs: true,
    });
    assert.equal(report.epochs.filter((e) => e.event === "opened").length, 10);
  });

  it("numbers a new epoch above any epoch files already in the lake", async () => {
    await refreshSource(lake, sourceOf([listed("a")]), { now: NOW });
    // Files from an epoch 3 that a restored list no longer knows about.
    await writeObservations(
      seriesPath(lake, "levels", "test", "a", 2026, 3),
      [{ time: Date.parse(NOW), level: 1, flag: Flag.good }],
      "MSL",
    );
    const { stations } = await refreshSource(lake, sourceOf([listed("a", { datum: "MSL" })]), {
      now: LATER,
    });
    assert.deepEqual(
      stations[0]!.epochs.map((e) => [e.id, e.datum]),
      [
        [1, "NAP"],
        [4, "MSL"],
      ],
    );
  });

  it("tells a station the source retired itself from one it stopped listing", async () => {
    await refreshSource(lake, sourceOf([listed("a"), listed("b")]), { now: NOW });
    const { report } = await refreshSource(lake, sourceOf([listed("a", { status: "inactive" })]), {
      now: LATER,
    });
    assert.deepEqual([report.retired, report.withdrawn], [["test/a", "test/b"], ["test/a"]]);
  });

  it("numbers a station new to the list above epoch files already in the lake", async () => {
    await refreshSource(lake, sourceOf([listed("a")]), { now: NOW });
    await writeObservations(
      seriesPath(lake, "levels", "test", "b", 2026, 2),
      [{ time: Date.parse(NOW), level: 1, flag: Flag.good }],
      "NAP",
    );
    const { stations } = await refreshSource(lake, sourceOf([listed("a"), listed("b")]), {
      now: LATER,
    });
    assert.deepEqual(
      stations.map((s) => s.epochs.map((e) => e.id)),
      [[1], [3]],
    );
  });

  it("applies a person's decision on an epoch from the source's overrides", async () => {
    await refreshSource(lake, sourceOf([listed("a")]), { now: NOW });
    await refreshSource(lake, sourceOf([listed("a", { datum: "MSL" })]), { now: LATER });
    const overrides = {
      epochs: { [epochKey("test/a", LATER)]: { reject: true, note: "the adapter misread it" } },
    };
    const { stations } = await refreshSource(
      lake,
      sourceOf([listed("a", { datum: "MSL" })], overrides),
      { now: "2027-01-05T00:00:00Z" },
    );
    assert.deepEqual(
      stations[0]!.epochs.map((e) => [e.datum, e.state]),
      [
        ["NAP", "open"],
        ["MSL", "rejected"],
      ],
    );
    assert.equal(stations[0]!.datum, "NAP");
  });
});

describe("seedSource", () => {
  let lake: string;
  beforeEach(async () => {
    lake = await mkdtemp(join(tmpdir(), "lake-"));
  });
  afterEach(() => rm(lake, { recursive: true }));

  it("seeds one epoch per station, starting USACE's at its zero date, once", async () => {
    const usace = { ...metadata, utc_offsets: [-6, -4] as [number, number] };
    const committed = [
      { ...listed("a"), datum: "GZ", zero_since: "2015-06-29" },
      { ...listed("b"), datum: "GZ" },
    ];
    const seeded = await seedSource(lake, usace, committed, NOW);
    assert.deepEqual(
      seeded.map((s) => s.epochs.map((e) => [e.id, e.since, e.reference])),
      [[[1, "2015-06-29T06:00:00Z", "2015-06-29"]], [[1, null, null]]],
    );
    assert.deepEqual(await readStationList(stationListPath(lake, "test")), seeded);
    await assert.rejects(seedSource(lake, usace, committed, NOW), /already exists/);
    // A seeded list that goes missing is refused, not rebuilt from the fetch.
    await rm(stationListPath(lake, "test"));
    await assert.rejects(
      refreshSource(lake, { metadata: usace, stations: async () => [] }, { now: LATER }),
      /history for test but no list/,
    );
  });
});

describe("publishStations", () => {
  let lake: string;
  beforeEach(async () => {
    lake = await mkdtemp(join(tmpdir(), "lake-"));
  });
  afterEach(() => rm(lake, { recursive: true }));

  it("publishes every list with its bounds, epochs and links", async () => {
    const { stations } = await refreshSource(
      lake,
      sourceOf([listed("a", { same_as: ["test/b"] }), listed("b")]),
      { now: NOW },
    );
    await writeStations(boundsPath(lake, "test"), [
      { ...stations[0]!, first: "2001-01-01T00:00:00Z", last: "2026-11-04T00:00:00Z" },
    ]);
    assert.deepEqual(await publishStations(lake, [sourceOf([])], ["test"]), { count: 2 });
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    await db.run("SET TimeZone = 'UTC'");
    const rows = (
      await db.runAndReadAll(
        `SELECT id, strftime(first, '%Y') AS first, same_as, len(epochs) AS epochs FROM '${stationsPath(lake)}' ORDER BY id`,
      )
    ).getRowObjectsJson();
    assert.deepEqual(rows, [
      { id: "test/a", first: "2001", same_as: ["test/b"], epochs: "1" },
      { id: "test/b", first: null, same_as: ["test/a"], epochs: "1" },
    ]);
  });

  it("publishes nothing while a source it should hold has no list", async () => {
    const other: Source = { ...sourceOf([]), metadata: { ...metadata, id: "other" } };
    assert.deepEqual(await publishStations(lake, [sourceOf([])], ["test"]), { missing: ["test"] });
    await writeStationList(stationListPath(lake, "test"), []);
    assert.deepEqual(await publishStations(lake, [sourceOf([]), other], ["test", "other"]), {
      missing: ["other"],
    });
    assert.equal(await exists(stationsPath(lake)), false);
    // A new source with no list yet doesn't hold up the others.
    assert.deepEqual(await publishStations(lake, [sourceOf([]), other], ["test"]), { count: 0 });
  });
});
