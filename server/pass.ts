/**
 * One pass of the poller over one source, run by server/ingest.ts in a
 * process of its own, so an adapter's state, such as a block or a cached
 * datum check, lasts one pass, as it lasts one run of a workflow.
 *
 *   node server/pass.ts <source> <now ms> <intervals> <seed: 0|1>
 *
 * `intervals` lists the `min_interval_s` values due this pass, separated by
 * commas, with 0 for stations that give none, or `all` for every station.
 * A source whose metadata sets `poller: "hourly"` has every station in one
 * hourly group, 0. Values go to the live store at STILLWELL_LIVE (the live
 * Worker's store endpoint, src/realtime/live.ts). Every pass that ends,
 * failed or not, adds a row to `polls`. Prints the pass's result as JSON on
 * stdout; everything else goes to stderr. The seed argument is accepted and
 * ignored: the live store outlives the poller.
 */
import { emptySummary, formatSummary, type RunSummary } from "../src/store/recent.ts";
import { startedListOf } from "../src/refresh.ts";
import { sourceOf } from "../src/sources/index.ts";
import { storeOfSource } from "../src/store/stores.ts";
import { liveStore } from "../src/realtime/live.ts";
import { intervalOf, polled, pollSource } from "../src/realtime/poll.ts";

/** The first 100 of a list, and how many more there were. */
const capped = (list: string[]): string[] =>
  list.length > 100 ? [...list.slice(0, 100), `and ${list.length - 100} more`] : list;

/** How far back every pass asks, as the hourly workflow's `--hours 12` did, for values sources send late. */
const LOOKBACK_MS = 12 * 3_600_000;

const [id, nowArg, intervals, seeding] = process.argv.slice(2);
if (!id || !nowArg || !intervals || seeding === undefined)
  throw new Error("usage: pass.ts <source> <now ms> <intervals> <seed: 0|1>");
const now = Number(nowArg);
const source = sourceOf(id);
const due = intervals === "all" ? null : new Set(intervals.split(",").map(Number));
const store = liveStore(process.env.STILLWELL_LIVE ?? "");

let summary: RunSummary;
let groups: number[] = [];
try {
  const stations = await startedListOf(storeOfSource(source.metadata), source);
  // A source with no list yet, until its Monthly refresh starts it, has nothing to poll; its list is read again hourly.
  if (!stations) console.error(`${id}: no station list yet; the Monthly refresh starts it`);
  groups = [...new Set(polled(source, stations ?? []).map((s) => intervalOf(source, s)))];
  summary = await pollSource({
    source,
    stations: stations ?? [],
    store,
    since: now - LOOKBACK_MS,
    now,
    due: (s) => due === null || due.has(intervalOf(source, s)),
    accept: process.env.STILLWELL_ACCEPT_WITHHELD === "1",
  });
} catch (error) {
  // A pass that fails still leaves a row, so a source whose passes all fail shows in `polls`.
  summary = emptySummary(`poll ${id}`, 0);
  summary.failed.push(`pass: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
console.error(formatSummary(summary));
// A failed insert still lets the result through, so the scheduler sees a block or a datum change.
try {
  await store.poll({
    source: id,
    started: now,
    finished: Date.now(),
    // An hourly-polled source asks every station each pass, as a pass over all of them does.
    intervals: due && source.metadata.poller !== "hourly" ? [...due] : [],
    // Clean when it ran to the end, wasn't blocked, and some station it asked had something: one that asked none,
    // as with no list, or whose every station failed or went stale, is an outage or a broken adapter.
    ok:
      process.exitCode !== 1 &&
      !summary.blocked &&
      summary.stations > 0 &&
      summary.failed.length + summary.stale.length < summary.stations,
    stations: summary.stations,
    updated: summary.updated,
    values: summary.values,
    // At most the first 100 of each, so a whole-source outage stays inside D1's 2 MB row.
    stale: capped(summary.stale),
    failed: capped(summary.failed),
    blocked: summary.blocked ?? false,
    datum_changed: summary.datumChanged ?? false,
  });
} catch (error) {
  console.error(`${id}: polls not written: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
process.stdout.write(`${JSON.stringify({ summary, intervals: groups, seeded: true })}\n`);
