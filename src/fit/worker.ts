import { parentPort } from "node:worker_threads";
import { connected, limitDuckDb, settled } from "../store/parquet.ts";
import { reduceDatums } from "./datums.ts";
import { fitStation, scoreReferences } from "./fit.ts";
import { DUCKDB_MB, type Reply, type Task } from "./workers.ts";
import { Busy } from "./series.ts";

// A worker fits, scores or reduces one station at a time, and its DuckDB reads one year file at once.
limitDuckDb({ threads: "1", memory_limit: `${DUCKDB_MB}MB` });

const post = (reply: Reply) => parentPort!.postMessage(reply);

parentPort!.on("message", async ({ id, station, context, score, datums }: Task) => {
  // Not done while DuckDB is starting or working, or the process could end with it.
  try {
    const full = { ...context, years: new Map(context.years) };
    const result = score
      ? await scoreReferences(station, score.fit, score.constants, full)
      : datums
        ? await reduceDatums(station, datums.fit, datums.constants, full)
        : await fitStation(station, full);
    await connected();
    post({ id, result });
  } catch (error) {
    await settled();
    const message = error instanceof Error ? error.message : String(error);
    post(error instanceof Busy ? { id, busy: message } : { id, error: message });
  }
});
