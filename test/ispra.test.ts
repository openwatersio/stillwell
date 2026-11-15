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
    // The archive lists no Arbatax, Cetraro or Pozzallo.
    assert.deepEqual(ids("arbatax-arb-ita-ispra"), []);
  });
});
