/**
 * Fetch from upstream sources into the store.
 *
 *   node scripts/ingest.ts stations [source...] [--accept-epochs] [--accept-withheld] [--no-publish]
 *   node scripts/ingest.ts publish
 *   node scripts/ingest.ts links [--concurrency 4] [--prune]
 *   node scripts/ingest.ts matches [--concurrency 4] [--accept-matches] [--prune]
 *   node scripts/ingest.ts backfill <source> <station,...|all|preliminary> <start> <end>
 *       [--first <file>] [--shard <i>/<n>] [--refetch | --skip-written] [--skip-unscreened]
 *       [--with-inactive]
 *   node scripts/ingest.ts compact <source> [--days 1] [--rebuild-bounds]
 *   node scripts/ingest.ts requalify <source> <station,...|all> <start> <end> [--shard <i>/<n>]
 *       [--budget <minutes>]
 *   node scripts/ingest.ts withhold <source> [--accept-withheld]
 *   node scripts/ingest.ts drop <source> [--dry-run]
 *   node scripts/ingest.ts misplaced <source> [--dry-run]
 *   node scripts/ingest.ts delete-years <source> <station> <epoch> <year,...>
 *   node scripts/ingest.ts years <source> [--rebuild-years]
 *   node scripts/ingest.ts analyze <source> [--all] [--requalify [--budget 120]]
 *   node scripts/ingest.ts fit <source> [<station,...>] [--all] [--shard 1/4]
 *
 * `stations` refreshes each source's list in the store, stations/<source>.parquet,
 * after snapshotting the previous one to history/, then writes stations.parquet,
 * sources.json, errata.json and their definitions (datapackage.json), unless `--no-publish`; `publish` writes only those. It
 * changes no file in the repo. A new source's first refresh starts its list.
 * `backfill` writes every product a station has over [start, end) (dates as YYYY or YYYY-MM-DD, end
 * exclusive) into its yearly files, replacing that range and keeping the rest,
 * so a rerun gives the same files. A calendar month the fetch returned nothing
 * for keeps what it had, so an outage never deletes stored values; a value the
 * source withdraws stays until its month is fetched again with others. A
 * source that never withdraws one (`keepsStored`, the EA) keeps every stored
 * level, so a day its archive lacks keeps what the store has.
 * Backfill skips a year whose file is already complete (see `yearDone` in
 * src/backfill.ts), so a run cut short doesn't fetch those again; `--refetch`
 * fetches every year anyway, and `--skip-written` skips every ended year that
 * has a file, complete or not (from 2026 on, see `COMPACTED_SINCE`), so a long campaign of runs doesn't fetch
 * provisional years again each time. `--first` names a file of station IDs to
 * run before the rest, and `--shard 2/8` takes the second of eight sets of
 * stations, split by a hash of their IDs, so separate jobs can split them.
 * `preliminary` in place of the stations takes every station, active or not,
 * whose bounds hold a preliminary value, from that value's month (or `start`,
 * the cutoff, when it's earlier) to `end`, and lists the ones past the
 * cutoff. After fetching a station's levels, backfill reads its earliest
 * preliminary value again into stations/bounds/<source>.parquet.
 * Skipping looks only at the files of the epoch a year is written to, so a
 * new epoch starts its years over. `compact` folds the last `--days` whole UTC
 * days of the poller's daily files, recent/<source>/<YYYY-MM-DD>.parquet, into each station's year
 * files, each row into its datum epoch's, then writes each station's first and
 * last level to stations/bounds/<source>.parquet (`updateBounds` in
 * src/store/recent.ts); `--rebuild-bounds` reads every station's again rather
 * than keep the ones it knows. It prints a summary, and adds it to
 * the workflow run's page. `requalify` works the flags of stations' observed
 * levels out again over the years [start, end) from the store alone (src/store/requalify.ts),
 * so a QC rule change reaches stored values without fetching them again;
 * with `--budget` it starts stations only for that many minutes.
 * `withhold` deletes the files of a source's withheld stations, whose owner
 * refused republication, and their rows in its bounds, years and daily files
 * (src/withhold.ts); the source's next refresh drops them from its list.
 * `misplaced` drops the rows in a datum epoch's files from outside its span that
 * the epoch holding their time already has, as an epoch opened with a start in
 * the past leaves them, and lists any others (src/store/misplaced.ts).
 * `delete-years` deletes a station's year files of levels that hold only values
 * flagged bad and outside the span, which a year file can't be emptied of, and their rows in the
 * years file (src/delete-years.ts); the bounds and `missing_years` follow
 * `compact --rebuild-bounds` and `publish`.
 * `years` reads the source's year files of levels into stations/years/<source>.parquet,
 * which backfill, compaction and requalify then keep (src/store/years.ts).
 * `analyze` judges the source's stations that are due from their levels in the
 * store, such as whether they carry a tide, into stations/analysis/<source>.parquet
 * (src/store/analysis.ts), `--all` every station, and lists the stations whose
 * QC that changes; `--requalify` requalifies them, and every station after its
 * first verdict, over every year, starting stations for `--budget` minutes.
 * `fit` fits harmonic constants to the source's stations whose fit is due, from their
 * final values in the store, into fits/<source>.parquet and constituents/<source>.parquet
 * (src/fit/store.ts); `--all` fits every station again, and station IDs or `--shard` limit the run.
 *
 * A station the source now reports against another reference opens a datum
 * epoch, whose values go to files of their own (docs/stations.md). `backfill`
 * writes the current epoch, never before its start, and skips a
 * station whose new epoch is held for a decision. For a source with `archive:
 * "previous"`, backfill writes each closed epoch's span to its files too. `backfill all` skips inactive
 * stations unless given `--with-inactive`; naming one still works, adapters refuse values in any datum but
 * the station's, and backfill refuses a file whose `datum` column names another.
 *
 * The store is STILLWELL_STORE: a directory (default `data`) or an `s3://` URL.
 * Its bucket is public, so a source whose terms bar republishing its data keeps
 * its list and series in STILLWELL_RESTRICTED_STORE instead, which must be a
 * separate store, and ingest refuses to write one without it. Commercial use is
 * a tag on each station for readers to filter on; it doesn't move a station.
 */
