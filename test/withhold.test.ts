import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  readRecent,
  readStationBounds,
  readStationList,
  writeJsonArray,
  writeObservations,
  writeRecent,
  writeStationBounds,
} from "../src/lake/parquet.ts";
import {
  boundsPath,
  analysisHistoryPath,
  emptyYearsPath,
  recentPath,
  seriesPath,
  stationListPath,
  stationsPath,
} from "../src/lake/paths.ts";
import {
  AfterWrite,
  describeReport,
  listOf,
  needsPerson,
  withoutWithheld,
  publishStations,
  Refused,
  refreshSource,
  startedListOf,
} from "../src/refresh.ts";
import type { Erratum } from "../src/errata.ts";
import { JUDGE, RULES, readAnalysis, writeAnalysis } from "../src/lake/analysis.ts";
import { Flag, type ListedStation, type Source, type SourceMetadata } from "../src/schema.ts";
import * as gesla from "../src/sources/gesla/index.ts";
import * as uhslc from "../src/sources/uhslc/index.ts";
import {
  awsRemoveArgs,
  removePrefixes,
  seriesPrefixes,
  tooManyWithheld,
  withhold,
} from "../src/withhold.ts";

const metadata: SourceMetadata = {
  id: "test",
  name: "Test",
  url: "https://example.org",
  license: {
    id: "CC0-1.0",
    name: "CC0",
    url: "https://example.org",
    commercial_use: true,
    redistribution: true,
  },
  attribution: "Test",
  contact: { url: "https://example.org/contact" },
  hourly: true,
  finalizes: true,
};

const listed = (
  source: string,
  code: string,
  fields: Partial<ListedStation> & Record<string, unknown> = {},
): ListedStation => ({
  id: `${source}/${code}`,
  source,
  source_id: code,
  name: code,
  lat: 1,
  lon: 2,
  country_code: null,
  kind: "coastal",
  interval_s: 3600,
  datum: "ZERO",
  datums: {},
  products: ["levels"],
  first: null,
  last: null,
  license: "CC0-1.0",
  commercial_use: true,
  attribution: "Test",
  tide_station: null,
  same_as: [],
  status: "active",
  live: false,
  min_interval_s: null,
  source_url: null,
  ...fields,
});

/** A source listing `stations`, withholding the codes `refused` names. */
const sourceOf = (
  stations: ListedStation[],
  refused?: (code: string) => boolean,
  id = "test",
): Source => ({
  metadata: { ...metadata, id },
  stations: async () => stations,
  ...(refused && { withheld: (code: string) => (refused(code) ? "refused (#80)" : null) }),
});

const NOW = "2026-11-05T00:00:00Z";
const LATER = "2026-12-05T00:00:00Z";
const HOUR = 3_600_000;
const T = Date.UTC(2026, 10, 1);

let lake: string;
beforeEach(async () => {
  lake = await mkdtemp(join(tmpdir(), "lake-"));
});
afterEach(() => rm(lake, { recursive: true }));

