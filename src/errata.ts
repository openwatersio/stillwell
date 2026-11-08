/**
 * Errors in what a source publishes, found while ingesting it: values on the
 * wrong clock or day, positions far from the gauge, metadata that contradicts
 * the data, two endpoints that disagree. Each is an open issue labeled
 * `source-error`, written with the issue form in
 * `.github/ISSUE_TEMPLATE/source-error.yml`, which also tracks the report to
 * the agency. The adapter cites its ID (`erratum \`<id>\``) where it works
 * around it or, where the lake keeps the data as served, in its README.
 * `publish` reads the open issues, lists each station's errata in the
 * `errata` column of `stations.parquet`, and writes them to `errata.json`, so
 * a user can see which values the lake changed and why. Closing the issue,
 * once the agency has fixed the data and the lake has refetched it, takes the
 * erratum out at the next publish. See CONTRIBUTING.md.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getJson } from "./http.ts";

/** What the lake does about an erratum. */
export const HANDLING = ["corrected", "flagged", "dropped", "refused", "avoided", "kept"] as const;
/**
 * `corrected`: values or metadata changed to what the source should have
 * published. `flagged`: values kept, flagged `suspect` or worse. `dropped`:
 * stations or values left out. `refused`: the adapter refuses the file, so its
 * values are missing until it's fixed. `avoided`: the lake doesn't use the
 * wrong part, so nothing in it is affected. `kept`: kept as the source serves it.
 */
export type Handling = (typeof HANDLING)[number];

export interface Erratum {
  /** `<source>-<what>`, never reused. */
  id: string;
  source: string;
  /**
   * Lake station IDs known to be affected; null for every station of the
   * source. Partial or empty where the source doesn't say which stations, or
   * they aren't in the lake; `error` says which.
   */
  stations: string[] | null;
  /**
   * The UTC days of values the error is in, `since` to before `until`; null
   * for an open end or none. What the lake lacks or changed as a result can
   * be wider, and `lake` says so.
   */
  since: string | null;
  until: string | null;
  /** What the source publishes wrong. */
  error: string;
  handling: Handling;
  /** What the lake does about it. */
  lake: string;
  /** The `source-error` issue it's written in. */
  issue: number;
}

export const REPO = "openwatersio/water-levels";
export const LABEL = "source-error";

/** The issue form's headings, by field. */
const FIELDS = {
  error: "What's wrong",
  id: "Erratum ID",
  source: "Source",
  stations: "Stations",
  since: "Values since",
  until: "Values until",
  handling: "Handling",
  lake: "What the lake does",
  evidence: "Evidence",
  report: "Report to the agency",
} as const;

/** What the form writes for a field left blank. */
const BLANK = "_No response_";

/**
 * The erratum an issue body written with the form holds, or an Error saying
 * what's missing or malformed. `sources` are the registered source IDs.
 */
