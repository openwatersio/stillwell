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
import { difference, gapsDue, intervalOf, pollSource } from "../src/realtime/poll.ts";

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

describe("gapsDue", () => {
  const SIX = 6 * HOUR;

  it("gives a station one pass every six hours, however late a pass runs", () => {
    for (const every of [60_000, 300_000, 301_000, 660_000, 50 * 60_000]) {
      const turns: number[] = [];
      for (let t = NOW; t < NOW + 48 * HOUR; t += every)
        if (gapsDue("test/a", t - every, t)) turns.push(t);
      assert.equal(turns.length, 8, `${turns.length} turns in two days at ${every} ms`);
      for (let i = 1; i < turns.length; i++)
        assert.ok(Math.abs(turns[i]! - turns[i - 1]! - SIX) <= every);
    }
  });

  it("is due once after a stop longer than six hours", () => {
    assert.equal(gapsDue("test/a", NOW - 7 * HOUR, NOW), true);
    const next = NOW + 300_000;
    // Unless that pass is past the next turn too.
    const turn = Array.from({ length: 72 }, (_, i) => NOW + i * 300_000).find((t) =>
      gapsDue("test/a", t, t + 300_000),
    )!;
    assert.equal(gapsDue("test/a", NOW, next), turn === NOW);
  });

  it("spreads a source's stations over the six hours", () => {
    const first = Array.from({ length: 200 }, (_, i) => {
      const id = `test/${1000 + i * 7}`;
      let t = NOW;
      while (!gapsDue(id, t - 300_000, t)) t += 300_000;
      return t - NOW;
    });
    // No hour of the six takes more than a third of them.
    for (let h = 0; h < 6; h++)
      assert.ok(first.filter((t) => Math.floor(t / HOUR) === h).length < 67);
  });
});

describe("pollSource for a source that fills values in late", () => {
  const day = 24 * HOUR;
  const a = station("a", { min_interval_s: 300 });
  // A week of values every 10 minutes, and the day of them the source first lacked.
  const all: Observation[] = [];
  for (let t = NOW - 8 * day; t < NOW; t += 600_000) all.push(at(t, 1));
  const outage = (o: Observation) => o.time >= NOW - 2 * day && o.time < NOW - day;
  // A pass in the station's turn, five minutes after the last, and one outside it.
  let turn = NOW;
  while (!gapsDue(a.id, turn - 300_000, turn)) turn += 300_000;
  const other = turn + 300_000;

  /** A store holding everything but the outage, and a source that sends `sends`, recording where each fetch started. */
  async function setup(sends: () => Observation[]) {
    const asked: number[] = [];
    const src: Source = {
      ...source({}),
      fillsLate: true,
      observations: async (_, start) => {
        asked.push(start.getTime());
        return sends().filter((o) => o.time >= start.getTime());
      },
    };
    const store = memory();
    await store.write(
      all
        .filter((o) => !outage(o))
        .map((o) => ({ ...o, received: o.time, station: a.id, epoch: 1 })),
    );
    const held = async () => (await store.read([a.id], turn - 7 * day)).length;
    const poll = (now: number, last: number | null) =>
      pollSource({ source: src, stations: [a], store, since: now - 12 * HOUR, now, last });
    return { asked, held, poll };
  }

  it("takes the values a gap has since been filled with, on the station's turn", async () => {
    const { asked, held, poll } = await setup(() => all);
    const before = await held();
    await poll(other, other - 300_000);
    assert.equal(await held(), before);
    await poll(turn, turn - 300_000);
    assert.deepEqual(asked, [other - 12 * HOUR, NOW - 2 * day - 600_000]);
    assert.equal(await held(), before + 144);
  });

  it("takes its turn on the first pass after one a late pass skipped", async () => {
    const { asked, poll } = await setup(() => all);
    await poll(turn + 11 * 60_000, turn - 300_000);
    assert.equal(asked[0], NOW - 2 * day - 600_000);
  });

  it("deletes nothing when a fetch for a gap lacks values the window holds", async () => {
    // The source sends the last hours only, as an answer cut short would be.
    const { held, poll } = await setup(() => all.filter((o) => o.time >= NOW - HOUR));
    const before = await held();
    await poll(turn, turn - 300_000);
    assert.equal(await held(), before);
  });
});
