import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  constituents,
  createTidePredictor,
  foremanCandidates,
  type HarmonicConstituent,
} from "@slackwater/engine";
import type { Erratum } from "../src/errata.ts";
import { CANDIDATES } from "../src/fit/candidates.ts";
import {
  comparable,
  engineVersion,
  fitStation,
  meanRange,
  varianceExplained,
} from "../src/fit/fit.ts";
import type { FitContext } from "../src/fit/fit.ts";
import { Flag, type Observation, type SourceMetadata, type StoredStation } from "../src/schema.ts";
import { readYearStats, writeObservations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import type { YearRow } from "../src/store/years.ts";

const HOUR = 3_600_000;
const OFFSET = 0.4;
const GENERATING: HarmonicConstituent[] = [
  { name: "M2", amplitude: 1, phase: 30 },
  { name: "S2", amplitude: 0.3, phase: 60 },
  { name: "K1", amplitude: 0.2, phase: 120 },
  { name: "O1", amplitude: 0.15, phase: 200 },
];

/** A fixed pseudo-random sequence in [-1, 1), so a run is the same every time. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 31 - 1;
  };
}

const hours = (start: number, end: number) =>
  Array.from({ length: (end - start) / HOUR }, (_, i) => start + i * HOUR);

const tideAt = (times: number[], constants = GENERATING) => {
  const predictor = createTidePredictor(constants, { offset: false, nodeCorrections: "schureman" });
  return times.map((time) => predictor.getWaterLevelAtTime({ time: new Date(time) }).level);
};

const generated = new Map<number, Observation[]>();
/** A year of hourly good values: the four constituents, an offset and noise of at most 1 cm. */
function yearOfValues(year: number, keep = Infinity): Observation[] {
  let rows = generated.get(year);
  if (!rows) {
    const times = hours(Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1));
    const next = noise(year);
    const levels = tideAt(times);
    rows = times.map((time, i) => ({
      time,
      level: levels[i]! + OFFSET + 0.01 * next(),
      flag: Flag.good,
      source_flag: Flag.good,
    }));
    generated.set(year, rows);
  }
  return rows.slice(0, keep);
}

const metadata = { id: "test", finalizes: true } as unknown as SourceMetadata;
const station = {
  id: "test/1",
  source: "test",
  source_id: "1",
  datum: "NAVD88",
  epochs: [
    {
      id: 1,
      datum: "NAVD88",
      since: null,
      until: null,
      seen: null,
      reference: null,
      reference_since: null,
      datums: {},
      to_current: 0,
      state: "open",
    },
  ],
} as unknown as StoredStation;

/** A temp store with a station's year files for each `[year, hours kept]`, counted as the store would. */
async function store(spans: [year: number, keep?: number][]) {
  const root = mkdtempSync(join(tmpdir(), "stillwell-fit-"));
  const years = new Map<string, YearRow>();
  for (const [year, keep] of spans) {
    const file = seriesPath(root, "levels", "test", "1", year);
    await writeObservations(file, yearOfValues(year, keep), "NAVD88");
    const stats = (await readYearStats([file])).get(file)!;
    years.set(`test/1 1 ${year}`, { id: "test/1", epoch: 1, year, ...stats });
  }
  const context = (overrides: Partial<FitContext> = {}): FitContext => ({
    store: root,
    metadata,
    years,
    errata: [],
    now: new Date(Date.UTC(2026, 10, 25)),
    finalYear: 2024,
    engine: engineVersion(),
    ...overrides,
  });
  return { years, context };
}

