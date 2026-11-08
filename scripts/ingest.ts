/**
 * Fetch from upstream sources into the lake.
 *
 *   node scripts/ingest.ts stations [source...] [--accept-epochs] [--no-publish]
 *   node scripts/ingest.ts publish
 *   node scripts/ingest.ts backfill <source> <station,...|all|preliminary> <start> <end>
 *       [--first <file>] [--shard <i>/<n>] [--refetch | --skip-written] [--skip-unscreened]
 *   node scripts/ingest.ts recent <source> [--hours 24] [--keep-days 7]
 *   node scripts/ingest.ts compact <source> [--days 1] [--rebuild-bounds]
 *
 * `stations` refreshes each source's list in the lake, stations/<source>.parquet,
 * after snapshotting the previous one to history/, then writes stations.parquet,
 * sources.json and errata.json, unless `--no-publish`; `publish` writes only those. It
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
 * src/lake/recent.ts); `--rebuild-bounds` reads every station's again rather
 * than keep the ones it knows. Both print a summary, and add it to
 * the workflow run's page.
 *
 * A station the source now reports against another reference opens a datum
 * epoch, whose values go to files of their own (docs/stations.md). `backfill`
 * and `recent` write the current epoch, never before its start, and skip a
 * station whose new epoch waits on a person. For a source with `archive:
 * "previous"`, backfill writes each closed epoch's span to its files too. `backfill all` skips inactive
 * stations; naming one still works, adapters refuse values in any datum but
 * the station's, and backfill refuses a file whose `datum` column names another.
 *
 * The lake is WATER_LEVELS_LAKE: a directory (default `data`) or an `s3://` URL.
 * Its bucket is public, so a source whose terms bar republishing its data keeps
 * its list and series in WATER_LEVELS_RESTRICTED_LAKE instead, which must be a
 * separate lake, and ingest refuses to write one without it. Commercial use is
 * a tag on each station for readers to filter on; it doesn't move a station.
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  earliestPreliminary,
  epochSpans,
  orderStations,
  parseShard,
  parseStationList,
  preliminaryRuns,
  shard,
  yearsToFetch,
} from "../src/backfill.ts";
import { useDiskCache } from "../src/cache.ts";
import { citedIn, fromPublished, openErrata, settle } from "../src/errata.ts";
import { Blocked } from "../src/http.ts";
import { mergeFetched, sameRows } from "../src/lake/merge.ts";
import {
  chunks,
  compactRecent,
  formatSummary,
  lastDays,
  pool,
  qcFor,
  REFETCH_YEARS,
  refuseOtherDatum,
  updateRecent,
  writePreliminary,
  type RunSummary,
} from "../src/lake/recent.ts";
import { appendFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isHeld } from "../src/epochs.ts";
import {
  readExtremes,
  readJsonArray,
  readObservations,
  readStationBounds,
  setConnections,
  writeExtremes,
  publishedSources,
  writeObservations,
} from "../src/lake/parquet.ts";
import { boundsPath, errataPath, seriesDir, seriesPath, stationsPath } from "../src/lake/paths.ts";
import { qc, withSourceFlag } from "../src/qc.ts";
import {
  describeReport,
  hasHistory,
  epochOf,
  listOf,
  startedListOf,
  publishStations,
  refreshSource,
} from "../src/refresh.ts";
import type {
  Epoch,
  LakeStation,
  Observation,
  Product,
  PublishedExtreme,
  Source,
  SourceMetadata,
  Station,
} from "../src/schema.ts";
import { sourceOf, sources } from "../src/sources/index.ts";

const LAKE = (process.env.WATER_LEVELS_LAKE ?? "data").replace(/\/$/, "");

/** Where a station's series go: its source's lake. */
function lakeFor(station: Pick<Station, "source">): string {
  return lakeOfSource(sourceOf(station.source).metadata);
}

