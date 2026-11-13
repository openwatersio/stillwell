import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { HANDLING, published } from "../src/errata.ts";
import { writeLinks } from "../src/links.ts";
import { sourceEntry } from "../src/refresh.ts";
import { Flag, type StoredStation } from "../src/schema.ts";
import { errata, sources } from "../src/sources/index.ts";
import { JUDGE, readAnalysis, writeAnalysis } from "../src/store/analysis.ts";
import {
  ERRATA_SCHEMA,
  FILES,
  SOURCES_SCHEMA,
  columnTypes,
  dataPackage,
  jsonProblems,
  type FileName,
} from "../src/store/files.ts";
import {
  checkFile,
  writeExtremes,
  writeRows,
  writeJson,
  writeJsonArray,
  writeObservations,
  writeOffsets,
  writeRecent,
  writeStationList,
  writeStations,
} from "../src/store/parquet.ts";
import { writeYears } from "../src/store/years.ts";
import { analysisPath } from "../src/store/paths.ts";

// Every field set, so a field added to the type must be added here, where the test below checks that the definition has it.
const STATION: Required<StoredStation> = {
  id: "test/a",
  source: "test",
  source_id: "a",
  name: "A",
  lat: 52,
  lon: 4,
  country_code: "NL",
  kind: "coastal",
  interval_s: 600,
  datum: "NAP",
  datums: { MSL: -0.1 },
  datums_source: { MSL: "source" },
  datums_epoch: { MSL: { start: "2001-01-01", end: "2019-12-31" } },
  datums_attribution: [],
  chart_datum: "LAT",
  frame: "source",
  products: ["levels"],
  first: "2001-01-01T00:00:00Z",
  last: "2026-11-01T00:00:00Z",
  license: "CC0-1.0",
  commercial_use: true,
  attribution: "Test",
  tide_station: null,
  same_as: [],
  preferred: "test/a",
  errata: [],
  status: "active",
  live: true,
  min_interval_s: null,
  source_qc_start: "2019-07-01T00:00:00Z",
  source_qc_start_inferred: false,
  tidal: true,
  tide_m: 0.8,
  source_url: null,
  epochs: [
    {
      id: 1,
      datum: "NAP",
      since: null,
      until: null,
      seen: "2026-11-01T00:00:00Z",
      reference: null,
      reference_since: null,
      datums: { MSL: -0.1 },
      to_current: 0,
      state: "open",
    },
  ],
};

const HOUR = 3_600_000;
const T = Date.UTC(2026, 0, 1);

