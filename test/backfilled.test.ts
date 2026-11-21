import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addRange,
  backfillStatus,
  missingYears,
  readBackfilled,
  recordWalk,
  wholeYears,
  writeBackfilled,
  type Backfilled,
} from "../src/backfilled.ts";
import { writeYears } from "../src/store/years.ts";
import type { Epoch, Source } from "../src/schema.ts";

const NOW = Date.UTC(2026, 10, 15);
const at = (iso: string) => new Date(iso);
/** The years [from, to). */
const span = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => from + i);

describe("wholeYears", () => {
  it("takes the whole years a run asks for, and the current year when it reaches now", () => {
    assert.deepEqual(wholeYears(at("1986-01-01"), at("2026-01-01"), NOW), [1986, 2026]);
    assert.deepEqual(wholeYears(at("2026-01-01"), at("2027-01-01"), NOW), [2026, 2027]);
    // Not a year it starts or ends partway through, unless that end is now.
    assert.deepEqual(wholeYears(at("2023-05-01"), at("2025-03-01"), NOW), [2024, 2025]);
    assert.deepEqual(wholeYears(at("2025-01-01"), at("2026-12-01"), NOW), [2025, 2027]);
    // Never past this year, and null for no whole year.
    assert.deepEqual(wholeYears(at("2026-01-01"), at("2028-01-01"), NOW), [2026, 2027]);
    assert.equal(wholeYears(at("2024-02-01"), at("2024-11-01"), NOW), null);
  });
});

describe("addRange", () => {
  it("merges ranges that touch or overlap, in order", () => {
    assert.deepEqual(addRange([], 2020, 2023), [[2020, 2023]]);
    assert.deepEqual(addRange([[2020, 2023]], 2023, 2025), [[2020, 2025]]);
    assert.deepEqual(addRange([[2020, 2023]], 2010, 2012), [
      [2010, 2012],
      [2020, 2023],
    ]);
    assert.deepEqual(
      addRange(
        [
          [2010, 2012],
          [2020, 2023],
        ],
        2011,
        2021,
      ),
      [[2010, 2023]],
    );
  });
});

describe("recordWalk", () => {
  it("records each whole year an epoch's span reaches into, under that epoch, less failed ones", () => {
    const record: Backfilled = new Map();
    const span = (id: number, from: string, to: string) => ({
      epoch: { id },
      from: at(from),
      to: at(to),
    });
    recordWalk(
      record,
      { id: "test/a", live: true },
      [span(1, "1990-01-01", "2010-06-01"), span(2, "2010-06-01", "2027-01-01")],
      at("1990-01-01"),
      at("2027-01-01"),
      NOW,
      // 2010 failed in epoch 1 alone, so epoch 2 still has it.
      new Set(["1 2000", "1 2010"]),
    );
    assert.deepEqual(
      [...record.get("test/a")!],
      [
        [
          1,
          [
            [1990, 2000],
            [2001, 2010],
          ],
        ],
        [2, [[2010, 2027]]],
      ],
    );
    // A station that isn't live doesn't get the current year, whose later months would go unasked.
    recordWalk(
      record,
      { id: "test/c", live: false },
      [span(1, "2025-01-01", "2027-01-01")],
      at("2025-01-01"),
      at("2027-01-01"),
      NOW,
    );
    assert.deepEqual([...record.get("test/c")!], [[1, [[2025, 2026]]]]);
    // A walk that starts partway through a year, as a `preliminary` refetch does, records from the next.
    recordWalk(
      record,
      { id: "test/b", live: true },
      [span(1, "2025-06-01", "2027-01-01")],
      at("2025-06-01"),
      at("2027-01-01"),
      NOW,
    );
    assert.deepEqual([...record.get("test/b")!], [[1, [[2026, 2027]]]]);
  });
});

