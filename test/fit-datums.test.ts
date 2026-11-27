import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createTidePredictor } from "@slackwater/engine";
import {
  datumsDigest,
  datumsDue,
  datumsVersion,
  readFitDatums,
  DATUM_SPACING_MS,
  reduceDatums,
  Stale,
  writeFitDatums,
  type FitDatums,
} from "../src/fit/datums.ts";
import { constantsOf, datumsSource } from "../src/fit/datums-store.ts";
import { engineVersion, type Fit, type FittedCandidate } from "../src/fit/fit.ts";
import { Busy, emptyInputs, readSeries } from "../src/fit/series.ts";
import { dropFits, readFits, writeFits } from "../src/fit/store.ts";
import { datumsInWorker } from "../src/fit/workers.ts";
import { Flag, type Source, type SourceMetadata, type StoredStation } from "../src/schema.ts";
import { readYearStats, writeObservations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import { writeYears, type YearRow } from "../src/store/years.ts";

const NOW = new Date("2026-11-25T00:00:00Z");
const HOUR = 3_600_000;
const MINUTE = 60_000;
const FINALIZES = { id: "test", finalizes: true } as unknown as SourceMetadata;
const CONSTANTS = [
  { name: "M2", amplitude: 1, phase: 30 },
  { name: "K1", amplitude: 0.2, phase: 120 },
];
const EPOCHS = [
  { id: 1, datum: "STND", since: null, until: null, to_current: 0, state: "open" as const },
];
const station = (id: string, epochs: object[] = EPOCHS) =>
  ({
    id: `test/${id}`,
    source: "test",
    source_id: id,
    datum: "STND",
    epochs,
  }) as unknown as StoredStation;
/** A fit's inputs as `readSeries` records them, epochs and all. */
const inputs = (epochs: object[] = EPOCHS) =>
  JSON.stringify({
    ...emptyInputs(),
    epochs: epochs.map(({ id, since, until, to_current, state }: any) => ({
      id,
      since,
      until,
      to_current,
      state,
    })),
    digest: "d",
  });
const yearsOf = (rows: YearRow[]) =>
  new Map(rows.map((r) => [`${r.id} ${r.epoch} ${r.year}`, r] as const));

const fitOf = (id: string, fields: Partial<Fit> = {}): Fit =>
  ({
    id: `test/${id}`,
    fitted: NOW.toISOString(),
    reason: null,
    version: "v1",
    since: new Date(Date.UTC(2022, 0, 1)).toISOString(),
    until: new Date(Date.UTC(2024, 0, 1)).toISOString(),
    z0_m: 2,
    engine: engineVersion(),
    held_out: 2024,
    inputs: inputs(),
    ...fields,
  }) as Fit;

/**
 * Writes a station's year files of M2 and K1 on a mean of 2 m, every
 * `step` ms, with `flagOf` deciding each value's flag; returns their rows.
 */
async function writeTide(
  store: string,
  id: string,
  years: number[],
  step: number,
  flagOf: (time: number) => Flag = () => Flag.good,
  stamp: (time: number, index: number) => number = (t) => t,
): Promise<YearRow[]> {
  const predictor = createTidePredictor(CONSTANTS, {
    offset: false,
    nodeCorrections: "schureman",
  });
  const rows: YearRow[] = [];
  for (const year of years) {
    const observations = [];
    let i = 0;
    for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += step)
      observations.push({
        time: stamp(t, i++),
        level: 2 + predictor.getWaterLevelAtTime({ time: new Date(t) }).level,
        flag: flagOf(t),
      });
    const path = seriesPath(store, "levels", "test", id, year);
    await writeObservations(path, observations, "STND");
    rows.push({ id: `test/${id}`, epoch: 1, year, ...(await readYearStats([path])).get(path)! });
  }
  return rows;
}

