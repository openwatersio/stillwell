/**
 * Rows in a datum epoch's files from outside that epoch's span. An epoch
 * opened with a start in the past, such as RWS's split at the 2005 NAP
 * revision or a zero move a refresh finds later, ends the earlier epoch
 * before values already written to its files; readers and every writer go by
 * span, so those rows are never read, but they stay in the files. `misplaced`
 * finds them and drops each one whose time the epoch that holds it already
 * has, since the store's values belong there and came from a later fetch.
 * A row no epoch's span holds, or whose epoch lacks its time, stays and is
 * reported: moving it would assume it's in that epoch's reference.
 */
import type { StoredStation } from "../schema.ts";
import { dropTimes, listFiles, readTimes } from "./parquet.ts";
import { DATASET, PRODUCTS, seriesPath, sourceEpochDirs, sourceFirstEpochFiles } from "./paths.ts";
import { epochWindow } from "./recent.ts";
import { markYears, reconcileYears } from "./years.ts";
import type { Product } from "../schema.ts";

/** One file with rows outside its epoch's span. */
export interface MisplacedFile {
  file: string;
  product: Product;
  id: string;
  epoch: number;
  year: number;
  /** Rows outside the span whose own epoch holds their time: dropped, or with `dryRun`, to drop. */
  dropped: number;
  /** Rows outside the span its own epoch lacks, or that no epoch's span holds: kept. */
  kept: { time: number; epoch: number | null }[];
  /** Whether the file is left with no rows, so it's deleted. */
  emptied: boolean;
}

/** The product, station, epoch and year of a series file under `<dataset>/<source>/`; null for any other path. */
export function seriesFileKey(
  source: string,
  file: string,
): { product: Product; sourceId: string; epoch: number; year: number } | null {
  const parts = file.split("/");
  const year = Number(parts.at(-1)!.replace(/\.parquet$/, ""));
  // Epoch 1's files sit in the station's directory; a later epoch's one level down, so a station named like its source still parses.
  const first = parts.at(-3) === source && PRODUCTS.some((p) => DATASET[p] === parts.at(-4));
  const at = first ? -4 : -5;
  const product = PRODUCTS.find((p) => DATASET[p] === parts.at(at));
  const epoch = first ? 1 : Number(parts.at(-2));
  const dir = parts.at(first ? -2 : -3);
  if (!product || parts.at(at + 1) !== source || !Number.isInteger(year) || !dir) return null;
  if (!Number.isInteger(epoch)) return null;
  try {
    return { product, sourceId: decodeURIComponent(dir), epoch, year };
  } catch {
    return null;
  }
}

const span = (from: number, to: number, year: number) =>
  from <= Date.UTC(year, 0, 1) && to >= Date.UTC(year + 1, 0, 1);

/**
 * Find a source's rows outside their epoch's span, in every product, and
 * drop those whose own epoch holds their time, deleting a file left empty,
 * then bring the years file in line. With `dryRun`, changes nothing and
 * reports what it would do. `remove` deletes files (`removePrefixes`).
 */
export async function misplaced(
  store: string,
  source: string,
  stations: StoredStation[],
  remove: (store: string, files: string[]) => Promise<void>,
  { dryRun = false, keep = () => true }: { dryRun?: boolean; keep?: (id: string) => boolean } = {},
): Promise<{ files: MisplacedFile[]; unlisted: string[]; failed: string[] }> {
  const bySourceId = new Map(stations.map((s) => [s.source_id, s]));
  const files: MisplacedFile[] = [];
  const unlisted: string[] = [];
  const candidates: {
    file: string;
    product: Product;
    station: StoredStation;
    epoch: number;
    year: number;
  }[] = [];
  for (const product of PRODUCTS)
    for (const file of [
      ...(await listFiles(sourceFirstEpochFiles(store, product, source))),
      ...(await listFiles(sourceEpochDirs(store, product, source))),
    ]) {
      const key = seriesFileKey(source, file);
      const station = key && bySourceId.get(key.sourceId);
      if (!key || !station) {
        unlisted.push(file);
        continue;
      }
      const window = epochWindow(station.epochs, key.epoch);
      // A held epoch's rows wait for a decision; a file of an epoch the list lacks is reported.
      if (!station.epochs.some((e) => e.id === key.epoch)) unlisted.push(file);
      if (!window || span(window[0], window[1], key.year)) continue;
      candidates.push({ file, product, station, epoch: key.epoch, year: key.year });
    }
  for (const c of candidates) {
    // Each target read once for this file, and let go after it, so a source's whole history isn't held at once.
    const held = new Map<string, Promise<Set<number>>>();
    const timesOf = (file: string) => {
      if (!held.has(file))
        held.set(
          file,
          readTimes(file).then((t) => new Set(t)),
        );
      return held.get(file)!;
    };
    const [from, until] = epochWindow(c.station.epochs, c.epoch)!;
    const times = await readTimes(c.file);
    const outside = times.filter((t) => t < from || t >= until);
    if (!outside.length) continue;
    const drop: number[] = [];
    const kept: MisplacedFile["kept"] = [];
    for (const time of outside) {
      const owner = c.station.epochs.find((e) => {
        if (e.state !== "open" && e.state !== "closed") return false;
        const w = epochWindow(c.station.epochs, e.id);
        return w !== null && time >= w[0] && time < w[1];
      });
      const target =
        owner && seriesPath(store, c.product, source, c.station.source_id, c.year, owner.id);
      if (target && (await timesOf(target)).has(time)) drop.push(time);
      else kept.push({ time, epoch: owner?.id ?? null });
    }
    const entry: MisplacedFile = {
      file: c.file,
      product: c.product,
      id: c.station.id,
      epoch: c.epoch,
      year: c.year,
      dropped: drop.length,
      kept,
      emptied: drop.length === times.length,
    };
    files.push(entry);
    if (dryRun || !drop.length) continue;
    // Marked before the write, so a stopped run leaves the station for the next reconcile to read.
    if (c.product === "levels") await markYears(store, source, [c.station.id]);
    if (entry.emptied || !(await dropTimes(c.file, drop))) await remove(store, [c.file]);
  }
  const touched = [
    ...new Set(files.filter((f) => f.product === "levels" && f.dropped).map((f) => f.id)),
  ];
  const years =
    !dryRun && touched.length
      ? await reconcileYears(store, source, { reread: touched, keep })
      : null;
  return { files, unlisted, failed: years?.failed ?? [] };
}
