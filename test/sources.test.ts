import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "node:test";
import { fetchText, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as bsh from "../src/sources/bsh/index.ts";
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
