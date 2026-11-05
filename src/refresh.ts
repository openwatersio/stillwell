/**
 * Station lists in the lake: refreshing a source's list, seeding it, and
 * publishing stations.parquet from every list. docs/stations.md has the design.
 */
import { isDeepStrictEqual } from "node:util";
import { currentEpoch, firstEpochs } from "./epochs.ts";
import {
  exists,
  highestEpoch,
  readStationBounds,
  readStationList,
  writeJsonArray,
  writeStationList,
  writeStations,
} from "./lake/parquet.ts";
import {
  boundsPath,
  epochDirs,
  historyPath,
  stationListPath,
  stationsPath,
  sourcesPath,
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
  /** A location outside the lake that every snapshot is also written to. */
  backup?: string;
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
  if (!stored && (await exists(historyPath(lake, id, "*", "parquet"))))
    throw new Refused(`the lake has history for ${id} but no list at ${listPath}`);
  const previous = stored ?? [];

  const fetched = await source.stations(previous);
  if (!fetched.length && previous.length) throw new Refused("listed no stations");
  const shrunk = shrankSharply(previous, fetched);
  if (shrunk) throw new Refused(shrunk);
  refuseMixedTerms(source.metadata, fetched);

  const options_ = {
    now: options.now,
    offsets: source.metadata.utc_offsets ?? ([0, 0] as [number, number]),
    decisions: source.overrides?.epochs ?? {},
  };
  const { stations, changes } = mergeStationList(previous, fetched, options_);
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
  if (stored) {
    for (const root of [lake, options.backup].filter((r): r is string => !!r)) {
      await writeStationList(historyPath(root, id, options.now, "parquet"), stored);
      await writeJsonArray(historyPath(root, id, options.now, "json"), [report]);
    }
  }
  await writeStationList(listPath, stations);
  return { stations, report };
}

/**
 * A new epoch takes an `id` above any epoch directory already in the lake, so
 * one restored from a snapshot never reuses another's files.
 */
async function renumberAboveFiles(
  lake: string,
  stations: LakeStation[],
  previous: LakeStation[],
): Promise<void> {
  const before = new Map(previous.map((s) => [s.id, new Set(s.epochs.map((e) => e.id))]));
  for (const station of stations) {
    const known = before.get(station.id) ?? new Set<number>();
    const fresh = station.epochs.filter((e) => !known.has(e.id));
    if (!fresh.length) continue;
    const onDisk = await highestEpoch(
      station.products.map((p) => epochDirs(lake, p, station.source, station.source_id)),
    );
    // A station new to the list with no later epochs on disk starts at 1.
    if (!known.size && onDisk === 1) continue;
    let next = Math.max(onDisk + 1, ...[...known].map((n) => n + 1));
    for (const epoch of fresh) epoch.id = Math.max(epoch.id, next++);
  }
}

/**
 * Write a source's list into the lake for the first time from a committed
 * list, each station with one epoch. Refuses when the lake already has one.
 */
export async function seedSource(
  lake: string,
  metadata: SourceMetadata,
  committed: Station[],
  now: string,
): Promise<LakeStation[]> {
  const path = stationListPath(lake, metadata.id);
  if (await exists(path)) throw new Refused(`${path} already exists`);
  const offsets = metadata.utc_offsets ?? ([0, 0] as [number, number]);
  const stations = committed.map((s) => {
    // USACE's zero dates are where its current epoch starts.
    const since = (s as Station & { zero_since?: string }).zero_since;
    const reference = since ? { id: since, since } : null;
    return {
      ...s,
      first: null,
      last: null,
      epochs: firstEpochs(
        { datum: s.datum, datums: s.datums, reference },
        { station: s.id, now, offsets, decisions: {} },
      ),
    };
  });
  await writeStationList(path, stations);
  // Seeding counts as the first refresh, so a list lost later is refused, not rebuilt.
  await writeStationList(historyPath(lake, metadata.id, now, "parquet"), stations);
  return stations;
}

/**
 * Rebuild `stations.parquet` and `sources.json` in `lake` from the lists of
 * `all`, the sources it holds, and their bounds. A source in `expected` that
 * has no list yet, because it isn't seeded or its list went missing, stops
 * the rebuild, which would otherwise drop its stations from what the lake
 * publishes; it returns the missing ones. A source in neither is new, and
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
      // QC settings and offsets are ingest's business, not part of a source's terms.
      ...Object.fromEntries(
        Object.entries(s.metadata).filter(([key]) => key !== "qc" && key !== "utc_offsets"),
      ),
      stations: stations.filter((st) => st.source === s.metadata.id && st.status === "active")
        .length,
    })),
  );
  return { count: stations.length };
}

/** A source's list from the lake, or an error naming what to run. */
export async function listOf(lake: string, sourceId: string): Promise<LakeStation[]> {
  const list = await readStationList(stationListPath(lake, sourceId));
  if (!list)
    throw new Error(
      `No station list for ${sourceId} in ${lake}; run \`seed-stations ${sourceId}\`, or \`stations ${sourceId}\` for a new source`,
    );
  return list;
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

/** A source's list lives in one lake, so every station in it shares the source's terms. */
function refuseMixedTerms(metadata: SourceMetadata, fetched: ListedStation[]): void {
  const other = fetched.find((s) => s.commercial_use !== metadata.license.commercial_use);
  if (other)
    throw new Refused(
      `${other.id} has commercial_use ${other.commercial_use}, unlike its source; split the source in two`,
    );
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
    const fields = [...new Set([...Object.keys(a!), ...Object.keys(b!)])]
      .filter((key) => !isDeepStrictEqual(a![key], b![key]))
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
      `  ${e.id}: epoch ${e.event}, ${e.from} to ${e.to}${e.reason ? ` (${e.reason})` : ""}`,
    );
  return lines;
}