/** The public lake, or the private one for a source whose terms bar republishing. */
function lakeOfSource(metadata: SourceMetadata): string {
  if (metadata.license.redistribution) return LAKE;
  const restricted = process.env.WATER_LEVELS_RESTRICTED_LAKE?.replace(/\/$/, "");
  if (!restricted)
    throw new Error(
      `${metadata.id} bars republishing its data; set WATER_LEVELS_RESTRICTED_LAKE to a private lake`,
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

useDiskCache();

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    hours: { type: "string", default: "24" },
    "keep-days": { type: "string", default: "7" },
    days: { type: "string", default: "1" },
    concurrency: { type: "string", default: "4" },
    "accept-epochs": { type: "boolean", default: false },
    "no-publish": { type: "boolean", default: false },
    first: { type: "string" },
    shard: { type: "string" },
    refetch: { type: "boolean", default: false },
    "skip-written": { type: "boolean", default: false },
    "skip-unscreened": { type: "boolean", default: false },
    "rebuild-bounds": { type: "boolean", default: false },
  },
});
const [command, ...args] = positionals;

switch (command) {
  case "stations":
    await refreshStations(args.length ? args : Object.keys(sources));
    break;
  case "publish":
    for (const lake of new Set(Object.values(sources).flatMap(lakesOf))) await publish(lake);
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
  case "compact": {
    const [source] = args;
    if (!source) usage();
    await compact(source, Number(values.days));
    break;
  }
  default:
    usage();
}

async function refreshStations(ids: string[]): Promise<void> {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const lakes = new Set<string>();
  const summary: string[] = [];
  for (const id of ids) {
    const source = sourceOf(id);
    try {
      const lake = lakeOfSource(source.metadata);
      lakes.add(lake);
      const { stations, report } = await refreshSource(lake, source, {
        now,
        acceptEpochs: values["accept-epochs"],
      });
      const active = stations.filter((s) => s.status === "active").length;
      const lines = describeReport(report);
      lines[0] += `; ${active} active, ${stations.length - active} inactive`;
      for (const line of lines) console.log(line);
      summary.push(...lines);
      // A station waiting on a person, or newly retired by the source itself
      // (a USACE gauge whose series CWMS withdrew), fails the run so it's seen.
      for (const e of report.epochs)
        if (e.event === "held" || e.event === "waiting") process.exitCode = 1;
      if (report.withdrawn.length) process.exitCode = 1;
    } catch (error) {
      // One source failing keeps its list and doesn't stop the others.
      const why = error instanceof Error ? error.message : String(error);
      console.error(`${id}: ${why}; keeping the list in the lake`);
      summary.push(`${id}: ${why}; keeping the list in the lake`);
      process.exitCode = 1;
    }
  }
  // The lists are written, so their report is kept even if publishing fails.
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) await appendFile(file, ["```", ...summary, "```", ""].join("\n"));
  if (!values["no-publish"]) for (const lake of lakes) await publish(lake);
}

/** The lake a source's list is in, or none for a restricted source with no restricted lake configured. */
function lakesOf(source: Source): string[] {
  try {
    return [lakeOfSource(source.metadata)];
  } catch {
    return [];
  }
}

/**
 * Rebuild `stations.parquet`, `sources.json` and `errata.json` for `lake`, unless a source
 * that has had a list there, by the published file or its history, has none.
 */
