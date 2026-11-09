import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fetchText, HttpError, setTransport } from "../src/http.ts";
import { correctPositions } from "../src/positions.ts";
import { Flag } from "../src/schema.ts";
import * as bodc from "../src/sources/bodc/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

/** Answer requests from fixtures, by the first pattern the decoded URL matches. */
function serve(routes: [RegExp, string | (() => string)][]): void {
  setTransport(async (url) => {
    const route = routes.find(([pattern]) => pattern.test(decodeURIComponent(url)));
    if (!route) throw new Error(`GET ${url} returned 404`);
    return typeof route[1] === "function" ? route[1]() : route[1];
  });
}

const datasets: [RegExp, string] = [/allDatasets/, fixture("bodc-datasets.json")];

beforeEach(() => bodc.reset());
afterEach(() => setTransport(fetchText));

describe("bodc", () => {
  bodc.pacing.requestMs = 0;

  it("lists each gauge's dataset by its port code, in chart datum with its offset to ordnance datum", async () => {
    serve([datasets]);
    const stations = await bodc.stations();
    assert.equal(stations.length, 42);
    const ler = stations.find((s) => s.id === "bodc/ler")!;
    assert.deepEqual(
      [ler.source_id, ler.name, ler.lat, ler.lon, ler.country_code, ler.datum, ler.datums],
      ["ler", "Lerwick", 60.15403, -1.14031, "GB", "CD", { AOD: -1.22 }],
    );
    assert.equal(
      ler.source_url,
      "https://erddap.bodc.ac.uk/erddap/tabledap/LER_ukcff_4109_001.html",
    );
    assert.equal(stations.find((s) => s.id === "bodc/liv")!.name, "Liverpool - Gladstone Dock");
    assert.equal(stations.find((s) => s.id === "bodc/jer")!.country_code, "JE");
    assert.deepEqual(stations.find((s) => s.id === "bodc/har")!.datums, {});
  });

  it("moves the gauges ERDDAP misplaces", async () => {
    serve([datasets]);
    const { stations, stale } = correctPositions(await bodc.stations());
    assert.deepEqual(stale, []);
    const at = (id: string) => stations.find((s) => s.id === id)!;
    assert.deepEqual([at("bodc/wor").lat, at("bodc/wor").lon], [54.650691, -3.56717]);
    assert.deepEqual([at("bodc/imm").lat, at("bodc/imm").lon], [53.63039, -0.18755]);
    assert.deepEqual([at("bodc/nha").lat, at("bodc/nha").lon], [50.781775, 0.057004]);
  });

  it("reads the processed channel, on the minute, with BODC's flags", async () => {
    serve([
      datasets,
      [/LER_ukcff_4109_001.*time>=2024-12-07/, fixture("bodc-levels-interpolated.json")],
      [/LER_ukcff_4109_001.*time>=2025-01-19/, fixture("bodc-levels-null.json")],
      [/LER_ukcff_4109_001.*time>=2024-02-29/, fixture("bodc-levels-improbable.json")],
    ]);
    const read = async (from: string, to: string) =>
      (await bodc.levels("ler", new Date(from), new Date(to))).map((o) => [
        new Date(o.time).toISOString(),
        o.level,
        o.flag,
      ]);
    assert.deepEqual(await read("2024-12-07T07:30:00Z", "2024-12-07T08:30:00Z"), [
      ["2024-12-07T07:30:00.000Z", 1.2110001, Flag.good],
      ["2024-12-07T07:45:00.000Z", 1.192, Flag.good],
      ["2024-12-07T08:00:00.000Z", 1.1842722, Flag.interpolated],
      ["2024-12-07T08:15:00.000Z", 1.159, Flag.good],
    ]);
    // The null value is dropped.
    assert.deepEqual(await read("2025-01-19T02:15:00Z", "2025-01-19T03:15:00Z"), [
      ["2025-01-19T02:15:00.000Z", 1.982, Flag.good],
      ["2025-01-19T02:30:00.000Z", 1.995, Flag.good],
      ["2025-01-19T03:00:00.000Z", 1.955, Flag.good],
    ]);
    assert.deepEqual(
      (await read("2024-03-01T00:00:00Z", "2024-03-01T00:45:00Z")).map(([, , f]) => f),
      [Flag.suspect, Flag.suspect, Flag.suspect],
    );
  });

  it("marks bad the zeros BODC flags improbable, as at Portbury", async () => {
    serve([
      datasets,
      [
        /LER_ukcff_4109_001/,
        JSON.stringify({
          table: {
            columnNames: ["time", "ASLVBG02", "FASLVBG02"],
            rows: [
              ["2024-03-06T00:00:00Z", 0, "'M'"],
              ["2024-03-06T00:15:00Z", -0.001, "'M'"],
              ["2024-03-06T00:30:00Z", 0, "''"],
              ["2024-03-06T00:45:00Z", -0.002, "'M'"],
            ],
          },
        }),
      ],
    ]);
    assert.deepEqual(
      (await bodc.levels("ler", new Date("2024-03-06T00:00Z"), new Date("2024-03-06T01:00Z"))).map(
        (o) => [o.level, o.flag],
      ),
      [
        [0, Flag.bad],
        [-0.001, Flag.bad],
        [0, Flag.good],
        [-0.002, Flag.suspect],
      ],
    );
  });

  it("answers a span with no values with none, and refuses another datum", async () => {
    serve([
      datasets,
      [
        /LER_ukcff_4109_001/,
        () => {
          throw new HttpError(
            "404",
            'Error {\n code=404;\n message="Not Found: Your query produced no matching results. (nRows = 0)";\n}',
          );
        },
      ],
    ]);
    assert.deepEqual(
      await bodc.levels("ler", new Date("2022-06-01T00:00Z"), new Date("2022-06-01T01:00Z")),
      [],
    );
    await assert.rejects(
      bodc.levels("ler", new Date("2022-06-01T00:00Z"), new Date("2022-06-01T01:00Z"), "AOD"),
      /measured from CD/,
    );
    await assert.rejects(bodc.levels("xyz", new Date(0), new Date(1)), /no dataset for xyz/);
  });

  it("puts a value stamped just off New Year in the year it rounds into, once", async () => {
    const table = (rows: (string | number)[][]) =>
      JSON.stringify({ table: { columnNames: ["time", "ASLVBG02", "FASLVBG02"], rows } });
    serve([
      datasets,
      // Each year's query starts half a minute early, so both answers hold the edge.
      [/time>=2024-12-31T23:59:30/, table([["2024-12-31T23:59:59.998Z", 1.5, "''"]])],
      [
        /time>=2023-12-31T23:59:30/,
        table([
          ["2024-12-31T23:44:59.999Z", 1.4, "''"],
          ["2024-12-31T23:59:59.998Z", 1.5, "''"],
        ]),
      ],
    ]);
    const values = await bodc.levels(
      "ler",
      new Date("2024-01-01T00:00Z"),
      new Date("2025-01-01T01:00Z"),
    );
    assert.deepEqual(
      values.map((o) => new Date(o.time).toISOString()),
      ["2024-12-31T23:45:00.000Z", "2025-01-01T00:00:00.000Z"],
    );
  });

  it("asks for the dataset list again after a failed lookup", async () => {
    let fail = true;
    serve([
      [
        /allDatasets/,
        () => {
          if (fail) throw new Error("GET allDatasets returned 503");
          return fixture("bodc-datasets.json");
        },
      ],
      [/LER_ukcff_4109_001/, fixture("bodc-levels-null.json")],
    ]);
    const span = [new Date("2025-01-19T02:15:00Z"), new Date("2025-01-19T03:15:00Z")] as const;
    await assert.rejects(bodc.levels("ler", ...span), /503/);
    fail = false;
    assert.equal((await bodc.levels("ler", ...span)).length, 3);
  });

  it("refuses two datasets for one port code", async () => {
    const body = JSON.parse(fixture("bodc-datasets.json"));
    const ler = body.table.rows.find((r: string[]) => r[0] === "LER_ukcff_4109_001");
    body.table.rows.push(["LER_ukcff_4109_002", ...ler.slice(1)]);
    serve([[/allDatasets/, JSON.stringify(body)]]);
    await assert.rejects(bodc.stations(), /two datasets for LER/);
  });

  it("maps BODC's qualifiers", () => {
    assert.equal(bodc.flagOf("''"), Flag.good);
    assert.equal(bodc.flagOf("'M'"), Flag.suspect);
    assert.equal(bodc.flagOf("'T'"), Flag.interpolated);
    assert.equal(bodc.flagOf("'N'"), null);
    assert.equal(bodc.flagOf("'L'"), Flag.suspect);
  });
});
