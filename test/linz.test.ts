import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as linz from "../src/sources/linz/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Answer requests from fixtures, by the first pattern the URL matches, recording each request. */
function serve(routes: [RegExp, string][]): [string, RequestOptions][] {
  const requests: [string, RequestOptions][] = [];
  setTransport(async (url, options) => {
    requests.push([url, options]);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return route[1];
  });
  return requests;
}

afterEach(() => setTransport(fetchText));

// Fixtures were recorded on 14 November 2026; the adapter judges activity against the clock.
beforeEach(() => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-14T22:00:00Z") });
  mock.method(console, "warn", () => {});
});
afterEach(() => {
  mock.timers.reset();
  mock.restoreAll();
});

const CODES = ["CHIT", "KAIT", "OTAT", "SCOT", "SUMT", "WLGT"];
const listRoutes: [RegExp, string][] = [
  [/\/api\/listGauges$/, fixture("linz-gauges.json")],
  ...CODES.map((c): [RegExp, string] => [
    new RegExp(`/api/getGaugeData/${c}$`),
    fixture(`linz-gauge-${c}.json`),
  ]),
];
const fileRoutes: [RegExp, string][] = [
  [/listDatasetFiles\/WLGT\/2026\/40$/, fixture("linz-list-WLGT-2026-40.json")],
  [/listDatasetFiles\/WLGT\/2025\/40$/, fixture("linz-list-WLGT-2025-40.json")],
  [/tidegauge\/WLGT\/2026\/40\/WLGT_40_2026310\.zip$/, fixture("linz-WLGT_40_2026310.zip.b64")],
  [/tidegauge\/WLGT\/2025\/40\/WLGT_40_2025\.zip$/, fixture("linz-WLGT_40_2025.zip.b64")],
];

