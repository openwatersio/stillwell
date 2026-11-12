import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  JUDGE,
  RULES,
  analyze,
  judge,
  markRequalified,
  pending,
  readAnalysis,
  withAnalysis,
  writeAnalysis,
} from "../src/store/analysis.ts";
import {
  readJsonArray,
  writeObservations,
  writeRows,
  writeStationBounds,
} from "../src/store/parquet.ts";
import { analysisHistoryPath, seriesPath } from "../src/store/paths.ts";
import { qcFor } from "../src/store/recent.ts";
import {
  Flag,
  Unjudged,
  type StoredStation,
  type Observation,
  type Source,
} from "../src/schema.ts";
import { DRAINS_RUNS, TIDE_M, drains } from "../src/tidal.ts";
import { fromSource, qc } from "../src/qc.ts";

const QUARTER = 900_000;
const M2_H = 12.4206012;

const river = (source_id: string, extra: Partial<StoredStation> = {}) =>
  ({
    id: `test/${source_id}`,
    source: "test",
    source_id,
    datum: "NAVD88",
    datums: {},
    kind: "river",
    epochs: [{ id: 1, datum: "NAVD88", state: "open" }],
    ...extra,
  }) as unknown as StoredStation;

const source = { metadata: { id: "test" }, stations: async () => [] } as unknown as Source;

/** 15-minute levels over `days` of 2026 from `level(hour)`, as the source sent them. */
function series(days: number, level: (h: number) => number): Observation[] {
  return Array.from({ length: days * 96 }, (_, i) => ({
    time: Date.UTC(2026, 0, 1) + i * QUARTER,
    level: Math.round(level(i / 4) * 1000) / 1000,
    flag: Flag.good,
    source_flag: Flag.good,
  }));
}
const tide = (amplitude: number) => (h: number) => amplitude * Math.cos((2 * Math.PI * h) / M2_H);
/** A pooled river: 30 cm, drifting 5 cm over ten days, with a three-week flood of two meters. */
const pooled = (h: number) =>
  0.3 + 0.05 * Math.sin((2 * Math.PI * h) / 240) + (h > 1000 && h < 1500 ? 2 : 0);

describe("judge", () => {
  it("finds a tidal river, and a pooled one", () => {
    const tidal = judge(river("1"), series(90, tide(0.5)));
    assert.equal(tidal.tidal, true);
    assert.ok(Math.abs(tidal.tide_m! - 0.5) < 0.05);
    assert.equal(tidal.days, 90);
    assert.equal(judge(river("2"), series(90, pooled)).tidal, false);
  });

  it("can't say under 30 days, and keeps out water high above the sea", () => {
    assert.equal(judge(river("1"), series(20, tide(0.5))).tidal, null);
    // A gage whose zero is 600 m up, as at a mountain tailwater.
    const high = river("3", { datum: "GAGE", datums: { NAVD88: 600 } });
    const verdict = judge(high, series(90, tide(TIDE_M * 2)));
    assert.equal(verdict.tidal, false);
    assert.ok(verdict.tide_m! >= TIDE_M);
  });

  it("leaves water that drains between tides still", () => {
    // Held at its low level for 8 hours every week: a creek drained to a sill.
    const level = (h: number) => (h % 168 < 8 ? -0.5 : tide(0.5)(h));
    const verdict = judge(river("4"), series(90, level));
    assert.ok(verdict.drains! > DRAINS_RUNS);
    assert.equal(verdict.tidal, false);
    // On the coast those runs are a stuck or dry gauge, for QC to flag, not still water.
    const coast = judge(river("5", { kind: "coastal" }), series(90, level));
    assert.equal(coast.tidal, true);
  });

  it("doesn't count holds that a small whole-centimeter tide's rules let stand", () => {
    // A 12 cm tide held at its low water for 8 hours every week, as at Werkendam.
    const held = (h: number) => (h % 168 < 8 ? -0.12 : tide(0.12)(h));
    const whole = series(90, (h) => Math.round(held(h) * 100) / 100);
    const verdict = judge(river("8"), whole);
    assert.equal(verdict.drains, 0);
    assert.equal(verdict.tidal, true);
    // A plain six-hour limit would have counted each hold.
    const start = fromSource(whole);
    const still = qc(start, { flatline_s: 48 * 3600, outliers: false });
    assert.ok(drains(still, qc(start, { outliers: false })) > DRAINS_RUNS);
    // Where a tidal verdict would turn the outlier check on, the holds still count.
    const unlabeled = judge(river("10", { kind: null }), whole);
    assert.ok(unlabeled.drains! > DRAINS_RUNS);
    assert.equal(unlabeled.tidal, false);
    // In millimeters QC gives the same tide six hours, so the holds still count.
    const fine = judge(river("9"), series(90, held));
    assert.ok(fine.drains! > DRAINS_RUNS);
    assert.equal(fine.tidal, false);
  });

  it("measures every year from its last usable value", () => {
    // 90 days of tide, then 300 days the source flagged bad: the year is still the tide's.
    const rows = series(390, tide(0.5)).map((r, i) =>
      i >= 90 * 96 ? { ...r, flag: Flag.bad, source_flag: Flag.bad } : r,
    );
    const verdict = judge(river("7"), rows);
    assert.equal(verdict.days, 90);
    assert.equal(verdict.tidal, true);
  });

  it("counts held levels, not outliers, against a tide", () => {
    // An estuary's week-long surge of 1.06 m on a 10 cm tide: its high waters cross the
    // outlier rule's line, about 1.05 m, and its low waters don't, 14 times.
    const surge = (h: number) => tide(0.1)(h) + (h > 1000 && h < 1168 ? 1.06 : 0);
    const verdict = judge(river("6", { kind: "estuary" }), series(90, surge));
    assert.equal(verdict.drains, 0);
    assert.equal(verdict.tidal, true);
  });
});

