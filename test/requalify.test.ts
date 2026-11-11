import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  readObservations,
  readRecent,
  writeObservations,
  writeRecent,
} from "../src/lake/parquet.ts";
import { recentPath, seriesPath } from "../src/lake/paths.ts";
import { updateRecent } from "../src/lake/recent.ts";
import { judgeFetched, requalify } from "../src/lake/requalify.ts";
import { fromSource, qc, withSourceFlag } from "../src/qc.ts";
import { source as gesla } from "../src/sources/gesla/index.ts";
import { Flag, Unjudged, type LakeStation, type Observation, type Source } from "../src/schema.ts";

const HOUR = 3_600_000;
const NEW_YEAR = Date.UTC(2025, 0, 1);

const station = {
  id: "test/1",
  source: "test",
  source_id: "1",
  datum: "NAP",
  kind: "coastal",
  products: ["levels"],
  status: "active",
  live: true,
  interval_s: 3600,
  epochs: [
    {
      id: 1,
      datum: "NAP",
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
} as unknown as LakeStation;

function source(extra: Partial<Source> = {}): Source {
  return { metadata: { id: "test" } as Source["metadata"], stations: async () => [], ...extra };
}

/** Hourly tide over [from, to), with a still stretch at 0.5 m over [stillFrom, stillTo). */
function hourly(from: number, to: number, still: [number, number] = [0, 0]): Observation[] {
  const rows: Observation[] = [];
  for (let t = from; t < to; t += HOUR)
    rows.push({
      time: t,
      level: t >= still[0] && t < still[1] ? 0.5 : Math.sin((2 * Math.PI * t) / (12.42 * HOUR)),
      flag: Flag.good,
    });
  return rows;
}

describe("fromSource", () => {
  it("starts a flag over from the source's, and fills in the source's where it's sure", () => {
    const rows: Observation[] = [
      { time: 0, level: 1, flag: Flag.suspect, source_flag: Flag.good }, // QC's mark
      { time: 1, level: 1, flag: Flag.preliminary }, // before source_flag: QC never sets preliminary
      { time: 2, level: 1, flag: Flag.suspect }, // before source_flag: QC's or the source's
      { time: 3, level: 1, flag: Flag.good, source_flag: Flag.good }, // in an erratum's span
    ];
    assert.deepEqual(
      fromSource(rows, [[3, 4]]).map((r) => [r.flag, r.source_flag]),
      [
        [Flag.good, Flag.good],
        [Flag.preliminary, Flag.preliminary],
        [Flag.suspect, undefined],
        [Flag.suspect, Flag.good],
      ],
    );
  });
});

describe("qc with context", () => {
  it("judges a flatline across New Year whole, and returns only its own rows", () => {
    // 4 hours still on each side of midnight: 8 hours in all, past the 6-hour rule.
    const all = hourly(NEW_YEAR - 10 * 24 * HOUR, NEW_YEAR + 10 * 24 * HOUR, [
      NEW_YEAR - 4 * HOUR,
      NEW_YEAR + 4 * HOUR,
    ]);
    const after = all.filter((r) => r.time >= NEW_YEAR);
    const before = all.filter((r) => r.time < NEW_YEAR);
    assert.equal(qc(after)[0]!.flag, Flag.good);
    const judged = qc(after, {}, before);
    assert.equal(judged.length, after.length);
    assert.deepEqual(
      judged.slice(0, 5).map((r) => r.flag),
      [Flag.suspect, Flag.suspect, Flag.suspect, Flag.suspect, Flag.good],
    );
  });
});

describe("requalify", () => {
  it("clears what a stricter rule flagged once the rule loosens, without fetching", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-requalify-"));
    const path = (year: number) => seriesPath(root, "levels", "test", "1", year);
    // 10 hours still in mid-2024, which a 6-hour rule flags and a 48-hour one doesn't.
    const still: [number, number] = [Date.UTC(2024, 5, 1), Date.UTC(2024, 5, 1, 10)];
    const rows = hourly(Date.UTC(2024, 0, 1), NEW_YEAR, still);
    const strict = qc(withSourceFlag(rows), { flatline_s: 6 * 3600 });
    // A value from before source_flag was kept, which QC marked: it can't be told from the source's.
    const legacy = strict.findIndex((r) => r.time === still[0]);
    delete strict[legacy]!.source_flag;
    await writeObservations(path(2024), strict, "NAP");
    assert.equal(strict.filter((r) => r.flag === Flag.suspect).length, 10);

    // A pooled river gets 48 hours.
    const pooled = { ...station, kind: "river" as const, tidal: false };
    assert.deepEqual(await requalify(source(), pooled, root, 2024, 2025), {
      files: 1,
      changed: 9,
      warnings: [],
    });
    const after = await readObservations(path(2024));
    assert.deepEqual(
      after.filter((r) => r.flag !== Flag.good).map((r) => r.time),
      [still[0]],
    );
    // Nothing changes on a second run, so nothing is written.
    assert.deepEqual(await requalify(source(), pooled, root, 2024, 2025), {
      files: 0,
      changed: 0,
      warnings: [],
    });
    // A stricter rule again flags them, and an erratum's span comes back from the source.
    const span: [number, number] = [Date.UTC(2024, 2, 1), Date.UTC(2024, 2, 2)];
    const errata = source({ suspect: async () => [span] });
    await requalify(errata, station, root, 2024, 2025);
    const flagged = (await readObservations(path(2024))).filter((r) => r.flag === Flag.suspect);
    assert.equal(flagged.length, 10 + 24);
    assert.ok(flagged.every((r) => r.source_flag !== Flag.suspect));
    // A source that can't judge the record still gives its errata's span, with a warning.
    const partial = source({
      suspect: async () => {
        throw new Unjudged("the lake holds part of the record", [span]);
      },
    });
    // A value the source flagged when it was fetched, as GESLA flags a datum jump from its whole file.
    const jump = Date.UTC(2024, 8, 1);
    await writeObservations(
      path(2024),
      (await readObservations(path(2024))).map((r) =>
        r.time === jump ? { ...r, flag: Flag.suspect, source_flag: Flag.good } : r,
      ),
      "NAP",
    );
    const { warnings } = await requalify(partial, station, root, 2024, 2025);
    assert.deepEqual(warnings, ["epoch 1: the lake holds part of the record; its flags are kept"]);
    const kept = await readObservations(path(2024));
    assert.equal(kept.filter((r) => r.flag === Flag.suspect).length, 10 + 24 + 1);
    assert.equal(kept.find((r) => r.time === jump)!.flag, Flag.suspect);
    // Any other error stops the station.
    const broken = source({
      suspect: async () => {
        throw new Error("unreadable");
      },
    });
    await assert.rejects(requalify(broken, station, root, 2024, 2025), /unreadable/);
  });

  it("judges a year with the years either side", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-requalify-"));
    const path = (year: number) => seriesPath(root, "levels", "test", "1", year);
    const all = withSourceFlag(
      hourly(Date.UTC(2024, 11, 1), Date.UTC(2025, 1, 1), [
        NEW_YEAR - 4 * HOUR,
        NEW_YEAR + 4 * HOUR,
      ]),
    );
    await writeObservations(
      path(2024),
      all.filter((r) => r.time < NEW_YEAR),
      "NAP",
    );
    await writeObservations(
      path(2025),
      all.filter((r) => r.time >= NEW_YEAR),
      "NAP",
    );
    await requalify(source(), station, root, 2025, 2026);
    const flags = (await readObservations(path(2025))).slice(0, 5).map((r) => r.flag);
    assert.deepEqual(flags, [Flag.suspect, Flag.suspect, Flag.suspect, Flag.suspect, Flag.good]);
  });
});

