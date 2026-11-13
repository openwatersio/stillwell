import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fetchText, setTransport, type RequestOptions } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import { epochSpans } from "../src/backfill.ts";
import { splitStarts } from "../src/epochs.ts";
import * as dmi from "../src/sources/dmi/index.ts";
import { mergeStationList } from "../src/stations.ts";

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
 * DMI's list as its station endpoint answered on 12 November 2026, 233
 * periods of 178 stations, followed by copies of Skagen's current period under
 * other IDs, owners and parameters.
 */
function stationList(extra: Record<string, unknown>[] = []): string {
  const body = JSON.parse(fixture("dmi-stations.json"));
  const current = body.features.find(
    (f: { properties: { stationId: string; validTo: string | null } }) =>
      f.properties.stationId === "20002" && !f.properties.validTo,
  );
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
  body.features.push(...extra.map(copy));
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
    const station = (await dmi.stations()).find((s) => s.id === "dmi/9005201")!;
    assert.equal(station.name, "Hvide Sande Havn");
    assert.equal(station.owner, "Kystdirektoratet / Coastal Authority");
    assert.equal(station.record_start, "1990-10-05");
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

  it("lists DMI's and the Coastal Authority's gauges from DMI's full list", async () => {
    const requests = serveList(fixture("dmi-stations.json"));
    const stations = await dmi.stations();
    assert.match(requests[0]![0], /station\/items\?limit=300000$/);
    const count = (owner: string, datum: string) =>
      stations.filter((s) => s.owner === owner && s.datum === datum).length;
    assert.equal(count("DMI", "DVR90"), 36);
    assert.equal(count("DMI", "LN"), 15);
    assert.equal(count("Kystdirektoratet / Coastal Authority", "DVR90"), 48);
    assert.equal(stations.length, 99);
    const hornbaek = stations.find((s) => s.id === "dmi/30018")!;
    assert.deepEqual(
      [hornbaek.status, hornbaek.record_start, hornbaek.record_end],
      ["inactive", "1891-01-01", "1991-10-11"],
    );
    // DMI dates the Coastal Authority's records from 1990.
    const coastal = stations.filter((s) => s.owner === "Kystdirektoratet / Coastal Authority");
    assert.ok(coastal.every((s) => s.record_start! >= "1990"));
  });

  it("names in its erratum every Coastal Authority gauge running before May 2002", async () => {
    serveList(fixture("dmi-stations.json"));
    const trimmed = (await dmi.stations())
      .filter((s) => s.parameter === "sea_reg" && (s.record_start ?? "") < "2002-05-29")
      .map((s) => s.id);
    const errata = JSON.parse(
      readFileSync(new URL("../src/sources/dmi/errata.json", import.meta.url), "utf8"),
    );
    const entry = errata.errata.find((e: { id: string }) => e.id === "dmi-coastal-authority-dnn");
    assert.deepEqual([...entry.stations].sort(), trimmed.sort());
    // The splits name the same gauges, on the erratum's day.
    assert.deepEqual([...dmi.SPLIT_STATIONS].sort(), trimmed.sort());
    const splits = dmi.source.overrides!.splits!;
    assert.deepEqual(Object.keys(splits).sort(), trimmed.sort());
    assert.ok(Object.values(splits).every((s) => s.length === 1 && s[0]!.since === entry.until));
  });

  it("refuses a list caught short", async () => {
    serveList(fixture("dmi-stations-skagen.json"));
    await assert.rejects(dmi.stations(), /listed only 1 sea-level stations/);
  });

  it("refuses a list whose owner name changed, rather than retire its gauges", async () => {
    const body = JSON.parse(fixture("dmi-stations.json"));
    // A later period under another spelling of the Coastal Authority hands over all 48 of its gauges.
    const renamed = body.features
      .filter((f: { properties: { owner: string } }) => f.properties.owner.startsWith("Kyst"))
      .map((f: { properties: Record<string, unknown> }) => ({
        ...f,
        properties: {
          ...f.properties,
          owner: "Kystdirektoratet",
          validFrom: "2026-11-01T00:00:00Z",
        },
      }));
    body.features.push(...renamed);
    serveList(JSON.stringify(body));
    await assert.rejects(dmi.stations(), /listed only 51 sea-level stations it still owns/);
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

  it("reads the Coastal Authority's registration from before its move to DVR90 in May 2002", async () => {
    const requests = serve([[/observation\/items/, fixture("dmi-levels-3.json")]]);
    await dmi.levels("9006401", new Date("2001-01-01Z"), new Date("2003-01-01Z"), {
      parameter: "sea_reg",
      record_start: "1990-09-05",
    });
    assert.deepEqual(
      requests.map(([url]) => /datetime=([^&]+)/.exec(url)![1]),
      [
        "2001-01-01T00:00:00.000Z/2001-12-31T23:59:59.999Z",
        "2002-01-01T00:00:00.000Z/2002-12-31T23:59:59.999Z",
      ],
    );
  });

  it("splits the Coastal Authority's gauges into an unconverted epoch before 29 May 2002", async () => {
    serveList(fixture("dmi-stations.json"));
    const fetched = await dmi.stations();
    const { stations } = mergeStationList([], fetched, {
      now: "2026-11-12T00:00:00Z",
      offsets: [0, 0],
      decisions: {},
      splits: dmi.source.overrides!.splits!,
    });
    const epochs = stations.find((s) => s.id === "dmi/9006401")!.epochs;
    assert.deepEqual(
      epochs.map((e) => [e.id, e.datum, e.since, e.until, e.to_current, e.state]),
      [
        [1, "DVR90", null, "2002-05-29T00:00:00Z", null, "closed"],
        [2, "DVR90", "2002-05-29T00:00:00Z", null, 0, "open"],
      ],
    );
    // Backfill writes each epoch's own span.
    const spans = epochSpans(
      epochs,
      new Date("2001-01-01Z"),
      new Date("2003-01-01Z"),
      undefined,
      splitStarts(dmi.source.overrides!.splits!["dmi/9006401"], [0, 0]),
    );
    assert.deepEqual(
      spans.map((s) => [s.epoch.id, s.from.toISOString(), s.to.toISOString()]),
      [
        [1, "2001-01-01T00:00:00.000Z", "2002-05-29T00:00:00.000Z"],
        [2, "2002-05-29T00:00:00.000Z", "2003-01-01T00:00:00.000Z"],
      ],
    );
    // A gauge that started after the move, and DMI's own, keep one epoch.
    assert.equal(stations.find((s) => s.id === "dmi/30017")!.epochs.length, 1);
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

  it("ends a gauge's record at its handover to an owner DMI's terms don't cover", async () => {
    serveList(
      stationList([
        {
          stationId: "20070",
          parameterId: ["sealev_dvr"],
          operationFrom: "1995-01-01T00:00:00Z",
          validFrom: "1995-01-01T00:00:00Z",
          validTo: "2018-04-16T00:00:00Z",
        },
        {
          stationId: "20070",
          name: "Havn",
          owner: "Kommuner/Havne",
          parameterId: ["sea_reg"],
          operationFrom: "1995-01-01T00:00:00Z",
          validFrom: "2018-04-16T00:00:00Z",
        },
      ]),
    );
    const station = (await dmi.stations()).find((s) => s.id === "dmi/20070")!;
    assert.equal(station.owner, "DMI");
    assert.equal(station.name, "Skagen Havn");
    assert.equal(station.parameter, "sealev_dvr");
    assert.deepEqual([station.status, station.live], ["inactive", false]);
    assert.deepEqual([station.record_start, station.record_end], ["1995-01-01", "2018-04-15"]);

    // A backfill or refetch past the handover reads nothing after it.
    const requests = serve([[/observation\/items/, fixture("dmi-levels-3.json")]]);
    await dmi.levels("20070", new Date("2017-01-01Z"), new Date("2027-01-01Z"), station);
    const ends = requests.map(([url]) => /datetime=[^/]+\/([^&]+)/.exec(url)![1]!);
    assert.deepEqual(ends, ["2017-12-31T23:59:59.999Z", "2018-04-15T23:59:59.999Z"]);
  });

  it("warns of a handover only until the stored list ends there", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    const list = stationList([
      { stationId: "20070", parameterId: ["sealev_dvr"], validFrom: "1995-01-01T00:00:00Z" },
      { stationId: "20070", owner: "Kommuner/Havne", validFrom: "2018-04-16T00:00:00Z" },
    ]);
    // A store that has never listed it has nothing to delete.
    serveList(list);
    await dmi.stations();
    assert.equal(warn.mock.callCount(), 0);
    serveList(list);
    await dmi.stations([{ id: "dmi/20070", record_end: null } as unknown as Station]);
    assert.equal(warn.mock.callCount(), 1);
    assert.match(String(warn.mock.calls[0]!.arguments[0]), /20070 was handed to Kommuner\/Havne/);
    serveList(list);
    await dmi.stations([{ id: "dmi/20070", record_end: "2018-04-15" } as unknown as Station]);
    assert.equal(warn.mock.callCount(), 1);
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
