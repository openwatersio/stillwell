---
title: Gauge
toc: true
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
  seriesUrl,
  yearFiles,
} from "./components/store.js";
import { flagChart, levelChart, breakGaps } from "./components/charts.js";
import { erratum } from "./components/errata.js";
```

```js
const id = param("id");
const [row] = id
  ? await sql`
      SELECT * EXCLUDE (datums, datums_source, datums_epoch, datums_attribution, epochs, same_as, errata, products),
        to_json(datums) AS datums, to_json(datums_source) AS datums_source, to_json(datums_epoch) AS datums_epoch,
        to_json(datums_attribution) AS datums_attribution, to_json(epochs) AS epochs, to_json(same_as) AS same_as,
        to_json(errata) AS errata, to_json(products) AS products
      FROM read_parquet(${url("stations.parquet")}) WHERE id = ${id}`
  : [];
const NESTED = [
  "datums",
  "datums_source",
  "datums_epoch",
  "datums_attribution",
  "epochs",
  "same_as",
  "errata",
  "products",
];
if (row)
  for (const k of NESTED)
    row[k] =
      JSON.parse(row[k] ?? "null") ??
      (k.startsWith("datums") && k !== "datums_attribution" ? {} : []);
if (row) document.title = `${row.name} | Stillwell`;
else
  display(
    html`<p>
      No station <code>${id ?? ""}</code> in the store. Find one from a
      <a href=${sourceLink("")}>source page</a>.
    </p>`,
  );
// Without a station the rest of the page waits, rather than failing in every block.
const st = row ?? new Promise(() => {});
const day = (d) => (d ? d.toISOString().slice(0, 10) : "–");
```

# ${st.name}

```js
display(
  html`<p class="muted">
    ${st.id} · <a href=${sourceLink(st.source)}>${st.source}</a> · ${st.kind ?? "kind unknown"} ·
    ${st.country_code ?? ""} · ${st.status}${st.live ? ", polled hourly" : ""} ·
    <a href=${st.source_url}>at the source</a>
  </p>`,
);
```

<div class="grid grid-cols-4">
  <div class="card"><h2>Record</h2><span class="big">${st.first ? `${st.first.getUTCFullYear()}–${st.last.getUTCFullYear()}` : "none yet"}</span><br>${day(st.first)} to ${day(st.last)}</div>
  <div class="card"><h2>Datum</h2><span class="big">${st.datum}</span><br>chart datum ${st.chart_datum ?? "unknown"}</div>
  <div class="card"><h2>Tide</h2><span class="big">${st.tidal == null ? "–" : st.tidal ? "tidal" : "not tidal"}</span><br>${st.tide_m == null ? "" : `M2 + O1 = ${st.tide_m.toFixed(3)} m`}</div>
  <div class="card"><h2>Interval</h2><span class="big">${st.interval_s ? `${st.interval_s / 60} min` : "–"}</span><br>${st.products.join(", ")}</div>
</div>

## Levels

```js
const end = st.live ? new Date() : (st.last ?? new Date());
const start = view(Inputs.date({ label: "From", value: d3.utcDay.offset(end, -30) }));
const stop = view(Inputs.date({ label: "To", value: end }));
const datum = view(
  Inputs.select([st.datum, ...Object.keys(st.datums).filter((d) => d !== st.datum)], {
    label: "Datum",
    value: st.chart_datum ?? st.datum,
  }),
);
```

```js
// Each epoch's levels convert to the current datum by its to_current; outside its since and until they aren't part of the series.
const epochs = new Map(st.epochs.map((e) => [e.id, e]));
const inEpoch = (d) => {
  const e = epochs.get(d.epoch);
  if (!e) return d.epoch === 1;
  return (
    e.to_current != null &&
    (!e.since || d.time >= new Date(e.since)) &&
    (!e.until || d.time < new Date(e.until))
  );
};
const shift = (d) =>
  (epochs.get(d.epoch)?.to_current ?? 0) + (datum === st.datum ? 0 : st.datums[datum]);
