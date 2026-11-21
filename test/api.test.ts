import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCatalog, type CatalogStation } from "../src/api/catalog.ts";
import {
  conversionFor,
  levelsResponse,
  maxAge,
  parseLevels,
  sample,
  statusOf,
  stepSampler,
  usableFor,
  type LevelsQuery,
  type StoredLevel,
} from "../src/api/levels.ts";
import { Flag } from "../src/schema.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-13T12:00:00Z");

// Two epochs: the first 0.1 m below the current one and closed at 06:00, the second open.
function catalog(overrides: Record<string, unknown> = {}) {
  return buildCatalog(
    [
      {
        id: "coops/9447130",
        source: "coops",
        name: "Seattle",
        datum: "STND",
        chart_datum: "MLLW",
        frame: "gauge",
        commercial_use: true,
        attribution: "NOAA National Ocean Service",
        datums_attribution: ["Slackwater database"],
        tide_station: "noaa/9447130",
        min_interval_s: 360,
        interval_s: 360,
        live: true,
        status: "active",
        products: ["levels"],
        epoch_ids: [1, 2],
        since: [null, "2026-11-13T06:00:00Z"],
        until: ["2026-11-13T06:00:00Z", null],
        to_current: [0.1, 0],
        state: ["closed", "open"],
        ...overrides,
      },
      {
        id: "smhi/2130",
        source: "smhi",
        name: "Barred",
        datum: "RH2000",
        chart_datum: null,
        frame: null,
        commercial_use: false,
        attribution: "SMHI",
        datums_attribution: [],
        tide_station: null,
        min_interval_s: null,
        live: true,
        status: "active",
        products: ["levels"],
        epoch_ids: [1],
        since: [null],
        until: [null],
        to_current: [0],
        state: ["open"],
      },
    ],
    [
      { station: "coops/9447130", epoch: 1, datum: "MLLW", offset_m: -2.319 },
      { station: "coops/9447130", epoch: 2, datum: "MLLW", offset_m: -2.419 },
      { station: "coops/9447130", epoch: 2, datum: "MSL", offset_m: -4.443 },
    ],
  );
}
const seattle = (): CatalogStation => catalog().get("coops/9447130")!;

function query(overrides: Partial<LevelsQuery> = {}): LevelsQuery {
  return {
    start: NOW - DAY,
    end: NOW,
    step: 6 * MIN,
    datum: undefined,
    feet: false,
    received: false,
    includeBad: false,
    ...overrides,
  };
}

const value = (
  time: number,
  level = 3,
  flag: number = Flag.preliminary,
  epoch = 2,
): StoredLevel => ({
  epoch,
  time,
  level,
  flag,
  received: time + MIN,
});

describe("parseLevels", () => {
  it("defaults to the last 7 days at 6-minute steps", () => {
    const parsed = parseLevels(new URLSearchParams(), NOW);
    assert.ok("query" in parsed);
    assert.equal(parsed.query.end, NOW);
    assert.equal(parsed.query.start, NOW - 7 * DAY);
    assert.equal(parsed.query.step, 6 * MIN);
  });

  it("lists every bad parameter", () => {
    const parsed = parseLevels(
      new URLSearchParams("step=5m&units=yards&includeBad=yes&include=predicted&start=nope"),
      NOW,
    );
    assert.ok("errors" in parsed);
    assert.deepEqual(parsed.errors.map((e) => e.path).sort(), [
      "include",
      "includeBad",
      "start",
      "step",
      "units",
    ]);
  });

  it("takes a range any time back, and refuses one given twice, reversed or too long", () => {
    for (const search of [
      "start=2001-01-01&end=2002-01-01",
      "start=2001-01-01&end=2001-02-01&step=raw",
      `start=${new Date(NOW - 8 * DAY).toISOString()}`,
    ])
      assert.ok("query" in parseLevels(new URLSearchParams(search), NOW), search);
    for (const [search, path] of [
      ["start=2001-01-01&end=2002-01-03", "end"],
      ["start=2001-01-01&end=2001-02-02&step=raw", "end"],
      [
        `start=${new Date(NOW - DAY).toISOString()}&start=${new Date(NOW - DAY).toISOString()}`,
        "start",
      ],
      [
        `start=${new Date(NOW - HOUR).toISOString()}&end=${new Date(NOW - 2 * HOUR).toISOString()}`,
        "start",
      ],
      // A far end would have the sampling step through every 6 minutes to it.
      [`start=${new Date(NOW - DAY).toISOString()}&end=9999-12-31T00:00:00Z`, "end"],
    ]) {
      const parsed = parseLevels(new URLSearchParams(search), NOW);
      assert.ok("errors" in parsed, search);
      assert.equal(parsed.errors[0]!.path, path, search);
    }
  });

  it("takes only ISO 8601 dates that exist, with a zone, and only the steps it lists", () => {
    for (const search of [
      "start=2026-11-31T00:00:00Z", // November 31 would roll into December
      "start=2026-11-13T10:00", // no zone, so the server's own
      "start=11/13/2026",
      "step=constructor",
      "step=toString",
    ])
      assert.ok("errors" in parseLevels(new URLSearchParams(search), NOW), search);
    const parsed = parseLevels(
      new URLSearchParams("start=2026-11-13&end=2026-11-13T10:30:00%2B02:00"),
      NOW,
    );
    assert.ok("query" in parsed);
    assert.equal(parsed.query.start, Date.parse("2026-11-13T00:00:00Z"));
    assert.equal(parsed.query.end, Date.parse("2026-11-13T08:30:00Z"));
  });
});

