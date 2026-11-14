// The public site for people using Stillwell's data; contributor docs stay in docs/.
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  redirects: {
    "/docs/guides/quality-flags/": "/docs/guides/quality-control/",
    "/docs/guides/gauges/": "/docs/guides/stations/",
  },
  integrations: [
    starlight({
      title: "Stillwell",
      customCss: ["./src/styles/custom.css"],
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/openwatersio/stillwell" },
      ],
      sidebar: [
        {
          label: "Overview",
          items: [
            { label: "Introduction", slug: "docs" },
            "docs/getting-started",
            "docs/sources",
            "docs/guides/stations",
            "docs/guides/datums",
            "docs/guides/quality-control",
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
