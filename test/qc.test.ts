import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { qc } from "../src/qc.ts";
import { FLATLINE_M, qcFor } from "../src/store/recent.ts";
import { Flag, type Observation } from "../src/schema.ts";

const MIN = 60_000;
const HOUR = 3_600_000;
const T = Date.UTC(2025, 0, 1);

/** A cosine tide of amplitude `a`, `n` values `step` apart, to 0.1 mm. */
const tide = (n: number, step: number, a = 1): Observation[] =>
  Array.from({ length: n }, (_, i) => ({
    time: T + i * step,
    level: Math.round(1e4 * a * Math.cos((2 * Math.PI * i * step) / (12.42 * HOUR))) / 1e4,
    flag: Flag.good,
  }));

describe("qc spike rule", () => {
  // BODC Jersey, three days of 15-minute values with a spring tide of 9 m. BODC's
  // service leaves out one value every 7 h 45 min or so, such as 00:45 on 10 March.
  const jersey = (): Observation[] =>
    JSON.parse(
      readFileSync(new URL("fixtures/bodc-jer-2025-03.json", import.meta.url), "utf8"),
    ).map(([time, level]: [number, number]) => ({ time, level, flag: Flag.good }));
  const midnight = Date.parse("2025-03-10T00:30Z");

  it("leaves values on a steep tide beside a gap alone", () => {
    // At 00:30 the median of every neighbor within 45 minutes is 00:15's 6.100 m, 0.29 m below it.
    assert.deepEqual(
      qc(jersey()).filter((r) => r.flag !== Flag.good),
      [],
    );
  });

  it("still flags a spike beside a gap", () => {
    const rows = jersey();
    const k = rows.findIndex((r) => r.time === midnight);
    rows[k]!.level += 0.6;
    assert.equal(qc(rows)[k]!.flag, Flag.suspect);
  });

  it("judges a value whose neighbors don't pair across it", () => {
    // 10-minute values with a neighbor 30 minutes before and 10 minutes after the spike only.
    const rows = tide(200, 10 * MIN, 0.5).filter((_, i) => ![98, 99, 102, 103].includes(i));
    const k = rows.findIndex((r) => r.time === T + 100 * 10 * MIN);
    rows[k]!.level += 3;
    assert.equal(qc(rows)[k]!.flag, Flag.suspect);
  });
});

describe("qc with non-finite levels", () => {
  // A 1 m tide every 6 minutes.
  const window = (days: number, nan: number[], noise = () => 0) => {
    const rows = Array.from({ length: days * 240 }, (_, i) => ({
      time: T + i * 6 * MIN,
      level: Math.round(1e4 * (Math.cos((2 * Math.PI * i * 0.1) / 12.42) + noise())) / 1e4,
      flag: Flag.good as Flag,
    }));
    for (const k of nan) rows[k]!.level = NaN;
    return rows;
  };

  it("marks them bad and flags nothing else", () => {
    const out = qc(window(30, [1000, 3000]));
    assert.deepEqual(
      out.flatMap((r, i) => (r.flag === Flag.good ? [] : [[i, r.flag]])),
      [
        [1000, Flag.bad],
        [3000, Flag.bad],
      ],
    );
  });

  it("still flags a spike", () => {
    // Seeded, so the same windows every run: 1 to 20 NaN at random rows and a 3 m spike.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let t = 0; t < 200; t++) {
      const count = 1 + Math.floor(random() * 20);
      const rows = window(7, [], () => 0.01 * (random() - 0.5));
      for (let n = 0; n < count; n++) rows[Math.floor(random() * rows.length)]!.level = NaN;
      rows[800]!.level = Number.isNaN(rows[800]!.level) ? 3 : rows[800]!.level + 3;
      assert.equal(qc(rows)[800]!.flag, Flag.suspect, `window ${t}`);
    }
  });
});

describe("qc flatline tolerance", () => {
  // A gauge stuck at 0.42 m for 8 hours on a 1 m tide, wavering a millimeter either way.
  const stuck = () => {
    const rows = tide(720, 6 * MIN);
    for (const r of rows)
      if (r.time >= T + 24 * HOUR && r.time < T + 32 * HOUR)
        r.level =
          Math.round(1e4 * (0.42 + ((Math.round((r.time - T) / (6 * MIN)) % 3) - 1) * 0.001)) / 1e4;
    return rows;
  };
  const inRun = (r: Observation) => r.time >= T + 24 * HOUR && r.time < T + 32 * HOUR;

  it("flags a run within a few millimeters of its first value at tidal water", () => {
    const out = qc(stuck(), qcFor({ kind: "coastal", tidal: true, tide_m: 1 }));
    assert.ok(out.filter(inRun).every((r) => r.flag === Flag.suspect));
  });

  it("needs exact equality without a tolerance, as at still water", () => {
    assert.ok(
      qc(stuck())
        .filter(inRun)
        .some((r) => r.flag === Flag.good),
    );
    assert.equal(qcFor({ kind: "river", tidal: false }).flatline_m, undefined);
    assert.equal(qcFor({ kind: "coastal", tidal: true, tide_m: 1 }).flatline_m, FLATLINE_M);
  });

  it("leaves a run that wanders further than the tolerance", () => {
    const rows = stuck().map((r) =>
      inRun(r) ? { ...r, level: 0.42 + ((r.time / (6 * MIN)) % 2) * 0.003 } : r,
    );
    assert.ok(
      qc(rows, { flatline_m: FLATLINE_M })
        .filter(inRun)
        .some((r) => r.flag === Flag.good),
    );
  });
});

describe("qc sensor span", () => {
  it("marks a year of placeholders bad, where the window's median is the placeholder", () => {
    // USACE MVS Sullivan, Jonathan Creek, 2026: every value 30,479.695 m (100,000 ft).
    const rows = tide(500, 15 * MIN).map((r) => ({ ...r, level: 30479.695 }));
    assert.ok(qc(rows, qcFor({ kind: "river", tidal: false })).every((r) => r.flag === Flag.bad));
  });

  it("leaves water high above its datum alone", () => {
    // USGS 09384600, Lyman Lake, whose levels are elevations near 1,815 m.
    const rows = tide(500, 15 * MIN, 0.01).map((r) => ({ ...r, level: 1815 + r.level }));
    assert.ok(qc(rows, qcFor({ kind: "lake", tidal: false })).every((r) => r.flag === Flag.good));
  });

  it("keeps placeholders out of the statistics the other rules judge by", () => {
    const rows = tide(1000, 10 * MIN);
    for (let i = 200; i < 800; i++) rows[i]!.level = -30479.695;
    const out = qc(rows);
    assert.ok(out.slice(200, 800).every((r) => r.flag === Flag.bad));
    assert.ok(
      out
        .slice(0, 199)
        .concat(out.slice(801))
        .every((r) => r.flag === Flag.good),
    );
  });
});