describe("CANDIDATES", () => {
  it("names catalog constituents of the same speed and Doodson numbers", () => {
    for (const c of CANDIDATES) {
      const entry = constituents[c.name];
      assert.ok(entry, `${c.name} is in the catalog`);
      assert.equal(entry.name, c.name);
      assert.ok(Math.abs(entry.speed - c.speed) < 1e-6, `${c.name}: ${entry.speed} vs ${c.speed}`);
      if (!c.compound) assert.deepEqual(c.doodson, entry.coefficients, c.name);
    }
  });

  it("lists each name once, with Sa and Ssa and without Foreman's H1 and H2", () => {
    const names = CANDIDATES.map((c) => c.name);
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.includes("Sa") && names.includes("Ssa"));
    assert.ok(!names.includes("H1") && !names.includes("H2"));
  });

  it("gives Foreman's candidates the comparison his table gives them", () => {
    // H1 and H2 are the lines MA2 and MB2 name here. Z0, the mean, stands for no test.
    const here = (name: string | undefined) =>
      name === "Z0" ? undefined : ({ H1: "MA2", H2: "MB2" }[name ?? ""] ?? name);
    const names = new Set(CANDIDATES.map((c) => c.name));
    const seasonal = ["Sa", "Ssa"];
    for (const { name, comparison } of foremanCandidates) {
      const candidate = CANDIDATES.find((c) => c.name === here(name));
      assert.ok(candidate, `${name} is a candidate`);
      if (!seasonal.includes(name)) assert.equal(candidate.comparison, here(comparison), name);
    }
    const foreman = new Set(foremanCandidates.map((c) => here(c.name)));
    for (const c of CANDIDATES) {
      if (c.comparison) assert.ok(names.has(c.comparison), `${c.name}: ${c.comparison}`);
      if (!foreman.has(c.name)) assert.equal(c.comparison, undefined, c.name);
    }
  });
});

describe("comparable", () => {
  const start = Date.UTC(2023, 0, 1);
  const comparisonOf = (step: number, name: string) =>
    comparable(
      CANDIDATES,
      Array.from({ length: 100 }, (_, i) => start + i * step),
    ).find((c) => c.name === name)!.comparison;

  it("gives each candidate its comparison on hourly values", () => {
    assert.equal(comparisonOf(HOUR, "T2"), "S2");
    assert.equal(comparisonOf(HOUR, "S1"), "K1");
    assert.equal(comparisonOf(HOUR, "K1"), undefined);
  });

  it("drops a comparison the sampling can't resolve", () => {
    // Six hours between values put the Nyquist frequency at 30 degrees an hour, S2's speed.
    assert.equal(comparisonOf(6 * HOUR, "T2"), undefined);
    assert.equal(comparisonOf(6 * HOUR, "S1"), "K1");
  });
});

describe("engineVersion", () => {
  it("names the engine package and its version", () => {
    assert.match(engineVersion(), /^@slackwater\/engine@\d+\.\d+\.\d+/);
  });
});

describe("meanRange", () => {
  it("is twice the amplitude of a pure tide", () => {
    // The nodal factor of M2 is 1 in mid-2020, so its amplitude is the constant's.
    const start = Date.UTC(2020, 6, 1);
    const range = meanRange(
      [{ name: "M2", amplitude: 1, phase: 0 }],
      start,
      start + 30 * 24 * HOUR,
    );
    assert.ok(Math.abs(range! - 2) < 0.02, `${range}`);
  });
});

describe("varianceExplained", () => {
  const times = hours(Date.UTC(2024, 0, 1), Date.UTC(2024, 0, 1) + 70 * 24 * HOUR);
  const levels = tideAt(times);
  const observed = times.map((time, i) => ({ time, level: levels[i]! }));

  it("is nearly 1 for the constants that made a noiseless series", () => {
    assert.ok(varianceExplained(GENERATING, observed)! > 0.999);
  });

  it("is 0 for no constituents", () => {
    assert.ok(Math.abs(varianceExplained([], observed)!) < 1e-9);
  });
});

