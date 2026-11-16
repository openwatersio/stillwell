import { sources } from "./index.ts";
import type { Source } from "../schema.ts";
import serverList from "./server.json" with { type: "json" };

/**
 * The scheduled jobs that run one job per source:
 * - `hourly`: hourly ingest, for sources that publish within hours.
 * - `compact`: nightly compaction, for every source with observed levels, and
 *   every hourly one, whose recent/ window it folds into year files.
 * - `lists`: the monthly station-list refresh, for every source.
 * - `refetch`: the monthly refetch, for sources whose values become final.
 *
 * Only sources that may be redistributed: the workflows write the public
 * store, and have no restricted one.
 */
export const JOBS = ["hourly", "compact", "lists", "refetch"] as const;
export type Job = (typeof JOBS)[number];

/**
 * Where a source in server.json is on the server's job queue
 * (docs/plans/jobs.md): `server` while the server writes it, once no Actions
 * run still does, and `returning` while the server's jobs for it finish
 * before it leaves the file and Actions writes it again.
 */
export type Phase = "server" | "returning";

export const PHASES: ReadonlyMap<string, Phase> = new Map(
  Object.entries(serverList as Record<string, Phase>),
);

/**
 * The sources in server.json, in any phase, which Actions never writes: the
 * scheduled workflows leave them out and every workflow job that writes one
 * refuses it, by main's list (scripts/server-owns.sh), so a run queued or
 * re-run from an older commit can't write one that has moved since. The
 * server writes only those in the `server` phase.
 */
export const SERVER_SOURCES: ReadonlySet<string> = new Set(PHASES.keys());

/** Whether `source` runs `job`, from its adapter's metadata, wherever it runs. */
export function runsJob(job: Job, source: Source): boolean {
  if (!source.metadata.license.redistribution) return false;
  switch (job) {
    case "hourly":
      return !!source.metadata.hourly;
    case "compact":
      return !!source.metadata.hourly || source.observations !== undefined;
    case "lists":
      return true;
    case "refetch":
      return !!source.metadata.finalizes;
  }
}

/**
 * The IDs of the sources `job` runs for in Actions, in ID order, leaving out
 * `SERVER_SOURCES`. Given `ids`, only those, each of which must be a
 * registered source.
 */
export function sourcesFor(job: Job, ids: string[] = []): string[] {
  for (const id of ids)
    if (!sources[id])
      throw new Error(`Unknown source ${id}; expected one of ${Object.keys(sources).join(", ")}`);
  const picked = ids.length ? new Set(ids) : undefined;
  return Object.entries(sources)
    .filter(([id]) => (!picked || picked.has(id)) && !SERVER_SOURCES.has(id))
    .filter(([, source]) => runsJob(job, source))
    .map(([id]) => id)
    .sort();
}
