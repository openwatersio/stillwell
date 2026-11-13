---
title: Rebuilding GESLA and TICON
---

```js
import { sql, literal } from "../components/duckdb.js";
import {
  url,
  json,
  gaugeLink,
  sourceLink,
  queryLink,
  yearFiles,
  recentUrl,
} from "../components/store.js";
import { erratum } from "../components/errata.js";
import { harmonics, utide } from "../components/tides.js";
const STATIONS = url("stations.parquet");
const n = (x) => (x ?? 0).toLocaleString("en-US");
const day = (d) => d?.toISOString().slice(0, 10);
const month = (d) =>
  d?.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
```

# Rebuilding GESLA and TICON

To support several projects at Open Waters, we needed a near-realtime database of global water levels, so we built [Stillwell](https://github.com/openwatersio/stillwell). This page explains what it is, then shows how it could be used to build [GESLA](https://gesla787883612.wordpress.com/) and [TICON](https://doi.org/10.17882/109129). Stillwell's quality control has also turned up errors in GESLA 4.1's files. Every number here is read from the store as the page loads.

## About Stillwell

```js
const [about] =
  await sql`SELECT count(*) AS series, count(DISTINCT source) AS sources FROM read_parquet(${STATIONS})`;
```

Stillwell is an open store of observed water levels, synced from the originating agencies themselves, every hour where they publish live. As of ${day(new Date())}, it holds ${n(about.series)} series from ${about.sources} sources and is still backfilling.

Every series has the same layout: times in UTC, levels in meters with their datums, and one quality-control flag scale. Where two sources cover one gauge, their stations are linked and one is marked as the preferred series. Every station carries its terms and the errata that touch it. The store includes all of [GESLA 4.1](https://github.com/openwatersio/stillwell/blob/main/src/sources/gesla/README.md), with each record linked to its originator's series where Stillwell reads that originator. The exception is 25 records from the South African Navy Hydrographic Office, which refused permission to republish its data.

All of it is readable over HTTPS without an account, as [Parquet](https://parquet.apache.org/) files at `https://stillwell.openwaters.io/`. To go further:

- [Query the store](../query) in your browser, or see the [data guide](https://github.com/openwatersio/stillwell/blob/main/docs/data.md) for the columns of every file.
- [GESLA in Stillwell](../source?id=gesla): its records, terms and errata.
- [How GESLA 4.1 is read](https://github.com/openwatersio/stillwell/blob/main/src/sources/gesla/README.md), flagged, corrected and linked to the originators.

## GESLA in Stillwell

```js
const [gesla] = await sql`
  WITH g AS (SELECT id, same_as FROM read_parquet(${STATIONS}) WHERE source = 'gesla'),
  l AS (
    SELECT g.id, o.live FROM g, unnest(g.same_as) AS u(other)
    JOIN read_parquet(${STATIONS}) o ON o.id = u.other
    WHERE o.source NOT IN ('gesla', 'bsh')
  )
  SELECT (SELECT count(*) FROM g) AS records, count(DISTINCT id) AS linked, count(DISTINCT id) FILTER (WHERE live) AS live FROM l`;
```

Every GESLA record is linked to the same gauge in the store's other sources, where there is one. Of the ${n(gesla.records)} GESLA 4.1 records in the store, ${n(gesla.linked)} link to an originator's series, and ${n(gesla.live)} of those to one Stillwell fetches live, so for those the originator's own data can stand in for GESLA's copy and runs on to the present:

```sql echo
SELECT o.source, count(DISTINCT g.id) AS gesla_records, count(DISTINCT o.id) AS series,
  count(DISTINCT o.id) FILTER (WHERE o.live) AS live
FROM (
  SELECT id, unnest(same_as) AS other
  FROM 'https://stillwell.openwaters.io/stations.parquet' WHERE source = 'gesla'
) g
JOIN 'https://stillwell.openwaters.io/stations.parquet' o ON o.id = g.other
WHERE o.source NOT IN ('gesla', 'bsh')
GROUP BY o.source ORDER BY gesla_records DESC
```

A series can stand for several GESLA records, since GESLA often holds a gauge from several contributors: a NOAA record, a UHSLC copy and a CMEMS copy, say.

## Rebuilding GESLA from Stillwell

This Python function writes a GESLA-format file for a GESLA record from its originator's series. It takes the series Stillwell links to the record, reads the years the store lists for it, and keeps the values on the hour:

```python
import urllib.parse

import duckdb

STORE = "https://stillwell.openwaters.io"
# Sources that publish observed levels; BSH's series are predictions.
OBSERVED = "source NOT IN ('gesla', 'bsh')"

con = duckdb.connect()
con.sql("SET TimeZone = 'UTC'")


def originator(gesla_record: str) -> dict:
    """The originator's series that Stillwell links to a GESLA record: the group's
    preferred series where that's an originator's, else the live one, else the oldest."""
    rows = con.execute(
        f"""
        SELECT o.id, o.source, o.source_id, o.name, o.lat, o.lon, o.country_code, o.datum,
          o.first, o.last, o.attribution, o.live
        FROM '{STORE}/stations.parquet' g JOIN '{STORE}/stations.parquet' o
          ON list_contains(g.same_as, o.id)
        WHERE g.id = ? AND o.{OBSERVED}
        ORDER BY o.id = g.preferred DESC, o.live DESC, o.first
        """,
        [f"gesla/{gesla_record}"],
    ).df()
    if rows.empty:
        raise LookupError(f"no originator's series is linked to {gesla_record}")
    return rows.iloc[0].to_dict()


def year_files(series: dict, start: int, end: int) -> list[str]:
    """The series' year files from start to end in its first datum epoch, from the
    store's list of the files it has."""
    code = urllib.parse.quote(urllib.parse.quote(series["source_id"], safe=""), safe="")
    years = con.execute(
        f"""
        SELECT year FROM '{STORE}/stations/years/{series['source']}.parquet'
        WHERE id = ? AND epoch = 1 AND year BETWEEN ? AND ? ORDER BY year
        """,
        [series["id"], start, end],
    ).fetchall()
    return [f"{STORE}/obs/{series['source']}/{code}/{y}.parquet" for (y,) in years]


def rebuild(gesla_record: str, path: str, start: int | None = None, end: int | None = None):
    """Write a GESLA-format file for a record, from its originator's series, on the hour."""
    s = originator(gesla_record)
    files = year_files(s, start or s["first"].year, end or s["last"].year)
    values = con.execute(
        """
        SELECT strftime(time, '%Y/%m/%d'), strftime(time, '%H:%M:%S'), level_m,
          CASE flag WHEN 0 THEN 1 WHEN 1 THEN 2 WHEN 2 THEN 0 WHEN 3 THEN 3 ELSE 4 END,
          (flag <= 2)::INT
        FROM read_parquet(?, union_by_name = true)
        WHERE minute(time) = 0 AND second(time) = 0
        ORDER BY time
        """,
        [files],
    ).fetchall()
    header = [
        f"FORMAT VERSION 5.0, rebuilt from {STORE}",
        f"SITE NAME {s['name']}",
        f"SITE CODE {s['source_id']}",
        f"COUNTRY {s['country_code']}",
        f"ORIGINATOR {s['attribution']}",
        f"LATITUDE {s['lat']:.8f}",
        f"LONGITUDE {s['lon']:.8f}",
        f"START DATE/TIME {values[0][0]} {values[0][1]}",
        f"END DATE/TIME {values[-1][0]} {values[-1][1]}",
        "TIME ZONE HOURS 0",
        f"DATUM INFORMATION {s['datum']} (Stillwell series {s['id']})",
        "NULL VALUE -99.9999",
    ]
    with open(path, "w") as out:
        out.writelines(f"# {line}\n" for line in header)
        for date, time, level, qc, use in values:
            out.write(f"{date} {time} {level:9.4f} {qc} {use}\n")
    return s["id"], len(values)


rebuild("atlantic_city-8534720-usa-noaa", "atlantic_city-8534720-usa-noaa.txt", 2015, 2016)
```

The same steps run here in your browser. Pick a record and years to rebuild it:

```js
const request = view(
  Inputs.form(
    {
      record: Inputs.text({
        label: "GESLA record",
        value: "atlantic_city-8534720-usa-noaa",
        width: 360,
      }),
      start: Inputs.number({ label: "From", value: 2015, step: 1 }),
      end: Inputs.number({ label: "To", value: 2016, step: 1 }),
    },
    { submit: "Rebuild" },
  ),
);
```

```js
async function originator(record) {
  const [o] = await sql`
    SELECT o.id, o.source, o.source_id, o.name, o.lat, o.lon, o.country_code, o.datum, o.first, o.last, o.attribution
    FROM read_parquet(${STATIONS}) g JOIN read_parquet(${STATIONS}) o ON list_contains(g.same_as, o.id)
    WHERE g.id = ${`gesla/${record}`} AND o.source NOT IN ('gesla', 'bsh')
    ORDER BY o.id = g.preferred DESC, o.live DESC, o.first LIMIT 1`;
  if (!o) throw new Error(`No originator's series is linked to ${record}`);
  return o;
}
const firstEpoch = async (id, start, end) =>
  (await yearFiles(id, start, end)).filter((f) => f.epoch === 1).map((f) => f.url);
```

```js
const series = await originator(request.record);
const files = await firstEpoch(series.id, request.start, request.end);
const values = files.length
  ? await sql`
      SELECT strftime(time, '%Y/%m/%d') AS date, strftime(time, '%H:%M:%S') AS time, level_m,
        CASE flag WHEN 0 THEN 1 WHEN 1 THEN 2 WHEN 2 THEN 0 WHEN 3 THEN 3 ELSE 4 END AS qc, (flag <= 2)::INT AS use
      FROM read_parquet(${files}, union_by_name = true)
      WHERE minute(time) = 0 AND second(time) = 0 ORDER BY 1, 2`
  : [];
const header = [
  "FORMAT VERSION 5.0, rebuilt from https://stillwell.openwaters.io",
  `SITE NAME ${series.name}`,
  `SITE CODE ${series.source_id}`,
  `COUNTRY ${series.country_code}`,
  `ORIGINATOR ${series.attribution}`,
  `LATITUDE ${series.lat.toFixed(8)}`,
  `LONGITUDE ${series.lon.toFixed(8)}`,
  `START DATE/TIME ${values[0]?.date} ${values[0]?.time}`,
  `END DATE/TIME ${values.at(-1)?.date} ${values.at(-1)?.time}`,
  "TIME ZONE HOURS 0",
  `DATUM INFORMATION ${series.datum} (Stillwell series ${series.id})`,
  "NULL VALUE -99.9999",
];
const text =
  [
    ...header.map((l) => `# ${l}`),
    ...values.map(
      (v) => `${v.date} ${v.time} ${v.level_m.toFixed(4).padStart(9)} ${v.qc} ${v.use}`,
    ),
  ].join("\n") + "\n";
```

```js
display(
  html`<p>
    ${n(values.length)} hourly values from <a href=${gaugeLink(series.id)}>${series.id}</a>, in
    ${files.length} year ${files.length === 1 ? "file" : "files"}:
  </p>`,
);
display(
  html`<pre>
${text
      .split("\n")
      .slice(0, header.length + 3)
      .join("\n")}</pre>`,
);
display(
  Inputs.button(`Download ${request.record}.txt`, {
    reduce: () => {
      const a = Object.assign(document.createElement("a"), {
        href: URL.createObjectURL(new Blob([text], { type: "text/plain" })),
        download: `${request.record}.txt`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    },
  }),
);
```

### Against GESLA's own copy

GESLA's own file for the record is in the store too, so the rebuilt values can be checked against it hour by hour.

```js
// One way per source of putting its values on GESLA's times: GESLA has some originators' values as served,
// some on the hour, and some as hourly means.
const METHODS = {
  hour: {
    label: "Values on the hour",
    sql: (f) =>
      `SELECT time, level_m AS level, flag FROM read_parquet(${literal(f)}, union_by_name = true) WHERE minute(time) = 0 AND second(time) = 0`,
  },
  served: {
    label: "Values as served",
    sql: (f) =>
      `SELECT time, level_m AS level, flag FROM read_parquet(${literal(f)}, union_by_name = true)`,
  },
  // WSV's hourly means are stamped at the start of the hour, and the store's gesla source moves them to its middle.
  mean: {
    label: "Hourly means, stamped at the middle of the hour",
    sql: (f) =>
      `SELECT time_bucket(INTERVAL 1 HOUR, time) + INTERVAL 30 MINUTE AS time, avg(level_m) AS level, max(flag) AS flag FROM read_parquet(${literal(f)}, union_by_name = true) GROUP BY 1 HAVING count(*) >= 50`,
  },
  centered: {
    label: "Hourly means, centered on the hour",
    sql: (f) =>
      `SELECT time_bucket(INTERVAL 1 HOUR, time + INTERVAL 30 MINUTE) AS time, avg(level_m) AS level, max(flag) AS flag FROM read_parquet(${literal(f)}, union_by_name = true) GROUP BY 1 HAVING count(*) >= 5`,
  },
};

/** The originator's values against GESLA's copy of a record, at the same times. */
async function compare(record, method, start, end) {
  const o = await originator(record);
  const [mine, theirs] = await Promise.all([
    firstEpoch(o.id, start, end),
    firstEpoch(`gesla/${record}`, start, end),
  ]);
  const [r] = await sql([
    `WITH o AS (${METHODS[method].sql(mine)}),
      g AS (SELECT time, level_m AS level, flag FROM read_parquet(${literal(theirs)}, union_by_name = true))
    SELECT count(*) FILTER (WHERE o.level IS NOT NULL AND g.level IS NOT NULL) AS both,
      count(*) FILTER (WHERE abs(o.level - g.level) < 0.0005) AS identical,
      count(*) FILTER (WHERE abs(o.level - g.level) < 0.00105) AS within_mm,
      count(*) FILTER (WHERE g.level IS NULL AND o.level IS NOT NULL) AS extra,
      count(*) FILTER (WHERE o.flag >= 3 AND g.flag <= 2) AS flagged,
      median(o.level - g.level) AS offset, stddev(o.level - g.level) AS spread
    FROM o FULL JOIN g USING (time)
    WHERE time >= '${start}-01-01' AND time < '${end + 1}-01-01'`,
  ]);
  return { ...r, originator: o };
}
```

```js
const atlantic = await compare("atlantic_city-8534720-usa-noaa", "hour", 2015, 2016);
```

Against GESLA 4.1's own <code>atlantic_city-8534720-usa-noaa</code> for 2015 and 2016:

- **${atlantic.identical === atlantic.both ? "Every value matches." : `${n(atlantic.identical)} of ${n(atlantic.both)} values match.`}** On the ${n(atlantic.both)} hours both files hold, ${atlantic.identical === atlantic.both ? "the levels are identical" : "the rest differ"}, in the same datum (CO-OPS's station datum, which GESLA calls "Station Datum").
- **${n(atlantic.extra)} more hours.** GESLA lists ${n(atlantic.extra)} hours as missing that CO-OPS now serves.
- **${n(atlantic.flagged)} flags differ,** where Stillwell's own QC marks a value suspect that GESLA marks correct.

Leave out `start` and `end` and the record runs from CO-OPS's first year, ${atlantic.originator.first.getUTCFullYear()}, to the last hour Stillwell fetched. The same series also has CO-OPS's 6-minute values, ten times as many, by dropping the `minute(time) = 0` condition. `year_files` reads a series' first datum epoch; the [data guide](https://github.com/openwatersio/stillwell/blob/main/docs/data.md#datum-epochs) shows how to read every epoch in the current datum.

### How each originator lines up with GESLA

The same comparison at one gauge per source, for 2015, matching the originator's values to GESLA's at the same times. It reads about 20 MB, so it runs when you ask.

```js
const ORIGINATORS = [
  { source: "CO-OPS", record: "atlantic_city-8534720-usa-noaa", method: "hour" },
  { source: "SMHI", record: "arko-2545-swe-smhi", method: "served" },
  { source: "Kartverket", record: "alesund-aes-nor-nhs", method: "hour" },
  { source: "PEGELONLINE", record: "bakez-9510066-deu-wsv", method: "mean" },
  { source: "REFMAR", record: "ajaccio_aspretto-300-fra-refmar", method: "centered" },
];
const runComparisons = view(Inputs.button("Compare all five"));
```

```js
const describe = (r) => {
  const rest = r.both - r.identical;
  const close = r.within_mm - r.identical;
  if (!rest) return `Identical, ${n(r.both)} hours`;
  if (r.identical / r.both >= 0.99)
    return `${n(r.identical)} of ${n(r.both)} hours identical, ${
      close === rest
        ? `the other ${n(rest)} within 1 mm`
        : close
          ? `${n(close)} of the other ${n(rest)} within 1 mm`
          : `the other ${n(rest)} more than 1 mm apart`
    }`;
  if (r.within_mm / r.both >= 0.99)
    return `Within 1 mm for ${n(r.within_mm)} of ${n(r.both)} hours`;
  return `${Math.abs(r.offset) < 0.0005 ? "No" : `${(r.offset * 1000).toFixed(0)} mm`} offset, ${(r.spread * 1000).toFixed(0)} mm spread`;
};
display(
  runComparisons
    ? Inputs.table(
        await Promise.all(
          ORIGINATORS.map(async (d) => {
            const r = await compare(d.record, d.method, 2015, 2015);
            return {
              Source: d.source,
              "GESLA record": d.record,
              "How to match GESLA": METHODS[d.method].label,
              Result: describe(r),
            };
          }),
        ),
        { select: false, width: { "GESLA record": 260, Result: 300 } },
      )
    : html`<p class="muted">Press the button to run the five comparisons.</p>`,
);
```

Two of these say something about GESLA's records:

- **WSV's values are hourly means, stamped at the start of the hour they average,** so a PEGELONLINE mean over 10:00 to 11:00 matches GESLA's 10:00 value. Stillwell's `gesla` source moves those records 30 minutes later, to the middle of the hour (erratum `gesla-wsv-hourly-means-early`). The comparison above uses those moved times.
- **REFMAR's hourly values aren't a plain mean** of its 10-minute ones. They're probably REFMAR's own filtered hourly product, which Stillwell doesn't read, since it reads the 10-minute values where REFMAR has them.

To rebuild a WSV record as GESLA has it, read hourly means instead of the values on the hour, with this in place of the `FROM … WHERE` part of `rebuild`'s query:

```sql run=false
SELECT time_bucket(INTERVAL 1 HOUR, time) AS time, avg(level_m) AS level_m, max(flag) AS flag
FROM read_parquet(?, union_by_name = true)
GROUP BY 1 HAVING count(*) >= 50  -- most of the hour's 60 values
ORDER BY 1
```

### The station list, in GESLA's terms

GESLA's metadata file comes from the originators' station lists too. `stations.parquet` holds every series with its name, position, datum, interval, span, terms and links. This lists the CO-OPS series behind GESLA's NOAA records, with the GESLA record each one stands for:

```sql echo
SELECT g.source_id AS gesla_file, o.id AS series, o.name, round(o.lat, 4) AS lat,
  round(o.lon, 4) AS lon, o.datum, o.interval_s,
  strftime(o.first, '%Y-%m-%d') AS start, strftime(o.last, '%Y-%m-%d') AS "end", o.commercial_use
FROM 'https://stillwell.openwaters.io/stations.parquet' g
JOIN 'https://stillwell.openwaters.io/stations.parquet' o ON list_contains(g.same_as, o.id)
WHERE g.source = 'gesla' AND g.source_id LIKE '%-noaa' AND o.source = 'coops'
ORDER BY gesla_file LIMIT 5
```

GESLA's own fields for each record (contributor, originator, datum information, record quality and span) are in `stations/gesla.parquet`, in its `extra` column, as JSON:

```sql echo
SELECT source_id, json_extract_string(extra, '$.contributor') AS contributor,
  json_extract_string(extra, '$.datum_information') AS datum_information,
  json_extract_string(extra, '$.record_start')[:10] AS start_date,
  json_extract_string(extra, '$.record_end')[:10] AS end_date
FROM 'https://stillwell.openwaters.io/stations/gesla.parquet'
WHERE source_id = 'atlantic_city-8534720-usa-noaa'
```

### Flags

Stillwell keeps one flag scale for every source: 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad. `rebuild` maps it to GESLA's QC flag as 1 correct, 2 interpolated, 0 no quality control (for preliminary, real-time values), 3 doubtful and 4 wrong, and sets the use flag to 0 for suspect and bad values.

Every source's flags map onto Stillwell's scale by its own rules, which each [adapter's README](https://github.com/openwatersio/stillwell/tree/main/src/sources) gives. Stillwell's own QC runs on top, and `flag` is the worse of the two, while `source_flag` keeps the source's verdict. The QC checks limits, flatlines, spikes and outliers, readings a gauge holds while the tide moves, and runs that jump away from a harmonic fit of the gauge's own tide and back. Which of these apply depends on whether the station's water is tidal, which Stillwell measures from its levels (`tidal` and `tide_m` in `stations.parquet`); [Stations](https://github.com/openwatersio/stillwell/blob/main/docs/stations.md#analysis) has the rules.

### GESLA's own records

```js
const firsts = new Map(
  (
    await sql`SELECT id, first FROM read_parquet(${STATIONS}) WHERE id IN ('gesla/aberdeen-abe-gbr-bodc', 'bodc/abe', 'ea/E70739')`
  ).map((d) => [d.id, d.first]),
);
const errata = (await json("errata.json")).filter((e) => e.source === "gesla");
```

```js
const code = (id) => html`<a href=${gaugeLink(id)}><code>${id}</code></a>`;
display(
  html`<p>
    Where no originator's series covers a record, or for its years before the originator's archive
    begins, GESLA's copy is in the store as the source
    <a href=${sourceLink("gesla")}><code>gesla</code></a
    >: one series per record, named by its file name, in files of
    <code>obs/gesla/&lt;file name&gt;/&lt;year&gt;.parquet</code>. For example,
    ${code("gesla/aberdeen-abe-gbr-bodc")} holds BODC's Aberdeen record from
    ${firsts.get("gesla/aberdeen-abe-gbr-bodc")?.getUTCFullYear()}, while BODC's own
    quality-controlled series in the store, ${code("bodc/abe")}, starts in
    ${month(firsts.get("bodc/abe"))}, and the Environment Agency's live series for the same gauge,
    ${code("ea/E70739")}, starts in ${month(firsts.get("ea/E70739"))}.
  </p>`,
);
```

Stillwell changes GESLA's values only where it found an error, each an erratum with its evidence. There are ${errata.length}:

- **Clocks.** WSV's hourly means are stamped 30 minutes early, and UHSLC's Hong Kong records and some of CRMS's Louisiana records an hour early; all are moved.
- **Datums and positions.** Some records change datum while every value stays flagged usable, so a check on the raw levels flags the segments that sit apart from each record's longest one. Records copied from UHSLC that keep positions UHSLC has since corrected are moved to their gauges.
- **The wrong data.** GESLA's SMHI record of Uddevalla holds Arkö's values and is left out.
- **Shorter spans.** Offsets, spikes and clock errors of days to months are flagged suspect.

```js
display(html`${errata.map(erratum)}`);
```

## Rebuilding TICON from Stillwell

With the originators' series in the store, a fit is a query and a call to any harmonic analysis package. This uses [UTide](https://github.com/wesleybowman/UTide) on ten years of CO-OPS's Atlantic City series, on the hour, as GESLA's record has it:

```python
import duckdb, utide

con = duckdb.connect()
con.sql("SET TimeZone = 'UTC'")
files = [f"https://stillwell.openwaters.io/obs/coops/8534720/{y}.parquet" for y in range(2015, 2025)]
df = con.execute(
    "SELECT time, level_m FROM read_parquet(?, union_by_name = true) "
    "WHERE flag IN (0, 1) AND minute(time) = 0 ORDER BY time",
    [files],
).df()

coef = utide.solve(df.time.dt.tz_localize(None), df.level_m.values, lat=39.357,
                   method="ols", conf_int="none", verbose=False)
for name in ("M2", "S2", "N2", "K1", "O1"):
    i = list(coef.name).index(name)
    print(f"{name}  {coef.A[i]:.4f} m  {coef.g[i]:6.2f}°")
```

Here the same values are fitted in your browser by [`@slackwater/engine`](https://www.npmjs.com/package/@slackwater/engine), a least-squares fit of NOAA's 37 constituents with nodal corrections at every sample, and, if you ask, by UTide itself, run through [Pyodide](https://pyodide.org/). Aberdeen's fit uses the Environment Agency's last 366 days of 15-minute, real-time values, with `flag <= 2` since they're preliminary.

```js
const runFits = view(Inputs.button("Read the values and fit"));
```

```js
async function atlanticRows() {
  const files = await firstEpoch("coops/8534720", 2015, 2024);
  return sql`
    SELECT time, level_m AS level FROM read_parquet(${files}, union_by_name = true)
    WHERE flag IN (0, 1) AND minute(time) = 0 AND second(time) = 0 ORDER BY time`;
}
async function aberdeenRows() {
  const since = d3.utcDay.offset(new Date(), -366);
  const files = await firstEpoch("ea/E70739", since.getUTCFullYear(), new Date().getUTCFullYear());
  const [stored, recent] = await Promise.all([
    sql`SELECT time, level_m AS level FROM read_parquet(${files}, union_by_name = true) WHERE flag <= 2 AND time >= ${since}`,
    sql`SELECT time, level_m AS level FROM read_parquet(${recentUrl("ea")}) WHERE station = 'ea/E70739' AND flag <= 2 AND time >= ${since}`,
  ]);
  return [...new Map([...recent, ...stored].map((d) => [+d.time, d])).values()].sort(
    (a, b) => a.time - b.time,
  );
}
const fits = runFits
  ? await (async () => {
      const t0 = performance.now();
      const [atlantic, aberdeen] = await Promise.all([atlanticRows(), aberdeenRows()]);
      const read = (performance.now() - t0) / 1000;
      return {
        atlantic,
        aberdeen,
        read,
        engine: { atlantic: harmonics(atlantic), aberdeen: harmonics(aberdeen) },
      };
    })()
  : null;
```

```js
const runUtide = fits
  ? view(Inputs.button("Also fit with UTide (loads Pyodide, about 30 MB)"))
  : null;
```

```js
const utideFits = runUtide
  ? { atlantic: await utide(fits.atlantic, 39.357), aberdeen: await utide(fits.aberdeen, 57.144) }
  : null;
```

```js
// TICON-4's published constants (Hart-Davis et al. 2025), from the records' TICON files.
const TICON4 = {
  atlantic: {
    M2: [0.5845, 355.1],
    S2: [0.1177, 19.03],
    N2: [0.1347, 336.1],
    K1: [0.1083, 181.38],
    O1: [0.0747, 166.66],
  },
  aberdeen: {
    M2: [1.3008, 24.49],
    S2: [0.4401, 62.69],
    N2: [0.2586, 1.06],
    K1: [0.1124, 204.75],
    O1: [0.1266, 51.06],
  },
};
const fmt = (c) =>
  c ? `${c.amplitude.toFixed(4)} m, ${(((c.phase % 360) + 360) % 360).toFixed(2)}°` : "";
const ticon = ([a, g]) => `${a.toFixed(4)} m, ${g.toFixed(2)}°`;
display(
  fits
    ? html`<p>
          ${n(fits.atlantic.length)} hourly values at Atlantic City and ${n(fits.aberdeen.length)}
          at Aberdeen, read in ${fits.read.toFixed(1)} s.
        </p>
        ${Inputs.table(
          ["M2", "S2", "N2", "K1", "O1"].map((name) => ({
            Constituent: name,
            "Atlantic City, engine": fmt(fits.engine.atlantic.get(name)),
            ...(utideFits ? { "Atlantic City, UTide": fmt(utideFits.atlantic.get(name)) } : {}),
            "Atlantic City, TICON-4": ticon(TICON4.atlantic[name]),
            "Aberdeen, engine": fmt(fits.engine.aberdeen.get(name)),
            ...(utideFits ? { "Aberdeen, UTide": fmt(utideFits.aberdeen.get(name)) } : {}),
            "Aberdeen, TICON-4": ticon(TICON4.aberdeen[name]),
          })),
          { select: false },
        )}`
    : html`<p class="muted">
        Press the button to read ten years of Atlantic City and a year of Aberdeen (about 25 MB) and
        fit them.
      </p>`,
);
```

Phases are Greenwich phase lags, in degrees on UTC. TICON-4 fits Atlantic City from 1911 to 2025 and Aberdeen from BODC's record since 1930; the originators' current data carries the same constants on.

```js
const inventory = await FileAttachment("ticon-inventory.csv").csv({ typed: true });
const accepted = inventory.filter((d) => d.accepted === true);
const ready = accepted.filter((d) => d.status === "ready");
const [withValues] = await sql`
  SELECT count(*) AS n FROM read_parquet(${STATIONS})
  WHERE list_contains(${[...new Set(ready.map((d) => d.originator_id))]}, id) AND first IS NOT NULL`;
```

Of the ${n(accepted.length)} records slackwater-database's quality evaluation accepts, ${n(ready.length)} have an originator's series that Stillwell reads and may republish, ${n(withValues.n)} of which already have values in the store, so they can be fit directly today. The [TICON inventory](https://github.com/openwatersio/stillwell/blob/main/docs/ticon-inventory.md) gives the rest by source and status.

## Things to know

```js
const [backfill] = await sql`
  SELECT count(DISTINCT o.id) AS series, count(DISTINCT o.id) FILTER (WHERE o.first IS NULL) AS empty
  FROM read_parquet(${STATIONS}) g, unnest(g.same_as) AS u(other)
  JOIN read_parquet(${STATIONS}) o ON o.id = u.other
  WHERE g.source = 'gesla' AND o.source = 'coops'`;
```

- **Backfills are still running.** ${backfill.empty ? `CO-OPS's history is still being written, TICON's stations first, so ${n(backfill.empty)} of the ${n(backfill.series)} CO-OPS series GESLA links to have no values yet.` : "Every CO-OPS series GESLA links to has values."} `stations/years/<source>.parquet` lists the year files each series has, which is why `rebuild` reads it rather than guessing.
- **Datums.** Each originator's series is in its own datum, with the offsets it publishes in `stations.parquet`'s `datums`. GESLA's records are labeled `ZERO`, the contributor's own datum, with GESLA's description in `datum_information` and no offsets. Where the two match, as at Atlantic City, a rebuilt record and GESLA's agree to the millimeter; where they don't, as at Aberdeen (Ordnance Datum Newlyn in the EA's feed, Admiralty Chart Datum in BODC's series and GESLA's record), they differ by the offset between the datums.
- **Datum epochs.** A series whose datum changed has a subdirectory per later epoch, which `rebuild` doesn't read. The [data guide](https://github.com/openwatersio/stillwell/blob/main/docs/data.md#datum-epochs) shows how to read a whole record in its current datum.
- **Terms.** Each series carries its source's terms, and each GESLA record its contributor's, from GESLA's license table and from what the repository knows of the originator.
- **Credit.** Each series' `attribution` gives the credit its source asks for; GESLA's records name GESLA-4.1 (Haigh et al. 2023; Woodworth et al. 2017) and the contributor. The data is CC BY 4.0, credited to Open Waters and to each station's attribution, except the stations whose terms bar commercial use, which keep their contributor's terms.

## What we'd ask of you

```js
const aberdeenYears = new Map(
  (
    await sql`
      SELECT year, suspect + bad AS flagged, good + interpolated + preliminary + suspect + bad AS total
      FROM read_parquet(${url("stations/years/gesla.parquet")}) WHERE id = 'gesla/aberdeen-abe-gbr-bodc' AND year IN (2020, 2024)`
  ).map((d) => [d.year, d]),
);
const [bodcAgree] = await sql`
  WITH g AS (SELECT time, flag FROM read_parquet(${await firstEpoch("gesla/aberdeen-abe-gbr-bodc", 2024, 2024)})),
  b AS (SELECT time, flag FROM read_parquet(${await firstEpoch("bodc/abe", 2024, 2024)}))
  SELECT count(*) AS both, count(*) FILTER (WHERE (g.flag >= 3) = (b.flag >= 3)) AS agree FROM g JOIN b USING (time)`;
const bodcShare = await sql`
  SELECT year, (suspect + bad) / (good + interpolated + preliminary + suspect + bad) AS share
  FROM read_parquet(${url("stations/years/bodc.parquet")}) WHERE id = 'bodc/abe' AND year >= 2023 ORDER BY year`;
const a2020 = aberdeenYears.get(2020);
const a2024 = aberdeenYears.get(2024);
```

- **Look at the errata:** tell us if any entry in [GESLA's errata](../source?id=gesla) is wrong, or should be fixed in GESLA itself.
- **Aberdeen's recent flags:** GESLA 4.1 marks much of Aberdeen's recent record doubtful and not for use: ${n(a2020?.flagged)} of its ${n(a2020?.total)} values in 2020 and ${n(a2024?.flagged)} of ${n(a2024?.total)} in 2024. The flag is BODC's: in 2024 GESLA's flags match the improbable flags in BODC's own processed files on ${n(bodcAgree.agree)} of the ${n(bodcAgree.both)} values both hold, and BODC marks ${bodcShare.map((d) => `${Math.round(d.share * 100)}% in ${d.year}`).join(", ")}. We'd like to know what the flag reflects, if you know, and whether other BODC records in GESLA share it.
- **Tell us where an originator is missing:** if you know an agency's own feed for a GESLA contributor that Stillwell doesn't read yet, we'd like to add it.
- **Use it, and tell us what breaks:** for GESLA 5, TICON-5, or a check of either against the originators' current data. Issues on [the repository](https://github.com/openwatersio/stillwell/issues) reach us.

Fitted on their own, do GESLA's flagged values give Aberdeen's tide? Split 2020 and 2024 by GESLA's flag and fit each half:

```js
const runSplit = view(Inputs.button("Fit flagged and unflagged values"));
```

```js
const split = runSplit
  ? await (async () => {
      const files = await firstEpoch("gesla/aberdeen-abe-gbr-bodc", 2020, 2024);
      const rows = await sql`
        SELECT time, level_m AS level, flag >= 3 AS flagged FROM read_parquet(${files.filter((f) => /\/(2020|2024)\.parquet$/.test(f))})
        ORDER BY time`;
      return {
        flagged: harmonics(rows.filter((d) => d.flagged)).get("M2"),
        unflagged: harmonics(rows.filter((d) => !d.flagged)).get("M2"),
      };
    })()
  : null;
display(
  split
    ? html`<p>
        M2 from GESLA's flagged values: ${fmt(split.flagged)}; from the unflagged ones of the same
        years: ${fmt(split.unflagged)}.
      </p>`
    : html`<p class="muted">Press the button to fit them.</p>`,
);
```
