/**
 * Fetch from upstream sources into the lake.
 *
 *   node scripts/ingest.ts stations [source...]
 *   node scripts/ingest.ts backfill <source> <station,...|all> <start> <end>
 *       [--first <file>] [--shard <i>/<n>] [--refetch | --skip-written]
 *   node scripts/ingest.ts recent <source> [--hours 24] [--keep-days 7]
 *
 * `stations` refreshes the committed lists in stations/<source>.json, then
 * writes stations.parquet and sources.json to the lake. `backfill` writes every
 * product a station has over [start, end) (dates as YYYY or YYYY-MM-DD, end
 * exclusive) into its yearly files, replacing that range and keeping the rest,
 * so a rerun gives the same files. A calendar month the fetch returned nothing
 * for keeps what it had, so an outage never deletes stored values; a value the
 * source withdraws stays until its month is fetched again with others.
 * Backfill skips a year whose file is already complete (see `yearDone` in
 * src/backfill.ts), so a run cut short doesn't fetch those again; `--refetch`
 * fetches every year anyway, and `--skip-written` skips every ended year that
 * has a file, complete or not, so a long campaign of runs doesn't fetch
 * provisional years again each time. `--first` names a file of station IDs to
 * run before the rest, and `--shard 2/8` takes the second of eight sets of
 * stations, split by a hash of their IDs, so separate jobs can split them. `recent` fetches the last hours for every live station
 * and merges them into recent/<source>.parquet.
 *
 * Files carry no datum of their own, so a station the source now reports in
 * another datum is marked inactive, and `stations` lists it and exits nonzero
 * for a person to resolve. `backfill all` skips inactive stations; naming one
 * still works, adapters refuse values in any datum but the station's, and
 * backfill refuses a file whose `datum` column names another.
 *
 * The lake is WATER_LEVELS_LAKE: a directory (default `data`) or an `s3://` URL.
 * Its bucket is public, so a station whose license bars commercial use writes
 * its series to WATER_LEVELS_RESTRICTED_LAKE instead, which must be a separate
 * lake, and ingest refuses to write one without it.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  orderStations,
  parseShard,
  parseStationList,
  shard,
  yearDone,
  yearWritten,
} from "../src/backfill.ts";
import { useDiskCache } from "../src/cache.ts";
import { mergeFetched, sameRows } from "../src/lake/merge.ts";
import {
  readExtremes,
  readDatums,
  readYearFiles,
  listYears,
  readObservations,
  checkRecent,
  readRecent,
  writeExtremes,
  writeJsonArray,
  writeObservations,
  writeRecent,
  writeStations,
  type StationObservation,
} from "../src/lake/parquet.ts";
import { recentPath, seriesDir, seriesPath, sourcesPath, stationsPath } from "../src/lake/paths.ts";
import { qc, type QcOptions } from "../src/qc.ts";
import { linkBothWays, mergeStationList } from "../src/stations.ts";
import type {
  ListedStation,
  Observation,
  Product,
  PublishedExtreme,
  Source,
  Station,
} from "../src/schema.ts";
import { sourceOf, sources } from "../src/sources/index.ts";

const LAKE = (process.env.WATER_LEVELS_LAKE ?? "data").replace(/\/$/, "");

/** Where a station's series go: the public lake, or the private one when its license is restricted. */
function lakeFor(station: Station): string {
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
    first: { type: "string" },
    shard: { type: "string" },
    refetch: { type: "boolean", default: false },
    "skip-written": { type: "boolean", default: false },
  },
});
const [command, ...args] = positionals;

