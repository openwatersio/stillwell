import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import {
  orderStations,
  parseShard,
  parseStationList,
  shard,
  yearDone,
  yearWritten,
  yearsToFetch,
} from "../src/backfill.ts";
import {
  listYears,
  readYearFiles,
  writeObservations,
  writeStationList,
} from "../src/lake/parquet.ts";
import { seriesDir, seriesPath, stationListPath } from "../src/lake/paths.ts";
import { Flag, type LakeStation, type Station } from "../src/schema.ts";

const DAY = 86_400_000;
const Y2024 = new Date(Date.UTC(2024, 0, 1));
const Y2025 = new Date(Date.UTC(2025, 0, 1));
const NOW = Date.UTC(2026, 10, 5);
const DONE = {
  preliminary: 0,
  months: 12,
  last: Date.UTC(2024, 11, 31, 23, 45),
  backfilled: 1,
};

describe("yearDone", () => {
  it("skips a past year whose file reaches the year's end with no preliminary values", () => {
    assert.equal(yearDone(DONE, Y2024, Y2025, NOW), true);
  });

  it("fetches a year with no file", () => {
    assert.equal(yearDone(undefined, Y2024, Y2025, NOW), false);
  });

  it("fetches a year whose file holds preliminary values", () => {
    assert.equal(yearDone({ ...DONE, preliminary: 1 }, Y2024, Y2025, NOW), false);
  });

  it("fetches the current year, however complete its file", () => {
    const from = new Date(Date.UTC(2026, 0, 1));
    const to = new Date(Date.UTC(2027, 0, 1));
    assert.equal(yearDone({ ...DONE, last: NOW }, from, to, NOW), false);
  });

  it("fetches a year whose file stops before its last week", () => {
    const last = Y2025.getTime() - 7 * DAY - 1;
    assert.equal(yearDone({ ...DONE, last }, Y2024, Y2025, NOW), false);
    assert.equal(yearDone({ ...DONE, last: last + 1 }, Y2024, Y2025, NOW), true);
  });

  it("fetches a year whose file misses a month, such as one an earlier run wrote only December of", () => {
    assert.equal(yearDone({ ...DONE, months: 11 }, Y2024, Y2025, NOW), false);
    assert.equal(yearDone({ ...DONE, months: 1 }, Y2024, Y2025, NOW), false);
  });

  it("fetches a request for part of a year", () => {
    assert.equal(yearDone(DONE, new Date(Date.UTC(2024, 5, 1)), Y2025, NOW), false);
    assert.equal(yearDone(DONE, Y2024, new Date(Date.UTC(2024, 5, 1)), NOW), false);
  });

  it("counts a year as ended only once the next has begun", () => {
    assert.equal(yearDone(DONE, Y2024, Y2025, Y2025.getTime() - 1), false);
    assert.equal(yearDone(DONE, Y2024, Y2025, Y2025.getTime()), true);
  });
});

describe("yearWritten", () => {
  const written = new Set([2024, 2026]);

  it("skips a whole, ended year that has a file, complete or not", () => {
    assert.equal(yearWritten(written, Y2024, Y2025, NOW), true);
    assert.equal(yearWritten(written, Y2025, new Date(Date.UTC(2026, 0, 1)), NOW), false);
  });

  it("fetches the current year and a request for part of a year, file or not", () => {
    const y2026 = new Date(Date.UTC(2026, 0, 1));
    assert.equal(yearWritten(written, y2026, new Date(Date.UTC(2027, 0, 1)), NOW), false);
    assert.equal(yearWritten(written, new Date(Date.UTC(2024, 5, 1)), Y2025, NOW), false);
  });

  it("from 2026 on, skips a file with every month, or one backfill wrote to", () => {
    const y2026 = new Date(Date.UTC(2026, 0, 1));
    const y2027 = new Date(Date.UTC(2027, 0, 1));
    const later = Date.UTC(2027, 0, 5);
    // Compaction wrote it from the year's last weeks: every value has `received`.
    const compacted = { ...DONE, months: 2, backfilled: 0 };
    assert.equal(yearWritten(written, y2026, y2027, later, compacted), false);
    assert.equal(yearWritten(written, y2026, y2027, later), false);
    // Backfill wrote some of it.
    assert.equal(yearWritten(written, y2026, y2027, later, { ...compacted, backfilled: 5 }), true);
    // Compaction carried it through the year, or backfill over compacted
    // values kept their `received`: every month is there either way.
    assert.equal(yearWritten(written, y2026, y2027, later, { ...DONE, backfilled: 0 }), true);
  });
});

