import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { createTidePredictor } from "@slackwater/engine";
import type { Erratum } from "../src/errata.ts";
import { CANDIDATES } from "../src/fit/candidates.ts";
import type { Fit, FittedCandidate } from "../src/fit/fit.ts";
import { engineVersion, fitStation } from "../src/fit/fit.ts";
import { emptyInputs, finalYear, inputsDigest, readSeries } from "../src/fit/series.ts";
import {
  dropFits,
  due,
  fitSource,
  readConstituents,
  readFits,
  writeFits,
} from "../src/fit/store.ts";
import { Flag, type Source, type SourceMetadata, type StoredStation } from "../src/schema.ts";
import { readYearStats, writeObservations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import { writeYears, type YearRow } from "../src/store/years.ts";
import { fitInWorker, workerCount } from "../src/fit/workers.ts";
import { Busy } from "../src/fit/series.ts";

const NOW = new Date("2026-11-25T00:00:00Z");
const ENGINE = engineVersion();
const HOUR = 3_600_000;

const row = (year: number, version: string, id = "test/a", epoch = 1): YearRow => ({
  id,
  epoch,
  year,
  hours: 8760,
  flags: [8760, 0, 0, 0, 0],
  version,
});
const yearsOf = (rows: YearRow[]) =>
  new Map(rows.map((r) => [`${r.id} ${r.epoch} ${r.year}`, r] as const));
const station = (id: string, fields: Record<string, unknown> = {}) =>
  ({
    id: `test/${id}`,
    source: "test",
    source_id: id,
    epochs: [{ id: 1, since: null, until: null, to_current: 0, state: "open" }],
    ...fields,
  }) as unknown as StoredStation;
const FINALIZES = { id: "test", finalizes: true } as unknown as SourceMetadata;
const erratum = (fields: Partial<Erratum> = {}): Erratum => ({
  id: "test-x",
  source: "test",
  stations: ["test/a"],
  since: null,
  until: null,
  error: "e",
  handling: "kept",
  response: "r",
  evidence: null,
  reported: null,
  report: null,
  ...fields,
});

const fit = (fields: Partial<Fit> = {}): Fit =>
  ({
    id: "test/a",
    fitted: NOW.toISOString(),
    reason: null,
    version: "v",
    engine: ENGINE,
    held_out: 2024,
    inputs: JSON.stringify({ ...emptyInputs(), digest: "d" }),
    ...fields,
  }) as Fit;
const rows = (version: string) => [{ version }, { version }];

describe("a fit is due", () => {
  it("when the station has none, or another engine version fitted it", () => {
    assert.equal(due(undefined, "d", ENGINE), true);
    assert.equal(due(fit({ engine: "other@1" }), "d", ENGINE, rows("v")), true);
  });

  it("not while what it depends on is as it was", () => {
    assert.equal(due(fit(), "d", ENGINE, rows("v")), false);
  });

  it("when what it depends on has changed", () => {
    assert.equal(due(fit(), "d2", ENGINE, rows("v")), true);
  });

  it("when its candidate rows are missing or another fit's, as a run stopped between the files leaves them", () => {
    assert.equal(due(fit(), "d", ENGINE, []), true);
    assert.equal(due(fit(), "d", ENGINE, rows("older")), true);
    assert.equal(due(fit({ reason: "too short", version: null }), "d", ENGINE, rows("v")), true);
  });

  it("when the inputs it recorded can't be read", () => {
    assert.equal(due(fit({ inputs: "not json" }), "d", ENGINE, rows("v")), true);
  });

  it("not for a station without constants until something changes", () => {
    const none = fit({ reason: "too short", version: null });
    assert.equal(due(none, "d", ENGINE, []), false);
    assert.equal(due(none, "d2", ENGINE, []), true);
  });
});

describe("inputsDigest", () => {
  const a = station("a");
  const base = {
    metadata: FINALIZES,
    years: yearsOf([row(2023, "a"), row(2024, "b")]),
    errata: [] as Erratum[],
    finalYear: 2024,
  };
  const digest = inputsDigest(a, base);

  it("changes with a year file's version, a file added within the final year, and the final year", () => {
    assert.notEqual(
      inputsDigest(a, { ...base, years: yearsOf([row(2023, "a2"), row(2024, "b")]) }),
      digest,
    );
    // A year backfilled inside the window, which no earlier read named.
    assert.notEqual(
      inputsDigest(a, {
        ...base,
        years: yearsOf([row(2012, "z"), row(2023, "a"), row(2024, "b")]),
      }),
      digest,
    );
    assert.notEqual(inputsDigest(a, { ...base, finalYear: 2025 }), digest);
  });

  it("changes with a candidate's Rayleigh comparison", () => {
    const s1 = CANDIDATES.find((c) => c.name === "S1")!;
    const comparison = s1.comparison;
    try {
      s1.comparison = undefined;
      assert.notEqual(inputsDigest(a, base), digest);
    } finally {
      s1.comparison = comparison;
    }
    assert.equal(inputsDigest(a, base), digest);
  });

  it("covers a gauge's files however long ago it closed", () => {
    const closed = { ...base, years: yearsOf([row(1974, "a"), row(1975, "b")]) };
    assert.notEqual(
      inputsDigest(a, { ...closed, years: yearsOf([row(1974, "a2"), row(1975, "b")]) }),
      inputsDigest(a, closed),
    );
  });

  it("is the same for another station's file, and for a year after the final one", () => {
    const more = yearsOf([
      row(2023, "a"),
      row(2024, "b"),
      row(2025, "c"),
      row(2024, "x", "test/b"),
    ]);
    assert.equal(inputsDigest(a, { ...base, years: more }), digest);
  });

  it("changes with an erratum that names the station, and with its handling", () => {
    const kept = inputsDigest(a, { ...base, errata: [erratum()] });
    assert.notEqual(kept, digest);
    assert.notEqual(inputsDigest(a, { ...base, errata: [erratum({ handling: "flagged" })] }), kept);
    assert.equal(inputsDigest(a, { ...base, errata: [erratum({ stations: ["test/b"] })] }), digest);
  });

  it("changes with an epoch's conversion, where the source's checks start, and its rule for final values", () => {
    const moved = station("a", {
      epochs: [{ id: 1, since: null, until: null, to_current: 0.1, state: "open" }],
    });
    assert.notEqual(inputsDigest(moved, base), digest);
    assert.notEqual(
      inputsDigest(station("a", { source_qc_start: "2020-01-01T00:00:00Z" }), base),
      digest,
    );
    const settles = { id: "test", finalizes: false, settles_after_months: 12 } as SourceMetadata;
    assert.notEqual(
      inputsDigest(a, { ...base, metadata: settles }),
      inputsDigest(a, { ...base, metadata: { ...settles, settles_after_months: 24 } }),
    );
  });
});

describe("finalYear", () => {
  it("takes a year of preliminary values that ended by a station's source_qc_start as final", () => {
    const preliminary = (year: number): YearRow => ({
      ...row(year, "v"),
      flags: [0, 0, 8760, 0, 0],
    });
    const years = yearsOf([preliminary(2024), preliminary(2025)]);
    assert.throws(() => finalYear(FINALIZES, years, NOW), /no year of final values/);
    const qcStarts = new Map([["test/a", Date.UTC(2026, 0, 1)]]);
    assert.equal(finalYear(FINALIZES, years, NOW, qcStarts), 2025);
    assert.equal(
      finalYear(FINALIZES, years, NOW, new Map([["test/a", Date.UTC(2025, 0, 1)]])),
      2024,
    );
  });
});

describe("readSeries", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-missing-"));
  after(() => rmSync(store, { recursive: true, force: true }));

  it("refuses a year the years file counts whose file is missing, so no fit records it as read", async () => {
    await assert.rejects(
      readSeries(
        station("a"),
        { start: Date.UTC(2024, 0, 1), end: Date.UTC(2025, 0, 1) },
        "final",
        {
          store,
          metadata: FINALIZES,
          years: yearsOf([row(2024, "b")]),
          errata: [],
          now: NOW,
          inputs: emptyInputs(),
        },
      ),
      /in the years file and missing from the store/,
    );
  });
});