const until = d3.utcDay.offset(stop, 1);

const files = await yearFiles(st.id, start.getUTCFullYear(), stop.getUTCFullYear());
const epochOf = new Map(files.map((f) => [f.url, f.epoch]));
const stored = files.length
  ? await sql`
      SELECT time, level_m, flag, filename FROM read_parquet(${files.map((f) => f.url)}, filename = true, union_by_name = true)
      WHERE time >= ${start} AND time < ${until}`
  : [];
// recent/ holds the last 7 days, including hours compaction hasn't folded into the year files yet.
const recent =
  st.live && until > d3.utcDay.offset(new Date(), -7)
    ? await sql`SELECT time, level_m, flag, epoch FROM read_parquet(${recentUrl(st.source)}) WHERE station = ${st.id} AND time >= ${start} AND time < ${until}`
    : [];
const byTime = new Map(recent.map((d) => [+d.time, d]));
for (const d of stored) byTime.set(+d.time, { ...d, epoch: epochOf.get(d.filename) ?? 1 });
const levels = [...byTime.values()]
  .filter(inEpoch)
  .map((d) => ({ time: d.time, flag: d.flag, level: d.level_m + shift(d) }))
  .sort((a, b) => a.time - b.time);
```

```js
// Predictions from this station, or from a linked one whose datum this station has an offset to, such as BSH's for a PEGELONLINE gauge.
const forecaster = [
  { id: st.id, datum: st.datum, products: st.products },
  ...linked.map((d) => ({ ...d, products: JSON.parse(d.products) })),
].find(
  (d) => d.products.includes("predictions") && (d.datum === st.datum || st.datums[d.datum] != null),
);
const predicted = forecaster
  ? (
      await Promise.all(
        d3.range(start.getUTCFullYear(), stop.getUTCFullYear() + 1).map((year) =>
          // Prediction years have no list, so a year without a file is skipped.
          sql`SELECT time, level_m FROM read_parquet(${seriesUrl("predictions", forecaster.id, year)}) WHERE time >= ${start} AND time < ${until}`.catch(
            () => [],
          ),
        ),
      )
    )
      .flat()
      .map((d) => ({
        time: d.time,
        level:
          d.level_m -
          (forecaster.datum === st.datum ? 0 : st.datums[forecaster.datum]) +
          shift({ epoch: 1 }),
      }))
      .sort((a, b) => a.time - b.time)
  : [];
```

```js
display(
  levels.length || predicted.length
    ? levelChart(breakGaps(levels, Math.max(3 * (st.interval_s ?? 3600) * 1000, 3 * 3600e3)), {
        width,
        title: st.name,
        datum,
        predictions: predicted,
      })
    : html`<p>No values between ${day(start)} and ${day(stop)}.</p>`,
);
```

${levels.length.toLocaleString()} observed values${predicted.length ? html` and ${predicted.length.toLocaleString()} predicted by <a href=${gaugeLink(forecaster.id)}>${forecaster.id}</a>` : ""}, in ${datum}${datum === st.datum ? "" : `: ${st.datum} ${st.datums[datum] >= 0 ? "plus" : "minus"} ${Math.abs(st.datums[datum])} m`}. Red dots are values flagged suspect or bad.

## Years in the store

```js
const years = await sql`
  SELECT epoch, year, hours, good, interpolated, preliminary, suspect, bad, version
  FROM read_parquet(${url(`stations/years/${st.source}.parquet`)}) WHERE id = ${st.id} AND year IS NOT NULL ORDER BY epoch, year`;
