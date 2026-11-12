import { commitYears, markYears, reconcileYears } from "./years.ts";
import { withheldReason } from "../withhold.ts";
import { Blocked } from "../http.ts";
import { FLATLINE_S, fromSource, qc, withSourceFlag, type QcOptions } from "../qc.ts";
import { DatumChanged, isHeld, recentWindow } from "../epochs.ts";
import {
  Flag,
  type Epoch,
  type StoredStation,
  type Observation,
  type Source,
  type Station,
} from "../schema.ts";
import { mergeFetched, sameRows, upsert } from "./merge.ts";
import {
  checkRecent,
  readDatums,
  listFiles,
  readObservationFile,
  readRecent,
  readStationBounds,
  readTimeBounds,
  type StationBounds,
  recentStations,
  writeObservations,
  type YearStats,
  writeRecent,
  writeStationBounds,
  type StationObservation,
} from "./parquet.ts";
import {
  boundsPath,
  recentPath,
  seriesPath,
  sourceEpochDirs,
  sourceFirstEpochFiles,
} from "./paths.ts";

/**
 * The scheduled jobs: `updateRecent` merges a fetch into each source's
 * recent/<source>.parquet every hour, and `compactRecent` folds the days in it
 * into each station's year files once a day.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** A batch of stations read, merged and written at a time: every live USGS station's window is about 9 million values. */
const BATCH = 500;

/** What a run did, for its log and the workflow's summary. */
export interface RunSummary {
  title: string;
  /** Stations the run looked at. */
  stations: number;
  /** Stations that sent new values (recent), or whose year files changed (compact). */
  updated: number;
  /** Stations with nothing recent enough, by ID. */
  stale: string[];
  /** Stations the run couldn't fetch or write, with why. */
  failed: string[];
  /** Whether the source blocked this client partway, so the stations after it failed without asking. */
  blocked?: boolean;
  /** Whether a station failed because its source now reports it in another datum, which a station refresh handles. */
  datumChanged?: boolean;
  /** Stations whose values wait in the window for a decision on a held datum change. */
  waiting: string[];
  /** Stations the run judged with less than it should, such as without some errata spans, with why. */
  warned?: string[];
  /** Values new to the store. */
  values: number;
  /** Files written. */
  files: number;
  /** Seconds spent in each phase of the run, in the order they first ran. */
  seconds?: Record<string, number>;
}

/** Runs a phase of work and adds the time it took to its phase's total. */
export type Timer = <T>(phase: string, work: () => Promise<T>) => Promise<T>;

/**
 * A timer that adds each phase's seconds to `seconds` and logs each phase as
 * it starts and ends, so a run stopped at its time limit still shows where
 * the time went and which phase it stopped in.
 */
export function timer(title: string, seconds: Record<string, number>): Timer {
  return async (phase, work) => {
    const began = performance.now();
    console.log(`${title}: ${phase}…`);
    try {
      return await work();
    } finally {
      const took = (performance.now() - began) / 1000;
      seconds[phase] = (seconds[phase] ?? 0) + took;
      console.log(`${title}: ${phase} ${took.toFixed(1)}s`);
    }
  };
}

interface RunOptions {
  source: Source;
  /** The source's list from the store; each job picks the stations it covers. */
  stations: StoredStation[];
  /** The store a station's files go to, public or restricted. */
  storeFor: (station: Station) => string;
  /** How many stations to fetch, or files to merge, at once. */
  concurrency?: number;
}

/**
 * Fetch [since, now) for every live station and merge it into the source's
 * recent window, keeping `keepDays` days. A value first seen in this run gets
 * `received` = `now`; one seen before keeps its first arrival. A station whose
 * fetch fails, or brings nothing, keeps what it had, so a source with a short
 * window of its own never loses values to an outage. A station fetched on its
 * own looks back at least two of its intervals, so a daily gauge that
 * publishes hours late still gets each value.
 *
 * Each row carries the datum epoch it belongs to. A station's rows from
 * before its current epoch stay as they are, for compaction to fold into
 * their own epoch's files, and fetching never reaches back before the current
 * epoch's start. A station whose new epoch is held isn't fetched,
 * but keeps what it had.
 *
 * A station is stale when its newest value is older than three of its
 * intervals, and at least `staleHours`.
 */
