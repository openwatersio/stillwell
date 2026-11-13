import { parentPort } from "node:worker_threads";
import { sourceOf } from "../sources/index.ts";
import type { StoredStation } from "../schema.ts";
import { limitDuckDb, setConnections, type YearStats } from "./parquet.ts";
import { DUCKDB_MB, requalify, type Reply } from "./requalify.ts";

// A worker can hold a few stations at once, each reading three years together;
// every worker's lanes share the process's libuv pool (scripts/threadpool.ts).
setConnections(4);
// Each worker has its own DuckDB, which by default takes every core and most of the memory.
limitDuckDb({ threads: "2", memory_limit: `${DUCKDB_MB}MB` });

const post = (reply: Reply) => parentPort!.postMessage(reply);

parentPort!.on(
  "message",
  async ({
    id,
    source,
    station,
    root,
    start,
    end,
  }: {
    id: number;
    source: string;
    station: StoredStation;
    root: string;
    start: number;
    end: number;
  }) => {
    // Each file's stats go back as it's written, so they arrive even if the worker then dies.
    const written = new (class extends Map<string, YearStats> {
      override set(path: string, stats: YearStats) {
        post({ id, written: [path, stats] });
        return this;
      }
    })();
    try {
      post({ id, result: await requalify(sourceOf(source), station, root, start, end, written) });
    } catch (error) {
      post({ id, error: error instanceof Error ? error.message : String(error) });
    }
  },
);