```

```js
display(
  years.length
    ? flagChart(
        years.flatMap((y) =>
          ["good", "interpolated", "preliminary", "suspect", "bad"].map((flag) => ({
            year: y.year,
            flag,
            n: y[flag],
          })),
        ),
        { width },
      )
    : html`<p>No year files yet.</p>`,
);
```

${years.length ? `${years.length} year ${years.length === 1 ? "file" : "files"}` : ""}${new Set(years.map((y) => y.epoch)).size > 1 ? `, in ${new Set(years.map((y) => y.epoch)).size} datum epochs` : ""}. ${st.source_qc_start ? `${st.source} checks values from ${day(st.source_qc_start)}${st.source_qc_start_inferred ? " (inferred from its flags)" : ""}.` : ""}

## Datums

```js
display(
  Inputs.table(
    Object.entries(st.datums).map(([name, offset]) => ({
      datum: name,
      "add (m)": offset,
      from: st.datums_source[name] ?? "",
      "reduced over": st.datums_epoch[name]
        ? `${st.datums_epoch[name].start ?? ""} to ${st.datums_epoch[name].end ?? ""}`
        : "",
    })),
    { select: false, format: { "add (m)": (x) => x.toFixed(3) } },
  ),
);
```

Add an offset to a level in ${st.datum} to refer it to that datum. ${st.datums_attribution.length ? html`Offsets not from ${st.source} itself credit: ${st.datums_attribution.join("; ")}.` : ""}

```js
if (st.epochs.length > 1)
  display(
    Inputs.table(
      st.epochs.map((e) => ({
        epoch: e.id,
        datum: e.datum,
        since: e.since?.slice(0, 10) ?? "",
        until: e.until?.slice(0, 10) ?? "",
        "to current (m)": e.to_current,
        state: e.state ?? "",
      })),
      { select: false },
    ),
  );
```

## Linked stations

```js
const linked = st.same_as.length
  ? await sql`
      SELECT id, name, source, datum, to_json(products) AS products, first, last, status
      FROM read_parquet(${url("stations.parquet")}) WHERE list_contains(${st.same_as}, id) ORDER BY id`
  : [];
```

```js
display(
  linked.length
    ? Inputs.table(
        linked.map((d) => ({
          ...d,
          products: JSON.parse(d.products).join(", "),
          preferred: d.id === st.preferred ? "✓" : "",
        })),
        {
          select: false,
          columns: ["id", "source", "products", "first", "last", "status", "preferred"],
          format: { id: (x) => html`<a href=${gaugeLink(x)}>${x}</a>`, first: day, last: day },
        },
      )
    : html`<p>No other source carries this gauge.</p>`,
);
```

${st.same_as.length ? html`For the gauge's observed levels, use ${st.preferred === st.id ? "this station" : html`<a href=${gaugeLink(st.preferred)}>${st.preferred}</a>`}${st.tide_station ? `; its record in slackwater-database is ${st.tide_station}` : ""}.` : ""}

## Errata

```js
const errata = (await json("errata.json")).filter(
  (e) => e.stations?.includes(st.id) || (e.source === st.source && !e.stations?.length),
);
display(errata.length ? html`${errata.map(erratum)}` : html`<p>No errata touch this station.</p>`);
```

## Terms

<table>
  <tr><th>License</th><td>${st.license}</td></tr>
  <tr><th>Commercial use</th><td>${st.commercial_use ? "allowed" : "not allowed"}</td></tr>
  <tr><th>Credit</th><td>${st.attribution}</td></tr>
</table>

## Read it yourself

```js
const latest = years.at(-1);
const example = latest
  ? `SET TimeZone = 'UTC';
SELECT time, level_m, flag
FROM '${seriesUrl("obs", st.id, latest.year, latest.epoch)}'
WHERE flag <= 2
ORDER BY time DESC LIMIT 10`
  : `SELECT * FROM 'https://stillwell.openwaters.io/stations.parquet' WHERE id = '${st.id}'`;
display(
  html`<pre><code>${example}</code></pre>
    <p><a href=${queryLink(example)}>Open in the query page</a></p>`,
);
```