export async function updateRecent({
  source,
  stations: all,
  storeFor,
  concurrency = 4,
  since,
  now,
  keepDays = 7,
  staleHours = 6,
}: RunOptions & {
  since: Date;
  now: number;
  keepDays?: number;
  staleHours?: number;
}): Promise<RunSummary> {
  const id = source.metadata.id;
  if (!source.observations && !source.recent) throw new Error(`${id} has no observations`);
  const live = all.filter((s) => s.live && s.status === "active" && s.products.includes("levels"));
  const stations = live.filter((s) => !isHeld(s.epochs));
  const keepFrom = now - keepDays * DAY_MS;
  // Restricted stations' recent values go to the private store, like their series.
  const storeOf = (s: Station): string | undefined => {
    try {
      return recentPath(storeFor(s), id);
    } catch {
      return undefined;
    }
  };
  const summary = emptySummary(`recent ${id}`, stations.length);
  // A station whose store can't be named, such as a restricted one with no
  // restricted store set, fails alone rather than stop the source's run.
  const pathOf = new Map<string, string>();
  for (const s of live)
    try {
      pathOf.set(s.id, recentPath(storeFor(s), id));
    } catch (error) {
      summary.failed.push(`${s.id}: ${message(error)}`);
    }
  const reporting = new Set<string>();

  // Each file is read in batches after the sweep, so one that can't be read
  // fails the run here, before the sweep spends a source's request budget.
  const candidates = new Set([...pathOf.values(), ...all.flatMap((s) => storeOf(s) ?? [])]);
  for (const path of candidates) await checkRecent(path);

  // Listed stations a file holds that this run doesn't fetch, because they've
  // stopped being live or active since, keep their rows until they age out, so
  // compaction can still fold them. One whose license now sends it to the other
  // store doesn't, so its rows never stay in the wrong one, and it starts empty
  // in its new store rather than carry rows across. A station gone from the list
  // has nowhere to be folded, so its rows go.
  const listed = new Map(all.map((s) => [s.id, s]));
  const carried = new Map<string, string[]>();
  for (const path of candidates) {
    const ids = (await recentStations(path)).filter((station) => {
      if (pathOf.has(station)) return false;
      const s = listed.get(station);
      return s !== undefined && storeOf(s) === path;
    });
    if (ids.length) carried.set(path, ids);
  }
  const fetched = new Set(pathOf.values());
  const paths = [...candidates].filter((path) => carried.has(path) || fetched.has(path));

  // A source that can sweep every station at once does; a failed sweep fails
  // every station, which keeps what each had.
  let swept: Map<string, Observation[] | Error> | Error | undefined;
  if (source.recent)
    swept = await source
      .recent(
        stations.filter((s) => pathOf.has(s.id)),
        since,
        new Date(now),
      )
      .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));

  async function* batches(path: string): AsyncGenerator<StationObservation[]> {
    for (const ids of chunks(carried.get(path) ?? [], BATCH))
      yield (await readRecent(path, ids)).filter((r) => r.time >= keepFrom);
    for (const batch of chunks(
      live.filter((s) => pathOf.get(s.id) === path),
      BATCH,
    )) {
      const ids = batch.map((s) => s.id);
      const previous = Map.groupBy(await readRecent(path, ids), (r) => r.station);
      const rows: StationObservation[] = [];
      await pool(batch, concurrency, async (station) => {
        const lookback = swept
          ? since.getTime()
          : Math.min(since.getTime(), now - 2 * (station.interval_s ?? 0) * 1000);
        const window = recentWindow(
          station.epochs,
          previous.get(station.id) ?? [],
          keepFrom,
          lookback,
        );
        // Rows from other epochs are in another reference, and stay as they are.
        rows.push(...window.other);
        if (isHeld(station.epochs)) {
          rows.push(...window.current);
          return;
        }
        let merged: Observation[] = window.current;
        let failed = false;
        try {
          if (swept instanceof Error) throw swept;
          const answer = swept ? swept.get(station.id) : undefined;
          if (answer instanceof Error) throw answer;
          // A sweep covers the whole window, so values from before the current epoch are left out.
          const got = swept
            ? (answer ?? []).filter((o) => o.time >= window.from)
            : await source.observations!(station, new Date(window.from), new Date(now));
          // QC the whole window, so spikes and flatlines are judged against their neighbors.
          // What we had starts again from the source's flags, so a mark can clear,
          // except within a flatline's length of the window's start, where a run
          // that began before it can't be seen whole, and compaction folds those days.
          // Nothing new keeps what we had, rather than clearing the last hours.
          if (got.length) {
            const had = window.current;
            const opts = qcFor(station);
            // The longest run any flatline rule needs to see.
            const longest = Math.max(
              opts.flatline_s ?? FLATLINE_S,
              opts.centimeter_flatline_s ?? 0,
            );
            const edge = (had[0]?.time ?? 0) + longest * 1000;
            // A source that can't judge a part of its record keeps the flags stored.
            const suspect = await source
              .suspect?.(station, async function* () {
                yield had;
              })
              .catch(() => null);
            const start =
              suspect === null
                ? had
                : [
                    ...had.filter((r) => r.time < edge),
                    ...fromSource(
                      had.filter((r) => r.time >= edge),
                      suspect,
                    ),
                  ];
            // Seven days can't fit a tide, so residual jumps wait for the year's requalify.
            merged = qc(mergeFetched(start, withSourceFlag(got), window.from, now, now), {
              ...opts,
              jumps: false,
            });
          }
        } catch (error) {
          // Keep what we had; a failed fetch mustn't empty the window.
          summary.failed.push(`${station.id}: ${message(error)}`);
          if (error instanceof Blocked) summary.blocked = true;
          // A refresh ignores a rejected change, matched on datum and
          // reference as nextEpochs does, so that one doesn't ask for one; an
          // unknown reference matches none.
          if (
            error instanceof DatumChanged &&
            !station.epochs.some(
              (e) =>
                e.state === "rejected" &&
                e.datum === error.datum &&
                e.reference === error.reference,
            )
          )
            summary.datumChanged = true;
          failed = true;
        }
        for (const r of merged) rows.push({ ...r, station: station.id, epoch: window.epoch });
        const fresh = merged.filter((r) => r.received === now).length;
        if (fresh) reporting.add(station.id);
        summary.values += fresh;
        const newest = merged.at(-1)?.time ?? -Infinity;
        const staleAfter = Math.max(staleHours * HOUR_MS, 3 * (station.interval_s ?? 0) * 1000);
        if (!failed && newest < now - staleAfter) summary.stale.push(station.id);
      });
      if (swept instanceof Map) for (const id of ids) swept.delete(id);
      yield rows;
    }
  }
  for (const path of paths) {
    await writeRecent(path, batches(path));
    summary.files++;
  }
  summary.updated = reporting.size;
  return summary;
}

