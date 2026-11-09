import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readRows, readYearStats, writeObservations, writeRecent } from "../src/lake/parquet.ts";
import { recentPath, seriesPath, yearsPath } from "../src/lake/paths.ts";
import { compactRecent } from "../src/lake/recent.ts";
import {
  commitYears,
  dropYears,
  fileKey,
  markYears,
  reconcileYears,
  writeYears,
} from "../src/lake/years.ts";
import { Flag, type LakeStation, type Observation, type Source } from "../src/schema.ts";

const HOUR = 3_600_000;
const T = Date.UTC(2024, 0, 1);

function lake(): string {
  return mkdtempSync(join(tmpdir(), "water-levels-years-"));
}

const rows = (n: number, flag: Flag = Flag.good): Observation[] =>
  // Two values an hour, so `hours` is half the values.
  Array.from({ length: n }, (_, i) => ({ time: T + i * 30 * 60_000, level: i / 10, flag }));

/** A source's rows as a reader sees them, without the version. */
async function years(root: string): Promise<unknown[]> {
  return (await readRows(yearsPath(root, "test"))).map(({ version: _, ...r }) => r);
}

describe("year stats", () => {
  it("are the same from a write as from a read of the file", async () => {
    const root = lake();
    const file = seriesPath(root, "levels", "test", "a", 2024);
    const written = await writeObservations(
      file,
      [...rows(4), { time: T + 3 * HOUR, level: 1, flag: Flag.suspect, source_flag: Flag.good }],
      "NAP",
    );
    assert.deepEqual(written, (await readYearStats([file])).get(file));
    assert.deepEqual([written.hours, written.flags], [3, [4, 0, 0, 1, 0]]);
    // A changed flag changes the version; the same rows written again don't.
    const same = await writeObservations(
      file,
      [...rows(4), { time: T + 3 * HOUR, level: 1, flag: Flag.suspect, source_flag: Flag.good }],
      "NAP",
    );
    const flagged = await writeObservations(file, rows(5), "NAP");
    // A repeated row doesn't cancel out.
    const [first] = rows(1);
    const repeated = await writeObservations(file, [first!, first!, ...rows(4).slice(1)], "NAP");
    assert.notEqual(
      repeated.version,
      (await writeObservations(file, rows(4).slice(1), "NAP")).version,
    );
    assert.equal(same.version, written.version);
    assert.notEqual(flagged.version, written.version);
  });

  it("read a station whose ID holds a glob character alone", async () => {
    const root = lake();
    const files = ["a*", "ab"].map((id) => seriesPath(root, "levels", "test", id, 2024));
    await writeObservations(files[0]!, rows(2), "NAP");
    await writeObservations(files[1]!, rows(6), "NAP");
    const stats = await readYearStats(files);
    assert.deepEqual(
      files.map((f) => stats.get(f)?.flags[0]),
      [2, 6],
    );
  });
});

describe("fileKey", () => {
  it("names a file's station, epoch and year", () => {
    assert.deepEqual(fileKey("test", "s3://lake/obs/test/a%2Fb/2024.parquet"), {
      id: "test/a/b",
      epoch: 1,
      year: 2024,
    });
    assert.equal(fileKey("test", "/x/obs/test/100%/2024.parquet"), null);
    assert.deepEqual(fileKey("test", "/x/obs/test/a/2/2024.parquet"), {
      id: "test/a",
      epoch: 2,
      year: 2024,
    });
  });
});