async function publish(lake: string): Promise<void> {
  // A restricted source with no restricted lake configured isn't in this one.
  const inLake = (metadata: SourceMetadata) => {
    try {
      return lakeOfSource(metadata) === lake;
    } catch {
      return false;
    }
  };
  const held = Object.values(sources).filter((s) => inLake(s.metadata));
  // A source the published file lists, or that has history, has had a list:
  // publishing without it would drop its stations.
  const published = new Set(await publishedSources(stationsPath(lake)));
  const expected: string[] = [];
  for (const { metadata } of held)
    if (published.has(metadata.id) || (await hasHistory(lake, metadata.id)))
      expected.push(metadata.id);
  // The issues are the errata; what was published last stands in for any that can't be read.
  const previous = fromPublished((await readJsonArray(errataPath(lake))) ?? []);
  const fetched = await openErrata(Object.keys(sources)).catch((error: Error) => error);
  const cited = new Set(citedIn(fileURLToPath(new URL("../src", import.meta.url))).keys());
  const { errata, notes } = settle(fetched, previous, cited);
  if (!(fetched instanceof Error))
    for (const u of fetched.unregistered)
      console.log(
        `  erratum #${u.issue} is for ${u.source}, which this build doesn't register: a typo, or a source still in a pull request; left out`,
      );
  if (!(fetched instanceof Error) && fetched.ignored.length)
    console.log(
      `  source-error issues not from a maintainer, left out: #${fetched.ignored.join(", #")}`,
    );
  const result = await publishStations(lake, held, expected, errata);
  if ("count" in result) {
    console.log(`${stationsPath(lake)}: ${result.count} stations`);
    const { pairs, dropped, skipped, large } = result.links;
    for (const [pair, counts] of Object.entries(pairs).sort())
      console.log(
        `  same_as ${pair}: ${Object.entries(counts)
          .map(([how, n]) => `${n} by ${how}`)
          .join(", ")}`,
      );
    for (const d of dropped) console.log(`  same_as dropped: ${d.from} to ${d.to}, ${d.reason}`);
    for (const k of skipped)
      console.log(`  same_as skipped: ${k.a} to ${k.b} by ${k.how}, ${k.reason}`);
    for (const group of large) console.log(`  same_as large group: ${group.join(" ")}`);
    for (const e of result.unknownErrata)
      console.error(`  erratum lists a station not in the lake: ${e}`);
    for (const n of notes) console.error(`  errata: ${n}`);
    // A typo in an erratum's issue tags nothing, so fail the run to say so,
    // after publishing: holding back every source's list for it would cost more.
    if (result.unknownErrata.length || notes.length) process.exitCode = 1;
  } else {
    console.error(
      `${stationsPath(lake)} not written: no list in the lake for ${result.missing.join(", ") || "any source"}`,
    );
    process.exitCode = 1;
  }
}

