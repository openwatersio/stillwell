import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  citations,
  closedIds,
  errataOf,
  fromPublished,
  HANDLING,
  openErrata,
  parseErratum,
  published,
  settle,
  UnknownSource,
  type Erratum,
} from "../src/errata.ts";
import { fetchText, setTransport } from "../src/http.ts";
import { readJsonArray, writeJsonArray } from "../src/lake/parquet.ts";
import { sources } from "../src/sources/index.ts";

const IDS = Object.keys(sources);

/** An issue body as the form writes it. */
const body = (fields: Partial<Record<string, string>> = {}) =>
  Object.entries({
    "What's wrong": "UHSLC's Hong Kong heights are an hour early.",
    "Erratum ID": "uhslc-hong-kong-hour-early",
    Source: "uhslc",
    Stations: "uhslc/329\nuhslc/329a",
    "Values since": "_No response_",
    "Values until": "_No response_",
    Handling: "corrected",
    "What the lake does": "Shifted an hour later.",
    Evidence: "A clock check.\n\n### Method\n\nFitted M2 phases.",
    "Report to the agency": "- [ ] Draft the report",
    ...fields,
  })
    .map(([heading, text]) => `### ${heading}\n\n${text}`)
    .join("\n\n");

afterEach(() => setTransport(fetchText));