describe("a source-wide erratum", () => {
  it("is recorded only by a read of a year the station has a file for", async () => {
    const errata = [erratum({ stations: null, since: "2022-04-01" })];
    const read = async (years: ReturnType<typeof yearsOf>) => {
      const inputs = emptyInputs();
      // No file is opened: the year read has no row in the years file.
      await readSeries(
        station("a"),
        { start: Date.UTC(2023, 0, 1), end: Date.UTC(2024, 0, 1) },
        "final",
        { store: "nowhere", metadata: FINALIZES, errata, now: NOW, years, inputs },
      );
      return Object.keys(inputs.errata);
    };
    // The record ended in 2010; the erratum names every station from 2022 on.
    assert.deepEqual(await read(yearsOf([row(2010, "a")])), []);
  });
});

describe("fitStation", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-held-"));
  after(() => rmSync(store, { recursive: true, force: true }));
  const predictor = createTidePredictor(
    [
      { name: "M2", amplitude: 1, phase: 30 },
      { name: "K1", amplitude: 0.2, phase: 120 },
    ],
    { offset: false, nodeCorrections: "schureman" },
  );
  // A fixed sequence, so SNR is finite and every run fits the same values.
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  const write = async (year: number, every: number) => {
    const observations = [];
    for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += every * HOUR)
      observations.push({
        time: t,
        level: predictor.getWaterLevelAtTime({ time: new Date(t) }).level + noise(),
        flag: Flag.good,
      });
    const path = seriesPath(store, "levels", "test", "a", year);
    await writeObservations(path, observations, "NAVD88");
    return { id: "test/a", epoch: 1, year, ...(await readYearStats([path])).get(path)! };
  };

  it("scores on an earlier year when the latest has half its hours and none that can be scored", async () => {
    // Every other hour is half the year's values, and leaves no 71 hours unbroken for the filter.
    const years = yearsOf([await write(2022, 1), await write(2023, 1), await write(2024, 2)]);
    const { fit: result } = await fitStation(station("a"), {
      store,
      metadata: FINALIZES,
      years,
      errata: [],
      now: NOW,
      finalYear: 2024,
      engine: ENGINE,
    });
    assert.equal(result.reason, null);
    assert.equal(result.held_out, 2023);
    // The mean level a prediction is added to: the series has none, so it is near zero.
    assert.ok(Math.abs(result.z0_m!) < 0.01);
    assert.ok(result.held_out_hours! > 8000);
    for (const value of [result.held_out_rms_m, result.d2_rms_m, result.turn_time_rms_min])
      assert.ok(Number.isFinite(value));
  });
});

