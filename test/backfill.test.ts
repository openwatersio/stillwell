import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import {
  backfillYear,
  earliestPreliminary,
  epochSpans,
  orderStations,
  parseShard,
  parseStationList,
  preliminaryRuns,
  readerOf,
  seriesFiles,
  shard,
  yearDone,
  yearWritten,
  yearsToFetch,
} from "../src/backfill.ts";
import {
  listYears,
  readObservationFile,
  readObservations,
  readStationBounds,
  readYearFiles,
  writeObservations,
  writeStationBounds,
  writeStationList,
  writeStations,
} from "../src/store/parquet.ts";
import { boundsPath, seriesDir, seriesPath, stationListPath } from "../src/store/paths.ts";
import { REFETCH_YEARS } from "../src/store/recent.ts";
import { readEmptyYears, writeEmptyYears } from "../src/empty-years.ts";
import {
  Flag,
  type StoredStation,
  type Observation,
  type Source,
  type Station,
} from "../src/schema.ts";

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

  it("skips preliminary values from before the source's QC start, which it never checks", () => {
    const file = { ...DONE, preliminary: 1 };
    assert.equal(yearDone(file, Y2024, Y2025, NOW, "2025-01-01T00:00:00Z"), true);
    // A year the checks start in may still have values the source will check.
    assert.equal(yearDone(file, Y2024, Y2025, NOW, "2024-07-01T00:00:00Z"), false);
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
    const root = mkdtempSync(join(tmpdir(), "stillwell-backfill-"));
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
    const root = mkdtempSync(join(tmpdir(), "stillwell-backfill-"));
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
    const root = mkdtempSync(join(tmpdir(), "stillwell-backfill-"));
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
    // A relative store, which DuckDB lists without its leading `./`.
    const relativeRoot = `./${relative(process.cwd(), root)}`;
    assert.deepEqual(
      [...(await listYears(seriesDir(relativeRoot, "levels", "usgs", "ab")))].sort(),
      [2023, 2024],
    );
  });

  it("reads the current epoch's directory, not epoch 1's", () => {
    assert.equal(seriesDir("store", "levels", "usgs", "x"), "store/obs/usgs/x");
    assert.equal(seriesDir("store", "levels", "usgs", "x", 2), "store/obs/usgs/x/2");
    assert.equal(
      seriesPath("store", "levels", "usgs", "x", 2024, 2),
      "store/obs/usgs/x/2/2024.parquet",
    );
  });

  it("reads a station with no files as none", async () => {
    const root = mkdtempSync(join(tmpdir(), "stillwell-backfill-"));
    assert.equal((await readYearFiles(seriesDir(root, "levels", "usgs", "x"), [2024])).size, 0);
    assert.equal((await listYears(seriesDir(root, "levels", "usgs", "x"))).size, 0);
  });
});