describe("readYearFiles", () => {
  it("reads each year's preliminary count and last time from one directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-backfill-"));
    const t = Date.UTC(2023, 11, 31, 23);
    await writeObservations(
      seriesPath(root, "levels", "usgs", "07010000", 2023),
      [
        { time: t - DAY, level: 1, flag: Flag.good },
        { time: t, level: 1, flag: Flag.good },
      ],
      "GAGE",
    );
    await writeObservations(
      seriesPath(root, "levels", "usgs", "07010000", 2024),
      [
        { time: Date.UTC(2024, 0, 1), level: 1, flag: Flag.preliminary },
        { time: Date.UTC(2024, 0, 2), level: 1, flag: Flag.preliminary },
        { time: Date.UTC(2024, 0, 3), level: 1, flag: Flag.suspect },
      ],
      "GAGE",
    );
    const dir = seriesDir(root, "levels", "usgs", "07010000");
    const files = await readYearFiles(dir, [2022, 2023, 2024]);
    assert.deepEqual([...(await listYears(dir))].sort(), [2023, 2024]);
    assert.deepEqual(
      [...(await readYearFiles(dir, [2024]))].map(([y]) => y),
      [2024],
    );
    assert.deepEqual(
      [...files],
      [
        [2023, { preliminary: 0, months: 1, last: t, backfilled: 2 }],
        [2024, { preliminary: 2, months: 1, last: Date.UTC(2024, 0, 3), backfilled: 3 }],
      ],
    );
  });

  it("counts a provisional value QC flagged, and values ingest received", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-backfill-"));
    await writeObservations(
      seriesPath(root, "levels", "usgs", "x", 2026),
      [
        { time: Date.UTC(2026, 0, 1), level: 1, flag: Flag.suspect, source_flag: Flag.preliminary },
        { time: Date.UTC(2026, 0, 2), level: 1, flag: Flag.good, source_flag: Flag.good },
        { time: Date.UTC(2026, 0, 3), level: 1, flag: Flag.good, received: Date.UTC(2026, 0, 3) },
      ],
      "GAGE",
    );
    const dir = seriesDir(root, "levels", "usgs", "x");
    const [file] = (await readYearFiles(dir, [2026])).values();
    assert.equal(file!.preliminary, 1);
    assert.equal(file!.backfilled, 2);
  });

  it("lists only the station's own files when its ID holds a glob character", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-backfill-"));
    const write = (id: string, y: number) =>
      writeObservations(
        seriesPath(root, "levels", "usgs", id, y),
        [{ time: Date.UTC(y, 0, 1), level: 1, flag: Flag.good }],
        "GAGE",
      );
    await write("a*", 2023);
    await write("ab", 2024);
    await writeObservations(
      seriesPath(root, "levels", "usgs", "ab", 2023),
      [
        { time: Date.UTC(2023, 0, 1), level: 1, flag: Flag.good },
        { time: Date.UTC(2023, 0, 2), level: 1, flag: Flag.good },
      ],
      "GAGE",
    );
    assert.deepEqual([...(await listYears(seriesDir(root, "levels", "usgs", "a*")))], [2023]);
    // read_parquet globs too: a*'s 2023 is read alone, not with ab's.
    const own = await readYearFiles(seriesDir(root, "levels", "usgs", "a*"), [2023]);
    assert.equal(own.get(2023)!.backfilled, 1);
    // A relative lake, which DuckDB lists without its leading `./`.
    const relativeRoot = `./${relative(process.cwd(), root)}`;
    assert.deepEqual(
      [...(await listYears(seriesDir(relativeRoot, "levels", "usgs", "ab")))].sort(),
      [2023, 2024],
    );
  });

  it("reads the current epoch's directory, not epoch 1's", () => {
    assert.equal(seriesDir("lake", "levels", "usgs", "x"), "lake/obs/usgs/x");
    assert.equal(seriesDir("lake", "levels", "usgs", "x", 2), "lake/obs/usgs/x/2");
    assert.equal(
      seriesPath("lake", "levels", "usgs", "x", 2024, 2),
      "lake/obs/usgs/x/2/2024.parquet",
    );
  });

  it("reads a station with no files as none", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-backfill-"));
    assert.equal((await readYearFiles(seriesDir(root, "levels", "usgs", "x"), [2024])).size, 0);
    assert.equal((await listYears(seriesDir(root, "levels", "usgs", "x"))).size, 0);
  });
});