describe("a worker thread with files to read", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-worker-"));
  after(() => rmSync(store, { recursive: true, force: true }));

  it("reads a station's files and fits it as the main thread does", async () => {
    const predictor = createTidePredictor(
      [
        { name: "M2", amplitude: 1, phase: 30 },
        { name: "K1", amplitude: 0.2, phase: 120 },
      ],
      { offset: false, nodeCorrections: "schureman" },
    );
    const rows: YearRow[] = [];
    for (const year of [2022, 2023, 2024]) {
      const observations = [];
      for (let t = Date.UTC(year, 0, 1), i = 0; t < Date.UTC(year + 1, 0, 1); t += HOUR, i++)
        observations.push({
          time: t,
          // A fixed ripple, so the fit has noise to measure.
          level:
            2 +
            predictor.getWaterLevelAtTime({ time: new Date(t) }).level +
            ((i * 7919) % 13) / 1000,
          flag: Flag.good,
        });
      const path = seriesPath(store, "levels", "test", "a", year);
      await writeObservations(path, observations, "NAVD88");
      rows.push({ id: "test/a", epoch: 1, year, ...(await readYearStats([path])).get(path)! });
    }
    const context = {
      store,
      metadata: FINALIZES,
      years: yearsOf(rows),
      errata: [],
      now: NOW,
      finalYear: 2024,
      engine: ENGINE,
    };
    const [here, there] = await Promise.all([
      fitStation(station("a"), context),
      fitInWorker(station("a"), context),
    ]);
    assert.equal(there.fit.reason, null);
    assert.equal(there.fit.held_out, 2024);
    assert.ok(Math.abs(there.fit.z0_m! - 2.006) < 0.01);
    assert.ok(there.constituents.find((c) => c.name === "M2")!.kept);
    assert.deepEqual(there, here);
  });
});

