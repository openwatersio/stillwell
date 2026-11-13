import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchText, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as jodc from "../src/sources/jodc/index.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));

let requests: string[] = [];

describe("jodc", () => {
  jodc.pacing.requestMs = 0;

  beforeEach(() => {
    requests = [];
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-09T00:00:00Z") });
    setTransport(async (url) => {
      requests.push(url);
      if (url.endsWith("/station_info.json")) return fixture("jodc-stations.json").toString("utf8");
      // Mitajiri-Nakanoseki, 2011 to 2013, the smallest record.
      if (url.endsWith("/8413.zip")) return fixture("jodc-8413.zip").toString("base64");
      throw new Error(`Unexpected request ${url}`);
    });
  });

  afterEach(() => {
    setTransport(fetchText);
    mock.timers.reset();
  });

  it("lists every station but JMA's, with its agency and record span", async () => {
    const stations = await jodc.stations();
    assert.deepEqual(
      stations.map((s) => s.id),
      ["jodc/0101", "jodc/8413", "jodc/GS01", "jodc/HD01", "jodc/HD50"],
    );
    const byId = new Map(stations.map((s) => [s.id, s]));
    const gs = byId.get("jodc/GS01")!;
    assert.equal(gs.name, "Aburatsubo");
    assert.equal(
      gs.attribution,
      "Japan Oceanographic Data Center; Geospatial Information Authority of Japan",
    );
    assert.equal(gs.status, "active");
    assert.equal(gs.commercial_use, false);
    assert.equal(gs.record_start, "1933-01-01T00:00:00.000Z");
    assert.equal(gs.record_end, "2023-12-31T15:00:00.000Z");
    // Active while within two years of the newest of its agency's: 2022 for
    // the Coast Guard's here, 2020 for the ports'.
    assert.equal(byId.get("jodc/HD01")!.status, "inactive");
    assert.equal(byId.get("jodc/HD50")!.status, "active");
    assert.equal(byId.get("jodc/0101")!.status, "active");
    assert.equal(byId.get("jodc/8413")!.status, "inactive");
    const syowa = byId.get("jodc/HD50")!;
    assert.equal(syowa.country_code, "AQ");
    assert.equal(syowa.record_start, "1987-01-01T00:00:00.000Z");
    assert.equal(syowa.record_end, "2022-12-31T21:00:00.000Z");
  });

  it("reads a record's years from its zip, in JST, as UTC meters", async () => {
    const values = await jodc.levels("8413", new Date("2011-01-01Z"), new Date("2014-01-01Z"));
    // Read once, however many years are asked for.
    await jodc.levels("8413", new Date("2012-01-01Z"), new Date("2013-01-01Z"));
    assert.equal(requests.length, 1);
    assert.ok(values.every((o) => o.flag === Flag.good));
    // 2011/04/01 00:00 JST is 212 cm.
    const first = values.find((o) => o.time === Date.parse("2011-03-31T15:00:00Z"));
    assert.equal(first?.level, 2.12);
    // 2011/01/01 is all 9999, missing.
    assert.ok(!values.some((o) => o.time < Date.parse("2011-03-31T15:00:00Z")));
    // The last hours of 2011 UTC come from 2012's file.
    assert.ok(values.some((o) => o.time === Date.parse("2011-12-31T20:00:00Z")));
    // 2010's last 9 hours UTC would come from 2011's file, but there's no 2010 file.
    assert.ok(!values.some((o) => new Date(o.time).getUTCFullYear() === 2010));
  });

  it("asks for nothing outside a station's record", async () => {
    const span = {
      record_start: "2010-12-31T15:00:00.000Z",
      record_end: "2013-12-31T15:00:00.000Z",
    };
    // 0101, which no other test reads, so its zip isn't already in memory.
    assert.deepEqual(
      await jodc.levels("0101", new Date("2009-01-01Z"), new Date("2010-01-01Z"), span),
      [],
    );
    assert.deepEqual(
      await jodc.levels("0101", new Date("2014-01-01Z"), new Date("2015-01-01Z"), span),
      [],
    );
    assert.equal(requests.length, 0);
  });

  it("refuses a line for another station or year", () => {
    const line = `8413,2011/01/01${",100".repeat(24)}`;
    assert.equal(jodc.parse(line, "8413", 2011).length, 24);
    assert.throws(() => jodc.parse(line, "8413", 2012), /has a line/);
    assert.throws(() => jodc.parse(line, "0101", 2011), /has a line/);
    assert.throws(() => jodc.parse(`${line}\n${line}`, "8413", 2011), /twice/);
    assert.throws(
      () => jodc.parse(line.replace("2011/01/01", "2011/13/01"), "8413", 2011),
      /no day/,
    );
  });

  it("refuses a zip cut off between whole files", async () => {
    const zip = fixture("jodc-8413.zip");
    assert.equal((await jodc.unzip(zip)).size, 3);
    const local = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const central = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    // After 2011's file, and after every file but before the directory.
    for (const cut of [zip.indexOf(local, 4), zip.indexOf(central)])
      await assert.rejects(jodc.unzip(zip.subarray(0, cut)), /cut off/);
  });

  it("refuses a list with a year past next", async () => {
    const list = JSON.parse(fixture("jodc-stations.json").toString("utf8"));
    list.features.find((f: any) => f.properties.code === "8413").properties.eyear = "2205";
    setTransport(async () => JSON.stringify(list));
    await assert.rejects(jodc.stations(), /8413 has years/);
  });

  it("reads a line dated day 00 as the day after the line before it", () => {
    const row = (date: string) => `0132,${date}${",100".repeat(24)}`;
    const days = (text: string) => [
      ...new Set(
        jodc
          .parse(text, "0132", 2012)
          .map((o) => new Date(o.time + 9 * 3_600_000).toISOString().slice(0, 10)),
      ),
    ];
    assert.deepEqual(days([row("2012/01/08"), row("2012/01/00"), row("2012/01/10")].join("\n")), [
      "2012-01-08",
      "2012-01-09",
      "2012-01-10",
    ]);
    assert.deepEqual(days(row("2012/01/00")), ["2012-01-01"]);
    // Not when the day after falls in another month, or is already there.
    assert.throws(
      () => jodc.parse([row("2012/01/31"), row("2012/01/00")].join("\n"), "0132", 2012),
      /no day/,
    );
    assert.throws(
      () => jodc.parse([row("2012/01/00"), row("2012/01/01")].join("\n"), "0132", 2012),
      /twice/,
    );
  });

  it("keeps Syowa Station on UTC+3", () => {
    const [first] = jodc.parse(`HD50,2000/01/01,123${",9999".repeat(23)}`, "HD50", 2000);
    assert.equal(first!.time, Date.parse("1999-12-31T21:00:00Z"));
    assert.equal(first!.level, 1.23);
  });
});
