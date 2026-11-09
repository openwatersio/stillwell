import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { citations, citedIn } from "../src/citations.ts";
import {
  errataOf,
  parseErrata,
  published,
  readErrata,
  spans,
  withErrata,
  type Erratum,
} from "../src/errata.ts";
import { Flag, type Observation, type Source, type Station } from "../src/schema.ts";
import { errata, errataFiles, errataProblems, sources } from "../src/sources/index.ts";

const entry = (fields: Record<string, unknown> = {}) => ({
  id: "uhslc-hong-kong-hour-early",
  stations: ["uhslc/329", "uhslc/329a"],
  since: "2020-01-01",
  until: "2021-01-01",
  handling: "corrected",
  error: "UHSLC's Hong Kong heights are an hour early.",
  response: "Shifted an hour later.",
  ...fields,
});
const file = (entries: object[], retired: string[] = []) => ({ errata: entries, retired });
const DAY = (d: string) => Date.parse(`${d}T00:00:00Z`);

describe("errata files", () => {
  it("are every source's that has one, each for a registered source", () => {
    const dir = fileURLToPath(new URL("../src/sources", import.meta.url));
    const onDisk = readdirSync(dir).filter((d) => existsSync(join(dir, d, "errata.json")));
    assert.deepEqual(Object.keys(errataFiles).sort(), onDisk.sort());
    for (const source of onDisk) assert.ok(sources[source], `${source} isn't registered`);
    assert.deepEqual(errataProblems, []);
  });

  it("leave out an ID used twice or retired anywhere, and a file that doesn't parse", () => {
    const one = file([entry()]);
    assert.deepEqual(readErrata({ uhslc: one }).problems, []);
    const twice = readErrata({ uhslc: file([entry(), entry()]) });
    assert.equal(twice.errata.length, 1);
    assert.match(twice.problems.join(), /twice/);
    const retired = readErrata({ uhslc: one, gesla: file([], ["uhslc-hong-kong-hour-early"]) });
    assert.deepEqual(retired.errata, []);
    assert.match(retired.problems.join(), /retired/);
    // A bad file costs only its own source's errata.
    const bad = readErrata({ uhslc: one, gesla: file([entry({ id: "uhslc-x" })]) });
    assert.equal(bad.errata.length, 1);
    assert.equal(bad.problems.length, 1);
  });

  it("hold every erratum ID the code cites", () => {
    const ids = new Set(errata.map((e) => e.id));
    const stray = [...citedIn(fileURLToPath(new URL("../src", import.meta.url)))].filter(
      ([id]) => !ids.has(id),
    );
    assert.deepEqual(stray, []);
  });
});

describe("parseErrata", () => {
  it("reads an entry, with optional fields null", () => {
    assert.deepEqual(parseErrata("uhslc", file([entry()])).errata, [
      {
        id: "uhslc-hong-kong-hour-early",
        source: "uhslc",
        stations: ["uhslc/329", "uhslc/329a"],
        since: "2020-01-01",
        until: "2021-01-01",
        error: "UHSLC's Hong Kong heights are an hour early.",
        handling: "corrected",
        response: "Shifted an hour later.",
        evidence: null,
        reported: null,
        report: null,
      },
    ]);
  });

  it("reads every station, and open ends", () => {
    const [e] = parseErrata(
      "uhslc",
      file([entry({ stations: "every station", since: null, until: undefined })]),
    ).errata;
    assert.equal(e!.stations, null);
    assert.equal(e!.since, null);
    assert.equal(e!.until, null);
  });

  it("refuses what an erratum can't be", () => {
    const refused = (fields: Record<string, unknown>, retired: string[] = []) =>
      assert.throws(() => parseErrata("uhslc", file([entry(fields)], retired)));
    refused({ id: "gesla-hong-kong" });
    refused({ stations: ["gesla/329"] });
    refused({ stations: "all" });
    refused({ since: "2026-02-30" });
    refused({ since: "2021-01-01", until: "2020-01-01" });
    refused({ handling: "fixed" });
    refused({ error: "" });
    refused({ response: undefined });
    refused({ reported: "last week" });
    refused({}, ["uhslc-hong-kong-hour-early"]);
    // A misspelled until would leave the span open.
    refused({ unitl: "2021-01-01" });
    assert.throws(() => parseErrata("uhslc", { errata: [] }));
  });
});

