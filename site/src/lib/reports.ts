// The work-planning reports the repository's scripts write to reports/ before the site builds, rendered for their pages.
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import markdownit from "markdown-it";
import type { Heading } from "./readme";
import { slug } from "./readme-text";

const REPO = "https://github.com/openwatersio/stillwell/blob/main/";
// Builds run in site/, so the repository's root is its parent.
const DIR = resolve(process.cwd(), "..", process.env.STILLWELL_REPORTS ?? "reports");

/** Each report's name in its file names and path, with its title and the command that writes it. */
export const REPORTS: Record<string, { title: string; command: string }> = {
  "ticon-inventory": { title: "TICON inventory", command: "npm run ticon:inventory" },
  "gesla-coverage": { title: "GESLA coverage", command: "npm run gesla:coverage" },
};

const file = (name: string, ext: string) => resolve(DIR, `${name}.${ext}`);

/** The report's CSV, or undefined where this build didn't write it. */
export function reportCsv(name: string): string | undefined {
  const path = file(name, "csv");
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/**
 * The report's summary rendered without its title, with its headings for the table of contents and when it was
 * written, or undefined where this build didn't write it. A root-relative link goes to the file on GitHub.
 */
export function report(
  name: string,
): { html: string; headings: Heading[]; written: Date } | undefined {
  const path = file(name, "md");
  if (!existsSync(path)) return undefined;
  // html: false escapes any raw HTML in the text.
  const md = markdownit({ html: false, linkify: true });
  const headings: Heading[] = [];
  const link = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    const href = tokens[i]!.attrGet("href");
    if (href?.startsWith("/") && !href.startsWith("//"))
      tokens[i]!.attrSet("href", REPO + href.slice(1));
    return link ? link(tokens, i, options, env, self) : self.renderToken(tokens, i, options);
  };
  md.renderer.rules.heading_open = (tokens, i, options, _env, self) => {
    const text = (tokens[i + 1]?.children ?? [])
      .filter((t) => t.type === "text" || t.type === "code_inline")
      .map((t) => t.content)
      .join("");
    tokens[i]!.attrSet("id", slug(text));
    headings.push({ depth: Number(tokens[i]!.tag.slice(1)), slug: slug(text), text });
    return self.renderToken(tokens, i, options);
  };
  const text = readFileSync(path, "utf8").replace(/^# .*\n/, "");
  return { html: md.render(text), headings, written: statSync(path).mtime };
}
