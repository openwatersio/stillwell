import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Flag,
  type Epoch,
  type Observation,
  type Source,
  type StoredStation,
} from "../src/schema.ts";
import type { StationObservation } from "../src/store/parquet.ts";
import type { ObservationStore } from "../src/realtime/live.ts";
import { difference, intervalOf, pollSource } from "../src/realtime/poll.ts";
import { formatSummary } from "../src/store/recent.ts";
import { withinSpan } from "../src/sources/index.ts";

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

/** An ObservationStore in memory that keeps levels as 32-bit floats, as the year files keep them, and counts what it's asked to write. */
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

  it("says why a station that sent only fill values went stale", async () => {
    const a = station("a");
    const fill = [at(NOW - 2 * HOUR, -9999), at(NOW - HOUR, -9999)];
    const wrapped = withinSpan(source({ [a.id]: fill }));
    const summary = await pollSource({
      source: wrapped,
      stations: [a],
      store: memory(),
      since: NOW - 6 * HOUR,
      now: NOW,
    });
    assert.deepEqual(summary.stale, [a.id]);
    assert.equal(summary.dropped!.count, 2);
    assert.equal(summary.droppedBy!.get(a.id)!.below, 2);
    assert.match(
      formatSummary(summary),
      /test\/a: its fetch left out 2 levels outside −500 to 9,000 m/,
    );
  });

  it("says which station of a sweep sent only fill values", async () => {
    const [a, b] = [station("a"), station("b")];
    const swept = withinSpan({
      ...source({}),
      recent: async () =>
        new Map([
          [a.id, [at(NOW - HOUR, -9999)]],
          [b.id, [at(NOW - HOUR, 1.2)]],
        ]),
    });
    const summary = await pollSource({
      source: swept,
      stations: [a, b],
      store: memory(),
      since: NOW - 6 * HOUR,
      now: NOW,
    });
    assert.deepEqual([...summary.droppedBy!.keys()], [a.id]);
    assert.deepEqual(summary.stale, [a.id]);
    assert.match(formatSummary(summary), /test\/a: its fetch left out 1 level outside/);
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

describe("intervalOf", () => {
  it("groups a station by its interval, and every station of an hourly-polled source as hourly", () => {
    const quick = station("a", { min_interval_s: 360 });
    assert.equal(intervalOf(source({}), quick), 360);
    assert.equal(intervalOf(source({}), station("b")), 0);
    const hourly = {
      ...source({}),
      metadata: { id: "test", poller: "hourly" } as Source["metadata"],
    };
    assert.equal(intervalOf(hourly, quick), 0);
  });
});
