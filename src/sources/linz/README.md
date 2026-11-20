# LINZ (`linz`)

Sea levels from the tsunami gauge network of Toitū Te Whenua Land Information New Zealand (LINZ), read from its open download API at `https://sealevel-data.linz.govt.nz/`. The gauges are around New Zealand, the Chatham Islands and Raoul Island, and two are in Antarctica: Cape Roberts and Scott Base.

- **Stations:** each gauge is `linz/<CODE>`, with LINZ's four-letter code, and takes its name and position from its README on the API. Sumner closed on 1 April 2022, and New Brighton Pier replaced it. Scott Base's gauge was removed on 5 March 2026 because of iceberg activity, and its record ends there.
- **Levels:** above the sensor's tide gauge zero, one a minute. Cape Roberts has one every five minutes, and Scott Base had one every five minutes until February 2023.
- **Sensors:** each New Zealand gauge has two sensors, 40 and 41, each on a zero of its own. LINZ warns that they drift and advises caution for long-term analysis. At some gauges the two move apart by up to 1.5 m. The store reads sensor 40, and sensor 41 only where sensor 40 fails. The Antarctic gauges have one sensor.
- **Times:** Scott Base's files label NZST, and UTC+13 for most of a year from November 2023 (erratum `linz-scott-base-clock`). Both Antarctic clocks agree with UHSLC's Scott Base in the years they share. No independent record covers Scott Base after June 2017 or Cape Roberts' 2008 and 2009. There, the clocks and zeros rest on the tide against the other Antarctic gauge.
- **Datum:** `ZERO`, each sensor's tide gauge zero (TG0). `archive` is `previous`: each level is on the zero of its time, and a datum epoch opens where the data show a step. `datums.CD` is set where a README's calibration gives chart datum above TG0 and lists no sensor replaced since, and at Sumner, whose README gives chart datum against TG0. At six gauges the README gives chart datum only against a benchmark and points long-term users to a nearby reference gauge. Every other gauge has no `datums`.
- **Flags:** LINZ sends no quality flag, and its READMEs say the data aren't quality-controlled. A value from a day's file is `preliminary`. A value from a year's file, LINZ's final release, which replaces the day's files, is `good`, as is one from Scott Base's last file. Here `good` means final, not checked. A value LINZ marks bad, with a trailing `/`, is left out. A year with no year's file, such as Owenga's 2009 and 2010, Sumner's 2021 and 2022 and Cape Roberts' 2007, stays `preliminary`.
- **Freshness:** LINZ posts each day's file 6 to 12 days after the day, in batches, so no station is polled hourly. Values reach the store up to six weeks after they're measured. Cape Roberts has only year's files, which LINZ issues in the January or February after the year.

## Known limits

- **Sensor 41:** where it stands in for sensor 40, its level can differ from sensor 40's by up to 0.22 m, a step the rows don't mark.
- **Unscanned years:** years LINZ serves only as daily files, such as the current year, haven't been scanned for sensor faults.

## Running ingest

- **Requests:** LINZ publishes no rate limit and serves its files through a CDN. Requests start a second apart. A station refresh makes one request for the gauge list and one per gauge. Per gauge, year and sensor, `GET /api/listDatasetFiles/<CODE>/<year>/<sensor>` lists the zips under `/tidegauge/<CODE>/<year>/<sensor>/`: one per day (`WLGT_40_2026310.zip`, about 7 KB) and, once LINZ issues it in early January, one for the year (`WLGT_40_2025.zip`, about 2.3 MB). A year with a year's zip is read from it alone.
- **Caching:** listings and READMEs are never cached. A year's zip is cached once its year began four years ago. A day's file is never cached, since LINZ rewrites them without notice.
- **Empty listings:** a past year in a gauge's record with an empty listing fails the run rather than read as a year with no data. Cape Roberts' last year is the exception before May, since its year's file isn't out yet. After that, its empty listing fails the run until LINZ issues the file.
- **Missing days:** backfill replaces each month it fetches. LINZ lacks days at times, and a listing can't be checked for completeness, so a month whose listing omits a day loses the stored values for that day.

### Backfill

From nothing, through the Ingest workflow. `--with-inactive` takes Sumner's and Scott Base's closed records:

```bash
node scripts/ingest.ts backfill linz all 2007 2026 --skip-written --with-inactive
node scripts/ingest.ts backfill linz all 2026 2027 --with-inactive --shard 1/3
```

The past years are about 340 station-years, a listing and a 2.3 MB zip each: about 700 MB and 10 minutes. The current year is a request per day at each gauge, up to about 7,000 requests and 2 hours late in the year, so it runs in shards that each fit in one run: `--shard 2/3` and `3/3` follow.

### Scheduled runs

Monthly refreshes the list on the 2nd. Its refetch on the 9th runs the backfills in `schedule.refetch`, which `node scripts/schedule.ts refetch linz` prints: every open station from two months back, Cape Roberts' last year, and each station from its earliest preliminary value, which brings in a year's file once LINZ issues it. Late in the year the last of these takes about 2 hours.
