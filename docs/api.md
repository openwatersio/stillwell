# Water levels API

The API this repo will serve at `https://api.openwaters.io/water-levels`, and the bulk files behind it. This is the design to build against; [plan.md](plan.md) says when each part lands (live levels in phase 9, the rest in phase 10, bulk in phase 12). Nothing here is deployed yet.

## Conventions

- **Station IDs** are `<source>:<source_id>`: `coops:9447130`, `usgs:07022000`, `rws:hoekvanholland`, `pegelonline:BONN`. A station is one gauge's series from one source. The same physical gauge relayed by two sources has two IDs linked by `same_as`.
- **Times** are ISO 8601 in UTC with a `Z` suffix, in requests and responses.
- **Levels** are meters, rounded to the millimeter, positive up.
- **Datums.** Every level is in one datum, named in the response. `datum` accepts:
  - `station` (default): the source's own reference, such as MLLW, NAP, gauge zero (PNP) or NAVD88.
  - `MSL`, `LAT`, `NAVD88`: converted with the station's offsets.
  - `chart`: the station's chart datum as tide-database defines it (MLLW in the US, LAT in most of Europe).
  - A datum the station has no offset for returns `422 datum_unavailable`, never a silent fallback.
- **Flags** on every value: `good`, `preliminary`, `suspect`, `bad`, `interpolated`. Real-time values are `preliminary` until the source verifies them. `bad` values are left out unless `include_bad=true`.
- **Licenses.** Only stations whose license allows commercial use are served. Each station carries its license, and every response that returns data lists the attribution lines its stations require. Displaying them is a condition of use.
- **Not for navigation.** Every data response includes `notice`. Observations are preliminary, and a gauge can fail without warning.
- **Requests** need a descriptive `User-Agent`. The open API allows 100 requests a minute and 10,000 a day per IP address, as the tides API does.
- **Errors** are JSON: `{"error": {"code": "station_not_found", "message": "…"}}`, with status 400 (bad parameters or range too long), 404, 422 and 503 (source unavailable and nothing cached).
- **Versioning.** Fields are only ever added. A breaking change gets a new path.
- Values in the examples are illustrative.

## Endpoints

### `GET /water-levels/sources`

Each source with its operator, license, attribution line, terms URL, how often it updates, and how many stations it has.

### `GET /water-levels/stations`

Lists stations. Filters combine:

| Parameter                                   | Meaning                                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `bbox=west,south,east,north`                | Stations inside the box                                                                                       |
| `near=lat,lon` and `radius_km` (default 50) | Stations within the radius, nearest first, with `distance_km`                                                 |
| `kind`                                      | `coastal`, `estuary`, `lake`, `river`                                                                         |
| `source`                                    | A source ID, such as `coops`                                                                                  |
| `tide_station=noaa/9447130`                 | The station linked to a tide-database station. A subordinate station resolves to its reference gauge's series |
| `live=true`                                 | Only stations the live endpoint serves                                                                        |
| `status`                                    | `active` (default) or `all`                                                                                   |

```json
{
  "stations": [
    {
      "id": "coops:9447130",
      "name": "Seattle",
      "lat": 47.6026,
      "lon": -122.3393,
      "country_code": "US",
      "kind": "coastal",
      "source": "coops",
      "status": "active",
      "live": true,
      "interval_s": 360,
      "first": "1898-01-01T00:00:00Z",
      "last": "2026-11-03T15:42:00Z",
      "tide_station": "noaa/9447130",
      "distance_km": 1.2
    }
  ]
}
```

### `GET /water-levels/stations/{id}`

One station in full: the fields above plus

```json
{
  "datum": "MLLW",
  "datums": { "MSL": 1.983, "LAT": -0.912, "NAVD88": 0.692, "chart": 0 },
  "datums_source": "coops",
  "frame": "gauge",
  "license": {
    "type": "public-domain",
    "commercial_use": true,
    "url": "https://www.tidesandcurrents.noaa.gov/disclaimers.html"
  },
  "attribution": "NOAA National Ocean Service",
  "same_as": ["gesla:seattle-9447130-usa-noaa"],
  "source_url": "https://tidesandcurrents.noaa.gov/stationhome.html?id=9447130",
  "min_interval_s": 300
}
```

`datums` gives meters to add to a level in `datum` to refer it to each other datum. `frame` is `gauge` when those offsets are measured against the gauge zero, and `unknown` when tide-database's datums for the linked station are in the constituent frame (MSL = 0). Then observed levels and predictions can't be compared in absolute terms, only as trends.

### `GET /water-levels/stations/{id}/live`

The last hours of observations, fetched from the source when the cache is older than the source allows, for apps and station pages.

| Parameter | Default   | Meaning                                                                                                            |
| --------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `hours`   | 96        | Up to 168                                                                                                          |
| `step`    | `6m`      | `6m`, `15m`, `1h`, or `raw` for the source's own interval. Each step takes the sample nearest its time, not a mean |
| `datum`   | `station` | As above                                                                                                           |

