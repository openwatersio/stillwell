import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  candidateOf,
  difference,
  fittedFor,
  median,
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
    assert.equal(candidateOf("SIGMA1"), undefined);
  });

  it("has every one of NOAA's 37 names", () => {
    // prettier-ignore
    const NOAA = ["M2","S2","N2","K1","M4","O1","M6","MK3","S4","MN4","NU2","S6","MU2","2N2","OO1","LAM2","S1","M1","J1","MM","SSA","SA","MSF","MF","RHO","Q1","T2","R2","2Q1","P1","2SM2","M3","L2","2MK3","K2","M8","MS4"];
    assert.deepEqual(
      NOAA.filter((name) => !candidateOf(name)),
      [],
    );
    assert.equal(new Set(NOAA.map((name) => candidateOf(name)!.name)).size, 37);
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
