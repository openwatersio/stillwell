import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as cdec from "../src/sources/cdec/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

let requests: [string, RequestOptions][] = [];

function serve(route: (url: string) => string): void {
  setTransport(async (url, options) => {
    requests.push([url, options]);
    return route(url);
  });
}

const iso = (t: number) => new Date(t).toISOString();

/** A page laid out as CDEC's are, for a station with no 15-minute stage. */
const NO_STAGE =
  "<html><h2>NO STAGE</h2><tr><td><b>Latitude</b></td><td>38.1&#176</td><td><b>Longitude</b></td><td>-121.5&#176</td></tr><tr><td><b>Operator</b></td><td>CA Dept of Water Resources</td></tr>The following data types are available online.</html>";

describe("cdec", () => {
  cdec.pacing.requestMs = 0;

  beforeEach(() => {
    requests = [];
  });

  afterEach(() => {
    setTransport(fetchText);
  });

  it("lists the stations others than USGS run, NAVD88 from the date their pages give", async () => {
    // Martinez, Georgiana Slough and the Deep Water Ship Channel (USGS's); every other code has no page.
    const pages: Record<string, string> = {
      MRZ: fixture("cdec-meta-MRZ.html"),
      GSS: fixture("cdec-meta-GSS.html"),
      DWS: fixture("cdec-meta-DWS.html"),
    };
    serve((url) => {
      const code = /station_id=(\w+)/.exec(url)![1]!;
      return pages[code] ?? NO_STAGE;
    });
    const stations = (await cdec.stations()) as cdec.CdecStation[];
    assert.equal(requests.length, cdec.CODES.length);
    assert.deepEqual(
      stations.map((s) => [s.id, s.datum, s.status, s.live, s.record_start, s.attribution]),
      [
        [
          "cdec/GSS",
          "NAVD88",
          "active",
          true,
          // 15-minute stage from 2003, but NAVD88 only from Pacific midnight, 1 October 2005.
          "2005-10-01T07:00:00.000Z",
          "U.S. Bureau of Reclamation, via CDEC",
        ],
        [
          "cdec/MRZ",
          "NAVD88",
          "active",
          true,
          "2008-08-21T07:00:00.000Z",
          "California Department of Water Resources, via CDEC",
        ],
      ],
    );
    const mrz = stations.find((s) => s.id === "cdec/MRZ")!;
    assert.equal(mrz.name, "Martinez");
    assert.equal(mrz.lat, 38.027637);
    assert.equal(mrz.lon, -122.140488);
    assert.equal(mrz.interval_s, 900);
    assert.ok(requests.every(([, o]) => o.fresh));
  });

  it("refuses a page without a name, a sensor table or a readable stage row", () => {
    assert.throws(() => cdec.parseMeta("<html></html>", "MRZ"), /no name, operator or position/);
    const mrz = fixture("cdec-meta-MRZ.html");
    // Cut before its sensors, it mustn't read as a station with no stage.
    assert.throws(
      () => cdec.parseMeta(mrz.slice(0, mrz.indexOf("The following data types")), "MRZ"),
      /no sensor table/,
    );
    assert.throws(
      () => cdec.parseMeta(mrz.replaceAll("08/21/2008 to present", "since 2008"), "MRZ"),
      /stage row it can't read/,
    );
  });

  it("refuses a page whose gauge-zero datum disagrees with the adapter's list", async () => {
    // GSS's page with its zero in NGVD 29, though the adapter lists it in NAVD88.
    const gss = fixture("cdec-meta-GSS.html").replace("NAVD 88", "NGVD 29");
    assert.equal(cdec.parseMeta(gss, "GSS").zeroDatum, "NGVD 29");
    serve((url) => (/station_id=GSS/.test(url) ? gss : NO_STAGE));
    await assert.rejects(
      cdec.stations(),
      /GSS gives its zero in NGVD 29, but the adapter lists it in NAVD88/,
    );
  });

  it("merges a station's 15-minute stage rows", () => {
    const mrz = fixture("cdec-meta-MRZ.html");
    const i = mrz.indexOf("<tr><td align=left><b>RIVER STAGE</b>, FEET");
    const row = mrz.slice(i, mrz.indexOf("</tr>", i) + 5);
    // A closed row after the current one, as CDEC lists old collection methods.
    const closed = row
      .replace("DATA XCHG-DWR ISE", "SATELLITE")
      .replace("08/21/2008 to present", "01/01/1998 to 08/20/2008");
    const meta = cdec.parseMeta(mrz.replace(row, row + closed), "MRZ");
    assert.deepEqual(meta.stage, { from: "01/01/1998", to: null });
  });

  it("keeps NAVD88 stations to their start date, read from stations.parquet too", async () => {
    serve(
      () =>
        "STATION_ID,DURATION,SENSOR_NUMBER,SENSOR_TYPE,DATE TIME,OBS DATE,VALUE,DATA_FLAG,UNITS\n",
    );
    await cdec.levels({ source_id: "GSS" }, new Date("2004-01-01Z"), new Date("2006-01-01Z"));
    assert.deepEqual(
      requests.map(([url]) => /Start=([\d-]+)/.exec(url)![1]),
      ["2005-10-01"],
    );
  });

  it("credits the agencies that run a station", () => {
    assert.equal(
      cdec.attributionOf("USBR/DWR"),
      "U.S. Bureau of Reclamation, California Department of Water Resources, via CDEC",
    );
    assert.equal(cdec.attributionOf("City of Petaluma"), "City of Petaluma, via CDEC");
    assert.equal(
      cdec.attributionOf("CA Dept of Water Resources/Div of Integrated Science and Eng"),
      "California Department of Water Resources, via CDEC",
    );
    assert.equal(
      cdec.attributionOf("CA Dept of Water Resources/Contra Costa Water District"),
      "California Department of Water Resources, Contra Costa Water District, via CDEC",
    );
    // A local reclamation district isn't the Bureau, and an agency named "Regional" is kept.
    assert.equal(
      cdec.attributionOf("Reclamation District 2068"),
      "Reclamation District 2068, via CDEC",
    );
    assert.equal(
      cdec.attributionOf("Central Valley Regional Water Quality Control Board"),
      "Central Valley Regional Water Quality Control Board, via CDEC",
    );
    assert.throws(() => cdec.attributionOf(" / "), /names no operator/);
  });

  it("converts Pacific time, with daylight saving, to UTC", () => {
    const at = (wall: string) => iso(cdec.fromPacific(Date.parse(`${wall}Z`)));
    assert.equal(at("2026-01-01T12:00"), "2026-01-01T20:00:00.000Z");
    assert.equal(at("2026-07-01T12:00"), "2026-07-01T19:00:00.000Z");
    // Spring forward: 01:45 PST, then 03:00 PDT, fifteen minutes later.
    assert.equal(at("2026-03-08T01:45"), "2026-03-08T09:45:00.000Z");
    assert.equal(at("2026-03-08T03:00"), "2026-03-08T10:00:00.000Z");
    // Fall back: 00:30 is still PDT; the repeated 01:00 hour is read as PST.
    assert.equal(at("2025-11-02T00:30"), "2025-11-02T07:30:00.000Z");
    assert.equal(at("2025-11-02T01:00"), "2025-11-02T09:00:00.000Z");
  });

  it("reads stage in meters at UTC, preliminary, across the end of daylight saving", async () => {
    serve(() => fixture("cdec-MRZ-dst.csv"));
    const levels = await cdec.levels(
      { source_id: "MRZ" },
      new Date("2025-11-01T07:00:00Z"),
      new Date("2025-11-03T08:00:00Z"),
    );
    assert.match(
      requests[0]![0],
      /Stations=MRZ&SensorNums=1&dur_code=E&Start=2025-11-01&End=2025-11-04/,
    );
    // 2025-11-01 00:00 PDT, 4.18 ft.
    assert.deepEqual(levels[0], {
      time: Date.parse("2025-11-01T07:00:00Z"),
      level: 1.274,
      flag: Flag.preliminary,
    });
    // CDEC's 00:45 on the day daylight saving ends is dropped; its 01:00 hour is standard time.
    const times = levels.map((l) => iso(l.time));
    assert.ok(!times.includes("2025-11-02T07:45:00.000Z"));
    assert.ok(times.includes("2025-11-02T07:30:00.000Z"));
    assert.ok(times.includes("2025-11-02T09:00:00.000Z"));
    assert.ok(levels.every((l, i) => i === 0 || l.time > levels[i - 1]!.time));
    // 193 rows, 1 November 00:00 to 3 November 00:00, less that 00:45 and the last, at the range end.
    assert.equal(levels.length, 191);
  });

  it("asks a calendar year at a time, and nothing outside the record", async () => {
    serve(
      () =>
        "STATION_ID,DURATION,SENSOR_NUMBER,SENSOR_TYPE,DATE TIME,OBS DATE,VALUE,DATA_FLAG,UNITS\n",
    );
    await cdec.levels(
      { source_id: "MRZ", record_start: "2024-06-01T07:00:00Z" },
      new Date("2020-01-01Z"),
      new Date("2026-01-01Z"),
    );
    assert.deepEqual(
      requests.map(([url]) => /Start=([\d-]+)&End=([\d-]+)/.exec(url)!.slice(1)),
      [
        ["2024-06-01", "2025-01-01"],
        ["2024-12-31", "2026-01-01"],
      ],
    );
    requests = [];
    const closed = { source_id: "ROR", record_end: "2011-10-08T07:00:00Z" };
    assert.deepEqual(
      await cdec.levels(closed, new Date("2012-01-01Z"), new Date("2013-01-01Z")),
      [],
    );
    assert.equal(requests.length, 0);
  });

  it("skips missing readings and refuses bad rows", () => {
    const header =
      "STATION_ID,DURATION,SENSOR_NUMBER,SENSOR_TYPE,DATE TIME,OBS DATE,VALUE,DATA_FLAG,UNITS";
    const rows = (...r: string[]) => [header, ...r].join("\n");
    assert.deepEqual(
      cdec.parse(rows("MRZ,E,1,RIV STG,20250101 0000,20250101 0000,---, ,FEET"), "MRZ"),
      [],
    );
    assert.deepEqual(
      cdec.parse(rows("MRZ,E,1,RIV STG,20250101 0000,20250101 0000,---, ,"), "MRZ"),
      [],
    );
    assert.throws(
      () => cdec.parse(rows("MRZ,E,1,RIV STG,20250230 0000,20250230 0000,1.0, ,FEET"), "MRZ"),
      /bad row/,
    );
    assert.throws(
      () => cdec.parse(rows("MRZ,E,1,RIV STG,20250101 0000,20250101 0000,1.0, ,METERS"), "MRZ"),
      /rather than feet/,
    );
    assert.throws(
      () => cdec.parse(rows("MAL,E,1,RIV STG,20250101 0000,20250101 0000,1.0, ,FEET"), "MRZ"),
      /row for MAL/,
    );
    assert.throws(() => cdec.parse("<html>", "MRZ"), /unexpected header/);
  });
});
