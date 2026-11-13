import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchText, HttpError, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as jma from "../src/sources/jma/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Requests made, with their options. */
let requests: [string, RequestOptions][] = [];

/** Answer requests from fixtures, by the first pattern the URL matches; others 404. */
function serve(routes: [RegExp, string][]): void {
  setTransport(async (url, options) => {
    requests.push([url, options]);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new HttpError(`GET ${url} returned 404`, "");
    return route[1];
  });
}

/** Chichijima's files, recorded at 15:34 UTC on 7 November 2026 (00:34 JST on the 8th). */
const RECORDED = Date.parse("2026-11-07T15:34:00Z");
const chichijima: [RegExp, string][] = [
  [/sea_lev_var\/1980\/198001\/hry198001CC\.txt$/, fixture("jma-historic-198001CC.txt")],
  [/genbo\/2024\/202412\/hry202412CC\.txt$/, fixture("jma-final-202412CC.txt")],
  [/genbo\/2025\/202501\/hry202501CC\.txt$/, fixture("jma-final-202501CC.txt")],
  [/sokuho\/202610\/z_hry202610CC\.txt$/, fixture("jma-preliminary-202610CC.txt")],
  [/sokuho\/202611\/z_hry202611CC\.txt$/, fixture("jma-preliminary-202611CC.txt")],
];

const iso = (t: number) => new Date(t).toISOString();
const HOUR_MS = 3_600_000;

