import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nearContext, qc, type QcOptions } from "../src/qc.ts";
import { Flag, type Observation } from "../src/schema.ts";
import { qcFor } from "../src/store/recent.ts";

const MINUTE = 60_000;
const DAY = 86_400_000;

/** A seeded random number in [0, 1), so a failure reproduces. */
function random(seed: number): () => number {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed / 2 ** 31;
  };
}

/**
 * `days` of values every `step` from `from`, in stretches of half a day to
 * six days that mix what the scanning rules judge: a tide, calm water that
 * moves in sub-centimeter steps, whole centimeters, holds, flatlines and gaps,
 * with spikes and placeholders throughout.
 */
function series(rand: () => number, from: number, days: number, step: number): Observation[] {
  const rows: Observation[] = [];
  const modes = ["tide", "calm", "cm", "flat", "hold", "gap"];
  let mode = modes[Math.floor(rand() * modes.length)]!;
  let until = from + rand() * 4 * DAY;
  let held: number | undefined;
  for (let t = from; t < from + days * DAY; t += step) {
    if (t >= until) {
      mode = modes[Math.floor(rand() * modes.length)]!;
      until = t + (0.5 + rand() * 5.5) * DAY;
      held = undefined;
    }
    if (mode === "gap") continue;
    let level = Math.sin((2 * Math.PI * t) / (12.42 * 3_600_000));
    if (mode === "calm") level = 0.3 + ((t / step) % 7) * 0.0009;
    if (mode === "cm") level = Math.round(level * 100) / 100;
    if (mode === "flat" || mode === "hold") {
      held ??= level;
      level = held + (mode === "hold" ? rand() * 0.004 : 0);
    }
    if (rand() < 0.003) level += (rand() - 0.5) * 3;
    if (rand() < 0.0005) level = 99_999;
    rows.push({ time: t, level: Math.round(level * 10_000) / 10_000, flag: Flag.good });
  }
  return rows;
}

/** Every option set `qcFor` gives, once each, and the defaults. */
const OPTIONS: QcOptions[] = [
  ...new Set(
    ["{}"].concat(
      ["coastal", "estuary", "river", "lake", null].flatMap((kind) =>
        [true, false, null].flatMap((tidal) =>
          [0.1, 1].map((tide_m) =>
            JSON.stringify(qcFor({ kind, tidal, tide_m } as Parameters<typeof qcFor>[0])),
          ),
        ),
      ),
    ),
  ),
].map((o) => JSON.parse(o) as QcOptions);

describe("nearContext", () => {
  it("gives qc the same flags as the whole of the neighboring years", () => {
    let trimmed = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const rand = random(seed);
      const step = [MINUTE, 6 * MINUTE, 15 * MINUTE, 60 * MINUTE][seed % 4]!;
      const days = step === MINUTE ? 12 : 40;
      const start = Date.UTC(2025, 0, 1);
      // One series cut in three, so runs carry on across each New Year.
      const all = series(rand, start - days * DAY, 3 * days, step);
      const before = all.filter((r) => r.time < start);
      const rows = all.filter((r) => r.time >= start && r.time < start + days * DAY);
      const after = all.filter((r) => r.time >= start + days * DAY);
      const context = [...before, ...after];
      for (const options of OPTIONS) {
        const near = nearContext(rows, options, context);
        trimmed += context.length - near.length;
        assert.deepEqual(
          qc(rows, options, near).map((r) => r.flag),
          qc(rows, options, context).map((r) => r.flag),
          `seed ${seed}, ${JSON.stringify(options)}`,
        );
      }
    }
    // It has to trim something to test anything.
    assert.ok(trimmed > 0);
  });

  it("keeps a flatline across New Year whole", () => {
    const start = Date.UTC(2025, 0, 1);
    const at = (t: number, level: number) => ({ time: t, level, flag: Flag.good });
    const before = Array.from({ length: 24 * 20 }, (_, i) =>
      at(start - (24 * 20 - i) * 3_600_000, i >= 24 * 20 - 4 ? 0.5 : Math.sin(i)),
    );
    const rows = Array.from({ length: 24 * 20 }, (_, i) =>
      at(start + i * 3_600_000, i < 3 ? 0.5 : Math.sin(i)),
    );
    const near = nearContext(rows, {}, before);
    assert.ok(near.length < before.length);
    const flags = qc(rows, {}, near).map((r) => r.flag);
    assert.deepEqual(flags.slice(0, 3), [Flag.suspect, Flag.suspect, Flag.suspect]);
    assert.deepEqual(
      flags,
      qc(rows, {}, before).map((r) => r.flag),
    );
  });
});
