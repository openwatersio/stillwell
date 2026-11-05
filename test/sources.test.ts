import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fetchText, setTransport } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import { readStationFiles } from "../src/station-files.ts";
import * as bsh from "../src/sources/bsh/index.ts";
import * as coops from "../src/sources/coops/index.ts";
import * as pegelonline from "../src/sources/pegelonline/index.ts";
import * as rws from "../src/sources/rws/index.ts";
import * as usace from "../src/sources/usace/index.ts";
import { ZERO_SINCE } from "../src/sources/usace/zeros.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Answer requests from fixtures, by the first pattern the URL matches. */
function serve(routes: [RegExp, string | (() => string)][]): void {
  setTransport(async (url) => {
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return typeof route[1] === "function" ? route[1]() : route[1];
  });
}

afterEach(() => setTransport(fetchText));

describe("rws", () => {
  it("reads levels in meters with flags from RWS's status and quality codes", async () => {
    serve([[/OphalenWaarnemingen/, fixture("rws-observations.json")]]);
    const levels = await rws.levels(
      "vlissingen",
      new Date("2016-12-30T00:00:00Z"),
      new Date("2017-01-01T00:00:00Z"),
    );
    assert.deepEqual(
      levels.map((l) => [new Date(l.time).toISOString(), l.level, l.flag]),
      [
        ["2016-12-31T00:00:00.000Z", -0.52, Flag.good],
        ["2016-12-31T00:10:00.000Z", -0.41, Flag.good],
        ["2016-12-31T00:20:00.000Z", -0.31, Flag.good],
        // 00:30 carried RWS's missing-value sentinel.
        ["2016-12-31T00:40:00.000Z", -0.1, Flag.preliminary],
        ["2016-12-31T15:10:00.000Z", 2.51, Flag.suspect],
      ],
    );
  });
});

describe("rws stations", () => {
  it("prefers NAP, takes MSL where that's all a location has, and lists extremes only against NAP", async () => {
    serve([[/OphalenCatalogus/, fixture("rws-catalog.json")]]);
    const stations = await rws.stations();
    // Being a meter apart doesn't make two codes one gauge; only checked twins are linked.
    assert.deepEqual(stations[0]!.same_as, []);
    assert.deepEqual(
      stations.map((s) => [s.id, s.datum, s.products, s.country_code]),
      [
        [
          "rws/hoekvanholland",
          "NAP",
          ["levels", "extremes", "predictions", "predicted_extremes"],
          "NL",
        ],
        ["rws/hoekvanholland.2", "NAP", ["levels"], "NL"],
        ["rws/k13a", "MSL", ["levels"], "NL"],
        ["rws/kralendijk", "NAP", ["levels"], "BQ"],
      ],
    );
  });

  it("asks for the station's datum for every product", async () => {
    const asked: string[] = [];
    setTransport(async (_url, options) => {
      const body = JSON.parse(String(options.body));
      asked.push(body.AquoPlusWaarnemingMetadata.AquoMetadata.Hoedanigheid?.Code ?? "any");
      return "";
    });
    const station = { source_id: "k13a", datum: "MSL" } as never;
    const range = [new Date("2024-01-01T00:00:00Z"), new Date("2024-01-02T00:00:00Z")] as const;
    await rws.source.observations!(station, ...range);
    await rws.source.predictions!(station, ...range);
    assert.deepEqual(asked, ["MSL", "MSL"]);
    // Extremes requests filter by grouping; the height channel must then be MSL.
    serve([
      [
        /OphalenWaarnemingen/,
        JSON.stringify({
          Succesvol: true,
          WaarnemingenLijst: [
            {
              Locatie: { Code: "k13a" },
              AquoMetadata: {
                Grootheid: { Code: "NVT" },
                Hoedanigheid: { Code: "NVT" },
                Typering: { Code: "GETETTPE" },
              },
              MetingenLijst: [
                {
                  Tijdstip: "2024-01-01T01:00:00+00:00",
                  Meetwaarde: { Waarde_Alfanumeriek: "hoogwater" },
                  WaarnemingMetadata: {},
                },
              ],
            },
            {
              Locatie: { Code: "k13a" },
              AquoMetadata: {
                Grootheid: { Code: "WATHTE" },
                Hoedanigheid: { Code: "NAP" },
                Eenheid: { Code: "cm" },
              },
              MetingenLijst: [
                {
                  Tijdstip: "2024-01-01T01:00:00+00:00",
                  Meetwaarde: { Waarde_Numeriek: 100 },
                  WaarnemingMetadata: {},
                },
              ],
            },
          ],
        }),
      ],
    ]);
    // NAP heights at an MSL station are refused rather than mixed in.
    await assert.rejects(rws.source.extremes!(station, ...range), /in NAP, not MSL/);
  });
});

