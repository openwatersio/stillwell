/**
 * A zero-phase Butterworth low-pass filter: the gain it has at a frequency,
 * and the filter itself on an evenly spaced series. An agency that analyzes a
 * filtered series publishes constants the filter has scaled, so a fit of the
 * unfiltered series is compared with them through the gain.
 */

/**
 * The amplitude gain of a Butterworth low-pass of `order`, run forward and
 * backward so it shifts no phase, at a constituent's `speed` in degrees an
 * hour: 1 / (1 + (f / fc)^(2 · order)), which is the one-way filter's gain
 * squared. `cutoffHours` is the period where one pass gains 1/√2.
 */
export function zeroPhaseGain(speed: number, order: number, cutoffHours: number): number {
  return 1 / (1 + ((speed / 360) * cutoffHours) ** (2 * order));
}

/**
 * `values`, evenly spaced `stepHours` apart, through a Butterworth low-pass
 * of even `order` and `cutoffHours`, forward and backward. The ends carry the
 * filter's start-up, so a caller drops a few cutoff periods from each.
 */
export function lowPass(
  values: readonly number[],
  order: number,
  cutoffHours: number,
  stepHours: number,
): number[] {
  if (order < 2 || order % 2) throw new Error("the filter's order is an even number from 2");
  const w0 = (2 * Math.PI * stepHours) / cutoffHours;
  if (!(w0 > 0 && w0 < Math.PI)) throw new Error("the cutoff is slower than two steps");
  // The order's pole pairs as second-order sections (bilinear transform, warped to the cutoff).
  const sections = Array.from({ length: order / 2 }, (_, k) => {
    const q = 1 / (2 * Math.cos((Math.PI * (2 * k + 1)) / (2 * order)));
    const alpha = Math.sin(w0) / (2 * q);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    return {
      b0: (1 - cos) / 2 / a0,
      b1: (1 - cos) / a0,
      b2: (1 - cos) / 2 / a0,
      a1: (-2 * cos) / a0,
      a2: (1 - alpha) / a0,
    };
  });
  const once = (input: readonly number[]) => {
    let x = [...input];
    for (const s of sections) {
      const y = new Array<number>(x.length);
      // Started at the first value, as if the series had held it before.
      let [x1, x2, y1, y2] = [x[0] ?? 0, x[0] ?? 0, x[0] ?? 0, x[0] ?? 0];
      for (let i = 0; i < x.length; i++) {
        const v = s.b0 * x[i]! + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
        [x2, x1, y2, y1] = [x1, x[i]!, y1, v];
        y[i] = v;
      }
      x = y;
    }
    return x;
  };
  return once(once(values).reverse()).reverse();
}