describe("missingYears", () => {
  const station = (
    files: number[],
    ranges: [number, number][],
    {
      stored = files,
      reachable = (_: number): boolean => true,
      closed = true,
      compacted = true,
    } = {},
  ) => ({
    files: new Set(files),
    stored: new Set(stored),
    asked: (y: number) => ranges.some(([a, b]) => y >= a && y < b),
    reachable,
    closed,
    compacted,
  });

  it("takes an empty year as sure outside the station's record, or where the source says so", () => {
    // 2000 is before the record, 2002 within it, 2004 and 2005 after it, and 2006 never asked for.
    // After an active station's record, the source may not have published yet.
    assert.deepEqual(
      missingYears(station([2001, 2003], [[2000, 2006]], { closed: false }), false, 2000, 2006),
      [2002, 2004, 2005, 2006],
    );
    const s = station([2001, 2003], [[2000, 2006]]);
    assert.deepEqual(missingYears(s, false, 2000, 2006), [2002, 2006]);
    assert.deepEqual(missingYears(s, true, 2000, 2006), [2006]);
    // A station with nothing stored may only have met an outage.
    assert.deepEqual(
      missingYears(station([], [[2000, 2003]]), false, 2000, 2002),
      span(2000, 2003),
    );
    assert.deepEqual(missingYears(station([], [[2000, 2003]]), true, 2000, 2002), []);
  });

  it("counts a year no backfill can reach as had, and a file outside its epoch's span as not", () => {
    const s = station([2003, 2004], [[2000, 2007]], {
      stored: [2003, 2004, 2005],
      reachable: (y) => y >= 2001,
    });
    assert.deepEqual(missingYears(s, false, 1998, 2006), [2005]);
  });

  it("counts a file from compaction's first year on only where a range covers it", () => {
    const files = [2025, 2026, 2027];
    assert.deepEqual(missingYears(station(files, [[2020, 2026]]), false, 2020, 2027), [2026, 2027]);
    // A station that isn't live has its files from backfill alone.
    assert.deepEqual(missingYears(station(files, [], { compacted: false }), false, 2025, 2027), []);
    // A station compaction carried from January 1, 2027 has that year recorded.
    assert.deepEqual(missingYears(station(files, [[2020, 2028]]), false, 2020, 2027), []);
  });
});

