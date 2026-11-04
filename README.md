# water-levels

Observed and predicted water levels from tide and river gauges, in one shape, for [Open Waters](https://github.com/openwatersio). This is the start of the water-level lake described in the [planning evaluation](https://github.com/openwatersio/planning/tree/main/water-levels): one adapter per source, Parquet out, read with DuckDB.

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

```bash
node scripts/fetch.ts stations
```

```bash
node scripts/fetch.ts rws hoekvanholland 2024 2025
```

```bash
node scripts/fetch.ts bsh 506P
```

Output goes to `data/`:

```
data/stations/<source>.json
data/obs/<source>/<station>/<year>.parquet                 time, level_m
data/obs/<source>/<station>/<year>-extremes.parquet        time, level_m, type
data/predictions/<source>/<station>/<year>.parquet         time, level_m
data/predictions/<source>/<station>/<year>-extremes.parquet time, level_m, type[, transit, event]
```

`time` is UTC. `level_m` is in the station's own datum (NAP for RWS, gauge zero PNP for BSH and PEGELONLINE); `data/stations/*.json` gives offsets to other datums where the source publishes them. PEGELONLINE files are named for the days they cover, since the service only keeps 31 days.

Responses are cached in `.cache/`, so re-running a historical fetch doesn't hit the upstream service again.

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
