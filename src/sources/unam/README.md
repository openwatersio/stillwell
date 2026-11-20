# Servicio Mareográfico Nacional, UNAM (`unam`)

One-minute sea levels from each sensor at 26 of the 27 tide gauges of Mexico's Servicio Mareográfico Nacional (SMN), run by UNAM's Instituto de Geofísica, from the files behind its [station pages](https://www.mareografico.unam.mx/estaciones/). SMN serves only the last 5 days, so the store's record starts when the adapter started reading.

- **Stations:** a series for each sea-level sensor at each gauge, `unam/<number>-<sensor>`, with SMN's station number and GESLA's names for the sensors: `radar` for the averaged radar (`radar promedio`), `flotador` for the float gauge, `flotador-promedio` for its average, and `cbs` and `pls`, SMN's names for its other sensors. La Paz has `unam/14-radar` and `unam/14-flotador`. SMN publishes no positions, so they come from GESLA 4.1's records of the same gauges. Río Grijalva (40) has no position there or on SMN's site, so it's left out.
- **Levels:** one a minute, in meters above the sensor's zero, as SMN publishes them.
- **Sensors:** each sensor measures from its own zero, centimeters to meters apart from the others at its gauge. Manzanillo's radar reads 7.7 m where its CBS reads 2.7 m. So each sensor is a series of its own.
- **Times:** UTC, whatever the station's zone. SMN's chart axis says 「Hora UTC」. `clock-check` against TICON's records from UHSLC, which converts to UTC itself, finds no series off by an hour at La Paz, Mazatlán, Puerto Vallarta, Manzanillo, Acapulco's float, Salina Cruz and Veracruz, and Isla Mujeres fits its own TICON record. Four days of values resolve a lag only to 10 or 20 minutes. Puerto Morelos's tide is too small to check.
- **Datum:** `ZERO`, each sensor's zero, the name GESLA gives it. SMN publishes no datum or benchmark heights, only that levels are measured from 「un nivel de referencia fijo」 (a fixed reference level). A zero can still move: GESLA's copies of both Mazatlán sensors sit 0.5 to 2 m off their usual level for months of 2021 (erratum `gesla-datum-jumps`), and nothing in the adapter or QC detects a lasting shift like that.
- **Flags:** SMN flags and reviews nothing in these files, so every value is `preliminary`.
- **Freshness:** a sensor's values run about 15 minutes behind, and every station is polled hourly. Values from a gap in ingest that isn't backfilled within 5 days are lost.
- **Not used:** SMN's tide prediction (the files' `Pronostico` column), its weather files (`data-<number>_<unit>.csv` for temperature, pressure, wind and the sensors' battery and noise), and its historical records (TICON's `unam_hist`, back to 1946), which SMN sends only on request.

## Running ingest

- **Station list:** the stations come from the menu of a station page (`estaciones/?estacion=1`), which leaves out the page's own station, so that one comes from the page's heading. A new station without a position, a column the adapter doesn't know, or a page whose heading it can't read fails the list's refresh rather than be left out silently.
- **Files:** `estaciones/grdata/data-<number>_metros.csv`, rewritten every minute, about 300 KB: a header, `Tiempo,Pronostico,` then a column per sensor, and a line per minute for the last 5 days and a few hours, blank where a sensor has no value.
- **Reading files:** the adapter reads the header (the first 512 bytes), then the end of the file by a byte range big enough for the hours asked for, at most 80 bytes a minute, about 60 KB for the poller's 12 hours; the cut first line is skipped, and so is a last line without its newline, which the file's rewrite can leave cut mid-value. A station's sensors share both requests. A request that starts more than 5 days back is refused (see below).
- **Gaps:** the poller reads the last 12 hours, so after a longer gap, run the backfill below within 5 days of its start, or the values are lost for good. A whole file that starts more than 2 minutes after the hours asked for, as when SMN restarts its logger, is refused, and so is one that ends more than 30 minutes before them, as a read caught mid-rewrite can, so a fetch doesn't replace stored values with fewer. A station whose file can't be read fails the list's refresh, which keeps the list it had.
- **Limits:** SMN publishes no rate limit and has no robots.txt. Its pages refresh themselves every 5 minutes, so `min_interval_s` is 300. Requests start half a second apart.

### Backfill

There's no history to backfill: SMN serves 5 days. The adapter refuses a request that starts earlier, since backfill replaces every month it brings values for, and a year's backfill would replace a month the store holds with its last 5 days. To keep the days SMN serves, run one backfill over them through the Ingest workflow, from 4 days back to tomorrow, with the dates written out:

```bash
node scripts/ingest.ts backfill unam all <4 days ago> <tomorrow>
```

That's 26 stations, two requests each; 4 days' range is bigger than the file, so each answers with all of it, about 8 MB in all, in one run. A wider range, or `backfill unam preliminary`, is refused for every station.

### Scheduled runs

Monthly refreshes SMN's list on the 2nd, and the poller takes the stations from its next run.
