// The text of a source adapter's README as its page on the site shows it, kept free of the site's build
// imports so the repository's tests can check it.

// The section about operating the adapter, which a README keeps last.
const SKIP_SECTION = /^##\s+Running ingest\b/;
// In an Errata section, a bullet for one erratum, which the source page lists from errata.json.
const ERRATUM_BULLET = /^- \*\*.*\(.*erratum `/;

/** A heading's id on the source page: GitHub's, prefixed so it can't collide with the page's own sections. */
export const slug = (text: string) =>
  "about-" +
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/**
 * The README's text for the site: no title, no Running ingest section, no erratum bullets, no links to
 * contributor docs, and headings a level down, under the page's own.
 */
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
  return (
    out
      .join("\n")
      // Contributor docs stay in the repository, so a link to one keeps only its text.
      .replace(/\[([^\]]+)\]\((?:\.\.\/)+(?:docs\/[^)]*|CONTRIBUTING\.md[^)]*)\)/g, "$1")
      // A section left with nothing, such as an Errata section of erratum bullets only, loses its heading too.
      .replace(/^#{3,6} [^\n]*\n\s*(?=#{3} |$(?![\s\S]))/gm, "")
      .trim()
  );
}
