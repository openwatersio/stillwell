import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { sources } from "../src/sources/index.ts";

// A fact about one source lives in its own directory (CONTRIBUTING.md, Where facts live), so shared docs and
// config don't list sources: a list is one more place every new source would have to edit.

const files = (dir: string, pattern: RegExp) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((f) => pattern.test(f))
    .map((f) => join(dir, f));

/** What runs and operates every source: no line names more than two. */
const OPERATIONS = [
  "CONTRIBUTING.md",
  ...files("docs/contributing", /\.md$/),
  "site/README.md",
  "scripts/monthly.sh",
  ...files("server/deploy", /\.(md|sh|example|service)$/),
  ...files(".github/workflows", /\.yml$/),
];

/** The site's guides, which explain how sources relate, but give no source a section of its own. */
const GUIDES = files("site/src/content/docs/docs/guides", /\.mdx?$/);

/** A source's ID as prose writes it: any case, with or without hyphens or spaces (`CO-OPS`, `Marine Institute`). */
const NAMED = Object.keys(sources).map((id) => ({
  id,
  pattern: new RegExp(`(?<![\\w/-])${id.replace(/-/g, "").split("").join("[- ]?")}(?![\\w-])`, "i"),
}));
const namedIn = (text: string) =>
  NAMED.filter(({ pattern }) => pattern.test(text)).map((n) => n.id);

describe("shared docs and config", () => {
  it("name no more than two sources on a line", () => {
    const lists = OPERATIONS.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => {
          const ids = namedIn(line);
          return ids.length > 2 ? [`${file}:${i + 1} names ${ids.join(", ")}`] : [];
        }),
    );
    assert.deepEqual(
      lists,
      [],
      "move each source's part to its own directory and state the rule here",
    );
  });

  it("branch on no source in a script or workflow", () => {
    const ids = new Set(Object.keys(sources));
    const branches = OPERATIONS.filter((f) => !f.endsWith(".md")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => {
          // A shell `case` arm (`usgs | dwr)`), or a test of a source against a literal (`== 'bsh'`, `= bsh`).
          const arm = /^\s*([\w-]+(\s*\|\s*[\w-]+)*)\)/.exec(line)?.[1]?.split(/\s*\|\s*/) ?? [];
          const tested = [...line.matchAll(/(?:==|!=|\s=)\s*['"]?([\w-]+)['"]?/g)].map(
            (m) => m[1]!,
          );
          const hit = [...arm, ...tested].filter((w) => ids.has(w));
          return hit.length ? [`${file}:${i + 1} branches on ${hit.join(", ")}`] : [];
        }),
    );
    assert.deepEqual(
      branches,
      [],
      "put what the source does differently in its adapter's metadata or schedule",
    );
  });

  it("give no more than two sources a bullet of their own in a guide", () => {
    const lists = GUIDES.flatMap((file) => {
      const led = readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) => {
          // The bullet's lead: its bold or link text, or its first few words.
          const lead = /^\s*[-*]\s+(\*\*.+?\*\*|\[.+?\]|\S+(\s+\S+){0,2})/.exec(line)?.[1];
          return lead && namedIn(lead).length ? [i + 1] : [];
        });
      return led.length > 2 ? [`${file}: lines ${led.join(", ")} each lead with a source`] : [];
    });
    assert.deepEqual(lists, [], "each source's README holds its own part; the guide links to it");
  });

  it("give every source a canary probe of its own", async () => {
    const missing: string[] = [];
    for (const id of Object.keys(sources)) {
      const file = `src/sources/${id}/canary.ts`;
      const probes = existsSync(file) ? (await import(`../${file}`)).probes : {};
      if (!probes[id]) missing.push(id);
    }
    assert.deepEqual(missing, [], "each source's canary.ts exports a probe under its ID");
  });
});