/**
 * Fold the recent window's values in [start, end) into each station's year
 * files, each row into its own datum epoch's, carrying `received`, as `upsert`
 * merges them. A year file is read, merged and written whole, so a failed run
 * leaves the file it had; one the fold doesn't change isn't written. Inactive
 * stations are folded too, so the last values of a station retired since they
 * arrived still reach its files, as are those of a station whose list no
 * longer has `levels`. A live, active station with levels and no values in the
 * range is stale. Values at or after a held epoch's start wait in the window,
 * reported but not failed, and those older than the window when the hold
 * is decided need a backfill. Then it writes the source's bounds (`updateBounds`).
 */
export async function compactRecent({
  source,
  stations: all,
  storeFor,
  concurrency = 8,
  start,
  end,
  rebuildBounds = false,
}: RunOptions & { start: number; end: number; rebuildBounds?: boolean }): Promise<RunSummary> {
  const id = source.metadata.id;
  const summary = emptySummary(`compact ${id}`, 0);
  const seconds: Record<string, number> = {};
  summary.seconds = seconds;
  const time = timer(summary.title, seconds);
  // A station whose store can't be named, such as a restricted one with no
  // restricted store set, fails alone rather than stop the source's fold.
  // A station without levels has rows only from before its list dropped them,
  // and one of those whose store can't be named has none to fold there.
  const levels = (s: Station) => s.products.includes("levels");
  const pathOf = new Map<string, string>();
  for (const s of all)
    try {
      pathOf.set(s.id, recentPath(storeFor(s), id));
    } catch (error) {
      if (levels(s)) summary.failed.push(`${s.id}: ${message(error)}`);
    }
  const stations = all.filter((s) => pathOf.has(s.id));
  summary.stations = stations.filter(levels).length + summary.failed.length;
  // The span of each year file this run read whole, by `spanKey`, for the bounds.
  const spans = new Map<string, FileBounds | null>();
  // Stations whose fold the years file may not have recorded, for the reconcile to read.
  const unmarked: string[] = [];

  for (const path of new Set(pathOf.values())) {
    for (const batch of chunks(
      stations.filter((s) => pathOf.get(s.id) === path),
      BATCH,
    )) {
      const window = Map.groupBy(
        (
          await time("read window", () =>
            readRecent(
              path,
              batch.map((s) => s.id),
            ),
          )
        ).filter((r) => r.time >= start && r.time < end),
        (r) => r.station,
      );
      const store = storeFor(batch[0]!);
      const folding = [...window.keys()];
      const written = new Map<string, YearStats>();
      // A batch that can't be marked still folds, since its rows age out of
      // the window; the reconcile below reads its stations' files instead.
      let marked: string[] = [];
      try {
        marked = await time("mark years", () => markYears(store, id, folding));
      } catch (error) {
        summary.failed.push(`years: ${message(error)}`);
        unmarked.push(...folding);
      }
      await time("fold", () =>
        pool(batch, concurrency, async (station) => {
          const rows = window.get(station.id);
          // A live station sends something every day; one that isn't live may not.
          if (!rows?.length) {
            // A held station isn't fetched, so it has nothing once its rows age out.
            if (
              station.live &&
              station.status === "active" &&
              levels(station) &&
              !isHeld(station.epochs)
            )
              summary.stale.push(station.id);
            return;
          }
          let changed = false;
          // A row goes to the epoch its time falls in, as the next hourly run
          // would move it: a refresh can open an epoch whose start is in the
          // past after the window's rows were tagged. Rows at or after a held
          // epoch's start wait in the window for a decision.
          const heldFrom = Math.min(
            ...station.epochs
              .filter((e) => e.state === "held" && e.since !== null)
              .map((e) => Date.parse(e.since!)),
          );
          const waiting = rows.filter((r) => r.time >= heldFrom);
          if (waiting.length) summary.waiting.push(`${station.id}: ${waiting.length} values`);
          const parts = Map.groupBy(
            rows.filter((r) => r.time < heldFrom),
            (r) => `${epochAt(station.epochs, r)} ${new Date(r.time).getUTCFullYear()}`,
          );
          for (const [key, values] of parts) {
            const [epochId, year] = key.split(" ").map(Number) as [number, number];
            const label =
              epochId === 1 ? `${station.id} ${year}` : `${station.id} epoch ${epochId} ${year}`;
            try {
              // Rows of an epoch the list doesn't have, such as after a restore,
              // have no datum to be written in.
              const epoch = station.epochs.find((e) => e.id === epochId);
              if (!epoch) throw new Error(`the list has no epoch ${epochId}`);
              const file = seriesPath(
                storeFor(station),
                "levels",
                id,
                station.source_id,
                year,
                epochId,
              );
              const existing = await readObservationFile(file);
              await refuseOtherDatum(file, { ...station, datum: epoch.datum }, existing.datums);
              const incoming = values.map(({ station: _, epoch: __, ...r }) => r as Observation);
              const merged = upsert(existing.rows, incoming);
              const span = spanOf(merged, epochWindow(station.epochs, epochId));
              const key = spanKey(station, epochId, year);
              if (sameRows(existing.rows, merged)) {
                spans.set(key, span);
                continue;
              }
              written.set(file, await writeObservations(file, merged, epoch.datum));
              spans.set(key, span);
              summary.files++;
              const had = new Map(existing.rows.map((r) => [r.time, r]));
              summary.values += merged.filter((r) => {
                const before = had.get(r.time);
                return !before || !sameRows([before], [r]);
              }).length;
              changed = true;
            } catch (error) {
              summary.failed.push(`${label}: ${message(error)}`);
            }
          }
          if (changed) summary.updated++;
        }),
      );
      try {
        await time("commit years", () => commitYears(store, id, marked, written));
      } catch (error) {
        summary.failed.push(`years: ${message(error)}`);
        unmarked.push(...folding);
      }
    }
  }
  // A source's stations share its store, so this is one store. A failure goes
  // first, so the summary's list of failures shows it.
  for (const [store, members] of Map.groupBy(stations, (s) => storeFor(s)))
    try {
      await updateBounds({
        store,
        source: id,
        stations: members,
        spans,
        year: new Date(end).getUTCFullYear(),
        rebuild: rebuildBounds,
        concurrency,
        time,
      });
    } catch (error) {
      summary.failed.unshift(`bounds: ${message(error)}`);
    }
  // Rows a run that stopped partway left out of date, and files written without a row.
  for (const store of new Set(stations.map((s) => storeFor(s))))
    try {
      const years = await reconcileYears(store, id, {
        keep: (station) => withheldReason(source, station) === null,
        reread: unmarked,
        // Enough for a stopped run's stations, and short of compaction's time limit; an unfinished `years` build goes on a night at a time.
        limit: 5000,
        concurrency,
        time,
      });
      for (const file of years?.failed ?? []) summary.failed.push(`years: can't read ${file}`);
    } catch (error) {
      summary.failed.unshift(`years: ${message(error)}`);
    }
  return summary;
}