describe("refreshSource with withheld stations", () => {
  it("drops them from the list, its snapshot, bounds and recent window, without tripping the shrink guard", async () => {
    // 20 active stations, 12 of them withheld: the 8 left would be a sharp shrink.
    const codes = Array.from({ length: 20 }, (_, i) => (i < 12 ? `x${i}` : `k${i}`));
    const all = codes.map((c) => listed("test", c));
    await refreshSource(lake, sourceOf(all), { now: NOW });
    await writeStationBounds(
      boundsPath(lake, "test"),
      ["test/x0", "test/k12"].map((id) => ({
        id,
        first: "2001-01-01T00:00:00Z",
        last: "2026-11-01T00:00:00Z",
        preliminary: null,
        screened: true,
      })),
    );
    await writeRecent(recentPath(lake, "test"), [
      ["test/x0", "test/k12"].map((station) => ({
        station,
        epoch: 1,
        time: T,
        level: 1,
        flag: Flag.preliminary,
      })),
    ]);
    await writeJsonArray(emptyYearsPath(lake, "test"), [
      { key: "test/x0 levels 1 1990", seen: NOW },
      { key: "test/k12 levels 1 1990", seen: NOW },
    ]);
    const verdict = (id: string) => ({
      id,
      analyzed: NOW,
      rules: RULES,
      judge: JUDGE,
      tidal: true,
      tide_m: 0.5,
      days: 366,
      drains: 0,
      requalified: null,
    });
    await writeAnalysis(lake, "test", [verdict("test/k12"), verdict("test/x0")]);
    const history = analysisHistoryPath(lake, "test", NOW);
    await writeJsonArray(history, [
      {
        rules: RULES,
        judge: JUDGE,
        changed: ["test/k12", "test/x0"].map((id) => ({ id, from: null, to: true, tide_m: 0.5 })),
      },
    ]);

    const refused = (code: string) => code.startsWith("x");
    const kept = all.filter((s) => !refused(s.source_id));
    // Twelve is more than the guard allows of 20 without --accept-withheld.
    await assert.rejects(
      refreshSource(lake, sourceOf(kept, refused), { now: LATER }),
      (error: Error) =>
        error instanceof Refused &&
        /12 of the 20 test stations .* --accept-withheld/.test(error.message),
    );
    const { stations, report } = await refreshSource(lake, sourceOf(kept, refused), {
      now: LATER,
      acceptWithheld: true,
    });
    assert.deepEqual(
      stations.map((s) => s.id),
      kept.map((s) => s.id),
    );
    assert.deepEqual(
      report.removed,
      codes
        .slice(0, 12)
        .map((c) => `test/${c}`)
        .sort(),
    );
    assert.deepEqual([report.retired, report.withdrawn], [[], []]);
    // The snapshot of the list it read leaves them out too.
    const [snapshot] = (await readdir(join(lake, "history/stations/test")))
      .filter((f) => f.endsWith(".parquet"))
      .sort()
      .slice(-1);
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    const snapshotIds = (
      await db.runAndReadAll(`SELECT id FROM '${join(lake, "history/stations/test", snapshot!)}'`)
    )
      .getRowObjectsJson()
      .map((r) => r.id);
    assert.equal(snapshotIds.length, 8);
    assert.deepEqual([...(await readStationBounds(boundsPath(lake, "test"))).keys()], ["test/k12"]);
    assert.deepEqual(
      (await readRecent(recentPath(lake, "test"))).map((r) => r.station),
      ["test/k12"],
    );
    assert.deepEqual(
      JSON.parse(await readFile(emptyYearsPath(lake, "test"), "utf8")).map(
        (r: { key: string }) => r.key,
      ),
      ["test/k12 levels 1 1990"],
    );
    // Its analysis, and the history of it, which carry the station's measures.
    assert.deepEqual([...(await readAnalysis(lake, "test")).keys()], ["test/k12"]);
    assert.deepEqual(
      JSON.parse(await readFile(history, "utf8"))[0].changed.map((c: { id: string }) => c.id),
      ["test/k12"],
    );
  });

  it("withholds exactly as many stations as the limit allows", async () => {
    // At least 5, or 2% of the stations known.
    assert.equal(tooManyWithheld("test", 5, 20), null);
    assert.match(tooManyWithheld("test", 6, 20) ?? "", /6 of the 20 .* more than 5/);
    assert.equal(tooManyWithheld("test", 14, 743), null);
    assert.match(tooManyWithheld("test", 15, 743) ?? "", /more than 14/);
    const all = Array.from({ length: 20 }, (_, i) => listed("test", i < 5 ? `x${i}` : `k${i}`));
    await refreshSource(lake, sourceOf(all), { now: NOW });
    const refused = (code: string) => code.startsWith("x");
    const { report } = await refreshSource(lake, sourceOf(all.slice(5), refused), { now: LATER });
    assert.equal(report.removed.length, 5);
  });

  it("still refuses a sharp shrink among the stations it keeps", async () => {
    const all = Array.from({ length: 40 }, (_, i) => listed("test", i < 2 ? `x${i}` : `k${i}`));
    await refreshSource(lake, sourceOf(all), { now: NOW });
    const refused = (code: string) => code.startsWith("x");
    await assert.rejects(
      refreshSource(lake, sourceOf(all.slice(2, 12), refused), { now: LATER }),
      (error: Error) =>
        error instanceof Refused && /lists 10 stations, down from 38/.test(error.message),
    );
  });

  it("leaves withheld stations out of a list read directly, as the TICON inventory does", () => {
    const source = sourceOf([], (code) => code === "x");
    const list = [listed("test", "x"), listed("test", "k")].map((s) => ({
      ...s,
      datum: s.datum!,
      epochs: [],
    }));
    assert.deepEqual(
      withoutWithheld(source, list).map((s) => s.id),
      ["test/k"],
    );
  });

  it("keeps withheld stations from the readers of a list it hasn't refreshed yet", async () => {
    await refreshSource(lake, sourceOf([listed("test", "x"), listed("test", "k")]), { now: NOW });
    const source = sourceOf([], (code) => code === "x");
    assert.deepEqual(
      (await listOf(lake, source)).map((s) => s.id),
      ["test/k"],
    );
    assert.deepEqual(
      (await startedListOf(lake, source))!.map((s) => s.id),
      ["test/k"],
    );
  });

  it("says the new list is written when dropping withheld rows fails after it", async () => {
    await refreshSource(lake, sourceOf([listed("test", "x"), listed("test", "k")]), { now: NOW });
    await writeStationBounds(boundsPath(lake, "test"), [
      { id: "test/x", first: "2000-01-01T00:00:00Z", last: "2000-01-01T00:00:00Z" },
    ]);
    // The bounds read, but can't be written back without x's row.
    const dir = join(lake, "stations/bounds");
    await chmod(dir, 0o555);
    try {
      await assert.rejects(
        refreshSource(
          lake,
          sourceOf([listed("test", "k")], (code) => code === "x"),
          { now: LATER },
        ),
        (error: Error) =>
          error instanceof AfterWrite &&
          /wrote the new list/.test(error.message) &&
          error.report.removed.join() === "test/x" &&
          /removed test\/x/.test(describeReport(error.report).join("\n")),
      );
    } finally {
      await chmod(dir, 0o755);
    }
    assert.deepEqual(
      (await readStationList(stationListPath(lake, "test")))!.map((s) => s.id),
      ["test/k"],
    );
  });

  it("leaves out a withheld station the source still lists", async () => {
    const refused = (code: string) => code === "x";
    const { stations } = await refreshSource(
      lake,
      sourceOf([listed("test", "x"), listed("test", "k")], refused),
      { now: NOW },
    );
    assert.deepEqual(
      stations.map((s) => s.id),
      ["test/k"],
    );
  });
});

