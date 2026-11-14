// A source adapter's README as its page on the site shows it: what the README says about the source's data,
// without the parts about running ingest against it.
import { existsSync, readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import markdownit from "markdown-it";
import { sitePath } from "./paths";

const REPO = "https://github.com/openwatersio/stillwell/blob/main/";
// Builds run in site/, so the repository's root is its parent.
const SOURCES = resolve(process.cwd(), "..", "src/sources");

// Sections about fetching data.
const SKIP_SECTION = /^##\s+Backfill\b/;
// In an Errata section, the bullets for an erratum, which the source page lists from errata.json; the
// section's other notes, such as GESLA's clock check, stay.
const ERRATUM_BULLET = /^- \*\*.*\(.*erratum `/;
/** A heading's id on the source page, prefixed so it can't collide with the page's own sections. */
const slug = (text: string) =>
  "about-" +
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

/** Where a README's link goes from the site: a heading on this page, another source's page, or the file on GitHub. */
function target(href: string, id: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith("//")) return href;
  if (href.startsWith("#")) return `#about-${href.slice(1)}`;
  const [file, anchor] = href.split("#");
  // A root-relative link is relative to the repository, as on GitHub.
  const path = file!.startsWith("/")
    ? posix.normalize(file!.slice(1))
    : posix.normalize(posix.join("src/sources", id, file!));
  const source = path.match(/^src\/sources\/([^/]+)\/README\.md$/);
  if (source) return sitePath(`/sources/${source[1]}/`) + (anchor ? `#about-${anchor}` : "");
  return REPO + path + (anchor ? `#${anchor}` : "");
}

/** The README's text for the site: no title, no Backfill sections or erratum bullets, and headings a level down. */
export function readmeText(markdown: string): string {
  const out: string[] = [];
  let section = "";
  let bullet = false;
  let fence = false;
  for (const line of markdown.split("\n")) {
    // A code block's lines are kept or dropped with what holds them, never read as headings or bullets.
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (fence) {
      if (!SKIP_SECTION.test(section) && !bullet) out.push(line);
      continue;
    }
    if (/^# /.test(line)) continue;
    if (/^## /.test(line)) section = line;
    if (SKIP_SECTION.test(section)) continue;
    // A bullet runs until the next bullet, heading or blank line.
    if (/^- /.test(line)) bullet = /^##\s+Errata\b/.test(section) && ERRATUM_BULLET.test(line);
    else if (!line.trim() || /^#/.test(line)) bullet = false;
    if (bullet) continue;
    out.push(line.replace(/^(#{2,5}) /, "#$1 "));
  }
  // A section left with nothing, such as an Errata section of erratum bullets only, loses its heading too.
  return (
    out
      .join("\n")
      // Contributor docs stay in the repository, so a link to one keeps only its text.
      .replace(/\[([^\]]+)\]\((?:\.\.\/)+(?:docs\/[^)]*|CONTRIBUTING\.md[^)]*)\)/g, "$1")
      .replace(/^#{3,6} [^\n]*\n\s*(?=#{3} |$(?![\s\S]))/gm, "")
      .trim()
  );
}

/** A heading in a rendered README, for the page's table of contents. */
export type Heading = { depth: number; slug: string; text: string };

/**
 * A source's README rendered for its page on the site, with its headings for the table of contents, or
 * undefined where the adapter has none. The build fails if the adapters can't be found at all, rather than
 * leave every source page without its README.
 */
export function readme(id: string): { html: string; headings: Heading[] } | undefined {
  if (!existsSync(SOURCES))
    throw new Error(`No source adapters at ${SOURCES}; build the site from site/`);
  const file = resolve(SOURCES, id, "README.md");
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, "utf8");
  // html: false escapes any raw HTML in the README.
  const md = markdownit({ html: false, linkify: true });
  const headings: Heading[] = [];
  const seen = new Map<string, number>();
  const link = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    const href = tokens[i]!.attrGet("href");
    if (href) tokens[i]!.attrSet("href", target(href, id));
    return link ? link(tokens, i, options, env, self) : self.renderToken(tokens, i, options);
  };
  md.renderer.rules.heading_open = (tokens, i, options, _env, self) => {
    const text = tokens[i + 1]?.content ?? "";
    // A repeated heading gets a number, as GitHub numbers them, so each id is unique.
    const base = slug(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const anchor = n ? `${base}-${n}` : base;
    tokens[i]!.attrSet("id", anchor);
    headings.push({ depth: Number(tokens[i]!.tag.slice(1)), slug: anchor, text });
    return self.renderToken(tokens, i, options);
  };
  return { html: md.render(readmeText(text)), headings };
}
