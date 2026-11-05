/**
 * Fetch from upstream sources into the lake.
 *
 *   node scripts/ingest.ts stations [source...] [--accept-epochs]
 *   node scripts/ingest.ts seed-stations [source...]
 *   node scripts/ingest.ts backfill <source> <station,...|all> <start> <end>
 *   node scripts/ingest.ts recent <source> [--hours 24] [--keep-days 7]
 *   node scripts/ingest.ts compact <source> [--days 1]
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
 * live station and merges them into recent/<source>.parquet. `compact` folds
 * the last `--days` whole UTC days of that window into each station's year
 * files, each row into its datum epoch's. Both print a summary, and add it to
 * the workflow run's page.
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
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { useDiskCache } from "../src/cache.ts";
import { mergeFetched, sameRows } from "../src/lake/merge.ts";
import {
  compactRecent,
  formatSummary,
  lastDays,
  pool,
  qcFor,
  refuseOtherDatum,
  updateRecent,
  type RunSummary,
} from "../src/lake/recent.ts";
import { existsSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { isHeld } from "../src/epochs.ts";
import {
  readExtremes,
  readObservations,
  exists,
  setConnections,
  writeExtremes,
  writeObservations,
} from "../src/lake/parquet.ts";
import { historyPath, seriesPath, stationListPath, stationsPath } from "../src/lake/paths.ts";
import { qc } from "../src/qc.ts";
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
// The repo's, wherever ingest runs from.
const STATIONS_DIR = fileURLToPath(new URL("../stations", import.meta.url));
const DAY_MS = 86_400_000;

useDiskCache();

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    hours: { type: "string", default: "24" },
    "keep-days": { type: "string", default: "7" },
    days: { type: "string", default: "1" },
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
    await recent(source, positive("hours"), positive("keep-days"));
    break;
  }
  case "compact": {
    const [source] = args;
    if (!source) usage();
    await compact(source, Number(values.days));
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
  await pool(wanted, positive("concurrency"), async (station) => {
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

async function recent(sourceId: string, hours: number, keepDays: number): Promise<void> {
  const now = Date.now();
  const summary = await reporting(`recent ${sourceId}`, async () => {
    const source = sourceOf(sourceId);
    return updateRecent({
      source,
      stations: await listOf(lakeOfSource(source.metadata), sourceId),
      lakeFor,
      concurrency: positive("concurrency"),
      since: new Date(now - hours * 3_600_000),
      now,
      keepDays,
    });
  });
  // Some stations failing or going quiet is ordinary; all of them is an outage,
  // or a broken adapter, even one that answers "no data" without an error.
  if (summary.stations && summary.failed.length + summary.stale.length >= summary.stations)
    process.exitCode = 1;
}

async function compact(sourceId: string, days: number): Promise<void> {
  let live = 0;
  const summary = await reporting(`compact ${sourceId}`, async () => {
    // The window keeps 7 days back from its last hourly run, which is partway
    // into the seventh day, so 6 is the most whole days it holds.
    if (!Number.isInteger(days) || days < 1 || days > 6)
      throw new Error("--days must be a whole number from 1 to 6, the whole days the window holds");
    const concurrency = positive("concurrency");
    setConnections(concurrency);
    const source = sourceOf(sourceId);
    const stations = await listOf(lakeOfSource(source.metadata), sourceId);
    live = stations.filter((s) => s.live && s.status === "active").length;
    const [start, end] = lastDays(Date.now(), days);
    return compactRecent({ source, stations, lakeFor, concurrency, start, end });
  });
  // A failed fold left its year file as it was; a person should look. Every
  // live station silent means recent/ is missing, empty or not being updated.
  if (summary.failed.length || (live && summary.stale.length >= live)) process.exitCode = 1;
}

/**
 * Run a job and print its summary, adding it to the workflow run's page when
 * there is one. A job that throws still leaves a line there saying why.
 */
async function reporting(title: string, run: () => Promise<RunSummary>): Promise<RunSummary> {
  const page = process.env.GITHUB_STEP_SUMMARY;
  let summary;
  try {
    summary = await run();
  } catch (error) {
    if (page)
      await appendFile(
        page,
        `### ${title}\n\nFailed: ${error instanceof Error ? error.message : error}\n`,
      );
    throw error;
  }
  const text = formatSummary(summary);
  console.log(text);
  if (page) await appendFile(page, text);
  return summary;
}

/** A command-line option that must be a whole number of at least 1. */
function positive(name: "concurrency" | "hours" | "keep-days"): number {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`--${name} must be a whole number of at least 1`);
  return value;
}

/** Where a station's current epoch starts, or null for one with no known start. */
function currentSince(station: LakeStation): string | null {
  return station.epochs.filter((e) => e.state === "open").at(-1)?.since ?? null;
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

function usage(): never {
  console.error(
    "usage: ingest.ts stations [source...] [--accept-epochs] | seed-stations [source...] | backfill <source> <station,...|all> <start> <end> | recent <source> [--hours N] [--keep-days N] | compact <source> [--days N]",
  );
  process.exit(1);
}