describe("yearsToFetch", () => {
  const root = mkdtempSync(join(tmpdir(), "stillwell-backfill-"));
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

describe("preliminaryRuns", () => {
  const Y2023 = new Date(Date.UTC(2023, 0, 1));
  const Y2026 = new Date(Date.UTC(2026, 0, 1));
  const bounds = (preliminary: string | null, last: string | null = "2025-12-31T00:00:00Z") => ({
    first: "2010-01-01T00:00:00Z",
    last,
    preliminary,
  });

  it("takes each station from its preliminary value's month, or the cutoff, to its last year", () => {
    const { runs, past } = preliminaryRuns(
      [
        ..."abcdef".split("").map((id) => ({ id, products: ["levels" as const], epochs: [] })),
        // Its list dropped levels, so there's nothing to read again.
        { id: "g", products: ["extremes" as const], epochs: [] },
      ],
      new Map([
        ["g", bounds("2024-03-15T06:00:00Z")],
        ["a", bounds("2024-03-15T06:00:00Z", "2024-06-30T00:00:00Z")],
        ["b", bounds(null)],
        ["c", bounds("2021-05-01T00:00:00Z")],
        ["d", bounds("2021-05-01T00:00:00Z", "2021-05-01T00:00:00Z")],
        ["f", bounds("2026-02-01T00:00:00Z", null)],
      ]),
      Y2023,
      Y2026,
    );
    assert.deepEqual(
      runs.map((r) => [r.station.id, r.from.toISOString(), r.to.toISOString()]),
      [
        // Its last value ends the run with its year.
        ["a", "2024-03-01T00:00:00.000Z", "2025-01-01T00:00:00.000Z"],
        // Past the cutoff, but its later values may be preliminary too.
        ["c", "2023-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
      ],
    );
    // d stopped before the cutoff, so it's listed and not fetched; f starts after the end.
    assert.deepEqual(past, [
      { id: "c", preliminary: "2021-05-01T00:00:00Z" },
      { id: "d", preliminary: "2021-05-01T00:00:00Z" },
    ]);
  });
});

describe("preliminaryRuns with skipUnscreened", () => {
  const levels = (id: string, epochs: StoredStation["epochs"] = []) => ({
    id,
    products: ["levels" as const],
    epochs,
  });
  const row = (first: string, screened: boolean | null) => ({
    first,
    last: "2025-12-31T00:00:00Z",
    preliminary: "2025-03-01T00:00:00Z",
    screened,
  });
  const bounds = new Map([
    ["never", row("2023-01-01T00:00:00Z", false)],
    ["young", row("2025-06-01T00:00:00Z", false)],
    ["unknown", row("2023-01-01T00:00:00Z", null)],
    ["screens", row("2023-01-01T00:00:00Z", true)],
    ["renewed", row("2023-01-01T00:00:00Z", false)],
  ]);
  const stations = [
    ...["never", "young", "unknown", "screens"].map((id) => levels(id)),
    // Its current epoch began under a year ago, whatever came before.
    levels("renewed", [
      { ...coopsStation("x", "active").epochs[0]!, since: "2025-06-01T00:00:00Z" },
    ]),
  ];
  const Y2023 = new Date(Date.UTC(2023, 0, 1));
  const Y2026 = new Date(Date.UTC(2026, 0, 1));

  it("leaves out a station with a year of record and no value the source screened", () => {
    const { runs, unscreened } = preliminaryRuns(stations, bounds, Y2023, Y2026, true);
    assert.deepEqual(
      runs.map((r) => r.station.id),
      ["young", "unknown", "screens", "renewed"],
    );
    assert.deepEqual(unscreened, ["never"]);
  });

  it("takes it like any other without the option", () => {
    const { runs, unscreened } = preliminaryRuns(stations, bounds, Y2023, Y2026);
    assert.equal(runs.length, 5);
    assert.deepEqual(unscreened, []);
  });
});

describe("monthly refetch", () => {
  it("reaches back as far as compaction looks for preliminary values", () => {
    const workflow = readFileSync(".github/workflows/monthly.yml", "utf8");
    assert.match(workflow, new RegExp(`from=\\$\\(\\(year - ${REFETCH_YEARS}\\)\\)`));
    assert.match(workflow, /backfill "\$SOURCE" "\$which" "\$from" "\$@"/);
    // California DWR, which nothing else fetches, reads every active station from last January.
    assert.match(
      workflow,
      /dwr\) which=all from=\$\(\(year - 1\)\) && set -- "\$\(date -u \+%F\)" --refetch ;;/,
    );
  });
});

describe("earliestPreliminary", () => {
  it("reads the earliest value the source sent as preliminary across a station's files", async () => {
    const root = mkdtempSync(join(tmpdir(), "stillwell-backfill-"));
    const write = (year: number, rows: Parameters<typeof writeObservations>[1]) =>
      writeObservations(seriesPath(root, "levels", "usgs", "x", year), rows, "GAGE");
    const dir = seriesDir(root, "levels", "usgs", "x");
    assert.deepEqual(await earliestPreliminary(dir), { preliminary: null, screened: false });
    // Without a source flag, a suspect one may be QC's alone, so it isn't the source's screening.
    await write(2021, [{ time: Date.UTC(2021, 5, 1), level: 1, flag: Flag.suspect }]);
    assert.deepEqual(await earliestPreliminary(dir), { preliminary: null, screened: false });
    await write(2022, [{ time: Date.UTC(2022, 5, 1), level: 1, flag: Flag.good }]);
    // A good value is one the source screened.
    assert.deepEqual(await earliestPreliminary(dir), { preliminary: null, screened: true });
    await write(2025, [{ time: Date.UTC(2025, 1, 1), level: 1, flag: Flag.preliminary }]);
    // QC raised it to suspect, but the source hasn't approved it.
    await write(2024, [
      { time: Date.UTC(2024, 6, 1), level: 1, flag: Flag.suspect, source_flag: Flag.preliminary },
    ]);
    assert.equal((await earliestPreliminary(dir)).preliminary, Date.UTC(2024, 6, 1));
    // Only inside the epoch's window, as compaction counts them.
    assert.deepEqual(
      await earliestPreliminary(dir, [Date.UTC(2025, 0, 1), Infinity]),
      // The 2022 file's good value is outside it.
      { preliminary: Date.UTC(2025, 1, 1), screened: false },
    );
    // Only the files from `fromYear` on: 2022's good value isn't among them.
    assert.deepEqual(await earliestPreliminary(dir, [-Infinity, Infinity], 2025), {
      preliminary: Date.UTC(2025, 1, 1),
      screened: false,
    });
  });
});

describe("parseStationList", () => {
  it("reads a plain list, bare or with the source, skipping comments and other sources", () => {
    const text = "# TICON first\n07010000\nusgs/02198820  # Abercorn\n\ncoops/8761724\n07010000\n";
    assert.deepEqual(parseStationList(text, "usgs", false), ["usgs/07010000", "usgs/02198820"]);
  });

  it("reads the originator_id column of a CSV, quoted fields and all", () => {
    const text = [
      "ticon_id,name,originator_source,originator_id,note",
      'a,"Name, with comma",usgs,usgs/02198820,""',
      "b,B,rws,rws/a12,",
      "c,C,usgs,,unmatched",
      'd,D,usgs,usgs/01410600,"a ""quoted"" note"',
    ].join("\n");
    assert.deepEqual(parseStationList(text, "usgs", true), ["usgs/02198820", "usgs/01410600"]);
  });

  it("reads the committed TICON inventory", () => {
    const ids = parseStationList(
      readFileSync(new URL("../docs/ticon-inventory.csv", import.meta.url), "utf8"),
      "usgs",
      true,
    );
    assert.ok(ids.length > 400);
    assert.ok(ids.every((id) => /^usgs\/\d+$/.test(id)));
  });

  it("keeps an empty first field, so the columns after it stay in place", () => {
    const text = "ticon_id,name,originator_id\n,Name,usgs/02198820\n,,usgs/01410600";
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

/** A CO-OPS station with only levels, in one open epoch. */
function coopsStation(id: string, status: "active" | "inactive"): StoredStation {
  return {
    id: `coops/${id}`,
    source: "coops",
    source_id: id,
    datum: "STND",
    products: ["levels"],
    status,
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
  } as StoredStation;
}

/** `ingest.ts backfill coops …` against `store`, through the verifying CO-OPS fixture. */
function backfillCoops(store: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "./test/fixtures/coops-verified.ts",
      "scripts/ingest.ts",
      "backfill",
      "coops",
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        STILLWELL_STORE: store,
        STILLWELL_CACHE: join(store, "..", "cache"),
        ...env,
      },
    },
  );
}

describe("backfill script", () => {
  it("walks a station named twice, by either form of its ID, once", async () => {
    // Each in its own store, since a run's responses are cached beside it.
    const fetches = async (ids: string) => {
      const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
      await writeStationList(stationListPath(store, "coops"), [coopsStation("2000", "active")]);
      return backfillCoops(store, [ids, "2020", "2021"]).stderr.match(/^fetch /gm)?.length;
    };
    assert.equal(await fetches("2000,coops/2000"), await fetches("2000"));
  });

  it("lowers each batch's values before fetching, so a killed run leaves them early", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
    const ids = [...Array(102).keys()].map((i) => String(2000 + i));
    await writeStationList(
      stationListPath(store, "coops"),
      ids.map((id) => coopsStation(id, "active")),
    );
    const path = boundsPath(store, "coops");
    // Relative to now: lowering goes no earlier than the cutoff, three years back.
    const year = new Date().getUTCFullYear();
    const late = `${year}-02-01T00:00:00Z`;
    const fetchFrom = `${year - 2}-12-01`;
    await writeStationBounds(
      path,
      ids.map((id) => ({
        id: `coops/${id}`,
        first: late,
        last: late,
        // The last one's is already earlier than its fetch, so it isn't raised.
        preliminary: id === "2101" ? `${year - 6}-01-01T00:00:00Z` : late,
      })),
    );
    // One request each; the process dies at the second batch's first station.
    const run = backfillCoops(store, ["all", fetchFrom, `${year - 1}`, "--concurrency", "1"], {
      EXIT_AFTER: "101",
    });
    assert.equal(run.status, 9, run.stderr);
    const after = [...(await readStationBounds(path)).values()].map((b) => b.preliminary);
    // The first batch was read again and has none; the killed one says where its fetch began.
    assert.equal(after.filter((p) => p === null).length, 100);
    assert.deepEqual(
      after.filter((p) => p !== null),
      [`${fetchFrom}T00:00:00Z`, `${year - 6}-01-01T00:00:00Z`],
    );
  });

  it("with --skip-unscreened, skips a station whose source never screened its values", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
    await writeStationList(stationListPath(store, "coops"), [
      coopsStation("8", "inactive"),
      coopsStation("9", "inactive"),
    ]);
    const path = boundsPath(store, "coops");
    await writeStationBounds(
      path,
      ["8", "9"].map((id) => ({
        id: `coops/${id}`,
        first: "2023-01-01T00:00:00Z",
        last: "2024-12-31T00:00:00Z",
        preliminary: "2024-12-01T00:00:00Z",
        screened: id === "8" ? false : null,
      })),
    );
    assert.equal(backfillCoops(store, ["all", "2024", "2025", "--skip-unscreened"]).status, 1);
    const run = backfillCoops(store, ["preliminary", "2023", "2025", "--skip-unscreened"]);
    assert.equal(run.status, 0, run.stderr);
    const asked = new Set([...run.stderr.matchAll(/^fetch .*station=(\w+)/gm)].map((m) => m[1]));
    assert.deepEqual([...asked], ["9"]);
    assert.match(
      run.stdout,
      /skipped 1 stations with a year of record and no value the source screened/,
    );
    // The fetch's verified values are screened, so 9 is known to be now.
    assert.equal((await readStationBounds(path)).get("coops/9")?.screened, true);
  });

  it("takes one shard of the stations with preliminary values", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
    const stations = ["11", "12", "13", "14", "15", "16"].map((id) => coopsStation(id, "inactive"));
    await writeStationList(stationListPath(store, "coops"), stations);
    await writeStationBounds(
      boundsPath(store, "coops"),
      stations.map((s) => ({
        id: s.id,
        first: "2024-12-01T00:00:00Z",
        last: "2024-12-01T00:00:00Z",
        preliminary: "2024-12-01T00:00:00Z",
      })),
    );
    const run = backfillCoops(store, ["preliminary", "2023", "2025", "--shard", "1/2"]);
    assert.equal(run.status, 0, run.stderr);
    const asked = [
      ...new Set([...run.stderr.matchAll(/^fetch .*station=(\w+)/gm)].map((m) => m[1])),
    ];
    assert.deepEqual(
      asked.sort(),
      shard(stations, 1, 2)
        .map((s) => s.source_id)
        .sort(),
    );
    assert.ok(asked.length > 0 && asked.length < stations.length);
  });

  it("lowers no earlier than the cutoff, and not for a fetch that ends before it", async () => {
    const year = new Date().getUTCFullYear();
    const late = `${year}-02-01T00:00:00Z`;
    const killed = async (from: string, to: string) => {
      const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
      await writeStationList(stationListPath(store, "coops"), [coopsStation("7", "active")]);
      const path = boundsPath(store, "coops");
      await writeStationBounds(path, [
        { id: "coops/7", first: late, last: late, preliminary: late },
      ]);
      const run = backfillCoops(store, ["all", from, to], { EXIT_AFTER: "1" });
      assert.equal(run.status, 9, run.stderr);
      return (await readStationBounds(path)).get("coops/7")?.preliminary;
    };
    assert.equal(await killed(`${year - 6}`, `${year - 1}`), `${year - 3}-01-01T00:00:00Z`);
    assert.equal(await killed(`${year - 8}`, `${year - 6}`), late);
  });

  it("gives a lowered station its value back when it had no year to fetch", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
    await writeStationList(stationListPath(store, "coops"), [coopsStation("7", "active")]);
    const good = (time: number) => ({ time, level: 2, flag: Flag.good });
    await writeObservations(
      seriesPath(store, "levels", "coops", "7", 2024),
      [...Array(12).keys()]
        .map((m) => good(Date.UTC(2024, m, 1)))
        .concat(good(Date.UTC(2024, 11, 31))),
      "STND",
    );
    const path = boundsPath(store, "coops");
    const late = "2026-02-01T00:00:00Z";
    await writeStationBounds(path, [{ id: "coops/7", first: late, last: late, preliminary: late }]);
    const run = backfillCoops(store, ["all", "2024", "2025"]);
    assert.equal(run.status, 0, run.stderr);
    assert.doesNotMatch(run.stderr, /^fetch /m);
    assert.equal((await readStationBounds(path)).get("coops/7")?.preliminary, late);
  });

  it("with --skip-written, skips a year it found empty, for 30 days", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
    await writeStationList(stationListPath(store, "coops"), [coopsStation("9", "active")]);
    const asked = (run: { stderr: string }, year: number) =>
      new RegExp(`^fetch .*begin_date=${year}`, "m").test(run.stderr);
    const args = ["9", "2020", "2023", "--concurrency", "1"];
    const first = backfillCoops(store, [...args, "--skip-written"], { EMPTY_YEARS: "2021" });
    assert.equal(first.status, 0, first.stderr);
    assert.ok(asked(first, 2021));
    const record = await readEmptyYears(store, "coops", Date.now());
    assert.deepEqual([...record.keys()], ["coops/9 levels 1 2021"]);

    // The next run skips it, and the years it wrote.
    const second = backfillCoops(store, [...args, "--skip-written"], { EMPTY_YEARS: "2021" });
    assert.equal(second.status, 0, second.stderr);
    assert.doesNotMatch(second.stderr, /^fetch /m);
    assert.match(second.stdout, /coops: skipped 1 years found empty in the last 30 days/);

    assert.match(first.stdout, /coops: recorded 1 years with no file that came back empty/);

    // A record it can't read is neither used nor written over.
    const broken = join(store, "stations", "empty", "coops.json");
    const saved = readFileSync(broken, "utf8");
    writeFileSync(broken, "not json");
    const unreadable = backfillCoops(store, [...args, "--skip-written"], { EMPTY_YEARS: "2021" });
    assert.equal(unreadable.status, 0, unreadable.stderr);
    assert.match(unreadable.stderr, /asking for every year, recording none/);
    assert.ok(asked(unreadable, 2021));
    assert.equal(readFileSync(broken, "utf8"), "not json");
    writeFileSync(broken, saved);

    // A plain backfill asks again.
    const plain = backfillCoops(store, args, { EMPTY_YEARS: "2021" });
    assert.equal(plain.status, 0, plain.stderr);
    assert.ok(asked(plain, 2021));

    // Past 30 days, an entry is dropped and the year is asked for again.
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString();
    await writeEmptyYears(
      store,
      "coops",
      new Map([["coops/9 levels 1 2021", old]]),
      Date.now() - 31 * 86_400_000,
    );
    assert.equal((await readEmptyYears(store, "coops", Date.now())).size, 0);
    const later = backfillCoops(store, [...args, "--skip-written"]);
    assert.equal(later.status, 0, later.stderr);
    assert.ok(asked(later, 2021));
    assert.equal((await readEmptyYears(store, "coops", Date.now())).size, 0);
  });

  it("refetches every station with preliminary values, active or not, and reads them again", async () => {
    const root = mkdtempSync(join(tmpdir(), "stillwell-backfill-"));
    const store = join(root, "store");
    const station = (id: string, status: "active" | "inactive", since: string | null = null) =>
      ({
        id: `coops/${id}`,
        source: "coops",
        source_id: id,
        datum: "STND",
        products: ["levels"],
        status,
        live: false,
        interval_s: 360,
        kind: "coastal",
        commercial_use: true,
        epochs: [
          {
            id: 1,
            datum: "STND",
            since,
            until: null,
            seen: null,
            reference: null,
            reference_since: null,
            datums: {},
            to_current: 0,
            state: "open",
          },
        ],
      }) as StoredStation;
    await writeStationList(stationListPath(store, "coops"), [
      station("1", "inactive"),
      station("2", "active"),
      station("3", "inactive"),
      station("4", "inactive"),
      station("5", "inactive", "2024-06-01T00:00:00Z"),
      // Held for a datum change, so skipped, and not listed.
      {
        ...station("6", "inactive"),
        epochs: [
          ...station("6", "inactive").epochs,
          { ...station("6", "inactive").epochs[0]!, id: 2, state: "held" },
        ],
      } as StoredStation,
    ]);
    // Station 5's epoch starts after a preliminary row its directory holds, which compaction doesn't count.
    await writeObservations(
      seriesPath(store, "levels", "coops", "5", 2024),
      [
        { time: Date.UTC(2024, 1, 1), level: 2, flag: Flag.preliminary },
        { time: Date.UTC(2024, 7, 1), level: 2, flag: Flag.preliminary },
      ],
      "STND",
    );
    // Station 4's years from the cutoff on are complete and final. Its 2021 is
    // still preliminary, but before the years the refetch and compaction look in.
    const good = (time: number) => ({ time, level: 2, flag: Flag.good });
    await writeObservations(
      seriesPath(store, "levels", "coops", "4", 2021),
      [{ time: Date.UTC(2021, 4, 1), level: 2, flag: Flag.preliminary }],
      "STND",
    );
    for (const year of [2023, 2024, 2025])
      await writeObservations(
        seriesPath(store, "levels", "coops", "4", year),
        [...Array(12).keys()]
          .map((m) => good(Date.UTC(year, m, 1)))
          .concat(good(Date.UTC(year, 11, 31))),
        "STND",
      );
    const file = seriesPath(store, "levels", "coops", "1", 2024);
    await writeObservations(
      file,
      [{ time: Date.UTC(2024, 2, 15), level: 2, flag: Flag.preliminary }],
      "STND",
    );
    const path = boundsPath(store, "coops");
    await writeStationBounds(path, [
      {
        id: "coops/1",
        first: "2024-03-15T00:00:00Z",
        last: "2024-03-15T00:00:00Z",
        preliminary: "2024-03-15T00:00:00Z",
      },
      {
        id: "coops/2",
        first: "2020-01-01T00:00:00Z",
        last: "2026-11-01T00:00:00Z",
        preliminary: null,
      },
      {
        id: "coops/3",
        first: "2019-05-01T00:00:00Z",
        last: "2019-05-01T00:00:00Z",
        preliminary: "2019-05-01T00:00:00Z",
      },
      {
        id: "coops/4",
        first: "2021-01-01T00:00:00Z",
        last: "2025-12-31T00:00:00Z",
        preliminary: "2021-05-01T00:00:00Z",
      },
      {
        id: "coops/6",
        first: "2019-05-01T00:00:00Z",
        last: "2019-05-01T00:00:00Z",
        preliminary: "2019-05-01T00:00:00Z",
      },
      {
        id: "coops/5",
        first: "2024-06-01T00:00:00Z",
        last: "2024-08-01T00:00:00Z",
        preliminary: "2024-08-01T00:00:00Z",
      },
    ]);
    const summary = join(root, "summary.md");
    const backfill = (...flags: string[]) =>
      spawnSync(
        process.execPath,
        [
          "--import",
          "./test/fixtures/coops-verified.ts",
          "scripts/ingest.ts",
          "backfill",
          "coops",
          "preliminary",
          "2023",
          "2026",
          "--concurrency",
          "1",
          ...flags,
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            STILLWELL_STORE: store,
            STILLWELL_CACHE: join(root, "cache"),
            GITHUB_STEP_SUMMARY: summary,
          },
        },
      );
    const run = backfill();
    assert.equal(run.status, 0, run.stderr);
    // Only the inactive stations with a preliminary value since the cutoff are fetched.
    const asked = new Set([...run.stderr.matchAll(/^fetch .*station=(\w+)/gm)].map((m) => m[1]));
    assert.deepEqual([...asked], ["1", "5"]);
    // From its preliminary value's month to the end of its last year.
    const months = [...run.stderr.matchAll(/station=1&.*begin_date=(\d{6})/g)].map((m) => m[1]);
    assert.deepEqual([months[0], months.at(-1)], ["202403", "202412"]);
    assert.ok(
      (await readObservations(file)).every((r) => r.source_flag === Flag.good),
      "the verified values replace the preliminary one",
    );
    // Read again from its files, it has none left; the others keep theirs.
    const after = await readStationBounds(path);
    assert.deepEqual(after.get("coops/1"), {
      first: "2024-03-15T00:00:00Z",
      last: "2024-03-15T00:00:00Z",
      preliminary: null,
      screened: true,
    });
    // Its files end before the cutoff, so it's listed once and its value cleared.
    assert.equal(after.get("coops/3")?.preliminary, null);
    // With nothing left to fetch, its files are still read again, from the cutoff on.
    assert.equal(after.get("coops/4")?.preliminary, null);
    assert.equal(after.get("coops/5")?.preliminary, null);
    assert.equal(after.get("coops/2")?.last, "2026-11-01T00:00:00Z");
    // The one past the cutoff is listed on the run's page.
    assert.match(readFileSync(summary, "utf8"), /coops\/3 since 2019-05-01T00:00:00Z/);
    assert.doesNotMatch(readFileSync(summary, "utf8"), /coops\/6/);

    // Skipping every written year would skip the preliminary ones.
    const skipping = backfill("--skip-written");
    assert.equal(skipping.status, 1);
    assert.match(skipping.stderr, /--skip-written and `preliminary` contradict each other/);

    // Bounds an older build wrote, without the column, would pick nothing; it says so instead.
    await writeStations(path, [
      { id: "coops/1", first: null, last: null } as unknown as StoredStation,
    ]);
    const old = backfill();
    assert.equal(old.status, 1);
    assert.match(old.stderr, /predate preliminary values; run `compact coops --rebuild-bounds`/);
  });

  it("keeps the preliminary values it read every 100 stations, though the run is killed", async () => {
    const root = mkdtempSync(join(tmpdir(), "stillwell-backfill-"));
    const store = join(root, "store");
    const ids = [...Array(101).keys()].map((i) => String(1000 + i));
    await writeStationList(
      stationListPath(store, "coops"),
      ids.map(
        (id) =>
          ({
            id: `coops/${id}`,
            source: "coops",
            source_id: id,
            datum: "STND",
            products: ["levels"],
            status: "inactive",
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
          }) as StoredStation,
      ),
    );
    const path = boundsPath(store, "coops");
    // One month each to fetch, December 2024, which the fetch verifies.
    await writeStationBounds(
      path,
      ids.map((id) => ({
        id: `coops/${id}`,
        first: "2024-12-01T00:00:00Z",
        last: "2024-12-01T00:00:00Z",
        preliminary: "2024-12-01T00:00:00Z",
      })),
    );
    const run = spawnSync(
      process.execPath,
      [
        "--import",
        "./test/fixtures/coops-verified.ts",
        "scripts/ingest.ts",
        "backfill",
        "coops",
        "preliminary",
        "2023",
        "2026",
        "--concurrency",
        "1",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          STILLWELL_STORE: store,
          STILLWELL_CACHE: join(root, "cache"),
          EXIT_AFTER: "101",
        },
      },
    );
    assert.equal(run.status, 9, run.stderr);
    const after = [...(await readStationBounds(path)).values()].map((b) => b.preliminary);
    assert.equal(after.filter((p) => p === null).length, 100);
  });

  it("stops, and fails the run, once CO-OPS blocks it", async () => {
    const root = mkdtempSync(join(tmpdir(), "stillwell-backfill-"));
    const store = join(root, "store");
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
        }) as StoredStation,
    );
    await writeStationList(stationListPath(store, "coops"), stations);
    // Every station but 5 has a known value, later than the run's fetches.
    const late = "2026-02-01T00:00:00Z";
    await writeStationBounds(
      boundsPath(store, "coops"),
      ["1", "2", "3", "4"].map((id) => ({
        id: `coops/${id}`,
        first: late,
        last: late,
        preliminary: late,
      })),
    );
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
        env: { ...process.env, STILLWELL_STORE: store, STILLWELL_CACHE: join(root, "cache") },
      },
    );
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stderr, /^coops: stopped: /m);
    // A failed year prints when it fails, not only in the summary a killed run never reaches.
    assert.match(run.stderr, /^failed: coops\/1 levels 2024: /m);
    // Three holds in a row stop the run before the last stations send anything.
    const asked = [...run.stderr.matchAll(/^fetch .*station=(\w+)/gm)].map((m) => m[1]);
    assert.ok(asked.length > 0, run.stderr);
    assert.ok(!asked.includes("4") && !asked.includes("5"), `asked ${asked}`);
    // A station the run never reached gets its value back; one with no row gets none.
    const after = await readStationBounds(boundsPath(store, "coops"));
    assert.equal(after.get("coops/4")?.preliminary, late);
    assert.equal(after.has("coops/5"), false);
  });
});

