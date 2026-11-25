import { availableParallelism, totalmem } from "node:os";
import { Worker } from "node:worker_threads";
import type { StoredStation } from "../schema.ts";
import type { YearRow } from "../store/years.ts";
import type { fitStation, FitContext } from "./fit.ts";
import { Busy } from "./series.ts";

/**
 * Fits on worker threads. A fit is two minutes of computation on one core, so
 * a source's stations are fitted on as many threads as the run is given, each
 * taking one station at a time and sending its rows back. The main thread
 * keeps the files.
 */

type Result = Awaited<ReturnType<typeof fitStation>>;

/** What a worker is sent: a station and its context as plain data, the years file as its entries. */
export interface Task {
  id: number;
  station: StoredStation;
  context: Omit<FitContext, "years"> & { years: [string, YearRow][] };
}

/** What a worker sends back: the station's rows, that its year files are being written, or an error. */
export type Reply = { id: number } & ({ result: Result } | { busy: string } | { error: string });

/** The memory each worker's DuckDB may use, in MB. */
export const DUCKDB_MB = 512;
/** A worker's heap, in MB: a 19-year fit peaks near 600 MB. */
const HEAP_MB = 2048;

/**
 * A station failed because its worker ended before answering. A worker past
 * its heap once its DuckDB has started takes the whole process with it, as
 * requalify's does (`src/store/requalify.ts`), so this covers a worker that
 * failed to start or threw outside a fit.
 */
export class WorkerDied extends Error {}

interface Pooled {
  worker: Worker;
  task?: { resolve: (result: Result) => void; reject: (error: Error) => void };
}
const pool: Pooled[] = [];
let tasks = 0;

function spawn(): Pooled {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: HEAP_MB },
  });
  const pooled: Pooled = { worker };
  pool.push(pooled);
  // Only a busy worker keeps the process alive.
  worker.unref();
  worker.on("message", (message: Reply) => {
    const task = pooled.task;
    if (!task) return;
    pooled.task = undefined;
    worker.unref();
    if ("result" in message) task.resolve(message.result);
    else if ("busy" in message) task.reject(new Busy(message.busy));
    else task.reject(new Error(message.error));
  });
  // An error is followed by an exit; either fails the worker's station, and the next call starts another.
  const die = (error: Error) => {
    if (pool.includes(pooled)) pool.splice(pool.indexOf(pooled), 1);
    pooled.task?.reject(new WorkerDied(error.message));
    pooled.task = undefined;
  };
  worker
    .on("error", die)
    .on("exit", (code) => die(new Error(`a fit's worker exited with ${code}`)));
  return pooled;
}

/**
 * How many stations `concurrency` fits at once: no more than the machine has
 * cores, or memory for each worker's heap and DuckDB together.
 */
export function workerCount(concurrency: number): number {
  const limit = process.constrainedMemory();
  const memory = limit > 0 && limit < totalmem() ? limit : totalmem();
  const fit = Math.floor(memory / 2 ** 20 / (HEAP_MB + DUCKDB_MB));
  return Math.max(1, Math.min(Math.floor(concurrency), availableParallelism(), fit));
}

/**
 * `fitStation` on a worker thread that isn't fitting, starting one where none
 * is free. The caller runs no more of these at once than `workerCount` allows.
 * Rejects with `Busy` as `fitStation` throws it, and with `WorkerDied` where
 * the worker ended before answering.
 */
export function fitInWorker(station: StoredStation, context: FitContext): Promise<Result> {
  const pooled = pool.find((p) => !p.task) ?? spawn();
  const id = tasks++;
  return new Promise((resolve, reject) => {
    pooled.task = { resolve, reject };
    pooled.worker.ref();
    // An erratum's check is a function, which a message can't carry and a fit doesn't use.
    const errata = context.errata.map(({ check: _, ...erratum }) => erratum);
    const task: Task = { id, station, context: { ...context, errata, years: [...context.years] } };
    try {
      pooled.worker.postMessage(task);
    } catch (error) {
      // A task that can't be sent leaves the worker free, and idle for the process to end.
      pooled.task = undefined;
      pooled.worker.unref();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
