import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { issueBody, planIssues, quoted } from "../src/errata-issues.ts";

const [repo, run] = ["o/r", "https://run"];
const issue = (number: number, id: string, error: string) => ({
  number,
  body: issueBody({ id, source: "bodc", error }, repo, run),
});
const result = (id: string, error: string | null, unreadable = false) => ({
  id,
  source: "bodc",
  error,
  unreadable,
});

describe("planIssues", () => {
  const known = new Set(["a", "b", "c", "d", "e"]);

  it("opens, updates, closes and leaves issues as the checks say", () => {
    const actions = planIssues(
      [
        result("a", "new failure"),
        result("b", "same\nfailure"),
        result("c", "fails another way"),
        result("d", null),
      ],
      [
        issue(2, "b", "same failure"),
        issue(3, "c", "fails one way"),
        issue(4, "d", "x"),
        issue(5, "gone", "x"),
      ],
      known,
      repo,
      run,
    );
    assert.deepEqual(
      actions.map(({ kind, id }) => [kind, id]),
      [
        ["open", "a"],
        ["update", "c"],
        ["close", "d"],
        ["close", "gone"],
      ],
    );
  });

  it("leaves an issue for an erratum the run didn't check or couldn't read, and one without a marker", () => {
    assert.deepEqual(
      planIssues(
        [result("b", "couldn't read the store: 503", true), result("c", "x", true)],
        [issue(2, "a", "x"), issue(3, "b", "x"), { number: 4, body: "by hand" }],
        known,
        repo,
        run,
      ),
      [],
    );
  });

  it("closes the newer of two issues for one erratum", () => {
    assert.deepEqual(
      planIssues([result("a", "x")], [issue(7, "a", "x"), issue(6, "a", "x")], known, repo, run),
      [{ kind: "close", number: 7, id: "a", reason: "duplicate" }],
    );
  });

  it("reads a body edited on the web, and keeps what a maintainer added", () => {
    const edited = `${issue(2, "a", "x").body.replaceAll("\n", "\r\n")}\r\n\r\nLooked at this.`;
    assert.deepEqual(
      planIssues([result("a", "x")], [{ number: 2, body: edited }], known, repo, run),
      [],
    );
    const [update] = planIssues(
      [result("a", "y")],
      [{ number: 2, body: edited }],
      known,
      repo,
      run,
    );
    assert.equal(update?.kind, "update");
    assert.ok(update.kind === "update" && update.body.includes(quoted("y")));
    assert.ok(update.kind === "update" && update.body.endsWith("Looked at this."));
  });
});

describe("quoted", () => {
  it("puts a message on one capped line in a code block", () => {
    assert.equal(quoted("a\r\n b @someone #1"), "```text\na b @someone #1\n```");
    assert.equal(quoted("x".repeat(3000)).length, "```text\n".length + 2001 + "\n```".length);
  });
});
