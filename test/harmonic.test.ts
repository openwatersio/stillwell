import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as harmonic from "../src/harmonic.ts";
import { compareExtremes } from "../src/metrics.ts";
import type { Sample } from "../src/types.ts";

describe("harmonic", () => {
  it("keeps the major constituent of a pair a record can't separate", () => {
    const year = harmonic.resolvable(harmonic.STANDARD, 8760);
    assert.ok(year.includes("S2") && !year.includes("T2"));
    assert.ok(year.includes("K1") && year.includes("P1"));
    assert.ok(!year.includes("Sa"), "Sa needs more than 365 days");
  });

  it("recovers a synthetic M2 and S2 tide", () => {
    const samples: Sample[] = [];
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2026, 1, 1); t += 600_000) {
      const hours = (t - Date.UTC(2026, 0, 1)) / 3_600_000;
      samples.push({ time: t, level: 1 + Math.cos((28.984104 * hours * Math.PI) / 180) });
    }
    const model = harmonic.fit(samples, ["M2", "S2"]);
    const predicted = harmonic.timeline(
      model,
      samples.map((s) => s.time),
    );
    const worst = Math.max(...predicted.map((p, i) => Math.abs(p.level - samples[i]!.level)));
    // The engine applies M2's nodal factor, which a pure cosine lacks.
    assert.ok(worst < 0.05, `worst ${worst}`);
    assert.ok(Math.abs(model.offset - 1) < 0.01);
  });
});

describe("compareExtremes", () => {
  it("matches one to one within the window and by type", () => {
    const reference = [
      { time: 0, level: 1, type: "high" as const },
      { time: 6 * 3_600_000, level: -1, type: "low" as const },
    ];
    const predicted = [
      { time: 10 * 60_000, level: 1.1, type: "high" as const },
      { time: 20 * 60_000, level: 1.2, type: "high" as const },
      { time: 6 * 3_600_000 - 5 * 60_000, level: -0.9, type: "low" as const },
    ];
    const c = compareExtremes(predicted, reference);
    assert.equal(c.matched, 2);
    assert.equal(c.high.time.bias, 10);
    assert.equal(c.low.time.bias, -5);
    assert.ok(Math.abs(c.height.rms - 0.1) < 1e-9);
  });
});