switch (command) {
  case "stations":
    await refreshStations(args.length ? args : Object.keys(sources));
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
  for (const id of ids) {
    const previous = await committedStations(id);
    let fetched;
    try {
      fetched = await sourceOf(id).stations(previous);
    } catch (error) {
      // One source failing keeps its committed list and doesn't stop the others.
      console.error(
        `${id}: ${error instanceof Error ? error.message : error}; keeping the committed list`,
      );
      process.exitCode = 1;
      continue;
    }
    // An empty list is a broken response, not every station retiring at once.
    if (!fetched.length && previous.length) {
      console.error(`${id}: listed no stations; keeping the committed list`);
      process.exitCode = 1;
      continue;
    }
    const shrunk = shrankSharply(previous, fetched);
    if (shrunk) {
      console.error(`${id}: ${shrunk}; keeping the committed list`);
      process.exitCode = 1;
      continue;
    }
    let merged;
    try {
      const source = sourceOf(id);
      merged = mergeStationList(previous, fetched, source.seriesChanged?.bind(source));
    } catch (error) {
      console.error(
        `${id}: ${error instanceof Error ? error.message : error}; keeping the committed list`,
      );
      process.exitCode = 1;
      continue;
    }
    const { stations, changed } = merged;
    // A station the source itself newly lists as inactive, such as a USACE
    // gauge whose series CWMS withdrew, fails the refresh that marks it, so a
    // person sees it in the commit. Left inactive, it's retired; a person who
    // moves it to another series brings it back.
    const wasActive = new Set(previous.filter((s) => s.status === "active").map((s) => s.id));
    for (const s of fetched)
      if (s.status === "inactive" && wasActive.has(s.id)) {
        console.error(`  ${s.id}: listed inactive by the source; see its log above`);
        process.exitCode = 1;
      }
    await writeFile(`${STATIONS_DIR}/${id}.json`, JSON.stringify(stations, null, 2) + "\n");
    const active = stations.filter((s) => s.status === "active").length;
    console.log(`${id}: ${active} active, ${stations.length - active} inactive`);
    // The station's files are all in its committed datum, so a person decides
    // whether to convert them or start over; until then it stays inactive.
    for (const c of changed) {
      console.error(
        c.reason
          ? `  ${c.id}: ${c.reason}; marked inactive`
          : `  ${c.id}: now reported in ${c.to}, not ${c.from}; marked inactive`,
      );
      process.exitCode = 1;
    }
  }

  let all: Station[] = [];
  for (const file of (await readdir(STATIONS_DIR)).filter((f) => f.endsWith(".json")).sort())
    all.push(...(await committedStations(file.replace(/\.json$/, ""))));
  all = linkBothWays(all);
  await writeStations(stationsPath(LAKE), all);
  await writeJsonArray(
    sourcesPath(LAKE),
    Object.values(sources).map((s) => ({
      // QC settings are ingest's business, not part of a source's terms.
      ...Object.fromEntries(Object.entries(s.metadata).filter(([key]) => key !== "qc")),
      stations: all.filter((st) => st.source === s.metadata.id && st.status === "active").length,
    })),
  );
  console.log(`${stationsPath(LAKE)}: ${all.length} stations`);
}

/**
 * A list that suddenly lists fewer than half the active or live stations it
 * did is a truncated response, not half the network retiring; taken at its
 * word, it would end those stations' feeds and backfills.
 */
function shrankSharply(previous: Station[], fetched: ListedStation[]): string | null {
  const active = previous.filter((s) => s.status === "active");
  for (const [what, before, now] of [
    ["stations", active.length, fetched.length],
    ["live stations", active.filter((s) => s.live).length, fetched.filter((s) => s.live).length],
  ] as const)
    if (before >= 20 && now < before / 2) return `lists ${now} ${what}, down from ${before}`;
  return null;
}

