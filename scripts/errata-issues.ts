/**
 * Brings the repo's `errata-check` issues in line with an `errata-check`
 * report (src/errata-issues.ts): opens one for each failing erratum, updates
 * one whose check fails another way, and closes one whose check passes or
 * whose erratum is gone. Refuses a report with problems, since a file left
 * out whole would read as its errata gone. A check that couldn't read the
 * store leaves its issue as it is, and fails the run, as does any `gh` call
 * that fails, after the rest are made.
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
  planIssues,
  quoted,
  type CheckResult,
  type OpenIssue,
} from "../src/errata-issues.ts";
import { errata } from "../src/sources/index.ts";

const LABEL = "errata-check";
const file = process.argv[2];
if (!file) throw new Error("usage: node scripts/errata-issues.ts <report.json>");
const report = JSON.parse(readFileSync(file, "utf8")) as {
  problems?: unknown;
  results?: unknown;
};
if (!Array.isArray(report.problems) || !Array.isArray(report.results) || !report.results.length)
  throw new Error(`${file} isn't an errata-check report with results`);
if (report.problems.length)
  throw new Error(
    `the errata files have problems, so no issue is changed:\n${report.problems.join("\n")}`,
  );
const results = report.results as CheckResult[];
for (const r of results)
  if (
    typeof r?.id !== "string" ||
    typeof r.source !== "string" ||
    !(r.error === null || typeof r.error === "string") ||
    typeof r.unreadable !== "boolean"
  )
    throw new Error(`${file} holds a result that isn't one: ${JSON.stringify(r)}`);

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

let failed = 0;
const plan = planIssues(results, issues, new Set(errata.map((e) => e.id)), repo, run);
for (const action of plan) {
  console.log(`${action.kind} ${action.id}${"number" in action ? ` (#${action.number})` : ""}`);
  try {
    if (action.kind === "open")
      gh(
        ["issue", "create", "--title", issueTitle(action.id), "--label", LABEL, "--body-file", "-"],
        issueBody(action, repo, run),
      );
    else if (action.kind === "update") {
      gh(["issue", "edit", String(action.number), "--body-file", "-"], action.body);
      gh(
        ["issue", "comment", String(action.number), "--body-file", "-"],
        `The check now fails with:\n\n${quoted(action.error)}\n\nFound in [this run](${run}).`,
      );
    } else
      gh([
        "issue",
        "close",
        String(action.number),
        "--comment",
        action.reason === "passes"
          ? `The check passes in [this run](${run}).`
          : action.reason === "gone"
            ? `Erratum \`${action.id}\` no longer exists, as of [this run](${run}).`
            : `Another open issue tracks erratum \`${action.id}\`, as of [this run](${run}).`,
      ]);
  } catch (error) {
    failed++;
    console.error(`${action.kind} ${action.id} failed: ${(error as Error).message}`);
  }
}
const unreadable = results.filter((r) => r.unreadable);
for (const r of unreadable) console.error(`${r.id} couldn't read the store: ${r.error}`);
if (unreadable.length)
  console.error(
    `${unreadable.length} checks couldn't read the store, so their issues are unchanged`,
  );
if (failed || unreadable.length) process.exitCode = 1;
