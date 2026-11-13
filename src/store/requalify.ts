import { availableParallelism, totalmem } from "node:os";
import { Worker } from "node:worker_threads";
import { fromSource, nearContext, qc, withSourceFlag, type QcOptions } from "../qc.ts";
import { Flag, Unjudged, type StoredStation, type Observation, type Source } from "../schema.ts";
import { mergeFetched, sameRows } from "./merge.ts";
import {
  listYears,
  readDatums,
  readObservationFile,
  writeObservations,
  type YearStats,
} from "./parquet.ts";
import { seriesDir } from "./paths.ts";
import { qcFor } from "./recent.ts";

/**
 * Work a station's flags out again from what the store holds, without asking
 * the source: each year file of levels from `start` to before `end`, in every
 * epoch, starts over from its `source_flag` and the source's errata spans
 * (`fromSource`), then QC runs with the current rules, judged with the years
 * either side, and the file is written only when a row changed, its stats
 * going in `written` by path. Returns the files written and the rows whose
 * flag changed.
 */
export async function requalify(
  source: Source,
  station: StoredStation,
  root: string,
  start: number,
  end: number,
  written = new Map<string, YearStats>(),
): Promise<{ files: number; changed: number; warnings: string[] }> {
  // Every epoch's datums and errata spans first, so a file to resolve by hand,
  // or a source's error, stops the station before any is written.
  const plans = [];
  const warnings: string[] = [];
  for (const epoch of station.epochs) {
    const dir = seriesDir(root, "levels", station.source, station.source_id, epoch.id);
    const years = [...(await listYears(dir))].sort((a, b) => a - b);
    const wanted = years.filter((y) => y >= start && y < end);
    if (!wanted.length) continue;
    const path = (year: number) => `${dir}/${year}.parquet`;
    for (const year of wanted) {
      const datums = await readDatums(path(year));
      if (datums.length !== 1)
        throw new Error(`${path(year)} holds ${datums.join(", ") || "no datum"}; resolve by hand`);
    }
    // A record the source can't judge keeps the flags it has, since some may be
    // the source's spans worked out when they were fetched, as GESLA's datum
    // jumps are from its whole file; it gets the spans the source can still
    // give, and a warning.
    let unjudged = false;
    const suspect =
      (await source
        .suspect?.(station, async function* () {
          for (const year of years) yield (await readObservationFile(path(year))).rows;
        })
        .catch((error: unknown) => {
          if (!(error instanceof Unjudged)) throw error;
          unjudged = true;
          warnings.push(`epoch ${epoch.id}: ${error.message}; its flags are kept`);
          return error.spans;
        })) ?? [];
    plans.push({ years, wanted, path, suspect, unjudged });
  }
  const opts = qcFor(station);
  let files = 0;
  let changed = 0;
  for (const { years, wanted, path, suspect, unjudged } of plans) {
    // Each year once, and only the three a step needs.
    const cache = new Map<number, Promise<{ rows: Observation[]; datums: string[] }>>();
    const read = (year: number) => {
      if (!cache.has(year))
        cache.set(
          year,
          years.includes(year)
            ? readObservationFile(path(year))
            : Promise.resolve({ rows: [], datums: [] }),
        );
      return cache.get(year)!;
    };
    for (const year of wanted) {
      for (const y of cache.keys()) if (y < year - 1) cache.delete(y);
      const [{ rows: had, datums }, before, after] = await Promise.all([
        read(year),
        read(year - 1),
        read(year + 1),
      ]);
      // writeObservations stamps one datum on every row; the check above is only as fresh as its read.
      if (datums.length !== 1)
        throw new Error(`${path(year)}'s datums changed while requalify ran`);
      // Kept flags can only get worse, so a looser rule doesn't clear a mark there.
      const start = unjudged ? withSpans(had, suspect) : fromSource(had, suspect);
      const next = qc(start, opts, nearContext(start, opts, [...before.rows, ...after.rows]));
      // From here this year is only the next one's context, so only the part qc sees stays in memory.
      cache.set(year, Promise.resolve({ rows: nearContext(after.rows, opts, had), datums }));
      if (sameRows(had, next)) continue;
      const flags = new Map(had.map((r) => [r.time, r.flag]));
      changed += next.filter((r) => flags.get(r.time) !== r.flag).length;
      written.set(path(year), await writeObservations(path(year), next, datums[0]!));
      files++;
    }
  }
  return { files, changed, warnings };
}

/** A worker thread and the stations it's requalifying, by task ID. */
interface Pooled {
  worker: Worker;
  tasks: Map<
    number,
    {
      written: Map<string, YearStats>;
      resolve: (result: Awaited<ReturnType<typeof requalify>>) => void;
      reject: (error: unknown) => void;
    }
  >;
}

const pool: Pooled[] = [];
let tasks = 0;

