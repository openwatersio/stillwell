// DuckDB in the browser, served with the site rather than from a CDN. Only the query page loads it.
import * as duckdb from "@duckdb/duckdb-wasm";
import mvpWasm from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import ehWasm from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

// Arrow's Timestamp type; the store's times are TIMESTAMPTZ, which arrive as epoch milliseconds.
const TIMESTAMP = 10;
// Arrow's Date type, which arrives as epoch milliseconds too.
const DATE = 8;
// Arrow's Float type; precision 1 is single precision, the store's levels.
const FLOAT = 3;

let connection: Promise<duckdb.AsyncDuckDBConnection> | undefined;

function connect() {
  connection ??= (async () => {
    const bundle = await duckdb.selectBundle({
      mvp: { mainModule: mvpWasm, mainWorker: mvpWorker },
      eh: { mainModule: ehWasm, mainWorker: ehWorker },
    });
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(bundle.mainWorker!));
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
    const c = await db.connect();
    await c.query("SET TimeZone = 'UTC'");
    return c;
  })();
  return connection;
}

/** Run SQL and return its rows as plain objects, with timestamps as Dates. */
export async function query(sql: string): Promise<Record<string, any>[]> {
  const table = await (await connect()).query(sql);
  const times = table.schema.fields.filter((f) => f.type.typeId === TIMESTAMP).map((f) => f.name);
  const dates = table.schema.fields.filter((f) => f.type.typeId === DATE).map((f) => f.name);
  const singles = table.schema.fields
    .filter((f) => f.type.typeId === FLOAT && (f.type as any).precision === 1)
    .map((f) => f.name);
  return table.toArray().map((row) => {
    const o = row.toJSON();
    for (const k of times) if (o[k] != null) o[k] = new Date(Number(o[k]));
    for (const k of dates)
      if (o[k] != null) o[k] = new Date(Number(o[k])).toISOString().slice(0, 10);
    // A 32-bit level such as 1.68 widens to 1.6799999475479126; seven significant digits is what it stores.
    for (const k of singles) if (o[k] != null) o[k] = Number(o[k].toPrecision(7));
    return o;
  });
}

export async function version(): Promise<string> {
  return (await query("SELECT version() AS v"))[0].v;
}