import "./threadpool.ts";
import { isDeepStrictEqual, parseArgs } from "node:util";
import {
  backfillYear,
  earliestPreliminary,
  epochSpans,
  orderStations,
  parseShard,
  parseStationList,
  preliminaryRuns,
  readerOf,
  seriesFiles,
  shard,
  wholeEndedYear,
  COMPACTED_SINCE,
  years,
  yearsToFetch,
  type YearReport,
} from "../src/backfill.ts";
import { Dropped } from "../src/span.ts";
import { emptyKey, keepsEmptyYears, readEmptyYears, writeEmptyYears } from "../src/empty-years.ts";
import {
  mergeBackfilled,
  readBackfilled,
  recordWalk,
  writeBackfilled,
  type Backfilled,
} from "../src/backfilled.ts";
import { useDiskCache } from "../src/cache.ts";
import { Blocked } from "../src/http.ts";
import {
  chunks,
  compactRecent,
  formatSummary,
  lastDays,
  pool,
  poolUntil,
  qcFor,
  REFETCH_YEARS,
  writePreliminary,
  type RunSummary,
} from "../src/store/recent.ts";
import { appendFile, readFile } from "node:fs/promises";
import { isHeld, splitStarts } from "../src/epochs.ts";
import {
  listYears,
  readStationBounds,
  setConnections,
  publishedSources,
  readJsonArray,
  readStationList,
  writeJsonArray,
  type YearStats,
} from "../src/store/parquet.ts";
import { commitYears, markYears, readYears, reconcileYears } from "../src/store/years.ts";
import { fitSource } from "../src/fit/store.ts";
import { requalifyInWorker, WorkerDied } from "../src/store/requalify.ts";
import {
  analyze,
  markRequalified,
  pending,
  readAnalysis,
  requalifiedMarks,
} from "../src/store/analysis.ts";
import {
  boundsPath,
  linksPath,
  matchesPath,
  requalifyLeftPath,
  seriesDir,
  stationListPath,
  stationsPath,
  yearsPath,
  RECENT_DAYS,
} from "../src/store/paths.ts";
import {
  describeReport,
  hasHistory,
  epochOf,
  listOf,
  startedListOf,
  publishStations,
  stationsToMeasure,
  refreshSource,
  AfterWrite,
  needsPerson,
} from "../src/refresh.ts";
import type {
  StoredStation,
  Observation,
  PublishedExtreme,
  Source,
  SourceMetadata,
  Station,
} from "../src/schema.ts";
import { errata, errataProblems, questions, sourceOf, sources } from "../src/sources/index.ts";
import { DROPS, dropFiles, removePrefixes, withhold, withheldReason } from "../src/withhold.ts";
import { deleteYears } from "../src/delete-years.ts";
import { misplaced } from "../src/store/misplaced.ts";
import { storeFor, storeOfSource } from "../src/store/stores.ts";
import { measureLinks, readLinks, writeLinks } from "../src/links.ts";
import {
  compareStations,
  differsByData,
  readMatches,
  sameByData,
  shiftedByData,
  tooManyStopped,
  withoutGone,
  writeMatches,
  type DataMatch,
} from "../src/matches.ts";
import { ID_KM } from "../src/same-as.ts";
import { INGEST_OPTIONS } from "../src/ingest-options.ts";

useDiskCache();

/** Whether a station isn't withheld, so its rows in the monthly files stay (`withoutGone`). */
const shown = (id: string) => {
  const source = sources[id.split("/")[0]!];
  return !source || withheldReason(source, id) === null;
};

/**
 * With `--prune`, `links` and `matches` only take out the rows `withoutGone`
 * does, measuring nothing, so the Ingest workflow can drop a withheld or
 * dropped station's rows in minutes after a `withhold` or `drop`. A file with
 * no such row isn't written.
 */
async function prune<T>(
  path: string,
  stored: number,
  kept: T[],
  write: (rows: T[]) => Promise<void>,
): Promise<void> {
  if (kept.length < stored) await write(kept);
  console.log(
    `${path}: ${stored - kept.length} rows naming a withheld or dropped station taken out, ${kept.length} kept`,
  );
}

/**
 * The stations `--prune` tells gone rows by, from each source's list as
 * stored: `withoutGone` reads only their IDs, so it needs no levels, bounds or
 * matches. A dropped record is known only through its source's list, so a
 * source `drop` covers with no list fails the run, leaving `file` unchanged.
 */
async function listedStations(
  store: string,
  held: Source[],
  file: string,
): Promise<StoredStation[] | null> {
  const stations: StoredStation[] = [];
  for (const source of held) {
    const list = await readStationList(stationListPath(store, source.metadata.id));
    if (list) stations.push(...list);
    else if (source.metadata.id in DROPS) {
      console.error(`${store}: no list for ${source.metadata.id}; ${file} unchanged`);
      process.exitCode = 1;
      return null;
    }
  }
  return stations;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: INGEST_OPTIONS,
});
const [command, ...args] = positionals;

