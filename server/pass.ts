/**
 * One pass of stillwell-ingest over one source, run by server/ingest.ts in a
 * process of its own, so an adapter's state, such as a block or a cached
 * datum check, lasts one pass, as it lasts one run of a workflow.
 *
 *   node server/pass.ts <source> <now ms> <intervals> <seed: 0|1>
 *
 * `intervals` lists the `min_interval_s` values due this pass, separated by
 * commas, with 0 for stations that give none, or `all` for every station.
 * Every pass that ends, failed or not, adds a row to `polls`. Prints the pass's result
 * as JSON on stdout; everything else goes to stderr.
 *
 * A source named in STILLWELL_FROM_RECENT (comma-separated) isn't asked at all:
 * each pass, hourly, brings ClickHouse's window into line with the
 * recent/<source>.parquet the hourly workflow writes (`fillFromRecent`), for a
 * source that refuses the server.
 */
import { emptySummary, formatSummary, type RunSummary } from "../src/store/recent.ts";
import { startedListOf } from "../src/refresh.ts";
import { sourceOf } from "../src/sources/index.ts";
import { storeFor, storeOfSource } from "../src/store/stores.ts";
import { clickhouse, databaseFor, observationStore } from "../src/realtime/clickhouse.ts";
import { fillFromRecent, polled, pollSource, seedFromRecent } from "../src/realtime/poll.ts";

/** How far back every pass asks, as the hourly workflow's `--hours 12` did, for values sources send late. */
const LOOKBACK_MS = 12 * 3_600_000;

const [id, nowArg, intervals, seeding] = process.argv.slice(2);
if (!id || !nowArg || !intervals || seeding === undefined)
  throw new Error("usage: pass.ts <source> <now ms> <intervals> <seed: 0|1>");
const now = Number(nowArg);
const source = sourceOf(id);
const due = intervals === "all" ? null : new Set(intervals.split(",").map(Number));
const ch = clickhouse(databaseFor(source));
const store = observationStore(ch);

const fromRecent = (process.env.STILLWELL_FROM_RECENT ?? "")
  .split(",")
  .map((s) => s.trim())
  .includes(id);

let summary: RunSummary;
let groups: number[] = [];
let seeded = seeding !== "1";
try {
  const stations = await startedListOf(storeOfSource(source.metadata), source);
  // A source with no list yet, until its Monthly refresh starts it, has nothing to poll; its list is read again hourly.
  if (!stations) console.error(`${id}: no station list yet; the Monthly refresh starts it`);
  // Filled from recent/, which changes hourly, so every station is one hourly group.
  groups = fromRecent
    ? polled(source, stations ?? []).length
      ? [0]
      : []
    : [...new Set(polled(source, stations ?? []).map((s) => s.min_interval_s ?? 0))];
  if (fromRecent) {
    summary = await fillFromRecent({
      source,
      stations: stations ?? [],
      storeFor,
      store,
      now,
      accept: process.env.STILLWELL_ACCEPT_WITHHELD === "1",
    });
    seeded = true;
  } else {
    // A seed that fails doesn't stop the poll; the next pass seeds again.
    if (!seeded && stations)
      try {
        const added = await seedFromRecent({ source, stations, storeFor, store, now });
        if (added) console.error(`${id}: added ${added} values from recent/`);
        seeded = true;
      } catch (error) {
        console.error(`${id}: seed failed: ${error instanceof Error ? error.message : error}`);
      }
    summary = await pollSource({
      source,
      stations: stations ?? [],
      store,
      since: now - LOOKBACK_MS,
      now,
      due: (s) => due === null || due.has(s.min_interval_s ?? 0),
      accept: process.env.STILLWELL_ACCEPT_WITHHELD === "1",
    });
  }
} catch (error) {
  // A pass that fails still leaves a row, so a source whose passes all fail shows in `polls`.
  summary = emptySummary(`poll ${id}`, 0);
  summary.failed.push(`pass: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
console.error(formatSummary(summary));
// A failed insert still lets the result through, so the scheduler sees a block or a datum change.
try {
  await ch.insert("polls", [
    {
      source: id,
      started: new Date(now).toISOString(),
      finished: new Date().toISOString(),
      // A fill covers every station, as a pass over all of them does.
      intervals: due && !fromRecent ? [...due] : [],
      // Clean when it ran to the end and the source answered for some station it asked.
      ok: process.exitCode !== 1 && (!summary.stations || summary.failed.length < summary.stations),
      stations: summary.stations,
      updated: summary.updated,
      values: summary.values,
      stale: summary.stale,
      failed: summary.failed,
      blocked: summary.blocked ?? false,
      datum_changed: summary.datumChanged ?? false,
    },
  ]);
} catch (error) {
  console.error(`${id}: polls not written: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
}
process.stdout.write(`${JSON.stringify({ summary, intervals: groups, seeded })}\n`);
