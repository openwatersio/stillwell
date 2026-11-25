import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { citations, citedIn } from "../src/citations.ts";
import {
  covers,
  draft,
  errataOf,
  flaggedSpan,
  parseErrata,
  parseQuestions,
  published,
  readErrata,
  spans,
  withErrata,
  type Erratum,
  type StoreReader,
} from "../src/errata.ts";
import { Flag, Unjudged, type Observation, type Source, type Station } from "../src/schema.ts";
import { errata, errataFiles, errataProblems, sources, withinSpan } from "../src/sources/index.ts";

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
    const onDisk = readdirSync(dir).filter((d) => existsSync(join(dir, d, "errata.ts")));
    // An errata.json left beside it would be read by nothing.
    assert.deepEqual(
      readdirSync(dir).filter((d) => existsSync(join(dir, d, "errata.json"))),
      [],
    );
    assert.deepEqual(Object.keys(errataFiles).sort(), onDisk.sort());
    for (const source of onDisk) assert.ok(sources[source], `${source} isn't registered`);
    assert.deepEqual(errataProblems, []);
    assert.deepEqual(
      errata.filter((e) => !e.check).map((e) => e.id),
      [],
      "every erratum has a check",
    );
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

  it("back every split with an erratum of the station's source", () => {
    for (const [name, source] of Object.entries(sources))
      for (const [station, splits] of Object.entries(source.overrides?.splits ?? {}))
        for (const split of splits) {
          assert.match(split.since, /^\d{4}-\d{2}-\d{2}$/, `${station} ${split.since}`);
          // Date rolls 2026-02-30 over to March, so a day must come back the same.
          for (const day of [split.since, ...(split.from ? [split.from] : [])])
            assert.ok(
              /^\d{4}-\d{2}-\d{2}$/.test(day) &&
                new Date(`${day}T00:00:00Z`).toISOString().startsWith(day),
              `${station} ${day} isn't a day`,
            );
          if (split.from)
            assert.ok(split.from > split.since, `${station} from ${split.from} isn't after since`);
          // A split stays once its erratum is retired, since its epochs do.
          const { errata: own, retired } = parseErrata(name, errataFiles[name]);
          const ids = [
            ...own.filter((e) => e.stations?.includes(station)).map((e) => e.id),
            ...retired,
          ];
          assert.ok(
            ids.some((id) => split.note.includes(`\`${id}\``)),
            `${station} ${split.since} cites no erratum of ${name}`,
          );
        }
  });

  it("restart only the source's own stations, with a datum and a note", () => {
    for (const [name, source] of Object.entries(sources))
      for (const [station, restart] of Object.entries(source.overrides?.restarts ?? {})) {
        assert.ok(station.startsWith(`${name}/`), `${station} isn't a ${name} station`);
        assert.ok(restart.datum && restart.note, `${station} needs a datum and a note`);
      }
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
    refused({ check: true });
    assert.throws(() => parseErrata("uhslc", { errata: [] }));
  });

  it("refuses a copy of a source that isn't registered", () => {
    const { errata, problems } = readErrata(
      { uhslc: file([entry({ stations: ["uhslc/329", "gelsa/329"] })]) },
      ["uhslc", "gesla"],
    );
    assert.deepEqual(errata, []);
    assert.match(problems[0]!, /gelsa\/329/);
  });

  it("covers the source's own errata, those listing its copies, and those naming no station yet", () => {
    const [copied, empty] = parseErrata(
      "uhslc",
      file([
        entry({ stations: ["uhslc/329", "gesla/329"] }),
        entry({ id: "uhslc-none-listed", stations: [] }),
      ]),
    ).errata;
    assert.ok(covers(copied!, "uhslc") && covers(copied!, "gesla") && !covers(copied!, "cmems"));
    assert.ok(covers(empty!, "uhslc") && !covers(empty!, "gesla"));
  });

  it("reads another source's copy beside the source's own station", () => {
    const [e] = parseErrata(
      "uhslc",
      file([entry({ stations: ["uhslc/329", "gesla/hk-329"] })]),
    ).errata;
    assert.deepEqual(e!.stations, ["uhslc/329", "gesla/hk-329"]);
    assert.throws(() => parseErrata("uhslc", file([entry({ stations: ["gesla/hk-329"] })])));
    assert.throws(() => parseErrata("uhslc", file([entry({ stations: ["uhslc/329", "hk"] })])));
  });

  it("keeps an erratum's check, and leaves it out of what's published", () => {
    const check = async () => true;
    const parsed = parseErrata("uhslc", file([entry({ check })])).errata;
    assert.equal(parsed[0]!.check, check);
    assert.ok(!("check" in (published(parsed)[0] as object)));
  });
});