describe("epochSpans", () => {
  const epochs = [
    { ...base(1), since: null, until: "2005-01-01T00:00:00Z", state: "closed" as const },
    { ...base(2), since: "2005-01-01T00:00:00Z", until: null, state: "open" as const },
  ];
  const range = [new Date("1990-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z")] as const;
  const spans = (archive?: "current" | "previous") =>
    epochSpans(epochs, ...range, archive).map((s) => [
      s.epoch.id,
      s.from.toISOString().slice(0, 4),
      s.to.toISOString().slice(0, 4),
    ]);

  it("writes the current epoch from its start", () => {
    assert.deepEqual(spans(), [[2, "2005", "2026"]]);
  });

  it("writes closed epochs too where the source serves them in their own reference", () => {
    assert.deepEqual(spans("previous"), [
      [1, "1990", "2005"],
      [2, "2005", "2026"],
    ]);
  });

  it("writes a closed epoch a split ended, whatever the source's archive", () => {
    const ids = (starts: string[]) =>
      epochSpans(epochs, ...range, "current", new Set(starts)).map((s) => s.epoch.id);
    assert.deepEqual(ids(["2005-01-01T00:00:00Z"]), [1, 2]);
    // One the source closed is on today's zero in its archive, so it isn't written.
    assert.deepEqual(ids(["2010-01-01T00:00:00Z"]), [2]);
    // A decision ending it earlier leaves the next epoch's start, which marks the split.
    const ended = [{ ...epochs[0]!, until: "2004-06-01T00:00:00Z" }, epochs[1]!];
    assert.deepEqual(
      epochSpans(ended, ...range, "current", new Set(["2005-01-01T00:00:00Z"])).map(
        (s) => s.epoch.id,
      ),
      [1, 2],
    );
  });

  it("never writes a current epoch before the reference it names, split or not", () => {
    const unsplit = [
      { ...base(1), since: null, until: null, state: "open" as const },
      { ...base(2), datum: "MSL", since: null, until: null, state: "rejected" as const },
    ];
    unsplit[0]!.reference_since = "2005-01-01T00:00:00Z";
    assert.deepEqual(
      epochSpans(unsplit, ...range, "previous").map((s) => [s.epoch.id, s.from.toISOString()]),
      [[1, "2005-01-01T00:00:00.000Z"]],
    );
  });

  it("keeps a closed epoch out of the current one's span", () => {
    const recorded = [
      { ...base(1), since: null, until: "2015-01-01T00:00:00Z", state: "closed" as const },
      { ...base(2), since: null, until: null, state: "open" as const },
    ];
    recorded[1]!.reference_since = "2005-01-01T00:00:00Z";
    assert.deepEqual(
      epochSpans(recorded, ...range, "previous").map((s) => [
        s.epoch.id,
        s.from.toISOString().slice(0, 4),
        s.to.toISOString().slice(0, 4),
      ]),
      [
        [1, "1990", "2005"],
        [2, "2005", "2026"],
      ],
    );
  });

  it("leaves out a closed epoch under another label, which the source no longer serves", () => {
    const moved = [
      {
        ...base(1),
        datum: "MSL",
        since: null,
        until: "2010-01-01T00:00:00Z",
        state: "closed" as const,
      },
      { ...base(2), since: "2010-01-01T00:00:00Z", until: null, state: "open" as const },
    ];
    assert.deepEqual(
      epochSpans(moved, ...range, "previous").map((s) => s.epoch.id),
      [2],
    );
  });
});

