/**
 * What the calibration scripts share: the local copy of the store they read,
 * the worker threads that fit one station at a time, and the pair of files
 * each writes. A calibration never writes to the store.
 */
import { existsSync, realpathSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { parentPort, Worker } from "node:worker_threads";
import type { Erratum } from "../src/errata.ts";
import { checkCopy } from "../src/fit/calibration.ts";
import { engineVersion } from "../src/fit/fit.ts";
import { finalYear } from "../src/fit/series.ts";
import { DUCKDB_MB, HEAP_MB, workerCount } from "../src/fit/workers.ts";
import { listOf } from "../src/refresh.ts";
import type { Source, StoredStation } from "../src/schema.ts";
import { errata, sourceOf } from "../src/sources/index.ts";
import { connected, limitDuckDb, settled } from "../src/store/parquet.ts";
import { pool } from "../src/store/recent.ts";
import { STORE } from "../src/store/stores.ts";
import { readYears, type YearRow } from "../src/store/years.ts";

/** A source as a calibration reads it from the copy. */
export interface Copy {
  store: string;
  source: Source;
  list: StoredStation[];
  /** The copy's years file as it is, markers included, for `checkCopy`. */
  all: Map<string, YearRow>;
  /** Its rows without the markers, as a worker's context takes them. */
  years: [string, YearRow][];
  /** Stations the copy marks as being written. */
  marked: Set<string>;
  /** The source's last year of final values. */
  final: number;
  now: Date;
  engine: string;
  errata: Omit<Erratum, "check">[];
}

/**
 * The copy of the store `STILLWELL_STORE` names, for one source. A station
 * being written is refused by the fits' reader, and a calibration drops that
 * marker once `checkCopy` has shown the station's rows describe its files,
 * which is sound only on a copy nothing is writing to, and so never on a URL
 * or the checkout's own `data`. A marked station votes for no final year, and
 * the store's own fits wait while any is marked, so the year is taken only
 * where it is the same whether the marked stations' rows vote or not.
 */
export async function openCopy(sourceId: string): Promise<Copy> {
  if (
    !process.env.STILLWELL_STORE ||
    /^[a-z0-9]+:\/\//i.test(STORE) ||
    !existsSync(STORE) ||
    !statSync(STORE).isDirectory() ||
    (existsSync("data") && realpathSync(STORE) === realpathSync("data")) ||
    resolve(STORE) === resolve("data")
  )
    throw new Error(
      `STILLWELL_STORE must name a local copy of the store, a directory other than the checkout's own \`data\`; it is ${process.env.STILLWELL_STORE ?? "not set"}`,
    );
  const source = sourceOf(sourceId);
  const list = await listOf(STORE, source);
  const all = await readYears(STORE, sourceId);
  if (!all) throw new Error(`${STORE} has no years file for ${sourceId}`);
  const marked = new Set(
    [...all.values()].filter((r) => r.epoch === null || r.year === null).map((r) => r.id),
  );
  const now = new Date();
  const qcStarts = new Map(
    list.flatMap((s) =>
      s.source_qc_start ? [[s.id, Date.parse(s.source_qc_start)] as const] : [],
    ),
  );
  const final = finalYear(source.metadata, all, now, qcStarts);
  const unmarked = new Map([...all].filter(([, r]) => r.epoch !== null && r.year !== null));
  if (finalYear(source.metadata, unmarked, now, qcStarts) !== final)
    throw new Error(
      `${sourceId}'s last year of final values depends on the stations the copy marks as being written; copy the years file again once they are done`,
    );
  return {
    store: STORE,
    source,
    list,
    all,
    years: [...unmarked],
    marked,
    final,
    now,
    engine: engineVersion(),
    errata: errata.map(({ check: _, ...erratum }) => erratum),
  };
}

/** The copy's station of this ID, with its files checked against the copy's years file. */
export async function stationOf(copy: Copy, id: string): Promise<StoredStation> {
  const station = copy.list.find((s) => s.id === id);
  if (!station) throw new Error(`${copy.store} lists no ${id}`);
  await checkCopy(copy.store, station, copy.all);
  return station;
}

/** `--concurrency` as a whole number from 1 to the number of stations. */
export function concurrencyOf(value: string, stations: number): number {
  const concurrency = Number(value);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > stations)
    throw new Error(`--concurrency is a whole number from 1 to ${stations}`);
  return concurrency;
}

