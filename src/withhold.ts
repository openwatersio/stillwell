import { deletesFiles } from "./sources/gesla/dropped.ts";
/**
 * Stations withheld from the store, because their owner refused republication
 * or their values aren't water levels (`Source.withheld`). A refresh drops them from the source's list and their
 * rows from its bounds, years, daily files, empty-years record, backfilled years, requalify list and analysis, and publishing
 * leaves them out of stations.parquet. `ingest withhold <source>` deletes
 * their series files, and their rows, from a store that still holds them.
 */
import { dropAnalysis, readAnalysis } from "./store/analysis.ts";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import {
  exists,
  listFiles,
  listable,
  listedIds,
  readJsonArray,
  readRecent,
  readStationBounds,
  recentStations,
  writeJsonArray,
  writeRecent,
  writeStationBounds,
} from "./store/parquet.ts";
import {
  backfilledPath,
  boundsPath,
  DATASET,
  emptyYearsPath,
  historyPath,
  PRODUCTS,
  recentDayPath,
  recentDayPaths,
  RECENT_DAYS,
  requalifyLeftPath,
  sourceEpochDirs,
  sourceFirstEpochFiles,
  stationDir,
  stationListPath,
} from "./store/paths.ts";
import type { Source } from "./schema.ts";
import { dropYears } from "./store/years.ts";
import { dropFits } from "./fit/store.ts";

/** Why a station, by its store ID, is withheld, or null; null for another source's station. */
export function withheldReason(source: Source, id: string): string | null {
  const prefix = `${source.metadata.id}/`;
  if (!source.withheld || !id.startsWith(prefix)) return null;
  return source.withheld(id.slice(prefix.length));
}

/**
 * Drop withheld stations' rows from the source's bounds, years, daily files,
 * empty-years record, backfilled years, requalify list, analysis, with its history, and fits, in `store`, rewriting only a file that holds one. Returns
 * the station IDs it dropped rows for.
 */
export async function dropWithheldRows(store: string, source: Source): Promise<string[]> {
  if (!source.withheld) return [];
  const id = source.metadata.id;
  const held = (station: string) => withheldReason(source, station) !== null;
  const dropped = new Set<string>();

  const bounds = await readStationBounds(boundsPath(store, id));
  const gone = [...bounds.keys()].filter(held);
  if (gone.length) {
    for (const station of gone) dropped.add(station);
    // A file without `preliminary` stays without it, as compaction keeps it.
    const preliminary = ![...bounds.values()].some((b) => b.preliminary === undefined);
    await writeStationBounds(
      boundsPath(store, id),
      [...bounds]
        .filter(([station]) => !held(station))
        .map(([station, b]) => ({ id: station, ...b })),
      preliminary,
    );
  }

  for (const path of await recentFiles(store, id)) {
    const inRecent = (await recentStations(path)).filter(held);
    if (!inRecent.length) continue;
    for (const station of inRecent) dropped.add(station);
    const rows = await readRecent(path);
    await writeRecent(path, [rows.filter((r) => !held(r.station))]);
  }

  const emptyPath = emptyYearsPath(store, id);
  const empty = ((await readJsonArray(emptyPath)) ?? []) as { key: string; seen: string }[];
  // Each key starts with the station's ID (`emptyKey`).
  const stationOf = (key: string) => key.split(" ")[0]!;
  if (empty.some((r) => held(stationOf(r.key)))) {
    for (const r of empty) if (held(stationOf(r.key))) dropped.add(stationOf(r.key));
    await writeJsonArray(
      emptyPath,
      empty.filter((r) => !held(stationOf(r.key))),
    );
  }
  for (const path of [requalifyLeftPath(store, id), backfilledPath(store, id)]) {
    const rows = ((await readJsonArray(path)) ?? []) as { id: string }[];
    if (!rows.some((r) => held(r.id))) continue;
    for (const r of rows) if (held(r.id)) dropped.add(r.id);
    await writeJsonArray(
      path,
      rows.filter((r) => !held(r.id)),
    );
  }
  for (const station of await dropAnalysis(store, id, held)) dropped.add(station);
  // Constants fitted to a station's values leave with them.
  for (const station of await dropFits(store, id, held)) dropped.add(station);
  // Last, so the values themselves are gone even if this file can't be written.
  for (const station of await dropYears(store, id, held)) dropped.add(station);
  return [...dropped].sort();
}

/**
 * A source's daily files: those a listing finds, where the store can be
 * listed, and the last `RECENT_DAYS` days', which a short listing may miss.
 * A day with no file reads as empty.
 */
async function recentFiles(store: string, id: string): Promise<string[]> {
  const listed = listable(store) ? await listFiles(recentDayPath(store, id, "*")) : [];
  return [...new Set([...listed, ...recentDayPaths(store, id, Date.now(), RECENT_DAYS)])].sort();
}

