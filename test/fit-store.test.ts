import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { Fit } from "../src/fit/fit.ts";
import { engineVersion } from "../src/fit/fit.ts";
import { due, fitSource, readConstituents, readFits, writeFits } from "../src/fit/store.ts";
import type { Source, StoredStation } from "../src/schema.ts";
import { writeYears, type YearRow } from "../src/store/years.ts";

const NOW = new Date("2026-11-25T00:00:00Z");
const ENGINE = engineVersion();

const row = (year: number, version: string, epoch = 1): YearRow => ({
  id: "test/a",
  epoch,
  year,
  hours: 8760,
  flags: [8760, 0, 0, 0, 0],
  version,
});
const yearsOf = (rows: YearRow[]) =>
  new Map(rows.map((r) => [`${r.id} ${r.epoch} ${r.year}`, r] as const));

const fit = (fields: Partial<Fit> = {}): Fit =>
  ({
    id: "test/a",
    fitted: NOW.toISOString(),
    reason: null,
    version: "v",
    engine: ENGINE,
    held_out: 2024,
    inputs: JSON.stringify({ versions: { "1 2023": "a", "1 2024": "b" }, epochs: [], errata: {} }),
    ...fields,
  }) as Fit;

describe("a fit is due", () => {
  const station = { id: "test/a" };
  const current = yearsOf([row(2023, "a"), row(2024, "b")]);

  it("when the station has none, or its last try gave no constants", () => {
    assert.equal(due(undefined, station, current, 2024, ENGINE), true);
    assert.equal(due(fit({ reason: "too short" }), station, current, 2024, ENGINE), true);
  });

  it("not when every file it read has the version it read", () => {
    assert.equal(due(fit(), station, current, 2024, ENGINE), false);
  });

  it("when a file it read has another version or is gone", () => {
    const revised = yearsOf([row(2023, "a2"), row(2024, "b")]);
    assert.equal(due(fit(), station, revised, 2024, ENGINE), true);
    assert.equal(due(fit(), station, yearsOf([row(2024, "b")]), 2024, ENGINE), true);
  });

  it("when another engine version fitted it", () => {
    assert.equal(due(fit({ engine: "other@1" }), station, current, 2024, ENGINE), true);
  });

  it("when a later year has become final, and not before", () => {
    const grown = yearsOf([row(2023, "a"), row(2024, "b"), row(2025, "c")]);
    assert.equal(due(fit(), station, grown, 2024, ENGINE), false);
    assert.equal(due(fit(), station, grown, 2025, ENGINE), true);
  });

  it("not for another station's files", () => {
    const other = yearsOf([row(2023, "a"), row(2024, "b"), { ...row(2025, "c"), id: "test/b" }]);
    assert.equal(due(fit(), station, other, 2025, ENGINE), false);
  });
});

describe("fitSource", () => {
  const store = mkdtempSync(join(tmpdir(), "stillwell-fit-store-"));
  after(() => rmSync(store, { recursive: true, force: true }));
  const station = (id: string) =>
    ({
      id: `test/${id}`,
      source: "test",
      source_id: id,
      epochs: [{ id: 1, since: null, until: null, to_current: 0, state: "open" }],
    }) as unknown as StoredStation;
  // It never finalizes and states no revision window, so none of its values count as final.
  const source = { metadata: { id: "test", finalizes: false } } as unknown as Source;

  it("refuses a source with no years file", async () => {
    await assert.rejects(
      fitSource(store, source, [station("a")], { now: NOW, errata: [] }),
      /no years file/,
    );
  });

  it("gives every station of a source with no revision window that reason, and no constants", async () => {
    await writeYears(store, "test", [row(2024, "b")]);
    const report = await fitSource(store, source, [station("a"), station("b")], {
      now: NOW,
      errata: [],
    });
    assert.deepEqual(report.fitted, []);
    assert.deepEqual(
      report.none.map((n) => n.id),
      ["test/a", "test/b"],
    );
    const fits = await readFits(store, "test");
    assert.deepEqual([...fits.keys()], ["test/a", "test/b"]);
    for (const f of fits.values()) {
      assert.match(f.reason!, /states no revision window/);
      assert.equal(f.version, null);
      assert.equal(f.engine, ENGINE);
    }
    assert.deepEqual(await readConstituents(store, "test"), []);
  });

  it("drops the rows of a station that left the list, and fits only the stations named", async () => {
    const report = await fitSource(store, source, [station("b"), station("c")], {
      now: NOW,
      errata: [],
      only: ["test/c"],
    });
    assert.deepEqual(
      report.none.map((n) => n.id),
      ["test/c"],
    );
    assert.deepEqual([...(await readFits(store, "test")).keys()], ["test/b", "test/c"]);
  });

  it("writes both files so a fit without constants has no candidate rows", async () => {
    const fits = [...(await readFits(store, "test")).values()];
    await writeFits(store, "test", fits, []);
    assert.equal((await readConstituents(store, "test")).length, 0);
  });
});
