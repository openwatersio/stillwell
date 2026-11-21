// Imports only Node's async hooks, so adapters can use it without QC's harmonic dependencies.
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Levels no gauge can read in any datum the store holds, in meters: below the
 * Dead Sea's shore or above Everest. QARTOD's gross range test fails a value
 * outside the sensor's span whatever the window holds, which catches a year
 * that is all placeholder, such as USACE's 30,479.695 m (99,999 ft), where
 * the window's own median is the placeholder. A scan of every year file in
 * November 2026 found no real level above 1,817 m, at USGS's Lyman Lake.
 * The store leaves out a level outside it: every fetch of levels drops one,
 * and CO-OPS's fetch of high and low waters drops one,
 * as do backfill, compaction and requalify from the stored rows they write.
 * Each counts what it left out in a `Dropped`, and why, for its log and summary.
 * A year that holds nothing else is written as rows flagged `bad`, not as an empty year.
 */
export const SPAN_M = [-500, 9000] as const;

/** Whether a level is finite and within `SPAN_M`; NaN fails both comparisons. */
export const possible = (level: number) => level >= SPAN_M[0] && level <= SPAN_M[1];

/** Distinct out-of-span values a `Dropped` names, so a stream of junk can't grow it without bound. */
const NAMED_VALUES = 8;

/**
 * Levels left out for being outside `SPAN_M`, and why: how many, on which
 * side, and the values that account for them, such as a fill value's −9,999.
 * Every writer that leaves a level out counts it here, so a source whose
 * values all turn to fill reads as bad values in the run's log, not as a
 * station that went quiet.
 */
export class Dropped {
  count = 0;
  below = 0;
  above = 0;
  /** Not a number, which fails both sides of the span. */
  nan = 0;
  /** The most frequent values, up to `NAMED_VALUES` distinct ones; the rest count in `count` only. */
  values = new Map<number, number>();

  add(level: number, times = 1): void {
    this.count += times;
    if (Number.isNaN(level)) this.nan += times;
    else if (level < SPAN_M[0]) this.below += times;
    else this.above += times;
    if (this.values.has(level) || this.values.size < NAMED_VALUES)
      this.values.set(level, (this.values.get(level) ?? 0) + times);
  }

  merge(other: Dropped): this {
    this.count += other.count;
    this.below += other.below;
    this.above += other.above;
    this.nan += other.nan;
    for (const [level, times] of other.values)
      if (this.values.has(level) || this.values.size < NAMED_VALUES)
        this.values.set(level, (this.values.get(level) ?? 0) + times);
    return this;
  }

  /** The counts as JSON, since a `Map` has no JSON form. */
  toJSON() {
    return {
      count: this.count,
      below: this.below,
      above: this.above,
      nan: this.nan,
      values: Object.fromEntries(this.values),
    };
  }

  /** `1,234 levels outside −500 to 9,000 m (−9,999 ×1,200, 30,479.695 ×34)`, or "" when none. */
  describe(): string {
    if (!this.count) return "";
    const top = [...this.values]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(
        ([level, times]) =>
          `${level.toLocaleString("en-US").replace("-", "−")} ×${times.toLocaleString("en-US")}`,
      );
    const sides = [
      this.below && `${this.below.toLocaleString("en-US")} below`,
      this.above && `${this.above.toLocaleString("en-US")} above`,
      this.nan && `${this.nan.toLocaleString("en-US")} not a number`,
    ].filter(Boolean);
    return `${this.count.toLocaleString("en-US")} ${this.count === 1 ? "level" : "levels"} outside −500 to 9,000 m (${sides.join(", ")}; ${top.join(", ")})`;
  }
}

/** The drops a `tallying` call is collecting, and the dropped rows when it asked for them. */
interface Ledger {
  dropped: Dropped;
  rows?: { time: number; level: number }[];
}

const ledgers = new AsyncLocalStorage<Ledger>();

/**
 * Runs `work` and returns what it dropped: every call to `inSpan` or
 * `leaveOut` inside it, down its awaits, lands here. `keepRows` also collects
 * the dropped rows' times and levels (as given to `inSpan`), for the caller
 * that writes a year of nothing else.
 */
export async function tallying<T>(
  work: () => Promise<T>,
  keepRows = false,
): Promise<{ result: T; dropped: Dropped; rows: { time: number; level: number }[] }> {
  const ledger: Ledger = { dropped: new Dropped(), ...(keepRows && { rows: [] }) };
  const result = await ledgers.run(ledger, work);
  return { result, dropped: ledger.dropped, rows: ledger.rows ?? [] };
}

/**
 * `possible(level)`, counting a level outside the span in the running
 * `tallying`, if any. `time` goes with it for the rows a caller may keep.
 */
export function inSpan(level: number, time?: number): boolean {
  if (possible(level)) return true;
  const ledger = ledgers.getStore();
  if (ledger) {
    ledger.dropped.add(level);
    if (ledger.rows && time !== undefined) ledger.rows.push({ time, level });
  }
  return false;
}

/** The rows of `rows` within the span, the others counted as `inSpan` counts them. */
export function leaveOut<T extends { time: number; level: number }>(rows: T[]): T[] {
  return rows.filter((r) => inSpan(r.level, r.time));
}

/** The rows of `rows` within the span; each other is added to `dropped`, for the stored rows a writer rewrites. */
export function leaveOutInto<T extends { level: number }>(rows: T[], dropped: Dropped): T[] {
  return rows.filter((r) => {
    if (possible(r.level)) return true;
    dropped.add(r.level);
    return false;
  });
}
