import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as dmi from "../src/sources/dmi/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Answer requests from fixtures, by the first pattern the URL matches, keeping each request. */
function serve(routes: [RegExp, string | (() => string)][]): [string, RequestOptions][] {
  const requests: [string, RequestOptions][] = [];
  setTransport(async (url, options) => {
    requests.push([url, options]);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return typeof route[1] === "function" ? route[1]() : route[1];
  });
  return requests;
}

afterEach(() => setTransport(fetchText));

dmi.pacing.requestMs = 0;

/**
 * DMI's list as its station endpoint answered in November 2026, which held
 * only Skagen's two periods, followed by copies of Skagen's current period
 * under other IDs, owners and parameters, enough to pass the list's floor.
 */
function stationList(extra: Record<string, unknown>[] = []): string {
  const body = JSON.parse(fixture("dmi-stations.json"));
  const [, current] = body.features;
  const copy = (props: Record<string, unknown>) => ({
    ...current,
    properties: {
      ...current.properties,
      status: "Active",
      validTo: null,
      operationTo: null,
      ...props,
    },
  });
  body.features.push(
    ...Array.from({ length: 90 }, (_, i) =>
      copy({
        stationId: String(9_000_000 + i),
        owner: "Kystdirektoratet / Coastal Authority",
        parameterId: ["sea_reg"],
      }),
    ),
    ...extra.map(copy),
  );
  return JSON.stringify(body);
}

/** Serve a station list, then the empty page DMI answers after a list's last feature. */
function serveList(body: string): [string, RequestOptions][] {
  const empty = JSON.stringify({ type: "FeatureCollection", features: [], links: [] });
  return serve([
    [/offset=/, empty],
    [/station\/items/, body],
  ]);
}

describe("dmi stations", () => {
  it("collapses a station's periods to its latest, with the span of all", async () => {
    const requests = serveList(stationList());
    const stations = await dmi.stations();
    const skagen = stations.find((s) => s.id === "dmi/20002")!;
    assert.equal(stations.filter((s) => s.source_id === "20002").length, 1);
    assert.equal(skagen.name, "Skagen Havn");
    assert.equal(skagen.country_code, "DK");
    assert.equal(skagen.datum, "DVR90");
    assert.equal(skagen.parameter, "sealev_dvr");
    assert.equal(skagen.status, "inactive");
    assert.equal(skagen.live, false);
    assert.equal(skagen.record_start, "2012-01-01");
    assert.equal(skagen.record_end, "2021-01-06");
    assert.deepEqual([skagen.lat, skagen.lon], [57.7165, 10.5951]);
    assert.equal(skagen.attribution, "Danish Meteorological Institute (DMI)");
    assert.equal(skagen.commercial_use, true);
    assert.ok(requests.every(([, options]) => options.fresh));
  });

  it("reads a Coastal Authority gauge's registration as DVR90 with its owner's credit", async () => {
    serveList(stationList());
    const station = (await dmi.stations()).find((s) => s.id === "dmi/9000000")!;
    assert.equal(station.parameter, "sea_reg");
    assert.equal(station.datum, "DVR90");
    assert.equal(station.status, "active");
    assert.equal(station.live, true);
    assert.equal(station.record_end, null);
    assert.equal(
      station.attribution,
      "Danish Meteorological Institute (DMI); Danish Coastal Authority (Kystdirektoratet)",
    );
  });

  it("takes an old DMI record's local zero, and leaves out gauges with only a registration DMI doesn't vouch for", async () => {
    serveList(
      stationList([
        { stationId: "30018", parameterId: ["sea_reg", "sealev_ln"] },
        { stationId: "20102", parameterId: ["sea_reg", "tw"] },
        // A port's gauge: neither its datum nor DMI's terms cover it.
        { stationId: "20049", owner: "Hirtshals Havn", parameterId: ["sea_reg"] },
        // Inactive with no end date: its values may run on past the period's start.
        { stationId: "31618", parameterId: ["sealev_ln"], status: "Inactive" },
      ]),
    );
    const stations = await dmi.stations();
    const hornbaek = stations.find((s) => s.id === "dmi/30018")!;
    assert.equal(hornbaek.parameter, "sealev_ln");
    assert.equal(hornbaek.datum, "LN");
    assert.equal(
      stations.find((s) => s.id === "dmi/20102"),
      undefined,
    );
    assert.equal(
      stations.find((s) => s.id === "dmi/20049"),
      undefined,
    );
    const gedser = stations.find((s) => s.id === "dmi/31618")!;
    assert.deepEqual([gedser.status, gedser.record_end], ["inactive", null]);
  });

  it("refuses a list caught short", async () => {
    serveList(fixture("dmi-stations.json"));
    await assert.rejects(dmi.stations(), /listed only 1 sea-level stations/);
  });
});

