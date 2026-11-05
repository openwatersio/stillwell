import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { SourceMetadata, Station } from "../src/schema.ts";
import { sourceOf } from "../src/sources/index.ts";
import {
  readStationFiles,
  stationFile,
  stationSources,
  writeStationFiles,
} from "../src/station-files.ts";

const RWS: SourceMetadata = {
  id: "rws",
  name: "Rijkswaterstaat",
  url: "https://rijkswaterstaat.nl",
  license: {
    id: "CC0-1.0",
    name: "CC0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercial_use: true,
  },
  attribution: "Rijkswaterstaat",
};
const BSH: SourceMetadata = { ...RWS, id: "bsh" };

const station = (sourceId: string, fields: Partial<Station> = {}): Station => ({
  source: "rws",
  license: "CC0-1.0",
  commercial_use: true,
  attribution: "Rijkswaterstaat",
  id: `rws/${sourceId}`,
  source_id: sourceId,
  name: "Hoek van Holland",
  lat: 51.98,
  lon: 4.12,
  country_code: "NL",
  kind: null,
  interval_s: 600,
  datum: "NAP",
  datums: {},
  products: ["levels", "extremes"],
  first: null,
  last: null,
  tide_station: null,
  same_as: [],
  status: "active",
  live: true,
  min_interval_s: 300,
  source_url: null,
  ...fields,
});