describe("errata", () => {
  it("reads an erratum from an issue written with the form", () => {
    assert.deepEqual(parseErratum(63, body(), IDS), {
      id: "uhslc-hong-kong-hour-early",
      source: "uhslc",
      stations: ["uhslc/329", "uhslc/329a"],
      since: null,
      until: null,
      error: "UHSLC's Hong Kong heights are an hour early.",
      handling: "corrected",
      lake: "Shifted an hour later.",
      issue: 63,
    });
  });

  it("reads every station, none listed, dates, and stations in a list", () => {
    const every = parseErratum(1, body({ Stations: "every station" }), IDS);
    const none = parseErratum(1, body({ Stations: "None listed" }), IDS);
    const listed = parseErratum(1, body({ Stations: "- `uhslc/329`\n\n- uhslc/329a" }), IDS);
    const dated = parseErratum(
      1,
      body({ "Values since": "2020-01-01", "Values until": "2025-01-01" }),
      IDS,
    );
    assert.deepEqual(
      [every.stations, none.stations, listed.stations, [dated.since, dated.until]],
      [null, [], ["uhslc/329", "uhslc/329a"], ["2020-01-01", "2025-01-01"]],
    );
  });

  it("refuses an issue it can't read, naming the issue and the field", () => {
    const refused = (fields: Partial<Record<string, string>>, message: RegExp) =>
      assert.throws(() => parseErratum(7, body(fields), IDS), message);
    refused({ Source: "nowhere" }, /#7: no source nowhere/);
    refused({ Source: "uhslc(" }, /#7: source uhslc\( isn't a source ID/);
    refused({ "Erratum ID": "usgs-hong-kong" }, /#7: erratum ID usgs-hong-kong isn't uhslc-<what>/);
    refused({ Stations: "usgs/1" }, /#7: station usgs\/1 isn't uhslc's/);
    refused({ "Values since": "1 May 2020" }, /#7: "Values since" is 1 May 2020/);
    refused({ "Values until": "2026-02-30" }, /#7: "Values until" is 2026-02-30/);
    refused({ "Values since": "2025-01-01", "Values until": "2020-01-01" }, /isn't before/);
    refused({ Handling: "ignored" }, /#7: handling ignored isn't one of/);
    refused({ "What the lake does": "_No response_" }, /#7: "What the lake does" is blank/);
    assert.throws(() => parseErratum(7, "Some prose.", IDS), /#7: no "### Source" heading/);
  });

  it("reads maintainers' open issues, leaving out pull requests, and reports bad ones", async () => {
    const asked: string[] = [];
    const issue = (number: number, b: string | null, more: object = {}) => ({
      number,
      body: b,
      author_association: "MEMBER",
      ...more,
    });
    setTransport(async (url) => {
      asked.push(url);
      if (/state=closed/.test(url))
        return JSON.stringify([
          issue(9, body({ "Erratum ID": "uhslc-closed" })),
          // A duplicate of #63 opened after it and closed doesn't take its ID.
          issue(80, body()),
        ]);
      return JSON.stringify([
        issue(69, body({ "Erratum ID": "uhslc-closed" })),
        issue(64, body({ "Erratum ID": "uhslc-twice" })),
        issue(63, body(), { author_association: "OWNER" }),
        issue(70, body(), { pull_request: {} }),
        issue(65, body({ "Erratum ID": "uhslc-twice" }), { author_association: "COLLABORATOR" }),
        issue(66, null),
        // The form labels anyone's issue; a stranger's isn't an erratum.
        issue(67, body({ "Erratum ID": "uhslc-stranger" }), { author_association: "NONE" }),
        issue(68, body(), { author_association: "CONTRIBUTOR" }),
        // A source whose adapter isn't registered yet, such as one still in a pull request.
        issue(
          71,
          body({ Source: "newsource", "Erratum ID": "newsource-clock", Stations: "newsource/a" }),
        ),
        // Its other fields are still checked, and its ID can't be reused.
        issue(
          72,
          body({
            Source: "newsource",
            "Erratum ID": "newsource-x",
            Stations: "newsource/a",
            Handling: "ignored",
          }),
        ),
        issue(
          73,
          body({ Source: "newsource", "Erratum ID": "newsource-clock", Stations: "newsource/b" }),
        ),
      ]);
    });
    const { errata, problems, ignored, unregistered } = await openErrata(IDS);
    assert.deepEqual(
      asked.map((url) => /state=(\w+)/.exec(url)![1]),
      ["closed", "open"],
    );
    assert.ok(asked.every((url) => url.includes("labels=source-error")));
    assert.deepEqual(
      errata.map((e) => [e.issue, e.id]),
      [
        [63, "uhslc-hong-kong-hour-early"],
        [64, "uhslc-twice"],
      ],
    );
    assert.deepEqual(problems, [
      { issue: 65, message: "#65: erratum ID uhslc-twice is #64's too" },
      { issue: 66, message: `#66: no "### Source" heading` },
      { issue: 69, message: "#69: erratum ID uhslc-closed is closed #9's" },
      {
        issue: 72,
        message:
          "#72: handling ignored isn't one of corrected, flagged, dropped, refused, avoided, kept",
      },
      { issue: 73, message: "#73: erratum ID newsource-clock is #71's too" },
    ]);
    assert.deepEqual(ignored, [67, 68]);
    assert.deepEqual(
      unregistered.map((u) => [u.issue, u.source, u.erratum?.id]),
      [[71, "newsource", "newsource-clock"]],
    );
  });

  it("finds the IDs of closed issues, which a new one may not reuse", async () => {
    setTransport(async (url) => {
      assert.match(url, /state=closed/);
      return JSON.stringify([
        { number: 9, body: body({ "Erratum ID": "`uhslc-old`" }), author_association: "MEMBER" },
        { number: 8, body: "## Evidence\n\nAn old template.", author_association: "MEMBER" },
        { number: 12, body: body({ "Erratum ID": "uhslc-old" }), author_association: "MEMBER" },
        // Anyone can open and close an issue with the form; a stranger's holds no ID.
        { number: 7, body: body({ "Erratum ID": "uhslc-taken" }), author_association: "NONE" },
      ]);
    });
    assert.deepEqual([...(await closedIds())], [["uhslc-old", 9]]);
  });

  it("keeps what was published last for an issue it can't read, or when it can't read any", () => {
    const one = parseErratum(63, body(), IDS);
    const two = { ...one, id: "uhslc-two", issue: 64 };
    const three = { ...one, id: "uhslc-three", issue: 65 };
    const four = { ...one, id: "uhslc-four", issue: 66 };
    const previous = [one, two, four];
    // #64 doesn't parse now and #66's author no longer counts, so both keep
    // their last erratum; #63 changed and takes the new one.
    const changed = { ...one, lake: "Changed." };
    const fetched = {
      errata: [three, changed],
      problems: [{ issue: 64, message: "#64: bad" }],
      ignored: [66, 70],
    };
    assert.deepEqual(settle(fetched, previous), {
      errata: [changed, two, three, four],
      notes: [
        "#64: bad; kept uhslc-two as published last",
        "#66: not opened by a maintainer; kept uhslc-four as published last",
      ],
    });
    const none = { errata: [], problems: [{ issue: 67, message: "#67: bad" }], ignored: [] };
    assert.deepEqual(settle(none, []).notes, ["#67: bad; left out"]);
    assert.deepEqual(settle(new Error("timed out"), previous).errata, previous);
    // An erratum the code still cites stays, though its issue is gone.
    assert.deepEqual(
      settle({ errata: [three], problems: [], ignored: [] }, previous, new Set(["uhslc-two"])),
      {
        errata: [two, three],
        notes: [
          "uhslc-two is cited in the code, but no open issue holds it; kept as published last",
        ],
      },
    );
    // A published erratum whose source this build doesn't register, or was
    // mistyped in an edit, is left out, and the run says so.
    const gone = new UnknownSource(64, "uhslcc");
    assert.deepEqual(
      settle({ errata: [one], problems: [], ignored: [], unregistered: [gone] }, previous).notes,
      ["#64: no source uhslcc in this build; uhslc-two, published last, is left out"],
    );
    // Every issue closed is no errata.
    assert.deepEqual(settle({ errata: [], problems: [], ignored: [] }, previous), {
      errata: [],
      notes: [],
    });
  });

  it("reads back the errata errata.json holds", async () => {
    const dir = mkdtempSync(join(tmpdir(), "errata-"));
    try {
      const path = join(dir, "errata.json");
      assert.equal(await readJsonArray(path), null);
      const errata = [
        parseErratum(63, body(), IDS),
        parseErratum(
          61,
          body({
            "Erratum ID": "uhslc-dated",
            Stations: "every station",
            "Values since": "2020-01-01",
          }),
          IDS,
        ),
      ];
      await writeJsonArray(path, published(errata));
      assert.deepEqual(fromPublished((await readJsonArray(path))!), errata);
      await writeJsonArray(path, []);
      assert.deepEqual(fromPublished((await readJsonArray(path))!), []);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("lists a station's errata: its own, and its source's for every station", () => {
    const e = (id: string, stations: string[] | null): Erratum => ({
      ...parseErratum(1, body(), IDS),
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

  it("finds citations in code and docs", () => {
    assert.deepEqual(
      citations("see erratum `jma-saigo-1980-day-stamp`, and Erratum\n`usace-zero-elevation`."),
      ["jma-saigo-1980-day-stamp", "usace-zero-elevation"],
    );
  });

  it("offers every registered source and handling in the issue form", () => {
    const form = readFileSync(
      new URL("../.github/ISSUE_TEMPLATE/source-error.yml", import.meta.url),
      "utf8",
    );
    // A dropdown's options, the "- " lines that follow its label.
    const options = (label: string) =>
      form
        .split(`label: ${label}\n`)[1]!
        .split(/options:\n/)[1]!
        .split("\n")
        .filter(
          (line, i, lines) =>
            /^ {8}- /.test(line) && lines.slice(0, i).every((l) => /^ {8}- /.test(l)),
        )
        .map((line) => line.trim().slice(2));
    assert.deepEqual(options("Source"), IDS.toSorted());
    assert.deepEqual(options("Handling"), [...HANDLING]);
  });
});