describe("reduceDatums", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-datums-"));
  after(() => rmSync(store, { recursive: true, force: true }));
  let years: Map<string, YearRow>;
  // A day of 2023-06 the source interpolated, which the reduction can't read.
  const filled = (t: number) =>
    t >= Date.UTC(2023, 5, 10) && t < Date.UTC(2023, 5, 11) ? Flag.interpolated : Flag.good;
  before(async () => {
    years = yearsOf([
      ...(await writeTide(store, "a", [2022, 2023, 2024], HOUR)),
      ...(await writeTide(store, "b", [2022, 2023, 2024], HOUR, filled)),
      ...(await writeTide(store, "c", [2024], HOUR, (t) =>
        t < Date.UTC(2024, 6, 1) ? Flag.good : Flag.bad,
      )),
    ]);
  });
  const context = () => ({ store, metadata: FINALIZES, years, errata: [], now: NOW });

  it("reduces the observed datums over the latest whole years, and predicts HAT and LAT on z0", async () => {
    const row = await reduceDatums(station("a"), fitOf("a"), CONSTANTS, context());
    assert.equal(row.reason, null);
    assert.equal(row.since, "2022-01-01T00:00:00.000Z");
    assert.equal(row.until, "2025-01-01T00:00:00.000Z");
    assert.equal(row.months, 36);
    assert.equal(row.inferred_hours, 0);
    assert.equal(row.datum, "STND");
    assert.equal(row.epoch, 1);
    const o = row.observed!;
    assert.ok(Math.abs(o.MSL! - 2) < 0.005, `MSL ${o.MSL}`);
    assert.ok(o.MHHW! > o.MHW! && o.MHW! > o.MSL! && o.MSL! > o.MLW! && o.MLW! > o.MLLW!);
    const p = row.predicted!;
    assert.equal(row.predicted_since, "2007-01-01T00:00:00.000Z");
    assert.equal(row.predicted_until, "2026-01-01T00:00:00.000Z");
    assert.equal(p.MSL, 2);
    // The highest and lowest tide of M2 and K1 together, with their nodal modulation.
    assert.ok(p.HAT! > 3.15 && p.HAT! < 3.3, `HAT ${p.HAT}`);
    assert.ok(p.LAT! < 0.85 && p.LAT! > 0.7, `LAT ${p.LAT}`);
    assert.equal(row.version, "v1");
    assert.equal(row.package, datumsVersion());
    assert.equal(row.digest, datumsDigest(datumsVersion()));
  });

  it("never reads an interpolated value, so a day of them is a gap the package doesn't fill", async () => {
    const row = await reduceDatums(station("b"), fitOf("b"), CONSTANTS, context());
    // June 2023 is incomplete, so the run is cut there, and the latest whole year after it wins.
    assert.equal(row.since, "2024-01-01T00:00:00.000Z");
    assert.equal(row.until, "2025-01-01T00:00:00.000Z");
    assert.equal(row.months, 12);
  });

  it("gives a reason and no observed datums where no whole year is complete", async () => {
    const fit = fitOf("c", { since: new Date(Date.UTC(2024, 0, 1)).toISOString(), held_out: 2024 });
    const row = await reduceDatums(station("c"), fit, CONSTANTS, context());
    assert.match(row.reason!, /no whole year of complete months/);
    assert.equal(row.observed, null);
    assert.equal(row.since, null);
    assert.ok(row.predicted!.LAT! < 1);
  });

  it("names the open epoch, not a later held or rejected one", async () => {
    const epochs = [
      ...EPOCHS,
      {
        id: 2,
        datum: "NAVD88",
        since: "2026-01-01T00:00:00Z",
        until: null,
        to_current: null,
        state: "held",
      },
      {
        id: 3,
        datum: "XX",
        since: "2026-02-01T00:00:00Z",
        until: null,
        to_current: 0,
        state: "rejected",
      },
    ];
    const row = await reduceDatums(
      station("a", epochs),
      fitOf("a", { inputs: inputs(epochs) }),
      CONSTANTS,
      context(),
    );
    assert.equal(row.epoch, 1);
    assert.equal(row.datum, "STND");
  });

  it("waits for a fit where the station's epochs changed after it", async () => {
    const epochs = [{ ...EPOCHS[0]!, to_current: 1.2 }];
    await assert.rejects(
      reduceDatums(station("a", epochs), fitOf("a"), CONSTANTS, context()),
      Stale,
    );
  });

  it("predicts no datums from constants with no daily or faster tide", async () => {
    const row = await reduceDatums(
      station("a"),
      fitOf("a"),
      [{ name: "Sa", amplitude: 0.1, phase: 10 }],
      context(),
    );
    assert.equal(row.predicted, null);
    assert.equal(row.predicted_since, null);
    assert.ok(row.observed);
  });

  it("reduces on a worker thread as on the main thread", async () => {
    const [here, there] = await Promise.all([
      reduceDatums(station("a"), fitOf("a"), CONSTANTS, context()),
      datumsInWorker(station("a"), fitOf("a"), CONSTANTS, context()),
    ]);
    assert.deepEqual({ ...there, reduced: "" }, { ...here, reduced: "" });
  });

  it("waits while the station's year files are being written", async () => {
    const busy = new Map([
      ...years,
      ["test/a null null", { id: "test/a", epoch: null, year: null }],
    ]);
    await assert.rejects(
      reduceDatums(station("a"), fitOf("a"), CONSTANTS, { ...context(), years: busy }),
      Busy,
    );
  });
});