type Span = [number, number];

/**
 * How many years before the current one the monthly refetch reaches back
 * (`backfill … preliminary` from January of that year, in monthly.yml), and
 * so how far back compaction looks for a station's first preliminary value.
 */
export const REFETCH_YEARS = 3;

/**
 * A year file's earliest and latest counted row, its earliest preliminary one
 * or null, and whether any is one the source screened.
 */
type FileBounds = [number, number, number | null, boolean];

/** A station's year file in one epoch, as `updateBounds` names it. */
function spanKey(station: Pick<Station, "source_id">, epoch: number, year: number): string {
  return `${encodeURIComponent(station.source_id)} ${epoch} ${year}`;
}

/**
 * The times an epoch's files count in, `[since, until)`; null for an epoch
 * whose files aren't part of the series: a held one, or one the list doesn't
 * have, such as after a restore.
 */
function epochWindow(epochs: Epoch[], id: number): Span | null {
  const epoch = epochs.find((e) => e.id === id);
  if (!epoch || epoch.state === "held") return null;
  return [
    epoch.since ? Date.parse(epoch.since) : -Infinity,
    epoch.until ? Date.parse(epoch.until) : Infinity,
  ];
}

/**
 * The earliest and latest of `rows` inside `window`, and the earliest there
 * the source sent as preliminary, or null when none are inside.
 */
