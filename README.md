# water-levels

Observed and predicted water levels from tide, river and lake gauges around the world, in one shape. Every station has its datum and its license, and the data is free to download as Parquet. [Open Waters](https://openwaters.io) builds it for reducing crowdsourced soundings to chart datum, for showing in [Slackwater](https://slackwater.xyz) how far the water is from the prediction, and for anyone else who needs gauge data without writing an adapter for each agency.

Each agency publishes in its own format, with its own limits, datums and quirks. This project fetches from each one, checks quality, and writes everything to one layout:

- **One schema.** Times are UTC and levels are meters. Quality flags run from 0, good, to 4, bad, whatever scale the source used.
- **Datums.** Each station's levels stay in the datum the source measures them from, and the station list gives the offsets to the other datums the source publishes.
- **Licenses.** Every station carries its source's license and attribution, and the public data includes only sources that allow commercial use.
- **Links between sources.** When two sources cover the same gauge, such as BSH's predictions and PEGELONLINE's observations at Cuxhaven, their stations link to each other.

## Sources

| Source                                                               | Coverage                                                                                                                                                                                                     | Datum                                                                                 | License                                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rijkswaterstaat](https://rijkswaterstaatdata.nl/waterdata/) (`rws`) | Observed levels and high and low waters, and RWS's astronomical tide and its extremes, at about 690 locations in the Netherlands and the Caribbean Netherlands, with multi-year histories at the tide gauges | NAP, or MSL at 14 stations, mostly offshore platforms                                 | [CC0](https://rijkswaterstaatdata.nl/waterdata/)                                                                                                                                                                  |
| [BSH tide service](https://gezeiten.bsh.de/) (`bsh`)                 | Predicted high and low waters and 10-minute curves at 172 German gauges, for the current year and the next                                                                                                   | Gauge zero (PNP), or chart datum (SKN) at 10 gauges                                   | Free, including commercial use, with BSH's source notice ([fee schedule, Anlage 4](https://www.bsh.de/DE/Das_BSH/Gebuehren_Preise/Gebuehren_und_Preise/_Anlagen/Downloads/Entgeltverzeichnis-digitale-Daten.pdf)) |
| [PEGELONLINE](https://www.pegelonline.wsv.de/) (`pegelonline`)       | Observed levels at German federal gauges on the coast and the rivers, including the BSH gauges, for the last 31 days                                                                                         | Gauge zero (PNP), or NN at 67 gauges                                                  | [DL-DE/Zero-2.0](https://www.pegelonline.wsv.de/gast/nutzungsbedingungen)                                                                                                                                         |
| [NOAA CO-OPS](https://tidesandcurrents.noaa.gov/) (`coops`)          | Observed 6-minute and hourly levels and verified high and low waters at about 2,900 current and historical stations, nearly all in the US, including the Great Lakes                                         | Station datum (STND), with offsets to MLLW, MSL, NAVD88 and, on the Great Lakes, IGLD | [U.S. Government work, public domain](https://tidesandcurrents.noaa.gov/disclaimers.html)                                                                                                                         |
| [USACE CWMS](https://cwms-data.usace.army.mil/cwms-data/) (`usace`)  | Stage at about 1,350 Corps gauges, pools and tailwaters on the Mississippi, Ohio, Missouri and their tributaries                                                                                             | Gauge zero (GZ), with offsets to NGVD29 or NAVD88 where CWMS gives them               | [U.S. Government work, public domain](https://www.law.cornell.edu/uscode/text/33/2342)                                                                                                                            |

[`stations.parquet`](https://water-levels.openwaters.io/stations.parquet) lists every station, and [`sources.json`](https://water-levels.openwaters.io/sources.json) gives each source's license and the attribution it asks for.

USGS comes next, for more river stage and lake levels. More European agencies follow after that, including the UK Environment Agency, Kartverket, SMHI, DMI, the Irish Marine Institute and REFMAR. [docs/plan.md](docs/plan.md) has the order. Sources that bar commercial use, such as IOC's sea level monitoring facility, parts of GESLA and the Canadian Hydrographic Service, aren't in the public data.

## Getting the data

Everything is Parquet at `https://water-levels.openwaters.io/`, readable without an account by DuckDB, Polars, pandas or anything else that reads Parquet over HTTPS. For example, with the [DuckDB CLI](https://duckdb.org/docs/installation/):

```sql
SET TimeZone = 'UTC';
SELECT time, level_m, flag, datum
FROM 'https://water-levels.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
WHERE flag <= 2
ORDER BY time LIMIT 5;
```

Files are laid out by product, source, station and year:

```
stations.parquet                                      one row per station
sources.json                                          license and attribution per source
recent/<source>.parquet                               the last 7 days for every station of a source
obs/<source>/<station>/<year>.parquet                 observed levels
extremes/<source>/<station>/<year>.parquet            the source's observed high and low waters
predictions/<source>/<station>/<year>.parquet         the source's predicted curve
predicted-extremes/<source>/<station>/<year>.parquet  the source's predicted high and low waters
```

Station IDs are `<source>/<source_id>`, such as `rws/hoekvanholland`. [docs/data.md](docs/data.md) describes every column and has more example queries: finding stations by name or by distance from a point, converting between datums, comparing observed levels with the prediction, reading many files at once, and reading from Python.

The lake is new. So far it holds the station lists for every source and one year of observations, Hoek van Holland in 2024. Scheduled ingest will fill in the rest.

An API at `api.openwaters.io/water-levels` is planned, with live levels for a station, and an archive series that can include Slackwater's prediction and the residual alongside the observations. [docs/api.md](docs/api.md) has the design.

## Not for navigation

Recent values are usually preliminary. Sources revise them later, and a gauge can fail without warning. Check the `flag` column, and don't rely on this data alone for navigation or safety.

## Also here

An implementation of the harmonic representation of inequalities (HRoI), the method BSH uses for German tide predictions, with an evaluation of it against a harmonic curve fit at German and Dutch gauges. See [docs/hroi-evaluation.md](docs/hroi-evaluation.md).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers running ingest, the checks, and adding a source.

## License

The code is [MIT](LICENSE). The data isn't covered by that license: each source's water levels and station metadata, including the copies in `stations/` (until each list moves to the lake), `test/fixtures/` and `docs/results/`, stay under that source's own license and attribution, in the table above and in `sources.json`. `docs/ticon-replacement.csv` and `.md` list [TICON-4](https://doi.org/10.17882/109129) records, under TICON-4's terms. BSH's data needs its source notice wherever it's shown, which for this repo's copies is: Datenquelle: Gezeitenvorausberechnungen ©, Bundesamt für Seeschifffahrt und Hydrographie.
