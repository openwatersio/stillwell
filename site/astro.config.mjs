// The public site for people using Stillwell's data; contributor docs stay in docs/.
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
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
          label: "Reference: files",
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
