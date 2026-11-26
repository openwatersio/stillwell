import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { afterEach, describe, it } from "node:test";
import { fetchText, HttpError, setTransport } from "../src/http.ts";
import { Flag } from "../src/schema.ts";
import * as ispra from "../src/sources/ispra/index.ts";
import { originatorIds } from "../src/sources/gesla/index.ts";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

const requested: string[] = [];

/** The dump as the repository serves it, and one month of Napoli; every other month is a 404. */
function serve(): void {
  requested.length = 0;
  setTransport(async (url) => {
    requested.push(url);
    if (url.endsWith("rmn_dump.nt.gz"))
      return gzipSync(fixture("ispra-dump.nt")).toString("base64");
    if (url.endsWith("napoli_hydrometric_201401.csv")) return fixture("ispra-napoli-201401.csv");
    throw new HttpError(`GET ${url} returned 404`, "");
  });
}

afterEach(() => setTransport(fetchText));
ispra.pacing.requestMs = 0;

describe("ispra", () => {
  it("lists each gauge in the dump under the name of its files, with ISPRA's name and position", async () => {
    serve();
    const stations = await ispra.stations();
    assert.deepEqual(
      stations.map((s) => [s.id, s.name, s.lat, s.lon, s.datum, s.interval_s, s.live]),
      [
        ["ispra/ancona", "Ancona", 43.62477, 13.50652, "ZERO", 600, false],
        ["ispra/isole-tremiti", "Isole Tremiti", 42.11888, 15.50157, "ZERO", 600, false],
        ["ispra/la-spezia", "La Spezia", 44.09661, 9.85764, "ZERO", 600, false],
        ["ispra/napoli", "Napoli", 40.84141, 14.26919, "ZERO", 600, false],
      ],
    );
    assert.equal(stations[0]!.commercial_use, true);
    assert.equal(stations[0]!.license, "CC-BY-4.0");
  });

  it("reads centimeters as meters, flags every value preliminary, and skips listed months that 404", async () => {
    serve();
    const got = await ispra.levels(
      "napoli",
      new Date("2013-12-01T00:00:00Z"),
      new Date("2014-06-01T00:00:00Z"),
    );
    assert.equal(got.length, 12);
    assert.deepEqual(got[0], {
      time: Date.parse("2014-01-01T00:10:00Z"),
      level: -0.257,
      flag: Flag.preliminary,
    });
    assert.ok(got.every((o) => o.flag === Flag.preliminary));
    // The dump lists December 2013 and January to March and May 2014 for Napoli.
    assert.deepEqual(
      requested.filter((u) => u.includes("napoli_")).map((u) => u.slice(-10, -4)),
      ["201312", "201401", "201402", "201403", "201405"],
    );
  });

  it("asks only for the months a window overlaps, and keeps only its values", async () => {
    serve();
    const got = await ispra.levels(
      "napoli",
      new Date("2014-01-01T00:30:00Z"),
      new Date("2014-01-01T01:00:00Z"),
    );
    assert.deepEqual(
      got.map((o) => o.time),
      [
        Date.parse("2014-01-01T00:30:00Z"),
        Date.parse("2014-01-01T00:40:00Z"),
        Date.parse("2014-01-01T00:50:00Z"),
      ],
    );
    assert.equal(requested.filter((u) => u.endsWith(".csv")).length, 1);
  });

  it("fails on a file that isn't the CSV it expects, and on an error that isn't a 404", async () => {
    assert.throws(() => ispra.parse("Date;Value\r\n"), /starts "Date;Value"/);
    assert.throws(() => ispra.parse("UTC;Level\r\n2014-01-01 00:10:00;n/a\r\n"), /has the row/);
    setTransport(async (url) => {
      if (url.endsWith("rmn_dump.nt.gz"))
        return gzipSync(fixture("ispra-dump.nt")).toString("base64");
      throw new HttpError(`GET ${url} returned 500`, "");
    });
    await assert.rejects(
      ispra.levels("napoli", new Date("2014-01-01Z"), new Date("2014-02-01Z")),
      /returned 500/,
    );
  });

  it("refuses dates that don't exist, repeated times with another level, and rows of another shape", () => {
    const one = (row: string) => ispra.parse(`UTC;Level\r\n${row}\r\n`);
    assert.equal(one("2020-02-29 00:10:00;1.5")[0]!.level, 0.015);
    for (const row of [
      "2019-02-29 00:10:00;1",
      "2014-02-31 00:10:00;1",
      "2014-13-01 00:10:00;1",
      "2014-01-31 24:00:00;1",
      "2014-01-01 00:10:00;1;2",
      "2014-01-01 00:10:00;0x1F",
      "2014-01-01 00:10:00;",
    ])
      assert.throws(() => one(row), /has the row/, row);
    assert.equal(
      ispra.parse("UTC;Level\r\n2014-01-01 00:10:00;1\r\n2014-01-01 00:10:00;1.0\r\n").length,
      1,
    );
    // A time with two different levels, even within a millimeter, is dropped whole.
    const times = (text: string) => ispra.parse(text).map((o) => new Date(o.time).toISOString());
    assert.deepEqual(
      times(
        "UTC;Level\r\n2014-01-01 00:00:00;1\r\n2014-01-01 00:10:00;1\r\n2014-01-01 00:10:00;2\r\n2014-01-01 00:20:00;3\r\n2014-01-01 00:20:00;-25.71\r\n2014-01-01 00:20:00;-25.74\r\n",
      ),
      ["2014-01-01T00:00:00.000Z"],
    );
    // A first row with a date and no time is midnight.
    assert.deepEqual(ispra.parse("UTC;Level\r\n2015-01-01;-1.6\r\n2015-01-01 00:10:00;1.8\r\n"), [
      { time: Date.parse("2015-01-01T00:00:00Z"), level: -0.016, flag: Flag.preliminary },
      { time: Date.parse("2015-01-01T00:10:00Z"), level: 0.018, flag: Flag.preliminary },
    ]);
    assert.throws(() => one("2015-02-30;1"), /has the row/);
    // Midnight without a time is the first row's alone, and a blank row is a corrupt file.
    assert.throws(
      () => ispra.parse("UTC;Level\r\n2015-01-01 00:10:00;1\r\n2015-01-01;-1.6\r\n"),
      /has the row/,
    );
    assert.throws(
      () => ispra.parse("UTC;Level\r\n2015-01-01 00:10:00;1\r\n\r\n2015-01-01 00:20:00;2\r\n"),
      /has the row ""/,
    );
    assert.equal(ispra.parse("UTC;Level\r\n2015-01-01 00:10:00;1\r\n").length, 1);
  });

  it("reads the dump whatever its line ends and order, naming a gauge by its latest month", () => {
    const lines = fixture("ispra-dump.nt").trimEnd().split("\n");
    const plain = ispra.parseDump(lines.join("\n"));
    assert.deepEqual(ispra.parseDump(lines.join("\r\n")), plain);
    assert.deepEqual(ispra.parseDump([...lines].reverse().join("\n")), plain);
    const label = (month: string, name: string) =>
      `<https://w3id.org/italia/env/ld/rmn/observationseries/00105_na23_hydrometriclevel_${month}> <http://www.w3.org/2000/01/rdf-schema#label> "${name} - Water Level, March 2014"@en .`;
    const renamed = [...lines, label("201405", "Napoli Porto"), label("201301", "Napoli Vecchio")];
    assert.equal(ispra.parseDump(renamed.join("\n")).stations.get("napoli")!.name, "Napoli Porto");
    // A month the dump lists twice is asked for once.
    assert.deepEqual(ispra.parseDump([...lines, ...lines].join("\n")).months, plain.months);
  });

  it("maps every GESLA ISPRA record to a gauge of the archive, or to none where it lists none", () => {
    const gauges = new Set(fixture("ispra-gauges.txt").trim().split("\n"));
    // GESLA 4.1's ISPRA records, as the gesla source lists them.
    const records = fixture("ispra-gesla-records.txt").trim().split("\n");
    assert.equal(records.length, 39);
    const unlisted = records.filter((id) => {
      const mapped = ispra.idOfGeslaFile(id.slice("gesla/".length));
      assert.ok(mapped === null || gauges.has(mapped.slice("ispra/".length)), id);
      return mapped === null;
    });
    assert.deepEqual(unlisted, [
      "gesla/arbatax-arb-ita-ispra",
      "gesla/cetraro-cet-ita-ispra",
      "gesla/pozzallo-poz-ita-ispra",
    ]);
  });

  it("fails on a level file in the dump that it can't read, rather than drop its gauge", () => {
    const line = `<https://w3id.org/italia/env/ld/rmn/media/00105_na23_hydrometriclevel_201401> <https://w3id.org/italia/env/onto/top/hasDownloadURL> <https://rep.isprambiente.it/file/rmn/napoli_2_hydrometric_201401.csv> .`;
    assert.throws(() => ispra.parseDump(`${fixture("ispra-dump.nt")}${line}\n`), /can't read/);
  });

  it("refuses a gauge the dump doesn't list", async () => {
    serve();
    await assert.rejects(
      ispra.levels("arbatax", new Date("2014-01-01Z"), new Date("2014-02-01Z")),
      /lists no gauge arbatax/,
    );
  });

  it("links GESLA's ISPRA records to the gauge their file names, where the archive has it", () => {
    const ids = (file: string) => originatorIds("ISPRA", "x", 10, new Map(), file);
    assert.deepEqual(ids("napoli-nap-ita-ispra"), ["ispra/napoli"]);
    assert.deepEqual(ids("laspezia-las-ita-ispra"), ["ispra/la-spezia"]);
    assert.deepEqual(ids("tremiti-tre-ita-ispra"), ["ispra/isole-tremiti"]);
    assert.deepEqual(ids("reggio_calabria-reg-ita-ispra"), ["ispra/reggio-di-calabria"]);
    assert.deepEqual(ids("porto_empedocle-por-ita-ispra"), ["ispra/porto-empedocle"]);
    assert.deepEqual(ids("san_benedetto_del_tronto-san-ita-ispra"), [
      "ispra/san-benedetto-del-tronto",
    ]);
    assert.deepEqual(ids("palinuro-pal-ita-ispra"), ["ispra/palinuro"]);
    // The archive lists no Arbatax, Cetraro, Marzamemi, Milazzo or Pozzallo.
    for (const file of ["arbatax-arb", "pozzallo-poz", "milazzo-mil"])
      assert.deepEqual(ids(`${file}-ita-ispra`), []);
  });
});
