import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  readRecent,
  readStationBounds,
  readStationList,
  readJsonArray,
  writeJsonArray,
  writeObservations,
  writeRecent,
  writeStationBounds,
  writeStationList,
} from "../src/store/parquet.ts";
import {
  boundsPath,
  analysisHistoryPath,
  emptyYearsPath,
  recentDayPath,
  recentDays,
  requalifyLeftPath,
  backfilledPath,
  linksPath,
  matchesPath,
  seriesPath,
  stationListPath,
  stationsPath,
} from "../src/store/paths.ts";
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
import { JUDGE, RULES, readAnalysis, writeAnalysis } from "../src/store/analysis.ts";
import type { Fit, FittedCandidate } from "../src/fit/fit.ts";
import { readConstituents, readFits, writeFits } from "../src/fit/store.ts";
import { Flag, type ListedStation, type Source, type SourceMetadata } from "../src/schema.ts";
import * as gesla from "../src/sources/gesla/index.ts";
import * as uhslc from "../src/sources/uhslc/index.ts";
import { deletesFiles, isDropped, KEEP_FILES } from "../src/sources/gesla/dropped.ts";
import { readYears, writeYears } from "../src/store/years.ts";
import { readLinks, writeLinks, type LinkOffset } from "../src/links.ts";
import { readMatches, writeMatches, type DataMatch } from "../src/matches.ts";
import {
  awsRemoveArgs,
  dropFiles,
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

let store: string;
beforeEach(async () => {
  store = await mkdtemp(join(tmpdir(), "store-"));
});
afterEach(() => rm(store, { recursive: true }));

const fitted = (id: string) =>
  ({
    id,
    fitted: "2026-11-25T00:00:00.000Z",
    reason: null,
    version: "v",
    engine: "e",
    inputs: "{}",
  }) as Fit;
const candidate = (id: string) =>
  ({
    id,
    version: "v",
    name: "M2",
    rank: 1,
    doodson: [2, 0, 0, 0, 0, 0, 0],
    speed: 28.9841042,
    kept: true,
  }) as FittedCandidate;

describe("refreshSource with withheld stations", () => {
  it("drops them from the list, its snapshot, bounds and daily files, without tripping the shrink guard", async () => {
    // 20 active stations, 12 of them withheld: the 8 left would be a sharp shrink.
    const codes = Array.from({ length: 20 }, (_, i) => (i < 12 ? `x${i}` : `k${i}`));
    const all = codes.map((c) => listed("test", c));
    await refreshSource(store, sourceOf(all), { now: NOW });
    await writeStationBounds(
      boundsPath(store, "test"),
      ["test/x0", "test/k12"].map((id) => ({
        id,
        first: "2001-01-01T00:00:00Z",
        last: "2026-11-01T00:00:00Z",
        preliminary: null,
        screened: true,
      })),
    );
    // Yesterday and today, and a day older than the last 30 that only a listing finds; the day between has no file.
    const days = [...recentDays(Date.now(), 3).filter((_, i) => i !== 1), "2020-01-01"];
    for (const day of days)
      await writeRecent(recentDayPath(store, "test", day), [
        ["test/x0", "test/k12"].map((station) => ({
          station,
          epoch: 1,
          time: T,
          level: 1,
          flag: Flag.preliminary,
        })),
      ]);
    await writeJsonArray(emptyYearsPath(store, "test"), [
      { key: "test/x0 levels 1 1990", seen: NOW },
      { key: "test/k12 levels 1 1990", seen: NOW },
    ]);
    await writeJsonArray(requalifyLeftPath(store, "test"), [
      { id: "test/x0", start: 2026, end: 2027 },
      { id: "test/k12", start: 2026, end: 2027 },
    ]);
    await writeJsonArray(backfilledPath(store, "test"), [
      { id: "test/x0", years: [[1990, 2027]] },
      { id: "test/k12", years: [[1990, 2027]] },
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
      step_s: 600,
      sea_level: null,
      requalified: null,
    });
    await writeAnalysis(store, "test", [verdict("test/k12"), verdict("test/x0")]);
    await writeFits(
      store,
      "test",
      [fitted("test/k12"), fitted("test/x0")],
      [candidate("test/k12"), candidate("test/x0")],
    );
    const history = analysisHistoryPath(store, "test", NOW);
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
      refreshSource(store, sourceOf(kept, refused), { now: LATER }),
      (error: Error) =>
        error instanceof Refused &&
        /12 of the 20 test stations .* --accept-withheld/.test(error.message),
    );
    const { stations, report } = await refreshSource(store, sourceOf(kept, refused), {
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
    const [snapshot] = (await readdir(join(store, "history/stations/test")))
      .filter((f) => f.endsWith(".parquet"))
      .sort()
      .slice(-1);
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    const snapshotIds = (
      await db.runAndReadAll(`SELECT id FROM '${join(store, "history/stations/test", snapshot!)}'`)
    )
      .getRowObjectsJson()
      .map((r) => r.id);
    assert.equal(snapshotIds.length, 8);
    assert.deepEqual(
      [...(await readStationBounds(boundsPath(store, "test"))).keys()],
      ["test/k12"],
    );
    for (const day of days)
      assert.deepEqual(
        (await readRecent(recentDayPath(store, "test", day))).map((r) => r.station),
        ["test/k12"],
        day,
      );
    assert.deepEqual(
      JSON.parse(await readFile(emptyYearsPath(store, "test"), "utf8")).map(
        (r: { key: string }) => r.key,
      ),
      ["test/k12 levels 1 1990"],
    );
    assert.deepEqual(
      JSON.parse(await readFile(requalifyLeftPath(store, "test"), "utf8")).map(
        (r: { id: string }) => r.id,
      ),
      ["test/k12"],
    );
    assert.deepEqual(
      JSON.parse(await readFile(backfilledPath(store, "test"), "utf8")).map(
        (r: { id: string }) => r.id,
      ),
      ["test/k12"],
    );
    // Its analysis, and the history of it, which carry the station's measures.
    assert.deepEqual([...(await readAnalysis(store, "test")).keys()], ["test/k12"]);
    // Constants fitted to a withheld station's values leave with them.
    assert.deepEqual([...(await readFits(store, "test")).keys()], ["test/k12"]);
    assert.deepEqual(
      (await readConstituents(store, "test")).map((c) => c.id),
      ["test/k12"],
    );
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
    await refreshSource(store, sourceOf(all), { now: NOW });
    const refused = (code: string) => code.startsWith("x");
    const { report } = await refreshSource(store, sourceOf(all.slice(5), refused), { now: LATER });
    assert.equal(report.removed.length, 5);
  });

  it("still refuses a sharp shrink among the stations it keeps", async () => {
    const all = Array.from({ length: 40 }, (_, i) => listed("test", i < 2 ? `x${i}` : `k${i}`));
    await refreshSource(store, sourceOf(all), { now: NOW });
    const refused = (code: string) => code.startsWith("x");
    await assert.rejects(
      refreshSource(store, sourceOf(all.slice(2, 12), refused), { now: LATER }),
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
    await refreshSource(store, sourceOf([listed("test", "x"), listed("test", "k")]), { now: NOW });
    const source = sourceOf([], (code) => code === "x");
    assert.deepEqual(
      (await listOf(store, source)).map((s) => s.id),
      ["test/k"],
    );
    assert.deepEqual(
      (await startedListOf(store, source))!.map((s) => s.id),
      ["test/k"],
    );
  });

  it("says the new list is written when dropping withheld rows fails after it", async () => {
    await refreshSource(store, sourceOf([listed("test", "x"), listed("test", "k")]), { now: NOW });
    await writeStationBounds(boundsPath(store, "test"), [
      { id: "test/x", first: "2000-01-01T00:00:00Z", last: "2000-01-01T00:00:00Z" },
    ]);
    // The bounds read, but can't be written back without x's row.
    const dir = join(store, "stations/bounds");
    await chmod(dir, 0o555);
    try {
      await assert.rejects(
        refreshSource(
          store,
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
      (await readStationList(stationListPath(store, "test")))!.map((s) => s.id),
      ["test/k"],
    );
  });

  it("leaves out a withheld station the source still lists", async () => {
    const refused = (code: string) => code === "x";
    const { stations } = await refreshSource(
      store,
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

  /** Lists as the store holds them before a refresh with the rule: every record present. */
  async function seed(): Promise<void> {
    await refreshSource(
      store,
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
      store,
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
      await db.runAndReadAll(`SELECT id, same_as FROM '${stationsPath(store)}' ORDER BY id`)
    ).getRowObjectsJson();
  }

  it("leaves SANHO's records out of stations.parquet, Walvis Bay's and Lüderitz's alike", async () => {
    await seed();
    const result = await publishStations(store, [gesla.source, uhslc.source], [], []);
    assert.ok("count" in result);
    // Every Walvis Bay and Lüderitz series is SANHO's, UHSLC's own included.
    assert.deepEqual(await published(), [{ id: "uhslc/001", same_as: [] }]);
    // LINKS names stations this store doesn't hold; none of SANHO's may be dropped as missing.
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
      fit: null,
    };
    const result = await publishStations(store, [gesla.source, uhslc.source], [], [erratum]);
    assert.deepEqual("count" in result && result.unknownErrata, [
      "gesla-uhslc-positions gesla/nowhere-999-xxx-uhslc_fd",
    ]);
  });

  it("drops them from the lists at the next refresh", async () => {
    await seed();
    const { report } = await refreshSource(
      store,
      { ...uhslc.source, stations: async () => [listed("uhslc", "001", pohnpei)] },
      { now: LATER },
    );
    assert.deepEqual(report.removed, ["uhslc/220", "uhslc/702"]);
    assert.deepEqual(
      (await readStationList(stationListPath(store, "uhslc")))!.map((s) => s.id),
      ["uhslc/001"],
    );
  });
});

describe("withhold", () => {
  const refused = (code: string) => code.startsWith("x");

  async function file(code: string, product: "levels" | "predictions", year: number, epoch = 1) {
    await writeObservations(
      seriesPath(store, product, "test", code, year, epoch),
      [{ time: Date.UTC(year, 0, 1), level: 1, flag: Flag.good }],
      "ZERO",
    );
  }

  it("deletes exactly the withheld stations' directories, found through the list's history and the files", async () => {
    const all = ["x1", "x2", "k", "x1k"].map((c) => listed("test", c));
    await refreshSource(store, sourceOf(all), { now: NOW });
    // The list as the next refresh reads it goes to history, with x1k, which has no files.
    await refreshSource(store, sourceOf(all), { now: "2026-11-20T00:00:00Z" });
    await file("x1", "levels", 2000);
    await file("x1", "levels", 2001, 2);
    await file("x1", "predictions", 2000);
    await file("k", "levels", 2000);
    // An ID that only starts like a withheld one isn't another's directory.
    await file("kx1", "levels", 2000);
    await writeStationBounds(boundsPath(store, "test"), [
      { id: "test/x1", first: "2000-01-01T00:00:00Z", last: "2001-01-01T00:00:00Z" },
      { id: "test/k", first: "2000-01-01T00:00:00Z", last: "2000-01-01T00:00:00Z" },
    ]);
    // The refresh drops them from the list first; history still has them.
    const source = sourceOf(
      all.filter((s) => !refused(s.source_id)),
      refused,
    );
    const { report } = await refreshSource(store, source, { now: LATER });
    // x1's files are still there, so the report says to run `withhold`.
    assert.deepEqual(report.unwithheld, ["test/x1"]);
    assert.match(describeReport(report).join("\n"), /run `ingest withhold test`/);
    // The run fails until they're deleted, and the report kept in history says so too.
    assert.equal(needsPerson(report), true);
    assert.equal(needsPerson({ ...report, unwithheld: [] }), false);
    const [stored] = JSON.parse(
      await readFile(join(store, "history/stations/test/2026-12-05T000000Z.json"), "utf8"),
    );
    assert.deepEqual(stored.unwithheld, ["test/x1"]);
    // A later refresh, with nothing left to remove, still asks.
    const again = await refreshSource(store, source, { now: "2026-12-20T00:00:00Z" });
    assert.deepEqual([again.report.removed, again.report.unwithheld], [[], ["test/x1"]]);
    await file("x2", "levels", 2000);

    const removed: string[][] = [];
    const result = await withhold(store, source, {
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
          (d) => `${store}/${d}/test/${c}/`,
        ),
      ),
    );
    for (const dir of ["obs/test/x1", "obs/test/x2", "predictions/test/x1"])
      assert.equal(existsSync(join(store, dir)), false, dir);
    for (const dir of ["obs/test/k/2000.parquet", "obs/test/kx1/2000.parquet"])
      assert.equal(existsSync(join(store, dir)), true, dir);
    assert.deepEqual([...(await readStationBounds(boundsPath(store, "test"))).keys()], ["test/k"]);
  });

  it("drops the files of the stations a rule names, and only lists them on a dry run", async () => {
    const all = ["d1", "d2", "keep", "k"].map((c) => listed("test", c));
    await refreshSource(store, sourceOf(all), { now: NOW });
    await file("d1", "levels", 2000);
    await file("d1", "levels", 2001, 2);
    await file("keep", "levels", 2000);
    await file("k", "levels", 2000);
    // d2 has no files, so there's nothing to delete for it.
    const drop = (code: string) => code.startsWith("d");
    await writeYears(store, "test", [
      { id: "test/d1", epoch: 1, year: 2000 },
      { id: "test/k", epoch: 1, year: 2000 },
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
      step_s: 600,
      sea_level: null,
      requalified: null,
    });
    await writeAnalysis(store, "test", [verdict("test/d1"), verdict("test/k")]);
    await writeFits(
      store,
      "test",
      [fitted("test/d1"), fitted("test/k")],
      [candidate("test/d1"), candidate("test/k")],
    );
    // d2's ranges stay from a drop before it cleared them.
    const ranges = (id: string) => ({ id, epoch: 1, years: [[1990, 2027]] });
    await writeJsonArray(backfilledPath(store, "test"), [
      ranges("test/d1"),
      ranges("test/d2"),
      ranges("test/k"),
    ]);
    const recorded = async () =>
      ((await readJsonArray(backfilledPath(store, "test"))) as { id: string }[]).map((r) => r.id);
    const removed: string[][] = [];
    const remove = async (root: string, prefixes: string[]) => {
      removed.push(prefixes);
      await removePrefixes(root, prefixes);
    };
    const dry = await dropFiles(store, "test", drop, { remove, dryRun: true });
    assert.deepEqual(dry.ids, ["test/d1"]);
    assert.deepEqual(dry.cleared, ["test/d1", "test/d2"]);
    assert.equal(removed.length, 0);
    assert.equal(existsSync(join(store, "obs/test/d1/2000.parquet")), true);
    assert.deepEqual(await recorded(), ["test/d1", "test/d2", "test/k"]);
    const done = await dropFiles(store, "test", drop, { remove });
    assert.deepEqual(done.prefixes, dry.prefixes);
    assert.deepEqual(
      removed[0],
      ["obs", "extremes", "predictions", "predicted-extremes"].map((d) => `${store}/${d}/test/d1/`),
    );
    assert.equal(existsSync(join(store, "obs/test/d1")), false);
    assert.deepEqual(
      [...(await readYears(store, "test"))!.keys()].map((k) => k.split(" ")[0]),
      ["test/k"],
    );
    assert.deepEqual([...(await readAnalysis(store, "test")).keys()], ["test/k"]);
    assert.deepEqual([...(await readFits(store, "test")).keys()], ["test/k"]);
    assert.deepEqual(
      (await readConstituents(store, "test")).map((c) => c.id),
      ["test/k"],
    );
    assert.deepEqual(await recorded(), ["test/k"]);
    for (const dir of ["obs/test/keep/2000.parquet", "obs/test/k/2000.parquet"])
      assert.equal(existsSync(join(store, dir)), true, dir);
    // Nothing is left to delete the second time, but rows an earlier drop left are cleared.
    await writeJsonArray(backfilledPath(store, "test"), [ranges("test/d1"), ranges("test/k")]);
    const again = await dropFiles(store, "test", drop, { remove });
    assert.deepEqual(again.ids, []);
    assert.deepEqual(again.cleared, ["test/d1"]);
    assert.deepEqual(await recorded(), ["test/k"]);
    await assert.rejects(
      dropFiles("https://stillwell.openwaters.io", "test", drop),
      /Can't delete files from https:/,
    );
  });

  it("deletes the files of GESLA's dropped CRMS records, but not the ten unidentified ones", () => {
    assert.equal(deletesFiles("crms0153-crms0153-usa-crms"), true);
    assert.equal(deletesFiles("uddevalla-2541-swe-smhi"), true);
    assert.equal(deletesFiles("crms3800-crms3800-usa-crms"), false);
    assert.equal(deletesFiles("crms0002-crms0002-usa-crms"), false);
    for (const file of KEEP_FILES) assert.equal(isDropped(file), true, file);
    assert.equal(KEEP_FILES.size, 10);
  });

  it("runs `ingest.ts drop gesla --dry-run` through to its report", async () => {
    const codes = ["crms0153-crms0153-usa-crms", "crms3800-crms3800-usa-crms"];
    await refreshSource(
      store,
      sourceOf(
        codes.map((c) => listed("gesla", c)),
        undefined,
        "gesla",
      ),
      {
        now: NOW,
      },
    );
    for (const code of codes)
      await writeObservations(
        seriesPath(store, "levels", "gesla", code, 2015, 1),
        [{ time: Date.UTC(2015, 0, 1), level: 1, flag: Flag.good }],
        "ZERO",
      );
    // The dropped record's backfilled years, in two epochs, and the kept one's.
    const gesla = (code: string, epoch: number) => ({
      id: `gesla/${code}`,
      epoch,
      years: [[2010, 2016]],
    });
    await writeJsonArray(backfilledPath(store, "gesla"), [
      gesla(codes[0]!, 1),
      gesla(codes[0]!, 2),
      gesla(codes[1]!, 1),
    ]);
    const run = spawnSync(process.execPath, ["scripts/ingest.ts", "drop", "gesla", "--dry-run"], {
      encoding: "utf8",
      env: { ...process.env, STILLWELL_STORE: store, STILLWELL_CACHE: join(store, "..", "cache") },
    });
    assert.equal(run.status, 0, run.stderr);
    assert.match(
      run.stdout,
      /gesla: 1 dropped stations with files, \d+ directories to delete \(dry run\)/,
    );
    assert.match(run.stdout, /gesla\/crms0153-crms0153-usa-crms/);
    assert.doesNotMatch(run.stdout, /crms3800/);
    // Counted by station, its two epochs' rows as one.
    assert.match(run.stdout, /gesla: 1 dropped stations' backfilled years to clear \(dry run\)/);
    assert.equal(existsSync(seriesPath(store, "levels", "gesla", codes[0], 2015, 1)), true);
    assert.equal(((await readJsonArray(backfilledPath(store, "gesla"))) as unknown[]).length, 3);
  });

  it("takes a dropped record's rows out of the link and match files with `--prune`", async () => {
    const dropped = "gesla/crms0153-crms0153-usa-crms";
    await refreshSource(
      store,
      sourceOf([listed("gesla", "crms0153-crms0153-usa-crms")], undefined, "gesla"),
      { now: NOW },
    );
    const span = { since: "2023-01-01T00:00:00.000Z", until: "2026-01-01T00:00:00.000Z" };
    const link = (a: string, b: string): LinkOffset => ({
      a,
      b,
      a_epoch: 1,
      b_epoch: 1,
      ...span,
      hours: 8760,
      offset_m: 0.1,
      spread_m: 0.005,
    });
    const match = (a: string, b: string): DataMatch => ({
      a,
      b,
      ...span,
      months: 36,
      hours: 26000,
      rms_m: 0.004,
      lag_h: 0,
      lag_rms_m: 0.004,
    });
    await writeLinks(store, [link("crms/CRMS0153-H01", dropped), link("coops/1", "coops/2")]);
    await writeMatches(store, [match("coops/1", "coops/2"), match("crms/CRMS0153-H01", dropped)]);
    const prune = (command: string) =>
      spawnSync(process.execPath, ["scripts/ingest.ts", command, "--prune"], {
        encoding: "utf8",
        env: {
          ...process.env,
          STILLWELL_STORE: store,
          STILLWELL_CACHE: join(store, "..", "cache"),
        },
      });
    for (const command of ["links", "matches"]) {
      const run = prune(command);
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /: 1 rows naming a withheld or dropped station taken out, 1 kept/);
    }
    // Measuring nothing, so the pair that isn't gone keeps last month's row as it was.
    assert.deepEqual(await readLinks(store), [link("coops/1", "coops/2")]);
    assert.deepEqual(await readMatches(store), [match("coops/1", "coops/2")]);
    // A file with nothing gone isn't written again.
    for (const [command, path] of [
      ["links", linksPath(store)],
      ["matches", matchesPath(store)],
    ] as const) {
      const written = (await stat(path)).mtimeMs;
      const again = prune(command);
      assert.match(again.stdout, /: 0 rows naming a withheld or dropped station taken out, 1 kept/);
      assert.equal((await stat(path)).mtimeMs, written, command);
    }
    // Without GESLA's list a dropped record can't be told apart, though other lists are read,
    // so the files stay and the run fails.
    const geslaList = (await readStationList(stationListPath(store, "gesla")))!;
    await rm(stationListPath(store, "gesla"));
    await refreshSource(store, sourceOf([listed("coops", "1")], undefined, "coops"), { now: NOW });
    await writeLinks(store, [link("crms/CRMS0153-H01", dropped)]);
    await writeMatches(store, [match("crms/CRMS0153-H01", dropped)]);
    for (const command of ["links", "matches"]) {
      const blind = prune(command);
      assert.equal(blind.status, 1);
      assert.match(blind.stderr, new RegExp(`no list for gesla; ${command} unchanged`));
    }
    assert.deepEqual(await readLinks(store), [link("crms/CRMS0153-H01", dropped)]);
    assert.deepEqual(await readMatches(store), [match("crms/CRMS0153-H01", dropped)]);
    // A store whose only list holds nothing but the dropped record still prunes.
    await rm(stationListPath(store, "coops"));
    await writeStationList(stationListPath(store, "gesla"), geslaList);
    const alone = prune("links");
    assert.equal(alone.status, 0, alone.stderr);
    assert.deepEqual(await readLinks(store), []);
  });

  it("refuses a rule that withholds more stations than a mistake would explain", async () => {
    const all = Array.from({ length: 10 }, (_, i) => listed("test", `x${i}`));
    await refreshSource(store, sourceOf(all), { now: NOW });
    const remove = async () => {
      removed++;
    };
    let removed = 0;
    await assert.rejects(
      withhold(store, sourceOf([], refused), { remove }),
      /10 of the 10 test stations the store has known are withheld, more than 5/,
    );
    assert.equal(removed, 0);
    // A person who checked the rule lets it through.
    await withhold(store, sourceOf([], refused), { remove, accept: true });
    assert.equal(removed, 1);
  });

  it("refuses a store it can't delete from, rather than report success", async () => {
    const source = sourceOf([], refused);
    await assert.rejects(
      withhold("https://stillwell.openwaters.io", source, { remove: async () => {} }),
      /Can't delete files from https:/,
    );
    await assert.rejects(
      removePrefixes("https://stillwell.openwaters.io", [
        "https://stillwell.openwaters.io/obs/test/x/",
      ]),
      /Can't delete files from https:/,
    );
  });

  it("refuses an ID that would name more than one station's directory", () => {
    for (const id of ["", " ", ".", "..", "a*"])
      assert.throws(() => seriesPrefixes(store, "test", [id]), /Refusing to delete/);
    assert.throws(() => seriesPrefixes(store, "", ["a"]), /Not a source ID/);
    // A slash is encoded, so the ID stays one directory.
    assert.deepEqual(
      seriesPrefixes("s3://water-levels", "test", ["a/b"])[0],
      "s3://water-levels/obs/test/a%2Fb/",
    );
  });

  it("deletes an s3:// directory with the AWS CLI on the store's endpoint", () => {
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
    // A single Parquet file goes without --recursive, so it can't take its neighbors.
    assert.deepEqual(awsRemoveArgs("s3://water-levels/obs/rws/x/2026.parquet", "r2.example"), [
      "s3",
      "rm",
      "s3://water-levels/obs/rws/x/2026.parquet",
      "--endpoint-url",
      "https://r2.example",
      "--only-show-errors",
    ]);
    for (const prefix of ["s3://water-levels/", "s3://water-levels/obs/gesla", "obs/gesla/x/"])
      assert.throws(() => awsRemoveArgs(prefix, "https://r2.example"), /isn't a directory/);
  });
});
