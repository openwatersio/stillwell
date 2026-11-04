/**
 * Fetch from upstream sources into the lake.
 *
 *   node scripts/ingest.ts stations [source...]
 *   node scripts/ingest.ts backfill <source> <station,...|all> <start> <end>
 *   node scripts/ingest.ts recent <source> [--hours 24] [--keep-days 7]
 *
 * `stations` refreshes the committed lists in stations/<source>.json, then
 * writes stations.parquet and sources.json to the lake. `backfill` writes every
 * product a station has over [start, end) (dates as YYYY or YYYY-MM-DD, end
 * exclusive) into its yearly files, replacing that range and keeping the rest,
 * so a rerun gives the same files. `recent` fetches the last hours for every
 * live station and merges them into recent/<source>.parquet.
 *
 * The lake is WATER_LEVELS_LAKE: a directory (default `data`) or an `s3://` URL.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { useDiskCache } from "../src/cache.ts";
import { mergeRange, sameRows } from "../src/lake/merge.ts";
import {
  readExtremes,
  readObservations,
  readRecent,
  writeExtremes,
  writeJsonArray,
  writeObservations,
  writeRecent,
  writeStations,
  type StationObservation,
} from "../src/lake/parquet.ts";
import { recentPath, seriesPath, sourcesPath, stationsPath } from "../src/lake/paths.ts";
import { qc } from "../src/qc.ts";
import type { Observation, Product, PublishedExtreme, Source, Station } from "../src/schema.ts";
import { sourceOf, sources } from "../src/sources/index.ts";

const LAKE = (process.env.WATER_LEVELS_LAKE ?? "data").replace(/\/$/, "");
const STATIONS_DIR = "stations";
const DAY_MS = 86_400_000;

useDiskCache();

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    hours: { type: "string", default: "24" },
    "keep-days": { type: "string", default: "7" },
    concurrency: { type: "string", default: "4" },
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
    const fetched = await sourceOf(id).stations();
    const previous = await committedStations(id);
    const fresh = new Set(fetched.map((s) => s.id));
    const before = new Map(previous.map((s) => [s.id, s]));
    const merged = [
      // Fields the lake fills in later survive a refresh.
      ...fetched.map((s) => {
        const old = before.get(s.id);
        return {
          ...s,
          first: s.first ?? old?.first ?? null,
          last: s.last ?? old?.last ?? null,
          tide_station: s.tide_station ?? old?.tide_station ?? null,
        };
      }),
      // A station the source stopped listing stays, marked inactive, so its ID is never reused.
      ...previous
        .filter((s) => !fresh.has(s.id))
        .map((s) => ({ ...s, status: "inactive" as const })),
    ].sort((a, b) => a.id.localeCompare(b.id));
    await writeFile(`${STATIONS_DIR}/${id}.json`, JSON.stringify(merged, null, 2) + "\n");
    const inactive = merged.length - fetched.length;
    console.log(`${id}: ${fetched.length} active, ${inactive} inactive`);
  }

  const all: Station[] = [];
  for (const file of (await readdir(STATIONS_DIR)).filter((f) => f.endsWith(".json")).sort())
    all.push(...(await committedStations(file.replace(/\.json$/, ""))));
  // Links run both ways in the lake, whichever list recorded them.
  const links = new Map<string, Set<string>>();
  for (const s of all)
    for (const other of s.same_as) {
      links.set(s.id, (links.get(s.id) ?? new Set()).add(other));
      links.set(other, (links.get(other) ?? new Set()).add(s.id));
    }
  for (const s of all) s.same_as = [...(links.get(s.id) ?? [])].sort();
  await writeStations(stationsPath(LAKE), all);
  await writeJsonArray(
    sourcesPath(LAKE),
    Object.values(sources).map((s) => ({
      ...s.metadata,
      stations: all.filter((st) => st.source === s.metadata.id && st.status === "active").length,
    })),
  );
  console.log(`${stationsPath(LAKE)}: ${all.length} stations`);
}

async function backfill(sourceId: string, ids: string, start: Date, end: Date): Promise<void> {
  const source = sourceOf(sourceId);
  const list = await committedStations(sourceId);
  if (!list.length)
    throw new Error(`No stations/${sourceId}.json; run \`stations ${sourceId}\` first`);
  const wanted = ids === "all" ? list : ids.split(",").map((id) => find(list, sourceId, id));
  // Sources with a rolling window can't reach further back than it.
  const window = source.metadata.window_days;
  if (window) start = new Date(Math.max(start.getTime(), Date.now() - window * DAY_MS));

  await pool(wanted, async (station) => {
    for (const product of station.products) {
      for (const [from, to] of years(start, end)) {
        const written = await backfillYear(source, station, product, from, to);
        if (written !== undefined)
          console.log(`${station.id} ${product} ${from.getUTCFullYear()}: ${written} rows`);
      }
    }
  });
}

/** Returns how many rows the year's file now holds, or undefined when nothing changed. */
async function backfillYear(
  source: Source,
  station: Station,
  product: Product,
  from: Date,
  to: Date,
): Promise<number | undefined> {
  const path = seriesPath(LAKE, product, station.source, station.source_id, from.getUTCFullYear());
  const range = [from.getTime(), to.getTime()] as const;
  if (product === "levels" || product === "predictions") {
    const get = product === "levels" ? source.observations : source.predictions;
    if (!get) return undefined;
    let rows = await get(station, from, to);
    if (product === "levels") rows = qc(rows);
    const existing = await readObservations(path);
    const merged = mergeRange(existing, rows, ...range);
    if (!merged.length || sameRows(existing, merged)) return undefined;
    await writeObservations(path, merged);
    return merged.length;
  }
  const get = product === "extremes" ? source.extremes : source.predictedExtremes;
  if (!get) return undefined;
  const rows = await get(station, from, to);
  const existing = await readExtremes(path);
  const merged = mergeRange<PublishedExtreme>(existing, rows, ...range);
  if (!merged.length || sameRows(existing, merged)) return undefined;
  await writeExtremes(path, merged);
  return merged.length;
}

