// The public site for people using Stillwell's data; contributor docs stay in docs/.
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const sources = await fetch("https://stillwell.openwaters.io/sources.json").then((r) => r.json());

export default defineConfig({
  integrations: [
    starlight({
      title: "Stillwell",
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/openwatersio/stillwell" },
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Reading the data", slug: "guide/reading-the-data" },
            { label: "Query the store", link: "/query/" },
          ],
        },
        {
          label: "Sources",
          collapsed: true,
          items: sources
            .map((s) => ({ label: s.name, link: `/sources/${s.id}/` }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        },
      ],
    }),
  ],
  vite: {
    // DuckDB-WASM ships its own workers and wasm, which Vite's prebundling breaks.
    optimizeDeps: { exclude: ["@duckdb/duckdb-wasm"] },
  },
});
