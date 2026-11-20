import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { Flag, type StoredStation } from "../src/schema.ts";
import { writeObservations, writeOffsets, writeStations } from "../src/store/parquet.ts";
import worker, { normalize, resetCatalog } from "../workers/api/index.ts";
import { type Bucket, type D1, loadCatalog, r2File } from "../workers/api/store.ts";

const NOW = Date.parse("2026-11-13T12:03:30Z");
const PATH = "https://api.openwaters.io/water-levels/stations/coops/9447130/levels";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("normalize", () => {
  it("puts a range relative to now at the 7 days to now, rounded up to the step", () => {
    const { canonical, last } = normalize(new URLSearchParams("units=feet&step=1h"), NOW);
    assert.equal(
      canonical,
      "end=2026-11-13T13%3A00%3A00Z&start=2026-11-06T13%3A00%3A00Z&step=1h&units=feet",
    );
    assert.equal(last, "step=1h&units=feet");
  });

  it("rounds a start alone down to the step, and keys its last good copy by how far back it reaches", () => {
    const lone = normalize(new URLSearchParams("start=2026-11-09T12:03:29.5Z&end="), NOW);
    assert.equal(lone.canonical, "start=2026-11-09T12%3A00%3A00Z");
    assert.equal(lone.last, `ago=${96 * 3_600_000}`);
    // A later request, 96 hours back from a later now, finds the same copy.
    const later = normalize(new URLSearchParams("start=2026-11-09T12:05:01Z"), NOW + 90_000);
    assert.equal(later.last, lone.last);
    assert.equal(
      normalize(new URLSearchParams("start=2026-11-09T12:03:29Z&step=raw"), NOW).canonical,
      "start=2026-11-09T12%3A03%3A00Z&step=raw",
    );
    // At 1d, today's midnight is never in the future, and a start that rounding would push past the window stays.
    assert.equal(
      normalize(new URLSearchParams("start=2026-11-13T06:00:00Z&step=1d"), NOW).canonical,
      "start=2026-11-13T00%3A00%3A00Z&step=1d",
    );
    assert.equal(
      normalize(new URLSearchParams("start=2026-11-06T13:00:00Z&step=1d"), NOW).canonical,
      "start=2026-11-06T13%3A00%3A00Z&step=1d",
    );
  });

  it("rounds a given range inward to the step, and leaves alone what the server must judge", () => {
    const given = normalize(
      new URLSearchParams("start=2026-11-13T10:01:00Z&end=2026-11-13T11:59:00Z&step=15m"),
      NOW,
    );
    assert.equal(
      given.canonical,
      "end=2026-11-13T11%3A45%3A00Z&start=2026-11-13T10%3A15%3A00Z&step=15m",
    );
    for (const search of [
      "start=2026-11-13T10:01:00Z&end=2026-11-13T10:02:00Z", // no step time between
      "start=nope&end=2026-11-13T10:02:00Z",
      "step=5m",
      "foo=1&step=raw&start=2026-11-13T10:01:07Z&end=2026-11-13T10:02:00Z",
      "step=constructor", // not a step, though every object has one
      "start=2026-11-31T00:00:00Z&end=2026-12-02T00:00:00Z", // rolled into December, the server refuses it
    ]) {
      const kept = new URLSearchParams(search);
      kept.delete("foo");
      kept.sort();
      assert.equal(normalize(new URLSearchParams(search), NOW).canonical, kept.toString(), search);
    }
  });
});

function station(id: string, fields: Partial<StoredStation> = {}): StoredStation {
  const [source, sourceId] = id.split("/") as [string, string];
  return {
    id,
    source,
    source_id: sourceId,
    name: id,
    lat: 47.6,
    lon: -122.3,
    country_code: "US",
    kind: "coastal",
    interval_s: 360,
    datum: "STND",
    datums: {},
    datums_source: {},
    datums_epoch: {},
    datums_attribution: [],
    chart_datum: "MLLW",
    frame: "gauge",
    products: ["levels"],
    first: "2020-01-01T00:00:00Z",
    last: "2026-11-13T12:00:00Z",
    missing_years: [],
    license: "CC0-1.0",
    commercial_use: true,
    attribution: "NOAA",
    tide_station: null,
    same_as: [],
    preferred: id,
    errata: [],
    status: "active",
    live: true,
    min_interval_s: 360,
    source_qc_start: null,
    source_qc_start_inferred: false,
    tidal: true,
    tide_m: 1,
    source_url: null,
    epochs: [
      {
        id: 1,
        datum: "STND",
        since: null,
        until: "2026-11-01T00:00:00Z",
        seen: "2026-11-01T00:00:00Z",
        reference: null,
        reference_since: null,
        datums: {},
        to_current: 0.5,
        state: "closed",
      },
      {
        id: 2,
        datum: "STND",
        since: "2026-11-01T00:00:00Z",
        until: null,
        seen: "2026-11-13T00:00:00Z",
        reference: null,
        reference_since: null,
        datums: {},
        to_current: 0,
        state: "open",
      },
    ],
    ...fields,
  } as StoredStation;
}