describe("publishStations with withheld stations", () => {
  // Positions from UHSLC's lists.
  const luderitz = { lat: -26.6383, lon: 15.1525, name: "Luderitz" };
  const walvis = { lat: -22.95, lon: 14.5, name: "Walvis Bay" };
  const pohnpei = { lat: 6.98, lon: 158.2, name: "Pohnpei" };
  const geslaRecords = [
    ["luderitz-702-zaf-uhslc_fd", luderitz, "UHSLC_FD"],
    ["luderitz-702a-zaf-uhslc_rq", luderitz, "UHSLC_RQ"],
    ["walvis_bay-220-nam-uhslc_fd", walvis, "UHSLC_FD"],
    ["walvis_bay-220a-nam-uhslc_rq", walvis, "UHSLC_RQ"],
  ] as const;

  /** Lists as the lake holds them before a refresh with the rule: every record present. */
  async function seed(): Promise<void> {
    await refreshSource(
      lake,
      sourceOf(
        [
          listed("uhslc", "220", {
            ...walvis,
            contributor: "South Africa Navy Hydrographic Office (SANHO)",
          }),
          listed("uhslc", "702", { ...luderitz, contributor: null }),
          listed("uhslc", "001", { ...pohnpei, contributor: null }),
        ],
        undefined,
        "uhslc",
      ),
      { now: NOW },
    );
    await refreshSource(
      lake,
      sourceOf(
        geslaRecords.map(([file, at, contributor]) =>
          listed("gesla", file, {
            ...at,
            contributor,
            same_as: [
              `uhslc/${/-(\d{3})/.exec(file)![1]}`,
              ...geslaRecords
                .filter(([other]) => other !== file && other.slice(0, 5) === file.slice(0, 5))
                .map(([other]) => `gesla/${other}`),
            ],
          }),
        ),
        undefined,
        "gesla",
      ),
      { now: NOW },
    );
  }

  async function published(): Promise<Record<string, unknown>[]> {
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    return (
      await db.runAndReadAll(`SELECT id, same_as FROM '${stationsPath(lake)}' ORDER BY id`)
    ).getRowObjectsJson();
  }

  it("leaves SANHO's records out of stations.parquet, Walvis Bay's and Lüderitz's alike", async () => {
    await seed();
    const result = await publishStations(lake, [gesla.source, uhslc.source], [], []);
    assert.ok("count" in result);
    // Every Walvis Bay and Lüderitz series is SANHO's, UHSLC's own included.
    assert.deepEqual(await published(), [{ id: "uhslc/001", same_as: [] }]);
    // LINKS names stations this lake doesn't hold; none of SANHO's may be dropped as missing.
    const sanho = /walvis|luderitz|-zaf-|^uhslc\/(220|702)/;
    assert.deepEqual(
      result.links.dropped.filter((d) => sanho.test(d.from) || sanho.test(d.to)),
      [],
    );
  });

  it("doesn't count an erratum's withheld station as unknown", async () => {
    await seed();
    const erratum: Erratum = {
      id: "gesla-uhslc-positions",
      source: "gesla",
      stations: ["gesla/mossel_bay-185-zaf-uhslc_fd", "gesla/nowhere-999-xxx-uhslc_fd"],
      since: null,
      until: null,
      error: "",
      handling: "corrected",
      response: "",
      evidence: null,
      reported: null,
      report: null,
    };
    const result = await publishStations(lake, [gesla.source, uhslc.source], [], [erratum]);
    assert.deepEqual("count" in result && result.unknownErrata, [
      "gesla-uhslc-positions gesla/nowhere-999-xxx-uhslc_fd",
    ]);
  });

  it("drops them from the lists at the next refresh", async () => {
    await seed();
    const { report } = await refreshSource(
      lake,
      { ...uhslc.source, stations: async () => [listed("uhslc", "001", pohnpei)] },
      { now: LATER },
    );
    assert.deepEqual(report.removed, ["uhslc/220", "uhslc/702"]);
    assert.deepEqual(
      (await readStationList(stationListPath(lake, "uhslc")))!.map((s) => s.id),
      ["uhslc/001"],
    );
  });
});

