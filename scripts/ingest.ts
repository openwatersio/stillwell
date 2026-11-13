/**
 * Fetch from upstream sources into the store.
 *
 *   node scripts/ingest.ts stations [source...] [--accept-epochs] [--accept-withheld] [--no-publish]
 *   node scripts/ingest.ts publish
 *   node scripts/ingest.ts links [--concurrency 4]
 *   node scripts/ingest.ts backfill <source> <station,...|all|preliminary> <start> <end>
 *       [--first <file>] [--shard <i>/<n>] [--refetch | --skip-written] [--skip-unscreened]
 *       [--with-inactive]
 *   node scripts/ingest.ts recent <source> [--hours 24] [--keep-days 7]
 *   node scripts/ingest.ts compact <source> [--days 1] [--rebuild-bounds]
 *   node scripts/ingest.ts requalify <source> <station,...|all> <start> <end> [--shard <i>/<n>]
 *   node scripts/ingest.ts withhold <source> [--accept-withheld]
 *   node scripts/ingest.ts years <source> [--rebuild-years]
 *   node scripts/ingest.ts analyze <source> [--all] [--requalify [--budget 120]]
 *
 * `stations` refreshes each source's list in the store, stations/<source>.parquet,
 * after snapshotting the previous one to history/, then writes stations.parquet,
 * sources.json, errata.json and their definitions (datapackage.json), unless `--no-publish`; `publish` writes only those. It
 * changes no file in the repo. A new source's first refresh starts its list.
 * `backfill` writes every product a station has over [start, end) (dates as YYYY or YYYY-MM-DD, end
 * exclusive) into its yearly files, replacing that range and keeping the rest,
 * so a rerun gives the same files. A calendar month the fetch returned nothing
 * for keeps what it had, so an outage never deletes stored values; a value the
 * source withdraws stays until its month is fetched again with others.
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
 * new epoch starts its years over. `recent` fetches the last hours for every live station and merges them into
 * recent/<source>.parquet. `compact` folds
 * the last `--days` whole UTC days of that window into each station's year
 * files, each row into its datum epoch's, then writes each station's first and
 * last level to stations/bounds/<source>.parquet (`updateBounds` in
 * src/store/recent.ts); `--rebuild-bounds` reads every station's again rather
 * than keep the ones it knows. Both print a summary, and add it to
 * the workflow run's page. `requalify` works the flags of stations' observed
 * levels out again over the years [start, end) from the store alone (src/store/requalify.ts),
 * so a QC rule change reaches stored values without fetching them again.
 * `withhold` deletes the files of a source's withheld stations, whose owner
 * refused republication, and their rows in its bounds, years and recent window
 * (src/withhold.ts); the source's next refresh drops them from its list.
 * `years` reads the source's year files of levels into stations/years/<source>.parquet,
 * which backfill, compaction and requalify then keep (src/store/years.ts).
 * `analyze` judges the source's stations that are due from their levels in the
 * store, such as whether they carry a tide, into stations/analysis/<source>.parquet
 * (src/store/analysis.ts), `--all` every station, and lists the stations whose
 * QC that changes; `--requalify` requalifies them, and every station after its
 * first verdict, over every year, starting batches for `--budget` minutes.
 *
 * A station the source now reports against another reference opens a datum
 * epoch, whose values go to files of their own (docs/stations.md). `backfill`
 * and `recent` write the current epoch, never before its start, and skip a
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
  yearsToFetch,
} from "../src/backfill.ts";
import { emptyKey, readEmptyYears, writeEmptyYears } from "../src/empty-years.ts";
import { useDiskCache } from "../src/cache.ts";
import { Blocked } from "../src/http.ts";
import {
  chunks,
  compactRecent,
  formatSummary,
  lastDays,
  pool,
  qcFor,
  REFETCH_YEARS,
  updateRecent,
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
  type YearStats,
} from "../src/store/parquet.ts";
import { commitYears, markYears, reconcileYears } from "../src/store/years.ts";
import { requalify } from "../src/store/requalify.ts";
import { analyze, markRequalified, pending, readAnalysis } from "../src/store/analysis.ts";
import { boundsPath, seriesDir, stationsPath, yearsPath } from "../src/store/paths.ts";
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
import { errata, errataProblems, sourceOf, sources } from "../src/sources/index.ts";
import { withhold, withheldReason } from "../src/withhold.ts";
import { storeFor, storeOfSource } from "../src/store/stores.ts";
import { measureLinks, readLinks, writeLinks } from "../src/links.ts";
import { ID_KM } from "../src/same-as.ts";

useDiskCache();

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    hours: { type: "string", default: "24" },
    "keep-days": { type: "string", default: "7" },
    days: { type: "string", default: "1" },
    concurrency: { type: "string", default: "4" },
    "accept-epochs": { type: "boolean", default: false },
    "accept-withheld": { type: "boolean", default: false },
    "no-publish": { type: "boolean", default: false },
    first: { type: "string" },
    shard: { type: "string" },
    refetch: { type: "boolean", default: false },
    "skip-written": { type: "boolean", default: false },
    "with-inactive": { type: "boolean", default: false },
    "skip-unscreened": { type: "boolean", default: false },
    "rebuild-bounds": { type: "boolean", default: false },
    "rebuild-years": { type: "boolean", default: false },
    all: { type: "boolean", default: false },
    requalify: { type: "boolean", default: false },
    budget: { type: "string", default: "120" },
  },
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
      const { rows, failed } = await measureLinks(
        store,
        await stationsToMeasure(store, held),
        positive("concurrency"),
        await readLinks(store),
      );
      await writeLinks(store, rows);
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
  case "recent": {
    const [source] = args;
    if (!source) usage();
    await recent(source);
    break;
  }
  case "requalify": {
    const [source, ids, start, end] = args;
    if (!source || !ids || !start || !end) usage();
    await requalifyStations(source, ids, parseYear(start), parseYear(end));
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
  const result = await publishStations(store, held, expected, errata);
  if ("count" in result) {
    console.log(`${stationsPath(store)}: ${result.count} stations`);
    const { pairs, dropped, skipped, wide } = result.links;
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
    const { joined, fromTide, computed, far, disagree } = result.datums;
    console.log(
      `  datums: ${joined} joined to slackwater-database, ${fromTide} with its datums, ${computed} computed from a linked series`,
    );
    for (const f of far) console.log(`  datums join dropped: ${f}`);
    for (const d of disagree) console.log(`  datums differ: ${d}`);
    for (const e of result.unknownErrata)
      console.error(`  erratum lists a station not in the store: ${e}`);
    for (const p of errataProblems) console.error(`  errata: ${p}; left out`);
    // A typo in an erratum's stations tags nothing, and a bad errata file leaves
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
  // Only a source whose empty answer means no data, not an outage, keeps a
  // record. One that can't be read is neither used nor written over this run.
  const empty =
    mode === "written" && source.metadata.empty_means_none
      ? await readEmptyYears(store, sourceId, now).catch((error: Error) => {
          console.error(
            `${sourceId}: asking for every year, recording none; the empty-years record: ${error.message}`,
          );
          return undefined;
        })
      : undefined;
  let emptyFound = false;
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
            if (plan.fetch.length)
              files = seriesFiles(dir, plan.listed ?? (await listYears(dir)), readerOf(product));
            // A station picked for its preliminary value is read again even with no year
            // left to fetch, so one the source finalized drops out.
            if (ownEpoch && (plan.fetch.length || ranges)) levels = dir;
          } catch (error) {
            fail(`${station.id} ${product}`, error);
            continue;
          }
          skipped += plan.skipped;
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
              const rows = await backfillYear(
                source,
                station,
                product,
                from,
                to,
                epoch,
                files!,
                written,
              );
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
              } else if (rows !== undefined) console.log(`${label}: ${rows} rows`);
            } catch (error) {
              // A failed year writes nothing, so its file keeps what it had.
              if (error instanceof Blocked) stopped ??= error;
              else fail(label, error);
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
      await saveEmpty();
    });
    await saveEmpty(true);
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
  console.log(`${sourceId}: ${failed.length} failed`);
  if (stopped) console.error(`${sourceId}: stopped: ${stopped.message}`);
  for (const f of failed) console.error(`  ${f}`);
  if (failed.length || stopped) process.exitCode = 1;
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

async function recent(sourceId: string): Promise<void> {
  const now = Date.now();
  const source = sourceOf(sourceId);
  const stations = await startedListOf(storeOfSource(source.metadata), source);
  if (!stations) return await notStarted(sourceId);
  const summary = await reporting(`recent ${sourceId}`, async () => {
    const [hours, keepDays] = [positive("hours"), positive("keep-days")];
    return updateRecent({
      source,
      stations,
      storeFor,
      concurrency: positive("concurrency"),
      since: new Date(now - hours * 3_600_000),
      now,
      keepDays,
    });
  });
  // A source now reporting a station in another datum needs a station refresh,
  // which the Ingest hourly workflow starts.
  const output = process.env.GITHUB_OUTPUT;
  if (output && summary.datumChanged) await appendFile(output, "datum_changed=true\n");
  // Some stations failing or going quiet is ordinary; all of them is an outage,
  // or a broken adapter, even one that answers "no data" without an error.
  // A source that blocked this client needs a person, however many stations got through.
  if (
    summary.blocked ||
    (summary.stations && summary.failed.length + summary.stale.length >= summary.stations)
  )
    process.exitCode = 1;
}

async function compact(sourceId: string, days: number): Promise<void> {
  let live = 0;
  const source = sourceOf(sourceId);
  const started = await startedListOf(storeOfSource(source.metadata), source);
  if (!started) return await notStarted(sourceId);
  const summary = await reporting(`compact ${sourceId}`, async () => {
    // The window keeps 7 days back from its last hourly run, which is partway
    // into the seventh day, so 6 is the most whole days it holds.
    if (!Number.isInteger(days) || days < 1 || days > 6)
      throw new Error("--days must be a whole number from 1 to 6, the whole days the window holds");
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
function positive(name: "concurrency" | "hours" | "keep-days" | "budget"): number {
  const value = Number(values[name]);
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

async function requalifyStations(
  sourceId: string,
  ids: string,
  start: number,
  end: number,
): Promise<RunSummary> {
  if (start >= end)
    throw new Error(`requalify ${start} ${end} holds no year; the end is exclusive`);
  if (values.shard && ids !== "all") throw new Error("--shard splits `all`, not named stations");
  const source = sourceOf(sourceId);
  const list = await listOf(storeOfSource(source.metadata), source);
  // Every station with files, inactive ones too, since their stored values are QC'd as well.
  let stations = ids === "all" ? list : ids.split(",").map((id) => find(list, sourceId, id));
  if (values.shard) stations = shard(stations, ...parseShard(values.shard));
  setConnections(positive("concurrency"));
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
    const store = storeOfSource(source.metadata);
    for (const batch of chunks(stations, 100)) {
      const ids = batch.map((station) => station.id);
      const written = new Map<string, YearStats>();
      // A batch that can't be marked isn't written, so the years can't go stale.
      let marked: string[];
      try {
        marked = await markYears(store, sourceId, ids);
      } catch (error) {
        s.failed.push(
          `years (skipped ${ids.length} stations): ${error instanceof Error ? error.message : error}`,
        );
        continue;
      }
      await pool(batch, positive("concurrency"), async (station) => {
        try {
          const { files, changed, warnings } = await requalify(
            source,
            station,
            storeFor(station),
            start,
            end,
            written,
          );
          if (files) s.updated++;
          s.files += files;
          s.values += changed;
          for (const w of warnings) (s.warned ??= []).push(`${station.id}: ${w}`);
        } catch (error) {
          s.failed.push(`${station.id}: ${error instanceof Error ? error.message : error}`);
        }
      });
      try {
        await commitYears(store, sourceId, marked, written);
      } catch (error) {
        s.failed.push(`years: ${error instanceof Error ? error.message : error}`);
      }
    }
    return s;
  });
  if (summary.failed.length) process.exitCode = 1;
  return summary;
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
  // record; a batch at a time, each marked once done, so a run stopped partway
  // leaves the rest pending for the next.
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
  // A batch starts only within the budget, so the source's hourly runs and compaction aren't held off for long.
  const until = Date.now() + positive("budget") * 60_000;
  for (const batch of chunks(waiting, 100)) {
    if (Date.now() > until) {
      console.log(
        `analyze ${sourceId}: out of time, ${waiting.length - waiting.indexOf(batch[0]!)} stations left pending`,
      );
      break;
    }
    const summary = await requalifyStations(sourceId, batch.join(","), 0, 10_000);
    // A failure that names no station, such as the years file's, may have skipped any of them.
    const failed = new Set(summary.failed.map((f) => f.split(": ")[0]));
    if ([...failed].some((id) => !batch.includes(id!))) continue;
    await markRequalified(
      store,
      sourceId,
      batch.filter((id) => !failed.has(id)),
      new Date(),
    );
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
      `Refresh ${sourceId}'s list with the Monthly workflow (sources: ${sourceId}) to drop them from it and publish stations.parquet.`,
    );
  for (const line of lines) console.log(line);
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, ["```", ...lines, "```", ""].join("\n"));
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
    "usage: ingest.ts stations [source...] [--accept-epochs] [--accept-withheld] [--no-publish] | publish | links [--concurrency N] | backfill <source> <station,...|all|preliminary> <start> <end> [--first FILE] [--shard I/N] [--refetch | --skip-written] [--skip-unscreened] [--with-inactive] | recent <source> [--hours N] [--keep-days N] | compact <source> [--days N] [--rebuild-bounds] | requalify <source> <station,...|all> <start> <end> [--shard I/N] | withhold <source> [--accept-withheld] | years <source> [--rebuild-years] | analyze <source> [--all] [--requalify [--budget MINUTES]]",
  );
  process.exit(1);
}
