import markdownit from "npm:markdown-it";

// html: false escapes any raw HTML in the text, and markdown-it refuses javascript: links, so its output is safe to insert.
const renderer = markdownit({ html: false, linkify: true });

/** Markdown from the store's JSON (errata, terms) as an element. */
export function md(text) {
  const div = document.createElement("div");
  div.innerHTML = renderer.render(text ?? "");
  return div;
}
