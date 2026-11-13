/**
 * Station lists in the store: refreshing a source's list, and publishing
 * stations.parquet from every list. docs/stations.md has the design.
 */
import { isDeepStrictEqual } from "node:util";
import { currentEpoch } from "./epochs.ts";
import { correctPositions } from "./positions.ts";
import { decideKinds } from "./kinds.ts";
import {
  exists,
  anyFile,
  highestEpochs,
  recentEpochs,
  readStationBounds,
  readStationList,
  writeJson,
  writeJsonArray,
  writeStationList,
  writeOffsets,
  writeStations,
} from "./store/parquet.ts";
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
  offsetsPath,
  sourcesPath,
  errataPath,
  PRODUCTS,
} from "./store/paths.ts";
import type { StoredStation, ListedStation, Source, SourceMetadata, Station } from "./schema.ts";
import { errataOf, published, type Erratum } from "./errata.ts";
import { linkGauges, type LinkReport } from "./same-as.ts";
import { linkShifts, readLinks } from "./links.ts";
import { JSON_FILES, dataPackage } from "./store/files.ts";
import {
  offsetRows,
  ticonOriginators,
  tideStations,
  withDatums,
  type DatumReport,
} from "./datums.ts";
import { DROPPED } from "./sources/gesla/dropped.ts";
import { usableShares, writeYears } from "./store/years.ts";
import { readAnalysis, withAnalysis } from "./store/analysis.ts";
import { mergeStationList, type EpochChange } from "./stations.ts";
import {
  dropWithheldRows,
  tooManyWithheld,
  withFiles,
  withheldReason,
  withheldStations,
} from "./withhold.ts";

/** What a refresh changed, written beside its snapshot. */
export interface RefreshReport {
  source: string;
  time: string;
  added: string[];
  retired: string[];
  /** Retired by the source itself, listed inactive, rather than dropped from its list. */
  withdrawn: string[];
  /** Withheld (`Source.withheld`): dropped from the list, with their rows in the bounds and recent window. */
  removed: string[];
  /** Removed stations whose series files are still in the store, for `ingest withhold` to delete. */
  unwithheld: string[];
  changed: { id: string; fields: string[] }[];
  epochs: EpochChange[];
  /** `POSITIONS` entries whose station the source has moved, kept where the source puts it. */
  positions: string[];
  /** `KINDS` entries whose station the source now gives a kind of its own, which it keeps. */
  kinds: string[];
}

export interface RefreshOptions {
  now: string;
  /** Accept more epochs opening at once than the guard allows, after a person checked them. */
  acceptEpochs?: boolean;
  /** Accept withholding more stations than `withholdLimit` allows, after a person checked the rule. */
  acceptWithheld?: boolean;
}

/** Why a refresh kept the previous list, as an error the caller reports. */
export class Refused extends Error {}

/** A failure after the refresh wrote the new list, so the store has it, with the refresh's report. */
export class AfterWrite extends Error {
  readonly report: RefreshReport;
  constructor(message: string, report: RefreshReport) {
    super(message);
    this.report = report;
  }
}

/**
 * Refresh one source's list in `store`: fetch, merge, check, snapshot the
 * previous list and write the new one. Throws `Refused`, writing nothing, when
 * a guard fails.
 */
