import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { candidatesDigest } from "../src/fit/calibration.ts";
import { render, type Report } from "../src/fit/calibration-report.ts";
import { NODE_CORRECTIONS } from "../src/fit/scores.ts";
import { METHOD } from "../src/fit/series.ts";

const read = () => JSON.parse(readFileSync("docs/results/fit-calibration.json", "utf8")) as Report;
const section = (markdown: string, heading: string) =>
  markdown.slice(markdown.indexOf(heading)).split(/\n##+ /)[0] ?? "";

describe("the fit calibration", () => {
  // The report is the fits' independent reference, so it has to be of the method as it is. The
  // engine's version isn't compared: the report names the one it ran with, and a release of the
  // engine shouldn't wait on a copy of the store.
  it("was run with the method, candidates and nodal corrections the fits use", () => {
    const report = read();
    const rerun =
      "run `npm run calibrate:fits` against a copy of the store (docs/contributing/checks.md#fit-calibration)";
    assert.equal(report.method, METHOD, rerun);
    assert.equal(report.candidates, candidatesDigest(), rerun);
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
      /the candidate list predicts worse than NOAA's constituents at/,
    );
    for (const result of report.results) result.scores.window.rms = result.scores.steps.robust.rms;
    const defects = section(render(report), "### Defects");
    assert.doesNotMatch(defects, /the candidate list predicts worse than NOAA's constituents at/);
    assert.match(
      defects,
      /the candidate list predicts no worse than NOAA's constituents at any station/,
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
  });

  it("refuses a report in which every station's NOAA years include the held-out year", () => {
    const report = read();
    for (const result of report.results) result.scores.window.seen = true;
    assert.throws(() => render(report), /out of sample/);
  });
});
