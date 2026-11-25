// The live Worker's alert: one GitHub issue for each source the poller hasn't passed cleanly, and one for a stopped
// poller (README.md).

import type { LiveDb } from "./store.ts";

const REPO = "openwatersio/stillwell";
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A source with no clean pass for this long has an issue open. */
export const STALE_MS = 2 * HOUR_MS;
/** How long one GitHub call may take, so a stalled one fails instead of holding up the issues after it. */
const CALL_MS = 30_000;

/**
 * Open an issue for each source with no clean pass in `STALE_MS`, and one for the poller when no pass of any source
 * has finished in that time, and close each once that's no longer so: one issue each, found by its title, as
 * scripts/alert.sh does for the workflows, and every open issue with that title closed. A source with no pass in the last
 * week drops out, with its issue left open. A GitHub call that fails or takes over `callMs` for one issue doesn't stop
 * the others; the failures are thrown together at the end.
 */
export async function alert(
  db: LiveDb,
  token: string | undefined,
  now: number,
  fetcher: typeof fetch = fetch,
  callMs = CALL_MS,
): Promise<void> {
  const { results: passes } = await db
    .prepare(
      "SELECT source, max(finished) AS last, max(CASE WHEN ok = 1 THEN finished END) AS last_ok FROM polls WHERE finished > ? GROUP BY source",
    )
    .bind(now - 7 * DAY_MS)
    .all<{ source: string; last: number; last_ok: number | null }>();
  // Every source with live values too, so one whose passes never record still opens its issue.
  const { results: held } = await db
    .prepare("SELECT DISTINCT substr(station, 1, instr(station, '/') - 1) AS source FROM live")
    .all<{ source: string }>();
  const results = [
    ...passes,
    ...held
      .filter((h) => !passes.some((p) => p.source === h.source))
      .map((h) => ({ source: h.source, last: 0, last_ok: null })),
  ];
  if (!token) throw new Error("GITHUB_TOKEN isn't set, so stale sources open no issue");
  const github = async (path: string, init: RequestInit = {}) => {
    const response = await fetcher(`https://api.github.com/repos/${REPO}/${path}`, {
      ...init,
      signal: AbortSignal.timeout(callMs),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "stillwell-live",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!response.ok)
      throw new Error(`GitHub ${path}: ${response.status} ${await response.text()}`);
    return response.json() as Promise<unknown>;
  };
  // The listing holds pull requests too, which a title of theirs mustn't count as an alert's issue.
  const open: { number: number; title: string }[] = [];
  for (let page = 1; ; page++) {
    const listed = (await github(`issues?state=open&per_page=100&page=${page}`)) as {
      number: number;
      title: string;
      pull_request?: unknown;
    }[];
    open.push(...listed.filter((i) => !i.pull_request));
    if (listed.length < 100) break;
  }
  const stopped = Math.max(0, ...results.map((r) => r.last)) < now - STALE_MS;
  const subjects: [string, boolean, string][] = [
    [
      "The live poller has stopped",
      stopped,
      "No poller pass of any source has finished for over 2 hours: the live Worker's container isn't running passes, or can't record them. The Worker's logs have its last lines every 10 minutes, and `GET /log` on it returns them to holders of `STORE_TOKEN`. This issue closes on its own after a pass finishes.",
    ],
    ...results.map((r): [string, boolean, string] => [
      `Live polling is failing for ${r.source}`,
      (r.last_ok ?? 0) < now - STALE_MS,
      `The live poller has had no clean pass of \`${r.source}\` for over 2 hours. The \`polls\` table in the \`stillwell-live\` D1 database has each pass's failures. This issue closes on its own after a clean pass.`,
    ]),
  ];
  const failed: string[] = [];
  const attempt = (title: string, call: Promise<unknown>) =>
    call.catch((error: unknown) => {
      failed.push(`${title}: ${error instanceof Error ? error.message : String(error)}`);
    });
  for (const [title, failing, body] of subjects) {
    const issues = open.filter((i) => i.title === title);
    if (failing && !issues.length)
      await attempt(
        title,
        github("issues", { method: "POST", body: JSON.stringify({ title, body }) }),
      );
    if (!failing)
      for (const issue of issues)
        await attempt(
          title,
          github(`issues/${issue.number}`, {
            method: "PATCH",
            body: JSON.stringify({ state: "closed", state_reason: "completed" }),
          }),
        );
  }
  if (failed.length) throw new Error(failed.join("; "));
}