switch (command) {
  case "stations":
    await refreshStations(args.length ? args : Object.keys(sources));
    break;
  case "publish":
    for (const store of new Set(Object.values(sources).flatMap(storesOf))) await publish(store);
    break;
  case "links":
    // From the source lists, as publish builds stations.parquet, for the next publish to carry offsets along (src/links.ts).
    setConnections(positive("concurrency"));
    for (const store of new Set(Object.values(sources).flatMap(storesOf))) {
      const held = Object.values(sources).filter((s) => storesOf(s).includes(store));
      if (values.prune) {
        const listed = await listedStations(store, held, "links");
        if (!listed) continue;
        const stored = await readLinks(store);
        const kept = withoutGone(stored, listed, shown);
        await prune(linksPath(store), stored.length, kept, (rows) => writeLinks(store, rows));
        continue;
      }
      const stations = await stationsToMeasure(store, held);
      const previous = withoutGone(await readLinks(store), stations, shown);
      const { rows, failed } = await measureLinks(
        store,
        stations,
        positive("concurrency"),
        previous,
      );
      await writeLinks(store, rows);
      // Written first, so the pairs that were read are kept; a failed read keeps its pair's last row.
      if (failed) process.exitCode = 1;
    }
    break;
  case "matches":
    // Nearby series compared by their levels, for the next publish to link those that agree (src/matches.ts).
    setConnections(positive("concurrency"));
    for (const store of new Set(Object.values(sources).flatMap(storesOf))) {
      const held = Object.values(sources).filter((s) => storesOf(s).includes(store));
      if (values.prune) {
        const listed = await listedStations(store, held, "matches");
        if (!listed) continue;
        const stored = await readMatches(store);
        const kept = withoutGone(stored, listed, shown);
        await prune(matchesPath(store), stored.length, kept, (rows) => writeMatches(store, rows));
        continue;
      }
      const stations = await stationsToMeasure(store, held);
      // A missing list or years file leaves no stations; last month's file stays.
      if (!stations.length) {
        console.error(`${store}: no stations to compare; matches unchanged`);
        process.exitCode = 1;
        continue;
      }
      // Before the stopped-agreeing guard, so a withheld or dropped station's rows don't count as stopped.
      const previous = withoutGone(await readMatches(store), stations, shown);
      const { rows, failed, pairs } = await compareStations(
        store,
        stations,
        positive("concurrency"),
        previous,
      );
      // A link by levels lasts while they agree; these won't be linked by them at the next publish.
      const agreeing = new Set(rows.filter(sameByData).map((m) => `${m.a} ${m.b}`));
      const stopped = previous.filter((m) => sameByData(m) && !agreeing.has(`${m.a} ${m.b}`));
      const agreed = previous.filter(sameByData).length;
      if (tooManyStopped(stopped.length, agreed) && !values["accept-matches"]) {
        console.error(
          `${store}: ${stopped.length} of ${agreed} pairs stopped agreeing at once; matches unchanged. Check them and rerun with --accept-matches:`,
        );
        for (const m of stopped) console.error(`  ${m.a} ${m.b}`);
        process.exitCode = 1;
        continue;
      }
      await writeMatches(store, rows);
      const linked = new Set(stations.flatMap((s) => s.same_as.map((o) => `${s.id} ${o}`)));
      const line = (m: DataMatch) =>
        `${m.a} ${m.b}: ${m.months} months, ${(m.rms_m * 100).toFixed(1)} cm` +
        (m.lag_h
          ? `, ${(m.lag_rms_m * 100).toFixed(1)} cm with b ${m.lag_h > 0 ? "+" : ""}${m.lag_h} h`
          : "");
      const fresh = rows.filter((m) => sameByData(m) && !linked.has(`${m.a} ${m.b}`));
      const differ = rows.filter((m) => differsByData(m) && linked.has(`${m.a} ${m.b}`));
      const shifted = rows.filter(shiftedByData);
      console.log(
        `${matchesPath(store)}: ${rows.length} of ${pairs} pairs compared, ${rows.filter(sameByData).length} agree; ${failed} failed`,
      );
      for (const m of fresh) console.log(`  agree, not yet linked: ${line(m)}`);
      for (const m of differ) console.log(`  linked, but differ: ${line(m)}`);
      for (const m of shifted) console.log(`  agree only with a clock offset: ${line(m)}`);
      for (const m of stopped) console.log(`  agreed last month, not now: ${line(m)}`);
      // Written first, so the pairs that were read are kept; a failed read keeps its pair's last row.
      if (failed) process.exitCode = 1;
    }
    break;
  case "backfill": {
    const [source, ids, start, end] = args;
    if (!source || !ids || !start || !end) usage();
    await backfill(source, ids, parseDate(start), parseDate(end));
    break;
  }
  case "requalify": {
    const [source, ids, start, end] = args;
    if (!source || !ids || !start || !end) usage();
    if (values.budget === undefined) {
      await requalifyStations(source, ids, parseYear(start), parseYear(end));
      break;
    }
    // A budgeted run saves the stations it didn't finish, each with its years,
    // and the next starts with them, each over its own years and that run's, so
    // a source too big for the budget doesn't leave the same stations out each
    // time. 0 saves them all, starting none.
    if (ids !== "all" || values.shard) throw new Error("--budget resumes `all`, unsharded");
    if (!/^\d+$/.test(values.budget))
      throw new Error("--budget must be a whole number of minutes, 0 or more");
    const minutes = Number(values.budget);
    const range = { start: parseYear(start), end: parseYear(end) };
    const path = requalifyLeftPath(storeOfSource(sourceOf(source).metadata), source);
    const prior = ((await readJsonArray(path)) ?? []) as {
      id: string;
      start: number;
      end: number;
    }[];
    const first = new Map(
      prior.map((p) => [
        p.id,
        { start: Math.min(p.start, range.start), end: Math.max(p.end, range.end) },
      ]),
    );
    const { left, failed } = await requalifyStations(
      source,
      ids,
      range.start,
      range.end,
      minutes ? Date.now() + minutes * 60_000 : 0,
      undefined,
      first,
    );
    // A station that failed is tried again too, over this run's years only, so
    // one that always fails, such as on a file holding two datums, stops once
    // its year leaves the range rather than widening it each month. One whose
    // batch couldn't be marked wasn't tried, so it keeps its saved years.
    const failedIds = new Map(failed.map((f) => [f.split(": ")[0]!, f]));
    await writeJsonArray(path, [
      ...left.map((id) => ({ id, ...(first.get(id) ?? range) })),
      ...[...failedIds]
        .filter(([id]) => id.startsWith(`${source}/`) && !left.includes(id))
        .map(([id, f]) => ({
          id,
          ...((f.startsWith(`${id}: years file not marked:`) && first.get(id)) || range),
        })),
    ]);
    break;
  }
  case "compact": {
    const [source] = args;
    if (!source) usage();
    await compact(source, Number(values.days));
    break;
  }
  case "withhold": {
    const [source] = args;
    if (!source) usage();
    await withholdStations(source);
    break;
  }
  case "drop": {
    const [source] = args;
    if (!source) usage();
    await dropStations(source);
    break;
  }
  case "misplaced": {
    const [source] = args;
    if (!source) usage();
    await misplacedRows(source);
    break;
  }
  case "delete-years": {
    const [source, station, epoch, years] = args;
    if (!source || !station || !epoch || !years || args.length > 4 || values["dry-run"]) usage();
    const { files, gone, rows } = await deleteYears(
      storeOfSource(sourceOf(source).metadata),
      source,
      station,
      parseEpoch(epoch),
      years.split(",").map(parseYear),
      removePrefixes,
    );
    const lines = [
      `${source}/${station}: ${files.length} year files deleted, ${rows} values flagged bad`,
      ...files.map((f) => `  ${f}`),
      ...(gone.length
        ? [`${gone.length} named years had no file, deleted by an earlier run or never there`]
        : []),
      `Run \`compact ${source} --rebuild-bounds\` and \`publish\` to rebuild the bounds and the missing years.`,
    ];
    for (const line of lines) console.log(line);
    const summary = process.env.GITHUB_STEP_SUMMARY;
    if (summary) await appendFile(summary, ["```", ...lines, "```", ""].join("\n"));
    break;
  }
  case "years": {
    const [source] = args;
    if (!source) usage();
    setConnections(positive("concurrency"));
    const store = storeOfSource(sourceOf(source).metadata);
    const years = await reconcileYears(store, source, {
      start: true,
      rebuild: values["rebuild-years"],
      keep: (id) => withheldReason(sourceOf(source), id) === null,
      concurrency: positive("concurrency"),
    });
    console.log(`${source}: read ${years!.read} year files into ${yearsPath(store, source)}`);
    for (const file of years!.failed) console.error(`  can't read ${file}`);
    if (years!.failed.length) process.exitCode = 1;
    break;
  }
  case "analyze": {
    const [source] = args;
    if (!source) usage();
    await analyzeSource(source);
    break;
  }
  case "fit": {
    const [source, ids] = args;
    if (!source) usage();
    await fitStations(source, ids);
    break;
  }
  default:
    usage();
}

async function refreshStations(ids: string[]): Promise<void> {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const stores = new Set<string>();
  const summary: string[] = [];
  for (const id of ids) {
    const source = sourceOf(id);
    try {
      const store = storeOfSource(source.metadata);
      stores.add(store);
      const { stations, report } = await refreshSource(store, source, {
        now,
        acceptEpochs: values["accept-epochs"],
        acceptWithheld: values["accept-withheld"],
      });
      const active = stations.filter((s) => s.status === "active").length;
      const lines = describeReport(report);
      lines[0] += `; ${active} active, ${stations.length - active} inactive`;
      for (const line of lines) console.log(line);
      summary.push(...lines);
      // The list is written either way; the run fails so a person sees it.
      if (needsPerson(report)) process.exitCode = 1;
      if (report.unwithheld.length && process.env.GITHUB_ACTIONS)
        console.log(
          `::warning title=Withheld files remain::${report.unwithheld.length} ${id} stations were removed from the list but still have series files; run \`ingest withhold ${id}\``,
        );
    } catch (error) {
      // One source failing doesn't stop the others; it keeps its list unless the new one was written.
      const why = error instanceof Error ? error.message : String(error);
      const lines =
        error instanceof AfterWrite
          ? [`${id}: ${why}`, ...describeReport(error.report)]
          : [`${id}: ${why}; keeping the list in the store`];
      for (const line of lines) console.error(line);
      summary.push(...lines);
      process.exitCode = 1;
    }
  }
  // The lists are written, so their report is kept even if publishing fails.
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, ["```", ...summary, "```", ""].join("\n"));
  if (!values["no-publish"]) for (const store of stores) await publish(store);
}

/** The store a source's list is in, or none for a restricted source with no restricted store configured. */
function storesOf(source: Source): string[] {
  try {
    return [storeOfSource(source.metadata)];
  } catch {
    return [];
  }
}

/**
 * Rebuild `stations.parquet`, `sources.json`, `errata.json` and their definitions for `store`, unless a source
 * that has had a list there, by the published file or its history, has none.
 */
