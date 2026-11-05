/**
 * Fetch from upstream sources into the lake.
 *
 *   node scripts/ingest.ts stations [source...] [--accept-epochs]
 *   node scripts/ingest.ts seed-stations [source...]
 *   node scripts/ingest.ts backfill <source> <station,...|all> <start> <end>
 *   node scripts/ingest.ts recent <source> [--hours 24] [--keep-days 7]
 *
 * `stations` refreshes each source's list in the lake, stations/<source>.parquet,
 * after snapshotting the previous one to history/, then writes stations.parquet
 * and sources.json. It changes no file in the repo. `seed-stations` writes a
 * source's first list from the committed station files, once.
 * `backfill` writes every product a station has over [start, end) (dates as YYYY or YYYY-MM-DD, end
 * exclusive) into its yearly files, replacing that range and keeping the rest,
 * so a rerun gives the same files. A calendar month the fetch returned nothing
 * for keeps what it had, so an outage never deletes stored values; a value the
 * source withdraws stays until its month is fetched again with others. `recent` fetches the last hours for every
 * live station and merges them into recent/<source>.parquet.
 *
 * A station the source now reports against another reference opens a datum
 * epoch, whose values go to files of their own (docs/stations.md). `backfill`
 * and `recent` write the current epoch, never before its start, and skip a
 * station whose new epoch waits on a person. `backfill all` skips inactive
 * stations; naming one still works, adapters refuse values in any datum but
 * the station's, and backfill refuses a file whose `datum` column names another.
 *
 * The lake is WATER_LEVELS_LAKE: a directory (default `data`) or an `s3://` URL.
 * Its bucket is public, so a source whose license bars commercial use keeps
 * its list and series in WATER_LEVELS_RESTRICTED_LAKE instead, which must be a
 * separate lake, and ingest refuses to write one without it.
 */
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { useDiskCache } from "../src/cache.ts";
import { mergeFetched, sameRows } from "../src/lake/merge.ts";
import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { isHeld, recentWindow } from "../src/epochs.ts";
import {
  readExtremes,
  readDatums,
  readObservations,
  checkRecent,
  readRecent,
  exists,
  writeExtremes,
  writeObservations,
  writeRecent,
  type StationObservation,
} from "../src/lake/parquet.ts";
import {
  historyPath,
  recentPath,
  seriesPath,
  stationListPath,
  stationsPath,
} from "../src/lake/paths.ts";
import { qc, type QcOptions } from "../src/qc.ts";
import {
  describeReport,
  hasHistory,
  epochOf,
  listOf,
  publishStations,
  refreshSource,
  seedSource,
} from "../src/refresh.ts";
import { readStationFiles } from "../src/station-files.ts";
import type {
  LakeStation,
  Observation,
  Product,
  PublishedExtreme,
  Source,
  SourceMetadata,
  Station,
} from "../src/schema.ts";
import { sourceOf, sources } from "../src/sources/index.ts";

const LAKE = (process.env.WATER_LEVELS_LAKE ?? "data").replace(/\/$/, "");

/** Where a station's series go: the public lake, or the private one when its license is restricted. */
function lakeFor(station: Pick<Station, "id" | "commercial_use">): string {
  if (station.commercial_use) return LAKE;
  const restricted = process.env.WATER_LEVELS_RESTRICTED_LAKE?.replace(/\/$/, "");
  if (!restricted)
    throw new Error(
      `${station.id} bars commercial use; set WATER_LEVELS_RESTRICTED_LAKE to a private lake`,
    );
  if (overlaps(restricted, LAKE))
    throw new Error("WATER_LEVELS_RESTRICTED_LAKE must be a separate bucket or directory");
  return restricted;
}

/** The lake that holds a source's list, by its terms; every station in it shares them. */
function lakeOfSource(metadata: SourceMetadata): string {
  return lakeFor({ id: metadata.id, commercial_use: metadata.license.commercial_use });
}

/** Whether two lakes share a bucket, or one directory holds the other. */
function overlaps(a: string, b: string): boolean {
  const bucket = (lake: string) => /^s3:\/\/([^/]+)/.exec(lake)?.[1];
  if (bucket(a) || bucket(b)) return bucket(a) === bucket(b);
  const [x, y] = [resolve(a), resolve(b)];
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
}
const STATIONS_DIR = "stations";
const DAY_MS = 86_400_000;

useDiskCache();

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    hours: { type: "string", default: "24" },
    "keep-days": { type: "string", default: "7" },
    concurrency: { type: "string", default: "4" },
    "accept-epochs": { type: "boolean", default: false },
  },
});
const [command, ...args] = positionals;

