import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lowPass, zeroPhaseGain } from "../src/fit/butterworth.ts";

describe("zeroPhaseGain", () => {
  it("is a half at the cutoff, near one well below it and near none well above", () => {
    // A period of 2.98 hours is 360 / 2.98 degrees an hour.
    assert.ok(Math.abs(zeroPhaseGain(360 / 2.98, 4, 2.98) - 0.5) < 1e-12);
    assert.ok(zeroPhaseGain(28.9841042, 4, 2.98) > 0.9999);
    assert.ok(zeroPhaseGain(360, 4, 2.98) < 1e-3);
  });

  it("falls faster for a higher order", () => {
    assert.ok(zeroPhaseGain(115.94, 6, 2.98) > zeroPhaseGain(115.94, 4, 2.98));
    assert.ok(zeroPhaseGain(150, 6, 2.98) < zeroPhaseGain(150, 4, 2.98));
  });
});

describe("lowPass", () => {
  /** The amplitude and phase shift a sinusoid of `speed` comes out with, ten-minute steps, away from the ends. */
  function through(speed: number) {
    const step = 1 / 6;
    const n = 6 * 24 * 40;
    const angle = (i: number) => (speed * i * step * Math.PI) / 180;
    const out = lowPass(
      Array.from({ length: n }, (_, i) => Math.cos(angle(i))),
      4,
      2.98,
      step,
    );
    let [c, s, m] = [0, 0, 0];
    for (let i = 6 * 24 * 5; i < n - 6 * 24 * 5; i++) {
      c += out[i]! * Math.cos(angle(i));
      s += out[i]! * Math.sin(angle(i));
      m++;
    }
    return { gain: (2 * Math.hypot(c, s)) / m, shift: (Math.atan2(s, c) * 180) / Math.PI };
  }

  it("scales a constituent by the zero-phase gain and shifts no phase", () => {
    for (const speed of [28.9841042, 57.9682085, 86.9523127, 115.9364169]) {
      const { gain, shift } = through(speed);
      assert.ok(
        Math.abs(gain - zeroPhaseGain(speed, 4, 2.98)) < 0.004,
        `${speed}: ${gain} against ${zeroPhaseGain(speed, 4, 2.98)}`,
      );
      assert.ok(Math.abs(shift) < 0.05, `${speed}: shifted ${shift}°`);
    }
  });

  it("leaves a constant series as it is", () => {
    for (const v of lowPass(new Array<number>(500).fill(1.25), 4, 2.98, 1 / 6))
      assert.ok(Math.abs(v - 1.25) < 1e-9);
  });

  it("refuses an odd order and a cutoff under two steps", () => {
    assert.throws(() => lowPass([1, 2, 3], 3, 2.98, 1 / 6), /even/);
    assert.throws(() => lowPass([1, 2, 3], 4, 0.2, 1 / 6), /cutoff/);
  });
});