/**
 * Every withheld station of a source that `store` has known: in its list, any
 * snapshot of the list in history, its bounds, its daily files or, unless
 * `files` is false, a directory of its files, so a run after the refresh
 * dropped them from the list still finds them. Listing the files reads every
 * one of the source's, so a refresh leaves it out. Also returns how many
 * stations the store has known in all.
 */
export async function withheldStations(
  store: string,
  source: Source,
  { files = true }: { files?: boolean } = {},
): Promise<{ ids: string[]; known: number }> {
  const id = source.metadata.id;
  const lists = [
    ...((await exists(stationListPath(store, id))) ? [stationListPath(store, id)] : []),
    ...(await listFiles(historyPath(store, id, "*", "parquet"))),
  ];
  const dirs: string[] = [];
  if (files)
    for (const product of PRODUCTS)
      for (const [pattern, depth] of [
        [sourceFirstEpochFiles(store, product, id), 2],
        [sourceEpochDirs(store, product, id), 3],
      ] as const)
        for (const file of await listFiles(pattern))
          dirs.push(`${id}/${decodeURIComponent(file.split("/").at(-depth)!)}`);
  const known = new Set([
    ...dirs,
    ...(await listedIds(lists)),
    ...(await readStationBounds(boundsPath(store, id))).keys(),
    ...(await recentStations(await recentFiles(store, id))),
    ...(await readAnalysis(store, id)).keys(),
  ]);
  return {
    ids: [...known].filter((s) => withheldReason(source, s) !== null).sort(),
    known: known.size,
  };
}

/**
 * The directories that hold a station's files, one per product, each ending
 * in a slash so it names that station's directory alone. Refuses an ID that
 * would name another directory, such as an empty one or `..`.
 */
export function seriesPrefixes(store: string, source: string, sourceIds: string[]): string[] {
  if (!/^[a-z][a-z0-9-]*$/.test(source)) throw new Error(`Not a source ID: "${source}"`);
  return sourceIds.flatMap((sourceId) => {
    const dir = encodeURIComponent(sourceId);
    // `encodeURIComponent` leaves `.` and `*` alone.
    if (!sourceId.trim() || /^\.*$/.test(dir) || /[*?[\]]/.test(dir))
      throw new Error(`Refusing to delete the files of ${source} station "${sourceId}"`);
    return PRODUCTS.map((product) => {
      const prefix = `${stationDir(store, product, source, sourceId)}/`;
      if (prefix !== `${store}/${DATASET[product]}/${source}/${dir}/`)
        throw new Error(`${prefix} isn't one station's directory`);
      return prefix;
    });
  });
}

/** Which of `ids`, stations of `source`, still have series files in `store`. */
export async function withFiles(store: string, source: string, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const sourceId = id.slice(source.length + 1);
    for (const product of PRODUCTS) {
      const dir = `${stationDir(store, product, source, sourceId)}/`;
      // A glob reads `*`, `?` and `[` in an ID as wildcards, so only files under this exact directory count.
      const files = [
        ...(await listFiles(`${dir}*.parquet`)),
        ...(await listFiles(`${dir}*/*.parquet`)),
      ];
      if (files.some((f) => f.startsWith(dir))) {
        out.push(id);
        break;
      }
    }
  }
  return out;
}

/** `aws` arguments that delete everything under an `s3://` prefix on the store's endpoint. */
export function awsRemoveArgs(prefix: string, endpoint: string): string[] {
  const file = /^s3:\/\/[^/]+\/.+\.parquet$/.test(prefix);
  if (!file && !/^s3:\/\/[^/]+\/.+\/$/.test(prefix))
    throw new Error(`${prefix} isn't a directory or a Parquet file in a bucket`);
  // DuckDB's setup takes S3_ENDPOINT with or without a scheme; the CLI needs one.
  const url = /^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`;
  return [
    "s3",
    "rm",
    prefix,
    ...(file ? [] : ["--recursive"]),
    "--endpoint-url",
    url,
    "--only-show-errors",
  ];
}

/** Refuses a store `withhold` can't delete from: anything but `s3://` or a local path. */
function deletable(store: string): void {
  if (/^[a-z0-9]+:\/\//i.test(store) && !store.startsWith("s3://"))
    throw new Error(
      `Can't delete files from ${store}; withhold needs an s3:// store or a local one`,
    );
}

/**
 * Delete everything under each prefix, or a single Parquet file: from disk for a local store, or with
 * the AWS CLI for an `s3://` one, since DuckDB can't delete objects. The CLI
 * takes the store's `S3_*` credentials.
 */
export async function removePrefixes(store: string, prefixes: string[]): Promise<void> {
  deletable(store);
  if (!store.startsWith("s3://")) {
    for (const prefix of prefixes) await rm(prefix, { recursive: true, force: true });
    return;
  }
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) throw new Error("Deleting from an s3:// store needs S3_ENDPOINT");
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "",
    AWS_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "",
    AWS_DEFAULT_REGION: process.env.S3_REGION ?? "auto",
    // R2 rejects the checksums newer CLIs send by default.
    AWS_REQUEST_CHECKSUM_CALCULATION: "when_required",
    AWS_RESPONSE_CHECKSUM_VALIDATION: "when_required",
  };
  for (const prefix of prefixes) {
    const args = awsRemoveArgs(prefix, endpoint);
    await new Promise<void>((resolve, reject) => {
      const child = spawn("aws", args, { env, stdio: "inherit" });
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`aws ${args.slice(0, 3).join(" ")} exited ${code}`)),
      );
    });
  }
}