describe("readSeries with a spacing", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-datums-spacing-"));
  after(() => rmSync(store, { recursive: true, force: true }));

  it("thins a finer series to every 5 minutes and leaves a coarser one whole", async () => {
    const years = yearsOf([
      ...(await writeTide(store, "fine", [2024], MINUTE)),
      ...(await writeTide(store, "six", [2024], 6 * MINUTE)),
      // Every 5 minutes, with every other stamp a second early.
      ...(await writeTide(
        store,
        "jitter",
        [2024],
        5 * MINUTE,
        undefined,
        (t, i) => t - (i % 2) * 1000,
      )),
    ]);
    const read = (id: string) =>
      readSeries(
        station(id),
        { start: Date.UTC(2024, 0, 1), end: Date.UTC(2024, 0, 2) },
        "measured",
        { store, metadata: FINALIZES, years, errata: [], now: NOW, inputs: emptyInputs() },
        DATUM_SPACING_MS,
      );
    const fine = await read("fine");
    assert.equal(fine.length, 288);
    assert.ok(fine.every((s, i) => i === 0 || s.time - fine[i - 1]!.time === 5 * MINUTE));
    assert.equal((await read("six")).length, 240);
    assert.equal((await read("jitter")).length, 288);
  });
});

describe("datumsDue", () => {
  const pkg = "@slackwater/datums@1";
  const row = (fields: Partial<FitDatums> = {}) =>
    ({
      version: "v1",
      fitted: NOW.toISOString(),
      digest: datumsDigest(pkg),
      ...fields,
    }) as FitDatums;

  it("is due without a row, or with one from another fit or package", () => {
    assert.ok(datumsDue(fitOf("a"), undefined, pkg));
    assert.ok(datumsDue(fitOf("a"), row({ version: "v0" }), pkg));
    assert.ok(datumsDue(fitOf("a"), row({ fitted: "2026-01-01T00:00:00.000Z" }), pkg));
    assert.ok(datumsDue(fitOf("a"), row(), "@slackwater/datums@2"));
  });

  it("isn't due with a current row, or for a fit without constants", () => {
    assert.ok(!datumsDue(fitOf("a"), row(), pkg));
    assert.ok(!datumsDue(fitOf("a", { version: null }), undefined, pkg));
  });
});

