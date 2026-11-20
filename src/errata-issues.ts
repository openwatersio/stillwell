/**
 * What `errata-check`'s report asks of the repo's issues: one open issue for
 * each erratum whose check fails, found by the marker in its body, brought up
 * to date when the check fails another way, and closed when it passes or the
 * erratum is gone. scripts/errata-issues.ts carries the actions out.
 */

/** One erratum's check, as `errata-check --report` writes it; `error` is null where it passed. */
export interface CheckResult {
  id: string;
  source: string;
  error: string | null;
}

export interface OpenIssue {
  number: number;
  body: string;
}

export type IssueAction =
  | { kind: "open"; id: string; source: string; error: string }
  | { kind: "update"; number: number; id: string; source: string; error: string }
  | { kind: "close"; number: number; id: string; reason: "passes" | "gone" };

const MARKER = /^<!-- erratum: (\S+) -->$/m;

/** The title of the issue for the erratum with ID `id`. */
export const issueTitle = (id: string) => `The store no longer matches erratum ${id}`;

/** A check's message on one line, as an issue quotes it. */
export const oneLine = (error: string) => error.replace(/\s*\n\s*/g, " ");

/** An issue's body for a failing check, with the marker that finds it again. */
export function issueBody(
  r: { id: string; source: string; error: string },
  repo: string,
  run: string,
): string {
  return [
    `<!-- erratum: ${r.id} -->`,
    `The check for erratum \`${r.id}\` in [src/sources/${r.source}/errata.ts](https://github.com/${repo}/blob/main/src/sources/${r.source}/errata.ts) fails against the store:`,
    "",
    `> ${oneLine(r.error)}`,
    "",
    `Either the source's data changed and ingest stored it, so the erratum needs rewriting or retiring, or the store needs fixing. This issue closes on its own when the check passes. Found in [this run](${run}).`,
  ].join("\n");
}

/**
 * The actions that bring `issues`, the open ones the label finds, in line with
 * `results`. `known` is every erratum ID there is, so an issue for one the run
 * didn't check stays open unless its erratum is gone.
 */
export function planIssues(
  results: CheckResult[],
  issues: OpenIssue[],
  known: Set<string>,
): IssueAction[] {
  const byId = new Map<string, OpenIssue>();
  for (const issue of issues) {
    const id = MARKER.exec(issue.body)?.[1];
    if (id && !byId.has(id)) byId.set(id, issue);
  }
  const actions: IssueAction[] = [];
  for (const r of results) {
    const issue = byId.get(r.id);
    if (r.error === null) {
      if (issue) actions.push({ kind: "close", number: issue.number, id: r.id, reason: "passes" });
    } else if (!issue) actions.push({ kind: "open", id: r.id, source: r.source, error: r.error });
    else if (!issue.body.includes(`\n> ${oneLine(r.error)}\n`))
      actions.push({
        kind: "update",
        number: issue.number,
        id: r.id,
        source: r.source,
        error: r.error,
      });
  }
  for (const [id, issue] of byId)
    if (!known.has(id)) actions.push({ kind: "close", number: issue.number, id, reason: "gone" });
  return actions;
}