describe("updateRecent", () => {
  it("clears a mark an earlier hour's QC left on a stored value", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-requalify-"));
    const path = recentPath(root, "test");
    const NOW = Date.UTC(2026, 10, 5, 12);
    const window = withSourceFlag(hourly(NOW - 48 * HOUR, NOW - HOUR));
    // The source said good; an earlier rule marked it suspect.
    window[10]!.flag = Flag.suspect;
    await writeRecent(path, [window.map((r) => ({ ...r, station: station.id, epoch: 1 }))]);
    await updateRecent({
      source: source({ observations: async () => hourly(NOW - HOUR, NOW) }),
      stations: [station],
      lakeFor: () => root,
      since: new Date(NOW - 2 * HOUR),
      now: NOW,
    });
    const after = await readRecent(path);
    assert.equal(after.find((r) => r.time === window[10]!.time)!.flag, Flag.good);
  });

  it("keeps a mark within a flatline's length of the window's start, where a run can't be seen whole", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-requalify-"));
    const path = recentPath(root, "test");
    const NOW = Date.UTC(2026, 10, 5, 12);
    // The window's first 3 hours are the end of a still stretch an earlier hour saw whole.
    const window = withSourceFlag(
      hourly(NOW - 48 * HOUR, NOW - HOUR, [NOW - 48 * HOUR, NOW - 45 * HOUR]),
    );
    for (const r of window.slice(0, 3)) r.flag = Flag.suspect;
    await writeRecent(path, [window.map((r) => ({ ...r, station: station.id, epoch: 1 }))]);
    await updateRecent({
      source: source({ observations: async () => hourly(NOW - HOUR, NOW) }),
      stations: [station],
      lakeFor: () => root,
      since: new Date(NOW - 2 * HOUR),
      now: NOW,
    });
    const after = await readRecent(path);
    assert.deepEqual(
      after.slice(0, 4).map((r) => r.flag),
      [Flag.suspect, Flag.suspect, Flag.suspect, Flag.good],
    );
  });
});