describe("conversionFor", () => {
  it("answers in chart datum by default, the station's own on request, and refuses a datum with no offset", () => {
    assert.deepEqual(conversionFor(seattle(), undefined), { named: "MLLW" });
    assert.deepEqual(conversionFor(seattle(), "station"), { named: null });
    assert.deepEqual(conversionFor(seattle(), "MSL"), { named: "MSL" });
    assert.equal((conversionFor(seattle(), "NAVD88") as { path: string }).path, "datum");
    // A chart datum the current epoch has no offset to falls back to the station's own.
    const unconverted = catalog({ chart_datum: "LAT" }).get("coops/9447130")!;
    assert.deepEqual(conversionFor(unconverted, undefined), { named: null });
  });
});

describe("sample", () => {
  it("takes the value nearest each step time, once, within half a step", () => {
    const values = [value(NOW - 13 * MIN), value(NOW - 11 * MIN), value(NOW - 5 * MIN), value(NOW)];
    const picked = sample(seattle(), { named: null }, values, query({ start: NOW - 20 * MIN }));
    // 18 minutes back: nothing within 3. 12: the one at 13 (11 is as near; the earlier wins). 6: the one at 5. 0: now.
    assert.deepEqual(
      picked.map((v) => (NOW - v.time) / MIN),
      [13, 5, 0],
    );
  });

  it("gives the same rows wherever in the step before its first step time the range starts", () => {
    // 6-minute values from 10:00; at 15m, the 10:15 step ties between 10:12 and 10:18 and takes 10:12.
    const at = (m: number) => Date.parse("2026-11-13T10:00:00Z") + m * MIN;
    const values = [0, 6, 12, 18, 24, 30].map((m) => value(at(m)));
    const rows = (start: number) =>
      sample(seattle(), { named: null }, values, query({ start, end: at(30), step: 15 * MIN })).map(
        (v) => (v.time - at(0)) / MIN,
      );
    assert.deepEqual(rows(at(1)), [12, 30]);
    assert.deepEqual(rows(at(15)), [12, 30]);
  });

  it("leaves out bad values unless asked, and values outside their epoch's span or with no offset", () => {
    const values = [
      value(NOW - 7 * HOUR, 1, Flag.good, 1), // epoch 1, before its until
      value(NOW - 6 * HOUR, 1, Flag.good, 1), // epoch 1 at its until: outside it
      value(NOW - 5 * HOUR, 2, Flag.bad),
      value(NOW - 4 * HOUR, 2, Flag.good, 9), // an epoch the list doesn't have
    ];
    const raw = query({ step: 0 });
    assert.deepEqual(
      sample(seattle(), { named: "MLLW" }, values, raw).map((v) => [v.time, v.level]),
      [[NOW - 7 * HOUR, 1 - 2.319]],
    );
    assert.equal(
      sample(seattle(), { named: null }, values, { ...raw, includeBad: true }).length,
      2,
    );
    // MSL has no row for epoch 1, so its value drops out there.
    assert.equal(sample(seattle(), { named: "MSL" }, values, raw).length, 0);
  });
});