function spanOf(rows: Observation[], window: Span | null): FileBounds | null {
  if (!window) return null;
  // A loop, not Math.min(...): a one-minute year file has too many rows to spread.
  let [first, last, preliminary, screened] = [Infinity, -Infinity, Infinity, false];
  for (const { time, flag, source_flag } of rows)
    if (time >= window[0] && time < window[1]) {
      if (time < first) first = time;
      if (time > last) last = time;
      // As readTimeBounds: without `source_flag`, only a good or interpolated flag is the source's.
      if (source_flag === undefined ? flag < Flag.preliminary : source_flag !== Flag.preliminary)
        screened = true;
      if ((source_flag ?? flag) === Flag.preliminary && time < preliminary) preliminary = time;
    }
  return first <= last
    ? [first, last, preliminary < Infinity ? preliminary : null, screened]
    : null;
}

/**
 * Write each station's first and last level to the source's bounds in
 * `store`, over the rows its epochs count: each epoch's files within its
 * `[since, until)`, and none of a held epoch's or one the list doesn't have.
 * Beside them goes the earliest value in the current epoch the source sent as
 * preliminary, which the monthly refetch fetches again from; backfill writes
 * only the current epoch, so earlier epochs' values can't be refetched.
 *
 * A listing of the source's files gives each station's first and last year.
 * The files of those years come from `spans`, which compaction read whole
 * this run; or else from the bound already known, when it's in that year,
 * still inside an epoch, and the year is before last year; or else from a
 * read. So a backfill of earlier years is read, as is any end year from last
 * year on that compaction didn't fold, where backfills of a new station's
 * first weeks and a station that isn't live land. A first run, or `rebuild`,
 * reads every station's end years.
 *
 * The earliest preliminary value is the one already known, or else one in a
 * file compaction folded, whichever is earlier; backfill, which can finalize
 * it, writes its own (`writePreliminary`). A station new to the bounds, or
 * every station on a rebuild, has the current epoch's files read from
 * `REFETCH_YEARS` before this year on until one holds a preliminary value,
 * which for a station with none is at most four files. A bounds file an older build wrote without the column
 * keeps none until a rebuild.
 *
 * shortcut: a backfill within a station's first or last year, when that year
 * is before last year, isn't seen, nor are rows an epoch's widened span takes
 * in; `compact --rebuild-bounds` reads every station again.
 */
