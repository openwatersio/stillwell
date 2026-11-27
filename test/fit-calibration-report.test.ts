import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { calibrationDigest } from "../src/fit/calibration.ts";
import { LARGE_MISS, render, type Report } from "../src/fit/calibration-report.ts";
import { NODE_CORRECTIONS } from "../src/fit/scores.ts";
import { METHOD } from "../src/fit/series.ts";

const read = () => JSON.parse(readFileSync("docs/results/fit-calibration.json", "utf8")) as Report;
const section = (markdown: string, heading: string) =>
  markdown.slice(markdown.indexOf(heading)).split(/\n##+ /)[0] ?? "";

describe("the fit calibration", () => {
  // The report is the fits' independent reference, so it has to be of the method as it is. The
  // engine's version isn't compared: the report names the one it ran with, and a release of the
  // engine shouldn't wait on a copy of the store.
  it("was run with the method, lists and nodal corrections the code has", () => {
    const report = read();
    const rerun =
      "run `npm run calibrate:fits` against a copy of the store (docs/contributing/checks.md#fit-calibration)";
    assert.equal(report.method, METHOD, rerun);
    assert.equal(report.inputs, calibrationDigest(), rerun);
    assert.equal(report.node_corrections, NODE_CORRECTIONS, rerun);
  });

  it("has the Markdown its JSON renders to", () => {
    assert.equal(
      readFileSync("docs/results/fit-calibration.md", "utf8"),
      render(read()),
      "run `npm run calibrate:fits -- --report`",
    );
  });
});

describe("render", () => {
  it("says NOAA's method gives NOAA's constants only where it does", () => {
    const agrees = render(read());
    assert.match(agrees, /\*\*NOAA's method on the store's values gives NOAA's constants\.\*\*/);
    assert.match(section(agrees, "### Defects"), /None shown in the engine's solver/);

    // Every constant of NOAA's method moved a centimeter from NOAA's.
    const report = read();
    for (const result of report.results)
      for (const row of result.rows) if (row.steps.yearly) row.steps.yearly.vector += 0.01;
    const misses = render(report);
    assert.match(misses, /\*\*NOAA's method on the store's values\.\*\*/);
    assert.doesNotMatch(misses, /gives NOAA's constants\.\*\*/);
    assert.match(section(misses, "### Defects"), /NOAA's method doesn't give NOAA's constants/);
    assert.doesNotMatch(section(misses, "### Defects"), /None shown/);
  });

  it("lists the candidate list as a defect only at stations where it predicts worse", () => {
    const report = read();
    assert.match(
      section(render(report), "### Defects"),
      /the candidate list and its selection predict worse than NOAA's constituents at/,
    );
    for (const result of report.results) result.scores.window.rms = result.scores.steps.robust.rms;
    const defects = section(render(report), "### Defects");
    assert.doesNotMatch(
      defects,
      /the candidate list and its selection predict worse than NOAA's constituents at/,
    );
    assert.match(
      defects,
      /the candidate list and its selection predict no worse than NOAA's constituents at any station/,
    );
  });

  it("names a line held under another name only where a fit holds one", () => {
    const report = read();
    assert.match(render(report), /\*\*M1 is held as NO1\.\*\*/);
    for (const result of report.results) {
      result.renamed = null;
      for (const row of result.rows) if (!("reason" in row.window)) row.window.as = null;
    }
    const renamed = render(report);
    assert.doesNotMatch(renamed, /is held as/);
    assert.doesNotMatch(renamed, /Lines held under another name/);
  });

  it("refuses a report with a set of constants that has no score", () => {
    const report = read();
    report.results[0]!.scores.noaa.rms = null;
    assert.throws(() => render(report), /no score/);
    // A refit under NOAA's names with no score would otherwise count as an improvement.
    const renamed = read();
    renamed.results.find((r) => r.renamed)!.renamed!.score.rms = null;
    assert.throws(() => render(renamed), /no score/);
  });

  it("names a constant NOAA's method misses by more than LARGE_MISS as open", () => {
    const report = read();
    const defects = () => section(render(report), "### Defects");
    for (const result of report.results)
      for (const row of result.rows)
        if (row.steps.yearly) row.steps.yearly.vector = Math.min(row.steps.yearly.vector, 0.0001);
    assert.match(defects(), /gives NOAA's constants, as above\. Each step/);
    const row = report.results[0]!.rows.find((x) => x.name === "M2")!;
    row.steps.yearly!.vector = LARGE_MISS + 0.001;
    assert.match(
      defects(),
      new RegExp(`as above, except for M2 at ${report.results[0]!.name}, which is open`),
    );
  });

  it("gives the largest difference in held-out RMS as a bound", () => {
    const report = read();
    for (const result of report.results) result.scores.steps.yearly.rms = result.scores.noaa.rms;
    report.results[0]!.scores.steps.yearly.rms = report.results[0]!.scores.noaa.rms! + 0.000143;
    assert.match(render(report), /score within 0\.2 mm RMS of NOAA's own/);
  });

  it("says a step accounts for a constituent's differences only where it is the largest for most", () => {
    const report = read();
    assert.match(render(report), /is the largest step for \d+ of L2's \d+ outside\. L2 shares/);
    // The step to one fit of all years moves no L2.
    for (const result of report.results)
      for (const row of result.rows)
        if (row.name === "L2" && row.steps.joint && row.steps.exact)
          row.steps.joint = { ...row.steps.exact };
    const markdown = render(report);
    assert.match(markdown, /half or fewer, so it doesn't account for L2's/);
    assert.doesNotMatch(markdown, /L2 shares its frequency/);
  });

  it("refuses a report in which every station's NOAA years include the held-out year", () => {
    const report = read();
    for (const result of report.results) result.scores.window.seen = true;
    assert.throws(() => render(report), /out of sample/);
  });
});
