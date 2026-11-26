import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { engineVersion } from "../src/fit/fit.ts";
import {
  estimateFilter,
  FILTER,
  GAUGES,
  kartverketDigest,
  render,
  type Report,
} from "../src/fit/kartverket-report.ts";
import { METHOD } from "../src/fit/series.ts";

const read = () =>
  JSON.parse(readFileSync("docs/results/kartverket-calibration.json", "utf8")) as Report;
const rerun =
  "run `npm run calibrate:kartverket` against a copy of the store (docs/contributing/checks.md#kartverket)";

describe("the Kartverket calibration", () => {
  it("was run with the method and the filter the code has", () => {
    const report = read();
    assert.equal(report.method, METHOD, rerun);
    assert.deepEqual(report.filter, FILTER, rerun);
    assert.equal(report.inputs, kartverketDigest(), rerun);
    assert.deepEqual(
      report.results.map((r) => r.id),
      GAUGES.map((code) => `kartverket/${code}`),
      rerun,
    );
    assert.match(report.engine, /^@slackwater\/engine@/);
    assert.ok(engineVersion());
  });

  it("has the Markdown its JSON renders to", () => {
    assert.equal(
      readFileSync("docs/results/kartverket-calibration.md", "utf8"),
      render(read()),
      "run `npm run calibrate:kartverket -- --report`",
    );
  });

  it("uses the filter its own constants estimate", () => {
    const { best } = estimateFilter(read().results);
    assert.deepEqual({ order: best.order, cutoff_hours: best.cutoff_hours }, FILTER);
  });
});

describe("estimateFilter", () => {
  it("finds another cutoff where the fitted amplitudes are scaled by another filter", () => {
    const report = read();
    // As if Kartverket's filter had cut off at 3.3 hours: its constants are what the fit's would be through that.
    for (const result of report.results)
      for (const row of result.rows)
        if (!("reason" in row.ours))
          row.kartverket.amplitude = row.ours.amplitude / (1 + ((row.speed / 360) * 3.3) ** 8);
    const { best, none } = estimateFilter(report.results);
    assert.deepEqual(
      { order: best.order, cutoff_hours: best.cutoff_hours },
      { order: 4, cutoff_hours: 3.3 },
    );
    assert.ok(best.misfit < 1e-6 && none > best.misfit);
  });
});

describe("render", () => {
  it("says none is outside where none is, and lists them where some are", () => {
    const report = read();
    assert.match(render(report), /\*\*Outside\.\*\* \d+ constants at /);
    for (const result of report.results) {
      result.probe = null;
      for (const row of result.rows) if (!("reason" in row.ours)) row.ours.d.ratio = 0.5;
    }
    const none = render(report);
    assert.match(none, /\*\*Outside\.\*\* None\./);
    assert.match(none, /No constituent is outside the fit's interval\./);
  });
});
