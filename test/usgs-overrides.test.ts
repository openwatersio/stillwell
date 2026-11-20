import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { StoredStation } from "../src/schema.ts";
import { mergeStationList } from "../src/stations.ts";
import { seriesChanged, source } from "../src/sources/usgs/index.ts";

/** A gage as the store held it after the refresh of 2026-11-16: epoch 1 closed at its last `seen`, epoch 2 open from the refresh. */
const gage = (id: string): StoredStation => ({
  id,
  source: "usgs",
  source_id: id.slice("usgs/".length),
  name: "",
  lat: 0,
  lon: 0,
  country_code: "US",
  kind: "river",
  interval_s: null,
  datum: "GAGE",
  datums: { NAVD88: 10 },
  products: ["levels"],
  first: null,
  last: null,
  license: "US-Government-Works",
  commercial_use: true,
  attribution: "",
  tide_station: null,
  same_as: [],
  status: "active",
  live: true,
  min_interval_s: 900,
  source_url: null,
  epochs: [
    {
      id: 1,
      datum: "GAGE",
      since: null,
      until: "2026-11-05T14:12:26Z",
      seen: "2026-11-05T14:12:26Z",
      reference: null,
      reference_since: null,
      datums: { NAVD88: 9.9 },
      to_current: null,
      state: "closed",
    },
    {
      id: 2,
      datum: "GAGE",
      since: "2026-11-16T14:19:07Z",
      until: null,
      seen: "2026-11-16T14:19:07Z",
      reference: "series a is now b",
      reference_since: null,
      datums: { NAVD88: 10 },
      to_current: 0,
      state: "open",
    },
  ],
});

describe("USGS epoch decisions", () => {
  const decisions = source.overrides!.epochs!;
  const ids = Object.keys(decisions).map((key) => key.split(" ")[0]!);

  it("decide only the epoch the refresh of 2026-11-16 opened", () => {
    assert.ok(ids.length > 0);
    for (const [key, decision] of Object.entries(decisions)) {
      assert.match(key, /^usgs\/[^ ]+ 2026-11-16T14:19:07Z$/);
      assert.equal(decision.reject, true, key);
      assert.ok(decision.note.length > 0, key);
    }
    assert.equal(new Set(ids).size, ids.length);
  });

  it("give the readings between the epochs to epoch 1, which then runs on", () => {
    const previous = ids.map(gage);
    const fetched = previous.map(({ epochs, ...s }) => ({ ...s, datums: { NAVD88: 10 } }));
    const { stations, changes } = mergeStationList(previous, fetched, {
      now: "2026-11-21T00:00:00Z",
      offsets: [0, 0],
      decisions,
    });
    assert.deepEqual(
      changes.map((c) => c.event),
      ids.map(() => "rejected"),
    );
    for (const s of stations) {
      const [first, second] = s.epochs;
      assert.equal(first!.state, "open", s.id);
      assert.equal(first!.until, null, s.id);
      assert.equal(second!.state, "rejected", s.id);
      assert.equal(first!.to_current, 0, s.id);
      assert.equal(second!.to_current, 0, s.id);
    }
  });

  it("leave the rejected change alone at the next refresh", () => {
    // The stored list names the series the refresh switched to, as the fetched one does.
    const stored = (id: string) => ({ ...gage(id), time_series_id: "b" }) as StoredStation;
    const fetched = ids.map(stored);
    const options = {
      now: "2026-11-21T00:00:00Z",
      offsets: [0, 0] as [number, number],
      decisions,
      seriesChanged,
    };
    const once = mergeStationList(ids.map(stored), fetched, options).stations;
    const again = mergeStationList(once, fetched, options);
    assert.deepEqual(
      again.changes.filter((c) => c.event === "opened" || c.event === "held"),
      [],
    );
    for (const s of again.stations) {
      assert.deepEqual(
        s.epochs.map((e) => e.state),
        ["open", "rejected"],
        s.id,
      );
    }
  });
});
