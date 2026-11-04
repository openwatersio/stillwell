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

/** Whether two sorted series hold the same values. */
export function sameRows<T extends object>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((row, i) => canonical(row) === canonical(b[i]!));
}

function canonical(row: object): string {
  return JSON.stringify(Object.entries(row).sort(([x], [y]) => x.localeCompare(y)));
}