describe("stepSampler", () => {
  it("keeps the values sample picks, whatever their order", () => {
    // Irregular values in both epochs, some bad, some at exactly half a step, shuffled.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const times = [...Array(9 * 120).keys()]
      .filter(() => random() < 0.4)
      .map((half) => NOW - 9 * HOUR + half * 30_000);
    const values = times
      .map((time) =>
        value(
          time,
          random(),
          random() < 0.2 ? Flag.bad : Flag.preliminary,
          time < NOW - 6 * HOUR ? 1 : 2,
        ),
      )
      .sort(() => random() - 0.5);
    for (const step of [6 * MIN, 15 * MIN, HOUR])
      for (const includeBad of [false, true])
        for (const conversion of [{ named: null }, { named: "MLLW" }]) {
          const q = query({ start: NOW - 8 * HOUR, end: NOW - HOUR, step, includeBad });
          const sampler = stepSampler(step, usableFor(seattle(), conversion, includeBad));
          for (const v of values) sampler.add(v);
          assert.ok(sampler.values().length <= 2 * ((9 * HOUR) / step + 1));
          const picked = sample(seattle(), conversion, values, q);
          assert.ok(picked.length >= 5);
          assert.deepEqual(
            sample(seattle(), conversion, sampler.values(), q),
            picked,
            `${step} ${includeBad} ${conversion.named}`,
          );
        }
  });
});

describe("held epochs and offsets", () => {
  it("leaves out a held epoch's values in every datum", () => {
    const held = catalog({ state: ["held", "open"] }).get("coops/9447130")!;
    const values = [value(NOW - 7 * HOUR, 1, Flag.good, 1)];
    for (const conversion of [{ named: null }, { named: "MLLW" }])
      assert.equal(sample(held, conversion, values, query({ step: 0 })).length, 0);
  });

  it("reads an offset's + sent unencoded", () => {
    const parsed = parseLevels(new URLSearchParams("start=2026-11-13T10:30:00+02:00"), NOW);
    assert.ok("query" in parsed);
    assert.equal(parsed.query.start, Date.parse("2026-11-13T08:30:00Z"));
  });
});

describe("the response", () => {
  it("converts levels and datums, and rounds to the millimeter in feet too", () => {
    const body = levelsResponse({
      station: seattle(),
      conversion: { named: "MLLW" },
      query: query({ feet: true, received: true }),
      values: [value(NOW - 6 * MIN, 5)],
      asOf: NOW - 6 * MIN,
      updated: NOW - MIN,
      now: NOW,
    }) as Record<string, unknown>;
    assert.equal(body.datum, "MLLW");
    // MSL's height above MLLW, as the tides API gives datums: (4.443 - 2.419) / 0.3048.
    assert.deepEqual(body.datums, { MLLW: 0, MSL: 6.64 });
    assert.deepEqual(body.levels, [
      {
        time: "2026-11-13T11:54:00Z",
        level: 8.468, // (5 - 2.419) / 0.3048
        flag: "preliminary",
        received: "2026-11-13T11:55:00Z",
      },
    ]);
    assert.equal(body.status, "reporting");
    assert.equal(body.updated, "2026-11-13T11:59:00Z");
    assert.deepEqual(body.attribution, ["NOAA National Ocean Service", "Slackwater database"]);
  });

  it("is stale past three intervals and two hours, and offline past a day", () => {
    assert.equal(statusOf(seattle(), NOW - 2 * HOUR, NOW), "reporting");
    assert.equal(statusOf(seattle(), NOW - 2 * HOUR - 1, NOW), "stale");
    // A station recording every 3 hours, though asked every 6 minutes.
    const sparse = catalog({ interval_s: 3 * 3600 }).get("coops/9447130")!;
    assert.equal(statusOf(sparse, NOW - 9 * HOUR, NOW), "reporting");
    assert.equal(statusOf(sparse, NOW - 9 * HOUR - 1, NOW), "stale");
    assert.equal(statusOf(seattle(), NOW - DAY - 1, NOW), "offline");
    assert.equal(statusOf(seattle(), null, NOW), "offline");
  });

  it("is cached for the station's interval, at most 5 minutes, and a day once past the window", () => {
    assert.equal(maxAge(seattle(), NOW, NOW), 300);
    assert.equal(maxAge(catalog({ min_interval_s: 60 }).get("coops/9447130")!, NOW, NOW), 60);
    assert.equal(maxAge(seattle(), NOW - 8 * DAY, NOW), 86_400);
  });
});