describe("linz", () => {
  linz.pacing.requestMs = 0;

  it("lists the gauges with sensor 40 files, with positions and stated chart datum offsets", async () => {
    const requests = serve(listRoutes);
    const stations = await linz.stations();
    // Scott Base has only sensor 00, which the adapter doesn't read.
    assert.deepEqual(
      stations.map((s) => s.id),
      ["linz/CHIT", "linz/KAIT", "linz/OTAT", "linz/SUMT", "linz/WLGT"],
    );
    assert.ok(requests.every(([, o]) => o.fresh));
    const wlgt = stations.find((s) => s.id === "linz/WLGT")!;
    assert.equal(wlgt.name, "Wellington");
    assert.equal(wlgt.lat, -41.284444);
    assert.equal(wlgt.lon, 174.779722);
    assert.equal(wlgt.country_code, "NZ");
    assert.equal(wlgt.datum, "ZERO");
    assert.equal(wlgt.interval_s, 60);
    assert.equal(wlgt.license, "CC-BY-3.0-NZ");
    assert.equal(wlgt.commercial_use, true);
    assert.equal(wlgt.attribution, "Land Information New Zealand");
    assert.equal(wlgt.live, false);
    assert.equal(wlgt.status, "active");
    assert.equal(wlgt.record_start, "2007-01-01T00:00:00.000Z");
    assert.equal(wlgt.record_end, null);
    // "Chart Datum is 3.565m below BM ABPC" doesn't say where gauge zero is.
    assert.deepEqual(wlgt.datums, {});
  });

  it("reads the README's own spellings of a position", async () => {
    serve(listRoutes);
    const stations = await linz.stations();
    // `44° 01" 26"S` and `170° 37' 46E`, which the READMEs write with a stray quote or no mark.
    const chit = stations.find((s) => s.id === "linz/CHIT")!;
    assert.equal(chit.lat, -44.023889);
    assert.equal(chit.lon, -176.3675);
    const otat = stations.find((s) => s.id === "linz/OTAT")!;
    assert.equal(otat.lat, -45.814444);
    assert.equal(otat.lon, 170.629444);
  });

  it("gives the chart datum offset a calibration states, and Sumner's below gauge zero", async () => {
    serve(listRoutes);
    const stations = await linz.stations();
    // CD is 2.016 m above gauge zero, so a level above it is that much less above CD.
    assert.deepEqual(stations.find((s) => s.id === "linz/CHIT")!.datums, { CD: -2.016 });
    assert.deepEqual(stations.find((s) => s.id === "linz/KAIT")!.datums, { CD: -1.38 });
    assert.deepEqual(stations.find((s) => s.id === "linz/SUMT")!.datums, { CD: 0.5 });
  });

  it("marks a gauge whose sensor 40 files stopped before last year inactive", async () => {
    serve(listRoutes);
    const sumt = (await linz.stations()).find((s) => s.id === "linz/SUMT")!;
    assert.equal(sumt.status, "inactive");
    assert.equal(sumt.record_end, "2023-01-01T00:00:00.000Z");
  });

  it("keeps a listed gauge whose README can't be read, and leaves out a new one", async () => {
    serve(listRoutes);
    const was = (await linz.stations()) as Station[];
    const broken = {
      gauge: "WLGT",
      description: "NAME: Wellington",
      datasets: [{ year: "2026", sensor: "40" }],
    };
    serve([
      [/getGaugeData\/WLGT$/, JSON.stringify(broken)],
      [/getGaugeData\/OTAT$/, JSON.stringify({ ...broken, gauge: "OTAT" })],
      ...listRoutes,
    ]);
    const now = await linz.stations(was);
    assert.equal(now.find((s) => s.id === "linz/WLGT")!.lat, -41.284444);
    const fresh = await linz.stations();
    assert.deepEqual(
      fresh.map((s) => s.id),
      ["linz/CHIT", "linz/KAIT", "linz/SUMT"],
    );
  });

  it("keeps a listed gauge whose sensor 40 files have gone from its datasets", async () => {
    serve(listRoutes);
    const was = (await linz.stations()) as Station[];
    const empty = { gauge: "WLGT", description: "", datasets: [] };
    serve([[/getGaugeData\/WLGT$/, JSON.stringify(empty)], ...listRoutes]);
    const now = await linz.stations(was);
    assert.equal(now.find((s) => s.id === "linz/WLGT")!.name, "Wellington");
  });

  it("refuses an empty list", async () => {
    serve([[/listGauges$/, JSON.stringify({ gauges: [] })]]);
    await assert.rejects(linz.stations(), /listed no gauges/);
  });

  it("reads a day's file as preliminary, one request for the listing and one for the day", async () => {
    const requests = serve(fileRoutes);
    const obs = await linz.levels(
      "WLGT",
      new Date("2026-11-06T00:00:00Z"),
      new Date("2026-11-07T00:00:00Z"),
    );
    // 1,440 minutes with the ones LINZ lacks left out.
    assert.equal(obs.length, 1434);
    assert.deepEqual(obs[0], {
      time: Date.UTC(2026, 10, 6, 0, 0),
      level: 2.549,
      flag: Flag.preliminary,
    });
    assert.equal(obs.at(-1)!.time, Date.UTC(2026, 10, 6, 23, 53));
    assert.ok(obs.every((o, i) => i === 0 || o.time > obs[i - 1]!.time));
    assert.deepEqual(
      requests.map(([url]) => url.replace(/^.*(listDatasetFiles|tidegauge)/, "$1")),
      ["listDatasetFiles/WLGT/2026/40", "tidegauge/WLGT/2026/40/WLGT_40_2026310.zip"],
    );
    // A day's file changes until LINZ replaces it with the year's, so it is never cached.
    assert.ok(requests.every(([, o]) => o.fresh));
    assert.equal(requests[1]![1].base64, true);
  });

  it("reads only the days a range touches", async () => {
    const requests = serve(fileRoutes);
    const none = await linz.levels(
      "WLGT",
      new Date("2026-02-01T00:00:00Z"),
      new Date("2026-02-02T00:00:00Z"),
    );
    assert.deepEqual(none, []);
    assert.equal(requests.length, 1);
  });

  it("prefers a year's file, flags it good, and drops the rows LINZ marks missing or bad", async () => {
    const requests = serve(fileRoutes);
    const obs = await linz.levels(
      "WLGT",
      new Date("2025-04-09T23:55:00Z"),
      new Date("2025-04-15T22:00:00Z"),
    );
    assert.equal(requests.length, 2);
    assert.match(requests[1]![0], /WLGT_40_2025\.zip$/);
    assert.ok(obs.every((o) => o.flag === Flag.good));
    const at = (iso: string) => obs.find((o) => o.time === Date.parse(iso));
    assert.equal(at("2025-04-09T23:55:00Z")?.level, 2.597);
    // The start is inclusive and the earlier minutes are out of range.
    assert.equal(at("2025-04-09T23:54:00Z"), undefined);
    // `//.///` is a missing value, `02.22/` a marked one, and `00.000` a sensor that was off.
    assert.equal(at("2025-04-10T02:26:00Z"), undefined);
    assert.equal(at("2025-04-15T21:18:00Z"), undefined);
    assert.equal(at("2025-04-14T02:47:00Z"), undefined);
    assert.ok(at("2025-04-10T00:00:00Z"));
  });

  it("stops at the end of the range and before a gauge's record", async () => {
    serve(fileRoutes);
    const obs = await linz.levels(
      "WLGT",
      new Date("2025-04-09T00:00:00Z"),
      new Date("2025-04-10T00:01:00Z"),
    );
    assert.equal(obs.at(-1)!.time, Date.parse("2025-04-10T00:00:00Z"));
    const before = await linz.levels(
      "WLGT",
      new Date("2025-04-09T00:00:00Z"),
      new Date("2025-04-10T00:01:00Z"),
      {
        record_start: "2026-01-01T00:00:00.000Z",
      },
    );
    assert.deepEqual(before, []);
  });

  it("drops 0.001 from a day's file, where a sensor was off, but not from a year's", () => {
    const csv = "WLGT,2019-04-20 00:00,0.001\nWLGT,2019-04-20 00:01,0.002\n";
    assert.deepEqual(
      linz.parse(csv, "WLGT", true).map((r) => r.level),
      [0.002],
    );
    const year = "WLGT,20190420,00:00:00,00.001\nWLGT,20190420,00:01:00,00.000\n";
    assert.deepEqual(
      linz.parse(year, "WLGT", false).map((r) => r.level),
      [0.001],
    );
  });

  it("fails a past year in a gauge's record that lists no files, rather than read it as no data", async () => {
    serve([[/listDatasetFiles\/WLGT\/2025\/40$/, JSON.stringify({ files: [] })]]);
    const span = [new Date("2025-04-09T00:00:00Z"), new Date("2025-04-10T00:00:00Z")] as const;
    await assert.rejects(
      linz.levels("WLGT", ...span, { record_start: "2007-01-01T00:00:00.000Z" }),
      /lists no files for WLGT in 2025/,
    );
    assert.deepEqual(await linz.levels("WLGT", ...span), []);
  });

  it("decides Kaikoura's zero", () => {
    assert.equal(linz.source.overrides!.epochs!["linz/KAIT start"]!.to_current, -0.88);
  });

  it("refuses a station that isn't a LINZ code", async () => {
    await assert.rejects(linz.levels("../x", new Date(0), new Date(1)), /Not a LINZ station/);
  });
});

