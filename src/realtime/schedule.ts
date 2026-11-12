import type { RunSummary } from "../store/recent.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
/** A station that gives no `min_interval_s` is asked hourly, as the hourly workflow asked it. */
const DEFAULT_INTERVAL_S = 3600;
/** How long a source rests after its pass was blocked, rather than probe the block every pass. */
export const BLOCKED_MS = HOUR_MS;
/** How soon a pass that failed before the source's groups were known is tried again. */
export const RETRY_MS = 5 * MINUTE_MS;

/** What one pass reports to the scheduler. */
export interface PassResult {
  /** Whether the pass ran to the end; one that failed still reports what it could. */
  ok: boolean;
  summary: RunSummary | null;
  /** Each polled station's `min_interval_s` in the list the pass read, 0 for none. */
  intervals: number[];
  /** Whether the source's window from recent/ is in ClickHouse, as of this pass. */
  seeded: boolean;
}

/**
 * Poll one source until `stopped`. Its stations are grouped by
 * `min_interval_s`, read again from each pass's list, and each pass fetches
 * the groups that are due (`null` for every station), one pass at a time, so
 * the source's pacing holds. The first pass fetches every station, and
 * passes seed until one has; a list with nothing to poll is read again hourly.
 * A pass that fails waits for its groups' intervals like one that succeeds,
 * so a failure never asks a source sooner; one before the groups are known is
 * tried again after `RETRY_MS`, and one the source blocked rests it for
 * `BLOCKED_MS`.
 */
export async function schedule({
  pass,
  refresh,
  clock = Date.now,
  sleep,
  stopped,
  log = console.error,
}: {
  pass: (due: number[] | null, seeding: boolean, now: number) => Promise<PassResult>;
  /** Start the source's station refresh, after a datum change; whether one started or already had. */
  refresh: () => Promise<boolean>;
  clock?: () => number;
  sleep: (ms: number) => Promise<void>;
  stopped: () => boolean;
  log?: (message: string) => void;
}): Promise<void> {
  // When each group last ran, by its interval in seconds (0 for none given).
  const ran = new Map<number, number>();
  // The source's groups, from its last pass; null until one has read its list.
  let intervals: number[] | null = null;
  let seeded = false;
  let notBefore = 0;
  let refreshAfter = -Infinity;
  while (!stopped()) {
    const now = clock();
    const due = intervals?.filter((i) => now - (ran.get(i) ?? 0) >= seconds(i) * 1000) ?? null;
    if (now >= notBefore && (!due || due.length)) {
      for (const i of due ?? []) ran.set(i, now);
      try {
        const result = await pass(due, !seeded, now);
        if (result.intervals.length) {
          // A first pass fetched every group; a group new to the list since is due at once.
          if (!due) for (const i of result.intervals) ran.set(i, now);
          intervals = result.intervals;
        } else if (result.ok) intervals = null;
        if (result.seeded) seeded = true;
        if (!result.ok && !intervals) notBefore = now + RETRY_MS;
        // A list with nothing to poll, such as a new source's, is read again hourly.
        if (result.ok && !result.intervals.length) notBefore = now + seconds(0) * 1000;
        if (result.summary?.blocked) {
          log("blocked; resting for an hour");
          notBefore = now + BLOCKED_MS;
        }
        // At most once a day, so a station that stays changed doesn't ask GitHub every pass;
        // an hour after a refresh that couldn't start.
        if (result.summary?.datumChanged && now >= refreshAfter)
          refreshAfter = now + ((await refresh()) ? 24 : 1) * HOUR_MS;
      } catch (error) {
        log(error instanceof Error ? error.message : String(error));
        if (!intervals) notBefore = now + RETRY_MS;
      }
    }
    const next = intervals
      ? Math.min(...intervals.map((i) => (ran.get(i) ?? 0) + seconds(i) * 1000))
      : notBefore;
    await sleep(Math.max(5000, Math.max(next, notBefore) - clock()));
  }
}

export function seconds(interval: number): number {
  return Math.max(60, interval || DEFAULT_INTERVAL_S);
}
