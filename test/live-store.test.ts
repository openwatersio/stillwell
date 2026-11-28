import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, it } from "node:test";
import {
  day,
  handleStore,
  insertPoll,
  lastPass,
  prune,
  read,
  remove,
  removeStations,
  stations,
  write,
  type LiveDb,
  type Statement,
} from "../workers/live/store.ts";
import { alert, STALE_MS } from "../workers/live/alert.ts";
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
    assert.equal(await lastPass(db, "ea"), null);
    await pass(T);
    await pass(T - 40 * DAY);
    assert.equal(await lastPass(db, "ea"), T - 1000);
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

describe("the live alert", () => {
  const HOUR = 3_600_000;
  /** A pass of `source` that finished at `finished`. */
  const pass = (db: { db: DatabaseSync }, source: string, finished: number, ok: 0 | 1) =>
    db.db
      .prepare(`INSERT INTO polls VALUES (?, ?, ?, '[]', ?, 1, ?, 0, '[]', '[]', 0, 0)`)
      .run(source, finished - 60_000, finished, ok, ok);

  /** GitHub with `issues` open, refusing the calls `refuse` matches and never answering those `stall` matches. */
  function github(
    issues: { number: number; title: string; pull_request?: object }[],
    refuse = (_: string) => false,
    stall = (_: string) => false,
  ) {
    const calls: string[] = [];
    const fetcher = (async (url: string | URL | Request, init: RequestInit = {}) => {
      const path = String(url).replace("https://api.github.com/repos/openwatersio/stillwell/", "");
      const call = `${init.method ?? "GET"} ${path}`;
      calls.push(call);
      if (refuse(call)) return new Response("Resource not accessible", { status: 403 });
      if (stall(call))
        return new Promise<Response>((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
        );
      return Response.json(path.startsWith("issues?") ? issues : {});
    }) as typeof fetch;
    return { calls, fetcher };
  }

  it("opens an issue for a source with no clean pass and closes one for a source with a clean pass", async () => {
    const db = d1();
    pass(db, "ea", T - STALE_MS - HOUR, 1);
    pass(db, "ea", T - HOUR, 0);
    pass(db, "rws", T - HOUR, 1);
    const { calls, fetcher } = github([{ number: 7, title: "Live polling is failing for rws" }]);
    await alert(db, "token", T, fetcher);
    assert.deepEqual(calls.slice(1), ["POST issues", "PATCH issues/7"]);
  });

  it("handles every issue when a GitHub call for one fails, then throws the failure", async () => {
    const db = d1();
    for (const source of ["dmi", "ea", "rws"]) pass(db, source, T - HOUR, 1);
    const { calls, fetcher } = github(
      [
        { number: 1, title: "Live polling is failing for dmi" },
        { number: 2, title: "Live polling is failing for ea" },
        { number: 3, title: "Live polling is failing for rws" },
      ],
      (call) => call === "PATCH issues/1",
    );
    await assert.rejects(
      alert(db, "token", T, fetcher),
      /^Error: Live polling is failing for dmi: GitHub issues\/1: 403/,
    );
    assert.deepEqual(calls.slice(1), ["PATCH issues/1", "PATCH issues/2", "PATCH issues/3"]);
  });

  it("gives up on a GitHub call that doesn't answer and carries on", async () => {
    const db = d1();
    for (const source of ["dmi", "ea"]) pass(db, source, T - HOUR, 1);
    const { calls, fetcher } = github(
      [
        { number: 1, title: "Live polling is failing for dmi" },
        { number: 2, title: "Live polling is failing for ea" },
      ],
      undefined,
      (call) => call === "PATCH issues/1",
    );
    await assert.rejects(alert(db, "token", T, fetcher, 10), /failing for dmi: .*timeout/i);
    assert.deepEqual(calls.slice(1), ["PATCH issues/1", "PATCH issues/2"]);
  });

  it("closes every open issue with the title", async () => {
    const db = d1();
    pass(db, "rws", T - HOUR, 1);
    const { calls, fetcher } = github([
      { number: 3, title: "Live polling is failing for rws" },
      { number: 4, title: "Live polling is failing for rws" },
    ]);
    await alert(db, "token", T, fetcher);
    assert.deepEqual(calls.slice(1), ["PATCH issues/3", "PATCH issues/4"]);
  });

  it("takes no pull request with an alert's title for its issue", async () => {
    const db = d1();
    pass(db, "ea", T - HOUR, 0);
    pass(db, "rws", T - HOUR, 1);
    const { calls, fetcher } = github([
      { number: 5, title: "Live polling is failing for ea", pull_request: {} },
      { number: 6, title: "Live polling is failing for rws", pull_request: {} },
    ]);
    await alert(db, "token", T, fetcher);
    assert.deepEqual(calls.slice(1), ["POST issues"]);
  });
});