describe("pegelonline", () => {
  it("lists stations with their datum, gauge zero and sampling interval", async () => {
    serve([[/stations\.json/, fixture("pegelonline-stations.json")]]);
    const stations = await pegelonline.stations();
    // The third fixture station has no position, so it isn't listed.
    assert.equal(stations.length, 2);
    const cuxhaven = stations.find((s) => s.source_id === "5990020")!;
    assert.equal(cuxhaven.id, "pegelonline/5990020");
    assert.equal(cuxhaven.datum, "PNP");
    assert.deepEqual(cuxhaven.datums, { NHN: -5.033 });
    assert.equal(cuxhaven.interval_s, 60);
    assert.equal(cuxhaven.commercial_use, true);
    const inland = stations.find((s) => s.source_id !== "5990020")!;
    assert.equal(inland.datum, "NN");
    assert.deepEqual(inland.datums, {});
  });

  it("scales levels by the series' unit", async () => {
    const values = JSON.stringify([
      { timestamp: "2026-11-03T12:00:00+01:00", value: 512 },
      { timestamp: "2026-11-03T12:01:00+01:00", value: 514 },
    ]);
    serve([
      [/5990020\/W\.json/, JSON.stringify({ unit: "cm" })],
      [/27800090\/W\.json/, JSON.stringify({ unit: "m+NN" })],
      [/measurements/, values],
    ]);
    const start = new Date("2026-11-03T00:00:00Z");
    const end = new Date("2026-11-04T00:00:00Z");
    const cm = await pegelonline.levels("5990020", start, end);
    assert.deepEqual(
      cm.map((l) => [new Date(l.time).toISOString(), l.level, l.flag]),
      [
        ["2026-11-03T11:00:00.000Z", 5.12, Flag.preliminary],
        ["2026-11-03T11:01:00.000Z", 5.14, Flag.preliminary],
      ],
    );
    const m = await pegelonline.levels("27800090", start, end);
    assert.equal(m[0]!.level, 512);
    // A station committed in PNP refuses a series now in NN.
    await assert.rejects(pegelonline.levels("27800090", start, end, "PNP"), /now in NN, not PNP/);
  });

  it("lists a station missing its W series without a datum, so it keeps the committed one", async () => {
    const [first] = JSON.parse(fixture("pegelonline-stations.json"));
    serve([[/stations\.json/, JSON.stringify([{ ...first, timeseries: [] }])]]);
    const [listed] = await pegelonline.stations();
    assert.equal(listed!.datum, null);
  });

  it("leaves out a station with half a position", async () => {
    const [first] = JSON.parse(fixture("pegelonline-stations.json"));
    serve([[/stations\.json/, JSON.stringify([{ ...first, longitude: undefined }])]]);
    assert.deepEqual(await pegelonline.stations(), []);
  });
});

