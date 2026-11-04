import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fetchText, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as bsh from "../src/sources/bsh/index.ts";
import * as coops from "../src/sources/coops/index.ts";
import * as pegelonline from "../src/sources/pegelonline/index.ts";
import * as rws from "../src/sources/rws/index.ts";

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
