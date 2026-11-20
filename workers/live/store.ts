// The live store's endpoint: D1's `live` and `polls` tables (schema.sql) and the daily files on R2, which the poller's
// container reaches at http://store.internal through its outbound handler (index.ts), so it holds no D1 token or
// R2 key. The client is liveStore in src/realtime/live.ts.

import type { LiveCell, PollRow } from "./types.ts";

export interface StoreEnv {
  LIVE: D1Database;
  STORE: R2Bucket;
}

/** D1 binds at most 100 parameters to a statement. */
const PARAMS = 90;

export const dayOf = (time: number): string => new Date(time).toISOString().slice(0, 10);

/** `source`'s station IDs sort between `<source>/` and `<source>0`, since `0` follows `/`. */
const range = (source: string): [string, string] => [`${source}/`, `${source}0`];

export async function handleStore(request: Request, env: StoreEnv): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (request.method === "PUT" && url.pathname.startsWith("/files/")) {
      const key = decodeURIComponent(url.pathname.slice("/files/".length));
      // The poller writes only the daily files.
      if (!/^recent\/[a-z0-9-]+\/\d{4}-\d{2}-\d{2}\.parquet$/.test(key))
        return json({ error: `not a daily file: ${key}` }, 400);
      await env.STORE.put(key, request.body);
      return json({ ok: true });
    }
    if (request.method === "GET" && url.pathname === "/stations")
      return json({ stations: await stations(env.LIVE, url.searchParams.get("source") ?? "") });
    if (request.method !== "POST") return json({ error: "not found" }, 404);
    const body = (await request.json()) as Record<string, unknown>;
    switch (url.pathname) {
      case "/read":
        return json({ rows: await read(env.LIVE, body.stations as string[], body.from as number) });
      case "/write":
        await write(env.LIVE, body.rows as [string, LiveCell][]);
        return json({ ok: true });
      case "/remove":
        await remove(env.LIVE, body.values as { station: string; time: number }[]);
        return json({ ok: true });
      case "/remove-stations":
        await removeStations(env.LIVE, body.stations as string[]);
        return json({ ok: true });
      case "/polls":
        await insertPoll(env.LIVE, body as unknown as PollRow);
        return json({ ok: true });
      case "/day":
        return json(
          await day(
            env.LIVE,
            body.source as string,
            body.day as string,
            body.after as string,
            body.limit as number,
          ),
        );
    }
    return json({ error: "not found" }, 404);
  } catch (error) {
    return json({ error: (error as Error).message }, 500);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Each named station's values from `from` on, as [station, cells] sorted by station and time. */
export async function read(
  db: D1Database,
  stations: string[],
  from: number,
): Promise<[string, LiveCell[]][]> {
  const since = dayOf(from);
  const results = await batch(
    db,
    chunks(stations, PARAMS).map((part) =>
      db
        .prepare(
          `SELECT station, rows FROM live WHERE station IN (${part.map(() => "?").join(",")}) AND day >= ?
           ORDER BY station, day`,
        )
        .bind(...part, since),
    ),
  );
  const out = new Map<string, LiveCell[]>();
  for (const { station, rows } of results.flat() as { station: string; rows: string }[]) {
    const cells = (JSON.parse(rows) as LiveCell[]).filter((c) => c[1] >= from);
    const list = out.get(station);
    if (list) list.push(...cells);
    else out.set(station, cells);
  }
  return [...out].sort(([a], [b]) => (a < b ? -1 : 1));
}

/** The station-days the given keys name, as `station day` → cells. */
async function current(db: D1Database, keys: [string, string][]): Promise<Map<string, LiveCell[]>> {
  const results = await batch(
    db,
    chunks(keys, PARAMS / 2).map((part) =>
      db
        .prepare(
          `SELECT station, day, rows FROM live WHERE (station, day) IN (VALUES ${part.map(() => "(?, ?)").join(",")})`,
        )
        .bind(...part.flat()),
    ),
  );
  return new Map(
    (results.flat() as { station: string; day: string; rows: string }[]).map((r) => [
      `${r.station} ${r.day}`,
      JSON.parse(r.rows) as LiveCell[],
    ]),
  );
}

/** Write each station-day's cells back, deleting a station-day left with none. */
async function save(db: D1Database, days: Map<string, LiveCell[]>): Promise<void> {
  const statements = [...days].map(([key, cells]) => {
    const [station, day] = key.split(" ") as [string, string];
    return cells.length
      ? db
          .prepare(
            "INSERT INTO live (station, day, rows) VALUES (?, ?, ?) ON CONFLICT (station, day) DO UPDATE SET rows = excluded.rows",
          )
          .bind(station, day, JSON.stringify(cells.sort((a, b) => a[1] - b[1])))
      : db.prepare("DELETE FROM live WHERE station = ? AND day = ?").bind(station, day);
  });
  for (const part of chunks(statements, 100)) await db.batch(part);
}

function keysOf(items: { station: string; time: number }[]): [string, string][] {
  const keys = new Map<string, [string, string]>();
  for (const { station, time } of items) {
    const day = dayOf(time);
    keys.set(`${station} ${day}`, [station, day]);
  }
  return [...keys.values()];
}

/** Write rows, replacing any at the same station and time. */
export async function write(db: D1Database, rows: [string, LiveCell][]): Promise<void> {
  if (!rows.length) return;
  const days = await current(db, keysOf(rows.map(([station, c]) => ({ station, time: c[1] }))));
  const byTime = new Map<string, Map<number, LiveCell>>();
  for (const [station, cell] of rows) {
    const key = `${station} ${dayOf(cell[1])}`;
    let cells = byTime.get(key);
    if (!cells) byTime.set(key, (cells = new Map((days.get(key) ?? []).map((c) => [c[1], c]))));
    cells.set(cell[1], cell);
  }
  await save(db, new Map([...byTime].map(([key, cells]) => [key, [...cells.values()]])));
}

/** Delete the given values. */
export async function remove(
  db: D1Database,
  values: { station: string; time: number }[],
): Promise<void> {
  if (!values.length) return;
  const days = await current(db, keysOf(values));
  const gone = new Set(values.map((v) => `${v.station} ${v.time}`));
  for (const [key, cells] of days) {
    const station = key.split(" ")[0]!;
    days.set(
      key,
      cells.filter((c) => !gone.has(`${station} ${c[1]}`)),
    );
  }
  await save(db, days);
}

export async function removeStations(db: D1Database, stations: string[]): Promise<void> {
  for (const part of chunks(stations, PARAMS))
    await db
      .prepare(`DELETE FROM live WHERE station IN (${part.map(() => "?").join(",")})`)
      .bind(...part)
      .run();
}

export async function stations(db: D1Database, source: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT DISTINCT station FROM live WHERE station >= ? AND station < ?")
    .bind(...range(source))
    .all<{ station: string }>();
  return results.map((r) => r.station);
}

export async function insertPoll(db: D1Database, row: PollRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO polls (source, started, finished, intervals, ok, stations, updated, "values", stale, failed, blocked, datum_changed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.source,
      row.started,
      row.finished,
      JSON.stringify(row.intervals),
      row.ok ? 1 : 0,
      row.stations,
      row.updated,
      row.values,
      JSON.stringify(row.stale),
      JSON.stringify(row.failed),
      row.blocked ? 1 : 0,
      row.datum_changed ? 1 : 0,
    )
    .run();
}

/** A page of one source's stations' values for one day, after the station `after`, and where the next page starts. */
export async function day(
  db: D1Database,
  source: string,
  date: string,
  after: string,
  limit: number,
): Promise<{ rows: [string, LiveCell[]][]; next: string | null }> {
  const [from, to] = range(source);
  const { results } = await db
    .prepare(
      "SELECT station, rows FROM live WHERE station > ? AND station < ? AND day = ? ORDER BY station LIMIT ?",
    )
    .bind(after && after > from ? after : from, to, date, limit)
    .all<{ station: string; rows: string }>();
  return {
    rows: results.map((r) => [r.station, JSON.parse(r.rows) as LiveCell[]]),
    next: results.length === limit ? results.at(-1)!.station : null,
  };
}

/** Delete station-days before `day`, and passes that finished before `finished`. */
export async function prune(db: D1Database, before: string, finished: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM live WHERE day < ?").bind(before),
    db.prepare("DELETE FROM polls WHERE finished < ?").bind(finished),
  ]);
}

async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<unknown[][]> {
  const out: unknown[][] = [];
  for (const part of chunks(statements, 50))
    for (const result of await db.batch(part)) out.push(result.results);
  return out;
}