async function publish(store: string): Promise<void> {
  // A restricted source with no restricted store configured isn't in this one.
  const inStore = (metadata: SourceMetadata) => {
    try {
      return storeOfSource(metadata) === store;
    } catch {
      return false;
    }
  };
  const held = Object.values(sources).filter((s) => inStore(s.metadata));
  // A source the published file lists, or that has history, has had a list:
  // publishing without it would drop its stations.
  const published = new Set(await publishedSources(stationsPath(store)));
  const expected: string[] = [];
  for (const { metadata } of held)
    if (published.has(metadata.id) || (await hasHistory(store, metadata.id)))
      expected.push(metadata.id);
  const result = await publishStations(store, held, expected, errata, questions);
  if ("count" in result) {
    console.log(`${stationsPath(store)}: ${result.count} stations`);
    const { pairs, dropped, skipped, wide, shifted } = result.links;
    for (const [pair, counts] of Object.entries(pairs).sort())
      console.log(
        `  same_as ${pair}: ${Object.entries(counts)
          .map(([how, n]) => `${n} by ${how}`)
          .join(", ")}`,
      );
    for (const d of dropped) console.log(`  same_as dropped: ${d.from} to ${d.to}, ${d.reason}`);
    for (const k of skipped)
      console.log(`  same_as skipped: ${k.a} to ${k.b} by ${k.how}, ${k.reason}`);
    for (const group of wide)
      console.log(
        `  same_as group over ${ID_KM} km wide, or with a station without a position: ${group.join(" ")}`,
      );
    for (const m of result.links.disagree)
      console.log(
        `  same_as levels differ: ${m.a} to ${m.b} by ${m.how}, ${(m.rms_m * 100).toFixed(1)} cm over ${m.months} months`,
      );
    for (const m of shifted)
      console.log(
        `  same_as levels agree only with ${m.b} moved ${m.lag_h} h: ${m.a}, ${(m.lag_rms_m * 100).toFixed(1)} cm over ${m.months} months`,
      );
    const { joined, fromTide, computed, far, disagree } = result.datums;
    console.log(
      `  datums: ${joined} joined to slackwater-database, ${fromTide} with its datums, ${computed} computed from a linked series`,
    );
    for (const f of far) console.log(`  datums join dropped: ${f}`);
    for (const d of disagree) console.log(`  datums differ: ${d}`);
    for (const e of result.unknownErrata)
      console.error(`  erratum or question lists a station not in the store: ${e}`);
    for (const p of errataProblems) console.error(`  errata: ${p}; left out`);
    // A typo in an erratum's stations tags nothing, one in a question's names the wrong gauge to its agency, and a bad errata file leaves
    // its errata out, so fail the run to say so, after publishing: holding back
    // every source's list for it would cost more.
    if (result.unknownErrata.length || errataProblems.length) process.exitCode = 1;
  } else {
    console.error(
      `${stationsPath(store)} not written: no list in the store for ${result.missing.join(", ") || "any source"}`,
    );
    process.exitCode = 1;
  }
}