type Reply<R> = { result: R } | { error: string };

/** A worker's side: `calibrate` one station at a time, as `src/fit/worker.ts` fits one. */
export function work<T, R>(calibrate: (task: T) => Promise<R>): void {
  limitDuckDb({ threads: "1", memory_limit: `${DUCKDB_MB}MB` });
  parentPort!.on("message", async (task: T) => {
    let reply: Reply<R>;
    try {
      reply = { result: await calibrate(task) };
      await connected();
    } catch (error) {
      await settled();
      reply = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
    }
    parentPort!.postMessage(reply);
  });
}

/**
 * Runs `tasks` on worker threads of `script`, `concurrency` at once at most,
 * and returns each station's result by its ID. Checks each station's files
 * against the copy again afterwards, since a file rewritten while the fits
 * ran would have been read against a row that no longer describes it. Exits
 * without a result where any station fails, so no report is of some stations.
 */
export async function inWorkers<T extends { station: StoredStation }, R>(
  script: URL,
  copy: Copy,
  tasks: T[],
  concurrency: number,
): Promise<Map<string, R>> {
  const queue = [...tasks];
  const results = new Map<string, R>();
  const failed: string[] = [];
  const lanes = workerCount(concurrency);
  await pool(
    Array.from({ length: lanes }, (_, i) => i),
    lanes,
    async () => {
      const worker = new Worker(script, { resourceLimits: { maxOldGenerationSizeMb: HEAP_MB } });
      // One set of listeners for the worker's life: whichever station it is on gets the answer.
      let answer: (reply: Reply<R>) => void = () => {};
      let gone: string | undefined;
      const end = (why: string) => {
        gone = why;
        answer({ error: why });
      };
      worker
        .on("message", (reply: Reply<R>) => answer(reply))
        .on("error", (error) => end(String(error)))
        .on("exit", (code) => end(`the worker exited with ${code}`));
      for (let task = queue.shift(); task; task = queue.shift()) {
        const id = task.station.id;
        const started = Date.now();
        const sent = task;
        // A worker that ended between stations would never answer the next one.
        const reply = await new Promise<Reply<R>>((answered) => {
          answer = answered;
          if (gone) answered({ error: gone });
          else worker.postMessage(sent);
        });
        if ("error" in reply) {
          failed.push(`${id}: ${reply.error}`);
          console.error(`${id}: ${reply.error}`);
          // Nothing is written once a station fails, so the other lanes take no more.
          queue.length = 0;
          break;
        }
        results.set(id, reply.result);
        console.error(`${id}: fitted in ${Math.round((Date.now() - started) / 1000)} s`);
      }
    },
  );
  for (const id of results.keys())
    await checkCopy(
      copy.store,
      copy.list.find((s) => s.id === id)!,
      copy.all,
    );
  if (failed.length || results.size !== tasks.length) {
    console.error(`${failed.length} stations failed; nothing written`);
    process.exit(1);
  }
  return results;
}

/** Numbers to a micrometer or a millionth of a degree, so a results file doesn't carry the noise below them. */
export function rounded(_: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isInteger(value)
    ? Math.round(value * 1e6) / 1e6
    : value;
}

/** Writes a report's JSON and Markdown, both beside their places first, so a write that fails leaves the pair as it was. */
export async function writePair(
  jsonPath: string,
  json: string,
  reportPath: string,
  markdown: string,
): Promise<void> {
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(`${jsonPath}.tmp`, json);
  await writeFile(`${reportPath}.tmp`, markdown);
  await rename(`${jsonPath}.tmp`, jsonPath);
  await rename(`${reportPath}.tmp`, reportPath);
}
