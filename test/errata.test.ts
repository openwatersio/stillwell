import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { ERRATA, errataOf, render, type Erratum } from "../src/errata.ts";
import { sources } from "../src/sources/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const CITE = /[Ee]rratum\s+(?:\*\s+)?`([a-z0-9-]+)`/g;

/** Every file under a directory, recursively. */
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : [join(dir, d.name)],
  );
}

describe("errata", () => {
  it("names each erratum by its source, once, with its stations and issue", () => {
    assert.equal(new Set(ERRATA.map((e) => e.id)).size, ERRATA.length);
    for (const e of ERRATA) {
      assert.ok(sources[e.source], `${e.id}: no source ${e.source}`);
      assert.match(e.id, new RegExp(`^${e.source}-[a-z0-9-]+$`));
      for (const s of e.stations ?? []) assert.ok(s.startsWith(`${e.source}/`), `${e.id}: ${s}`);
      if (e.since && e.until) assert.ok(e.since < e.until, e.id);
      assert.ok(e.issue > 0, `${e.id}: no issue`);
    }
  });

  it("is cited in each source's adapter, and every citation is listed", () => {
    const cited = new Map<string, string[]>();
    for (const file of files(join(ROOT, "src")))
      for (const [, id] of readFileSync(file, "utf8").matchAll(CITE))
        cited.set(id!, [...(cited.get(id!) ?? []), file]);
    const ids = new Set(ERRATA.map((e) => e.id));
    for (const [id, where] of cited) assert.ok(ids.has(id), `${where.join(", ")} cites ${id}`);
    for (const e of ERRATA)
      assert.ok(
        cited.get(e.id)?.some((f) => f.startsWith(join(ROOT, "src/sources", e.source, "/"))),
        `${e.id} isn't cited in src/sources/${e.source}/`,
      );
  });

  it("lists a station's errata: its own, and its source's for every station", () => {
    const e = (id: string, stations: string[] | null): Erratum => ({
      ...ERRATA[0]!,
      id,
      source: "test",
      stations,
    });
    const errata = [e("test-one", ["test/a"]), e("test-every", null), e("test-none", [])];
    assert.deepEqual(errataOf({ id: "test/a", source: "test" }, errata), [
      "test-one",
      "test-every",
    ]);
    assert.deepEqual(errataOf({ id: "test/b", source: "test" }, errata), ["test-every"]);
    assert.deepEqual(errataOf({ id: "other/a", source: "other" }, errata), []);
  });

  it("keeps docs/errata.md current; `npm run errata` writes it", () => {
    assert.equal(readFileSync(join(ROOT, "docs/errata.md"), "utf8"), render());
  });
});