describe("backfillStatus", () => {
  const source = (empty_means_none = false) =>
    ({ metadata: { id: "test", empty_means_none, hourly: true } }) as unknown as Pick<
      Source,
      "metadata" | "overrides"
    >;
  const epoch = (id: number, datum: string, since: string | null, until: string | null) =>
    ({ id, datum, since, until, state: until ? "closed" : "open" }) as Epoch;
  const station = (id: string, live = false, epochs = [epoch(1, "A", null, null)]) => ({
    id,
    live,
    status: live ? ("active" as const) : ("inactive" as const),
    epochs,
    products: ["levels" as const],
  });
  const row = (id: string, year: number, epoch = 1) => ({
    id,
    epoch,
    year,
    hours: 1,
    flags: [1, 0, 0, 0, 0],
    version: "v",
  });

  it("judges each station with levels from the source's first year", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-backfilled-"));
    await writeYears(store, "test", [
      row("test/a", 1990),
      row("test/a", 1991),
      row("test/b", 2025),
      row("test/b", 2026),
      // A marked station's rows may be out of date, so it isn't judged.
      row("test/e", 2000),
      { id: "test/e", epoch: null, year: null },
      // Epoch 1's files from before its datum changed in 2005, two now outside its span.
      ...[2003, 2004, 2005, 2006].map((y) => row("test/f", y)),
      // A run cut short in 1996, having written 1990 to 1995.
      ...span(1990, 1996).map((y) => row("test/g", y)),
      // Nor does a station no longer listed set `since`.
      row("test/gone", 1900),
    ]);
    const all: [number, number][] = [[1986, 2027]];
    await writeBackfilled(
      store,
      "test",
      new Map([
        ["test/a", new Map([[1, all]])],
        ["test/c", new Map([[1, all]])],
        // Recorded before the datum change; epoch 2 has no years of its own.
        ["test/f", new Map([[1, all]])],
        ["test/g", new Map([[1, [[1986, 1992]] as [number, number][]]])],
        ["test/gone", new Map([[1, [[1850, 2027]] as [number, number][]]])],
      ]),
    );
    const status = await backfillStatus(
      store,
      source(),
      [
        // Its record is 1990 and 1991; every other year was asked for and found empty.
        station("test/a"),
        // Live, with only compaction's years.
        station("test/b", true),
        // Asked for every year, and found nothing, which may be an outage.
        station("test/c"),
        station("test/e"),
        station("test/f", false, [
          epoch(1, "A", null, "2005-01-01T00:00:00Z"),
          epoch(2, "B", "2005-01-01T00:00:00Z", null),
        ]),
        station("test/g"),
        // With no open epoch it has no span, and is left out rather than failing the source.
        station("test/h", false, [epoch(1, "A", null, "2020-01-01T00:00:00Z")]),
        { ...station("test/d"), products: ["predictions" as const] },
      ],
      NOW,
    );
    assert.equal(status?.since, 1990);
    assert.deepEqual(status?.missing.get("test/a"), []);
    assert.deepEqual(status?.missing.get("test/b"), span(1990, 2025).concat(2026));
    // Not live, so judged to last year.
    assert.deepEqual(status?.missing.get("test/c"), span(1990, 2026));
    // Before epoch 2 no backfill can ask, since the source serves only the current datum.
    assert.deepEqual(status?.missing.get("test/f"), span(2005, 2026));
    // It shows the year after its last stored one, not complete.
    assert.deepEqual(status?.missing.get("test/g"), [1996]);
    assert.equal(status?.missing.has("test/d"), false);
    assert.equal(status?.missing.has("test/e"), false);
    assert.equal(status?.missing.has("test/h"), false);
    // The record round-trips by epoch.
    assert.deepEqual(
      [...(await readBackfilled(store, "test")).get("test/g")!],
      [[1, [[1986, 1992]]]],
    );
  });

  it("leaves a source's empty years in its record missing unless its empty answer is sure", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-backfilled-"));
    await writeYears(store, "test", [row("test/k", 1990), row("test/k", 1992)]);
    await writeBackfilled(store, "test", new Map([["test/k", new Map([[1, [[1986, 2027]]]])]]));
    const judged = async (metadata: object) =>
      (
        await backfillStatus(
          store,
          { metadata: { ...source().metadata, ...metadata } } as ReturnType<typeof source>,
          [station("test/k")],
          NOW,
        )
      )?.missing.get("test/k");
    // One that only skips them in a campaign keeps the gap inside the record.
    assert.deepEqual(await judged({ skip_empty: true }), [1991]);
    assert.deepEqual(await judged({ empty_means_none: true }), []);
  });

  it("takes an empty answer as sure from a source that says so", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-backfilled-"));
    await writeYears(store, "test", [row("test/x", 2000)]);
    await writeBackfilled(
      store,
      "test",
      new Map([["test/c", new Map([[1, [[1986, 2027]] as [number, number][]]])]]),
    );
    const status = await backfillStatus(
      store,
      source(true),
      [station("test/c"), station("test/x")],
      NOW,
    );
    assert.deepEqual(status?.missing.get("test/c"), []);
  });

  it("counts a retired station's compacted year only once a backfill covered it", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-backfilled-"));
    // Polled hourly from November 2026, retired in 2027, so compaction wrote only 2026's last weeks.
    await writeYears(
      store,
      "test",
      span(2020, 2027).map((y) => row("test/r", y)),
    );
    await writeBackfilled(
      store,
      "test",
      new Map([["test/r", new Map([[1, [[2020, 2026]] as [number, number][]]])]]),
    );
    const status = await backfillStatus(store, source(), [station("test/r")], Date.UTC(2027, 5, 1));
    assert.deepEqual(status?.missing.get("test/r"), [2026]);
  });

  it("judges a station with nothing stored at least through the source's first year", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-backfilled-"));
    // The source's only files are this year's, and the station's only walk found nothing before them.
    await writeYears(store, "test", [row("test/x", 2026)]);
    await writeBackfilled(
      store,
      "test",
      new Map([["test/n", new Map([[1, [[1980, 1990]] as [number, number][]]])]]),
    );
    const status = await backfillStatus(
      store,
      source(),
      [station("test/n"), station("test/x", true)],
      NOW,
    );
    assert.deepEqual(status?.missing.get("test/n"), [2026]);
  });

  it("is null for a source with no years file", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-backfilled-"));
    assert.equal(await backfillStatus(store, source(), [], NOW), null);
  });
});
