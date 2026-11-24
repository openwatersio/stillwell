import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import { sources } from "../src/sources/index.ts";
import * as cdec from "../src/sources/cdec/index.ts";
import { mergeStationList } from "../src/stations.ts";

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
  "<html><h2>NO STAGE</h2><tr><td><b>Latitude</b></td><td>38.1&#176</td><td><b>Longitude</b></td><td>-121.5&#176</td></tr><tr><td><b>Operator</b></td><td>CA Dept of Water Resources</td></tr>The following data types are available online.<table></table></html>";

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
    // Cut just after the heading, before the table ends.
    assert.throws(
      () => cdec.parseMeta(mrz.slice(0, mrz.indexOf("The following data types") + 200), "MRZ"),
      /no sensor table/,
    );
    assert.throws(
      () => cdec.parseMeta(mrz.replaceAll("08/21/2008 to present", "since 2008"), "MRZ"),
      /stage row it can't read/,
    );
  });

  it("lists each station in the datum its page gives", async () => {
    assert.deepEqual(cdec.parseMeta(fixture("cdec-meta-MRZ.html"), "MRZ").zero, {
      feet: 0,
      datum: "NAVD 88",
    });
    // A zero of 0.0 ft puts stage in that datum; any other is stage above it.
    assert.deepEqual(cdec.datumOf("MRZ", { feet: 0, datum: "NAVD 88" }), {
      datum: "NAVD88",
      datums: {},
      reference: "0 ft NAVD88",
    });
    assert.deepEqual(cdec.datumOf("SDC", { feet: 5, datum: "NGVD 29" }), {
      datum: "GZ",
      datums: { NGVD29: 1.524 },
      reference: "5 ft NGVD29",
    });
    // No table: a datum the notes give, or gauge zero.
    assert.deepEqual(cdec.datumOf("BDL", null), { datum: "NAVD88", datums: {}, reference: null });
    assert.deepEqual(cdec.datumOf("HOL", null), { datum: "GZ", datums: {}, reference: null });
    assert.throws(
      () => cdec.datumOf("HOL", { feet: 0, datum: "MLLW 1" }),
      /unknown datum, "MLLW 1"/,
    );
    // A page that moves GSS to NGVD 29 moves the station, for the refresh to open or hold an epoch.
    const gss = fixture("cdec-meta-GSS.html").replace("NAVD 88", "NGVD 29");
    serve((url) => (/station_id=GSS/.test(url) ? gss : NO_STAGE));
    const [listed] = await cdec.stations();
    assert.deepEqual([listed!.id, listed!.datum], ["cdec/GSS", "NGVD29"]);
  });

  it("reports the gauge zero as the reference, and keeps the datum when a page loses its table", async () => {
    serve((url) => (/station_id=GSS/.test(url) ? fixture("cdec-meta-GSS.html") : NO_STAGE));
    const fetched = await cdec.stations();
    assert.deepEqual(fetched[0]!.reference, { id: "0 ft NAVD88", since: null });
    // The store's list keeps the reference on the station's epoch, not the station.
    const options = {
      now: "2026-11-02T00:00:00Z",
      offsets: [-8, -7] as [number, number],
      decisions: {},
    };
    const { stations: store } = mergeStationList([], fetched, options);
    assert.equal("reference" in store[0]!, false);
    // The same page without its gauge-zero table says nothing of the datum this time.
    const bare = fixture("cdec-meta-GSS.html").replace(/<th>Zero[\s\S]*?<\/table>/, "</table>");
    serve((url) => (/station_id=GSS/.test(url) ? bare : NO_STAGE));
    const again = await cdec.stations(store);
    assert.deepEqual([again[0]!.datum, again[0]!.reference], [null, null]);
    // So the merge keeps GSS in NAVD88, with no new epoch.
    const merged = mergeStationList(store, again, { ...options, now: "2026-12-02T00:00:00Z" });
    assert.equal(merged.stations[0]!.datum, "NAVD88");
    assert.equal(merged.stations[0]!.epochs.length, 1);
    // A new station without a table has no reference to compare later.
    serve((url) => (/station_id=GSS/.test(url) ? bare : NO_STAGE));
    assert.deepEqual((await cdec.stations())[0]!.reference, null);
  });

  it("refuses a listed station whose stage row is gone, and a datum it doesn't know", async () => {
    serve((url) => (/station_id=GSS/.test(url) ? fixture("cdec-meta-GSS.html") : NO_STAGE));
    const fetched = await cdec.stations();
    serve((url) => (/station_id=GSS/.test(url) ? NO_STAGE.replace("NO STAGE", "GSS") : NO_STAGE));
    await assert.rejects(
      cdec.stations(fetched as never),
      /GSS no longer shows its 15-minute stage/,
    );
    const usgs = fixture("cdec-meta-GSS.html").replace(
      "<td>US Bureau of Reclamation</td>",
      "<td>USBR/USGS</td>",
    );
    serve((url) => (/station_id=GSS/.test(url) ? usgs : NO_STAGE));
    await assert.rejects(cdec.stations(fetched as never), /GSS now names USBR\/USGS/);
    // A USGS page's own tables aren't read, as VON's "0.0' USED" flood-guidance row.
    const von = usgs.replace(/0\.0' NAVD 88/, "0.0' USED");
    serve((url) => (/station_id=GSS/.test(url) ? von : NO_STAGE));
    // It's left out without reading that row, so the only error is the empty list.
    await assert.rejects(cdec.stations(), /listed none of its stations/);
    const msl = fixture("cdec-meta-GSS.html").replace(/0\.0' NAVD 88/, "0.0' MSL");
    assert.deepEqual(cdec.parseMeta(msl, "GSS").zero, { feet: 0, datum: "MSL" });
    serve((url) => (/station_id=GSS/.test(url) ? msl : NO_STAGE));
    await assert.rejects(cdec.stations(), /unknown datum, "MSL"/);
    // A non-zero zero read from a page, as SDC's 5.0 ft NGVD 29.
    const sdc = fixture("cdec-meta-GSS.html").replace(/0\.0' NAVD 88/, "5.0' NGVD 29");
    assert.deepEqual(cdec.parseMeta(sdc, "SDC").zero, { feet: 5, datum: "NGVD 29" });
  });

  it("skips a bad page only for a code the last list left out", async () => {
    const gssPage = fixture("cdec-meta-GSS.html");
    serve((url) =>
      /station_id=GSS/.test(url) ? gssPage : /station_id=RYI/.test(url) ? "<html>" : NO_STAGE,
    );
    await assert.rejects(cdec.stations(), /RYI has no name/);
    const [gss] = await cdec.stations([{ source_id: "GSS" } as never]);
    assert.equal(gss!.id, "cdec/GSS");
    serve((url) => (/station_id=GSS/.test(url) ? "<html>" : NO_STAGE));
    await assert.rejects(cdec.stations([{ source_id: "GSS" } as never]), /GSS has no name/);
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
      /Stations=MRZ&SensorNums=1&dur_code=E&Start=2025-11-01&End=2025-11-03/,
    );
    // 2025-11-01 00:00 PDT, 4.18 ft.
    assert.deepEqual(levels[0], {
      time: Date.parse("2025-11-01T07:00:00Z"),
      level: 1.274,
      flag: Flag.preliminary,
    });
    // The level drops 1.25 ft from 00:30 to 00:45 on the day daylight saving ends, the hour the clock's
    // switch skips, so 00:45 is standard time; the hour from 01:00 is standard time too.
    const times = levels.map((l) => iso(l.time));
    assert.ok(!times.includes("2025-11-02T07:45:00.000Z"));
    assert.ok(times.includes("2025-11-02T07:30:00.000Z"));
    assert.ok(times.includes("2025-11-02T08:45:00.000Z"));
    assert.ok(times.includes("2025-11-02T09:00:00.000Z"));
    assert.ok(levels.every((l, i) => i === 0 || l.time > levels[i - 1]!.time));
    // 193 rows, 1 November 00:00 to 3 November 00:00, less the last, at the range end.
    assert.equal(levels.length, 192);
  });

  describe("the day daylight saving ends", () => {
    /** CSV rows for 2 November 2025, 00:00 to 02:00, at the given feet by stamp. */
    /** A reply covering the day to 01:45 (`reach`), its last level held to there unless it ends early. */
    const day = (feet: Record<string, number>, reach = true) =>
      [
        "STATION_ID,DURATION,SENSOR_NUMBER,SENSOR_TYPE,DATE TIME,OBS DATE,VALUE,DATA_FLAG,UNITS",
        ...Object.entries({
          ...(reach
            ? { "0130": Object.values(feet).at(-1)!, "0145": Object.values(feet).at(-1)! }
            : {}),
          ...feet,
        })
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([hhmm, v]) => `MRZ,E,1,STAGE,20251102 ${hhmm},20251102 ${hhmm},${v}, ,FEET`),
      ].join("\n");
    const times = (csv: string) => cdec.parse(csv, "MRZ").map((l) => iso(l.time));
    const flat = { "0000": 4, "0015": 4.1, "0030": 4.2, "0045": 4.3, "0100": 4.4, "0115": 4.5 };

    it("reads the stamps after the jump as standard time, and the ones before as daylight time", () => {
      // The skipped hour shows between 00:15 and 00:30.
      const early = times(day({ ...flat, "0030": 2.5, "0045": 2.4, "0100": 2.3, "0115": 2.2 }));
      assert.ok(early.includes("2025-11-02T07:15:00.000Z"));
      assert.ok(early.includes("2025-11-02T08:30:00.000Z"));
      assert.ok(early.includes("2025-11-02T08:45:00.000Z"));
      assert.ok(!early.includes("2025-11-02T07:30:00.000Z"));
      // Between 00:30 and 00:45.
      const middle = times(day({ ...flat, "0045": 2.5, "0100": 2.4, "0115": 2.3 }));
      assert.ok(middle.includes("2025-11-02T07:30:00.000Z"));
      assert.ok(middle.includes("2025-11-02T08:45:00.000Z"));
      assert.ok(!middle.includes("2025-11-02T07:45:00.000Z"));
      // Between 00:45 and 01:00, where every 00:xx stamp is daylight time.
      const late = times(day({ ...flat, "0100": 2.5, "0115": 2.4 }));
      assert.ok(late.includes("2025-11-02T07:45:00.000Z"));
      assert.ok(late.includes("2025-11-02T09:00:00.000Z"));
      assert.ok(!late.includes("2025-11-02T08:45:00.000Z"));
    });

    it("drops the stamps the switch could fall on where no jump stands out", () => {
      const got = times(day(flat));
      assert.deepEqual(
        got,
        ["07:00", "07:15", "09:00", "09:15", "09:30", "09:45"].map(
          (t) => `2025-11-02T${t}:00.000Z`,
        ),
      );
      // Two jumps of alike size (a tide moving fast) don't say either.
      const two = times(day({ "0000": 4, "0015": 3.5, "0030": 4.2, "0045": 3.6, "0100": 4.1 }));
      assert.ok(
        !two.includes("2025-11-02T07:30:00.000Z") && !two.includes("2025-11-02T08:45:00.000Z"),
      );
    });

    it("leaves a placeholder out of the search for the jump", () => {
      // The −7,999 ft at 01:30 is dropped through the registry, and doesn't hide the switch at 00:45.
      const got = times(
        day({ ...flat, "0045": 2.5, "0100": 2.4, "0115": 2.3, "0130": -7999, "0145": 2.2 }),
      );
      assert.ok(got.includes("2025-11-02T08:45:00.000Z"));
      assert.ok(!got.includes("2025-11-02T07:45:00.000Z"));
      // One at 00:30 leaves a 30-minute step, which decides nothing.
      const gap = times(day({ ...flat, "0030": -7999, "0045": 2.5, "0100": 2.4, "0115": 2.3 }));
      assert.ok(!gap.includes("2025-11-02T08:45:00.000Z"));
    });

    it("decides nothing where a stamp is missing or the reply covers part of the hour", () => {
      const drops = (got: string[]) =>
        !got.includes("2025-11-02T07:45:00.000Z") && !got.includes("2025-11-02T08:45:00.000Z");
      // 00:30 is missing, so the 00:15 to 00:45 step spans two.
      assert.ok(
        drops(times(day({ "0000": 4, "0015": 4.1, "0045": 2.5, "0100": 2.4, "0115": 2.3 }))),
      );
      // A reply that ends before 01:00, as a live poll's can, or starts after 00:15.
      assert.ok(
        drops(times(day({ "0000": 4, "0015": 4.1, "0030": 4.2, "0045": 2.5, "0100": 2.4 }, false))),
      );
      assert.ok(drops(times(day({ "0030": 4.2, "0045": 2.5, "0100": 2.4, "0115": 2.3 }))));
      // A repeated stamp counts once, the last.
      const repeated = day({ ...flat, "0045": 2.5, "0100": 2.4, "0115": 2.3 }).replace(
        "MRZ,E,1,STAGE,20251102 0030,20251102 0030,4.2, ,FEET",
        "MRZ,E,1,STAGE,20251102 0030,20251102 0030,9, ,FEET\nMRZ,E,1,STAGE,20251102 0030,20251102 0030,4.2, ,FEET",
      );
      assert.ok(times(repeated).includes("2025-11-02T08:45:00.000Z"));
    });

    it("reads a jump of exactly 0.2 ft whichever the level", () => {
      for (const base of [4, 2.1]) {
        const got = times(
          day({
            "0000": base,
            "0015": base,
            "0030": base,
            "0045": base + 0.2,
            "0100": base + 0.2,
            "0115": base + 0.2,
          }),
        );
        assert.ok(got.includes("2025-11-02T08:45:00.000Z"), `at ${base} ft`);
      }
    });

    it("leaves other days alone", () => {
      const csv = day({ "0030": 4, "0045": 2 }, false).replaceAll("20251102", "20251101");
      assert.equal(cdec.parse(csv, "MRZ").length, 2);
    });
  });

  it("drops CDEC's −7,999 ft placeholder through the registry, not in the adapter", async () => {
    // The fixture with its 00:15 reading replaced by the placeholder.
    const csv = fixture("cdec-MRZ-dst.csv").replace(
      "20251101 0015,20251101 0015,3.92,",
      "20251101 0015,20251101 0015,-7999,",
    );
    serve(() => csv);
    const range = [new Date("2025-11-01T07:00:00Z"), new Date("2025-11-01T08:00:00Z")] as const;
    const placeholder = Date.parse("2025-11-01T07:15:00Z");
    const raw = await cdec.levels({ source_id: "MRZ" }, ...range);
    assert.ok(raw.some((l) => l.time === placeholder));
    const kept = await sources.cdec!.observations!(
      { id: "cdec/MRZ", source_id: "MRZ" } as Station,
      ...range,
    );
    assert.equal(kept.length, raw.length - 1);
    assert.ok(!kept.some((l) => l.time === placeholder));
  });

  it("asks to the next Pacific day across the end of daylight saving", async () => {
    serve(() => fixture("cdec-MRZ-dst.csv"));
    // To Pacific midnight starting 3 November 2025, a 25-hour day after 2 November's start.
    const levels = await cdec.levels(
      { source_id: "MRZ" },
      new Date("2025-11-02T07:00:00Z"),
      new Date("2025-11-03T08:00:00Z"),
    );
    assert.match(requests[0]![0], /Start=2025-11-02&End=2025-11-03/);
    assert.equal(iso(levels.at(-1)!.time), "2025-11-03T07:45:00.000Z");
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

  it("drops a stamp in the hour skipped when daylight saving starts", () => {
    const header =
      "STATION_ID,DURATION,SENSOR_NUMBER,SENSOR_TYPE,DATE TIME,OBS DATE,VALUE,DATA_FLAG,UNITS";
    const rows = [
      header,
      "MRZ,E,1,RIV STG,20260308 0215,20260308 0215,9.0, ,FEET",
      "MRZ,E,1,RIV STG,20260308 0315,20260308 0315,1.0, ,FEET",
    ].join("\n");
    assert.deepEqual(
      cdec.parse(rows, "MRZ").map((o) => [iso(o.time), o.level]),
      [["2026-03-08T10:15:00.000Z", 0.305]],
    );
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
      () => cdec.parse(rows("MRZ,E,1,RIV STG,20251301 0000,20251301 0000,1.0, ,FEET"), "MRZ"),
      /bad row/,
    );
    assert.throws(
      () => cdec.parse(rows("MRZ,E,1,RIV STG,20250101 0060,20250101 0060,1.0, ,FEET"), "MRZ"),
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
    // A range with no readings still sends the header (MRZ, 1 January 1990); a reply without it is a failure.
    assert.deepEqual(cdec.parse(fixture("cdec-empty.csv"), "MRZ"), []);
    assert.throws(() => cdec.parse("", "MRZ"), /empty reply/);
  });
});