async function backfill(sourceId: string, ids: string, start: Date, end: Date): Promise<void> {
  const source = sourceOf(sourceId);
  const store = storeOfSource(source.metadata);
  // Each worker writes its stations' years; on one connection they'd wait on each other's uploads.
  setConnections(positive("concurrency"));
  const list = await listOf(store, source);
  // A refresh never stores an empty list, so this is a broken file or every station withheld, and a run would
  // pass having read nothing.
  if (!list.length)
    throw new Error(
      `${sourceId}: no station to backfill: the store's list is empty or all withheld`,
    );
  // `preliminary` takes each station from its earliest preliminary value, active or not.
  let ranges: Map<string, [Date, Date]> | undefined;
  // Stations listed past the cutoff with nothing after it to fetch, whose value is cleared.
  let behind: string[] = [];
  let named: StoredStation[];
  const bounds = await readStationBounds(boundsPath(store, sourceId));
  // Bounds an older build wrote have no `preliminary`, and backfill leaves them alone.
  const legacy = [...bounds.values()].some((b) => b.preliminary === undefined);
  if (ids === "preliminary") {
    if (legacy)
      throw new Error(
        `${sourceId}'s bounds predate preliminary values; run \`compact ${sourceId} --rebuild-bounds\` first`,
      );
    const { runs, past, unscreened } = preliminaryRuns(
      // A held station is skipped, so it isn't listed either.
      (values.shard ? shard(list, ...parseShard(values.shard)) : list).filter(
        (s) => !isHeld(s.epochs),
      ),
      bounds,
      start,
      end,
      values["skip-unscreened"],
    );
    if (unscreened.length)
      console.log(
        `${sourceId}: skipped ${unscreened.length} stations with a year of record and no value the source screened`,
      );
    named = runs.map((r) => r.station);
    ranges = new Map(runs.map((r) => [r.station.id, [r.from, r.to]]));
    await reportPast(sourceId, start, past);
    // Their files end before the cutoff, which no read looks behind, so they're listed once.
    behind = past.map((p) => p.id).filter((id) => !ranges!.has(id));
  } else
    named =
      ids === "all"
        ? list.filter((s) => s.status === "active" || values["with-inactive"])
        : // A station named twice, by either form of its ID, is walked once.
          [...new Set(ids.split(",").map((id) => find(list, sourceId, id)))];
  // A station whose new epoch is held for a decision gets nothing, in either datum.
  let wanted = named.filter((s) => {
    if (isHeld(s.epochs)) console.error(`  ${s.id}: held for a datum change; skipped`);
    return !isHeld(s.epochs);
  });
  if (values.shard && ids !== "all" && ids !== "preliminary")
    throw new Error("--shard splits `all` or `preliminary`, not named stations");
  // `preliminary` took its shard before picking stations, so the cutoff list is the shard's too.
  if (values.shard && ids === "all") wanted = shard(wanted, ...parseShard(values.shard));
  if (values["with-inactive"] && ids !== "all") throw new Error("--with-inactive goes with `all`");
  if (values["skip-written"] && values.refetch)
    throw new Error("--skip-written and --refetch contradict each other");
  // Skipping every written year would skip the very years holding preliminary values.
  if (values["skip-unscreened"] && ids !== "preliminary")
    throw new Error("--skip-unscreened goes with `preliminary`");
  if (values["skip-written"] && ids === "preliminary")
    throw new Error("--skip-written and `preliminary` contradict each other");
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
  const now = Date.now();
  const mode = values["skip-written"] ? "written" : values.refetch ? "none" : "complete";
  console.log(`${sourceId}: backfilling ${wanted.length} stations`);

  const failed: string[] = [];
  // Each failure prints as it happens too, since a run killed by its time limit
  // never reaches the summary.
  const fail = (what: string, error: unknown) => {
    const line = `${what}: ${error instanceof Error ? error.message : error}`;
    failed.push(line);
    console.error(`failed: ${line}`);
  };
  let skipped = 0;
  // Years a skip-written campaign found empty lately, skipped rather than asked again.
  // Only a source that says so keeps a record (`keepsEmptyYears`). One that
  // can't be read is neither used nor written over this run.
  const empty =
    mode === "written" && keepsEmptyYears(source.metadata)
      ? await readEmptyYears(store, sourceId, now).catch((error: Error) => {
          console.error(
            `${sourceId}: asking for every year, recording none; the empty-years record: ${error.message}`,
          );
          return undefined;
        })
      : undefined;
  // The whole years each station's levels came back for, for the source's completeness, merged
  // into the record at each write. One that can't be read now fails the run and isn't written over.
  const backfilled: Backfilled | undefined = await readBackfilled(store, sourceId).then(
    () => new Map(),
    (error: Error) => void fail("backfilled years, recording none", error),
  );
  let emptyFound = false;
  // What the run's fetches and the stored years it rewrote left out as outside `SPAN_M`.
  const leftOut = new Dropped();
  let leftOutYears = 0;
  // Series years whose every level was outside it, written as rows flagged bad.
  const badYears: string[] = [];
  let emptySkipped = 0;
  let emptyRecorded = 0;
  // Each station's earliest preliminary value, read again after its levels
  // were fetched, written to the bounds after each batch of 100 stations, so
  // a run stopped by its time limit keeps most of them.
  let preliminary = new Map<string, { preliminary: number | null; screened?: boolean }>(
    behind.map((id) => [id, { preliminary: null }]),
  );
  // Compaction and the read below look for preliminary values from this year on;
  // a `preliminary` run from an earlier start reads from there, so it sees what it fetched.
  const cutoffYear = new Date(now).getUTCFullYear() - REFETCH_YEARS;
  const fromYear = ranges ? Math.min(cutoffYear, start.getUTCFullYear()) : cutoffYear;
  const cutoff = Date.UTC(cutoffYear, 0, 1);
  let saving = Promise.resolve();
  // Saved at most every 5 minutes after a station that found one, and after
  // each batch, since a CO-OPS run can end at its time limit before its first
  // batch of 100 does; a run killed between saves loses only those minutes.
  let emptySaved = Date.now();
  const saveEmpty = (force = false) => {
    if (!empty || !emptyFound) return saving;
    if (!force && Date.now() - emptySaved < 5 * 60_000) return saving;
    emptySaved = Date.now();
    const record = new Map(empty);
    emptyFound = false;
    saving = saving.then(() =>
      writeEmptyYears(store, sourceId, record, now).catch((error) => fail("empty years", error)),
    );
    return saving;
  };
  const save = () => {
    const found = preliminary;
    preliminary = new Map();
    saving = saving.then(async () => {
      if (!found.size) return;
      try {
        if (!(await writePreliminary(store, sourceId, found)))
          console.log(
            `${sourceId}: bounds predate preliminary values; run \`compact ${sourceId} --rebuild-bounds\` to record them`,
          );
      } catch (error) {
        fail("bounds", error);
      }
    });
    return saving;
  };
  // The epochs a station's fetch writes, each with its part of the range (`epochSpans`).
  const spansOf = (station: StoredStation) => {
    const [begin, until] = ranges?.get(station.id) ?? [start, end];
    return epochSpans(
      station.epochs,
      begin,
      until,
      source.metadata.archive,
      splitStarts(source.overrides?.splits?.[station.id], source.metadata.utc_offsets ?? [0, 0]),
    );
  };
  // A source that blocks this client fails every request after, so the run
  // stops rather than go on through its stations.
  let stopped: Blocked | undefined;
  for (const batch of chunks(wanted, 100)) {
    if (stopped) break;
    // Their rows in the source's years say they're being written until the batch
    // ends. Before the bounds are lowered, so a batch skipped here leaves them alone.
    const ids = batch.filter((s) => s.products.includes("levels")).map((s) => s.id);
    const written = new Map<string, YearStats>();
    let marked: string[];
    try {
      marked = await markYears(store, sourceId, ids);
    } catch (error) {
      fail(`years (skipped ${batch.length} stations)`, error);
      continue;
    }
    // Before a batch, a station's value is lowered to where its fetch starts,
    // since the fetch may write preliminary values from there. A run killed
    // partway leaves it too early, which the next refetch reads again, rather
    // than too late, which nothing would correct. A `preliminary` run fetches
    // from the value itself, so it has nothing to lower.
    const prior = new Map<string, number | null>();
    const lowered = new Map<string, { preliminary: number }>();
    if (!ranges && !legacy)
      for (const station of batch) {
        if (!station.products.includes("levels")) continue;
        // A station with no row is new to compaction, which reads its files.
        // Only the current epoch's values count, so only its span lowers.
        // No read looks before the cutoff, so neither does the lowered value, and a
        // fetch that ends before it needs none.
        const span = spansOf(station).find((s) => s.epoch.id === epochOf(station));
        const known = bounds.get(station.id)?.preliminary;
        const from = span ? Math.max(span.from.getTime(), cutoff) : Infinity;
        if (
          !span ||
          from >= span.to.getTime() ||
          known === undefined ||
          (known && Date.parse(known) <= from)
        )
          continue;
        prior.set(station.id, known ? Date.parse(known) : null);
        lowered.set(station.id, { preliminary: from });
      }
    if (lowered.size)
      try {
        await writePreliminary(store, sourceId, lowered);
      } catch (error) {
        // Fetched unlowered, a killed run could leave these too late; they wait for the next run.
        fail(`bounds (skipped ${batch.length} stations)`, error);
        await commitYears(store, sourceId, marked, new Map()).catch((e) => fail("years", e));
        continue;
      }
    // Lowered stations that fetched no year of levels, having none to fetch or
    // stopping first, get their value back.
    const fetched = new Set<string>();
    await pool(batch, positive("concurrency"), async (station) => {
      if (stopped) return;
      const spans = spansOf(station);
      const current = epochOf(station);
      let levels: string | undefined;
      // The years of the station's levels whose fetch failed, or skipped part-written, which go unrecorded.
      const failedYears = new Set<string>();
      for (const product of station.products)
        for (const { epoch, from: since, to: until } of spans) {
          if (stopped) break;
          // One read per series tells which years are done, rather than one per year;
          // --skip-written needs a listing, and a read of years from 2026 on.
          let plan;
          let files;
          const ownEpoch = product === "levels" && epoch.id === current;
          try {
            const dir = seriesDir(
              storeFor(station),
              product,
              station.source,
              station.source_id,
              epoch.id,
            );
            plan = await yearsToFetch(dir, since, until, mode, now, station.source_qc_start);
            if (plan.fetch.length) {
              plan.listed ??= await listYears(dir);
              files = seriesFiles(dir, plan.listed, readerOf(product));
            }
            // A station picked for its preliminary value is read again even with no year
            // left to fetch, so one the source finalized drops out.
            if (ownEpoch && (plan.fetch.length || ranges)) levels = dir;
          } catch (error) {
            fail(`${station.id} ${product}`, error);
            if (product === "levels")
              for (const [from] of years(since, until))
                failedYears.add(`${epoch.id} ${from.getUTCFullYear()}`);
            continue;
          }
          skipped += plan.skipped;
          // A year skipped but not known to be whole goes unrecorded (`partial`).
          if (product === "levels")
            for (const y of plan.partial) failedYears.add(`${epoch.id} ${y}`);
          for (const [from, to] of plan.fetch) {
            if (stopped) break;
            const key = emptyKey(station.id, product, epoch.id, from.getUTCFullYear());
            if (empty?.has(key)) {
              emptySkipped++;
              continue;
            }
            const label = `${station.id} ${product} ${from.getUTCFullYear()}${epoch.id === current ? "" : ` (epoch ${epoch.id})`}`;
            if (ownEpoch) fetched.add(station.id);
            try {
              const report: YearReport = { dropped: new Dropped(), allOutOfSpan: false };
              const rows = await backfillYear(
                source,
                station,
                product,
                from,
                to,
                epoch,
                files!,
                written,
                report,
              );
              // Counted whatever came of the year, so a source whose values all turned to fill shows as that.
              if (report.dropped.count) {
                leftOut.merge(report.dropped);
                leftOutYears++;
                const note = `left out ${report.dropped.describe()}`;
                if (report.allOutOfSpan) {
                  badYears.push(label);
                  console.log(
                    `${label}: every level the source sent was outside the span, so the year is ${rows} rows flagged bad; ${note}`,
                  );
                } else if (rows === "empty" || rows === undefined) console.log(`${label}: ${note}`);
                else console.log(`${label}: ${rows} rows; ${note}`);
              }
              // An empty answer for a year from 2026 on that has a file, perhaps compaction's
              // last weeks, may be an outage, so it doesn't vouch for the rest of the year.
              if (
                rows === "empty" &&
                product === "levels" &&
                from.getUTCFullYear() >= COMPACTED_SINCE &&
                plan.listed?.has(from.getUTCFullYear())
              )
                failedYears.add(`${epoch.id} ${from.getUTCFullYear()}`);
              if (rows === "empty") {
                // A year with a file keeps being asked for, so an outage never blocks its refill.
                if (
                  empty &&
                  wholeEndedYear(from, to, now) &&
                  !plan.listed?.has(from.getUTCFullYear())
                ) {
                  empty.set(key, new Date(now).toISOString());
                  emptyFound = true;
                  emptyRecorded++;
                }
              } else if (rows !== undefined && !report.dropped.count)
                console.log(`${label}: ${rows} rows`);
            } catch (error) {
              // A failed year writes nothing, so its file keeps what it had.
              if (error instanceof Blocked) stopped ??= error;
              else fail(label, error);
              if (product === "levels") failedYears.add(`${epoch.id} ${from.getUTCFullYear()}`);
            }
          }
        }
      // Whatever the fetches did, the files now say where the preliminary values start.
      // Bounds an older build wrote are left alone, so there's nothing to read for.
      if (levels && !legacy)
        try {
          // Within the current epoch, the rows compaction counts.
          const epoch = station.epochs.find((e) => e.id === epochOf(station))!;
          const window: [number, number] = [
            epoch.since ? Date.parse(epoch.since) : -Infinity,
            epoch.until ? Date.parse(epoch.until) : Infinity,
          ];
          preliminary.set(station.id, await earliestPreliminary(levels, window, fromYear));
        } catch (error) {
          fail(`${station.id} preliminary`, error);
        }
      // A stop may have cut the station's walk short. Publish judges the empty years.
      if (backfilled && !stopped && station.products.includes("levels")) {
        const [begin, until] = ranges?.get(station.id) ?? [start, end];
        recordWalk(backfilled, station, spans, begin, until, now, failedYears);
      }
      await saveEmpty();
    });
    await saveEmpty(true);
    // Merged into the record as it is now, so a compaction's years since this run started stay.
    if (backfilled?.size)
      try {
        const record = mergeBackfilled(await readBackfilled(store, sourceId), backfilled);
        await writeBackfilled(store, sourceId, record);
        backfilled.clear();
      } catch (error) {
        fail("backfilled years", error);
      }
    try {
      await commitYears(store, sourceId, marked, written);
    } catch (error) {
      fail("years", error);
    }
    for (const [id, time] of prior)
      if (!fetched.has(id) && !preliminary.has(id)) preliminary.set(id, { preliminary: time });
    await save();
  }
  // Values set before any batch, such as the stations behind the cutoff.
  await save();
  const why = { written: "already written", complete: "already complete", none: "" }[mode];
  if (why) console.log(`${sourceId}: skipped ${skipped} years ${why}`);
  if (emptySkipped)
    console.log(`${sourceId}: skipped ${emptySkipped} years found empty in the last 30 days`);
  // A jump here, against the years written, is the sign of an outage answering with nothing.
  if (emptyRecorded)
    console.log(`${sourceId}: recorded ${emptyRecorded} years with no file that came back empty`);
  await reportLeftOut(sourceId, leftOut, leftOutYears, badYears);
  console.log(`${sourceId}: ${failed.length} failed`);
  if (stopped) console.error(`${sourceId}: stopped: ${stopped.message}`);
  for (const f of failed) console.error(`  ${f}`);
  if (failed.length || stopped) process.exitCode = 1;
}

