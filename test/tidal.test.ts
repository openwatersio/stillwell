import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromSource, qc } from "../src/qc.ts";
import { Flag } from "../src/schema.ts";
import { DRAINS_RUNS, TIDE_M, drains, tidal } from "../src/tidal.ts";

describe("tidal", () => {
  const HOUR = 3_600_000;
  /** Hourly levels over `days`, from 2020, of `level(hour)`, with GESLA's flags all good. */
  const record = (days: number, level: (h: number) => number) => {
    const times = Float64Array.from(
      { length: days * 24 },
      (_, h) => Date.UTC(2020, 0, 1) + h * HOUR,
    );
    return {
      times,
      levels: Float64Array.from(times, (_, h) => level(h)),
      source: new Uint8Array(times.length),
    };
  };
  const wave = (amplitude: number, periodHours: number) => (h: number) =>
    amplitude * Math.cos((2 * Math.PI * h) / periodHours);
  // A pooled river: flat, then a three-week flood of two meters.
  const flood = (h: number) => (h > 2000 && h < 2500 ? 2 : 0);

  it("finds a semidiurnal tide, or a diurnal one, of TIDE_M", () => {
    assert.equal(tidal(record(90, wave(TIDE_M + 0.01, 12.4206012))), true);
    assert.equal(tidal(record(90, wave(TIDE_M + 0.01, 25.8193417))), true);
  });

  it("finds none in a pooled river's floods, a smaller tide, or a daily schedule", () => {
    assert.equal(tidal(record(180, flood)), false);
    assert.equal(tidal(record(90, wave(TIDE_M - 0.02, 12.4206012))), false);
    // A dam's releases each day and half day, which a solar S2 and K1 would read as a tide.
    assert.equal(tidal(record(90, (h) => wave(0.5, 24)(h) + wave(0.3, 12)(h))), false);
  });

  it("says no under 30 days, and leaves out values GESLA says not to use", () => {
    assert.equal(tidal(record(20, wave(1, 12.4206012))), false);
    // A year of daily values, which alias M2 to a 15-day period.
    const daily = record(366, wave(1, 12.4206012));
    const kept = (_: number, i: number) => i % 24 === 0;
    assert.equal(
      tidal({
        times: daily.times.filter(kept),
        levels: daily.levels.filter(kept),
        source: daily.source.filter(kept),
      }),
      false,
    );
    const unused = record(90, wave(1, 12.4206012));
    unused.source.fill(Flag.suspect);
    assert.equal(tidal(unused), false);
  });
});

describe("drains", () => {
  // 90 days of a 50 cm M2 tide every 15 minutes, held at `at` for 8 hours from each start.
  const series = (holds: number[], at: number) =>
    Array.from({ length: 90 * 96 }, (_, i) => {
      const time = Date.UTC(2026, 0, 1) + i * 900_000;
      const held = holds.some((h) => time >= h && time < h + 8 * 3_600_000);
      const level = held
        ? at
        : Math.round(500 * Math.cos((2 * Math.PI * i) / (12.4206012 * 4))) / 1000;
      return { time, level, flag: Flag.suspect as Flag, source_flag: Flag.good as Flag };
    });
  const judge = (holds: number[], at = -0.4) => {
    // Stored flags say suspect, as after a requalify under the tide gauge's limit.
    const start = fromSource(series(holds, at));
    return (
      drains(
        qc(start, { outliers: false, flatline_s: 48 * 3600 }),
        qc(start, { outliers: false }),
      ) > DRAINS_RUNS
    );
  };
  const days = (n: number) => Array.from({ length: n }, (_, k) => Date.UTC(2026, 0, 10 + 7 * k));

  it("counts the runs only a tide gauge's limit flags, from the source's flags", () => {
    assert.equal(judge(days(DRAINS_RUNS + 1)), true);
    assert.equal(judge(days(DRAINS_RUNS)), false);
  });
});
