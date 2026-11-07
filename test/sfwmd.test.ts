import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as sfwmd from "../src/sources/sfwmd/index.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));

/** Requests made, with their options. */
let requests: [string, RequestOptions][] = [];

/** Answer requests from fixtures, by the first pattern the URL matches. */
function serve(routes: [RegExp, () => string][]): void {
  setTransport(async (url, options) => {
    requests.push([url, options]);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return route[1]();
  });
}

const HEADER =
  "TIMESERIESID,STATION,SOURCE_TIMESERIES,PARAMETER,TIMESTAMP,VALUE,CODE,REVISION_DATE,QUALITY_CODE";

/** A DBHYDRO CSV for `dbkey`, from `time,value,code,quality` rows. */
const csv = (dbkey: string, rows: string[]) =>
  [
    "# notes",
    HEADER,
    ...rows.map(
      (r) => `"${dbkey}","S123_T","S123-T",STG,${r.replace(/,([^,]*),([^,]*)$/, ",$1, ,$2")}`,
    ),
  ].join("\n");

/** A zip holding `text` as its one file, stored uncompressed, as base64. */
function zipOf(text: string): string {
  const data = Buffer.from(text);
  const name = Buffer.from("sfwmd-data.csv");
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + data.length, 16);
  return Buffer.concat([local, name, data, central, name, end]).toString("base64");
}

/** An empty zip is its end-of-directory record alone, which DBHYDRO sends for a range with no readings. */
const EMPTY = Buffer.from([0x50, 0x4b, 5, 6, ...new Array(18).fill(0)]).toString("base64");

const catalog: [RegExp, () => string][] = [
  [/\/cont\/ts$/, () => fixture("sfwmd-catalog.json").toString("utf8")],
];
const zips: [RegExp, () => string][] = [
  [/timeseriesIds=IY320/, () => fixture("sfwmd-IY320.zip").toString("base64")],
  [/timeseriesIds=AP159/, () => fixture("sfwmd-AP159.zip").toString("base64")],
];

