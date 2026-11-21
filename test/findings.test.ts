import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reviewed } from "../src/cross-check-reviewed.ts";
import { errataReport, parseChecks } from "../src/errata-report.ts";
import {
  finding,
  isDay,
  isStation,
  KINDS,
  monthRuns,
  offsets,
  open,
  parseFindings,
  PAD_DAYS,
} from "../src/findings.ts";

const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const step = (d: string, size: number) => ({ day: day(d), size, seen: ["a", "b"], unseen: [] });
describe("offsets", () => {
  it("pairs a step with one back by about as much, widened by the pad", () => {
    assert.deepEqual(offsets([step("2012-10-10", -0.19), step("2012-11-20", 0.17)]), [
      {
        since: day("2012-10-10") - PAD_DAYS,
        until: day("2012-11-20") + PAD_DAYS,
        size: -0.19,
        steps: [day("2012-10-10"), day("2012-11-20")],
      },
    ]);
  });

  it("leaves a step no other undoes, one three quarters undone or less, and one too far on", () => {
    assert.deepEqual(offsets([step("2010-01-01", 0.3)]), []);
    assert.deepEqual(offsets([step("2010-01-01", 0.2), step("2010-03-01", -0.15)]), []);
    assert.deepEqual(offsets([step("2010-01-01", 0.3), step("2012-01-01", -0.3)]), []);
  });
});

describe("monthRuns", () => {
  it("joins consecutive months across a year's end", () => {
    assert.deepEqual(monthRuns(["2021-01", "2020-12", "2021-03"]), [
      { since: day("2020-12-01"), until: day("2021-02-01") },
      { since: day("2021-03-01"), until: day("2021-04-01") },
    ]);
  });
});

describe("findings", () => {
  const f = finding("offset", "pegelonline/1", day("2012-10-05"), day("2012-11-25"), "off");

  const r = {
    kind: "offset" as const,
    station: "pegelonline/1",
    since: "2012-10-10",
    until: "2012-11-20",
    reason: "surge",
  };

  it("are settled by a reviewed entry of the same kind and station whose span holds them, give or take the pad", () => {
    assert.deepEqual(open([f], [r]), []);
    assert.deepEqual(open([f], [{ ...r, kind: "clock" }]), [f]);
    assert.deepEqual(open([f], [{ ...r, station: "pegelonline/2" }]), [f]);
    assert.deepEqual(open([f], [{ ...r, since: "2013-01-01", until: "2013-02-01" }]), [f]);
  });

  it("are settled by an entry dated from the daily values, later than the step's median date", () => {
    const s = finding(
      "step",
      "pegelonline/1",
      day("2012-10-10") - PAD_DAYS,
      day("2012-10-10") + PAD_DAYS,
      "s",
    );
    assert.deepEqual(
      open([s], [{ ...r, kind: "step", since: "2012-10-24", until: "2013-01-01" }]),
      [],
    );
  });

  it("stay open where a reviewed entry covers only part of them", () => {
    const long = finding("offset", "pegelonline/1", day("2012-06-01"), day("2013-06-01"), "long");
    assert.deepEqual(open([long], [r]), [long]);
  });

  it("are settled, for a copied pair, only by an entry for the same pair", () => {
    const copied = finding("copied", "gesla/1", day("2012-10-10"), day("2012-11-20"), "c", {
      other: "pegelonline/1",
      otherRecords: ["gesla/p1", "pegelonline/1"],
    });
    const entry = { ...r, kind: "copied" as const, station: "pegelonline/1", other: "gesla/1" };
    assert.deepEqual(open([copied], [entry]), []);
    assert.deepEqual(open([copied], [{ ...entry, station: "gesla/p1" }]), []);
    assert.deepEqual(open([copied], [{ ...entry, other: "coops/2" }]), [copied]);
    assert.deepEqual(open([copied], [{ ...entry, other: undefined }]), [copied]);
  });

  it("are settled by an entry for any record of the station's gauge", () => {
    const g = finding("offset", "pegelonline/1", day("2012-10-05"), day("2012-11-25"), "g", {
      records: ["gesla/x", "pegelonline/1"],
    });
    assert.deepEqual(open([g], [{ ...r, station: "gesla/x" }]), []);
    assert.deepEqual(open([g], [{ ...r, station: "gesla/y" }]), [g]);
  });

  it("are settled, for a step, by an offset entry around it, not the other way round", () => {
    const s = finding("step", "pegelonline/1", day("2012-10-20"), day("2012-11-19"), "s");
    assert.deepEqual(open([s], [r]), []);
    assert.deepEqual(open([f], [{ ...r, kind: "step" }]), [f]);
  });

  it("refuse a station ID the report can't read", () => {
    assert.throws(() => finding("step", "gesla/a b", 0, 10, "x"));
  });

  it("refuse a file that isn't one", () => {
    const file = {
      region: "German Bight",
      from: 2021,
      to: 2027,
      run: "",
      at: "2026-12-02T00:00:00Z",
      findings: [f],
    };
    assert.deepEqual(parseFindings(file), file);
    const bad = (fields: object) => assert.throws(() => parseFindings({ ...file, ...fields }));
    bad({ region: null });
    bad({ region: "" });
    bad({ from: 2027, to: 2021 });
    bad({ run: undefined });
    bad({ run: "javascript:x" });
    bad({ at: "x" });
    bad({ findings: [{ ...f, other: "gesla/1" }] });
    bad({ findings: [{ ...f, kind: "copied" }] });
    bad({ findings: [{ ...f, records: ["a b"] }] });
    bad({ findings: [null] });
    bad({ findings: [{ ...f, kind: "drift" }] });
    bad({ findings: [{ ...f, since: "2012-02-30" }] });
    bad({ findings: [{ ...f, since: "2012-13-01" }] });
    bad({ findings: [{ ...f, until: f.since }] });
    bad({ findings: [{ ...f, station: "1" }] });
    bad({ findings: [{ ...f, station: "a/b|c" }] });
    bad({ findings: [{ ...f, detail: 3 }] });
    assert.ok(isStation("marine-institute/Galway"));
  });
});