describe("datumsSource", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-datums-source-"));
  after(() => rmSync(store, { recursive: true, force: true }));
  const source = { metadata: FINALIZES } as unknown as Source;
  const candidate = (id: string, version: string, name: string, kept = true): FittedCandidate => ({
    id,
    version,
    name,
    rank: 1,
    doodson: [2, 0, 0, 0, 0, 0],
    speed: 28.98,
    kept,
    reason: kept ? null : "snr",
    conflict: null,
    amplitude_m: 1,
    phase_deg: 10,
    amplitude_ci_m: null,
    phase_ci_deg: null,
    snr: null,
    yearly_amplitude_sd_m: null,
    yearly_phase_sd_deg: null,
    yearly_se_m: null,
  });
  const stored = (id: string, fields: Partial<FitDatums> = {}): FitDatums => ({
    id,
    version: "v1",
    fitted: NOW.toISOString(),
    reduced: NOW.toISOString(),
    reason: null,
    datum: "STND",
    epoch: 1,
    since: null,
    until: null,
    months: null,
    observed_hours: null,
    inferred_hours: null,
    observed: null,
    predicted_since: "2007-01-01T00:00:00.000Z",
    predicted_until: "2026-01-01T00:00:00.000Z",
    predicted: { LAT: 0 },
    ignored: [],
    package: datumsVersion(),
    digest: datumsDigest(datumsVersion()),
    ...fields,
  });

  it("reduces due stations from their fits' constants, keeps current rows and drops stale ones", async () => {
    await writeYears(store, "test", [
      { id: "test/a", epoch: 1, year: 2024, hours: 1, flags: [1, 0, 0, 0, 0], version: "x" },
    ]);
    await writeFits(
      store,
      "test",
      [fitOf("a"), fitOf("b", { version: "v2" }), fitOf("c"), fitOf("d", { version: null })],
      [
        candidate("test/a", "v1", "M2"),
        candidate("test/b", "v2", "M2"),
        candidate("test/b", "v2", "S2", false),
        candidate("test/c", "v1", "M2"),
      ],
    );
    // a is current; b's row is from an earlier fit; e has left the list.
    await writeFitDatums(store, "test", [stored("test/a"), stored("test/b"), stored("test/e")]);
    const calls: { id: string; constants: unknown }[] = [];
    const report = await datumsSource(
      store,
      source,
      ["a", "b", "c", "d"].map((id) => station(id)),
      {
        now: NOW,
        errata: [],
        reduce: async (s, fit, constants) => {
          calls.push({ id: s.id, constants });
          if (s.id === "test/c") throw new Error("boom");
          return stored(s.id, { version: fit.version!, digest: "new", reason: "short" });
        },
      },
    );
    assert.deepEqual(calls, [
      { id: "test/b", constants: [{ name: "M2", amplitude: 1, phase: 10 }] },
      { id: "test/c", constants: [{ name: "M2", amplitude: 1, phase: 10 }] },
    ]);
    assert.deepEqual(report.reduced, ["test/b"]);
    assert.deepEqual(report.none, [{ id: "test/b", reason: "short" }]);
    assert.equal(report.current, 1);
    assert.match(report.failed[0]!, /^test\/c: boom/);
    const rows = await readFitDatums(store, "test");
    assert.deepEqual([...rows.keys()], ["test/a", "test/b"]);
    assert.equal(rows.get("test/b")!.version, "v2");
  });

  it("goes with its station when the station is withheld", async () => {
    assert.deepEqual(await dropFits(store, "test", (id) => id === "test/b"), ["test/b"]);
    assert.deepEqual([...(await readFitDatums(store, "test")).keys()], ["test/a"]);
    assert.deepEqual([...(await readFits(store, "test")).keys()].sort(), [
      "test/a",
      "test/c",
      "test/d",
    ]);
  });

  it("keeps a stale fit's row and reduces nothing for it", async () => {
    const moved = [{ ...EPOCHS[0]!, to_current: 1.2 }];
    let called = false;
    const report = await datumsSource(store, source, [station("a", moved)], {
      now: NOW,
      errata: [],
      all: true,
      reduce: async () => {
        called = true;
        throw new Error("not called");
      },
    });
    assert.equal(called, false);
    assert.deepEqual(report.stale, ["test/a"]);
    assert.deepEqual(report.failed, []);
    assert.deepEqual([...(await readFitDatums(store, "test")).keys()], ["test/a"]);
  });

  it("starts nothing past its deadline, leaves the due stations, and still drops stale rows", async () => {
    const other = mkdtempSync(join(tmpdir(), "stillwell-datums-until-"));
    try {
      await writeYears(other, "test", [
        { id: "test/a", epoch: 1, year: 2024, hours: 1, flags: [1, 0, 0, 0, 0], version: "x" },
      ]);
      await writeFits(
        other,
        "test",
        [fitOf("a"), fitOf("b"), fitOf("c")],
        ["a", "b", "c"].map((id) => candidate(`test/${id}`, "v1", "M2")),
      );
      // a is current; b and c are due; e has left the list.
      await writeFitDatums(other, "test", [stored("test/a"), stored("test/e")]);
      let called = false;
      const report = await datumsSource(
        other,
        source,
        ["a", "b", "c"].map((id) => station(id)),
        {
          now: NOW,
          errata: [],
          until: 1000,
          clock: () => 1001,
          reduce: async () => {
            called = true;
            throw new Error("not called");
          },
        },
      );
      assert.equal(called, false);
      assert.equal(report.left, 2);
      assert.equal(report.current, 1);
      assert.deepEqual(report.reduced, []);
      assert.deepEqual([...(await readFitDatums(other, "test")).keys()], ["test/a"]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("refuses an empty list, which would take every row", async () => {
    await assert.rejects(
      datumsSource(store, source, [], { now: NOW, errata: [] }),
      /lists no stations/,
    );
  });

  it("writes and reads back a row without predicted datums", async () => {
    const other = mkdtempSync(join(tmpdir(), "stillwell-datums-null-"));
    try {
      const row = stored("test/a", {
        predicted: null,
        predicted_since: null,
        predicted_until: null,
      });
      await writeFitDatums(other, "test", [row]);
      assert.deepEqual([...(await readFitDatums(other, "test")).values()], [row]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("takes a fit's kept constants of its own version only", () => {
    assert.deepEqual(
      constantsOf(
        [candidate("x", "v1", "M2"), candidate("x", "v0", "S2"), candidate("x", "v1", "K1", false)],
        "v1",
      ),
      [{ name: "M2", amplitude: 1, phase: 10 }],
    );
  });
});
