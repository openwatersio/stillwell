import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { constituents as catalog, createTidePredictor } from "@slackwater/engine";
import {
  bandRms,
  compareConstants,
  compareCurves,
  compareTurns,
  conditioning,
  pickTurns,
  rmsOf,
  sawYear,
  scoreHeldOut,
  seasonalSpread,
  symmetricEigen,
  tidalResiduals,
  varianceDifferenceSE,
  yearlyScatter,
  yearlySet,
} from "../src/fit/scores.ts";
import type { Sample } from "../src/types.ts";

const HOUR = 3_600_000;
const START = Date.UTC(2021, 0, 1);

/** `toBeCloseTo`: within 10^-digits / 2 of the expected value. */
function close(actual: number, expected: number, digits = 2) {
  assert.ok(
    Math.abs(actual - expected) < 10 ** -digits / 2,
    `expected ${actual} to be within ${10 ** -digits / 2} of ${expected}`,
  );
}

/** Hourly levels of `constituents` from START, plus `extra(hour)`. */
const series = (
  hours: number,
  constituents: { name: string; amplitude: number; phase: number }[],
  extra = (_h: number) => 0,
): Sample[] => {
  const p = createTidePredictor(constituents, { offset: false });
  return Array.from({ length: hours }, (_, h) => ({
    time: START + h * HOUR,
    level: p.getWaterLevelAtTime({ time: new Date(START + h * HOUR) }).level + extra(h),
  }));
};

const TIDE = [
  { name: "M2", amplitude: 1, phase: 40 },
  { name: "S2", amplitude: 0.3, phase: 80 },
  { name: "K1", amplitude: 0.2, phase: 120 },
  { name: "O1", amplitude: 0.15, phase: 200 },
];

describe("tidalResiduals", () => {
  it("is zero for the constants that made the series, after the Godin filter", () => {
    const year = series(24 * 120, TIDE, (h) => 0.5 + 0.2 * Math.sin(h / 500));
    const { rms, hours } = rmsOf(tidalResiduals(TIDE, year));
    assert.ok(rms < 2e-3);
    // The filter's 71 hours eat 35 at each end.
    assert.equal(hours, 24 * 120 - 70);
  });

  it("shows an amplitude error as its RMS", () => {
    const year = series(24 * 120, TIDE);
    const wrong = TIDE.map((c) => (c.name === "M2" ? { ...c, amplitude: 0.9 } : c));
    close(rmsOf(tidalResiduals(wrong, year)).rms, 0.1 / Math.SQRT2, 2);
  });
});

describe("bandRms", () => {
  it("puts a semidiurnal residual in D2 alone", () => {
    const residuals = new Map(
      Array.from({ length: 24 * 365 }, (_, h) => [
        h,
        0.1 * Math.cos((2 * Math.PI * 1.93 * h) / 24),
      ]),
    );
    const bands = bandRms(residuals);
    close(bands.D2, 0.1 / Math.SQRT2, 3);
    assert.ok(bands.D1 < 1e-3);
    assert.ok(bands.D4 < 1e-3);
    assert.ok(bands.D6 < 1e-3);
  });
});

describe("pickTurns", () => {
  it("finds the engine's high and low waters to the minute", () => {
    const turns = pickTurns(series(24 * 30, TIDE), 0.1);
    const engine = createTidePredictor(TIDE, { offset: false })
      .getExtremesPrediction({
        start: new Date(START + HOUR),
        end: new Date(START + 24 * 29 * HOUR),
      })
      .map((e) => ({ time: +e.time, level: e.level, high: e.high }));
    assert.ok(turns.every((t, i) => i === 0 || t.high !== turns[i - 1]!.high));
    const scores = compareTurns(engine, turns);
    assert.equal(scores.unmatched, 0);
    assert.ok(scores.timeRms < 2);
    assert.ok(scores.heightRms < 0.005);
  });

  it("ignores a wiggle smaller than the gauge's least range", () => {
    const wiggle = (h: number) => 0.02 * Math.cos((2 * Math.PI * h) / 3);
    const clean = pickTurns(series(24 * 10, [TIDE[0]!]), 0.1);
    const noisy = pickTurns(series(24 * 10, [TIDE[0]!], wiggle), 0.1);
    assert.equal(noisy.length, clean.length);
  });

  it("picks each run of hours on its own", () => {
    const s = series(24 * 10, [TIDE[0]!]).filter((_, h) => h < 100 || h >= 106);
    const turns = pickTurns(s, 0.1);
    assert.ok(turns.every((t) => t.time < START + 100 * HOUR || t.time > START + 106 * HOUR));
  });
});

describe("compareTurns", () => {
  it("measures a constant lag", () => {
    const observed = pickTurns(series(24 * 30, TIDE), 0.1);
    const late = observed.map((t) => ({ ...t, time: t.time + 10 * 60_000 }));
    const scores = compareTurns(observed, late);
    assert.equal(scores.matched, observed.length);
    close(scores.timeMean, 10, 6);
    close(scores.timeRms, 10, 6);
    assert.equal(scores.heightRms, 0);
  });
});