const question = (fields: Record<string, unknown> = {}) => ({
  id: "uhslc-hong-kong-datum",
  stations: ["uhslc/329"],
  question: "Which datum are Hong Kong's heights before 1986 on?",
  why: "A datum epoch would open in 1986 if the zero moved.",
  meanwhile: "The store keeps them on the station's datum.",
  ...fields,
});
const withQuestions = (questions: object[], entries: object[] = [], retired: string[] = []) => ({
  ...file(entries, retired),
  questions,
});

describe("questions", () => {
  it("are read beside the errata, with optional fields null", () => {
    assert.deepEqual(parseQuestions("uhslc", withQuestions([question()])), [
      {
        id: "uhslc-hong-kong-datum",
        source: "uhslc",
        stations: ["uhslc/329"],
        question: "Which datum are Hong Kong's heights before 1986 on?",
        why: "A datum epoch would open in 1986 if the zero moved.",
        meanwhile: "The store keeps them on the station's datum.",
        asked: null,
        answer: null,
      },
    ]);
    assert.deepEqual(parseQuestions("uhslc", file([entry()])), []);
    const [all] = parseQuestions(
      "uhslc",
      withQuestions([question({ stations: "every station", asked: "2026-11-01" })]),
    );
    assert.equal(all!.stations, null);
    assert.equal(all!.asked, "2026-11-01");
  });

  it("refuse what a question can't be", () => {
    const refused = (fields: Record<string, unknown>, retired: string[] = []) =>
      assert.throws(() => parseQuestions("uhslc", withQuestions([question(fields)], [], retired)));
    refused({ id: "gesla-hong-kong" });
    refused({ stations: "all" });
    refused({ stations: null });
    // A question goes to the source's own agency, about its own stations.
    refused({ stations: ["uhslc/329", "gesla/329"] });
    refused({ stations: ["uhslc/"] });
    // A whole station ID, so none can carry another source's onto the draft's next line.
    refused({ stations: ["uhslc/329\ngesla/329"] });
    refused({ stations: ["uhslc/.."] });
    refused({ stations: [] });
    refused({ stations: ["uhslc/329", "uhslc/329"] });
    refused({ question: "" });
    refused({ why: undefined });
    refused({ meanwhile: 3 });
    refused({ asked: "2026-02-30" });
    refused({ answr: "Chart datum." });
    refused({}, ["uhslc-hong-kong-datum"]);
    assert.throws(() => parseQuestions("uhslc", { ...file([]), questions: {} }));
    assert.throws(() => parseQuestions("uhslc", { ...file([]), questions: [null] }));
  });

  it("leave out an ID used twice, by a question or an erratum, or retired anywhere", () => {
    assert.deepEqual(readErrata({ uhslc: withQuestions([question()]) }).problems, []);
    const twice = readErrata({ uhslc: withQuestions([question(), question()]) });
    assert.equal(twice.questions.length, 1);
    assert.match(twice.problems.join(), /question ID uhslc-hong-kong-datum is used twice/);
    const erratum = readErrata({
      uhslc: withQuestions([question({ id: "uhslc-hong-kong-hour-early" })], [entry()]),
    });
    assert.equal(erratum.errata.length, 1);
    assert.deepEqual(erratum.questions, []);
    assert.match(erratum.problems.join(), /used twice/);
    const retired = readErrata({
      uhslc: withQuestions([question()]),
      gesla: file([], ["uhslc-hong-kong-datum"]),
    });
    assert.deepEqual(retired.questions, []);
    assert.match(retired.problems.join(), /question ID uhslc-hong-kong-datum is retired/);
    // A bad question costs only its file's questions: the errata beside it still flag their spans.
    const bad = readErrata({
      uhslc: withQuestions(
        [question(), question({ id: "uhslc-other", asked: "2026-02-30" })],
        [entry({ handling: "flagged" })],
      ),
    });
    assert.deepEqual(
      bad.errata.map((e) => e.id),
      ["uhslc-hong-kong-hour-early"],
    );
    assert.deepEqual(bad.questions, []);
    assert.equal(bad.problems.length, 1);
    // And a bad erratum costs only the errata.
    const badErratum = readErrata({
      uhslc: withQuestions([question()], [entry({ handling: "fixed" })]),
    });
    assert.deepEqual(badErratum.errata, []);
    assert.equal(badErratum.questions.length, 1);
  });
});