switch (command) {
  case "stations":
    await refreshStations(args.length ? args : Object.keys(sources));
    break;
  case "seed-stations":
    await seedStations(args.length ? args : Object.keys(sources));
    break;
  case "backfill": {
    const [source, ids, start, end] = args;
    if (!source || !ids || !start || !end) usage();
    await backfill(source, ids, parseDate(start), parseDate(end));
    break;
  }
  case "recent": {
    const [source] = args;
    if (!source) usage();
    await recent(source, Number(values.hours), Number(values["keep-days"]));
    break;
  }
  default:
    usage();
}

async function refreshStations(ids: string[]): Promise<void> {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const lakes = new Set<string>();
  const summary: string[] = [];
  for (const id of ids) {
    const source = sourceOf(id);
    try {
      const lake = lakeOfSource(source.metadata);
      lakes.add(lake);
      // Starting a list from the fetch alone would drop what the committed
      // files carry forward, such as USACE's series picks.
      if (
        existsSync(join(STATIONS_DIR, id)) &&
        !(await exists(stationListPath(lake, id))) &&
        !(await hasHistory(lake, id))
      )
        throw new Error(`no list in the lake yet; run \`seed-stations ${id}\` first`);
      const { stations, report } = await refreshSource(lake, source, {
        now,
        acceptEpochs: values["accept-epochs"],
      });
      const active = stations.filter((s) => s.status === "active").length;
      const lines = describeReport(report);
      lines[0] += `; ${active} active, ${stations.length - active} inactive`;
      for (const line of lines) console.log(line);
      summary.push(...lines);
      // A station waiting on a person, or newly retired by the source itself
      // (a USACE gauge whose series CWMS withdrew), fails the run so it's seen.
      for (const e of report.epochs)
        if (e.event === "held" || e.event === "waiting") process.exitCode = 1;
      if (report.withdrawn.length) process.exitCode = 1;
    } catch (error) {
      // One source failing keeps its list and doesn't stop the others.
      const why = error instanceof Error ? error.message : String(error);
      console.error(`${id}: ${why}; keeping the list in the lake`);
      summary.push(`${id}: ${why}; keeping the list in the lake`);
      process.exitCode = 1;
    }
  }
  // The lists are written, so their report is kept even if publishing fails.
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, ["```", ...summary, "```", ""].join("\n"));
  for (const lake of lakes) await publish(lake);
}

/**
 * Rebuild `stations.parquet` and `sources.json` for `lake`, unless a source it
 * should hold has no list yet: one with committed station files or history.
 */
async function publish(lake: string): Promise<void> {
  // A restricted source with no restricted lake configured isn't in this one.
  const inLake = (metadata: SourceMetadata) => {
    try {
      return lakeOfSource(metadata) === lake;
    } catch {
      return false;
    }
  };
  const held = Object.values(sources).filter((s) => inLake(s.metadata));
  const expected: string[] = [];
  for (const { metadata } of held)
    if (
      existsSync(join(STATIONS_DIR, metadata.id)) ||
      (await exists(historyPath(lake, metadata.id, "*", "parquet")))
    )
      expected.push(metadata.id);
  const result = await publishStations(lake, held, expected);
  if ("count" in result) console.log(`${stationsPath(lake)}: ${result.count} stations`);
  else {
    console.error(
      `${stationsPath(lake)} not written: no list in the lake yet for ${result.missing.join(", ") || "any source"}`,
    );
    process.exitCode = 1;
  }
}

/** Write each source's first list into the lake from its committed station files. */
async function seedStations(ids: string[]): Promise<void> {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const lakes = new Set<string>();
  for (const id of ids) {
    const { metadata } = sourceOf(id);
    try {
      const lake = lakeOfSource(metadata);
      const stations = await seedSource(
        lake,
        metadata,
        await readStationFiles(STATIONS_DIR, metadata),
        now,
      );
      lakes.add(lake);
      console.log(`${id}: seeded ${stations.length} stations`);
    } catch (error) {
      console.error(`${id}: ${error instanceof Error ? error.message : error}`);
      process.exitCode = 1;
    }
  }
  for (const lake of lakes) await publish(lake);
}