export async function refreshSource(
  store: string,
  source: Source,
  options: RefreshOptions,
): Promise<{ stations: StoredStation[]; report: RefreshReport }> {
  const id = source.metadata.id;
  const listPath = stationListPath(store, id);
  const stored = await readStationList(listPath);
  // A list that went missing would read as an empty store, and rebuild every station.
  if (!stored && (await hasHistory(store, id))) throw new Refused(lostList(store, id));
  // Nor is a store with the source's series a new source: a list started from
  // the fetch would forget what the old one carried forward, such as USACE's
  // series picks, and write another series into the same files.
  if (!stored && (await hasSeries(store, id)))
    throw new Refused(
      `the store has ${id} series but no list or history for it; copy stations/${id}.parquet in from a snapshot or another store, such as the public one at https://stillwell.openwaters.io, rather than start one from the fetch`,
    );
  const held = (s: Pick<Station, "id">) => withheldReason(source, s.id) !== null;
  // A withheld station leaves the list, rather than stay inactive like one the source stopped listing.
  const removed = (stored ?? []).filter(held);
  const previous = (stored ?? []).filter((s) => !held(s));
  const tooMany = tooManyWithheld(id, removed.length, stored?.length ?? 0);
  if (tooMany && !options.acceptWithheld) throw new Refused(tooMany);

  const positioned = correctPositions(await source.stations(previous));
  const kinds = decideKinds(id, positioned.stations, previous);
  const listing = { stations: kinds.stations, stale: positioned.stale };
  const stale = listing.stale;
  const fetched = listing.stations.filter((s) => !held(s));
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
    splits: source.overrides?.splits ?? {},
    restarts: source.overrides?.restarts ?? {},
    seriesChanged: source.seriesChanged?.bind(source),
  };
  const { stations, changes } = mergeStationList(previous, fetched, options_);
  // A fetch whose stations all lack a datum merges to nothing for a new source.
  if (!stations.length) throw new Refused("listed no stations with a datum");
  await renumberAboveFiles(store, stations, previous);
  const opened = changes.filter((c) => c.event === "opened" || c.event === "held");
  // A station already held isn't a new change.
  const limit = Math.max(5, Math.floor(previous.length * 0.02));
  if (opened.length > limit && !options.acceptEpochs)
    throw new Refused(
      `${opened.length} stations changed datum at once (limit ${limit}): ${opened.map((c) => c.id).join(", ")}; check them and rerun with --accept-epochs`,
    );

  // A GESLA record dropped for holding another gauge's values was a decision in `DROPPED`, not the source's.
  const listedInactive = new Set(
    fetched
      .filter((s) => s.status === "inactive" && !(s.source === "gesla" && DROPPED.has(s.source_id)))
      .map((s) => s.id),
  );
  const report = {
    ...reportOf(id, options.now, previous, stations, changes, listedInactive),
    removed: removed.map((s) => s.id),
    // Every withheld station the store has known, not only those this refresh
    // removes, so the report keeps asking for `withhold` until it runs. Read
    // before the snapshot, so the report it stores has them.
    unwithheld: source.withheld
      ? await withFiles(store, id, (await withheldStations(store, source, { files: false })).ids)
      : [],
    positions: stale,
    kinds: kinds.stale,
  };
  // The list it read goes to history before it's replaced, without withheld
  // stations. A new source's snapshot, its empty list, goes after its first
  // list instead, so a run cut short between the two can't leave history with
  // no list to refuse on.
  const snapshot = async () => {
    await writeStationList(historyPath(store, id, options.now, "parquet"), previous);
    await writeJsonArray(historyPath(store, id, options.now, "json"), [report]);
  };
  if (stored) await snapshot();
  // A new source has no files yet, so its years start empty and every run keeps
  // them. Before its list, so a failure here leaves it new for the next refresh.
  if (!stored) await writeYears(store, id, []);
  await writeStationList(listPath, stations);
  if (!stored) await snapshot();
  try {
    await dropWithheldRows(store, source);
  } catch (error) {
    throw new AfterWrite(
      `wrote the new list, but couldn't drop withheld stations' rows (${error instanceof Error ? error.message : String(error)}); run \`ingest withhold ${id}\``,
      report,
    );
  }
  return { stations, report };
}

/**
 * A new epoch takes an `id` above any epoch directory already in the store, or
 * any epoch the recent window still has rows for, so one restored from a
 * snapshot never reuses another's files or rows.
 */
async function renumberAboveFiles(
  store: string,
  stations: StoredStation[],
  previous: StoredStation[],
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
      ? PRODUCTS.map((p) => sourceEpochDirs(store, p, changed[0]!.source))
      : changed.flatMap((s) => PRODUCTS.map((p) => epochDirs(store, p, s.source, s.source_id)));
  const onDiskOf = await highestEpochs(patterns);
  const inRecent = await recentEpochs(recentPath(store, changed[0]!.source));
  for (const station of changed) {
    const known = before.get(station.id) ?? new Set<number>();
    const fresh = station.epochs.filter((e) => !known.has(e.id));
    const onDisk = Math.max(
      inRecent.get(station.id) ?? 1,
      ...PRODUCTS.map(
        (p) => onDiskOf.get(stationDir(store, p, station.source, station.source_id)) ?? 1,
      ),
    );
    // A station new to the list with no later epochs on disk starts at 1.
    if (!known.size && onDisk === 1) continue;
    let next = Math.max(onDisk + 1, ...[...known].map((n) => n + 1));
    for (const epoch of fresh) epoch.id = Math.max(epoch.id, next++);
  }
}

