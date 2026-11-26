import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { constituents } from "@slackwater/engine";
import { CANDIDATES } from "../src/fit/candidates.ts";
import { Flag, type StoredStation } from "../src/schema.ts";
import { readYearStats, writeObservations } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";
import type { YearRow } from "../src/store/years.ts";
import {
  candidateOf,
  difference,
  fittedFor,
  median,
  analysisYears,
  checkCopy,
  MISNAMED,
  noaaConstants,
  phaseDifference,
  vectorAverage,
} from "../src/fit/calibration.ts";

const ROUNDING = { amplitude: 0.0005, phase: 0.05 };
const near = (a: number, b: number, tolerance = 1e-9) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} is not ${b}`);

describe("candidateOf", () => {
  it("finds a candidate by its own name or a listed spelling, and by nothing else", () => {
    assert.equal(candidateOf("M2")?.name, "M2");
    assert.equal(candidateOf("LAM2")?.name, "lambda2");
    assert.equal(candidateOf("RHO")?.name, "rho1");
    assert.equal(candidateOf("SSA")?.name, "Ssa");
    assert.equal(candidateOf("m2"), undefined);
    assert.equal(candidateOf("CHI1")?.name, "chi1");
    // NOAA's SIGMA1 and 4MSL12 aren't the lines the catalog gives those names.
    assert.equal(candidateOf("SIGMA1"), undefined);
    assert.equal(candidateOf("4MSL12"), undefined);
  });

  it("gives no candidate a spelling the catalog reads as another constituent", () => {
    for (const c of CANDIDATES)
      for (const spelling of c.spellings ?? []) {
        const entry = constituents[spelling];
        if (entry) assert.equal(entry.name, c.name, `${spelling} of ${c.name}`);
        assert.ok(!MISNAMED.includes(spelling), `${spelling} is misnamed in the catalog`);
      }
  });

  it("has 37 candidates from NOAA's standard list", () => {
    assert.equal(CANDIDATES.filter((c) => c.from.includes("noaa")).length, 37);
  });
});

describe("fittedFor", () => {
  const fitted = [
    { name: "M2", amplitude: 1, phase: 10 },
    { name: "NO1", amplitude: 0.01, phase: 20 },
  ];
  const verdicts = [
    { name: "M2", kept: true, reason: null, conflict: null },
    { name: "NO1", kept: true, reason: null, conflict: null },
    { name: "M1", kept: false, reason: "rayleigh", conflict: "NO1" },
    { name: "S2", kept: false, reason: "rayleigh", conflict: "M2" },
    { name: "M4", kept: false, reason: "snr", conflict: null },
  ];

  it("gives the constituent under the agency's name", () => {
    assert.deepEqual(fittedFor("M2", fitted, verdicts), { fitted: fitted[0], sameLine: null });
  });

  it("gives the same line under the name selection kept it by", () => {
    assert.deepEqual(fittedFor("M1", fitted, verdicts), { fitted: fitted[1], sameLine: "NO1" });
  });

  it("gives no constituent for one dropped for another line, and says why", () => {
    assert.deepEqual(fittedFor("S2", fitted, verdicts), { reason: "rayleigh (M2)" });
    assert.deepEqual(fittedFor("M4", fitted, verdicts), { reason: "snr" });
    assert.deepEqual(fittedFor("SIGMA1", fitted, verdicts), { reason: "not a candidate" });
  });
});

describe("difference", () => {
  it("is the fit's minus the agency's, with the phase wrapped", () => {
    const d = difference(
      { name: "M2", amplitude: 1.01, phase: 1, amplitudeInterval: 0.02, phaseInterval: 4 },
      { name: "M2", amplitude: 1, phase: 359 },
      ROUNDING,
    );
    near(d.amplitude, 0.01);
    near(d.relative!, 0.01);
    near(d.phase!, 2);
    near(d.vector, Math.hypot(1.01 * Math.cos(Math.PI / 90) - 1, 1.01 * Math.sin(Math.PI / 90)));
    near(d.ratio!, 2 / Math.hypot(4, 0.05));
  });

  it("is outside where either difference passes its interval", () => {
    const ours = {
      name: "K1",
      amplitude: 0.1,
      phase: 50,
      amplitudeInterval: 0.001,
      phaseInterval: 1,
    };
    assert.ok(difference(ours, { name: "K1", amplitude: 0.1, phase: 52 }, ROUNDING).ratio! > 1);
    assert.ok(difference(ours, { name: "K1", amplitude: 0.103, phase: 50 }, ROUNDING).ratio! > 1);
    assert.ok(
      difference(ours, { name: "K1", amplitude: 0.1005, phase: 50.5 }, ROUNDING).ratio! < 1,
    );
  });

  it("widens the interval by the agency's rounding", () => {
    const d = difference(
      { name: "M8", amplitude: 0.0004, phase: 10, amplitudeInterval: 0.0001, phaseInterval: 5 },
      { name: "M8", amplitude: 0, phase: 0 },
      ROUNDING,
    );
    assert.equal(d.phase, null);
    assert.equal(d.relative, null);
    near(d.vector, 0.0004);
    near(d.ratio!, 0.0004 / Math.hypot(0.0001, 0.0005));
  });

  it("has no ratio without the fit's intervals", () => {
    const d = difference(
      { name: "M2", amplitude: 1, phase: 0 },
      { name: "M2", amplitude: 1, phase: 0 },
      ROUNDING,
    );
    assert.equal(d.ratio, null);
  });
});

describe("phaseDifference", () => {
  it("wraps to ±180", () => {
    assert.equal(phaseDifference(350, 10), -20);
    assert.equal(phaseDifference(10, 350), 20);
    assert.equal(phaseDifference(180, 0), -180);
  });
});

describe("vectorAverage", () => {
  it("averages constants as vectors", () => {
    const average = vectorAverage([
      { amplitude: 1, phase: 350 },
      { amplitude: 1, phase: 10 },
    ])!;
    near(average.amplitude, Math.cos(Math.PI / 18));
    near(Math.min(average.phase, 360 - average.phase), 0, 1e-9);
    assert.equal(vectorAverage([]), null);
  });
});

describe("median", () => {
  it("is the middle value, or the mean of the middle two", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([]), null);
  });
});

describe("noaaConstants", () => {
  // prettier-ignore
  const NAMES = ["M2","S2","N2","K1","M4","O1","M6","MK3","S4","MN4","NU2","S6","MU2","2N2","OO1","LAM2","S1","M1","J1","MM","SSA","SA","MSF","MF","RHO","Q1","T2","R2","2Q1","P1","2SM2","M3","L2","2MK3","K2","M8","MS4"];
  const answer = (
    names = NAMES,
    comments: (i: number) => string = () => "5 years, 2014-2018.",
  ) => ({
    units: "meters",
    HarmonicConstituents: names.map((name, i) => ({
      name,
      amplitude: 0.001 * i,
      phase_GMT: i,
      comments: comments(i),
    })),
  });

  it("reads NOAA's 37 as amplitudes in meters and Greenwich lags, with the comment", () => {
    const { comment, constants } = noaaConstants("coops/1", answer());
    assert.equal(comment, "5 years, 2014-2018.");
    assert.equal(constants.length, 37);
    assert.deepEqual(constants[1], { name: "S2", amplitude: 0.001, phase: 1 });
  });

  it("refuses an answer that isn't a whole set in meters", () => {
    assert.throws(() => noaaConstants("coops/1", { ...answer(), units: "feet" }), /meters/);
    assert.throws(() => noaaConstants("coops/1", { units: "meters" }), /meters/);
    assert.throws(() => noaaConstants("coops/1", answer(NAMES.slice(1))), /lack M2/);
    assert.throws(() => noaaConstants("coops/1", answer([...NAMES, "M2"])), /twice/);
    assert.throws(() => noaaConstants("coops/1", answer([...NAMES, "RHO1"])), /twice/);
    assert.throws(
      () =>
        noaaConstants(
          "coops/1",
          answer(NAMES, (i) => (i ? "a" : "b")),
        ),
      /different comments/,
    );
    const broken = answer();
    broken.HarmonicConstituents[3]!.amplitude = NaN;
    assert.throws(() => noaaConstants("coops/1", broken), /isn't a number/);
    const negative = answer();
    negative.HarmonicConstituents[3]!.amplitude = -1;
    assert.throws(() => noaaConstants("coops/1", negative), /under zero/);
    const turned = answer();
    turned.HarmonicConstituents[3]!.phase_GMT = 999;
    assert.throws(() => noaaConstants("coops/1", turned), /outside 0 to 360/);
    // NOAA publishes a phase of 360.0.
    const full = answer();
    full.HarmonicConstituents[3]!.phase_GMT = 360;
    assert.equal(noaaConstants("coops/1", full).constants[3]!.phase, 360);
  });
});

describe("analysisYears", () => {
  it("reads the years of the comment's first sentence", () => {
    assert.deepEqual(
      analysisYears(
        "Vector Average of 5 years, 2014-2018.  Sa, Mm, and Mf from 17 years (1998-2018).",
      ),
      [2014, 2015, 2016, 2017, 2018],
    );
    assert.deepEqual(
      analysisYears(
        "Vector Averaged of 5 years (2016-2019, 2022).  MM, MF from 18 year average (2000-2022)",
      ),
      [2016, 2017, 2018, 2019, 2022],
    );
    assert.deepEqual(
      analysisYears(
        "5-year (2012-2016) Vector Averaged.  Mm, Msf, Mf from average of 20 years (1996-2016).",
      ),
      [2012, 2013, 2014, 2015, 2016],
    );
    assert.deepEqual(
      analysisYears("Vector Averaged (5-years).  Sa and SSa from 20-year analysis"),
      [],
    );
  });
});

describe("checkCopy", () => {
  const station = {
    id: "test/1",
    source: "test",
    source_id: "1",
    epochs: [{ id: 1 }, { id: 2 }],
  } as unknown as StoredStation;

  async function copy() {
    const root = mkdtempSync(join(tmpdir(), "stillwell-calibration-"));
    const years = new Map<string, YearRow>();
    for (const [epoch, year] of [
      [1, 2020],
      [2, 2021],
    ] as const) {
      const file = seriesPath(root, "levels", "test", "1", year, epoch);
      const rows = [0, 1, 2].map((h) => ({
        time: Date.UTC(year, 0, 1, h),
        level: h * 0.1,
        flag: Flag.good,
        source_flag: Flag.good,
      }));
      await writeObservations(file, rows, "NAVD88");
      const stats = (await readYearStats([file])).get(file)!;
      years.set(`test/1 ${epoch} ${year}`, { id: "test/1", epoch, year, ...stats });
    }
    return { root, years };
  }

  it("passes a copy whose years file describes each file, in every epoch", async () => {
    const { root, years } = await copy();
    await checkCopy(root, station, years);
    // A row for a year the copy doesn't hold is the reader's to refuse.
    years.set("test/1 1 2019", { ...years.get("test/1 1 2020")!, year: 2019 });
    await checkCopy(root, station, years);
  });

  it("refuses a file with no row, and one whose row has another version", async () => {
    const { root, years } = await copy();
    const row = years.get("test/1 2 2021")!;
    years.delete("test/1 2 2021");
    await assert.rejects(checkCopy(root, station, years), /doesn't describe its files for 2021/);
    years.set("test/1 2 2021", { ...row, version: "another" });
    await assert.rejects(checkCopy(root, station, years), /2021/);
  });
});
