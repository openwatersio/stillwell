import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  Flag,
  type Epoch,
  type Observation,
  type Source,
  type StoredStation,
} from "../src/schema.ts";
import type { StationObservation } from "../src/store/parquet.ts";
import { writeRecent } from "../src/store/parquet.ts";
import { recentPath } from "../src/store/paths.ts";
import type { ObservationStore } from "../src/realtime/clickhouse.ts";
import { difference, pollSource, seedFromRecent } from "../src/realtime/poll.ts";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 5, 12);

function epoch(id: number): Epoch {
  return {
    id,
    datum: "NAP",
    since: null,
    until: null,
    seen: null,
    reference: null,
    reference_since: null,
    datums: {},
    to_current: 0,
    state: "open",
  };
}

function station(id: string, extra: Partial<StoredStation> = {}): StoredStation {
  return {
    epochs: [epoch(1)],
    id: `test/${id}`,
    source: "test",
    source_id: id,
    datum: "NAP",
    products: ["levels"],
    status: "active",
    live: true,
    interval_s: 600,
    kind: "coastal",
    commercial_use: true,
    ...extra,
  } as StoredStation;
}

/** A source answering each station from `answers`, which a test can change between passes. */
function source(answers: Record<string, Observation[]>, withheld: string[] = []): Source {
  return {
    metadata: { id: "test" } as Source["metadata"],
    stations: async () => [],
    observations: async (s) => answers[s.id] ?? [],
    withheld: (id) => (withheld.includes(id) ? "refused" : null),
  };
}

/** An ObservationStore in memory that keeps levels as 32-bit floats, as ClickHouse does, and counts what it's asked to write. */
function memory(): ObservationStore & { rows: Map<string, StationObservation>; written: number } {
  const rows = new Map<string, StationObservation>();
  const key = (r: { station: string; time: number }) => `${r.station} ${r.time}`;
  const store = {
    rows,
    written: 0,
    async read(stations: string[], from: number) {
      return [...rows.values()]
        .filter((r) => stations.includes(r.station) && r.time >= from)
        .sort((a, b) => a.station.localeCompare(b.station) || a.time - b.time);
    },
    async write(next: StationObservation[]) {
      store.written += next.length;
      for (const r of next) rows.set(key(r), { ...r, level: Math.fround(r.level) });
    },
    async remove(values: { station: string; time: number }[]) {
      for (const v of values) rows.delete(key(v));
    },
    async removeStations(stations: string[]) {
      for (const [k, r] of rows) if (stations.includes(r.station)) rows.delete(k);
    },
    async stations(prefix: string) {
      return [...new Set([...rows.values()].map((r) => r.station))].filter((s) =>
        s.startsWith(`${prefix}/`),
      );
    },
  };
  return store;
}

const at = (time: number, level: number, flag: Flag = Flag.preliminary): Observation => ({
  time,
  level,
  flag,
});