async function backfill(sourceId: string, ids: string, start: Date, end: Date): Promise<void> {
  const source = sourceOf(sourceId);
  const list = await committedStations(sourceId);
  if (!list.length)
    throw new Error(`No stations/${sourceId}.json; run \`stations ${sourceId}\` first`);
  let wanted =
    ids === "all"
      ? list.filter((s) => s.status === "active")
      : ids.split(",").map((id) => find(list, sourceId, id));
  if (values.shard) wanted = shard(wanted, ...parseShard(values.shard));
  if (values["skip-written"] && values.refetch)
    throw new Error("--skip-written and --refetch contradict each other");
  if (values.first) {
    const text = await readFile(values.first, "utf8");
    const first = parseStationList(text, sourceId, /\.csv$/i.test(values.first));
    wanted = orderStations(wanted, first);
    // Stations in another shard, inactive or misspelled don't run first here.
    // Unsharded, a file that matches nothing is a mistake, not an order.
    const here = new Set(wanted.map((s) => s.id));
    const matched = first.filter((id) => here.has(id)).length;
    if (!matched && !values.shard)
      throw new Error(`${values.first} names none of the ${sourceId} stations here`);
    console.log(
      `${values.first}: ${matched} of its ${first.length} ${sourceId} stations run first`,
    );
  }
  // Sources with a rolling window can't reach further back than it.
  const window = source.metadata.window_days;
  if (window) start = new Date(Math.max(start.getTime(), Date.now() - window * DAY_MS));
  const now = Date.now();
  console.log(`${sourceId}: backfilling ${wanted.length} stations`);

  const failed: string[] = [];
  let skipped = 0;
  await pool(wanted, async (station) => {
    for (const product of station.products) {
      // One read per series tells which years are done, rather than one per year;
      // --skip-written needs only a listing.
      let done: (from: Date, to: Date) => boolean = () => false;
      try {
        const dir = seriesDir(lakeFor(station), product, station.source, station.source_id);
        if (values["skip-written"]) {
          const listed = await listYears(dir);
          done = (from, to) => yearWritten(listed, from, to, now);
        } else if (!values.refetch) {
          const files = await readYearFiles(dir);
          done = (from, to) => yearDone(files.get(from.getUTCFullYear()), from, to, now);
        }
      } catch (error) {
        failed.push(`${station.id} ${product}: ${error instanceof Error ? error.message : error}`);
        continue;
      }
      for (const [from, to] of years(start, end)) {
        if (done(from, to)) {
          skipped++;
          continue;
        }
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
  const why = values["skip-written"] ? "already written" : "already complete";
  console.log(`${sourceId}: skipped ${skipped} years ${why}, ${failed.length} failed`);
  for (const f of failed) console.error(`  ${f}`);
  if (failed.length) process.exitCode = 1;
}

/** Returns how many rows the year's file now holds, or undefined when nothing changed. */
async function backfillYear(
  source: Source,
  station: Station,
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
  const stations = (await committedStations(sourceId)).filter(
    (s) => s.live && s.status === "active" && s.products.includes("levels"),
  );
  const now = Date.now();
  const since = new Date(now - hours * 3_600_000);
  const keepFrom = now - keepDays * DAY_MS;
  // Restricted stations' recent values go to the private lake, like their series.
  const lakeOf = new Map(stations.map((s) => [s.id, recentPath(lakeFor(s), sourceId)]));
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
      .recent(stations, since, new Date(now))
      .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));

  // A batch of stations at a time, read, merged and written: every live USGS
  // station's window is about 9 million values, too many to hold at once.
  const BATCH = 500;
  async function* batches(path: string): AsyncGenerator<StationObservation[]> {
    const here = stations.filter((s) => lakeOf.get(s.id) === path);
    for (let i = 0; i < here.length; i += BATCH) {
      const batch = here.slice(i, i + BATCH);
      const ids = batch.map((s) => s.id);
      const previous = Map.groupBy(await readRecent(path, ids), (r) => r.station);
      const rows: StationObservation[] = [];
      await pool(batch, async (station) => {
        const old = (previous.get(station.id) ?? []).filter((r) => r.time >= keepFrom);
        let merged: Observation[] = old;
        try {
          if (swept instanceof Error) throw swept;
          const answer = swept ? swept.get(station.id) : undefined;
          if (answer instanceof Error) throw answer;
          const fetched = swept
            ? (answer ?? [])
            : await source.observations!(station, since, new Date(now));
          // QC the whole window, so spikes and flatlines are judged against their neighbors.
          // Nothing new keeps what we had, rather than clearing the last hours.
          if (fetched.length)
            merged = qc(
              mergeFetched(old, fetched, since.getTime(), now, now),
              qcFor(source, station),
            );
        } catch (error) {
          // Keep what we had; a failed fetch mustn't empty the window.
          failed.push(`${station.id}: ${error instanceof Error ? error.message : error}`);
        }
        for (const r of merged) rows.push({ ...r, station: station.id });
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

async function committedStations(sourceId: string): Promise<Station[]> {
  try {
    return JSON.parse(await readFile(`${STATIONS_DIR}/${sourceId}.json`, "utf8")) as Station[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/** A station by its ID or its source's own code. */
function find(list: Station[], sourceId: string, id: string): Station {
  const station = list.find((s) => s.id === id || s.id === `${sourceId}/${id}`);
  if (!station) throw new Error(`No station ${id} in stations/${sourceId}.json`);
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
    "usage: ingest.ts stations [source...] | backfill <source> <station,...|all> <start> <end> [--first FILE] [--shard I/N] [--refetch | --skip-written] | recent <source> [--hours N] [--keep-days N]",
  );
  process.exit(1);
}
