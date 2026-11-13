---
title: Marine Institute tide gauges
sql:
  stations: https://stillwell.openwaters.io/stations.parquet
  years: https://stillwell.openwaters.io/stations/years/marine-institute.parquet
---

# Irish National Tide Gauge Network

Observed water levels from the Marine Institute's tide gauges, read live from the [Stillwell](https://github.com/openwatersio/stillwell) store each time this page loads. The [data guide](https://github.com/openwatersio/stillwell/blob/main/docs/data.md) describes every file and column.

Data: Marine Institute, Irish National Tide Gauge Network, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Gauges

`stations.parquet` has one row per station. `datums` maps each datum to the meters to add to a level to refer it to that datum.

```sql id=gauges display echo
SELECT id, name, lat, lon, datum, map_extract(datums, 'LAT')[1] AS lat_offset_m, first, last
FROM stations
WHERE source = 'marine-institute'
ORDER BY name
```

## Levels

```js
const options = Array.from(gauges);
const last = d3.max(options, (d) => d.last);
const gauge = view(
  Inputs.select(options, {
    label: "Gauge",
    format: (d) => d.name,
    value: options.find((d) => d.name === "Ballycotton Harbour"),
  }),
);
const start = view(Inputs.date({ label: "From", value: d3.utcDay.offset(last, -30) }));
const stop = view(Inputs.date({ label: "To", value: last }));
const datum = view(Inputs.radio(["OD Malin", "LAT"], { label: "Datum", value: "OD Malin" }));
```

Each series is stored as one file per year, at `obs/<id>/<year>.parquet`. The years list says which files exist, since reading a missing one fails.

```sql id=available echo
SELECT year
FROM years
WHERE id = ${gauge.id} AND year BETWEEN ${start.getUTCFullYear()} AND ${stop.getUTCFullYear()}
```

```js echo
const shift = datum === "LAT" ? (gauge.lat_offset_m ?? 0) : 0;
const paths = Array.from(
  available,
  ({ year }) => `'https://stillwell.openwaters.io/obs/${gauge.id}/${year}.parquet'`,
);
// read_parquet needs its file list in the query text, not as a parameter.
const query = `
  SELECT time, level_m + ${shift} AS level, flag,
    CASE WHEN flag <= 2 THEN 'good' ELSE 'suspect or bad' END AS quality
  FROM read_parquet([${paths}])
  WHERE time >= '${start.toISOString()}' AND time < '${d3.utcDay.offset(stop, 1).toISOString()}'
  ORDER BY time`;
const levels = paths.length ? Array.from(await sql([query])) : [];
```

```js
display(
  Plot.plot({
    title: gauge.name,
    width,
    height: 320,
    x: { type: "utc", label: null },
    y: { label: `Level (m, ${datum})`, grid: true },
    color: { legend: true, domain: ["good", "suspect or bad"] },
    marks: [Plot.lineY(levels, { x: "time", y: "level", stroke: "quality", tip: true })],
  }),
);
```

${levels.length.toLocaleString()} values. ${gauge.lat_offset_m == null ? "No LAT offset is published for this gauge." : `LAT is OD Malin plus ${gauge.lat_offset_m} m, the gauge's current offset.`}

## About LAT

Stillwell stores the levels in OD Malin, which is continuous, and gives LAT as the gauge's current offset from OD Malin. On 24 March 2026 at 11:15 UTC the Marine Institute re-evaluated its harmonics and levels, and the LAT offsets moved by up to about 12 cm (Ballycotton went from 2.489 m to 2.460 m). LAT values here use the new offset for the whole record.
