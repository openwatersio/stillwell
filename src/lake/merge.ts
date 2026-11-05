import { Flag } from "../schema.ts";

/**
 * Replace the rows of `existing` in [start, end) with `incoming`, keeping
 * everything outside that range. A value seen before keeps its first `received`
 * time; a new one gets `receivedAt`, which is unset for backfilled history.
 * Later fetches win on level and flag, so verified data replaces preliminary.
 */
export function mergeRange<T extends { time: number; received?: number }>(
  existing: T[],
  incoming: T[],
  start: number,
  end: number,
  receivedAt?: number,
): T[] {
  const before = new Map(existing.map((r) => [r.time, r]));
  const merged = existing.filter((r) => r.time < start || r.time >= end);
  for (const row of incoming) {
    if (row.time < start || row.time >= end) continue;
    const received = before.get(row.time)?.received ?? row.received ?? receivedAt;
    const next = { ...row };
    if (received === undefined) delete next.received;
    else next.received = received;
    merged.push(next);
  }
  merged.sort((a, b) => a.time - b.time);
  return merged.filter((r, i) => i === 0 || r.time !== merged[i - 1]!.time);
}

/**
 * `mergeRange`, except that a calendar month (UTC) with no incoming rows keeps
 * the rows it had. Sources that fetch a month per request, or answer a month
 * with "no data" during an outage, shouldn't delete what the lake already holds;
 * a value is only replaced by a fetch that covered its month.
 */
export function mergeFetched<T extends { time: number; received?: number }>(
  existing: T[],
  incoming: T[],
  start: number,
  end: number,
  receivedAt?: number,
): T[] {
  const fetched = new Set(incoming.map((r) => monthOf(r.time)));
  const kept = existing.filter(
    (r) => r.time >= start && r.time < end && !fetched.has(monthOf(r.time)),
  );
  const merged = [...mergeRange(existing, incoming, start, end, receivedAt), ...kept];
  merged.sort((a, b) => a.time - b.time);
  return merged.filter((r, i) => i === 0 || r.time !== merged[i - 1]!.time);
}

function monthOf(time: number): number {
  const d = new Date(time);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** Whether two sorted series hold the same values. */
export function sameRows<T extends object>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((row, i) => canonical(row) === canonical(b[i]!));
}

function canonical(row: object): string {
  return JSON.stringify(Object.entries(row).sort(([x], [y]) => x.localeCompare(y)));
}

/**
 * Every row of both series, so folding the recent window into a year file
 * never drops a value the file had. Where both have a time, `incoming` wins on
 * level and flag, except that a preliminary value never replaces one the
 * source finalized (good or interpolated), such as a verified backfill. The
 * row keeps the file's `received`, earlier or unknown: a value backfilled
 * before the window saw it arrive has no first arrival on record, not the
 * window's.
 */
export function upsert<T extends { time: number; flag: number; received?: number }>(
  existing: T[],
  incoming: T[],
): T[] {
  const byTime = new Map(existing.map((r) => [r.time, r]));
  for (const row of incoming) {
    const before = byTime.get(row.time);
    if (!before) {
      byTime.set(row.time, row);
      continue;
    }
    const finalized = before.flag <= Flag.interpolated && row.flag === Flag.preliminary;
    const next = { ...(finalized ? before : row) };
    const received =
      before.received === undefined
        ? undefined
        : Math.min(before.received, row.received ?? before.received);
    if (received === undefined) delete next.received;
    else next.received = received;
    byTime.set(row.time, next);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