export async function updateBounds({
  store,
  source,
  stations,
  spans,
  year: thisYear,
  rebuild = false,
  concurrency = 8,
  time = (_, work) => work(),
}: {
  store: string;
  source: string;
  stations: StoredStation[];
  spans: Map<string, FileBounds | null>;
  /** The year compaction ran up to. */
  year: number;
  rebuild?: boolean;
  concurrency?: number;
  time?: Timer;
}): Promise<void> {
  const path = boundsPath(store, source);
  const had = await time("bounds: read bounds", () => readStationBounds(path));
  const known = rebuild ? new Map<string, never>() : had;
  // Bounds an older build wrote, without `preliminary`, stay without it until
  // a rebuild: filling it in reads nearly every file, too long for a nightly run.
  const legacy = [...known.values()].some((b) => b.preliminary === undefined);
  // Files by station directory, then year: epoch 1's beside later epochs' directories.
  const listed = new Map<string, Map<number, { epoch: number; file: string }[]>>();
  for (const [pattern, depth] of [
    [sourceFirstEpochFiles(store, "levels", source), 2],
    [sourceEpochDirs(store, "levels", source), 3],
  ] as const)
    for (const file of await time("bounds: list files", () => listFiles(pattern))) {
      const parts = file.split("/");
      const year = Number(parts.at(-1)!.replace(/\.parquet$/, ""));
      const epoch = depth === 2 ? 1 : Number(parts.at(-2));
      if (!Number.isInteger(year) || !Number.isInteger(epoch)) continue;
      const dir = parts.at(-depth)!;
      const byYear = listed.get(dir) ?? new Map<number, { epoch: number; file: string }[]>();
      byYear.set(year, [...(byYear.get(year) ?? []), { epoch, file }]);
      listed.set(dir, byYear);
    }
  // A listing that finds nothing when the store had bounds is a wrong path or a failed list, not a store emptied.
  if (!listed.size && had.size)
    throw new Error(`no ${source} files listed in ${store}, yet it has bounds; keeping them`);

  // Each end of each station: its counted years from that end inward, and
  // the bound kept there, if any.
  type File = { file: string; key: string; window: Span; epoch: number };
  // Pick 0 is first, 1 last, and 2 the earliest preliminary, over the current epoch alone.
  type End = { id: string; pick: 0 | 1 | 2; years: File[][]; at: number; value?: number | null };
  const ends: End[] = [];
  // Each station's current-epoch files, for `screened`.
  const own = new Map<string, File[]>();
  for (const station of stations) {
    const dir = encodeURIComponent(station.source_id);
    const counted = new Map<number, File[]>();
    for (const [year, files] of listed.get(dir) ?? [])
      for (const { epoch, file } of files) {
        const window = epochWindow(station.epochs, epoch);
        if (window)
          counted.set(year, [
            ...(counted.get(year) ?? []),
            { file, key: spanKey(station, epoch, year), window, epoch },
          ]);
      }
    const ascending = [...counted.keys()].sort((x, y) => x - y);
    const current = station.epochs.filter((e) => e.state === "open").at(-1);
    const window = current && epochWindow(station.epochs, current.id);
    // Earlier years are never refetched, so their values aren't looked for.
    const years = ascending
      .filter((y) => y >= thisYear - REFETCH_YEARS)
      .map((y) => counted.get(y)!.filter((f) => f.epoch === current?.id))
      .filter((files) => files.length);
    own.set(
      station.id,
      ascending.flatMap((y) => counted.get(y)!.filter((f) => f.epoch === current?.id)),
    );
    const preliminary: End = { id: station.id, pick: 2, years, at: 0 };
    const prior = known.get(station.id)?.preliminary;
    const time = prior ? Date.parse(prior) : NaN;
    // One from an earlier epoch says nothing of this one's files, so they're read like a new station's.
    const stale = prior && !(window && time >= window[0] && time < window[1]);
    if (prior !== undefined && !stale) {
      // Known, and kept unless a file folded this run holds an earlier one.
      const times = years.flat().flatMap((f) => spans.get(f.key)?.[2] ?? []);
      if (prior) times.push(time);
      preliminary.value = times.length ? Math.min(...times) : null;
    }
    if (!legacy) ends.push(preliminary);
    for (const pick of [0, 1] as const) {
      const years = (pick === 0 ? ascending : ascending.toReversed()).map((y) => counted.get(y)!);
      const end: End = { id: station.id, pick, years, at: 0 };
      const bound = known.get(station.id)?.[pick === 0 ? "first" : "last"];
      const time = bound ? Date.parse(bound) : NaN;
      const year = (pick === 0 ? ascending[0] : ascending.at(-1)) ?? NaN;
      const files = years[0] ?? [];
      if (
        new Date(time).getUTCFullYear() === year &&
        year < thisYear - 1 &&
        files.some((f) => time >= f.window[0] && time < f.window[1]) &&
        !files.some((f) => spans.has(f.key))
      )
        end.value = time;
      ends.push(end);
    }
  }

  // Each end's year is read, files compaction didn't give in batches at once;
  // a year with no counted rows moves the end a year inward.
  let readCount = 0;
  for (let open = ends.filter((e) => e.value === undefined && e.years.length); open.length;) {
    const unread = new Map<string, File>();
    for (const e of open)
      for (const f of e.years[e.at]!) if (!spans.has(f.key)) unread.set(f.key, f);
    await time(`bounds: read files`, () =>
      pool([...chunks([...unread], 100)], concurrency, async (batch) => {
        const read = await readTimeBounds(batch.map(([, f]) => f));
        for (const [key, f] of batch) spans.set(key, read.get(f.file) ?? null);
      }),
    );
    readCount += unread.size;
    for (const e of open) {
      const times = e.years[e.at]!.flatMap((f) => spans.get(f.key)?.[e.pick] ?? []);
      if (times.length) e.value = e.pick === 1 ? Math.max(...times) : Math.min(...times);
      else e.at++;
    }
    open = open.filter((e) => e.value === undefined && e.at < e.years.length);
  }

  console.log(`${source} bounds: read ${readCount} files`);
  const found = Map.groupBy(ends, (e) => e.id);
  const bounds: ({ id: string } & StationBounds)[] = [];
  for (const station of stations) {
    const picked = found.get(station.id)!;
    const [first, last] = picked.filter((e) => e.pick !== 2).map((e) => e.value);
    const preliminary = picked.find((e) => e.pick === 2)?.value;
    // Screened if any file read this run says so, else as known; once screened, always.
    const prior = had.get(station.id)?.screened ?? null;
    const screened = own.get(station.id)!.some((f) => spans.get(f.key)?.[3]) ? true : prior;
    if (typeof first === "number" && typeof last === "number")
      bounds.push({
        id: station.id,
        first: iso(first),
        last: iso(last),
        preliminary: typeof preliminary === "number" ? iso(preliminary) : null,
        screened,
      });
  }
  // A station not in this run, such as one whose store can't be named, keeps
  // what it had; so does one with no counted rows, unless this is a rebuild.
  const here = new Set(stations.map((s) => s.id));
  const bounded = new Set(bounds.map((b) => b.id));
  for (const [id, b] of had)
    if (!bounded.has(id) && (!rebuild || !here.has(id))) bounds.push({ id, ...b });
  await time("bounds: write bounds", () => writeStationBounds(path, bounds, !legacy));
}