async function backfill(sourceId: string, ids: string, start: Date, end: Date): Promise<void> {
  const source = sourceOf(sourceId);
  const lake = lakeOfSource(source.metadata);
  const list = await listOf(lake, sourceId);
  // `preliminary` takes each station from its earliest preliminary value, active or not.
  let ranges: Map<string, [Date, Date]> | undefined;
  // Stations listed past the cutoff with nothing after it to fetch, whose value is cleared.
  let behind: string[] = [];
  let named: LakeStation[];
  const bounds = await readStationBounds(boundsPath(lake, sourceId));
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
        ? list.filter((s) => s.status === "active")
        : ids.split(",").map((id) => find(list, sourceId, id));
  // A station whose new epoch waits on a person gets nothing, in either datum.
  let wanted = named.filter((s) => {
    if (isHeld(s.epochs)) console.error(`  ${s.id}: held for a datum change; skipped`);
    return !isHeld(s.epochs);
  });
  if (values.shard && ids !== "all" && ids !== "preliminary")
    throw new Error("--shard splits `all` or `preliminary`, not named stations");
  // `preliminary` took its shard before picking stations, so the cutoff list is the shard's too.
  if (values.shard && ids === "all") wanted = shard(wanted, ...parseShard(values.shard));
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
  const save = () => {
    const found = preliminary;
    preliminary = new Map();
    saving = saving.then(async () => {
      if (!found.size) return;
      try {
        if (!(await writePreliminary(lake, sourceId, found)))
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
  const spansOf = (station: LakeStation) => {
    const [begin, until] = ranges?.get(station.id) ?? [start, end];
    return epochSpans(station.epochs, begin, until, source.metadata.archive);
  };
  // A source that blocks this client fails every request after, so the run
  // stops rather than go on through its stations.
  let stopped: Blocked | undefined;
  for (const batch of chunks(wanted, 100)) {
    if (stopped) break;
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
        await writePreliminary(lake, sourceId, lowered);
      } catch (error) {
        // Fetched unlowered, a killed run could leave these too late; they wait for the next run.
        fail(`bounds (skipped ${batch.length} stations)`, error);
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
          const ownEpoch = product === "levels" && epoch.id === current;
          try {
            const dir = seriesDir(
              lakeFor(station),
              product,
              station.source,
              station.source_id,
              epoch.id,
            );
            plan = await yearsToFetch(dir, since, until, mode, now);
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
            const label = `${station.id} ${product} ${from.getUTCFullYear()}${epoch.id === current ? "" : ` (epoch ${epoch.id})`}`;
            if (ownEpoch) fetched.add(station.id);
            try {
              const written = await backfillYear(source, station, product, from, to, epoch);
              if (written !== undefined) console.log(`${label}: ${written} rows`);
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
    });
    for (const [id, time] of prior)
      if (!fetched.has(id) && !preliminary.has(id)) preliminary.set(id, { preliminary: time });
    await save();
  }
  // Values set before any batch, such as the stations behind the cutoff.
  await save();
  const why = { written: "already written", complete: "already complete", none: "" }[mode];
  if (why) console.log(`${sourceId}: skipped ${skipped} years ${why}`);
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

/** Returns how many rows the year's file now holds, or undefined when nothing changed. */
async function backfillYear(
  source: Source,
  station: LakeStation,
  product: Product,
  from: Date,
  to: Date,
  epoch: Epoch,
): Promise<number | undefined> {
  // The epoch's own datum, which a closed epoch keeps when the station's moves on.
  station = { ...station, datum: epoch.datum };
  const path = seriesPath(
    lakeFor(station),
    product,
    station.source,
    station.source_id,
    from.getUTCFullYear(),
    epoch.id,
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
    if (product === "levels") rows = qc(withSourceFlag(rows), qcFor(source, station));
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
 * A source registered since the last Monthly refresh has no list yet, so the
 * scheduled jobs that pick it up have nothing to do until that refresh starts it.
 */
async function notStarted(sourceId: string): Promise<void> {
  const note = `${sourceId}: no station list yet; the Monthly workflow starts it, or dispatch Monthly with \`sources: ${sourceId}\` to start it now`;
  console.log(note);
  // On a run's page too, so a lake that lost everything doesn't pass unseen.
  if (process.env.GITHUB_ACTIONS) console.log(`::warning title=No station list::${note}`);
  const page = process.env.GITHUB_STEP_SUMMARY;
  if (page) await appendFile(page, `${note}\n`);
}

async function recent(sourceId: string): Promise<void> {
  const now = Date.now();
  const source = sourceOf(sourceId);
  const stations = await startedListOf(lakeOfSource(source.metadata), sourceId);
  if (!stations) return await notStarted(sourceId);
  const summary = await reporting(`recent ${sourceId}`, async () => {
    const [hours, keepDays] = [positive("hours"), positive("keep-days")];
    return updateRecent({
      source,
      stations,
      lakeFor,
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
  const started = await startedListOf(lakeOfSource(source.metadata), sourceId);
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
      lakeFor,
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
function positive(name: "concurrency" | "hours" | "keep-days"): number {
  const value = Number(values[name]);
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`--${name} must be a whole number of at least 1`);
  return value;
}

/** A station by its ID or its source's own code. */
function find(list: LakeStation[], sourceId: string, id: string): LakeStation {
  const station = list.find((s) => s.id === id || s.id === `${sourceId}/${id}`);
  if (!station) throw new Error(`No station ${id} in ${sourceId}'s list`);
  return station;
}

function parseDate(value: string): Date {
  const date = new Date(/^\d{4}$/.test(value) ? `${value}-01-01T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${value}`);
  return date;
}

function usage(): never {
  console.error(
    "usage: ingest.ts stations [source...] [--accept-epochs] [--no-publish] | publish | backfill <source> <station,...|all|preliminary> <start> <end> [--first FILE] [--shard I/N] [--refetch | --skip-written] [--skip-unscreened] | recent <source> [--hours N] [--keep-days N] | compact <source> [--days N] [--rebuild-bounds]",
  );
  process.exit(1);
}
