// Framework ships DuckDB-WASM 1.29 (DuckDB 1.1); pages import this `sql` instead to run a current DuckDB.
import * as duckdb from "npm:@duckdb/duckdb-wasm@1.32.0";

const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
const worker = new Worker(
  URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
  ),
);
const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
// As Framework's own client does: JavaScript numbers rather than BigInts.
await db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } });
const connection = await db.connect();
await connection.query("SET TimeZone = 'UTC'");

// DuckDB-WASM binds only strings, numbers, booleans and null, so lists and dates go into the text as quoted literals.
export function literal(value) {
  if (Array.isArray(value)) return `[${value.map(literal).join(", ")}]`;
  if (value instanceof Date) return literal(value.toISOString());
  if (typeof value === "string") return `'${value.replaceAll("'", "''")}'`;
  return String(value);
}

// Arrow's Timestamp type; the store's times are TIMESTAMPTZ, which arrive as epoch milliseconds.
const TIMESTAMP = 10;

/** Rows as plain objects, with timestamps as Dates. */
function rows(table) {
  const times = table.schema.fields.filter((f) => f.type.typeId === TIMESTAMP).map((f) => f.name);
  return table.toArray().map((row) => {
    const o = row.toJSON();
    for (const k of times) if (o[k] != null) o[k] = new Date(Number(o[k]));
    return o;
  });
}

/** Run a query, with ${…} values bound as parameters, and return its rows. */
export async function sql(strings, ...values) {
  let text = strings[0];
  const params = [];
  values.forEach((value, i) => {
    if (Array.isArray(value) || value instanceof Date) text += literal(value);
    else ((text += "?"), params.push(value));
    text += strings[i + 1];
  });
  if (!params.length) return rows(await connection.query(text));
  const statement = await connection.prepare(text);
  try {
    return rows(await statement.query(...params));
  } finally {
    await statement.close();
  }
}
