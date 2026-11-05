import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
import { listYears, readYearFiles, writeObservations } from "../src/lake/parquet.ts";
import { seriesDir, seriesPath } from "../src/lake/paths.ts";
import { Flag, type Station } from "../src/schema.ts";

const DAY = 86_400_000;
const Y2024 = new Date(Date.UTC(2024, 0, 1));
const Y2025 = new Date(Date.UTC(2025, 0, 1));
const NOW = Date.UTC(2026, 10, 5);
const DONE = { preliminary: 0, months: 12, last: Date.UTC(2024, 11, 31, 23, 45) };

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
    const files = await readYearFiles(dir);
    assert.deepEqual([...(await listYears(dir))].sort(), [2023, 2024]);
    assert.deepEqual(
      [...files],
      [
        [2023, { preliminary: 0, months: 1, last: t }],
        [2024, { preliminary: 2, months: 1, last: Date.UTC(2024, 0, 3) }],
      ],
    );
  });

  it("reads a station with no files as none", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-backfill-"));
    assert.equal((await readYearFiles(seriesDir(root, "levels", "usgs", "x"))).size, 0);
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