/**
 * Delete the series files of the stations in `source`'s list whose source ID
 * `drop` names, such as GESLA's records that hold another gauge's values, and
 * their rows in the years file and the analysis, and the backfilled years of
 * every station `drop` names, files or not, so a run after an earlier one
 * clears what that left; `cleared` lists those, or with `dryRun` would. The
 * rows of every station `drop` names go from the fit files too, files or not. Deletes only the directories that have files, and with `dryRun`
 * deletes nothing, returning what it would delete. The bounds keep them until
 * `compact --rebuild-bounds`.
 */
export async function dropFiles(
  store: string,
  source: string,
  drop: (sourceId: string) => boolean,
  {
    remove = removePrefixes,
    dryRun = false,
  }: { remove?: (store: string, prefixes: string[]) => Promise<void>; dryRun?: boolean } = {},
): Promise<{ ids: string[]; prefixes: string[]; cleared: string[] }> {
  deletable(store);
  const list = stationListPath(store, source);
  if (!(await exists(list))) throw new Error(`The store has no list for ${source}`);
  const named = (await listedIds([list])).filter((id) => drop(id.slice(source.length + 1)));
  const ids = await withFiles(store, source, named);
  const prefixes = seriesPrefixes(
    store,
    source,
    ids.map((id) => id.slice(source.length + 1)),
  );
  const dropped = new Set(named);
  const path = backfilledPath(store, source);
  const recorded = ((await readJsonArray(path)) ?? []) as { id: string }[];
  const cleared = [...new Set(recorded.filter((r) => dropped.has(r.id)).map((r) => r.id))];
  if (dryRun) return { ids, prefixes, cleared };
  if (cleared.length)
    await writeJsonArray(
      path,
      recorded.filter((r) => !dropped.has(r.id)),
    );
  // Before the files and whether or not any are left, so a drop stopped after deleting them still takes these on its next run.
  await dropFits(store, source, (id) => dropped.has(id));
  if (!ids.length) return { ids, prefixes, cleared };
  await remove(store, prefixes);
  const gone = new Set(ids);
  await dropAnalysis(store, source, (id) => gone.has(id));
  await dropYears(store, source, (id) => gone.has(id));
  return { ids, prefixes, cleared };
}

/**
 * The most stations one run may withhold, of those the store has known,
 * beyond which a rule more likely matches by mistake. `--accept-withheld`
 * lifts it, for the refresh and `withhold` alike.
 */
export function withholdLimit(known: number): number {
  return Math.max(5, Math.floor(known * 0.02));
}

/** Why withholding `count` of `known` stations is refused, or null when it's within the limit. */
export function tooManyWithheld(source: string, count: number, known: number): string | null {
  const limit = withholdLimit(known);
  return count > limit
    ? `${count} of the ${known} ${source} stations the store has known are withheld, more than ${limit}; check the rule, then rerun with --accept-withheld`
    : null;
}

/**
 * Remove a source's withheld stations from `store`: delete their series files,
 * then drop their rows from the bounds, years, daily files, empty-years record, backfilled years and requalify list.
 * Their list rows go at the source's next refresh. Refuses more stations than
 * `withholdLimit` allows unless `accept`, and a store it can't delete from.
 */
export async function withhold(
  store: string,
  source: Source,
  {
    remove = removePrefixes,
    accept = false,
  }: { remove?: (store: string, prefixes: string[]) => Promise<void>; accept?: boolean } = {},
): Promise<{ ids: string[]; prefixes: string[]; rows: string[] }> {
  const id = source.metadata.id;
  if (!source.withheld) throw new Error(`${id} withholds no stations`);
  deletable(store);
  const { ids, known } = await withheldStations(store, source);
  const tooMany = tooManyWithheld(id, ids.length, known);
  if (tooMany && !accept) throw new Error(tooMany);
  const prefixes = seriesPrefixes(
    store,
    id,
    ids.map((s) => s.slice(id.length + 1)),
  );
  await remove(store, prefixes);
  const rows = await dropWithheldRows(store, source);
  return { ids, prefixes, rows };
}

/** The records whose files `drop` deletes, by source; a dropped record is known only through its source's list. */
export const DROPS: Record<string, (sourceId: string) => boolean> = { gesla: deletesFiles };