/** Hourly values from `from` to `to`, each at `level`. */
function hourly(from: string, to: string, level: number) {
  const rows = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += HOUR)
    rows.push({ time: t, level, flag: Flag.preliminary });
  return rows;
}

/** The R2 binding over a local directory, recording each key asked for. */
function bucket(dir: string, asked: string[], broken: { yes: boolean }): Bucket {
  return {
    async get(key, options) {
      asked.push(key);
      if (broken.yes) throw new Error("R2 is down");
      const file = await readFile(join(dir, key)).catch(() => null);
      if (!file) return null;
      // A version's ETag: its contents' length and first and last bytes are enough to tell the test's files apart.
      const etag = `${file.length}-${file[0]}-${file.at(-1)}-${(await stat(join(dir, key))).mtimeMs}`;
      if (options?.onlyIf && options.onlyIf.etagMatches !== etag)
        return { size: file.length, etag };
      const range = options?.range;
      const [start, end] = !range
        ? [0, file.length]
        : "suffix" in range
          ? [Math.max(0, file.length - range.suffix), file.length]
          : [range.offset, range.offset + range.length];
      return {
        size: file.length,
        etag,
        arrayBuffer: async () => file.buffer.slice(file.byteOffset + start, file.byteOffset + end),
      };
    },
  };
}

/** The D1 binding over SQLite with workers/live/schema.sql, which has the JSON functions D1 has. */
function d1(db: DatabaseSync, broken: { yes: boolean }): D1 {
  return {
    prepare: (sql) => ({
      bind: (...values) => ({
        async all<T>() {
          if (broken.yes) throw new Error("D1 is down");
          return { results: db.prepare(sql).all(...(values as never[])) as T[] };
        },
        async first<T>() {
          if (broken.yes) throw new Error("D1 is down");
          return (db.prepare(sql).get(...(values as never[])) ?? null) as T | null;
        },
      }),
    }),
  };
}

