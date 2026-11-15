/**
 * The years each station's levels came back for, by datum epoch:
 * `stations/backfilled/<source>.json`, a row per station and epoch with its
 * ranges of UTC years, `[from, to)`. Publish turns this and the years file
 * into each station's `missing_years` and its source's `backfill` in
 * `sources.json`.
 *
 * Backfill records the whole years of its run that each epoch's span reaches
 * into, values or empty, leaving out a year whose fetch failed; a run stopped
 * partway records nothing for the stations it was walking. Compaction records
 * a year it folds a station's values from January 1 of, since it carries
 * such a year whole. Whether an empty answer means the source has nothing is
 * publish's call (`missingYears`), from the files as they are then. Ranges
 * are by epoch, so a new epoch, or one a split ends, never inherits years
 * another's walk answered.
 */
import { COMPACTED_SINCE, epochSpans } from "./backfill.ts";
import { splitStarts } from "./epochs.ts";
import type { Epoch, Source, StoredStation } from "./schema.ts";
import { readJsonArray, writeJsonArray } from "./store/parquet.ts";
import { backfilledPath } from "./store/paths.ts";
import { readYears } from "./store/years.ts";

export type Ranges = [number, number][];
/** By station ID, then epoch ID. */
export type Backfilled = Map<string, Map<number, Ranges>>;

/** A source's record; empty when it has none. */
export async function readBackfilled(store: string, source: string): Promise<Backfilled> {
  const rows = ((await readJsonArray(backfilledPath(store, source))) ?? []) as {
    id: string;
    epoch: number;
    years: Ranges;
  }[];
  const record: Backfilled = new Map();
  for (const r of rows) {
    if (!record.has(r.id)) record.set(r.id, new Map());
    record.get(r.id)!.set(r.epoch, r.years);
  }
  return record;
}

export async function writeBackfilled(
  store: string,
  source: string,
  record: Backfilled,
): Promise<void> {
  const rows = [...record]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([id, epochs]) =>
      [...epochs].sort(([a], [b]) => a - b).map(([epoch, years]) => ({ id, epoch, years })),
    );
  await writeJsonArray(backfilledPath(store, source), rows);
}

/**
 * The whole UTC years a run over [start, end) asks for: those from its first
 * January 1 to its last, and the current year too when the run reaches the
 * present. Null when that's none.
 */
export function wholeYears(start: Date, end: Date, now: number): [number, number] | null {
  const startYear = start.getUTCFullYear();
  const from = start.getTime() === Date.UTC(startYear, 0, 1) ? startYear : startYear + 1;
  const endYear = end.getUTCFullYear();
  // A year the run ends partway through counts only when that's the present; later years can't have values yet.
  const boundary = end.getTime() === Date.UTC(endYear, 0, 1);
  const to = Math.min(
    boundary || end.getTime() < now ? endYear : endYear + 1,
    new Date(now).getUTCFullYear() + 1,
  );
  return from < to ? [from, to] : null;
}

