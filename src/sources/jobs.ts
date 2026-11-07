import { sources } from "./index.ts";

/**
 * The scheduled jobs that run one job per source:
 * - `hourly`: hourly ingest, for sources that publish within hours.
 * - `compact`: nightly compaction, for every source with observed levels, and
 *   every hourly one, whose recent/ window it folds into year files.
 * - `lists`: the monthly station-list refresh, for every source.
 * - `refetch`: the monthly refetch, for sources whose values become final.
 *
 * Only sources that may be redistributed: the workflows write the public
 * lake, and have no restricted one.
 */
export const JOBS = ["hourly", "compact", "lists", "refetch"] as const;
export type Job = (typeof JOBS)[number];

/**
 * The IDs of the sources `job` runs for, in ID order. Given `ids`, only those,
 * each of which must be a registered source.
 */
export function sourcesFor(job: Job, ids: string[] = []): string[] {
  for (const id of ids)
    if (!sources[id])
      throw new Error(`Unknown source ${id}; expected one of ${Object.keys(sources).join(", ")}`);
  const picked = ids.length ? new Set(ids) : undefined;
  return Object.entries(sources)
    .filter(([id]) => !picked || picked.has(id))
    .filter(([, source]) => source.metadata.license.redistribution)
    .filter(([, source]) => {
      switch (job) {
        case "hourly":
          return source.metadata.hourly;
        case "compact":
          return source.metadata.hourly || source.observations !== undefined;
        case "lists":
          return true;
        case "refetch":
          return source.metadata.finalizes;
      }
    })
    .map(([id]) => id)
    .sort();
}
