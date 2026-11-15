import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { fetchText, HttpError, setTransport } from "../src/http.ts";
import { Flag, type Station } from "../src/schema.ts";
import * as cmems from "../src/sources/cmems/index.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}`, import.meta.url));

/** Answer requests by the first pattern the URL matches; anything else is the bucket's 403. */
function serve(routes: [RegExp, string][]): string[] {
  const asked: string[] = [];
  setTransport(async (url) => {
    asked.push(url);
    const route = routes.find(([pattern]) => pattern.test(url));
    if (!route) throw new HttpError(`GET ${url} returned 403`, "");
    return route[1];
  });
  return asked;
}

/** A platform chunk as the Marine Data Store serves it, base64, from [time, value, qc] rows. */
function chunk(rows: [number, number | null, number][]): string {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE data (platform_id TEXT, platform_type TEXT, time INTEGER, longitude REAL, latitude REAL, elevation REAL, is_approx_elevation INTEGER, pressure REAL, value REAL, value_qc INTEGER)",
  );
  const insert = db.prepare("INSERT INTO data (time, value, value_qc) VALUES (?, ?, ?)");
  for (const r of rows) insert.run(...r);
  const bytes = db.serialize();
  db.close();
  return Buffer.from(bytes).toString("base64");
}

/** The STAC record's chunk layout for a dataset, with the real references and lengths. */
const stac = (part: string, ref: number, len: number) =>
  JSON.stringify({
    assets: {
      platformChunked: {
        href: `https://arco.test/${part}/platformChunked`,
        viewDims: { time: { chunkRefCoord: ref, chunkLen: { timeSeries: len } } },
      },
    },
  });

afterEach(() => setTransport(fetchText));