describe("a worker thread", () => {
  const context = {
    store: "nowhere",
    metadata: FINALIZES,
    // A check is a function, which a message to a worker can't carry.
    errata: [{ ...erratum(), check: async () => {} }],
    now: NOW,
    finalYear: 2024,
    engine: ENGINE,
  };

  it("fits a station as the main thread would", async () => {
    const years = yearsOf([row(2024, "b", "test/other")]);
    const [here, there] = await Promise.all([
      fitStation(station("a"), { ...context, years }),
      fitInWorker(station("a"), { ...context, years }),
    ]);
    assert.equal(there.fit.reason, "no year files");
    assert.deepEqual(there, here);
  });

  it("says a station's year files are being written, as the main thread would", async () => {
    const years = new Map([
      ["test/a null null", { id: "test/a", epoch: null, year: null }],
      ["test/a 1 2024", row(2024, "b")],
    ]);
    await assert.rejects(fitInWorker(station("a"), { ...context, years }), Busy);
  });

  it("stays free after a task that can't be sent", async () => {
    const years = yearsOf([row(2024, "b", "test/other")]);
    // A function can't cross to a worker.
    const unsendable = station("a", { name: () => "x" });
    await assert.rejects(fitInWorker(unsendable, { ...context, years }), /could not be cloned/);
    const after = await fitInWorker(station("a"), { ...context, years });
    assert.equal(after.fit.reason, "no year files");
  });

  it("fits no more stations at once than the machine has cores", () => {
    assert.equal(workerCount(1), 1);
    assert.equal(workerCount(0), 1);
    assert.ok(workerCount(10_000) < 10_000);
  });
});

