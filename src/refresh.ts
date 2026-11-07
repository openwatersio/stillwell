/**
 * Station lists in the lake: refreshing a source's list, and publishing
 * stations.parquet from every list. docs/stations.md has the design.
 */
import { isDeepStrictEqual } from "node:util";
import { currentEpoch } from "./epochs.ts";
import {
  exists,
  anyFile,
  highestEpochs,
  recentEpochs,
  readStationBounds,
  readStationList,
  writeJsonArray,
  writeStationList,
  writeStations,
} from "./lake/parquet.ts";
import {
  boundsPath,
  epochDirs,
  sourceEpochDirs,
  sourceFirstEpochFiles,
  stationDir,
  recentPath,
  historyPath,
  stationListPath,
  stationsPath,
  sourcesPath,
  PRODUCTS,
} from "./lake/paths.ts";
import type { LakeStation, ListedStation, Source, SourceMetadata, Station } from "./schema.ts";
import { linkBothWays, mergeStationList, type EpochChange } from "./stations.ts";

/** What a refresh changed, written beside its snapshot. */
export interface RefreshReport {
  source: string;
  time: string;
  added: string[];
  retired: string[];
  /** Retired by the source itself, listed inactive, rather than dropped from its list. */
  withdrawn: string[];
  changed: { id: string; fields: string[] }[];
  epochs: EpochChange[];
}

export interface RefreshOptions {
  now: string;
  /** Accept more epochs opening at once than the guard allows, after a person checked them. */
  acceptEpochs?: boolean;
}

/** Why a refresh kept the previous list, as an error the caller reports. */
export class Refused extends Error {}

/**
 * Refresh one source's list in `lake`: fetch, merge, check, snapshot the
 * previous list and write the new one. Throws `Refused`, writing nothing, when
 * a guard fails.
 */
export async function refreshSource(
  lake: string,
  source: Source,
  options: RefreshOptions,
): Promise<{ stations: LakeStation[]; report: RefreshReport }> {
  const id = source.metadata.id;
  const listPath = stationListPath(lake, id);
  const stored = await readStationList(listPath);
  // A list that went missing would read as an empty lake, and rebuild every station.
  if (!stored && (await hasHistory(lake, id))) throw new Refused(lostList(lake, id));
  // Nor is a lake with the source's series a new source: a list started from
  // the fetch would forget what the old one carried forward, such as USACE's
  // series picks, and write another series into the same files.
  if (!stored && (await hasSeries(lake, id)))
    throw new Refused(
      `the lake has ${id} series but no list or history for it; copy stations/${id}.parquet in from a snapshot or another lake, such as the public one at https://water-levels.openwaters.io, rather than start one from the fetch`,
    );
  const previous = stored ?? [];

  const fetched = await source.stations(previous);
  if (!fetched.length) throw new Refused("listed no stations");
  const stray = fetched.find((s) => s.source !== id || !s.source_id);
  if (stray) throw new Refused(`${stray.id} isn't a ${id} station with a code`);
  const shrunk = shrankSharply(previous, fetched);
  if (shrunk) throw new Refused(shrunk);

  const options_ = {
    now: options.now,
    offsets: source.metadata.utc_offsets ?? ([0, 0] as [number, number]),
    archive: source.metadata.archive,
    decisions: source.overrides?.epochs ?? {},
    seriesChanged: source.seriesChanged?.bind(source),
  };
  const { stations, changes } = mergeStationList(previous, fetched, options_);
  // A fetch whose stations all lack a datum merges to nothing for a new source.
  if (!stations.length) throw new Refused("listed no stations with a datum");
  await renumberAboveFiles(lake, stations, previous);
  const opened = changes.filter((c) => c.event === "opened" || c.event === "held");
  // A station already waiting on a person isn't a new change.
  const limit = Math.max(5, Math.floor(previous.length * 0.02));
  if (opened.length > limit && !options.acceptEpochs)
    throw new Refused(
      `${opened.length} stations changed datum at once (limit ${limit}): ${opened.map((c) => c.id).join(", ")}; check them and rerun with --accept-epochs`,
    );

  const listedInactive = new Set(fetched.filter((s) => s.status === "inactive").map((s) => s.id));
  const report = reportOf(id, options.now, previous, stations, changes, listedInactive);
  // The list it read goes to history before it's replaced. A new source's
  // snapshot, its empty list, goes after its first list instead, so a run cut
  // short between the two can't leave history with no list to refuse on.
  const snapshot = async () => {
    await writeStationList(historyPath(lake, id, options.now, "parquet"), previous);
    await writeJsonArray(historyPath(lake, id, options.now, "json"), [report]);
  };
  if (stored) await snapshot();
  await writeStationList(listPath, stations);
  if (!stored) await snapshot();
  return { stations, report };
}