describe("GESLA's datum jumps over the lake's copy", () => {
  // Hourly over 2000–2003, with 2001 a metre up: a datum jump GESLA flags usable.
  const rows = withSourceFlag(
    hourly(Date.UTC(2000, 0, 1), Date.UTC(2004, 0, 1)).map((r) =>
      r.time >= Date.UTC(2001, 0, 1) && r.time < Date.UTC(2002, 0, 1)
        ? { ...r, level: r.level + 1 }
        : r,
    ),
  );
  const coastal = {
    ...station,
    source_id: "x",
    record_start: "2000-01-01T00:00:00Z",
    record_end: "2003-12-31T23:00:00Z",
  } as LakeStation;
  const years = (from: number) =>
    async function* () {
      yield rows.filter((r) => r.time >= from);
    };

  it("finds them from the whole record", async () => {
    const spans = await gesla.suspect!(coastal, years(0));
    assert.equal(spans.length, 1);
    assert.ok(spans[0]![0] <= Date.UTC(2001, 0, 2) && spans[0]![1] >= Date.UTC(2001, 11, 31));
  });

  it("refuses a copy that misses an end of the record", async () => {
    await assert.rejects(
      gesla.suspect!(coastal, years(Date.UTC(2002, 0, 1))),
      (error: unknown) => error instanceof Unjudged && /whole record/.test(error.message),
    );
  });
});

describe("withSourceFlag", () => {
  it("rounds levels to what the lake reads back, so a fetched value equals its stored copy", () => {
    assert.equal(withSourceFlag([{ time: 0, level: 57 * 0.01, flag: Flag.good }])[0]!.level, 0.57);
  });
});

describe("judgeFetched", () => {
  it("QCs a partial fetch with the whole year and its neighbors, leaving what it didn't fetch", () => {
    const year = hourly(NEW_YEAR, Date.UTC(2025, 2, 1));
    // An old mark on a value the fetch doesn't cover stays; requalify clears it.
    const existing = withSourceFlag(year).map((r, i) =>
      i === 100 ? { ...r, flag: Flag.suspect } : r,
    );
    // February fetched again, now 3 hours still at its start, after 4 still hours that end January.
    const still: [number, number] = [Date.UTC(2025, 0, 31, 20), Date.UTC(2025, 1, 1, 3)];
    const fetched = hourly(Date.UTC(2025, 1, 1), Date.UTC(2025, 2, 1), still);
    const january = existing.map((r) =>
      r.time >= still[0] && r.time < still[1] ? { ...r, level: 0.5 } : r,
    );
    const judged = judgeFetched(
      january,
      fetched,
      Date.UTC(2025, 1, 1),
      Date.UTC(2025, 2, 1),
      {},
      [],
    );
    assert.equal(judged.length, year.length);
    assert.equal(judged[100]!.flag, Flag.suspect);
    // The run is judged whole across the fetch's edge, and only what it fetched starts over.
    const feb = judged.filter((r) => r.time >= Date.UTC(2025, 1, 1) && r.time < still[1]);
    assert.deepEqual(
      feb.map((r) => r.flag),
      [Flag.suspect, Flag.suspect, Flag.suspect],
    );
    // January's half of the run wasn't fetched, so it keeps its flag until requalify.
    const jan = judged.filter((r) => r.time >= still[0] && r.time < Date.UTC(2025, 1, 1));
    assert.ok(jan.length === 4 && jan.every((r) => r.flag === Flag.good));
    assert.ok(feb.every((r) => r.source_flag === Flag.good));
  });
});

describe("readObservations", () => {
  it("reads a station ID with a glob character from its own file alone", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-requalify-"));
    const rows = (level: number) => [{ time: NEW_YEAR, level, flag: Flag.good }];
    await writeObservations(seriesPath(root, "levels", "test", "a*", 2025), rows(1), "NAP");
    await writeObservations(seriesPath(root, "levels", "test", "ab", 2025), rows(2), "NAP");
    const own = await readObservations(seriesPath(root, "levels", "test", "a*", 2025));
    assert.deepEqual(
      own.map((r) => r.level),
      [1],
    );
  });
});

describe("updateRecent with a whole-centimeter flatline rule", () => {
  it("keeps marks within that rule's length of the window's start", async () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-requalify-"));
    const path = recentPath(root, "test");
    const NOW = Date.UTC(2026, 10, 5, 12);
    const window = withSourceFlag(hourly(NOW - 72 * HOUR, NOW - HOUR));
    // 20 hours in: past the 6-hour rule's edge, inside the 48-hour one's.
    window[20]!.flag = Flag.suspect;
    await writeRecent(path, [window.map((r) => ({ ...r, station: station.id, epoch: 1 }))]);
    await updateRecent({
      source: source({ observations: async () => hourly(NOW - HOUR, NOW) }),
      // A small tide, which gets the whole-centimeter rule.
      stations: [{ ...station, tidal: true, tide_m: 0.1 }],
      lakeFor: () => root,
      since: new Date(NOW - 2 * HOUR),
      now: NOW,
    });
    const after = await readRecent(path);
    assert.equal(after.find((r) => r.time === window[20]!.time)!.flag, Flag.suspect);
  });
});