describe("the source's years", () => {
  it("are built by a rebuild, and left alone by other runs until then", async () => {
    const root = lake();
    await writeObservations(seriesPath(root, "levels", "test", "a", 2023), rows(2), "NAP");
    await writeObservations(seriesPath(root, "levels", "test", "a", 2024, 2), rows(4), "MSL");
    assert.equal(await reconcileYears(root, "test"), null);
    assert.deepEqual(await markYears(root, "test", ["test/a"]), []);
    await commitYears(root, "test", ["test/a"], new Map());
    assert.deepEqual(await readRows(yearsPath(root, "test")), []);

    assert.equal((await reconcileYears(root, "test", { start: true }))?.read, 2);
    assert.deepEqual(await years(root), [
      {
        id: "test/a",
        epoch: 1,
        year: 2023,
        hours: 1,
        good: 2,
        interpolated: 0,
        preliminary: 0,
        suspect: 0,
        bad: 0,
      },
      {
        id: "test/a",
        epoch: 2,
        year: 2024,
        hours: 2,
        good: 4,
        interpolated: 0,
        preliminary: 0,
        suspect: 0,
        bad: 0,
      },
    ]);
    // Nothing changed, so nothing is read again, unless asked to.
    assert.equal((await reconcileYears(root, "test"))?.read, 0);
    assert.equal((await reconcileYears(root, "test", { rebuild: true }))?.read, 2);
    // A listing that finds nothing isn't taken for a lake emptied.
    rmSync(join(root, "obs"), { recursive: true });
    await assert.rejects(reconcileYears(root, "test"), /no test files listed/);
  });

  it("mark a station while a run writes it, and a later run reads what a stopped one left", async () => {
    const root = lake();
    await writeYears(root, "test", []);
    const a2023 = seriesPath(root, "levels", "test", "a", 2023);
    const b2023 = seriesPath(root, "levels", "test", "b", 2023);
    await commitYears(
      root,
      "test",
      [],
      new Map([[b2023, await writeObservations(b2023, rows(2), "NAP")]]),
    );

    await markYears(root, "test", ["test/a"]);
    const none = {
      hours: null,
      good: null,
      interpolated: null,
      preliminary: null,
      suspect: null,
      bad: null,
    };
    const zeros = { interpolated: 0, preliminary: 0, suspect: 0, bad: 0 };
    assert.deepEqual(await years(root), [
      { id: "test/a", epoch: null, year: null, ...none },
      { id: "test/b", epoch: 1, year: 2023, hours: 1, good: 2, ...zeros },
    ]);
    // The run stops after writing a's file, before setting its row. A later
    // run writes a's 2024 and leaves the stopped run's mark for the reconcile.
    await writeObservations(a2023, rows(4), "NAP");
    const a2024 = seriesPath(root, "levels", "test", "a", 2024);
    const later = await markYears(root, "test", ["test/a"]);
    assert.deepEqual(later, []);
    await commitYears(
      root,
      "test",
      later,
      new Map([[a2024, await writeObservations(a2024, rows(1), "NAP")]]),
    );
    rmSync(b2023);
    assert.equal((await reconcileYears(root, "test"))?.read, 2);
    assert.deepEqual(
      (await years(root)).map((r) => [(r as { year: number }).year, (r as { good: number }).good]),
      [
        [2023, 4],
        [2024, 1],
      ],
    );
    rmSync(a2024);
    await reconcileYears(root, "test");
    assert.deepEqual(
      (await years(root)).map((r) => (r as { id: string }).id),
      ["test/a"],
    );

    const stats = await writeObservations(a2023, rows(6), "NAP");
    const marked = await markYears(root, "test", ["test/a"]);
    assert.deepEqual(marked, ["test/a"]);
    await commitYears(root, "test", marked, new Map([[a2023, stats]]));
    const [row] = await readRows(yearsPath(root, "test"));
    assert.deepEqual([row!.epoch, row!.good, row!.version], [1, 6, stats.version]);

    assert.deepEqual(await dropYears(root, "test", (id) => id === "test/a"), ["test/a"]);
    assert.deepEqual(await readRows(yearsPath(root, "test")), []);
  });

  it("leave out a station `keep` refuses, and read again the ones in `reread`", async () => {
    const root = lake();
    await writeYears(root, "test", []);
    const a = seriesPath(root, "levels", "test", "a", 2023);
    await writeObservations(seriesPath(root, "levels", "test", "w", 2023), rows(2), "NAP");
    await commitYears(root, "test", [], new Map([[a, await writeObservations(a, rows(2), "NAP")]]));
    await reconcileYears(root, "test", { keep: (id) => id !== "test/w" });
    assert.deepEqual(
      (await years(root)).map((r) => (r as { id: string }).id),
      ["test/a"],
    );
    // Rewritten without its row set, as when a batch can't be marked.
    await writeObservations(a, rows(3), "NAP");
    assert.equal(
      (await reconcileYears(root, "test", { keep: (id) => id !== "test/w", reread: ["test/a"] }))
        ?.read,
      1,
    );
    const [row] = await readRows(yearsPath(root, "test"));
    assert.equal(row!.good, 3);
  });

  it("read at most `limit` files, and resume from the marks left", async () => {
    const root = lake();
    await writeYears(root, "test", []);
    for (const year of [2020, 2021, 2022])
      await writeObservations(seriesPath(root, "levels", "test", "a", year), rows(2), "NAP");
    assert.equal((await reconcileYears(root, "test", { limit: 2 }))?.read, 2);
    const left = (await years(root)).map((r) => (r as { year: number | null }).year);
    // The station isn't finished, so it stays marked.
    assert.deepEqual(left.toSorted(), [2020, 2021, null].toSorted());
    assert.equal((await reconcileYears(root, "test"))?.read, 3);
    assert.deepEqual(
      (await years(root)).map((r) => (r as { year: number }).year),
      [2020, 2021, 2022],
    );
  });

  it("finish a station's files before another's, whatever the listing's order", async () => {
    const root = lake();
    await writeYears(root, "test", []);
    await writeObservations(seriesPath(root, "levels", "test", "a", 2020), rows(1), "NAP");
    await writeObservations(seriesPath(root, "levels", "test", "a", 2021, 2), rows(1), "NAP");
    await writeObservations(seriesPath(root, "levels", "test", "b", 2020), rows(1), "NAP");
    await reconcileYears(root, "test", { limit: 2 });
    assert.deepEqual(
      (await years(root)).map((r) => [
        (r as { id: string }).id,
        (r as { year: number | null }).year,
      ]),
      [
        ["test/a", 2020],
        ["test/a", 2021],
        ["test/b", null],
      ],
    );
  });

  it("give a file with no rows a row of zeros, as its write does", async () => {
    const root = lake();
    await writeYears(root, "test", []);
    const file = seriesPath(root, "levels", "test", "a", 2020);
    const written = await writeObservations(file, [], "NAP");
    await reconcileYears(root, "test");
    const [row] = await readRows(yearsPath(root, "test"));
    assert.deepEqual([row!.hours, row!.good, row!.version], [0, 0, written.version]);
  });

  it("read a lake named by a relative path", async () => {
    const root = lake();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      await writeObservations(seriesPath("data", "levels", "test", "a", 2020), rows(2), "NAP");
      assert.deepEqual(await reconcileYears("data", "test", { start: true }), {
        read: 1,
        failed: [],
      });
    } finally {
      process.chdir(cwd);
    }
  });

  it("go on past a file that can't be read, keeping its station marked", async () => {
    const root = lake();
    await writeYears(root, "test", []);
    await writeObservations(seriesPath(root, "levels", "test", "a", 2020), rows(2), "NAP");
    const bad = seriesPath(root, "levels", "test", "b", 2020);
    await writeObservations(bad, rows(2), "NAP");
    writeFileSync(bad, "not parquet");
    assert.deepEqual(await reconcileYears(root, "test"), { read: 1, failed: [bad] });
    assert.deepEqual(
      (await years(root)).map((r) => [(r as { id: string }).id, (r as { year: number }).year]),
      [
        ["test/a", 2020],
        ["test/b", null],
      ],
    );
  });

  it("count UTC hours before 1970 as after it", async () => {
    const root = lake();
    const file = seriesPath(root, "levels", "test", "a", 1969);
    // 22:30 and 22:59:59 share an hour, and 23:00 is the next; truncating toward 1970 would join all three.
    const end = Date.UTC(1970, 0, 1);
    const times = [-1.5 * HOUR, -HOUR - 1000, -HOUR].map((t) => end + t);
    const stats = await writeObservations(
      file,
      times.map((time) => ({ time, level: 0, flag: Flag.good })),
      "NAP",
    );
    assert.equal(stats.hours, 2);
  });

  it("follow the files compaction folds", async () => {
    const root = lake();
    await writeYears(root, "test", []);
    const a = {
      id: "test/a",
      source: "test",
      source_id: "a",
      datum: "NAP",
      products: ["levels"],
      status: "active",
      live: true,
      epochs: [{ id: 1, datum: "NAP", since: null, until: null, state: "open" }],
    } as unknown as LakeStation;
    const start = Date.UTC(2026, 10, 4);
    await writeRecent(recentPath(root, "test"), [
      [{ time: start + HOUR, level: 1, flag: Flag.good, station: a.id, epoch: 1 }],
    ]);
    const summary = await compactRecent({
      source: { metadata: { id: "test" } } as Source,
      stations: [a],
      lakeFor: () => root,
      start,
      end: start + 24 * HOUR,
    });
    assert.deepEqual(summary.failed, []);
    const stats = (await readYearStats([seriesPath(root, "levels", "test", "a", 2026)]))
      .values()
      .next().value!;
    const [row] = await readRows(yearsPath(root, "test"));
    assert.deepEqual([row!.year, row!.hours, row!.version], [2026, 1, stats.version]);
  });
});