describe("yearsToFetch", () => {
  const root = mkdtempSync(join(tmpdir(), "water-levels-backfill-"));
  const dir = seriesDir(root, "levels", "usgs", "07010000");
  const y2023 = new Date(Date.UTC(2023, 0, 1));
  const y2027 = new Date(Date.UTC(2027, 0, 1));
  const year = ([from]: [Date, Date]) => from.getUTCFullYear();
  // A whole 2023, December 2024 alone, and part of 2026 (the current year).
  const monthly = (y: number, months: number[], flag: Flag) =>
    months.map((m) => ({ time: Date.UTC(y, m, 28, 12), level: 1, flag }));

  it("with --skip-written, fetches a 2026 file only compaction wrote", async () => {
    const id = "compacted";
    await writeObservations(
      seriesPath(root, "levels", "usgs", id, 2026),
      [
        {
          time: Date.UTC(2026, 11, 30),
          level: 1,
          flag: Flag.good,
          received: Date.UTC(2026, 11, 30),
        },
      ],
      "GAGE",
    );
    const later = Date.UTC(2027, 0, 5);
    const d = seriesDir(root, "levels", "usgs", id);
    const result = await yearsToFetch(d, new Date(Date.UTC(2026, 0, 1)), y2027, "written", later);
    assert.deepEqual(result.fetch.map(year), [2026]);
  });

  it("fetches only the years that aren't complete, or with --skip-written, not written", async () => {
    await writeObservations(
      seriesPath(root, "levels", "usgs", "07010000", 2023),
      [...monthly(2023, [...Array(12).keys()], Flag.good)],
      "GAGE",
    );
    await writeObservations(
      seriesPath(root, "levels", "usgs", "07010000", 2024),
      monthly(2024, [11], Flag.good),
      "GAGE",
    );
    await writeObservations(
      seriesPath(root, "levels", "usgs", "07010000", 2026),
      monthly(2026, [0, 1, 2], Flag.preliminary),
      "GAGE",
    );
    const complete = await yearsToFetch(dir, y2023, y2027, "complete", NOW);
    assert.deepEqual(complete.fetch.map(year), [2024, 2025, 2026]);
    assert.equal(complete.skipped, 1);
    const written = await yearsToFetch(dir, y2023, y2027, "written", NOW);
    assert.deepEqual(written.fetch.map(year), [2025, 2026]);
    assert.equal(written.skipped, 2);
    const none = await yearsToFetch(dir, y2023, y2027, "none", NOW);
    assert.deepEqual(none.fetch.map(year), [2023, 2024, 2025, 2026]);
    assert.equal(none.skipped, 0);
  });

  it("throws on an unreadable file, rather than fetch every year again", async () => {
    const bad = seriesDir(root, "levels", "usgs", "broken");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "2023.parquet"), "not parquet");
    await assert.rejects(yearsToFetch(bad, y2023, y2027, "complete", NOW));
    // A year not asked about is never opened.
    assert.equal((await yearsToFetch(bad, Y2024, Y2025, "complete", NOW)).fetch.length, 1);
    // A run over the current year alone has nothing to skip, so reads nothing.
    const y2026 = new Date(Date.UTC(2026, 0, 1));
    assert.equal((await yearsToFetch(bad, y2026, y2027, "complete", NOW)).fetch.length, 1);
    // A listing doesn't open the files.
    assert.equal((await yearsToFetch(bad, y2023, y2027, "written", NOW)).skipped, 1);
  });
});