/**
 * Rebuild `stations.parquet`, `stations/offsets.parquet`, `sources.json` and `errata.json` in `store`, with
 * `datapackage.json` and the JSON Schemas that define them (`src/store/files.ts`), from the lists of
 * `all`, the sources it holds, their bounds, and their years files' flag counts for `rank`. A source in `expected` that
 * has no list, because it went missing, stops the rebuild, which would
 * otherwise drop its stations from what the store publishes; it returns the
 * missing ones. A source in neither is new, and
 * joins once it has a list. Stations sharing a gauge are linked and given a
 * preferred series as the file is built (`src/same-as.ts`), and the result
 * says what was linked. Each station carries the IDs of its `errata`, and
 * `errata.json` those of the sources the store holds (each source's
 * `errata.json`, read by `src/errata.ts`); the result names any station an erratum lists that a source in the store
 * doesn't, a typo or a station since removed.
 */
export async function publishStations(
  store: string,
  all: Source[],
  expected: string[],
  errata: Erratum[],
): Promise<
  | { count: number; links: LinkReport; datums: DatumReport; unknownErrata: string[] }
  | { missing: string[] }
> {
  const built = await linkedStations(store, all, expected);
  if ("missing" in built) return built;
  const { gauges, listed, report, steps } = built;
  const { stations: linked, report: datums } = withDatums(
    gauges,
    await tideStations(),
    await ticonOriginators(),
    linkShifts(await readLinks(store), gauges),
  );
  for (const station of linked) station.errata = errataOf(station, errata);
  // Two files written one after the other: if the second write fails, they're from
  // different publishes until the next one.
  await writeOffsets(offsetsPath(store), linked.flatMap(offsetRows));
  // The measured step stands in for an interval the source doesn't give in the published file
  // only, after ranking and pairing, which read the source's own, as ingest does.
  await writeStations(
    stationsPath(store),
    linked.map((s) =>
      s.interval_s === null && steps.has(s.id) ? { ...s, interval_s: steps.get(s.id)! } : s,
    ),
  );
  await writeJsonArray(
    sourcesPath(store),
    listed.map((s) =>
      sourceEntry(
        s.metadata,
        linked.filter((st) => st.source === s.metadata.id),
      ),
    ),
  );
  // A store's errata are its own sources', so a restricted source's stay out of the public store.
  const held = new Set(listed.map((s) => s.metadata.id));
  await writeJsonArray(errataPath(store), published(errata.filter((e) => held.has(e.source))));
  // The definition of every file above, for readers (src/store/files.ts).
  await writeJson(`${store}/datapackage.json`, dataPackage());
  for (const [path, schema] of Object.entries(JSON_FILES))
    await writeJson(`${store}/${path.replace(/\.json$/, ".schema.json")}`, schema);
  const ids = new Set(linked.map((s) => s.id));
  // A withheld station is gone on purpose, though an erratum may still name it.
  const withheld = (id: string) => listed.some((s) => withheldReason(s, id) !== null);
  const unknownErrata = errata.flatMap((e) =>
    held.has(e.source)
      ? (e.stations ?? [])
          .filter((id) => !ids.has(id) && !withheld(id))
          .map((id) => `${e.id} ${id}`)
      : [],
  );
  return { count: linked.length, links: report, datums, unknownErrata };
}

/**
 * The stations in `store`'s lists, with their bounds and analysis, linked
 * (`linkGauges`), as `stations.parquet` is built from them, with the step
 * analysis measured for each station whose source gives no interval; or the
 * sources in `expected` that have no list.
 */