describe("bsh", () => {
  it("reads predicted extremes and skips years BSH hasn't published", async () => {
    serve([[/deu2026&files=DE__506P2026/, fixture("DE__506P2026.txt")]]);
    const extremes = await bsh.source.predictedExtremes!(
      { source_id: "506P", datum: "PNP" } as never,
      new Date("2026-01-01T00:00:00Z"),
      new Date("2028-01-01T00:00:00Z"),
    );
    assert.ok(extremes.length > 100);
    assert.deepEqual(
      { type: extremes[0]!.type, flag: extremes[0]!.flag, transit: "transit" in extremes[0]! },
      { type: "low", flag: Flag.good, transit: true },
    );
  });

  it("gives datum offsets from the station's own datum, skipping heights BSH leaves null", () => {
    // 624A: SKN 1.56 m below NHN, gauge zero unknown.
    assert.deepEqual(
      bsh.offsets(
        { "PNP (unter NHN)": null, "SKN (unter NHN)": -156, "SKN (ueber PNP)": null },
        "SKN",
      ),
      { NHN: -1.56 },
    );
    // 726A: SKN 1.92 m below NHN, gauge zero 5.02 m below.
    assert.deepEqual(bsh.offsets({ "PNP (unter NHN)": -502, "SKN (unter NHN)": -192 }, "SKN"), {
      NHN: -1.92,
      PNP: 3.1,
    });
    // A PNP gauge with SKN given above gauge zero.
    assert.deepEqual(bsh.offsets({ "PNP (unter NHN)": -503, "SKN (ueber PNP)": 344 }, "PNP"), {
      NHN: -5.03,
      SKN: -3.44,
    });
  });

  it("refuses a year whose file is in another datum", async () => {
    serve([[/deu2026&files=DE__506P2026/, fixture("DE__506P2026.txt")]]);
    const range = [new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z")] as const;
    await assert.rejects(
      bsh.source.predictedExtremes!({ source_id: "506P", datum: "SKN" } as never, ...range),
      /in PNP, not SKN/,
    );
  });
});

describe("coops", () => {
  coops.pacing.metadataMs = 0;
  coops.pacing.blockedMs = 0;
  const station = (fields: object) => ({
    id: "9447130",
    name: "Seattle",
    lat: 47.6,
    lng: -122.3,
    state: "WA",
    tidal: true,
    greatlakes: false,
    ...fields,
  });

  it("lists current and historical stations in STND, with datums from it", async () => {
    serve([
      [
        /type=historicwl/,
        JSON.stringify({
          stations: [
            station({}),
            station({
              id: "9063020",
              name: "Buffalo",
              state: "NY",
              tidal: false,
              greatlakes: true,
            }),
            station({ id: "1495000", name: "Esperanza, Antarctica", state: "" }),
          ],
        }),
      ],
      [/type=waterlevels/, JSON.stringify({ stations: [station({}), station({ id: "9063020" })] })],
      [
        /9447130\/datums/,
        JSON.stringify({
          datums: [
            { name: "STND", value: 0 },
            { name: "MLLW", value: 2.419 },
            { name: "MSL", value: 4.443 },
            { name: "GT", value: 3.462 },
            { name: "NAVD88", value: 3.134 },
          ],
          LAT: 1.1089039,
        }),
      ],
      [/9063020\/datums/, JSON.stringify({ datums: [{ name: "GL_LWD", value: 173.5 }] })],
      [/1495000\/datums/, JSON.stringify({ datums: null, LAT: null })],
    ]);
    const [esperanza, buffalo, seattle] = await coops.stations();
    assert.deepEqual(
      [
        seattle!.id,
        seattle!.datum,
        seattle!.datums,
        seattle!.products,
        seattle!.live,
        seattle!.kind,
      ],
      [
        "coops/9447130",
        "STND",
        // A range such as GT isn't a datum.
        { MLLW: -2.419, MSL: -4.443, NAVD88: -3.134, LAT: -1.109 },
        ["levels", "extremes"],
        true,
        "coastal",
      ],
    );
    assert.deepEqual(
      [buffalo!.datums, buffalo!.products, buffalo!.kind],
      [{ IGLD: 0, LWD: -173.5 }, ["levels"], "lake"],
    );
    // Listed for its history, but not on the live network.
    assert.deepEqual(
      [esperanza!.live, esperanza!.status, esperanza!.datums],
      [false, "active", {}],
    );
  });

  it("reads 6-minute levels, falling back to hourly heights where there are none", async () => {
    serve([
      [/details\.json/, JSON.stringify({ established: "1899-01-01 00:00:00", removed: "" })],
      [
        /product=water_level.*begin_date=2024/,
        JSON.stringify({
          data: [
            { t: "2024-01-01 00:00", v: "4.788", f: "0,0,0,0", q: "v" },
            { t: "2024-01-01 00:06", v: "", f: "0,0,0,0", q: "v" },
            { t: "2024-01-01 00:12", v: "4.816", f: "1,0,0,0", q: "p" },
            { t: "2024-01-01 00:18", v: "9.9", f: "0,1,0,0", q: "p" },
          ],
        }),
      ],
      [
        /product=water_level/,
        JSON.stringify({
          error: { message: "No data was found. This product may not be offered." },
        }),
      ],
      [
        /product=hourly_height/,
        JSON.stringify({ data: [{ t: "1990-01-01 01:00", v: "5.084", f: "1,0" }] }),
      ],
    ]);
    const recent = await coops.levels(
      "9447130",
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-01T01:00:00Z"),
    );
    assert.deepEqual(
      recent.map((r) => [new Date(r.time).toISOString(), r.level, r.flag]),
      [
        ["2024-01-01T00:00:00.000Z", 4.788, Flag.good],
        // An outlier count alone doesn't flag the value.
        ["2024-01-01T00:12:00.000Z", 4.816, Flag.preliminary],
        ["2024-01-01T00:18:00.000Z", 9.9, Flag.suspect],
      ],
    );
    const old = await coops.levels(
      "9447130",
      new Date("1990-01-01T00:00:00Z"),
      new Date("1990-01-02T00:00:00Z"),
    );
    assert.deepEqual(old, [
      { time: Date.UTC(1990, 0, 1, 1), level: 5.084, flag: Flag.interpolated },
    ]);
  });

  it("doesn't ask for years the station wasn't running", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(url);
      if (url.includes("details.json"))
        return JSON.stringify({
          established: "1993-02-15 00:00:00",
          removed: "1999-02-26 23:59:00",
        });
      throw new Error(`unexpected ${url}`);
    });
    const levels = await coops.levels(
      "1495000",
      new Date("2010-01-01T00:00:00Z"),
      new Date("2011-01-01T00:00:00Z"),
    );
    assert.deepEqual([levels, asked.length], [[], 1]);
  });

  it("reads high and low waters, keeping higher and lower ones as high and low", async () => {
    serve([
      [/details\.json/, JSON.stringify({ established: "1899-01-01 00:00:00" })],
      [
        /product=high_low/,
        JSON.stringify({
          data: [
            { t: "2024-01-01 02:54", v: "5.192", ty: "H ", f: "0,0" },
            { t: "2024-01-01 09:30", v: "2.709", ty: "LL", f: "0,0" },
          ],
        }),
      ],
    ]);
    const extremes = await coops.extremes(
      "8443970",
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-02T00:00:00Z"),
    );
    assert.deepEqual(
      extremes.map((e) => [e.type, e.level]),
      [
        ["high", 5.192],
        ["low", 2.709],
      ],
    );
  });

  it("reads a country from a state, a territory or a full name", () => {
    assert.deepEqual(
      ["WA", "PR", "MH", "United Kingdom", "Antigua and Barbuda", "Germany", "ZZ", ""].map(
        coops.countryOf,
      ),
      // Germany isn't the retired DD; an unknown two-letter code isn't assumed to be a state.
      ["US", "PR", "MH", "GB", "AG", "DE", null, null],
    );
  });

  it("fills in hourly heights only before the 6-minute record starts", async () => {
    serve([
      [/details\.json/, JSON.stringify({ established: "1899-01-01 00:00:00" })],
      [
        /product=water_level/,
        JSON.stringify({
          data: [
            { t: "1996-03-15 00:00", v: "1.5", f: "0,0,0,0", q: "v" },
            { t: "1996-03-15 00:06", v: "1.6", f: "0,0,0,0", q: "v" },
          ],
        }),
      ],
      [
        /product=hourly_height/,
        JSON.stringify({
          data: [
            { t: "1996-03-14 23:00", v: "1.4", f: "0,0" },
            { t: "1996-03-15 00:00", v: "9.9", f: "0,0" },
          ],
        }),
      ],
    ]);
    const levels = await coops.levels(
      "8518750",
      new Date("1996-03-01T00:00:00Z"),
      new Date("1996-04-01T00:00:00Z"),
    );
    assert.deepEqual(
      levels.map((l) => l.level),
      [1.4, 1.5, 1.6],
    );
  });

  it("asks through the last whole minute before a range's end", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(new URL(url).searchParams.get("end_date") ?? "");
      return JSON.stringify({ data: [] });
    });
    // 00:06:30 exclusive means through 00:06.
    await coops.levels(
      "9410170",
      new Date("2024-01-10T00:00:00Z"),
      new Date("2024-01-10T00:06:30Z"),
    );
    assert.equal(asked.at(-1), "20240110 00:06");
  });

  it("keeps a Great Lakes station's committed offsets when its datums fail", async () => {
    serve([
      [
        /type=historicwl/,
        JSON.stringify({
          stations: [
            station({}),
            station({ id: "9063020", name: "Buffalo", tidal: false, greatlakes: true }),
          ],
        }),
      ],
      [/type=waterlevels/, JSON.stringify({ stations: [station({})] })],
      [/9447130\/datums/, JSON.stringify({ datums: [{ name: "MLLW", value: 2.419 }] })],
    ]);
    const listed = await coops.stations();
    // No IGLD: 0 on its own, which would replace the committed LWD.
    assert.deepEqual(listed.find((s) => s.source_id === "9063020")!.datums, {});
  });

  it("never replaces a 6-minute month with hourly heights after the 6-minute era begins", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(new URL(url).searchParams.get("product") ?? "");
      return JSON.stringify({ error: { message: "No data was found." } });
    });
    const levels = await coops.levels("9447130", new Date("2010-05-01Z"), new Date("2010-06-01Z"), {
      established: "1899-01-01T00:00:00Z",
      removed: null,
    });
    // An outage month comes back empty, so the lake keeps the 6-minute values it holds.
    assert.deepEqual([levels, asked], [[], ["water_level"]]);
  });

  it("asks a live station for years after an old removed date", async () => {
    let asked = 0;
    setTransport(async () => {
      asked++;
      return JSON.stringify({ data: [] });
    });
    await coops.levels("8410141", new Date("2010-01-01Z"), new Date("2010-02-01Z"), {
      live: true,
      established: "1990-01-01T00:00:00Z",
      removed: "2000-01-01T00:00:00Z",
    });
    assert.equal(asked, 1);
  });

  it("keeps a Great Lakes station's offsets when its datums come back empty", async () => {
    serve([
      [
        /type=historicwl/,
        JSON.stringify({
          stations: [station({ id: "9063020", tidal: false, greatlakes: true })],
        }),
      ],
      [/type=waterlevels/, JSON.stringify({ stations: [station({ id: "9063020" })] })],
      [/9063020\/datums/, JSON.stringify({ datums: null })],
    ]);
    const [buffalo] = await coops.stations();
    assert.deepEqual(buffalo!.datums, {});
  });

  it("takes a station's operating dates from its committed record", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(url);
      throw new Error(`unexpected ${url}`);
    });
    const gone = { established: "1993-02-15T00:00:00Z", removed: "1999-02-26T23:59:00Z" };
    const levels = await coops.levels(
      "1495000",
      new Date("2010-01-01T00:00:00Z"),
      new Date("2011-01-01T00:00:00Z"),
      gone,
    );
    assert.deepEqual([levels, asked], [[], []]);
    await assert.rejects(
      coops.levels("1495000", new Date("2010-01-01Z"), new Date("2010-02-01Z"), {
        established: "sometime",
        removed: null,
      }),
      /unreadable dates/,
    );
  });

  it("asks every year of a station removed before it was established, since it was reinstalled", async () => {
    let asked = 0;
    setTransport(async () => {
      asked++;
      return JSON.stringify({ data: [] });
    });
    await coops.levels("8410140", new Date("2010-01-01Z"), new Date("2010-03-01Z"), {
      established: "2015-01-01T00:00:00Z",
      removed: "2005-01-01T00:00:00Z",
    });
    // Two months, a 6-minute request each; hourly heights only fill in before 1997.
    assert.equal(asked, 2);
  });

  it("lists each station's established and removed dates", async () => {
    serve([
      [
        /type=historicwl/,
        JSON.stringify({
          stations: [
            station({
              id: "1495000",
              details: { established: "1993-02-15 00:00:00", removed: "1999-02-26 23:59:00" },
            }),
          ],
        }),
      ],
      [/type=waterlevels/, JSON.stringify({ stations: [station({})] })],
      [/datums/, JSON.stringify({ datums: [] })],
    ]);
    const listed = (await coops.stations()) as coops.CoopsStation[];
    const esperanza = listed.find((s) => s.source_id === "1495000")!;
    assert.deepEqual(
      [esperanza.established, esperanza.removed],
      ["1993-02-15T00:00:00Z", "1999-02-26T23:59:00Z"],
    );
  });

  it("counts a datums answer with an error body as a failure", async () => {
    const ids = ["1", "2", "3", "4", "5"];
    serve([
      [/type=historicwl/, JSON.stringify({ stations: ids.map((id) => station({ id })) })],
      [/type=waterlevels/, JSON.stringify({ stations: [station({ id: "1" })] })],
      [/datums/, JSON.stringify({ error: { message: "Internal error" } })],
    ]);
    await assert.rejects(coops.stations(), /datums failed for 5 stations.*Internal error/);
  });

  it("fills in the hour before a 6-minute record that starts an hour into the month", async () => {
    serve([
      [
        /product=water_level/,
        JSON.stringify({ data: [{ t: "1995-06-01 01:00", v: "1.5", f: "0,0,0,0", q: "v" }] }),
      ],
      [
        /product=hourly_height/,
        JSON.stringify({ data: [{ t: "1995-06-01 00:00", v: "1.4", f: "0,0" }] }),
      ],
    ]);
    const levels = await coops.levels("8518751", new Date("1995-06-01Z"), new Date("1995-07-01Z"), {
      established: "1899-01-01T00:00:00Z",
      removed: null,
    });
    assert.deepEqual(
      levels.map((l) => l.level),
      [1.4, 1.5],
    );
  });

  it("gives up as soon as several stations' datums fail in a row", async () => {
    const ids = ["1", "2", "3", "4", "5", "6"];
    serve([
      [/type=historicwl/, JSON.stringify({ stations: ids.map((id) => station({ id })) })],
      [/type=waterlevels/, JSON.stringify({ stations: [station({ id: "1" })] })],
    ]);
    await assert.rejects(coops.stations(), /datums failed for 5 stations/);
  });

  it("refuses an empty current-station list rather than taking every station off the live feed", async () => {
    serve([
      [/type=historicwl/, JSON.stringify({ stations: [station({})] })],
      [/type=waterlevels/, JSON.stringify({ stations: [] })],
    ]);
    await assert.rejects(coops.stations(), /listed no water-level stations/);
  });
});

