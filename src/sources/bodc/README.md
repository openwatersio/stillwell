# BODC (`bodc`)

Quality-controlled sea levels every 15 minutes from the UK National Tide Gauge Network, which the Environment Agency owns and BODC processes as part of the National Tidal and Sea Level Facility. They come from BODC's [ERDDAP](https://erddap.bodc.ac.uk/erddap/index.html), a dataset per gauge titled "Processed values of sea level from tide gauge station …".

- **Stations:** each gauge is `bodc/<code>`, with BODC's port code, which starts its dataset's ID, such as `LER_ukcff_4109_001`. Names come from the dataset's title. Avonmouth, Felixstowe, Moray Firth and Port Ellen, which the network has had, have no dataset and aren't listed. Every gauge is listed active, since BODC's months arrive late rather than because a gauge stopped.
- **Levels:** meters, from the `ASLVBG02` channel. Each dataset holds every sensor's channel, up to 12, all labeled "unspecified datum", and marks none as the main one. `ASLVBG02` matches GESLA's copy of BODC's processed files within 1.5 mm at nearly every shared time, at all 24 gauges checked. Hinkley Point's levels come from its radar channel (erratum `bodc-hinkley-channel`).
- **Times:** UTC, rounded to the minute (erratum `bodc-erddap-times`). At 15 gauges, BODC's values and the EA's readings of the same gauges fall on the same quarter hours a constant apart, so neither clock is shifted against the other.
- **Datum:** `CD`, Admiralty Chart Datum, the datum of BODC's processed files. `datums.AOD` is chart datum's height relative to ordnance datum, from [NTSLF's table](https://ntslf.org/tides/datum): Ordnance Datum Newlyn in Great Britain, the local ordnance datum at Lerwick, Stornoway, St Mary's, Port Erin and St Helier, and Belfast's in Northern Ireland, as the EA's mAOD readings use. The EA's readings less BODC's equal the table to the centimeter at 15 gauges, and differ by 2 to 6 cm at Kinlochbervie, Lerwick and Cromer. Harwich and Portbury aren't in the table and have no offset.
- **Flags:** each value's qualifier, quoted as `''` or `'M'`. Blank is `good`, `M` (improbable) `suspect` and `T` (interpolated) `interpolated`. `N` (null) and missing values are dropped. Any other letter is `suspect`. An `M` value within a millimeter of 0 is `bad`, in both `flag` and `source_flag`: BODC writes 0 or −0.001 m every quarter hour where a gauge has no reading, as through Bournemouth's whole record, Fishguard's from 2023 and Portbury's but for 6 to 11 March 2024. A few real low waters that close to 0 and flagged `M`, as at Aberdeen in March 2025, are `bad` too. BODC marks whole months improbable at times, such as Lerwick's from November 2025 to February 2026, and nearly every value at Bangor, Barmouth, Bournemouth, Fishguard, Mumbles and Portbury.
- **Freshness:** BODC publishes each month weeks to months after it ends, and adds months, fills gaps and changes flags later still, so no station is polled hourly. Each month the store reads every station's last three calendar years again. ERDDAP holds less than BODC's processed files (erratum `bodc-erddap-gaps`).

## Running ingest

- **Limits:** ERDDAP publishes none. Requests start at least a second apart, a calendar year per request; a year of one gauge is about 35,000 rows. A query with no matching rows answers 404 with "Your query produced no matching results" in the body, read as no values; any other 404 fails. Nothing is cached, since BODC adds months to a year, and may fill its gaps, late.
- **Datasets:** since the number after the port code isn't documented, each fetch looks the dataset up by code from one `allDatasets` query of every dataset whose ID has `_ukcff_`, once a run. The refresh reports GESLA's links to the four gauges with no dataset as dropped.

### Backfill

From nothing, through the Ingest workflow, the finished years first, then the current year on its own, since end years are exclusive and a year still under way is fetched whole on every run:

```bash
node scripts/ingest.ts backfill bodc all 2022 2026
```

```bash
node scripts/ingest.ts backfill bodc all 2026 2027
```

That's about 40 gauges at up to five years each, about 200 requests, a few minutes.

### Scheduled runs

The Monthly workflow refreshes the list on the 2nd with every other source's. Compact daily skips the source until its list is in the store. BODC isn't hourly, so nothing else brings its new months: Monthly's refetch on the 9th reads every station's last three years again with `--refetch` (`backfill bodc all <two years ago> <next year> --refetch`), finished years included, so months that arrive up to two years late, filled gaps and changed flags all reach the store. `finalizes` is what puts BODC in the refetch. That's about 126 requests a month.