describe("spans", () => {
  const erratum = (fields: Partial<Erratum>): Erratum => ({
    ...(parseErrata("uhslc", file([entry()])).errata[0] as Erratum),
    handling: "flagged",
    ...fields,
  });

  it("are a flagged erratum's days at the stations it names", () => {
    assert.deepEqual(spans({ id: "uhslc/329" }, [erratum({})]), [
      [DAY("2020-01-01"), DAY("2021-01-01")],
    ]);
    assert.deepEqual(spans({ id: "uhslc/1" }, [erratum({})]), []);
    assert.deepEqual(spans({ id: "uhslc/329" }, [erratum({ since: null })]), [
      [-Infinity, DAY("2021-01-01")],
    ]);
  });

  it("leave an unflagged or unbounded erratum to the adapter", () => {
    assert.deepEqual(spans({ id: "uhslc/329" }, [erratum({ handling: "kept" })]), []);
    assert.deepEqual(spans({ id: "uhslc/329" }, [erratum({ since: null, until: null })]), []);
  });

  it("cover every station for one that names every station", () => {
    assert.deepEqual(spans({ id: "uhslc/1" }, [erratum({ stations: null })]), [
      [DAY("2020-01-01"), DAY("2021-01-01")],
    ]);
  });
});

describe("withErrata", () => {
  const rows: Observation[] = [
    { time: DAY("2019-12-31"), level: 1, flag: Flag.good },
    { time: DAY("2020-06-01"), level: 1, flag: Flag.preliminary },
    { time: DAY("2020-06-02"), level: 1, flag: Flag.bad },
    { time: DAY("2021-01-01"), level: 1, flag: Flag.good },
  ];
  const adapter = {
    metadata: { id: "uhslc" },
    observations: async () => rows,
    suspect: async () => [[1, 2]],
  } as unknown as Source;
  const flagged = parseErrata("uhslc", file([entry({ handling: "flagged" })])).errata;
  const station = { id: "uhslc/329" } as Station;

  it("flags fetched values in the span, keeping the source's flag", async () => {
    const got = await withErrata(adapter, flagged).observations!(station, new Date(0), new Date());
    assert.deepEqual(
      got.map((o) => [o.flag, o.source_flag]),
      [
        [Flag.good, undefined],
        [Flag.suspect, Flag.preliminary],
        [Flag.bad, Flag.bad],
        [Flag.good, undefined],
      ],
    );
  });

  it("adds the span to the adapter's own", async () => {
    assert.deepEqual(await withErrata(adapter, flagged).suspect!(station, async function* () {}), [
      [1, 2],
      [DAY("2020-01-01"), DAY("2021-01-01")],
    ]);
  });

  it("flags values a sweep of every station fetches", async () => {
    const sweeping = {
      ...adapter,
      recent: async () =>
        new Map<string, Observation[] | Error>([
          ["uhslc/329", rows],
          ["uhslc/1", new Error("down")],
        ]),
    } as unknown as Source;
    const got = await withErrata(sweeping, flagged).recent!([station], new Date(0), new Date());
    assert.deepEqual(
      (got.get("uhslc/329") as Observation[]).map((o) => o.flag),
      [Flag.good, Flag.suspect, Flag.bad, Flag.good],
    );
    assert.ok(got.get("uhslc/1") instanceof Error);
  });

  it("leaves a source with nothing flagged as it is", () => {
    assert.equal(withErrata(adapter, parseErrata("uhslc", file([entry()])).errata), adapter);
  });
});

describe("published", () => {
  it("links each erratum to its file", () => {
    const [row] = published(parseErrata("uhslc", file([entry()])).errata) as { url: string }[];
    assert.equal(
      row!.url,
      "https://github.com/openwatersio/water-levels/blob/main/src/sources/uhslc/errata.json",
    );
  });

  it("names a station's errata, including those for every station", () => {
    const errata = parseErrata(
      "uhslc",
      file([entry(), entry({ id: "uhslc-all", stations: "every station" })]),
    ).errata;
    assert.deepEqual(errataOf({ id: "uhslc/329", source: "uhslc" }, errata), [
      "uhslc-hong-kong-hour-early",
      "uhslc-all",
    ]);
    assert.deepEqual(errataOf({ id: "uhslc/1", source: "uhslc" }, errata), ["uhslc-all"]);
    assert.deepEqual(errataOf({ id: "gesla/329", source: "gesla" }, errata), []);
  });

  it("finds citations in prose", () => {
    assert.deepEqual(citations("see erratum `a-b` and Erratum\n`c-d`"), ["a-b", "c-d"]);
  });
});