// Fixtures were recorded on 14 November 2026.
beforeEach(() => mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-11-14T20:00:00Z") }));
afterEach(() => mock.timers.reset());

describe("cmems", () => {
  it("indexes tide-gauge files with sea level by platform code, joining SHOM's interval files", () => {
    const row = (file: string, parameters = "DEPH SLEV") =>
      `COP-GLOBAL-01,X/history/${file},48.38,48.38,-4.49,-4.49,1997-05-20T13:41:00Z,2026-10-31T23:59:00Z,SHOM,2026-11-01T00:00:00Z,R,${parameters}`;
    const index = cmems.parseIndex(
      [
        "# product_id,file_name,…",
        row("TG/GL_TS_TG_BrestTG_01minute.nc"),
        row("TG/GL_TS_TG_BrestTG_60minute.nc"),
        row("TG/GL_TS_TG_IOC-erdek.nc"),
        row("MO/BO_TS_MO_Flinten16.nc"),
        row("TG/GL_TS_TG_NoLevel.nc", "TEMP"),
      ].join("\n"),
    );
    assert.deepEqual([...index.keys()], ["BrestTG", "IOC-erdek"]);
    assert.equal(index.get("BrestTG")!.length, 2);
  });

  it("refuses an index row it can't split", () => {
    const gauge =
      "COP-BO-01,X/history/TG/BO_TS_TG_Aarhus.nc,56.15,56.15,10.2,10.2,2005-01-01T00:00:00Z,2026-11-01T03:40:00Z,DMI, Denmark,2026-11-01T05:45:13Z,R,DEPH SLEV";
    assert.throws(() => cmems.parseIndex(gauge), /13 fields/);
    // Another platform's row is none of the store's, however it's split.
    const profile =
      "COP-AR-01,X/history/AD/AR_PR_AD_58GS.nc,57,80,-14,43,2017-03-01T18:17:20Z,2020-11-28T22:36:06Z,Institute, Tromsø,2025-11-24T16:36:42Z,R,DEPH EWCT NSCT";
    assert.equal(cmems.parseIndex(profile).size, 0);
  });

  it("lists every gauge, active where the latest window has a file, with its datum and credit", async () => {
    serve([
      [/index_history\.txt$/, fixture("cmems-index-history.txt").toString()],
      [/index_latest\.txt$/, fixture("cmems-index-latest.txt").toString()],
      [
        /BO_TS_TG_Aarhus_20261015\.nc$/,
        fixture("cmems-BO_TS_TG_Aarhus_20261015.nc").toString("base64"),
      ],
      [
        /NO_TS_TG_A121TG_20261015\.nc$/,
        fixture("cmems-NO_TS_TG_A121TG_20261015.nc").toString("base64"),
      ],
      [/history\/TG\/BO_TS_TG_Ahus\.nc$/, fixture("cmems-BO_TS_TG_Ahus.nc").toString("base64")],
      [
        /GL_TS_TG_AmbesTG_20261015\.nc$/,
        fixture("cmems-GL_TS_TG_AmbesTG_20261015.nc").toString("base64"),
      ],
    ]);
    const stations = await cmems.stations();
    assert.deepEqual(
      stations.map((s) => [
        s.id,
        s.name,
        s.datum,
        s.datum_information,
        s.institution,
        s.status,
        s.record_start,
        s.record_end,
        s.attribution,
      ]),
      [
        // In the latest window only, with a one-byte placeholder for its name.
        [
          "cmems/A121TG",
          "A121TG",
          "ZERO",
          "MSL",
          "Rijkswaterstaat Water- Traffic and Environment",
          "active",
          "2026-10-15",
          null,
          "E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00036; Rijkswaterstaat Water- Traffic and Environment",
        ],
        [
          "cmems/Aarhus",
          "Aarhus",
          "ZERO",
          "BSCD2000(DVR90)",
          "DMI",
          "active",
          "2005-01-01",
          null,
          "E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00036; DMI",
        ],
        // Stopped, so read from its history file; a Baltic name with letters
        // beyond ASCII gives way to the code (erratum `cmems-baltic-names`).
        [
          "cmems/Ahus",
          "Ahus",
          "ZERO",
          "BSCD2000",
          "SMHI",
          "inactive",
          "2010-12-16",
          "2012-05-30",
          "E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00036; SMHI",
        ],
        // SHOM's credit line is a condition of use, so it's in the attribution.
        [
          "cmems/AmbesTG",
          "AMBES",
          "ZERO",
          "chart datum",
          "Hydrographic and oceanographic service of the French navy",
          "active",
          "2008-09-06",
          null,
          'E.U. Copernicus Marine Service Information; https://doi.org/10.48670/moi-00036; Hydrographic and oceanographic service of the French navy; Data may be freely used providing that the source is mentioned as follows: "SHOM, year, name, DOI: http://dx.doi.org/10.17183/REFMAR#6118"',
        ],
      ],
    );
    assert.deepEqual(
      stations.map((s) => s.citation),
      [
        null,
        null,
        null,
        'Data may be freely used providing that the source is mentioned as follows: "SHOM, year, name, DOI: http://dx.doi.org/10.17183/REFMAR#6118"',
      ],
    );
    assert.ok(
      stations.every((s) => s.license === "LicenseRef-Copernicus-Marine" && s.commercial_use),
    );
  });

  it("keeps a stopped gauge's details from the store's list, and a file it can't read", async () => {
    const asked = serve([
      [/index_history\.txt$/, fixture("cmems-index-history.txt").toString()],
      [/index_latest\.txt$/, fixture("cmems-index-latest.txt").toString()],
      [
        /BO_TS_TG_Aarhus_20261015\.nc$/,
        fixture("cmems-BO_TS_TG_Aarhus_20261015.nc").toString("base64"),
      ],
    ]);
    const had = (code: string, record_end: string | null) =>
      ({
        source_id: code,
        name: `Old ${code}`,
        datum_information: "kept",
        citation: null,
        record_end,
      }) as unknown as Station;
    const stations = await cmems.stations([had("Ahus", "2012-05-30"), had("AmbesTG", null)]);
    const byId = new Map(stations.map((s) => [s.source_id, s]));
    // Stopped on the same day: not read again.
    assert.equal(byId.get("Ahus")!.name, "Old Ahus");
    assert.ok(!asked.some((url) => url.endsWith("BO_TS_TG_Ahus.nc")));
    // Its daily file is gone: the list's details stand.
    assert.equal(byId.get("AmbesTG")!.datum_information, "kept");
    // Not in the list and unreadable: named by its code.
    assert.deepEqual(
      [byId.get("A121TG")!.name, byId.get("A121TG")!.datum_information],
      ["A121TG", null],
    );
  });

  it("reads a stopped gauge again when the list holds no details from an earlier read", async () => {
    const asked = serve([
      [/index_history\.txt$/, fixture("cmems-index-history.txt").toString()],
      [/index_latest\.txt$/, fixture("cmems-index-latest.txt").toString()],
      [/history\/TG\/BO_TS_TG_Ahus\.nc$/, fixture("cmems-BO_TS_TG_Ahus.nc").toString("base64")],
    ]);
    const empty = {
      source_id: "Ahus",
      name: "Ahus",
      datum_information: null,
      citation: null,
      record_end: "2012-05-30",
    } as unknown as Station;
    const ahus = (await cmems.stations([empty])).find((s) => s.source_id === "Ahus")!;
    assert.ok(asked.some((url) => url.endsWith("BO_TS_TG_Ahus.nc")));
    assert.equal(ahus.datum_information, "BSCD2000");
  });

  it("refuses a file that names another licence", async () => {
    const aarhus = Buffer.from(fixture("cmems-BO_TS_TG_Aarhus_20261015.nc"));
    const url = "https://marine.copernicus.eu/user-corner/service-commitments-and-licence";
    const other = "https://example.org/".padEnd(url.length, "x");
    aarhus.write(other, aarhus.indexOf(url, 0, "latin1"), "latin1");
    serve([
      [/index_history\.txt$/, fixture("cmems-index-history.txt").toString()],
      [/index_latest\.txt$/, fixture("cmems-index-latest.txt").toString()],
      [/BO_TS_TG_Aarhus_20261015\.nc$/, aarhus.toString("base64")],
    ]);
    await assert.rejects(cmems.stations(), /Aarhus: .+ names the licence https:\/\/example\.org/);
  });

  it("refuses an empty index, or a latest index short of most active gauges", async () => {
    const history = fixture("cmems-index-history.txt").toString();
    const latest = fixture("cmems-index-latest.txt").toString();
    serve([
      [/index_history\.txt$/, "# header only\n"],
      [/index_latest\.txt$/, latest],
    ]);
    await assert.rejects(cmems.stations(), /history index lists no tide gauges/);
    serve([
      [/index_history\.txt$/, history],
      [/index_latest\.txt$/, "# header only\n"],
    ]);
    await assert.rejects(cmems.stations(), /latest index lists no tide gauges/);
    serve([
      [/index_history\.txt$/, history],
      [/index_latest\.txt$/, latest],
    ]);
    const active = Array.from(
      { length: 20 },
      (_, i) => ({ source_id: `G${i}`, status: "active" }) as Station,
    );
    await assert.rejects(cmems.stations(active), /latest index lists 3 tide gauges, the store 20/);
  });

  it("opens an epoch when the datum text changes, not its case or spacing", () => {
    const at = (datum_information: string | null) => ({ datum_information }) as unknown as Station;
    const changed = cmems.source.seriesChanged!;
    assert.match(changed(at("chart datum"), at("chart datum 2025")) ?? "", /changed from/);
    assert.equal(changed(at("Chart  Datum"), at("chart datum")), null);
    assert.equal(changed(at(null), at("MSL")), null);
    assert.equal(changed(at("MSL"), at(null)), null);
  });

  it("places a gauge at the middle of its file's span of positions", () => {
    const index = cmems.parseIndex(
      "COP-MO-01,X/history/TG/MO_TS_TG_ANDRATX.nc,39.5442,39.5462,2.37846,2.38539,2010-01-01T00:00:00Z,2026-11-01T00:00:00Z,SOCIB,2026-11-01T00:00:00Z,R,SLEV",
    );
    const [row] = index.get("ANDRATX")!;
    assert.deepEqual([row!.lat.toFixed(4), row!.lon.toFixed(5)], ["39.5452", "2.38192"]);
  });

  it("reads CRLF lines, and refuses a row with no position or a date that doesn't exist", () => {
    const row = (lat: string, start: string) =>
      `COP-BO-01,X/history/TG/BO_TS_TG_Aarhus.nc,56.15,${lat},10.2,10.2,${start},2026-11-01T03:40:00Z,DMI,2026-11-01T05:45:13Z,R,DEPH SLEV`;
    assert.equal(cmems.parseIndex(`${row("56.15", "2005-01-01T00:00:00Z")}\r\n`).size, 1);
    assert.throws(() => cmems.parseIndex(row("", "2005-01-01T00:00:00Z")), /bad position or time/);
    assert.throws(
      () => cmems.parseIndex(row("56.15", "2019-02-31T00:00:00Z")),
      /bad position or time/,
    );
  });

  describe("levels", () => {
    const HISTORY = [-5_359_651_200, 17_280_000] as const;
    const LATEST = [1_706_313_600, 691_200] as const;
    const t = (iso: string) => Date.parse(iso) / 1000;
    const index = ([ref, len]: readonly [number, number], iso: string) =>
      Math.floor((t(iso) - ref) / len);

    function routes(history: string, latest: string): [RegExp, string][] {
      return [
        [/--ext--history\/dataset\.stac\.json$/, stac("history", ...HISTORY)],
        [/--ext--latest\/dataset\.stac\.json$/, stac("latest", ...LATEST)],
        [
          new RegExp(
            `history/platformChunked/Aarhus___TG/SLEV/${index(HISTORY, "2026-10-31T00:00:00Z")}\\.0\\.0\\.0\\.sqlite$`,
          ),
          history,
        ],
        [
          new RegExp(
            `latest/platformChunked/Aarhus___TG/SLEV/${index(LATEST, "2026-10-31T00:00:00Z")}\\.0\\.0\\.0\\.sqlite$`,
          ),
          latest,
        ],
      ];
    }

    it("refuses a STAC record without the chunk layout it reads", async () => {
      // The layout is read once a run and a failed read isn't kept, so this goes first.
      serve([[/--ext--history\/dataset\.stac\.json$/, stac("history", Number.NaN, 0)]]);
      await assert.rejects(
        cmems.levels("Aarhus", new Date("2000-01-01Z"), new Date("2000-01-02Z")),
        /history STAC record has no chunk layout/,
      );
    });

    it("maps QC flags, keeps the history copy over the latest window, and marks the window preliminary", async () => {
      serve(
        routes(
          chunk([
            [t("2026-10-31T00:00:00Z"), 0.1, 1],
            [t("2026-10-31T00:10:00Z"), 0.2, 4],
            [t("2026-10-31T00:20:00Z"), 0.3, 9],
            [t("2026-10-31T00:30:00Z"), null, 1],
            [t("2026-10-31T00:40:00Z"), 0.123456, 0],
          ]),
          chunk([
            // A time the coarser history lacks: kept, preliminary.
            [t("2026-10-31T00:05:00Z"), 9, 1],
            // A time the history has: the history's value stands.
            [t("2026-10-31T00:40:00Z"), 9, 1],
            // After it: kept, preliminary however good.
            [t("2026-10-31T01:00:00Z"), 0.5, 1],
            [t("2026-10-31T01:10:00Z"), 0.6, 3],
          ]),
        ),
      );
      const values = await cmems.levels(
        "Aarhus",
        new Date("2026-10-31T00:00:00Z"),
        new Date("2026-11-01T00:00:00Z"),
      );
      assert.deepEqual(values, [
        { time: Date.parse("2026-10-31T00:00:00Z"), level: 0.1, flag: Flag.good },
        { time: Date.parse("2026-10-31T00:05:00Z"), level: 9, flag: Flag.preliminary },
        { time: Date.parse("2026-10-31T00:10:00Z"), level: 0.2, flag: Flag.bad },
        { time: Date.parse("2026-10-31T00:40:00Z"), level: 0.123456, flag: Flag.preliminary },
        { time: Date.parse("2026-10-31T01:00:00Z"), level: 0.5, flag: Flag.preliminary },
        { time: Date.parse("2026-10-31T01:10:00Z"), level: 0.6, flag: Flag.suspect },
      ]);
    });

    it("reads a span the history copy hasn't reached from the latest window alone", async () => {
      serve(routes(chunk([]), chunk([[t("2026-10-31T12:00:00Z"), 0.4, 1]])));
      const values = await cmems.levels(
        "Aarhus",
        new Date("2026-10-31T00:00:00Z"),
        new Date("2026-11-01T00:00:00Z"),
      );
      assert.deepEqual(values, [
        { time: Date.parse("2026-10-31T12:00:00Z"), level: 0.4, flag: Flag.preliminary },
      ]);
    });

    it("asks the latest window only for its last two months", async () => {
      const asked = serve(routes(chunk([]), chunk([])));
      await cmems.levels(
        "Aarhus",
        new Date("2025-10-01T00:00:00Z"),
        new Date("2025-10-02T00:00:00Z"),
      );
      assert.ok(asked.some((url) => url.includes("history/platformChunked")));
      assert.ok(!asked.some((url) => url.includes("latest/platformChunked")));
    });

    it("reads a chunk of minutes too large to spread into a call", async () => {
      const first = t("2026-10-15T00:00:00Z");
      const rows = Array.from(
        { length: 200_000 },
        (_, i) => [first + i * 60, 0.1, 1] as [number, number, number],
      );
      serve([
        [/--ext--history\/dataset\.stac\.json$/, stac("history", ...HISTORY)],
        [/--ext--latest\/dataset\.stac\.json$/, stac("latest", ...LATEST)],
        [/history\/platformChunked\/Aarhus___TG\/SLEV\//, chunk(rows)],
      ]);
      const values = await cmems.levels(
        "Aarhus",
        new Date(first * 1000),
        new Date((first + 200_000 * 60) * 1000),
      );
      assert.equal(values.length, 200_000);
    });

    it("asks nothing outside a stopped gauge's record", async () => {
      const asked = serve(routes(chunk([]), chunk([])));
      const values = await cmems.levels(
        "Aarhus",
        new Date("2026-10-31T00:00:00Z"),
        new Date("2026-11-01T00:00:00Z"),
        { record_start: "2005-01-01", record_end: "2012-05-30" },
      );
      assert.deepEqual(values, []);
      assert.deepEqual(asked, []);
    });

    it("refuses a station recorded in another datum", async () => {
      await assert.rejects(
        cmems.levels("Aarhus", new Date(0), new Date(1), { datum: "NAP" }),
        /measured from ZERO, not NAP/,
      );
    });
  });

  it("reads netCDF-4 text attributes, and no placeholder", () => {
    const aarhus = fixture("cmems-BO_TS_TG_Aarhus_20261015.nc");
    assert.equal(cmems.attribute(aarhus, "sea_level_datum"), "BSCD2000(DVR90)");
    assert.equal(cmems.attribute(aarhus, "platform_name"), "Aarhus");
    assert.equal(cmems.attribute(aarhus, "no_such_attribute"), null);
    assert.equal(cmems.attribute(fixture("cmems-BO_TS_TG_Ahus.nc"), "platform_name"), "Åhus mobi");
    // As the Baltic unit wrote it (erratum `cmems-baltic-names`).
    assert.equal(
      cmems.attribute(fixture("cmems-BO_TS_TG_Arko_20261015.nc"), "platform_name"),
      "Ark\uFFFD",
    );
    // SHOM's files write version 1 messages: names padded to 8 bytes, an 8-byte dataspace.
    const ambes = fixture("cmems-GL_TS_TG_AmbesTG_20261015.nc");
    assert.equal(cmems.attribute(ambes, "sea_level_datum"), "chart datum");
    assert.equal(cmems.attribute(ambes, "platform_name"), "AMBES");
    assert.match(cmems.attribute(ambes, "citation")!, /SHOM, year, name, DOI: .+REFMAR#6118/);
    assert.equal(
      cmems.attribute(fixture("cmems-NO_TS_TG_A121TG_20261015.nc"), "platform_name"),
      null,
    );
  });
});
