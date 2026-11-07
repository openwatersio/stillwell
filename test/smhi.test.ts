import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as smhi from "../src/sources/smhi/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Requests made, with their options. */
let requests: [string, RequestOptions][] = [];

/** Answer requests from fixtures, by the first pattern the URL matches. */
function serve(routes: [RegExp, string | (() => string)][]): void {
  setTransport(async (url, options) => {
    requests.push([url, options]);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return typeof route[1] === "function" ? route[1]() : route[1];
  });
}

/** Arkö's archive and latest day, recorded at 01:39 UTC on 7 November 2026. */
const RECORDED = Date.parse("2026-11-07T01:39:00Z");
const arko: [RegExp, string][] = [
  [/2545\/period\/corrected-archive/, fixture("smhi-archive.csv")],
  [/2545\/period\/latest-day/, fixture("smhi-latest-day.csv")],
];

const iso = (t: number) => new Date(t).toISOString();

describe("smhi", () => {
  smhi.pacing.requestMs = 0;

  beforeEach(() => {
    requests = [];
    smhi.forgetArchives();
    mock.timers.enable({ apis: ["Date"], now: RECORDED });
  });

  afterEach(() => {
    setTransport(fetchText);
    mock.timers.reset();
  });

  it("lists every sea-level station with its record span", async () => {
    serve([[/parameter\/6\.json/, fixture("smhi-stations.json")]]);
    const stations = await smhi.stations();
    assert.deepEqual(
      stations.map((s) => [s.id, s.status, s.live, s.kind, s.record_start, s.record_end]),
      [
        ["smhi/2088", "active", true, "coastal", "1886-12-01T00:00:00.000Z", null],
        ["smhi/2545", "active", true, "coastal", "2014-04-02T07:00:00.000Z", null],
        [
          "smhi/33092",
          "inactive",
          false,
          "estuary",
          "2010-10-20T08:00:00.000Z",
          "2013-05-15T13:00:00.000Z",
        ],
        ["smhi/33094", "active", true, "estuary", "2010-08-27T11:00:00.000Z", null],
      ],
    );
    const arkoStation = stations.find((s) => s.id === "smhi/2545")!;
    assert.equal(arkoStation.datum, "RH2000");
    assert.equal(arkoStation.country_code, "SE");
    assert.equal(arkoStation.interval_s, 3600);
    assert.equal(arkoStation.license, "CC-BY-4.0");
    assert.equal(arkoStation.attribution, "SMHI");
    assert.equal(requests[0]![1].fresh, true);
  });

  it("refuses an empty station list", async () => {
    serve([[/parameter\/6\.json/, JSON.stringify({ station: [] })]]);
    await assert.rejects(smhi.stations(), /no sea-level stations/);
  });

  it("reads the last hours from latest-day alone, in meters at UTC", async () => {
    serve(arko);
    const levels = await smhi.levels(
      "2545",
      new Date(RECORDED - 12 * 3_600_000),
      new Date(RECORDED),
    );
    assert.deepEqual(
      requests.map(([url]) => url.replace(/.*station\//, "")),
      ["2545/period/latest-day/data.csv"],
    );
    assert.deepEqual(levels.at(-1), {
      time: Date.parse("2026-11-07T00:00:00Z"),
      level: 0.022,
      // G, but within the month SMHI may still correct.
      flag: Flag.preliminary,
    });
    assert.equal(levels.length, 11);
  });

  it("joins the archive and latest-day without gaps or repeats", async () => {
    serve(arko);
    const start = Date.parse("2026-11-04T00:00:00Z");
    const levels = await smhi.levels("2545", new Date(start), new Date(RECORDED + 3_600_000));
    assert.deepEqual(
      requests.map(([url]) => url.replace(/.*period\//, "")),
      ["corrected-archive/data.csv", "latest-day/data.csv"],
    );
    assert.equal(iso(levels[0]!.time), iso(start));
    assert.ok(levels.every((l, i) => i === 0 || l.time - levels[i - 1]!.time === 3_600_000));
    const latest = smhi.parse(fixture("smhi-latest-day.csv"), "2545", "RH2000");
    assert.equal(levels.at(-1)!.time, latest.last);
  });

  it("reads each archive once per process and slices it by range", async () => {
    serve(arko);
    await smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-05Z"));
    const day = await smhi.levels("2545", new Date("2026-11-05Z"), new Date("2026-11-06Z"));
    assert.equal(day.length, 24);
    assert.equal(requests.filter(([url]) => /corrected-archive/.test(url)).length, 1);
  });

  it("maps G to good, O and Y to preliminary, and others to suspect once SMHI's corrections are done", async () => {
    mock.timers.setTime(Date.parse("2027-03-01T00:00:00Z"));
    // Recorded archives hold no Y, so one value is changed to it here.
    const archive = fixture("smhi-archive.csv")
      .replace("2026-11-04 05:00:00;7.6;G", "2026-11-04 05:00:00;7.6;Y")
      .replace("2026-11-04 06:00:00;7.1;G", "2026-11-04 06:00:00;7.1;X");
    serve([[/corrected-archive/, archive]]);
    const levels = await smhi.levels("2545", new Date("2014-01-01Z"), new Date("2026-11-05Z"));
    const flags = Object.fromEntries(levels.map((l) => [iso(l.time), l.flag]));
    assert.equal(flags["2014-04-02T08:00:00.000Z"], Flag.preliminary);
    assert.equal(flags["2026-11-04T04:00:00.000Z"], Flag.good);
    assert.equal(flags["2026-11-04T05:00:00.000Z"], Flag.preliminary);
    assert.equal(flags["2026-11-04T06:00:00.000Z"], Flag.suspect);
    assert.equal(levels.find((l) => iso(l.time) === "2014-04-02T08:00:00.000Z")!.level, -0.006);
  });

  it("refuses values in another height system", async () => {
    serve([[/corrected-archive/, fixture("smhi-archive.csv").replace("RH2000", "RH70")]]);
    await assert.rejects(
      smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-05Z")),
      /measured from RH70, not RH2000/,
    );
  });

  it("refuses a stale archive whose own end note matches its last row", async () => {
    const text = fixture("smhi-archive.csv");
    // A copy built on 5 November: its rows and its note end together.
    const stale = text
      .slice(0, text.indexOf("2026-11-05 01:00:00"))
      .replace("t.o.m.) = 2026-11-07 01:00:00", "t.o.m.) = 2026-11-05 01:00:00");
    serve([[/corrected-archive/, stale]]);
    await assert.rejects(
      smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-07Z")),
      /archive ends at 2026-11-05T00:00:00.000Z, before 2026-11-06T00:00:00/,
    );
    // A closed station's archive only has to reach the end the list gives.
    smhi.forgetArchives();
    const levels = await smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-06Z"), {
      record_end: "2026-11-05T01:00:00.000Z",
    });
    assert.ok(levels.length);
  });

  it("reads a closed station's final archive whose last hours have no values", async () => {
    // Landsort's archive ends at 09:00, though its note and the list give 12:00.
    const text = fixture("smhi-archive.csv");
    const final = text.slice(0, text.indexOf("2026-11-05 01:00:00"));
    const range = [new Date("2026-11-04Z"), new Date("2026-11-06Z")] as const;
    serve([[/corrected-archive/, final]]);
    const levels = await smhi.levels("2545", ...range, { record_end: "2026-11-05T03:00:00.000Z" });
    assert.ok(levels.length);
    // A stale copy's note ends with its own rows, so it gets only the hour's slack.
    smhi.forgetArchives();
    serve([
      [
        /corrected-archive/,
        final.replace("t.o.m.) = 2026-11-07 01:00:00", "t.o.m.) = 2026-11-05 00:00:00"),
      ],
    ]);
    await assert.rejects(
      smhi.levels("2545", ...range, { record_end: "2026-11-05T03:00:00.000Z" }),
      /archive ends at 2026-11-05T00:00:00.000Z, before 2026-11-05T03:00:00/,
    );
    // More than six hours short is cut, whatever its note says.
    smhi.forgetArchives();
    serve([[/corrected-archive/, final]]);
    await assert.rejects(
      smhi.levels("2545", ...range, { record_end: "2026-11-05T07:00:00.000Z" }),
      /archive ends at 2026-11-05T00:00:00.000Z, before 2026-11-05T07:00:00/,
    );
    smhi.forgetArchives();
    assert.ok(
      (await smhi.levels("2545", ...range, { record_end: "2026-11-05T06:00:00.000Z" })).length,
    );
  });

  it("refuses an archive cut within its last day, read after the station's year", async () => {
    mock.timers.setTime(Date.parse("2027-03-01T00:00:00Z"));
    const text = fixture("smhi-archive.csv");
    const cut = text.slice(0, text.indexOf("2026-11-06 13:00:00"));
    serve([[/corrected-archive/, cut]]);
    await assert.rejects(
      smhi.levels("2545", new Date("2026-01-01Z"), new Date("2027-01-01Z")),
      /archive ends at 2026-11-06T12:00:00.000Z, before 2027-02-28T00:00:00/,
    );
  });

  it("reads a few hours of latest-day whose notes stop before the height system", async () => {
    const short = fixture("smhi-latest-day.csv")
      .split("\n")
      .filter((l) => !/^2026-11-06 (0[3-9]|1\d|2\d)/.test(l))
      .map((l) => l.replace(/;;[^;]*Höjdsystem[^\r\n]*/, ";;"))
      .join("\n");
    serve([[/latest-day/, short]]);
    const levels = await smhi.levels(
      "2545",
      new Date(RECORDED - 12 * 3_600_000),
      new Date(RECORDED),
    );
    assert.ok(levels.length > 0);
  });

  it("refuses an archive that ends before SMHI says it runs to", async () => {
    const cut = fixture("smhi-archive.csv").split("\n").slice(0, -40).join("\n");
    serve([[/corrected-archive/, cut]]);
    await assert.rejects(
      smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-07Z")),
      /archive ends at .* before 2026-11-06T00:00:00/,
    );
    // A range that ends inside what the archive holds loses nothing, so it's read.
    assert.ok((await smhi.levels("2545", new Date("2026-11-04Z"), new Date("2026-11-05Z"))).length);
  });

  it("asks for nothing outside a closed station's record", async () => {
    serve([[/33092\/period\/corrected-archive/, fixture("smhi-archive-closed.csv")]]);
    const span = {
      record_start: "2010-10-20T08:00:00.000Z",
      record_end: "2013-05-15T13:00:00.000Z",
    };
    assert.deepEqual(
      await smhi.levels("33092", new Date("2009-01-01Z"), new Date("2010-01-01Z"), span),
      [],
    );
    assert.deepEqual(
      await smhi.levels("33092", new Date("2014-01-01Z"), new Date("2015-01-01Z"), span),
      [],
    );
    assert.equal(requests.length, 0);
    const levels = await smhi.levels(
      "33092",
      new Date("2013-01-01Z"),
      new Date("2014-01-01Z"),
      span,
    );
    assert.equal(levels.length, 24);
    // A closed station's last year needs no latest-day.
    assert.equal(requests.length, 1);
  });

  it("never lets a cache keep a response", async () => {
    serve([[/parameter\/6\.json/, fixture("smhi-stations.json")], ...arko]);
    await smhi.stations();
    await smhi.levels("2545", new Date("2026-11-04Z"), new Date(RECORDED));
    assert.equal(requests.length, 3);
    assert.ok(requests.every(([, options]) => options.fresh === true && !options.keep));
  });
});
