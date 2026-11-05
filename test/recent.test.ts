import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fetchText, setTransport } from "../src/http.ts";
import { upsert } from "../src/lake/merge.ts";
import { isMissing } from "../src/lake/parquet.ts";
import {
  readObservations,
  readRecent,
  setConnections,
  writeObservations,
  writeRecent,
} from "../src/lake/parquet.ts";
import { recentPath, seriesPath } from "../src/lake/paths.ts";
import { compactRecent, formatSummary, lastDays, updateRecent } from "../src/lake/recent.ts";
import { Flag, type Observation, type Source, type Station } from "../src/schema.ts";
import * as usgs from "../src/sources/usgs/index.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 5, 12);

afterEach(() => {
  setTransport(fetchText);
  setConnections(1);
});

function lake(): string {
  return mkdtempSync(join(tmpdir(), "water-levels-recent-"));
}

function station(id: string, extra: Partial<Station> = {}): Station {
  return {
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
  } as Station;
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

const at = (time: number, level: number, received?: number): Observation =>
  received === undefined
    ? { time, level, flag: Flag.preliminary }
    : { time, level, flag: Flag.preliminary, received };

describe("updateRecent", () => {
  it("merges the fetch into the window, trims it, and stamps only new values", async () => {
    const root = lake();
    const path = recentPath(root, "test");
    const a = station("a");
    await writeRecent(path, [
      [
        { ...at(NOW - 8 * DAY, 0.1, NOW - 8 * DAY), station: a.id }, // past the 7 days
        { ...at(NOW - 3 * HOUR, 0.2, NOW - 3 * HOUR), station: a.id }, // seen before
      ],
    ]);
    const summary = await updateRecent({
      source: source({ [a.id]: [at(NOW - 3 * HOUR, 0.25), at(NOW - HOUR, 0.3)] }),
      stations: [a],
      lakeFor: () => root,
      since: new Date(NOW - 6 * HOUR),
      now: NOW,
    });
    assert.deepEqual(
      (await readRecent(path)).map((r) => [r.time - NOW, r.level, r.received! - NOW]),
      [
        // A revised value takes the new level and keeps its first arrival.
        [-3 * HOUR, 0.25, -3 * HOUR],
        [-HOUR, 0.3, 0],
      ],
    );
    assert.deepEqual(
      { ...summary, stale: summary.stale.length, failed: summary.failed.length },
      { title: "recent test", stations: 1, updated: 1, stale: 0, failed: 0, values: 1, files: 1 },
    );
  });

  it("keeps a failed or silent station's window, and counts it failed or stale", async () => {
    const root = lake();
    const path = recentPath(root, "test");
    const [ok, broken, quiet] = [station("ok"), station("broken"), station("quiet")];
    const old = (s: Station) => ({ ...at(NOW - 10 * HOUR, 1, NOW - 10 * HOUR), station: s.id });
    await writeRecent(path, [[old(broken), old(quiet)]]);
    const src = source({ [ok.id]: [at(NOW - HOUR, 2)], [broken.id]: new Error("timed out") });
    const summary = await updateRecent({
      source: src,
      // Stations that aren't live, or aren't active, aren't asked.
      stations: [
        ok,
        broken,
        quiet,
        station("retired", { status: "inactive" }),
        station("predicted", { live: false }),
      ],
      lakeFor: () => root,
      since: new Date(NOW - 6 * HOUR),
      now: NOW,
    });
    assert.deepEqual(src.asked.sort(), ["test/broken", "test/ok", "test/quiet"]);
    assert.deepEqual(
      (await readRecent(path)).map((r) => [r.station, r.level]),
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
    const root = lake();
    const daily = station("daily", { interval_s: 86_400 });
    await writeRecent(recentPath(root, "test"), [
      [{ ...at(NOW - 2 * DAY, 1, NOW - 2 * DAY), station: daily.id }],
    ]);
    const summary = await updateRecent({
      source: source({}),
      stations: [daily],
      lakeFor: () => root,
      since: new Date(NOW - 6 * HOUR),
      now: NOW,
    });
    assert.deepEqual(summary.stale, []);
  });

  it("carries rows of stations it no longer fetches, until they age out", async () => {
    const root = lake();
    const path = recentPath(root, "test");
    const [live, retired, quiet, gone, moved] = [
      station("live"),
      station("retired", { status: "inactive" }),
      station("quiet", { live: false }),
      station("gone"),
      station("moved", { live: false, commercial_use: false }),
    ];
    const row = (s: Station, ago: number) => ({ ...at(NOW - ago, 1, NOW - ago), station: s.id });
    await writeRecent(path, [
      [
        row(retired, 2 * HOUR),
        row(retired, 8 * DAY), // aged out
        row(quiet, 3 * HOUR),
        row(gone, 4 * HOUR), // no longer listed, so nowhere to fold it
        row(moved, 5 * HOUR), // now restricted: never stays in the public lake
      ],
    ]);
    const restricted = lake();
    await updateRecent({
      source: source({ [live.id]: [at(NOW - HOUR, 2)] }),
      stations: [live, retired, quiet, moved],
      lakeFor: (s) => (s.commercial_use ? root : restricted),
      since: new Date(NOW - 6 * HOUR),
      now: NOW,
    });
    assert.deepEqual(
      (await readRecent(path)).map((r) => [r.station, (NOW - r.time) / HOUR]),
      [
        ["test/live", 1],
        ["test/quiet", 3],
        ["test/retired", 2],
      ],
    );
  });

  it("looks back two intervals for a station fetched on its own", async () => {
    const root = lake();
    const asked: [string, number][] = [];
    const daily = station("daily", { interval_s: 86_400 });
    await updateRecent({
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
      lakeFor: () => root,
      since: new Date(NOW - 12 * HOUR),
      now: NOW,
    });
    assert.deepEqual(asked.sort(), [
      ["test/daily", 48],
      ["test/tenminute", 12],
    ]);
    assert.deepEqual(
      (await readRecent(recentPath(root, "test"))).map((r) => r.station),
      ["test/daily"],
    );
  });

  it("merges across batches of 500 stations", async () => {
    const root = lake();
    const path = recentPath(root, "test");
    const stations = Array.from({ length: 1001 }, (_, i) => station(String(i).padStart(4, "0")));
    // Before the fetched hours, so the merge keeps it.
    const old = (s: Station) => ({ ...at(NOW - 8 * HOUR, 1, NOW - 8 * HOUR), station: s.id });
    await writeRecent(path, [stations.map(old)]);
    const summary = await updateRecent({
      source: source(Object.fromEntries(stations.map((s) => [s.id, [at(NOW - HOUR, 2)]]))),
      stations,
      lakeFor: () => root,
      since: new Date(NOW - 6 * HOUR),
      now: NOW,
      concurrency: 8,
    });
    const rows = await readRecent(path);
    assert.equal(rows.length, 2002);
    for (const s of [stations[0]!, stations[499]!, stations[500]!, stations[1000]!])
      assert.deepEqual(
        rows.filter((r) => r.station === s.id).map((r) => r.level),
        [1, 2],
      );
    assert.equal(summary.updated, 1001);
    assert.equal(summary.values, 1001);
  });

  it("leaves the old file when a batch fails partway", async () => {
    const root = lake();
    const path = recentPath(root, "test");
    const stations = Array.from({ length: 600 }, (_, i) => station(String(i).padStart(4, "0")));
    await writeRecent(path, [[{ ...at(NOW - 2 * HOUR, 1, NOW - 2 * HOUR), station: "test/0000" }]]);
    // A sweep whose second batch breaks after the first was merged.
    class Breaking extends Map<string, Observation[]> {
      override delete(id: string): boolean {
        if (id === "test/0500") throw new Error("broken batch");
        return super.delete(id);
      }
    }
    await assert.rejects(
      updateRecent({
        source: { ...source({}), recent: async () => new Breaking() },
        stations,
        lakeFor: () => root,
        since: new Date(NOW - 6 * HOUR),
        now: NOW,
      }),
      /broken batch/,
    );
    assert.deepEqual(
      (await readRecent(path)).map((r) => [r.station, r.level]),
      [["test/0000", 1]],
    );
  });

  it("writes restricted stations' window to their own lake", async () => {
    const [open, restricted] = [lake(), lake()];
    const [a, b] = [station("a"), station("b", { commercial_use: false })];
    await updateRecent({
      source: source({ [a.id]: [at(NOW - HOUR, 1)], [b.id]: [at(NOW - HOUR, 2)] }),
      stations: [a, b],
      lakeFor: (s) => (s.commercial_use ? open : restricted),
      since: new Date(NOW - 6 * HOUR),
      now: NOW,
    });
    assert.deepEqual(
      (await readRecent(recentPath(open, "test"))).map((r) => r.station),
      ["test/a"],
    );
    assert.deepEqual(
      (await readRecent(recentPath(restricted, "test"))).map((r) => r.station),
      ["test/b"],
    );
  });

  it("fails on an unreadable window before the sweep spends any requests", async () => {
    const root = lake();
    const path = recentPath(root, "test");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not parquet");
    let swept = false;
    await assert.rejects(
      updateRecent({
        source: {
          ...source({}),
          recent: async () => {
            swept = true;
            return new Map();
          },
        },
        stations: [station("a")],
        lakeFor: () => root,
        since: new Date(NOW - 6 * HOUR),
        now: NOW,
      }),
    );
    assert.equal(swept, false);
    assert.equal(readFileSync(path, "utf8"), "not parquet");
  });

  it("keeps every station's window when a sweep throws", async () => {
    const root = lake();
    const path = recentPath(root, "test");
    const [a, b] = [station("a"), station("b")];
    await writeRecent(path, [
      [a, b].map((s) => ({ ...at(NOW - 2 * HOUR, 1, NOW - 2 * HOUR), station: s.id })),
    ]);
    const summary = await updateRecent({
      source: {
        ...source({}),
        recent: async () => {
          throw new Error("sweep down");
        },
      },
      stations: [a, b],
      lakeFor: () => root,
      since: new Date(NOW - 6 * HOUR),
      now: NOW,
    });
    assert.deepEqual(summary.failed, ["test/a: sweep down", "test/b: sweep down"]);
    assert.equal((await readRecent(path)).length, 2);
  });

  it("writes USGS's batched sweep into the window, one request for every station", async () => {
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
    const root = lake();
    const summary = await updateRecent({
      source: usgs.source,
      // c answers nothing; d is committed in another datum and fails alone.
      stations: [gage("a"), gage("b"), gage("c"), gage("d", { datum: "NAVD88" })],
      lakeFor: () => root,
      since: new Date(NOW - 6 * HOUR),
      now: NOW,
    });
    assert.equal(asked.length, 1);
    assert.match(asked[0]!, /collections\/continuous\/items\?.*parameter_code=00065/);
    assert.deepEqual(
      (await readRecent(recentPath(root, "usgs"))).map((r) => [
        r.station,
        (r.time - NOW) / HOUR,
        r.level,
        r.received,
      ]),
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
      JSON.stringify({ type: "FeatureCollection", features: [], links: [] }),
    );
    const root = lake();
    const a = station("a", {
      id: "usgs/a",
      source: "usgs",
      datum: "GAGE",
      ...({ time_series_id: "a-00065", parameter_code: "00065" } as object),
    });
    await writeRecent(recentPath(root, "usgs"), [
      [{ ...at(NOW - 2 * HOUR, 1, NOW - 2 * HOUR), station: a.id }],
    ]);
    const summary = await updateRecent({
      source: usgs.source,
      stations: [a],
      lakeFor: () => root,
      since: new Date(NOW - 6 * HOUR),
      now: NOW,
    });
    assert.match(summary.failed[0]!, /usgs\/a: USGS returned no values/);
    assert.equal((await readRecent(recentPath(root, "usgs"))).length, 1);
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

  it("folds yesterday into the year file, carrying received and keeping what it had", async () => {
    setConnections(4);
    const root = lake();
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
    await writeRecent(recentPath(root, "test"), [
      [
        { ...at(start - HOUR, 9, start), station: a.id }, // the day before: not folded
        { ...at(start + HOUR, 0.65, start + 3 * HOUR), station: a.id },
        { ...at(start + 3 * HOUR, 0.8, start + 4 * HOUR), station: a.id },
        { ...at(end, 9, end), station: a.id }, // today: not folded
      ],
    ]);
    const run = () =>
      compactRecent({ source: source({}), stations: [a], lakeFor: () => root, start, end });
    const summary = await run();
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
      { ...summary, stale: summary.stale.length, failed: summary.failed.length },
      { title: "compact test", stations: 1, updated: 1, stale: 0, failed: 0, values: 2, files: 1 },
    );

    // A rerun changes nothing, so it writes nothing.
    const written = statSync(file).mtimeMs;
    const again = await run();
    assert.equal(again.files, 0);
    assert.equal(statSync(file).mtimeMs, written);
  });

  it("splits a range across New Year into each year's file", async () => {
    const root = lake();
    const a = station("a");
    const newYear = Date.UTC(2026, 0, 1);
    await writeRecent(recentPath(root, "test"), [
      [
        { ...at(newYear - HOUR, 1, newYear), station: a.id },
        { ...at(newYear + HOUR, 2, newYear + 2 * HOUR), station: a.id },
      ],
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [a],
      lakeFor: () => root,
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

  it("folds a station retired since its values arrived", async () => {
    const root = lake();
    const retired = station("retired", { status: "inactive", live: false });
    await writeRecent(recentPath(root, "test"), [
      [{ ...at(start + HOUR, 1, start + HOUR), station: retired.id }],
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [retired],
      lakeFor: () => root,
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

  it("leaves a file in another datum as it was, and counts silent stations stale", async () => {
    const root = lake();
    const [a, quiet, archive] = [
      station("a"),
      station("quiet"),
      station("archive", { live: false }),
    ];
    const file = seriesPath(root, "levels", "test", "a", 2026);
    await writeObservations(file, [at(start - DAY, 0.5)], "MSL");
    await writeRecent(recentPath(root, "test"), [
      [{ ...at(start + HOUR, 1, start + HOUR), station: a.id }],
    ]);
    const summary = await compactRecent({
      source: source({}),
      stations: [a, quiet, archive],
      lakeFor: () => root,
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

  it("keeps a finalized value over any unfinalized one, whatever QC made of it", () => {
    const verified: Observation = { time: 1, level: 1, flag: Flag.good };
    assert.deepEqual(upsert([verified], [at(1, 1.2, 5)]), [verified]);
    const suspect: Observation = { time: 1, level: 1.3, flag: Flag.suspect, received: 5 };
    assert.deepEqual(upsert([verified], [suspect]), [verified]);
    // A finalized value replaces another, keeping the file's unknown arrival.
    const reverified: Observation = { time: 1, level: 1.1, flag: Flag.good, received: 5 };
    assert.deepEqual(upsert([verified], [reverified]), [{ time: 1, level: 1.1, flag: Flag.good }]);
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
        values: 12,
        files: 1,
      },
      1,
    );
    assert.match(text, /^### recent test\n/);
    assert.match(text, /\| 3 \| 1 \| 1 \| 1 \| 12 \| 1 \|/);
    assert.match(text, /Failed:\n\n- test\/c: timed out/);
    assert.match(text, /Stale:\n\n- test\/b/);
  });
});
