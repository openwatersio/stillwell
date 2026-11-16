import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { readmeText, slug } from "../site/src/lib/readme-text.ts";

const SOURCES = fileURLToPath(new URL("../src/sources/", import.meta.url));

describe("readmeText", () => {
  it("drops the title and the Running ingest section, and moves headings a level down", () => {
    const text = readmeText(
      [
        "# Source",
        "",
        "- **Levels:** hourly.",
        "",
        "## Compared with another source",
        "",
        "They agree.",
        "",
        "## Running ingest",
        "",
        "- **Rate limit:** 10 a second.",
        "",
        "### Backfill",
        "",
        "Run it twice.",
      ].join("\n"),
    );
    assert.equal(text, "- **Levels:** hourly.\n\n### Compared with another source\n\nThey agree.");
  });

  it("keeps a code block whole, whatever its lines look like", () => {
    const text = readmeText(
      ["- **Levels:** hourly.", "", "```bash", "# a comment", "## not a heading", "```"].join("\n"),
    );
    assert.match(text, /# a comment\n## not a heading/);
  });

  it("drops a code block inside Running ingest", () => {
    const text = readmeText(
      ["Intro.", "", "## Running ingest", "", "```bash", "node run", "```"].join("\n"),
    );
    assert.equal(text, "Intro.");
  });

  it("keeps only the text of a link to contributor docs", () => {
    const text = readmeText(
      "See [the plan](../../../docs/plans/plan.md) and [withheld stations](../../../CONTRIBUTING.md#withheld-stations), and [the code](../../stations.ts).",
    );
    assert.equal(text, "See the plan and withheld stations, and [the code](../../stations.ts).");
  });

  it("lays out every adapter's README as its source page needs", () => {
    let checked = 0;
    for (const id of readdirSync(SOURCES, { withFileTypes: true })) {
      if (!id.isDirectory()) continue;
      let markdown: string;
      try {
        markdown = readFileSync(join(SOURCES, id.name, "README.md"), "utf8");
      } catch {
        continue;
      }
      const sections = [...markdown.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      assert.ok(
        !sections.some((s) => /^Backfill/.test(s!)),
        `${id.name}: a Backfill section belongs under ## Running ingest`,
      );
      const at = sections.indexOf("Running ingest");
      if (at >= 0)
        assert.equal(at, sections.length - 1, `${id.name}: ## Running ingest is the last section`);
      // Errata are documented in errata.json alone, which the page lists.
      assert.ok(
        !sections.includes("Errata"),
        `${id.name}: errata belong in errata.json, not the README`,
      );
      // What the page shows: none of the runbook, and no link a reader can't follow.
      checked++;
      const shown = readmeText(markdown);
      assert.doesNotMatch(
        shown,
        /^#+ (Running ingest|Backfill)/m,
        `${id.name}: shows ingest notes`,
      );
      assert.doesNotMatch(
        shown,
        /\]\((\.\.\/)+(docs\/|CONTRIBUTING)/,
        `${id.name}: links into docs/`,
      );
    }
    assert.ok(checked >= 20, `checked only ${checked} adapter READMEs`);
  });
});

describe("slug", () => {
  it("makes GitHub's heading id, prefixed", () => {
    assert.equal(slug("4.0 records missing from 4.1"), "about-40-records-missing-from-41");
    assert.equal(slug("source_qc_start"), "about-source_qc_start");
    assert.equal(slug("A - B"), "about-a---b");
  });
});