/**
 * Set the earliest preliminary value of the stations a backfill read, by ID,
 * and whether they hold a value the source screened, where given, in the
 * source's bounds in `store`, keeping every other station's bounds and their
 * first and last. A station with no row and none gets no row. Returns
 * false, writing nothing, when the bounds have no `preliminary` column yet,
 * since writing one would mark every other station as having none;
 * `compact --rebuild-bounds` fills them in first.
 */
export async function writePreliminary(
  store: string,
  source: string,
  found: Map<string, { preliminary: number | null; screened?: boolean }>,
): Promise<boolean> {
  const path = boundsPath(store, source);
  const bounds = await readStationBounds(path);
  if ([...bounds.values()].some((b) => b.preliminary === undefined)) return false;
  let changed = false;
  for (const [id, { preliminary: time, screened }] of found) {
    const preliminary = time === null ? null : iso(time);
    const had = bounds.get(id);
    if (!had && preliminary === null) continue;
    if (
      (had?.preliminary ?? null) === preliminary &&
      (screened === undefined || (had?.screened ?? null) === screened)
    )
      continue;
    bounds.set(id, {
      first: null,
      last: null,
      ...had,
      preliminary,
      ...(screened === undefined ? {} : { screened }),
    });
    changed = true;
  }
  if (changed)
    await writeStationBounds(
      path,
      [...bounds].map(([id, b]) => ({ id, ...b })),
    );
  return true;
}

function iso(time: number): string {
  return new Date(time).toISOString().replace(/\.\d+Z$/, "Z");
}

/**
 * The epoch a recent row belongs to: its own, or a later open or closed one
 * whose known start is at or before the row's time.
 */
function epochAt(epochs: Epoch[], row: { time: number; epoch: number }): number {
  let id = row.epoch;
  for (const e of epochs)
    if (
      (e.state === "open" || e.state === "closed") &&
      e.since !== null &&
      Date.parse(e.since) <= row.time
    )
      id = Math.max(id, e.id);
  return id;
}

/** The `days` whole UTC days before `now`, as [start, end). */
export function lastDays(now: number, days = 1): [number, number] {
  const end = Math.floor(now / DAY_MS) * DAY_MS;
  return [end - days * DAY_MS, end];
}

/**
 * Adapters return values in the station's datum; this keeps a file from gaining
 * them when it already holds another, whatever the station list says.
 */
export async function refuseOtherDatum(
  path: string,
  station: Station,
  datums?: string[],
): Promise<void> {
  const held = (datums ?? (await readDatums(path))).filter((d) => d !== station.datum);
  if (held.length)
    throw new Error(`${path} holds ${held.join(", ")}, not ${station.datum}; resolve by hand`);
}

