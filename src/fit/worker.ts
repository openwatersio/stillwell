import { parentPort } from "node:worker_threads";
import { connected, limitDuckDb, settled } from "../store/parquet.ts";
import { fitStation } from "./fit.ts";
import { DUCKDB_MB, type Reply, type Task } from "./workers.ts";
import { Busy } from "./series.ts";

// A worker fits one station at a time, and its DuckDB only reads hourly values of one year file at once.
limitDuckDb({ threads: "1", memory_limit: `${DUCKDB_MB}MB` });

const post = (reply: Reply) => parentPort!.postMessage(reply);

parentPort!.on("message", async ({ id, station, context }: Task) => {
  // Not done while DuckDB is starting or working, or the process could end with it.
  try {
    const result = await fitStation(station, { ...context, years: new Map(context.years) });
    await connected();
    post({ id, result });
  } catch (error) {
    await settled();
    const message = error instanceof Error ? error.message : String(error);
    post(error instanceof Busy ? { id, busy: message } : { id, error: message });
  }
});
