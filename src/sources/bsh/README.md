# BSH tide predictions (`bsh`)

Predicted high and low waters and 10-minute curves for German gauges (146 of BSH's 172 have heights) from the [BSH tide service](https://gezeiten.bsh.de/), for the current year and, from about August, the next.

- **License:** free, including commercial use and publication, under Anlage 4 of BSH's [fee schedule for digital data](https://www.bsh.de/DE/Das_BSH/Gebuehren_Preise/Gebuehren_und_Preise/_Anlagen/Downloads/Entgeltverzeichnis-digitale-Daten.pdf). A year's predictions may be published online only from 1 August of the year before. The source notice is "Datenquelle: Gezeitenvorausberechnungen ©, Bundesamt für Seeschifffahrt und Hydrographie". See [slackwater-database#335](https://github.com/openwatersio/slackwater-database/issues/335).
- **Contact for errors:** gezeiten@bsh.de, the tide service's mailbox, given on [gezeiten.bsh.de](https://gezeiten.bsh.de/).
- **Stations:** the gauges in BSH's overview, with offsets from gauge zero (PNP) to NHN and to chart datum (SKN) from the latest year. Each year's file names its datum, PNP at most gauges and SKN at 10; a station's datum is the latest year's, and the store holds no year in any other. Where BSH names a PEGELONLINE series for the gauge (103 of the 172), `same_as` links to it and observed levels come from there: Cuxhaven is `bsh/506P` for predictions and `pegelonline/5990020` for levels. `kind` is null: the overview gives only a name, number, position and an undocumented `gauge_group`, and only some names end in a water (", Elbe", ", Ostsee"). BSH predicts 26 of the gauges (in November 2026) only as high- and low-water times after a reference port's, with no heights and no curve ("Keine Gezeitenhöhen verfügbar"), so they have no rows in the store. BSH's per-year `has_height` and `has_curve` flags don't mark these gauges reliably.
- **Refresh:** the station list and the predictions refresh monthly, on the 2nd. Nothing is read hourly, since a year's predictions are published whole and not revised. Each month this year's predictions are fetched for every gauge, and from August to December next year's too, so a gauge added in the year, or a month whose run failed, is filled the next month. No year is fetched before 1 August of the year before, when BSH's terms let it be published.
- **Method:** high and low waters from the harmonic representation of inequalities, the curve between them from a mean observed tide curve.
- **Times:** from each row's Julian date, which is UTC and finer than the minute-resolution local time beside it. BSH's files run by German local time, so the last hour of each UTC year sits in the next year's file, and the store doesn't have it.
- **Observed levels:** a gauge's `first` and `last` describe observed levels, which come from PEGELONLINE, so they're null here.
- **Extremes** carry BSH's lunar transit number and event index (1 high water after upper transit, 2 low water after upper, 3 high after lower, 4 low after lower).

## Running ingest

- **Evaluation:** [the HRoI evaluation](../../../docs/hroi-evaluation.md) compares the method with tide gauges.

- **Refresh:** the Monthly workflow's BSH refresh fetches the station list on the 2nd, and the same job fetches the predictions: this year's for every gauge, and from August to December next year's too (`backfill bsh all <this year> <next year + 1>`). BSH `finalizes` nothing and has no live feed, so neither Ingest hourly nor the Monthly refetch reads it.
- **Publication date:** the adapter asks for no year before 1 August of the year before, whoever runs the backfill. A year BSH hasn't published yet answers 404 and writes nothing, and an unchanged year rewrites no file.
- **Datums:** a backfill refuses a year whose file names a datum other than the station's.
- **Gauges without heights:** a file whose `C02` line lists only times (`Zeiten : HW NW`) is read as having no heights, and any other header without a unit or datum still fails. Since BSH's `has_height` and `has_curve` flags aren't reliable, the adapter goes by the file.
