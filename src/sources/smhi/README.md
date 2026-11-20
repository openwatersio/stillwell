# Swedish Meteorological and Hydrological Institute (`smhi`)

Hourly sea levels at Swedish gauges from SMHI's [Open Data Oceanographic Observations API](https://opendata-download-ocobs.smhi.se/api), parameter 6 (`Havsvattenstånd`). [SMHI's notes on sea level](https://www.smhi.se/data/oceanografi/havsvattenstand) describe the data.

- **Stations:** each gauge is `smhi/<id>`, with SMHI's station id (`smhi/2545` for Arkö), the same id TICON's SMHI records carry (`arko-2545-swe-smhi`).
- **Parameters:** SMHI also publishes minute values in RH2000 (parameter 13), and hourly and minute values against each year's computed mean level (12 and 14). The store holds parameter 6 alone: one value an hour, measured on the hour, in one fixed datum. The mean-level series move their zero every year, and the minute series add nothing to a harmonic fit.
- **Levels:** to a tenth of a centimeter, or in whole centimeters at most gauges until the middle of 2004.
- **Times:** UTC. Against UHSLC's Smögen and Göteborg-Torshamnen and CMEMS's Kungsvik, each series fits best within 10 minutes of zero lag, and the weather in the levels rules out a 12-hour error. The west coast's tide is about 10 cm and the Baltic's a centimeter or two, too small to time a clock, so the check says little at the Baltic gauges.
- **Datum:** RH2000, Sweden's national height system, named in each CSV's notes (`Höjdsystem: RH2000`). SMHI gives the whole record in RH2000, its 19th-century years included, so the series show land uplift and sea-level rise directly. `datums` is empty, and `archive` is `current`.
- **Flags:** SMHI's G (checked and approved) is `good`. O (unchecked) and Y (roughly checked archive data, and each station's unchecked last two hours) are `preliminary`. SMHI documents no other codes, so any other is `suspect`. SMHI corrects its data every month and marks many values G within the hour, so a value from this calendar month or the last is at most `preliminary`. Much of the oldest data is O and stays `preliminary`: Kungsholmsfort's values from 1886 to 1919 are all O. A closed station whose values are all O, such as Landsort, never finalizes, and nothing marks it.
- **QC start:** at about 30 stations, most of them the Swedish Maritime Administration's, the CSV's notes say data before 1 July 2019 isn't quality-controlled and automatic checks run from then on ("Data före 2019-07-01 är ej kvalitetskontrollerad"). The store keeps that date as `source_qc_start`. SMHI's own stations state no date, and most are O to the end of 2009 and G from 1 January 2010. Where the notes give no date, the store infers one from the flags, with `source_qc_start_inferred` true: the first G after the station's last run of a month or more of other flags, where that run ended over a year ago. It stays null where that start leaves less than a year of values to judge it by, where more than 5% of the values since aren't G, or where the station has no such run.
- **Freshness:** SMHI adds each night's values to the archive and corrects it every month. Its latest values arrive in batches, at times more than an hour late, and the hourly refresh reads back 12 hours.

## Running ingest

- **Requests:** SMHI publishes no rate limit, so requests start a second apart. Each station's record comes from two periods: `corrected-archive`, one CSV with every value to midnight UTC today, and `latest-day`, the values since the previous UTC midnight. Both are read as CSV, since only the CSV names the datum. A range that starts at or after the previous UTC midnight reads `latest-day` alone, and any other reads the archive and adds `latest-day`'s later values. Backfill asks for nothing outside a station's `record_start` and `record_end`.
- **Sizes:** archives come gzipped. Arkö (2014 on) is 460 KB, 3 MB unzipped, and Kungsholmsfort (1886 on) is 4.7 MB, about 30 MB unzipped. A `latest-day` CSV is about 1.5 KB.
- **Caching:** nothing is cached on disk, since SMHI adds to the archive every night and corrects it every month. A process keeps the archives of the eight stations asked for most recently in memory, so a backfill fetches each station's archive once.
- **Short archives:** a range that runs past the archive's end is refused when the archive ends more than an hour before the previous UTC midnight, or, for a closed station, before its listed end, since backfill would delete the missing hours from the store. A closed station's last hours can be empty, as Landsort's are, so an archive whose own note reaches the listed end gets six hours' slack. A range that ends inside the archive is read as it is, so a silent gauge still backfills its past years.
- **Datum:** a CSV that names another system is refused, and one that names none fails, except a `latest-day` of a few hours, whose rows end before the notes reach the height system. A station SMHI moves to another system fails each request until the adapter handles it.
- **QC start:** backfill counts a year that ends by `source_qc_start` as done despite its O hours. `stations` reads the stated date from each active station's `latest-day`, and once from a closed station's archive, within a 15-minute budget. A failed read, or a `latest-day` too short to reach the note, leaves the station as it was. Notes that stop giving a date clear it with a warning. If SMHI rewords the note, `qcStartOf` needs the new wording. An inferred date is read from the archive once and kept as `inferred_qc_start` in the list's `extra`.

### Backfill

From nothing, dispatch Monthly with `sources: smhi` first, since Ingest hourly and Compact daily fail for SMHI until its list is in the store. Then backfill through the Ingest workflow. `--with-inactive` takes the closed stations:

```bash
node scripts/ingest.ts backfill smhi all 1886 2026 --skip-written --with-inactive
node scripts/ingest.ts backfill smhi all 2026 2027
```

The past years are about 2,700 station-years but one archive download per station, about 90 MB gzipped in all, and fit in one 6-hour run. `--skip-written` resumes one that stops. The current year runs on its own, since each run fetches it whole.

### Scheduled runs

Ingest hourly reads each active station's `latest-day`. Monthly refreshes the list on the 2nd, and its refetch on the 9th (`backfill smhi preliminary`) reads each station again from its earliest preliminary value, which brings in SMHI's corrections. Each refetch downloads that station's whole archive.
