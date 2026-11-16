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
