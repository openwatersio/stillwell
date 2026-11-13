import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCatalog, type CatalogStation } from "../src/api/catalog.ts";
import { apiHandler } from "../src/api/handler.ts";
import {
  conversionFor,
  levelsResponse,
  maxAge,
  parseLevels,
  sample,
  statusOf,
  type LevelsQuery,
  type StoredLevel,
} from "../src/api/levels.ts";
import { clickhouse, migrate } from "../src/realtime/clickhouse.ts";
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

  it("refuses a range reaching back past the window, given twice, reversed or too long", () => {
    for (const [search, path] of [
      [`start=${new Date(NOW - 8 * DAY).toISOString()}`, "start"],
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

// Runs against a real ClickHouse only when CLICKHOUSE_URL names one, as CI's service does.
describe("stillwell-api on ClickHouse", { skip: !process.env.CLICKHOUSE_URL }, () => {
  it("serves a station's levels, and refuses what it can't serve", async () => {
    const now = Math.floor(Date.now() / HOUR) * HOUR;
    const ch = clickhouse(`stillwell_api_test_${process.pid}`);
    await migrate(ch);
    try {
      const station = "coops/9447130";
      await ch.insert(
        "observations",
        [
          { time: now - 12 * MIN, level: 3, flag: Flag.preliminary, version: 1 },
          { time: now - 6 * MIN, level: 3.1, flag: Flag.preliminary, version: 1 },
          { time: now - 6 * MIN, level: 3.2, flag: Flag.preliminary, version: 2 }, // a revision
          { time: now, level: 9, flag: Flag.bad, version: 1 },
        ].map((r) => ({
          station,
          epoch: 2,
          ...r,
          time: new Date(r.time).toISOString(),
          source_flag: null,
          received: null,
        })),
      );
      const poll = (finished: number, ok: boolean, intervals: number[]) => ({
        source: "coops",
        started: new Date(finished - MIN).toISOString(),
        finished: new Date(finished).toISOString(),
        intervals,
        ok,
        stations: 1,
        updated: 1,
        values: 1,
        stale: [],
        failed: [],
        blocked: false,
        datum_changed: false,
      });
      await ch.insert("polls", [
        poll(now - 3 * MIN, true, [360]),
        poll(now - 2 * MIN, true, [60]), // another group's
        poll(now - MIN, false, [360]), // failed
      ]);
      // A newer value in an epoch the published list doesn't have yet: not shown, nor counted in as_of.
      await ch.insert("observations", [
        {
          station,
          epoch: 3,
          time: new Date(now - MIN).toISOString(),
          level: 1,
          flag: Flag.preliminary,
          source_flag: null,
          received: null,
          version: 1,
        },
      ]);
      // Newer still, in epoch 1 after its until: outside its span, so neither shown nor counted.
      await ch.insert("observations", [
        {
          station,
          epoch: 1,
          time: new Date(now - MIN / 2).toISOString(),
          level: 1,
          flag: Flag.preliminary,
          source_flag: null,
          received: null,
          version: 1,
        },
      ]);
      const stations = catalog({
        since: [null, new Date(now - DAY).toISOString()],
        until: [new Date(now - DAY).toISOString(), null],
      });
      const handle = apiHandler({ ch, catalog: () => stations, now: () => now });

      const ok = await handle("GET", `/water-levels/stations/coops/9447130/levels?datum=station`);
      assert.equal(ok.status, 200, ok.body);
      assert.equal(ok.headers["cache-control"], "public, max-age=300");
      const body = JSON.parse(ok.body);
      assert.deepEqual(
        body.levels.map((l: { level: number }) => l.level),
        [3, 3.2],
      );
      assert.equal(body.datum, "STND");
      assert.equal(body.as_of, new Date(now - 6 * MIN).toISOString().replace(".000Z", "Z"));
      assert.equal(body.updated, new Date(now - 3 * MIN).toISOString().replace(".000Z", "Z"));

      const encoded = await handle("GET", `/water-levels/stations/coops/9447130%2Fx/levels`);
      assert.equal(encoded.status, 404);
      assert.equal((await handle("GET", `/water-levels/stations/smhi/2130/levels`)).status, 451);
      const bad = await handle("GET", `/water-levels/stations/coops/9447130/levels?datum=NAVD88`);
      assert.equal(bad.status, 400);
      assert.equal(JSON.parse(bad.body).errors[0].path, "datum");
      assert.equal(
        (await handle("POST", `/water-levels/stations/coops/9447130/levels`)).status,
        405,
      );
      assert.equal((await handle("GET", `/health`)).status, 200);
      assert.equal((await apiHandler({ ch, catalog: () => null })("GET", "/health")).status, 503);
    } finally {
      await ch.exec(`DROP DATABASE IF EXISTS ${ch.database}`);
    }
  });
});