describe("fitSource", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-store-"));
  after(() => rmSync(store, { recursive: true, force: true }));
  // It never finalizes and states no revision window, so none of its values count as final.
  const source = { metadata: { id: "test", finalizes: false } } as unknown as Source;
  const finalizing = { metadata: FINALIZES } as unknown as Source;
  const options = { now: NOW, errata: [] };

  it("refuses a source with no years file", async () => {
    await assert.rejects(fitSource(store, source, [station("a")], options), /no years file/);
  });

  it("starts no station after its time, the largest tides first, and says how many it left", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stillwell-fit-budget-"));
    await writeYears(dir, "test", [row(2024, "b")]);
    const finalizes = { metadata: FINALIZES } as unknown as Source;
    const stations = [
      station("small", { tide_m: 0.01 }),
      station("unmeasured"),
      station("large", { tide_m: 1.5 }),
      station("middle", { tide_m: 0.4 }),
    ];
    const started: string[] = [];
    let now = 0;
    const report = await fitSource(dir, finalizes, stations, {
      ...options,
      until: 1,
      clock: () => now,
      concurrency: 1,
      // Each fit takes one tick, so the time runs out after the second starts.
      fit: async (s) => {
        started.push(s.id);
        now += 1;
        return {
          fit: { ...fit({ id: s.id, reason: "x", version: null }) } as Fit,
          constituents: [],
          references: [],
        };
      },
    });
    assert.deepEqual(started, ["test/large", "test/middle"]);
    assert.equal(report.left, 2);
    assert.deepEqual([...(await readFits(dir, "test")).keys()], ["test/large", "test/middle"]);
    // A run whose time has passed starts none and writes nothing: the two it left and the two the
    // stand-in gave no real digest are all still due.
    const none = await fitSource(dir, finalizes, stations, {
      ...options,
      until: -1,
      clock: () => 0,
      fit: async () => assert.fail("no station starts after the time"),
    });
    assert.equal(none.left, 4);
    assert.deepEqual([...(await readFits(dir, "test")).keys()], ["test/large", "test/middle"]);
    // It still takes out the rows of a station that left the list.
    await fitSource(
      dir,
      finalizes,
      stations.filter((s) => s.id !== "test/large"),
      { ...options, until: -1, clock: () => 0 },
    );
    assert.deepEqual([...(await readFits(dir, "test")).keys()], ["test/middle"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses an empty list, which would take every station's rows with it", async () => {
    await writeYears(store, "test", [row(2024, "b")]);
    await assert.rejects(fitSource(store, source, [], options), /lists no stations/);
  });

  it("gives every station of a source with no revision window that reason, and no constants", async () => {
    await writeYears(store, "test", [row(2024, "b")]);
    const report = await fitSource(store, source, [station("a"), station("b")], options);
    assert.deepEqual(report.fitted, []);
    assert.deepEqual(
      report.none.map((n) => n.id),
      ["test/a", "test/b"],
    );
    const fits = await readFits(store, "test");
    assert.deepEqual([...fits.keys()], ["test/a", "test/b"]);
    for (const f of fits.values()) {
      assert.match(f.reason!, /states no revision window/);
      assert.equal(f.version, null);
      assert.equal(f.engine, ENGINE);
    }
    assert.deepEqual(await readConstituents(store, "test"), []);
  });

  it("doesn't try a station without constants again until something it depends on changes", async () => {
    const again = await fitSource(store, source, [station("a"), station("b")], options);
    assert.deepEqual([again.none.length, again.current], [0, 2]);
    await writeYears(store, "test", [row(2024, "b2")]);
    const changed = await fitSource(store, source, [station("a"), station("b")], options);
    assert.deepEqual(
      changed.none.map((n) => n.id),
      ["test/a"],
    );
  });

  it("fits none of the stations for an empty selection, as an empty shard is", async () => {
    const report = await fitSource(store, source, [station("a"), station("b")], {
      ...options,
      all: true,
      only: [],
    });
    assert.deepEqual([report.none.length, report.fitted.length, report.current], [0, 0, 0]);
  });

  it("drops the rows of a station that left the list, and fits only the stations named", async () => {
    const report = await fitSource(store, source, [station("b"), station("c")], {
      ...options,
      only: ["test/c"],
    });
    assert.deepEqual(
      report.none.map((n) => n.id),
      ["test/c"],
    );
    assert.deepEqual([...(await readFits(store, "test")).keys()], ["test/b", "test/c"]);
  });

  const constants = (id: string): [Fit, FittedCandidate] => [
    { ...fit({ id }), since: null, until: null } as Fit,
    {
      id,
      version: "v",
      name: "M2",
      rank: 1,
      doodson: [2, 0, 0, 0, 0, 0, 0],
      speed: 28.9841042,
      kept: true,
    } as FittedCandidate,
  ];

  it("leaves a station whose year files are being written as it was", async () => {
    // A source whose final year comes from its settle rule, which a station being written can't move.
    const settles = {
      metadata: { id: "test", finalizes: false, settles_after_months: 12 },
    } as unknown as Source;
    const [f, c] = constants("test/a");
    await writeFits(store, "test", [f], [c]);
    await writeYears(store, "test", [{ id: "test/a", epoch: null, year: null }]);
    const report = await fitSource(store, settles, [station("a"), station("b")], {
      ...options,
      all: true,
    });
    assert.deepEqual(report.waiting, ["test/a"]);
    assert.deepEqual(
      report.none.map((n) => n.id),
      ["test/b"],
    );
    assert.equal((await readFits(store, "test")).get("test/a")!.version, "v");
    assert.deepEqual(
      (await readConstituents(store, "test")).map((r) => r.id),
      ["test/a"],
    );
  });

  it("writes nothing while a source's final year can't be told for stations being written", async () => {
    const [f, c] = constants("test/a");
    await writeFits(store, "test", [f], [c]);
    // One station being written is enough, even with a year every other station has final.
    await writeYears(store, "test", [
      { id: "test/a", epoch: null, year: null },
      row(2024, "b", "test/b"),
    ]);
    const lines: string[] = [];
    const report = await fitSource(store, finalizing, [station("a"), station("b")], {
      ...options,
      all: true,
      log: (line) => lines.push(line),
      fit: async () => assert.fail("no station is fitted while the final year can't be told"),
    });
    // The run waits and doesn't fail, so a write in progress doesn't fail the job that follows it.
    assert.deepEqual(report.waiting, ["test/a", "test/b"]);
    assert.deepEqual(report.failed, []);
    assert.match(lines[0]!, /1 stations' year files are being written/);
    assert.equal((await readFits(store, "test")).get("test/a")!.version, "v");
    assert.equal((await readConstituents(store, "test")).length, 1);
  });

  it("stops, writing nothing, where a source that finalizes has constants and no final year", async () => {
    const [f, c] = constants("test/a");
    await writeFits(store, "test", [f], [c]);
    // Every value preliminary, as a years file rebuilt wrong might say.
    await writeYears(store, "test", [{ ...row(2024, "b"), flags: [0, 0, 8760, 0, 0] }]);
    await assert.rejects(
      fitSource(store, finalizing, [station("a")], { ...options, all: true }),
      /have constants; check its years file/,
    );
    assert.equal((await readFits(store, "test")).get("test/a")!.version, "v");
    assert.equal((await readConstituents(store, "test")).length, 1);
  });

  it("keeps a station's constants where the years file lacks a file its fit read and the store holds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "stillwell-fit-short-"));
    // The fit read 2023 and 2024, and the store still holds both files.
    for (const year of [2023, 2024])
      await writeObservations(
        seriesPath(dir, "levels", "test", "a", year),
        [{ time: Date.UTC(year, 0, 1), level: 1, flag: Flag.good }],
        "NAVD88",
      );
    const [fa, ca] = constants("test/a");
    const read = {
      ...fa,
      inputs: JSON.stringify({
        ...emptyInputs(),
        digest: "d",
        versions: { "1 2023": "a", "1 2024": "b" },
      }),
    };
    const stub = async (s: StoredStation) => ({
      fit: { ...fit({ id: s.id, reason: "x", version: null }) } as Fit,
      constituents: [],
      references: [],
    });
    // A years file from a short listing: 2024's row is gone, with the file still there.
    await writeFits(dir, "test", [read], [ca]);
    await writeYears(dir, "test", [row(2023, "a")]);
    const short = await fitSource(dir, finalizing, [station("a")], { ...options, fit: stub });
    assert.match(
      short.failed[0]!,
      /test\/a: the years file lacks 1 year files .* 1 2024 among them; run `ingest years test`/,
    );
    assert.equal((await readFits(dir, "test")).get("test/a")!.version, "v");
    assert.equal((await readConstituents(dir, "test")).length, 1);
    // The file really gone, as after delete-years: the station is fitted again.
    rmSync(seriesPath(dir, "levels", "test", "a", 2024));
    const gone = await fitSource(dir, finalizing, [station("a")], { ...options, fit: stub });
    assert.deepEqual(gone.failed, []);
    assert.equal((await readFits(dir, "test")).get("test/a")!.reason, "x");
    rmSync(dir, { recursive: true, force: true });
  });

  it("takes stations' rows out of both files", async () => {
    const [fa, ca] = constants("test/a");
    const [fb, cb] = constants("test/b");
    await writeFits(store, "test", [fa, fb], [ca, cb]);
    assert.deepEqual(await dropFits(store, "test", (id) => id === "test/a"), ["test/a"]);
    assert.deepEqual([...(await readFits(store, "test")).keys()], ["test/b"]);
    assert.deepEqual(
      (await readConstituents(store, "test")).map((r) => r.id),
      ["test/b"],
    );
    assert.deepEqual(await dropFits(store, "test", (id) => id === "test/a"), []);
  });
});