describe("held-out scoring", () => {
  it("scores every set with the same code, and calls a clear loser worse", () => {
    const year = series(24 * 365, TIDE, (h) => 0.03 * Math.sin(h * 0.7));
    const scores = scoreHeldOut(year, TIDE, {
      exact: { constituents: TIDE, seen: false },
      worse: {
        constituents: TIDE.map((c) => (c.name === "M2" ? { ...c, phase: c.phase + 3 } : c)),
        seen: true,
      },
    });
    const { exact, worse } = scores.others;
    assert.equal(typeof exact!.se, "number");
    assert.ok(Math.abs(exact!.rms - scores.fit.rms) <= 2 * exact!.se!);
    assert.equal(typeof worse!.se, "number");
    assert.ok(worse!.rms - scores.fit.rms > 2 * worse!.se!);
    assert.equal(worse!.seen, true);
    assert.ok(scores.fit.turns.matched > 1300);
  });

  it("can't measure the error of a year too short for two 30-day blocks", () => {
    const a = new Map([[0, 1]]);
    assert.equal(varianceDifferenceSE(a, a), null);
  });

  it("knows whether a record's analysis saw the year", () => {
    const year = [new Date("2024-01-01"), new Date("2025-01-01")] as const;
    assert.equal(sawYear({ start: "2006-01-01", end: "2020-12-31" }, ...year), false);
    assert.equal(sawYear({ start: "1915-01-01", end: "2024-03-01" }, ...year), true);
    assert.equal(sawYear(undefined, ...year), true);
    assert.equal(sawYear({ start: "unknown", end: "2024-03-01" }, ...year), true);
  });
});

describe("conditioning", () => {
  it("decomposes a symmetric matrix", () => {
    const { values } = symmetricEigen([
      [2, 1],
      [1, 2],
    ]);
    values.sort();
    close(values[0]!, 1, 12);
    close(values[1]!, 3, 12);
  });

  it("finds K1 and P1 inseparable in a month and separable in a year", () => {
    const names = ["M2", "K1", "P1"];
    const month = series(24 * 30, []);
    const year = series(24 * 365, []);
    const short = conditioning(month, names);
    const long = conditioning(year, names);
    assert.deepEqual(short.maxCorrelation!.between.sort(), ["K1", "P1"]);
    assert.ok(short.maxCorrelation!.value > 0.5);
    assert.ok(short.conditionNumber! > long.conditionNumber!);
    assert.ok(long.maxCorrelation!.value < 0.05);
  });

  it("calls a design matrix with a repeated constituent singular", () => {
    assert.deepEqual(conditioning(series(24 * 30, []), ["M2", "M2"]), {
      conditionNumber: null,
      maxCorrelation: null,
    });
  });

  it("fits each year without the whole record's weights", () => {
    const years = series(24 * 365 * 2, TIDE);
    const weights = years.map(() => 1);
    assert.equal(yearlyScatter(years, ["M2", "S2", "K1", "O1"], { weights }).years, 2);
  });
});

describe("yearly fits", () => {
  it("keep one fixed set a year separates", () => {
    assert.deepEqual(yearlySet(["M2", "S2", "K1", "N2", "T2", "S1", "P1"]), [
      "M2",
      "S2",
      "K1",
      "N2",
      "P1",
    ]);
    assert.notEqual(catalog["T2"], undefined);
  });

  it("show no scatter in a stationary tide", () => {
    const years = series(24 * 365 * 3, TIDE);
    const scatter = yearlyScatter(years, ["M2", "S2", "K1", "O1"]);
    assert.equal(scatter.years, 3);
    assert.ok(scatter.constituents["M2"]!.amplitude < 1e-4);
    assert.ok(scatter.constituents["K1"]!.phase < 0.05);
  });
});

describe("agency comparison", () => {
  it("gives differences and the ratio to our interval", () => {
    const diff = compareConstants(
      [
        {
          name: "M2",
          amplitude: 1.002,
          phase: 1,
          amplitudeInterval: 0.001,
          phaseInterval: 1,
        },
      ],
      [{ name: "M2", amplitude: 1, phase: 359 }],
    );
    assert.equal(diff.length, 1);
    const { amplitude, ratio, ...rest } = diff[0]!;
    assert.deepEqual(rest, {
      name: "M2",
      phase: 2,
      amplitudeInterval: 0.001,
      phaseInterval: 1,
    });
    close(amplitude, 0.002, 12);
    close(ratio!, 2, 9);
  });

  it("compares curves on another datum by shape", () => {
    const a = [1, 2, 3].map((x, i) => ({ time: i, level: x }));
    const b = [1, 2, 3].map((x, i) => ({ time: i, level: x + 5 }));
    assert.deepEqual(compareCurves(a, b), { n: 3, rms: 0, max: 0 });
  });
});

describe("seasonalSpread", () => {
  it("gives the yearly vectors' mean and the standard error of one component", () => {
    // Three years of Sa at 0.10 m, phases 80°, 90° and 100°.
    const spread = seasonalSpread([
      { amplitude: 0.1, phase: 80 },
      { amplitude: 0.1, phase: 90 },
      { amplitude: 0.1, phase: 100 },
    ])!;
    close(spread.phase, 90, 6);
    // The mean of three unit vectors 10° apart is cos 10°·(1 + 2)/3 shorter.
    const mean = (0.1 * (1 + 2 * Math.cos(Math.PI / 18))) / 3;
    close(spread.amplitude, mean, 9);
    const ss =
      2 * (0.1 * Math.sin(Math.PI / 18)) ** 2 +
      2 * (0.1 * Math.cos(Math.PI / 18) - mean) ** 2 +
      (0.1 - mean) ** 2;
    close(spread.scatter, Math.sqrt(ss / 4), 12);
    close(spread.se, spread.scatter / Math.sqrt(3), 12);
  });

  it("needs two years", () => {
    assert.equal(seasonalSpread([{ amplitude: 0.1, phase: 0 }]), undefined);
  });

  it("a cycle whose phase wanders from year to year has a small mean and a large error", () => {
    const spread = seasonalSpread([0, 90, 180, 270].map((phase) => ({ amplitude: 0.1, phase })))!;
    assert.ok(spread.amplitude < 1e-12);
    assert.ok(spread.amplitude < 2 * spread.se);
  });
});