/**
 * A new epoch takes an `id` above any epoch directory already in the lake, or
 * any epoch the recent window still has rows for, so one restored from a
 * snapshot never reuses another's files or rows.
 */
async function renumberAboveFiles(
  lake: string,
  stations: LakeStation[],
  previous: LakeStation[],
): Promise<void> {
  const before = new Map(previous.map((s) => [s.id, new Set(s.epochs.map((e) => e.id))]));
  const changed = stations.filter((s) => {
    const known = before.get(s.id);
    return s.epochs.some((e) => !known?.has(e.id));
  });
  if (!changed.length) return;
  // Every product, not only the ones a station lists now: one it dropped may
  // still have files under an epoch id. A source's first refresh has every
  // station new, and one listing per product beats one per station; a few
  // stations are cheaper one by one.
  const patterns =
    changed.length > 50
      ? PRODUCTS.map((p) => sourceEpochDirs(lake, p, changed[0]!.source))
      : changed.flatMap((s) => PRODUCTS.map((p) => epochDirs(lake, p, s.source, s.source_id)));
  const onDiskOf = await highestEpochs(patterns);
  const inRecent = await recentEpochs(recentPath(lake, changed[0]!.source));
  for (const station of changed) {
    const known = before.get(station.id) ?? new Set<number>();
    const fresh = station.epochs.filter((e) => !known.has(e.id));
    const onDisk = Math.max(
      inRecent.get(station.id) ?? 1,
      ...PRODUCTS.map(
        (p) => onDiskOf.get(stationDir(lake, p, station.source, station.source_id)) ?? 1,
      ),
    );
    // A station new to the list with no later epochs on disk starts at 1.
    if (!known.size && onDisk === 1) continue;
    let next = Math.max(onDisk + 1, ...[...known].map((n) => n + 1));
    for (const epoch of fresh) epoch.id = Math.max(epoch.id, next++);
  }
}

/**
 * Rebuild `stations.parquet` and `sources.json` in `lake` from the lists of
 * `all`, the sources it holds, and their bounds. A source in `expected` that
 * has no list, because it went missing, stops the rebuild, which would
 * otherwise drop its stations from what the lake publishes; it returns the
 * missing ones. A source in neither is new, and
 * joins once it has a list.
 */
export async function publishStations(
  lake: string,
  all: Source[],
  expected: string[],
): Promise<{ count: number } | { missing: string[] }> {
  let stations: LakeStation[] = [];
  const listed: Source[] = [];
  const missing: string[] = [];
  for (const source of all) {
    const list = await readStationList(stationListPath(lake, source.metadata.id));
    if (!list) {
      if (expected.includes(source.metadata.id)) missing.push(source.metadata.id);
      continue;
    }
    listed.push(source);
    const bounds = await readStationBounds(boundsPath(lake, source.metadata.id));
    stations.push(...list.map((s) => ({ ...s, ...bounds.get(s.id) })));
  }
  if (missing.length || !listed.length) return { missing };
  stations = linkBothWays(stations);
  await writeStations(stationsPath(lake), stations);
  await writeJsonArray(
    sourcesPath(lake),
    listed.map((s) => ({
      ...Object.fromEntries(Object.entries(s.metadata).filter(([key]) => !INGEST_ONLY.has(key))),
      stations: stations.filter((st) => st.source === s.metadata.id && st.status === "active")
        .length,
    })),
  );
  return { count: stations.length };
}

/**
 * Metadata that is ingest's business, not part of a source's terms, so
 * `sources.json` leaves it out: QC settings, offsets, the archive's reference,
 * and which scheduled jobs run for the source.
 */
const INGEST_ONLY = new Set(["qc", "utc_offsets", "archive", "hourly", "finalizes"]);

/** A source's list from the lake, or an error naming what to run. */
export async function listOf(lake: string, sourceId: string): Promise<LakeStation[]> {
  const list = await readStationList(stationListPath(lake, sourceId));
  if (!list && (await hasHistory(lake, sourceId))) throw new Error(lostList(lake, sourceId));
  if (!list)
    throw new Error(
      `No station list for ${sourceId} in ${lake}; run \`stations ${sourceId}\` to start it`,
    );
  return list;
}

