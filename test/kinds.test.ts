import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KINDS, decideKinds } from "../src/kinds.ts";
import { describeReport, needsPerson, type RefreshReport } from "../src/refresh.ts";
import type { Kind } from "../src/schema.ts";
import { sources } from "../src/sources/index.ts";

describe("decideKinds", () => {
  it("gives a station its KINDS kind where its source gives none", () => {
    const { stations, stale } = decideKinds("rws", [
      { id: "rws/uithuizerwad", kind: null as Kind | null },
      { id: "rws/hoekvanholland", kind: null as Kind | null },
      { id: "rws/werkendam.kleinezalm", kind: null as Kind | null },
      // A source that gives the decided kind is no conflict.
      { id: "rws/werkendam.steenenmuur", kind: "river" as Kind | null },
    ]);
    assert.deepEqual(
      stations.map((s) => s.kind),
      ["coastal", null, "river", "river"],
    );
    assert.deepEqual(stale, []);
  });

  it("keeps a kind the source gives, and reports the entry for a maintainer to remove", () => {
    const { stations, stale } = decideKinds("refmar", [
      { id: "refmar/339", kind: "estuary" as Kind | null },
      { id: "refmar/108", kind: null as Kind | null },
      { id: "refmar/308", kind: null as Kind | null },
    ]);
    assert.equal(stations[0]!.kind, "estuary");
    // Deshaies (673) is in neither this listing nor the lake, as after a typo.
    assert.deepEqual(stale, [
      "refmar/673 isn't listed by its source",
      "refmar/339 is now estuary by its source, not coastal",
    ]);
    const report = {
      source: "refmar",
      added: [],
      retired: [],
      withdrawn: [],
      removed: [],
      unwithheld: [],
      changed: [],
      epochs: [],
      positions: [],
      kinds: stale,
    } as unknown as RefreshReport;
    assert.ok(needsPerson(report));
    assert.ok(describeReport(report).some((line) => line.includes("remove its entry from KINDS")));
  });

  it("counts an entry the lake knows as listed, though the source no longer lists it", () => {
    const { stale } = decideKinds(
      "refmar",
      [{ id: "refmar/339", kind: null as Kind | null }],
      [{ id: "refmar/108" }, { id: "refmar/308" }, { id: "refmar/673" }],
    );
    assert.deepEqual(stale, []);
  });

  it("names lake sources' stations, each with a note", () => {
    for (const [id, { note }] of Object.entries(KINDS)) {
      assert.ok(id.split("/")[0]! in sources, id);
      assert.ok(note.length > 20, id);
    }
  });
});