/**
 * Below this lunar tide, in meters (`Station.tide_m`), a tide gauge whose
 * values move in whole centimeters gets still water's two days before a
 * flatline is suspect. A smaller tide, such as Göteborg's 9 cm, can sit on
 * one centimeter for hours at the turn; at 30 cm the level leaves it within
 * about an hour, even a diurnal tide's, so a longer run is a stuck gauge.
 * A change to it, or to `qcFor`'s other limits, bumps `RULES` in
 * `src/store/analysis.ts`, so every station's stored years are requalified.
 */
export const CENTIMETER_TIDE_M = 0.3;

/**
 * How far, in meters, a tide gauge's level can waver from a run's first value
 * and still count as one flatline: a stuck gauge that dithers by a millimeter
 * either way, which spans 2 mm from the first: QARTOD's flat line test takes
 * values equal within 1 mm of each other. A centimeter flags hours of real
 * water where a small tide turns, as at Berwick, Louisiana. A change to it
 * bumps `RULES` in `src/store/analysis.ts`.
 */
export const FLATLINE_M = 0.002;

/**
 * QC's rules for a station, by whether its levels carry a tide
 * (`Station.tidal`, from `src/store/analysis.ts`), the same for every source.
 * Still water, a pooled river, a lake or a creek drained to its sill, holds
 * one level to the centimeter for a day or more, so it gets two days before a
 * flatline counts as suspect, and it sits nearly flat for months and then
 * rises meters in a flood, so a level far outside its own range isn't suspect
 * for that alone, and a pool can be let up for a few hours and back down, so
 * neither is a level held between two steps. A sea without a tide, such as the Baltic, holds a
 * centimeter for a day on calm days too, but a millimeter for hours only when
 * its gauge is stuck, so it keeps six hours where its values move in
 * millimeters. Tidal water never holds still that long, so it gets six hours,
 * counting a level within `FLATLINE_M` of a run's first as unchanged,
 * or two days where its tide is under `CENTIMETER_TIDE_M` and its values move
 * in whole centimeters. A tidal river or lake still floods, so it keeps the
 * outlier check off, and its tide is too far from harmonic for the residual
 * jumps; tidal water of any other kind, or none, keeps both. A
 * station with no verdict yet is judged by its kind: a river or lake as
 * still, anything else as tidal, as a tide gauge is, since sources such as
 * RWS and REFMAR leave their tide gauges' kind unset.
 */
export function qcFor(station: Pick<Station, "kind" | "tidal" | "tide_m">): QcOptions {
  const river = station.kind === "river" || station.kind === "lake";
  if (!(station.tidal ?? !river))
    return station.kind === "coastal"
      ? { centimeter_flatline_s: 48 * 3600, outliers: false, held: false }
      : { flatline_s: 48 * 3600, outliers: false, held: false };
  const small = station.tide_m != null && station.tide_m < CENTIMETER_TIDE_M;
  return {
    flatline_m: FLATLINE_M,
    ...(small ? { centimeter_flatline_s: 48 * 3600 } : {}),
    ...(river ? { outliers: false } : { jumps: true }),
  };
}

/** Run `work` over `items`, `concurrency` at a time. */
export async function pool<T>(
  items: T[],
  concurrency: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: concurrency }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
  });
  await Promise.all(workers);
}

/** The summary as Markdown, for the log and `$GITHUB_STEP_SUMMARY`. */
export function formatSummary(s: RunSummary, listed = 20): string {
  const lines = [
    `### ${s.title}`,
    "",
    "| Stations | Updated | Stale | Failed | Values written | Files written |",
    "| -: | -: | -: | -: | -: | -: |",
    `| ${s.stations} | ${s.updated} | ${s.stale.length} | ${s.failed.length} | ${s.values} | ${s.files} |`,
  ];
  const phases = Object.entries(s.seconds ?? {});
  if (phases.length) {
    lines.push("", "| Phase | Seconds |", "| - | -: |");
    for (const [phase, took] of phases) lines.push(`| ${phase} | ${took.toFixed(1)} |`);
  }
  for (const [what, items] of [
    ["Failed", s.failed],
    ["Stale", s.stale],
    ["Waiting on a held datum change", s.waiting],
    ["Warnings", s.warned ?? []],
  ] as const)
    if (items.length) {
      lines.push("", `${what}${items.length > listed ? ` (first ${listed})` : ""}:`, "");
      for (const item of items.slice(0, listed)) lines.push(`- ${item}`);
    }
  return lines.join("\n") + "\n";
}

export function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

function emptySummary(title: string, stations: number): RunSummary {
  return { title, stations, updated: 0, stale: [], failed: [], waiting: [], values: 0, files: 0 };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
