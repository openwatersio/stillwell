import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { epochKey } from "../src/epochs.ts";
import {
  exists,
  publishedSources,
  readStationList,
  writeObservations,
  writeRecent,
  writeStationList,
  writeStations,
} from "../src/store/parquet.ts";
import {
  boundsPath,
  recentPath,
  seriesPath,
  sourcesPath,
  errataPath,
  stationListPath,
  stationsPath,
  yearsPath,
} from "../src/store/paths.ts";
import type { Erratum } from "../src/errata.ts";
import { KINDS } from "../src/kinds.ts";
import { POSITIONS } from "../src/positions.ts";
import { LINKS, UNLINKS } from "../src/same-as.ts";
import { writeYears } from "../src/store/years.ts";
import {
  describeReport,
  needsPerson,
  publishStations,
  Refused,
  refreshSource,
  startedListOf,
} from "../src/refresh.ts";
import * as pegelonline from "../src/sources/pegelonline/index.ts";
import {
  Flag,
  type Kind,
  type ListedStation,
  type Overrides,
  type Source,
  type SourceMetadata,
} from "../src/schema.ts";

const metadata: SourceMetadata = {
  id: "test",
  name: "Test",
  url: "https://example.org",
  license: {
    id: "CC0-1.0",
    name: "CC0",
    url: "https://example.org",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "Test",
  contact: { url: "https://example.org/contact" },
  hourly: true,
  finalizes: true,
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

// The real link decisions name stations these lists don't have, which would report them as dropped.
const DECISIONS = [...LINKS];
const APART = [...UNLINKS];
before(() => {
  LINKS.splice(0);
  UNLINKS.splice(0);
});
after(() => {
  LINKS.push(...DECISIONS);
  UNLINKS.push(...APART);
});

const NOW = "2026-11-05T00:00:00Z";
const LATER = "2026-12-05T00:00:00Z";

describe("refreshSource", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "store-"));
  });
  afterEach(() => rm(store, { recursive: true }));

  it("moves the stations POSITIONS names, and reports one the source has moved", async () => {
    const uhslc = (fields: Partial<ListedStation>[]): Source => ({
      metadata: { ...metadata, id: "uhslc" },
      stations: async () =>
        Object.entries(POSITIONS)
          .filter(([id]) => id.startsWith("uhslc/"))
          .map(([id, { served }], i) =>
            listed(id.slice(6), { id, source: "uhslc", ...served, ...fields[i] }),
          ),
    });
    const { stations } = await refreshSource(store, uhslc([]), { now: NOW });
    assert.deepEqual(
      stations.find((s) => s.id === "uhslc/290a")!.lat,
      POSITIONS["uhslc/290a"]!.at.lat,
    );
    const moved = await refreshSource(store, uhslc([{ lat: 0 }]), { now: LATER });
    const id = Object.keys(POSITIONS).find((k) => k.startsWith("uhslc/"))!;
    assert.equal(moved.stations.find((s) => s.id === id)!.lat, 0);
    assert.match(moved.report.positions.join(), new RegExp(`^${id} is now at 0,`));
    assert.match(describeReport(moved.report).join("\n"), /check its entry in POSITIONS/);
  });

  it("gives the stations KINDS names their kind, and reports one the source now gives another", async () => {
    const rws = (kind: Kind | null): Source => ({
      metadata: { ...metadata, id: "rws" },
      stations: async () =>
        Object.keys(KINDS)
          .filter((id) => id.startsWith("rws/"))
          .map((id) => listed(id.slice(4), { id, source: "rws", kind })),
    });
    const { stations, report } = await refreshSource(store, rws(null), { now: NOW });
    assert.equal(stations.find((s) => s.id === "rws/uithuizerwad")!.kind, "coastal");
    assert.deepEqual(report.kinds, []);
    const changed = await refreshSource(store, rws("lake"), { now: LATER });
    assert.equal(changed.stations.find((s) => s.id === "rws/uithuizerwad")!.kind, "lake");
    assert.match(changed.report.kinds.join(), /rws\/uithuizerwad is now lake by its source/);
    assert.ok(needsPerson(changed.report));
    assert.match(describeReport(changed.report).join("\n"), /remove its entry from KINDS/);
    // The source's kind stays, and stays reported, run after run.
    const again = await refreshSource(store, rws("lake"), { now: "2027-01-05T00:00:00Z" });
    assert.equal(again.stations.find((s) => s.id === "rws/uithuizerwad")!.kind, "lake");
    assert.match(again.report.kinds.join(), /rws\/uithuizerwad is now lake by its source/);
  });

  it("writes a source's first list, then snapshots it before the next", async () => {
    const first = await refreshSource(store, sourceOf([listed("a"), listed("b")]), { now: NOW });
    assert.deepEqual(first.report.added, ["test/a", "test/b"]);
    assert.equal((await readStationList(stationListPath(store, "test")))!.length, 2);

    const next = await refreshSource(store, sourceOf([listed("a", { name: "Ay" })]), {
      now: LATER,
    });
    assert.deepEqual(next.report.retired, ["test/b"]);
    assert.deepEqual(next.report.changed, [
      { id: "test/a", fields: ["name"] },
      { id: "test/b", fields: ["status"] },
    ]);
    const history = (await readdir(join(store, "history/stations/test"))).sort();
    assert.deepEqual(history, [
      "2026-11-05T000000Z.json",
      "2026-11-05T000000Z.parquet",
      "2026-12-05T000000Z.json",
      "2026-12-05T000000Z.parquet",
    ]);
    // Each snapshot is the list as its refresh started: none, then the first.
    assert.deepEqual(await readStationList(join(store, "history/stations/test", history[1]!)), []);
    const snapshot = await readStationList(join(store, "history/stations/test", history[3]!));
    assert.deepEqual(
      snapshot!.map((s) => [s.id, s.name, s.status]),
      [
        ["test/a", "a", "active"],
        ["test/b", "b", "active"],
      ],
    );
  });

  it("gives a source whose history comes in today's reference first epochs with no start", async () => {
    const reference = { id: "2019-11-01", since: "2019-11-02" };
    const source = {
      ...sourceOf([listed("a", { reference })]),
      metadata: { ...metadata, archive: "current" as const },
    };
    await refreshSource(store, source, { now: NOW });
    const [epoch] = (await readStationList(stationListPath(store, "test")))![0]!.epochs;
    assert.deepEqual([epoch!.since, epoch!.reference_since], [null, "2019-11-02T00:00:00Z"]);
  });

  it("refuses to start over when the list is gone but its history isn't", async () => {
    await refreshSource(store, sourceOf([listed("a")]), { now: NOW });
    await rm(stationListPath(store, "test"));
    await assert.rejects(
      refreshSource(store, sourceOf([listed("a")]), { now: LATER }),
      (e) => e instanceof Refused && /history for test but no list/.test(e.message),
    );
  });

  it("refuses to start a list over a recent window the store already has", async () => {
    await writeRecent(recentPath(store, "test"), [
      [{ station: "test/a", time: Date.parse(NOW), level: 1, flag: Flag.good, epoch: 1 }],
    ]);
    await assert.rejects(
      refreshSource(store, sourceOf([listed("a")]), { now: NOW }),
      /has test series but no list or history/,
    );
  });

  it("refuses to start a list over the source's series already in the store", async () => {
    await writeObservations(
      seriesPath(store, "levels", "test", "a", 2024),
      [{ time: Date.parse(NOW), level: 1, flag: Flag.good }],
      "NAP",
    );
    await assert.rejects(
      refreshSource(store, sourceOf([listed("a")]), { now: NOW }),
      (e) => e instanceof Refused && /has test series but no list or history/.test(e.message),
    );
  });

  it("refuses a list that shrank sharply or came back empty", async () => {
    const many = Array.from({ length: 30 }, (_, i) => listed(String(i)));
    await refreshSource(store, sourceOf(many), { now: NOW });
    await assert.rejects(
      refreshSource(store, sourceOf(many.slice(0, 10)), { now: LATER }),
      /lists 10 stations, down from 30/,
    );
    await assert.rejects(refreshSource(store, sourceOf([]), { now: LATER }), /listed no stations/);
    // A new source's first fetch can't be empty either.
    const other = { ...sourceOf([]), metadata: { ...metadata, id: "other" } };
    await assert.rejects(refreshSource(store, other, { now: NOW }), /listed no stations/);
    // Nor one whose stations all lack the datum a new station needs.
    const nameless = {
      ...sourceOf([
        listed("a", { id: "other/a", source: "other", datum: null as unknown as string }),
      ]),
      metadata: { ...metadata, id: "other" },
    };
    await assert.rejects(refreshSource(store, nameless, { now: NOW }), /no stations with a datum/);
  });

  it("refuses a station from another source", async () => {
    await assert.rejects(
      refreshSource(store, sourceOf([listed("a", { source: "rws", id: "rws/a" })]), { now: NOW }),
      /rws\/a isn't a test station/,
    );
  });

  it("lists a station whose commercial use differs from its source's default", async () => {
    await refreshSource(store, sourceOf([listed("a", { commercial_use: false })]), { now: NOW });
    const [a] = (await readStationList(stationListPath(store, "test")))!;
    assert.equal(a!.commercial_use, false);
  });

  it("refuses many datum changes at once until --accept-epochs accepts them", async () => {
    const stations = Array.from({ length: 10 }, (_, i) => listed(String(i)));
    await refreshSource(store, sourceOf(stations), { now: NOW });
    const moved = stations.map((s) => ({ ...s, datum: "MSL" }));
    await assert.rejects(
      refreshSource(store, sourceOf(moved), { now: LATER }),
      /10 stations changed datum at once \(limit 5\)/,
    );
    const { report } = await refreshSource(store, sourceOf(moved), {
      now: LATER,
      acceptEpochs: true,
    });
    assert.equal(report.epochs.filter((e) => e.event === "opened").length, 10);
  });

  it("numbers a new epoch above any epoch files already in the store", async () => {
    await refreshSource(store, sourceOf([listed("a")]), { now: NOW });
    // Files from an epoch 3 that a restored list no longer knows about.
    await writeObservations(
      seriesPath(store, "levels", "test", "a", 2026, 3),
      [{ time: Date.parse(NOW), level: 1, flag: Flag.good }],
      "MSL",
    );
    const { stations } = await refreshSource(store, sourceOf([listed("a", { datum: "MSL" })]), {
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

  it("counts a field a stored station leaves out as null, not a change", async () => {
    await refreshSource(store, sourceOf([listed("a")]), { now: NOW });
    const { report } = await refreshSource(
      store,
      sourceOf([{ ...listed("a"), series_end: null } as ListedStation]),
      { now: LATER },
    );
    assert.deepEqual(report.changed, []);
  });

  it("tells a station the source retired itself from one it stopped listing", async () => {
    await refreshSource(store, sourceOf([listed("a"), listed("b")]), { now: NOW });
    const { report } = await refreshSource(store, sourceOf([listed("a", { status: "inactive" })]), {
      now: LATER,
    });
    assert.deepEqual([report.retired, report.withdrawn], [["test/a", "test/b"], ["test/a"]]);
  });

  it("doesn't count a GESLA record it drops for another gauge's values as withdrawn", async () => {
    const uddevalla = {
      id: "gesla/uddevalla-2541-swe-smhi",
      source: "gesla",
      source_id: "uddevalla-2541-swe-smhi",
    };
    const gesla = (station: ListedStation): Source => ({
      ...sourceOf([station]),
      metadata: { ...metadata, id: "gesla" },
    });
    await refreshSource(store, gesla(listed("a", uddevalla)), { now: NOW });
    const { report } = await refreshSource(
      store,
      gesla(listed("a", { ...uddevalla, status: "inactive", products: [] })),
      { now: LATER },
    );
    assert.deepEqual([report.retired, report.withdrawn], [["gesla/uddevalla-2541-swe-smhi"], []]);
  });

  it("numbers a new epoch above files for a product the station no longer lists", async () => {
    await refreshSource(store, sourceOf([listed("a")]), { now: NOW });
    await writeObservations(
      seriesPath(store, "predictions", "test", "a", 2026, 2),
      [{ time: Date.parse(NOW), level: 1, flag: Flag.good }],
      "NAP",
    );
    const { stations } = await refreshSource(store, sourceOf([listed("a", { datum: "MSL" })]), {
      now: LATER,
    });
    assert.deepEqual(
      stations[0]!.epochs.map((e) => e.id),
      [1, 3],
    );
  });

  it("numbers a new epoch above an epoch only the recent window still has", async () => {
    await refreshSource(store, sourceOf([listed("a")]), { now: NOW });
    // Rows from an epoch 2 that a restored list no longer knows about.
    await writeRecent(recentPath(store, "test"), [
      [{ station: "test/a", time: Date.parse(NOW), level: 1, flag: Flag.good, epoch: 2 }],
    ]);
    const { stations } = await refreshSource(store, sourceOf([listed("a", { datum: "MSL" })]), {
      now: LATER,
    });
    assert.deepEqual(
      stations[0]!.epochs.map((e) => e.id),
      [1, 3],
    );
  });

  it("numbers a station new to the list above epoch files already in the store", async () => {
    await refreshSource(store, sourceOf([listed("a")]), { now: NOW });
    await writeObservations(
      seriesPath(store, "levels", "test", "b", 2026, 2),
      [{ time: Date.parse(NOW), level: 1, flag: Flag.good }],
      "NAP",
    );
    const { stations } = await refreshSource(store, sourceOf([listed("a"), listed("b")]), {
      now: LATER,
    });
    assert.deepEqual(
      stations.map((s) => s.epochs.map((e) => e.id)),
      [[1], [3]],
    );
  });

  it("finds epoch files for many new stations with one listing per product", async () => {
    // The source has a list, so the epoch-3 files aren't another list's lost series.
    await refreshSource(store, sourceOf([listed("x")]), { now: NOW });
    await writeObservations(
      seriesPath(store, "levels", "test", "7", 2026, 3),
      [{ time: Date.parse(NOW), level: 1, flag: Flag.good }],
      "NAP",
    );
    const many = Array.from({ length: 60 }, (_, i) => listed(String(i)));
    const { stations } = await refreshSource(store, sourceOf([listed("x"), ...many]), {
      now: LATER,
    });
    const ids = new Map(stations.map((s) => [s.source_id, s.epochs.map((e) => e.id)]));
    assert.deepEqual([ids.get("7"), ids.get("8")], [[4], [1]]);
  });

  it("applies a decision on an epoch from the source's overrides", async () => {
    await refreshSource(store, sourceOf([listed("a")]), { now: NOW });
    await refreshSource(store, sourceOf([listed("a", { datum: "MSL" })]), { now: LATER });
    const overrides = {
      epochs: { [epochKey("test/a", LATER)]: { reject: true, note: "the adapter misread it" } },
    };
    const { stations } = await refreshSource(
      store,
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

  it("keeps Wachendorf on one epoch, by PEGELONLINE's override (#72)", async () => {
    const wachendorf = (reference: { id: string; since: string } | null) =>
      listed("3500031", {
        id: "pegelonline/3500031",
        source: "pegelonline",
        datum: "PNP",
        datums: { NHN: 12.77 },
        reference,
      });
    const as = (station: ListedStation): Source => ({
      ...pegelonline.source,
      stations: async () => [station],
    });
    // The first refresh to list it didn't read the zero's date; the next one did.
    await refreshSource(store, as(wachendorf(null)), { now: "2026-11-05T14:12:26Z" });
    const { stations } = await refreshSource(
      store,
      as(wachendorf({ id: "2026-06-18", since: "2026-06-19" })),
      { now: "2026-11-06T22:10:13Z" },
    );
    assert.deepEqual(
      stations[0]!.epochs.map((e) => [e.since, e.state]),
      [
        [null, "open"],
        ["2026-06-18T23:00:00Z", "rejected"],
      ],
    );
  });
});

describe("publishStations", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "store-"));
  });
  afterEach(() => rm(store, { recursive: true }));

  it("gives commercial_use in sources.json as true only where every station allows it", async () => {
    const published = async (stations: ListedStation[]) => {
      await refreshSource(store, sourceOf(stations), { now: NOW });
      await publishStations(store, [sourceOf([])], ["test"], []);
      const [source] = JSON.parse(await readFile(sourcesPath(store), "utf8"));
      return source;
    };
    assert.equal(
      (await published([listed("a"), listed("b", { lat: 40 })])).license.commercial_use,
      true,
    );
    const mixed = await published([listed("a"), listed("b", { commercial_use: false, lat: 40 })]);
    assert.deepEqual([mixed.license.commercial_use, mixed.license.id], [false, "CC0-1.0"]);
    // A station the source stopped listing stays in the store, with its series.
    const gone = await published([listed("a")]);
    assert.deepEqual([gone.license.commercial_use, gone.stations], [false, 1]);
  });

  it("publishes every list with its bounds, epochs and links", async () => {
    const { stations } = await refreshSource(
      store,
      sourceOf([
        listed("a", {
          same_as: ["test/b"],
          source_qc_start: "2019-07-01T00:00:00Z",
          source_qc_start_inferred: true,
        }),
        listed("b"),
      ]),
      { now: NOW },
    );
    await writeStations(boundsPath(store, "test"), [
      { ...stations[0]!, first: "2001-01-01T00:00:00Z", last: "2026-11-04T00:00:00Z" },
    ]);
    assert.deepEqual(await publishStations(store, [sourceOf([])], ["test"], []), {
      count: 2,
      links: { pairs: { "test~test": { id: 1 } }, dropped: [], skipped: [], wide: [] },
      datums: { joined: 0, fromTide: 0, computed: 0, far: [], disagree: [] },
      unknownErrata: [],
    });
    assert.deepEqual(await publishedSources(stationsPath(store)), ["test"]);
    // sources.json carries a source's terms, not which jobs ingest runs for it.
    const [published] = JSON.parse(await readFile(sourcesPath(store), "utf8"));
    assert.equal(published.license.id, "CC0-1.0");
    assert.deepEqual(published.contact, { url: "https://example.org/contact" });
    for (const key of ["hourly", "qc", "utc_offsets", "archive"])
      assert.ok(!(key in published), key);
    // A reader tells preliminary values that will change from ones that won't by it.
    assert.equal(published.finalizes, true);
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    await db.run("SET TimeZone = 'UTC'");
    const rows = (
      await db.runAndReadAll(
        `SELECT id, strftime(first, '%Y') AS first, same_as, preferred, errata, len(epochs) AS epochs, strftime(source_qc_start, '%Y-%m-%d %H:%M') AS source_qc_start, source_qc_start_inferred FROM '${stationsPath(store)}' ORDER BY id`,
      )
    ).getRowObjectsJson();
    assert.deepEqual(rows, [
      // The longer record in the store is preferred.
      {
        id: "test/a",
        first: "2001",
        same_as: ["test/b"],
        preferred: "test/a",
        errata: [],
        epochs: "1",
        // Kept through the source's list, where it rides in `extra`.
        source_qc_start: "2019-07-01 00:00",
        source_qc_start_inferred: true,
      },
      {
        id: "test/b",
        first: null,
        same_as: ["test/a"],
        preferred: "test/a",
        errata: [],
        epochs: "1",
        source_qc_start: null,
        source_qc_start_inferred: null,
      },
    ]);
    // errata.json holds the errata of the sources the store holds, here none.
    assert.deepEqual(JSON.parse(await readFile(errataPath(store), "utf8")), []);
  });

  it("prefers a shorter record over a longer one whose values are all flagged", async () => {
    const { stations } = await refreshSource(
      store,
      sourceOf([listed("a", { same_as: ["test/b"] }), listed("b")]),
      { now: NOW },
    );
    await writeStations(boundsPath(store, "test"), [
      { ...stations[0]!, first: "2001-01-01T00:00:00Z", last: "2026-11-04T00:00:00Z" },
      { ...stations[1]!, first: "2025-01-01T00:00:00Z", last: "2026-11-04T00:00:00Z" },
    ]);
    const year = (id: string, flags: number[]) => ({
      id,
      epoch: 1,
      year: 2026,
      hours: 1,
      flags,
      version: "v",
    });
    await writeYears(store, "test", [
      year("test/a", [0, 0, 0, 5, 1]),
      year("test/b", [4, 0, 0, 0, 0]),
    ]);
    await publishStations(store, [sourceOf([])], ["test"], []);
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    const rows = (
      await db.runAndReadAll(`SELECT DISTINCT preferred FROM '${stationsPath(store)}'`)
    ).getRowObjectsJson();
    assert.deepEqual(rows, [{ preferred: "test/b" }]);
  });

  it("publishes without the flag counts when the years file can't be read", async () => {
    await refreshSource(store, sourceOf([listed("a")]), { now: NOW });
    await writeFile(yearsPath(store, "test"), "not parquet");
    assert.equal(
      ((await publishStations(store, [sourceOf([])], ["test"], [])) as { count: number }).count,
      1,
    );
  });

  it("tags each station with its errata, and names a listed station the store lacks", async () => {
    await refreshSource(store, sourceOf([listed("a"), listed("b")]), { now: NOW });
    const erratum = (id: string, source: string, stations: string[] | null): Erratum => ({
      id,
      source,
      stations,
      since: null,
      until: null,
      error: "",
      handling: "kept",
      response: "",
      evidence: null,
      reported: null,
      report: null,
    });
    const errata = [
      erratum("test-a", "test", ["test/a", "test/gone"]),
      erratum("test-every", "test", null),
      // Another source's isn't this store's to report or publish.
      erratum("other-x", "other", ["other/x"]),
    ];
    const result = await publishStations(store, [sourceOf([])], ["test"], errata);
    assert.deepEqual("count" in result && result.unknownErrata, ["test-a test/gone"]);
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    const rows = (
      await db.runAndReadAll(`SELECT id, errata FROM '${stationsPath(store)}' ORDER BY id`)
    ).getRowObjectsJson();
    assert.deepEqual(rows, [
      { id: "test/a", errata: ["test-a", "test-every"] },
      { id: "test/b", errata: ["test-every"] },
    ]);
    assert.deepEqual(
      JSON.parse(await readFile(errataPath(store), "utf8")).map((e: Erratum) => e.id),
      ["test-a", "test-every"],
    );
  });

  it("publishes nothing while a source it should hold has no list", async () => {
    const other: Source = { ...sourceOf([]), metadata: { ...metadata, id: "other" } };
    assert.deepEqual(await publishStations(store, [sourceOf([])], ["test"], []), {
      missing: ["test"],
    });
    await writeStationList(stationListPath(store, "test"), []);
    assert.deepEqual(await publishStations(store, [sourceOf([]), other], ["test", "other"], []), {
      missing: ["other"],
    });
    assert.equal(await exists(stationsPath(store)), false);
    assert.deepEqual(await publishedSources(stationsPath(store)), []);
    // A new source with no list yet doesn't hold up the others.
    assert.deepEqual(await publishStations(store, [sourceOf([]), other], ["test"], []), {
      count: 0,
      links: { pairs: {}, dropped: [], skipped: [], wide: [] },
      datums: { joined: 0, fromTide: 0, computed: 0, far: [], disagree: [] },
      unknownErrata: [],
    });
  });
});

describe("startedListOf", () => {
  let store: string;
  beforeEach(async () => {
    store = await mkdtemp(join(tmpdir(), "store-"));
  });
  afterEach(() => rm(store, { recursive: true }));

  it("is null for a source whose list was never started, and fails for one that's lost", async () => {
    assert.equal(await startedListOf(store, sourceOf([])), null);
    await refreshSource(store, sourceOf([listed("a")]), { now: NOW });
    assert.equal((await startedListOf(store, sourceOf([])))!.length, 1);
    await rm(stationListPath(store, "test"));
    await assert.rejects(startedListOf(store, sourceOf([])), /history for test but no list/);
  });

  it("fails for a store with the source's series but no list or history", async () => {
    await writeRecent(recentPath(store, "test"), []);
    await assert.rejects(startedListOf(store, sourceOf([])), /test series but no list or history/);
  });
});
