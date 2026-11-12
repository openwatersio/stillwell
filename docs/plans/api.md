# Water levels API

The API this repo will serve at `https://api.openwaters.io/water-levels`, and the bulk files behind it. Parameter names, defaults and response fields follow the [tides API](https://github.com/openwatersio/slackwater/blob/main/packages/api/src/openapi.ts) wherever the two overlap, so a client of one already knows the other. This is the design to build against; [plan.md](plan.md) says when each part lands (live levels in phase 9, the rest in phase 10, bulk in phase 12). Nothing here is deployed yet.

## Conventions

- **Stations** are addressed as `/stations/{source}/{id}`, as in the tides API: `/stations/coops/9447130`, `/stations/rws/hoekvanholland`, `/stations/pegelonline/5990020`. A station is one source's series at one place; a gauge is the instrument, and `same_as` links stations that share one, such as a gauge whose observations come from one source and predictions from another. Some stations, such as BSH's predictions derived from a neighboring gauge, have no gauge of their own.
- **Times** are ISO 8601 in UTC with a `Z` suffix, in requests and responses.
- **Levels** are meters, rounded to the millimeter, positive up, or feet with `units=feet`.
- **Datums.** Every level is in one datum, named in the response as `datum`. The `datum` parameter accepts:
  - Omitted: the station's chart datum, as in the tides API (MLLW in the US, LAT in most of Europe), when the station has an offset to it. Otherwise the source's own reference, such as NAP or gauge zero (PNP).
  - A datum name the tides API accepts, such as `MSL`, `LAT` or `MLLW`, or `NAVD88`: converted with the station's offsets.
  - `station`: the source's own reference, unconverted. A source's datum keeps the source's name and isn't assumed to be the tides API's datum of the same name: RWS's offshore platforms report against RWS's own MSL, so `datum=MSL` there converts through the station's offsets like anywhere else, and is a 400 until one is known, while `datum=station` returns RWS's MSL as is.
  - A datum the station has no offset for is a 400 error, never a silent fallback.
- **Flags** on every value: `good`, `preliminary`, `suspect`, `bad`, `interpolated`. Real-time values are `preliminary` until the source verifies them. `bad` values are left out unless `includeBad=true`.
- **Licenses.** Until tokens exist, only stations whose terms allow commercial use (`commercial_use`) are served; the public store also holds stations that don't. The API's terms cover access to the service. The data is CC BY 4.0, as in the [README](../../README.md#license), except `commercial_use` false stations, which keep their contributor's terms. Each station carries its source's license, which still applies alongside CC BY, and every response that returns data lists the attribution lines its stations require. Displaying them is a condition of use.
- **Not for navigation.** Every data response includes `notice`. Observations are preliminary, and a gauge can fail without warning.
- **Source.** The code is AGPL-3.0, whose section 13 has a modified version offer its source to its network users. The API docs and a `/water-levels` root response, to be added to the endpoints below, link to its source, [openwatersio/stillwell](https://github.com/openwatersio/stillwell).
- **Requests** need a descriptive `User-Agent`. The open API allows 100 requests a minute and 10,000 a day per IP address, as the tides API does.
- **Parameters** are camelCase, as in the tides API (`maxResults`, `includeBad`). Responses use the tides API's field names where they overlap (`latitude`, `longitude`, `distance`, `datums`), and snake_case for fields of their own.
- **Errors** are JSON like the tides API's: `{"message": "…"}`, with `errors` listing each bad parameter on a 400. Status is 400 for bad parameters or a range too long, 404 for an unknown station, and 503 when the source is unavailable and nothing is cached.
- **Versioning.** Fields are only ever added. A breaking change gets a new path.
- Values in the examples are illustrative.

## Endpoints

### `GET /water-levels/sources`

Each source with its operator, license, attribution line, terms URL, where to report an error in its data, how often it updates, and how many stations it has.

### `GET /water-levels/stations`

Lists stations. Filters combine:

| Parameter                          | Meaning                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `query`                            | Full-text search on name, ID or place, as in the tides API                                                    |
| `latitude`, `longitude`            | Stations nearest the point, nearest first, each with `distance` in kilometers                                 |
| `maxDistance`                      | Search radius for `latitude` and `longitude`, in kilometers                                                   |
| `maxResults`                       | How many stations to return, 1 to 100; default 10                                                             |
| `bbox=minLon,minLat,maxLon,maxLat` | Stations inside the box, longitude first as in GeoJSON. `minLon > maxLon` crosses the antimeridian            |
| `kind`                             | `coastal`, `estuary`, `lake`, `river`                                                                         |
| `source`                           | A source ID, such as `coops`                                                                                  |
| `tide_station=noaa/9447130`        | The station linked to a slackwater-database station. A subordinate station resolves to its reference gauge's series |
| `live=true`                        | Only stations the live endpoint serves                                                                        |
| `status`                           | `active` (default) or `all`                                                                                   |

```json
{
  "stations": [
    {
      "id": "coops/9447130",
      "source": "coops",
      "name": "Seattle",
      "latitude": 47.6026,
      "longitude": -122.3393,
      "country_code": "US",
      "kind": "coastal",
      "status": "active",
      "live": true,
      "interval_s": 360,
      "first": "1898-01-01T00:00:00Z",
      "last": "2026-11-03T15:42:00Z",
      "tide_station": "noaa/9447130",
      "distance": 1.2
    }
  ]
}
```

### `GET /water-levels/stations/{source}/{id}`

One station in full: the fields above plus

```json
{
  "datum": "MLLW",
  "datums": { "MSL": 1.983, "LAT": -0.912, "NAVD88": 0.692 },
  "datums_source": {
    "MSL": "slackwater-database",
    "LAT": "slackwater-database",
    "NAVD88": "source"
  },
  "chart_datum": "MLLW",
  "datums_attribution": [
    "Slackwater database (https://github.com/openwatersio/slackwater-database)"
  ],
  "frame": "gauge",
  "license": {
    "type": "public-domain",
    "commercial_use": true,
    "url": "https://www.tidesandcurrents.noaa.gov/disclaimers.html"
  },
  "attribution": "NOAA National Ocean Service",
  "same_as": [],
  "preferred": "coops/9447130",
  "errata": [],
  "source_url": "https://tidesandcurrents.noaa.gov/stationhome.html?id=9447130",
  "min_interval_s": 360
}
```

`datum` is the datum the response is in, the station's chart datum unless `datum` asks for another. The store keeps each series in its source's own datum instead (station datum, STND, for CO-OPS; gage datum, GAGE, for USGS gage height), and the API will convert where the station has offsets; a USGS gage with no surveyed altitude has none, so its levels stay in gage datum. `datums` gives meters to add to a level in `datum` to refer it to each other datum. `frame` is `gauge` when the chart-datum offset comes from the slackwater-database station that `tide_station` names, measured against this series' zero, so observed levels and that station's predictions line up. It's `source` when the offset is the source's own or carried from another series of the gauge, which can differ from slackwater-database's by a few centimeters, and `unknown` when there's no chart-datum offset, or where slackwater-database's datums for the linked station are in the constituent frame (MSL = 0). Then observed levels and predictions can't be compared in absolute terms, only as trends. `stations.parquet` carries `frame` and `chart_datum` ([data.md](../data.md#stations)).

`same_as` lists the other stations for the same gauge, and `preferred` names the one to use for its observed levels, as in `stations.parquet` ([data.md](../data.md#stations)). Among the gauge's stations with observed levels, `preferred` names one whose terms allow commercial use where there is one.

`errata` names the errors found in what the source publishes for the station, each an entry in the source's [`errata.json`](https://github.com/openwatersio/stillwell/tree/main/src/sources), such as a clock the store corrects or a span it flags.

### `GET /water-levels/stations/{source}/{id}/live`

The last hours of observations, fetched from the source when the cache is older than the source allows, for apps and station pages.

| Parameter      | Default           | Meaning                                                                                                            |
| -------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `start`, `end` | The last 96 hours | ISO 8601, as in the tides API; at most 168 hours back                                                              |
| `step`         | `6m`              | `6m`, `15m`, `1h`, or `raw` for the source's own interval. Each step takes the sample nearest its time, not a mean |
| `datum`        | Chart datum       | As above                                                                                                           |
| `units`        | `meters`          | `meters` or `feet`                                                                                                 |

```json
{
  "station": { "id": "coops/9447130", "name": "Seattle", "tide_station": "noaa/9447130" },
  "datum": "MLLW",
  "datums": { "MSL": 1.983, "MLLW": 0 },
  "frame": "gauge",
  "status": "reporting",
  "as_of": "2026-11-03T15:42:00Z",
  "fetched": "2026-11-03T15:44:10Z",
  "levels": [
    { "time": "2026-10-30T15:48:00Z", "level": 2.871, "flag": "preliminary" },
    { "time": "2026-10-30T15:54:00Z", "level": 2.905, "flag": "preliminary" }
  ],
  "attribution": [
    "NOAA National Ocean Service",
    "Slackwater database (https://github.com/openwatersio/slackwater-database)"
  ],
  "notice": "Preliminary observations. Not for navigation."
}
```

`status` is `reporting`; `stale` when the newest value is older than three of the station's intervals, or when the source failed and this is the last good copy; or `offline` when the station has sent nothing for a day. `as_of` is the newest value's time and `fetched` is when the API last asked the source. Responses carry `Cache-Control: public, max-age=<min_interval_s>`.

This endpoint returns observations only. Slackwater computes the residual against its own bundled prediction, so the number matches the curve the user sees.

### `GET /water-levels/stations/{source}/{id}/levels`

A series from the archive, joined to the live window when `end` is recent.

| Parameter      | Default               | Meaning                                                                                                                                                                   |
| -------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`, `end` | The 7 days before now | At most 1 year per request at 6-minute steps or coarser, 31 days at `raw` for 1-minute sources                                                                            |
| `step`         | `6m`                  | As above, plus `1d`                                                                                                                                                       |
| `datum`        | Chart datum           | As above                                                                                                                                                                  |
| `units`        | `meters`              | `meters` or `feet`                                                                                                                                                        |
| `include`      | none                  | Comma-separated: `predicted` (Slackwater's prediction from the linked slackwater-database station), `residual` (observed minus predicted), `received` (when each value arrived) |
| `includeBad`   | `false`               | `true` to include values flagged `bad`                                                                                                                                    |

Each row is `{time, level, flag}`, plus `predicted`, `residual` and `received` when asked for. When `include` asks for predictions, the response names the slackwater-database version it used (`"database": "2026.11.01"`).

### `GET /water-levels/stations/{source}/{id}/extremes`

High and low waters over `start` to `end`, in `datum` and `units`, with the same defaults as `levels`.

- `kind=observed` (default): turning points taken from the observed series, one high and one low per tidal cycle.
- `kind=published`: the source's own extremes where it publishes them (RWS measured and astronomical, BSH predictions), with `transit` and `event` for BSH.

Each row is `{time, level, high, low, label}` like the tides API's extremes: `high` or `low` is true, and `label` is "High" or "Low".

### `GET /water-levels/at`

The best estimate of the water level at a point and time, for places without a gauge. Needs `latitude`, `longitude` and `time`; takes `datum` and `units` as above.

```json
{
  "time": "2025-07-14T18:00:00Z",
  "level": 1.42,
  "datum": "MLLW",
  "uncertainty_m": 0.12,
  "method": "prediction+residual",
  "components": {
    "predicted": { "level": 1.31, "tide_station": "noaa/9446484", "distance": 3.4 },
    "residual": { "level": 0.11, "stations": ["coops/9446484"], "distance": 3.4 }
  },
  "attribution": ["NOAA National Ocean Service"],
  "notice": "Estimate. Not for navigation."
}
```

`method` is one of:

1. `observed`: a gauge within 1 km with data at that time.
2. `prediction+residual`: the nearest slackwater-database prediction, plus the residual from gauges within about 100 km (fast) or a few hundred km (slow), as crowd-depth uses today.
3. `prediction+surge`: the prediction plus modeled surge (STOFS-2D or GTSM).
4. `model`: modeled total water level only.

`uncertainty_m` comes from validating each method against held-out gauges, not from the components' own spread.

## Bulk data

The API serves what the store holds, and the store's files stay readable without an account, as [data.md](../data.md) describes. Phase 12 adds quarterly snapshots, with a DOI:

```
bulk/<YYYY-Qn>/<source>.parquet
```

## Not in the API

- Stations with `commercial_use` false, such as the UHSLC gauges whose contributors bar commercial use, until tokens and plans exist; then non-commercial users get them. They're in the public store.
- Data whose source bars republishing, such as IOC's sea level monitoring facility and the restricted GESLA contributors. It goes to the private store for research and for fitting slackwater-database constants where the operator agrees.
- CHS data in any form. Its license bars third-party transfer and commercial derivatives; Slackwater fetches it on the device.
- Data from vessels. See [plan.md](plan.md#out-of-scope).