describe("dmi levels", () => {
  const start = new Date("2024-01-15T15:00:00Z");
  const end = new Date("2024-01-15T18:00:00Z");

  it("keeps one value a time when paging repeats it", async () => {
    // A new value arriving between pages shifts the offsets, so page 2 repeats page 1's last.
    const page1 = JSON.parse(fixture("dmi-levels-1.json"));
    const page2 = JSON.parse(fixture("dmi-levels-2.json"));
    page2.features.unshift(page1.features.at(-1));
    serve([
      [/offset=18/, fixture("dmi-levels-3.json")],
      [/offset=10/, JSON.stringify(page2)],
      [/observation\/items/, JSON.stringify(page1)],
    ]);
    assert.equal((await dmi.levels("30017", start, end)).length, 18);
  });

  it("reads centimeters as meters, sorted, through every page", async () => {
    const requests = serve([
      [/offset=18/, fixture("dmi-levels-3.json")],
      [/offset=10/, fixture("dmi-levels-2.json")],
      [/observation\/items/, fixture("dmi-levels-1.json")],
    ]);
    const levels = await dmi.levels("30017", start, end);
    assert.equal(requests.length, 3);
    assert.match(
      requests[0]![0],
      /stationId=30017&parameterId=sealev_dvr&datetime=2024-01-15T15:00:00.000Z\/2024-01-15T17:59:59.999Z&limit=300000/,
    );
    assert.equal(levels.length, 18);
    assert.deepEqual(
      levels.map((l) => l.time),
      Array.from({ length: 18 }, (_, i) => start.getTime() + i * 600_000),
    );
    // A spike DMI's step check flagged, then values only its automatic checks passed.
    const spike = levels.find((l) => l.time === Date.parse("2024-01-15T16:40:00Z"))!;
    assert.deepEqual(spike, { time: spike.time, level: 2.82, flag: Flag.suspect });
    assert.equal(levels[0]!.flag, Flag.preliminary);
    assert.ok(Math.abs(levels[0]!.level) < 1);
  });

  it("marks values checked by hand good and erroneous ones bad", async () => {
    const body = JSON.parse(fixture("dmi-levels-manual.json"));
    body.features[0].properties.qcResult = 6.0;
    serve([
      [/offset=/, fixture("dmi-levels-3.json")],
      [/observation\/items/, JSON.stringify(body)],
    ]);
    const levels = await dmi.levels(
      "30017",
      new Date("2005-03-01T00:00:00Z"),
      new Date("2005-03-01T01:00:00Z"),
    );
    assert.equal(levels.length, 6);
    assert.equal(levels.filter((l) => l.flag === Flag.bad).length, 1);
    assert.equal(levels.filter((l) => l.flag === Flag.good).length, 5);
  });

  it("asks for a Coastal Authority gauge's registration", async () => {
    const requests = serve([
      [/offset=/, fixture("dmi-levels-3.json")],
      [/observation\/items/, fixture("dmi-levels-sea_reg.json")],
    ]);
    const levels = await dmi.levels(
      "9005201",
      new Date("2026-11-06T00:00:00Z"),
      new Date("2026-11-06T01:00:00Z"),
      { datum: "DVR90", parameter: "sea_reg" },
    );
    assert.match(requests[0]![0], /parameterId=sea_reg/);
    assert.equal(levels.length, 6);
  });

  it("refuses a parameter measured from another datum than the station's", async () => {
    serve([]);
    await assert.rejects(
      dmi.levels("30017", start, end, { datum: "DVR90", parameter: "sealev_ln" }),
      /measured from LN, not DVR90/,
    );
  });

  it("asks only for years inside the station's record", async () => {
    const requests = serve([[/observation\/items/, fixture("dmi-levels-3.json")]]);
    await dmi.levels("20002", new Date("2000-01-01Z"), new Date("2026-01-01Z"), {
      record_start: "2012-01-01",
      record_end: "2021-01-06",
    });
    const years = requests.map(([url]) => /datetime=(\d{4})/.exec(url)![1]);
    assert.deepEqual(years, [
      "2011",
      "2012",
      "2013",
      "2014",
      "2015",
      "2016",
      "2017",
      "2018",
      "2019",
      "2020",
      "2021",
    ]);
  });
});

