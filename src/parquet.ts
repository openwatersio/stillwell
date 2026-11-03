import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import type { Extreme, Sample, TransitExtreme } from "./types.ts";

/**
 * Write samples as Parquet with columns `time` (UTC), `level_m` and, for
 * extremes, `type` (`high` or `low`), plus `transit` and `event` where the source
 * gives them. Rows are sorted by time.
 */
export async function writeParquet(
  path: string,
  rows: (Sample | Extreme | TransitExtreme)[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const instance = await DuckDBInstance.create(":memory:");
  const connection = await instance.connect();
  try {
    await connection.run("SET TimeZone = 'UTC'");
    await connection.run(
      "CREATE TABLE rows (time_ms DOUBLE, level_m FLOAT, type VARCHAR, transit INTEGER, event UTINYINT)",
    );
    const appender = await connection.createAppender("rows");
    for (const row of rows) {
      appender.appendDouble(row.time);
      appender.appendFloat(row.level);
      if ("type" in row) appender.appendVarchar(row.type);
      else appender.appendNull();
      if ("transit" in row) {
        appender.appendInteger(row.transit);
        appender.appendUTinyInt(row.event);
      } else {
        appender.appendNull();
        appender.appendNull();
      }
      appender.endRow();
    }
    appender.closeSync();
    const hasType = rows.some((r) => "type" in r);
    const hasTransit = rows.some((r) => "transit" in r);
    const columns = [
      "epoch_ms(time_ms::BIGINT)::TIMESTAMPTZ AS time",
      "level_m",
      ...(hasType ? ["type"] : []),
      ...(hasTransit ? ["transit", "event"] : []),
    ];
    await connection.run(
      `COPY (SELECT ${columns.join(", ")} FROM rows ORDER BY time_ms) TO '${path.replaceAll("'", "''")}' (FORMAT parquet, COMPRESSION zstd)`,
    );
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}