describe("withhold", () => {
  const refused = (code: string) => code.startsWith("x");

  async function file(code: string, product: "levels" | "predictions", year: number, epoch = 1) {
    await writeObservations(
      seriesPath(lake, product, "test", code, year, epoch),
      [{ time: Date.UTC(year, 0, 1), level: 1, flag: Flag.good }],
      "ZERO",
    );
  }

  it("deletes exactly the withheld stations' directories, found through the list's history and the files", async () => {
    const all = ["x1", "x2", "k", "x1k"].map((c) => listed("test", c));
    await refreshSource(lake, sourceOf(all), { now: NOW });
    // The list as the next refresh reads it goes to history, with x1k, which has no files.
    await refreshSource(lake, sourceOf(all), { now: "2026-11-20T00:00:00Z" });
    await file("x1", "levels", 2000);
    await file("x1", "levels", 2001, 2);
    await file("x1", "predictions", 2000);
    await file("k", "levels", 2000);
    // An ID that only starts like a withheld one isn't another's directory.
    await file("kx1", "levels", 2000);
    await writeStationBounds(boundsPath(lake, "test"), [
      { id: "test/x1", first: "2000-01-01T00:00:00Z", last: "2001-01-01T00:00:00Z" },
      { id: "test/k", first: "2000-01-01T00:00:00Z", last: "2000-01-01T00:00:00Z" },
    ]);
    // The refresh drops them from the list first; history still has them.
    const source = sourceOf(
      all.filter((s) => !refused(s.source_id)),
      refused,
    );
    const { report } = await refreshSource(lake, source, { now: LATER });
    // x1's files are still there, so the report says to run `withhold`.
    assert.deepEqual(report.unwithheld, ["test/x1"]);
    assert.match(describeReport(report).join("\n"), /run `ingest withhold test`/);
    // The run fails until they're deleted, and the report kept in history says so too.
    assert.equal(needsPerson(report), true);
    assert.equal(needsPerson({ ...report, unwithheld: [] }), false);
    const [stored] = JSON.parse(
      await readFile(join(lake, "history/stations/test/2026-12-05T000000Z.json"), "utf8"),
    );
    assert.deepEqual(stored.unwithheld, ["test/x1"]);
    // A later refresh, with nothing left to remove, still asks.
    const again = await refreshSource(lake, source, { now: "2026-12-20T00:00:00Z" });
    assert.deepEqual([again.report.removed, again.report.unwithheld], [[], ["test/x1"]]);
    await file("x2", "levels", 2000);

    const removed: string[][] = [];
    const result = await withhold(lake, source, {
      remove: async (root, prefixes) => {
        removed.push(prefixes);
        await removePrefixes(root, prefixes);
      },
    });
    assert.deepEqual(result.ids, ["test/x1", "test/x1k", "test/x2"]);
    assert.deepEqual(
      removed[0],
      ["x1", "x1k", "x2"].flatMap((c) =>
        ["obs", "extremes", "predictions", "predicted-extremes"].map(
          (d) => `${lake}/${d}/test/${c}/`,
        ),
      ),
    );
    for (const dir of ["obs/test/x1", "obs/test/x2", "predictions/test/x1"])
      assert.equal(existsSync(join(lake, dir)), false, dir);
    for (const dir of ["obs/test/k/2000.parquet", "obs/test/kx1/2000.parquet"])
      assert.equal(existsSync(join(lake, dir)), true, dir);
    assert.deepEqual([...(await readStationBounds(boundsPath(lake, "test"))).keys()], ["test/k"]);
  });

  it("refuses a rule that withholds more stations than a mistake would explain", async () => {
    const all = Array.from({ length: 10 }, (_, i) => listed("test", `x${i}`));
    await refreshSource(lake, sourceOf(all), { now: NOW });
    const remove = async () => {
      removed++;
    };
    let removed = 0;
    await assert.rejects(
      withhold(lake, sourceOf([], refused), { remove }),
      /10 of the 10 test stations the lake has known are withheld, more than 5/,
    );
    assert.equal(removed, 0);
    // --accept-withheld, after checking the rule, lets it through.
    await withhold(lake, sourceOf([], refused), { remove, accept: true });
    assert.equal(removed, 1);
  });

  it("refuses a lake it can't delete from, rather than report success", async () => {
    const source = sourceOf([], refused);
    await assert.rejects(
      withhold("https://water-levels.openwaters.io", source, { remove: async () => {} }),
      /Can't delete files from https:/,
    );
    await assert.rejects(
      removePrefixes("https://water-levels.openwaters.io", [
        "https://water-levels.openwaters.io/obs/test/x/",
      ]),
      /Can't delete files from https:/,
    );
  });

  it("refuses an ID that would name more than one station's directory", () => {
    for (const id of ["", " ", ".", "..", "a*"])
      assert.throws(() => seriesPrefixes(lake, "test", [id]), /Refusing to delete/);
    assert.throws(() => seriesPrefixes(lake, "", ["a"]), /Not a source ID/);
    // A slash is encoded, so the ID stays one directory.
    assert.deepEqual(
      seriesPrefixes("s3://water-levels", "test", ["a/b"])[0],
      "s3://water-levels/obs/test/a%2Fb/",
    );
  });

  it("deletes an s3:// directory with the AWS CLI on the lake's endpoint", () => {
    assert.deepEqual(
      awsRemoveArgs("s3://water-levels/obs/gesla/durban-181-zaf-uhslc_fd/", "https://r2.example"),
      [
        "s3",
        "rm",
        "s3://water-levels/obs/gesla/durban-181-zaf-uhslc_fd/",
        "--recursive",
        "--endpoint-url",
        "https://r2.example",
        "--only-show-errors",
      ],
    );
    // DuckDB takes S3_ENDPOINT as a bare host too.
    assert.equal(
      awsRemoveArgs("s3://water-levels/obs/gesla/x/", "r2.example").at(-2),
      "https://r2.example",
    );
    assert.equal(
      awsRemoveArgs("s3://water-levels/obs/gesla/x/", "http://localhost:9000").at(-2),
      "http://localhost:9000",
    );
    for (const prefix of ["s3://water-levels/", "s3://water-levels/obs/gesla", "obs/gesla/x/"])
      assert.throws(() => awsRemoveArgs(prefix, "https://r2.example"), /isn't a directory/);
  });
});