/**
 * A source's list from the lake, or null for a source whose list was never
 * started, such as one registered since the last Monthly refresh. A list that
 * existed and is gone, or series with no list, are still errors.
 */
export async function startedListOf(lake: string, sourceId: string): Promise<LakeStation[] | null> {
  const list = await readStationList(stationListPath(lake, sourceId));
  if (list) return list;
  if (await hasHistory(lake, sourceId)) throw new Error(lostList(lake, sourceId));
  // The refresh refuses such a lake too, so waiting for it would wait for good.
  if (await hasSeries(lake, sourceId))
    throw new Error(`the lake has ${sourceId} series but no list or history for it`);
  return null;
}

/** Whether `lake` holds any of a source's values: series files in any epoch, or a recent window. */
async function hasSeries(lake: string, sourceId: string): Promise<boolean> {
  if (await exists(recentPath(lake, sourceId))) return true;
  return anyFile(
    PRODUCTS.flatMap((p) => [
      sourceFirstEpochFiles(lake, p, sourceId),
      sourceEpochDirs(lake, p, sourceId),
    ]),
  );
}

/** Whether a source's list has ever been written to `lake`. */
export async function hasHistory(lake: string, sourceId: string): Promise<boolean> {
  return exists(historyPath(lake, sourceId, "*", "parquet"));
}

function lostList(lake: string, sourceId: string): string {
  return `the lake has history for ${sourceId} but no list at ${stationListPath(lake, sourceId)}; copy its latest snapshot in history/ back rather than start over`;
}

/** The epoch new values for a station go to. */
export function epochOf(station: LakeStation): number {
  return currentEpoch(station.epochs).id;
}

/**
 * A list that suddenly lists fewer than half the active or live stations it
 * did is a truncated response, not half the network retiring; taken at its
 * word, it would end those stations' feeds and backfills.
 */
export function shrankSharply(previous: Station[], fetched: ListedStation[]): string | null {
  const active = previous.filter((s) => s.status === "active");
  for (const [what, before, now] of [
    ["stations", active.length, fetched.length],
    ["live stations", active.filter((s) => s.live).length, fetched.filter((s) => s.live).length],
  ] as const)
    if (before >= 20 && now < before / 2) return `lists ${now} ${what}, down from ${before}`;
  return null;
}

const COMPARED = (s: LakeStation) => {
  const { epochs: _, first: __, last: ___, ...fields } = s;
  return fields;
};

function reportOf(
  source: string,
  time: string,
  previous: LakeStation[],
  stations: LakeStation[],
  epochs: EpochChange[],
  listedInactive: Set<string>,
): RefreshReport {
  const before = new Map(previous.map((s) => [s.id, s]));
  const report: RefreshReport = {
    source,
    time,
    added: [],
    retired: [],
    withdrawn: [],
    changed: [],
    epochs,
  };
  for (const station of stations) {
    const old = before.get(station.id);
    if (!old) {
      report.added.push(station.id);
      continue;
    }
    if (old.status === "active" && station.status === "inactive") {
      report.retired.push(station.id);
      if (listedInactive.has(station.id)) report.withdrawn.push(station.id);
    }
    const [a, b] = [COMPARED(old), COMPARED(station)] as Record<string, unknown>[];
    // A field left out, as the lists seeded from YAML files leave out nulls, is null.
    const fields = [...new Set([...Object.keys(a!), ...Object.keys(b!)])]
      .filter((key) => !isDeepStrictEqual(a![key] ?? null, b![key] ?? null))
      .sort();
    if (fields.length) report.changed.push({ id: station.id, fields });
  }
  return report;
}

/** A report as lines for a log or a job summary. */
export function describeReport(report: RefreshReport): string[] {
  const lines = [
    `${report.source}: ${report.added.length} added, ${report.retired.length} retired, ${report.changed.length} changed`,
  ];
  for (const id of report.added.slice(0, 20)) lines.push(`  added ${id}`);
  for (const id of report.retired)
    lines.push(
      `  retired ${id}${report.withdrawn.includes(id) ? ", by the source; see its log above" : ""}`,
    );
  for (const c of report.changed.slice(0, 50)) lines.push(`  ${c.id}: ${c.fields.join(", ")}`);
  for (const e of report.epochs)
    lines.push(
      `  ${e.id}: epoch ${e.event}, ${e.from} to ${e.to}${e.reason ? ` (${e.reason})` : ""}; overrides key "${e.key}"`,
    );
  return lines;
}
