import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import * as hroi from "../src/hroi/index.ts";
import { PARTIAL_TIDES, SET_2, SET_3, resolvable } from "../src/hroi/constituents.ts";
import { LUNAR_DAY_MS, transits } from "../src/hroi/transits.ts";
import { compareExtremes } from "../src/metrics.ts";
import { parse } from "../src/sources/bsh.ts";
import type { TransitExtreme } from "../src/types.ts";

// January and February 2026 at Cuxhaven, from BSH's published predictions.
const rows = parse(readFileSync(new URL("fixtures/DE__506P2026.txt", import.meta.url), "utf8"));
const bshExtremes: TransitExtreme[] = rows.map((r) => ({
  time: r.time,
  level: r.level,
  type: r.kind === "H" ? "high" : "low",
  transit: r.transit,
  event: r.event as TransitExtreme["event"],
}));
const range = transits(Date.UTC(2025, 11, 29), Date.UTC(2026, 2, 3));

describe("BSH files", () => {
  it("takes times from the Julian date, in UTC", () => {
    // 1 January 2026, 4:50 MEZ.
    assert.equal(new Date(rows[0]!.time).toISOString(), "2026-01-01T03:50:25.000Z");
    assert.deepEqual(
      {
        kind: rows[0]!.kind,
        level: rows[0]!.level,
        transit: rows[0]!.transit,
        event: rows[0]!.event,
      },
      { kind: "N", level: 3.8, transit: 26818, event: 4 },
    );
  });
});

describe("partial tides", () => {
  it("has BSH's sets from Boesch and Müller-Navarra (2019), Table 2", () => {
    assert.equal(SET_2.length, 43);
    assert.equal(SET_3.length, 39);
    assert.ok(PARTIAL_TIDES.every((t, i) => i === 0 || t.omega > PARTIAL_TIDES[i - 1]!.omega));
  });

  it("drops what a record can't separate", () => {
    const year = resolvable(SET_3, 353);
    assert.ok(year.length < SET_3.length);
    assert.ok(!year.some((t) => t.doodson === "ZZZZAZ")); // 18.6 years
    assert.ok(resolvable(SET_3, 19 * 353).length === SET_3.length);
  });
});

describe("transits", () => {
  it("alternates upper and lower, about half a lunar day apart", () => {
    for (let i = 1; i < range.length; i++) {
      assert.notEqual(range[i]!.upper, range[i - 1]!.upper);
      const gap = range[i]!.time - range[i - 1]!.time;
      assert.ok(Math.abs(gap - LUNAR_DAY_MS / 2) < 3_600_000, `gap ${gap}`);
    }
  });

  it("numbers transits the way BSH does", () => {
    const assigned = hroi.assign(bshExtremes, range, { high: 11 + 51 / 60, low: 18 + 36 / 60 });
    assert.equal(assigned.length, bshExtremes.length);
    for (const [i, a] of assigned.entries()) {
      assert.equal(a.transit, bshExtremes[i]!.transit, `transit of event ${i}`);
      assert.equal(a.event, bshExtremes[i]!.event, `index of event ${i}`);
    }
  });
});

describe("HRoI", () => {
  it("estimates BSH's mean lunitidal intervals", () => {
    const intervals = hroi.estimateIntervals(bshExtremes, range);
    // BSH: MHWI 11:51, MNWI 18:36, over a 19-year epoch.
    assert.ok(Math.abs(intervals.high - 11.85) < 0.3, `high ${intervals.high}`);
    assert.ok(Math.abs(intervals.low - 18.6) < 0.3, `low ${intervals.low}`);
  });

  it("recovers a known model", () => {
    const tides = SET_3.filter((t) => ["Mm", "MSf", "Mf"].includes(t.name ?? ""));
    const truth = (n: number, a: number) =>
      a +
      0.3 * Math.cos((tides[1]!.omega * n * Math.PI) / 180) +
      0.1 * Math.sin((tides[0]!.omega * n * Math.PI) / 180);
    const long = transits(Date.UTC(2026, 0, 1), Date.UTC(2026, 6, 1));
    const synthetic = long.flatMap((t) =>
      (["high", "low"] as const).map((type) => {
        const interval = truth(t.number, type === "high" ? 12 : 18.5);
        return {
          time: t.time + interval * 3_600_000,
          level: truth(t.number, type === "high" ? 6 : 3),
          type,
          transit: t.number,
          event: (type === "high" ? (t.upper ? 1 : 3) : t.upper ? 2 : 4) as TransitExtreme["event"],
          interval,
        };
      }),
    );
    const model = hroi.fit(synthetic, { tides });
    const predicted = hroi.predict(model, Date.UTC(2026, 1, 1), Date.UTC(2026, 5, 1));
    const reference = synthetic.filter(
      (e) => e.time >= Date.UTC(2026, 1, 1) && e.time < Date.UTC(2026, 5, 1),
    );
    const comparison = compareExtremes(predicted, reference);
    assert.equal(comparison.matched, reference.length);
    assert.ok(comparison.time.max < 0.01, `time ${comparison.time.max} min`);
    assert.ok(comparison.height.max < 1e-6, `height ${comparison.height.max} m`);
  });

  it("draws a curve through extremes with the mean tide curve", () => {
    const extremes = [
      { time: 0, level: 0, type: "low" as const },
      { time: 6, level: 2, type: "high" as const },
      { time: 12, level: 0, type: "low" as const },
    ];
    const shape = { rise: [0, 0.25, 1], fall: [0, 0.5, 1] };
    assert.deepEqual(
      hroi.curveAt(extremes, shape, [0, 3, 6, 9]).map((s) => s.level),
      [0, 0.5, 2, 1],
    );
  });

  it("picks one high and one low water per transit from a curve", () => {
    const intervals = { high: 3, low: 9.2 };
    // A semidiurnal tide with a double low water, locked to the transits.
    const samples = [];
    for (let t = range[0]!.time; t < range.at(-1)!.time; t += 600_000) {
      const phase = ((t - range[0]!.time) / (LUNAR_DAY_MS / 2)) * 2 * Math.PI;
      samples.push({
        time: t,
        level:
          Math.cos(phase - (3 / 12.42) * 2 * Math.PI) -
          0.2 * Math.cos(2 * (phase - (3 / 12.42) * 2 * Math.PI)),
      });
    }
    const extremes = hroi.canonicalExtremes(samples, range, intervals);
    const highs = extremes.filter((e) => e.type === "high");
    const lows = extremes.filter((e) => e.type === "low");
    assert.ok(Math.abs(highs.length - lows.length) <= 1);
    assert.ok(highs.length >= range.length - 3 && highs.length <= range.length);
  });
});
