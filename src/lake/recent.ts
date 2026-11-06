import { Blocked } from "../http.ts";
import { qc, withSourceFlag, type QcOptions } from "../qc.ts";
import { DatumChanged, isHeld, recentWindow } from "../epochs.ts";
import type { Epoch, LakeStation, Observation, Source, Station } from "../schema.ts";
import { mergeFetched, sameRows, upsert } from "./merge.ts";
import {
  checkRecent,
  readDatums,
  readObservationFile,
  readRecent,
  recentStations,
  writeObservations,
  writeRecent,
  type StationObservation,
} from "./parquet.ts";
import { recentPath, seriesPath } from "./paths.ts";

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
  /** Stations whose values wait in the window for a person's decision on a held datum change. */
  waiting: string[];
  /** Values new to the lake. */
  values: number;
  /** Files written. */
  files: number;
}

interface RunOptions {
  source: Source;
  /** The source's list from the lake; each job picks the stations it covers. */
  stations: LakeStation[];
  /** The lake a station's files go to, public or restricted. */
  lakeFor: (station: Station) => string;
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
 * epoch's start. A station whose new epoch waits on a person isn't fetched,
 * but keeps what it had.
 *
 * A station is stale when its newest value is older than three of its
 * intervals, and at least `staleHours`.
 */
export async function updateRecent({
  source,
  stations: all,
  lakeFor,
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
  // Restricted stations' recent values go to the private lake, like their series.
  const lakeOf = (s: Station): string | undefined => {
    try {
      return recentPath(lakeFor(s), id);
    } catch {
      return undefined;
    }
  };
  const summary = emptySummary(`recent ${id}`, stations.length);
  // A station whose lake can't be named, such as a restricted one with no
  // restricted lake set, fails alone rather than stop the source's run.
  const pathOf = new Map<string, string>();
  for (const s of live)
    try {
      pathOf.set(s.id, recentPath(lakeFor(s), id));
    } catch (error) {
      summary.failed.push(`${s.id}: ${message(error)}`);
    }
  const reporting = new Set<string>();

  // Each file is read in batches after the sweep, so one that can't be read
  // fails the run here, before the sweep spends a source's request budget.
  const candidates = new Set([...pathOf.values(), ...all.flatMap((s) => lakeOf(s) ?? [])]);
  for (const path of candidates) await checkRecent(path);

  // Listed stations a file holds that this run doesn't fetch, because they've
  // stopped being live or active since, keep their rows until they age out, so
  // compaction can still fold them. One whose license now sends it to the other
  // lake doesn't, so its rows never stay in the wrong one, and it starts empty
  // in its new lake rather than carry rows across. A station gone from the list
  // has nowhere to be folded, so its rows go.
  const listed = new Map(all.map((s) => [s.id, s]));
  const carried = new Map<string, string[]>();
  for (const path of candidates) {
    const ids = (await recentStations(path)).filter((station) => {
      if (pathOf.has(station)) return false;
      const s = listed.get(station);
      return s !== undefined && lakeOf(s) === path;
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
          // Nothing new keeps what we had, rather than clearing the last hours.
          if (got.length)
            merged = qc(
              mergeFetched(window.current, withSourceFlag(got), window.from, now, now),
              qcFor(source, station),
            );
        } catch (error) {
          // Keep what we had; a failed fetch mustn't empty the window.
          summary.failed.push(`${station.id}: ${message(error)}`);
          if (error instanceof Blocked) summary.blocked = true;
          // A refresh ignores a change a person rejected, matched on datum and
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
 * reported but not failed, and those older than the window when a person
 * decides need a backfill.
 */
export async function compactRecent({
  source,
  stations: all,
  lakeFor,
  concurrency = 8,
  start,
  end,
}: RunOptions & { start: number; end: number }): Promise<RunSummary> {
  const id = source.metadata.id;
  const summary = emptySummary(`compact ${id}`, 0);
  // A station whose lake can't be named, such as a restricted one with no
  // restricted lake set, fails alone rather than stop the source's fold.
  // A station without levels has rows only from before its list dropped them,
  // and one of those whose lake can't be named has none to fold there.
  const levels = (s: Station) => s.products.includes("levels");
  const pathOf = new Map<string, string>();
  for (const s of all)
    try {
      pathOf.set(s.id, recentPath(lakeFor(s), id));
    } catch (error) {
      if (levels(s)) summary.failed.push(`${s.id}: ${message(error)}`);
    }
  const stations = all.filter((s) => pathOf.has(s.id));
  summary.stations = stations.filter(levels).length + summary.failed.length;

  for (const path of new Set(pathOf.values())) {
    for (const batch of chunks(
      stations.filter((s) => pathOf.get(s.id) === path),
      BATCH,
    )) {
      const window = Map.groupBy(
        (
          await readRecent(
            path,
            batch.map((s) => s.id),
          )
        ).filter((r) => r.time >= start && r.time < end),
        (r) => r.station,
      );
      await pool(batch, concurrency, async (station) => {
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
        // epoch's start wait in the window for a person's decision.
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
              lakeFor(station),
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
            if (sameRows(existing.rows, merged)) continue;
            await writeObservations(file, merged, epoch.datum);
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
      });
    }
  }
  return summary;
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
 * Pooled rivers and lakes hold one level, to the hundredth of a foot, for a day
 * or more, so they get two days before a flatline counts as suspect. And they
 * sit nearly flat for months and then rise meters in a flood, so a level far
 * outside their own range isn't suspect for that alone. Tide gauges never sit
 * still that long, and keep the defaults.
 */
export function qcFor(source: Source, station: Station): QcOptions {
  const still = station.kind === "river" || station.kind === "lake";
  return { ...source.metadata.qc, ...(still ? { flatline_s: 48 * 3600, outliers: false } : {}) };
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
  for (const [what, items] of [
    ["Failed", s.failed],
    ["Stale", s.stale],
    ["Waiting on a held datum change", s.waiting],
  ] as const)
    if (items.length) {
      lines.push("", `${what}${items.length > listed ? ` (first ${listed})` : ""}:`, "");
      for (const item of items.slice(0, listed)) lines.push(`- ${item}`);
    }
  return lines.join("\n") + "\n";
}

function* chunks<T>(items: T[], size: number): Generator<T[]> {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}

function emptySummary(title: string, stations: number): RunSummary {
  return { title, stations, updated: 0, stale: [], failed: [], waiting: [], values: 0, files: 0 };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