describe("published file definitions", () => {
  let store: string;
  before(async () => {
    store = await mkdtemp(join(tmpdir(), "files-"));
  });
  after(() => rm(store, { recursive: true }));

  const writers: Record<FileName, (path: string) => Promise<unknown>> = {
    stations: (path) => writeStations(path, [STATION, { ...STATION, id: "test/0" }]),
    lists: (path) => writeStationList(path, [STATION]),
    offsets: (path) =>
      writeOffsets(path, [
        { station: "test/b", epoch: 1, datum: "MSL", offset_m: 0.1 },
        { station: "test/a", epoch: 2, datum: "LAT", offset_m: 1 },
        { station: "test/a", epoch: 1, datum: "MSL", offset_m: 0.1 },
      ]),
    links: () =>
      writeLinks(store, [
        {
          a: "test/b",
          b: "test/c",
          a_epoch: 1,
          b_epoch: 1,
          since: "2025-01-01T00:00:00Z",
          until: "2026-01-01T00:00:00Z",
          hours: 8000,
          offset_m: 0.2,
          spread_m: 0.004,
        },
      ]),
    years: () =>
      writeYears(store, "test", [
        { id: "test/a", epoch: 1, year: 2025, hours: 10, flags: [1, 2, 3, 4, 5], version: "x" },
        { id: "test/b", epoch: null, year: null },
        { id: "test/a", epoch: 1, year: 2024, hours: 10, flags: [1, 2, 3, 4, 5], version: "y" },
      ]),
    analysis: () =>
      writeAnalysis(store, "test", [
        {
          id: "test/a",
          analyzed: "2026-11-01T00:00:00Z",
          rules: "r",
          judge: "j",
          tidal: null,
          tide_m: null,
          days: null,
          drains: null,
          step_s: null,
          requalified: null,
        },
      ]),
    recent: (path) =>
      writeRecent(path, [
        [
          { station: "test/b", epoch: 1, time: T, level: 1, flag: Flag.good, received: T },
          { station: "test/a", epoch: 2, time: T + HOUR, level: 1, flag: Flag.suspect },
          { station: "test/a", epoch: 2, time: T, level: 1, flag: Flag.good, source_flag: 0 },
        ],
      ]),
    obs: (path) =>
      writeObservations(
        path,
        [
          { time: T + HOUR, level: 1.5, flag: Flag.good, source_flag: Flag.good, received: T },
          { time: T, level: 1, flag: Flag.preliminary },
        ],
        "NAP",
      ),
    extremes: (path) =>
      writeExtremes(
        path,
        [
          { time: T + HOUR, level: 1, type: "high", flag: Flag.good },
          { time: T, level: -1, type: "low", flag: Flag.good },
        ],
        "NAP",
      ),
    predictions: (path) =>
      writeObservations(path, [{ time: T, level: 1, flag: Flag.preliminary }], "SKN"),
    "predicted-extremes": (path) =>
      writeExtremes(
        path,
        [{ time: T, level: 1, type: "high", flag: Flag.good, transit: 100, event: 1 }],
        "SKN",
      ),
  };

  for (const [name, write] of Object.entries(writers) as [FileName, typeof writers.obs][]) {
    it(`writes ${FILES[name].path} as its definition says`, async () => {
      const path = join(
        store,
        FILES[name].path
          .replace("<source>", "test")
          .replace(/\[.*?\]/, "")
          .replace(/<(\w+)>/g, "$1"),
      );
      await write(path);
      assert.deepEqual(await checkFile(path, FILES[name]), []);
    });
  }

  it("defines a column for every station field", () => {
    assert.deepEqual(Object.keys(STATION).sort(), FILES.stations.columns.map((c) => c.name).sort());
  });

  it("finds a file that differs", async () => {
    const path = join(store, "differs.parquet");
    await writeObservations(path, [{ time: T, level: 1, flag: Flag.good }], "NAP");
    const { obs, extremes } = FILES;
    assert.deepEqual(await checkFile(path, extremes), [
      "no column type",
      "unexpected columns source_flag, received",
    ]);
    assert.deepEqual(
      await checkFile(path, {
        ...obs,
        columns: obs.columns.map((c) => (c.name === "level_m" ? { ...c, type: "DOUBLE" } : c)),
      }),
      ["level_m is FLOAT, not DOUBLE"],
    );
    assert.deepEqual(
      await checkFile(path, {
        ...obs,
        columns: obs.columns.map((c) => (c.name === "received" ? { ...c, nullable: false } : c)),
      }),
      ["1 nulls in received"],
    );
    await writeOffsets(path, [
      { station: "b", epoch: 1, datum: "MSL", offset_m: 0 },
      { station: "a", epoch: 1, datum: "MSL", offset_m: 0 },
    ]);
    assert.deepEqual(await checkFile(path, { ...FILES.offsets, sort: ["offset_m", "datum"] }), []);
    assert.deepEqual(await checkFile(path, { ...FILES.offsets, sort: ["station DESC"] }), [
      "2 rows out of order",
    ]);
  });

  it("publishes sources.json for every source as its schema says", async () => {
    const path = join(store, "sources.json");
    await writeJsonArray(
      path,
      Object.values(sources).map((s) =>
        sourceEntry(s.metadata, [{ status: "active", commercial_use: true }]),
      ),
    );
    const published = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(jsonProblems(SOURCES_SCHEMA, published), []);
    // A source needs a mailbox or a form.
    for (const contact of [{}, { email: null, url: null }])
      assert.deepEqual(jsonProblems(SOURCES_SCHEMA, [{ ...published[0], contact }]), [
        "$[0].contact: fits none of its 2 forms",
      ]);
  });

  it("publishes errata.json for every erratum as its schema says", async () => {
    const path = join(store, "errata.json");
    await writeJsonArray(path, published(errata));
    assert.deepEqual(jsonProblems(ERRATA_SCHEMA, JSON.parse(await readFile(path, "utf8"))), []);
    assert.deepEqual(
      jsonProblems(ERRATA_SCHEMA, [{ ...published(errata)[0], handling: "x", extra: 1 }]),
      [
        `$[0].handling: "x" isn't one of corrected, flagged, dropped, refused, avoided, kept`,
        "$[0]: unexpected extra",
      ],
    );
    for (const day of ["2019-02-31", "2026-13-01", "2026-11-31"])
      assert.deepEqual(jsonProblems(ERRATA_SCHEMA, [{ ...published(errata)[0], since: day }]), [
        `$[0].since: ${day} isn't a date`,
      ]);
  });

  it("lists every handling an erratum can have", () => {
    assert.deepEqual(ERRATA_SCHEMA.items!.properties!.handling!.enum, [...HANDLING]);
  });

  it("passes an analysis file written before `judge` or `step_s` was kept", async () => {
    const path = join(store, "old-analysis.parquet");
    const { judge: _, step_s: __, ...columns } = columnTypes(FILES.analysis);
    await writeRows(
      path,
      [{ id: "test/a", analyzed: "2026-01-01T00:00:00Z", rules: "r" }],
      columns,
      "id",
    );
    assert.deepEqual(await checkFile(path, FILES.analysis), []);
  });

  it("reads an analysis file an older build rewrote without `step_s` as judged under no `JUDGE`", async () => {
    const { step_s: _, ...columns } = columnTypes(FILES.analysis);
    await writeRows(
      analysisPath(store, "older"),
      [{ id: "older/a", analyzed: "2026-01-01T00:00:00Z", rules: "r", judge: JUDGE }],
      columns,
      "id",
    );
    const row = (await readAnalysis(store, "older")).get("older/a")!;
    assert.deepEqual([row.judge, row.step_s], [null, null]);
  });

  it("refuses to check a local path that would glob other files", async () => {
    await assert.rejects(checkFile(join(store, "obs/test/a*/2026.parquet"), FILES.obs), /glob/);
  });

  it("writes datapackage.json as it is", async () => {
    const path = join(store, "datapackage.json");
    await writeJson(path, dataPackage());
    assert.deepEqual(JSON.parse(await readFile(path, "utf8")), dataPackage());
  });
});