describe("parseStationList", () => {
  it("reads a plain list, bare or with the source, skipping comments and other sources", () => {
    const text = "# TICON first\n07010000\nusgs/02198820  # Abercorn\n\ncoops/8761724\n07010000\n";
    assert.deepEqual(parseStationList(text, "usgs", false), ["usgs/07010000", "usgs/02198820"]);
  });

  it("reads the replacement_id column of a CSV, quoted fields and all", () => {
    const text = [
      "ticon_id,name,replacement_source,replacement_id,note",
      'a,"Name, with comma",usgs,usgs/02198820,""',
      "b,B,rws,rws/a12,",
      "c,C,usgs,,unmatched",
      'd,D,usgs,usgs/01410600,"a ""quoted"" note"',
    ].join("\n");
    assert.deepEqual(parseStationList(text, "usgs", true), ["usgs/02198820", "usgs/01410600"]);
  });

  it("reads the committed TICON inventory", () => {
    const ids = parseStationList(
      readFileSync(new URL("../docs/ticon-replacement.csv", import.meta.url), "utf8"),
      "usgs",
      true,
    );
    assert.ok(ids.length > 400);
    assert.ok(ids.every((id) => /^usgs\/\d+$/.test(id)));
  });

  it("keeps an empty first field, so the columns after it stay in place", () => {
    const text = "ticon_id,name,replacement_id\n,Name,usgs/02198820\n,,usgs/01410600";
    assert.deepEqual(parseStationList(text, "usgs", true), ["usgs/02198820", "usgs/01410600"]);
  });

  it("refuses a CSV with no station column", () => {
    assert.throws(() => parseStationList("a,b\n1,2", "usgs", true), /column/);
  });
});

const stations = ["usgs/05", "usgs/01", "usgs/04", "usgs/02", "usgs/03"].map(
  (id) => ({ id }) as Station,
);
const ids = (list: Station[]) => list.map((s) => s.id);

describe("orderStations", () => {
  it("puts the named stations first, in the file's order, then the rest in theirs", () => {
    assert.deepEqual(ids(orderStations(stations, ["usgs/03", "usgs/09", "usgs/05"])), [
      "usgs/03",
      "usgs/05",
      "usgs/01",
      "usgs/04",
      "usgs/02",
    ]);
  });
});

describe("shard", () => {
  it("puts every station in exactly one shard, and spreads them out", () => {
    const many = Array.from({ length: 2000 }, (_, i) => ({ id: `usgs/${i}` }) as Station);
    const parts = [1, 2, 3, 4].map((i) => ids(shard(many, i, 4)));
    assert.deepEqual(parts.flat().sort(), ids(many).sort());
    for (const part of parts) assert.ok(part.length > 400 && part.length < 600, `${part.length}`);
  });

  it("gives a station the same shard however the list is ordered or changes", () => {
    const before = new Set(ids(shard(stations, 2, 3)));
    const grown = [{ id: "usgs/00" } as Station, ...orderStations(stations, ["usgs/04"])];
    const after = ids(shard(grown, 2, 3)).filter((id) => id !== "usgs/00");
    assert.deepEqual(new Set(after), before);
  });

  it("parses INDEX/COUNT and refuses a shard out of range", () => {
    assert.deepEqual(parseShard("2/8"), [2, 8]);
    assert.throws(() => parseShard("2-8"), /INDEX\/COUNT/);
    assert.throws(() => shard(stations, 0, 3), /Not a shard/);
    assert.throws(() => shard(stations, 4, 3), /Not a shard/);
  });
});

describe("backfill script", () => {
  it("stops, and fails the run, once CO-OPS blocks it", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-backfill-"));
    const lake = join(root, "lake");
    const stations = ["1", "2", "3", "4", "5"].map(
      (id) =>
        ({
          id: `coops/${id}`,
          source: "coops",
          source_id: id,
          datum: "STND",
          products: ["levels"],
          status: "active",
          live: false,
          interval_s: 360,
          kind: "coastal",
          commercial_use: true,
          epochs: [
            {
              id: 1,
              datum: "STND",
              since: null,
              until: null,
              seen: null,
              reference: null,
              reference_since: null,
              datums: {},
              to_current: 0,
              state: "open",
            },
          ],
        }) as LakeStation,
    );
    await writeStationList(stationListPath(lake, "coops"), stations);
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        "./test/fixtures/coops-blocked.ts",
        "scripts/ingest.ts",
        "backfill",
        "coops",
        "all",
        "2024",
        "2025",
        "--concurrency",
        "1",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, WATER_LEVELS_LAKE: lake, WATER_LEVELS_CACHE: join(root, "cache") },
      },
    );
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /^coops: stopped: /m);
    // Three holds in a row stop the run before the last stations send anything.
    const asked = [...run.stderr.matchAll(/^fetch .*station=(\w+)/gm)].map((m) => m[1]);
    assert.ok(asked.length > 0, run.stderr);
    assert.ok(!asked.includes("4") && !asked.includes("5"), `asked ${asked}`);
  });
});