/**
 * Print what a backfill left out as outside the store's span, and the years where that was every
 * level, and add them to the workflow run's page. A source whose values all turned to fill
 * shows here as bad values, not as a station gone quiet.
 */
async function reportLeftOut(
  sourceId: string,
  leftOut: Dropped,
  years: number,
  bad: string[],
): Promise<void> {
  if (!leftOut.count) return;
  const lines = [
    `${sourceId}: left out ${leftOut.describe()} in ${years} series years`,
    ...(bad.length
      ? [
          `${sourceId}: ${bad.length} series years held no other level, so they are written as rows flagged bad:`,
          ...bad.slice(0, 100).map((b) => `  ${b}`),
          ...(bad.length > 100 ? [`  and ${bad.length - 100} more`] : []),
        ]
      : []),
  ];
  console.log(lines.join("\n"));
  const page = process.env.GITHUB_STEP_SUMMARY;
  if (page) await appendFile(page, ["```", ...lines, "```", ""].join("\n"));
}

/**
 * Print the stations whose values are still preliminary from before `cutoff`,
 * which `backfill … preliminary` doesn't fetch again from there, and add them to the workflow
 * run's page.
 */
async function reportPast(
  sourceId: string,
  cutoff: Date,
  past: { id: string; preliminary: string }[],
): Promise<void> {
  if (!past.length) return;
  // The run's page holds 1 MiB, so a long list is cut short there and here.
  const lines = [
    `${sourceId}: ${past.length} stations hold values still preliminary from before ${cutoff.toISOString().slice(0, 10)}, past the cutoff:`,
    ...past.slice(0, 1000).map((p) => `  ${p.id} since ${p.preliminary}`),
    ...(past.length > 1000 ? [`  and ${past.length - 1000} more`] : []),
  ];
  console.log(lines.join("\n"));
  const page = process.env.GITHUB_STEP_SUMMARY;
  if (page) await appendFile(page, ["```", ...lines, "```", ""].join("\n"));
}

/**
 * A source registered since the last Monthly refresh has no list yet, so the
 * scheduled jobs that pick it up have nothing to do until that refresh starts it.
 */
async function notStarted(sourceId: string): Promise<void> {
  const note = `${sourceId}: no station list yet; the Monthly workflow starts it, or dispatch Monthly with \`sources: ${sourceId}\` to start it now`;
  console.log(note);
  // On a run's page too, so a store that lost everything doesn't pass unseen.
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=No station list::${note}`);
  const page = process.env.GITHUB_STEP_SUMMARY;
  if (page) await appendFile(page, `${note}\n`);
}

async function compact(sourceId: string, days: number): Promise<void> {
  let live = 0;
  const source = sourceOf(sourceId);
  const started = await startedListOf(storeOfSource(source.metadata), source);
  if (!started) return await notStarted(sourceId);
  const summary = await reporting(`compact ${sourceId}`, async () => {
    // An R2 lifecycle rule deletes a daily file after RECENT_DAYS.
    if (!Number.isInteger(days) || days < 1 || days > RECENT_DAYS)
      throw new Error(
        `--days must be a whole number from 1 to ${RECENT_DAYS}, the days the daily files are kept`,
      );
    const concurrency = positive("concurrency");
    setConnections(concurrency);
    const stations = started;
    live = stations.filter(
      (s) => s.live && s.status === "active" && s.products.includes("levels"),
    ).length;
    const [start, end] = lastDays(Date.now(), days);
    return compactRecent({
      source,
      stations,
      storeFor,
      concurrency,
      start,
      end,
      rebuildBounds: values["rebuild-bounds"],
    });
  });
  // A failed fold left its year file as it was; a person should look. Every
  // live station silent means the daily files are missing, empty or not being written.
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
function positive(name: "concurrency" | "budget", fallback?: string): number {
  const value = Number(values[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`--${name} must be a whole number of at least 1`);
  return value;
}

/** A station by its ID or its source's own code. */
function find(list: StoredStation[], sourceId: string, id: string): StoredStation {
  const station = list.find((s) => s.id === id || s.id === `${sourceId}/${id}`);
  if (!station) throw new Error(`No station ${id} in ${sourceId}'s list`);
  return station;
}