async function backfill(sourceId: string, ids: string, start: Date, end: Date): Promise<void> {
  const source = sourceOf(sourceId);
  const list = await listOf(lakeOfSource(source.metadata), sourceId);
  const named =
    ids === "all"
      ? list.filter((s) => s.status === "active")
      : ids.split(",").map((id) => find(list, sourceId, id));
  // A station whose new epoch waits on a person gets nothing, in either datum.
  const wanted = named.filter((s) => {
    if (isHeld(s.epochs)) console.error(`  ${s.id}: held for a datum change; skipped`);
    return !isHeld(s.epochs);
  });
  // Sources with a rolling window can't reach further back than it.
  const window = source.metadata.window_days;
  if (window) start = new Date(Math.max(start.getTime(), Date.now() - window * DAY_MS));

  const failed: string[] = [];
  await pool(wanted, async (station) => {
    // Nothing from before the current epoch: those values are in another reference.
    const since = Date.parse(currentSince(station) ?? "");
    const from_ = Number.isNaN(since) ? start : new Date(Math.max(start.getTime(), since));
    for (const product of station.products) {
      for (const [from, to] of years(from_, end)) {
        const label = `${station.id} ${product} ${from.getUTCFullYear()}`;
        try {
          const written = await backfillYear(source, station, product, from, to);
          if (written !== undefined) console.log(`${label}: ${written} rows`);
        } catch (error) {
          // A failed year writes nothing, so its file keeps what it had.
          failed.push(`${label}: ${error instanceof Error ? error.message : error}`);
        }
      }
    }
  });
  for (const f of failed) console.error(`  ${f}`);
  if (failed.length) process.exitCode = 1;
}

/** Returns how many rows the year's file now holds, or undefined when nothing changed. */
async function backfillYear(
  source: Source,
  station: LakeStation,
  product: Product,
  from: Date,
  to: Date,
): Promise<number | undefined> {
  const path = seriesPath(
    lakeFor(station),
    product,
    station.source,
    station.source_id,
    from.getUTCFullYear(),
    epochOf(station),
  );
  const range = [from.getTime(), to.getTime()] as const;
  if (product === "levels" || product === "predictions") {
    const get = product === "levels" ? source.observations : source.predictions;
    if (!get) return undefined;
    let rows = await get(station, from, to);
    // An empty fetch is an outage, a year the source no longer publishes, or a
    // datum it no longer serves; it never empties a file.
    if (!rows.length) return undefined;
    await refuseOtherDatum(path, station);
    if (product === "levels") rows = qc(rows, qcFor(source, station));
    const existing = await readObservations(path);
    const merged = mergeFetched(existing, rows, ...range);
    if (!merged.length || sameRows(existing, merged)) return undefined;
    await writeObservations(path, merged, station.datum);
    return merged.length;
  }
  const get = product === "extremes" ? source.extremes : source.predictedExtremes;
  if (!get) return undefined;
  const rows = await get(station, from, to);
  if (!rows.length) return undefined;
  await refuseOtherDatum(path, station);
  const existing = await readExtremes(path);
  const merged = mergeFetched<PublishedExtreme>(existing, rows, ...range);
  if (!merged.length || sameRows(existing, merged)) return undefined;
  await writeExtremes(path, merged, station.datum);
  return merged.length;
}

/**
 * Adapters return values in the station's datum; this keeps a file from gaining
 * them when it already holds another, whatever the station list says. It runs
 * once there's something to write, so empty years cost no lake read.
 */
async function refuseOtherDatum(path: string, station: Station): Promise<void> {
  const held = (await readDatums(path)).filter((d) => d !== station.datum);
  if (held.length)
    throw new Error(`${path} holds ${held.join(", ")}, not ${station.datum}; resolve by hand`);
}