/**
 * `requalify` in a worker thread, so stations' QC, which is CPU-bound and
 * would otherwise take turns on the one main thread, runs side by side: a
 * worker per core at most (`availableParallelism`), each station going to the
 * least busy, so calls beyond that share a worker and its reads still overlap.
 * The worker gets the source by its ID, and has its own copy of each module,
 * such as its own DuckDB. Each file's stats reach `written` as it's written.
 * A worker that dies fails the stations it holds with `WorkerDied`, which the
 * caller keeps marked in the years file, since it may have written a file it
 * couldn't report. With @duckdb/node-api 2.0.0-r.1, terminating a worker
 * whose DuckDB has started aborts the whole process, as running out of memory
 * did on one thread, and so does the process ending while a worker's DuckDB
 * is starting or working, which the worker waits out for its own station
 * (`settled`); the run's
 * years marks then stay for the next reconcile too.
 */
export function requalifyInWorker(
  source: string,
  station: StoredStation,
  root: string,
  start: number,
  end: number,
  written = new Map<string, YearStats>(),
): Promise<Awaited<ReturnType<typeof requalify>>> {
  let pooled = pool.reduce<Pooled | undefined>(
    (a, b) => (a && a.tasks.size <= b.tasks.size ? a : b),
    undefined,
  );
  if (!pooled || (pooled.tasks.size && pool.length < availableParallelism())) pooled = spawn();
  const id = tasks++;
  const { worker } = pooled;
  return new Promise((resolve, reject) => {
    pooled.tasks.set(id, { written, resolve, reject });
    // Only a busy worker keeps the process alive.
    worker.ref();
    worker.postMessage({ id, source, station, root, start, end });
  });
}

function spawn(): Pooled {
  // The machine's memory, less the workers' DuckDB, split between the workers
  // and the main thread, so a worker collects garbage rather than grow until
  // they don't fit together. A year of 1-minute values needs about 500 MB of
  // heap; on a small machine with many cores the floor can overcommit. A worker
  // past it ends the run (see `requalifyInWorker`).
  const limit = process.constrainedMemory();
  const memory = limit > 0 && limit < totalmem() ? limit : totalmem();
  const cores = availableParallelism();
  const share = (memory / 2 ** 20 - cores * DUCKDB_MB) / (cores + 1);
  const worker = new Worker(new URL("./requalify-worker.ts", import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: Math.max(1024, Math.floor(share)) },
  });
  const pooled: Pooled = { worker, tasks: new Map() };
  pool.push(pooled);
  worker.on("message", (message: Reply) => {
    const task = pooled.tasks.get(message.id);
    if (!task) return;
    if ("written" in message) {
      task.written.set(...message.written);
      return;
    }
    pooled.tasks.delete(message.id);
    if (!pooled.tasks.size) worker.unref();
    if ("error" in message) task.reject(new Error(message.error));
    else task.resolve(message.result);
  });
  // An error is followed by an exit; either fails the worker's stations, and the next call starts another.
  const die = (error: Error) => {
    if (pool.includes(pooled)) pool.splice(pool.indexOf(pooled), 1);
    for (const task of pooled.tasks.values()) task.reject(new WorkerDied(error.message));
    pooled.tasks.clear();
  };
  worker
    .on("error", die)
    .on("exit", (code) => die(new Error(`requalify's worker exited with ${code}`)));
  return pooled;
}

/**
 * A station failed because its worker died, as on running out of memory,
 * which may have written a file without reporting it.
 */
export class WorkerDied extends Error {}

/** The memory each worker's DuckDB may use, in MB. */
export const DUCKDB_MB = 1024;

/** What a worker sends: a file's stats as it's written, then the station's result or error. */
export type Reply = { id: number } & (
  | { written: [string, YearStats] }
  | { result: Awaited<ReturnType<typeof requalify>> }
  | { error: string }
);

/** Rows with the values in `spans` flagged at least `suspect`, keeping every other flag. */
function withSpans(rows: Observation[], spans: [number, number][]): Observation[] {
  return rows.map((r) =>
    spans.some(([from, to]) => r.time >= from && r.time < to)
      ? {
          ...r,
          flag: Math.max(r.flag, Flag.suspect) as Flag,
          // A suspect or bad flag from before `source_flag` was kept may be QC's, as `fromSource` knows.
          source_flag: r.source_flag ?? (r.flag < Flag.suspect ? r.flag : undefined),
        }
      : r,
  );
}

/**
 * Backfill's fetched levels merged into the year they're written to, then the
 * whole year QC'd with `context` from the years either side, as requalify
 * does, so a partial fetch is judged against the same medians and spreads.
 * What it didn't fetch keeps its flag, since only requalify knows a source's
 * errata spans over the whole record.
 */
export function judgeFetched(
  existing: Observation[],
  fetched: Observation[],
  start: number,
  end: number,
  opts: QcOptions,
  context: Observation[],
): Observation[] {
  const merged = mergeFetched(existing, withSourceFlag(fetched), start, end);
  const times = new Set(fetched.map((r) => r.time));
  const stored = new Map(existing.map((r) => [r.time, r.flag]));
  return qc(merged, opts, context).map((r) =>
    times.has(r.time) ? r : { ...r, flag: stored.get(r.time) ?? r.flag },
  );
}
