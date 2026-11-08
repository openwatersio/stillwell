# BSH tide predictions (`bsh`)

Predicted high and low waters and 10-minute curves for 172 German gauges from the [BSH tide service](https://gezeiten.bsh.de/), for the current year and, from about August, the next.

- **License:** free, including commercial use and publication, under Anlage 4 of BSH's [fee schedule for digital data](https://www.bsh.de/DE/Das_BSH/Gebuehren_Preise/Gebuehren_und_Preise/_Anlagen/Downloads/Entgeltverzeichnis-digitale-Daten.pdf). A year's predictions may be published online only from 1 August of the year before. The source notice is "Datenquelle: Gezeitenvorausberechnungen ©, Bundesamt für Seeschifffahrt und Hydrographie". See [slackwater-database#335](https://github.com/openwatersio/slackwater-database/issues/335).
- **Contact for errors:** gezeiten@bsh.de, the tide service's mailbox, given on [gezeiten.bsh.de](https://gezeiten.bsh.de/).
- **Stations:** the gauges in BSH's overview, with offsets from gauge zero (PNP) to NHN and to chart datum (SKN) from the latest year. Each year's file names its datum, PNP at most gauges and SKN at 10; a station's datum is the latest year's, and a backfill refuses a year in any other. Where BSH names a PEGELONLINE series for the gauge, `same_as` links to it; observed levels come from there.
- **Method:** high and low waters from the harmonic representation of inequalities, the curve between them from a mean observed tide curve. [docs/hroi-evaluation.md](../../../docs/hroi-evaluation.md) has more.
- **Times:** from each row's Julian date, which is UTC and finer than the minute-resolution local time beside it.
- **Extremes** carry BSH's lunar transit number and event index (1 high water after upper transit, 2 low water after upper, 3 high after lower, 4 low after lower).
