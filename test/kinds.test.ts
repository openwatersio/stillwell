import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KINDS, decideKinds } from "../src/kinds.ts";
import { describeReport, needsPerson, type RefreshReport } from "../src/refresh.ts";
import type { Kind } from "../src/schema.ts";
import { sources } from "../src/sources/index.ts";

describe("decideKinds", () => {
  it("gives a station a person's kind where its source gives none", () => {
    const { stations, stale } = decideKinds([
      { id: "rws/uithuizerwad", kind: null as Kind | null },
      { id: "rws/hoekvanholland", kind: null as Kind | null },
    ]);
    assert.deepEqual(
      stations.map((s) => s.kind),
      ["coastal", null],
    );
    assert.deepEqual(stale, []);
  });

  it("keeps a kind the source gives, and reports the entry for a person to remove", () => {
    const { stations, stale } = decideKinds([{ id: "refmar/339", kind: "estuary" as Kind | null }]);
    assert.equal(stations[0]!.kind, "estuary");
    assert.deepEqual(stale, ["refmar/339 is now estuary by its source, not coastal"]);
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

  it("names lake sources' stations, each with a note", () => {
    for (const [id, { note }] of Object.entries(KINDS)) {
      assert.ok(id.split("/")[0]! in sources, id);
      assert.ok(note.length > 20, id);
    }
  });
});