describe("linz parse", () => {
  it("reads a year's rows and a day's rows", () => {
    const rows = linz.parse(
      "WLGT,20190101,00:00:00,03.487\nWLGT,2019-04-20 00:01,5.251\nWLGT,2019-04-20 0:02,-0.25\n",
      "WLGT",
      false,
    );
    assert.deepEqual(
      rows.map((r) => [new Date(r.time).toISOString(), r.level]),
      [
        ["2019-01-01T00:00:00.000Z", 3.487],
        ["2019-04-20T00:01:00.000Z", 5.251],
        ["2019-04-20T00:02:00.000Z", -0.25],
      ],
    );
  });

  it("skips another gauge's rows, impossible dates, and values that aren't levels", () => {
    const rows = linz.parse(
      [
        "AUCT,2019-04-20 00:00,5.251",
        "WLGT,2019-02-31 00:00,5.251",
        "WLGT,2019-04-20 24:00,5.251",
        "WLGT,2019-04-20 00:03,//.///",
        "WLGT,2019-04-20 00:04,47.80/",
        "WLGT,2019-04-20 00:05,0.000",
        "WLGT,2019-04-20 00:06,",
        "WLGT,2019-04-20 00:07,5.251,extra",
        "WLGT,2019-04-20 00:08,5.251",
      ].join("\n"),
      "WLGT",
      false,
    );
    assert.deepEqual(
      rows.map((r) => r.time),
      [Date.UTC(2019, 3, 20, 0, 8)],
    );
  });
});

describe("linz parseReadme", () => {
  it("takes the chart datum offset from a calibration table, not from a benchmark", () => {
    const table =
      "REFERENCE BENCH MARKS\r\n   EBRK - 5.606\r\n     CD - 2.016 (LAT analysis)\r\n    TG0 - 0.000\r\n";
    const head = "NAME:\t\tX\r\nWGS-84 POSITION:   \t41° 17' 04\"S\r\n   174° 46' 47\"E\r\n";
    assert.deepEqual(linz.parseReadme(head + table)!.datums, { CD: -2.016 });
    assert.deepEqual(
      linz.parseReadme(head + "Chart Datum is 3.565m below BM ABPC.\r\n")!.datums,
      {},
    );
    assert.deepEqual(
      linz.parseReadme(head + "Chart Datum is 0.50m below TG0 (Datum transfer)\r\n")!.datums,
      { CD: 0.5 },
    );
  });

  it("refuses a README without a name or a position", () => {
    assert.equal(linz.parseReadme("WGS-84 POSITION: 41° 17' 04\"S 174° 46' 47\"E"), null);
    assert.equal(linz.parseReadme("NAME: X\nWGS-84 POSITION: 41° 17' 04\"S"), null);
  });
});
