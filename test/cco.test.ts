import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchText, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as cco from "../src/sources/cco/index.ts";

// The fixtures are responses recorded from the API on 2026-11-16, trimmed to a
// few sites and readings. The API sends ids, values and flags as text.
const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

const requests: { url: string; headers: Record<string, string> }[] = [];

function serve(routes: [RegExp, string][]): void {
  setTransport(async (url, options) => {
    requests.push({ url, headers: options.headers as Record<string, string> });
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return route[1];
  });
}

beforeEach(() => {
  requests.length = 0;
  cco.pacing.requestMs = 0;
  process.env.CCO_API_KEY = "test-key";
  process.env.CCO_REFERER = "https://example.test/";
});
afterEach(() => {
  setTransport(fetchText);
  delete process.env.CCO_API_KEY;
  delete process.env.CCO_REFERER;
});

describe("cco", () => {
  it("lists the sites with a number, in chart datum, and links GESLA's records of them", async () => {
    serve([[/tides\/latest\.geojson$/, fixture("cco-tides-latest.geojson")]]);
    const stations = await cco.stations(undefined, Date.parse("2026-11-16T13:00:00Z"));
    // Barmouth and Whitby are other providers' gauges with a link for an id, and no readings.
    assert.deepEqual(
      stations.map((s) => s.id),
      ["cco/102", "cco/106", "cco/112", "cco/86", "cco/88", "cco/90"],
    );
    const deal = stations.find((s) => s.id === "cco/90")!;
    assert.deepEqual(
      [deal.name, deal.lat, deal.lon, deal.datum, deal.interval_s, deal.status],
      ["Deal Pier", 51.22379, 1.40926, "CD", 600, "active"],
    );
    assert.deepEqual(deal.same_as, ["gesla/deal_pier-dlp-gbr-cco"]);
    // CCO calls Severn Bridge by the crossing's name; Whitby Harbour is its own gauge, linked to its CCO record only.
    assert.deepEqual(stations.find((s) => s.id === "cco/106")!.same_as, [
      "gesla/severn_bridge-ssc-gbr-cco",
    ]);
    assert.deepEqual(stations.find((s) => s.id === "cco/112")!.same_as, [
      "gesla/whitby_harbour-wtb-gbr-cco",
    ]);
    // Arun Platform's last reading is from February 2024; Port Isaac's is from two weeks ago.
    assert.equal(stations.find((s) => s.id === "cco/86")!.status, "inactive");
    assert.equal(stations.find((s) => s.id === "cco/102")!.status, "active");
    // The key and referer go in headers, never the URL.
    assert.equal(requests[0]!.headers["x-api-key"], "test-key");
    assert.equal(requests[0]!.headers.referer, "https://example.test/");
    assert.ok(!requests[0]!.url.includes("test-key"));
  });

  it("refuses to run without a key and the domain it was issued for", async () => {
    delete process.env.CCO_REFERER;
    serve([]);
    await assert.rejects(cco.stations(), /CCO_API_KEY and CCO_REFERER/);
    assert.equal(requests.length, 0);
  });

  it("reads one site's readings, flagged by the monthly check", async () => {
    serve([
      [
        /tides\/20260915011000\.geojson\?sensor=90&duration=1$/,
        fixture("cco-tides-deal-pier.geojson"),
      ],
    ]);
    const out = await cco.levels(
      "90",
      new Date("2026-09-15T00:10:00Z"),
      new Date("2026-09-15T01:10:00Z"),
    );
    // The window includes the reading at each end; the one before the start is left out.
    assert.deepEqual(
      out.map((o) => [new Date(o.time).toISOString().slice(11, 16), o.level, o.flag]),
      [
        ["00:10", 5.458, Flag.good],
        ["00:20", 5.576, Flag.good],
        ["00:30", 5.68, Flag.good],
        ["00:40", 5.751, Flag.good],
        ["00:50", 5.809, Flag.good],
        ["01:00", 5.846, Flag.good],
      ],
    );
  });

  it("drops the readings of a gauge that sent no value, whatever the flag", async () => {
    serve([[/tides\//, fixture("cco-tides-port-isaac.geojson")]]);
    const out = await cco.levels(
      "102",
      new Date("2026-10-31T23:00:00Z"),
      new Date("2026-11-01T00:00:00Z"),
    );
    assert.deepEqual(out, []);
  });

  it("reads an answer with no readings as none", async () => {
    serve([[/tides\//, fixture("cco-tides-empty.geojson")]]);
    assert.deepEqual(
      await cco.levels("89", new Date("2001-05-31T23:00:00Z"), new Date("2001-06-01T00:00:00Z")),
      [],
    );
  });

  it("maps the check's flags, and reads no flag, 0 or blank as not yet checked", async () => {
    const reading = (n: number, QCflag: unknown, value: unknown = "1.5") => ({
      properties: {
        id: "90",
        date: `20261114#00${String(n * 3).padStart(2, "0")}00`,
        value,
        QCflag,
      },
    });
    serve([
      [
        /tides\//,
        JSON.stringify({
          features: [
            reading(0, null),
            reading(1, "0"),
            reading(2, " "),
            reading(3, "1"),
            reading(4, "5"),
            reading(5, "2"),
            reading(6, "3"),
            reading(7, "4"),
            reading(8, "8"),
            // The check marked it missing but the API still sent the value.
            reading(9, "9"),
            reading(10, "6"),
            reading(11, "17"),
            // Missing: null, empty or 9999.
            reading(12, "1", null),
            reading(13, "1", ""),
            reading(14, "1", "9999"),
            reading(16, "1", "999.9999"),
            reading(17, "1", "-999.9999"),
            reading(15, "1", " "),
          ],
        }),
      ],
    ]);
    const out = await cco.levels(
      "90",
      new Date("2026-11-14T00:00:00Z"),
      new Date("2026-11-14T02:00:00Z"),
    );
    assert.deepEqual(
      out.map((o) => o.flag),
      [
        Flag.preliminary,
        Flag.preliminary,
        Flag.preliminary,
        Flag.good,
        Flag.good,
        Flag.interpolated,
        Flag.suspect,
        Flag.bad,
        Flag.bad,
        Flag.bad,
        Flag.suspect,
        Flag.suspect,
      ],
    );
    assert.ok(out.every((o) => o.level === 1.5));
  });

  it("sends one request at a time, however many sites are read at once", async () => {
    let running = 0;
    let most = 0;
    setTransport(async () => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return fixture("cco-tides-empty.geojson");
    });
    const day = [new Date("2026-11-14T00:00:00Z"), new Date("2026-11-14T12:00:00Z")] as const;
    await Promise.all(["86", "87", "88", "89", "90"].map((id) => cco.levels(id, ...day)));
    assert.equal(most, 1);
  });

  it("asks a year at a time", async () => {
    serve([[/tides\//, fixture("cco-tides-empty.geojson")]]);
    await cco.levels("90", new Date("2024-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    assert.deepEqual(
      requests.map((r) => r.url.match(/duration=(\d+)/)![1]),
      ["8760", "8760", "25"],
    );
  });

  it("asks once for a window of whole hours", async () => {
    serve([[/tides\//, fixture("cco-tides-empty.geojson")]]);
    await cco.levels("90", new Date("2026-11-14T00:00:00Z"), new Date("2026-11-14T12:00:00Z"));
    assert.equal(requests.length, 1);
  });

  it("refuses a list in British National Grid, or one with no date it can read", async () => {
    const list = JSON.parse(fixture("cco-tides-latest.geojson"));
    list.features[0].geometry.coordinates = [530000, 105000];
    serve([[/latest/, JSON.stringify(list)]]);
    await assert.rejects(cco.stations(), /isn't a position around Great Britain/);
    for (const f of list.features) f.properties.date = "2026-11-14T12:00:00Z";
    list.features[0].geometry.coordinates = [0, 50];
    serve([[/latest/, JSON.stringify(list)]]);
    await assert.rejects(cco.stations(), /no site with a date/);
  });

  it("fails on a site with no name or position rather than retire it", async () => {
    const list = JSON.parse(fixture("cco-tides-latest.geojson"));
    list.features.find((f: any) => f.properties.id === "90").geometry = null;
    serve([[/latest/, JSON.stringify(list)]]);
    await assert.rejects(cco.stations(), /CCO site 90 has no name or position/);
  });

  it("leaves out the reading at the end of the window and keeps the one at the start", async () => {
    const at = (date: string) => ({ properties: { id: "90", date, value: "2", QCflag: null } });
    serve([
      [/tides\//, JSON.stringify({ features: [at("20261114#010000"), at("20261114#000000")] })],
    ]);
    const out = await cco.levels(
      "90",
      new Date("2026-11-14T00:00:00Z"),
      new Date("2026-11-14T01:00:00Z"),
    );
    assert.deepEqual(
      out.map((o) => o.time),
      [Date.parse("2026-11-14T00:00:00Z")],
    );
  });

  it("fails on an answer it can't read rather than read it as no values", async () => {
    const ask = (feature: object) => {
      serve([[/tides\//, JSON.stringify({ features: [{ properties: feature }] })]]);
      return cco.levels("90", new Date("2026-11-14T00:00:00Z"), new Date("2026-11-14T01:00:00Z"));
    };
    await assert.rejects(
      ask({ date: "20261114#000000", value: "1" }),
      /no feature carrying its id/,
    );
    await assert.rejects(ask({ id: "90", date: "2026-11-14T00:00:00Z", value: "1" }), /has date/);
    await assert.rejects(ask({ id: "90", date: "20261114#000000", value: "high" }), /has value/);
    await assert.rejects(ask({ id: "90", date: "20261114#000000", value: true }), /has value/);
    // A stamp that isn't a real time.
    await assert.rejects(ask({ id: "90", date: "20261131#000000", value: "1" }), /has date/);
  });
});
