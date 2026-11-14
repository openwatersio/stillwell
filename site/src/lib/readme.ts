// A source adapter's README as its page on the site shows it: what the README says about the source's data,
// without the parts about running ingest against it.
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import markdownit from "markdown-it";
import { sitePath } from "./paths";

const REPO = "https://github.com/openwatersio/stillwell/blob/main/";

// Sections about fetching, and errata, which the source page lists from errata.json.
const SKIP_SECTION = /^##\s+(Backfill|Errata)\b/;
// Bullets about running ingest against the source rather than about its data.
const SKIP_BULLET =
  /^- \*\*(Backfill|Backfill size|Compaction|Rate limit|Request limits|Limits)[:*]/;

/** Where a README's relative link goes from the site: another source's page, or the file on GitHub. */
function target(href: string, id: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return href;
  const [file, anchor] = href.split("#");
  const path = posix.normalize(posix.join("src/sources", id, file));
  const source = path.match(/^src\/sources\/([^/]+)\/README\.md$/);
  if (source) return sitePath(`/sources/${source[1]}/`) + (anchor ? `#${anchor}` : "");
  return REPO + path + (anchor ? `#${anchor}` : "");
}

/** The README's text for the site: no title, no ingest sections or bullets, and headings a level down. */
export function readmeText(markdown: string): string {
  const out: string[] = [];
  let skipping = false;
  let bullet = false;
  for (const line of markdown.split("\n")) {
    if (/^# /.test(line)) continue;
    if (/^## /.test(line)) skipping = SKIP_SECTION.test(line);
    if (skipping) continue;
    // A bullet runs until the next bullet, heading or blank line.
    if (/^- /.test(line)) bullet = SKIP_BULLET.test(line);
    else if (!line.trim() || /^#/.test(line)) bullet = false;
    if (bullet) continue;
    out.push(line.replace(/^(#{2,5}) /, "#$1 "));
  }
  return out.join("\n").trim();
}

/** A heading in a rendered README, for the page's table of contents. */
export type Heading = { depth: number; slug: string; text: string };

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

/**
 * A source's README rendered for its page on the site, with its headings for the table of contents, or
 * undefined where the adapter has none. Heading ids start with `about-`, so none collides with the page's own.
 */
export function readme(id: string): { html: string; headings: Heading[] } | undefined {
  let text: string;
  try {
    // Builds run in site/, so the repository's root is its parent.
    text = readFileSync(resolve(process.cwd(), "..", "src/sources", id, "README.md"), "utf8");
  } catch {
    return undefined;
  }
  // html: false escapes any raw HTML in the README.
  const md = markdownit({ html: false, linkify: true });
  const headings: Heading[] = [];
  const link = md.renderer.rules.link_open;
  md.renderer.rules.link_open = (tokens, i, options, env, self) => {
    const href = tokens[i]!.attrGet("href");
    if (href) tokens[i]!.attrSet("href", target(href, id));
    return link ? link(tokens, i, options, env, self) : self.renderToken(tokens, i, options);
  };
  md.renderer.rules.heading_open = (tokens, i, options, _env, self) => {
    const text = tokens[i + 1]?.content ?? "";
    const depth = Number(tokens[i]!.tag.slice(1));
    const anchor = `about-${slug(text)}`;
    tokens[i]!.attrSet("id", anchor);
    headings.push({ depth, slug: anchor, text });
    return self.renderToken(tokens, i, options);
  };
  return { html: md.render(readmeText(text)), headings };
}