async function linkedStations(
  store: string,
  all: Source[],
  expected: string[],
): Promise<
  | {
      gauges: StoredStation[];
      listed: Source[];
      report: LinkReport;
      /** Each station's measured step where its source gives no interval. */
      steps: Map<string, number>;
    }
  | { missing: string[] }
> {
  const stations: StoredStation[] = [];
  const listed: Source[] = [];
  const missing: string[] = [];
  const usable = new Map<string, number>();
  const steps = new Map<string, number>();
  for (const source of all) {
    const list = await readStationList(stationListPath(store, source.metadata.id));
    if (!list) {
      if (expected.includes(source.metadata.id)) missing.push(source.metadata.id);
      continue;
    }
    listed.push(source);
    const bounds = await readStationBounds(boundsPath(store, source.metadata.id));
    const analysis = await readAnalysis(store, source.metadata.id);
    stations.push(
      ...withoutWithheld(source, list).map((s) => ({
        ...s,
        ...bounds.get(s.id),
        tidal: analysis.get(s.id)?.tidal ?? null,
        tide_m: analysis.get(s.id)?.tide_m ?? null,
      })),
    );
    for (const s of list) {
      const step = analysis.get(s.id)?.step_s;
      if (s.interval_s === null && step != null) steps.set(s.id, step);
    }
    // Only a tie-breaker in `rank`, so a years file that can't be read doesn't stop publishing.
    const shares = await usableShares(store, source.metadata.id).catch((error: unknown) => {
      console.warn(`${source.metadata.id}: ranking without the years file: ${String(error)}`);
      return new Map<string, number>();
    });
    for (const [id, share] of shares) usable.set(id, share);
  }
  if (missing.length || !listed.length) return { missing };
  const { stations: gauges, report } = linkGauges(stations, new Date(), usable);
  return { gauges, listed, report, steps };
}

/**
 * The stations `links` measures pairs from: as publish builds them, with the
 * offsets carried through shared references but none through measured
 * shifts, so a pair is chosen by the offsets its stations have without it.
 */
export async function stationsToMeasure(store: string, all: Source[]): Promise<StoredStation[]> {
  const built = await linkedStations(store, all, []);
  if ("missing" in built) return [];
  return withDatums(built.gauges, await tideStations(), await ticonOriginators()).stations;
}

/**
 * Metadata that is ingest's business, not part of a source's terms, so
 * `sources.json` leaves it out: offsets, the archive's reference,
 * and which scheduled jobs run for the source. `finalizes` stays in, since it
 * tells a reader whether the source's `preliminary` values will ever change.
 */
const INGEST_ONLY = new Set(["utc_offsets", "archive", "hourly", "empty_means_none"]);

/**
 * A source's entry in `sources.json`: its metadata less what only ingest uses,
 * and the number of its `stations` that are active. `license.commercial_use` is
 * true only where every station allows it, inactive ones too, since their series stay.
 */
export function sourceEntry(
  metadata: SourceMetadata,
  stations: Pick<Station, "status" | "commercial_use">[],
): object {
  return {
    ...Object.fromEntries(Object.entries(metadata).filter(([key]) => !INGEST_ONLY.has(key))),
    license: {
      ...metadata.license,
      commercial_use: metadata.license.commercial_use && stations.every((st) => st.commercial_use),
    },
    stations: stations.filter((st) => st.status === "active").length,
  };
}

/** A source's list from the store, with each station's analysis (`withAnalysis`), or an error naming what to run. */
export async function listOf(store: string, source: Source): Promise<StoredStation[]> {
  const sourceId = source.metadata.id;
  const list = await readStationList(stationListPath(store, sourceId));
  if (!list && (await hasHistory(store, sourceId))) throw new Error(lostList(store, sourceId));
  if (!list)
    throw new Error(
      `No station list for ${sourceId} in ${store}; run \`stations ${sourceId}\` to start it`,
    );
  return withAnalysis(store, sourceId, withoutWithheld(source, list));
}

/** A list without withheld stations, which one not refreshed since they were withheld still has. */
export function withoutWithheld(source: Source, list: StoredStation[]): StoredStation[] {
  return list.filter((s) => withheldReason(source, s.id) === null);
}

