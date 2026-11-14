// The public site for people using Stillwell's data; contributor docs stay in docs/.
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import { satteri } from "@astrojs/markdown-satteri";

// GitHub Pages serves the site under the repository's name.
const base = "/stillwell";

// Root-relative links in the docs' Markdown, such as /docs/getting-started/, get the base path.
const rooted = (url) =>
  url.startsWith("/") && !url.startsWith("//") && url !== base && !url.startsWith(`${base}/`);
const baseLinks = {
  name: "base-links",
  link(node, ctx) {
    if (rooted(node.url)) ctx.setProperty(node, "url", base + node.url);
  },
  definition(node, ctx) {
    if (rooted(node.url)) ctx.setProperty(node, "url", base + node.url);
  },
};

export default defineConfig({
  site: "https://openwatersio.github.io",
  base,
  markdown: { processor: satteri({ mdastPlugins: [baseLinks] }) },
  integrations: [
    starlight({
      title: "Stillwell",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/openwatersio/stillwell" },
      ],
      sidebar: [
        {
          label: "Guides",
          items: [
            { label: "Introduction", slug: "docs" },
            "docs/getting-started",
            "docs/guides/gauges",
            "docs/guides/datums",
            "docs/guides/quality-flags",
            "docs/guides/terms",
          ],
        },
        {
          label: "Reference",
          items: [
            "docs/reference/stations",
            "docs/reference/observations",
            "docs/reference/predictions",
            "docs/reference/offsets",
            "docs/reference/links",
            "docs/reference/sources",
            "docs/reference/errata",
          ],
        },
        {
          label: "Examples",
          items: [
            {
              label: "Notebooks",
              items: [{ autogenerate: { directory: "docs/examples/notebooks" } }],
            },
            { label: "Tools", items: [{ autogenerate: { directory: "docs/examples/tools" } }] },
          ],
        },
        { label: "Query the store", link: "/query/" },
      ],
    }),
  ],
  vite: {
    // DuckDB-WASM ships its own workers and wasm, which Vite's prebundling breaks.
    optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
  },
});