```json
{
  "station": { "id": "coops:9447130", "name": "Seattle", "tide_station": "noaa/9447130" },
  "datum": "MLLW",
  "datums": { "MSL": 1.983, "chart": 0 },
  "frame": "gauge",
  "status": "reporting",
  "as_of": "2026-11-03T15:42:00Z",
  "fetched": "2026-11-03T15:44:10Z",
  "levels": [
    { "time": "2026-10-30T15:48:00Z", "level": 2.871, "flag": "preliminary" },
    { "time": "2026-10-30T15:54:00Z", "level": 2.905, "flag": "preliminary" }
  ],
  "attribution": ["NOAA National Ocean Service"],
  "notice": "Preliminary observations. Not for navigation."
}
```

`status` is `reporting`; `stale` when the newest value is older than three of the station's intervals, or when the source failed and this is the last good copy; or `offline` when the station has sent nothing for a day. `as_of` is the newest value's time and `fetched` is when the API last asked the source. Responses carry `Cache-Control: public, max-age=<min_interval_s>`.

This endpoint returns observations only. Slackwater computes the residual against its own bundled prediction, so the number matches the curve the user sees.

### `GET /water-levels/stations/{id}/levels`

A series from the archive, joined to the live window when `end` is recent.

| Parameter      | Default     | Meaning                                                                                                                                                                   |
| -------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`, `end` | Last 7 days | At most 1 year per request at 6-minute steps or coarser, 31 days at `raw` for 1-minute sources                                                                            |
| `step`         | `6m`        | As above, plus `1d`                                                                                                                                                       |
| `datum`        | `station`   | As above                                                                                                                                                                  |
| `include`      | none        | Comma-separated: `predicted` (Slackwater's prediction from the linked tide-database station), `residual` (observed minus predicted), `received` (when each value arrived) |
| `include_bad`  | `false`     | `true` to include values flagged `bad`                                                                                                                                    |

Each row is `{time, level, flag}`, plus `predicted`, `residual` and `received` when asked for. When `include` asks for predictions, the response names the tide-database version it used (`"database": "2026.11.01"`).

### `GET /water-levels/stations/{id}/extremes`

High and low waters over `start` to `end`, in `datum`.

- `kind=observed` (default): turning points taken from the observed series, one high and one low per tidal cycle.
- `kind=published`: the source's own extremes where it publishes them (RWS measured and astronomical, BSH predictions), with `transit` and `event` for BSH.

Each row is `{time, level, type: "high" | "low"}`.

### `GET /water-levels/at`

The best estimate of the water level at a point and time, for places without a gauge. Needs `lat`, `lon` and `time`; `datum` defaults to `chart`.

```json
{
  "time": "2025-07-14T18:00:00Z",
  "level": 1.42,
  "datum": "MLLW",
  "uncertainty_m": 0.12,
  "method": "prediction+residual",
  "components": {
    "predicted": { "level": 1.31, "tide_station": "noaa/9446484", "distance_km": 3.4 },
    "residual": { "level": 0.11, "stations": ["coops:9446484"], "distance_km": 3.4 }
  },
  "attribution": ["NOAA National Ocean Service"],
  "notice": "Estimate. Not for navigation."
}
```

`method` is one of:

1. `observed`: a gauge within 1 km with data at that time.
2. `prediction+residual`: the nearest tide-database prediction, plus the residual from gauges within about 100 km (fast) or a few hundred km (slow), as crowd-depth uses today.
3. `prediction+surge`: the prediction plus modeled surge (STOFS-2D or GTSM).
4. `model`: modeled total water level only.

`uncertainty_m` comes from validating each method against held-out gauges, not from the components' own spread.

## Bulk data

Everything the API serves, as Parquet, at `https://data.openwaters.io/water-levels/`, readable without an account:

```
stations.parquet
sources.json
obs/<source>/<station>/<year>.parquet          time, level_m, flag, received
extremes/<source>/<station>/<year>.parquet     time, level_m, type, flag
predictions/<source>/<station>/<year>.parquet  published predictions (RWS, BSH)
predicted-extremes/<source>/<station>/<year>.parquet  published predicted high and low waters
bulk/<YYYY-Qn>/<source>.parquet                quarterly snapshots, with a DOI
```

Levels in these files are in each station's own datum; `stations.parquet` has the offsets.

```sql
SELECT time, level_m
FROM 'https://data.openwaters.io/water-levels/obs/coops/9447130/2025.parquet'
WHERE flag <= 1;
```

## Not in the API

- Non-commercial sources (IOC, the restricted GESLA contributors, BODC) until tokens and plans exist. They're in the lake for research and for fitting tide-database constants where the operator agrees.
- CHS data in any form. Its license bars third-party transfer and commercial derivatives; Slackwater fetches it on the device.
- Data from vessels. See [plan.md](plan.md#out-of-scope).