describe("usace", () => {
  const now = Date.parse("2026-11-04T00:00:00Z");
  const series = (name: string, interval: string, from: string, to: string) => ({
    office: "MVS",
    name,
    interval,
    versioned: false,
    extents: [{ "earliest-time": from, "latest-time": to }],
  });

  it("lists one observed stage series per location, in GZ with the gauge zero's elevation", async () => {
    serve([
      [/catalog\/TIMESERIES\?office=MVN/, fixture("usace-catalog.json")],
      [/catalog\/LOCATIONS\?office=MVN/, fixture("usace-locations.json")],
      [/catalog\/(TIMESERIES|LOCATIONS)/, JSON.stringify({ entries: [] })],
    ]);
    // Only MVN answers here, and an office with no series fails the refresh.
    await assert.rejects(usace.stations(), /no stage series or locations for MVS/);
    const mvn = usace.toStations(
      "MVN",
      JSON.parse(fixture("usace-catalog.json")).entries,
      JSON.parse(fixture("usace-locations.json")).entries,
      new Map(),
      now,
    );
    assert.deepEqual(
      mvn.map((s) => [s.id, s.series, s.datum, s.datums, s.interval_s, s.live, s.kind]),
      [
        // Forecasts, statistics, the LWRP year and the NAVD88 copies are left out.
        [
          "usace/MVN.Baton_Rouge",
          "Baton_Rouge.Stage.Inst.1Hour.0.rev",
          "GZ",
          {},
          3600,
          true,
          "river",
        ],
        [
          "usace/MVN.Donaldsonville",
          "Donaldsonville.Stage.Inst.1Hour.0.rev",
          "GZ",
          {},
          3600,
          true,
          "river",
        ],
        // A local datum isn't one we can refer to.
        [
          "usace/MVN.New_Orleans",
          "New_Orleans.Stage.Inst.1Hour.0.rev",
          "GZ",
          {},
          3600,
          true,
          "river",
        ],
        // An elevation of 0 is as often a blank as a gauge set at the datum.
        ["usace/MVN.Reserve", "Reserve.Stage.Inst.1Hour.0.rev", "GZ", {}, 3600, true, "river"],
      ],
    );
    assert.equal(mvn[3]!.name, "Mississippi River at Reserve (01260)");
  });

  it("prefers a current series, then sub-daily, then revised, then the finest interval", () => {
    const [stLouis] = usace.toStations(
      "MVS",
      [
        series(
          "St Louis-Mississippi.Stage.Inst.1Hour.0.CWMS-Forecast-QPF",
          "1Hour",
          "2017-04-29T00:00:00Z",
          "2026-10-24T00:00:00Z",
        ),
        series(
          "St Louis-Mississippi.Stage.Inst.1Hour.0.historic-data-merge",
          "1Hour",
          "1983-11-15T00:00:00Z",
          "2011-01-01T00:00:00Z",
        ),
        series(
          "St Louis-Mississippi.Stage.Inst.~1Day.0.MVDhist-rev",
          "~1Day",
          "1861-01-01T00:00:00Z",
          "2026-09-11T00:00:00Z",
        ),
        series(
          "St Louis-Mississippi.Stage.Inst.30Minutes.0.lrgsShef-raw",
          "30Minutes",
          "1983-11-15T00:00:00Z",
          "2026-09-14T00:00:00Z",
        ),
        series(
          "St Louis-Mississippi.Stage.Inst.30Minutes.0.lrgsShef-rev",
          "30Minutes",
          "1983-11-15T00:00:00Z",
          "2026-09-14T00:00:00Z",
        ),
        series(
          "St Louis-Mississippi.Stage.Inst.15Minutes.0.rev-NAVD88",
          "15Minutes",
          "2020-01-01T00:00:00Z",
          "2026-09-14T00:00:00Z",
        ),
      ],
      [
        {
          office: "MVS",
          name: "St Louis-Mississippi",
          "public-name": "St Louis",
          kind: "STREAM_LOCATION",
          latitude: 38.629006,
          longitude: -90.179872,
          elevation: 379.5799999999999,
          unit: "ft",
          "vertical-datum": "NAVD88",
          nation: "United States",
        },
      ],
      new Map(),
      now,
    );
    assert.deepEqual(
      [stLouis!.series, stLouis!.datums, stLouis!.interval_s, stLouis!.live],
      ["St Louis-Mississippi.Stage.Inst.30Minutes.0.lrgsShef-rev", { NAVD88: 115.696 }, 1800, true],
    );
    // A gauge whose only series stopped years ago is listed for its history, not live.
    const [old] = usace.toStations(
      "MVS",
      [
        series(
          "St Louis-Mississippi.Stage.Inst.1Hour.0.historic-data-merge",
          "1Hour",
          "1983-11-15T00:00:00Z",
          "2011-01-01T00:00:00Z",
        ),
      ],
      [{ office: "MVS", name: "St Louis-Mississippi", latitude: 38.6, longitude: -90.2 }],
      new Map(),
      now,
    );
    assert.deepEqual([old!.live, old!.datums, old!.kind], [false, {}, null]);
  });

  it("refers gauge zero to NGVD29 or NAVD88, whatever CWMS calls them", () => {
    const vicksburg = {
      office: "MVK",
      name: "Vicksburg",
      elevation: 46.23,
      unit: "ft",
      "vertical-datum": "NGVD29",
    };
    assert.deepEqual(usace.datumsOf(vicksburg), { NGVD29: 14.091 });
    assert.deepEqual(usace.datumsOf({ ...vicksburg, "vertical-datum": "ngvd29" }), {
      NGVD29: 14.091,
    });
    assert.deepEqual(usace.datumsOf({ ...vicksburg, "vertical-datum": "NAVD88(2009.55)" }), {
      NAVD88: 14.091,
    });
    assert.deepEqual(usace.datumsOf({ ...vicksburg, elevation: 14.091, unit: "m" }), {
      NGVD29: 14.091,
    });
    assert.deepEqual(usace.datumsOf({ ...vicksburg, "vertical-datum": "LOCAL" }), {});
    assert.deepEqual(usace.datumsOf({ ...vicksburg, "vertical-datum": "COE1912" }), {});
  });

  it("keeps a committed series while CWMS lists it, and marks the station inactive when it doesn't", () => {
    const listed = [
      series(
        "Reserve.Stage.Inst.1Hour.0.rev",
        "1Hour",
        "1987-01-01T00:00:00Z",
        "2026-09-14T00:00:00Z",
      ),
      series(
        "Reserve.Stage.Inst.15Minutes.0.DCP-rev",
        "15Minutes",
        "2020-01-01T00:00:00Z",
        "2026-09-14T00:00:00Z",
      ),
    ];
    const reserve = [{ office: "MVN", name: "Reserve", latitude: 30.05, longitude: -90.57 }];
    // Fresh, the finer series wins.
    assert.equal(
      usace.toStations("MVN", listed, reserve, new Map(), now)[0]!.series,
      "Reserve.Stage.Inst.15Minutes.0.DCP-rev",
    );
    const [kept] = usace.toStations(
      "MVN",
      listed,
      reserve,
      new Map([["usace/MVN.Reserve", "Reserve.Stage.Inst.1Hour.0.rev"]]),
      now,
    );
    // Still reporting, so still live.
    assert.deepEqual(
      [kept!.series, kept!.interval_s, kept!.status, kept!.live],
      ["Reserve.Stage.Inst.1Hour.0.rev", 3600, "active", true],
    );
    // A committed ID belongs to its own location: another that maps to it is
    // skipped, even when it sorts first, so the station's files keep one gauge.
    const clash = usace.toStations(
      "MVN",
      [
        ...listed,
        series(
          "Reserve-.Stage.Inst.1Hour.0.rev",
          "1Hour",
          "2020-01-01T00:00:00Z",
          "2026-09-14T00:00:00Z",
        ),
        series(
          "Reserve&.Stage.Inst.1Hour.0.rev",
          "1Hour",
          "2020-01-01T00:00:00Z",
          "2026-09-14T00:00:00Z",
        ),
        series(
          "Reserve_.Stage.Inst.1Hour.0.rev",
          "1Hour",
          "2020-01-01T00:00:00Z",
          "2026-09-14T00:00:00Z",
        ),
      ],
      [
        ...reserve,
        ...["Reserve-", "Reserve&", "Reserve_"].map((name) => ({ ...reserve[0]!, name })),
      ],
      new Map([["usace/MVN.Reserve_", "Reserve_.Stage.Inst.1Hour.0.rev"]]),
      now,
    );
    assert.deepEqual(
      clash.map((s) => [s.id, s.series]),
      [
        ["usace/MVN.Reserve", "Reserve.Stage.Inst.15Minutes.0.DCP-rev"],
        ["usace/MVN.Reserve-", "Reserve-.Stage.Inst.1Hour.0.rev"],
        ["usace/MVN.Reserve_", "Reserve_.Stage.Inst.1Hour.0.rev"],
      ],
    );
    // A location gone, and another now mapping to its ID, leaves the station unlisted.
    assert.deepEqual(
      usace
        .toStations(
          "MVN",
          listed,
          reserve,
          new Map([["usace/MVN.Reserve", "Reserve_Old.Stage.Inst.1Hour.0.rev"]]),
          now,
        )
        .map((s) => s.id),
      [],
    );
    const [gone] = usace.toStations(
      "MVN",
      listed,
      reserve,
      new Map([["usace/MVN.Reserve", "Reserve.Stage.Inst.1Hour.0.raw"]]),
      now,
    );
    assert.deepEqual(
      [gone!.series, gone!.status, gone!.live],
      ["Reserve.Stage.Inst.1Hour.0.raw", "inactive", false],
    );
  });

  it("gives IDs safe in paths and shell arguments, and leaves out piezometers and wells", () => {
    const at = { latitude: 33.4, longitude: -92.1 };
    const stations = usace.toStations(
      "MVK",
      ["Columbia L&D-Lower", "Columbia L&D-Piezometer B1", "Columbia L&D-OW7L", "Baton Rouge"].map(
        (name) => ({
          ...series(
            `${name}.Stage.Inst.1Hour.0.DCP-rev`,
            "1Hour",
            "2011-01-01T00:00:00Z",
            "2026-09-14T00:00:00Z",
          ),
          office: "MVK",
        }),
      ),
      [
        "Columbia L&D-Lower",
        "Columbia L&D-Piezometer B1",
        "Columbia L&D-OW7L",
        "Baton Rouge",
        "Baton_Rouge",
      ].map((name) => ({ office: "MVK", name, ...at })),
      new Map(),
      now,
    );
    assert.deepEqual(
      stations.map((s) => [s.id, s.series]),
      [
        ["usace/MVK.Baton_Rouge", "Baton Rouge.Stage.Inst.1Hour.0.DCP-rev"],
        ["usace/MVK.Columbia_L_D-Lower", "Columbia L&D-Lower.Stage.Inst.1Hour.0.DCP-rev"],
      ],
    );
  });

  it("lists every office's catalogs, following pages", async () => {
    const entries = JSON.parse(fixture("usace-catalog.json")).entries as { name: string }[];
    const half = Math.ceil(entries.length / 2);
    serve([
      [/catalog\/TIMESERIES.*page=next/, JSON.stringify({ entries: entries.slice(half) })],
      [
        /catalog\/TIMESERIES/,
        JSON.stringify({ entries: entries.slice(0, half), "next-page": "next" }),
      ],
      [/catalog\/LOCATIONS/, fixture("usace-locations.json")],
    ]);
    const previous = [{ id: "usace/LRC.Reserve", zero_since: "2001-01-01" } as unknown as Station];
    const listed = (await usace.stations(previous)) as usace.UsaceStation[];
    assert.equal(listed.length, 9 * 4);
    // Donaldsonville's zero moved in 1988, per ZERO_SINCE; a date only the
    // committed list has is kept too.
    const since = (id: string) => listed.find((s) => s.id === id)!.zero_since;
    assert.equal(since("usace/MVN.Donaldsonville"), "1988-06-15");
    assert.equal(since("usace/LRC.Reserve"), "2001-01-01");
    assert.equal(since("usace/MVN.Reserve"), undefined);
    assert.deepEqual(
      listed.filter((s) => s.id.startsWith("usace/LRC.")).map((s) => s.series),
      [
        "Baton_Rouge.Stage.Inst.1Hour.0.rev",
        "Donaldsonville.Stage.Inst.1Hour.0.rev",
        "New_Orleans.Stage.Inst.1Hour.0.rev",
        "Reserve.Stage.Inst.1Hour.0.rev",
      ],
    );
  });

  it("reads a station's series from its source_url when it comes from stations.parquet", async () => {
    const requests: string[] = [];
    setTransport(async (url) => {
      requests.push(url);
      return JSON.stringify({ units: "m", values: [[1704070800000, 2.5, 3]] });
    });
    const [reserve] = usace
      .toStations(
        "MVN",
        JSON.parse(fixture("usace-catalog.json")).entries,
        JSON.parse(fixture("usace-locations.json")).entries,
        new Map(),
        now,
      )
      .filter((s) => s.id === "usace/MVN.Reserve");
    const { series: _, ...fromParquet } = reserve!;
    const levels = await usace.source.observations!(
      fromParquet as Station,
      new Date("2024-01-01Z"),
      new Date("2024-01-02Z"),
    );
    assert.deepEqual(levels, [{ time: 1704070800000, level: 2.5, flag: Flag.good }]);
    assert.match(requests[0]!, /office=MVN&name=Reserve.Stage.Inst.1Hour.0.rev&/);
  });

  it("leaves out locations placed outside the contiguous US", () => {
    const at = (latitude: number, longitude: number, name: string) => ({
      office: "MVS",
      name,
      latitude,
      longitude,
    });
    const names = ["Anoka", "BuckCreek", "Grafton"];
    const stations = usace.toStations(
      "MVS",
      names.map((n) =>
        series(
          `${n}.Stage.Inst.1Hour.0.rev`,
          "1Hour",
          "2011-01-01T00:00:00Z",
          "2026-09-14T00:00:00Z",
        ),
      ),
      [at(9.09, 9.09, "Anoka"), at(37.9, 83.75, "BuckCreek"), at(38.97, -90.43, "Grafton")],
      new Map(),
      now,
    );
    assert.deepEqual(
      stations.map((s) => s.id),
      ["usace/MVS.Grafton"],
    );
  });

  it("never fetches levels from before a station's gauge zero moved", async () => {
    const requests: string[] = [];
    setTransport(async (url) => {
      requests.push(url);
      return JSON.stringify({ units: "m", values: [[Date.parse("2015-07-01T00:00:00Z"), 1.2, 3]] });
    });
    // As read from stations.parquet: no series, no zero_since.
    const venice = {
      id: "usace/MVN.Venice",
      source_id: "MVN.Venice",
      datum: "GZ",
      source_url: `https://cwms-data.usace.army.mil/cwms-data/timeseries?office=MVN&name=${encodeURIComponent("Venice.Stage.Inst.1Hour.0.rev")}`,
    } as Station;
    const observe = (start: string, end: string) =>
      usace.source.observations!(venice, new Date(start), new Date(end));
    assert.deepEqual(await observe("2014-01-01Z", "2015-06-01Z"), []);
    assert.equal(requests.length, 0);
    assert.equal((await observe("2015-01-01Z", "2016-01-01Z")).length, 1);
    assert.equal(new URL(requests[0]!).searchParams.get("begin"), "2015-06-29T06:00:00.000Z");
    // A later date on the station wins over the table's.
    assert.equal(
      usace.zeroSince({ source_id: "MVN.Venice", zero_since: "2016-01-01" }),
      Date.parse("2016-01-01T06:00:00Z"),
    );
    assert.equal(usace.zeroSince({ source_id: "MVN.Reserve" }), -Infinity);
    assert.throws(
      () => usace.zeroSince({ source_id: "MVN.Reserve", zero_since: "June 2015" }),
      /unreadable/,
    );
  });

  it("keeps every hand-entered zero date in the committed station files", async () => {
    const committed = new Map(
      (
        (await readStationFiles(
          join(import.meta.dirname, "../stations"),
          usace.source.metadata,
        )) as usace.UsaceStation[]
      ).map((s) => [s.source_id, s]),
    );
    for (const [id, { since }] of Object.entries(ZERO_SINCE)) {
      assert.match(since, /^\d{4}-\d{2}-\d{2}$/, id);
      assert.ok(Number.isFinite(Date.parse(since)), id);
      const station = committed.get(id);
      assert.ok(station, `${id} isn't in stations/usace/`);
      assert.ok(
        station.zero_since && station.zero_since >= since,
        `${id} zero_since ${station.zero_since}`,
      );
    }
    // And the other way: a date only the committed list has would bound
    // backfills but not a station read from stations.parquet.
    for (const [id, station] of committed)
      if (station.zero_since)
        assert.ok(ZERO_SINCE[id], `${id} has zero_since but no ZERO_SINCE entry`);
  });

  it("maps CWMS quality codes to flags", () => {
    assert.deepEqual([0, 1, 3, 5, 9, 17, 2051, 4099, -2147483645].map(usace.flagOf), [
      Flag.preliminary, // unscreened
      Flag.preliminary, // screened, with no verdict
      Flag.good, // screened okay
      null, // missing
      Flag.suspect, // questionable
      Flag.bad, // rejected
      Flag.interpolated, // okay, replaced by linear interpolation
      Flag.good, // okay, replaced by hand
      Flag.good, // okay and protected
    ]);
  });

  it("reads stage in meters a year at a time, following pages and dropping missing values", async () => {
    const requests: string[] = [];
    setTransport(async (url) => {
      requests.push(url);
      const u = new URL(url);
      const begin = u.searchParams.get("begin")!;
      if (begin.startsWith("2023") && !u.searchParams.get("page"))
        return JSON.stringify({
          name: "Donaldsonville.Stage.Inst.1Hour.0.rev",
          "office-id": "MVN",
          units: "m",
          "next-page": "MTY4MjExMDgwMDAwMHx8NHx8Mg==",
          values: [
            [1704060000000, 5.748528, 3],
            [1704063600000, 5.855207999999999, 0],
          ],
        });
      if (begin.startsWith("2023"))
        return JSON.stringify({
          units: "m",
          values: [
            [1704063600000, 5.855207999999999, 0],
            [1704067200000, 6.626352, 5],
            [1704070800000, null, 0],
          ],
        });
      return JSON.stringify({
        units: "m",
        values: [
          [1704070800000, 6.089904, 9],
          [1704074400000, 6.1, 3],
        ],
      });
    });
    const levels = await usace.levels(
      "MVN",
      "Donaldsonville.Stage.Inst.1Hour.0.rev",
      new Date("2023-12-31T22:00:00Z"),
      new Date("2024-01-01T02:00:00Z"),
    );
    assert.deepEqual(
      levels.map((l) => [new Date(l.time).toISOString(), l.level, l.flag]),
      [
        ["2023-12-31T22:00:00.000Z", 5.749, Flag.good],
        ["2023-12-31T23:00:00.000Z", 5.855, Flag.preliminary],
        // 00:00 was marked missing; at 01:00 the 2023 page had no value and 2024 a questionable one.
        ["2024-01-01T01:00:00.000Z", 6.09, Flag.suspect],
      ],
    );
    assert.deepEqual(
      requests.map((r) => {
        const u = new URL(r);
        return [u.searchParams.get("begin"), u.searchParams.get("end"), u.searchParams.get("unit")];
      }),
      [
        ["2023-12-31T22:00:00.000Z", "2024-01-01T00:00:00.000Z", "SI"],
        ["2023-12-31T22:00:00.000Z", "2024-01-01T00:00:00.000Z", "SI"],
        ["2024-01-01T00:00:00.000Z", "2024-01-01T02:00:00.000Z", "SI"],
      ],
    );
  });

  it("refuses a series in feet, and a station committed in another datum", async () => {
    serve([[/timeseries/, JSON.stringify({ units: "ft", values: [[1704070800000, 20.1, 3]] })]]);
    await assert.rejects(
      usace.levels(
        "MVN",
        "Reserve.Stage.Inst.1Hour.0.rev",
        new Date("2024-01-01Z"),
        new Date("2024-01-02Z"),
      ),
      /came in ft, not m/,
    );
    // A response that doesn't say its unit is refused too.
    serve([[/timeseries/, JSON.stringify({ values: [[1704070800000, 20.1, 3]] })]]);
    await assert.rejects(
      usace.levels(
        "MVN",
        "Reserve.Stage.Inst.1Hour.0.rev",
        new Date("2024-01-01Z"),
        new Date("2024-01-02Z"),
      ),
      /came in undefined, not m/,
    );
    const station = {
      id: "usace/MVN.Reserve",
      source_id: "MVN.Reserve",
      datum: "NGVD29",
      series: "Reserve.Stage.Inst.1Hour.0.rev",
    } as unknown as Station;
    await assert.rejects(
      usace.source.observations!(station, new Date("2024-01-01Z"), new Date("2024-01-02Z")),
      /is in NGVD29; CWMS stage comes in GZ/,
    );
  });
});
