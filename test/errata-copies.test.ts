import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compare } from "../src/errata-copies.ts";

const HOUR = 3_600_000;
const tide = (t: number) => Math.sin((2 * Math.PI * t) / (12.42 * HOUR));
// Ten-minute values over six days; the span is days 2 and 3.
const [from, to] = [48 * HOUR, 96 * HOUR];
const inSpan = (t: number) => t >= from && t < to;
const original = Array.from({ length: 864 }, (_, i) => {
  const time = i * 600_000;
  return { time, level: tide(time) + (inSpan(time) ? 2 : 0) };
});
const hourly = (f: (t: number) => number, minute = 0) =>
  Array.from({ length: 143 }, (_, i) => ({
    time: i * HOUR + minute * 60_000,
    level: f(i * HOUR + minute * 60_000),
  }));
const value = (t: number) => original.find((o) => o.time === t)!.level;

describe("compare", () => {
  it("finds a copy on another datum that carries the error", () => {
    const c = compare(
      original,
      hourly((t) => value(t) + 5),
      from,
      to,
    );
    assert.equal(c.verdict, "copy");
    assert.ok(Math.abs(c.offset_m - 5) < 1e-9);
    assert.equal(c.days, 2);
  });

  it("finds a copy of hourly means stamped at the half hour", () => {
    const mean = (t: number) => {
      const near = original.filter((o) => o.time >= t - HOUR / 2 && o.time < t + HOUR / 2);
      return near.reduce((s, o) => s + o.level, 0) / near.length;
    };
    assert.equal(compare(original, hourly(mean, 30), from, to).verdict, "copy");
  });

  it("tells a record that doesn't carry the error from a copy", () => {
    const c = compare(
      original,
      hourly((t) => tide(t) + 5),
      from,
      to,
    );
    assert.equal(c.verdict, "own");
    assert.ok(Math.abs(c.shift_m + 2) < 0.05);
  });

  it("tells a record an hour off from a copy", () => {
    assert.equal(
      compare(
        original,
        hourly((t) => value(t + HOUR)),
        from,
        to,
      ).verdict,
      "own",
    );
  });

  it("can't judge without values either side of the span", () => {
    const inside = hourly(value).filter((o) => inSpan(o.time));
    assert.equal(compare(original, inside, from, to).verdict, "no control");
  });

  it("judges nothing on a few values in the span", () => {
    const few = hourly(value).filter((o) => !inSpan(o.time) || o.time < from + 3 * HOUR);
    assert.equal(compare(original, few, from, to).verdict, "too few");
  });

  it("tells a record holding values the original lacks from a copy", () => {
    const gap = original.filter((o) => !(o.time >= 60 * HOUR && o.time < 72 * HOUR));
    assert.equal(compare(gap, hourly(value), from, to).verdict, "own");
  });

  it("judges each piece of a long span, so one that differs isn't hidden", () => {
    const pieces: [number, number][] = [
      [from, from + 12 * HOUR],
      [to - 12 * HOUR, to],
    ];
    const late = hourly((t) => value(t) + (t >= to - 12 * HOUR && t < to ? 0.05 : 0));
    assert.equal(compare(original, late, from, to, pieces).verdict, "own");
    assert.equal(compare(original, hourly(value), from, to, pieces).verdict, "copy");
  });

  it("reads an original whose reads overlap as one sorted record", () => {
    const overlapping = [...original.slice(400), ...original.slice(0, 500)];
    assert.equal(compare(overlapping, hourly(value), from, to).verdict, "copy");
  });

  it("counts a piece with too few values to judge alone, so a short stretch that differs shows", () => {
    const pieces: [number, number][] = [
      [from, from + 5 * HOUR],
      [from + 5 * HOUR, to],
    ];
    const early = hourly((t) => value(t) + (t >= from && t < from + 5 * HOUR ? 0.02 : 0));
    assert.equal(compare(original, early, from, to, pieces).verdict, "unclear");
  });
});
