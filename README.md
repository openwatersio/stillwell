# water-levels

Observed and predicted water levels from tide and river gauges, in one shape, for [Open Waters](https://github.com/openwatersio). This is the water-level lake described in Open Waters' planning evaluation: one adapter per source, Parquet out, read with DuckDB. [docs/plan.md](docs/plan.md) has the plan and [docs/api.md](docs/api.md) the API design.

It has adapters for three sources so far:

| Source                                                               | What                                                                                                                                                                                              | License                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rijkswaterstaat](https://rijkswaterstaatdata.nl/waterdata/) (`rws`) | Observed levels and extremes, and RWS's astronomical tide and its extremes, at about 690 locations in the Netherlands and the Caribbean Netherlands, with multi-year histories at the tide gauges | CC0                                                                                                                                                                                                                                                                                                                   |
| [BSH tide service](https://gezeiten.bsh.de/) (`bsh`)                 | Predicted high and low waters and 10-minute curves at 172 German gauges, for the current year and the next                                                                                        | Free including commercial use, with BSH's source notice (Anlage 4 of the [fee schedule](https://www.bsh.de/DE/Das_BSH/Gebuehren_Preise/Gebuehren_und_Preise/_Anlagen/Downloads/Entgeltverzeichnis-digitale-Daten.pdf)); see [slackwater-database#335](https://github.com/openwatersio/slackwater-database/issues/335) |
| [PEGELONLINE](https://www.pegelonline.wsv.de/) (`pegelonline`)       | Observed levels at German federal gauges, including the BSH gauges, for the last 31 days                                                                                                          | DL-DE/Zero-2.0                                                                                                                                                                                                                                                                                                        |

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

The public lake is at `https://water-levels.openwaters.io/`; [docs/data.md](docs/data.md) explains its files, with example queries and their output.

The lake is `data/` unless `WATER_LEVELS_LAKE` names another directory or an `s3://` URL. For R2, set `S3_ENDPOINT`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, as crowd-depth does:

```
stations.parquet                                      one row per series
sources.json                                          license and attribution per source
recent/<source>.parquet                               station, time, level_m, flag, received
obs/<source>/<station>/<year>.parquet                 time, level_m, flag, received, datum
extremes/<source>/<station>/<year>.parquet            time, level_m, type, flag, datum
predictions/<source>/<station>/<year>.parquet         time, level_m, flag, received, datum
predicted-extremes/<source>/<station>/<year>.parquet  time, level_m, type, flag[, transit, event], datum
```

`time` is UTC. `level_m` is in the station's own datum, named in each series file's `datum` column and in `stations.parquet` (NAP for most RWS stations and MSL for the 14 that only report against it, mostly offshore platforms, gauge zero PNP for most PEGELONLINE gauges and BSH, except 10 BSH gauges predicted against chart datum SKN), and `stations.parquet` gives offsets to other datums where the source publishes them. `flag` is 0 good, 1 interpolated, 2 preliminary, 3 suspect, 4 bad. `received` is when ingest first saw a value arrive, and is empty for backfilled history.

Station IDs are `<source>/<source_id>`, such as `rws/hoekvanholland`. A station keeps one datum for its whole record, and adapters refuse values in any other. If a source starts reporting a station in another datum, `ingest stations` marks it inactive, prints it and exits nonzero, so a person can decide whether to convert its files or start over; `backfill … all` skips inactive stations. Each series file records its datum, and backfill refuses to write into a file in another, so a station brought back in a new datum can't mix the two. A station whose license bars commercial use writes its series to `WATER_LEVELS_RESTRICTED_LAKE`, a private lake separate from the public one, since the public bucket serves everything in it, and ingest refuses to write one without it.

Responses are cached in `.cache/`, so re-running a historical fetch doesn't hit the upstream service again. Each source's README in `src/sources/` covers its quirks.

## TICON replacement

```bash
npm run ticon:inventory
```

Reads a tide-database checkout (`TIDE_DATABASE`, default `../slackwater-database`) and writes [docs/ticon-replacement.md](docs/ticon-replacement.md): which lake source can replace each TICON record tide-database ships, and how far along each one is.

## Evaluations

```bash
npm run evaluate:bsh
```

```bash
npm run evaluate:rws
```

Each writes `docs/results/<source>.json` and prints a Markdown table. The RWS one downloads about 50 years of 10-minute data in total the first time, which takes 20–30 minutes.

## Development

[CONTRIBUTING.md](CONTRIBUTING.md) covers the layout, the checks and how to add a source.

```bash
npm run check
```

## License

The code is [MIT](LICENSE). The data isn't covered by that license: each source's water levels and station metadata, including the copies in `stations/`, `test/fixtures/` and `docs/results/`, stay under that source's own license and attribution, in the table above and in the lake's `sources.json`. `docs/ticon-replacement.csv` and `.md` list [TICON-4](https://doi.org/10.17882/109129) records, under TICON-4's terms. BSH's data needs its source notice wherever it's shown, which for this repo's copies is: Datenquelle: Gezeitenvorausberechnungen ©, Bundesamt für Seeschifffahrt und Hydrographie.
