import { laneOf } from "./commands.ts";

/** Every source, for a run that may write any of them. */
export const ALL = "*";

/** The workflows that write one source per job, and the names of those jobs, `<name> (<source>)`. */
const WORKFLOWS: Record<string, string[]> = {
  "ingest-hourly.yml": ["recent"],
  "compact-daily.yml": ["compact"],
  "monthly.yml": ["lists", "refetch"],
};

interface Run {
  id: number;
  display_title: string;
}
interface RunJob {
  name: string;
  status: string;
}

/** The sources a run of `workflow` may still write, from its title and jobs; `ALL` when it can't tell. */
export function writing(workflow: string, run: Run, jobs: RunJob[]): string[] {
  if (workflow === "ingest.yml") {
    const lane = laneOf(
      run.display_title
        .replace(/^Ingest /, "")
        .split(/\s+/)
        .filter(Boolean),
    );
    return lane.startsWith("store-") ? [lane.slice("store-".length)] : [];
  }
  const names = WORKFLOWS[workflow];
  const perSource = jobs.filter((j) => names.some((n) => j.name.startsWith(`${n} (`)));
  // A run whose matrix hasn't expanded yet may write any source.
  if (!perSource.length) return [ALL];
  return perSource
    .filter((j) => j.status !== "completed")
    .map((j) => /\((.+)\)$/.exec(j.name)?.[1] ?? ALL);
}

function client(token: string, repo: string) {
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
  return async <T>(path: string, accept = headers.Accept): Promise<T> => {
    const response = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
      headers: { ...headers, Accept: accept },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Reading ${path}: ${response.status}`);
    return (await response.json()) as T;
  };
}

/** Every item of a paged list, a hundred at a time, as `key` holds them. */
async function all<T>(
  get: <R>(path: string) => Promise<R>,
  path: string,
  key: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const items = (await get<Record<string, T[]>>(`${path}&per_page=100&page=${page}`))[key];
    out.push(...items);
    if (items.length < 100) return out;
  }
}

/**
 * The sources an Actions run queued or running may still write, so the server starts no job for one of them
 * while the run lasts, as when a source has just moved and a run from before still goes.
 */
export async function actionsWriting(token: string, repo: string): Promise<Set<string>> {
  const get = client(token, repo);
  const out = new Set<string>();
  for (const workflow of ["ingest.yml", ...Object.keys(WORKFLOWS)])
    // In the order a run moves through them, so one that moves on between reads lands in a list still to be read.
    for (const status of ["requested", "pending", "queued", "waiting", "in_progress"])
      for (const run of await all<Run>(
        get,
        `actions/workflows/${workflow}/runs?status=${status}`,
        "workflow_runs",
      )) {
        const jobs =
          workflow === "ingest.yml"
            ? []
            : await all<RunJob>(get, `actions/runs/${run.id}/jobs?filter=latest`, "jobs");
        for (const source of writing(workflow, run, jobs)) out.add(source);
      }
  return out;
}

/** main's src/sources/server.json, which the server writes by as Actions does. */
export async function mainPhases(token: string, repo: string): Promise<Map<string, string>> {
  const get = client(token, repo);
  const list = await get<unknown>(
    "contents/src/sources/server.json?ref=main",
    "application/vnd.github.raw+json",
  );
  if (!list || typeof list !== "object" || Array.isArray(list))
    throw new Error("main's server.json isn't a map of sources to phases");
  return new Map(Object.entries(list as Record<string, string>));
}