describe("jma", () => {
  jma.pacing.requestMs = 0;

  beforeEach(() => {
    requests = [];
    mock.timers.enable({ apis: ["Date"], now: RECORDED });
  });

  afterEach(() => {
    setTransport(fetchText);
    mock.timers.reset();
  });

  it("lists every station, open and closed, with its record span", async () => {
    serve([
      [/station_history\.php$/, fixture("jma-history.html")],
      [/genbo\/station\.php$/, fixture("jma-stations.html")],
    ]);
    const stations = await jma.stations();
    assert.equal(stations.length, 90);
    assert.equal(stations.filter((s) => s.status === "active").length, 70);
    const byId = new Map(stations.map((s) => [s.id, s]));
    const cc = byId.get("jma/CC")!;
    assert.deepEqual(
      [cc.name, cc.lat, cc.lon, cc.datum, cc.status, cc.record_start, cc.record_end],
      ["Chichijima", 27.1, 142.2, "DL", "active", "1933-06-30T15:00:00.000Z", null],
    );
    const hc = byId.get("jma/HC")!;
    // Hachinohe, closed after March 2011, is placed from CLOSED.
    assert.deepEqual(
      [hc.name, hc.lat, hc.lon, hc.status, hc.record_start, hc.record_end],
      [
        "Hachinohe",
        40.5333,
        141.5333,
        "inactive",
        "1936-10-31T15:00:00.000Z",
        "2011-03-31T15:00:00.000Z",
      ],
    );
    assert.ok(
      stations.every((s) => s.name && !/[^\x20-\x7e]/.test(s.name)),
      "every name in English",
    );
    assert.equal(cc.license, "PDL-1.0");
    assert.equal(cc.commercial_use, true);
    assert.equal(cc.country_code, "JP");
    assert.ok(requests.every(([, o]) => o.fresh));
  });

  it("refuses an empty station list", async () => {
    serve([
      [/station_history\.php$/, "<html></html>"],
      [/genbo\/station\.php$/, fixture("jma-stations.html")],
    ]);
    await assert.rejects(jma.stations(), /no tide stations/);
  });

  it("reads JST hours as UTC, across a month boundary", async () => {
    serve(chichijima);
    const levels = await jma.levels(
      "CC",
      new Date("2024-12-31T12:00Z"),
      new Date("2024-12-31T18:00Z"),
    );
    assert.deepEqual(
      requests.map(([url]) => url.replace(/.*\//, "")),
      ["hry202412CC.txt", "hry202501CC.txt"],
    );
    assert.deepEqual(
      levels.map((l) => iso(l.time)),
      [12, 13, 14, 15, 16, 17].map((h) => iso(Date.parse("2024-12-31T00:00Z") + h * HOUR_MS)),
    );
    // 0:00 JST on 1 January 2025 is the first value of January's file: 125 cm.
    assert.deepEqual(levels[3], {
      time: Date.parse("2024-12-31T15:00Z"),
      level: 1.25,
      flag: Flag.good,
    });
    assert.ok(requests.every(([, o]) => !o.fresh));
  });

  it("reads months before April 1997 from the historical set", async () => {
    serve(chichijima);
    const levels = await jma.levels(
      "CC",
      new Date("1980-01-01T00:00Z"),
      new Date("1980-01-02T00:00Z"),
    );
    assert.match(requests[0]![0], /sea_lev_var\/1980\/198001\/hry198001CC\.txt$/);
    assert.equal(levels.length, 24);
    // 9:00 JST on 1 January 1980, the tenth value: 176 cm.
    assert.deepEqual(levels[0], {
      time: Date.parse("1980-01-01T00:00Z"),
      level: 1.76,
      flag: Flag.good,
    });
  });

  it("fails on a 200 that isn't a month's file, and doesn't cache it", async () => {
    const page = "<html><body>メンテナンス中</body></html>";
    serve([[/hry198001CC\.txt$/, page]]);
    await assert.rejects(
      jma.levels("CC", new Date("1980-01-01T00:00Z"), new Date("1980-01-02T00:00Z")),
      /has a line for/,
    );
    const keep = requests[0]![1].keep!;
    assert.equal(keep(page), false);
    assert.equal(keep(""), false);
    assert.equal(keep(fixture("jma-historic-198001CC.txt")), true);
  });

  it("falls back to provisional values, fresh and preliminary, for recent months", async () => {
    serve(chichijima);
    const levels = await jma.levels("CC", new Date("2026-10-30T00:00Z"), new Date(RECORDED));
    assert.deepEqual(
      requests.map(([url, o]) => [url.replace(/.*tide\//, ""), o.fresh]),
      [
        ["genbo/2026/202610/hry202610CC.txt", true],
        ["sokuho/202610/z_hry202610CC.txt", true],
        ["genbo/2026/202611/hry202611CC.txt", true],
        ["sokuho/202611/z_hry202611CC.txt", true],
      ],
    );
    assert.ok(levels.every((l) => l.flag === Flag.preliminary));
    // Through 23:00 JST on 5 November; the blank days after it bring nothing.
    assert.equal(iso(levels.at(-1)!.time), "2026-11-05T14:00:00.000Z");
    assert.ok(levels.every((l, i) => i === 0 || l.time > levels[i - 1]!.time));
  });

  it("keeps to the station's record and sends nothing outside it", async () => {
    serve(chichijima);
    const levels = await jma.levels("CC", new Date("1920-01-01Z"), new Date("1921-01-01Z"), {
      record_start: "1933-06-30T15:00:00.000Z",
    });
    assert.deepEqual(levels, []);
    assert.equal(requests.length, 0);
  });

  it("drops a UTC month's last hours when its own JST month brought nothing", async () => {
    // December 2024's file is missing; January's first 9 hours fall on 31 December UTC.
    serve(chichijima.filter(([pattern]) => !pattern.source.includes("202412")));
    const levels = await jma.levels("CC", new Date("2024-12-01Z"), new Date("2025-01-02Z"));
    assert.equal(iso(levels[0]!.time), "2025-01-01T00:00:00.000Z");
    assert.equal(levels.length, 24);
  });

  it("drops the hours before a record's first JST month", async () => {
    serve(chichijima);
    // A record from January 2025 JST, whose first 9 hours are 31 December UTC.
    const levels = await jma.levels("CC", new Date("2024-12-31T00:00Z"), new Date("2025-01-02Z"), {
      record_start: "2024-12-31T15:00:00.000Z",
    });
    assert.equal(iso(levels[0]!.time), "2025-01-01T00:00:00.000Z");
  });

  it("refuses a station list month it can't read", async () => {
    serve([
      [/station_history\.php$/, fixture("jma-history.html").replace("1955年1月", "1955年13月")],
      [/genbo\/station\.php$/, fixture("jma-stations.html")],
    ]);
    await assert.rejects(jma.stations(), /has 1955年13月 for a month/);
  });

  it("refuses a file for another station or month", () => {
    assert.throws(
      () => jma.parse(fixture("jma-final-202501CC.txt"), "KS", Date.UTC(2025, 0, 1), Flag.good),
      /has a line for/,
    );
    assert.throws(
      () => jma.parse(fixture("jma-final-202501CC.txt"), "CC", Date.UTC(2024, 11, 1), Flag.good),
      /has a line for/,
    );
  });

  it("refuses a day past the month's end, or a day twice", () => {
    const text = fixture("jma-final-202412CC.txt");
    const day1 = text.split("\n")[0]!;
    // 31 November doesn't exist.
    assert.throws(
      () => jma.parse(day1.replace("2412 1CC", "241131CC"), "CC", Date.UTC(2024, 10, 1), Flag.good),
      /not a day/,
    );
    assert.throws(
      () => jma.parse(`${day1}\n${day1}`, "CC", Date.UTC(2024, 11, 1), Flag.good),
      /a day twice/,
    );
    const lines = text.split("\n");
    const restamp = (i: number, from: string, to: string) => {
      const copy = [...lines];
      copy[i] = copy[i]!.replace(from, to);
      assert.notEqual(copy[i], lines[i]);
      return copy;
    };
    // The last line has one neighbor, so a stamp repeated there is refused.
    assert.throws(
      () =>
        jma.parse(
          restamp(30, "241231CC", "241230CC").join("\n"),
          "CC",
          Date.UTC(2024, 11, 1),
          Flag.good,
        ),
      /a day twice/,
    );
    // Neighbors outside the month don't place a line: stamped 31, 0, 33, 2 to 29,
    // the second line would be read as the 32nd and the third as the 1st.
    const stamp = (line: string, day: number) =>
      `${line.slice(0, 76)}${String(day).padStart(2, " ")}${line.slice(78)}`;
    const chain = [31, 0, 33, ...Array.from({ length: 28 }, (_, i) => i + 2)].map((day, i) =>
      stamp(lines[i]!, day),
    );
    assert.throws(
      () => jma.parse(chain.join("\n"), "CC", Date.UTC(2024, 11, 1), Flag.good),
      /not a day/,
    );
    // A copy of the 20th, stamped the 20th where the 21st belongs, is a repeat.
    const copied = [...lines];
    copied[20] = lines[19]!;
    assert.throws(
      () => jma.parse(copied.join("\n"), "CC", Date.UTC(2024, 11, 1), Flag.good),
      /a day twice/,
    );
    // A file cut short is missing days at the end.
    assert.throws(
      () =>
        jma.parse(text.split("\n").slice(0, 20).join("\n"), "CC", Date.UTC(2024, 11, 1), Flag.good),
      /has 20 of 31 days/,
    );
  });

  it("reads a mistyped day between two in sequence as the day between them", () => {
    const text = fixture("jma-final-202412CC.txt");
    const good = jma.parse(text, "CC", Date.UTC(2024, 11, 1), Flag.good);
    // As in Saigo's October 1980 file, the 22nd is stamped the 20th.
    const lines = text.split("\n");
    lines[21] = lines[21]!.replace("241222CC", "241220CC");
    assert.notEqual(lines[21], text.split("\n")[21]);
    assert.deepEqual(jma.parse(lines.join("\n"), "CC", Date.UTC(2024, 11, 1), Flag.good), good);
  });

  it("refuses another datum", async () => {
    serve(chichijima);
    await assert.rejects(
      jma.levels("CC", new Date("2025-01-01Z"), new Date("2025-01-02Z"), { datum: "TP" }),
      /read in DL/,
    );
  });
});
