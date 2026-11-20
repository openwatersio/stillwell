# BSH tide predictions (`bsh`)

Predicted high and low waters and 10-minute curves for German gauges, from the [BSH tide service](https://gezeiten.bsh.de/), for the current year and, from August, the next.

- **Stations:** the gauges in BSH's overview. `kind` is null: the overview gives only a name, number, position and an undocumented `gauge_group`, and only some names end in a water (", Elbe", ", Ostsee"). A gauge's `first` and `last` describe observed levels, so they're null here.
- **Method:** high and low waters from the harmonic representation of inequalities, the curve between them from a mean observed tide curve. [The HRoI evaluation](../../../docs/hroi-evaluation.md) tests the method against observed levels at Dutch gauges. No check compares BSH's predictions with observed levels at its own gauges.
- **Extremes:** each carries BSH's lunar transit number and event index (1 high water after upper transit, 2 low water after upper, 3 high after lower, 4 low after lower).
- **Times:** from each row's Julian date, which is UTC and finer than the minute-resolution local time beside it.
- **Datum:** each year's file names its datum, PNP (gauge zero) at most gauges and SKN (chart datum) at about 10. A station's datum is the latest year's, and the store holds no year in any other. `datums` gives the offsets to NHN and to the other of PNP and SKN, from the same year, where BSH gives them.
- **Flags:** BSH publishes predictions only, so every value is `good`.
- **Freshness:** BSH publishes a year's predictions whole and doesn't revise them, so nothing is read hourly. The store reads them monthly.

## Known limits

- **Times only:** BSH predicts about 25 gauges only as high- and low-water times after a reference port's, with no heights and no curve ("Keine Gezeitenhöhen verfügbar"), so they have no rows in the store.
- **Year's end:** BSH's files run by German local time, so the last hour of each UTC year sits in the next year's file, and the store doesn't have it.

## Running ingest

- **Refresh:** the Monthly workflow's BSH refresh fetches the station list on the 2nd, and the same job fetches the predictions: this year's for every gauge, and from August to December next year's too (`backfill bsh all <this year> <next year + 1>`). A gauge added in the year, or a month whose run failed, is filled the next month. BSH `finalizes` nothing and has no live feed, so neither Ingest hourly nor the Monthly refetch reads it.
- **Publication date:** the adapter asks for no year before 1 August of the year before, whoever runs the backfill. A year BSH hasn't published yet answers 404 and writes nothing, and an unchanged year rewrites no file.
- **Datums:** a backfill refuses a year whose file names a datum other than the station's.
- **Gauges without heights:** a file whose `C02` line lists only times (`Zeiten : HW NW`) is read as having no heights, and any other header without a unit or datum still fails. BSH's per-year `has_height` and `has_curve` flags don't mark these gauges reliably, so the adapter goes by the file.
