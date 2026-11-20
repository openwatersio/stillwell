/**
 * Writes one source's daily files, `recent/<source>/<YYYY-MM-DD>.parquet`, from the live store, run by
 * server/ingest.ts in a process of its own so a large day's file doesn't hold the poller's memory
 * (docs/plans/cloudflare.md, The daily files).
 *
 *   node server/export.ts <source> <YYYY-MM-DD,...>
 *
 * A day with no values writes no file, so a missing day stays missing rather than empty.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { liveStore } from "../src/realtime/live.ts";
import { writeRecent, type StationObservation } from "../src/store/parquet.ts";
import { recentDayPath } from "../src/store/paths.ts";

/** Stations a page holds: a 1-minute station's day is 1,440 values. */
const PAGE = 500;

const [source, days] = process.argv.slice(2);
if (!source || !days) throw new Error("usage: export.ts <source> <YYYY-MM-DD,...>");
const store = liveStore(process.env.STILLWELL_LIVE ?? "");
const dir = mkdtempSync(join(tmpdir(), "export-"));
try {
  for (const day of days.split(",")) {
    let values = 0;
    async function* pages(): AsyncIterable<StationObservation[]> {
      for (let after = ""; ;) {
        const page = await store.day(source!, day, after, PAGE);
        values += page.rows.length;
        if (page.rows.length) yield page.rows;
        if (!page.next) return;
        after = page.next;
      }
    }
    const local = join(dir, `${day}.parquet`);
    await writeRecent(local, pages());
    if (!values) {
      console.error(`${source} ${day}: no values`);
      continue;
    }
    await store.put(recentDayPath("", source, day).slice(1), readFileSync(local));
    console.error(`${source} ${day}: ${values} values`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
