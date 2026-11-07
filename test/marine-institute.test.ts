import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchText, HttpError, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as mi from "../src/sources/marine-institute/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Answer requests from fixtures, by the first pattern the decoded URL matches. */
function serve(routes: [RegExp, string | (() => string)][]): void {
  setTransport(async (url) => {
    const route = routes.find(([pattern]) => pattern.test(decodeURIComponent(url)));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return typeof route[1] === "function" ? route[1]() : route[1];
  });
}

afterEach(() => setTransport(fetchText));

// Fixtures were recorded on 7 November 2026; the adapters judge age against the clock.
beforeEach(() => mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-07T02:00:00Z") }));
afterEach(() => mock.timers.reset());

describe("marine-institute", () => {
  mi.pacing.requestMs = 0;

  const listRoutes = (kinvara = fixture("marine-institute-span-kinvara-unreferenced.json")) =>
    [
      [/distinct\(\)/, fixture("marine-institute-stations.json")],
      [/"Ballycotton Harbour"/, fixture("marine-institute-span-ballycotton-harbour.json")],
      [/"Galway Port 2"/, fixture("marine-institute-span-galway-port-2.json")],
      [/"Kinvara - Unreferenced"/, kinvara],
    ] as [RegExp, string][];

  it("lists each gauge under a slug of its name, with its span, datum and LAT offset", async () => {
    serve(listRoutes());
    const stations = await mi.stations();
    assert.deepEqual(
      stations.map((s) => [
        s.id,
        s.source_id,
        s.name,
        s.datum,
        s.datums,
        s.record_start,
        s.record_end,
        s.status,
      ]),
      [
        [
          "marine-institute/ballycotton-harbour",
          "ballycotton-harbour",
          "Ballycotton Harbour",
          "ODM",
          { LAT: 2.46 },
          "2010-10-07",
          null,
          "active",
        ],
        // A second gauge reports OD Malin alone, so there's no LAT offset.
        [
          "marine-institute/galway-port-2",
          "galway-port-2",
          "Galway Port 2",
          "ODM",
          {},
          "2024-02-26",
          null,
          "active",
        ],
        [
          "marine-institute/kinvara-unreferenced",
          "kinvara-unreferenced",
          "Kinvara - Unreferenced",
          "ZERO",
          {},
          "2018-10-03",
          null,
          "active",
        ],
      ],
    );
    const ballycotton = stations[0]!;
    assert.deepEqual(
      [
        ballycotton.lat,
        ballycotton.lon,
        ballycotton.country_code,
        ballycotton.interval_s,
        ballycotton.live,
      ],
      [51.8278, -8.0007, "IE", 300, true],
    );
    assert.equal(ballycotton.license, "CC-BY-4.0");
    assert.equal(ballycotton.commercial_use, true);
  });

  it("retires a gauge with no values for a year, keeping its last day", async () => {
    serve(
      listRoutes(
        fixture("marine-institute-span-kinvara-unreferenced.json").replace(
          "2026-05-24",
          "2024-05-24",
        ),
      ),
    );
    const kinvara = (await mi.stations()).at(-1)!;
    assert.deepEqual(
      [kinvara.status, kinvara.live, kinvara.record_end],
      ["inactive", false, "2024-05-24"],
    );
  });

  it("lists a gauge once though the dataset gives it two positions, and refuses two names with one ID", async () => {
    const list = (rows: (string | number)[][]) =>
      JSON.stringify({ table: { columnNames: ["station_id", "longitude", "latitude"], rows } });
    serve([
      [
        /distinct\(\)/,
        list([
          ["Ballycotton Harbour", -8.0, 51.82],
          ["Ballycotton Harbour", -8.0001, 51.8201],
        ]),
      ],
      // ERDDAP sorts `distinct()` by position, so the latest is the span's last row.
      [
        /"Ballycotton Harbour"/,
        JSON.stringify({
          table: {
            columnNames: [
              "station_id",
              "time",
              "longitude",
              "latitude",
              "Water_Level_LAT",
              "Water_Level_OD_Malin",
            ],
            rows: [
              ["Ballycotton Harbour", "2010-10-07T15:06:00Z", -8.0001, 51.8201, 3.908, 1.419],
              ["Ballycotton Harbour", "2026-11-07T01:25:00Z", -8.0, 51.82, 3.113, 0.653],
            ],
          },
        }),
      ],
    ]);
    assert.deepEqual(
      (await mi.stations()).map((s) => [s.id, s.lon, s.lat]),
      [["marine-institute/ballycotton-harbour", -8.0, 51.82]],
    );
    serve([
      [
        /distinct\(\)/,
        list([
          ["Union Hall", -9.1, 51.5],
          ["Union-Hall", -9.1, 51.5],
        ]),
      ],
    ]);
    await assert.rejects(mi.stations(), /share an ID/);
  });

  it("refuses an empty list", async () => {
    serve([[/distinct\(\)/, JSON.stringify({ table: { columnNames: [], rows: [] } })]]);
    await assert.rejects(mi.stations(), /listed no stations/);
  });

  it("reads OD Malin levels, QC'd values as good and unchecked ones as preliminary", async () => {
    const urls: string[] = [];
    const body = JSON.parse(fixture("marine-institute-levels.json"));
    // A missing value, as flag 9 and as null.
    body.table.rows.push(["2019-02-27T12:00:00Z", -1.08, 9], ["2019-02-27T12:05:00Z", null, 0]);
    setTransport(async (url) => {
      urls.push(decodeURIComponent(url));
      return JSON.stringify(body);
    });
    const levels = await mi.levels(
      "Dublin Port",
      new Date("2019-02-27T11:00:00Z"),
      new Date("2019-02-27T12:00:00Z"),
    );
    assert.deepEqual(urls, [
      'https://erddap.marine.ie/erddap/tabledap/IrishNationalTideGaugeNetwork.json?time,Water_Level_OD_Malin,QC_Flag&station_id="Dublin Port"&time>=2019-02-27T11:00:00.000Z&time<2019-02-27T12:00:00.000Z',
    ]);
    assert.equal(levels.length, 12);
    assert.deepEqual(levels[0], {
      time: Date.parse("2019-02-27T11:00:00Z"),
      level: -1.133,
      flag: Flag.good,
    });
    assert.deepEqual(levels[8], {
      time: Date.parse("2019-02-27T11:40:00Z"),
      level: -1.086,
      flag: Flag.preliminary,
    });
  });

  it("asks a calendar year at a time, within the station's record", async () => {
    const urls: string[] = [];
    setTransport(async (url) => {
      urls.push(decodeURIComponent(url));
      throw new HttpError(
        "404",
        'Error {\n code=404;\n message="Not Found: Your query produced no matching results. (nRows = 0)";\n}',
      );
    });
    const levels = await mi.levels(
      "Galway Port 2",
      new Date("2020-01-01Z"),
      new Date("2026-01-01Z"),
      {
        record_start: "2024-02-26",
      },
    );
    // No rows is no values.
    assert.deepEqual(levels, []);
    assert.deepEqual(
      urls.map((u) => u.match(/time>=([^&]+)&time<(.+)$/)!.slice(1)),
      [
        ["2024-02-26T00:00:00.000Z", "2025-01-01T00:00:00.000Z"],
        ["2025-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
      ],
    );
  });

  it("fails on any other 404", async () => {
    setTransport(async () => {
      throw new HttpError("404", "Currently unknown datasetID");
    });
    await assert.rejects(
      mi.levels("Dublin Port", new Date("2019-01-01Z"), new Date("2019-01-02Z")),
      HttpError,
    );
  });

  it("refuses a station recorded in another datum", async () => {
    setTransport(async () => fixture("marine-institute-levels.json"));
    await assert.rejects(
      mi.levels("Dublin Port", new Date("2019-02-27T11:00Z"), new Date("2019-02-27T12:00Z"), {
        datum: "LAT",
      }),
      /measured from/,
    );
    await assert.rejects(
      mi.levels(
        "Kinvara - Unreferenced",
        new Date("2019-02-27T11:00Z"),
        new Date("2019-02-27T12:00Z"),
        { datum: "ODM" },
      ),
      /measured from/,
    );
  });

  it("caches a range only when every value is QC'd good and runs to its end", async () => {
    const keeps: boolean[] = [];
    const body = fixture("marine-institute-levels.json");
    const good = JSON.stringify({
      table: { ...JSON.parse(body).table, rows: JSON.parse(body).table.rows.slice(0, 8) },
    });
    for (const [text, end] of [
      [good, "2019-02-27T11:40:00Z"],
      // Unchecked values may still change.
      [body, "2019-02-27T12:00:00Z"],
      // Values stopping short of the range's end may be filled in.
      [good, "2019-02-27T14:00:00Z"],
    ] as const) {
      setTransport(async (_url, options) => {
        keeps.push(options.keep!(text));
        return text;
      });
      await mi.levels("Dublin Port", new Date("2019-02-27T11:00:00Z"), new Date(end));
    }
    assert.deepEqual(keeps, [true, false, false]);
    // Station lists are never cached.
    const fresh: boolean[] = [];
    setTransport(async (url, options) => {
      fresh.push(options.fresh === true);
      return listRoutes().find(([p]) => p.test(decodeURIComponent(url)))![1];
    });
    await mi.stations();
    assert.ok(fresh.length === 4 && fresh.every(Boolean));
  });
});
