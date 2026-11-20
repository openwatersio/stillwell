import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, it } from "node:test";
import {
  day,
  handleStore,
  insertPoll,
  prune,
  read,
  remove,
  removeStations,
  stations,
  write,
  type LiveDb,
  type Statement,
} from "../workers/live/store.ts";
import type { LiveCell } from "../workers/live/types.ts";

/** The D1 binding over SQLite with workers/live/schema.sql. */
function d1(): LiveDb & { db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync("workers/live/schema.sql", "utf8"));
  const statement = (sql: string, values: unknown[] = []): Statement => ({
    bind: (...next) => statement(sql, next),
    all: async <T>() => ({
      results: db.prepare(sql).all(...(values as SQLInputValue[])) as T[],
    }),
    run: async () => db.prepare(sql).run(...(values as SQLInputValue[])),
  });
  return {
    db,
    prepare: (sql) => statement(sql),
    async batch(statements) {
      const out = [];
      for (const s of statements) out.push(await s.all());
      return out;
    },
  };
}

const DAY = 86_400_000;
/** A query's rows as plain objects, which node:sqlite returns without a prototype. */
const rowsOf = (db: { db: DatabaseSync }, sql: string) =>
  db.db
    .prepare(sql)
    .all()
    .map((r) => ({ ...r }));
const T = Date.UTC(2026, 10, 20);
const cell = (time: number, level: number, flag = 1): LiveCell => [
  1,
  time,
  level,
  flag,
  null,
  time,
];

describe("the live store", () => {
  it("merges each write into its station-days, replacing values at the same time", async () => {
    const db = d1();
    await write(db, [
      ["ea/1", cell(T + 1000, 1)],
      ["ea/1", cell(T + 2000, 2)],
      ["ea/1", cell(T - 1000, 0.5)],
    ]);
    await write(db, [["ea/1", cell(T + 2000, 2.5)]]);
    const rows = rowsOf(db, "SELECT day, rows FROM live ORDER BY day") as {
      day: string;
      rows: string;
    }[];
    assert.deepEqual(
      rows.map((r) => [r.day, JSON.parse(r.rows).map((c: LiveCell) => c[2])]),
      [
        ["2026-11-19", [0.5]],
        ["2026-11-20", [1, 2.5]],
      ],
    );
    assert.deepEqual(await read(db, ["ea/1", "ea/2"], T), [
      ["ea/1", [cell(T + 1000, 1), cell(T + 2000, 2.5)]],
    ]);
  });

  it("removes values, and a station-day left with none", async () => {
    const db = d1();
    await write(db, [
      ["ea/1", cell(T + 1000, 1)],
      ["ea/1", cell(T - 1000, 0.5)],
      ["ea/2", cell(T + 1000, 3)],
    ]);
    await remove(db, [
      { station: "ea/1", time: T - 1000 },
      { station: "ea/2", time: T + 1000 },
    ]);
    assert.deepEqual(rowsOf(db, "SELECT station, day FROM live ORDER BY station, day"), [
      { station: "ea/1", day: "2026-11-20" },
    ]);
    await removeStations(db, ["ea/1"]);
    assert.deepEqual(rowsOf(db, "SELECT * FROM live"), []);
  });

  it("lists a source's stations, and pages through one day of them", async () => {
    const db = d1();
    await write(db, [
      ["ea/1", cell(T + 1000, 1)],
      ["ea/2", cell(T + 1000, 2)],
      ["ea/3", cell(T + 1000, 3)],
      ["ea/3", cell(T - 1000, 3)],
      ["eaa/1", cell(T + 1000, 9)],
    ]);
    assert.deepEqual((await stations(db, "ea")).sort(), ["ea/1", "ea/2", "ea/3"]);
    const first = await day(db, "ea", "2026-11-20", "", 2);
    assert.deepEqual(
      first.rows.map(([s]) => s),
      ["ea/1", "ea/2"],
    );
    const second = await day(db, "ea", "2026-11-20", first.next!, 2);
    assert.deepEqual(second, { rows: [["ea/3", [cell(T + 1000, 3)]]], next: null });
  });

  it("records passes, and prunes old days and passes", async () => {
    const db = d1();
    const pass = (finished: number) =>
      insertPoll(db, {
        source: "ea",
        started: finished - 1000,
        finished,
        intervals: [900],
        ok: true,
        stations: 1,
        updated: 1,
        values: 2,
        stale: ["ea/9"],
        failed: [],
        blocked: false,
        datum_changed: false,
      });
    await pass(T);
    await pass(T - 40 * DAY);
    await write(db, [
      ["ea/1", cell(T, 1)],
      ["ea/1", cell(T - 9 * DAY, 1)],
    ]);
    await prune(db, "2026-11-12", T - 30 * DAY);
    assert.deepEqual(rowsOf(db, "SELECT day FROM live"), [{ day: "2026-11-20" }]);
    assert.deepEqual(rowsOf(db, "SELECT stale, intervals FROM polls"), [
      { stale: '["ea/9"]', intervals: "[900]" },
    ]);
  });

  it("puts only daily files on R2", async () => {
    const put: string[] = [];
    const env = { LIVE: d1(), STORE: { put: async (key: string) => put.push(key) } };
    const send = (key: string) =>
      handleStore(new Request(`http://live/files/${key}`, { method: "PUT", body: "x" }), env);
    assert.equal((await send("recent/ea/2026-11-20.parquet")).status, 200);
    assert.equal((await send("obs/ea/1/2026.parquet")).status, 400);
    assert.equal((await send("recent/ea/../../stations.parquet")).status, 400);
    assert.deepEqual(put, ["recent/ea/2026-11-20.parquet"]);
  });
});