describe("the Worker", () => {
  let store: string;
  let db: DatabaseSync;
  let cache: Map<string, Response>;
  let waits: Promise<unknown>[];
  let asked: string[];
  const r2Down = { yes: false };
  const d1Down = { yes: false };
  let env: { LIVE: D1; STORE: Bucket };
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p) };
  const get = async (url: string) => {
    const response = await worker.fetch(new Request(url), env, ctx);
    await Promise.all(waits);
    return response;
  };
  const levels = async (search: string) => {
    const response = await get(`${PATH}?${search}`);
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()) as {
      status: string;
      as_of: string | null;
      updated: string | null;
      levels: { time: string; level: number }[];
    };
  };
  const writeList = (stations: StoredStation[]) =>
    writeStations(join(store, "stations.parquet"), stations);

  before(async () => {
    store = await mkdtemp(join(tmpdir(), "worker-api-"));
    await writeList([
      station("coops/9447130"),
      station("coops/1", { products: [] }),
      station("smhi/2130", { commercial_use: false }),
    ]);
    await writeOffsets(join(store, "stations/offsets.parquet"), [
      { station: "coops/9447130", epoch: 2, datum: "MLLW", offset_m: 2 },
    ]);
    const obs = join(store, "obs/coops/9447130");
    await writeObservations(
      join(obs, "2025.parquet"),
      hourly("2025-06-01", "2025-06-03", 1),
      "STND",
    );
    // Epoch 1 until November, at 0.25 m, then epoch 2 to now at 1 m.
    await writeObservations(
      join(obs, "2026.parquet"),
      hourly("2026-10-25", "2026-10-31T23:00:00Z", 0.25),
      "STND",
    );
    await writeObservations(
      join(obs, "2/2026.parquet"),
      hourly("2026-11-01", "2026-11-13T12:00:00Z", 1),
      "STND",
    );
  });
  after(() => rm(store, { recursive: true }));

  beforeEach(async () => {
    cache = new Map();
    waits = [];
    asked = [];
    r2Down.yes = d1Down.yes = false;
    resetCatalog();
    mock.timers.enable({ apis: ["Date"], now: NOW });
    (globalThis as Record<string, unknown>).caches = {
      default: {
        match: async (key: Request) => cache.get(key.url)?.clone(),
        put: async (key: Request, response: Response) => void cache.set(key.url, response),
        delete: async (key: Request) => cache.delete(key.url),
      },
    };
    // D1 holds the 8 days from November 6, at 2 m, but for November 8, and a bad value at 12:00 today.
    db = new DatabaseSync(":memory:");
    db.exec(await readFile(new URL("../workers/live/schema.sql", import.meta.url), "utf8"));
    const insert = db.prepare("INSERT INTO live (station, day, rows) VALUES (?, ?, ?)");
    for (let day = Date.parse("2026-11-06"); day <= Date.parse("2026-11-13"); day += DAY) {
      if (day === Date.parse("2026-11-08")) continue;
      const rows = hourly(new Date(day).toISOString(), new Date(day + 23 * HOUR).toISOString(), 2)
        .filter((r) => r.time <= Date.parse("2026-11-13T12:00:00Z"))
        .map((r) => [
          2,
          r.time,
          r.level,
          r.time === Date.parse("2026-11-13T12:00:00Z") ? Flag.bad : r.flag,
          null,
          r.time + 60_000,
        ]);
      insert.run("coops/9447130", new Date(day).toISOString().slice(0, 10), JSON.stringify(rows));
    }
    const poll = db.prepare(
      `INSERT INTO polls VALUES ('coops', ?, ?, ?, ?, 1, 1, 1, 0, '[]', 0, 0)`,
    );
    poll.run(NOW - 5 * 60_000, NOW - 4 * 60_000, "[360]", 1);
    poll.run(NOW - 3 * 60_000, NOW - 2 * 60_000, "[60]", 1); // another group's
    poll.run(NOW - 2 * 60_000, NOW - 60_000, "[360]", 0); // failed
    env = { LIVE: d1(db, d1Down), STORE: bucket(store, asked, r2Down) };
  });
  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
  });

  it("serves the last 8 days from D1, and a day it doesn't hold from the year files", async () => {
    const body = await levels(
      "start=2026-11-07T22:00:00Z&end=2026-11-09T01:00:00Z&step=1h&datum=station",
    );
    assert.deepEqual(
      body.levels.map((l) => [l.time.slice(5, 13), l.level]),
      [
        ["11-07T22", 2],
        ["11-07T23", 2],
        ...Array.from({ length: 24 }, (_, h) => [`11-08T${String(h).padStart(2, "0")}`, 1]),
        ["11-09T00", 2],
        ["11-09T01", 2],
      ],
    );
    // Only the year file of the epoch and year it needs.
    assert.deepEqual(
      asked.filter((k) => k.startsWith("obs/")),
      ["obs/coops/9447130/2/2026.parquet"],
    );
    // The newest value that isn't bad, and the last clean pass for the station's group.
    assert.equal(body.as_of, "2026-11-13T11:00:00Z");
    assert.equal(body.updated, "2026-11-13T11:59:30Z");
    assert.equal(body.status, "reporting");
  });

  it("takes the hours before a partial D1 day's first value from the year files", async () => {
    // The poller started at 18:00 on November 10, so D1 holds only that day's last hours.
    const day = Date.parse("2026-11-10");
    const rows = hourly("2026-11-10T18:00:00Z", "2026-11-10T23:00:00Z", 2).map((r) => [
      2,
      r.time,
      r.level,
      r.flag,
      null,
      null,
    ]);
    db.prepare("UPDATE live SET rows = ? WHERE station = 'coops/9447130' AND day = ?").run(
      JSON.stringify(rows),
      new Date(day).toISOString().slice(0, 10),
    );
    const body = await levels(
      "start=2026-11-10T16:00:00Z&end=2026-11-10T19:00:00Z&step=1h&datum=station",
    );
    assert.deepEqual(
      body.levels.map((l) => [l.time.slice(11, 13), l.level]),
      [
        ["16", 1],
        ["17", 1],
        ["18", 2],
        ["19", 2],
      ],
    );
  });

  it("reads a range across epochs from each epoch's file, and converts each", async () => {
    const range = "start=2026-10-31T22:00:00Z&end=2026-11-01T01:00:00Z&step=1h";
    // Epoch 1's 0.25 m is 0.75 m in epoch 2.
    assert.deepEqual(
      (await levels(`${range}&datum=station`)).levels.map((l) => l.level),
      [0.75, 0.75, 1, 1],
    );
    // Epoch 1 has no offset to MLLW, so only epoch 2's values are shown in it.
    assert.deepEqual(
      (await levels(range)).levels.map((l) => l.level),
      [3, 3],
    );
    assert.deepEqual([...new Set(asked.filter((k) => k.startsWith("obs/")))].sort(), [
      "obs/coops/9447130/2/2026.parquet",
      "obs/coops/9447130/2026.parquet",
    ]);
  });

  it("serves any range from the year files, reading nothing of D1", async () => {
    const queries = mock.method(env.LIVE, "prepare");
    const body = await levels(
      "start=2025-06-01T00:00:00Z&end=2025-06-02T00:00:00Z&step=raw&datum=station",
    );
    assert.equal(body.levels.length, 25);
    // The station's list has epoch 1 through 2025, so only its file for 2025 is read.
    assert.deepEqual(
      asked.filter((k) => k.startsWith("obs/")),
      ["obs/coops/9447130/2025.parquet"],
    );
    // Only as_of and updated ask D1.
    assert.equal(queries.mock.callCount(), 2);
    // A range that ended over 7 days ago is cached for a day.
    const response = await get(
      `${PATH}?start=2025-06-01T00:00:00Z&end=2025-06-02T00:00:00Z&step=1h`,
    );
    assert.equal(response.headers.get("Cache-Control"), "public, max-age=86400");
  });

  it("refuses a range too long for its step", async () => {
    assert.equal((await get(`${PATH}?start=2026-01-01&end=2026-03-01&step=raw`)).status, 400);
    assert.equal((await get(`${PATH}?start=2025-01-01&end=2026-03-01&step=1h`)).status, 400);
    assert.equal(cache.size, 0);
  });

  it("reads once, then answers from the cache", async () => {
    await levels("step=1h");
    const reads = asked.length;
    await levels("step=1h");
    assert.equal(asked.length, reads);
  });

  it("gives a cached copy only the time it has left, whatever the cache says", async () => {
    assert.equal((await get(PATH)).headers.get("Cache-Control"), "public, max-age=300");
    // Cloudflare's zone settings rewrite a cached response's Cache-Control.
    for (const [url, kept] of cache) {
      const rewritten = new Response(kept.body, kept);
      rewritten.headers.set("Cache-Control", "public, max-age=14400");
      cache.set(url, rewritten);
    }
    mock.timers.setTime(NOW + 100_000);
    const hit = await get(PATH);
    assert.equal(hit.headers.get("Cache-Control"), "public, max-age=200");
    assert.equal(hit.headers.get("X-Levels-Expires"), null);
    // Past its expiry, the copy is a miss, though the cache still holds it.
    mock.timers.setTime(NOW + 301_000);
    d1Down.yes = true;
    assert.equal(((await (await get(PATH)).json()) as { status: string }).status, "stale");
  });

  it("reads again when a cached copy has no expiry", async () => {
    await get(PATH);
    const [url] = [...cache.keys()].filter((k) => !k.includes("last-good"));
    cache.set(url!, Response.json({ status: "reporting", levels: [] })); // cached before expiries were kept
    d1Down.yes = true;
    assert.equal(((await (await get(PATH)).json()) as { status: string }).status, "stale");
  });

  it("serves the last good copy as stale when D1 or R2 fails, and 503 without one", async () => {
    const fresh = await levels("");
    d1Down.yes = true;
    mock.timers.setTime(NOW + 10 * 60_000); // a new step, so a new key
    const stale = await levels("");
    assert.equal(stale.status, "stale");
    assert.deepEqual(stale.levels, fresh.levels);
    assert.equal((await get(`${PATH}?step=1h`)).status, 503);
    d1Down.yes = false;
    r2Down.yes = true;
    // The station list in memory serves on; the year file can't be read.
    assert.equal(
      (await get(`${PATH}?start=2025-06-01T00:00:00Z&end=2025-06-02T00:00:00Z`)).status,
      503,
    );
  });

  it("serves Slackwater's start-only request its last good copy, though its start moved", async () => {
    await get(`${PATH}?start=2026-11-09T12:03:29.512Z`);
    d1Down.yes = true;
    // Four minutes on, in the next step, so not the cached copy.
    mock.timers.setTime(NOW + 4 * 60_000);
    const stale = await get(`${PATH}?start=2026-11-09T12:07:31.020Z`);
    assert.equal(stale.status, 200);
    assert.equal(((await stale.json()) as { status: string }).status, "stale");
  });

  it("reads the station list again after 10 minutes, and never serves an older copy of a station since withheld", async () => {
    await levels("");
    await writeList([station("coops/1", { products: [] })]);
    try {
      mock.timers.setTime(NOW + 11 * 60_000);
      // The list is read again in the background, so this request has the old one.
      assert.equal((await get(PATH)).status, 200);
      mock.timers.setTime(NOW + 18 * 60_000); // past the cached copy's 5 minutes
      assert.equal((await get(PATH)).status, 404);
      // With no list to answer from, there's no copy to fall back on.
      resetCatalog();
      r2Down.yes = true;
      mock.timers.setTime(NOW + 24 * 60_000);
      assert.equal((await get(PATH)).status, 503);
    } finally {
      await writeList([
        station("coops/9447130"),
        station("coops/1", { products: [] }),
        station("smhi/2130", { commercial_use: false }),
      ]);
    }
  });

  it("keeps the station list it has when a read fails, and serves the last good copy with none", async () => {
    const range = "start=2026-11-12T00:00:00Z&end=2026-11-13T12:00:00Z"; // all in D1
    await levels(range);
    r2Down.yes = true;
    mock.timers.setTime(NOW + 11 * 60_000);
    // The new read fails, and the list in memory still serves the range from D1.
    assert.equal((await levels(range)).status, "reporting");
    resetCatalog();
    mock.timers.setTime(NOW + 17 * 60_000);
    assert.equal((await levels(range)).status, "stale");
  });

  it("passes the handler's 4xx through and serves nothing but levels", async () => {
    assert.equal((await get(`${PATH}?step=5m`)).status, 400);
    assert.equal(cache.size, 0);
    assert.equal((await get(PATH.replace("coops/9447130", "coops/1"))).status, 404);
    assert.equal((await get(PATH.replace("coops/9447130", "smhi/2130"))).status, 451);
    assert.equal((await get("https://api.openwaters.io/water-levels/stations")).status, 404);
    const post = await worker.fetch(new Request(PATH, { method: "POST" }), env, ctx);
    assert.equal(post.status, 405);
  });
});

