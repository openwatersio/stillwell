# Kartverket (`kartverket`)

Observed water levels from the permanent tide gauges of Kartverket, the Norwegian Mapping Authority's Hydrographic Service, on the Norwegian coast and Svalbard. They come from its [tide API](https://vannstand.kartverket.no/tideapi_en.html), documented in its [communication protocol](https://vannstand.kartverket.no/API%20for%20water%20level%20and%20tides%20-%20communication%20protocol_revJune2025.pdf).

- **Stations:** every gauge the API lists with type `PERM`, as `kartverket/<code>` with Kartverket's three-letter code in capitals (`kartverket/BGO` for Bergen). Ny-Ålesund is on Svalbard (`SJ`); the rest are in Norway (`NO`).
- **Levels:** one every 10 minutes, which the API calls "filtered 10 minute data". They come in centimeters to a tenth and are stored as meters, rounded to the millimeter. Bergen's 1990 values change by different amounts within each hour, so they aren't hourly readings interpolated linearly, though the API doesn't say how they were sampled.
- **Times:** UTC. Every timestamp carries `+00:00` and is read as the instant it names. A month at Bergen across the change to summer time runs every 10 minutes, with none missing or doubled. In 2015, against UHSLC's Vardø, Tregde and Ny-Ålesund and CMEMS's Bergen, each series fits best within 10 minutes of zero lag. Tregde's tide is a few centimeters, so weather dominates its series and the check says little there.
- **Datum:** chart datum (`CD`), the API's default and the only reference every station has. The API serves a station's whole record against its current chart datum, so `archive` is `current`. `datums` holds mean sea level (1996–2014) and NN2000 above chart datum, from the API's station levels (Bergen: `MSL` −0.952 m, `NN2000` −1.022 m); Ny-Ålesund has no NN2000. Chart datum is tidal, so Kartverket can redefine it, and the API would then serve the whole record against the new one. A move of more than a centimeter in chart datum's height in NN2000 opens or holds a datum epoch ([when an epoch opens](https://openwatersio.github.io/stillwell/docs/guides/datums/#when-an-epoch-opens)), so values against a new chart datum never land in the old epoch's files. A change at Ny-Ålesund goes unseen.
- **Flags:** the API marks every observation `obs` and carries no quality flag, and Kartverket doesn't mark which values it has quality-controlled, though it revises recent values. A value measured within the last 365 days is `preliminary` and an older one `good`. The year is the store's choice, not Kartverket's, and `good` here means a year old, not checked. Any other flag is `suspect`.
- **History:** from 1986 to 1992 at the long-running gauges, and later at newer ones. Older records, back to 1914 at Oslo and 1915 at Bergen, aren't in this API; Kartverket points to the Copernicus Marine Service for them.
- **Freshness:** values arrive 10 to 20 minutes after they're measured, and the store reads them hourly.

## Running ingest

- **Requests:** the API needs no registration. It documents capacity for about 20 requests a second, shared by all users, and asks not to be polled hard, so requests start at least a second apart. Levels come from `stationdata` with `datatype=obs`, `interval=10`, `tzone=0` and `dst=0`; without `tzone`, the API answers in UTC+1 all year. `fromtime` and `totime` are both inclusive and given to the minute, so the adapter drops the value at the range's end.
- **Sizes:** a year in one request works (a year of hourly values at Vardø took 5 seconds). A month of 10-minute values at Bergen is 320 KB and took 3.4 seconds, so a station-year is about 3.8 MB and roughly 30 to 40 seconds. Responses aren't compressed.
- **Errors:** a bad request answers 200 with an `<error>` element, which fails, and so does an outage of the API's backend, which answers 200 with a bare message such as `Connection refused (111)<br />` and no `<tide>` element, so a station keeps its daily files and counts as failed rather than stale. A range with no data answers an empty `<location>`.
- **Station refresh:** asks `obstime` for each station's first observation, kept as `record_start` so a backfill doesn't ask for years before it, and `stationlevels` for its datum offsets: two requests a station, about a minute in all. An empty list fails the refresh. A gauge whose first observation or offsets can't be read keeps the ones the store's list has, with a warning.
- **Datum checks:** between refreshes, each run asks every station's offsets once, the poller and backfill alike, and refuses a station whose chart datum has moved, so neither the poller nor Monthly's refetch can put the new datum's values in the old epoch's files. That's one more small request a station each hour. A moved datum throws `DatumChanged`, so the poller starts a refresh of Kartverket's list, at most once a day, which opens or holds the epoch; a rejected change matches its epoch and starts none. Offsets that can't be read, or a reply without NN2000, make the poller warn and stop a backfill. A backfill also refuses a station whose list has no NN2000 while the API gives one, until the next refresh reads it. A response in a reference other than chart datum fails each request until the adapter handles it, since the refresh can't open an epoch for it.
- **Cache:** the station list, `obstime` and `stationlevels` are never cached. A year's levels are cached only when the whole range is more than 365 days old and the response runs to its last 10 minutes.

### Backfill

From nothing, dispatch Monthly with `sources: kartverket` first, since the poller and Compact daily fail for Kartverket until its list is in the store, and the backfill needs each station's `record_start` from it. Then, through the Ingest workflow:

```bash
node scripts/ingest.ts backfill kartverket all 1986 2026 --skip-written --first docs/ticon-inventory.csv
node scripts/ingest.ts backfill kartverket all 2026 2027
```

The past years are about 880 station-years, one request each, about 3.3 GB. At 30 to 40 seconds a request and the default 4 stations at once, that's 2 to 3 hours, one 6-hour Ingest run, or two if the server slows under parallel requests. The current year runs on its own, since each run fetches it whole.

### Scheduled runs

The poller keeps the gauges current. Monthly refreshes the list on the 2nd, and its refetch on the 9th (`backfill kartverket preliminary`) reads each station again from its earliest preliminary value, so values pick up Kartverket's revisions until they turn a year old.
