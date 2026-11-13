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
        { label: "Introduction", slug: "docs" },
        { label: "Getting started", slug: "docs/getting-started" },
        {
          label: "Reference",
          items: [
            "docs/reference/stations",
            "docs/reference/gauges",
            "docs/reference/series",
            "docs/reference/datums",
            "docs/reference/offsets",
            "docs/reference/links",
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
