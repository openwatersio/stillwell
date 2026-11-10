import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { RULES, analyze, judge, readAnalysis, withAnalysis } from "../src/lake/analysis.ts";
import { readJsonArray, writeObservations, writeStationBounds } from "../src/lake/parquet.ts";
import { analysisHistoryPath, seriesPath } from "../src/lake/paths.ts";
import { qcFor } from "../src/lake/recent.ts";
import { Flag, type LakeStation, type Observation, type Source } from "../src/schema.ts";
import { DRAINS_RUNS, TIDE_M } from "../src/tidal.ts";

const QUARTER = 900_000;
const M2_H = 12.4206012;

const river = (source_id: string, extra: Partial<LakeStation> = {}) =>
  ({
    id: `test/${source_id}`,
    source: "test",
    source_id,
    datum: "NAVD88",
    datums: {},
    kind: "river",
    epochs: [{ id: 1, datum: "NAVD88", state: "open" }],
    ...extra,
  }) as unknown as LakeStation;

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
    const tidal = judge(source, river("1"), series(90, tide(0.5)));
    assert.equal(tidal.tidal, true);
    assert.ok(Math.abs(tidal.tide_m! - 0.5) < 0.05);
    assert.equal(tidal.days, 90);
    assert.equal(judge(source, river("2"), series(90, pooled)).tidal, false);
  });

  it("can't say under 30 days, and keeps out water high above the sea", () => {
    assert.equal(judge(source, river("1"), series(20, tide(0.5))).tidal, null);
    // A gage whose zero is 600 m up, as at a mountain tailwater.
    const high = river("3", { datum: "GAGE", datums: { NAVD88: 600 } });
    const verdict = judge(source, high, series(90, tide(TIDE_M * 2)));
    assert.equal(verdict.tidal, false);
    assert.ok(verdict.tide_m! >= TIDE_M);
  });

  it("leaves water that drains between tides still", () => {
    // Held at its low level for 8 hours every week: a creek drained to a sill.
    const level = (h: number) => (h % 168 < 8 ? -0.5 : tide(0.5)(h));
    const verdict = judge(source, river("4"), series(90, level));
    assert.ok(verdict.drains! > DRAINS_RUNS);
    assert.equal(verdict.tidal, false);
  });
});

describe("qcFor", () => {
  it("gives a tidal river a tide gauge's flatline limit, and other rivers two days", () => {
    const tidal = qcFor(source, river("1", { tidal: true }));
    const pooled = qcFor(source, river("2", { tidal: false }));
    const unknown = qcFor(source, river("3", { tidal: null }));
    assert.equal(tidal.flatline_s, undefined);
    assert.equal(tidal.centimeter_flatline_s, 48 * 3600);
    assert.equal(pooled.flatline_s, 48 * 3600);
    assert.deepEqual(unknown, pooled);
    assert.equal(tidal.outliers, false);
  });
});

describe("analyze", () => {
  it("writes each station's verdict, lists those whose QC changes, and skips those not due", async () => {
    const lake = mkdtempSync(join(tmpdir(), "water-levels-analysis-"));
    const stations = [river("1"), river("2"), river("3")];
    await writeObservations(
      seriesPath(lake, "levels", "test", "1", 2026),
      series(90, tide(0.5)),
      "NAVD88",
    );
    await writeObservations(
      seriesPath(lake, "levels", "test", "2", 2026),
      series(90, pooled),
      "NAVD88",
    );
    // Station 3 has no values, so no bounds, and isn't judged.
    const last = new Date(Date.UTC(2026, 2, 31)).toISOString();
    await writeStationBounds(`${lake}/stations/bounds/test.parquet`, [
      { id: "test/1", first: "2026-01-01T00:00:00Z", last },
      { id: "test/2", first: "2026-01-01T00:00:00Z", last },
    ]);
    const now = new Date(Date.UTC(2026, 3, 1));
    const report = await analyze(lake, source, stations, { now });
    assert.equal(report.judged, 2);
    assert.deepEqual(report.failed, []);
    // A pooled river was already judged still with no verdict, so only the tidal one changes QC.
    assert.deepEqual(
      report.changed.map((c) => [c.id, c.from, c.to]),
      [["test/1", null, true]],
    );
    const analysis = await readAnalysis(lake, "test");
    assert.equal(analysis.get("test/1")!.tidal, true);
    assert.equal(analysis.get("test/2")!.tidal, false);
    assert.equal(analysis.get("test/1")!.rules, RULES);
    assert.ok(!analysis.has("test/3"));
    const history = await readJsonArray(analysisHistoryPath(lake, "test", now.toISOString()));
    assert.deepEqual(history, [{ rules: RULES, changed: report.changed }]);
    const [first] = await withAnalysis(lake, "test", stations);
    assert.equal(first!.tidal, true);

    // A month later nothing is due.
    const later = await analyze(lake, source, stations, { now: new Date(Date.UTC(2026, 4, 1)) });
    assert.equal(later.judged, 0);
    assert.equal((await readAnalysis(lake, "test")).size, 2);
    // `all` judges every station again, and nothing changes.
    const all = await analyze(lake, source, stations, { now, all: true });
    assert.equal(all.judged, 2);
    assert.deepEqual(all.changed, []);
  });
});