describe("pollSource", () => {
  it("writes new values with when they arrived, and nothing again when nothing changed", async () => {
    const a = station("a");
    const answers = { [a.id]: [at(NOW - 2 * HOUR, 1.234), at(NOW - HOUR, 1.301)] };
    const store = memory();
    const poll = (now: number) =>
      pollSource({ source: source(answers), stations: [a], store, since: now - 6 * HOUR, now });

    const first = await poll(NOW);
    assert.equal(first.values, 2);
    assert.equal(store.written, 2);
    assert.deepEqual(
      [...store.rows.values()].map((r) => r.received),
      [NOW, NOW],
    );

    // Levels parsed as doubles match the 32-bit floats stored, so nothing is written.
    const second = await poll(NOW + 10 * 60_000);
    assert.equal(second.values, 0);
    assert.equal(store.written, 2);
  });

  it("writes a value whose source flag changed, keeping when it first arrived", async () => {
    const a = station("a");
    const answers = { [a.id]: [at(NOW - HOUR, 1.2)] };
    const store = memory();
    await pollSource({
      source: source(answers),
      stations: [a],
      store,
      since: NOW - 6 * HOUR,
      now: NOW,
    });
    answers[a.id] = [at(NOW - HOUR, 1.2, Flag.good)];
    await pollSource({
      source: source(answers),
      stations: [a],
      store,
      since: NOW - 6 * HOUR,
      now: NOW + HOUR,
    });
    const [row] = store.rows.values();
    assert.equal(row!.source_flag, Flag.good);
    assert.equal(row!.received, NOW);
    assert.equal(store.written, 2);
  });

  it("deletes a value the source no longer sends", async () => {
    const a = station("a");
    const answers = { [a.id]: [at(NOW - 2 * HOUR, 1), at(NOW - HOUR, 2)] };
    const store = memory();
    await pollSource({
      source: source(answers),
      stations: [a],
      store,
      since: NOW - 6 * HOUR,
      now: NOW,
    });
    answers[a.id] = [at(NOW - HOUR, 2)];
    await pollSource({
      source: source(answers),
      stations: [a],
      store,
      since: NOW - 6 * HOUR,
      now: NOW + 60_000,
    });
    assert.deepEqual(
      [...store.rows.values()].map((r) => r.time),
      [NOW - HOUR],
    );
  });

  it("keeps what it had when a fetch fails", async () => {
    const a = station("a");
    const store = memory();
    await pollSource({
      source: source({ [a.id]: [at(NOW - HOUR, 1)] }),
      stations: [a],
      store,
      since: NOW - 6 * HOUR,
      now: NOW,
    });
    const failing: Source = {
      ...source({}),
      observations: async () => {
        throw new Error("down");
      },
    };
    const summary = await pollSource({
      source: failing,
      stations: [a],
      store,
      since: NOW - 6 * HOUR,
      now: NOW + 60_000,
    });
    assert.deepEqual(summary.failed, ["test/a: down"]);
    assert.equal(store.rows.size, 1);
  });

  it("deletes a withheld station's values and doesn't fetch it", async () => {
    const [a, b] = [station("a"), station("b")];
    const answers = { [a.id]: [at(NOW - HOUR, 1)], [b.id]: [at(NOW - HOUR, 2)] };
    const store = memory();
    await pollSource({
      source: source(answers),
      stations: [a, b],
      store,
      since: NOW - 6 * HOUR,
      now: NOW,
    });
    // The adapter withholds b before the list's next refresh drops it.
    const summary = await pollSource({
      source: source(answers, ["b"]),
      stations: [a, b],
      store,
      since: NOW - 6 * HOUR,
      now: NOW + 60_000,
    });
    assert.equal(summary.stations, 1);
    assert.deepEqual(
      [...store.rows.values()].map((r) => r.station),
      [a.id],
    );
  });
});

describe("pollSource limits", () => {
  it("keeps no level that isn't a finite number, and doesn't count it new on every pass", async () => {
    const a = station("a");
    const answers = { [a.id]: [at(NOW - 2 * HOUR, NaN), at(NOW - HOUR, 1)] };
    const store = memory();
    const first = await pollSource({
      source: source(answers),
      stations: [a],
      store,
      since: NOW - 6 * HOUR,
      now: NOW,
    });
    assert.equal(first.values, 1);
    const second = await pollSource({
      source: source(answers),
      stations: [a],
      store,
      since: NOW - 6 * HOUR,
      now: NOW + 60_000,
    });
    assert.equal(second.values, 0);
    assert.equal(store.rows.size, 1);
  });

  it("refuses to delete more withheld stations than every other withholding allows", async () => {
    const stations = Array.from({ length: 10 }, (_, i) => station(`s${i}`));
    const answers = Object.fromEntries(stations.map((s) => [s.id, [at(NOW - HOUR, 1)]]));
    const store = memory();
    await pollSource({ source: source(answers), stations, store, since: NOW - 6 * HOUR, now: NOW });
    const all = stations.map((s) => s.source_id);
    await assert.rejects(
      pollSource({
        source: source(answers, all),
        stations,
        store,
        since: NOW - 6 * HOUR,
        now: NOW + 60_000,
      }),
      /withheld, more than 5/,
    );
    assert.equal(store.rows.size, 10);
  });

  it("fetches only the stations due", async () => {
    const [a, b] = [station("a"), station("b", { min_interval_s: 60 })];
    const answers = { [a.id]: [at(NOW - HOUR, 1)], [b.id]: [at(NOW - HOUR, 2)] };
    const store = memory();
    const summary = await pollSource({
      source: source(answers),
      stations: [a, b],
      store,
      since: NOW - 6 * HOUR,
      now: NOW,
      due: (s) => s.min_interval_s === 60,
    });
    assert.equal(summary.stations, 1);
    assert.deepEqual(
      [...store.rows.values()].map((r) => r.station),
      [b.id],
    );
  });
});

