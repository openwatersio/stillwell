import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { correctPositions, POSITIONS } from "../src/positions.ts";
import { sources } from "../src/sources/index.ts";
import { km } from "../src/ticon.ts";

/** Every station `POSITIONS` names for a source, at its served position. */
const served = (source: string) =>
  Object.entries(POSITIONS)
    .filter(([id]) => id.startsWith(`${source}/`))
    .map(([id, { served }]) => ({ id, ...served }));

describe("correctPositions", () => {
  it("moves each station served where its entry says", () => {
    const { stations, stale } = correctPositions([
      ...served("uhslc"),
      { id: "uhslc/001", lat: 1, lon: 2 },
    ]);
    assert.deepEqual(stale, []);
    assert.deepEqual(
      stations.find((s) => s.id === "uhslc/290a"),
      { id: "uhslc/290a", lat: -51.690339, lon: -57.864931 },
    );
    assert.deepEqual(stations.at(-1), { id: "uhslc/001", lat: 1, lon: 2 });
  });

  it("keeps a position the source has moved, and names the entry", () => {
    const list = served("uhslc").map((s) => (s.id === "uhslc/290a" ? { ...s, lat: -51.7 } : s));
    const { stations, stale } = correctPositions(list);
    assert.equal(stations.find((s) => s.id === "uhslc/290a")!.lat, -51.7);
    assert.deepEqual(stale, ["uhslc/290a is now at -51.7, -57.8667, not -52.7, -57.8667"]);
  });

  it("names stations by the IDs their adapters give", () => {
    for (const id of Object.keys(POSITIONS))
      assert.match(id, /^(uhslc\/\d{3}[a-z]?|gesla\/[a-z_]+-\d{3}[a-z]?-[a-z]{3}-uhslc_(fd|rq))$/);
  });

  it("names lake sources' stations, each moved more than the source's rounding", () => {
    for (const [id, { served, at }] of Object.entries(POSITIONS)) {
      assert.ok(id.split("/")[0]! in sources, id);
      assert.ok(km(served, at) > 1, id);
    }
  });
});
