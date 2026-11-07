# water-levels

Observed and predicted water levels from tide, river and lake gauges around the world, in one shape. Every station has its datum and its license, and the data is free to download as Parquet. [Open Waters](https://openwaters.io) builds it for reducing crowdsourced soundings to chart datum, for showing in [Slackwater](https://slackwater.xyz) how far the water is from the prediction, and for anyone else who needs gauge data without writing an adapter for each agency.

Each agency publishes in its own format, with its own limits, datums and quirks. This project fetches from each one, checks quality, and writes everything to one layout:

- **One schema.** Times are UTC and levels are meters. Quality flags run from 0, good, to 4, bad, whatever scale the source used.
- **Datums.** Each station's levels stay in the datum the source measures them from, and the station list gives the offsets to the other datums the source publishes.
- **Licenses.** Every station carries its license, attribution and whether its terms allow commercial use. The public data holds what its sources let anyone republish.
- **Links between sources.** When two sources cover the same gauge, such as BSH's predictions and PEGELONLINE's observations at Cuxhaven, their stations link to each other.

## Sources

| Source                                                                                                               | Coverage                                                                                                                                                                                                                      | Datum                                                                                                                           | License                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Rijkswaterstaat](https://rijkswaterstaatdata.nl/waterdata/) (`rws`)                                                 | Observed levels and high and low waters, and RWS's astronomical tide and its extremes, at about 690 locations in the Netherlands and the Caribbean Netherlands, with multi-year histories at the tide gauges                  | NAP, or MSL at 14 stations, mostly offshore platforms                                                                           | [CC0](https://rijkswaterstaatdata.nl/waterdata/)                                                                                                                                                                  |
| [BSH tide service](https://gezeiten.bsh.de/) (`bsh`)                                                                 | Predicted high and low waters and 10-minute curves at 172 German gauges, for the current year and the next                                                                                                                    | Gauge zero (PNP), or chart datum (SKN) at 10 gauges                                                                             | Free, including commercial use, with BSH's source notice ([fee schedule, Anlage 4](https://www.bsh.de/DE/Das_BSH/Gebuehren_Preise/Gebuehren_und_Preise/_Anlagen/Downloads/Entgeltverzeichnis-digitale-Daten.pdf)) |
| [PEGELONLINE](https://www.pegelonline.wsv.de/) (`pegelonline`)                                                       | Observed levels at German federal gauges on the coast and the rivers, including the BSH gauges, back to 2000 at most gauges                                                                                                   | Gauge zero (PNP), or NN at 67 gauges                                                                                            | [DL-DE/Zero-2.0](https://www.pegelonline.wsv.de/gast/nutzungsbedingungen)                                                                                                                                         |
| [NOAA CO-OPS](https://tidesandcurrents.noaa.gov/) (`coops`)                                                          | Observed 6-minute and hourly levels and verified high and low waters at about 2,900 current and historical stations, nearly all in the US, including the Great Lakes                                                          | Station datum (STND), with offsets to MLLW, MSL, NAVD88 and, on the Great Lakes, IGLD                                           | [U.S. Government work, public domain](https://tidesandcurrents.noaa.gov/disclaimers.html)                                                                                                                         |
| [USACE CWMS](https://cwms-data.usace.army.mil/cwms-data/) (`usace`)                                                  | Stage at about 1,350 Corps gauges, pools and tailwaters on the Mississippi, Ohio, Missouri and their tributaries                                                                                                              | Gauge zero (GZ), with offsets to NGVD29 or NAVD88 where CWMS gives them                                                         | [U.S. Government work, public domain](https://www.law.cornell.edu/uscode/text/33/2342)                                                                                                                            |
| [USGS Water Data](https://waterdata.usgs.gov/) (`usgs`)                                                              | Observed gage height and water-surface elevations at about 14,000 river, lake, estuary and coastal gauges across the US, since 2007 at most                                                                                   | Gage datum (GAGE), with offsets to NAVD88 or NGVD29, or NAVD88 or NGVD29 directly                                               | [U.S. Government work, public domain](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)                                                                                          |
| [UHSLC](https://uhslc.soest.hawaii.edu/data/) (`uhslc`)                                                              | Hourly sea level at about 590 tide gauges worldwide, back to 1846: each station's research-quality record with fast-delivery values after it, and its older research-quality versions apart                                   | Station zero (ZERO)                                                                                                             | [Free use and redistribution, not for legal use](https://uhslc.soest.hawaii.edu/datainfo/); cite Caldwell et al. (2015). Commercial use and credit per contributor ([table](docs/uhslc-contributors.md))          |
| [REFMAR](https://refmar.shom.fr/) (`refmar`)                                                                         | Observed sea levels at about 170 French tide gauges in metropolitan France and overseas, SHOM's own and its partners', back to 1846 at Brest: validated 10-minute and hourly values, and raw values until SHOM validates them | Chart datum (ZH), with offsets to the land survey datum where SHOM gives them, or an unknown gauge zero (ZI) at about 65 gauges | [Licence Ouverte 2.0](https://www.etalab.gouv.fr/licence-ouverte-open-licence/) (Etalab); cite REFMAR's DOI and credit each gauge's owner                                                                         |
| [Kartverket](https://vannstand.kartverket.no/tideapi_en.html) (`kartverket`)                                         | Observed 10-minute levels at 33 permanent tide gauges in Norway and Svalbard, back to the late 1980s at the long-running ones                                                                                                 | Chart datum (CD), with offsets to MSL and NN2000                                                                                | [CC BY 4.0](https://kartverket.no/en/api-and-data/tides-and-water-level-data)                                                                                                                                     |
| [SMHI](https://www.smhi.se/data/oceanografi/ladda-ner-oceanografiska-observationer) (`smhi`)                         | Hourly sea level at 71 Swedish gauges, 60 of them active, back to 1886 at the oldest                                                                                                                                          | RH2000                                                                                                                          | [CC BY 4.0](https://www.smhi.se/data/om-smhis-data/villkor-for-anvandning)                                                                                                                                        |
| [JMA](https://www.data.jma.go.jp/kaiyou/db/tide/genbo/index.php) (`jma`)                                             | Hourly tide levels at 90 Japanese gauges, 70 of them open, back to 1924 at the oldest                                                                                                                                         | Each station's observation datum (DL)                                                                                           | [Public Data License 1.0](https://www.jma.go.jp/jma/en/copyright.html), compatible with CC BY 4.0                                                                                                                 |
| [Marine Institute](https://erddap.marine.ie/erddap/tabledap/IrishNationalTideGaugeNetwork.html) (`marine-institute`) | Observed 5-minute levels at 23 gauges of the Irish National Tide Gauge Network, back to 2006                                                                                                                                  | OD Malin (ODM), with the offset to LAT                                                                                          | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)                                                                                                                                                         |
| [Environment Agency](https://environment.data.gov.uk/flood-monitoring/doc/reference) (`ea`)                          | 15-minute tidal levels at 43 tide gauges of the UK National Tide Gauge Network and the EA's own coast, real-time and unchecked, from about a year back                                                                        | Ordnance datum (AOD), or chart datum (CD) at four gauges                                                                        | [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)                                                                                                        |
| [SFWMD DBHYDRO](https://www.sfwmd.gov/science-data/dbhydro) (`sfwmd`)                                                | Stage at 43 tidal structure tailwaters, estuaries and bays in South Florida, 37 of them active, back to 1974 at the oldest                                                                                                    | NAVD88                                                                                                                          | Florida public records, [no license stated](https://www.sfwmd.gov/disclaimer)                                                                                                                                     |

[`stations.parquet`](https://water-levels.openwaters.io/stations.parquet) lists every station, and [`sources.json`](https://water-levels.openwaters.io/sources.json) gives each source's license and the attribution it asks for.

More European agencies come next, including DMI. [docs/plan.md](docs/plan.md) has the order. Data whose source doesn't let anyone republish it, such as IOC's sea level monitoring facility and parts of GESLA, isn't in the public data. Data a source does let anyone republish is there, with `commercial_use` false on each station whose terms bar commercial use.

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
stations/<source>.parquet                             one source's station list, as ingest keeps it
history/stations/<source>/                            each station refresh's previous list and report
```

A station whose source moved it to another datum reference has later files under an epoch number, such as `obs/<source>/<station>/2/<year>.parquet`; `stations.parquet` lists each station's epochs.

Station IDs are `<source>/<source_id>`, such as `rws/hoekvanholland`. [docs/data.md](docs/data.md) describes every column and has more example queries: finding stations by name or by distance from a point, converting between datums, comparing observed levels with the prediction, reading many files at once, and reading from Python.

The lake is new. It holds the station lists for every source and one year of observations, Hoek van Holland in 2024. Scheduled ingest refreshes `recent/` every hour and adds each day to the year files, and backfill of older years comes next.

An API at `api.openwaters.io/water-levels` is planned, with live levels for a station, and an archive series that can include Slackwater's prediction and the residual alongside the observations. [docs/api.md](docs/api.md) has the design.

## Not for navigation

Recent values are usually preliminary. Sources revise them later, and a gauge can fail without warning. Check the `flag` column, and don't rely on this data alone for navigation or safety.

## Also here

An implementation of the harmonic representation of inequalities (HRoI), the method BSH uses for German tide predictions, with an evaluation of it against a harmonic curve fit at German and Dutch gauges. See [docs/hroi-evaluation.md](docs/hroi-evaluation.md).

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) covers running ingest, the checks, and adding a source.

## License

The code is © Open Water Software, LLC and contributors, and licensed under [AGPL-3.0](LICENSE). Contributions need the [CLA](CLA.md), which you're asked to sign on your first pull request. The AGPL covers the code only, not the data.

The data is [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), credited to "Open Waters" and to each station's `attribution`, except the stations with `commercial_use` false, which keep their contributor's terms. That includes the copies in `test/fixtures/` and `docs/results/`. Each station's `license` names its source's license, which still applies to the source's values alongside CC BY: those in the table above are public domain, CC0, licenses and terms that allow reuse with credit, or, for SFWMD, public records published with no license, and their credit is part of `attribution`. Anything more a source asks for, such as a citation, is in `sources.json`. Some UHSLC contributors have terms stricter than UHSLC's, listed in [docs/uhslc-contributors.md](docs/uhslc-contributors.md); those whose terms bar passing the data on are being asked for permission.

A commercial user reads only the stations with `commercial_use` true. Series files carry no license column, so pick them by station ID from this list, and filter `recent/` files' rows on `station`:

```sql
SELECT id, name, attribution
FROM 'https://water-levels.openwaters.io/stations.parquet'
WHERE commercial_use;
```

Service terms for the hosted API and the public lake at `water-levels.openwaters.io` aren't published yet. They'll govern access to the service, such as rate limits, identifying your client and which uses need a plan, not what you do with the data, which keeps these licenses wherever it comes from. `docs/ticon-replacement.csv` and `.md` list [TICON-4](https://doi.org/10.17882/109129) records, under TICON-4's terms. BSH's data needs its source notice wherever it's shown, which for this repo's copies is: Datenquelle: Gezeitenvorausberechnungen ©, Bundesamt für Seeschifffahrt und Hydrographie.
