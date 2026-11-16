import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { crc32, deflateRawSync } from "node:zlib";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import { firstEpochs, nextEpochs } from "../src/epochs.ts";
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

/** A zip holding one CSV, as the base64 text the adapter's transport returns. */
function zipOf(name: string, csv: string): string {
  const file = Buffer.from(name.replace(/\.zip$/, ".csv"));
  const data = Buffer.from(csv);
  const packed = deflateRawSync(data);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(file.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(file.length, 28);
  const offset = local.length + file.length + packed.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + file.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([local, file, packed, central, file, end]).toString("base64");
}

/** A year's file of one row a minute for `code`, from `level` at each minute. */
function yearCsv(code: string, year: number, level: (minute: number) => number): string {
  const rows: string[] = [];
  const start = Date.UTC(year, 0, 1);
  const minutes = (Date.UTC(year + 1, 0, 1) - start) / 60_000;
  for (let m = 0; m < minutes; m++) {
    const at = new Date(start + m * 60_000).toISOString();
    rows.push(
      `${code},${at.slice(0, 10).replaceAll("-", "")},${at.slice(11, 19)},${level(m).toFixed(3).padStart(6, "0")}`,
    );
  }
  return rows.join("\n");
}

const CODES = ["CHIT", "KAIT", "OTAT", "ROBT", "SCOT", "SUMT", "WLGT"];
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

  it("lists the gauges with sensor 40 files, and the Antarctic gauges with sensor 00 files", async () => {
    const requests = serve(listRoutes);
    const stations = await linz.stations();
    assert.deepEqual(
      stations.map((s) => s.id),
      ["linz/CHIT", "linz/KAIT", "linz/OTAT", "linz/ROBT", "linz/SCOT", "linz/SUMT", "linz/WLGT"],
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

  it("lists Cape Roberts and Scott Base in Antarctica, from their sensor 00 years", async () => {
    serve(listRoutes);
    const stations = await linz.stations();
    const robt = stations.find((s) => s.id === "linz/ROBT")!;
    assert.equal(robt.name, "Cape Roberts");
    assert.equal(robt.lat, -77.033333);
    assert.equal(robt.lon, 163.183333);
    assert.equal(robt.country_code, "AQ");
    assert.equal(robt.kind, "coastal");
    assert.equal(robt.record_start, "2007-01-01T00:00:00.000Z");
    // Its last year is last year's, so it is open and its record has no end.
    assert.equal(robt.status, "active");
    assert.equal(robt.record_end, null);
    assert.deepEqual(robt.datums, {});
    const scot = stations.find((s) => s.id === "linz/SCOT")!;
    assert.equal(scot.name, "Scott Base");
    assert.equal(scot.lat, -77.85);
    assert.equal(scot.lon, 166.766667);
    assert.equal(scot.country_code, "AQ");
    assert.equal(scot.record_start, "2016-01-01T00:00:00.000Z");
    // Its README says the gauge was removed on 5 March 2026, though 2026 is the current year.
    assert.equal(scot.status, "inactive");
    assert.equal(scot.record_end, "2026-03-05T00:00:00.000Z");
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

  it("drops a calibration's chart datum offset after sensors were replaced, and keeps Sumner's below gauge zero", async () => {
    serve(listRoutes);
    const stations = await linz.stations();
    // Owenga's 2011 calibration and Kaikoura's 2017 one are followed by replaced sensors (2014 and 2019, 2018).
    assert.deepEqual(stations.find((s) => s.id === "linz/CHIT")!.datums, {});
    assert.deepEqual(stations.find((s) => s.id === "linz/KAIT")!.datums, {});
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
      ["linz/CHIT", "linz/KAIT", "linz/ROBT", "linz/SCOT", "linz/SUMT"],
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

  it("reads sensor 41 over a span where sensor 40 is stuck, and sensor 40 either side", async () => {
    const requests = serve([
      [/listDatasetFiles\/SUMT\/2016\/40$/, fixture("linz-list-SUMT-2016-40.json")],
      [/listDatasetFiles\/SUMT\/2016\/41$/, fixture("linz-list-SUMT-2016-41.json")],
      [/tidegauge\/SUMT\/2016\/40\/SUMT_40_2016\.zip$/, fixture("linz-SUMT_40_2016.zip.b64")],
      [/tidegauge\/SUMT\/2016\/41\/SUMT_41_2016\.zip$/, fixture("linz-SUMT_41_2016.zip.b64")],
    ]);
    const obs = await linz.levels(
      "SUMT",
      new Date("2016-06-27T23:58:00Z"),
      new Date("2016-06-28T00:03:00Z"),
    );
    // Sensor 40 until the span starts at midnight, then sensor 41; no stuck -4.79 m survives.
    assert.deepEqual(
      obs.map((o) => [new Date(o.time).toISOString().slice(11, 16), o.level, o.flag]),
      [
        ["23:58", 1.953, Flag.good],
        ["23:59", 1.949, Flag.good],
        ["00:00", 1.921, Flag.good],
        ["00:01", 1.915, Flag.good],
        ["00:02", 1.912, Flag.good],
      ],
    );
    assert.ok(requests.some(([url]) => /SUMT_41_2016\.zip$/.test(url)));
    // A range before the span reads no sensor 41 file.
    requests.length = 0;
    await linz.levels("SUMT", new Date("2016-06-27T23:58:00Z"), new Date("2016-06-28T00:00:00Z"));
    assert.ok(requests.every(([url]) => !/\/41\//.test(url)));
  });

  it("reads nothing for days where both sensors are stuck", async () => {
    const requests = serve([]);
    const obs = await linz.levels(
      "NCPT",
      new Date("2011-09-22T00:00:00Z"),
      new Date("2011-09-22T00:05:00Z"),
    );
    assert.deepEqual(obs, []);
    assert.equal(requests.length, 0);
  });

  it("reads a whole year of sensor 41 inside a span, and no sensor 40 file", async () => {
    const name = "SUMT_41_2017.zip";
    const requests = serve([
      [
        /listDatasetFiles\/SUMT\/2017\/40$/,
        JSON.stringify({ files: [{ name: "SUMT_40_2017.zip" }] }),
      ],
      [/listDatasetFiles\/SUMT\/2017\/41$/, JSON.stringify({ files: [{ name }] })],
      [
        /tidegauge\/SUMT\/2017\/41\/SUMT_41_2017\.zip$/,
        zipOf(
          name,
          yearCsv("SUMT", 2017, () => 1.5),
        ),
      ],
    ]);
    // A year's minutes are too many arguments for one push.
    const obs = await linz.levels(
      "SUMT",
      new Date("2017-01-01T00:00:00Z"),
      new Date("2018-01-01T00:00:00Z"),
    );
    assert.equal(obs.length, 525_600);
    assert.ok(requests.every(([url]) => !/SUMT_40_2017\.zip/.test(url)));
  });

  it("reads a span across a year's end from both years' sensor 41 files", async () => {
    const files = (y: number) => JSON.stringify({ files: [{ name: `WLGT_41_${y}.zip` }] });
    const requests = serve([
      [/listDatasetFiles\/WLGT\/2014\/40$/, files(2014).replace("_41_", "_40_")],
      [/listDatasetFiles\/WLGT\/2015\/40$/, files(2015).replace("_41_", "_40_")],
      [/listDatasetFiles\/WLGT\/2014\/41$/, files(2014)],
      [/listDatasetFiles\/WLGT\/2015\/41$/, files(2015)],
      [
        /WLGT\/2014\/41\/WLGT_41_2014\.zip$/,
        zipOf("WLGT_41_2014.zip", "WLGT,20141231,23:59:00,03.100"),
      ],
      [
        /WLGT\/2015\/41\/WLGT_41_2015\.zip$/,
        zipOf("WLGT_41_2015.zip", "WLGT,20150101,00:00:00,03.110"),
      ],
    ]);
    const obs = await linz.levels(
      "WLGT",
      new Date("2014-12-31T23:59:00Z"),
      new Date("2015-01-01T00:01:00Z"),
    );
    assert.deepEqual(
      obs.map((o) => o.level),
      [3.1, 3.11],
    );
    assert.ok(requests.every(([url]) => !/WLGT_40_/.test(url)));
  });

  it("fails a span year where LINZ lists no sensor 41 files", async () => {
    serve([
      [
        /listDatasetFiles\/SUMT\/2017\/40$/,
        JSON.stringify({ files: [{ name: "SUMT_40_2017.zip" }] }),
      ],
      [/listDatasetFiles\/SUMT\/2017\/41$/, JSON.stringify({ files: [] })],
    ]);
    await assert.rejects(
      linz.levels("SUMT", new Date("2017-03-01T00:00:00Z"), new Date("2017-03-02T00:00:00Z")),
      /lists no sensor 41 files for SUMT in 2017/,
    );
  });

  it("leaves out Napier's minutes after its step on 24 February 2008, and keeps those either side", async () => {
    const name = "NAPT_40_2008.zip";
    const csv = [
      "NAPT,20080224,18:50:00,03.300",
      "NAPT,20080224,18:51:00,03.294",
      "NAPT,20080224,23:59:00,02.900",
      "NAPT,20080225,00:00:00,02.910",
    ].join("\n");
    const requests = serve([
      [/listDatasetFiles\/NAPT\/2008\/40$/, JSON.stringify({ files: [{ name }] })],
      [/tidegauge\/NAPT\/2008\/40\/NAPT_40_2008\.zip$/, zipOf(name, csv)],
    ]);
    const obs = await linz.levels(
      "NAPT",
      new Date("2008-02-24T00:00:00Z"),
      new Date("2008-02-26T00:00:00Z"),
    );
    assert.deepEqual(
      obs.map((o) => new Date(o.time).toISOString().slice(8, 16)),
      ["24T18:50", "25T00:00"],
    );
    assert.ok(requests.every(([url]) => !/\/41\//.test(url)));
  });

  it("resumes sensor 40 on the day a span ends, and reads sensor 41 on the day before", async () => {
    serve([
      [
        /listDatasetFiles\/CPIT\/2012\/40$/,
        JSON.stringify({ files: [{ name: "CPIT_40_2012.zip" }] }),
      ],
      [
        /listDatasetFiles\/CPIT\/2012\/41$/,
        JSON.stringify({ files: [{ name: "CPIT_41_2012.zip" }] }),
      ],
      [
        /CPIT\/2012\/40\/CPIT_40_2012\.zip$/,
        zipOf("CPIT_40_2012.zip", "CPIT,20120330,23:59:00,01.900\nCPIT,20120331,00:00:00,03.700"),
      ],
      [
        /CPIT\/2012\/41\/CPIT_41_2012\.zip$/,
        zipOf("CPIT_41_2012.zip", "CPIT,20120330,23:59:00,04.000\nCPIT,20120331,00:00:00,04.100"),
      ],
    ]);
    const obs = await linz.levels(
      "CPIT",
      new Date("2012-03-30T23:59:00Z"),
      new Date("2012-03-31T00:01:00Z"),
    );
    assert.deepEqual(
      obs.map((o) => o.level),
      [4, 3.7],
    );
  });

  it("keeps every span's dates real, in order, and clear of the next", () => {
    for (const [code, spans] of Object.entries(linz.SENSOR_41))
      spans.forEach((s, i) => {
        for (const date of [s.from, s.to])
          assert.ok(
            new Date(Date.parse(date))
              .toISOString()
              .startsWith(date.replace(/Z$/, "").slice(0, 16)),
            `${code} ${date} isn't a date`,
          );
        assert.ok(Date.parse(s.from) < Date.parse(s.to), `${code} ${s.from} isn't before ${s.to}`);
        if (i)
          assert.ok(Date.parse(spans[i - 1]!.to) <= Date.parse(s.from), `${code} spans overlap`);
      });
  });

  it("backs every sensor 41 span with an erratum for its station and days", () => {
    const errata = JSON.parse(
      readFileSync(new URL("../src/sources/linz/errata.json", import.meta.url), "utf8"),
    ).errata as {
      stations: string[] | null;
      since: string | null;
      until: string | null;
      handling: string;
    }[];
    for (const [code, spans] of Object.entries(linz.SENSOR_41))
      for (const span of spans) {
        const covered = errata.some(
          (e) =>
            (e.handling === "corrected" || e.handling === "dropped") &&
            // One for the whole record, such as the clock's, says nothing of a span.
            (e.since || e.until) &&
            e.stations?.includes(`linz/${code}`) &&
            (e.since ?? "") <= span.from.slice(0, 10) &&
            (e.until ?? "9999") >= span.to.slice(0, 10),
        );
        assert.ok(covered, `${code} ${span.from} to ${span.to} has no erratum`);
      }
  });

  it("opens the epochs the overrides split, each converting by what was measured", () => {
    const options = (station: string, withOverrides: boolean) => ({
      station,
      now: "2026-11-15T00:00:00Z",
      offsets: [0, 0] as [number, number],
      decisions: withOverrides ? linz.source.overrides!.epochs! : {},
      splits: withOverrides ? linz.source.overrides!.splits : undefined,
      archive: "previous" as const,
    });
    const fetched = { datum: "ZERO", datums: {}, reference: null };
    // A new station gets its epochs at once; one already in the store has them split by a refresh.
    const epochsOf = (station: string) => {
      const fresh = firstEpochs(fetched, options(station, true));
      const stored = firstEpochs(fetched, options(station, false));
      const split = nextEpochs(stored, fetched, options(station, true)).epochs;
      assert.deepEqual(
        split.map((e) => [e.since, e.to_current]),
        fresh.map((e) => [e.since, e.to_current]),
      );
      return fresh.map((e) => [e.since, e.to_current]);
    };
    assert.deepEqual(epochsOf("linz/NAPT"), [
      [null, -0.344],
      ["2008-02-25T00:00:00Z", 0],
    ]);
    assert.deepEqual(epochsOf("linz/WLGT"), [
      [null, -0.64],
      ["2012-05-30T00:00:00Z", -0.38],
      ["2021-04-16T00:00:00Z", 0],
    ]);
    assert.deepEqual(epochsOf("linz/GIST"), [
      [null, -1.53],
      ["2013-09-26T00:00:00Z", -0.95],
      ["2021-05-12T00:00:00Z", -0.54],
      ["2024-12-13T00:00:00Z", 0],
    ]);
    assert.deepEqual(epochsOf("linz/OTAT"), [
      [null, -0.56],
      ["2021-05-26T00:00:00Z", 0],
    ]);
    assert.deepEqual(epochsOf("linz/TAUT"), [
      [null, -0.47],
      ["2024-03-21T00:00:00Z", 0],
    ]);
    // Korotiti Bay's step has no record to measure against.
    assert.deepEqual(epochsOf("linz/GBIT"), [
      [null, null],
      ["2024-09-10T00:00:00Z", 0],
    ]);
    assert.deepEqual(epochsOf("linz/KAIT"), [
      [null, -0.88],
      ["2016-11-14T00:00:00Z", 0],
    ]);
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

describe("linz Antarctic gauges", () => {
  linz.pacing.requestMs = 0;

  const list = (code: string, year: number, ...names: string[]) =>
    [
      new RegExp(`listDatasetFiles/${code}/${year}/00$`),
      JSON.stringify({ files: [{ name: "" }, ...names.map((name) => ({ name }))] }),
    ] as [RegExp, string];
  const zip = (code: string, year: number, name: string, csv: string) =>
    [new RegExp(`tidegauge/${code}/${year}/00/${name}$`), zipOf(name, csv)] as [RegExp, string];
  const iso = (o: { time: number }) => new Date(o.time).toISOString().slice(0, 16);

  it("reads every layout of Cape Roberts' files and Scott Base's", () => {
    const rows = (csv: string, code: string) =>
      linz
        .parse(csv, code, false)
        .map((r) => [new Date(r.time).toISOString().slice(0, 16), r.level]);
    // 2007's day, 2008's year, 2011's with samples, temperature and pressure, 2010's with them twice.
    assert.deepEqual(rows("ROBT,2007-11-08 00:05,6.117", "ROBT"), [["2007-11-08T00:05", 6.117]]);
    assert.deepEqual(rows("ROBT,20080117,00:05:00,6.047", "ROBT"), [["2008-01-17T00:05", 6.047]]);
    assert.deepEqual(rows("ROBT,20110101,0:05:00,5.38,30,-2.338,992.99", "ROBT"), [
      ["2011-01-01T00:05", 5.38],
    ]);
    assert.deepEqual(
      rows("ROBT,20101231,23:55:00,5.372,30,-2.338,993.15,30,-2.338,993.15", "ROBT"),
      [["2010-12-31T23:55", 5.372]],
    );
    // A level of exactly 6 is written `6`.
    assert.deepEqual(rows("ROBT,20110219,15:05:00,6,21,-2,988.64", "ROBT"), [
      ["2011-02-19T15:05", 6],
    ]);
    // Year, day of the year, hour and minute as one number (so 5 is 00:05), samples, level.
    assert.deepEqual(
      rows(
        "2018,1,0,30,5.37,-2.889,986.98\n2018,1,5,30,5.392,-2.889,986.98\n2024,1,1000,30,5.676,-3.458,973.02",
        "ROBT",
      ),
      [
        ["2018-01-01T00:00", 5.37],
        ["2018-01-01T00:05", 5.392],
        ["2024-01-01T10:00", 5.676],
      ],
    );
    assert.deepEqual(rows("2024,366,2355,30,5.39,-3.238,987.4", "ROBT"), [
      ["2024-12-31T23:55", 5.39],
    ]);
    // Scott Base's 2016 to 2022 rows, 2023's with the date first, and 2025's with the day first.
    assert.deepEqual(rows("SCOT,20160105,15:50:00,1.881", "SCOT"), [["2016-01-05T15:50", 1.881]]);
    assert.deepEqual(rows("2023-01-01,00:05:00,2.504", "SCOT"), [["2023-01-01T00:05", 2.504]]);
    assert.deepEqual(rows("2024-01-03,13:37:00,792.7", "SCOT"), [["2024-01-03T13:37", 792.7]]);
    assert.deepEqual(rows("1/01/2025,00:00:00,3162\n31/12/2025,23:59:00,2475", "SCOT"), [
      ["2025-01-01T00:00", 3162],
      ["2025-12-31T23:59", 2475],
    ]);
  });

  it("leaves out the rows whose fields aren't where their layout puts them", () => {
    const read = (csv: string, code: string) => linz.parse(csv, code, false);
    assert.deepEqual(
      read(
        [
          // No day of the year: it would read as January 5 and a level of -2.681.
          "2024,5,30,6.251,-2.681,976.79",
          "2024,0,30,6.252,-2.681,976.63",
          // A level cut short, and a temperature and pressure run together.
          "2024,11,1715,26,6.-3.368,979.01",
          "2024,27,1910,30,5.797,-3.992.17",
          // Cape Roberts' missing marks are not 0 but impossible levels, which atGauge refuses.
          ",,,,,,",
          "2024,367,0,30,5.5,-3.2,970.1",
          "2023,60,2400,30,5.5,-3.2,970.1",
        ].join("\n"),
        "ROBT",
      ),
      [],
    );
    // Scott Base's mangled rows of 1 to 9 December 2023 have the hour in the date and `am` in the time.
    assert.deepEqual(
      read("1/12/2023  1,02:00:00,2.573\n9/12/2023  1,:59:00 am,2.803\n", "SCOT"),
      [],
    );
  });

  it("reads Cape Roberts' year as UTC, dropping missing levels, repeats and spans, and keeping the rest good", async () => {
    const csv = [
      "ROBT,20090101,00:00:00,5.993",
      "ROBT,20090101,00:05:00,-6999.000",
      "ROBT,20090101,00:10:00,6999.000",
      // The same minute twice with the same level is one minute; with two levels, none.
      "ROBT,20090101,00:15:00,5.99",
      "ROBT,20090101,00:15:00,5.99",
      "ROBT,20090101,00:20:00,6.152",
      "ROBT,20090101,00:20:00,6.162",
      "ROBT,20091204,03:00:00,5.5",
      "ROBT,20091204,02:55:00,5.6",
    ].join("\n");
    serve([
      list("ROBT", 2008, "ROBT_00_2008.zip"),
      list("ROBT", 2009, "ROBT_00_2009.zip"),
      zip("ROBT", 2009, "ROBT_00_2009.zip", csv),
    ]);
    const obs = await linz.levels(
      "ROBT",
      new Date("2009-01-01T00:00:00Z"),
      new Date("2010-01-01T00:00:00Z"),
    );
    // The new sensor's levels from 03:00 UTC on 4 December 2009 aren't a sea level (erratum `linz-cape-roberts-new-sensor-2009`).
    assert.deepEqual(
      obs.map((o) => [iso(o), o.level, o.flag]),
      [
        ["2009-01-01T00:00", 5.993, Flag.good],
        ["2009-01-01T00:15", 5.99, Flag.good],
        ["2009-12-04T02:55", 5.6, Flag.good],
      ],
    );
  });

  it("reads 2007's days, and the first minute of 2008 from the last day's file", async () => {
    const requests = serve([
      list("ROBT", 2007, "ROBT_00_2007364.zip", "ROBT_00_2007365.zip"),
      zip(
        "ROBT",
        2007,
        "ROBT_00_2007365.zip",
        "ROBT,2007-12-31 23:55,6.100\nROBT,2008-01-01 00:00,6.123",
      ),
      list("ROBT", 2008, "ROBT_00_2008.zip"),
      zip("ROBT", 2008, "ROBT_00_2008.zip", "ROBT,20080101,00:05:00,6.130"),
    ]);
    const obs = await linz.levels(
      "ROBT",
      new Date("2007-12-31T23:00:00Z"),
      new Date("2008-01-01T00:06:00Z"),
    );
    assert.deepEqual(
      obs.map((o) => [iso(o), o.level, o.flag]),
      [
        ["2007-12-31T23:55", 6.1, Flag.preliminary],
        ["2008-01-01T00:00", 6.123, Flag.preliminary],
        ["2008-01-01T00:05", 6.13, Flag.good],
      ],
    );
    assert.ok(requests.every(([url]) => !/2007364/.test(url)));
  });

  it("reads 2007's last day for the first minute of 2008 when 2008 is asked for alone", async () => {
    serve([
      list("ROBT", 2007, "ROBT_00_2007365.zip"),
      zip(
        "ROBT",
        2007,
        "ROBT_00_2007365.zip",
        "ROBT,2007-12-31 23:55,6.100\nROBT,2008-01-01 00:00,6.123",
      ),
      list("ROBT", 2008, "ROBT_00_2008.zip"),
      zip("ROBT", 2008, "ROBT_00_2008.zip", "ROBT,20080101,00:05:00,6.130"),
    ]);
    const obs = await linz.levels(
      "ROBT",
      new Date("2008-01-01T00:00:00Z"),
      new Date("2009-01-01T00:00:00Z"),
    );
    assert.deepEqual(obs.map(iso), ["2008-01-01T00:00", "2008-01-01T00:05"]);
  });

  it("fails rather than read a year's last hours from an empty next-year listing", async () => {
    serve([
      list("SCOT", 2018, "SCOT_00_2018.zip"),
      zip("SCOT", 2018, "SCOT_00_2018.zip", "SCOT,20181231,23:59:00,2.100"),
      list("SCOT", 2019),
    ]);
    await assert.rejects(
      linz.levels("SCOT", new Date("2018-12-01T00:00:00Z"), new Date("2019-01-01T00:00:00Z"), {
        record_start: "2016-01-01T00:00:00.000Z",
        record_end: "2026-03-05T00:00:00.000Z",
      }),
      /lists no files for SCOT in 2019/,
    );
  });

  it("reads Cape Roberts' last year, before its file is issued by May, as no data", async () => {
    const span = [new Date("2026-12-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z")] as const;
    const was = { record_start: "2007-01-01T00:00:00.000Z" };
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-01-09T00:00:00Z") });
    serve([list("ROBT", 2026), list("ROBT", 2025, "ROBT_00_2025.zip")]);
    assert.deepEqual(await linz.levels("ROBT", ...span, was), []);
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2027-05-09T00:00:00Z") });
    await assert.rejects(linz.levels("ROBT", ...span, was), /lists no files for ROBT in 2026/);
  });

  it("takes Scott Base's unit from the file's year, not the row's label", async () => {
    serve([
      list("SCOT", 2023, "SCOT_00_2023.zip"),
      zip("SCOT", 2023, "SCOT_00_2023.zip", "2024-01-01,00:00:00,2.401"),
      list("SCOT", 2024, "SCOT_00_2024.zip"),
      zip("SCOT", 2024, "SCOT_00_2024.zip", "2024-01-01,00:01:00,2400"),
    ]);
    const obs = await linz.levels(
      "SCOT",
      new Date("2023-12-31T00:00:00Z"),
      new Date("2024-01-01T00:00:00Z"),
    );
    assert.deepEqual(
      obs.map((o) => [iso(o), o.level]),
      [
        ["2023-12-31T11:00", 2.401],
        ["2023-12-31T11:01", 2.4],
      ],
    );
  });

  it("keeps a level of 20 m or more at a New Zealand gauge for QC to judge", async () => {
    serve([
      [
        /listDatasetFiles\/WLGT\/2025\/40$/,
        JSON.stringify({ files: [{ name: "WLGT_40_2025.zip" }] }),
      ],
      [
        /WLGT\/2025\/40\/WLGT_40_2025\.zip$/,
        zipOf("WLGT_40_2025.zip", "WLGT,20250410,00:00:00,47.800"),
      ],
    ]);
    const obs = await linz.levels(
      "WLGT",
      new Date("2025-04-10T00:00:00Z"),
      new Date("2025-04-11T00:00:00Z"),
    );
    assert.deepEqual(
      obs.map((o) => o.level),
      [47.8],
    );
  });

  it("reads the Antarctic layouts only at the Antarctic gauges", () => {
    assert.deepEqual(linz.parse("2024,1,1000,30,5.676,-3.458,973.02", "WLGT", false), []);
    assert.deepEqual(linz.parse("2023-01-01,00:00:00,2.504", "WLGT", false), []);
    assert.deepEqual(linz.parse("WLGT,20110101,0:05:00,5.38,30,-2.338,992.99", "WLGT", false), []);
  });

  it("reads Scott Base's NZST labels as UTC, in meters until 2024 and millimeters from it", async () => {
    serve([
      list("SCOT", 2023, "SCOT_00_2023.zip"),
      zip("SCOT", 2023, "SCOT_00_2023.zip", "2023-06-01,12:00:00,2.504\n2023-12-31,23:59:00,2.398"),
      list("SCOT", 2024, "SCOT_00_2024.zip"),
      zip("SCOT", 2024, "SCOT_00_2024.zip", "2024-01-01,00:00:00,2400\n2024-01-03,13:37:00,792.7"),
    ]);
    const obs = await linz.levels(
      "SCOT",
      new Date("2023-06-01T00:00:00Z"),
      new Date("2024-01-04T00:00:00Z"),
    );
    // 2023 is NZST until 25 November, and then UTC+13 (erratum `linz-scott-base-clock`).
    assert.deepEqual(
      obs.map((o) => [iso(o), o.level]),
      [
        ["2023-06-01T00:00", 2.504],
        ["2023-12-31T10:59", 2.398],
        ["2023-12-31T11:00", 2.4],
        ["2024-01-03T00:37", 0.793],
      ],
    );
  });

  it("reads Scott Base's clock as UTC+13 from the logger's reinstallation to October 2024, and leaves out the days between", async () => {
    serve([
      list("SCOT", 2024, "SCOT_00_2024.zip"),
      zip(
        "SCOT",
        2024,
        "SCOT_00_2024.zip",
        [
          "2024-10-28,23:59:00,2500",
          "2024-10-29,00:00:00,2501",
          "2024-10-31,23:59:00,2502",
          "2024-11-01,00:00:00,2503",
        ].join("\n"),
      ),
      list("SCOT", 2023, "SCOT_00_2023.zip"),
      zip(
        "SCOT",
        2023,
        "SCOT_00_2023.zip",
        ["2023-11-24,23:59:00,2.1", "2023-11-25,00:00:00,2.2"].join("\n"),
      ),
    ]);
    const obs = await linz.levels(
      "SCOT",
      new Date("2023-11-24T00:00:00Z"),
      new Date("2024-11-02T00:00:00Z"),
      { record_start: "2016-01-01T00:00:00.000Z" },
    );
    assert.deepEqual(
      obs.map((o) => [iso(o), o.level]),
      [
        // UTC+12 before the reinstallation, UTC+13 after.
        ["2023-11-24T11:59", 2.1],
        ["2023-11-24T11:00", 2.2],
        ["2024-10-28T10:59", 2.5],
        ["2024-10-31T12:00", 2.503],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });

  it("reads the next year's file for the last hours of a UTC year, and only then", async () => {
    const requests = serve([
      list("SCOT", 2018, "SCOT_00_2018.zip"),
      list("SCOT", 2019, "SCOT_00_2019.zip"),
      zip("SCOT", 2018, "SCOT_00_2018.zip", "SCOT,20181231,23:59:00,2.100"),
      zip(
        "SCOT",
        2019,
        "SCOT_00_2019.zip",
        "SCOT,20190101,00:00:00,2.110\nSCOT,20190101,11:59:00,2.120\nSCOT,20190101,12:00:00,2.130",
      ),
    ]);
    const obs = await linz.levels(
      "SCOT",
      new Date("2018-12-31T00:00:00Z"),
      new Date("2019-01-01T00:00:00Z"),
    );
    assert.deepEqual(
      obs.map((o) => [iso(o), o.level]),
      [
        ["2018-12-31T11:59", 2.1],
        ["2018-12-31T12:00", 2.11],
        ["2018-12-31T23:59", 2.12],
      ],
    );
    // A range early in a year asks for no other year.
    requests.length = 0;
    await linz.levels("SCOT", new Date("2018-06-01T00:00:00Z"), new Date("2018-06-02T00:00:00Z"));
    assert.ok(requests.every(([url]) => !/2019/.test(url)));
  });

  it("reads Scott Base's 2026 file, which LINZ names for its months", async () => {
    const requests = serve([
      list("SCOT", 2026, "SCOT_00_2026_01-03.zip"),
      zip(
        "SCOT",
        2026,
        "SCOT_00_2026_01-03.zip",
        "2026-01-02,00:00:00,2476\n2026-03-05,11:49:00,1065\n2026-03-05,12:00:00,1000",
      ),
    ]);
    const obs = await linz.levels(
      "SCOT",
      new Date("2026-01-01T00:00:00Z"),
      new Date("2027-01-01T00:00:00Z"),
      { record_start: "2016-01-01T00:00:00.000Z", record_end: "2026-03-05T00:00:00.000Z" },
    );
    // The gauge was removed on 5 March (NZST), and the record ends on UTC's 5th.
    assert.deepEqual(
      obs.map((o) => [iso(o), o.level, o.flag]),
      [
        ["2026-01-01T12:00", 2.476, Flag.good],
        ["2026-03-04T23:49", 1.065, Flag.good],
      ],
    );
    assert.equal(requests.filter(([url]) => /SCOT_00_2026_01-03/.test(url)).length, 1);
    // A month the file doesn't cover isn't downloaded.
    requests.length = 0;
    await linz.levels("SCOT", new Date("2026-06-01T00:00:00Z"), new Date("2026-07-01T00:00:00Z"));
    assert.ok(requests.every(([url]) => !/SCOT_00_2026_01-03/.test(url)));
  });

  it("leaves out the spans where the gauge reads no sea level", async () => {
    serve([
      list("SCOT", 2025, "SCOT_00_2025.zip"),
      zip(
        "SCOT",
        2025,
        "SCOT_00_2025.zip",
        [
          "8/03/2025,12:00:00,2500",
          "10/03/2025,12:00:00,-20",
          "20/11/2025,12:00:00,-20",
          "21/11/2025,15:00:00,1500",
        ].join("\n"),
      ),
      list("SCOT", 2026),
    ]);
    const obs = await linz.levels(
      "SCOT",
      new Date("2025-03-01T00:00:00Z"),
      new Date("2025-12-31T00:00:00Z"),
    );
    // Scott Base's gauge read -0.02 m, flat, from 9 March to 20 November (erratum `linz-scott-base-step-2025`).
    assert.deepEqual(
      obs.map((o) => [iso(o), o.level]),
      [
        ["2025-03-08T00:00", 2.5],
        ["2025-11-21T03:00", 1.5],
      ],
    );
  });

  it("cuts Cape Roberts' 3 February 2019 step to the end of its day", async () => {
    serve([
      list("ROBT", 2019, "ROBT_00_2019.zip"),
      zip(
        "ROBT",
        2019,
        "ROBT_00_2019.zip",
        [
          "2019,34,255,30,5.8,-2,986",
          "2019,34,300,30,5.9,-2,986",
          "2019,34,2355,30,7.2,-2,986",
          "2019,35,0,30,7.1,-2,986",
        ].join("\n"),
      ),
    ]);
    const obs = await linz.levels(
      "ROBT",
      new Date("2019-02-03T00:00:00Z"),
      new Date("2019-02-05T00:00:00Z"),
    );
    assert.deepEqual(
      obs.map((o) => [iso(o), o.level]),
      [
        ["2019-02-03T02:55", 5.8],
        ["2019-02-04T00:00", 7.1],
      ],
    );
  });

  it("opens an epoch at each step in the Antarctic gauges' zeros, with no conversion where nothing measured it", () => {
    const options = (station: string, withOverrides: boolean) => ({
      station,
      now: "2026-11-15T00:00:00Z",
      offsets: [0, 0] as [number, number],
      decisions: withOverrides ? linz.source.overrides!.epochs! : {},
      splits: withOverrides ? linz.source.overrides!.splits : undefined,
      archive: "previous" as const,
    });
    const fetched = { datum: "ZERO", datums: {}, reference: null };
    const epochsOf = (station: string) =>
      firstEpochs(fetched, options(station, true)).map((e) => [e.since, e.to_current]);
    assert.deepEqual(epochsOf("linz/ROBT"), [
      [null, null],
      ["2010-11-05T00:00:00Z", null],
      ["2019-02-04T00:00:00Z", null],
      ["2021-11-06T00:00:00Z", 0],
    ]);
    assert.deepEqual(
      epochsOf("linz/SCOT").map(([since]) => since),
      [
        null,
        "2016-03-29T00:00:00Z",
        "2018-01-22T00:00:00Z",
        "2019-11-03T00:00:00Z",
        "2020-05-12T00:00:00Z",
        "2021-11-17T00:00:00Z",
        "2022-10-30T00:00:00Z",
        "2025-11-20T00:00:00Z",
      ],
    );
    assert.ok(
      epochsOf("linz/SCOT")
        .slice(0, -1)
        .every(([, to]) => to === null),
    );
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

  it("keeps a calibration's offset only while no sensors were replaced since", () => {
    const head = "NAME: X\r\nWGS-84 POSITION: 41\u00b0 17' 04\"S\r\n 174\u00b0 46' 47\"E\r\n";
    const table = "Results of 2022 calibration:\r\n  CD - 1.53\r\n  TG0 - 0.000\r\n";
    const history = (y: number) => `GAUGE HISTORY\r\n${y}: sensors replaced November 24\r\n`;
    // CD is 1.53 m above gauge zero, so a level above it is that much less above CD.
    assert.deepEqual(linz.parseReadme(head + history(2021) + table)!.datums, { CD: -1.53 });
    assert.deepEqual(linz.parseReadme(head + history(2022) + table)!.datums, {});
    assert.deepEqual(linz.parseReadme(head + history(2024) + table)!.datums, {});
  });

  it("refuses a README without a name or a position", () => {
    assert.equal(linz.parseReadme("WGS-84 POSITION: 41° 17' 04\"S 174° 46' 47\"E"), null);
    assert.equal(linz.parseReadme("NAME: X\nWGS-84 POSITION: 41° 17' 04\"S"), null);
  });
});

describe("linz Antarctic files in a layout it doesn't know", () => {
  linz.pacing.requestMs = 0;

  it("fails a file of many rows that none of its layouts read, rather than read it as no data", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => `ROBT,2026010${1 + (i % 9)},00:05:00,5912`);
    serve([
      [
        /listDatasetFiles\/ROBT\/2026\/00$/,
        JSON.stringify({ files: [{ name: "ROBT_00_2026.zip" }] }),
      ],
      [/tidegauge\/ROBT\/2026\/00\/ROBT_00_2026\.zip$/, zipOf("ROBT_00_2026.zip", rows.join("\n"))],
    ]);
    await assert.rejects(
      linz.levels("ROBT", new Date("2026-01-01T00:00:00Z"), new Date("2026-02-01T00:00:00Z")),
      /none of a layout or unit this reads/,
    );
  });
});