/**
 * Requalify stations 100 at a time. A station whose turn comes after `until`
 * isn't started, and is returned in `left`; one requalified without a failure
 * goes to `finished` once its files are written. Those in `first` go first,
 * each over its own years. With a budget, `all` takes only the stations the
 * years file has a file in range for, or has marked as being written, or every
 * station for a source without one.
 */
async function requalifyStations(
  sourceId: string,
  ids: string,
  start: number,
  end: number,
  until = Infinity,
  finished?: (id: string) => Promise<void>,
  first = new Map<string, { start: number; end: number }>(),
): Promise<RunSummary & { left: string[] }> {
  if (start >= end)
    throw new Error(`requalify ${start} ${end} holds no year; the end is exclusive`);
  if (values.shard && ids !== "all") throw new Error("--shard splits `all`, not named stations");
  const source = sourceOf(sourceId);
  const store = storeOfSource(source.metadata);
  const list = await listOf(store, source);
  // Every station with files, inactive ones too, since their stored values are QC'd as well.
  let stations = ids === "all" ? list : ids.split(",").map((id) => find(list, sourceId, id));
  if (values.shard) stations = shard(stations, ...parseShard(values.shard));
  // Only a budgeted run, whose budget the rest would spend: a years file a
  // short listing left a row out of would otherwise hide a station from a hand run.
  const rows = ids === "all" && until < Infinity ? await readYears(store, sourceId) : null;
  if (rows) {
    const due = new Set(
      [...rows.values()]
        .filter((r) => {
          const { start: from, end: to } = first.get(r.id) ?? { start, end };
          return r.year === null || (r.year >= from && r.year < to);
        })
        .map((r) => r.id),
    );
    // A saved station always, so a row the listing left out doesn't drop its saved years.
    stations = stations.filter((s) => due.has(s.id) || first.has(s.id));
  }
  stations = [
    ...stations.filter((s) => first.has(s.id)),
    ...stations.filter((s) => !first.has(s.id)),
  ];
  setConnections(positive("concurrency"));
  const left: string[] = [];
  const summary = await reporting(`requalify ${sourceId} ${start}–${end}`, async () => {
    const s: RunSummary = {
      title: `requalify ${sourceId} ${start}–${end}`,
      stations: stations.length,
      updated: 0,
      stale: [],
      failed: [],
      waiting: [],
      values: 0,
      files: 0,
    };
    for (const batch of chunks(stations, 100)) {
      const ids = batch.map((station) => station.id);
      // Out of time: the rest aren't marked, which would rewrite the years file for nothing.
      if (Date.now() > until) {
        left.push(...ids);
        continue;
      }
      const written = new Map<string, YearStats>();
      // A batch that can't be marked isn't written, so the years can't go stale.
      let marked: string[];
      try {
        marked = await markYears(store, sourceId, ids);
      } catch (error) {
        // Each named, so a budgeted run saves them for the next.
        for (const id of ids)
          s.failed.push(
            `${id}: years file not marked: ${error instanceof Error ? error.message : error}`,
          );
        continue;
      }
      const died = new Set<string>();
      const late = await poolUntil(batch, positive("concurrency"), until, async (station) => {
        try {
          const { files, changed, dropped, warnings } = await requalifyInWorker(
            sourceId,
            station,
            storeFor(station),
            first.get(station.id)?.start ?? start,
            first.get(station.id)?.end ?? end,
            written,
          );
          if (files) s.updated++;
          s.files += files;
          s.values += changed;
          if (dropped.count) {
            (s.dropped ??= new Dropped()).merge(dropped);
            console.log(`${station.id}: left out ${dropped.describe()}`);
          }
          for (const w of warnings) (s.warned ??= []).push(`${station.id}: ${w}`);
        } catch (error) {
          s.failed.push(`${station.id}: ${error instanceof Error ? error.message : error}`);
          if (error instanceof WorkerDied) died.add(station.id);
          return;
        }
        await finished?.(station.id);
      });
      left.push(...late.map((station) => station.id));
      try {
        // A station whose worker died stays marked, so the next reconcile reads
        // its files: the worker may have written one it couldn't report.
        await commitYears(
          store,
          sourceId,
          marked.filter((id) => !died.has(id)),
          written,
        );
      } catch (error) {
        s.failed.push(`years: ${error instanceof Error ? error.message : error}`);
      }
    }
    // First, so the summary's first 20 warnings never leave it out.
    if (left.length)
      (s.warned ??= []).unshift(`${left.length} stations not started, for the next run`);
    s.stations -= left.length;
    return s;
  });
  if (summary.failed.length) process.exitCode = 1;
  return { ...summary, left };
}

async function fitStations(sourceId: string, ids?: string): Promise<void> {
  const source = sourceOf(sourceId);
  const store = storeOfSource(source.metadata);
  const list = await listOf(store, source);
  if (ids && values.shard) throw new Error("--shard splits every station, not named ones");
  const only = ids
    ? ids.split(",").map((id) => (id.startsWith(`${sourceId}/`) ? id : `${sourceId}/${id}`))
    : values.shard
      ? shard(list, ...parseShard(values.shard)).map((s) => s.id)
      : undefined;
  const unknown = (ids ? only! : []).filter((id) => !list.some((s) => s.id === id));
  if (unknown.length) throw new Error(`${sourceId} lists no ${unknown.join(", ")}`);
  setConnections(positive("concurrency"));
  const report = await fitSource(store, source, list, {
    now: new Date(),
    errata,
    all: values.all,
    ...(only ? { only } : {}),
    concurrency: positive("concurrency"),
    log: (line) => console.log(line),
  });
  const lines = [
    `fit ${sourceId}: ${report.fitted.length} fitted, ${report.none.length} without constants, ${report.current} current, ${report.failed.length} failed`,
    ...report.failed.map((f) => `  failed ${f}`),
  ];
  for (const line of lines) console.log(line);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, ["```", ...lines, "```", ""].join("\n"));
  if (report.failed.length) process.exitCode = 1;
}

