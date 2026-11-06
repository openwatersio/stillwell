import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Blocked, fetchText, setTransport } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as bsh from "../src/sources/bsh/index.ts";
import * as coops from "../src/sources/coops/index.ts";
import * as pegelonline from "../src/sources/pegelonline/index.ts";
import * as rws from "../src/sources/rws/index.ts";
import * as usace from "../src/sources/usace/index.ts";
import { ZERO_SINCE } from "../src/sources/usace/zeros.ts";
import * as usgs from "../src/sources/usgs/index.ts";

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

  /** One series per channel, each given as [time, value] pairs. */
  const answer = (...channels: [Record<string, unknown>, [string, number | string][]][]) =>
    JSON.stringify({
      Succesvol: true,
      WaarnemingenLijst: channels.map(([aquo, values]) => ({
        Locatie: { Code: "x" },
        AquoMetadata: { Eenheid: { Code: "cm" }, ...aquo },
        MetingenLijst: values.map(([time, value]) => ({
          Tijdstip: time,
          Meetwaarde:
            typeof value === "number"
              ? { Waarde_Numeriek: value }
              : { Waarde_Alfanumeriek: value, Waarde_Numeriek: 0 },
          WaarnemingMetadata: { Statuswaarde: "Gecontroleerd", Kwaliteitswaardecode: "00" },
        })),
      })),
    });
  const nap = { Grootheid: { Code: "WATHTE" }, Hoedanigheid: { Code: "NAP" } };
  const typeChannel = {
    Grootheid: { Code: "NVT" },
    Hoedanigheid: { Code: "NVT" },
    Groepering: { Code: "GETETM2" },
    Typering: { Code: "GETETTPE" },
  };

  it("puts observed values from before 2005 on the revised NAP where PSMSL gives the offset", async () => {
    // The revision starts at UTC midnight, so old-NAP epochs line up with year files.
    const times = ["2005-01-01T00:50:00.000+01:00", "2005-01-01T01:00:00.000+01:00"];
    serve([
      [
        /OphalenWaarnemingen/,
        answer(
          [typeChannel, times.map((t) => [t, "laagwater"])],
          [nap, times.map((t) => [t, 100])],
        ),
      ],
    ]);
    const range = [new Date("2004-12-31T00:00:00Z"), new Date("2005-01-02T00:00:00Z")] as const;
    // Hoek van Holland reads 2.8 cm lower on the revised NAP.
    for (const get of [rws.levels, rws.extremes])
      assert.deepEqual(
        (await get("hoekvanholland", ...range)).map((l) => l.level),
        [0.972, 1],
      );
    // The astronomical tide is left as RWS serves it.
    assert.deepEqual(
      (await rws.levels("hoekvanholland", ...range, { process: "astronomisch" })).map(
        (l) => l.level,
      ),
      [1, 1],
    );
    // A gauge without an offset is served as RWS gives it, for its old-NAP epoch.
    assert.deepEqual(
      (await rws.levels("dordrecht", ...range)).map((l) => l.level),
      [1, 1],
    );
  });

  it("reads both lows of a double low water, and not the rise between them", async () => {
    const times = [
      "2024-01-01T02:00:00+01:00",
      "2024-01-01T08:00:00+01:00",
      "2024-01-01T09:00:00+01:00",
      "2024-01-01T10:00:00+01:00",
    ];
    serve([
      [
        /OphalenWaarnemingen/,
        answer(
          [
            {
              Grootheid: { Code: "NVT" },
              Hoedanigheid: { Code: "NVT" },
              Typering: { Code: "GETETTPE" },
            },
            times.map((t, i) => [t, ["hoogwater", "laagwater 1", "topagger", "laagwater 2"][i]!]),
          ],
          [nap, times.map((t, i) => [t, [199, -40, -20, -45][i]!])],
        ),
      ],
    ]);
    const extremes = await rws.extremes(
      "hoekvanholland",
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-02T00:00:00Z"),
    );
    assert.deepEqual(
      extremes.map((e) => [e.type, e.level]),
      [
        ["high", 1.99],
        ["low", -0.4],
        ["low", -0.45],
      ],
    );
  });

  it("fails on an extreme type it doesn't know rather than drop it", async () => {
    const time = "2024-01-01T02:00:00+01:00";
    serve([
      [/OphalenWaarnemingen/, answer([typeChannel, [[time, "hoogwater 1"]]], [nap, [[time, 199]]])],
    ]);
    const range = [new Date("2024-01-01T00:00:00Z"), new Date("2024-01-02T00:00:00Z")] as const;
    await assert.rejects(
      rws.extremes("hoekvanholland", ...range),
      /unknown extreme type hoogwater 1/,
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
    // Dutch NAP stations without an offset have their history before 2005 in
    // the old NAP; MSL and Bonaire's NAP never changed.
    assert.deepEqual(
      stations.map((s) => s.reference),
      [null, rws.REVISED_NAP, null, null],
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
  beforeEach(() => {
    pegelonline.pacing.restMs = 0;
    pegelonline.resetPacing();
  });

  it("lists stations with their datum, gauge zero and sampling interval", async () => {
    serve([[/stations\.json/, fixture("pegelonline-stations.json")]]);
    const stations = await pegelonline.stations();
    // The third fixture station has no position, so it isn't listed.
    assert.equal(stations.length, 2);
    const cuxhaven = stations.find((s) => s.source_id === "5990020")!;
    assert.equal(cuxhaven.id, "pegelonline/5990020");
    assert.equal(cuxhaven.datum, "PNP");
    assert.deepEqual(cuxhaven.datums, { NHN: -5.033 });
    // Its gauge zero is valid from 2019-11-01, a day left out of both epochs if it moves.
    assert.deepEqual(cuxhaven.reference, { id: "2019-11-01", since: "2019-11-02" });
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

  /** Serve the raw-data download from the recorded zip, keeping each request's body. */
  function serveDownload(bodies: string[]): void {
    const zip = readFileSync(new URL("fixtures/pegelonline-download.zip", import.meta.url));
    setTransport(async (url, options) => {
      if (/stations\/5990020\.json/.test(url))
        return JSON.stringify({ uuid: "aad49293-242a-43ad-a8b1-e91d7792c4b2" });
      if (/download\/prepare/.test(url)) {
        bodies.push(String(options.body));
        return JSON.stringify({ downloadUrl: "/gast/download?filename=x.zip-abc" });
      }
      if (/gast\/download\?/.test(url)) return zip.toString("base64");
      throw new Error(`GET ${url} returned 404`);
    });
  }

  it("reads the raw-data download in UTC across the autumn clock change", async () => {
    const bodies: string[] = [];
    serveDownload(bodies);
    // 31 October 2010 local, 25 hours long: 22:00 UTC the day before to 23:00 UTC.
    const start = new Date("2010-10-30T22:00:00Z");
    const end = new Date("2010-10-31T23:00:00Z");
    const levels = await pegelonline.history("5990020", start, end, "PNP");
    assert.equal(levels.length, 25 * 60);
    assert.ok(levels.every((l, i) => i === 0 || l.time - levels[i - 1]!.time === 60_000));
    assert.equal(new Date(levels[0]!.time).toISOString(), start.toISOString());
    assert.equal(levels[0]!.flag, Flag.preliminary);
    assert.ok(levels.every((l) => l.level > 0 && l.level < 12));
    // Whole local days, both included, from the day before the UTC start to the local day of the end.
    const body = new URLSearchParams(bodies[0]);
    assert.deepEqual(
      [body.get("start"), body.get("end"), body.get("format")],
      ["2010-10-29", "2010-11-01", "json"],
    );
    await assert.rejects(pegelonline.history("5990020", start, end, "NN"), /in PNP, not NN/);
  });

  it("rests after each download as long as it took, and at least restMs", async () => {
    const zip = readFileSync(new URL("fixtures/pegelonline-download.zip", import.meta.url));
    const fetched: number[] = [];
    setTransport(async (url) => {
      if (/stations\/5990020\.json/.test(url)) return JSON.stringify({ uuid: "aad49293" });
      if (/download\/prepare/.test(url)) {
        fetched.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 80));
        return JSON.stringify({ downloadUrl: "/gast/download?filename=x.zip-abc" });
      }
      return zip.toString("base64");
    });
    pegelonline.pacing.restMs = 20;
    const day = [new Date("2010-10-31T00:00:00Z"), new Date("2010-10-31T01:00:00Z")] as const;
    await Promise.all([
      pegelonline.history("5990020", ...day),
      pegelonline.history("5990020", ...day),
    ]);
    // The second starts after the first's 80 ms and a rest as long, not after restMs.
    assert.ok(fetched[1]! - fetched[0]! >= 155, `${fetched[1]! - fetched[0]!} ms apart`);
  });

  // A transport whose `prepare` answers come from `answers` in turn ("ok", or a
  // status for the HTTP layer's error), with lookups for any station.
  const refusing = (answers: string[], lookup = () => "ok") => {
    const zip = readFileSync(new URL("fixtures/pegelonline-download.zip", import.meta.url));
    const counts = { prepared: 0, looked: 0 };
    setTransport(async (url) => {
      if (/stations\/\d+\.json/.test(url)) {
        counts.looked++;
        const answer = lookup();
        if (answer !== "ok") throw new Error(`GET ${url} returned ${answer}`);
        return JSON.stringify({ uuid: "aad49293" });
      }
      if (/gast\/download\?/.test(url)) return zip.toString("base64");
      const answer = answers[counts.prepared++] ?? "ok";
      if (answer === "ok") return JSON.stringify({ downloadUrl: "/gast/download?filename=x.zip" });
      throw new Error(`POST ${url} returned ${answer}`);
    });
    return counts;
  };
  const day = [new Date("2010-10-31T00:00:00Z"), new Date("2010-10-31T01:00:00Z")] as const;
  const notBlocked = (e: unknown) => !(e instanceof Blocked);

  it("stops downloading after refusals at three stations with no download between", async () => {
    const counts = refusing(["429", "429", "ok", "429", "429", "429", "429"]);
    // A completed download ends a run of refusals; one station's refusals,
    // however many, count once.
    await assert.rejects(pegelonline.history("1", ...day), notBlocked);
    await assert.rejects(pegelonline.history("2", ...day), notBlocked);
    await pegelonline.history("1", ...day);
    for (const id of ["3", "3", "4"])
      await assert.rejects(pegelonline.history(id, ...day), notBlocked);
    assert.equal(counts.prepared, 6);
    // The third station's refusal blocks. Downloads already queued behind it
    // fail without asking or waiting out a rest.
    pegelonline.pacing.restMs = 10_000;
    const began = Date.now();
    const queued = ["5", "6", "7"].map((id) => pegelonline.history(id, ...day));
    for (const q of queued) await assert.rejects(q, /at 3 stations with no download between/);
    assert.equal(counts.prepared, 7);
    assert.ok(Date.now() - began < 1_000);
  });

  it("counts a 500 as a refusal", async () => {
    const counts = refusing(["500", "500", "500"]);
    await assert.rejects(pegelonline.history("1", ...day), notBlocked);
    await assert.rejects(pegelonline.history("2", ...day), notBlocked);
    await assert.rejects(pegelonline.history("3", ...day), Blocked);
    assert.equal(counts.prepared, 3);
  });

  it("fails one gauge refused year after year without stopping the rest", async () => {
    refusing(["500", "500", "500", "500", "504"]);
    for (let i = 0; i < 4; i++) await assert.rejects(pegelonline.history("1", ...day), notBlocked);
    await assert.rejects(pegelonline.history("2", ...day), notBlocked);
    await pegelonline.history("3", ...day);
  });

  it("counts a refused station lookup toward a block", async () => {
    const counts = refusing([], () => "403");
    await assert.rejects(pegelonline.history("1", ...day), notBlocked);
    await assert.rejects(pegelonline.history("2", ...day), notBlocked);
    await assert.rejects(pegelonline.history("3", ...day), Blocked);
    assert.equal(counts.prepared, 0);
  });

  it("counts a refused file download toward a block, without preparing again", async () => {
    let prepared = 0;
    setTransport(async (url) => {
      if (/stations\/\d+\.json/.test(url)) return JSON.stringify({ uuid: "aad49293" });
      if (/gast\/download\?/.test(url)) throw new Error(`GET ${url} returned 429`);
      prepared++;
      return JSON.stringify({ downloadUrl: "/gast/download?filename=x.zip" });
    });
    await assert.rejects(pegelonline.history("1", ...day), notBlocked);
    await assert.rejects(pegelonline.history("2", ...day), notBlocked);
    await assert.rejects(pegelonline.history("3", ...day), Blocked);
    assert.equal(prepared, 3);
  });

  it("prepares again when a prepared file isn't a readable zip", async () => {
    const zip = readFileSync(new URL("fixtures/pegelonline-download.zip", import.meta.url));
    const prepared: number[] = [];
    let downloads = 0;
    setTransport(async (url) => {
      if (/stations\/\d+\.json/.test(url)) return JSON.stringify({ uuid: "aad49293" });
      // Two of every three files come back broken.
      if (/gast\/download\?/.test(url))
        return ++downloads % 3 ? btoa("not a zip") : zip.toString("base64");
      prepared.push(Date.now());
      return JSON.stringify({ downloadUrl: `/gast/download?filename=${prepared.length}.zip` });
    });
    pegelonline.pacing.restMs = 50;
    for (const id of ["1", "2"]) await pegelonline.history(id, ...day);
    assert.equal(prepared.length, 6);
    // Each prepares again only after a rest.
    assert.ok(prepared[1]! - prepared[0]! >= 45, `${prepared[1]! - prepared[0]!} ms apart`);
  });

  it("doesn't take a file that isn't a zip as a download that ended a run of refusals", async () => {
    let prepared = 0;
    setTransport(async (url) => {
      if (/stations\/\d+\.json/.test(url)) return JSON.stringify({ uuid: "aad49293" });
      if (/gast\/download\?/.test(url)) return btoa("not a zip");
      // Stations 1, 2 and 4 are refused; station 3's files come back broken.
      if (++prepared <= 2 || prepared > 5) throw new Error(`POST ${url} returned 503`);
      return JSON.stringify({ downloadUrl: `/gast/download?filename=${prepared}.zip` });
    });
    await assert.rejects(pegelonline.history("1", ...day), notBlocked);
    await assert.rejects(pegelonline.history("2", ...day), notBlocked);
    await assert.rejects(pegelonline.history("3", ...day), /not a zip/);
    await assert.rejects(pegelonline.history("4", ...day), Blocked);
  });

  it("rests at least restMs after a quick download", async () => {
    const zip = readFileSync(new URL("fixtures/pegelonline-download.zip", import.meta.url));
    const prepared: number[] = [];
    setTransport(async (url) => {
      if (/stations\/\d+\.json/.test(url)) return JSON.stringify({ uuid: "aad49293" });
      if (/gast\/download\?/.test(url)) return zip.toString("base64");
      prepared.push(Date.now());
      return JSON.stringify({ downloadUrl: "/gast/download?filename=x.zip" });
    });
    pegelonline.pacing.restMs = 100;
    await Promise.all([pegelonline.history("1", ...day), pegelonline.history("2", ...day)]);
    assert.ok(prepared[1]! - prepared[0]! >= 95, `${prepared[1]! - prepared[0]!} ms apart`);
  });

  it("stops when the site asks to wait longer than maxHoldMs", async () => {
    refusing(["429 (retry after 3600 s)"]);
    await assert.rejects(pegelonline.history("1", ...day), /asked to wait 3600 s/);
    await assert.rejects(pegelonline.history("2", ...day), Blocked);
  });

  it("holds the next download as long as a Retry-After the HTTP layer wouldn't wait", async () => {
    const zip = readFileSync(new URL("fixtures/pegelonline-download.zip", import.meta.url));
    const asked: number[] = [];
    setTransport(async (url) => {
      if (/stations\/5990020\.json/.test(url)) return JSON.stringify({ uuid: "aad49293" });
      if (/gast\/download\?/.test(url)) return zip.toString("base64");
      asked.push(Date.now());
      // http.ts throws at once on a Retry-After over a minute; one second keeps the test short.
      if (asked.length === 1) throw new Error(`POST ${url} returned 429 (retry after 1 s)`);
      return JSON.stringify({ downloadUrl: "/gast/download?filename=x.zip" });
    });
    const day = [new Date("2010-10-31T00:00:00Z"), new Date("2010-10-31T01:00:00Z")] as const;
    await assert.rejects(pegelonline.history("5990020", ...day));
    await pegelonline.history("5990020", ...day);
    assert.ok(asked[1]! - asked[0]! >= 950, `${asked[1]! - asked[0]!} ms apart`);
  });

  it("queues the station lookup with the downloads", async () => {
    const zip = readFileSync(new URL("fixtures/pegelonline-download.zip", import.meta.url));
    const looked: number[] = [];
    setTransport(async (url) => {
      if (/stations\/5990020\.json/.test(url)) {
        looked.push(Date.now());
        return JSON.stringify({ uuid: "aad49293" });
      }
      if (/gast\/download\?/.test(url)) return zip.toString("base64");
      return JSON.stringify({ downloadUrl: "/gast/download?filename=x.zip" });
    });
    pegelonline.pacing.restMs = 60;
    const day = [new Date("2010-10-31T00:00:00Z"), new Date("2010-10-31T01:00:00Z")] as const;
    await Promise.all([
      pegelonline.history("5990020", ...day),
      pegelonline.history("5990020", ...day),
    ]);
    assert.ok(looked[1]! - looked[0]! >= 55, `${looked[1]! - looked[0]!} ms apart`);
  });

  it("takes old ranges from the download and recent ones from the REST API", async () => {
    serveDownload([]);
    const station = {
      source_id: "5990020",
      datum: "PNP",
      history_since: "2000-01-01",
    } as unknown as Station;
    const old = await pegelonline.source.observations!(
      station,
      new Date("2010-10-31T00:00:00Z"),
      new Date("2010-10-31T01:00:00Z"),
    );
    assert.equal(old.length, 60);
    // Nothing before the first downloadable day, and nothing where there's no history.
    const hour = [new Date("2010-10-31T00:00:00Z"), new Date("2010-10-31T01:00:00Z")] as const;
    const later = { ...station, history_since: "2011-01-01" } as Station;
    assert.deepEqual(await pegelonline.source.observations!(later, ...hour), []);
    const none = { ...station, history_since: null } as unknown as Station;
    assert.deepEqual(await pegelonline.source.observations!(none, ...hour), []);
    // Unknown until a refresh has asked, which also records the gauge zero's validFrom.
    const unknown = { source_id: "5990020", datum: "PNP" } as Station;
    await assert.rejects(
      pegelonline.source.observations!(unknown, ...hour),
      /run ingest stations first/,
    );
    const now = Date.now();
    // The REST API isn't served, so a recent range reaching it fails.
    await assert.rejects(
      pegelonline.source.observations!(station, new Date(now - 3_600_000), new Date(now)),
      /measurements\.json.*returned 404/,
    );
  });

  it("reads each station's first downloadable day from the download dialog", async () => {
    const modal = fixture("pegelonline-modal.html");
    serve([[/download\/modal/, modal]]);
    assert.equal(await pegelonline.historySince("aad49293"), "2000-01-01");
    // A rolling 31 days, as at Hamburg Port Authority's gauges, is no history.
    serve([[/download\/modal/, modal.replaceAll("2000-01-01", "2026-10-05")]]);
    assert.equal(await pegelonline.historySince("aad49293"), null);
    // A new gauge's 45 days is history.
    serve([[/download\/modal/, modal.replaceAll("2000-01-01", "2026-09-21")]]);
    assert.equal(await pegelonline.historySince("aad49293"), "2026-09-21");
    setTransport(async (url) => {
      throw new Error(`GET ${url} returned 400`);
    });
    assert.equal(await pegelonline.historySince("aad49293"), null);
  });

  it("lists each station's history_since, keeping one it already has", async () => {
    let asked = 0;
    serve([
      [/stations\.json/, fixture("pegelonline-stations.json")],
      [
        /download\/modal/,
        () => {
          asked++;
          return fixture("pegelonline-modal.html");
        },
      ],
    ]);
    const listed = await pegelonline.stations([
      { id: "pegelonline/5990020", history_since: "2001-01-01" } as unknown as Station,
    ]);
    assert.equal(listed.find((s) => s.source_id === "5990020")!.history_since, "2001-01-01");
    assert.equal(listed.find((s) => s.source_id !== "5990020")!.history_since, "2000-01-01");
    assert.equal(asked, 1);
  });

  it("stops asking for history_since after five failures", async () => {
    const [first] = JSON.parse(fixture("pegelonline-stations.json"));
    const many = Array.from({ length: 8 }, (_, i) => ({ ...first, number: String(i) }));
    let asked = 0;
    serve([
      [/stations\.json/, JSON.stringify(many)],
      [
        /download\/modal/,
        () => {
          asked++;
          throw new Error("GET modal returned 503");
        },
      ],
    ]);
    const listed = await pegelonline.stations();
    assert.equal(listed.length, 8);
    assert.ok(listed.every((s) => !("history_since" in s)));
    assert.equal(asked, 5);
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
  coops.pacing.dataMs = 0;
  coops.pacing.blockedMs = 0;

  describe("data API pacing", () => {
    const realFetch = globalThis.fetch;
    // The last two hours at a live station: one water_level request, no metadata.
    const lastHours = (id: string) => {
      const end = new Date(Math.floor(Date.now() / 60_000) * 60_000);
      return coops.levels(id, new Date(end.getTime() - 2 * 3_600_000), end, { live: true });
    };
    const empty = () => new Response(JSON.stringify({ data: [] }));
    afterEach(() => {
      globalThis.fetch = realFetch;
      coops.pacing.dataMs = 0;
      coops.pacing.blockedMs = 0;
      coops.resetPacing();
    });

    it("spaces data requests that go out", async () => {
      const times: number[] = [];
      globalThis.fetch = (async () => {
        times.push(Date.now());
        return empty();
      }) as typeof fetch;
      setTransport(fetchText);
      coops.pacing.dataMs = 50;
      await Promise.all([lastHours("1"), lastHours("2")]);
      assert.ok(times.length >= 2);
      assert.ok(times[1]! - times[0]! >= 45, `${times[1]! - times[0]!} ms apart`);
    });

    it("waits out a 403 and carries on once it lifts", async () => {
      let calls = 0;
      globalThis.fetch = (async () =>
        ++calls === 1 ? new Response("Forbidden", { status: 403 }) : empty()) as typeof fetch;
      setTransport(fetchText);
      coops.pacing.blockedMs = 10;
      assert.deepEqual(await lastHours("1"), []);
      assert.ok(calls >= 2);
    });

    it("stops sending requests once a block outlasts its waits", async () => {
      let calls = 0;
      globalThis.fetch = (async () => {
        calls++;
        return new Response("Forbidden", { status: 403 });
      }) as typeof fetch;
      setTransport(fetchText);
      coops.pacing.blockedMs = 5;
      // Each station's request is tried three times; the third station's
      // first try is the third hold in a row.
      await assert.rejects(lastHours("1"), (error) => !(error instanceof Blocked));
      await assert.rejects(lastHours("2"), (error) => !(error instanceof Blocked));
      await assert.rejects(lastHours("3"), Blocked);
      assert.equal(calls, 7);
      // Every data request after it fails at once, without going out.
      await assert.rejects(lastHours("2"), Blocked);
      const end = new Date(Math.floor(Date.now() / 60_000) * 60_000);
      const start = new Date(end.getTime() - 3_600_000);
      await assert.rejects(coops.extremes("2", start, end, { live: true }), Blocked);
      assert.equal(calls, 7);
    });

    it("holds twice as long after a second refusal", async () => {
      const times: number[] = [];
      globalThis.fetch = (async () => {
        times.push(Date.now());
        return times.length <= 4 ? new Response("Forbidden", { status: 403 }) : empty();
      }) as typeof fetch;
      setTransport(fetchText);
      coops.pacing.blockedMs = 40;
      // The first station's three tries, then the second station's first try
      // is the second hold, and its retry waits that out.
      await assert.rejects(lastHours("1"));
      assert.deepEqual(await lastHours("2"), []);
      const gaps = times.slice(1).map((t, i) => t - times[i]!);
      assert.ok(gaps[0]! >= 35 && gaps[0]! < 75, `first hold ${gaps}`);
      assert.ok(gaps[3]! >= 75, `second hold ${gaps}`);
    });

    it("holds every data request while a 403's hold lasts", async () => {
      const times: number[] = [];
      globalThis.fetch = (async () => {
        times.push(Date.now());
        return times.length === 1 ? new Response("Forbidden", { status: 403 }) : empty();
      }) as typeof fetch;
      setTransport(fetchText);
      // Spaced, so the others are waiting for their slots when the 403 comes back.
      coops.pacing.dataMs = 20;
      coops.pacing.blockedMs = 60;
      await Promise.all([lastHours("1"), lastHours("2"), lastHours("3")]);
      // The first request went out, was refused, and nothing went out until its hold ended.
      assert.ok(
        times.slice(1).every((t) => t - times[0]! >= 55),
        `${times.map((t) => t - times[0]!)}`,
      );
    });

    it("fails a URL refused on its own without stopping the rest", async () => {
      globalThis.fetch = (async (url: string) =>
        String(url).includes("station=bad")
          ? new Response("Forbidden", { status: 403 })
          : empty()) as typeof fetch;
      setTransport(fetchText);
      coops.pacing.blockedMs = 5;
      // Other stations' answers between its tries keep the count from building.
      const bad = lastHours("bad");
      const good = (async () => {
        for (let i = 0; i < 20; i++) await lastHours(`good${i}`);
      })();
      await assert.rejects(
        bad,
        (error) => !(error instanceof Blocked) && /403/.test(String(error)),
      );
      await good;
      assert.deepEqual(await lastHours("after"), []);
    });

    it("fails a refused metadata request alone, and data requests carry on", async () => {
      globalThis.fetch = (async (url: string) =>
        String(url).includes("/mdapi/")
          ? new Response("Forbidden", { status: 403 })
          : empty()) as typeof fetch;
      setTransport(fetchText);
      coops.pacing.blockedMs = 5;
      // A station without dates looks them up in the metadata API.
      await assert.rejects(
        coops.levels("9", new Date(Date.UTC(2020, 0)), new Date(Date.UTC(2020, 1))),
        (error) => !(error instanceof Blocked) && /403/.test(String(error)),
      );
      assert.deepEqual(await lastHours("1"), []);
    });

    it("counts 403s for requests already in flight as one hold", async () => {
      let calls = 0;
      globalThis.fetch = (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return ++calls <= 3 ? new Response("Forbidden", { status: 403 }) : empty();
      }) as typeof fetch;
      setTransport(fetchText);
      coops.pacing.blockedMs = 10;
      // All three go out before the first 403 comes back.
      await Promise.all([lastHours("1"), lastHours("2"), lastHours("3")]);
    });

    it("doesn't take a cached answer as a sign a block has lifted", async () => {
      globalThis.fetch = (async () => new Response("Forbidden", { status: 403 })) as typeof fetch;
      // Months already in the disk cache answer without going out.
      setTransport((url, options) =>
        url.includes("station=cached")
          ? Promise.resolve(JSON.stringify({ data: [] }))
          : fetchText(url, options),
      );
      coops.pacing.blockedMs = 5;
      let stop = false;
      const cached = (async () => {
        while (!stop) {
          await lastHours("cached");
          // Cache hits never wait on a timer; let the hold's timers run.
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      })();
      try {
        await assert.rejects(lastHours("live1"), (error) => !(error instanceof Blocked));
        await assert.rejects(lastHours("live2"), (error) => !(error instanceof Blocked));
        await assert.rejects(lastHours("live3"), Blocked);
      } finally {
        stop = true;
      }
      await cached.catch(() => undefined);
    });
  });
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
    // Each zero date names the reference, so a new one opens a datum epoch.
    const reference = (id: string) => listed.find((s) => s.id === id)!.reference;
    assert.deepEqual(reference("usace/MVN.Donaldsonville"), {
      id: "1988-06-15",
      since: "1988-06-15",
    });
    assert.deepEqual(reference("usace/MVN.Reserve"), { id: "original", since: null });
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

  it("enters every hand-entered zero date as a day", () => {
    // The lake's lists keep these too, but a date dropped here would no longer
    // bound a station read from stations.parquet, which doesn't carry them.
    assert.equal(Object.keys(ZERO_SINCE).length, 33);
    for (const [id, { since }] of Object.entries(ZERO_SINCE)) {
      assert.match(since, /^\d{4}-\d{2}-\d{2}$/, id);
      assert.ok(Number.isFinite(Date.parse(since)), id);
    }
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

describe("usgs", () => {
  usgs.pacing.requestMs = 0;
  usgs.pacing.blockedMs = 0;
  const series = (site: string, parameter: string, fields: object = {}) => ({
    type: "Feature",
    id: `${site}-${parameter}`,
    properties: {
      id: `${site}-${parameter}`,
      monitoring_location_id: `USGS-${site}`,
      parameter_code: parameter,
      statistic_id: "00011",
      begin: "2014-06-04T04:00:00+00:00",
      end: new Date().toISOString(),
      sublocation_identifier: null,
      primary: "Primary",
      unit_of_measure: "ft",
      ...fields,
    },
    geometry: null,
  });
  const location = (site: string, lon: number, lat: number, fields: object) => ({
    type: "Feature",
    id: `USGS-${site}`,
    properties: {
      id: `USGS-${site}`,
      monitoring_location_name: site,
      agency_code: "USGS",
      site_type_code: "ST",
      state_name: "Georgia",
      country_code: "US",
      hydrologic_unit_code: "03060109",
      altitude: null,
      vertical_datum: null,
      ...fields,
    },
    geometry: { type: "Point", coordinates: [lon, lat] },
  });
  const collection = (features: object[], next?: string) =>
    JSON.stringify({
      type: "FeatureCollection",
      features,
      numberReturned: features.length,
      links: next ? [{ rel: "next", type: "application/geo+json", href: next }] : [],
    });

  it("lists every site with a water-level series, in gage datum where there's gage height", async () => {
    serve([
      [
        /parameter_code=00065/,
        collection([
          series("02198820", "00065"),
          series("07010000", "00065", { begin: "2001-10-01T07:00:00+00:00" }),
          // Olmsted's tailwater began later; the headwater is the longer record.
          series("03612600", "00065", {
            id: "tail",
            sublocation_identifier: "TAILWATER",
            begin: "2023-04-12T23:00:00+00:00",
          }),
          series("03612600", "00065", {
            id: "head",
            sublocation_identifier: "HEADWATER",
            begin: "2013-03-02T06:00:00+00:00",
          }),
          // A daily mean isn't an instantaneous series.
          series("06934500", "00065", { statistic_id: "00003" }),
          series("06934500", "00065", { end: "2001-01-01T00:00:00+00:00" }),
          series("02171645", "00065", { statistic_id: null }),
          // At a site with two primary series, the one still reporting wins.
          series("07022000", "00065", { id: "ended", end: "2012-01-01T00:00:00+00:00" }),
          series("07022000", "00065", { id: "current", begin: "2012-01-01T00:00:00+00:00" }),
          // Within the year, one reporting now beats an earlier one that stopped a month ago.
          series("07020500", "00065", {
            id: "stopped",
            begin: "2007-10-01T00:00:00+00:00",
            end: new Date(Date.now() - 30 * 86_400_000).toISOString(),
          }),
          series("07020500", "00065", { id: "replacement", begin: "2026-10-01T00:00:00+00:00" }),
        ]),
      ],
      [/parameter_code=62620/, collection([series("0158540095", "62620")])],
      [/parameter_code=63160/, collection([series("02198820", "63160")])],
      [/parameter_code=/, collection([series("02198820", "72279", { unit_of_measure: "m" })])],
      [
        /statistic_id=00021/,
        collection([
          {
            type: "Feature",
            properties: { monitoring_location_id: "USGS-02171645" },
            geometry: null,
          },
        ]),
      ],
      [
        /monitoring-locations/,
        collection([
          location("02198820", -81.15, 32.25, {
            site_type_code: "ST-TS",
            altitude: 0,
            vertical_datum: "NAVD88",
          }),
          location("07010000", -90.18, 38.63, {
            hydrologic_unit_code: "07140101",
            altitude: 379.58,
            vertical_datum: "NAVD88",
            state_name: "Missouri",
          }),
          location("03612600", -89.06, 37.17, {
            hydrologic_unit_code: "05140206",
            altitude: 270,
            vertical_datum: "NGVD29",
          }),
          // The Missouri at Hermann, outside the Mississippi and Ohio basins, is listed too.
          location("06934500", -91.44, 38.71, {
            hydrologic_unit_code: "10300200",
            altitude: 481.6,
            vertical_datum: "NAVD88",
          }),
          location("0158540095", -76.4, 39.2, { site_type_code: "ES" }),
          location("02171645", -80.0, 33.2, { state_name: "Puerto Rico" }),
          location("07022000", -89.5, 37.0, { hydrologic_unit_code: "07140105" }),
          location("07020500", -89.8, 37.6, { hydrologic_unit_code: "07140105" }),
        ]),
      ],
    ]);
    const list = await usgs.stations();
    assert.deepEqual(
      list.map((s) => [s.id, s.kind, s.datum, s.datums, s.time_series_id, s.live, s.country_code]),
      [
        ["usgs/0158540095", "estuary", "NAVD88", {}, "0158540095-62620", true, "US"],
        // Daily tidal highs and lows mark a stream as tidal.
        ["usgs/02171645", "estuary", "GAGE", {}, "02171645-00065", true, "PR"],
        // Gage height is preferred to an elevation series at the same site.
        ["usgs/02198820", "estuary", "GAGE", { NAVD88: 0 }, "02198820-00065", true, "US"],
        ["usgs/03612600", "river", "GAGE", { NGVD29: 82.296 }, "head", true, "US"],
        // Its gage height ended in 2001; a station still, just not live.
        ["usgs/06934500", "river", "GAGE", { NAVD88: 146.792 }, "06934500-00065", false, "US"],
        ["usgs/07010000", "river", "GAGE", { NAVD88: 115.696 }, "07010000-00065", true, "US"],
        ["usgs/07020500", "river", "GAGE", {}, "replacement", true, "US"],
        ["usgs/07022000", "river", "GAGE", {}, "current", true, "US"],
      ],
    );
    assert.equal(
      list[0]!.source_url,
      "https://waterdata.usgs.gov/monitoring-location/USGS-0158540095/",
    );
  });

  it("takes a station's kind from USGS's own site type and tidal series, not from its basin or altitude", () => {
    const kind = (site_type_code: string, tidal = false) => usgs.kindOf({ site_type_code }, tidal);
    assert.deepEqual(
      [kind("OC"), kind("OC-CO"), kind("ES"), kind("ST-TS"), kind("ST", true)],
      ["coastal", "coastal", "estuary", "estuary", "estuary"],
    );
    assert.deepEqual([kind("LK"), kind("WE")], ["lake", "lake"]);
    assert.deepEqual(
      [kind("ST"), kind("ST-CA"), kind("ST-DCH"), kind("SP"), kind("FA-DV")],
      ["river", "river", "river", "river", "river"],
    );
  });

  it("spaces requests that go out, but not cache hits", async () => {
    const realFetch = globalThis.fetch;
    const times: number[] = [];
    globalThis.fetch = (async () => {
      times.push(Date.now());
      return new Response(collection([]));
    }) as typeof fetch;
    usgs.pacing.requestMs = 50;
    try {
      setTransport(fetchText);
      const year = (y: number) =>
        usgs.levels("x", new Date(Date.UTC(y, 0)), new Date(Date.UTC(y, 1)));
      await Promise.all([year(2020), year(2021)]);
      assert.equal(times.length, 2);
      assert.ok(times[1]! - times[0]! >= 45, `${times[1]! - times[0]!} ms apart`);
      // A cached answer never reaches the pace.
      setTransport(async () => collection([]));
      const started = Date.now();
      await Promise.all([year(2022), year(2023), year(2024)]);
      assert.ok(Date.now() - started < 45);
    } finally {
      globalThis.fetch = realFetch;
      usgs.pacing.requestMs = 0;
    }
  });

  it("refuses an answer that would drop stations", async () => {
    serve([[/time-series-metadata/, collection([])]]);
    await assert.rejects(usgs.stations(), /listed no 00065 series/);
    serve([
      [/parameter_code=/, collection([series("02198820", "00065")])],
      [/statistic_id=00021/, collection([])],
    ]);
    await assert.rejects(usgs.stations(), /no daily tidal statistics/);
    const tidal = {
      type: "Feature",
      properties: { monitoring_location_id: "USGS-x" },
      geometry: null,
    };
    serve([
      [/parameter_code=/, collection([series("02198820", "00065"), series("07010000", "00065")])],
      [/statistic_id=00021/, collection([tidal])],
      [/monitoring-locations/, collection([location("02198820", -81.15, 32.25, {})])],
    ]);
    await assert.rejects(usgs.stations(), /no monitoring location for 1 sites, e.g. USGS-07010000/);
    // A site a short answer left out is asked for again.
    let asked = 0;
    setTransport(async (url) => {
      if (/statistic_id=00021/.test(url)) return collection([tidal]);
      if (/parameter_code=/.test(url))
        return collection([series("02198820", "00065"), series("07010000", "00065")]);
      return collection(
        ++asked === 1
          ? [location("02198820", -81.15, 32.25, { site_type_code: "ES" })]
          : [location("07010000", -90.18, 38.63, { hydrologic_unit_code: "07140101" })],
      );
    });
    assert.deepEqual(
      (await usgs.stations()).map((s) => s.source_id),
      ["02198820", "07010000"],
    );
  });

  it("takes a series that still reports over a preferred one that stopped years ago", () => {
    const stopped = series("01646500", "00065", { end: "2019-03-01T00:00:00+00:00" }).properties;
    const live = series("01646500", "62620").properties;
    assert.equal(usgs.choose([stopped, live]).get("USGS-01646500")!.parameter_code, "62620");
    // An outage of months doesn't.
    const paused = series("01646500", "00065", {
      end: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    }).properties;
    assert.equal(usgs.choose([paused, live]).get("USGS-01646500")!.parameter_code, "00065");
  });

  it("notices a station's series or gage zero changing under the same datum name", () => {
    const committed = {
      id: "usgs/03612600",
      datum: "GAGE",
      datums: { NAVD88: 84.774 },
      time_series_id: "head",
    } as never;
    const listed = (fields: object) =>
      ({ datum: "GAGE", datums: { NAVD88: 84.774 }, time_series_id: "head", ...fields }) as never;
    assert.equal(usgs.seriesChanged(committed, listed({})), null);
    assert.match(
      usgs.seriesChanged(committed, listed({ time_series_id: "tail" }))!,
      /series head is now tail/,
    );
    assert.match(
      usgs.seriesChanged(committed, listed({ datums: { NAVD88: 85.344 } }))!,
      /gage datum is now 85.344 m above NAVD88/,
    );
    // An offset to another vertical datum is new information, not a moved zero.
    assert.equal(
      usgs.seriesChanged(committed, listed({ datums: { NAVD88: 84.774, NGVD29: 85 } })),
      null,
    );
    // But a gage datum given only against another vertical datum may have moved.
    assert.match(
      usgs.seriesChanged(committed, listed({ datums: { NGVD29: 85 } }))!,
      /now given against NGVD29, not NAVD88/,
    );
    // A site that lists no altitude keeps its offsets.
    assert.equal(usgs.seriesChanged(committed, listed({ datums: {} })), null);
  });

  it("asks only for the years a station's series covers", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(new URL(url).searchParams.get("datetime")!);
      return collection([]);
    });
    const station = {
      id: "usgs/06934500",
      datum: "GAGE",
      time_series_id: "x",
      parameter_code: "00065",
      series_begin: "2014-06-04T04:00:00+00:00",
      series_end: "2016-03-01T00:00:00+00:00",
    } as never;
    const fetch = (from: number, to: number) =>
      usgs.source.observations!(station, new Date(Date.UTC(from, 0)), new Date(Date.UTC(to, 0)));
    await fetch(2007, 2027);
    assert.deepEqual(asked, [
      "2014-06-04T04:00:00.000Z/2015-01-01T00:00:00.000Z",
      "2015-01-01T00:00:00.000Z/2016-01-01T00:00:00.000Z",
      "2016-01-01T00:00:00.000Z/2016-03-01T00:00:00.001Z",
    ]);
    asked.length = 0;
    await fetch(2020, 2021);
    assert.deepEqual(asked, []);
  });

  it("caches a page only when every value on it is approved", () => {
    const page = (statuses: (string | null)[]) =>
      JSON.stringify(
        { features: statuses.map((approval_status) => ({ properties: { approval_status } })) },
        null,
        2,
      );
    assert.deepEqual(
      [
        page(["Approved"]),
        page(["Approved", "Provisional"]),
        page([]),
        // A value with no status, or one USGS adds later, isn't approved either.
        page(["Approved", null]),
        page(["Approved", "Working"]),
      ].map(usgs.approved),
      [true, false, false, false, false],
    );
  });

  it("sweeps every live station's recent values in one paged query per parameter", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(url);
      const v = (time_series_id: string, time: string, value: string) => ({
        type: "Feature",
        properties: {
          time_series_id,
          time,
          value,
          approval_status: "Provisional",
          qualifier: null,
        },
        geometry: null,
      });
      if (url.includes("cursor=")) return collection([v("b", "2026-11-04T00:15:00+00:00", "1.00")]);
      return collection(
        [
          v("a", "2026-11-04T00:00:00+00:00", "2.47"),
          v("unused", "2026-11-04T00:00:00+00:00", "9"),
        ],
        "https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?cursor=x&f=json",
      );
    });
    const station = (id: string, time_series_id: string, datum = "GAGE") =>
      ({ id, datum, time_series_id, parameter_code: "00065" }) as never;
    const swept = await usgs.recent(
      [station("usgs/a", "a"), station("usgs/b", "b"), station("usgs/bad", "c", "NAVD88")],
      new Date("2026-11-04T00:00:00Z"),
      new Date("2026-11-04T01:00:00Z"),
    );
    assert.deepEqual(
      [...swept].map(([id, rows]) => [
        id,
        rows instanceof Error ? rows.message : rows.map((r) => r.level),
      ]),
      [
        // Refused alone, without stopping the sweep.
        ["usgs/bad", "usgs/bad is in NAVD88; its USGS series is in GAGE"],
        ["usgs/a", [0.7529]],
        ["usgs/b", [0.3048]],
      ],
    );
    assert.equal(asked.length, 2);
    assert.match(asked[0]!, /parameter_code=00065/);
    assert.doesNotMatch(asked[0]!, /monitoring_location_id|time_series_id=/);
  });

  it("reads levels in meters across pages, with flags from approval and qualifiers", async () => {
    const value = (
      time: string,
      value: string | null,
      approval_status: string,
      qualifier: string[] | null = null,
    ) => ({
      type: "Feature",
      id: time,
      properties: { time, value, approval_status, qualifier },
      geometry: null,
    });
    const asked: string[] = [];
    const kept: boolean[] = [];
    setTransport(async (url, options) => {
      asked.push(url);
      const text = url.includes("cursor=")
        ? collection([
            value("2024-01-01T00:30:00+00:00", "-1.00", "Provisional"),
            value("2024-01-01T00:35:00+00:00", "1.00", "Approved", ["ESTIMATED"]),
            value("2024-01-01T00:45:00+00:00", "3.10", "Provisional", ["ICE"]),
            value("2024-01-01T00:50:00+00:00", "3.10", "Approved", ["SEASONAL", "BACKWATER"]),
            value("2024-01-01T01:00:00+00:00", "3.20", "Approved"),
          ])
        : collection(
            [
              value("2024-01-01T00:00:00+00:00", "2.47", "Approved"),
              value("2024-01-01T00:15:00+00:00", null, "Approved", ["EQUIP"]),
            ],
            "https://api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items?cursor=abc&f=json",
          );
      kept.push(options.keep!(text));
      return text;
    });
    const levels = await usgs.levels(
      "58253edd",
      new Date("2024-01-01T00:00:00Z"),
      new Date("2024-01-01T01:00:00Z"),
    );
    assert.deepEqual(
      levels.map((l) => [new Date(l.time).toISOString(), l.level, l.flag]),
      [
        ["2024-01-01T00:00:00.000Z", 0.7529, Flag.good],
        ["2024-01-01T00:30:00.000Z", -0.3048, Flag.preliminary],
        ["2024-01-01T00:35:00.000Z", 0.3048, Flag.interpolated],
        ["2024-01-01T00:45:00.000Z", 0.9449, Flag.suspect],
        ["2024-01-01T00:50:00.000Z", 0.9449, Flag.good],
      ],
    );
    // A page with provisional values isn't cached, since USGS will revise them.
    assert.deepEqual(kept, [true, false]);
    assert.match(asked[0]!, /time_series_id=58253edd/);
    assert.match(asked[0]!, /datetime=2024-01-01T00%3A00%3A00.000Z%2F2024-01-01T01%3A00%3A00.000Z/);
  });

  it("refuses a series with values measured from another datum", async () => {
    serve([
      [
        /continuous/,
        collection([
          {
            type: "Feature",
            properties: {
              time: "2024-01-01T00:40:00+00:00",
              value: "9.00",
              approval_status: "Provisional",
              qualifier: ["DIFFDATUM"],
            },
            geometry: null,
          },
        ]),
      ],
    ]);
    await assert.rejects(
      usgs.levels("x", new Date("2024-01-01T00:00:00Z"), new Date("2024-01-02T00:00:00Z")),
      /values in another datum \(DIFFDATUM\)/,
    );
  });

  it("fails the stations of a parameter the sweep found nothing for", async () => {
    setTransport(async (url) =>
      url.includes("parameter_code=62620")
        ? collection([])
        : collection([
            {
              type: "Feature",
              properties: {
                time_series_id: "a",
                time: "2026-11-04T00:00:00+00:00",
                value: "1.00",
                approval_status: "Provisional",
                qualifier: null,
              },
              geometry: null,
            },
          ]),
    );
    const swept = await usgs.recent(
      [
        { id: "usgs/a", datum: "GAGE", time_series_id: "a", parameter_code: "00065" } as never,
        { id: "usgs/b", datum: "NAVD88", time_series_id: "b", parameter_code: "62620" } as never,
      ],
      new Date("2026-11-04T00:00:00Z"),
      new Date("2026-11-04T01:00:00Z"),
    );
    assert.deepEqual(swept.get("usgs/a"), [
      { time: Date.UTC(2026, 10, 4), level: 0.3048, flag: Flag.preliminary },
    ]);
    assert.match(String(swept.get("usgs/b")), /returned no 62620 values/);
  });

  it("won't follow a next link off the API, since the key goes with it", async () => {
    serve([[/continuous/, collection([], "http://elsewhere.example/items?cursor=1")]]);
    await assert.rejects(
      usgs.levels("x", new Date("2024-01-01T00:00:00Z"), new Date("2024-01-02T00:00:00Z")),
      /off the API/,
    );
  });

  it("calls an empty sweep an outage", async () => {
    serve([[/continuous/, collection([])]]);
    const station = { id: "usgs/a", datum: "GAGE", time_series_id: "a", parameter_code: "00065" };
    await assert.rejects(
      usgs.recent(
        [station as never],
        new Date("2026-11-04T00:00:00Z"),
        new Date("2026-11-04T01:00:00Z"),
      ),
      /returned no values/,
    );
  });

  it("holds back a request already waiting for its slot when a 429 starts a block", async () => {
    const times: number[] = [];
    let calls = 0;
    setTransport(async (url, options) => {
      await options.pace?.();
      times.push(Date.now());
      if (++calls === 1) throw new Error(`GET ${url} returned 429`);
      return collection([]);
    });
    usgs.pacing.requestMs = 20;
    usgs.pacing.blockedMs = 200;
    try {
      const started = Date.now();
      const year = (y: number) =>
        usgs.levels("x", new Date(Date.UTC(y, 0)), new Date(Date.UTC(y, 1)));
      await Promise.all([year(2020), year(2021)]);
      // The second request took its slot before the 429 but waited out the block.
      assert.equal(times.length, 3);
      assert.ok(times[1]! - started >= 190, `second request ${times[1]! - started} ms in`);
    } finally {
      usgs.pacing.requestMs = 0;
      usgs.pacing.blockedMs = 0;
    }
  });

  it("holds every request while one waits out a short Retry-After", async () => {
    const times: number[] = [];
    let calls = 0;
    setTransport(async (url, options) => {
      await options.pace?.();
      times.push(Date.now());
      // As fetchText does on a 429 it retries itself.
      if (++calls === 1) {
        options.throttled?.(0.2);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return collection([]);
    });
    usgs.pacing.requestMs = 20;
    try {
      const started = Date.now();
      const year = (y: number) =>
        usgs.levels("x", new Date(Date.UTC(y, 0)), new Date(Date.UTC(y, 1)));
      await Promise.all([year(2020), year(2021)]);
      assert.ok(times[1]! - started >= 190, `second request ${times[1]! - started} ms in`);
    } finally {
      usgs.pacing.requestMs = 0;
    }
  });

  it("waits out a 429 and tries again", async () => {
    let calls = 0;
    setTransport(async (url) => {
      if (++calls === 1) throw new Error(`GET ${url} returned 429`);
      return collection([]);
    });
    assert.deepEqual(
      await usgs.levels("x", new Date("2024-01-01T00:00:00Z"), new Date("2024-01-02T00:00:00Z")),
      [],
    );
    assert.equal(calls, 2);
  });

  it("refuses a station committed in another datum than its series", async () => {
    const station = {
      id: "usgs/02198820",
      source_id: "02198820",
      datum: "NAVD88",
      time_series_id: "x",
      parameter_code: "00065",
    };
    await assert.rejects(
      async () => usgs.source.observations!(station as never, new Date(0), new Date(1)),
      /is in NAVD88; its USGS series is in GAGE/,
    );
  });
});