describe("the station list", () => {
  it("is read from stations.parquet and its offsets, as the server read it", async () => {
    const store = await mkdtemp(join(tmpdir(), "worker-catalog-"));
    try {
      await writeStations(join(store, "stations.parquet"), [
        station("coops/9447130", { min_interval_s: null, datums_attribution: ["Slackwater"] }),
      ]);
      await writeOffsets(join(store, "stations/offsets.parquet"), [
        { station: "coops/9447130", epoch: 1, datum: "MLLW", offset_m: 2.5 },
        { station: "coops/9447130", epoch: 2, datum: "MLLW", offset_m: 2 },
      ]);
      const catalog = await loadCatalog(bucket(store, [], { yes: false }));
      const seattle = catalog.get("coops/9447130")!;
      assert.equal(seattle.levels, true);
      assert.equal(seattle.commercial_use, true);
      assert.equal(seattle.min_interval_s, null);
      assert.deepEqual(seattle.datums_attribution, ["Slackwater"]);
      assert.equal(seattle.epoch, 2);
      assert.deepEqual(
        [...seattle.epochs],
        [
          [1, { since: null, until: Date.parse("2026-11-01"), to_current: 0.5 }],
          [2, { since: Date.parse("2026-11-01"), until: null, to_current: 0 }],
        ],
      );
      assert.deepEqual(
        [...seattle.offsets].map(([e, m]) => [e, [...m]]),
        [
          [1, [["MLLW", 2.5]]],
          [2, [["MLLW", 2]]],
        ],
      );
      await rm(join(store, "stations/offsets.parquet"));
      await assert.rejects(loadCatalog(bucket(store, [], { yes: false })), /offsets/);
    } finally {
      await rm(store, { recursive: true });
    }
  });
});

describe("year files on R2", () => {
  it("reads every range from the version the first read found, and fails when the file changes", async () => {
    const bytes = new Uint8Array(3 << 20).map((_, i) => i % 251);
    let etag = "v1";
    const fake: Bucket = {
      async get(_key, options) {
        if (options?.onlyIf && options.onlyIf.etagMatches !== etag)
          return { size: bytes.length, etag };
        const range = options?.range;
        const [start, end] =
          range && "suffix" in range
            ? [bytes.length - range.suffix, bytes.length]
            : [range!.offset, range!.offset + range!.length];
        return {
          size: bytes.length,
          etag,
          arrayBuffer: async () => bytes.slice(start, end).buffer,
        };
      },
    };
    const file = (await r2File(fake, "obs/x/1/2025.parquet"))!;
    assert.deepEqual(new Uint8Array(await file.slice(0, 3)), new Uint8Array([0, 1, 2]));
    etag = "v2";
    await assert.rejects(Promise.resolve(file.slice(0, 3)), /changed while it was read/);
  });
});
