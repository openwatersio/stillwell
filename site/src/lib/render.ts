// Build-time rendering helpers: charts as static SVG and Markdown from the store's JSON.
import * as Plot from "@observablehq/plot";
import { JSDOM } from "jsdom";
import markdownit from "markdown-it";

const { document } = new JSDOM("").window;

/** An Observable Plot chart rendered to markup at build time, as Plot's docs describe for Node. */
export function plot(options: Plot.PlotOptions): string {
  return Plot.plot({ ...options, document }).outerHTML;
}

export const FLAGS = ["good", "interpolated", "preliminary", "suspect", "bad"];
const FLAG_COLORS = ["#4e79a7", "#76b7b2", "#bab0ac", "#f28e2b", "#e15759"];

/** Values per year stacked by flag, from years-list rows. */
export function flagChart(years: Record<string, any>[], width = 720): string {
  const data = years.flatMap((y) =>
    FLAGS.map((flag) => ({ year: y.year, flag, n: Number(y[flag] ?? 0) })),
  );
  return plot({
    width,
    height: 240,
    marginLeft: 60,
    x: { label: null, tickFormat: "d" },
    y: { label: "Values", grid: true },
    color: { legend: true, domain: FLAGS, range: FLAG_COLORS },
    marks: [
      Plot.rectY(data, { x1: "year", x2: (d) => d.year + 1, y: "n", fill: "flag", order: FLAGS }),
      Plot.ruleY([0]),
    ],
  });
}

// html: false escapes any raw HTML in the text, and markdown-it refuses javascript: links, so its output is safe.
const md = markdownit({ html: false, linkify: true });
export const markdown = (text: string | null | undefined) => md.render(text ?? "");
