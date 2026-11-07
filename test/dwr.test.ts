import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as dwr from "../src/sources/dwr/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Requests made, with their options. */
let requests: [string, RequestOptions][] = [];

/** Answer requests by the first route whose pattern the URL matches. */
function serve(routes: [RegExp, (options: RequestOptions, url: string) => string][]): void {
  setTransport(async (url, options) => {
    requests.push([url, options]);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return route[1](options, url);
  });
}

/** Fisherman's Cut's file head, as the station in `url` would have it. */
const headFor = (_: RequestOptions, url: string) =>
  fixture("dwr-B95050Q-head.csv").replace('"B95050Q"', `"${/por\/([A-Z0-9]+)_/.exec(url)![1]}"`);

const rangeOf = (options: RequestOptions) =>
  (options.headers as Record<string, string> | undefined)?.range ?? null;

/** Fisherman's Cut's file, recorded on 7 November 2026; its last reading is 11/05/2026 10:45 PST. */
const RECORDED = Date.parse("2026-11-07T19:00:00Z");
const fishermans = {
  source_id: "B95050Q",
  parameter: "WaterSurfaceElevationNAVD88" as const,
  datum: "NAVD88",
  record_start: "2015-10-01T08:00:00.000Z",
};

describe("dwr", () => {
  beforeEach(() => {
    requests = [];
    dwr.forgetFiles();
    mock.timers.enable({ apis: ["Date"], now: RECORDED });
  });

  afterEach(() => {
    setTransport(fetchText);
    mock.timers.reset();
  });

  it("lists TICON's stations with a raw level file, NAVD88 where there is one", async () => {
    serve([
      [/stations\.csv$/, () => fixture("dwr-stations.csv")],
      [/station-trace-download-links\.csv$/, () => fixture("dwr-traces.csv")],
      [
        /B95325_StreamLevel/,
        (options, url) =>
          headFor(options, url).replace(
            "287.00 - Water Surface Elevation (NAVD88)",
            "233.00 - Corrected Stage",
          ),
      ],
      [/wdlcontinuous/, headFor],
    ]);
    const stations = (await dwr.stations()) as dwr.DwrStation[];
    assert.deepEqual(
      stations.map((s) => [s.id, s.datum, s.parameter, s.status, s.record_start, s.record_end]),
      [
        ["dwr/A02100", "GZ", "StreamLevel", "active", "1983-10-01T08:00:00.000Z", null],
        // Silent since 1999, so inactive, and nothing is asked for after its last reading.
        [
          "dwr/B91110",
          "GZ",
          "StreamLevel",
          "inactive",
          "1982-10-01T08:00:00.000Z",
          "1999-10-04T17:00:00.000Z",
        ],
        [
          "dwr/B95050Q",
          "NAVD88",
          "WaterSurfaceElevationNAVD88",
          "active",
          "2015-10-01T08:00:00.000Z",
          null,
        ],
        ["dwr/B95325", "GZ", "StreamLevel", "active", "1998-10-01T08:00:00.000Z", null],
      ],
    );
    const fc = stations.find((s) => s.id === "dwr/B95050Q")!;
    assert.equal(fc.name, "Fisherman's Cut");
    assert.equal(fc.lat, 38.0656);
    assert.equal(fc.lon, -121.6479);
    assert.equal(fc.interval_s, 900);
    assert.equal(fc.live, false);
    assert.equal(
      fc.source_url,
      "https://wdlstorageaccount.blob.core.windows.net/wdlcontinuous/B95050Q/por/B95050Q_WaterSurfaceElevationNAVD88_RAW.csv",
    );
    assert.ok(requests.every(([, options]) => options.fresh));
  });

  it("leaves out a station whose file is empty", async () => {
    serve([
      [/stations\.csv$/, () => fixture("dwr-stations.csv")],
      [/station-trace-download-links\.csv$/, () => fixture("dwr-traces.csv")],
      [
        /B95325_StreamLevel/,
        () => {
          throw new Error("GET … returned 416");
        },
      ],
      [/wdlcontinuous/, headFor],
    ]);
    const stations = await dwr.stations();
    assert.ok(!stations.some((s) => s.id === "dwr/B95325"));
    assert.equal(stations.length, 3);
  });

  it("reads stage where a station's NAVD88 file is empty", async () => {
    const traces = fixture("dwr-traces.csv").replace(
      /\nB95325,Tide Station,StreamLevel,/,
      "\nB95325,Tide Station,WaterSurfaceElevationNAVD88,Combined,1998-10-01 00:00:00,2026-08-12 08:45:00,x,RAW,https://x\nB95325,Tide Station,StreamLevel,",
    );
    serve([
      [/stations\.csv$/, () => fixture("dwr-stations.csv")],
      [/station-trace-download-links\.csv$/, () => traces],
      [
        /B95325_WaterSurfaceElevationNAVD88/,
        () => {
          throw new Error("GET … returned 416");
        },
      ],
      [/wdlcontinuous/, headFor],
    ]);
    const station = ((await dwr.stations()) as dwr.DwrStation[]).find(
      (s) => s.id === "dwr/B95325",
    )!;
    assert.deepEqual([station.parameter, station.datum], ["StreamLevel", "GZ"]);
  });

  it("leaves out a station whose file names another station", async () => {
    serve([
      [/stations\.csv$/, () => fixture("dwr-stations.csv")],
      [/station-trace-download-links\.csv$/, () => fixture("dwr-traces.csv")],
      // WDL's file for B95580 carries B95500's header, with no notes.
      [
        /B95325_StreamLevel/,
        () =>
          '"Time","B95500",\r\n"and",821.00,\r\n"Date","Point","Qual"\r\n10/01/1988 00:00:00,"",    151\r\n',
      ],
      [/wdlcontinuous/, headFor],
    ]);
    const stations = await dwr.stations();
    assert.ok(!stations.some((s) => s.id === "dwr/B95325"));
    assert.equal(stations.length, 3);
  });

  it("refuses to read a file whose header names another station", async () => {
    serve([[/B95050Q/, () => fixture("dwr-B95050Q-head.csv").replace('"B95050Q"', '"B95500"')]]);
    await assert.rejects(
      dwr.levels(fishermans, new Date("2015-01-01Z"), new Date("2016-01-01Z")),
      /names station B95500/,
    );
  });

  it("refuses an empty station or trace list", async () => {
    serve([
      [/stations\.csv$/, () => fixture("dwr-stations.csv")],
      [/station-trace-download-links\.csv$/, () => "station_number,parameter\n"],
    ]);
    await assert.rejects(dwr.stations(), /no stations or traces/);
  });

  it("reads quoted CSV fields with commas", () => {
    assert.deepEqual(dwr.records('a,b,c\r\n1,"x, ""y""",3\r\n'), [{ a: "1", b: 'x, "y"', c: "3" }]);
  });

  it("reads an old range from the whole file, in meters at UTC from PST", async () => {
    serve([[/B95050Q/, () => fixture("dwr-B95050Q-head.csv")]]);
    const levels = await dwr.levels(fishermans, new Date("2015-01-01Z"), new Date("2016-01-01Z"));
    assert.equal(requests.length, 1);
    assert.equal(rangeOf(requests[0]![1]), null);
    // 10/01/2015 00:00:00, 3.58 ft, quality 70 (estimated).
    assert.deepEqual(levels[0], {
      time: Date.parse("2015-10-01T08:00:00Z"),
      level: 1.091,
      flag: Flag.interpolated,
    });
    assert.ok(levels.every((l, i) => i === 0 || l.time - levels[i - 1]!.time === 900_000));
    // The file's last row is cut short, and isn't read.
    assert.equal(levels.at(-1)!.time, Date.parse("2015-10-01T22:30:00Z"));
  });

  it("refuses a file that names another variable", async () => {
    serve([[/B95050Q/, () => fixture("dwr-B95050Q-head.csv")]]);
    await assert.rejects(
      dwr.levels(
        { ...fishermans, parameter: "StreamLevel", datum: "GZ" },
        new Date("2015-01-01Z"),
        new Date("2016-01-01Z"),
      ),
      /names Water Surface Elevation/,
    );
    await assert.rejects(
      dwr.levels({ ...fishermans, datum: "GZ" }, new Date(0), new Date(1)),
      /its WaterSurfaceElevationNAVD88 is in NAVD88/,
    );
  });

  it("reads a recent range from the file's tail, preliminary for the last four months", async () => {
    // The file is 16,693,791 bytes; a guess past its end is refused.
    const tail = fixture("dwr-B95050Q-tail.csv");
    serve([
      [
        /B95050Q/,
        (options) => {
          if (rangeOf(options) === "bytes=0-1023") return fixture("dwr-B95050Q-head.csv");
          const offset = Number(/bytes=(\d+)-/.exec(rangeOf(options) ?? "")?.[1]);
          if (offset >= 16_693_791) throw new Error("GET … returned 416");
          // A cut line, then the file's last 200 rows.
          return `6:45:00,        4.62,      1,\r\n${tail}`;
        },
      ],
    ]);
    const levels = await dwr.levels(fishermans, new Date("2026-11-04Z"), new Date("2026-11-07Z"));
    // 43 bytes a row runs past the end; 41 lands within it.
    assert.deepEqual(
      requests.map(([, options]) => rangeOf(options)),
      ["bytes=0-1023", "bytes=16721184-", "bytes=15943264-"],
    );
    assert.equal(levels[0]!.time, Date.parse("2026-11-04T00:00:00Z"));
    assert.equal(levels.at(-1)!.time, Date.parse("2026-11-05T18:45:00Z"));
    assert.ok(levels.every((l) => l.flag === Flag.preliminary));
  });

  it("reads the whole file when no tail reaches back far enough, and an empty one as nothing", async () => {
    // An empty file answers any range with 416, and a whole read with nothing.
    serve([
      [
        /B95050Q/,
        (options) => {
          if (rangeOf(options)) throw new Error("GET … returned 416");
          return "";
        },
      ],
    ]);
    assert.deepEqual(
      await dwr.levels(fishermans, new Date("2026-11-04Z"), new Date("2026-11-07Z")),
      [],
    );
    // Three guesses, then the whole file.
    assert.deepEqual(
      requests.map(([, options]) => rangeOf(options)),
      ["bytes=0-1023", "bytes=16721184-", "bytes=15943264-", "bytes=12831584-", null],
    );
  });

  it("asks nothing outside the record", async () => {
    serve([]);
    const closed = { ...fishermans, record_end: "2016-01-01T00:00:00Z" };
    assert.deepEqual(
      await dwr.levels(closed, new Date("2010-01-01Z"), new Date("2015-01-01Z")),
      [],
    );
    assert.deepEqual(
      await dwr.levels(closed, new Date("2017-01-01Z"), new Date("2018-01-01Z")),
      [],
    );
    assert.equal(requests.length, 0);
  });

  it("sorts an edited file's rows and drops repeats", () => {
    const rows = [
      "10/01/1998 00:30:00,        3.00,      1,",
      "10/01/1998 00:15:00,        1.00,      1,",
      "10/01/1998 00:30:00,        2.00,      1,",
    ].join("\r\n");
    assert.deepEqual(
      dwr.parse(rows, "B95325").map((o) => o.level),
      [0.305, 0.61],
    );
  });

  it("checks a tail's variable from the file's first KB, once per process", async () => {
    serve([
      [
        /B95050Q/,
        (options) =>
          rangeOf(options) === "bytes=0-1023"
            ? fixture("dwr-B95050Q-head.csv").replace(
                "Water Surface Elevation (NAVD88)",
                "Corrected Stage",
              )
            : "",
      ],
    ]);
    await assert.rejects(
      dwr.levels(fishermans, new Date("2026-11-04Z"), new Date("2026-11-07Z")),
      /names Corrected Stage/,
    );
    assert.equal(requests.length, 1);
  });

  it("keeps a listed station's parameter when its file is empty", async () => {
    const traces = fixture("dwr-traces.csv").replace(
      /\nB95325,Tide Station,StreamLevel,/,
      "\nB95325,Tide Station,WaterSurfaceElevationNAVD88,Combined,1998-10-01 00:00:00,2026-08-12 08:45:00,x,RAW,https://x\nB95325,Tide Station,StreamLevel,",
    );
    serve([
      [/stations\.csv$/, () => fixture("dwr-stations.csv")],
      [/station-trace-download-links\.csv$/, () => traces],
      [
        /B95325_WaterSurfaceElevationNAVD88/,
        () => {
          throw new Error("GET … returned 416");
        },
      ],
      [/wdlcontinuous/, headFor],
    ]);
    // Listed in NAVD88, it's left out for the month rather than moved to stage.
    const previous = [{ source_id: "B95325", parameter: "WaterSurfaceElevationNAVD88" }] as never;
    assert.ok(!(await dwr.stations(previous)).some((s) => s.id === "dwr/B95325"));
    // New, it takes stage.
    assert.ok((await dwr.stations()).some((s) => s.id === "dwr/B95325"));
  });

  it("maps quality codes and skips missing readings", () => {
    const rows = [
      '10/01/1998 00:00:00,"",    151,',
      "10/01/1998 00:15:00,        1.00,      1,",
      "10/01/1998 00:30:00,        1.00,      2,",
      "10/01/1998 00:45:00,        1.00,     76,",
      "10/01/1998 01:00:00,        1.00,    170,",
      "10/01/1998 01:15:00,        1.00,    255,",
    ].join("\r\n");
    assert.deepEqual(
      dwr.parse(rows, "B95325").map((o) => o.flag),
      [Flag.good, Flag.good, Flag.interpolated, Flag.suspect],
    );
    assert.throws(
      () => dwr.parse("10/01/1998 00:15:00,        1.0.0,      1,", "B95325"),
      /bad row/,
    );
    assert.throws(
      () => dwr.parse("13/01/1998 00:15:00,        1.00,      1,", "B95325"),
      /bad row/,
    );
    assert.throws(
      () => dwr.parse("02/30/1998 00:15:00,        1.00,      1,", "B95325"),
      /bad row/,
    );
  });

  it("reads a station from stations.parquet by the file its source_url names", async () => {
    serve([[/B95050Q/, () => fixture("dwr-B95050Q-head.csv")]]);
    const station = {
      id: "dwr/B95050Q",
      source_id: "B95050Q",
      datum: "NAVD88",
      source_url:
        "https://wdlstorageaccount.blob.core.windows.net/wdlcontinuous/B95050Q/por/B95050Q_WaterSurfaceElevationNAVD88_RAW.csv",
    } as Station;
    const levels = await dwr.source.observations!(
      station,
      new Date("2015-10-01Z"),
      new Date("2015-10-02Z"),
    );
    assert.ok(levels.length > 50);
  });
});