function base(id: number): {
  id: number;
  datum: string;
  seen: null;
  reference: null;
  reference_since: string | null;
  datums: Record<string, number>;
  to_current: null;
} {
  return {
    id,
    datum: "NAP",
    seen: null,
    reference: null,
    reference_since: null,
    datums: {},
    to_current: null,
  };
}

describe("backfillYear", () => {
  const HOUR = 3_600_000;
  const station = coopsStation("8000001", "active");
  const epoch = station.epochs[0]!;
  const dirOf = (store: string) => seriesDir(store, "levels", "coops", "8000001");
  // Hourly values around a reservoir's 1897.5 m, where the file's FLOAT keeps
  // steps of 0.12 mm, and a spike. A year ends on four hours at 1897.5003,
  // which reads back as 1897.5002, and starts on four at 1897.5002, so the
  // next year's start is a six-hour flatline only against the year as read
  // back from its file.
  const source = (shift: number) =>
    ({
      metadata: { id: "coops" },
      observations: async (_: Station, from: Date, to: Date) => {
        const rows: Observation[] = [];
        for (let t = from.getTime(); t < to.getTime(); t += HOUR) {
          const [h, left] = [(t - from.getTime()) / HOUR, (to.getTime() - t) / HOUR];
          const level =
            h < 4
              ? 1897.5002
              : left <= 4
                ? 1897.5003
                : 1897.5002 +
                  0.3 * Math.sin(((Math.min(h, left) - 4) / 12.42) * 2 * Math.PI) +
                  shift;
          const flag = new Date(t).getUTCMonth() === 11 ? Flag.preliminary : Flag.good;
          rows.push({ time: t, level: h === 30 ? level + 9 : level, flag });
        }
        return rows;
      },
    }) as unknown as Source;
  const years = [2000, 2001, 2002, 2003, 2004];
  const walk = async (
    store: string,
    shift: number,
    files: (dir: string) => Promise<ReturnType<typeof seriesFiles<Observation>>>,
  ) => {
    for (const year of years)
      await backfillYear(
        source(shift),
        station,
        "levels",
        new Date(Date.UTC(year, 0, 1)),
        new Date(Date.UTC(year + 1, 0, 1)),
        epoch,
        await files(dirOf(store)),
        new Map(),
      );
  };
  // Years either side the walk doesn't fetch, and one in it, already hold values.
  const seed = async (store: string) => {
    for (const year of [1999, 2002, 2005]) {
      const start = Date.UTC(year, 0, 1);
      const rows = [...Array(48).keys()].map((h) => ({
        time: start + h * HOUR,
        level: 0.987654321 + h / 1000,
        flag: Flag.preliminary,
        source_flag: Flag.preliminary,
        received: start + h * HOUR + 123,
      }));
      await writeObservations(seriesPath(store, "levels", "coops", "8000001", year), rows, "STND");
    }
  };
  const bytes = (store: string) =>
    Object.fromEntries(
      readdirSync(dirOf(store))
        .sort()
        .map((f) => [f, readFileSync(join(dirOf(store), f)).toString("base64")]),
    );

  it("writes the same files whether it reads each year once or every time", async () => {
    const [cached, uncached] = [0, 1].map(() =>
      join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store"),
    );
    await seed(cached!);
    await seed(uncached!);
    // A new history, then a revised one over the files it wrote.
    for (const shift of [0, 0.01]) {
      const walkFiles = seriesFiles(
        dirOf(cached!),
        await listYears(dirOf(cached!)),
        readObservationFile,
      );
      await walk(cached!, shift, async () => walkFiles);
      // As before the cache: every read made again, every year.
      await walk(uncached!, shift, async (dir) =>
        seriesFiles(dir, await listYears(dir), readObservationFile),
      );
      assert.deepEqual(bytes(cached!), bytes(uncached!));
    }
    // The flags QC set lean on the neighbors, so the comparison means something.
    const start = (
      await readObservations(seriesPath(cached!, "levels", "coops", "8000001", 2001))
    ).slice(0, 5);
    assert.deepEqual(
      start.map((r) => r.flag),
      [Flag.suspect, Flag.suspect, Flag.suspect, Flag.suspect, Flag.good],
    );
  });

  it("reads each year file at most once, and none the listing didn't find", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
    await seed(store);
    const reads: string[] = [];
    const counting = (path: string) => {
      reads.push(relative(dirOf(store), path));
      return readObservationFile(path);
    };
    const files = seriesFiles(dirOf(store), await listYears(dirOf(store)), counting);
    await walk(store, 0, async () => files);
    // Five years written, from the three seeded files read once each.
    assert.deepEqual(reads.sort(), ["1999.parquet", "2002.parquet", "2005.parquet"]);
    reads.length = 0;
    const again = seriesFiles(dirOf(store), await listYears(dirOf(store)), counting);
    await walk(store, 0.01, async () => again);
    assert.deepEqual(
      reads.sort(),
      [1999, ...years, 2005].map((y) => `${y}.parquet`),
    );
  });

  it("reads a year again after its read fails", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
    await seed(store);
    const reads: string[] = [];
    let failing = true;
    const flaky = (path: string) => {
      reads.push(relative(dirOf(store), path));
      if (failing && path.endsWith("2002.parquet")) {
        failing = false;
        return Promise.reject(new Error("timed out"));
      }
      return readObservationFile(path);
    };
    const files = seriesFiles(dirOf(store), await listYears(dirOf(store)), flaky);
    // 2001's read of its neighbor 2002 fails, so 2001 fails; 2002 reads it again.
    await assert.rejects(
      walk(store, 0, async () => files),
      /timed out/,
    );
    await walk(store, 0, async () => files);
    assert.deepEqual(reads.filter((r) => r === "2002.parquet").length, 2);
  });

  it("reads a year again after its write fails", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
    await seed(store);
    const reads: string[] = [];
    const counting = (path: string) => {
      reads.push(relative(dirOf(store), path));
      return readObservationFile(path);
    };
    const files = seriesFiles(dirOf(store), await listYears(dirOf(store)), counting);
    // A directory where 2004's file goes fails its write; 2003 has read 2004 as empty.
    mkdirSync(join(dirOf(store), "2004.parquet"));
    await assert.rejects(walk(store, 0, async () => files));
    assert.ok(!reads.includes("2004.parquet"));
    rmSync(join(dirOf(store), "2004.parquet"), { recursive: true });
    await files.get(2004);
    assert.ok(reads.includes("2004.parquet"));
  });

  it("reads extremes once, for their datum and rows", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "stillwell-backfill-")), "store");
    const dir = seriesDir(store, "extremes", "coops", "8000001");
    let reads = 0;
    const read = readerOf("extremes");
    const files = seriesFiles(dir, new Set([2000]), (path: string) => (reads++, read(path)));
    const extremes = {
      metadata: { id: "coops" },
      extremes: async (_: Station, from: Date) => [
        { time: from.getTime(), level: 1.5, type: "high", flag: Flag.good },
      ],
    } as unknown as Source;
    for (const year of [2000, 2001])
      await backfillYear(
        extremes,
        { ...station, products: ["extremes"] },
        "extremes",
        new Date(Date.UTC(year, 0, 1)),
        new Date(Date.UTC(year + 1, 0, 1)),
        epoch,
        files,
        new Map(),
      );
    assert.equal(reads, 1);
  });
});