describe("ingest fit", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-cli-"));
  after(() => rmSync(store, { recursive: true, force: true }));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["scripts/ingest.ts", "fit", ...args], {
      encoding: "utf8",
      env: { ...process.env, STILLWELL_STORE: store },
    });

  it("fits nothing at a source whose adapter reads no levels", () => {
    const bsh = run("bsh");
    assert.equal(bsh.status, 0);
    assert.match(bsh.stdout, /fit bsh: its adapter reads no levels/);
  });

  it("starts no fits with --only-fitted where the source's file holds no constants", async () => {
    // Rows that say why each station has none, as a source with no revision window gets.
    await writeFits(
      store,
      "smhi",
      [{ ...fit({ id: "smhi/1", reason: "x", version: null }) } as Fit],
      [],
    );
    const smhi = run("smhi", "--only-fitted", "--budget", "0");
    assert.equal(smhi.status, 0);
    assert.match(smhi.stdout, /no station has constants yet, and --only-fitted starts none/);
    rmSync(join(store, "fits"), { recursive: true, force: true });
    rmSync(join(store, "constituents"), { recursive: true, force: true });
  });

  it("starts no fits with --only-fitted at a source that has none", () => {
    const smhi = run("smhi", "--only-fitted", "--budget", "0");
    assert.equal(smhi.status, 0);
    assert.match(
      smhi.stdout,
      /fit smhi: no station has constants yet, and --only-fitted starts none/,
    );
  });

  it("refuses a budget that isn't minutes", () => {
    // By its own message: an empty store would refuse the run for want of a station list anyway.
    for (const budget of ["1.5", "9".repeat(309), "soon", "1e3"])
      assert.match(
        run("smhi", "--budget", budget).stderr,
        /--budget must be a whole number of minutes/,
      );
  });
});