export function parseErratum(issue: number, body: string, sources: string[]): Erratum {
  const headings = new Set<string>(Object.values(FIELDS));
  const sections = new Map<string, string>();
  let current: string | null = null;
  // A line is a field's heading only if it's one of the form's, so the
  // evidence can use headings of its own.
  for (const line of body.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^### (.+?)\s*$/.exec(line)?.[1];
    if (heading && headings.has(heading) && !sections.has(heading)) {
      sections.set((current = heading), "");
      continue;
    }
    if (current) sections.set(current, `${sections.get(current)}${line}\n`);
  }
  const field = (name: keyof typeof FIELDS): string | null => {
    const text = sections.get(FIELDS[name])?.trim();
    if (text === undefined) throw new Error(`#${issue}: no "### ${FIELDS[name]}" heading`);
    return text === "" || text === BLANK ? null : text;
  };
  const required = (name: keyof typeof FIELDS): string => {
    const text = field(name);
    if (text === null) throw new Error(`#${issue}: "${FIELDS[name]}" is blank`);
    return text;
  };
  const day = (name: "since" | "until"): string | null => {
    const text = field(name);
    // A real day: Date rolls 2026-02-30 over to March, so it must come back the same.
    const ms = text === null ? NaN : Date.parse(`${text}T00:00:00Z`);
    const real =
      /^\d{4}-\d{2}-\d{2}$/.test(text ?? "") &&
      new Date(ms || 0).toISOString().slice(0, 10) === text;
    if (text !== null && (Number.isNaN(ms) || !real))
      throw new Error(`#${issue}: "${FIELDS[name]}" is ${text}, not YYYY-MM-DD`);
    return text;
  };

  const source = required("source");
  if (!sources.includes(source)) throw new Error(`#${issue}: no source ${source}`);
  const id = required("id").replace(/`/g, "");
  if (!new RegExp(`^${source}-[a-z0-9-]+$`).test(id))
    throw new Error(`#${issue}: erratum ID ${id} isn't ${source}-<what>`);
  const listed = required("stations")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*[-*]\s*/, "")
        .replace(/`/g, "")
        .trim(),
    )
    .filter(Boolean);
  const every = listed.length === 1 && /^every station$/i.test(listed[0]!);
  const none = listed.length === 1 && /^none listed$/i.test(listed[0]!);
  const stations = every ? null : none ? [] : listed;
  for (const s of stations ?? [])
    if (!s.startsWith(`${source}/`)) throw new Error(`#${issue}: station ${s} isn't ${source}'s`);
  const [since, until] = [day("since"), day("until")];
  if (since && until && since >= until)
    throw new Error(`#${issue}: "${FIELDS.since}" isn't before "${FIELDS.until}"`);
  const handling = required("handling");
  if (!(HANDLING as readonly string[]).includes(handling))
    throw new Error(`#${issue}: handling ${handling} isn't one of ${HANDLING.join(", ")}`);
  return {
    id,
    source,
    stations,
    since,
    until,
    error: required("error"),
    handling: handling as Handling,
    lake: required("lake"),
    issue,
  };
}

interface Issue {
  number: number;
  body: string | null;
  author_association: string;
  pull_request?: unknown;
}

/**
 * Who can open an issue that counts. The issue form labels whatever anyone
 * files with it, so a `source-error` issue from anyone else is a report for a
 * maintainer to read, not an erratum; and only its author and maintainers can
 * edit an issue, so the body stays theirs.
 */
const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** An issue that doesn't parse, or reuses another's ID. */
export interface Problem {
  issue: number;
  message: string;
}

async function issuesOf(state: "open" | "closed"): Promise<Issue[]> {
  const token = process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const issues: Issue[] = [];
  for (let page = 1; ; page++) {
    const batch = await getJson<Issue[]>(
      `https://api.github.com/repos/${REPO}/issues?labels=${LABEL}&state=${state}&per_page=100&page=${page}`,
      { fresh: true, headers },
    );
    issues.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return issues.sort((a, b) => a.number - b.number);
}

/**
 * The erratum IDs of maintainers' closed `source-error` issues, each with the
 * oldest that has it, which a newer issue may not reuse. A closed duplicate
 * opened after the original doesn't take the original's ID.
 */
export async function closedIds(): Promise<Map<string, number>> {
  const ids = new Map<string, number>();
  for (const { number, body, author_association } of await issuesOf("closed")) {
    if (!TRUSTED.has(author_association)) continue;
    const id = /^### Erratum ID\s*\n+\s*`?([a-z0-9-]+)`?\s*$/m.exec(body ?? "")?.[1];
    // The oldest holds the ID; issuesOf sorts by number.
    if (id && !ids.has(id)) ids.set(id, number);
  }
  return ids;
}

/**
 * The errata in the repository's open `source-error` issues opened by a
 * maintainer; each such issue that doesn't parse or reuses an ID, open or
 * closed, which is left out; and the others, by number. A token in GITHUB_TOKEN raises
 * GitHub's rate limit; the repository is public, so none is needed.
 */
export async function openErrata(
  sources: string[],
): Promise<{ errata: Erratum[]; problems: Problem[]; ignored: number[] }> {
  const errata: Erratum[] = [];
  const problems: Problem[] = [];
  const ignored: number[] = [];
  const closed = await closedIds();
  for (const { number, body, author_association } of await issuesOf("open")) {
    if (!TRUSTED.has(author_association)) {
      ignored.push(number);
      continue;
    }
    try {
      const e = parseErratum(number, body ?? "", sources);
      const twin = errata.find((other) => other.id === e.id);
      if (twin) throw new Error(`#${number}: erratum ID ${e.id} is #${twin.issue}'s too`);
      if ((closed.get(e.id) ?? Infinity) < number)
        throw new Error(`#${number}: erratum ID ${e.id} is closed #${closed.get(e.id)}'s`);
      errata.push(e);
    } catch (error) {
      problems.push({ issue: number, message: (error as Error).message });
    }
  }
  return { errata, problems, ignored };
}

/**
 * What publish writes, from the open issues and the errata it published last.
 * An issue that doesn't parse, or whose author no longer counts, keeps its
 * last published erratum, as does one the code still cites (`cited`) that
 * no open issue holds; a fetch that failed keeps the whole last list. `notes`
 * say what was kept and why. With every issue read and nothing cited, no open
 * issue means no errata.
 */
export function settle(
  fetched: { errata: Erratum[]; problems: Problem[]; ignored: number[] } | Error,
  previous: Erratum[],
  cited: Set<string> = new Set(),
): { errata: Erratum[]; notes: string[] } {
  if (fetched instanceof Error)
    return {
      errata: previous,
      notes: [
        `the issues couldn't be read (${fetched.message}); kept the ${previous.length} errata published last`,
      ],
    };
  const errata = [...fetched.errata];
  const notes: string[] = [];
  const keep = (issue: number, why: string, always: boolean) => {
    const last = previous.find((e) => e.issue === issue);
    if (last && !errata.some((e) => e.id === last.id)) errata.push(last);
    if (last || always)
      notes.push(`${why}${last ? `; kept ${last.id} as published last` : "; left out"}`);
  };
  for (const p of fetched.problems) keep(p.issue, p.message, true);
  // A stranger's new issue is only a report, but one that was an erratum shouldn't vanish unnoticed.
  for (const n of fetched.ignored) keep(n, `#${n}: not opened by a maintainer`, false);
  // Code that still works around an erratum still needs it published, so an
  // issue closed too soon, or missing from a bad answer, doesn't drop it.
  for (const e of previous)
    if (cited.has(e.id) && !errata.some((other) => other.id === e.id)) {
      errata.push(e);
      notes.push(
        `${e.id} is cited in the code, but no open issue holds it; kept as published last`,
      );
    }
  return { errata: errata.sort((a, b) => a.issue - b.issue), notes };
}

/** The errata `errata.json` holds, as `published` wrote them. */
export function fromPublished(rows: unknown[]): Erratum[] {
  return (rows as (Omit<Erratum, "issue"> & { issue: string })[]).map((r) => ({
    id: r.id,
    source: r.source,
    stations: r.stations,
    since: r.since,
    until: r.until,
    error: r.error,
    handling: r.handling,
    lake: r.lake,
    issue: Number(/\/issues\/(\d+)$/.exec(r.issue)?.[1]),
  }));
}

/** `errata.json`: each erratum with its issue's URL. */
export function published(errata: Erratum[]): object[] {
  return errata.map(({ issue, ...e }) => ({
    ...e,
    issue: `https://github.com/${REPO}/issues/${issue}`,
  }));
}

/** The IDs of the errata that affect a station. */
export function errataOf(station: { id: string; source: string }, errata: Erratum[]): string[] {
  return errata
    .filter((e) => e.source === station.source && (!e.stations || e.stations.includes(station.id)))
    .map((e) => e.id);
}

/** The erratum IDs cited under `dir`, with the files that cite each. */
export function citedIn(dir: string): Map<string, string[]> {
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );
  const cited = new Map<string, string[]>();
  for (const file of files(dir))
    for (const id of citations(readFileSync(file, "utf8")))
      cited.set(id, [...(cited.get(id) ?? []), file]);
  return cited;
}

/** Erratum IDs cited in a file's text, as erratum `<id>`. */
export function citations(text: string): string[] {
  return [...text.matchAll(/[Ee]rratum\s+(?:\*\s+)?`([a-z0-9-]+)`/g)].map((m) => m[1]!);
}
