# Rijkswaterstaat (`rws`)

Observed water levels, observed high and low waters, and RWS's astronomical tide and its high and low waters, for about 680 Dutch locations, from the [Waterwebservices](https://rijkswaterstaatdata.nl/waterdata/) (DDAPI 2.0).

- **License:** CC0. Attribution "Rijkswaterstaat" is optional but carried.
- **Stations:** every catalog location with a `WATHTE` series against NAP. Products come from the catalog: `extremes` where the location has the `GETETM2` grouping, `predictions` and `predicted_extremes` where it has `GETETBRKD2`.
- **Levels:** 10-minute, integer centimeters, relative to NAP. Values above 10,000 cm are RWS's missing-value sentinels and are dropped.
- **Flags:** `Gecontroleerd` (checked) is `good` and `Ongecontroleerd` (unchecked) is `preliminary`. Quality code `00` is a normal value. We haven't found what code `25` means, so it and any other code are `suspect` until we do. The astronomical tide is always `good`.
- **Limits:** at most 160,000 values per request, so requests go a year at a time. Fair use, no uptime guarantee. An empty range comes back as an empty body.
- **History:** back to about 1990 at the tide gauges. Observed extremes for the latest year appear months later.