async function analyzeSource(sourceId: string): Promise<void> {
  const source = sourceOf(sourceId);
  const store = storeOfSource(source.metadata);
  const list = await listOf(store, source);
  setConnections(positive("concurrency"));
  const report = await analyze(store, source, list, {
    now: new Date(),
    all: values.all,
    concurrency: positive("concurrency"),
  });
  const lines = [
    `analyze ${sourceId}: judged ${report.judged} stations, ${report.changed.length} change QC, ${report.failed.length} failed, ${report.warned.length} with warnings`,
    ...report.changed.map(
      (c) =>
        `  ${c.id}: tidal ${c.from} → ${c.to}${c.tide_m === null ? "" : ` (M2 + O1 ${(c.tide_m * 100).toFixed(1)} cm)`}`,
    ),
    ...report.failed.map((f) => `  failed ${f}`),
    ...report.warned.map((w) => `  warning ${w}`),
  ];
  for (const line of lines) console.log(line);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, ["```", ...lines, "```", ""].join("\n"));
  if (report.failed.length) process.exitCode = 1;
  if (!values.requalify) return;
  // Every year of every epoch, since a station's verdict holds for its whole
  // record; each station marked once its files are written, so a run stopped
  // partway leaves the rest pending for the next.
  const listed = new Map(list.map((s) => [s.id, s]));
  const analysis = await readAnalysis(store, sourceId);
  // Stations whose rules differ from their kind's come first; the rest are first verdicts that change nothing.
  const differs = (id: string) =>
    !isDeepStrictEqual(
      qcFor({ ...listed.get(id)!, tidal: null }),
      qcFor({ ...listed.get(id)!, ...analysis.get(id)! }),
    );
  const waiting = pending(analysis)
    .filter((id) => listed.has(id))
    .sort((a, b) => Number(differs(b)) - Number(differs(a)));
  // A station starts only within the budget, so the source's compaction isn't held off for long.
  const until = Date.now() + positive("budget", "120") * 60_000;
  // Finished stations are marked as others finish, at most every 5 minutes, and after each batch,
  // since a batch of 1-minute series can run for hours.
  const marks = requalifiedMarks(
    (ids) => markRequalified(store, sourceId, ids, new Date()),
    5 * 60_000,
  );
  let unmarked: string[] = [];
  try {
    let reached = 0;
    for (const batch of chunks(waiting, 100)) {
      if (Date.now() > until) {
        console.log(
          `analyze ${sourceId}: out of time, ${waiting.length - reached} stations not started`,
        );
        break;
      }
      reached += batch.length;
      const { left } = await requalifyStations(
        sourceId,
        batch.join(","),
        0,
        10_000,
        until,
        marks.add,
      );
      await marks.flush();
      if (left.length) {
        console.log(
          `analyze ${sourceId}: out of time, ${waiting.length - reached + left.length} stations not started`,
        );
        break;
      }
    }
  } finally {
    // A throw out of a batch still writes the stations finished before it.
    unmarked = await marks.flush();
  }
  if (unmarked.length) {
    console.error(`analyze ${sourceId}: ${unmarked.length} requalified stations left unmarked`);
    process.exitCode = 1;
  }
}

async function withholdStations(sourceId: string): Promise<void> {
  const source = sourceOf(sourceId);
  const store = storeOfSource(source.metadata);
  const { ids, prefixes, rows } = await withhold(store, source, {
    accept: values["accept-withheld"],
  });
  const lines = [
    `${sourceId}: ${ids.length} withheld stations, ${prefixes.length} directories deleted, rows dropped for ${rows.length}`,
    ...ids.map((id) => `  ${id}: ${withheldReason(source, id)}`),
  ];
  if (ids.length)
    lines.push(
      `Refresh ${sourceId}'s list with the Monthly workflow (sources: ${sourceId}) to drop them from it and publish stations.parquet. In the Ingest workflow, this withhold's prune jobs run \`matches --prune\` and \`links --prune\`, which take their rows out of stations/matches.parquet and stations/links.parquet, as a migration's prune steps do after it; after a withhold run anywhere else, dispatch Ingest with each.`,
    );
  for (const line of lines) console.log(line);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, ["```", ...lines, "```", ""].join("\n"));
}

/** Delete the files of a source's dropped records, or with --dry-run list them. */
async function dropStations(sourceId: string): Promise<void> {
  const drop = DROPS[sourceId];
  if (!drop) throw new Error(`${sourceId} drops no records`);
  const store = storeOfSource(sourceOf(sourceId).metadata);
  const dryRun = values["dry-run"];
  const { ids, prefixes, cleared } = await dropFiles(store, sourceId, drop, { dryRun });
  const lines = [
    `${sourceId}: ${ids.length} dropped stations with files, ${prefixes.length} directories ${dryRun ? "to delete (dry run)" : "deleted"}`,
    ...ids.map((id) => `  ${id}`),
    `${sourceId}: ${cleared.length} dropped stations' backfilled years ${dryRun ? "to clear (dry run)" : "cleared"}`,
  ];
  if (ids.length && !dryRun)
    lines.push(
      `Run \`compact ${sourceId} --rebuild-bounds\` and \`publish\` so the bounds and stations.parquet drop them. In the Ingest workflow, this drop's prune jobs run \`matches --prune\` and \`links --prune\`, which take their rows out of stations/matches.parquet and stations/links.parquet, as a migration's prune steps do after it; after a drop run anywhere else, dispatch Ingest with each.`,
    );
  for (const line of lines) console.log(line);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, ["```", ...lines, "```", ""].join("\n"));
}

/** Drop rows outside their epoch's span that the right epoch holds, or with --dry-run list them. */
async function misplacedRows(sourceId: string): Promise<void> {
  const store = storeOfSource(sourceOf(sourceId).metadata);
  const list = await listOf(store, sourceOf(sourceId));
  const dryRun = values["dry-run"];
  const { files, unlisted, failed } = await misplaced(store, sourceId, list, removePrefixes, {
    dryRun,
    keep: (id) => withheldReason(sourceOf(sourceId), id) === null,
  });
  const iso = (t: number) => new Date(t).toISOString();
  const lines = [
    `${sourceId}: ${files.length} files with rows outside their epoch's span; ${files.reduce((n, f) => n + f.dropped, 0)} rows ${dryRun ? "to drop (dry run)" : "dropped"}, ${files.filter((f) => f.emptied).length} files ${dryRun ? "to delete" : "deleted"}, ${files.reduce((n, f) => n + f.kept.length, 0)} rows kept`,
    ...files.map(
      (f) =>
        `  ${f.file}: ${f.dropped} ${dryRun ? "to drop" : "dropped"}${f.emptied ? ", empty" : ""}${f.kept.length ? `, ${f.kept.length} kept (${f.kept.filter((k) => k.epoch === null).length} in no epoch's span) from ${iso(f.kept[0]!.time)}` : ""}`,
    ),
    ...(unlisted.length
      ? [
          `${sourceId}: ${unlisted.length} files of no listed station or epoch, left as they are`,
          ...unlisted.map((f) => `  ${f}`),
        ]
      : []),
  ];
  if (failed.length) {
    lines.push(
      `${sourceId}: ${failed.length} year files the years file couldn't read; their stations stay marked for compaction to read again`,
      ...failed.map((f) => `  ${f}`),
    );
    process.exitCode = 1;
  }
  if (!dryRun && files.some((f) => f.dropped))
    lines.push(
      `Run \`compact ${sourceId} --rebuild-bounds\` and \`publish\` to rebuild the bounds and stations.parquet.`,
    );
  for (const line of lines) console.log(line);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, ["```", ...lines, "```", ""].join("\n"));
}

function parseEpoch(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) throw new Error(`Not an epoch: ${value}`);
  return Number(value);
}

function parseYear(value: string): number {
  if (!/^\d{4}$/.test(value)) throw new Error(`Not a year: ${value}`);
  return Number(value);
}

function parseDate(value: string): Date {
  const date = new Date(/^\d{4}$/.test(value) ? `${value}-01-01T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${value}`);
  return date;
}

function usage(): never {
  console.error(
    "usage: ingest.ts stations [source...] [--accept-epochs] [--accept-withheld] [--no-publish] | publish | links [--concurrency N] [--prune] | matches [--concurrency N] [--accept-matches] [--prune] | backfill <source> <station,...|all|preliminary> <start> <end> [--first FILE] [--shard I/N] [--refetch | --skip-written] [--skip-unscreened] [--with-inactive] | compact <source> [--days N] [--rebuild-bounds] | requalify <source> <station,...|all> <start> <end> [--shard I/N] [--budget MINUTES] | withhold <source> [--accept-withheld] | drop <source> [--dry-run] | misplaced <source> [--dry-run] | delete-years <source> <station> <epoch> <year,...> | years <source> [--rebuild-years] | analyze <source> [--all] [--requalify [--budget MINUTES]] | fit <source> [station,...] [--all] [--shard I/N]",
  );
  process.exit(1);
}