/** `ranges` with [from, to) added, merged where they touch, in order. */
export function addRange(ranges: Ranges, from: number, to: number): Ranges {
  const merged: Ranges = [];
  for (const [a, b] of [...ranges, [from, to] as [number, number]].sort((x, y) => x[0] - y[0])) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/** Add `year` to a station's epoch in `record`. */
export function recordYear(record: Backfilled, id: string, epoch: number, year: number): void {
  if (!record.has(id)) record.set(id, new Map());
  const epochs = record.get(id)!;
  epochs.set(epoch, addRange(epochs.get(epoch) ?? [], year, year + 1));
}

/** `record` with every range of `added` merged in. */
export function mergeBackfilled(record: Backfilled, added: Backfilled): Backfilled {
  for (const [id, epochs] of added)
    for (const [epoch, ranges] of epochs)
      for (const [from, to] of ranges)
        for (let y = from; y < to; y++) recordYear(record, id, epoch, y);
  return record;
}

/** Whether [from, to), in milliseconds, reaches into UTC `year`. */
const into = (from: number, to: number, year: number) =>
  from < Date.UTC(year + 1, 0, 1) && to > Date.UTC(year, 0, 1);

/**
 * Record a station's walk over [start, end): each of its whole years
 * (`wholeYears`) that an epoch's span (`epochSpans`) reaches into goes to that
 * epoch, unless it's in `failed`. A year an epoch starts partway through
 * counts, since the walk asked for all of it the epoch holds. The current
 * year counts only for a live station, which compaction carries on from
 * here; another's later months would go unasked.
 */
export function recordWalk(
  record: Backfilled,
  { id, live }: { id: string; live: boolean },
  spans: { epoch: Pick<Epoch, "id">; from: Date; to: Date }[],
  start: Date,
  end: Date,
  now: number,
  failed: Set<number> = new Set(),
): void {
  const years = wholeYears(start, end, now);
  if (!years) return;
  const last = live ? years[1] : Math.min(years[1], new Date(now).getUTCFullYear());
  for (const { epoch, from, to } of spans)
    for (let y = years[0]; y < last; y++)
      if (!failed.has(y) && into(from.getTime(), to.getTime(), y))
        recordYear(record, id, epoch.id, y);
}

/** What `missingYears` knows of one station. */
export type StationYears = {
  /** Years with a file of levels inside its epoch's span. */
  files: Set<number>;
  /** Years with a file in any epoch, which bound the station's record. */
  stored: Set<number>;
  /** Whether a range of an epoch whose span reaches into the year covers it. */
  asked: (year: number) => boolean;
  /** Whether any epoch's span reaches into the year, so a backfill can ask for it. */
  reachable: (year: number) => boolean;
  /** Whether the station is inactive, so years after its record are empty, not unpublished yet. */
  closed: boolean;
  /** Whether the source is polled hourly, so compaction may have written the station's files from `COMPACTED_SINCE` on. */
  compacted: boolean;
};

/**
 * The years from `since` to `through`, inclusive, that a station is missing.
 * A year counts as had when:
 *
 * - no epoch's span reaches into it, so no backfill can ask for it, as before
 *   a current epoch whose source serves only its current reference;
 * - it has a file, at a source that isn't polled hourly, or before
 *   `COMPACTED_SINCE`, when only backfill wrote them;
 * - it has a file, at an hourly source from then on, and a range covers it,
 *   since compaction began in November 2026 and writes a station's first
 *   year from when it was first polled; compaction adds a year to the record
 *   when it folds the station's values from the year's start;
 * - or a range covers it with no file, and the empty answer is sure: the
 *   source answers an outage with an error (`emptyMeansNone`), or the year is
 *   before the station's first stored year or, for an inactive station, after
 *   its last, outside its record. An empty year within the record may be an
 *   outage, so it stays missing, and so does every year of a station with
 *   nothing stored, but at a source whose empty answer is sure. An outage that answers empty at either end of a record
 *   goes unnoticed.
 */
export function missingYears(
  station: StationYears,
  emptyMeansNone: boolean,
  since: number,
  through: number,
): number[] {
  const { files, stored, asked, reachable, closed, compacted } = station;
  const first = Math.min(...stored);
  const last = Math.max(...stored);
  const sure = (y: number) =>
    emptyMeansNone || (stored.size > 0 && (y < first || (closed && y > last)));
  const missing: number[] = [];
  for (let y = since; y <= through; y++) {
    const had = !reachable(y)
      ? true
      : files.has(y)
        ? y < COMPACTED_SINCE || !compacted || asked(y)
        : asked(y) && sure(y);
    if (!had) missing.push(y);
  }
  return missing;
}

/**
 * A source's completeness: `since`, the first year any of `stations` has a
 * file of levels, and each station's `missingYears` from then on: to this
 * year for a live station, which compaction carries, and otherwise to the
 * year after its last stored one or the last year a range covers, whichever
 * is later, so a run cut short shows, but not this year, which only a
 * refetch brings. A station a run marked in the years file may have files
 * without rows, and one whose epochs can't be walked has no span, so neither
 * has any. Null where the source has no years file, so which years it holds
 * isn't known.
 */
export async function backfillStatus(
  store: string,
  source: Pick<Source, "metadata" | "overrides">,
  stations: Pick<StoredStation, "id" | "products" | "epochs" | "live" | "status">[],
  now: number,
): Promise<{ since: number | null; missing: Map<string, number[]> } | null> {
  const id = source.metadata.id;
  const rows = await readYears(store, id);
  if (!rows) return null;
  const record = await readBackfilled(store, id);
  // Only the listed stations', so one withheld or removed doesn't move `since`.
  const byId = new Map(stations.map((s) => [s.id, s]));
  const byFile = new Map<string, { epoch: number; year: number }[]>();
  const marked = new Set<string>();
  let first = Infinity;
  for (const { id: station, epoch, year } of rows.values()) {
    if (!byId.has(station)) continue;
    if (year === null || epoch === null) {
      marked.add(station);
      continue;
    }
    first = Math.min(first, year);
    if (!byFile.has(station)) byFile.set(station, []);
    byFile.get(station)!.push({ epoch, year });
  }
  const since = Number.isFinite(first) ? first : null;
  const missing = new Map<string, number[]>();
  if (since === null) return { since, missing };
  const current = new Date(now).getUTCFullYear();
  for (const s of stations) {
    if (!s.products.includes("levels") || marked.has(s.id)) continue;
    // What a backfill from `since` to now would walk; a station with no open epoch has none.
    let spans: { epoch: number; from: number; to: number }[];
    try {
      spans = epochSpans(
        s.epochs,
        new Date(Date.UTC(since, 0, 1)),
        new Date(Date.UTC(current + 1, 0, 1)),
        source.metadata.archive,
        splitStarts(source.overrides?.splits?.[s.id], source.metadata.utc_offsets ?? [0, 0]),
      ).map(({ epoch, from, to }) => ({ epoch: epoch.id, from: from.getTime(), to: to.getTime() }));
    } catch {
      continue;
    }
    const ranges = record.get(s.id) ?? new Map<number, Ranges>();
    const files = new Set<number>();
    const stored = new Set<number>();
    for (const { epoch, year } of byFile.get(s.id) ?? []) {
      stored.add(year);
      // A file outside the span a walk of its epoch reaches, as after a split, isn't in the station's series.
      if (spans.some((span) => span.epoch === epoch && into(span.from, span.to, year)))
        files.add(year);
    }
    const asked = (y: number) =>
      spans.some(
        (span) =>
          into(span.from, span.to, y) &&
          (ranges.get(span.epoch) ?? []).some(([a, b]) => y >= a && y < b),
      );
    let end = -Infinity;
    for (const y of stored) end = Math.max(end, y + 1);
    for (const r of ranges.values()) for (const [, b] of r) end = Math.max(end, b - 1);
    // On January 1 compaction hasn't folded the new year yet, so a live station is judged to the last.
    const live = now >= Date.UTC(current, 0, 2, 1) ? current : current - 1;
    // Never before `since`, so a station with nothing judged isn't complete for want of years.
    const through = Math.max(
      since,
      s.live ? live : Math.min(current - 1, end === -Infinity ? current : end),
    );
    missing.set(
      s.id,
      missingYears(
        {
          files,
          stored,
          asked,
          reachable: (y) => spans.some((span) => into(span.from, span.to, y)),
          closed: s.status === "inactive",
          compacted: source.metadata.hourly,
        },
        source.metadata.empty_means_none ?? false,
        since,
        through,
      ),
    );
  }
  return { since, missing };
}
