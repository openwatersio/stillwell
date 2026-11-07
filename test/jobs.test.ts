import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import { sources } from "../src/sources/index.ts";
import { sourcesFor } from "../src/sources/jobs.ts";
import type { Source } from "../src/schema.ts";

describe("sourcesFor", () => {
  it("picks each job's sources from the adapters' metadata", () => {
    assert.deepEqual(sourcesFor("hourly"), [
      "cdec",
      "coops",
      "ea",
      "kartverket",
      "marine-institute",
      "pegelonline",
      "refmar",
      "rws",
      "sfwmd",
      "smhi",
      "usace",
      "usgs",
    ]);
    assert.deepEqual(sourcesFor("compact"), [
      "cdec",
      "coops",
      "dwr",
      "ea",
      "jma",
      "kartverket",
      "marine-institute",
      "pegelonline",
      "refmar",
      "rws",
      "sfwmd",
      "smhi",
      "uhslc",
      "usace",
      "usgs",
    ]);
    assert.deepEqual(sourcesFor("lists"), Object.keys(sources).sort());
    assert.deepEqual(sourcesFor("refetch"), [
      "coops",
      "dwr",
      "jma",
      "kartverket",
      "marine-institute",
      "refmar",
      "rws",
      "sfwmd",
      "smhi",
      "uhslc",
      "usace",
      "usgs",
    ]);
  });

  it("keeps to the sources named, and refuses one that isn't registered", () => {
    assert.deepEqual(sourcesFor("refetch", ["usgs", "pegelonline", "coops"]), ["coops", "usgs"]);
    assert.deepEqual(sourcesFor("refetch", ["pegelonline"]), []);
    assert.throws(() => sourcesFor("lists", ["nope"]), /Unknown source nope/);
  });

  it("polls hourly only sources that can fetch observed levels", () => {
    for (const id of sourcesFor("hourly")) {
      const source = sources[id]!;
      assert.ok(source.observations || source.recent, `${id} is hourly with nothing to fetch`);
    }
  });

  it("schedules only sources that may be redistributed, and compacts every hourly one", () => {
    const base = sources.usgs!;
    const fake = (redistribution: boolean, extra: Partial<Source>): Source => ({
      metadata: {
        ...base.metadata,
        id: "zz",
        hourly: true,
        finalizes: true,
        license: { ...base.metadata.license, redistribution },
      },
      stations: base.stations,
      ...extra,
    });
    try {
      sources.zz = fake(false, { observations: base.observations });
      for (const job of ["hourly", "compact", "lists", "refetch"] as const)
        assert.ok(!sourcesFor(job).includes("zz"), job);
      // A source whose only fetch is a sweep of recent values is still folded.
      sources.zz = fake(true, { recent: base.recent });
      assert.ok(sourcesFor("compact").includes("zz"));
    } finally {
      delete sources.zz;
    }
  });

  it("refetches only sources that compaction keeps bounds for", () => {
    const compacted = new Set(sourcesFor("compact"));
    for (const id of sourcesFor("refetch")) assert.ok(compacted.has(id), id);
  });
});

describe("scripts/sources.ts", () => {
  const run = (...args: string[]) =>
    execFileSync(process.execPath, ["scripts/sources.ts", ...args], { encoding: "utf8" });

  it("prints a job's sources as a JSON array for a workflow matrix", () => {
    assert.deepEqual(JSON.parse(run("hourly")), sourcesFor("hourly"));
    assert.deepEqual(JSON.parse(run("refetch", "coops", "pegelonline")), ["coops"]);
  });

  it("fails when none of the sources named runs the job, or one is unknown", () => {
    assert.throws(() => run("refetch", "pegelonline"), /None of pegelonline runs refetch/);
    assert.throws(() => run("lists", "nope"), /Unknown source nope/);
    assert.throws(() => run("weekly"), /usage/);
  });
});

// The workflows run scripts/sources.ts with Node but no npm ci, so nothing it
// reaches may import a package. CI installs packages before the tests, so this
// walks the imports rather than run the script.
describe("scripts/sources.ts imports", () => {
  it("reaches no package, only Node built-ins and the repo's own files", () => {
    const seen = new Set<string>();
    const packages: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8");
      const specifiers = [
        ...text.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?\sfrom\s+"([^"]+)"/gms),
      ]
        .filter((m) => !m[2])
        .map((m) => m[3]!)
        .concat([...text.matchAll(/^\s*import\s+"([^"]+)"/gm)].map((m) => m[1]!))
        .concat([...text.matchAll(/\bimport\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]!));
      for (const specifier of specifiers) {
        if (specifier.startsWith(".")) walk(resolve(dirname(file), specifier));
        else if (!specifier.startsWith("node:")) packages.push(`${specifier} in ${file}`);
      }
    };
    walk(resolve("scripts/sources.ts"));
    assert.ok(seen.size > 5, `only ${seen.size} files walked`);
    assert.deepEqual(packages, []);
  });
});

describe("scheduled jobs for a source with no list yet", () => {
  it("skip it, saying the Monthly workflow starts its list", () => {
    const root = mkdtempSync(join(tmpdir(), "water-levels-jobs-"));
    for (const args of [
      ["recent", "coops"],
      ["compact", "coops"],
    ]) {
      const out = execFileSync(process.execPath, ["scripts/ingest.ts", ...args], {
        encoding: "utf8",
        env: {
          ...process.env,
          WATER_LEVELS_LAKE: join(root, "lake"),
          WATER_LEVELS_CACHE: join(root, "cache"),
        },
      });
      assert.match(out, /coops: no station list yet; the Monthly workflow starts it/);
    }
  });
});