describe("sfwmd", () => {
  sfwmd.pacing.requestMs = 0;

  beforeEach(() => {
    requests = [];
  });

  afterEach(() => {
    setTransport(fetchText);
  });

  it("lists the tidal stations, each with its derived and telemetry series", async () => {
    serve(catalog);
    const stations = (await sfwmd.stations()) as sfwmd.SfwmdStation[];
    assert.deepEqual(
      stations.map((s) => [s.id, s.status, s.kind, s.series, s.history, s.history_end]),
      [
        ["sfwmd/GORDON_2_T", "active", "estuary", "QS283", "67935", "2026-05-08T05:00:00.000Z"],
        ["sfwmd/MBTS", "inactive", "coastal", "15078", null, null],
        ["sfwmd/S123_T", "active", "estuary", "IY320", "AP159", "2026-05-11T05:00:00.000Z"],
        // AT061 ends as late but starts in 2025.
        ["sfwmd/S21_T", "active", "estuary", "06600", "AP155", "2026-05-13T05:00:00.000Z"],
      ],
    );
    const s123 = stations.find((s) => s.id === "sfwmd/S123_T")!;
    assert.equal(s123.name, "S-123 Structure On Canal C-100 At Tidewater (Tailwater)");
    assert.equal(s123.lat, 25.610775);
    assert.equal(s123.lon, -80.3077);
    assert.equal(s123.datum, "NAVD88");
    assert.equal(s123.live, true);
    // AP159, the derived series, starts in 1979; IY320 in 1985.
    assert.equal(s123.record_start, "1979-12-17T05:00:00.000Z");
    assert.equal(requests[0]![1].method, "POST");
    assert.equal(requests[0]![1].fresh, true);
  });

  it("refuses an empty catalog and a series in another unit", async () => {
    serve([[/\/cont\/ts$/, () => JSON.stringify({ results: [] })]]);
    await assert.rejects(sfwmd.stations(), /listed no series/);
    const series = JSON.parse(fixture("sfwmd-catalog.json").toString("utf8")).results.filter(
      (s: sfwmd.CatalogSeries) => s.location === "MBTS",
    );
    assert.throws(
      () => sfwmd.toStation("MBTS", [{ ...series[0], units: "ft NGVD29" }]),
      /not ft NAVD88/,
    );
  });

  it("ignores a derived series with no end and unread series in other units", () => {
    const series = JSON.parse(fixture("sfwmd-catalog.json").toString("utf8")).results.filter(
      (s: sfwmd.CatalogSeries) => s.location === "S123_T" && s.frequency === "BK",
    ) as sfwmd.CatalogSeries[];
    const open = series.map((s) => (s.timeseriesId === "AP159" ? { ...s, endDate: null } : s));
    const station = sfwmd.toStation("S123_T", open)!;
    assert.equal(station.series, "IY320");
    assert.equal(station.history, null);
    // 04859, the 1979 chart recorder, isn't read.
    const legacy = series.map((s) =>
      s.timeseriesId === "04859" ? { ...s, units: "ft NGVD29" } : s,
    );
    assert.equal(sfwmd.toStation("S123_T", legacy)!.history, "AP159");
    // A derived series with no end and nothing else: nothing to read.
    assert.equal(
      sfwmd.toStation(
        "S123_T",
        open.filter((s) => s.timeseriesId === "AP159"),
      ),
      null,
    );
  });

  it("keeps a closed station's telemetry span and record end", () => {
    const series = JSON.parse(fixture("sfwmd-catalog.json").toString("utf8")).results.filter(
      (s: sfwmd.CatalogSeries) => s.location === "MBTS",
    ) as sfwmd.CatalogSeries[];
    const station = sfwmd.toStation("MBTS", series)!;
    assert.equal(station.status, "inactive");
    // 15078 runs from 1991-06-13 to 2016-12-02, EST days.
    assert.equal(station.series_start, "1991-06-13T05:00:00.000Z");
    assert.equal(station.series_end, "2016-12-03T05:00:00.000Z");
    assert.equal(station.record_end, "2016-12-03T05:00:00.000Z");
  });

  it("doesn't fail when telemetry ended before history_end, and asks nothing after record_end", async () => {
    serve([
      [/AP159/, () => zipOf(csv("AP159", ["2016-03-01 12:00:00,1.0, ,A"]))],
      [/IY320/, () => EMPTY],
    ]);
    const closed = {
      series: "IY320",
      series_start: "1990-01-01T05:00:00Z",
      series_end: "2016-04-01T05:00:00Z",
      history: "AP159",
      history_end: "2016-06-01T05:00:00Z",
      record_end: "2016-06-02T05:00:00Z",
    };
    const levels = await sfwmd.levels(closed, new Date("2016-01-01Z"), new Date("2017-01-01Z"));
    assert.equal(levels.length, 1);
    assert.deepEqual(
      requests.map(([url]) =>
        /timeseriesIds=(\w+).*startDate=(\d+)&endDate=(\d+)/.exec(url)!.slice(1),
      ),
      // The derived series runs to record_end, its last day included.
      [["AP159", "20151231", "20160601"]],
    );
    requests = [];
    assert.deepEqual(
      await sfwmd.levels(closed, new Date("2017-01-01Z"), new Date("2018-01-01Z")),
      [],
    );
    assert.equal(requests.length, 0);
    // Telemetry that only starts after the range has nothing to give either.
    const late = { ...closed, series_start: "2017-01-01T05:00:00Z", record_end: null };
    assert.equal(
      (await sfwmd.levels(late, new Date("2016-01-01Z"), new Date("2017-01-01Z"))).length,
      1,
    );
  });

  it("returns each reading once across a year boundary", async () => {
    serve([
      [
        /./,
        () =>
          zipOf(
            csv("IY320", [
              "2024-12-31 18:00:00,1.0, ,A",
              "2024-12-31 20:00:00,2.0, ,A",
              "2025-12-31 20:00:00,3.0, ,A",
            ]),
          ),
      ],
    ]);
    const levels = await sfwmd.levels(
      { series: "IY320", history: null, history_end: null },
      new Date("2024-01-01Z"),
      new Date("2026-01-01Z"),
    );
    // 2024-12-31 20:00 EST is 2025-01-01 01:00 UTC, which both years' requests return.
    assert.deepEqual(
      levels.map((l) => new Date(l.time).toISOString()),
      ["2024-12-31T23:00:00.000Z", "2025-01-01T01:00:00.000Z"],
    );
  });

  it("reads telemetry in meters at UTC, with provisional values preliminary", async () => {
    serve(zips);
    const levels = await sfwmd.levels(
      { series: "IY320", history: null, history_end: null },
      new Date("2026-11-05T05:00:00Z"),
      new Date("2026-11-07T05:00:00Z"),
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0]![0], /startDate=20261105&endDate=20261106&datum=NAVD88/);
    assert.equal(requests[0]![1].base64, true);
    assert.ok(levels.length > 500);
    assert.ok(levels.every((l, i) => i === 0 || l.time > levels[i - 1]!.time));
    // 2026-11-05 00:03:16 EST, -0.622 ft.
    assert.deepEqual(levels[0], {
      time: Date.parse("2026-11-05T05:03:16Z"),
      level: -0.19,
      flag: Flag.preliminary,
    });
  });

  it("switches from the derived series to telemetry at the start of history_end's month", async () => {
    serve([
      [/AP159/, () => zipOf(csv("AP159", ["2024-01-16 12:00:00,1.0, ,A"]))],
      [/IY320/, () => zipOf(csv("IY320", ["2024-02-16 12:00:00,2.0, ,P"]))],
    ]);
    const station = { series: "IY320", history: "AP159", history_end: "2024-02-10T05:00:00Z" };
    const levels = await sfwmd.levels(station, new Date("2024-01-01Z"), new Date("2024-03-01Z"));
    assert.deepEqual(
      requests.map(([url]) =>
        /timeseriesIds=(\w+).*startDate=(\d+)&endDate=(\d+)/.exec(url)!.slice(1),
      ),
      [
        ["AP159", "20231231", "20240131"],
        ["IY320", "20240131", "20240229"],
      ],
    );
    assert.deepEqual(levels, [
      { time: Date.parse("2024-01-16T17:00:00Z"), level: 0.305, flag: Flag.good },
      { time: Date.parse("2024-02-16T17:00:00Z"), level: 0.61, flag: Flag.preliminary },
    ]);
  });

  it("keeps the derived series until the month after telemetry starts", async () => {
    serve([
      [/AP159/, () => zipOf(csv("AP159", ["2026-04-10 12:00:00,1.0, ,A"]))],
      [/IY320/, () => zipOf(csv("IY320", ["2026-05-10 12:00:00,2.0, ,P"]))],
    ]);
    // A new telemetry dbkey that starts after the derived series ends.
    const station = {
      series: "IY320",
      series_start: "2026-04-25T05:00:00Z",
      history: "AP159",
      history_end: "2026-04-20T05:00:00Z",
    };
    await sfwmd.levels(station, new Date("2026-01-01Z"), new Date("2026-06-01Z"));
    assert.deepEqual(
      requests.map(([url]) =>
        /timeseriesIds=(\w+).*startDate=(\d+)&endDate=(\d+)/.exec(url)!.slice(1),
      ),
      [
        ["AP159", "20251231", "20260430"],
        ["IY320", "20260430", "20260531"],
      ],
    );
  });

  it("leaves the months of a series that sends nothing to the lake", async () => {
    serve([
      [/AP159/, () => EMPTY],
      [/IY320/, () => zipOf(csv("IY320", ["2024-02-16 12:00:00,2.0, ,P"]))],
    ]);
    const station = { series: "IY320", history: "AP159", history_end: "2024-02-10T05:00:00Z" };
    const levels = await sfwmd.levels(station, new Date("2024-01-01Z"), new Date("2024-03-01Z"));
    // January has no values, so a merge keeps the lake's January.
    assert.deepEqual(
      levels.map((l) => new Date(l.time).toISOString()),
      ["2024-02-16T17:00:00.000Z"],
    );
  });

  it("reads telemetry from before the derived series starts, to the next month's start", async () => {
    serve([
      [/AP159/, () => zipOf(csv("AP159", ["1992-03-01 12:00:00,1.0, ,A"]))],
      [/IY320/, () => zipOf(csv("IY320", ["1990-03-01 12:00:00,2.0, ,A"]))],
    ]);
    // G56_T's telemetry starts in 1985, its derived series in September 1991.
    const station = {
      series: "IY320",
      series_start: "1985-05-31T05:00:00Z",
      history: "AP159",
      history_start: "1991-09-02T05:00:00Z",
      history_end: "2026-05-07T05:00:00Z",
    };
    const levels = await sfwmd.levels(station, new Date("1990-01-01Z"), new Date("1993-01-01Z"));
    assert.deepEqual(
      levels.map((l) => l.level),
      [0.61, 0.305],
    );
    assert.deepEqual(
      requests.map(([url]) =>
        /timeseriesIds=(\w+).*startDate=(\d+)&endDate=(\d+)/.exec(url)!.slice(1),
      ),
      [
        ["IY320", "19891231", "19901231"],
        ["IY320", "19901231", "19910930"],
        ["AP159", "19910930", "19911231"],
        ["AP159", "19911231", "19921231"],
      ],
    );
  });

  it("asks once per UTC year, by EST days", async () => {
    serve([[/./, () => EMPTY]]);
    await sfwmd.levels(
      { series: "IY320", history: null, history_end: null },
      new Date("2024-01-01Z"),
      new Date("2026-01-01Z"),
    );
    assert.deepEqual(
      requests.map(([url]) => /startDate=(\d+)&endDate=(\d+)/.exec(url)!.slice(1)),
      [
        ["20231231", "20241231"],
        ["20241231", "20251231"],
      ],
    );
  });

  it("reads a year of three-minute readings", async () => {
    const start = Date.parse("2025-01-01T05:00:00Z");
    const rows = Array.from(
      { length: 175_200 },
      (_, i) =>
        `${new Date(start + i * 180_000 - 5 * 3_600_000).toISOString().slice(0, 19).replace("T", " ")},1, ,A`,
    );
    serve([[/./, () => zipOf(csv("IY320", rows))]]);
    const levels = await sfwmd.levels(
      { series: "IY320", history: null, history_end: null },
      new Date("2025-01-01Z"),
      new Date("2026-01-01Z"),
    );
    assert.equal(levels.length, 175_100);
  });

  it("reads an empty zip as no values, and asks nothing before record_start", async () => {
    serve([[/./, () => EMPTY]]);
    const station = { series: "IY320", history: null, history_end: null };
    assert.deepEqual(
      await sfwmd.levels(station, new Date("1960-01-01Z"), new Date("1961-01-01Z")),
      [],
    );
    requests = [];
    const later = { ...station, record_start: "1985-05-31T05:00:00.000Z" };
    assert.deepEqual(
      await sfwmd.levels(later, new Date("1960-01-01Z"), new Date("1961-01-01Z")),
      [],
    );
    await sfwmd.levels(later, new Date("1985-01-01Z"), new Date("1986-01-01Z"));
    assert.deepEqual(
      requests.map(([url]) => /startDate=(\d+)&endDate=(\d+)/.exec(url)!.slice(1)),
      [["19850531", "19851231"]],
    );
  });

  it("reads a station from stations.parquet by the series its source_url names", async () => {
    serve([[/./, () => EMPTY]]);
    const station = {
      id: "sfwmd/S123_T",
      datum: "NAVD88",
      source_url:
        "https://insightsdata.sfwmd.gov/#/shared-reports?timeseriesIds=IY320&reportType=timeseries",
    } as Station;
    await sfwmd.source.observations!(station, new Date("2026-11-05Z"), new Date("2026-11-06Z"));
    assert.match(requests[0]![0], /timeseriesIds=IY320&/);
    await assert.rejects(
      sfwmd.source.observations!({ ...station, datum: "NGVD29" }, new Date(0), new Date(1)),
      /not NAVD88/,
    );
  });

  it("skips missing readings and flags estimates and unknown codes", () => {
    const text = [
      "# notes",
      "TIMESERIESID,STATION,SOURCE_TIMESERIES,PARAMETER,TIMESTAMP,VALUE,CODE,REVISION_DATE,QUALITY_CODE",
      '"AP159","S123_T","S123-D-L",STG,2024-01-17 07:29:12, ,M, ,P',
      '"AP159","S123_T","S123-D-L",STG,2024-01-17 07:44:12,0.000,M, ,P',
      '"AP159","S123_T","S123-D-L",STG,2024-02-20 09:00:40,-0.503,E, ,A',
      '"AP159","S123_T","S123-D-L",STG,2024-05-02 12:46:27,-0.533,V, ,A',
      '"AP159","S123_T","S123-D-L",STG,2024-05-02 12:50:18,-0.508,X, ,A',
    ].join("\n");
    assert.deepEqual(
      sfwmd.parse(text, "AP159").map((o) => o.flag),
      [Flag.interpolated, Flag.good, Flag.suspect],
    );
    assert.throws(() => sfwmd.parse(text, "IY320"), /row for AP159/);
    assert.throws(() => sfwmd.parse("# only notes", "AP159"), /no data table/);
    assert.throws(
      () => sfwmd.parse(csv("AP159", ["2024-01-17 07:44:12,--, ,P"]), "AP159"),
      /bad row/,
    );
    assert.throws(
      () => sfwmd.parse(csv("AP159", ["2024-02-30 07:44:12,1.0, ,P"]), "AP159"),
      /bad row/,
    );
  });

  it("decodes packed degrees", () => {
    assert.equal(sfwmd.degrees(253638.79), 25.610775);
  });
});
