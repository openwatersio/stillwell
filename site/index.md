---
title: Stillwell
toc: false
---

```js
import { sql } from "./components/duckdb.js";
import { url, recentUrl, json, sourceLink } from "./components/store.js";
```

# Stillwell

Observed and predicted water levels from tide, river and lake gauges around the world, fetched from each agency, quality checked, and published as Parquet at `https://stillwell.openwaters.io/` for anyone to read. Every number on this page is queried from the store as it loads.

```js
const sources = await json("sources.json");
const [totals] = await sql`
  SELECT count(*) AS stations,
    count(*) FILTER (WHERE status = 'active') AS active,
    count(*) FILTER (WHERE list_contains(products, 'levels') AND preferred = id) AS gauges,
    count(*) FILTER (WHERE live) AS live,
    count(DISTINCT country_code) AS countries
  FROM read_parquet(${url("stations.parquet")})`;
```

<div class="grid grid-cols-4">
  <div class="card"><h2>Sources</h2><span class="big">${sources.length}</span></div>
  <div class="card"><h2>Stations</h2><span class="big">${totals.stations.toLocaleString()}</span><br>${totals.active.toLocaleString()} active</div>
  <div class="card"><h2>Gauges with observed levels</h2><span class="big">${totals.gauges.toLocaleString()}</span><br>one per physical gauge, in ${totals.countries} countries</div>
  <div class="card"><h2>Polled every hour</h2><span class="big">${totals.live.toLocaleString()}</span></div>
</div>

A station is one source's series at one place. When several sources carry the same gauge, their stations are linked and one is marked preferred, so the gauge count above counts each gauge once.

## Where the stations are

```js
const land = await fetch(import.meta.resolve("npm:world-atlas@2/land-110m.json"))
  .then((r) => r.json())
  .then((world) => topojson.feature(world, world.objects.land));
const points = Array.from(
  await sql`SELECT id, name, source, coalesce(kind, 'unknown') AS kind, lon, lat, status FROM read_parquet(${url("stations.parquet")}) WHERE lat IS NOT NULL`,
);
```

```js
const shown = view(Inputs.checkbox(["active", "inactive"], { label: "Status", value: ["active"] }));
```

```js
display(
  Plot.plot({
    width,
    projection: "equal-earth",
    color: { legend: true, domain: ["coastal", "estuary", "lake", "river", "unknown"] },
    marks: [
      Plot.geo(land, { fill: "currentColor", fillOpacity: 0.08 }),
      Plot.sphere({ strokeOpacity: 0.3 }),
      Plot.dot(
        points.filter((d) => shown.includes(d.status)),
        { x: "lon", y: "lat", r: 1.2, fill: "kind", tip: true, title: (d) => `${d.name}\n${d.id}` },
      ),
    ],
  }),
);
```

## Sources

```js
const counts = new Map(
  Array.from(
    await sql`
      SELECT source, count(*) AS stations, count(*) FILTER (WHERE status = 'active') AS active,
        count(*) FILTER (WHERE live) AS live, min(first) AS first, count(*) FILTER (WHERE commercial_use) AS commercial
      FROM read_parquet(${url("stations.parquet")}) GROUP BY source`,
    (d) => [d.source, d],
  ),
);
const liveSources = sources.filter((s) => counts.get(s.id)?.live > 0).map((s) => s.id);
```

```js
// Each live source's newest value in recent/, read from the files' time column alone.
const fresh = new Map(
  Array.from(
    await sql`
      SELECT split_part(station, '/', 1) AS source, max(time) AS latest
      FROM read_parquet(${liveSources.map(recentUrl)})
      GROUP BY 1`,
    (d) => [d.source, d.latest],
  ),
);
```

```js
const ago = (t) => {
  if (t == null) return "";
  const hours = (Date.now() - t) / 3.6e6;
  return hours < 1
    ? `${Math.round(hours * 60)} min ago`
    : hours < 48
      ? `${Math.round(hours)} h ago`
      : `${Math.round(hours / 24)} days ago`;
};
display(
  Inputs.table(
    sources.map((s) => ({
      source: s.id,
      name: s.name,
      stations: counts.get(s.id)?.stations ?? 0,
      active: counts.get(s.id)?.active ?? 0,
      live: counts.get(s.id)?.live ?? 0,
      "latest value": fresh.get(s.id),
      since: counts.get(s.id)?.first,
      license: s.license?.id ?? s.license?.name,
    })),
    {
      rows: 30,
      sort: "stations",
      reverse: true,
      format: {
        source: (id) => html`<a href=${sourceLink(id)}>${id}</a>`,
        "latest value": ago,
        since: (d) => (d ? new Date(d).getUTCFullYear() : ""),
      },
      width: { name: 320 },
    },
  ),
);
```

"Latest value" is the newest observation the hourly ingest has written to `recent/`, for sources it polls.

## Years of record

```js
const spans = Array.from(
  await sql`
    SELECT year, count(*) AS stations
    FROM read_parquet(${url("stations.parquet")}),
      range(year(first), year(last) + 1) AS t(year)
    WHERE list_contains(products, 'levels') AND preferred = id AND first IS NOT NULL
    GROUP BY year ORDER BY year`,
);
```

```js
display(
  Plot.plot({
    width,
    height: 240,
    marginLeft: 50,
    x: { label: null, tickFormat: "d" },
    y: { label: "Gauges whose record spans the year", grid: true },
    marks: [
      Plot.rectY(spans, { x1: "year", x2: (d) => d.year + 1, y: "stations", tip: true }),
      Plot.ruleY([0]),
    ],
  }),
);
```

Each gauge counts in every year from its first observation to its last, so a gauge with a gap still counts through it. A station's [source page](./source) lists the years it has values for.