describe("draft", () => {
  const metadata = { name: "UHSLC", contact: { email: "sealevel@example.org" } };
  const read = (entries: object[], questions: object[]) => {
    const data = withQuestions(questions, entries);
    return draft(
      "uhslc",
      metadata,
      parseErrata("uhslc", data).errata,
      parseQuestions("uhslc", data),
    );
  };

  it("puts unasked questions after the unreported errata, with only the source's stations", () => {
    const { text, held } = read(
      [entry({ stations: ["uhslc/329", "gesla/hk-329"], evidence: "Against TICON." })],
      [question(), question({ id: "uhslc-whole", stations: "every station" })],
    );
    assert.deepEqual(held, []);
    assert.equal(
      text,
      [
        "## UHSLC\n\nTo: sealevel@example.org\n",
        "### uhslc-hong-kong-hour-early\n\nUHSLC's Hong Kong heights are an hour early.\n\nStations: uhslc/329; values 2020-01-01 to before 2021-01-01.\n\nAgainst TICON.\n\nWhat we do meanwhile: Shifted an hour later.\n",
        "### Questions\n",
        "#### uhslc-hong-kong-datum\n\nWhich datum are Hong Kong's heights before 1986 on?\n\nStations: uhslc/329.\n\nWhat the answer would change: A datum epoch would open in 1986 if the zero moved.\n\nWhat we do meanwhile: The store keeps them on the station's datum.\n",
        "#### uhslc-whole\n\nWhich datum are Hong Kong's heights before 1986 on?\n\nStations: the source as a whole.\n\nWhat the answer would change: A datum epoch would open in 1986 if the zero moved.\n\nWhat we do meanwhile: The store keeps them on the station's datum.\n",
      ].join("\n"),
    );
  });

  it("drafts a message for questions alone, and none with nothing to send", () => {
    const { text } = read([], [question()]);
    assert.match(text!, /^## UHSLC\n/);
    assert.match(text!, /### Questions/);
    assert.doesNotMatch(text!, /### uhslc-hong-kong-hour-early/);
    assert.equal(read([entry()], []).text!.includes("Questions"), false);
    assert.deepEqual(
      read([entry({ reported: "2026-01-01" })], [question({ asked: "2026-01-01" })]),
      { text: null, held: [] },
    );
  });

  it("holds back a question with an answer but no date asked, saying why", () => {
    const { text, held } = read(
      [entry({ report: "Waiting on the cross-check." })],
      [question({ answer: "Waiting on the next station refresh." })],
    );
    assert.equal(text, null);
    assert.deepEqual(held, [
      "uhslc-hong-kong-hour-early held: Waiting on the cross-check.",
      "uhslc-hong-kong-datum held: Waiting on the next station refresh.",
    ]);
  });

  it("leaves out another source's entries", () => {
    const data = withQuestions([question()], [entry()]);
    assert.deepEqual(
      draft("gesla", metadata, parseErrata("uhslc", data).errata, parseQuestions("uhslc", data)),
      {
        text: null,
        held: [],
      },
    );
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

  it("leaves out every fetched level outside the span, recent or not", async () => {
    const rows = [
      { time: 1, level: 1, flag: Flag.good },
      { time: 2, level: 30479.695, flag: Flag.good },
      { time: 3, level: -2438.095, flag: Flag.bad },
      { time: 4, level: Number.NaN, flag: Flag.good },
      { time: 5, level: -1, flag: Flag.good },
    ];
    const fills = {
      metadata: { id: "usace" },
      observations: async () => rows,
      recent: async () =>
        new Map<string, Observation[] | Error>([
          ["usace/x", rows],
          ["usace/y", new Error("down")],
        ]),
    } as unknown as Source;
    const kept = withinSpan(fills);
    assert.deepEqual(
      (await kept.observations!(station, new Date(0), new Date())).map((o) => o.time),
      [1, 5],
    );
    const recent = await kept.recent!([station], new Date(0), new Date());
    assert.deepEqual(
      (recent.get("usace/x") as Observation[]).map((o) => o.time),
      [1, 5],
    );
    assert.ok(recent.get("usace/y") instanceof Error);
  });

  it("adds the span to the adapter's own", async () => {
    assert.deepEqual(await withErrata(adapter, flagged).suspect!(station, async function* () {}), [
      [1, 2],
      [DAY("2020-01-01"), DAY("2021-01-01")],
    ]);
  });

  it("shows the adapter's rule the values in the span as already suspect", async () => {
    let seen: Observation[] = [];
    const judging = {
      ...adapter,
      suspect: async (_s: Station, record: () => AsyncIterable<Observation[]>) => {
        for await (const batch of record()) seen = seen.concat(batch);
        return [];
      },
    } as unknown as Source;
    await withErrata(judging, flagged).suspect!(station, async function* () {
      yield rows;
    });
    assert.deepEqual(
      seen.map((o) => [o.time, o.flag, o.source_flag]),
      [
        [rows[0]!.time, Flag.good, undefined],
        [rows[1]!.time, Flag.suspect, Flag.suspect],
        [rows[2]!.time, Flag.bad, Flag.bad],
        [rows[3]!.time, Flag.good, undefined],
      ],
    );
    // The record the caller holds isn't changed.
    assert.equal(rows[1]!.flag, Flag.preliminary);
  });

  it("keeps the span when the adapter can't judge the record, and passes other errors on", async () => {
    const refusing = {
      ...adapter,
      suspect: async () => {
        throw new Unjudged("part of the record");
      },
    } as unknown as Source;
    await assert.rejects(
      withErrata(refusing, flagged).suspect!(station, async function* () {}),
      (error: unknown) =>
        error instanceof Unjudged &&
        error.message === "part of the record" &&
        JSON.stringify(error.spans) === JSON.stringify([[DAY("2020-01-01"), DAY("2021-01-01")]]),
    );
    const broken = {
      ...adapter,
      suspect: async () => {
        throw new Error("unreadable");
      },
    } as unknown as Source;
    await assert.rejects(
      withErrata(broken, flagged).suspect!(station, async function* () {}),
      (error: unknown) => !(error instanceof Unjudged) && /unreadable/.test(String(error)),
    );
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

  it("flags a copy another source's erratum lists", async () => {
    const copied = parseErrata(
      "uhslc",
      file([entry({ handling: "flagged", stations: ["uhslc/329", "gesla/hk-329"] })]),
    ).errata;
    const gesla = { ...adapter, metadata: { id: "gesla" } } as unknown as Source;
    const got = await withErrata(gesla, copied).observations!(
      { id: "gesla/hk-329" } as Station,
      new Date(0),
      new Date(),
    );
    assert.deepEqual(
      got.map((o) => o.flag),
      [Flag.good, Flag.suspect, Flag.bad, Flag.good],
    );
    assert.equal(
      withErrata({ ...gesla, metadata: { id: "cmems" } } as Source, copied).suspect,
      gesla.suspect,
    );
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
      "https://github.com/openwatersio/stillwell/blob/main/src/sources/uhslc/errata.ts",
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
    const copied = parseErrata(
      "uhslc",
      file([entry({ stations: ["uhslc/329", "gesla/329"] })]),
    ).errata;
    assert.deepEqual(errataOf({ id: "gesla/329", source: "gesla" }, copied), [
      "uhslc-hong-kong-hour-early",
    ]);
  });

  it("finds citations in prose", () => {
    assert.deepEqual(citations("see erratum `a-b` and Erratum\n`c-d`"), ["a-b", "c-d"]);
  });
});

describe("flaggedSpan", () => {
  // Every level suspect over a good source flag, on every day read, as a record whose rule flags the days around the span.
  const flagged = (flag: number) =>
    ({
      levels: async (_id: string, since: string) => [
        { time: DAY(since), level: 1, flag, source_flag: Flag.good, epoch: 1 },
      ],
    }) as unknown as StoreReader;
  const e = { id: "x", stations: ["a/b"], since: "2020-01-01", until: "2020-01-10" };

  it("fails on suspect levels the days either side of the span", async () => {
    await assert.rejects(flaggedSpan(flagged(Flag.suspect), e), /outside the span, are suspect/);
  });

  it("leaves the day the span ends unjudged when asked, and still judges the day before the span", async () => {
    // Suspect from the span's start through the day it ends, as a record whose rule flags what follows the span.
    const through = {
      levels: async (_id: string, since: string) => [
        {
          time: DAY(since),
          level: 1,
          flag: since >= "2020-01-01" ? Flag.suspect : Flag.good,
          source_flag: Flag.good,
          epoch: 1,
        },
      ],
    } as unknown as StoreReader;
    await assert.rejects(flaggedSpan(through, e), /levels on 2020-01-10, outside the span/);
    await flaggedSpan(through, e, ["a/b"], { untilDay: false });
    await assert.rejects(
      flaggedSpan(flagged(Flag.suspect), e, ["a/b"], { untilDay: false }),
      /levels on 2019-12-31, outside the span/,
    );
  });

  it("still requires the span itself to be suspect", async () => {
    await assert.rejects(
      flaggedSpan(flagged(Flag.good), e, ["a/b"], { untilDay: false }),
      /aren't suspect/,
    );
  });
});