/**
 * A source's list from the store, with each station's analysis, or null for a source whose list was never
 * started, such as one registered since the last Monthly refresh. A list that
 * existed and is gone, or series with no list, are still errors.
 */
export async function startedListOf(
  store: string,
  source: Source,
): Promise<StoredStation[] | null> {
  const sourceId = source.metadata.id;
  const list = await readStationList(stationListPath(store, sourceId));
  if (list) return withAnalysis(store, sourceId, withoutWithheld(source, list));
  if (await hasHistory(store, sourceId)) throw new Error(lostList(store, sourceId));
  // The refresh refuses such a store too, so waiting for it would wait for good.
  if (await hasSeries(store, sourceId))
    throw new Error(`the store has ${sourceId} series but no list or history for it`);
  return null;
}

/** Whether `store` holds any of a source's values: series files in any epoch, or a recent window. */
async function hasSeries(store: string, sourceId: string): Promise<boolean> {
  if (await exists(recentPath(store, sourceId))) return true;
  return anyFile(
    PRODUCTS.flatMap((p) => [
      sourceFirstEpochFiles(store, p, sourceId),
      sourceEpochDirs(store, p, sourceId),
    ]),
  );
}

/** Whether a source's list has ever been written to `store`. */
export async function hasHistory(store: string, sourceId: string): Promise<boolean> {
  return exists(historyPath(store, sourceId, "*", "parquet"));
}

function lostList(store: string, sourceId: string): string {
  return `the store has history for ${sourceId} but no list at ${stationListPath(store, sourceId)}; copy its latest snapshot in history/ back rather than start over`;
}

/** The epoch new values for a station go to. */
export function epochOf(station: StoredStation): number {
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

const COMPARED = (s: StoredStation) => {
  const { epochs: _, first: __, last: ___, ...fields } = s;
  return fields;
};

function reportOf(
  source: string,
  time: string,
  previous: StoredStation[],
  stations: StoredStation[],
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
    removed: [],
    unwithheld: [],
    changed: [],
    epochs,
    positions: [],
    kinds: [],
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

/**
 * Whether a refresh's report needs a person, so the run fails: an epoch held
 * or waiting, a station the source retired itself, a moved `POSITIONS` entry,
 * a `KINDS` entry the source now gives a kind of its own, or a removed
 * station whose series files `ingest withhold` hasn't deleted.
 */
export function needsPerson(report: RefreshReport): boolean {
  return (
    report.epochs.some((e) => e.event === "held" || e.event === "waiting") ||
    report.withdrawn.length > 0 ||
    report.positions.length > 0 ||
    report.kinds.length > 0 ||
    report.unwithheld.length > 0
  );
}

/** A report as lines for a log or a job summary. */
export function describeReport(report: RefreshReport): string[] {
  const lines = [
    `${report.source}: ${report.added.length} added, ${report.retired.length} retired, ${report.changed.length} changed${report.removed.length ? `, ${report.removed.length} removed` : ""}`,
  ];
  for (const id of report.added.slice(0, 20)) lines.push(`  added ${id}`);
  for (const id of report.removed) lines.push(`  removed ${id}, withheld from the store`);
  if (report.unwithheld.length)
    lines.push(
      `  ${report.unwithheld.length} removed stations still have series files: run \`ingest withhold ${report.source}\` to delete them`,
    );
  for (const id of report.retired)
    lines.push(
      `  retired ${id}${report.withdrawn.includes(id) ? ", by the source; see its log above" : ""}`,
    );
  for (const c of report.changed.slice(0, 50)) lines.push(`  ${c.id}: ${c.fields.join(", ")}`);
  for (const e of report.epochs)
    lines.push(
      `  ${e.id}: epoch ${e.event}, ${e.from} to ${e.to}${e.reason ? ` (${e.reason})` : ""}; overrides key "${e.key}"`,
    );
  for (const p of report.positions)
    lines.push(`  ${p}; check its entry in POSITIONS (src/positions.ts)`);
  for (const k of report.kinds) lines.push(`  ${k}; remove its entry from KINDS (src/kinds.ts)`);
  return lines;
}