describe("qcFor", () => {
  it("gives tidal water six hours and still water two days, by verdict, then by kind", () => {
    const still = { flatline_s: 48 * 3600, outliers: false, held: false };
    assert.deepEqual(qcFor(river("1", { tidal: true, tide_m: 0.5 })), { outliers: false });
    assert.deepEqual(qcFor(river("2", { tidal: false })), still);
    // A tide under 30 cm can sit on one centimeter for hours; one of 30 cm or more can't.
    assert.equal(qcFor(river("5", { tidal: true, tide_m: 0.3 })).centimeter_flatline_s, undefined);
    assert.equal(qcFor(river("3", { tidal: true, tide_m: 0.09 })).centimeter_flatline_s, 48 * 3600);
    // A tidal river floods, so only it and a lake drop the outlier check, and the
    // residual jumps, since a river's tide is too far from harmonic.
    const tidal = { jumps: true };
    assert.deepEqual(qcFor({ kind: "coastal", tidal: true, tide_m: 1 }), tidal);
    assert.deepEqual(qcFor({ kind: "estuary", tidal: true, tide_m: 1 }), tidal);
    assert.deepEqual(qcFor({ kind: null, tidal: true, tide_m: 1 }), tidal);
    // A sea without a tide holds a centimeter for a day, but not a millimeter.
    assert.deepEqual(qcFor({ kind: "coastal", tidal: false }), {
      centimeter_flatline_s: 48 * 3600,
      outliers: false,
      held: false,
    });
    // With no verdict: a river or lake as still, anything else, water of no kind included, as tidal.
    assert.deepEqual(qcFor({ kind: "coastal", tidal: null }), tidal);
    assert.deepEqual(qcFor({ kind: "estuary", tidal: null }), tidal);
    assert.deepEqual(qcFor({ kind: null, tidal: null }), tidal);
    assert.deepEqual(qcFor(river("4", { tidal: null })), still);
  });
});