describe("fitStation", () => {
  const circular = (a: number, b: number) => Math.abs(((((a - b + 540) % 360) + 360) % 360) - 180);

  it("fits the generating constants and scores them on the held-out year", async () => {
    const { years, context } = await store([2019, 2020, 2021, 2022, 2023, 2024].map((y) => [y]));
    const { fit, constituents: rows } = await fitStation(station, context());
    assert.equal(fit.reason, null);
    assert.equal(fit.held_out, 2024);
    assert.equal(fit.since, "2019-01-01T00:00:00.000Z");
    assert.equal(fit.until, "2024-01-01T00:00:00.000Z");
    assert.equal(fit.hours, (Date.UTC(2024, 0, 1) - Date.UTC(2019, 0, 1)) / HOUR);
    assert.equal(fit.node_corrections, "schureman");
    assert.ok(fit.version);
    assert.ok(fit.variance_explained! > 0.99, `${fit.variance_explained}`);
    assert.ok(fit.mean_range_m! > 1.5 && fit.mean_range_m! < 3, `${fit.mean_range_m}`);
    assert.ok(fit.held_out_hours! > 0 && fit.held_out_hours! <= 8784, `${fit.held_out_hours}`);

    assert.deepEqual(
      rows.map((r) => r.name),
      CANDIDATES.map((c) => c.name),
    );
    for (const want of GENERATING) {
      const got = rows.find((r) => r.name === want.name)!;
      assert.equal(got.kept, true, `${want.name} is kept`);
      assert.ok(Math.abs(got.amplitude_m! - want.amplitude) < 0.01, `${want.name} amplitude`);
      assert.ok(circular(got.phase_deg!, want.phase) < 1, `${want.name} phase ${got.phase_deg}`);
    }
    for (const row of rows.filter((r) => !r.kept))
      assert.ok(row.reason, `${row.name} has a reason`);

    const { versions } = JSON.parse(fit.inputs) as { versions: Record<string, string> };
    assert.deepEqual(
      Object.keys(versions).sort(),
      [...years.values()].map((r) => `${r.epoch} ${r.year}`).sort(),
    );
  });

  it("tests S1, pi1, psi1, T2 and R2 against their comparisons over a common year", async () => {
    const { context } = await store([[2023], [2024]]);
    const { fit, constituents: rows } = await fitStation(station, context());
    assert.equal(fit.reason, null);
    assert.equal(fit.since, "2023-01-01T00:00:00.000Z");
    const row = (name: string) => rows.find((r) => r.name === name)!;
    for (const want of GENERATING) {
      const got = row(want.name);
      assert.equal(got.kept, true, `${want.name} is kept`);
      assert.ok(Math.abs(got.amplitude_m! - want.amplitude) < 0.01, `${want.name} amplitude`);
    }
    for (const [name, conflict] of [
      ["S1", "K1"],
      ["pi1", "P1"],
      ["psi1", "K1"],
      ["T2", "S2"],
      ["R2", "S2"],
    ] as const) {
      assert.equal(row(name).kept, false, `${name} is left out`);
      assert.equal(row(name).reason, "rayleigh", name);
      assert.equal(row(name).conflict, conflict, name);
    }
    // A cycle a year apart from K1 and S2, and two from P1 and K2, which a year separates.
    for (const name of ["P1", "K2"]) assert.notEqual(row(name).reason, "rayleigh", name);
  });

  it("lets a leap year, which separates them, test those candidates on their size", async () => {
    const { context } = await store([[2024], [2025]]);
    const { fit, constituents: rows } = await fitStation(station, context({ finalYear: 2025 }));
    assert.equal(fit.since, "2024-01-01T00:00:00.000Z");
    for (const name of ["S1", "pi1", "T2", "R2", "K1", "S2"])
      assert.notEqual(rows.find((r) => r.name === name)!.reason, "rayleigh", name);
    // The pairs are barely a cycle apart, and the constants still come out.
    for (const want of GENERATING) {
      const got = rows.find((r) => r.name === want.name)!;
      assert.equal(got.kept, true, `${want.name} is kept`);
      assert.ok(Math.abs(got.amplitude_m! - want.amplitude) < 0.01, `${want.name} amplitude`);
    }
  });

  it("gives a row with a reason and no candidates where the station has no year files", async () => {
    const { context } = await store([]);
    const { fit, constituents: rows } = await fitStation(station, context());
    assert.equal(fit.reason, "no year files");
    assert.equal(fit.version, null);
    assert.deepEqual(rows, []);
  });

  it("gives one where the window is under 183 days", async () => {
    const { context } = await store([[2024]]);
    const { fit, constituents: rows } = await fitStation(station, context());
    assert.match(fit.reason!, /under 183 days/);
    assert.deepEqual(rows, []);
  });

  it("holds out an earlier year where the final year has under half its hours", async () => {
    const { context } = await store([[2021], [2022], [2023], [2024, 24 * 100]]);
    const { fit } = await fitStation(station, context());
    assert.equal(fit.reason, null);
    assert.equal(fit.held_out, 2023);
    assert.equal(fit.since, "2021-01-01T00:00:00.000Z");
    assert.equal(fit.until, "2023-01-01T00:00:00.000Z");
  });
});
