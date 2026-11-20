# Marine Institute (`marine-institute`)

Sea levels every 5 minutes from the Irish National Tide Gauge Network, which the Marine Institute runs with harbor authorities and other partners around the coast of Ireland. They're read from the institute's [ERDDAP](https://erddap.marine.ie/erddap/tabledap/IrishNationalTideGaugeNetwork.html) dataset `IrishNationalTideGaugeNetwork`.

- **Stations:** each gauge is `marine-institute/<slug>`, a slug of the network's `station_id`, such as `malin-head-portmore-pier` for "Malin Head - Portmore Pier", which is kept as the name. That name is the dataset's only stable identifier, since its numeric `datasourceid` isn't documented, so a renamed gauge is a station of its own. Where a harbor has two gauges, the network lists them apart, such as "Galway Port" and "Galway Port 2", and so does the store. Positions are the dataset's. A gauge with no value for a year is inactive.
- **Not listed:** Arklow Harbour, Fenit and Roonagh Pier, which the dataset doesn't serve. The river gauges in Mayo, Dublin and Galway are in a separate dataset, `IrishNationalTideGaugeNetworkRiverGauges`, whose `Water_Level` names no datum and has no QC flag.
- **Levels:** from `Water_Level_OD_Malin`. Sampling starts at irregular minutes in the earliest years and settles on 5-minute marks.
- **Flags:** `QC_Flag` follows the SeaDataNet scheme, which the dataset documents as 0 unknown, 1 good and 9 missing. 1 is a value the institute has checked, `good`. 0 is one it hasn't, `preliminary`. 9 is dropped. Any other value is `suspect`, and none occur. The dataset documents no flag for bad values. The institute's checks are patchy and run years behind at some gauges, and some early stretches are unchecked.
- **Times:** UTC. Levels fit CMEMS's records of Ballyglass and Sligo and UHSLC's fast-delivery record of Castletownbere within a few minutes.
- **Datum:** `ODM`, Ordnance Datum Malin, the Irish geodetic datum, which every gauge reports. Most also report LAT, in `Water_Level_LAT`, but the second gauges at Galway, Howth and Union Hall don't. `datums.LAT` is the current LAT less OD Malin, rounded to the millimeter and read at the gauge's last value on each refresh, so it follows LAT's current definition (erratum `marine-institute-lat-2026`). Kinvara ("Kinvara - Unreferenced") gives values only in the OD Malin column, but the network says the gauge isn't tied to a benchmark, so its datum is `ZERO`.
- **Freshness:** values reach ERDDAP in batches, 10 to 30 minutes after they're measured, and the store reads them hourly. Values the institute checks later reach the store through the monthly refetch.

## Running ingest

- **Stations:** the adapter sends a station's `name` back to ERDDAP as `station_id`. Each station's `record_start` and `record_end` bound what a backfill asks for.
- **Limits:** ERDDAP publishes none. Requests start at least a second apart, a calendar year per request. A year of one gauge is about 4.5 MB, 560 KB compressed, and takes about 5 seconds (Dublin Port, 2023). A query with no matching rows answers 404 with "Your query produced no matching results" in the body, read as no values; any other 404, such as a renamed dataset, fails. Every gauge's first and last time in one query takes about 60 seconds and hits ERDDAP's gateway timeout, so the station refresh asks each gauge for its own (`orderByMinMax`, up to 7 seconds each), and backfill asks only for the years from a gauge's first day on, and to its last day for one that has stopped.
- **Cache:** the station list and its spans are never cached. A year's response is cached only when every value in it has QC flag 1 and they run to the year's last hour; any unchecked value, or a year still running, is fetched again.

### Backfill

A backfill is an Ingest run, started from Actions:

```bash
node scripts/ingest.ts backfill marine-institute all 2006 2026 --skip-written
```

That's about 300 station-years, each one request of about 5 seconds and 560 KB compressed (about 170 MB in all), so under half an hour: one run. The current year is fetched whole on every run, so it's backfilled on its own, `backfill marine-institute all 2026 2027`.

### Scheduled runs

The Marine Institute's nightly and monthly jobs run in Actions like every other source's, and the poller reads it hourly. Monthly refreshes the list on the 2nd. Its refetch on the 9th runs the default `schedule.refetch`, which `node scripts/schedule.ts refetch marine-institute` prints: each station from its earliest preliminary value, from January three years back to this month, which brings in values the institute has checked since.