describe("dmi cache", () => {
  it("never caches levels, since a cached first page could pair with a live second one", async () => {
    const requests = serve([
      [/offset=/, fixture("dmi-levels-3.json")],
      [/observation\/items/, fixture("dmi-levels-manual.json")],
    ]);
    await dmi.levels("30017", new Date("2005-03-01T00:00:00Z"), new Date("2005-03-01T01:00:00Z"));
    assert.ok(requests.every(([, options]) => options.fresh && !options.keep));
  });
});

describe("dmi owners and series", () => {
  it("lists only DMI's and the Coastal Authority's gauges, over every period", async () => {
    serveList(
      stationList([
        { stationId: "20049", owner: "Hirtshals Havn", parameterId: ["sealev_dvr"] },
        {
          stationId: "20050",
          owner: "Hirtshals Havn",
          parameterId: ["sea_reg"],
          validFrom: "2000-01-01T00:00:00Z",
        },
        {
          stationId: "20050",
          owner: "Kystdirektoratet / Coastal Authority",
          parameterId: ["sea_reg"],
        },
        { stationId: "20051", parameterId: ["sealev_dvr"], operationFrom: null },
        {
          stationId: "20052",
          owner: "DMI",
          parameterId: ["sea_reg"],
          validFrom: "2000-01-01T00:00:00Z",
        },
        {
          stationId: "20052",
          owner: "Kystdirektoratet / Coastal Authority",
          parameterId: ["sea_reg"],
        },
      ]),
    );
    const stations = await dmi.stations();
    assert.equal(
      stations.find((s) => s.id === "dmi/20049"),
      undefined,
    );
    assert.equal(
      stations.find((s) => s.id === "dmi/20050"),
      undefined,
    );
    // `validFrom` dates the metadata, not the record.
    assert.equal(stations.find((s) => s.id === "dmi/20051")!.record_start, null);
    // DMI's own `sea_reg` years are instrument readings, so a gauge it handed on reads no `sea_reg`.
    assert.equal(
      stations.find((s) => s.id === "dmi/20052"),
      undefined,
    );
  });

  it("reads the latest period's parameter, and credits every owner of the record", async () => {
    serveList(
      stationList([
        { stationId: "20060", parameterId: ["sealev_dvr"], validFrom: "2000-01-01T00:00:00Z" },
        { stationId: "20060", parameterId: ["sealev_ln"] },
        {
          stationId: "20061",
          owner: "Kystdirektoratet / Coastal Authority",
          parameterId: ["sealev_dvr"],
          validFrom: "2000-01-01T00:00:00Z",
        },
        { stationId: "20061", owner: "DMI", parameterId: ["sealev_dvr"] },
        { stationId: "20062", parameterId: ["sealev_dvr"], validFrom: "2000-01-01T00:00:00Z" },
        { stationId: "20062", parameterId: ["tw"] },
      ]),
    );
    const stations = await dmi.stations();
    assert.equal(stations.find((s) => s.id === "dmi/20060")!.parameter, "sealev_ln");
    // A latest period that lists nothing this reads falls back to every period's.
    assert.equal(stations.find((s) => s.id === "dmi/20062")!.parameter, "sealev_dvr");
    assert.equal(
      stations.find((s) => s.id === "dmi/20061")!.attribution,
      "Danish Meteorological Institute (DMI); Danish Coastal Authority (Kystdirektoratet)",
    );
  });

  it("refuses levels for a station whose owner DMI's terms don't cover", async () => {
    await assert.rejects(
      dmi.levels("20049", new Date("2024-01-01Z"), new Date("2024-01-02Z"), {
        owner: "Hirtshals Havn",
      }),
      /terms don't cover/,
    );
  });

  it("says a station whose levels move to another parameter changed series", () => {
    const station = (parameter: string) => ({ parameter }) as unknown as Station;
    assert.equal(dmi.seriesChanged(station("sea_reg"), station("sea_reg")), null);
    assert.match(
      dmi.seriesChanged(station("sea_reg"), station("sealev_dvr"))!,
      /now come from sealev_dvr, not sea_reg/,
    );
  });
});