async function recent(sourceId: string, hours: number, keepDays: number): Promise<void> {
  const source = sourceOf(sourceId);
  if (!source.observations) throw new Error(`${sourceId} has no observations`);
  const stations = (await committedStations(sourceId)).filter(
    (s) => s.live && s.status === "active" && s.products.includes("levels"),
  );
  const now = Date.now();
  const since = new Date(now - hours * 3_600_000);
  const keepFrom = now - keepDays * DAY_MS;
  const path = recentPath(LAKE, sourceId);
  const previous = Map.groupBy(await readRecent(path), (r) => r.station);
  const rows: StationObservation[] = [];
  const failed: string[] = [];

  await pool(stations, async (station) => {
    const old = (previous.get(station.id) ?? []).filter((r) => r.time >= keepFrom);
    let merged: Observation[] = old;
    try {
      const fetched = await source.observations!(station, since, new Date(now));
      // QC the whole window, so spikes and flatlines are judged against their neighbors.
      merged = qc(mergeRange(old, fetched, since.getTime(), now, now));
    } catch (error) {
      // Keep what we had; a failed fetch mustn't empty the window.
      failed.push(`${station.id}: ${error instanceof Error ? error.message : error}`);
    }
    for (const r of merged) rows.push({ ...r, station: station.id });
  });

  await writeRecent(path, rows);
  const reporting = new Set(rows.filter((r) => r.received === now).map((r) => r.station)).size;
  console.log(
    `${path}: ${rows.length} rows, ${reporting} of ${stations.length} stations sent new values, ${failed.length} failed`,
  );
  for (const f of failed.slice(0, 20)) console.log(`  ${f}`);
  if (stations.length && failed.length === stations.length) process.exit(1);
}

async function committedStations(sourceId: string): Promise<Station[]> {
  try {
    return JSON.parse(await readFile(`${STATIONS_DIR}/${sourceId}.json`, "utf8")) as Station[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function find(list: Station[], sourceId: string, id: string): Station {
  const station = list.find(
    (s) => s.source_id === id || s.id === id || s.id === `${sourceId}:${id}`,
  );
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
    "usage: ingest.ts stations [source...] | backfill <source> <station,...|all> <start> <end> | recent <source> [--hours N] [--keep-days N]",
  );
  process.exit(1);
}
