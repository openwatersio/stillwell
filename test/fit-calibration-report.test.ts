import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { candidatesDigest } from "../src/fit/calibration.ts";
import { NODE_CORRECTIONS } from "../src/fit/scores.ts";
import { METHOD } from "../src/fit/series.ts";

describe("the fit calibration", () => {
  // The report is the fits' independent reference, so it has to be of the method as it is. The
  // engine's version isn't compared: its report names the one it ran with, and a release of the
  // engine shouldn't wait on a copy of the store.
  it("was run with the method, candidates and nodal corrections the fits use", () => {
    const report = JSON.parse(readFileSync("docs/results/fit-calibration.json", "utf8")) as {
      method: number;
      candidates: string;
      node_corrections: string;
    };
    const rerun =
      "run `npm run calibrate:fits` against a copy of the store (docs/contributing/checks.md#fit-calibration)";
    assert.equal(report.method, METHOD, rerun);
    assert.equal(report.candidates, candidatesDigest(), rerun);
    assert.equal(report.node_corrections, NODE_CORRECTIONS, rerun);
  });
});
