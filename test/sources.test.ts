import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Blocked, fetchText, HttpError, setTransport } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as bsh from "../src/sources/bsh/index.ts";
import * as coops from "../src/sources/coops/index.ts";
import * as ea from "../src/sources/ea/index.ts";
import * as pegelonline from "../src/sources/pegelonline/index.ts";
import * as kuestendaten from "../src/sources/pegelonline/kuestendaten.ts";
import { sources } from "../src/sources/index.ts";
import * as refmar from "../src/sources/refmar/index.ts";
import * as rws from "../src/sources/rws/index.ts";
import * as uhslc from "../src/sources/uhslc/index.ts";
import { CONTRIBUTORS } from "../src/sources/uhslc/contributors.ts";
import {
  ALSO_WITHHELD,
  contributorOf,
  lostRefusals,
  NOTICES,
  noticeOf,
  originatorOf,
} from "../src/sources/uhslc/notices.ts";
import * as usace from "../src/sources/usace/index.ts";
import { describedDatums, isoDate } from "../src/sources/usace/described.ts";
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
    // RWS's description says K13a is a platform, at sea; it says nothing of the others' water.
    assert.deepEqual(
      stations.map((s) => s.kind),
      [null, null, "coastal", null],
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
    // The fourth fixture station has no position, so it isn't listed.
    assert.equal(stations.length, 3);
    const cuxhaven = stations.find((s) => s.source_id === "5990020")!;
    assert.equal(cuxhaven.id, "pegelonline/5990020");
    assert.equal(cuxhaven.datum, "PNP");
    assert.deepEqual(cuxhaven.datums, { NHN: -5.033 });
    // Its gauge zero is valid from 2019-11-01, a day left out of both epochs if it moves.
    assert.deepEqual(cuxhaven.reference, { id: "2019-11-01", since: "2019-11-02" });
    assert.equal(cuxhaven.interval_s, 60);
    assert.equal(cuxhaven.commercial_use, true);
    const inland = stations.find((s) => s.source_id === "27800090")!;
    assert.equal(inland.datum, "NN");
    assert.deepEqual(inland.datums, {});
    // Cuxhaven is on the Elbe, with the WSV's tidal values; Waltrop's canal says nothing; Konstanz is on the Bodensee.
    assert.deepEqual(
      stations.map((s) => [s.source_id, s.kind]),
      [
        ["27800090", null],
        ["5990020", "estuary"],
        ["906", "lake"],
      ],
    );
    assert.equal(
      pegelonline.kindOf({
        ...JSON.parse(fixture("pegelonline-stations.json"))[0],
        water: { shortname: "NORDSEE" },
      }),
      "coastal",
    );
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

  it("refuses a list without characteristic values, which would drop every estuary's kind", async () => {
    const stations = JSON.parse(fixture("pegelonline-stations.json")) as pegelonline.ApiStation[];
    for (const s of stations) for (const t of s.timeseries ?? []) delete t.characteristicValues;
    serve([[/stations\.json/, JSON.stringify(stations)]]);
    await assert.rejects(pegelonline.stations(), /no tidal characteristic values/);
    // Nor with the values there but none tidal.
    for (const s of stations)
      for (const t of s.timeseries ?? []) t.characteristicValues = [{ shortname: "MW" }];
    serve([[/stations\.json/, JSON.stringify(stations)]]);
    await assert.rejects(pegelonline.stations(), /no tidal characteristic values/);
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
      // Two of every three files come back broken: one not a zip, one an empty zip.
      if (/gast\/download\?/.test(url)) {
        const n = ++downloads % 3;
        if (n === 1) return btoa("not a zip");
        if (n === 2)
          return Buffer.from([0x50, 0x4b, 5, 6, ...new Array(18).fill(0)]).toString("base64");
        return zip.toString("base64");
      }
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
    assert.equal(listed.find((s) => s.source_id === "27800090")!.history_since, "2000-01-01");
    // Waltrop and Konstanz.
    assert.equal(asked, 2);
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

describe("pegelonline kuestendaten", () => {
  const zip = () =>
    readFileSync(new URL("fixtures/kuestendaten-5952050.zip", import.meta.url)).toString("base64");
  const hour = [new Date("2024-03-31T00:00:00Z"), new Date("2024-03-31T02:00:00Z")] as const;
  beforeEach(() => {
    kuestendaten.reset();
    kuestendaten.pacing.delayMs = 0;
  });

  it("reads HPA's history from kuestendaten.de, shifting UTC+1 to UTC", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(url);
      return zip();
    });
    const station = { source_id: "5952050", datum: "PNP", history_since: null };
    const rows = await pegelonline.source.observations!(station as unknown as Station, ...hour);
    // 02:00 UTC+1 is empty in the file, and summer time doesn't apply.
    assert.deepEqual(
      rows.map((r) => [new Date(r.time).toISOString().slice(11, 16), r.level, r.flag]),
      [
        ["00:58", 6.06, Flag.preliminary],
        ["00:59", 6.05, Flag.preliminary],
        ["01:01", 6.03, Flag.preliminary],
        ["01:02", 6.02, Flag.preliminary],
        ["01:03", 6.01, Flag.preliminary],
      ],
    );
    // Downloaded once, and from a range alone.
    const later = await kuestendaten.levels("5952050", new Date("2024-03-31T01:02:00Z"), hour[1]);
    assert.equal(later.length, 2);
    assert.equal(asked.length, 1);
    assert.match(asked[0]!, /wiski\/HAMBURG_ST\._PAULI!Wasserstand%20\(PNP\)\.zip$/);
  });

  it("refuses a file for another gauge, or with a status nobody has explained", async () => {
    setTransport(async () => zip());
    await assert.rejects(kuestendaten.levels("5952060", ...hour), /file is for 5952050/);
    const files = await pegelonline.unzip(zip());
    const [[name, text]] = [...files];
    const status = text!.replace("605\t240", "605\t200");
    // Not worth a zip writer: swap the parser's input for the edited text.
    const entry = new Map([[name!, () => new Blob([status]).stream()]]);
    await assert.rejects(
      kuestendaten.parseEntries(entry, "5952050"),
      /status 200 at 2024-03-31 01:59:00/,
    );
    const read = (text: string) =>
      kuestendaten.parseEntries(new Map([[name!, () => new Blob([text]).stream()]]), "5952050");
    // An empty value still carries its status.
    await assert.rejects(
      read(text!.replace("\t\t240", "\t\t200")),
      /status 200 at 2024-03-31 02:00/,
    );
    // A row missing between the rules, against the footer's count.
    await assert.rejects(read(text!.replace(/^2024-03-31 02:01.*\n/m, "")), /5 rows of 6/);
  });

  it("refuses another datum and asks nothing for a range before the files", async () => {
    setTransport(async () => assert.fail("no download"));
    await assert.rejects(kuestendaten.levels("5952050", ...hour, "NN"), /in PNP, not NN/);
    const old = [new Date("1990-01-01T00:00:00Z"), new Date("1999-01-01T00:00:00Z")] as const;
    assert.deepEqual(await kuestendaten.levels("5952050", ...old, "PNP"), []);
  });

  it("fails a gauge's every range after one failed download, and paces each attempt", async () => {
    let asked = 0;
    let paced = false;
    setTransport(async (_url, options) => {
      asked++;
      paced = typeof options.pace === "function";
      throw new Error("GET zip returned 404");
    });
    await assert.rejects(kuestendaten.levels("5952050", ...hour), /404/);
    await assert.rejects(kuestendaten.levels("5952050", ...hour), /404/);
    assert.equal(asked, 1);
    assert.ok(paced);
  });

  it("starts each request delayMs after the last", async () => {
    kuestendaten.pacing.delayMs = 50;
    const started: number[] = [];
    setTransport(async (_url, options) => {
      // Two attempts, as a retry would make.
      for (let i = 0; i < 2; i++) {
        await options.pace!();
        started.push(Date.now());
      }
      return zip();
    });
    await kuestendaten.levels("5952050", ...hour);
    assert.ok(started[1]! - started[0]! >= 45, `${started[1]! - started[0]!} ms apart`);
  });

  it("finds each gauge's file in the catalog, and fails on one it lacks", async () => {
    const entries = Object.entries(kuestendaten.GAUGES).map(([number, name]) => ({
      zipFileName: `${name}!Wasserstand (PNP).zip`,
      Messstellennummer: number,
      Zeitzone: "Mitteleuropäische Zeit (MEZ, engl. Central European Time, CET, UTC+1)",
      aufnahmeEnde: kuestendaten.BACKFILLED_TO,
      aktualisiert: "2026-10-19 05:20:17",
    }));
    let catalog = entries;
    setTransport(async (url) => {
      assert.match(url, /wiski\/WISKI_datenDownload\.json$/);
      return JSON.stringify(catalog);
    });
    assert.equal((await kuestendaten.catalog()).length, 6);
    catalog = entries.map((e) =>
      e.Messstellennummer === "5952060"
        ? { ...e, zipFileName: "SEEMANNSHOFT!Wasserstand (PNP).zip" }
        : e,
    );
    await assert.rejects(kuestendaten.catalog(), /for SEEMANNSHOEFT \(5952060\)$/);
    catalog = entries.map((e) =>
      e.Messstellennummer === "5952060" ? { ...e, Messstellennummer: "5952061" } : e,
    );
    await assert.rejects(kuestendaten.catalog(), /for SEEMANNSHOEFT \(5952060\)$/);
    catalog = entries.map((e) => ({ ...e, Zeitzone: "UTC" }));
    await assert.rejects(kuestendaten.catalog(), /BUNTHAUS \(5952020\), .* BLANKENESE_UF/);
  });

  it("says why the canary fails on files past the last backfill", async () => {
    const entries = Object.entries(kuestendaten.GAUGES).map(([number, name]) => ({
      zipFileName: `${name}!Wasserstand (PNP).zip`,
      Messstellennummer: number,
      Zeitzone: "Mitteleuropäische Zeit (MEZ, engl. Central European Time, CET, UTC+1)",
      aufnahmeEnde: kuestendaten.BACKFILLED_TO,
      aktualisiert: "2026-10-19 05:20:17",
    }));
    assert.equal(kuestendaten.update(entries), undefined);
    // Past any BACKFILLED_TO, so the test outlives each bump.
    entries[0]!.aufnahmeEnde = "9999-12-31 23:59:00";
    const note = kuestendaten.update(entries);
    assert.match(
      note!,
      /BUNTHAUS!Wasserstand \(PNP\)\.zip to 9999-12-31 23:59:00, published 2026-10-19/,
    );
    assert.match(note!, /issues\/125, then bump BACKFILLED_TO/);
    assert.match(note!, /Wait for HAMBURG-HARBURG!.*BLANKENESE_UF!Wasserstand \(PNP\)\.zip too/);
    for (const e of entries) e.aufnahmeEnde = "9999-12-31 23:59:00";
    assert.doesNotMatch(kuestendaten.update(entries)!, /Wait for/);
    // An end the catalog writes another way fails the check rather than miscompare.
    setTransport(async () =>
      JSON.stringify(entries.map((e) => ({ ...e, aufnahmeEnde: "31.12.2026" }))),
    );
    await assert.rejects(kuestendaten.catalog(), /with their end, for BUNTHAUS/);
    setTransport(async () => JSON.stringify({ entries }));
    await assert.rejects(kuestendaten.catalog(), /isn't a list/);
  });

  it("lists HPA's gauges with history from 1999-11-01 and HPA's credit", async () => {
    const [first] = JSON.parse(fixture("pegelonline-stations.json"));
    serve([
      [/stations\.json/, JSON.stringify([{ ...first, number: "5952050" }])],
      [/download\/modal/, fixture("pegelonline-modal.html").replaceAll("2000-01-01", "2026-10-09")],
    ]);
    const [listed] = await pegelonline.stations();
    assert.equal(listed!.history_since, "1999-11-01");
    assert.match(listed!.attribution, /PEGELONLINE; Hamburg Port Authority, .*kuestendaten\.de/);
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
            // CO-OPS's `greatlakes` misses this one, but its `tideType` says Great Lakes.
            station({
              id: "9075199",
              name: "Point Aux Frenes",
              state: "MI",
              tidal: false,
              greatlakes: false,
              tideType: "Great Lakes",
            }),
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
          DatumAnalysisPeriod: ["01/01/1983 - 12/31/2001"],
        }),
      ],
      [/9063020\/datums/, JSON.stringify({ datums: [{ name: "GL_LWD", value: 173.5 }] })],
      [/1495000\/datums/, JSON.stringify({ datums: null, LAT: null })],
      [/9075199\/datums/, JSON.stringify({ datums: null, LAT: null })],
    ]);
    const [esperanza, buffalo, frenes, seattle] = await coops.stations();
    assert.equal(frenes!.kind, "lake");
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
    assert.deepEqual((seattle as coops.CoopsStation).datums_period, {
      start: "1983-01-01",
      end: "2001-12-31",
    });
    // The Great Lakes have no tidal epoch.
    assert.equal((buffalo as coops.CoopsStation).datums_period, null);
    assert.deepEqual(
      [buffalo!.datums, buffalo!.products, buffalo!.kind],
      [{ IGLD: 0, LWD: -173.5 }, ["levels"], "lake"],
    );
    // Listed for its history, but not on the live network.
    assert.deepEqual(
      [esperanza!.live, esperanza!.status, esperanza!.datums],
      [false, "active", {}],
    );
    // A refresh that gets no datums keeps the offsets, so it keeps their period too.
    serve([
      [/type=historicwl/, JSON.stringify({ stations: [station({})] })],
      [/type=waterlevels/, JSON.stringify({ stations: [station({})] })],
      [/9447130\/datums/, JSON.stringify({ datums: null, LAT: null })],
    ]);
    const [again] = await coops.stations([seattle as unknown as Station]);
    assert.deepEqual((again as coops.CoopsStation).datums_period, {
      start: "1983-01-01",
      end: "2001-12-31",
    });
  });

  it("spans every datum analysis period CO-OPS gives", () => {
    assert.deepEqual(
      coops.periodOf([
        "05/01/1981 - 04/30/1983",
        "04/01/2004 - 03/31/2012",
        "01/01/2013 - 12/31/2017",
      ]),
      { start: "1981-05-01", end: "2017-12-31" },
    );
    assert.equal(coops.periodOf([]), null);
    // Anything but a span of real dates gives none, and never throws.
    assert.equal(coops.periodOf(["00/00/0000 - 13/45/2001"]), null);
    assert.equal(coops.periodOf([{ start: "1983-01-01" }]), null);
    assert.equal(coops.periodOf(null), null);
  });

  it("marks a value suspect for its limit flag only while it's preliminary or a high or low water", () => {
    // Verified 6-minute values keep L from an acquisition check whose limits are stale (erratum `coops-stale-limit-flag`).
    assert.equal(coops.flagOf({ f: "0,0,0,1", q: "v" }), Flag.good);
    assert.equal(coops.flagOf({ f: "0,0,0,1", q: "p" }), Flag.suspect);
    assert.equal(coops.flagOf({ f: "0,1,0,1", q: "v" }), Flag.suspect);
    assert.equal(coops.flagOf({ f: "0,0,1,0", q: "v" }), Flag.suspect);
    assert.equal(coops.flagOf({ f: "5,0,0,0", q: "v" }), Flag.good);
    // Only an explicit `v` counts as verified.
    assert.equal(coops.flagOf({ f: "0,0,0,1" }), Flag.suspect);
    // High and low waters keep L as suspect; I is interpolated.
    assert.equal(coops.flagOf({ f: "0,1" }), Flag.suspect);
    assert.equal(coops.flagOf({ f: "1,1" }), Flag.suspect);
    assert.equal(coops.flagOf({ f: "1,0" }), Flag.interpolated);
    // Hourly heights are verified, so their L is the same stale check.
    assert.equal(coops.flagOf({ f: "0,1" }, true), Flag.good);
    assert.equal(coops.flagOf({ f: "1,1" }, true), Flag.interpolated);
    assert.equal(coops.flagOf({ f: "1,0" }, true), Flag.interpolated);
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
            { t: "2024-01-01 00:24", v: "4.9", f: "0,0,0,1", q: "v" },
            { t: "2024-01-01 00:30", v: "4.95", f: "0,0,0,1", q: "p" },
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
        JSON.stringify({
          data: [
            { t: "1990-01-01 01:00", v: "5.084", f: "1,0" },
            { t: "1990-01-01 02:00", v: "5.1", f: "0,1" },
          ],
        }),
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
        // L alone on a verified value is erratum `coops-stale-limit-flag`; on a preliminary one it's still suspect.
        ["2024-01-01T00:24:00.000Z", 4.9, Flag.good],
        ["2024-01-01T00:30:00.000Z", 4.95, Flag.suspect],
      ],
    );
    const old = await coops.levels(
      "9447130",
      new Date("1990-01-01T00:00:00Z"),
      new Date("1990-01-02T00:00:00Z"),
    );
    assert.deepEqual(old, [
      { time: Date.UTC(1990, 0, 1, 1), level: 5.084, flag: Flag.interpolated },
      // L alone on an hourly height is erratum `coops-stale-limit-flag` too.
      { time: Date.UTC(1990, 0, 1, 2), level: 5.1, flag: Flag.good },
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
            { t: "2024-01-01 15:12", v: "5.4", ty: "HH", f: "0,1" },
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
      extremes.map((e) => [e.type, e.level, e.flag]),
      [
        ["high", 5.192, Flag.good],
        ["low", 2.709, Flag.good],
        // Unlike an hourly height, a high or low water keeps L as suspect.
        ["high", 5.4, Flag.suspect],
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
    // An outage month comes back empty, so the store keeps the 6-minute values it holds.
    assert.deepEqual([levels, asked], [[], ["water_level"]]);
  });

  it("asks for a leap year's high and low waters in two halves", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      const q = new URL(url).searchParams;
      asked.push(`${q.get("begin_date")}-${q.get("end_date")}`);
      return JSON.stringify({ data: [] });
    });
    const station = { established: "1899-01-01T00:00:00Z", removed: null };
    await coops.extremes("9461380", new Date("1944-01-01Z"), new Date("1946-01-01Z"), station);
    assert.deepEqual(asked, [
      "19440101 00:00-19440630 23:59",
      "19440701 00:00-19441231 23:59",
      "19450101 00:00-19451231 23:59",
    ]);
  });

  it('reads only "No data was found" as no data, and fails an answer with neither', async () => {
    const station = { established: "1899-01-01T00:00:00Z", removed: null };
    const span = [new Date("2010-05-01Z"), new Date("2010-06-01Z")] as const;
    setTransport(async () => JSON.stringify({ error: { message: "No data was found." } }));
    assert.deepEqual(await coops.levels("9447130", ...span, station), []);
    setTransport(async () => JSON.stringify({ metadata: { id: "9447130" } }));
    await assert.rejects(coops.levels("9447130", ...span, station), /no data in the answer/);
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
        // NAVD88 and LWRP come from the descriptions; CWMS's elevation of 0 is a blank.
        // Baton Rouge's LWRP offset is against another realization than its NAVD88 adjustment.
        [
          "usace/MVN.Baton_Rouge",
          "Baton_Rouge.Stage.Inst.1Hour.0.rev",
          "GZ",
          { NAVD88: -0.216 },
          3600,
          true,
          "river",
        ],
        [
          "usace/MVN.Donaldsonville",
          "Donaldsonville.Stage.Inst.1Hour.0.rev",
          "GZ",
          { NAVD88: -0.226, LWRP: -0.652 },
          3600,
          true,
          "river",
        ],
        // CWMS's local datum isn't one we can refer to; the description's NAVD88 is.
        [
          "usace/MVN.New_Orleans",
          "New_Orleans.Stage.Inst.1Hour.0.rev",
          "GZ",
          { NAVD88: -0.293, LWRP: -0.475 },
          3600,
          true,
          "river",
        ],
        [
          "usace/MVN.Reserve",
          "Reserve.Stage.Inst.1Hour.0.rev",
          "GZ",
          { NAVD88: -0.265, LWRP: -0.57 },
          3600,
          true,
          "river",
        ],
      ],
    );
    assert.deepEqual(mvn[0]!.datums_from, {
      NAVD88: {
        description: "Adjustment for vertical datum NAVD88 (OPUS 2019): -0.71 ft",
        realization: "OPUS 2019",
        as_of: null,
      },
    });
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

  it("takes a location's kind from CWMS's location kind and the district's type", () => {
    // Fields as CDA's catalog/LOCATIONS lists them.
    const kind = (name: string, kind: string, type?: string) => usace.kindOf({ name, kind, type });
    assert.deepEqual(
      [
        kind("Donaldsonville", "STREAM_LOCATION", "DCP"),
        kind("Danville", "SITE", "Stream"),
        kind("Cannelton", "SITE", "RoR Project"),
        kind("Somewhere", "SITE", "Streamgage"),
        // A lock and dam's tailwater CWMS calls a stream.
        kind("BellevilleLD-Tailwater", "STREAM_LOCATION"),
      ],
      ["river", "river", "river", "river", "river"],
    );
    assert.deepEqual(
      [
        kind("CaveRun", "PROJECT", "Corps Reservoir"),
        kind("SaltFk-Lake", "SITE", "Lake"),
        kind("Mark_Twain_Lk-Salt", "SITE", "Project"),
      ],
      ["lake", "lake", "lake"],
    );
    // A tailwater typed as its dam's reservoir, a pump station, and a gauge typed only "Gage".
    assert.deepEqual(
      [
        kind("Enid_Lake-Tailwater", "SITE", "RESERVOIR"),
        kind("Mark Twain Lk TW-Salt", "SITE", "Project"),
        kind("Sardis_TW", "SITE", "RESERVOIR"),
        kind("CalionPump-RS", "SITE"),
        kind("Adamsville", "SITE", "Gage"),
      ],
      [null, null, null, null, null],
    );
  });

  it("refers gauge zero to NGVD29 or NAVD88, whatever CWMS calls them", (t) => {
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
    const error = t.mock.method(console, "error", () => {});
    // Red River Landing's NGVD29 elevation is its NAVD88 correction, until CWMS changes it.
    const redRiver = {
      office: "MVN",
      name: "Red_River_Ldg",
      elevation: -0.27,
      unit: "ft",
      "vertical-datum": "NGVD29",
    };
    assert.deepEqual(usace.datumsOf(redRiver), { NAVD88: -0.082 });
    assert.deepEqual(usace.datumsOf({ ...redRiver, elevation: -0.3 }), { NGVD29: -0.091 });
    assert.deepEqual(usace.datumsOf({ ...redRiver, unit: "m" }), { NGVD29: -0.27 });
    assert.deepEqual(usace.datumsOf({ ...redRiver, elevation: 0 }), {});
    assert.deepEqual(usace.datumsOf({ ...redRiver, elevation: undefined }), {});
    assert.deepEqual(usace.datumsOf({ ...redRiver, elevation: -0.2700000001 }), { NAVD88: -0.082 });
    // Each change, including a dropped elevation, is reported for a person to check the entry.
    const said = error.mock.calls.map((c) => String(c.arguments[0]));
    for (const given of [
      "-0.3 ft NGVD29",
      "-0.27 m NGVD29",
      "0 ft NGVD29",
      "no elevation ft NGVD29",
    ])
      assert.ok(
        said.some((s) => s.includes(`MVN.Red_River_Ldg now gives ${given},`)),
        given,
      );
  });

  it("reads the NAVD88 adjustment and LWRP offset from a New Orleans description", () => {
    const read = (id: string, text: string) => {
      const { datums, notes } = describedDatums(id, text);
      return [
        datums,
        Object.fromEntries(Object.entries(notes).map(([k, n]) => [k, [n.realization, n.as_of]])),
      ];
    };
    // Morgan City: the stated adjustment, in feet, added to the stage.
    assert.deepEqual(
      read(
        "MVN.Morgan_City",
        "Natural flow is affected by tides.  Adjustment for vertical datum NAVD88 (OPUS 2021):  -1.403 ft. (e.g.add -1.403' to the gage reading to get to NAVD88)",
      ),
      [{ NAVD88: -0.428 }, { NAVD88: ["OPUS 2021", null] }],
    );
    // "Current adjustment … is", a misspelling, and a positive value.
    assert.deepEqual(
      read(
        "MVN.X",
        "Current adjsutment to NAVD88 2009.55 is 0.074' (e.g. add 0.074' to gage data)",
      ),
      [{ NAVD88: 0.023 }, { NAVD88: ["2009.55", null] }],
    );
    // Of several dated adjustments, the latest.
    assert.deepEqual(
      read(
        "MVN.SWPass_BHP",
        "Adjustment for vertical datum NAVD88 (OPUS 2022): -0.48 ft. as of 22Sep2022(e.g. for data relative to NAVD88 since 22Sep2022, subtract 0.48 ft)Adjustment for vertical datum NAVD88 (2009.55): 0.00 ft. as of 29Jun2015 Gage reset to vertical datum NAVD88 (2004.65) on 19Aug2010.",
      ),
      [{ NAVD88: -0.146 }, { NAVD88: ["OPUS 2022", "2022-09-22"] }],
    );
    // "Adjustment valid as of" after the example.
    assert.deepEqual(
      read(
        "MVN.Bayou_Boeuf-Amelia",
        "Adjustment for vertical datum NAVD88: -1.40' ft.(e.g. add -1.40' to gage data to adjust to NAVD88.) Adjustment valid as of 04/14/2025",
      ),
      [{ NAVD88: -0.427 }, { NAVD88: [null, "2025-04-14"] }],
    );
    // Several undated adjustments that differ, for different gages at one site: none.
    assert.deepEqual(
      read(
        "MVN.SaltWatBarrier_E",
        "For transmitted gage data, the adjustment to NAVD88 OPUS is -1.87'For the staffs recessed in the lock walls, the adjustment to NAVD88 OPUS is -2.11'",
      ),
      [{}, {}],
    );
    // A placeholder value, and an adjustment to another datum, aren't read.
    assert.deepEqual(read("MVN.X", "Adjustment for vertical datum NAVD88: -x.xx ft."), [{}, {}]);
    assert.deepEqual(
      read("MVN.X", "gage adjustment from NAVD88 (2004.65) to NGVD29 (1983) assumed to = 0.0'"),
      [{}, {}],
    );
    // A zero reset to NAVD88 before the station's ZERO_SINCE date is 0 there, plus LWRP.
    assert.ok(ZERO_SINCE["MVN.Venice"]!.since > "2015-06-28");
    assert.deepEqual(
      read(
        "MVN.Venice",
        "Gage zero reset to vertical datum NAVD88 (2009.55) on 28Jun2015. All prior historic stage data is relative to NGVD29.  To adjust the prior historic data (from 03Jun1987 to 28Jun2015 only) to NAVD88 (2009.55), add -1.84 feet.To adjust NAVD88 (2009.55) values to 2007 Low Water Reference Plane (LWRP) datum relative to NAVD88, add -0.1 ft.",
      ),
      [
        { NAVD88: 0, LWRP: -0.03 },
        { NAVD88: ["2009.55", "2015-06-28"], LWRP: ["2009.55", null] },
      ],
    );
    // Nor a reset other than the one ZERO_SINCE dates.
    assert.deepEqual(read("MVN.Venice", "Gage zero reset to NAVD88 (2004.65) on 19Aug2010."), [
      {},
      {},
    ]);
    // Not without a ZERO_SINCE date, which says every value read is on that zero.
    assert.deepEqual(read("MVN.X", "Gage zero reset to NAVD88 (2009.55) on 28Jun2015."), [{}, {}]);
    // Nor when the gauge has since diverged from it.
    assert.deepEqual(
      read(
        "MVN.Empire",
        "Gage reset to NAVD88 (2009.55) on 01Jul2015. Gage data from 26Sep18 to present diverged, so subtract 0.12 feet to adjust to NAVD88 (2009.55).",
      ),
      [{}, {}],
    );
    // An LWRP offset stated twice, as "add -0.5" and "subtract 0.5", is read once.
    assert.deepEqual(
      read(
        "MVN.IHNC_Lock",
        "Current adjustment from NAVD88 2004.65 to NAVD88 2009.55 is -0.22' (e.g. add -0.22' to gage data to adjust to NAVD88 2009.55).To adjust NAVD88 (2009.55) values to 2007 Low Water Reference Plane (LWRP) datum relative to NAVD88, add -0.5 ft. To adjust NAVD88 (2009.55) values to 2007 Low Water Reference Plane (LWRP) datum relative to NAVD88, subtract 0.5 ft.",
      ),
      [
        { NAVD88: -0.067, LWRP: -0.219 },
        { NAVD88: ["2009.55", null], LWRP: ["2009.55", null] },
      ],
    );
    // Adjustments that can't be told apart give none, and don't fall back on a reset.
    const reset = "Gage zero reset to vertical datum NAVD88 (2009.55) on 28Jun2015. ";
    assert.deepEqual(
      read(
        "MVN.Venice",
        reset +
          "the adjustment to NAVD88 OPUS is -1.87'. For the staffs, the adjustment to NAVD88 OPUS is -2.11'",
      ),
      [{}, {}],
    );
    assert.deepEqual(
      read(
        "MVN.X",
        "Adjustment for vertical datum NAVD88: -0.5 ft. as of 01Jan2020. Adjustment for vertical datum NAVD88: -0.6 ft. as of 01Jan2020",
      ),
      [{}, {}],
    );
    // One dated before the zero's reset is for the old zero.
    assert.deepEqual(
      read(
        "MVN.Venice",
        "Adjustment for vertical datum NAVD88 (2004.65): -0.8 ft. as of 01Jan2010",
      ),
      [{}, {}],
    );
    // Nor does one in meters fall back on a reset.
    assert.deepEqual(read("MVN.Venice", reset + "Gage adjustment to NAVD88 2009.55 = -0.30 m"), [
      {},
      {},
    ]);
    // An adjustment in meters isn't taken as feet.
    assert.deepEqual(read("MVN.X", "Gage adjustment to NAVD88 2009.55 = -0.30 m"), [{}, {}]);
    // An LWRP realization that isn't recognized can't be matched to the adjustment's.
    assert.deepEqual(
      read(
        "MVN.X",
        "Adjustment for vertical datum NAVD88 (OPUS2019 GEOID12B): -0.71 ft. To adjust NAVD88 (OPUS2010 GEOID09) values to 2007 Low Water Reference Plane (LWRP) datum relative to NAVD88, add -2.5ft.",
      ),
      [{ NAVD88: -0.216 }, { NAVD88: [null, null] }],
    );
    // Other districts' descriptions aren't read.
    assert.deepEqual(read("MVK.X", "Adjustment for vertical datum NAVD88: -0.5 ft."), [{}, {}]);
    // Red River Landing's description is Knox Landing's.
    const knox =
      "Adjustment for vertical datum NAVD88:  -0.08 ft. (add -0.08' to stage data to convert to NAVD88) To adjust NAVD88 values to 2007 Low Water Reference Plane (LWRP) datum relative to NAVD88, add -14.8'.";
    assert.deepEqual(read("MVN.Knox_Ldg", knox)[0], { NAVD88: -0.024, LWRP: -4.535 });
    assert.deepEqual(read("MVN.Red_River_Ldg", knox), [{}, {}]);
  });

  it("reads a description's dates", () => {
    assert.equal(isoDate("28Jun2015"), "2015-06-28");
    assert.equal(isoDate("01JUL2008"), "2008-07-01");
    assert.equal(isoDate("08 Aug 2022"), "2022-08-08");
    assert.equal(isoDate("26Sep18"), "2018-09-26");
    assert.equal(isoDate("14Jun88"), "1988-06-14");
    assert.equal(isoDate("01Jan27"), "2027-01-01");
    assert.equal(isoDate("10/11/2011"), "2011-10-11");
    assert.equal(isoDate("Nov. 22, 2021"), "2021-11-22");
    assert.equal(isoDate("Oct 15, 2008"), "2008-10-15");
    assert.equal(isoDate("31Feb2015"), null);
    assert.equal(isoDate("present"), null);
  });

  it("keeps where a stored offset came from when the description stops giving it, and says so", async (t) => {
    const entries = JSON.parse(fixture("usace-locations.json")).entries as usace.CatalogLocation[];
    serve([
      [/catalog\/TIMESERIES/, fixture("usace-catalog.json")],
      [
        /catalog\/LOCATIONS/,
        JSON.stringify({
          entries: entries.map((l) => (l.name === "New_Orleans" ? { ...l, description: " " } : l)),
        }),
      ],
    ]);
    const error = t.mock.method(console, "error", () => {});
    const note = { description: "…", realization: "2009.55", as_of: null };
    const from = { NAVD88: note, LWRP: note };
    const previous = ["usace/MVN.New_Orleans", "usace/MVN.Baton_Rouge"].map(
      (id) => ({ id, datums_from: from }) as unknown as Station,
    );
    const listed = (await usace.stations(previous)) as usace.UsaceStation[];
    const station = (id: string) => listed.find((s) => s.id === id)!;
    // New Orleans' description went blank: no offsets sent, so the stored ones and their notes stay.
    assert.deepEqual(station("usace/MVN.New_Orleans").datums, {});
    assert.deepEqual(station("usace/MVN.New_Orleans").datums_from, from);
    // Baton Rouge's still gives NAVD88 but not LWRP.
    assert.deepEqual(Object.keys(station("usace/MVN.Baton_Rouge").datums_from!), ["NAVD88"]);
    const said = error.mock.calls.map((c) => String(c.arguments[0])).join("\n");
    assert.match(said, /usace\/MVN.New_Orleans: its description no longer gives NAVD88, LWRP/);
    assert.match(said, /usace\/MVN.Baton_Rouge: its description no longer gives LWRP\n/);
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
    // The store's lists keep these too, but a date dropped here would no longer
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
      qualifier: (string | null)[] | null = null,
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
            value("2024-01-01T00:35:00+00:00", "1.00", "Approved", ["ESTIMATED", null]),
            value("2024-01-01T00:40:00+00:00", "2.00", "Approved", [null]),
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
        ["2024-01-01T00:40:00.000Z", 0.6096, Flag.good],
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
              qualifier: [null, "DIFFDATUM"],
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

describe("uhslc", () => {
  uhslc.pacing.requestMs = 0;

  it("lists each FD series with its latest RQ version, and the other versions apart", async () => {
    serve([
      [/global_hourly_rqds\.json/, fixture("uhslc-rq-stations.json")],
      [/global_hourly_fast\.json/, fixture("uhslc-fd-stations.json")],
      [/global_daily_rqds\.json/, fixture("uhslc-rq-spans.json")],
      [/global_daily_fast\.json/, fixture("uhslc-fd-spans.json")],
    ]);
    const stations = await uhslc.stations();
    assert.deepEqual(
      stations.map((s) => [s.id, s.version, s.reference, s.record_start, s.record_end]),
      [
        // Pohnpei's FD series carries version C; A and B have benchmarks of their own.
        ["uhslc/001", "C", { id: "C", since: "2001-12-16" }, "2001-12-17", null],
        ["uhslc/001a", "A", undefined, "1969-05-09", "1971-02-27"],
        ["uhslc/001b", "B", undefined, "1974-04-22", "2004-12-31"],
        // Abidjan has no FD series, so its one version stands alone.
        ["uhslc/230a", "A", undefined, "1982-01-01", "1988-12-31"],
        ["uhslc/329", "B", { id: "B", since: "1985-12-31" }, "1986-01-01", null],
        ["uhslc/329a", "A", undefined, "1962-01-01", "1985-12-30"],
        // Durban (181) is SANHO's, so it isn't listed.
      ],
    );
    const pohnpei = stations[0]!;
    assert.deepEqual(pohnpei.same_as, ["uhslc/001a", "uhslc/001b"]);
    assert.equal(pohnpei.country_code, "FM");
    assert.equal(stations.find((s) => s.id === "uhslc/230a")!.country_code, "CI");
    assert.equal(stations.find((s) => s.id === "uhslc/329")!.country_code, "HK");
    // Longitudes come as 0 to 360.
    assert.equal(stations.find((s) => s.id === "uhslc/230a")!.lon < 0, true);
    // Pohnpei's FD series carries version C, whose file points to BOM's
    // copyright notice; version A is Scripps's, with UHSLC's terms alone.
    assert.deepEqual(
      [pohnpei.contributor, pohnpei.commercial_use, pohnpei.attribution],
      [
        "National Tidal Centre, Bureau of Meteorology",
        false,
        "University of Hawaii Sea Level Center (UHSLC); Bureau of Meteorology, © Commonwealth of Australia",
      ],
    );
    const pohnpeiA = stations.find((s) => s.id === "uhslc/001a")!;
    assert.deepEqual(
      [pohnpeiA.contributor, pohnpeiA.commercial_use, pohnpeiA.attribution],
      ["Scripps Institute of Oceanography", true, "University of Hawaii Sea Level Center (UHSLC)"],
    );
  });

  it("withholds Walvis Bay, whose file carries SANHO's notice, and refuses to fetch it", async () => {
    const plus = (name: string, rows: unknown[][]) => {
      const body = JSON.parse(fixture(name));
      body.table.rows.push(...rows);
      return JSON.stringify(body);
    };
    const walvis = [220, "Walvis Bay", "Namibia", 516, -22.95, 14.5];
    serve([
      [
        /global_hourly_rqds\.json/,
        // Version B is one the scan hasn't read.
        plus("uhslc-rq-stations.json", [
          [220, "A", ...walvis.slice(1), "station zero"],
          [220, "B", ...walvis.slice(1), "station zero"],
        ]),
      ],
      [/global_hourly_fast\.json/, plus("uhslc-fd-stations.json", [[...walvis, "station zero"]])],
      [
        /global_daily_rqds\.json/,
        plus("uhslc-rq-spans.json", [
          [220, "A", "1959-01-01T12:00:00Z"],
          [220, "A", "2016-03-07T12:00:00Z"],
          [220, "B", "2017-01-01T12:00:00Z"],
          [220, "B", "2018-01-01T12:00:00Z"],
        ]),
      ],
      [
        /global_daily_fast\.json/,
        plus("uhslc-fd-spans.json", [
          [220, "1959-01-01T12:00:00Z"],
          [220, "2016-03-07T12:00:00Z"],
        ]),
      ],
    ]);
    const listed = await uhslc.stations();
    assert.deepEqual(
      listed.filter((s) => s.source_id.startsWith("220")),
      [],
    );
    // Its FD series and every version of its number, an unscanned one too.
    for (const id of ["220", "220a", "220b", "220f", "181a"])
      assert.match(uhslc.withheld(id) ?? "", /^South African Navy Hydrographic Office refused/);
    // Lüderitz's files name no contributor, but GESLA names SANHO, so ALSO_WITHHELD lists it.
    for (const id of ["702", "702a"])
      assert.match(uhslc.withheld(id) ?? "", /refused .*: GESLA names SANHO as originator/);
    for (const id of ["001", "329b"]) assert.equal(uhslc.withheld(id), null);
    for (const [number, { notice }] of Object.entries(ALSO_WITHHELD))
      assert.ok(NOTICES[notice]?.refused, `${number}'s notice ${notice} isn't a refusal`);
    // A withheld series the store still lists doesn't count toward a partial list.
    const five = ["101", "102", "103", "104", "105"].map((n) => ({
      ...listed[0]!,
      id: `uhslc/${n}`,
      source_id: n,
    }));
    const walvisBay = { ...listed[0]!, id: "uhslc/220", source_id: "220" };
    assert.equal((await uhslc.stations([...listed, ...five, walvisBay])).length, listed.length);
    await assert.rejects(
      uhslc.levels("220", new Date("2000-01-01Z"), new Date("2001-01-01Z")),
      /UHSLC 220 is withheld: South African Navy Hydrographic Office refused/,
    );
    await assert.rejects(
      uhslc.levels("220b", new Date("2017-01-01Z"), new Date("2018-01-01Z")),
      /UHSLC 220b is withheld/,
    );
  });

  it("names a station number a rescan would lose its refusal for", () => {
    const before = {
      "220a": { notice: "sanho" },
      "702a": { notice: null },
      "181a": { notice: "sanho" },
    };
    // UHSLC reworded 220A's notice, and dropped 181A for a 181B carrying it still.
    const after = {
      "220a": { notice: "unreviewed" },
      "702a": { notice: null },
      "181b": { notice: "sanho" },
    };
    assert.deepEqual(lostRefusals(before, after), ["220"]);
    assert.deepEqual(lostRefusals(before, before), []);
    // The scan as committed keeps every refusal it has.
    assert.deepEqual(lostRefusals(CONTRIBUTORS, CONTRIBUTORS), []);
  });

  it("takes a refusal over any other notice a file carries", () => {
    const flat =
      "Data supplied by the South Africa Navy Hydrographic Office; use allowed for non-commercial use";
    assert.equal(noticeOf(flat), "sanho");
    assert.equal(
      noticeOf("Use is allowed for non-commercial use. Creative Commons Attribution 4.0"),
      "dmi",
    );
    assert.equal(noticeOf("nothing here"), null);
  });

  it("reads millimeters as meters, RQ as good and FD as preliminary, skipping missing values", async () => {
    const urls: string[] = [];
    setTransport(async (url) => {
      urls.push(decodeURIComponent(url));
      return fixture("uhslc-fd-levels.json");
    });
    const levels = await uhslc.levels(
      "001",
      new Date("2021-12-31T21:00:00Z"),
      new Date("2022-01-01T03:00:00Z"),
    );
    assert.deepEqual(urls, [
      "https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_fast.json?time,sea_level,quality,reference_datum&uhslc_id=1&time>=2021-12-31T21:00:00.000Z&time<2022-01-01T00:00:00.000Z",
      "https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_fast.json?time,sea_level,quality,reference_datum&uhslc_id=1&time>=2022-01-01T00:00:00.000Z&time<2022-01-01T03:00:00.000Z",
    ]);
    const first = levels.slice(0, levels.length / 2);
    assert.deepEqual(first.at(0), {
      time: Date.parse("2021-12-31T21:00:00Z"),
      level: 0.51,
      flag: Flag.good,
    });
    assert.deepEqual(first.at(-1), {
      time: Date.parse("2022-01-01T02:00:00Z"),
      level: 1.519,
      flag: Flag.preliminary,
    });
  });

  it("moves Hong Kong's times an hour later, asking for the hour before", async () => {
    const urls: string[] = [];
    setTransport(async (url) => {
      urls.push(decodeURIComponent(url));
      return JSON.stringify({
        table: {
          columnNames: ["time", "sea_level", "quality", "reference_datum"],
          rows: [
            ["2024-12-31T23:00:00Z", null, 4, "station zero"],
            ["2025-01-01T00:00:00Z", 1080, 4, "station zero"],
          ],
        },
      });
    });
    const levels = await uhslc.levels(
      "329b",
      new Date("2025-01-01T00:00:00Z"),
      new Date("2025-01-01T02:00:00Z"),
    );
    assert.match(
      urls[0]!,
      /global_hourly_rqds.*version="B"&time>=2024-12-31T23:00:00.000Z&time<2025-01-01T01:00/,
    );
    assert.deepEqual(levels, [
      { time: Date.parse("2025-01-01T01:00:00Z"), level: 1.08, flag: Flag.good },
    ]);
  });

  it("asks only for the years a version has, and reads ERDDAP's 404 as no values", async () => {
    const urls: string[] = [];
    setTransport(async (url) => {
      urls.push(url);
      throw new HttpError(
        `GET ${url} returned 404`,
        'Error {\n    code=404;\n    message="Not Found: Your query produced no matching results. (nothing)";\n}\n',
      );
    });
    const levels = await uhslc.levels("230a", new Date("1970-01-01Z"), new Date("2000-01-01Z"), {
      record_start: "1982-01-01",
      record_end: "1988-12-31",
    });
    assert.deepEqual(levels, []);
    // 1981's last month through 1989's first.
    assert.equal(urls.length, 9);
  });

  it("fails on any other 404, such as a renamed dataset", async () => {
    setTransport(async (url) => {
      throw new HttpError(`GET ${url} returned 404`, "<html>Not Found</html>");
    });
    await assert.rejects(
      uhslc.levels("001", new Date("2020-01-01Z"), new Date("2020-01-02Z")),
      /returned 404/,
    );
  });

  it("refuses a list without record spans", async () => {
    const empty = JSON.stringify({ table: { columnNames: ["uhslc_id", "time"], rows: [] } });
    serve([
      [/global_hourly_rqds\.json/, fixture("uhslc-rq-stations.json")],
      [/global_hourly_fast\.json/, fixture("uhslc-fd-stations.json")],
      [/global_daily_rqds\.json/, empty],
      [/global_daily_fast\.json/, fixture("uhslc-fd-spans.json")],
    ]);
    await assert.rejects(uhslc.stations(), /research-quality stations and record spans disagree/);
  });

  it("keeps the strictest terms and every credit across a version change", async () => {
    // Pohnpei's FD series moves from version C (BOM's, non-commercial) to one
    // starting where B does (UHSLC's own, no notice).
    const fdSpans = JSON.parse(fixture("uhslc-fd-spans.json"));
    fdSpans.table.rows.find((r: unknown[]) => r[0] === 1)[1] = "1974-04-22T12:00:00Z";
    serve([
      [/global_hourly_rqds\.json/, fixture("uhslc-rq-stations.json")],
      [/global_hourly_fast\.json/, fixture("uhslc-fd-stations.json")],
      [/global_daily_rqds\.json/, fixture("uhslc-rq-spans.json")],
      [/global_daily_fast\.json/, JSON.stringify(fdSpans)],
    ]);
    const store = { id: "uhslc/001", source_id: "001", status: "active" as const, version: "C" };
    // The refresh that sees the change, and the next, whose list names both versions' epochs.
    for (const epochs of [[{ reference: "C" }], [{ reference: "C" }, { reference: "B" }]]) {
      const pohnpei = (await uhslc.stations([{ ...store, epochs }])).find(
        (s) => s.id === "uhslc/001",
      )!;
      assert.deepEqual(
        [pohnpei.version, pohnpei.commercial_use, pohnpei.attribution],
        [
          "B",
          false,
          "University of Hawaii Sea Level Center (UHSLC); Bureau of Meteorology, © Commonwealth of Australia",
        ],
      );
    }
  });

  it("keeps the store's version when a dropped row leaves none matching", async () => {
    const rq = JSON.parse(fixture("uhslc-rq-stations.json"));
    const versionAt = rq.table.columnNames.indexOf("version");
    // ERDDAP mid-reload: Pohnpei's version C row is missing from the hourly list.
    rq.table.rows = rq.table.rows.filter((r: unknown[]) => !(r[0] === 1 && r[versionAt] === "C"));
    const spans = JSON.parse(fixture("uhslc-rq-spans.json"));
    spans.table.rows = spans.table.rows.filter((r: unknown[]) => !(r[0] === 1 && r[1] === "C"));
    serve([
      [/global_hourly_rqds\.json/, JSON.stringify(rq)],
      [/global_hourly_fast\.json/, fixture("uhslc-fd-stations.json")],
      [/global_daily_rqds\.json/, JSON.stringify(spans)],
      [/global_daily_fast\.json/, fixture("uhslc-fd-spans.json")],
    ]);
    const previous = [
      { id: "uhslc/001", source_id: "001", status: "active" as const, version: "C" },
    ];
    const pohnpei = (await uhslc.stations(previous)).find((s) => s.id === "uhslc/001")!;
    assert.deepEqual([pohnpei.version, pohnpei.reference], ["C", { id: "C", since: null }]);
  });

  it("refuses a list that looks partial against the store's", async () => {
    serve([
      [/global_hourly_rqds\.json/, fixture("uhslc-rq-stations.json")],
      [/global_hourly_fast\.json/, fixture("uhslc-fd-stations.json")],
      [/global_daily_rqds\.json/, fixture("uhslc-rq-spans.json")],
      [/global_daily_fast\.json/, fixture("uhslc-fd-spans.json")],
    ]);
    const listed = await uhslc.stations();
    // The same list again is fine.
    assert.equal((await uhslc.stations(listed)).length, listed.length);
    // Six FD series gone at once is a partial list.
    const extra = ["101", "102", "103", "104", "105", "106"].map((n) => ({
      ...listed[0]!,
      id: `uhslc/${n}`,
      source_id: n,
    }));
    await assert.rejects(uhslc.stations([...listed, ...extra]), /stopped listing 6/);
  });

  it("keeps the FD series on the version it starts with", async () => {
    const spans = JSON.parse(fixture("uhslc-rq-spans.json"));
    // Pohnpei version D is out, but the FD series still starts with C.
    spans.table.rows.push([1, "D", "2020-01-01T12:00:00Z"], [1, "D", "2024-12-31T12:00:00Z"]);
    const rq = JSON.parse(fixture("uhslc-rq-stations.json"));
    rq.table.rows.push(
      [...rq.table.rows.find((r: unknown[]) => r[0] === 1)].map((v, i) =>
        i === rq.table.columnNames.indexOf("version") ? "D" : v,
      ),
    );
    serve([
      [/global_hourly_rqds\.json/, JSON.stringify(rq)],
      [/global_hourly_fast\.json/, fixture("uhslc-fd-stations.json")],
      [/global_daily_rqds\.json/, JSON.stringify(spans)],
      [/global_daily_fast\.json/, fixture("uhslc-fd-spans.json")],
    ]);
    const stations = await uhslc.stations();
    // The FD series stays on C, and D is listed on its own until it carries D.
    assert.equal(stations.find((s) => s.id === "uhslc/001")!.version, "C");
    // Nobody has read D's documentation file, so its terms are unknown.
    assert.equal(stations.find((s) => s.id === "uhslc/001d")!.commercial_use, false);
  });

  it("waits for a version the daily set doesn't have yet", async () => {
    const spans = JSON.parse(fixture("uhslc-rq-spans.json"));
    // Drop Pohnpei version C's span.
    spans.table.rows = spans.table.rows.filter((r: unknown[]) => !(r[0] === 1 && r[1] === "C"));
    serve([
      [/global_hourly_rqds\.json/, fixture("uhslc-rq-stations.json")],
      [/global_hourly_fast\.json/, fixture("uhslc-fd-stations.json")],
      [/global_daily_rqds\.json/, JSON.stringify(spans)],
      [/global_daily_fast\.json/, fixture("uhslc-fd-spans.json")],
    ]);
    await assert.rejects(uhslc.stations(), /research-quality stations and record spans disagree/);
  });

  it("ends an FD series that stopped over a year ago, and labels another reference", async () => {
    const fd = JSON.parse(fixture("uhslc-fd-stations.json"));
    fd.table.rows.find((r: unknown[]) => r[0] === 329)[6] = "chart datum";
    const spans = JSON.parse(fixture("uhslc-fd-spans.json"));
    spans.table.rows.find((r: unknown[]) => r[0] === 1 && r[1] === "2026-09-30T12:00:00Z")[1] =
      "2018-11-25T12:00:00Z";
    // A daily-only record, as UHSLC has, isn't a partial list.
    const rqSpans = JSON.parse(fixture("uhslc-rq-spans.json"));
    rqSpans.table.rows.push([391, "A", "1990-01-01T12:00:00Z"], [391, "A", "1991-01-01T12:00:00Z"]);
    serve([
      [/global_hourly_rqds\.json/, fixture("uhslc-rq-stations.json")],
      [/global_hourly_fast\.json/, JSON.stringify(fd)],
      [/global_daily_rqds\.json/, JSON.stringify(rqSpans)],
      [/global_daily_fast\.json/, JSON.stringify(spans)],
    ]);
    const stations = await uhslc.stations();
    assert.equal(stations.find((s) => s.id === "uhslc/001")!.record_end, "2018-11-25");
    assert.equal(stations.find((s) => s.id === "uhslc/329")!.datum, "chart datum");
  });

  it("caches only a version's values, never the FD series's", async () => {
    const kept: Record<string, boolean> = {};
    const text = JSON.stringify({
      table: {
        columnNames: ["time", "sea_level", "quality", "reference_datum"],
        rows: [["2020-12-31T23:00:00Z", 1, 4, "station zero"]],
      },
    });
    setTransport(async (url, options) => {
      kept[/version/.test(decodeURIComponent(url)) ? "version" : "fd"] = options.keep!(text);
      return text;
    });
    const year = [new Date("2020-01-01Z"), new Date("2021-01-01Z")] as const;
    await uhslc.levels("001", ...year);
    await uhslc.levels("001b", ...year);
    assert.deepEqual(kept, { fd: false, version: true });
  });

  it("caches a version's last year, cut at its last day, once it's all RQ", async () => {
    let keep: ((text: string) => boolean) | undefined;
    let asked = "";
    setTransport(async (url, options) => {
      asked = decodeURIComponent(url);
      keep = options.keep;
      return "{}";
    });
    await uhslc
      .levels("001a", new Date("1971-01-01Z"), new Date("1972-01-01Z"), {
        record_start: "1969-05-09",
        record_end: "1971-02-27",
      })
      .catch(() => {});
    // The cut is in the URL, so a release that extends the version is fetched anew.
    assert.match(asked, /time<1971-03-30T00:00:00.000Z/);
    const text = JSON.stringify({
      table: {
        columnNames: ["time", "sea_level", "quality"],
        rows: [["1971-02-28T07:00:00Z", 1, 4]],
      },
    });
    assert.equal(keep!(text), true);
  });

  it("reads levels in the station's own label, so a decision can let them through", async () => {
    setTransport(async () =>
      JSON.stringify({
        table: {
          columnNames: ["time", "sea_level", "quality", "reference_datum"],
          rows: [["2020-01-01T00:00:00Z", 1, 4, "chart datum"]],
        },
      }),
    );
    const levels = await uhslc.levels("001", new Date("2020-01-01Z"), new Date("2020-01-02Z"), {
      datum: "chart datum",
    });
    assert.equal(levels.length, 1);
  });

  it("caches a range only when it's all RQ and runs to its last hour", () => {
    const end = Date.parse("2021-01-01T00:00:00Z");
    const table = (rows: (string | number)[][]) =>
      JSON.stringify({ table: { columnNames: ["time", "sea_level", "quality"], rows } });
    assert.equal(uhslc.final(table([["2020-12-31T23:00:00Z", 1, 4]]), end), true);
    // FD values change.
    assert.equal(uhslc.final(table([["2020-12-31T23:00:00Z", 1, 3]]), end), false);
    // RQ that stops in September may be extended by the next release.
    assert.equal(uhslc.final(table([["2020-09-30T23:00:00Z", 1, 4]]), end), false);
  });

  it("names only notices that exist in every scanned record", () => {
    const missing = Object.entries(CONTRIBUTORS).filter(([, r]) => r.notice && !NOTICES[r.notice]);
    assert.deepEqual(missing, []);
  });

  it("reads a documentation file's originator number", () => {
    assert.equal(
      originatorOf("              GLOSS #  : 108  Originator #:1612340   NODC #: 72151701\r\n"),
      "1612340",
    );
    assert.equal(
      originatorOf("              GLOSS #  : 108  Originator #: none   NODC #: 1\n"),
      null,
    );
    assert.equal(originatorOf("              GLOSS #  : 108\n"), null);
    assert.equal(originatorOf("  GLOSS #  : 115  Originator #:        NODC #: 10156801\n"), null);
  });

  it("links a series to its CO-OPS station where NOS contributed it", () => {
    const nos = "National Ocean Service (NOS)";
    assert.equal(
      uhslc.originatorStation({ contributor: nos, originator: "1612340" }),
      "coops/1612340",
    );
    // Other contributors' numbers aren't their store source's IDs.
    assert.equal(
      uhslc.originatorStation({
        contributor: "Service Hydrographique Et Oceanographique",
        originator: "620",
      }),
      null,
    );
    assert.equal(uhslc.originatorStation({ contributor: nos, originator: "ID070007" }), null);
  });

  it("links a series to its JMA station by the code JMA or JODC gives", () => {
    const jma = "Japan Meteorological Agency";
    const jodc = "Japan Oceanographic Data Center";
    assert.equal(uhslc.originatorStation({ contributor: jma, originator: "CC" }), "jma/CC");
    assert.equal(uhslc.originatorStation({ contributor: jodc, originator: "HA" }), "jma/HA");
    // JODC's HD numbers aren't JMA codes.
    assert.equal(uhslc.originatorStation({ contributor: jodc, originator: "HD50" }), null);
  });

  it("reads a documentation file's contributor", () => {
    const file = (lines: string) => `              Station  : X\r\n${lines}`;
    assert.equal(
      contributorOf(
        file(
          "              Contributor  : National Ocean Service (NOS)   \r\n                             NOAA\r\n",
        ),
      ),
      "National Ocean Service (NOS)",
    );
    assert.equal(
      contributorOf(
        file(
          "              Contributor  : UH Sea Level Center (1971-)\n                             1000 Pope Rd.\n",
        ),
      ),
      "University of Hawaii Sea Level Center",
    );
    // A span of years labels the name on the next line.
    assert.equal(
      contributorOf(
        file(
          "              Contributor  :   For 1984-1988:\n                             Royal New Zealand Navy - Hydrographic Office\n",
        ),
      ),
      "Royal New Zealand Navy - Hydrographic Office",
    );
    assert.equal(
      contributorOf(
        file(
          "              Contributor  : Servicio Hidrografico y Oceanografico de la\n                             Armada (SHOA)\n",
        ),
      ),
      "Servicio Hidrografico y Oceanografico de la Armada (SHOA)",
    );
    assert.equal(contributorOf(file("              Contributor  : unconfirmed\n\n")), null);
  });

  it("refuses levels from another reference", async () => {
    setTransport(async () =>
      JSON.stringify({
        table: {
          columnNames: ["time", "sea_level", "quality", "reference_datum"],
          rows: [["2020-01-01T00:00:00Z", 1, 4, "chart datum"]],
        },
      }),
    );
    await assert.rejects(
      uhslc.levels("001", new Date("2020-01-01Z"), new Date("2020-01-02Z")),
      /chart datum/,
    );
  });
});

describe("refmar", () => {
  refmar.pacing.requestMs = 0;

  /** Serve REFMAR's gauge list and records from the fixtures. */
  function serveGauges(gauges: Record<string, unknown>) {
    setTransport(async (url) => {
      if (/service\/tidegauges$/.test(url)) return fixture("refmar-tidegauges.json");
      const id = /completetidegauge\/(\d+)$/.exec(url)?.[1];
      if (id && gauges[id]) return JSON.stringify(gauges[id]);
      throw new Error(`GET ${url} returned 404`);
    });
  }

  /** A month's answer for validated and raw 10-minute values, and the 1-minute one. */
  function serveLevels(combined: () => string, oneMinute = () => fixture("refmar-raw-1min.json")) {
    const asked: string[] = [];
    setTransport(async (url) => {
      const sources = new URL(url).searchParams.get("sources")!;
      asked.push(sources);
      if (sources === "2,3,4") return combined();
      if (sources === "1") return oneMinute();
      // The month after a range that ends in raw values, not validated yet.
      if (sources === "3,4") return JSON.stringify({ data: [] });
      throw new Error(`GET ${url} returned 404`);
    });
    return asked;
  }

  const row = (idsource: number, timestamp: string, value = 1) => ({
    idstation: 3,
    idsource,
    value,
    timestamp,
  });

  it("lists every gauge with its datum, owners and first observation", async () => {
    serveGauges(JSON.parse(fixture("refmar-gauges.json")));
    const stations = await refmar.stations();
    assert.deepEqual(
      stations.map((s) => [s.id, s.datum, s.datums, s.country_code, s.live, s.first_observation]),
      [
        ["refmar/16", "ZH", { NGNC: -0.835 }, "NC", false, "1967-02-24"],
        ["refmar/3", "ZH", { IGN69: -3.635 }, "FR", true, "1846-01-04"],
        ["refmar/6118", "ZH", {}, "FR", true, null],
        // Bassins à flot is hidden from SHOM's map: no products and no datum,
        // so it isn't added, and one already listed is never fetched.
        ["refmar/6326", null, {}, null, false, null],
      ],
    );
    assert.deepEqual(stations.find((s) => s.id === "refmar/6326")!.products, []);
    const brest = stations.find((s) => s.id === "refmar/3")!;
    assert.equal(
      brest.attribution,
      "© Shom, Marine nationale; REFMAR, Shom (doi:10.17183/REFMAR#RONIM)",
    );
    assert.equal(brest.commercial_use, true);
    assert.match(
      stations.find((s) => s.id === "refmar/6118")!.attribution,
      /GPM Bordeaux.*#PARTENAIRES/,
    );
  });

  it("leaves the datum unsaid when SHOM's record doesn't name a zero it knows", async () => {
    const gauges = JSON.parse(fixture("refmar-gauges.json"));
    gauges["6118"].verticalRef = { zero_hydro: "zero_nouveau" };
    gauges["16"].verticalRef = {};
    gauges["16"].date_prem_obs = "inconnue";
    serveGauges(gauges);
    const stations = await refmar.stations();
    const of = (id: string) => stations.find((s) => s.id === id)!;
    assert.equal(of("refmar/6118").datum, null);
    // A reference that names no zero is an unknown one.
    assert.equal(of("refmar/16").datum, "ZI");
    assert.equal(of("refmar/16").first_observation, null);
  });

  it("keeps a gauge's record when SHOM's answer for it fails, is partial or hides it", async () => {
    serveGauges(JSON.parse(fixture("refmar-gauges.json")));
    const previous = await refmar.stations();
    const gauges = JSON.parse(fixture("refmar-gauges.json"));
    delete gauges["6118"];
    serveGauges(gauges);
    const brestBefore = previous.find((s) => s.id === "refmar/3")!;
    // Bassins à flot was in the store before SHOM hid it.
    const hidden = { ...brestBefore, id: "refmar/6326", source_id: "6326", kind: "coastal" };
    // A kind `KINDS` gave a station in the store isn't REFMAR's, so a kept record leaves it out.
    const decided = previous.map((s) => (s.id === "refmar/6118" ? { ...s, kind: "coastal" } : s));
    const stations = await refmar.stations([...decided, hidden] as Station[]);
    const of = (id: string) => stations.find((s) => s.id === id)!;
    assert.equal(of("refmar/6118").datum, "ZH");
    assert.equal(of("refmar/6118").kind, null);
    assert.equal(of("refmar/6326").kind, null);
    // A hidden gauge keeps its owners' credit, but loses its products.
    assert.equal(of("refmar/6326").attribution, brestBefore.attribution);
    assert.deepEqual(of("refmar/6326").products, []);
    // A record without a vertical reference keeps what the gauge had.
    gauges["6118"] = { ...JSON.parse(fixture("refmar-gauges.json"))["6118"] };
    delete gauges["3"].verticalRef;
    serveGauges(gauges);
    assert.deepEqual(
      (await refmar.stations(previous as Station[])).find((s) => s.id === "refmar/3"),
      brestBefore,
    );
    // A record with no owners, or one that dropped its first observation, keeps
    // what the gauge had.
    gauges["16"].organismes = [];
    const brest = { ...JSON.parse(fixture("refmar-gauges.json"))["3"] };
    delete brest.date_prem_obs;
    gauges["3"] = brest;
    serveGauges(gauges);
    const again = await refmar.stations(previous as Station[]);
    const ofAgain = (id: string) => again.find((s) => s.id === id)!;
    assert.equal(
      ofAgain("refmar/16").attribution,
      previous.find((s) => s.id === "refmar/16")!.attribution,
    );
    assert.equal(ofAgain("refmar/3").first_observation, "1846-01-04");
    // An empty vertical reference doesn't move a ZH gauge to ZI.
    brest.verticalRef = {};
    serveGauges(gauges);
    assert.equal(
      (await refmar.stations(previous as Station[])).find((s) => s.id === "refmar/3")!.datum,
      null,
    );
    // A new gauge without a full record is left out.
    gauges["16"] = JSON.parse(fixture("refmar-gauges.json"))["16"];
    delete gauges["6118"];
    serveGauges(gauges);
    assert.equal(
      (await refmar.stations()).some((s) => s.id === "refmar/6118"),
      false,
    );
  });

  it("publishes only gauge states it knows, and refuses a list most records failed", async () => {
    const list = JSON.parse(fixture("refmar-tidegauges.json"));
    list.find((g: { shom_id: string }) => g.shom_id === "3").state = "PRIVATE";
    const gauges = JSON.parse(fixture("refmar-gauges.json"));
    setTransport(async (url) => {
      if (/service\/tidegauges$/.test(url)) return JSON.stringify(list);
      const id = /completetidegauge\/(\d+)$/.exec(url)?.[1];
      if (id && gauges[id]) return JSON.stringify(gauges[id]);
      throw new Error(`GET ${url} returned 404`);
    });
    const brest = (await refmar.stations()).find((s) => s.id === "refmar/3")!;
    assert.deepEqual([brest.products, brest.datum], [[], null]);
    delete gauges["3"];
    delete gauges["6118"];
    delete gauges["16"];
    await assert.rejects(refmar.stations(), /no full record/);
  });

  it("places overseas gauges by sector and latitude", () => {
    assert.equal(refmar.countryOf("AG", 16.22, -61.53), "GP");
    assert.equal(refmar.countryOf("AG", 14.6, -61.07), "MQ");
    assert.equal(refmar.countryOf("AG", 4.85, -52.26), "GF");
    assert.equal(refmar.countryOf("AG", 18.07, -63.08), "MF");
    assert.equal(refmar.countryOf("OI", -12.78, 45.26), "YT");
    assert.equal(refmar.countryOf("OI", -20.93, 55.29), "RE");
    assert.equal(refmar.countryOf("OI", -49.35, 70.22), "TF");
  });

  it("takes validated values, then raw 10-minute ones, then raw 1-minute ones on the ten minutes", async () => {
    const asked = serveLevels(() => {
      const validated = JSON.parse(fixture("refmar-validated.json"));
      const raw = JSON.parse(fixture("refmar-raw.json"));
      // An hourly validated value beside the 10-minute one at 23:00, as months SHOM has filtered carry.
      validated.data.push(row(4, "2026/10/21 23:00:00", 4.9));
      return JSON.stringify({ data: [...validated.data, ...raw.data] });
    });
    const values = await refmar.levels(
      { source_id: "3", first_observation: "1846-01-04" },
      new Date("2026-10-21T22:00:00Z"),
      new Date("2026-10-22T01:00:00Z"),
    );
    assert.deepEqual(asked, ["2,3,4", "1", "3,4"]);
    const at = (iso: string) => values.find((v) => v.time === Date.parse(iso));
    assert.equal(values.length, 18);
    assert.equal(at("2026-10-21T23:50:00Z")!.flag, Flag.good);
    // The hourly validated value at 23:00 gives way to the 10-minute one.
    assert.equal(at("2026-10-21T23:00:00Z")!.level, 4.945);
    assert.equal(at("2026-10-22T00:10:00Z")!.flag, Flag.preliminary);
    assert.equal(at("2026-10-22T00:50:00Z")!.flag, Flag.preliminary);
    assert.equal(at("2026-10-22T00:21:00Z"), undefined);
  });

  it("asks for raw values after 10-minute validated ones that end within the last hour", async () => {
    const asked = serveLevels(
      () => JSON.stringify({ data: [row(3, "2025/10/31 23:00:00")] }),
      () =>
        JSON.stringify({ data: [row(1, "2025/10/31 23:10:00"), row(1, "2025/10/31 23:50:00")] }),
    );
    const values = await refmar.levels(
      { source_id: "3", first_observation: null },
      new Date("2025-10-31T22:00:00Z"),
      new Date("2025-11-01T00:00:00Z"),
    );
    assert.deepEqual(asked, ["2,3,4", "1", "3,4"]);
    assert.equal(values.length, 3);
  });

  it("asks nothing more after an hourly validated value an hour before the end", async () => {
    const asked = serveLevels(() => JSON.stringify({ data: [row(4, "1990/01/31 23:00:00")] }));
    const values = await refmar.levels(
      { source_id: "3", first_observation: "1846-01-04" },
      new Date("1990-01-31T22:00:00Z"),
      new Date("1990-02-01T00:00:00Z"),
    );
    assert.deepEqual(asked, ["2,3,4"]);
    assert.equal(values.length, 1);
  });

  it("drops raw values before a later month's validated ones", async () => {
    let call = 0;
    setTransport(async (url) => {
      const sources = new URL(url).searchParams.get("sources");
      if (sources === "1") return JSON.stringify({ data: [] });
      // March's validated values stop on the 20th, its raw ones run on; April is validated.
      return JSON.stringify({
        data:
          call++ === 0
            ? [row(3, "2025/03/20 12:00:00"), row(2, "2025/03/25 00:00:00")]
            : [row(3, "2025/04/10 00:00:00")],
      });
    });
    const values = await refmar.levels(
      { source_id: "3", first_observation: "1846-01-04" },
      new Date("2025-03-01Z"),
      new Date("2025-05-01Z"),
    );
    assert.deepEqual(
      values.map((v) => [new Date(v.time).toISOString(), v.flag]),
      [
        ["2025-03-20T12:00:00.000Z", Flag.good],
        ["2025-04-10T00:00:00.000Z", Flag.good],
      ],
    );
  });

  it("keeps raw values from before SHOM validated the gauge", async () => {
    setTransport(async (url) => {
      const start = new URL(url).searchParams.get("dtStart")!;
      if (new URL(url).searchParams.get("sources") === "1") return JSON.stringify({ data: [] });
      if (start.startsWith("2015-01"))
        return JSON.stringify({ data: [row(3, "2015/01/01 00:00:00")] });
      return JSON.stringify({ data: [row(2, "2014/12/20 00:00:00")] });
    });
    const values = await refmar.levels(
      { source_id: "6118", first_observation: "2010-01-01" },
      new Date("2014-12-01Z"),
      new Date("2015-01-01Z"),
    );
    assert.deepEqual(
      values.map((v) => v.flag),
      [Flag.preliminary],
    );
    // The same within one range: December's raw values come before any validated one.
    const both = await refmar.levels(
      { source_id: "6118", first_observation: "2010-01-01" },
      new Date("2014-12-01Z"),
      new Date("2015-02-01Z"),
    );
    assert.deepEqual(
      both.map((v) => v.flag),
      [Flag.preliminary, Flag.good],
    );
  });

  it("drops raw values at a range's start when the month before is validated", async () => {
    setTransport(async (url) => {
      const params = new URL(url).searchParams;
      if (params.get("sources") === "1") return JSON.stringify({ data: [] });
      const start = params.get("dtStart")!;
      // December was validated; January 2026, rejected whole, has raw values only.
      if (start.startsWith("2025-12"))
        return JSON.stringify({ data: [row(3, "2025/12/31 23:50:00")] });
      if (start.startsWith("2026-01"))
        return JSON.stringify({ data: [row(2, "2026/01/10 00:00:00")] });
      return JSON.stringify({ data: [row(3, "2026/02/03 00:00:00")] });
    });
    const values = await refmar.levels(
      { source_id: "3", first_observation: "1846-01-04" },
      new Date("2026-01-01Z"),
      new Date("2026-03-01Z"),
    );
    assert.deepEqual(
      values.map((v) => v.flag),
      [Flag.good],
    );
  });

  it("drops raw values at a range's end when the next month is validated", async () => {
    setTransport(async (url) => {
      const params = new URL(url).searchParams;
      if (params.get("sources") === "1") return JSON.stringify({ data: [] });
      if (params.get("dtStart")!.startsWith("2026-01"))
        return JSON.stringify({ data: [row(3, "2026/01/01 00:00:00")] });
      return JSON.stringify({
        data: [row(3, "2025/12/10 00:00:00"), row(2, "2025/12/20 00:00:00")],
      });
    });
    const values = await refmar.levels(
      { source_id: "3", first_observation: "1846-01-04" },
      new Date("2025-12-01Z"),
      new Date("2026-01-01Z"),
    );
    assert.deepEqual(
      values.map((v) => v.flag),
      [Flag.good],
    );
  });

  it("flags Pointe-à-Pitre's values from 2020 to 2024 suspect", async () => {
    setTransport(async (url) => {
      const start = new URL(url).searchParams.get("dtStart")!;
      if (start.startsWith("2019-12"))
        return JSON.stringify({ data: [row(3, "2019/12/31 23:50:00")] });
      if (start.startsWith("2020-01"))
        return JSON.stringify({ data: [row(3, "2020/01/01 00:00:00")] });
      if (start.startsWith("2024-12"))
        return JSON.stringify({ data: [row(3, "2024/12/31 23:50:00")] });
      if (start.startsWith("2025-01"))
        return JSON.stringify({ data: [row(3, "2025/01/01 00:00:00")] });
      return JSON.stringify({ data: [] });
    });
    // Erratum `refmar-pointe-a-pitre-clock`, applied by the registry's wrapper.
    const station = (id: string) =>
      ({
        id: `refmar/${id}`,
        source_id: id,
        products: ["levels"],
        first_observation: "1983-01-04",
      }) as unknown as Station;
    const flags = async (id: string, from: string, to: string) =>
      (await sources.refmar!.observations!(station(id), new Date(from), new Date(to))).map((v) => [
        new Date(v.time).toISOString().slice(0, 4),
        v.flag,
      ]);
    const [, flagged] = await sources.refmar!.observations!(
      station("125"),
      new Date("2019-12-01Z"),
      new Date("2020-02-01Z"),
    );
    // SHOM's own flag stays as the source's.
    assert.equal(flagged!.source_flag, Flag.good);
    assert.deepEqual(await flags("125", "2019-12-01Z", "2020-02-01Z"), [
      ["2019", Flag.good],
      ["2020", Flag.suspect],
    ]);
    assert.deepEqual(await flags("125", "2024-12-01Z", "2025-02-01Z"), [
      ["2024", Flag.suspect],
      ["2025", Flag.good],
    ]);
    // Other gauges keep SHOM's flag.
    assert.deepEqual(await flags("126", "2019-12-01Z", "2020-02-01Z"), [
      ["2019", Flag.good],
      ["2020", Flag.good],
    ]);
  });

  it("caches a month only once its validated values run to its end", () => {
    const to = Date.parse("2026-11-01T00:00:00Z");
    const answer = (...rows: object[]) => JSON.stringify({ data: rows });
    assert.equal(refmar.complete(answer(row(3, "2026/10/31 23:50:00")), to), true);
    assert.equal(refmar.complete(answer(row(4, "2026/10/31 23:00:00")), to), true);
    // Raw values to the end don't make a month final.
    assert.equal(
      refmar.complete(answer(row(3, "2026/10/21 23:50:00"), row(2, "2026/10/31 23:50:00")), to),
      false,
    );
    assert.equal(refmar.complete(answer(), to), false);
    // Raw values after an hourly validated one would be cached unrevised.
    assert.equal(
      refmar.complete(answer(row(4, "2026/10/31 23:00:00"), row(2, "2026/10/31 23:50:00")), to),
      false,
    );
    // A validated row with no value doesn't make the month final.
    assert.equal(
      refmar.complete(
        answer({ idstation: 3, idsource: 3, value: null, timestamp: "2026/10/31 23:50:00" }),
        to,
      ),
      false,
    );
  });

  it("asks nothing for months before a gauge's first observation", async () => {
    setTransport(async (url) => {
      throw new Error(`GET ${url} shouldn't be asked`);
    });
    const none = (first_observation: string | null, source_id = "3") =>
      refmar.levels(
        { source_id, first_observation },
        new Date("1800-01-01Z"),
        new Date("1845-11-01Z"),
      );
    assert.deepEqual(await none("1846-01-04"), []);
    // An undated gauge starts five years before its probe found values, or at 2010.
    assert.deepEqual(
      await refmar.levels(
        { source_id: "6118", first_observation: null },
        new Date("1900-01-01Z"),
        new Date("1980-01-01Z"),
      ),
      [],
    );
    assert.deepEqual(
      await refmar.levels(
        { source_id: "99", first_observation: null },
        new Date("2000-01-01Z"),
        new Date("2010-01-01Z"),
      ),
      [],
    );
  });

  it("refuses a gauge listed without levels", async () => {
    const hidden = { source_id: "6326", products: [] } as unknown as Station;
    await assert.rejects(
      refmar.source.observations!(hidden, new Date("2020-01-01Z"), new Date("2020-02-01Z")),
      /isn't published/,
    );
  });
});

describe("ea", () => {
  /** A day file with another gauge's reading only. */
  const OTHER_GAUGE =
    "dateTime,measure,value\n2025-11-11T00:00:00Z,http://environment.data.gov.uk/flood-monitoring/id/measures/E70039-level-tidal_level-Mean-15_min-mAOD,1.0\n";

  beforeEach(() => ea.forgetArchive());

  it("lists each tide gauge's mAOD series, or its chart datum series where it has no other", async () => {
    serve([[/id\/stations\?type=TideGauge/, fixture("ea-stations.json")]]);
    const stations = await ea.stations();
    assert.deepEqual(
      stations.map((s) => [s.id, s.name, s.datum, s.country_code, ea.measureOf(s)]),
      [
        ["ea/E70039", "Lowestoft", "AOD", "GB", "E70039-level-tidal_level-Mean-15_min-mAOD"],
        ["ea/E70239", "Jersey", "AOD", "JE", "E70239-level-tidal_level-Mean-15_min-mAOD"],
        ["ea/E71924", "Bournemouth", "CD", "GB", "E71924-level-tidal_level-Mean-15_min-m"],
        ["ea/E72239", "Newlyn", "AOD", "GB", "E72239-level-tidal_level-Mean-15_min-mAOD"],
        [
          "ea/E73439-anglian",
          "Heysham",
          "AOD",
          "GB",
          "E73439-anglian-level-tidal_level-Mean-15_min-mAOD",
        ],
      ],
    );
    assert.equal(stations[0]!.interval_s, 900);
    assert.equal(stations[0]!.commercial_use, true);
  });

  it("reads a station from stations.parquet, without the list's extra fields", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(url);
      return JSON.stringify({ items: [] });
    });
    const now = Date.now();
    for (const [source_id, datum] of [
      ["E72239", "AOD"],
      ["E71924", "CD"],
    ])
      await ea.source.observations!(
        { source_id, datum } as Station,
        new Date(now - 3_600_000),
        new Date(now),
      );
    assert.deepEqual(
      asked.map((u) => /measures\/([^/]+)\/readings/.exec(u)![1]),
      ["E72239-level-tidal_level-Mean-15_min-mAOD", "E71924-level-tidal_level-Mean-15_min-m"],
    );
  });

  it("reads tide gauges' readings from a day's archive file", () => {
    const day = ea.parseArchive(fixture("ea-archive.csv"));
    // River gauges and other parameters aren't kept.
    assert.deepEqual(
      [...day.keys()],
      ["E72239-level-tidal_level-Mean-15_min-mAOD", "E72224-level-tidal_level-Mean-15_min-m"],
    );
    // A blank value and two readings joined by "|" are dropped.
    assert.deepEqual(day.get("E72239-level-tidal_level-Mean-15_min-mAOD"), [
      Date.parse("2025-11-10T00:00:00Z"),
      -0.5,
      Date.parse("2025-11-10T00:15:00Z"),
      -0.683,
      Date.parse("2025-11-10T00:30:00Z"),
      -0.846,
    ]);
  });

  it("reads older days from the archive, once a run, and recent ones from the API", async () => {
    const asked: string[] = [];
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const recent = new Date(today - 86_400_000).toISOString();
    setTransport(async (url) => {
      asked.push(url.replace(/^.*flood-monitoring/, ""));
      if (/readings-2025-11-10\.csv$/.test(url)) return fixture("ea-archive.csv");
      if (/readings-2025-11-\d\d\.csv$/.test(url)) return OTHER_GAUGE;
      if (/\/readings\?since=/.test(url))
        return JSON.stringify({ items: [{ dateTime: recent, value: 1.25 }] });
      throw new Error(`GET ${url} returned 404`);
    });
    const measure = "E72239-level-tidal_level-Mean-15_min-mAOD";
    const old = await ea.levels(measure, new Date("2025-11-10Z"), new Date("2025-11-12Z"));
    assert.equal(old.length, 3);
    assert.equal(old[0]!.flag, Flag.preliminary);
    await ea.levels(measure, new Date("2025-11-10Z"), new Date("2025-11-11Z"));
    // The second station's call reuses the day it read.
    assert.deepEqual(asked, [
      "/archive/readings-2025-11-10.csv",
      "/archive/readings-2025-11-11.csv",
    ]);
    const now = await ea.levels(measure, new Date(today - 2 * 86_400_000), new Date(today));
    assert.deepEqual(
      now.map((v) => [new Date(v.time).toISOString(), v.level]),
      [[recent, 1.25]],
    );
  });

  it("reads no archive file for a start within the API's days", async () => {
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(url);
      return JSON.stringify({ items: [] });
    });
    const now = Date.now();
    await ea.levels(
      "E72239-level-tidal_level-Mean-15_min-mAOD",
      new Date(now - 12 * 3_600_000),
      new Date(now),
    );
    assert.equal(asked.length, 1);
    assert.match(asked[0]!, /\/readings\?since=/);
  });

  it("fails on a day file that isn't the CSV or holds no tide gauge reading", async () => {
    for (const body of ["<html>Service unavailable</html>", "dateTime,measure,value\n"]) {
      ea.forgetArchive();
      setTransport(async () => body);
      await assert.rejects(
        ea.levels(
          "E72239-level-tidal_level-Mean-15_min-mAOD",
          new Date("2025-11-10Z"),
          new Date("2025-11-11Z"),
        ),
        /isn't the CSV|no tide gauge readings/,
      );
    }
    // The next station doesn't download a malformed day again.
    let asked = 0;
    setTransport(async () => {
      asked++;
      return "dateTime,measure,value\n";
    });
    ea.forgetArchive();
    for (let i = 0; i < 2; i++)
      await assert.rejects(
        ea.levels(
          "E72239-level-tidal_level-Mean-15_min-mAOD",
          new Date("2025-11-10Z"),
          new Date("2025-11-11Z"),
        ),
      );
    assert.equal(asked, 1);
  });

  it("gives nothing for the split's month when the API answers empty", async () => {
    const today = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    const split = today - 28 * 86_400_000;
    setTransport(async (url) => {
      if (/\/archive\//.test(url))
        return OTHER_GAUGE.replace(
          "2025-11-11T00:00:00Z",
          new Date(split - 86_400_000).toISOString(),
        ).replace("E70039", "E72239");
      return JSON.stringify({ items: [] });
    });
    const values = await ea.levels(
      "E72239-level-tidal_level-Mean-15_min-mAOD",
      new Date(split - 86_400_000),
      new Date(today),
    );
    const sameMonth = new Date(split - 86_400_000).getUTCMonth() === new Date(split).getUTCMonth();
    assert.equal(values.length, sameMonth ? 0 : 1);
  });

  it("gives nothing for a month with a day the archive no longer holds", async () => {
    setTransport(async (url) => {
      // October 28th is missing, after the 25th was read.
      if (/readings-2025-10-28\.csv$/.test(url)) throw new Error(`GET ${url} returned 404`);
      if (/readings-2025-11-10\.csv$/.test(url)) return fixture("ea-archive.csv");
      // October 25th has a reading, which its month's missing day drops.
      if (/readings-2025-10-25\.csv$/.test(url))
        return fixture("ea-archive.csv").replaceAll("2025-11-10T", "2025-10-25T");
      if (/readings-2025-1[01]-\d\d\.csv$/.test(url)) return OTHER_GAUGE;
      throw new Error(`GET ${url} returned 404`);
    });
    const values = await ea.levels(
      "E72239-level-tidal_level-Mean-15_min-mAOD",
      new Date("2025-10-20Z"),
      new Date("2025-11-12Z"),
    );
    // October lost its first days, so it gives nothing and the store keeps what it has;
    // November's first day gives its readings.
    assert.equal(values.length, 3);
  });
});
