---
title: Query the store
toc: false
---

```js
import { sql } from "./components/duckdb.js";
import { queryLink } from "./components/store.js";
```

# Query the store

Write SQL against the store and run it in your browser with [DuckDB](https://duckdb.org/docs/sql/introduction) ${(await sql`SELECT version() AS v`)[0].v}. Read any file by its URL, as in the examples. The query is saved in this page's address, so copy the link to share it.

```js
const EXAMPLES = {
  "Stations per source": `SELECT source, count(*) AS stations, count(*) FILTER (WHERE live) AS live
FROM 'https://stillwell.openwaters.io/stations.parquet'
GROUP BY source ORDER BY stations DESC`,
  "Nearest gauges to a point": `SELECT id, name, round(6371 * acos(least(1,
    sin(radians(lat)) * sin(radians(51.98)) +
    cos(radians(lat)) * cos(radians(51.98)) * cos(radians(lon - 4.12)))), 2) AS km
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE status = 'active' AND list_contains(products, 'levels') AND preferred = id
ORDER BY km LIMIT 10`,
  "A month's daily range": `SELECT date_trunc('day', time) AS day, min(level_m) AS low_m, max(level_m) AS high_m, count(*) AS n
FROM 'https://stillwell.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
WHERE flag <= 2 AND time < '2024-02-01'
GROUP BY ALL ORDER BY day`,
  "Largest surges": `SELECT o.time, o.level_m AS observed_m, p.level_m AS predicted_m, round(o.level_m - p.level_m, 2) AS residual_m
FROM 'https://stillwell.openwaters.io/obs/rws/hoekvanholland/2024.parquet' o
JOIN 'https://stillwell.openwaters.io/predictions/rws/hoekvanholland/2024.parquet' p USING (time)
ORDER BY abs(o.level_m - p.level_m) DESC LIMIT 10`,
  "Errata by how they're handled": `SELECT handling, count(*) AS errata, list(id ORDER BY id)[:5] AS some
FROM read_json('https://stillwell.openwaters.io/errata.json')
GROUP BY handling ORDER BY errata DESC`,
};
// A link that changes only the #q= part doesn't reload the page, so load its query.
addEventListener("hashchange", () => location.reload(), { once: true });
const fromHash = () => {
  const q = new URLSearchParams(location.hash.slice(1)).get("q");
  return q ?? EXAMPLES["Stations per source"];
};
```

```js
const example = view(
  Inputs.select([null, ...Object.keys(EXAMPLES)], {
    label: "Start from",
    format: (k) => k ?? "your query",
  }),
);
```

```js
const editor = Inputs.textarea({
  value: example ? EXAMPLES[example] : fromHash(),
  rows: 10,
  submit: "Run",
  monospace: true,
  width: "100%",
  spellcheck: false,
});
const query = view(editor);
```

```js
history.replaceState(null, "", `#q=${encodeURIComponent(query)}`);
const started = performance.now();
const result = await sql([query]).then(
  (rows) => ({ rows, ms: performance.now() - started }),
  (error) => ({ error }),
);
```

```js
display(
  result.error
    ? html`<pre style="color: var(--theme-red)">${result.error.message}</pre>`
    : html`<p class="muted">
        ${result.rows.length.toLocaleString()} ${result.rows.length === 1 ? "row" : "rows"} in
        ${(result.ms / 1000).toFixed(1)} s
      </p>`,
);
if (!result.error) display(Inputs.table(result.rows, { select: false, rows: 20 }));
```

```js
const csv = () =>
  d3.csvFormat(
    result.rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          v instanceof Date
            ? v.toISOString()
            : v !== null && typeof v === "object"
              ? JSON.stringify(v)
              : v,
        ]),
      ),
    ),
  );
if (!result.error && result.rows.length)
  display(
    Inputs.button("Download as CSV", {
      reduce: () => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([csv()], { type: "text/csv" }));
        a.download = "query.csv";
        a.click();
        URL.revokeObjectURL(a.href);
      },
    }),
  );
```

## What's in the store

| File                                                  | What it holds                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `stations.parquet`                                    | One row per station: position, datum and offsets, links to other sources, terms |
| `sources.json`, `errata.json`                         | Each source's terms, and the errors found in what sources publish               |
| `stations/years/<source>.parquet`                     | Which year files each station has, with counts by flag                          |
| `obs/<source>/<station>/<year>.parquet`               | Observed levels: `time`, `level_m`, `flag`, `source_flag`, `received`, `datum`  |
| `predictions/…`, `extremes/…`, `predicted-extremes/…` | The source's predicted curve, observed and predicted high and low waters        |
| `recent/<source>.parquet`                             | The last 7 days of observed levels, updated every hour                          |

HTTPS has no directory listing, so wildcards such as `obs/rws/*/2024.parquet` don't work. Build the list of files, then pass it to `read_parquet([…])`. Times are UTC, levels are meters, and `flag <= 2` keeps every value not flagged suspect or bad.
