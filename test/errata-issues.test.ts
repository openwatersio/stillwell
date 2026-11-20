import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { issueBody, planIssues } from "../src/errata-issues.ts";

const issue = (number: number, id: string, error: string) => ({
  number,
  body: issueBody({ id, source: "bodc", error }, "o/r", "https://run"),
});

describe("planIssues", () => {
  const known = new Set(["a", "b", "c", "d"]);

  it("opens, updates, closes and leaves issues as the checks say", () => {
    const actions = planIssues(
      [
        { id: "a", source: "bodc", error: "new failure" },
        { id: "b", source: "bodc", error: "same\nfailure" },
        { id: "c", source: "bodc", error: "fails another way" },
        { id: "d", source: "bodc", error: null },
      ],
      [
        issue(2, "b", "same failure"),
        issue(3, "c", "fails one way"),
        issue(4, "d", "x"),
        issue(5, "gone", "x"),
      ],
      known,
    );
    assert.deepEqual(actions, [
      { kind: "open", id: "a", source: "bodc", error: "new failure" },
      { kind: "update", number: 3, id: "c", source: "bodc", error: "fails another way" },
      { kind: "close", number: 4, id: "d", reason: "passes" },
      { kind: "close", number: 5, id: "gone", reason: "gone" },
    ]);
  });

  it("leaves an issue for an erratum the run didn't check, and one without a marker", () => {
    assert.deepEqual(
      planIssues([], [issue(2, "a", "x"), { number: 3, body: "by hand" }], known),
      [],
    );
  });
});
