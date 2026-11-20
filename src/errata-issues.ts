/**
 * What `errata-check`'s report asks of the repo's issues: one open issue for
 * each erratum whose check fails, found by the marker in its body, brought up
 * to date when the check fails another way, and closed when it passes or the
 * erratum is gone. A check that couldn't read the store leaves its issue as it
 * is. scripts/errata-issues.ts carries the actions out.
 */

/** One erratum's check, as `errata-check --report` writes it; `error` is null where it passed. */
export interface CheckResult {
  id: string;
  source: string;
  error: string | null;
  /** The check failed reading the store, so it says nothing about the erratum. */
  unreadable: boolean;
}

export interface OpenIssue {
  number: number;
  body: string;
}

export type IssueAction =
  | { kind: "open"; id: string; source: string; error: string }
  | { kind: "update"; number: number; id: string; source: string; error: string; body: string }
  | { kind: "close"; number: number; id: string; reason: "passes" | "gone" | "duplicate" };

const MARKER = /^<!-- erratum: (\S+) -->$/m;
// The part of the body the workflow writes; anything outside it is left as it is.
const START = "<!-- errata-check -->";
const END = "<!-- /errata-check -->";
const LIMIT = 2000;

/** The title of the issue for the erratum with ID `id`. */
export const issueTitle = (id: string) => `The store no longer matches erratum ${id}`;

/** A check's message as an issue quotes it: one line, capped, in a code block so it can't mention or link. */
export function quoted(error: string): string {
  const line = error.replace(/\s*[\r\n]+\s*/g, " ").replaceAll("```", "'''");
  return ["```text", line.length > LIMIT ? `${line.slice(0, LIMIT)}…` : line, "```"].join("\n");
}

function section(r: { id: string; source: string; error: string }, repo: string, run: string) {
  return [
    START,
    `The check for erratum \`${r.id}\` in [src/sources/${r.source}/errata.ts](https://github.com/${repo}/blob/main/src/sources/${r.source}/errata.ts) fails against the store:`,
    "",
    quoted(r.error),
    "",
    `Either the source's data changed and ingest stored it, so the erratum needs rewriting or retiring, or the store needs fixing. This issue closes on its own when the check passes. Found in [this run](${run}).`,
    END,
  ].join("\n");
}

/** A new issue's body for a failing check, with the marker that finds it again. */
export function issueBody(
  r: { id: string; source: string; error: string },
  repo: string,
  run: string,
): string {
  return `<!-- erratum: ${r.id} -->\n${section(r, repo, run)}`;
}

/** `body` with the workflow's section brought up to date, and the rest kept. */
function updated(
  body: string,
  r: { id: string; source: string; error: string },
  repo: string,
  run: string,
): string {
  const [start, end] = [body.indexOf(START), body.indexOf(END)];
  return start === -1 || end < start
    ? `${body}\n\n${section(r, repo, run)}`
    : `${body.slice(0, start)}${section(r, repo, run)}${body.slice(end + END.length)}`;
}

/**
 * The actions that bring `issues`, the open ones the label finds, in line with
 * `results`. `known` is every erratum ID there is, so an issue for one the run
 * didn't check stays open unless its erratum is gone. Of two open issues for
 * one erratum, the older stays.
 */
export function planIssues(
  results: CheckResult[],
  issues: OpenIssue[],
  known: Set<string>,
  repo: string,
  run: string,
): IssueAction[] {
  const actions: IssueAction[] = [];
  const byId = new Map<string, OpenIssue>();
  for (const issue of [...issues].sort((a, b) => a.number - b.number)) {
    const id = MARKER.exec(issue.body)?.[1];
    if (!id) continue;
    if (byId.has(id))
      actions.push({ kind: "close", number: issue.number, id, reason: "duplicate" });
    else byId.set(id, issue);
  }
  for (const r of results) {
    const issue = byId.get(r.id);
    if (r.unreadable) continue;
    if (r.error === null) {
      if (issue) actions.push({ kind: "close", number: issue.number, id: r.id, reason: "passes" });
    } else if (!issue) actions.push({ kind: "open", id: r.id, source: r.source, error: r.error });
    else if (!issue.body.replace(/\r\n/g, "\n").includes(quoted(r.error)))
      actions.push({
        kind: "update",
        number: issue.number,
        id: r.id,
        source: r.source,
        error: r.error,
        body: updated(issue.body, { ...r, error: r.error }, repo, run),
      });
  }
  for (const [id, issue] of byId)
    if (!known.has(id)) actions.push({ kind: "close", number: issue.number, id, reason: "gone" });
  return actions;
}
