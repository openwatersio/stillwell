# water-levels

Observed and predicted water levels from tide and river gauges, in one shape, for [Open Waters](https://github.com/openwatersio). This is the water-level lake described in the [planning evaluation](https://github.com/openwatersio/planning/tree/main/water-levels): one adapter per source, Parquet out, read with DuckDB. [docs/plan.md](docs/plan.md) has the plan and [docs/api.md](docs/api.md) the API design.

It has adapters for three sources so far:

| Source                                                               | What                                                                                                                                                   | License                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rijkswaterstaat](https://rijkswaterstaatdata.nl/waterdata/) (`rws`) | Observed levels and extremes, and RWS's astronomical tide and its extremes, at about 680 Dutch locations, with multi-year histories at the tide gauges | CC0                                                                                                                                                                                                                                                                                                                   |
| [BSH tide service](https://gezeiten.bsh.de/) (`bsh`)                 | Predicted high and low waters and 10-minute curves at 172 German gauges, for the current year and the next                                             | Free including commercial use, with BSH's source notice (Anlage 4 of the [fee schedule](https://www.bsh.de/DE/Das_BSH/Gebuehren_Preise/Gebuehren_und_Preise/_Anlagen/Downloads/Entgeltverzeichnis-digitale-Daten.pdf)); see [slackwater-database#335](https://github.com/openwatersio/slackwater-database/issues/335) |
| [PEGELONLINE](https://www.pegelonline.wsv.de/) (`pegelonline`)       | Observed levels at German federal gauges, including the BSH gauges, for the last 31 days                                                               | DL-DE/Zero-2.0                                                                                                                                                                                                                                                                                                        |

It also has an implementation of the harmonic representation of inequalities (HRoI), the method BSH uses for German tide predictions, and an evaluation of it against the harmonic method Slackwater uses. See [docs/hroi-evaluation.md](docs/hroi-evaluation.md).

## Usage

Requires Node 24 or later.

```bash
npm install
```

Refresh the station lists in `stations/` and write `stations.parquet` and `sources.json` to the lake:

```bash
node scripts/ingest.ts stations
```

Backfill a station's observations, extremes and predictions, by year (end exclusive):

```bash
node scripts/ingest.ts backfill rws hoekvanholland 2016 2025
```

```bash
node scripts/ingest.ts backfill bsh 506P 2026 2028
```

Merge the last hours from every live station into the recent window:

```bash
node scripts/ingest.ts recent pegelonline --hours 3
```

The lake is `data/` unless `WATER_LEVELS_LAKE` names another directory or an `s3://` URL. For R2, set `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, as crowd-depth does:

```
stations.parquet                                      one row per series
sources.json                                          license and attribution per source
recent/<source>.parquet                               station, time, level_m, flag, received
obs/<source>/<station>/<year>.parquet                 time, level_m, flag, received
extremes/<source>/<station>/<year>.parquet            time, level_m, type, flag
predictions/<source>/<station>/<year>.parquet         time, level_m, flag, received
predicted-extremes/<source>/<station>/<year>.parquet  time, level_m, type, flag[, transit, event]
```

`time` is UTC. `level_m` is in the station's own datum (NAP for RWS, gauge zero PNP for BSH and most PEGELONLINE gauges), and `stations.parquet` gives offsets to other datums where the source publishes them. `flag` is 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad. `received` is when ingest first saw a value arrive, and is empty for backfilled history.

Responses are cached in `.cache/`, so re-running a historical fetch doesn't hit the upstream service again. Each source's README in `src/sources/` covers its quirks.

## Evaluations

```bash
npm run evaluate:bsh
```

```bash
npm run evaluate:rws
```

Each writes `docs/results/<source>.json` and prints a Markdown table. The RWS one downloads about 50 years of 10-minute data in total the first time, which takes 20–30 minutes.

## Development

```bash
npm test
```

```bash
npm run typecheck
```
