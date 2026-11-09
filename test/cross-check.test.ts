import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as harmonic from "../src/harmonic.ts";
import {
  HOUR_MS,
  attribute,
  copies,
  dailyMeans,
  monthlyAgreement,
  runs,
  steps,
  timing,
  type Hourly,
} from "../src/cross-check.ts";

const START = Date.UTC(2020, 0, 1) / HOUR_MS;
const HOURS = 366 * 24;
const M2 = 28.9841042;
const K1 = 15.0410686;
const constituents = [
  { name: "M2", amplitude: 1, phase: 40 },
  { name: "K1", amplitude: 0.3, phase: 200 },
];

/** A year of hourly levels from `level(hour)`, with seeded noise. */
function year(level: (h: number) => number, noise = 0.02): Hourly {
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  return {
    start: START,
    levels: Float64Array.from({ length: HOURS }, (_, i) => level(START + i) + noise * random()),
  };
}

const wave = (speed: number, amplitude: number, phase: number) => (h: number) =>
  amplitude * Math.cos(((speed * h - phase) * Math.PI) / 180);

describe("copies", () => {
  it("finds a month holding another gauge's tide", () => {
    const a = year((h) => wave(M2, 1, 40)(h) + wave(K1, 0.3, 200)(h));
    const b = year((h) => wave(M2, 0.8, 70)(h) + wave(K1, 0.2, 150)(h));
    const may = (Date.UTC(2020, 4, 1) / HOUR_MS - START) | 0;
    const june = (Date.UTC(2020, 5, 1) / HOUR_MS - START) | 0;
    for (let i = may; i < june; i++) b.levels[i] = a.levels[i]! + 0.5;
    const found = copies(monthlyAgreement(a, b));
    assert.deepEqual(
      found.map((c) => c.month),
      ["2020-05"],
    );
    assert.ok(found[0]!.rms < 0.03);
  });

  it("leaves close neighbors that always agree alone", () => {
    const a = year((h) => wave(M2, 1, 40)(h));
    const b = year((h) => wave(M2, 1, 41)(h), 0.01);
    assert.deepEqual(copies(monthlyAgreement(a, b)), []);
  });
  it("flags close neighbors only for an identical month", () => {
    const a = year((h) => wave(M2, 1, 40)(h));
    const b = year((h) => wave(M2, 1, 41)(h), 0.01);
    const may = (Date.UTC(2020, 4, 1) / HOUR_MS - START) | 0;
    const june = (Date.UTC(2020, 5, 1) / HOUR_MS - START) | 0;
    for (let i = may; i < june; i++) b.levels[i] = a.levels[i]! + 0.04;
    assert.deepEqual(
      copies(monthlyAgreement(a, b)).map((c) => c.month),
      ["2020-05"],
    );
  });

  it("leaves records of one gauge alone when some months match exactly", () => {
    const a = year((h) => wave(M2, 1, 40)(h));
    const b = year((h) => wave(M2, 1, 40)(h) + 1, 0.01);
    const may = (Date.UTC(2020, 4, 1) / HOUR_MS - START) | 0;
    const june = (Date.UTC(2020, 5, 1) / HOUR_MS - START) | 0;
    for (let i = may; i < june; i++) b.levels[i] = a.levels[i]! + 1;
    assert.deepEqual(copies(monthlyAgreement(a, b)), []);
  });

  it("leaves two records of one gauge alone", () => {
    const a = year((h) => wave(M2, 1, 40)(h));
    const b = { start: a.start, levels: a.levels.map((v) => v + 1) };
    assert.deepEqual(copies(monthlyAgreement(a, b)), []);
  });
});

