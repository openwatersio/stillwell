/**
 * Stations withheld from the lake because their owner refused republication
 * (`Source.withheld`). A refresh drops them from the source's list and their
 * rows from its bounds, years, recent window and empty-years record, and publishing
 * leaves them out of stations.parquet. `ingest withhold <source>` deletes
 * their series files, and their rows, from a lake that still holds them.
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import {
  exists,
  listFiles,
  listedIds,
  readJsonArray,
  readRecent,
  readStationBounds,
  recentStations,
  writeJsonArray,
  writeRecent,
  writeStationBounds,
} from "./lake/parquet.ts";
import {
  boundsPath,
  DATASET,
  emptyYearsPath,
  historyPath,
  PRODUCTS,
  recentPath,
  sourceEpochDirs,
  sourceFirstEpochFiles,
  stationDir,
  stationListPath,
} from "./lake/paths.ts";
import type { Source } from "./schema.ts";
import { dropYears } from "./lake/years.ts";

/** Why a station, by its lake ID, is withheld, or null; null for another source's station. */
export function withheldReason(source: Source, id: string): string | null {
  const prefix = `${source.metadata.id}/`;
  if (!source.withheld || !id.startsWith(prefix)) return null;
  return source.withheld(id.slice(prefix.length));
}

/**
 * Drop withheld stations' rows from the source's bounds, years, recent window
 * and empty-years record in `lake`, rewriting only a file that holds one. Returns
 * the station IDs it dropped rows for.
 */
export async function dropWithheldRows(lake: string, source: Source): Promise<string[]> {
  if (!source.withheld) return [];
  const id = source.metadata.id;
  const held = (station: string) => withheldReason(source, station) !== null;
  const dropped = new Set<string>();

  const bounds = await readStationBounds(boundsPath(lake, id));
  const gone = [...bounds.keys()].filter(held);
  if (gone.length) {
    for (const station of gone) dropped.add(station);
    // A file without `preliminary` stays without it, as compaction keeps it.
    const preliminary = ![...bounds.values()].some((b) => b.preliminary === undefined);
    await writeStationBounds(
      boundsPath(lake, id),
      [...bounds]
        .filter(([station]) => !held(station))
        .map(([station, b]) => ({ id: station, ...b })),
      preliminary,
    );
  }

  const recent = recentPath(lake, id);
  const inRecent = (await recentStations(recent)).filter(held);
  if (inRecent.length) {
    for (const station of inRecent) dropped.add(station);
    const rows = await readRecent(recent);
    await writeRecent(recent, [rows.filter((r) => !held(r.station))]);
  }

  const emptyPath = emptyYearsPath(lake, id);
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
  // Last, so the values themselves are gone even if this file can't be written.
  for (const station of await dropYears(lake, id, held)) dropped.add(station);
  return [...dropped].sort();
}

/**
 * Every withheld station of a source that `lake` has known: in its list, any
 * snapshot of the list in history, its bounds, its recent window or, unless
 * `files` is false, a directory of its files, so a run after the refresh
 * dropped them from the list still finds them. Listing the files reads every
 * one of the source's, so a refresh leaves it out. Also returns how many
 * stations the lake has known in all.
 */
