import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchText, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as cco from "../src/sources/cco/index.ts";

// These fixtures follow the API page's field list, with site numbers made up:
// no key was available to record a real response.
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
    const stations = await cco.stations(undefined, Date.parse("2026-11-14T13:00:00Z"));
    assert.deepEqual(
      stations.map((s) => s.id),
      ["cco/38", "cco/54", "cco/71", "cco/89"],
    );
    const deal = stations.find((s) => s.id === "cco/54")!;
    assert.deepEqual(
      [deal.name, deal.lat, deal.lon, deal.datum, deal.interval_s, deal.status],
      ["Deal Pier", 51.2238, 1.4092, "CD", 600, "active"],
    );
    assert.deepEqual(deal.same_as, ["gesla/deal_pier-dlp-gbr-cco"]);
    // Dawlish has no GESLA record; Whitby Harbour's last reading is years old.
    assert.deepEqual(stations.find((s) => s.id === "cco/89")!.same_as, []);
    assert.equal(stations.find((s) => s.id === "cco/71")!.status, "inactive");
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

  it("reads one site's readings with the monthly check's flags, and drops missing values", async () => {
    serve([
      [
        /tides\/20261114013500\.geojson\?sensor=54&duration=2$/,
        fixture("cco-tides-deal-pier.geojson"),
      ],
    ]);
    const out = await cco.levels(
      "54",
      new Date("2026-11-14T00:00:00Z"),
      new Date("2026-11-14T01:35:00Z"),
    );
    const at = (t: string) => out.find((o) => o.time === Date.parse(`2026-11-14T${t}Z`));
    assert.deepEqual(
      out.map((o) => o.time),
      [0, 10, 20, 50, 60, 70, 80, 90].map((m) => Date.parse("2026-11-14T00:00:00Z") + m * 60_000),
    );
    assert.deepEqual([at("00:00")!.level, at("00:00")!.flag], [1.31, Flag.preliminary]);
    assert.equal(at("00:10")!.flag, Flag.good);
    assert.equal(at("00:20")!.flag, Flag.bad);
    assert.equal(at("01:10")!.flag, Flag.interpolated);
    assert.equal(at("01:00")!.flag, Flag.suspect);
    assert.equal(at("01:20")!.flag, Flag.suspect);
    // An unlisted code is suspect, not good; 9999, null and flag 9 are not stored.
    assert.equal(at("01:30")!.flag, Flag.suspect);
    assert.equal(at("00:30"), undefined);
    // A value the check marks missing, but that the API still sends, is bad.
    assert.equal(at("00:50")!.flag, Flag.bad);
    // The other site in the answer, and a reading before the start, are left out.
    assert.equal(out.length, 8);
  });

  it("asks a year at a time", async () => {
    serve([[/tides\//, JSON.stringify({ features: [] })]]);
    await cco.levels("54", new Date("2024-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"));
    assert.deepEqual(
      requests.map((r) => r.url.match(/duration=(\d+)/)![1]),
      ["8760", "8760", "25"],
    );
  });

  it("refuses a list in British National Grid, or one with no date it can read", async () => {
    const list = JSON.parse(fixture("cco-tides-latest.geojson"));
    list.features[0].geometry.coordinates = [530000, 105000];
    serve([[/latest/, JSON.stringify(list)]]);
    await assert.rejects(cco.stations(), /isn't longitude and latitude/);
    for (const f of list.features) f.properties.date = "2026-11-14T12:00:00Z";
    list.features[0].geometry.coordinates = [0, 50];
    serve([[/latest/, JSON.stringify(list)]]);
    await assert.rejects(cco.stations(), /no site with a date/);
  });

  it("reads a reading flagged 0 or blank as not yet checked", async () => {
    serve([
      [
        /tides\//,
        JSON.stringify({
          features: [
            { properties: { id: 54, date: "20261114#000000", value: 1, QCflag: "0" } },
            { properties: { id: 54, date: "20261114#001000", value: 2, QCflag: " " } },
          ],
        }),
      ],
    ]);
    const out = await cco.levels(
      "54",
      new Date("2026-11-14T00:00:00Z"),
      new Date("2026-11-14T01:00:00Z"),
    );
    assert.deepEqual(
      out.map((o) => [o.level, o.flag]),
      [
        [1, Flag.preliminary],
        [2, Flag.preliminary],
      ],
    );
  });

  it("fails on an answer it can't read rather than read it as no values", async () => {
    const ask = (feature: object) => {
      serve([[/tides\//, JSON.stringify({ features: [{ properties: feature }] })]]);
      return cco.levels("54", new Date("2026-11-14T00:00:00Z"), new Date("2026-11-14T01:00:00Z"));
    };
    await assert.rejects(ask({ date: "20261114#000000", value: 1 }), /no feature carrying its id/);
    await assert.rejects(ask({ id: 54, date: "2026-11-14T00:00:00Z", value: 1 }), /has date/);
    await assert.rejects(ask({ id: 54, date: "20261114#000000", value: "1.3" }), /has value/);
  });

  it("fails on a stamp that isn't a real time", async () => {
    serve([
      [
        /tides\//,
        JSON.stringify({
          features: [{ properties: { id: 54, date: "20260231#000000", value: 1, QCflag: null } }],
        }),
      ],
    ]);
    await assert.rejects(
      cco.levels("54", new Date("2026-02-01T00:00:00Z"), new Date("2026-03-05T00:00:00Z")),
      /has date/,
    );
  });
});
