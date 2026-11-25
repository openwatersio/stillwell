import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clockOff,
  fit,
  latestEpoch,
  levelAt,
  sharedDatum,
  type Reading,
} from "../src/pair-check.ts";
import type { StoredStation } from "../src/schema.ts";

const MIN = 60_000;
const tide = (t: number) => Math.sin((2 * Math.PI * t) / (12.42 * 60 * MIN));
/** A series every `step` minutes for `days`, its stamps `late` minutes after the instants it measured. */
const series = (step: number, days: number, late = 0): Reading[] =>
  Array.from({ length: Math.floor((days * 1440) / step) }, (_, i) => ({
    time: i * step * MIN + late * MIN,
    level: tide(i * step * MIN),
  }));

test("a first series stamped late fits at a positive lag", () => {
  const { best } = fit(series(10, 10, 30), series(10, 10));
  assert.equal(best?.lag, 30);
  assert.ok(best!.rms < 0.001);
});

test("a 10-minute shift between 15-minute series is found, which needs interpolation", () => {
  const { best, zero } = fit(series(15, 10, 10), series(15, 10));
  assert.equal(best?.lag, 10);
  assert.ok(clockOff(best!, zero!));
});

test("hourly series are tried only at whole-hour lags", () => {
  const { tried } = fit(series(60, 30), series(60, 30));
  assert.equal(tried, 7);
});

test("readings further apart than 20 minutes give no interpolated level", () => {
  const b = [
    { time: 0, level: 0 },
    { time: 60 * MIN, level: 1 },
  ];
  assert.equal(levelAt(b, 30 * MIN), undefined);
  assert.equal(levelAt(b, 60 * MIN), 1);
  assert.equal(
    levelAt(
      [
        { time: 0, level: 0 },
        { time: 15 * MIN, level: 3 },
      ],
      5 * MIN,
    ),
    1,
  );
});

test("a lag counts only where it is clearly better than zero", () => {
  assert.ok(!clockOff({ lag: 0, n: 1, mean: 0, rms: 0.01 }, { lag: 0, n: 1, mean: 0, rms: 0.01 }));
  assert.ok(
    !clockOff({ lag: 10, n: 1, mean: 0, rms: 0.027 }, { lag: 0, n: 1, mean: 0, rms: 0.035 }),
  );
  assert.ok(
    clockOff({ lag: 10, n: 1, mean: 0, rms: 0.014 }, { lag: 0, n: 1, mean: 0, rms: 0.021 }),
  );
});

test("stations naming the same local zero or tidal datum share no reference", () => {
  assert.equal(sharedDatum({ datum: "ZERO", datums: {} }, { datum: "ZERO", datums: {} }), null);
  assert.equal(
    sharedDatum({ datum: "STND", datums: { MSL: 1 } }, { datum: "GZ", datums: { MSL: 2 } }),
    null,
  );
  const shared = sharedDatum(
    { datum: "STND", datums: { NAVD88: -1.647 } },
    { datum: "NAVD88", datums: {} },
  );
  assert.equal(shared?.name, "NAVD88");
  assert.ok(Math.abs(shared!.expected - 1.647) < 1e-9);
});

test("the latest of the epochs that hold the year is the one read, and held ones aren't", () => {
  const epoch = (id: number, since: string | null, until: string | null, state: string) => ({
    id,
    datum: "X",
    since,
    until,
    state,
    datums: {},
  });
  const station = {
    epochs: [
      epoch(1, null, "2013-10-01T00:00:00Z", "closed"),
      epoch(2, "2013-10-01T00:00:00Z", null, "open"),
      epoch(3, "2013-11-01T00:00:00Z", null, "held"),
    ],
  } as unknown as StoredStation;
  const [from, to] = [Date.UTC(2013, 0, 1), Date.UTC(2014, 0, 1)];
  const found = latestEpoch(station, from, to);
  assert.equal(found?.epoch.id, 2);
  assert.equal(found?.of, 2);
  assert.equal(latestEpoch(station, Date.UTC(2012, 0, 1), Date.UTC(2013, 0, 1))?.epoch.id, 1);
});

test("an epoch that starts before 1970 sorts before a later one", () => {
  const station = {
    epochs: [
      { id: 2, datum: "X", since: "1965-06-01T00:00:00Z", until: null, state: "open", datums: {} },
      {
        id: 1,
        datum: "X",
        since: null,
        until: "1965-06-01T00:00:00Z",
        state: "closed",
        datums: {},
      },
    ],
  } as unknown as StoredStation;
  const found = latestEpoch(station, Date.UTC(1965, 0, 1), Date.UTC(1966, 0, 1));
  assert.equal(found?.epoch.id, 2);
});
