import { tooManyWithheld, withheldReason } from "../withhold.ts";
import { isHeld } from "../epochs.ts";
import type { Observation, Source, StoredStation } from "../schema.ts";
import type { StationObservation } from "../store/parquet.ts";
import {
  chunks,
  emptySummary,
  fetchCounting,
  pool,
  refreshStation,
  type RunSummary,
} from "../store/recent.ts";
import type { ObservationStore } from "./live.ts";

const DAY_MS = 86_400_000;

/** Stations read, refreshed and written at a time: a 1-minute source's 7 days are about 10,000 values a station. */
const BATCH = 100;

/**
 * One pass over a source's live stations into the live store: each
 * station's window is read, refreshed from the source and QC'd by
 * `refreshStation`, and only the values that changed are written. Values the source no longer sends are deleted, and so is every
 * value of a station the adapter now withholds, within the limit every other
 * withholding keeps (`tooManyWithheld`). Only the stations `due` says are
 * fetched; by default every live one.
 */
export async function pollSource({
  source,
  stations: all,
  store,
  since,
  now,
  keepDays = 7,
  concurrency = 4,
  due = () => true,
  accept = false,
}: {
  source: Source;
  /** The source's list from the store, withheld stations already left out. */
  stations: StoredStation[];
  store: ObservationStore;
  since: number;
  now: number;
  keepDays?: number;
  concurrency?: number;
  /** Which live stations this pass fetches. */
  due?: (station: StoredStation) => boolean;
  /** Withhold past the limit, as `--accept-withheld` does for the other withholdings. */
  accept?: boolean;
}): Promise<RunSummary> {
  const id = source.metadata.id;
  if (!source.observations && !source.recent) throw new Error(`${id} has no observations`);
  const keepFrom = now - keepDays * DAY_MS;
  // A withholding reaches the adapter as soon as it deploys, before the list's next refresh.
  const held = await store.stations(id);
  const withheld = held.filter((s) => withheldReason(source, s) !== null);
  const known = new Set([...held, ...all.map((s) => s.id)]).size;
  const refused = tooManyWithheld(id, withheld.length, known);
  if (refused && !accept) throw new Error(refused);
  await store.removeStations(withheld);
  const live = polled(source, all).filter(due);
  // A station whose new epoch is held keeps its values but isn't fetched.
  const fetching = live.filter((s) => !isHeld(s.epochs));
  const summary = emptySummary(`poll ${id}`, fetching.length);

  let swept: Map<string, Observation[] | Error> | Error | undefined;
  if (source.recent)
    swept = await fetchCounting(summary, undefined, () =>
      source.recent!(fetching, new Date(since), new Date(now)),
    ).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));

  for (const batch of chunks(live, BATCH)) {
    const previous = Map.groupBy(
      await store.read(
        batch.map((s) => s.id),
        keepFrom,
      ),
      (r) => r.station,
    );
    const changed: StationObservation[] = [];
    const vanished: { station: string; time: number }[] = [];
    await pool(batch, concurrency, async (station) => {
      const had = previous.get(station.id) ?? [];
      const { rows, fresh } = await refreshStation({
        source,
        station,
        previous: had,
        swept,
        since,
        now,
        keepFrom,
        summary,
      });
      // A level that isn't a finite number, which QC flags bad, can't be stored as a Float32 from
      // JSON, so it isn't kept, and isn't counted as new on every pass that sees it again.
      const kept = rows.filter((r) => Number.isFinite(r.level));
      const stored = kept.filter((r) => r.received === now && r.station === station.id).length;
      summary.values -= fresh - stored;
      if (stored) summary.updated++;
      const diff = difference(had, kept);
      changed.push(...diff.changed);
      vanished.push(...diff.vanished.map((time) => ({ station: station.id, time })));
    });
    await store.write(changed);
    await store.remove(vanished);
    if (swept instanceof Map) for (const s of batch) swept.delete(s.id);
  }
  return summary;
}

/**
 * The interval group a station is polled in: its `min_interval_s`, 0 for none, which the scheduler asks hourly, and 0
 * for every station of a source whose metadata sets `poller: "hourly"`.
 */
export function intervalOf(source: Source, station: StoredStation): number {
  return source.metadata.poller === "hourly" ? 0 : (station.min_interval_s ?? 0);
}

/** The stations of a source's list the poller fetches: live, active, with levels and not withheld. */
export function polled(source: Source, stations: StoredStation[]): StoredStation[] {
  return stations.filter(
    (s) =>
      s.live &&
      s.status === "active" &&
      s.products.includes("levels") &&
      withheldReason(source, s.id) === null,
  );
}

/**
 * The rows of `next` that differ from `had` at the same time, and the times
 * `had` holds that `next` doesn't. Levels compare as the 32-bit floats the
 * store keeps, so a value parsed from the source as a double isn't written
 * again on every pass.
 */
export function difference(
  had: StationObservation[],
  next: StationObservation[],
): { changed: StationObservation[]; vanished: number[] } {
  const before = new Map(had.map((r) => [r.time, r]));
  const times = new Set(next.map((r) => r.time));
  const changed = next.filter((r) => {
    const b = before.get(r.time);
    return (
      !b ||
      b.epoch !== r.epoch ||
      Math.fround(b.level) !== Math.fround(r.level) ||
      b.flag !== r.flag ||
      (b.source_flag ?? null) !== (r.source_flag ?? null) ||
      (b.received ?? null) !== (r.received ?? null)
    );
  });
  return { changed, vanished: had.filter((r) => !times.has(r.time)).map((r) => r.time) };
}