describe("station files", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "stations-"));
  });
  afterEach(() => rm(dir, { recursive: true }));

  it("reads back what it wrote, leaving out the path's fields, nulls and empties", async () => {
    const stations = [
      station("a", { datums: { LAT: -1.2 }, same_as: ["pegelonline/1"] }),
      station("b", { kind: "coastal", tide_station: "ticon/b" }),
    ];
    assert.equal(await writeStationFiles(dir, RWS, stations), 2);
    assert.deepEqual(await readStationFiles(dir, RWS), stations);
    assert.deepEqual(await stationSources(dir), ["rws"]);
    assert.equal(
      await readFile(join(dir, "rws/a.yml"), "utf8"),
      `name: Hoek van Holland
lat: 51.98
lon: 4.12
country_code: NL
datum: NAP
datums:
  LAT: -1.2
products: [levels, extremes]
interval_s: 600
min_interval_s: 300
live: true
status: active
same_as: [pegelonline/1]
`,
    );
  });

  it("keeps the lake's first and last out of the file", async () => {
    await writeStationFiles(dir, RWS, [station("a", { first: "2000-01-01T00:00:00Z" })]);
    assert.equal(await writeStationFiles(dir, RWS, [station("a", { last: "2026-01-01" })]), 0);
    assert.equal((await readStationFiles(dir, RWS))[0]!.first, null);
  });

  it("leaves out its source's terms unless the station's differ", async () => {
    const restricted = station("b", { license: "Custom", commercial_use: false });
    await writeStationFiles(dir, RWS, [station("a"), restricted]);
    assert.doesNotMatch(
      await readFile(join(dir, "rws/a.yml"), "utf8"),
      /license|commercial_use|attribution/,
    );
    const text = await readFile(join(dir, "rws/b.yml"), "utf8");
    assert.match(text, /^license: Custom$/m);
    assert.match(text, /^commercial_use: false$/m);
    assert.doesNotMatch(text, /attribution/);
    assert.deepEqual(await readStationFiles(dir, RWS), [station("a"), restricted]);
    // A source whose terms change takes every station that didn't set its own.
    const open = { ...RWS, license: { ...RWS.license, id: "CC-BY-4.0" } };
    assert.deepEqual(
      (await readStationFiles(dir, open)).map((s) => s.license),
      ["CC-BY-4.0", "Custom"],
    );
  });

  it("keeps a source's own fields, after the shared ones", async () => {
    const coops = { ...station("9447130"), established: "1899-01-01T00:00:00Z", removed: null };
    await writeStationFiles(dir, RWS, [coops]);
    const text = await readFile(join(dir, "rws/9447130.yml"), "utf8");
    assert.match(text, /status: active\nestablished: 1899-01-01T00:00:00Z\n$/);
    const [read] = await readStationFiles(dir, RWS);
    assert.equal((read as Station & { established?: string }).established, coops.established);
  });

  it("rewrites only changed files, keeping a person's comments", async () => {
    await writeStationFiles(dir, RWS, [station("a"), station("b")]);
    const path = join(dir, "rws/a.yml");
    const edited = (await readFile(path, "utf8")).replace(
      "status: active",
      "# Back in NAP after the 2026 survey; see #12.\nstatus: active",
    );
    await writeFile(path, edited);
    assert.equal(await writeStationFiles(dir, RWS, [station("a"), station("b")]), 0);
    assert.equal(await readFile(path, "utf8"), edited);

    const moved = [station("a", { lat: 52 }), station("b")];
    assert.equal(await writeStationFiles(dir, RWS, moved), 1);
    const text = await readFile(path, "utf8");
    assert.match(text, /^lat: 52$/m);
    assert.match(text, /# Back in NAP after the 2026 survey; see #12.\nstatus: active/);
  });

  it("keeps a comment on a value that changed, and one on a field that's gone", async () => {
    const path = join(dir, "rws/a.yml");
    await writeStationFiles(dir, RWS, [station("a", { datums: { LAT: -1.2, MSL: 0.1 } })]);
    await writeFile(
      path,
      (await readFile(path, "utf8"))
        .replace("status: active", "status: active # survey pending")
        .replace("  LAT: -1.2", "  # from the 2026 survey\n  LAT: -1.2")
        .replace("country_code: NL", "# checked by hand\ncountry_code: NL"),
    );
    const next = station("a", {
      status: "inactive",
      country_code: null,
      datums: { LAT: -1.2, MSL: 0.2 },
    });
    assert.equal(await writeStationFiles(dir, RWS, [next]), 1);
    const text = await readFile(path, "utf8");
    assert.match(text, /^status: inactive # survey pending$/m);
    assert.match(text, /# from the 2026 survey\n  LAT: -1.2\n  MSL: 0.2\n/);
    assert.match(text, /# checked by hand\ndatum: NAP/);
    assert.deepEqual(await readStationFiles(dir, RWS), [next]);
  });

  it("quotes a code that changed to look like a number", async () => {
    await writeStationFiles(dir, RWS, [station("a", { name: "Pier" })]);
    await writeStationFiles(dir, RWS, [station("a", { name: "52" })]);
    assert.equal((await readStationFiles(dir, RWS))[0]!.name, "52");
  });

  it("deletes nothing, so a station the merge dropped keeps its file", async () => {
    await writeStationFiles(dir, RWS, [station("a"), station("b")]);
    await writeStationFiles(dir, RWS, [station("a")]);
    assert.deepEqual((await readdir(join(dir, "rws"))).sort(), ["a.yml", "b.yml"]);
  });

  it("URL-encodes a source_id in the file name", async () => {
    const odd = station("x/y z", { id: "rws/x/y z" });
    await writeStationFiles(dir, RWS, [odd]);
    assert.equal(stationFile(dir, "rws", "x/y z"), join(dir, "rws/x%2Fy%20z.yml"));
    assert.deepEqual(await readStationFiles(dir, RWS), [odd]);
  });

  it("refuses two codes that would share a file on a case-insensitive disk", async () => {
    await assert.rejects(
      writeStationFiles(dir, RWS, [station("ab"), station("AB", { id: "rws/AB" })]),
      /rws\/AB and rws\/ab/,
    );
  });

  it("writes nothing when it refuses a list", async () => {
    await assert.rejects(
      writeStationFiles(dir, RWS, [station("a"), station("ab"), station("AB", { id: "rws/AB" })]),
    );
    assert.deepEqual(await stationSources(dir), []);
  });

  it("refuses a file not named as it writes them, and skips hidden ones", async () => {
    await writeStationFiles(dir, RWS, [station("a")]);
    await writeFile(join(dir, "rws/.DS_Store"), "");
    assert.equal((await readStationFiles(dir, RWS)).length, 1);
    for (const name of ["b.yaml", "50%.yml", "a b.yml"]) {
      await writeFile(join(dir, "rws", name), "name: x\n");
      await assert.rejects(readStationFiles(dir, RWS), new RegExp(name.replace(".", "\\.")));
      await rm(join(dir, "rws", name));
    }
  });

  it("names the file it can't parse", async () => {
    await writeStationFiles(dir, RWS, [station("a")]);
    await writeFile(join(dir, "rws/a.yml"), "name: [\n");
    await assert.rejects(readStationFiles(dir, RWS), /a\.yml/);
  });

  it("refuses a hand edit that isn't a station's field", async () => {
    await writeStationFiles(dir, RWS, [station("a")]);
    const path = join(dir, "rws/a.yml");
    const good = await readFile(path, "utf8");
    for (const [from, to, why] of [
      ["products: [levels, extremes]", "products: levels", /products is "levels"/],
      ["status: active", "status: active\ncommercial_use: no", /commercial_use is "no"/],
      ["name: Hoek van Holland\n", "", /name is missing/],
      ["status: active", "status: active\nfirst: 2000-01-01", /first doesn't belong/],
    ] as const) {
      await writeFile(path, good.replace(from, to));
      await assert.rejects(readStationFiles(dir, RWS), why);
    }
  });

  it("refuses a code that would be a hidden file", async () => {
    for (const code of ["", ".x"])
      await assert.rejects(writeStationFiles(dir, RWS, [station(code)]), /would be a hidden file/);
  });

  it("puts a list too long for one line on several, as Prettier would", async () => {
    const links = [
      "pegelonline/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "pegelonline/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "bsh/cccccccccccccccc",
    ];
    await writeStationFiles(dir, RWS, [station("a", { same_as: links })]);
    const text = await readFile(join(dir, "rws/a.yml"), "utf8");
    assert.match(text, /^same_as:\n  - pegelonline\/a+\n/m);
    assert.match(text, /^products: \[levels, extremes\]$/m);
  });

  it("writes nothing for a list with a station ingest would refuse", async () => {
    await assert.rejects(
      writeStationFiles(dir, RWS, [station("a"), station("b", { lat: null as unknown as number })]),
      /rws\/b: lat is missing/,
    );
    assert.deepEqual(await stationSources(dir), []);
  });

  it("rewrites a file whose alias lost its anchor", async () => {
    await writeStationFiles(dir, RWS, [station("a", { source_url: "NL" })]);
    const path = join(dir, "rws/a.yml");
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text
        .replace("country_code: NL", "country_code: &c NL")
        .replace("source_url: NL", "source_url: *c"),
    );
    const next = station("a", { country_code: null, source_url: "NL" });
    assert.equal(await writeStationFiles(dir, RWS, [next]), 1);
    assert.deepEqual(await readStationFiles(dir, RWS), [next]);
  });

  it("refuses a list in another layout beside the source directories", async () => {
    await writeStationFiles(dir, RWS, [station("a")]);
    await writeFile(join(dir, ".DS_Store"), "");
    assert.deepEqual(await stationSources(dir), ["rws"]);
    await writeFile(join(dir, "usgs.json"), "[]");
    await assert.rejects(stationSources(dir), /usgs\.json isn't a directory/);
  });

  it("writes a hand-written flow map of datums in block style when it changes", async () => {
    const path = join(dir, "rws/a.yml");
    await writeStationFiles(dir, RWS, [station("a", { datums: { LAT: -1.2 } })]);
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace("datums:\n  LAT: -1.2", "datums: { LAT: -1.2 }"),
    );
    await writeStationFiles(dir, RWS, [station("a", { datums: { LAT: -1.3 } })]);
    assert.match(await readFile(path, "utf8"), /^datums:\n  LAT: -1.3$/m);
  });

  it("reads no stations for a source with no directory", async () => {
    assert.deepEqual(await readStationFiles(dir, BSH), []);
  });
});

describe("the committed station files", () => {
  // Hand edits are checked here, before they reach an hourly run.
  it("all read as stations", async () => {
    const dir = join(import.meta.dirname, "../stations");
    for (const source of await stationSources(dir))
      assert.ok((await readStationFiles(dir, sourceOf(source).metadata)).length, source);
  });
});