describe("seedFromRecent", () => {
  it("fills an empty store from recent/, keeping when values arrived", async () => {
    const root = mkdtempSync(join(tmpdir(), "stillwell-seed-"));
    const [a, b] = [station("a"), station("b")];
    await writeRecent(recentPath(root, "test"), [
      [
        {
          station: a.id,
          epoch: 1,
          time: NOW - 3 * 24 * HOUR,
          level: 1,
          flag: Flag.good,
          received: NOW - 3 * 24 * HOUR,
        },
        { station: b.id, epoch: 1, time: NOW - HOUR, level: 2, flag: Flag.preliminary },
        { station: a.id, epoch: 1, time: NOW - 8 * 24 * HOUR, level: 3, flag: Flag.good },
      ],
    ]);
    const store = memory();
    const opts = {
      source: source({}, ["b"]),
      stations: [a, b],
      storeFor: () => root,
      store,
      now: NOW,
    };
    assert.equal(await seedFromRecent(opts), 1);
    assert.deepEqual(
      [...store.rows.values()].map((r) => [r.station, r.time, r.received]),
      [[a.id, NOW - 3 * 24 * HOUR, NOW - 3 * 24 * HOUR]],
    );
    // What the store holds already is left as it is.
    assert.equal(await seedFromRecent(opts), 0);
  });

  it("adds only the values the store lacks, keeping the ones it holds", async () => {
    const root = mkdtempSync(join(tmpdir(), "stillwell-seed-"));
    const a = station("a");
    await writeRecent(recentPath(root, "test"), [
      [
        { station: a.id, epoch: 1, time: NOW - 2 * HOUR, level: 1, flag: Flag.preliminary },
        { station: a.id, epoch: 1, time: NOW - HOUR, level: 2, flag: Flag.preliminary },
      ],
    ]);
    const store = memory();
    await store.write(
      [
        {
          station: a.id,
          epoch: 1,
          time: NOW - HOUR,
          level: 2.5,
          flag: Flag.suspect,
          received: NOW,
        },
      ],
      5,
    );
    const added = await seedFromRecent({
      source: source({}),
      stations: [a],
      storeFor: () => root,
      store,
      now: NOW,
    });
    assert.equal(added, 1);
    assert.deepEqual(
      [...store.rows.values()].map((r) => [r.time, r.level]).sort((x, y) => x[0]! - y[0]!),
      [
        [NOW - 2 * HOUR, 1],
        [NOW - HOUR, 2.5],
      ],
    );
  });
});

describe("difference", () => {
  const row = (time: number, level: number): StationObservation => ({
    station: "test/a",
    epoch: 1,
    time,
    level,
    flag: Flag.preliminary,
  });

  it("finds changed and vanished values", () => {
    const { changed, vanished } = difference(
      [row(1, 1), row(2, 2), row(3, 3)],
      [row(1, 1), row(2, 2.5), row(4, 4)],
    );
    assert.deepEqual(
      changed.map((r) => r.time),
      [2, 4],
    );
    assert.deepEqual(vanished, [3]);
  });

  it("sees a move to another epoch as a change", () => {
    const { changed } = difference([row(1, 1)], [{ ...row(1, 1), epoch: 2 }]);
    assert.equal(changed.length, 1);
  });
});
