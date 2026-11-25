/**
 * The errata report: what needs looking at in the errata after a Monthly run,
 * in one Markdown page. It lists the problems in the errata files, each
 * erratum whose check fails against the store, each check that couldn't read
 * the store, and each cross-check finding (src/findings.ts) nothing settles,
 * with the run each region's findings came from. scripts/errata-report.ts
 * writes it; docs/contributing/errata-runbook.md works it.
 */
import { open, type FindingsFile, type Reviewed } from "./findings.ts";

/** One erratum's check, as `errata-check --report` writes it; `error` is null where it passed. */
export interface CheckResult {
  id: string;
  source: string;
  error: string | null;
  /** The check failed reading the store, so it says nothing about the erratum. */
  unreadable: boolean;
}

/** `errata-check --report`: `only` the sources or IDs it was asked for, empty for every erratum. */
export interface Checks {
  only: string[];
  problems: string[];
  results: CheckResult[];
}

const LIMIT = 500;

/** Text for a table cell or list item: one line, capped, with Markdown escaped. */
export function cell(text: string): string {
  const line = text.replace(/\s*[\r\n]+\s*/g, " ");
  // Capped before escaping, so the cut never splits an escape.
  return (line.length > LIMIT ? `${line.slice(0, LIMIT)}…` : line).replace(/[\\|`<>[\]]/g, "\\$&");
}

const isResult = (r: Partial<CheckResult> | null) =>
  !!r &&
  typeof r.id === "string" &&
  typeof r.source === "string" &&
  (r.error === null || typeof r.error === "string") &&
  typeof r.unreadable === "boolean";
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** An `errata-check --report` file, checked, since a missing field would read as a pass. */
export function parseChecks(data: unknown): Checks {
  const d = data as Partial<Checks> | null;
  if (
    !d ||
    !strings(d.only) ||
    !strings(d.problems) ||
    !Array.isArray(d.results) ||
    !d.results.length ||
    !d.results.every(isResult)
  )
    throw new Error("not an errata-check report with results");
  return d as Checks;
}

export function errataReport(
  checks: Checks,
  findings: FindingsFile[],
  reviewed: Reviewed[],
): string {
  const out: string[] = ["# Errata report", ""];
  const failing = checks.results.filter((r) => r.error !== null && !r.unreadable);
  const unreadable = checks.results.filter((r) => r.unreadable);
  const passed = checks.results.length - failing.length - unreadable.length;
  if (checks.only.length)
    out.push(`Only these sources or errata were checked: ${cell(checks.only.join(", "))}.`, "");
  out.push(
    `${checks.results.length} errata checked: ${passed} passed, ${failing.length} failed, ${unreadable.length} couldn't read the store.`,
    "",
  );
  if (checks.problems.length)
    out.push(
      "## Problems in the errata files",
      "",
      "A file whose errata break the rules loses all its errata, which weren't checked; one whose questions do loses only its questions; an ID used twice or retired loses that entry.",
      "",
      ...checks.problems.map((p) => `- ${cell(p)}`),
      "",
    );
  if (failing.length)
    out.push(
      "## Failing checks",
      "",
      "| Erratum | Source | Check says |",
      "| --- | --- | --- |",
      ...failing.map((r) => `| ${cell(r.id)} | ${cell(r.source)} | ${cell(r.error!)} |`),
      "",
    );
  if (unreadable.length)
    out.push(
      "## Checks that couldn't read the store",
      "",
      ...unreadable.map((r) => `- ${cell(r.id)}: ${cell(r.error ?? "")}`),
      "",
    );
  out.push("## Cross-check findings nothing settles", "");
  if (!findings.length) out.push("No cross-check findings were read.", "");
  for (const f of [...findings].sort((a, b) => a.region.localeCompare(b.region))) {
    const left = open(f.findings, reviewed).sort(
      (a, b) => a.station.localeCompare(b.station) || a.since.localeCompare(b.since),
    );
    const from = f.run
      ? `[the run of ${f.at.slice(0, 10)}](${f.run})`
      : `a run by hand on ${f.at.slice(0, 10)}`;
    out.push(
      `### ${cell(f.region)}`,
      "",
      `Years ${f.from} to ${f.to - 1}, from ${from}: ${f.findings.length} found, ${f.findings.length - left.length} settled, ${left.length} left.`,
      "",
    );
    if (left.length)
      out.push(
        "| Kind | Station | Other | Since | Until | Detail |",
        "| --- | --- | --- | --- | --- | --- |",
        ...left.map(
          (x) =>
            `| ${x.kind} | ${cell(x.station)} | ${cell(x.other ?? "")} | ${x.since} | ${x.until} | ${cell(x.detail)} |`,
        ),
        "",
      );
  }
  return out.join("\n");
}