export async function withheldStations(
  lake: string,
  source: Source,
  { files = true }: { files?: boolean } = {},
): Promise<{ ids: string[]; known: number }> {
  const id = source.metadata.id;
  const lists = [
    ...((await exists(stationListPath(lake, id))) ? [stationListPath(lake, id)] : []),
    ...(await listFiles(historyPath(lake, id, "*", "parquet"))),
  ];
  const dirs: string[] = [];
  if (files)
    for (const product of PRODUCTS)
      for (const [pattern, depth] of [
        [sourceFirstEpochFiles(lake, product, id), 2],
        [sourceEpochDirs(lake, product, id), 3],
      ] as const)
        for (const file of await listFiles(pattern))
          dirs.push(`${id}/${decodeURIComponent(file.split("/").at(-depth)!)}`);
  const known = new Set([
    ...dirs,
    ...(await listedIds(lists)),
    ...(await readStationBounds(boundsPath(lake, id))).keys(),
    ...(await recentStations(recentPath(lake, id))),
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
export function seriesPrefixes(lake: string, source: string, sourceIds: string[]): string[] {
  if (!/^[a-z][a-z0-9-]*$/.test(source)) throw new Error(`Not a source ID: "${source}"`);
  return sourceIds.flatMap((sourceId) => {
    const dir = encodeURIComponent(sourceId);
    // `encodeURIComponent` leaves `.` and `*` alone.
    if (!sourceId.trim() || /^\.*$/.test(dir) || /[*?[\]]/.test(dir))
      throw new Error(`Refusing to delete the files of ${source} station "${sourceId}"`);
    return PRODUCTS.map((product) => {
      const prefix = `${stationDir(lake, product, source, sourceId)}/`;
      if (prefix !== `${lake}/${DATASET[product]}/${source}/${dir}/`)
        throw new Error(`${prefix} isn't one station's directory`);
      return prefix;
    });
  });
}

/** Which of `ids`, stations of `source`, still have series files in `lake`. */
export async function withFiles(lake: string, source: string, ids: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) {
    const sourceId = id.slice(source.length + 1);
    for (const product of PRODUCTS) {
      const dir = `${stationDir(lake, product, source, sourceId)}/`;
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

/** `aws` arguments that delete everything under an `s3://` prefix on the lake's endpoint. */
export function awsRemoveArgs(prefix: string, endpoint: string): string[] {
  if (!/^s3:\/\/[^/]+\/.+\/$/.test(prefix))
    throw new Error(`${prefix} isn't a directory in a bucket`);
  // DuckDB's setup takes S3_ENDPOINT with or without a scheme; the CLI needs one.
  const url = /^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`;
  return ["s3", "rm", prefix, "--recursive", "--endpoint-url", url, "--only-show-errors"];
}

/** Refuses a lake `withhold` can't delete from: anything but `s3://` or a local path. */
function deletable(lake: string): void {
  if (/^[a-z0-9]+:\/\//i.test(lake) && !lake.startsWith("s3://"))
    throw new Error(`Can't delete files from ${lake}; withhold needs an s3:// lake or a local one`);
}

/**
 * Delete everything under each prefix: from disk for a local lake, or with
 * the AWS CLI for an `s3://` one, since DuckDB can't delete objects. The CLI
 * takes the lake's `S3_*` credentials.
 */
export async function removePrefixes(lake: string, prefixes: string[]): Promise<void> {
  deletable(lake);
  if (!lake.startsWith("s3://")) {
    for (const prefix of prefixes) await rm(prefix, { recursive: true, force: true });
    return;
  }
  const endpoint = process.env.S3_ENDPOINT;
  if (!endpoint) throw new Error("Deleting from an s3:// lake needs S3_ENDPOINT");
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
 * The most stations one run may withhold, of those the lake has known,
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
    ? `${count} of the ${known} ${source} stations the lake has known are withheld, more than ${limit}; check the rule, then rerun with --accept-withheld`
    : null;
}

/**
 * Remove a source's withheld stations from `lake`: delete their series files,
 * then drop their rows from the bounds, years, recent window and empty-years record.
 * Their list rows go at the source's next refresh. Refuses more stations than
 * `withholdLimit` allows unless `accept`, and a lake it can't delete from.
 */
export async function withhold(
  lake: string,
  source: Source,
  {
    remove = removePrefixes,
    accept = false,
  }: { remove?: (lake: string, prefixes: string[]) => Promise<void>; accept?: boolean } = {},
): Promise<{ ids: string[]; prefixes: string[]; rows: string[] }> {
  const id = source.metadata.id;
  if (!source.withheld) throw new Error(`${id} withholds no stations`);
  deletable(lake);
  const { ids, known } = await withheldStations(lake, source);
  const tooMany = tooManyWithheld(id, ids.length, known);
  if (tooMany && !accept) throw new Error(tooMany);
  const prefixes = seriesPrefixes(
    lake,
    id,
    ids.map((s) => s.slice(id.length + 1)),
  );
  await remove(lake, prefixes);
  const rows = await dropWithheldRows(lake, source);
  return { ids, prefixes, rows };
}
