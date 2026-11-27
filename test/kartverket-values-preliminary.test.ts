import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkYears,
  HOURS,
  lostHours,
  VALUES,
} from "../src/migrations/20261127-kartverket-values-preliminary.ts";
import { FLAG_COUNTS } from "../src/store/files.ts";

const counts = (values: number, flag = "preliminary") =>
  FLAG_COUNTS.map((f) => (f === flag ? values : 0));

/** The year files the tables describe, as rows of the years file after the steps. */
const stored = () =>
  Object.entries(HOURS).flatMap(([id, [first, ...hours]]) =>
    hours.flatMap((h, i) =>
      h
        ? [{ id, epoch: 1, year: first + i, hours: h, flags: counts(VALUES[id]![i + 1] as number) }]
        : [],
    ),
  );
const change = (id: string, year: number, to: (r: ReturnType<typeof stored>[number]) => object) =>
  stored().map((r) => (r.id === id && r.year === year ? { ...r, ...to(r) } : r));

describe("the Kartverket migration's check", () => {
  it("describes 921 year files of 33 gauges, with values for each", () => {
    assert.equal(Object.keys(HOURS).length, 33);
    assert.equal(stored().length, 921);
    assert.deepEqual(Object.keys(VALUES), Object.keys(HOURS));
    for (const [id, row] of Object.entries(HOURS)) {
      assert.equal(VALUES[id]!.length, row.length, id);
      row.slice(1).forEach((h, i) => assert.ok(VALUES[id]![i + 1]! >= h, `${id} ${i}`));
    }
  });

  it("passes the files as they were, with more in them, and with a gauge listed since", () => {
    checkYears(stored());
    assert.deepEqual(lostHours(stored().map((r) => ({ ...r, hours: r.hours + 500 }))), []);
    checkYears([
      ...stored(),
      { id: "kartverket/NEW", epoch: 1, year: 2026, hours: 10, flags: counts(60) },
    ]);
  });

  it("allows a year 48 hours fewer and no more", () => {
    const less = (n: number) =>
      lostHours(change("kartverket/AES", 1998, (r) => ({ hours: r.hours - n })));
    assert.deepEqual(less(48), []);
    assert.equal(less(49).length, 1);
    assert.match(less(49)[0]!, /^kartverket\/AES 1998 \(\d+ to \d+ hours\)$/);
  });

  it("names a year that lost a month while another gained one, and a file that is gone", () => {
    const rows = stored().map((r) =>
      r.id !== "kartverket/AES"
        ? r
        : r.year === 2003
          ? { ...r, hours: r.hours - 700 }
          : r.year === 1986
            ? { ...r, hours: r.hours + 700 }
            : r,
    );
    assert.deepEqual(
      lostHours(rows).map((l) => l.slice(0, 19)),
      ["kartverket/AES 2003"],
    );
    const gone = stored().filter((r) => !(r.id === "kartverket/KAZ" && r.year === 2026));
    assert.equal(lostHours(gone).length, 2);
    assert.throws(() => checkYears(gone), /lost hours or values/);
  });

  it("names a year that kept its hours and lost most of its values", () => {
    const thinned = change("kartverket/BGO", 2001, (r) => ({
      flags: counts(Math.round(r.flags.reduce((a, b) => a + b, 0) / 6)),
    }));
    assert.equal(lostHours(thinned).length, 1);
    assert.match(lostHours(thinned)[0]!, /^kartverket\/BGO 2001 \(\d+ to \d+ values\)$/);
  });

  it("counts a year's datum epochs together", () => {
    const split = stored().flatMap((r) =>
      r.id === "kartverket/BGO" && r.year === 2026
        ? [
            {
              ...r,
              hours: r.hours - 300,
              flags: counts(r.flags.reduce((a, b) => a + b, 0) - 1800),
            },
            { ...r, epoch: 2, hours: 300, flags: counts(1800) },
          ]
        : [r],
    );
    checkYears(split);
  });

  it("fails while a file holds a good value or a station is marked as being written", () => {
    assert.throws(
      () =>
        checkYears(change("kartverket/OSL", 2010, (r) => ({ flags: counts(r.hours * 6, "good") }))),
      /1 Kartverket year files still hold good values, among them kartverket\/OSL epoch 1 2010/,
    );
    assert.throws(
      () => checkYears(change("kartverket/OSL", 2010, () => ({ flags: undefined }))),
      /rows without counts, for kartverket\/OSL/,
    );
  });
});
