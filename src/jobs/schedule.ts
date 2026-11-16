import { sources } from "../sources/index.ts";
import { JOBS, PHASES, runsJob, type Job } from "../sources/jobs.ts";

/** A scheduled run of one source's job, keyed by its period so it's queued once. */
export interface Planned {
  key: string;
  /** The schedule, the key's first part, so a run isn't queued while one of the same kind still waits. */
  kind: string;
  command: string[];
  lane: string;
  timeout: number;
}

/** Each schedule's command, timeout, and when in its period it's due, as the workflows run them in Actions. */
const SCHEDULES: Record<
  Job,
  { command: (id: string) => string[]; timeout: number; due: (now: Date) => string | null }
> = {
  // Ingest hourly's: from 12 minutes past each hour, its 12 hours catching up a late or missed run.
  hourly: {
    command: (id) => ["scripts/ingest.ts", "recent", id, "--hours", "12"],
    timeout: 50,
    due: (now) => (now.getUTCMinutes() >= 12 ? now.toISOString().slice(0, 13) : null),
  },
  // Compact daily's: from 00:40 UTC, its 6 days catching up a late or missed night. Half its concurrency,
  // since sixteen full-year 1-minute files merging at once peaked near 2.5 GB of heap on a 16 GB runner,
  // and a job here gets a fifth of the box.
  compact: {
    command: (id) => ["scripts/ingest.ts", "compact", id, "--days", "6", "--concurrency", "8"],
    timeout: 50,
    due: (now) =>
      now.getUTCHours() * 60 + now.getUTCMinutes() >= 40 ? now.toISOString().slice(0, 10) : null,
  },
  // Monthly's full refresh on the 2nd from 01:25 UTC, and its refetch on the 9th from 03:35, each within
  // three days, so a source that moves later in the month waits for the next rather than run twice in one.
  lists: {
    command: (id) => ["scripts/monthly.sh", "lists", id, "--full"],
    timeout: 360,
    due: (now) => monthly(now, 2, 85),
  },
  refetch: {
    command: (id) => ["scripts/monthly.sh", "refetch", id],
    timeout: 360,
    due: (now) => monthly(now, 9, 215),
  },
};

/** The month, as YYYY-MM, from `minute` past midnight UTC on `day` until three days after, or null. */
function monthly(now: Date, day: number, minute: number): string | null {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 0, minute);
  const t = now.getTime();
  return t >= start && t < start + 3 * 86_400_000 ? now.toISOString().slice(0, 7) : null;
}

/** The scheduled runs due now for the sources in the `server` phase. */
export function due(now: Date, phases: ReadonlyMap<string, string> = PHASES): Planned[] {
  const out: Planned[] = [];
  for (const [id, phase] of phases) {
    const source = sources[id];
    if (phase !== "server" || !source) continue;
    for (const job of JOBS) {
      const schedule = SCHEDULES[job];
      const period = runsJob(job, source) ? schedule.due(now) : null;
      if (!period) continue;
      out.push({
        key: `${job}:${id}:${period}`,
        kind: `${job}:${id}`,
        command: schedule.command(id),
        lane: `store-${id}`,
        timeout: schedule.timeout,
      });
    }
  }
  return out;
}

/** The list refresh a datum change asks for, at most once a day, as the hourly workflow's was. */
export function refreshFor(id: string, now: Date): Planned {
  return {
    key: `refresh:${id}:${now.toISOString().slice(0, 10)}`,
    kind: `refresh:${id}`,
    command: ["scripts/monthly.sh", "lists", id],
    lane: `store-${id}`,
    timeout: 360,
  };
}
