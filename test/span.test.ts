import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Dropped, inSpan, leaveOut, leaveOutInto, tallying } from "../src/span.ts";

describe("Dropped", () => {
  it("counts each side of the span and names the values behind the count", () => {
    const d = new Dropped();
    for (let i = 0; i < 1200; i++) d.add(-9999);
    d.add(30479.695, 34);
    d.add(Number.NaN);
    assert.deepEqual([d.count, d.below, d.above, d.nan], [1235, 1200, 34, 1]);
    assert.equal(
      d.describe(),
      "1,235 levels outside −500 to 9,000 m (1,200 below, 34 above, 1 not a number; −9,999 ×1,200, 30,479.695 ×34, NaN ×1)",
    );
    assert.equal(new Dropped().describe(), "");
  });

  it("names a bounded number of distinct values and counts the rest", () => {
    const d = new Dropped();
    for (let i = 0; i < 100; i++) d.add(10_000 + i);
    assert.equal(d.count, 100);
    assert.equal(d.values.size, 50);
  });

  it("merges tallies", () => {
    const a = new Dropped();
    a.add(-9999, 2);
    const b = new Dropped();
    b.add(-9999);
    b.add(99999);
    assert.deepEqual(JSON.parse(JSON.stringify(a.merge(b))), {
      count: 4,
      below: 3,
      above: 1,
      nan: 0,
      values: { "-9999": 3, "99999": 1 },
    });
  });
});

describe("tallying", () => {
  it("collects the levels inSpan and leaveOut leave out, down the awaits", async () => {
    const rows = [0, 1, -9999, 9000.5, 2].map((level, time) => ({ time, level }));
    const {
      result,
      dropped,
      rows: left,
    } = await tallying(async () => {
      await Promise.resolve();
      return leaveOut(rows);
    }, true);
    assert.deepEqual(
      result.map((r) => r.level),
      [0, 1, 2],
    );
    assert.deepEqual(left, [
      { time: 2, level: -9999 },
      { time: 3, level: 9000.5 },
    ]);
    assert.equal(dropped.count, 2);
  });

  it("keeps rows only when asked, and keeps concurrent calls apart", async () => {
    const [a, b] = await Promise.all([
      tallying(async () => {
        await new Promise((r) => setTimeout(r, 5));
        inSpan(-9999, 1);
        return 1;
      }),
      tallying(async () => {
        inSpan(1e6, 2);
        inSpan(1e6, 3);
        return 2;
      }, true),
    ]);
    assert.deepEqual([a.dropped.count, a.rows], [1, []]);
    assert.deepEqual([b.dropped.count, b.rows.length], [2, 2]);
  });

  it("keeps rows only for levels that are numbers, with the source's flag", async () => {
    const { rows } = await tallying(async () => {
      inSpan(Number.NaN, 1, 0);
      inSpan(Number.POSITIVE_INFINITY, 2, 0);
      inSpan(-9999, 3, 2);
      return 0;
    }, true);
    assert.deepEqual(rows, [{ time: 3, level: -9999, flag: 2 }]);
  });

  it("counts nothing outside a tally, and counts stored rows into the tally it's given", () => {
    assert.equal(inSpan(-9999), false);
    const d = new Dropped();
    assert.deepEqual(
      leaveOutInto([{ level: 1 }, { level: -9999 }, { level: 1e5 }], d).map((r) => r.level),
      [1],
    );
    assert.deepEqual([d.below, d.above], [1, 1]);
  });
});

describe("usableHours", () => {
  it("counts no hours for a year of nothing but bad values", async () => {
    const { usableHours } = await import("../src/store/years.ts");
    assert.equal(usableHours({ hours: 8760, flags: [0, 0, 0, 0, 8760] }), 0);
    assert.equal(usableHours({ hours: 8760, flags: [8000, 0, 0, 0, 760] }), 8760);
    assert.equal(usableHours({ hours: 5 }), 5);
  });
});
