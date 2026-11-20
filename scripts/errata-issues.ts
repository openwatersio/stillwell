/**
 * Brings the repo's `errata-check` issues in line with an `errata-check`
 * report (src/errata-issues.ts): opens one for each failing erratum, updates
 * one whose check fails another way, and closes one whose check passes or
 * whose erratum is gone. Refuses a report with problems, since a file left
 * out whole would read as its errata gone.
 *
 *   node scripts/errata-issues.ts report.json
 *
 * Run from the Errata check workflow, with GH_TOKEN allowed to write issues.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import {
  issueBody,
  issueTitle,
  oneLine,
  planIssues,
  type CheckResult,
  type OpenIssue,
} from "../src/errata-issues.ts";
import { errata } from "../src/sources/index.ts";

const LABEL = "errata-check";
const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/errata-issues.ts <report.json>");
const report = JSON.parse(readFileSync(file, "utf8")) as {
  problems: string[];
  results: CheckResult[];
};
if (report.problems.length)
  throw new Error(
    `the errata files have problems, so no issue is changed:\n${report.problems.join("\n")}`,
  );

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) throw new Error("set GITHUB_REPOSITORY");
const run = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
const gh = (args: string[], input?: string) =>
  execFileSync("gh", [...args, "--repo", repo], { encoding: "utf8", input });

gh([
  "label",
  "create",
  LABEL,
  "--force",
  "--color",
  "d93f0b",
  "--description",
  "An erratum's check fails against the store",
]);
const issues = JSON.parse(
  gh([
    "issue",
    "list",
    "--label",
    LABEL,
    "--state",
    "open",
    "--limit",
    "1000",
    "--json",
    "number,body",
  ]),
) as OpenIssue[];

for (const action of planIssues(report.results, issues, new Set(errata.map((e) => e.id)))) {
  console.log(`${action.kind} ${action.id}${"number" in action ? ` (#${action.number})` : ""}`);
  if (action.kind === "open")
    gh(
      ["issue", "create", "--title", issueTitle(action.id), "--label", LABEL, "--body-file", "-"],
      issueBody(action, repo, run),
    );
  else if (action.kind === "update") {
    gh(["issue", "edit", String(action.number), "--body-file", "-"], issueBody(action, repo, run));
    gh(
      ["issue", "comment", String(action.number), "--body-file", "-"],
      `The check now fails with:\n\n> ${oneLine(action.error)}\n\nFound in [this run](${run}).`,
    );
  } else
    gh([
      "issue",
      "close",
      String(action.number),
      "--comment",
      action.reason === "passes"
        ? `The check passes in [this run](${run}).`
        : `Erratum \`${action.id}\` no longer exists, as of [this run](${run}).`,
    ]);
}
