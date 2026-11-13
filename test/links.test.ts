import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { withDatums } from "../src/datums.ts";
import {
  byMinute,
  linkShifts,
  measure,
  measureLinks,
  MIN_HOURS,
  pairsToMeasure,
  readLinks,
  writeLinks,
  yearsToMeasure,
  type LinkOffset,
} from "../src/links.ts";
import { Flag, type Epoch, type Observation, type StoredStation } from "../src/schema.ts";
import { writeObservations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import { writeYears } from "../src/store/years.ts";

const HOUR_MS = 3_600_000;
const START = Date.UTC(2025, 0, 1);

const open = (datum: string, fields: Partial<Epoch> = {}): Epoch => ({
  id: 1,
  datum,
  since: null,
  until: null,
  seen: null,
  reference: null,
  reference_since: null,
  datums: {},
  to_current: 0,
  state: "open",
  ...fields,
});

const station = (id: string, fields: Partial<StoredStation> = {}): StoredStation => {
  const [source, source_id] = id.split("/") as [string, string];
  const datum = fields.datum ?? "ZERO";
  return {
    id,
    source,
    source_id,
    name: "",
    lat: 54,
    lon: 8,
    country_code: null,
    kind: null,
    interval_s: 3600,
    datum,
    datums: {},
    products: ["levels"],
    first: "2020-01-01T00:00:00Z",
    last: "2026-01-01T00:00:00Z",
    license: "CC0-1.0",
    commercial_use: true,
    attribution: `credit for ${id}`,
    tide_station: null,
    same_as: [],
    status: "active",
    live: true,
    min_interval_s: null,
    source_url: null,
    epochs: [open(datum)],
    ...fields,
  };
};

/** A 1.5 m semidiurnal tide. */
const tide = (time: number) => 1.5 * Math.sin((2 * Math.PI * time) / (12.42 * HOUR_MS));

/** `hours` of a tide in a zero `offset` below the other's, every `stepMs` from `from`. */
const series = (
  hours: number,
  stepMs: number,
  offset: number,
  from = START,
  flag: Flag = Flag.good,
): Observation[] =>
  Array.from({ length: (hours * HOUR_MS) / stepMs }, (_, i) => {
    const time = from + i * stepMs;
    return { time, level: tide(time) + offset, flag };
  });

describe("measure", () => {
  it("finds the offset between minute values and half-hourly ones of the same gauge", () => {
    // PEGELONLINE in PNP every minute; a copy 5 m lower, at half past each hour.
    const minutes = byMinute(series(2000, 60_000, 5), 0, Infinity);
    const halfHours = byMinute(series(2000, HOUR_MS, 0, START + HOUR_MS / 2), 0, Infinity);
    const m = measure(minutes, halfHours)!;
    assert.equal(m.hours, 2000);
    assert.equal(m.offset_m, -5);
    assert.equal(m.spread_m, 0);
  });

  it("spreads across a datum step", () => {
    const a = byMinute(series(2000, HOUR_MS, 0), 0, Infinity);
    // The second half of b's values step up 5 cm, a month and more after the first.
    const b = byMinute(
      [...series(1000, HOUR_MS, 0), ...series(1000, HOUR_MS, 0.05, START + 1000 * HOUR_MS)],
      0,
      Infinity,
    );
    assert.equal(measure(a, b)!.spread_m, 0.05);
  });

  it("needs MIN_HOURS shared hours", () => {
    const a = byMinute(series(MIN_HOURS - 1, HOUR_MS, 0), 0, Infinity);
    assert.equal(measure(a, a), null);
  });

  it("counts one value an hour from minute series, so they weigh no more than hourly ones", () => {
    // From mid-January, so the hours span two months.
    const a = byMinute(series(MIN_HOURS, 60_000, 0, Date.UTC(2025, 0, 15)), 0, Infinity);
    assert.equal(measure(a, a)!.hours, MIN_HOURS);
  });

  it("needs two months of 10 days, since one month can't show a step", () => {
    // 744 hours, every one in January.
    const a = byMinute(series(744, HOUR_MS, 0), 0, Infinity);
    assert.equal(measure(a, a), null);
  });
});

describe("byMinute", () => {
  it("keeps only good and preliminary values inside the window", () => {
    const rows: Observation[] = [
      { time: START, level: 1, flag: Flag.good },
      { time: START + 60_000, level: 2, flag: Flag.preliminary },
      { time: START + 120_000, level: 3, flag: Flag.suspect },
      { time: START + 180_000, level: 4, flag: Flag.bad },
      { time: START + 240_000, level: 5, flag: Flag.good },
    ];
    assert.deepEqual([...byMinute(rows, START, START + 240_000).values()], [1, 2]);
  });
});

describe("pairsToMeasure", () => {
  const gesla = (fields: Partial<StoredStation> = {}) =>
    station("gesla/cux", {
      datums: { MSL: -0.2, LAT: 1.7 },
      same_as: ["pegelonline/cux"],
      ...fields,
    });
  const pegel = (fields: Partial<StoredStation> = {}) =>
    station("pegelonline/cux", {
      datum: "PNP",
      datums: { NHN: -5 },
      same_as: ["gesla/cux"],
      ...fields,
    });

  it("takes a linked pair with no shared reference where one lacks MSL", () => {
    const [pair] = pairsToMeasure([gesla(), pegel()]);
    assert.equal(pair!.a.id, "gesla/cux");
    assert.equal(pair!.b.id, "pegelonline/cux");
    assert.equal(pair!.start, Date.parse("2020-01-01T00:00:00Z"));
  });

  it("leaves out a pair that shares a reference, since offsets carry through it", () => {
    assert.deepEqual(pairsToMeasure([gesla({ datums: { MSL: -0.2, NHN: 0 } }), pegel()]), []);
  });

  it("leaves out a pair more than a kilometer apart", () => {
    assert.deepEqual(pairsToMeasure([gesla({ lat: 54.02 }), pegel()]), []);
  });

  it("keeps a pair once publish has carried its offsets, so it's measured again", () => {
    const carried = pegel({
      datums: { NHN: -5, MSL: 4.8, LAT: 6.7 },
      datums_source: { NHN: "source", MSL: "computed", LAT: "computed" },
    });
    assert.equal(pairsToMeasure([gesla(), carried]).length, 1);
  });

  it("leaves out a pair that has the same offsets on both sides", () => {
    assert.deepEqual(pairsToMeasure([gesla(), pegel({ datums: { MSL: 5, LAT: 3 } })]), []);
  });

  it("starts at the open epoch", () => {
    const epochs = [
      open("PNP", { state: "closed", until: "2024-03-01T00:00:00Z" }),
      open("PNP", { id: 2, since: "2024-03-01T00:00:00Z" }),
    ];
    const [pair] = pairsToMeasure([gesla(), pegel({ epochs })]);
    assert.equal(pair!.start, Date.parse("2024-03-01T00:00:00Z"));
  });
});

describe("yearsToMeasure", () => {
  it("takes the years in which both have MIN_HOURS, latest first", () => {
    const [a, b] = [station("gesla/a"), station("pegelonline/b")];
    const hours = new Map([
      ["gesla/a 1 2023", 8760],
      ["pegelonline/b 1 2023", 8760],
      ["gesla/a 1 2024", 8784],
      ["pegelonline/b 1 2024", MIN_HOURS - 1],
      ["gesla/a 1 2025", 8760],
    ]);
    hours.set("gesla/a 1 2021", 8760).set("pegelonline/b 1 2021", 8760);
    assert.deepEqual(
      yearsToMeasure(a, b, Date.UTC(2020, 0, 1), Date.UTC(2026, 0, 1), hours),
      [2023, 2021],
    );
    assert.deepEqual(yearsToMeasure(a, b, Date.UTC(2024, 0, 1), Date.UTC(2026, 0, 1), hours), []);
  });
});

const row = (fields: Partial<LinkOffset> = {}): LinkOffset => ({
  a: "gesla/cux",
  b: "pegelonline/cux",
  a_epoch: 1,
  b_epoch: 1,
  since: "2025-01-01T00:00:00.000Z",
  until: "2026-01-01T00:00:00.000Z",
  hours: 8760,
  offset_m: 5,
  spread_m: 0.004,
  ...fields,
});

describe("linkShifts", () => {
  const stations = [station("gesla/cux"), station("pegelonline/cux")];

  it("gives a pair's shift both ways", () => {
    assert.deepEqual(
      [...linkShifts([row()], stations)],
      [
        ["gesla/cux pegelonline/cux", 5],
        ["pegelonline/cux gesla/cux", -5],
      ],
    );
  });

  it("drops a pair whose months spread too far", () => {
    assert.equal(linkShifts([row({ spread_m: 0.02 })], stations).size, 0);
  });

  it("drops a pair whose stations have moved more than a kilometer apart", () => {
    const moved = [station("gesla/cux"), station("pegelonline/cux", { lat: 54.02 })];
    assert.equal(linkShifts([row()], moved).size, 0);
  });

  it("drops a pair measured in an epoch that is no longer open", () => {
    assert.equal(linkShifts([row({ b_epoch: 2 })], stations).size, 0);
  });
});

describe("withDatums with measured shifts", () => {
  // GESLA's file in the gauge's zero, 5 m above PEGELONLINE's PNP, with MSL and LAT
  // from slackwater-database; PEGELONLINE's NHN shares no reference with it.
  const stations = () => [
    station("gesla/cux", {
      datums: { MSL: -0.193, LAT: 2.071 },
      same_as: ["pegelonline/cux"],
    }),
    station("pegelonline/cux", { datum: "PNP", datums: { NHN: -5.033 }, same_as: ["gesla/cux"] }),
  ];

  it("carries MSL and LAT along a measured pair", () => {
    const shifts = linkShifts([row({ offset_m: 5 })], stations());
    const pegel = withDatums(stations(), [], new Map(), shifts).stations[1]!;
    // A level of 6.0 m above PNP is 1.0 m in GESLA's zero, 0.807 m above MSL.
    assert.equal(Math.round((6 + pegel.datums.MSL!) * 1e4) / 1e4, 0.807);
    assert.deepEqual(pegel.datums, { NHN: -5.033, MSL: -5.193, LAT: -2.929 });
    assert.equal(pegel.datums_source!.MSL, "computed");
    assert.deepEqual(pegel.datums_attribution, ["credit for gesla/cux"]);
  });

  it("carries through a shared reference before a measured shift", () => {
    const [gesla, pegel] = stations();
    gesla!.datums.NHN = -4.9;
    const shifts = linkShifts([row({ offset_m: 5 })], [gesla!, pegel!]);
    const out = withDatums([gesla!, pegel!], [], new Map(), shifts).stations[1]!;
    assert.equal(out.datums.MSL, round(-5.033 + 4.9 - 0.193));
  });
});

describe("measureLinks", () => {
  // GESLA's hourly file and PEGELONLINE's six-minute one, 5 m apart, in a local store.
  const pair = () => [
    station("gesla/cux", { datums: { MSL: -0.2 }, same_as: ["pegelonline/cux"] }),
    station("pegelonline/cux", { datum: "PNP", datums: { NHN: -5 }, same_as: ["gesla/cux"] }),
  ];
  const write = async (dir: string, id: string, year: number, rows: Observation[]) => {
    const [source, sourceId] = id.split("/") as [string, string];
    await writeObservations(seriesPath(dir, "levels", source, sourceId, year), rows, "ZERO");
  };
  const years = async (dir: string, rows: [string, number | null, number][]) => {
    for (const source of ["gesla", "pegelonline"])
      await writeYears(
        dir,
        source,
        rows
          .filter(([id]) => id.startsWith(source))
          .map(([id, year, hours]) => ({ id, epoch: year && 1, year, hours, version: "v" })),
      );
  };

  it("measures the latest year that measures, falling back past one that doesn't", async () => {
    const dir = await mkdtemp(join(tmpdir(), "links-"));
    try {
      const y2024 = Date.UTC(2024, 0, 1);
      await write(dir, "gesla/cux", 2024, series(2000, HOUR_MS, 0, y2024));
      await write(dir, "pegelonline/cux", 2024, series(2000, 360_000, 5, y2024));
      // 2025's values are all suspect, so it has hours but doesn't measure.
      const y2025 = Date.UTC(2025, 0, 1);
      await write(dir, "gesla/cux", 2025, series(2000, HOUR_MS, 0, y2025, Flag.suspect));
      await write(dir, "pegelonline/cux", 2025, series(2000, 360_000, 5, y2025));
      await years(dir, [
        ["gesla/cux", 2024, 2000],
        ["pegelonline/cux", 2024, 2000],
        ["gesla/cux", 2025, 2000],
        ["pegelonline/cux", 2025, 2000],
      ]);
      const [row] = (await measureLinks(dir, pair(), 2)).rows;
      assert.equal(row!.since, "2024-01-01T00:00:00.000Z");
      assert.equal(row!.offset_m, 5);
      assert.equal(row!.spread_m, 0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps last month's row for a pair whose files are being rewritten", async () => {
    const dir = await mkdtemp(join(tmpdir(), "links-"));
    try {
      await years(dir, [
        ["gesla/cux", null, 0],
        ["pegelonline/cux", 2025, 8760],
      ]);
      assert.deepEqual(await measureLinks(dir, pair(), 1, [row()]), { rows: [row()], failed: 0 });
      // Nor once its stations are no longer linked.
      const apart = pair().map((s) => ({ ...s, same_as: [] }));
      assert.deepEqual((await measureLinks(dir, apart, 1, [row()])).rows, []);
      // Not once a station has opened a new epoch.
      assert.deepEqual((await measureLinks(dir, pair(), 1, [row({ b_epoch: 2 })])).rows, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps last month's row when the store has no years file or list for it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "links-"));
    try {
      assert.deepEqual((await measureLinks(dir, pair(), 1, [row()])).rows, [row()]);
      assert.deepEqual((await measureLinks(dir, [], 1, [row()])).rows, [row()]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps last month's row for a pair whose file is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "links-"));
    try {
      // The years files count 2025, but neither file is there.
      await years(dir, [
        ["gesla/cux", 2025, 8760],
        ["pegelonline/cux", 2025, 8760],
      ]);
      assert.deepEqual((await measureLinks(dir, pair(), 1, [row()])).rows, [row()]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops last month's row for a pair whose values were read but don't measure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "links-"));
    try {
      const y2025 = Date.UTC(2025, 0, 1);
      await write(dir, "gesla/cux", 2025, series(2000, HOUR_MS, 0, y2025, Flag.suspect));
      await write(dir, "pegelonline/cux", 2025, series(2000, 360_000, 5, y2025));
      await years(dir, [
        ["gesla/cux", 2025, 2000],
        ["pegelonline/cux", 2025, 2000],
      ]);
      assert.deepEqual((await measureLinks(dir, pair(), 1, [row()])).rows, []);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the links file", () => {
  it("writes and reads back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "links-"));
    try {
      await writeLinks(dir, [row()]);
      const [back] = await readLinks(dir);
      assert.deepEqual(back, row());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    assert.deepEqual(await readLinks(join(tmpdir(), "no-such-store")), []);
  });
});

const round = (m: number) => Math.round(m * 1e4) / 1e4;