async function recent(sourceId: string, hours: number, keepDays: number): Promise<void> {
  const source = sourceOf(sourceId);
  if (!source.observations && !source.recent) throw new Error(`${sourceId} has no observations`);
  const live = (await listOf(lakeOfSource(source.metadata), sourceId)).filter(
    (s) => s.live && s.status === "active" && s.products.includes("levels"),
  );
  // A station whose new epoch waits on a person isn't fetched, but keeps what it had.
  const stations = live.filter((s) => !isHeld(s.epochs));
  const now = Date.now();
  const start = new Date(now - hours * 3_600_000);
  const keepFrom = now - keepDays * DAY_MS;
  // Restricted stations' recent values go to the private lake, like their series.
  const lakeOf = new Map(live.map((s) => [s.id, recentPath(lakeFor(s), sourceId)]));
  const paths = [...new Set(lakeOf.values())];
  const failed: string[] = [];
  let written = 0;
  const reporting = new Set<string>();

  // Each file is read in batches after the sweep, so one that can't be read
  // fails the run here, before the sweep spends a source's request budget. A
  // station read only from its own lake's file starts empty in the other lake
  // when its license changes, rather than carry rows across.
  for (const path of paths) await checkRecent(path);

  // A source that can sweep every station at once does; a failed sweep fails
  // every station, which keeps what each had.
  let swept: Map<string, Observation[] | Error> | Error | undefined;
  if (source.recent)
    swept = await source
      .recent(stations, start, new Date(now))
      .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));

  // A batch of stations at a time, read, merged and written: every live USGS
  // station's window is about 9 million values, too many to hold at once.
  const BATCH = 500;
  async function* batches(path: string): AsyncGenerator<StationObservation[]> {
    const here = live.filter((s) => lakeOf.get(s.id) === path);
    for (let i = 0; i < here.length; i += BATCH) {
      const batch = here.slice(i, i + BATCH);
      const ids = batch.map((s) => s.id);
      const previous = Map.groupBy(await readRecent(path, ids), (r) => r.station);
      const rows: StationObservation[] = [];
      await pool(batch, async (station) => {
        const window = recentWindow(
          station.epochs,
          previous.get(station.id) ?? [],
          keepFrom,
          start.getTime(),
        );
        // Rows from other epochs are in another reference, and stay as they are.
        rows.push(...window.other);
        // A held station isn't fetched, but keeps what it had.
        if (isHeld(station.epochs)) {
          rows.push(...window.current);
          return;
        }
        let merged: Observation[] = window.current;
        try {
          if (swept instanceof Error) throw swept;
          const answer = swept ? swept.get(station.id) : undefined;
          if (answer instanceof Error) throw answer;
          // A sweep covers the whole window, so values from before the current epoch are left out.
          const fetched = swept
            ? (answer ?? []).filter((o) => o.time >= window.from)
            : await source.observations!(station, new Date(window.from), new Date(now));
          // QC the whole window, so spikes and flatlines are judged against their neighbors.
          // Nothing new keeps what we had, rather than clearing the last hours.
          if (fetched.length)
            merged = qc(
              mergeFetched(window.current, fetched, window.from, now, now),
              qcFor(source, station),
            );
        } catch (error) {
          // Keep what we had; a failed fetch mustn't empty the window.
          failed.push(`${station.id}: ${error instanceof Error ? error.message : error}`);
        }
        for (const r of merged) rows.push({ ...r, station: station.id, epoch: window.epoch });
        if (merged.some((r) => r.received === now)) reporting.add(station.id);
      });
      if (swept instanceof Map) for (const id of ids) swept.delete(id);
      written += rows.length;
      yield rows;
    }
  }
  for (const path of paths) await writeRecent(path, batches(path));

  console.log(
    `${paths.join(", ")}: ${written} rows, ${reporting.size} of ${stations.length} stations sent new values, ${failed.length} failed`,
  );
  for (const f of failed.slice(0, 20)) console.log(`  ${f}`);
  if (stations.length && failed.length === stations.length) process.exit(1);
}

/** Where a station's current epoch starts, or null for one with no known start. */
function currentSince(station: LakeStation): string | null {
  return station.epochs.filter((e) => e.state === "open").at(-1)?.since ?? null;
}

/**
 * Pooled rivers and lakes hold one level, to the hundredth of a foot, for a day
 * or more, so they get two days before a flatline counts as suspect. And they
 * sit nearly flat for months and then rise meters in a flood, so a level far
 * outside their own range isn't suspect for that alone. Tide gauges never sit
 * still that long, and keep the defaults.
 */
function qcFor(source: Source, station: Station): QcOptions {
  const still = station.kind === "river" || station.kind === "lake";
  return { ...source.metadata.qc, ...(still ? { flatline_s: 48 * 3600, outliers: false } : {}) };
}

/** A station by its ID or its source's own code. */
function find(list: LakeStation[], sourceId: string, id: string): LakeStation {
  const station = list.find((s) => s.id === id || s.id === `${sourceId}/${id}`);
  if (!station) throw new Error(`No station ${id} in ${sourceId}'s list`);
  return station;
}

/** [start, end) split at UTC year boundaries. */
function* years(start: Date, end: Date): Generator<[Date, Date]> {
  for (let t = start.getTime(); t < end.getTime();) {
    const next = Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
    yield [new Date(t), new Date(Math.min(next, end.getTime()))];
    t = next;
  }
}

function parseDate(value: string): Date {
  const date = new Date(/^\d{4}$/.test(value) ? `${value}-01-01T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${value}`);
  return date;
}

async function pool<T>(items: T[], run: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Number(values.concurrency) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) await run(item);
  });
  await Promise.all(workers);
}

function usage(): never {
  console.error(
    "usage: ingest.ts stations [source...] [--accept-epochs] | seed-stations [source...] | backfill <source> <station,...|all> <start> <end> | recent <source> [--hours N] [--keep-days N]",
  );
  process.exit(1);
}
