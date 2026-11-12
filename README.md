# Stillwell

Observed and predicted water levels from tide, river and lake gauges around the world, in one shape. Every station has its datum and its license, and the data is free to download as Parquet. [Open Waters](https://openwaters.io) builds it for reducing crowdsourced soundings to chart datum, for showing in [Slackwater](https://slackwater.xyz) how far the water is from the prediction, and for anyone else who needs gauge data without writing an adapter for each agency.

Each agency publishes in its own format, with its own limits, datums and quirks. Stillwell fetches from each one, checks quality, and writes everything to one layout:

- **One schema.** Times are UTC and levels are meters. Quality flags run from 0, good, to 4, bad, whatever scale the source used.
- **Datums.** Each station's levels stay in the datum the source measures them from, and the station list gives the offsets to the other datums the source publishes, and to MSL, LAT and chart datum from slackwater-database where it has the gauge.
- **Licenses.** Every station carries its license, attribution and whether its terms allow commercial use. The public store holds what its sources let anyone republish.
- **Errata.** Errors found in what a source publishes, such as UHSLC's Hong Kong heights stamped an hour early, are listed in [`errata.json`](https://stillwell.openwaters.io/errata.json) with what the store does about each, and each station's `errata` names the ones that touch it.
- **Links between sources.** When two sources cover the same gauge, such as BSH's predictions and PEGELONLINE's observations at Cuxhaven, their stations link to each other.

## Sources

Each source's README gives its coverage, datums, cadence, license and quirks.

- [BODC](src/sources/bodc/README.md): quality-controlled 15-minute levels from the UK National Tide Gauge Network.
- [BSH](src/sources/bsh/README.md): predicted high and low waters and tide curves at German gauges.
- [CDEC](src/sources/cdec/README.md): 15-minute river stage at tidal gauges in the Sacramento–San Joaquin Delta and San Francisco Bay.
- [CO-OPS](src/sources/coops/README.md): NOAA's observed levels and verified high and low waters, nearly all in the US and the Great Lakes.
- [CRMS](src/sources/crms/README.md): hourly levels in Louisiana's coastal marshes and swamps.
- [California DWR](src/sources/dwr/README.md): 15-minute stage at tidal gauges in the Sacramento–San Joaquin Delta.
- [Environment Agency](src/sources/ea/README.md): real-time 15-minute tidal levels around England and the UK network.
- [GESLA](src/sources/gesla/README.md): GESLA 4.1's static release of sea level records from more than 40 agencies.
- [JMA](src/sources/jma/README.md): hourly tide levels at Japanese gauges.
- [Kartverket](src/sources/kartverket/README.md): 10-minute levels at Norway's and Svalbard's permanent tide gauges.
- [Marine Institute](src/sources/marine-institute/README.md): 5-minute levels from the Irish National Tide Gauge Network.
- [PEGELONLINE](src/sources/pegelonline/README.md): observed levels at German federal gauges on the coast and the rivers.
- [REFMAR](src/sources/refmar/README.md): SHOM's and its partners' tide gauges in France and its overseas territories.
- [Rijkswaterstaat](src/sources/rws/README.md): observed levels, high and low waters and astronomical tide in the Netherlands and the Caribbean Netherlands.
- [SFWMD](src/sources/sfwmd/README.md): stage at tidal structures, estuaries and bays in South Florida.
- [SMHI](src/sources/smhi/README.md): hourly sea level at Swedish gauges.
- [UHSLC](src/sources/uhslc/README.md): hourly sea level at tide gauges worldwide, research-quality and fast-delivery.
- [USACE](src/sources/usace/README.md): stage at Corps gauges, pools and tailwaters on the Mississippi, Ohio, Missouri and their tributaries.
- [USGS](src/sources/usgs/README.md): gage height and water-surface elevations at river, lake, estuary and coastal gauges across the US.

[`stations.parquet`](https://stillwell.openwaters.io/stations.parquet) lists every station, and [`sources.json`](https://stillwell.openwaters.io/sources.json) gives each source's license, the attribution it asks for, and where to report an error in its data (`contact`). The [DMI](src/sources/dmi/README.md) adapter isn't registered, so DMI isn't in the store. [docs/plans/plan.md](docs/plans/plan.md) has the sources still to come.

## Getting the data

Everything is Parquet at `https://stillwell.openwaters.io/`, readable without an account by DuckDB, Polars, pandas or anything else that reads Parquet over HTTPS. For example, with the [DuckDB CLI](https://duckdb.org/docs/installation/):

```sql
SET TimeZone = 'UTC';
SELECT time, level_m, flag, datum
FROM 'https://stillwell.openwaters.io/obs/rws/hoekvanholland/2024.parquet'
WHERE flag <= 2
ORDER BY time LIMIT 5;
```

[docs/data.md](docs/data.md) has the file layout, every column, and more example queries: finding stations by name or by distance from a point, converting between datums, comparing observed levels with the prediction, reading many files at once, and reading from Python.

There's no API yet. [docs/plans/api.md](docs/plans/api.md) has the design for one at `api.openwaters.io/water-levels`.

## Not for navigation

Recent values are usually preliminary. Sources revise them later, and a gauge can fail without warning. Check the `flag` column, and don't rely on this data alone for navigation or safety.

## Docs

- [docs/data.md](docs/data.md): using the store's files.
- [docs/stations.md](docs/stations.md): station lists, datum epochs, analysis and links between sources.
- [docs/qc/](docs/qc/README.md): quality control, compared with published practice.
- [docs/ticon-replacement.md](docs/ticon-replacement.md): the store series that can replace each TICON record.
- [docs/plans/](docs/plans/plan.md): the roadmap and the API design.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers running ingest, the checks, and adding a source.

## License

**Code**: [AGPL-3.0](LICENSE) © Open Waters (https://openwaters.io) and contributors with [CLA](CLA.md).

**Data**: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) © Open Waters (https://openwaters.io), and:

- Stations with `commercial_use` false keep their source's terms.
- Show each station's `attribution` from [`stations.parquet`](https://stillwell.openwaters.io/stations.parquet) wherever its data is used, and its `datums_attribution` wherever you use its datum offsets.

For example, this query reads the last week of REFMAR levels that allow commercial use, with each station's attribution:

```sql
SELECT r.time, r.station, r.level_m, s.attribution
FROM 'https://stillwell.openwaters.io/recent/refmar.parquet' r
JOIN 'https://stillwell.openwaters.io/stations.parquet' s ON s.id = r.station
WHERE s.commercial_use;
```