describe("analyze", () => {
  it("writes each station's verdict, lists those whose QC changes, and skips those not due", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-analysis-"));
    const stations = [river("1"), river("2"), river("3")];
    await writeObservations(
      seriesPath(store, "levels", "test", "1", 2026),
      series(90, tide(0.5)),
      "NAVD88",
    );
    await writeObservations(
      seriesPath(store, "levels", "test", "2", 2026),
      series(90, pooled),
      "NAVD88",
    );
    // Station 3 has no values, so no bounds, and isn't judged.
    const last = new Date(Date.UTC(2026, 2, 31)).toISOString();
    await writeStationBounds(`${store}/stations/bounds/test.parquet`, [
      { id: "test/1", first: "2026-01-01T00:00:00Z", last },
      { id: "test/2", first: "2026-01-01T00:00:00Z", last },
    ]);
    const now = new Date(Date.UTC(2026, 3, 1));
    const report = await analyze(store, source, stations, { now });
    assert.equal(report.judged, 2);
    assert.deepEqual(report.failed, []);
    // A river with no verdict is judged still, so only the tidal one changes its rules.
    assert.deepEqual(
      report.changed.map((c) => [c.id, c.from, c.to]),
      [["test/1", null, true]],
    );
    const analysis = await readAnalysis(store, "test");
    assert.equal(analysis.get("test/1")!.tidal, true);
    assert.equal(analysis.get("test/2")!.tidal, false);
    assert.equal(analysis.get("test/1")!.rules, RULES);
    assert.ok(!analysis.has("test/3"));
    const history = await readJsonArray(analysisHistoryPath(store, "test", now.toISOString()));
    assert.deepEqual(history, [{ rules: RULES, judge: JUDGE, changed: report.changed }]);
    const [first] = await withAnalysis(store, "test", stations);
    assert.equal(first!.tidal, true);
    // Both wait for requalify: their stored years may be under rules no build has now.
    assert.deepEqual(pending(analysis), ["test/1", "test/2"]);
    await markRequalified(store, "test", ["test/1", "test/2"], now);
    assert.deepEqual(pending(await readAnalysis(store, "test")), []);

    // A month later nothing is due.
    const later = await analyze(store, source, stations, { now: new Date(Date.UTC(2026, 4, 1)) });
    assert.equal(later.judged, 0);
    assert.equal((await readAnalysis(store, "test")).size, 2);
    // `all` judges every station again, and nothing changes.
    const all = await analyze(store, source, stations, { now, all: true });
    assert.equal(all.judged, 2);
    assert.deepEqual(all.changed, []);
    assert.deepEqual(pending(await readAnalysis(store, "test")), []);
    // New rules requalify every station, though no verdict changes.
    const rules = await readAnalysis(store, "test");
    await writeAnalysis(
      store,
      "test",
      [...rules.values()].map((a) => ({ ...a, rules: "older" })),
    );
    const rejudged = await analyze(store, source, stations, { now });
    assert.deepEqual(rejudged.changed, []);
    assert.deepEqual(pending(await readAnalysis(store, "test")), ["test/1", "test/2"]);
    // A new judge judges every station again, and requalifies only those whose QC changes.
    await markRequalified(store, "test", ["test/1", "test/2"], now);
    const judged = await readAnalysis(store, "test");
    await writeAnalysis(
      store,
      "test",
      [...judged.values()].map((a) =>
        a.id === "test/1" ? { ...a, judge: "older", tidal: false } : { ...a, judge: "older" },
      ),
    );
    const rejudged2 = await analyze(store, source, stations, { now });
    assert.equal(rejudged2.judged, 2);
    assert.deepEqual(
      rejudged2.changed.map((c) => c.id),
      ["test/1"],
    );
    assert.deepEqual(pending(await readAnalysis(store, "test")), ["test/1"]);
  });

  it("judges every station again from a file written before `judge` was kept", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-analysis-"));
    await writeObservations(
      seriesPath(store, "levels", "test", "1", 2026),
      series(90, tide(0.5)),
      "NAVD88",
    );
    await writeStationBounds(`${store}/stations/bounds/test.parquet`, [
      { id: "test/1", first: "2026-01-01T00:00:00Z", last: "2026-03-31T00:00:00Z" },
    ]);
    const now = new Date(Date.UTC(2026, 3, 1));
    // As the first build wrote it: no `judge` column.
    await writeRows(
      `${store}/stations/analysis/test.parquet`,
      [
        {
          id: "test/1",
          analyzed: now.toISOString(),
          rules: RULES,
          tidal: true,
          tide_m: 0.5,
          days: 90,
          drains: 0,
          requalified: now.toISOString(),
        },
      ],
      {
        id: "VARCHAR",
        analyzed: "TIMESTAMPTZ",
        rules: "VARCHAR",
        tidal: "BOOLEAN",
        tide_m: "DOUBLE",
        days: "INTEGER",
        drains: "INTEGER",
        requalified: "TIMESTAMPTZ",
      },
      "id",
    );
    assert.equal((await readAnalysis(store, "test")).get("test/1")!.judge, null);
    const report = await analyze(store, source, [river("1")], { now });
    assert.equal(report.judged, 1);
    const row = (await readAnalysis(store, "test")).get("test/1")!;
    assert.equal(row.judge, JUDGE);
    // Its verdict and so its QC are unchanged, so it isn't requalified.
    assert.equal(row.requalified, now.toISOString());
  });

  it("judges a station its source can't judge with the spans it gives, with a warning, and fails on other errors", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-analysis-"));
    await writeObservations(
      seriesPath(store, "levels", "test", "1", 2026),
      series(90, tide(0.5)),
      "NAVD88",
    );
    await writeStationBounds(`${store}/stations/bounds/test.parquet`, [
      { id: "test/1", first: "2026-01-01T00:00:00Z", last: "2026-03-31T00:00:00Z" },
    ]);
    const refusing = {
      ...source,
      suspect: async () => {
        throw new Unjudged("not its whole record");
      },
    } as Source;
    const report = await analyze(store, refusing, [river("1")], {
      now: new Date(Date.UTC(2026, 3, 1)),
    });
    assert.deepEqual(report.failed, []);
    assert.equal(report.warned.length, 1);
    assert.equal((await readAnalysis(store, "test")).get("test/1")!.tidal, true);
    const broken = {
      ...source,
      suspect: async () => {
        throw new Error("unreadable");
      },
    } as Source;
    const failed = await analyze(store, broken, [river("1")], {
      now: new Date(Date.UTC(2026, 3, 1)),
      all: true,
    });
    assert.equal(failed.failed.length, 1);
  });

  it("keeps a verdict its latest values can't give, and leaves out flags it can't start over", async () => {
    const store = mkdtempSync(join(tmpdir(), "stillwell-analysis-"));
    const stations = [river("1")];
    const path = seriesPath(store, "levels", "test", "1", 2026);
    // A suspect value from before source_flag was kept.
    const rows = series(90, tide(0.5));
    rows[100] = { time: rows[100]!.time, level: 9, flag: Flag.suspect };
    await writeObservations(path, rows, "NAVD88");
    await writeStationBounds(`${store}/stations/bounds/test.parquet`, [
      { id: "test/1", first: "2026-01-01T00:00:00Z", last: "2026-03-31T00:00:00Z" },
    ]);
    const now = new Date(Date.UTC(2026, 3, 1));
    const first = await analyze(store, source, stations, { now });
    assert.deepEqual(first.failed, []);
    assert.equal((await readAnalysis(store, "test")).get("test/1")!.tidal, true);
    // A year later its values span 20 days, too few to say.
    await writeObservations(path, series(20, tide(0.5)), "NAVD88");
    const later = await analyze(store, source, stations, { now: new Date(Date.UTC(2027, 3, 2)) });
    assert.equal(later.judged, 1);
    assert.deepEqual(later.changed, []);
    const kept = (await readAnalysis(store, "test")).get("test/1")!;
    assert.equal(kept.tidal, true);
    assert.equal(kept.analyzed, now.toISOString());
    // New rules still requalify it under the verdict it keeps.
    await markRequalified(store, "test", ["test/1"], now);
    await writeAnalysis(store, "test", [
      { ...kept, rules: "older", requalified: now.toISOString() },
    ]);
    await analyze(store, source, stations, { now: new Date(Date.UTC(2027, 3, 3)) });
    const bumped = (await readAnalysis(store, "test")).get("test/1")!;
    assert.deepEqual([bumped.tidal, bumped.rules, bumped.requalified], [true, RULES, null]);
  });
});
