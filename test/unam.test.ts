import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as unam from "../src/sources/unam/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Requests made, with their range. */
let requests: [string, string | undefined][] = [];

/** La Paz's file, recorded at 15:31 UTC on 9 November 2026. */
const RECORDED = Date.parse("2026-11-09T15:31:00Z");
const HEADER = fixture("unam-14-head.csv");
const TAIL = fixture("unam-14-tail.csv");

/** Answer the station page, and each file's header or tail by the range asked for. */
function serve(header = (_number: string) => HEADER): void {
  setTransport(async (url, options: RequestOptions) => {
    const range = (options.headers as Record<string, string> | undefined)?.range;
    requests.push([url, range]);
    if (url.endsWith("/estaciones/?estacion=1")) return fixture("unam-station.html");
    const m = /data-(\d+)_metros\.csv$/.exec(url);
    if (!m) throw new Error(`Unexpected request ${url}`);
    return range === "bytes=0-511" ? header(m[1]!) : TAIL;
  });
}

describe("unam", () => {
  unam.pacing.requestMs = 0;

  beforeEach(() => {
    requests = [];
    mock.timers.enable({ apis: ["Date"], now: RECORDED });
  });

  afterEach(() => {
    setTransport(fetchText);
    mock.timers.reset();
  });

  it("lists a series for each sensor at each station but Río Grijalva", async () => {
    serve((n) =>
      n === "31" ? "Tiempo,Pronostico,Nivel del mar (radar promedio),Nivel del mar CBS\n" : HEADER,
    );
    const stations = await unam.stations();
    const numbers = new Set(stations.map((s) => s.source_id.split("-")[0]));
    // The page's own station, La Paz, isn't in its menu but is in its heading.
    assert.ok(numbers.has("14"));
    assert.ok(!numbers.has("40"));
    assert.equal(numbers.size, 26);
    const byId = new Map(stations.map((s) => [s.id, s]));
    const radar = byId.get("unam/14-radar")!;
    assert.equal(radar.name, "La Paz (radar)");
    assert.equal(radar.column, "Nivel del mar (radar promedio)");
    assert.equal(radar.commercial_use, false);
    assert.equal(radar.datum, "ZERO");
    assert.deepEqual([radar.lat, radar.lon], [24.2667, -110.3333]);
    assert.equal(byId.get("unam/14-flotador")!.column, "Nivel del mar (flotador)");
    assert.equal(byId.get("unam/31-cbs")!.column, "Nivel del mar CBS");
  });

  it("refuses a station page whose heading it can't read", async () => {
    setTransport(
      async () => '<option value="2">2 - Acapulco</option><option value="3">3 - Campeche</option>',
    );
    await assert.rejects(unam.stations(), /no heading naming its station/);
  });

  it("refuses a column it doesn't know", async () => {
    serve(() => "Tiempo,Pronostico,Nivel del mar (sonar)\n");
    await assert.rejects(unam.stations(), /has a column Nivel del mar \(sonar\)/);
  });

  it("reads each sensor's levels from the end of the file, one fetch for both", async () => {
    serve();
    const start = new Date("2026-11-09T14:50:00Z");
    const end = new Date("2026-11-09T15:31:00Z");
    const columns = HEADER.trim().split(",");
    const radar = await unam.levels({ source_id: "14-radar", column: columns[2]! }, start, end);
    const float = await unam.levels({ source_id: "14-flotador", column: columns[3]! }, start, end);
    // A header and a tail, shared by both sensors.
    assert.equal(requests.length, 2);
    assert.equal(requests[1]![1], `bytes=-${2 * 60 * 80}`);
    assert.deepEqual(radar[0], {
      time: Date.parse("2026-11-09T14:50:00Z"),
      level: 6.911,
      flag: Flag.preliminary,
    });
    assert.equal(float[0]!.level, 6.864);
    // Observations run about 15 minutes behind; the later lines are blank.
    assert.equal(radar.at(-1)!.time, Date.parse("2026-11-09T15:14:00Z"));
    assert.equal(float.length, radar.length);
  });

  it("refuses a whole file that starts after the hours asked for", async () => {
    // SMN restarted its logger: the file holds only its last hour, so a range answers with all of it.
    setTransport(async () => `${HEADER}2026-11-09 14:40:00,6.3,6.9,6.8\n`);
    await assert.rejects(
      unam.levels(
        { source_id: "14-radar", column: "Nivel del mar (radar promedio)" },
        new Date("2026-11-09T03:00:00Z"),
        new Date("2026-11-09T15:00:00Z"),
      ),
      /file starts at 2026-11-09 14:40:00/,
    );
  });

  it("refuses a range that doesn't reach back to the hours asked for", async () => {
    // Lines longer than the range allowed for: it starts at 13:00, not 03:00.
    // Station 98, so no other test's answer is still in memory.
    setTransport(async (_url, options) =>
      (options.headers as Record<string, string>).range === "bytes=0-511"
        ? HEADER
        : "1,2\n2026-11-09 13:00:00,6.3,6.9,6.8\n2026-11-09 15:20:00,6.3,6.9,6.8\n",
    );
    await assert.rejects(
      unam.levels(
        { source_id: "98-radar", column: "Nivel del mar (radar promedio)" },
        new Date("2026-11-09T03:00:00Z"),
        new Date("2026-11-09T15:31:00Z"),
      ),
      /file starts at 2026-11-09 13:00:00/,
    );
  });

  it("refuses a file that stops short of the hours asked for", async () => {
    // Caught mid-rewrite: the answer ends at 12:00, three and a half hours ago.
    setTransport(async (_url, options) =>
      (options.headers as Record<string, string>).range === "bytes=0-511"
        ? HEADER
        : "1,2\n2026-11-09 11:59:00,6.3,6.9,6.8\n2026-11-09 12:00:00,6.3,6.9,6.8\n",
    );
    await assert.rejects(
      unam.levels(
        { source_id: "14-flotador", column: "Nivel del mar (flotador)" },
        new Date("2026-11-09T05:00:00Z"),
        new Date("2026-11-09T15:31:00Z"),
      ),
      /ends at 2026-11-09 12:00:00/,
    );
  });

  it("refuses to fetch from before the file's 5 days", async () => {
    serve();
    await assert.rejects(
      unam.levels(
        { source_id: "14-radar", column: "Nivel del mar (radar promedio)" },
        new Date("2026-01-01Z"),
        new Date("2027-01-01Z"),
      ),
      /only the last 5 days/,
    );
    assert.equal(requests.length, 0);
  });

  it("skips a range's cut first and last lines and the header, and refuses a short line between", () => {
    const columns = ["Tiempo", "Pronostico", "A"];
    const text =
      "0,1.2\n2026-11-09 00:00:00,1.0,2.0\n2026-11-09 00:01:00,1.0,\n2026-11-09 00:02:00,1.0,6";
    assert.deepEqual(
      unam.parse(text, columns, "A", "x").map((o) => o.level),
      [2],
    );
    assert.throws(
      () => unam.parse(`Tiempo,Pronostico,A\n2026-11-09 00:00:00,1.0\n\n`, columns, "A", "x"),
      /not a line/,
    );
    // Only lines in the hours asked for are held to that: a short line before them is skipped.
    const short = "2026-11-09 00:00:00,1.0\n2026-11-09 01:00:00,1.0,3.0\n";
    const from = Date.parse("2026-11-09T00:30:00Z");
    assert.deepEqual(
      unam.parse(short, columns, "A", "x", from).map((o) => o.level),
      [3],
    );
  });

  it("refuses a menu entry it can't read", () => {
    const page = (entry: string) =>
      `<h1>La Paz (14)</h1><option value="1">1 - Veracruz</option>${entry}`;
    assert.equal(unam.numbered(page(`<option value="2">2 - Acapulco</option>`)).size, 3);
    assert.throws(
      () => unam.numbered(page(`<option value="2">2 – Acapulco</option>`)),
      /can't read/,
    );
  });
});
