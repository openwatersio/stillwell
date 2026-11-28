import assert from "node:assert/strict";
import { readBackfilled } from "../src/backfilled.ts";
import { chmodSync, mkdirSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { DatumChanged, isHeld } from "../src/epochs.ts";
import { Blocked, fetchText, setTransport } from "../src/http.ts";
import { upsert } from "../src/store/merge.ts";
import { DuckDBInstance } from "@duckdb/node-api";
import { isMissing } from "../src/store/parquet.ts";
import {
  readDatums,
  readObservations,
  type StationObservation,
  readStationBounds,
  setConnections,
  writeObservations,
  writeRecent,
  writeStationBounds,
} from "../src/store/parquet.ts";
import { boundsPath, recentDayPath, seriesPath } from "../src/store/paths.ts";
import {
  compactRecent,
  formatSummary,
  timer,
  lastDays,
  emptySummary,
  gapStart,
  refreshStation,
  writePreliminary,
  type RunSummary,
} from "../src/store/recent.ts";
import {
  Flag,
  type Epoch,
  type StoredStation,
  type Observation,
  type Source,
  type Station,
} from "../src/schema.ts";
import * as usgs from "../src/sources/usgs/index.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 5, 12);

afterEach(() => {
  setTransport(fetchText);
  setConnections(1);
});

/** A source's bounds without their earliest preliminary value, for the tests of first and last. */
async function firstLast(
  path: string,
): Promise<Map<string, { first: string | null; last: string | null }>> {
  const bounds = await readStationBounds(path);
  return new Map([...bounds].map(([id, { first, last }]) => [id, { first, last }]));
}

function store(): string {
  return mkdtempSync(join(tmpdir(), "stillwell-recent-"));
}

function station(id: string, extra: Partial<StoredStation> = {}): StoredStation {
  const datum = extra.datum ?? "NAP";
  return {
    epochs: [epoch(1, datum)],
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

/** A source whose per-station answers come from `answers`, by station ID. */
function source(answers: Record<string, Observation[] | Error>): Source & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    metadata: { id: "test" } as Source["metadata"],
    stations: async () => [],
    observations: async (s) => {
      asked.push(s.id);
      const answer = answers[s.id] ?? [];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

function epoch(id: number, datum: string, extra: Partial<Epoch> = {}): Epoch {
  return {
    id,
    datum,
    since: null,
    until: null,
    seen: null,
    reference: null,
    reference_since: null,
    datums: {},
    to_current: 0,
    state: "open",
    ...extra,
  };
}

const at = (time: number, level: number, received?: number): Observation =>
  received === undefined
    ? { time, level, flag: Flag.preliminary }
    : { time, level, flag: Flag.preliminary, received };

/**
 * A poller's pass over in-memory windows: a sweep where the source has one, then
 * `refreshStation` for each live, active station with levels, its rows sorted as a daily file's.
 */
async function refresh({
  source,
  stations,
  previous = [],
  since,
}: {
  source: Source;
  stations: StoredStation[];
  previous?: StationObservation[];
  since: Date;
}): Promise<{ rows: StationObservation[]; summary: RunSummary }> {
  const live = stations.filter(
    (s) => s.live && s.status === "active" && s.products.includes("levels"),
  );
  const fetching = live.filter((s) => !isHeld(s.epochs));
  const summary = emptySummary("refresh test", fetching.length);
  let swept: Map<string, Observation[] | Error> | Error | undefined;
  if (source.recent)
    swept = await source
      .recent(fetching, since, new Date(NOW))
      .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
  const had = Map.groupBy(previous, (r) => r.station);
  const rows: StationObservation[] = [];
  for (const station of live) {
    const result = await refreshStation({
      source,
      station,
      previous: had.get(station.id) ?? [],
      swept,
      since: since.getTime(),
      now: NOW,
      keepFrom: NOW - 7 * DAY,
      summary,
    });
    rows.push(...result.rows);
    if (result.fresh) summary.updated++;
  }
  rows.sort((a, b) => (a.station < b.station ? -1 : a.station > b.station ? 1 : a.time - b.time));
  return { rows, summary };
}

describe("refreshStation", () => {
  it("says when the source blocked this client", async () => {
    const [a, b] = [station("a"), station("b")];
    const { summary } = await refresh({
      source: source({ [a.id]: [at(NOW - HOUR, 0.3)], [b.id]: new Blocked("refused") }),
      stations: [a, b],
      since: new Date(NOW - 6 * HOUR),
    });
    assert.equal(summary.blocked, true);
    assert.equal(summary.updated, 1);
  });

  it("says when a station failed because its source moved it to another datum", async () => {
    const [a, b] = [station("a"), station("b")];
    const run = async (answer: Error) =>
      (
        await refresh({
          source: source({ [a.id]: [at(NOW - HOUR, 0.3)], [b.id]: answer }),
          stations: [a, b],
          since: new Date(NOW - 6 * HOUR),
        })
      ).summary;
    assert.equal((await run(new DatumChanged("now in NHN", "NHN"))).datumChanged, true);
    assert.equal((await run(new Error("timed out"))).datumChanged, undefined);
    // A rejected change stays rejected, however often the list is
    // refreshed, but a change to another datum or reference still asks for one.
    b.epochs.push(epoch(2, "NHN", { state: "rejected" }));
    assert.equal((await run(new DatumChanged("now in NHN", "NHN", null))).datumChanged, undefined);
    assert.equal((await run(new DatumChanged("now in NN", "NN", null))).datumChanged, true);
    b.epochs.push(epoch(3, "PNP", { state: "rejected", reference: "2020-01-01" }));
    assert.equal(
      (await run(new DatumChanged("now in PNP", "PNP", "2020-01-01"))).datumChanged,
      undefined,
    );
    assert.equal(
      (await run(new DatumChanged("now in PNP", "PNP", "2024-06-01"))).datumChanged,
      true,
    );
    assert.equal((await run(new DatumChanged("now in PNP", "PNP"))).datumChanged, true);
  });

  it("merges the fetch into the window, trims it, and stamps only new values", async () => {
    const a = station("a");
    const { rows, summary } = await refresh({
      source: source({ [a.id]: [at(NOW - 3 * HOUR, 0.25), at(NOW - HOUR, 0.3)] }),
      stations: [a],
      previous: [
        { ...at(NOW - 8 * DAY, 0.1, NOW - 8 * DAY), station: a.id, epoch: 1 }, // past the 7 days
        // Before the fetch, with a flag QC may have marked.
        {
          ...at(NOW - 10 * HOUR, 0.15, NOW - 10 * HOUR),
          flag: Flag.suspect,
          station: a.id,
          epoch: 1,
        },
        { ...at(NOW - 3 * HOUR, 0.2, NOW - 3 * HOUR), station: a.id, epoch: 1 }, // seen before
      ],
      since: new Date(NOW - 6 * HOUR),
    });
    assert.deepEqual(
      rows.map((r) => [r.time - NOW, r.level, r.received! - NOW, r.source_flag]),
      [
        // Only fetched values carry the source's flag.
        [-10 * HOUR, 0.15, -10 * HOUR, undefined],
        // A revised value takes the new level and keeps its first arrival.
        [-3 * HOUR, 0.25, -3 * HOUR, Flag.preliminary],
        [-HOUR, 0.3, 0, Flag.preliminary],
      ],
    );
    assert.deepEqual(
      [summary.updated, summary.values, summary.stale, summary.failed],
      [1, 1, [], []],
    );
  });

  it("keeps a failed or silent station's window, and counts it failed or stale", async () => {
    const [ok, broken, quiet] = [station("ok"), station("broken"), station("quiet")];
    const old = (s: Station) => ({
      ...at(NOW - 10 * HOUR, 1, NOW - 10 * HOUR),
      station: s.id,
      epoch: 1,
    });
    const src = source({ [ok.id]: [at(NOW - HOUR, 2)], [broken.id]: new Error("timed out") });
    const { rows, summary } = await refresh({
      source: src,
      stations: [ok, broken, quiet],
      previous: [old(broken), old(quiet)],
      since: new Date(NOW - 6 * HOUR),
    });
    assert.deepEqual(src.asked.sort(), ["test/broken", "test/ok", "test/quiet"]);
    assert.deepEqual(
      rows.map((r) => [r.station, r.level]),
      [
        ["test/broken", 1],
        ["test/ok", 2],
        ["test/quiet", 1],
      ],
    );
    assert.deepEqual(summary.failed, ["test/broken: timed out"]);
    // Ten hours is stale for a 10-minute gauge; a daily one has three days.
    assert.deepEqual(summary.stale, ["test/quiet"]);
    assert.equal(summary.updated, 1);
  });

  it("gives a station three of its intervals before it's stale", async () => {
    const daily = station("daily", { interval_s: 86_400 });
    const { summary } = await refresh({
      source: source({}),
      stations: [daily],
      previous: [{ ...at(NOW - 2 * DAY, 1, NOW - 2 * DAY), station: daily.id, epoch: 1 }],
      since: new Date(NOW - 6 * HOUR),
    });
    assert.deepEqual(summary.stale, []);
  });

  it("tags rows with their epoch, and fetches only from the current epoch's start", async () => {
    const since = NOW - 3 * HOUR;
    const moved = station("moved", {
      datum: "NHN",
      epochs: [
        epoch(1, "PNP", { state: "closed", until: new Date(since).toISOString() }),
        epoch(2, "NHN", { since: new Date(since).toISOString() }),
      ],
    });
    const held = station("held", {
      epochs: [
        epoch(1, "NAP"),
        epoch(2, "MSL", { state: "held", since: new Date(since).toISOString() }),
      ],
    });
    const asked: [string, number][] = [];
    const src = source({ [moved.id]: [at(NOW - 2 * HOUR, 2), at(NOW - HOUR, 4)] });
    const observations = src.observations!;
    src.observations = (s, from, to) => {
      asked.push([s.id, (NOW - from.getTime()) / HOUR]);
      return observations(s, from, to);
    };
    const { rows } = await refresh({
      source: src,
      stations: [moved, held],
      previous: [
        { ...at(NOW - 5 * HOUR, 1, NOW - 5 * HOUR), station: moved.id, epoch: 1 },
        // Fetched in the new reference before the epoch opened: it moves into it.
        { ...at(NOW - 2 * HOUR, 2, NOW - 2 * HOUR), station: moved.id, epoch: 1 },
        { ...at(NOW - 2 * HOUR, 3, NOW - 2 * HOUR), station: held.id, epoch: 1 },
      ],
      since: new Date(NOW - 12 * HOUR),
    });
    assert.deepEqual(asked, [["test/moved", 3]]);
    assert.deepEqual(
      rows.map((r) => [r.station, (NOW - r.time) / HOUR, r.epoch, (NOW - r.received!) / HOUR]),
      [
        ["test/held", 2, 1, 2],
        ["test/moved", 5, 1, 5],
        // It keeps its first arrival in its new epoch.
        ["test/moved", 2, 2, 2],
        ["test/moved", 1, 2, 0],
      ],
    );
  });

  it("looks back two intervals for a station fetched on its own", async () => {
    const asked: [string, number][] = [];
    const daily = station("daily", { interval_s: 86_400 });
    const { rows } = await refresh({
      source: {
        metadata: { id: "test" } as Source["metadata"],
        stations: async () => [],
        observations: async (s, from) => {
          asked.push([s.id, (NOW - from.getTime()) / HOUR]);
          // Published hours after it was measured.
          return [at(NOW - 20 * HOUR, 1)];
        },
      },
      stations: [daily, station("tenminute")],
      since: new Date(NOW - 12 * HOUR),
    });
    assert.deepEqual(asked.sort(), [
      ["test/daily", 48],
      ["test/tenminute", 12],
    ]);
    assert.deepEqual(
      rows.map((r) => r.station),
      ["test/daily"],
    );
  });

  it("fetches from a gap in the window for a source that fills values in late", async () => {
    const a = station("a");
    const asked: number[] = [];
    const filled = [at(NOW - 2 * DAY, 0.2), at(NOW - 2 * DAY + 600_000, 0.25), at(NOW - HOUR, 0.3)];
    const previous: StationObservation[] = [];
    const src: Source = {
      ...source({}),
      // What the window holds, and what the gap has since been filled with.
      observations: async (_, start) => {
        asked.push(start.getTime());
        return [...previous.map((r) => at(r.time, r.level)), ...filled]
          .filter((o) => o.time >= start.getTime())
          .sort((x, y) => x.time - y.time);
      },
    };
    // Every 10 minutes for 7 days, but for a day that ended a day ago.
    for (let t = NOW - 7 * DAY; t < NOW - HOUR; t += 600_000)
      if (t < NOW - 2 * DAY || t >= NOW - DAY)
        previous.push({ ...at(t, 0.1, t), station: a.id, epoch: 1 });
    const run = async (gapsFrom?: number) => {
      const summary = emptySummary("gaps", 1);
      const { rows } = await refreshStation({
        source: src,
        station: a,
        previous,
        swept: undefined,
        since: NOW - 6 * HOUR,
        now: NOW,
        keepFrom: NOW - 7 * DAY,
        gapsFrom,
        summary,
      });
      return { rows, summary };
    };
    // Outside the station's turn, the usual look-back.
    await run();
    assert.deepEqual(asked, [NOW - 6 * HOUR]);
    const { rows, summary } = await run(NOW - 5 * DAY);
    assert.equal(asked[1], NOW - 2 * DAY - 600_000);
    // The values the gap now has arrive as new, and those before it stay.
    const got = rows.filter((r) => r.received === NOW).map((r) => r.time - NOW);
    assert.deepEqual(got, [-2 * DAY, -2 * DAY + 600_000, -HOUR]);
    assert.equal(summary.values, 3);
    assert.equal(rows.filter((r) => r.time < NOW - 2 * DAY).length, 5 * 144);
    // Never from before the current epoch's start, nor for a station whose new epoch is held.
    const begins = NOW - 36 * HOUR;
    a.epochs = [epoch(1, "NAP", { since: new Date(begins).toISOString() })];
    await run(NOW - 5 * DAY);
    assert.equal(asked[2], begins);
    a.epochs = [epoch(1, "NAP"), epoch(2, "NAP", { state: "held" })];
    await run(NOW - 5 * DAY);
    assert.equal(asked.length, 3);
  });

  it("keeps every station's window when a sweep throws", async () => {
    const [a, b] = [station("a"), station("b")];
    const { rows, summary } = await refresh({
      source: {
        ...source({}),
        recent: async () => {
          throw new Error("sweep down");
        },
      },
      stations: [a, b],
      previous: [a, b].map((s) => ({
        ...at(NOW - 2 * HOUR, 1, NOW - 2 * HOUR),
        station: s.id,
        epoch: 1,
      })),
      since: new Date(NOW - 6 * HOUR),
    });
    assert.deepEqual(summary.failed, ["test/a: sweep down", "test/b: sweep down"]);
    assert.equal(rows.length, 2);
  });

  it("takes USGS's batched sweep, one request for every station", async () => {
    usgs.pacing.requestMs = 0;
    const asked: string[] = [];
    setTransport(async (url) => {
      asked.push(url);
      const v = (time_series_id: string, time: number, value: string) => ({
        type: "Feature",
        properties: {
          time_series_id,
          time: new Date(time).toISOString(),
          value,
          approval_status: "Provisional",
          qualifier: null,
        },
        geometry: null,
      });
      return JSON.stringify({
        type: "FeatureCollection",
        features: [
          v("a-00065", NOW - 2 * HOUR, "10.00"),
          v("a-00065", NOW - HOUR, "10.50"),
          v("b-00065", NOW - HOUR, "3.00"),
          v("someone-else", NOW - HOUR, "1.00"),
        ],
        numberReturned: 4,
        links: [],
      });
    });
    const gage = (id: string, extra: object = {}) =>
      station(id, {
        id: `usgs/${id}`,
        source: "usgs",
        datum: "GAGE",
        interval_s: null,
        kind: "river",
        ...extra,
        ...({ time_series_id: `${id}-00065`, parameter_code: "00065" } as object),
      });
    const { rows, summary } = await refresh({
      source: usgs.source,
      // c answers nothing; d is committed in another datum and fails alone.
      stations: [gage("a"), gage("b"), gage("c"), gage("d", { datum: "NAVD88" })],
      since: new Date(NOW - 6 * HOUR),
    });
    assert.equal(asked.length, 1);
    assert.match(asked[0]!, /collections\/continuous\/items\?.*parameter_code=00065/);
    assert.deepEqual(
      rows.map((r) => [r.station, (r.time - NOW) / HOUR, r.level, r.received]),
      [
        ["usgs/a", -2, 3.048, NOW],
        ["usgs/a", -1, 3.2004, NOW],
        ["usgs/b", -1, 0.9144, NOW],
      ],
    );
    assert.equal(summary.values, 3);
    assert.equal(summary.updated, 2);
    assert.deepEqual(summary.stale, ["usgs/c"]);
    assert.deepEqual(summary.failed, ["usgs/d: usgs/d is in NAVD88; its USGS series is in GAGE"]);
  });

  it("keeps every station's window when USGS's sweep fails", async () => {
    usgs.pacing.requestMs = 0;
    setTransport(async () =>
      JSON.stringify({ type: "FeatureCollection", features: [], numberReturned: 0, links: [] }),
    );
    const a = station("a", {
      id: "usgs/a",
      source: "usgs",
      datum: "GAGE",
      ...({ time_series_id: "a-00065", parameter_code: "00065" } as object),
    });
    const { rows, summary } = await refresh({
      source: usgs.source,
      stations: [a],
      previous: [{ ...at(NOW - 2 * HOUR, 1, NOW - 2 * HOUR), station: a.id, epoch: 1 }],
      since: new Date(NOW - 6 * HOUR),
    });
    assert.match(summary.failed[0]!, /usgs\/a: USGS returned no values/);
    assert.equal(rows.length, 1);
  });
});

/** Rows written to the daily files of their UTC days, as the poller writes them. */
async function writeDays(root: string, batches: StationObservation[][]): Promise<void> {
  const days = Map.groupBy(batches.flat(), (r) => new Date(r.time).toISOString().slice(0, 10));
  for (const [day, rows] of days) await writeRecent(recentDayPath(root, "test", day), [rows]);
}

describe("gapStart", () => {
  const MIN = 60_000;
  const from = NOW - 5 * DAY;
  const since = NOW - 12 * HOUR;
  // A value every 10 minutes over [a, b).
  const run = (a: number, b: number) =>
    Array.from({ length: Math.ceil((b - a) / (10 * MIN)) }, (_, i) => a + i * 10 * MIN);
  const find = (times: number[], extra: Partial<Parameters<typeof gapStart>[1]> = {}) =>
    gapStart(times, { interval_s: 600, from, since, ...extra });

  it("finds nothing in a window with every value", () => {
    assert.equal(find(run(NOW - 7 * DAY, NOW)), null);
  });

  it("starts at the value before the first break longer than three intervals and half an hour", () => {
    const stopped = NOW - 3 * DAY;
    const times = [...run(NOW - 7 * DAY, stopped), ...run(stopped + 50 * MIN, NOW)];
    assert.equal(find(times), stopped - 10 * MIN);
    // Two missing values are a break of three intervals, which is no gap.
    const short = [...run(NOW - 7 * DAY, stopped), ...run(stopped + 20 * MIN, NOW)];
    assert.equal(find(short), null);
    // Half an hour is over three of a 1-minute gauge's intervals, and no longer than half an hour.
    assert.equal(find(short, { interval_s: 60 }), null);
    assert.equal(
      find([...run(NOW - 7 * DAY, stopped), ...run(stopped + 30 * MIN, NOW)], { interval_s: 60 }),
      stopped - 10 * MIN,
    );
  });

  it("looks between values only where the interval is known", () => {
    const stopped = NOW - 3 * DAY;
    const times = [...run(NOW - 7 * DAY, stopped), ...run(stopped + DAY, NOW)];
    assert.equal(find(times, { interval_s: null }), null);
  });

  it("starts where a station stopped, whatever its interval", () => {
    const stopped = NOW - 2 * DAY;
    assert.equal(find(run(NOW - 7 * DAY, stopped)), stopped - 10 * MIN);
    assert.equal(find(run(NOW - 7 * DAY, stopped), { interval_s: null }), stopped - 10 * MIN);
    // Within the usual look-back, the usual fetch covers it.
    assert.equal(find(run(NOW - 7 * DAY, NOW - HOUR)), null);
  });

  it("asks nothing from before `from`", () => {
    // A break that ended before it is past repair.
    const old = [...run(NOW - 7 * DAY, NOW - 6.5 * DAY), ...run(NOW - 6 * DAY, NOW)];
    assert.equal(find(old), null);
    // One that spans it is asked from there, as is a window that starts after it.
    const spans = [...run(NOW - 7 * DAY, NOW - 6 * DAY), ...run(NOW - 4 * DAY, NOW)];
    assert.equal(find(spans), from);
    assert.equal(find(run(NOW - 4 * DAY, NOW)), from);
    // A break across it is measured from the value before it, not from it.
    const across = [...run(NOW - 7 * DAY, from - 20 * MIN), ...run(from + 20 * MIN, NOW)];
    assert.equal(find(across), from);
    // A station that stopped before it is asked from there too.
    assert.equal(find(run(NOW - 7 * DAY, NOW - 6 * DAY)), from);
  });

  it("asks a station with no values for all of it", () => {
    assert.equal(find([]), from);
    assert.equal(find([], { interval_s: null }), from);
  });
});

describe("compactRecent", () => {
  const [start, end] = lastDays(NOW);

  it("is the whole UTC days before now", () => {
    assert.deepEqual(
      [start, end].map((t) => new Date(t).toISOString()),
      ["2026-11-04T00:00:00.000Z", "2026-11-05T00:00:00.000Z"],
    );
    assert.equal(new Date(lastDays(NOW, 6)[0]).toISOString(), "2026-10-30T00:00:00.000Z");
  });

  it("records a year it folds a station's values from its first hour of, and no other", async () => {
    const root = store();
    const a = station("a");
    const day = Date.UTC(2027, 0, 1);
    await writeDays(root, [
      [
        { ...at(day - HOUR, 1, day), station: a.id, epoch: 1 },
        { ...at(day + 10 * 60_000, 1, day + HOUR), station: a.id, epoch: 1 },
        { ...at(day + DAY + HOUR, 1, day + DAY + HOUR), station: a.id, epoch: 1 },
      ],
    ]);
    const fold = (from: number) =>
      compactRecent({
        source: source({}),
        stations: [a],
        storeFor: () => root,
        start: from,
        end: from + DAY,
      });
    await fold(day - DAY);
    assert.equal((await readBackfilled(root, "test")).size, 0);
    await fold(day + DAY);
    assert.equal((await readBackfilled(root, "test")).size, 0);
    await fold(day);
    assert.deepEqual([...(await readBackfilled(root, "test")).get(a.id)!], [[1, [[2027, 2028]]]]);
  });

  it("takes a station with no interval to step by its values' shortest gap", async () => {
    const root = store();
    const b = station("b", { interval_s: null });
    const day = Date.UTC(2027, 0, 1);
    // Two-hourly, from 02:00.
    await writeDays(root, [
      [2, 4, 6].map((h) => ({ ...at(day + h * HOUR, 1, day + h * HOUR), station: b.id, epoch: 1 })),
    ]);
    await compactRecent({
      source: source({}),
      stations: [b],
      storeFor: () => root,
      start: day,
      end: day + DAY,
    });
    assert.deepEqual([...(await readBackfilled(root, "test")).get(b.id)!], [[1, [[2027, 2028]]]]);
  });

  it("drops a stored level outside the span among the rows it folds", async () => {
    setConnections(4);
    const root = store();
    const a = station("a");
    const file = seriesPath(root, "levels", "test", "a", 2026);
    await writeObservations(
      file,
      [
        at(start - DAY, 30479.695), // before the fold, and all the file held before it
        at(start + HOUR, 0.6),
        at(start + 2 * HOUR, 30479.695), // USACE's 99,999 ft, which the window doesn't bring again
      ],
      "NAP",
    );
    await writeDays(root, [
      [
        { ...at(start + HOUR, 0.65, start + 3 * HOUR), station: a.id, epoch: 1 },
        // Fetched before fetches dropped such levels.
        { ...at(start + 3 * HOUR, -2438.095, start + 4 * HOUR), station: a.id, epoch: 1 },
      ],
    ]);
    await compactRecent({ source: source({}), stations: [a], storeFor: () => root, start, end });
    assert.deepEqual(
      (await readObservations(file)).map((r) => [
        r.time - start,
        r.level > 9000 ? "fill" : r.level,
      ]),
      // The earlier fill goes too, since the file would otherwise hold fill beside levels.
      [[HOUR, 0.65]],
    );
  });

  it("counts the levels a fold leaves out, and says when a year holds nothing else", async () => {
    setConnections(4);
    const root = store();
    const a = station("a");
    const file = seriesPath(root, "levels", "test", "a", 2026);
    await writeObservations(file, [at(start + HOUR, 0.6), at(start + 2 * HOUR, 30479.695)], "NAP");
    await writeDays(root, [
      [
        { ...at(start + HOUR, 0.65, start + 3 * HOUR), station: a.id, epoch: 1 },
        { ...at(start + 3 * HOUR, -2438.095, start + 4 * HOUR), station: a.id, epoch: 1 },
      ],
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [a],
      storeFor: () => root,
      start,
      end,
    });
    assert.deepEqual([summary.dropped!.below, summary.dropped!.above], [1, 1]);
    assert.match(formatSummary(summary), /Left out 2 levels outside −500 to 9,000 m/);

    const b = station("b");
    const only = seriesPath(root, "levels", "test", "b", 2026);
    await writeObservations(only, [at(start + 2 * HOUR, 30479.695)], "NAP");
    await writeDays(root, [
      [{ ...at(start + HOUR, 30479.695, start + 3 * HOUR), station: b.id, epoch: 1 }],
    ]);
    const kept = await compactRecent({
      source: source({}),
      stations: [b],
      storeFor: () => root,
      start,
      end,
    });
    assert.match(kept.warned!.join(), /b 2026: holds only 2 levels outside −500 to 9,000 m/);
  });

  it("replaces a year of fill with the levels a fold brings, so a file never holds both", async () => {
    setConnections(4);
    const root = store();
    const a = station("a");
    const file = seriesPath(root, "levels", "test", "a", 2026);
    // Fill from before the fold's start, as a backfill of a year of nothing else leaves it.
    await writeObservations(
      file,
      [at(start - 3 * DAY, 30479.695), at(start - 2 * DAY, 30479.695)].map((r) => ({
        ...r,
        flag: Flag.bad,
      })),
      "NAP",
    );
    await writeDays(root, [
      [{ ...at(start + HOUR, 0.65, start + 3 * HOUR), station: a.id, epoch: 1 }],
    ]);
    const folded = await compactRecent({
      source: source({}),
      stations: [a],
      storeFor: () => root,
      start,
      end,
    });
    assert.deepEqual(
      (await readObservations(file)).map((r) => r.level),
      [0.65],
    );
    // The two fill rows it replaced are counted.
    assert.equal(folded.dropped!.count, 2);
  });

  it("leaves a year file as it is when every row it would fold is outside the span", async () => {
    setConnections(4);
    const root = store();
    const a = station("a");
    const file = seriesPath(root, "levels", "test", "a", 2026);
    // The stored fill comes after the window's first row, so the fold reads it.
    await writeObservations(file, [at(start + 2 * HOUR, 30479.695)], "NAP");
    await writeDays(root, [
      [{ ...at(start + HOUR, 30479.695, start + 3 * HOUR), station: a.id, epoch: 1 }],
    ]);
    await compactRecent({ source: source({}), stations: [a], storeFor: () => root, start, end });
    assert.deepEqual(
      (await readObservations(file)).map((r) => r.time - start),
      [2 * HOUR],
    );
  });

  it("folds yesterday into the year file, carrying received and keeping what it had", async () => {
    setConnections(4);
    const root = store();
    const a = station("a");
    const file = seriesPath(root, "levels", "test", "a", 2026);
    await writeObservations(
      file,
      [
        at(start - DAY, 0.5), // backfilled history
        at(start + HOUR, 0.6), // backfilled before the window saw it arrive
        at(start + 2 * HOUR, 0.7, start + 2 * HOUR), // the recent window lost it
      ],
      "NAP",
    );
    await writeDays(root, [
      [
        { ...at(start - HOUR, 9, start), station: a.id, epoch: 1 }, // the day before: not folded
        { ...at(start + HOUR, 0.65, start + 3 * HOUR), station: a.id, epoch: 1 },
        { ...at(start + 3 * HOUR, 0.8, start + 4 * HOUR), station: a.id, epoch: 1 },
        { ...at(end, 9, end), station: a.id, epoch: 1 }, // today: not folded
      ],
    ]);
    const run = () =>
      compactRecent({ source: source({}), stations: [a], storeFor: () => root, start, end });
    const { seconds, ...summary } = await run();
    // Each phase reaches the summary; with no years file, the reconcile stops after reading it.
    assert.deepEqual(Object.keys(seconds!), [
      "read window",
      "mark years",
      "fold",
      "commit years",
      "bounds: read bounds",
      "bounds: list files",
      "bounds: read files",
      "bounds: write bounds",
      "reconcile: read years",
    ]);
    assert.deepEqual(
      (await readObservations(file)).map((r) => [r.time - start, r.level, r.received]),
      [
        [-DAY, 0.5, undefined],
        // Its first arrival is unknown, not when the window saw it.
        [HOUR, 0.65, undefined],
        [2 * HOUR, 0.7, start + 2 * HOUR],
        [3 * HOUR, 0.8, start + 4 * HOUR],
      ],
    );
    assert.deepEqual(
      {
        ...summary,
        stale: summary.stale.length,
        failed: summary.failed.length,
        waiting: summary.waiting.length,
      },
      {
        title: "compact test",
        stations: 1,
        updated: 1,
        stale: 0,
        failed: 0,
        waiting: 0,
        values: 2,
        files: 1,
      },
    );

    // A rerun changes nothing, so it writes nothing.
    const written = statSync(file).mtimeMs;
    const again = await run();
    assert.equal(again.files, 0);
    assert.equal(statSync(file).mtimeMs, written);
  });

  it("folds each day it covers from that day's file, a day with no file having nothing", async () => {
    const root = store();
    const a = station("a");
    const [from, to] = lastDays(NOW, 3);
    const day = (n: number) => new Date(from + n * DAY).toISOString().slice(0, 10);
    const row = (time: number, level: number) => ({
      ...at(time, level, time),
      station: a.id,
      epoch: 1,
    });
    // The first and last of the three days; the second has no file.
    await writeRecent(recentDayPath(root, "test", day(0)), [[row(from + HOUR, 1)]]);
    await writeRecent(recentDayPath(root, "test", day(2)), [[row(from + 2 * DAY + HOUR, 3)]]);
    // Days outside the fold aren't read.
    await writeRecent(recentDayPath(root, "test", day(-1)), [[row(from - DAY + HOUR, 9)]]);
    await writeRecent(recentDayPath(root, "test", day(3)), [[row(to + HOUR, 9)]]);
    const summary = await compactRecent({
      source: source({}),
      stations: [a],
      storeFor: () => root,
      start: from,
      end: to,
    });
    assert.deepEqual([summary.failed, summary.stale, summary.values], [[], [], 2]);
    assert.deepEqual(
      (await readObservations(seriesPath(root, "levels", "test", "a", 2026))).map((r) => [
        (r.time - from) / HOUR,
        r.level,
      ]),
      [
        [1, 1],
        [49, 3],
      ],
    );

    // With no file for any day it covers, a live station is stale.
    const quiet = await compactRecent({
      source: source({}),
      stations: [a],
      storeFor: () => root,
      start: from + DAY,
      end: from + 2 * DAY,
    });
    assert.deepEqual([quiet.failed, quiet.stale, quiet.values], [[], [a.id], 0]);
  });

  it("writes each station's first and last over its epochs to the source's bounds", async () => {
    const root = store();
    const a = station("a", {
      datum: "NHN",
      epochs: [epoch(1, "NAP", { state: "closed" }), epoch(2, "NHN")],
    });
    const quiet = station("quiet", { live: false });
    const empty = station("empty");
    const march2020 = Date.UTC(2020, 2, 1);
    // Backfilled years, in epoch 1, written without compaction.
    await writeObservations(
      seriesPath(root, "levels", "test", "a", 2020),
      [at(march2020, 1), at(march2020 + DAY, 1)],
      "NAP",
    );
    await writeObservations(
      seriesPath(root, "levels", "test", "a", 2026, 2),
      [at(start - DAY, 2)],
      "NHN",
    );
    await writeObservations(
      seriesPath(root, "levels", "test", "quiet", 2024),
      [at(Date.UTC(2024, 4, 1), 3), at(Date.UTC(2024, 5, 1), 3)],
      "NAP",
    );
    await writeDays(root, [
      [{ ...at(start + 3 * HOUR, 2, start + 3 * HOUR), station: a.id, epoch: 2 }],
    ]);
    const run = () =>
      compactRecent({
        source: source({}),
        stations: [a, quiet, empty],
        storeFor: () => root,
        start,
        end,
      });
    const path = boundsPath(root, "test");

    await run();
    assert.deepEqual(
      await firstLast(path),
      new Map([
        [a.id, { first: "2020-03-01T00:00:00Z", last: "2026-11-04T03:00:00Z" }],
        [quiet.id, { first: "2024-05-01T00:00:00Z", last: "2024-06-01T00:00:00Z" }],
      ]),
    );

    // A backfill of earlier years moves first; the next fold moves last.
    await writeObservations(
      seriesPath(root, "levels", "test", "a", 2019),
      [at(Date.UTC(2019, 6, 1), 1)],
      "NAP",
    );
    await writeDays(root, [
      [{ ...at(start + 5 * HOUR, 2, start + 5 * HOUR), station: a.id, epoch: 2 }],
    ]);
    await run();
    assert.deepEqual((await firstLast(path)).get(a.id), {
      first: "2019-07-01T00:00:00Z",
      last: "2026-11-04T05:00:00Z",
    });

    // A backfill within this year's file is seen, folded or not.
    const fresh = station("fresh", { live: false });
    await writeObservations(
      seriesPath(root, "levels", "test", "fresh", 2026),
      [at(start - 10 * DAY, 4)],
      "NAP",
    );
    await writeObservations(
      seriesPath(root, "levels", "test", "a", 2026, 2),
      [at(Date.UTC(2026, 0, 5), 2), at(start - DAY, 2)],
      "NHN",
    );
    const withFresh = (rebuildBounds = false) =>
      compactRecent({
        source: source({}),
        stations: [a, quiet, empty, fresh],
        storeFor: () => root,
        start,
        end,
        rebuildBounds,
      });
    await withFresh();
    await writeObservations(
      seriesPath(root, "levels", "test", "fresh", 2026),
      [at(start - 20 * DAY, 4), at(start - 10 * DAY, 4)],
      "NAP",
    );
    await withFresh();
    assert.deepEqual((await firstLast(path)).get(fresh.id), {
      first: "2026-10-15T00:00:00Z",
      last: "2026-10-25T00:00:00Z",
    });

    // A bound in a station's first or last year, before last year, is kept
    // without reading its files, until a rebuild.
    await writeStationBounds(path, [
      { id: quiet.id, first: "2024-01-02T00:00:00Z", last: "2024-12-30T00:00:00Z" },
    ]);
    await withFresh();
    const kept = await firstLast(path);
    assert.deepEqual(kept.get(quiet.id), {
      first: "2024-01-02T00:00:00Z",
      last: "2024-12-30T00:00:00Z",
    });
    assert.equal(kept.get(a.id)?.last, "2026-11-04T05:00:00Z");
    await withFresh(true);
    assert.deepEqual((await firstLast(path)).get(quiet.id), {
      first: "2024-05-01T00:00:00Z",
      last: "2024-06-01T00:00:00Z",
    });
  });

  it("bounds a station by the rows its epochs count", async () => {
    const root = store();
    const b = station("b", {
      datum: "NHN",
      epochs: [
        epoch(1, "NAP", { state: "closed", until: "2020-06-01T00:00:00Z" }),
        epoch(2, "NHN", { since: "2020-07-01T00:00:00Z" }),
        epoch(3, "PNP", { state: "held", since: "2026-01-01T00:00:00Z" }),
      ],
    });
    const write = (year: number, epochId: number, times: number[]) =>
      writeObservations(
        seriesPath(root, "levels", "test", "b", year, epochId),
        times.map((t) => at(t, 1)),
        "NAP",
      );
    await write(2019, 1, [Date.UTC(2019, 11, 1)]);
    await write(2020, 1, [Date.UTC(2020, 5, 15)]); // after epoch 1's until
    await write(2020, 2, [Date.UTC(2020, 5, 20), Date.UTC(2020, 7, 1)]); // the first is before its since
    await write(2026, 3, [Date.UTC(2026, 1, 1)]); // held
    await write(2027, 9, [Date.UTC(2027, 1, 1)]); // an epoch the list doesn't have
    await compactRecent({ source: source({}), stations: [b], storeFor: () => root, start, end });
    assert.deepEqual((await firstLast(boundsPath(root, "test"))).get(b.id), {
      first: "2019-12-01T00:00:00Z",
      last: "2020-08-01T00:00:00Z",
    });
  });

  it("moves an end a year inward when its year holds no counted rows", async () => {
    const root = store();
    const c = station("c", {
      datum: "NHN",
      epochs: [
        epoch(1, "NAP", { state: "closed", until: "2020-06-01T00:00:00Z" }),
        epoch(2, "NHN", { since: "2021-01-01T00:00:00Z" }),
      ],
    });
    const write = (year: number, epochId: number, time: number) =>
      writeObservations(
        seriesPath(root, "levels", "test", "c", year, epochId),
        [at(time, 1)],
        "NAP",
      );
    await write(2018, 1, Date.UTC(2018, 8, 1));
    await write(2022, 2, Date.UTC(2022, 3, 1));
    await write(2023, 1, Date.UTC(2023, 3, 1)); // after epoch 1's until
    await compactRecent({ source: source({}), stations: [c], storeFor: () => root, start, end });
    assert.deepEqual((await firstLast(boundsPath(root, "test"))).get(c.id), {
      first: "2018-09-01T00:00:00Z",
      last: "2022-04-01T00:00:00Z",
    });
  });

  it("keeps the bounds when the listing finds no files", async () => {
    const root = store();
    const path = boundsPath(root, "test");
    const had = { id: "test/a", first: "2020-01-01T00:00:00Z", last: "2020-02-01T00:00:00Z" };
    await writeStationBounds(path, [had]);
    const summary = await compactRecent({
      source: source({}),
      stations: [station("a", { live: false })],
      storeFor: () => root,
      start,
      end,
    });
    assert.match(summary.failed[0]!, /^bounds: no test files listed/);
    const rebuilt = await compactRecent({
      source: source({}),
      stations: [station("a", { live: false })],
      storeFor: () => root,
      start,
      end,
      rebuildBounds: true,
    });
    assert.match(rebuilt.failed[0]!, /^bounds: no test files listed/);
    assert.deepEqual((await firstLast(path)).get(had.id), {
      first: had.first,
      last: had.last,
    });
  });

  it("doesn't bound a station by a value whose write failed", async () => {
    const root = store();
    const a = station("a");
    const file = seriesPath(root, "levels", "test", "a", 2026);
    await writeObservations(file, [at(start - DAY, 1)], "NAP");
    await writeDays(root, [[{ ...at(start + HOUR, 1, start + HOUR), station: a.id, epoch: 1 }]]);
    // A read-only file in a read-only directory makes the write fail.
    chmodSync(file, 0o444);
    chmodSync(dirname(file), 0o555);
    try {
      const summary = await compactRecent({
        source: source({}),
        stations: [a],
        storeFor: () => root,
        start,
        end,
      });
      assert.equal(summary.failed.length, 1);
    } finally {
      chmodSync(dirname(file), 0o755);
      chmodSync(file, 0o644);
    }
    assert.deepEqual((await firstLast(boundsPath(root, "test"))).get(a.id), {
      first: "2026-11-03T00:00:00Z",
      last: "2026-11-03T00:00:00Z",
    });
  });

  it("keeps each station's earliest preliminary value in its current epoch", async () => {
    const root = store();
    const p = station("p", {
      datum: "NHN",
      live: false,
      epochs: [
        epoch(1, "NAP", { state: "closed", until: "2023-06-01T00:00:00Z" }),
        epoch(2, "NHN", { since: "2023-06-01T00:00:00Z" }),
      ],
    });
    const write = (year: number, epochId: number, rows: Observation[]) =>
      writeObservations(seriesPath(root, "levels", "test", "p", year, epochId), rows, "NAP");
    const good = (time: number): Observation => ({ time, level: 1, flag: Flag.good });
    // Epoch 1's values can't be fetched again, so its preliminary one doesn't count.
    await write(2023, 1, [at(Date.UTC(2023, 1, 1), 1)]);
    await write(2023, 2, [good(Date.UTC(2023, 6, 1))]);
    // QC raised it to suspect, but the source hasn't finalized it.
    await write(2024, 2, [
      good(Date.UTC(2024, 0, 1)),
      { time: Date.UTC(2024, 3, 1), level: 1, flag: Flag.suspect, source_flag: Flag.preliminary },
    ]);
    await write(2025, 2, [at(Date.UTC(2025, 0, 1), 1)]);
    // Before the years the refetch reaches, so not looked for.
    const r = station("r", { live: false });
    await writeObservations(
      seriesPath(root, "levels", "test", "r", 2022),
      [at(Date.UTC(2022, 0, 1), 1)],
      "NAP",
    );
    await writeObservations(
      seriesPath(root, "levels", "test", "r", 2024),
      [at(Date.UTC(2024, 0, 1), 1)],
      "NAP",
    );
    const path = boundsPath(root, "test");
    const run = (rebuildBounds = false) =>
      compactRecent({
        source: source({}),
        stations: [p, r],
        storeFor: () => root,
        start,
        end,
        rebuildBounds,
      });
    const preliminary = async () => (await readStationBounds(path)).get(p.id)?.preliminary;

    // A station new to the bounds has its files read until one holds one.
    // One not in this run, which only backfill has bounded, keeps its row.
    const other = {
      id: "test/other",
      first: null,
      last: null,
      preliminary: "2024-01-01T00:00:00Z",
    };
    await writeStationBounds(path, [other]);
    await run();
    assert.equal(await preliminary(), "2024-04-01T00:00:00Z");
    assert.equal((await readStationBounds(path)).get(r.id)?.preliminary, "2024-01-01T00:00:00Z");
    assert.deepEqual((await readStationBounds(path)).get(other.id), {
      first: null,
      last: null,
      preliminary: other.preliminary,
      screened: null,
    });

    // Once known, it's kept without a read, and a later one folded doesn't move it.
    await write(2024, 2, [good(Date.UTC(2024, 3, 1))]);
    await writeDays(root, [[{ ...at(start + HOUR, 1, start + HOUR), station: p.id, epoch: 2 }]]);
    await run();
    assert.equal(await preliminary(), "2024-04-01T00:00:00Z");

    // One known as none gives way to a folded one; one from an earlier epoch to
    // a read of this epoch's files.
    for (const [known, found] of [
      [null, "2026-11-04T01:00:00Z"],
      ["2023-02-01T00:00:00Z", "2025-01-01T00:00:00Z"],
    ]) {
      await writeStationBounds(path, [
        {
          id: p.id,
          first: "2019-06-01T00:00:00Z",
          last: "2023-01-01T00:00:00Z",
          preliminary: known,
        },
      ]);
      await run();
      assert.equal(await preliminary(), found);
    }

    // A rebuild reads the files again.
    await run(true);
    assert.equal(await preliminary(), "2025-01-01T00:00:00Z");
  });

  it("marks a station screened once a file it reads holds a value the source screened", async () => {
    const root = store();
    const s = station("s", { live: false });
    const path = boundsPath(root, "test");
    await writeObservations(
      seriesPath(root, "levels", "test", "s", 2025),
      [at(Date.UTC(2025, 0, 1), 1)],
      "NAP",
    );
    const run = () =>
      compactRecent({ source: source({}), stations: [s], storeFor: () => root, start, end });
    const screened = async () => (await readStationBounds(path)).get(s.id)?.screened;
    const known = (value: boolean | null) =>
      writeStationBounds(path, [
        {
          id: s.id,
          first: "2025-01-01T00:00:00Z",
          last: "2025-01-01T00:00:00Z",
          preliminary: "2025-01-01T00:00:00Z",
          screened: value,
        },
      ]);
    const fold = (flag: Flag) =>
      writeDays(root, [
        [{ time: start + HOUR, level: 1, flag, received: start + HOUR, station: s.id, epoch: 1 }],
      ]);

    // Only preliminary values folded: still unscreened. A suspect one without
    // a source flag may be QC's alone, so it doesn't count either.
    await known(false);
    await fold(Flag.preliminary);
    await run();
    assert.equal(await screened(), false);
    await fold(Flag.suspect);
    await run();
    assert.equal(await screened(), false);
    // A screened value folded marks it.
    await known(false);
    await fold(Flag.good);
    await run();
    assert.equal(await screened(), true);
    // Once screened, it stays so, though no file read this run holds one.
    await writeObservations(
      seriesPath(root, "levels", "test", "s", 2026),
      [at(start - DAY, 1)],
      "NAP",
    );
    await fold(Flag.preliminary);
    await run();
    assert.equal(await screened(), true);
  });

  it("fills in a bounds file written before preliminary values on a rebuild, from old files too", async () => {
    const root = store();
    const q = station("q", { live: false });
    // Both written by an older build: bounds without `preliminary`, a year file without `source_flag`.
    const path = boundsPath(root, "test");
    const old = seriesPath(root, "levels", "test", "q", 2024);
    mkdirSync(dirname(path), { recursive: true });
    mkdirSync(dirname(old), { recursive: true });
    const db = await (await DuckDBInstance.create(":memory:")).connect();
    await db.run(
      `COPY (SELECT 'test/q' AS id, TIMESTAMPTZ '2024-03-01 00:00:00+00' AS first, TIMESTAMPTZ '2024-03-01 00:00:00+00' AS last) TO '${path}' (FORMAT parquet)`,
    );
    await db.run(
      `COPY (SELECT TIMESTAMPTZ '2024-03-01 00:00:00+00' AS time, 1.5::FLOAT AS level_m, ${Flag.preliminary}::UTINYINT AS flag, 'NAP' AS datum) TO '${old}' (FORMAT parquet)`,
    );
    assert.equal(
      await writePreliminary(root, "test", new Map([[q.id, { preliminary: null }]])),
      false,
    );
    assert.equal((await readStationBounds(path)).get(q.id)?.preliminary, undefined);
    const run = (rebuildBounds = false) =>
      compactRecent({
        source: source({}),
        stations: [q],
        storeFor: () => root,
        start,
        end,
        rebuildBounds,
      });
    // A nightly run leaves it without the column, rather than read every file.
    await run();
    assert.deepEqual((await readStationBounds(path)).get(q.id), {
      first: "2024-03-01T00:00:00Z",
      last: "2024-03-01T00:00:00Z",
      preliminary: undefined,
      screened: null,
    });
    await run(true);
    assert.equal((await readStationBounds(path)).get(q.id)?.preliminary, "2024-03-01T00:00:00Z");
  });

  it("sets the preliminary values and screening backfill read, keeping every other bound", async () => {
    const root = store();
    const path = boundsPath(root, "test");
    const first = "2020-01-01T00:00:00Z";
    const last = "2025-01-01T00:00:00Z";
    await writeStationBounds(path, [
      { id: "test/a", first, last, preliminary: "2024-01-01T00:00:00Z" },
      { id: "test/b", first, last, preliminary: "2024-01-01T00:00:00Z" },
    ]);
    await writePreliminary(
      root,
      "test",
      new Map([
        ["test/a", { preliminary: null, screened: true }],
        ["test/c", { preliminary: Date.UTC(2025, 1, 1), screened: false }],
        // A station with no row and none gets no row.
        ["test/d", { preliminary: null, screened: false }],
      ]),
    );
    assert.deepEqual(
      await readStationBounds(path),
      new Map([
        ["test/a", { first, last, preliminary: null, screened: true }],
        ["test/b", { first, last, preliminary: "2024-01-01T00:00:00Z", screened: null }],
        [
          "test/c",
          { first: null, last: null, preliminary: "2025-02-01T00:00:00Z", screened: false },
        ],
      ]),
    );
  });

  it("splits a range across New Year into each year's file", async () => {
    const root = store();
    const a = station("a");
    const newYear = Date.UTC(2026, 0, 1);
    await writeDays(root, [
      [
        { ...at(newYear - HOUR, 1, newYear), station: a.id, epoch: 1 },
        { ...at(newYear + HOUR, 2, newYear + 2 * HOUR), station: a.id, epoch: 1 },
      ],
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [a],
      storeFor: () => root,
      start: newYear - DAY,
      end: newYear + DAY,
    });
    assert.equal(summary.files, 2);
    assert.deepEqual(
      (await readObservations(seriesPath(root, "levels", "test", "a", 2025))).map((r) => r.level),
      [1],
    );
    assert.deepEqual(
      (await readObservations(seriesPath(root, "levels", "test", "a", 2026))).map((r) => r.level),
      [2],
    );
  });

  it("folds each row into its own epoch's files, in that epoch's datum", async () => {
    const root = store();
    const moved = station("moved", {
      datum: "NHN",
      epochs: [epoch(1, "PNP", { state: "closed" }), epoch(2, "NHN")],
    });
    const lost = station("lost");
    await writeDays(root, [
      [
        { ...at(start + HOUR, 1, start + HOUR), station: lost.id, epoch: 3 },
        { ...at(start + HOUR, 1, start + HOUR), station: moved.id, epoch: 1 },
        { ...at(start + 2 * HOUR, 2, start + 2 * HOUR), station: moved.id, epoch: 2 },
      ],
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [moved, lost],
      storeFor: () => root,
      start,
      end,
    });
    const first = seriesPath(root, "levels", "test", "moved", 2026);
    const second = seriesPath(root, "levels", "test", "moved", 2026, 2);
    assert.match(second, /obs\/test\/moved\/2\/2026\.parquet$/);
    assert.deepEqual(
      (await readObservations(first)).map((r) => r.level),
      [1],
    );
    assert.deepEqual(
      (await readObservations(second)).map((r) => r.level),
      [2],
    );
    assert.deepEqual(await readDatums(first), ["PNP"]);
    assert.deepEqual(await readDatums(second), ["NHN"]);
    // An epoch the list doesn't know has no datum to write in.
    assert.deepEqual(summary.failed, ["test/lost epoch 3 2026: the list has no epoch 3"]);
  });

  it("folds a row into an epoch opened after it was tagged, by its time", async () => {
    const root = store();
    const opened = start + 6 * HOUR;
    const moved = station("moved", {
      datum: "NHN",
      epochs: [
        epoch(1, "PNP", { state: "closed", until: new Date(opened).toISOString() }),
        epoch(2, "NHN", { since: new Date(opened).toISOString() }),
      ],
    });
    const held = station("held", {
      epochs: [
        epoch(1, "NAP"),
        epoch(2, "MSL", { state: "held", since: new Date(opened).toISOString() }),
      ],
    });
    // The hourly run tagged every row epoch 1 before the refresh opened epoch 2 in the past.
    await writeDays(root, [
      [held, moved].flatMap((s) => [
        { ...at(start + HOUR, 1, start + HOUR), station: s.id, epoch: 1 },
        { ...at(start + 8 * HOUR, 2, start + 8 * HOUR), station: s.id, epoch: 1 },
      ]),
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [moved, held],
      storeFor: () => root,
      start,
      end,
    });
    const file = (s: string, n: number) => seriesPath(root, "levels", "test", s, 2026, n);
    assert.deepEqual(
      (await readObservations(file("moved", 1))).map((r) => r.level),
      [1],
    );
    assert.deepEqual(
      (await readObservations(file("moved", 2))).map((r) => r.level),
      [2],
    );
    // A held change's values wait; the ones before it fold.
    assert.deepEqual(
      (await readObservations(file("held", 1))).map((r) => r.level),
      [1],
    );
    assert.deepEqual(
      (await readObservations(file("held", 2))).map((r) => r.level),
      [],
    );
    // Waiting on a decision isn't a failure.
    assert.deepEqual(summary.failed, []);
    assert.deepEqual(summary.waiting, ["test/held: 1 values"]);
    // Nor is a held station stale once its rows age out of the window.
    const later = await compactRecent({
      source: source({}),
      stations: [held],
      storeFor: () => root,
      start: end,
      end: end + DAY,
    });
    assert.deepEqual([later.stale, later.failed], [[], []]);
  });

  it("folds a station retired since its values arrived", async () => {
    const root = store();
    const retired = station("retired", { status: "inactive", live: false });
    await writeDays(root, [
      [{ ...at(start + HOUR, 1, start + HOUR), station: retired.id, epoch: 1 }],
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [retired],
      storeFor: () => root,
      start,
      end,
    });
    assert.equal(summary.files, 1);
    assert.deepEqual(summary.stale, []);
    assert.deepEqual(
      (await readObservations(seriesPath(root, "levels", "test", "retired", 2026))).map(
        (r) => r.level,
      ),
      [1],
    );
  });

  it("folds a station whose list dropped levels, and doesn't count it stale", async () => {
    const root = store();
    const [dropped, gone] = [
      station("dropped", { products: ["predictions"] }),
      station("gone", { products: ["predictions"] }),
    ];
    await writeDays(root, [
      [{ ...at(start + HOUR, 1, start + HOUR), station: dropped.id, epoch: 1 }],
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [dropped, gone],
      storeFor: () => root,
      start,
      end,
    });
    assert.deepEqual([summary.stations, summary.stale, summary.files], [0, [], 1]);
    assert.deepEqual(
      (await readObservations(seriesPath(root, "levels", "test", "dropped", 2026))).map(
        (r) => r.level,
      ),
      [1],
    );
  });

  it("keeps a verified value QC marked suspect over the window's preliminary one", async () => {
    const root = store();
    const a = station("a");
    const file = seriesPath(root, "levels", "test", "a", 2026);
    const verified: Observation = {
      time: start + HOUR,
      level: 0.5,
      flag: Flag.suspect,
      source_flag: Flag.good,
    };
    await writeObservations(file, [verified], "NAP");
    await writeDays(root, [
      [
        {
          ...at(start + HOUR, 1, start + HOUR),
          source_flag: Flag.preliminary,
          station: a.id,
          epoch: 1,
        },
        {
          ...at(start + 2 * HOUR, 2, start + 2 * HOUR),
          source_flag: Flag.preliminary,
          station: a.id,
          epoch: 1,
        },
      ],
    ]);
    await compactRecent({ source: source({}), stations: [a], storeFor: () => root, start, end });
    assert.deepEqual(
      (await readObservations(file)).map((r) => [r.level, r.flag, r.source_flag]),
      [
        [0.5, Flag.suspect, Flag.good],
        [2, Flag.preliminary, Flag.preliminary],
      ],
    );
  });

  it("counts a value whose source flag alone changed as written", async () => {
    const root = store();
    const a = station("a");
    const file = seriesPath(root, "levels", "test", "a", 2026);
    const time = start + HOUR;
    await writeObservations(
      file,
      [{ time, level: 0.5, flag: Flag.suspect, source_flag: Flag.preliminary, received: time }],
      "NAP",
    );
    await writeDays(root, [
      [
        {
          ...at(time, 0.5, time),
          flag: Flag.suspect,
          source_flag: Flag.good,
          station: a.id,
          epoch: 1,
        },
      ],
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [a],
      storeFor: () => root,
      start,
      end,
    });
    assert.equal(summary.files, 1);
    assert.equal(summary.values, 1);
    assert.deepEqual(
      (await readObservations(file)).map((r) => r.source_flag),
      [Flag.good],
    );
  });

  it("leaves a file in another datum as it was, and counts silent stations stale", async () => {
    const root = store();
    const [a, quiet, archive] = [
      station("a"),
      station("quiet"),
      station("archive", { live: false }),
    ];
    const file = seriesPath(root, "levels", "test", "a", 2026);
    await writeObservations(file, [at(start - DAY, 0.5)], "MSL");
    await writeDays(root, [[{ ...at(start + HOUR, 1, start + HOUR), station: a.id, epoch: 1 }]]);
    const summary = await compactRecent({
      source: source({}),
      stations: [a, quiet, archive],
      storeFor: () => root,
      start,
      end,
    });
    assert.match(summary.failed[0]!, /^test\/a 2026: .* holds MSL, not NAP; resolve by hand$/);
    assert.deepEqual(summary.stale, ["test/quiet"]);
    assert.deepEqual(
      (await readObservations(file)).map((r) => r.level),
      [0.5],
    );
  });
});

describe("upsert", () => {
  it("takes incoming levels and flags, keeps the earlier arrival and every time", () => {
    assert.deepEqual(
      upsert([at(1, 1, 10), at(2, 2), at(4, 4, 40)], [at(1, 1.5, 5), at(2, 2.5, 20), at(3, 3)]),
      // The file never knew when 2 arrived, so neither does the fold.
      [at(1, 1.5, 5), at(2, 2.5), at(3, 3), at(4, 4, 40)],
    );
    assert.deepEqual(upsert([at(1, 1, 5)], [at(1, 1, 10)]), [at(1, 1, 5)]);
  });

  it("keeps a value the source finalized over one it hasn't, whatever QC made of either", () => {
    const verified: Observation = { time: 1, level: 1, flag: Flag.good, source_flag: Flag.good };
    const unchecked = (flag: Flag, source_flag: Flag): Observation => ({
      time: 1,
      level: 1.2,
      flag,
      source_flag,
      received: 5,
    });
    assert.deepEqual(upsert([verified], [unchecked(Flag.preliminary, Flag.preliminary)]), [
      verified,
    ]);
    assert.deepEqual(upsert([verified], [unchecked(Flag.suspect, Flag.preliminary)]), [verified]);
    // An unchecked value the source flagged, such as RWS with a quality code.
    assert.deepEqual(upsert([verified], [unchecked(Flag.suspect, Flag.suspect)]), [verified]);
    // QC's mark on a verified value doesn't make it unfinalized.
    const marked: Observation = { ...verified, flag: Flag.suspect };
    assert.deepEqual(upsert([marked], [unchecked(Flag.preliminary, Flag.preliminary)]), [marked]);
    // A finalized value replaces another, keeping the file's unknown arrival.
    const reverified: Observation = { ...verified, level: 1.1, received: 5 };
    assert.deepEqual(upsert([verified], [reverified]), [{ ...verified, level: 1.1 }]);
  });

  it("judges a row from before source flags were kept by its flag", () => {
    const old: Observation = { time: 1, level: 1, flag: Flag.good };
    assert.deepEqual(upsert([old], [at(1, 1.2, 5)]), [old]);
    assert.deepEqual(upsert([{ ...old, flag: Flag.suspect }], [at(1, 1.2, 5)]), [at(1, 1.2)]);
  });
});

describe("isMissing", () => {
  it("knows DuckDB's 404 from any error whose path holds 404", () => {
    const path = "s3://water-levels/obs/coops/1612404/2026.parquet";
    assert.equal(
      isMissing(new Error(`HTTP Error: HTTP HEAD error checking '${path}' (HTTP 404 Not Found)`)),
      true,
    );
    assert.equal(
      isMissing(
        new Error(
          "HTTP Error: Request returned HTTP 503 for HTTP HEAD to 'https://r2/water-levels/obs/coops/1612404/2026.parquet'",
        ),
      ),
      false,
    );
    assert.equal(isMissing(new Error(`IO Error: timed out reading '${path}'`)), false);
  });
});

describe("formatSummary", () => {
  it("tabulates the counts and lists the first failures and stale stations", () => {
    const text = formatSummary(
      {
        title: "recent test",
        stations: 3,
        updated: 1,
        stale: ["test/b"],
        failed: ["test/c: timed out"],
        waiting: ["test/d: 4 values"],
        warned: ["test/e: epoch 1: part of the record; its flags are kept"],
        values: 12,
        files: 1,
      },
      1,
    );
    assert.match(text, /^### recent test\n/);
    assert.match(text, /\| 3 \| 1 \| 1 \| 1 \| 12 \| 1 \|/);
    assert.match(text, /Failed:\n\n- test\/c: timed out/);
    assert.match(text, /Stale:\n\n- test\/b/);
    assert.match(text, /Waiting on a held datum change:\n\n- test\/d: 4 values/);
    assert.match(text, /Warnings:\n\n- test\/e: epoch 1: part of the record; its flags are kept/);
  });

  it("tabulates each phase's seconds", () => {
    const text = formatSummary({
      title: "compact test",
      stations: 1,
      updated: 0,
      stale: [],
      failed: [],
      waiting: [],
      values: 0,
      files: 0,
      seconds: { fold: 12.34, "commit years": 0.5 },
    });
    assert.match(
      text,
      /\| Phase \| Seconds \|\n\| - \| -: \|\n\| fold \| 12\.3 \|\n\| commit years \| 0\.5 \|/,
    );
  });
});

describe("timer", () => {
  it("adds up a phase's seconds over its runs and passes on what its work throws", async () => {
    const seconds: Record<string, number> = {};
    const time = timer("test", seconds);
    assert.equal(await time("a", async () => 1), 1);
    const first = seconds.a!;
    await time("a", () => new Promise((done) => setTimeout(done, 20)));
    assert.ok(seconds.a! >= first + 0.015);
    await assert.rejects(
      time("b", async () => {
        throw new Error("boom");
      }),
      /boom/,
    );
    assert.deepEqual(Object.keys(seconds), ["a", "b"]);
    assert.ok(seconds.a! >= 0 && seconds.b! >= 0);
  });
});
