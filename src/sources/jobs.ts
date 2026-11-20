import { sources } from "./index.ts";
import type { Source } from "../schema.ts";

/**
 * The scheduled jobs that run one job per source:
 * - `compact`: nightly compaction, for every source with observed levels, and
 *   every hourly one, whose daily files under recent/ it folds into year files.
 * - `lists`: the monthly station-list refresh, for every source.
 * - `refetch`: the monthly refetch, for sources whose values become final.
 *
 * Only sources that may be redistributed: the workflows write the public
 * store, and have no restricted one.
 */
export const JOBS = ["compact", "lists", "refetch"] as const;
export type Job = (typeof JOBS)[number];

/** Whether `source` runs `job`, from its adapter's metadata. */
export function runsJob(job: Job, source: Source): boolean {
  if (!source.metadata.license.redistribution) return false;
  switch (job) {
    case "compact":
      return !!source.metadata.hourly || source.observations !== undefined;
    case "lists":
      return true;
    case "refetch":
      return !!source.metadata.finalizes;
  }
}

/**
 * The IDs of the sources `job` runs for, in ID order. Given `ids`, only
 * those, each of which must be a registered source.
 */
export function sourcesFor(job: Job, ids: string[] = []): string[] {
  for (const id of ids)
    if (!sources[id])
      throw new Error(`Unknown source ${id}; expected one of ${Object.keys(sources).join(", ")}`);
  const picked = ids.length ? new Set(ids) : undefined;
  return Object.entries(sources)
    .filter(([id]) => !picked || picked.has(id))
    .filter(([, source]) => runsJob(job, source))
    .map(([id]) => id)
    .sort();
}