describe("timing", () => {
  it("times a clock 20 minutes late in both bands", () => {
    const model = { constituents, offset: 0, rms: 0 };
    const lateFrom = START + 195 * 24;
    const late = (h: number) => (h >= lateFrom && h < lateFrom + 45 * 24 ? 20 / 60 : 0);
    const truth = harmonic.timeline(
      model,
      Array.from({ length: HOURS }, (_, i) => (START + i - late(START + i)) * HOUR_MS),
    );
    // Stamped `late` hours after the level it carries was measured.
    const series = { start: START, levels: Float64Array.from(truth, (p) => p.level) };
    const found = timing(series, model);
    const inside = found.filter(
      (w) => w.time / HOUR_MS >= lateFrom && w.time / HOUR_MS + 360 <= lateFrom + 45 * 24,
    );
    assert.equal(inside.length, 2);
    for (const w of inside) {
      assert.ok(Math.abs(w.semidiurnal - 20) < 2, `semidiurnal ${w.semidiurnal}`);
      assert.ok(Math.abs(w.diurnal! - 20) < 2, `diurnal ${w.diurnal}`);
    }
    // The last window too, which needs the prediction's final half hour.
    assert.ok(found.every((w) => Number.isFinite(w.semidiurnal) && Number.isFinite(w.diurnal!)));
    for (const w of found.filter((w) => w.time / HOUR_MS + 360 <= lateFrom))
      assert.ok(Math.abs(w.semidiurnal) < 0.5 && Math.abs(w.diurnal!) < 0.5);
  });
});

describe("runs", () => {
  it("joins consecutive departures and drops single ones", () => {
    const values = [0, 0, 9, 0, 0, 10, 12, 11, 0, -9, -10, 0].map((value, i) => ({
      time: i,
      value,
    }));
    assert.deepEqual(runs(values, 8, 1), [
      { from: 5, to: 7, count: 3, peak: 12 },
      { from: 9, to: 10, count: 2, peak: -10 },
    ]);
  });
});

describe("steps", () => {
  const days = (f: (d: number) => number, n = 400) =>
    new Map(Array.from({ length: n }, (_, d) => [18000 + d, f(18000 + d)]));
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.04;

  it("finds a step and where it starts", () => {
    const found = steps(days((d) => (d >= 18200 ? 0.2 : 0) + noise()));
    assert.equal(found.length, 1);
    assert.ok(Math.abs(found[0]!.day - 18200) <= 2);
    assert.ok(Math.abs(found[0]!.size - 0.2) < 0.03);
  });

  it("puts a step on the station that has it", () => {
    const common = days(() => noise());
    const shifted = (offset: number) =>
      new Map([...common].map(([d, v]) => [d, v + offset + noise()]));
    const station = new Map([...shifted(0)].map(([d, v]) => [d, v + (d >= 18200 ? 0.15 : 0)]));
    const neighbors = new Map([
      ["a", shifted(1)],
      ["b", shifted(2)],
      ["c", shifted(3)],
    ]);
    const found = attribute(station, neighbors);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.seen.length, 3);
    // From the neighbor's side, the step shows against one station only.
    assert.deepEqual(
      attribute(
        neighbors.get("a")!,
        new Map([
          ["s", station],
          ["b", neighbors.get("b")!],
          ["c", neighbors.get("c")!],
        ]),
      ),
      [],
    );
  });
  it("doesn't count a neighbor too sparse to show the step against it", () => {
    const common = days(() => noise());
    const shifted = (offset: number) =>
      new Map([...common].map(([d, v]) => [d, v + offset + noise()]));
    const station = new Map([...shifted(0)].map(([d, v]) => [d, v + (d >= 18200 ? 0.2 : 0)]));
    // A day either side of the step, and a stretch well before it.
    const sparse = (offset: number) =>
      new Map([...shifted(offset)].filter(([d]) => d < 18100 || d === 18199 || d === 18200));
    const neighbors = new Map([
      ["a", shifted(1)],
      ["b", shifted(2)],
      ["c", sparse(3)],
      ["d", sparse(4)],
    ]);
    const found = attribute(station, neighbors);
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]!.unseen, []);
  });
});

describe("dailyMeans", () => {
  it("keeps only days with enough hours", () => {
    const levels = new Float64Array(48).fill(1);
    levels.fill(NaN, 24, 30);
    const means = dailyMeans({ start: START, levels });
    assert.equal(means.size, 1);
  });
});
