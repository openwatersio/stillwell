---
title: Source
toc: false
---

```js
import { sql } from "./components/duckdb.js";
import {
  url,
  json,
  param,
  gaugeLink,
  sourceLink,
  recentUrl,
  queryLink,
} from "./components/store.js";
import { md } from "./components/md.js";
import { flagChart } from "./components/charts.js";
import { erratum } from "./components/errata.js";
```

```js
const sources = await json("sources.json");
const source = sources.find((s) => s.id === param("id"));
if (source) document.title = `${source.name} | Stillwell`;
else
  display(
    html`<p>Pick a source:</p>
      <ul>
        ${sources.map((s) => html`<li><a href=${sourceLink(s.id)}>${s.name}</a></li>`)}
      </ul>`,
  );
// Without a source the rest of the page waits, rather than failing in every block.
const s = source ?? new Promise(() => {});
```

# ${s.name}

```js
display(
  html`<p class="muted">
    ${s.id} · <a href=${s.url}>${new URL(s.url).host}</a> ·
    <a href=${`https://github.com/openwatersio/stillwell/blob/main/src/sources/${s.id}/README.md`}
      >how Stillwell reads it</a
    >
  </p>`,
);
```

```js
const [counts] = await sql`
  SELECT count(*) AS stations,
    count(*) FILTER (WHERE status = 'active') AS active,
    count(*) FILTER (WHERE live) AS live,
    count(*) FILTER (WHERE list_contains(products, 'levels')) AS levels,
    count(*) FILTER (WHERE list_contains(products, 'predictions')) AS predictions,
    count(*) FILTER (WHERE commercial_use) AS commercial,
    min(first) AS first, max(last) AS last,
    string_agg(DISTINCT datum, ', ' ORDER BY datum) AS datums,
    count(DISTINCT country_code) AS countries
  FROM read_parquet(${url("stations.parquet")}) WHERE source = ${s.id}`;
const year = (d) => (d ? d.getUTCFullYear() : "–");
```

<div class="grid grid-cols-4">
  <div class="card"><h2>Stations</h2><span class="big">${counts.stations.toLocaleString()}</span><br>${counts.active.toLocaleString()} active, ${counts.live.toLocaleString()} polled hourly</div>
  <div class="card"><h2>Observed levels</h2><span class="big">${counts.levels.toLocaleString()}</span><br>${counts.predictions.toLocaleString()} with predictions</div>
  <div class="card"><h2>Record</h2><span class="big">${year(counts.first)}–${year(counts.last)}</span><br>in ${counts.countries} ${counts.countries === 1 ? "country" : "countries"}</div>
  <div class="card"><h2>Datums</h2><span class="big">${counts.datums ?? "–"}</span></div>
</div>

## Terms

```js
display(
  html`<table>
    <tr>
      <th>License</th>
      <td>
        ${s.license?.url ? html`<a href=${s.license.url}>${s.license.name}</a>` : (s.license?.name ?? "–")}
      </td>
    </tr>
    <tr>
      <th>Commercial use</th>
      <td>
        ${s.license?.commercial_use ? "allowed" : "not allowed"}${counts.commercial !== counts.stations ? ` (${counts.commercial.toLocaleString()} of ${counts.stations.toLocaleString()} stations allow it; each station's own terms apply)` : ""}
      </td>
    </tr>
    <tr>
      <th>Credit</th>
      <td>${s.attribution}</td>
    </tr>
    <tr>
      <th>Checks its values</th>
      <td>
        ${s.finalizes ? "yes: preliminary values are checked later" : "no: its preliminary values stay preliminary"}
      </td>
    </tr>
    <tr>
      <th>Contact</th>
      <td>
        ${s.contact?.email ?? ""}
        ${s.contact?.url ? html`<a href=${s.contact.url}>${s.contact.url}</a>` : ""}
      </td>
    </tr>
  </table>`,
);
display(md(s.terms));
```

## Stations

```js
const stations = Array.from(
  await sql`
    SELECT id, name, coalesce(kind, 'unknown') AS kind, status, live, datum, lat, lon, first, last, preferred = id AS preferred
    FROM read_parquet(${url("stations.parquet")}) WHERE source = ${s.id} ORDER BY name`,
);
const land = await fetch(import.meta.resolve("npm:world-atlas@2/land-50m.json"))
  .then((r) => r.json())
  .then((world) => topojson.feature(world, world.objects.land));
```

```js
const located = stations.filter((d) => d.lat != null && d.lon != null);
display(
  Plot.plot({
    width,
    height: Math.min(560, width * 0.6),
    projection: {
      type: "mercator",
      domain: { type: "MultiPoint", coordinates: located.map((d) => [d.lon, d.lat]) },
      inset: 20,
    },
    color: { legend: true, domain: ["coastal", "estuary", "lake", "river", "unknown"] },
    marks: [
      Plot.geo(land, { fill: "currentColor", fillOpacity: 0.08 }),
      Plot.dot(located, {
        x: "lon",
        y: "lat",
        r: 2.5,
        fill: "kind",
        tip: true,
        title: (d) => `${d.name}\n${d.id}`,
      }),
    ],
  }),
);
```

```js
const search = view(Inputs.search(stations, { placeholder: "Search stations" }));
```

```js
display(
  Inputs.table(search, {
    columns: ["name", "id", "kind", "status", "live", "datum", "first", "last"],
    format: {
      name: (name, i, data) => html`<a href=${gaugeLink(data[i].id)}>${name}</a>`,
      first: year,
      last: year,
    },
    width: { name: 260 },
  }),
);
```

## Values by year

How many of the source's values carry each flag, from <code>stations/years/${s.id}.parquet</code>.

```js
const flags = Array.from(
  await sql`
    UNPIVOT (
      SELECT year, sum(good) AS good, sum(interpolated) AS interpolated, sum(preliminary) AS preliminary,
        sum(suspect) AS suspect, sum(bad) AS bad
      FROM read_parquet(${url(`stations/years/${s.id}.parquet`)})
      WHERE year IS NOT NULL GROUP BY year
    ) ON good, interpolated, preliminary, suspect, bad INTO NAME flag VALUE n`,
);
```

```js
display(flagChart(flags, { width }));
```

## Latest values

```js
const recent = counts.live
  ? (
      await sql`
        SELECT max(time) AS latest, count(DISTINCT station) AS stations, count(*) AS values
        FROM read_parquet(${recentUrl(s.id)}) WHERE time > now() - INTERVAL 1 DAY`
    )[0]
  : null;
```

${recent ? html`In the last 24 hours, ${recent.values.toLocaleString()} values from ${recent.stations.toLocaleString()} stations; the newest is from ${recent.latest?.toISOString().slice(0, 16).replace("T", " ")} UTC. <code>recent/${s.id}.parquet</code> holds the last 7 days.` : "Stillwell doesn't poll this source hourly; its values arrive with backfills and monthly refetches."}

## Errata

```js
const errata = (await json("errata.json")).filter((e) => e.source === s.id);
```

${errata.length ? `${errata.length} errors found in what ${s.id} publishes, and what the store does about each.` : "No errata are recorded for this source."}

```js
for (const e of errata) display(erratum(e));
```

## Query it

```js
const example = `SELECT id, name, datum, first, last
FROM 'https://stillwell.openwaters.io/stations.parquet'
WHERE source = '${s.id}' AND status = 'active'
ORDER BY name`;
display(
  html`<pre><code>${example}</code></pre>
    <p><a href=${queryLink(example)}>Open in the query page</a></p>`,
);
```