describe("reviewed findings", () => {
  it("each name a kind, a station, a span and a reason", () => {
    for (const r of reviewed) {
      assert.ok(KINDS.includes(r.kind), JSON.stringify(r));
      assert.ok(isStation(r.station), JSON.stringify(r));
      assert.equal(
        r.kind === "copied",
        r.other !== undefined && isStation(r.other),
        JSON.stringify(r),
      );
      assert.ok(isDay(r.since) && isDay(r.until) && r.since < r.until, JSON.stringify(r));
      assert.ok(r.reason.length > 20, JSON.stringify(r));
    }
  });
});

describe("errataReport", () => {
  const settled = finding("offset", "pegelonline/1", day("2012-10-05"), day("2012-11-25"), "a");
  const left = finding("step", "pegelonline/2", day("2020-01-01"), day("2020-01-11"), "x | y");
  const checks = {
    only: [],
    problems: ["bad file"],
    results: [
      { id: "a", source: "s", error: null, unreadable: false },
      { id: "b", source: "s", error: "values\nchanged", unreadable: false },
      { id: "c", source: "s", error: "couldn't read the store", unreadable: true },
    ],
  };
  const run = "https://github.com/o/r/actions/runs/1";
  const report = errataReport(
    checks,
    [
      {
        region: "German Bight",
        from: 2021,
        to: 2027,
        run,
        at: "2026-12-02T03:00:00Z",
        findings: [settled, left],
      },
    ],
    [
      {
        kind: "offset",
        station: "pegelonline/1",
        since: "2012-10-01",
        until: "2012-12-01",
        reason: "x",
      },
    ],
  );

  it("lists the problems, failing checks, unreadable checks and open findings, with their run", () => {
    assert.match(report, /3 errata checked: 1 passed, 1 failed, 1 couldn't read the store\./);
    assert.match(report, /- bad file/);
    assert.match(report, /\| b \| s \| values changed \|/);
    assert.match(report, /- c: couldn't read the store/);
    assert.ok(
      report.includes(
        `Years 2021 to 2026, from [the run of 2026-12-02](${run}): 2 found, 1 settled, 1 left.`,
      ),
    );
    assert.match(
      report,
      /\| step \| pegelonline\/2 \|  \| 2020-01-01 \| 2020-01-11 \| x \\\| y \|/,
    );
    assert.doesNotMatch(report, /pegelonline\/1 \|/);
    assert.doesNotMatch(report, /Only these/);
  });

  it("says when it read no findings, or checked only some errata", () => {
    const some = errataReport({ ...checks, only: ["coops"] }, [], []);
    assert.match(some, /No cross-check findings were read\./);
    assert.match(some, /Only these sources or errata were checked: coops\./);
  });

  it("refuses a check report whose results lack a field", () => {
    assert.deepEqual(parseChecks(checks), checks);
    assert.throws(() => parseChecks({ ...checks, only: undefined }));
    assert.throws(() => parseChecks({ ...checks, results: [] }));
    assert.throws(() =>
      parseChecks({ ...checks, results: [{ id: "a", source: "s", error: null }] }),
    );
  });
});
