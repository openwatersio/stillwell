# California Data Exchange Center (`cdec`)

River stage every 15 minutes at tidal gauges in the Sacramento–San Joaquin Delta, Suisun Bay and the Petaluma River, from the [California Data Exchange Center](https://cdec.water.ca.gov/) (CDEC), which the Department of Water Resources (DWR) runs.

- **Stations:** the 60 CDEC codes that TICON's `cdwr` records carry (`CODES`), each named and placed from its CDEC metadata page. A station whose operator includes USGS is left out, as is one with no 15-minute stage: the Corps of Engineers' two (RYE, SKT) and three with only hourly stage that ended by 2002 (BRY, OLR, VNE). A station is inactive once its 15-minute stage has an end date. Many stations belong to other agencies, such as the U.S. Bureau of Reclamation and the City of Petaluma, and each station credits the operator CDEC names.
- **Levels:** river stage, sensor 1, at CDEC's 15-minute ("event") duration. Most stations report every 15 minutes. Petaluma (PTB) reports about every 9, so its `interval_s` is null in the list and `stations.parquet` gives the step the store measures ([the `interval_s` column](https://openwatersio.github.io/stillwell/docs/reference/stations/#column-interval_s)). The hourly duration, which reaches back to 1987 at a few DWR stations, isn't read, since before 2006 it's in other datums. Neither is the "RIVER STAGE NAVD88" sensor (141) some pages list, which covers a few months at most. Feet are converted to meters and rounded to the millimeter.
- **Times:** Pacific local time with daylight saving, though CDEC's pages say PST. Every spring-forward day checked lacks its 02:00 hour, and in summer Fisherman's Cut (FCT) reads an hour later than in DWR's Water Data Library, which is PST all year. On the day daylight saving ends, CDEC sends the repeated hour once, as standard time. Its switch to standard time comes at 00:45 in some years and 01:00 in others, so readings from 00:45 to 01:00 that day are dropped.
- **Datum:** from the gauge-zero table on each station's page. A zero of 0.0 ft in a named datum puts the stage in that datum, such as `NAVD88`. Any other zero puts it above the gauge's own zero, `GZ`, with the zero's elevation in `datums`: Sacramento River above the Delta Cross Channel (SDC) is 5.0 ft NGVD 29, so `GZ` with an NGVD29 offset of 1.524 m. A station with no table takes a datum its notes give, such as Beldon Landing's (BDL) NAVD88, and otherwise `GZ`. A page that changes its datum, or moves its gauge zero under the same label, opens a datum epoch at that refresh, or holds it for a decision when it goes back to an earlier one ([epoch states](https://openwatersio.github.io/stillwell/docs/guides/datums/#epoch-states)). Four stations moved to NAVD88 partway through their record, by their notes: Georgiana Slough (GSS) and Sutter Slough (SUT) were on an arbitrary datum until 1 October 2005, and Mallard Island (MAL) and Martinez (MRZ) on NGVD29 until 1 October 2006. Nothing before those dates is read, so each station's files hold one datum.
- **Flags:** CDEC's flag column is blank throughout and it marks nothing reviewed, so every value is `preliminary`. CDEC's pages say its data is "preliminary and subject to revision". DWR's reviewed record of its own stations is the Water Data Library.
- **Freshness:** readings reach CDEC within the hour.

## Known limits

- **Datum changes:** the list refreshes monthly and CDEC's data carries no datum, so values from between a datum change and the next refresh land in the old epoch's files.
- **Revisions:** CDEC may revise any reading, but nothing reads a reading again after Ingest hourly's window. A later correction reaches the store only through a manual backfill.

## Running ingest

- **Station pages:** each refresh reads every station's metadata page (`staMeta?station_id=<code>`), about 70 KB each. A station can list several 15-minute rows, one per way its data came in, and they're merged: the earliest start, and current if any is. A page without its sensor table, or with a stage row the adapter can't read, fails the refresh rather than drop the station as having no stage. That holds for the stations the last list had, as does a page that no longer shows a listed station's 15-minute stage; a bad page for a code the last list left out, one USGS runs or with no 15-minute stage, only warns. A backfill asks for nothing outside a station's `record_start` and `record_end`.
- **Datums:** a gauge-zero table naming any other datum than NAVD 88 or NGVD 29, such as MSL, fails the refresh. A listed station whose page loses its gauge-zero table is reported with no datum (`datum: null`), which keeps the datum it was listed with, and a warning. `NAVD88_SINCE` applies also to a station read from `stations.parquet`.
- **Requests:** `CSVDataServlet?Stations=<code>&SensorNums=1&dur_code=E&Start=<date>&End=<date>`, a calendar year a request, about 2 MB. `End` runs only to the start of its day, so each request asks to the day after. A range with no readings, or a code CDEC doesn't know, still answers the CSV header, so an empty reply fails rather than read as no data.
- **Limits:** none published, so requests start half a second apart. CDEC may revise any reading, so nothing is cached on disk.

### Backfill

Monthly refreshes CDEC's list on the 2nd. A full backfill goes through the Ingest workflow, active stations first and the six inactive ones in a second run:

```bash
node scripts/ingest.ts backfill cdec all 1998 2026 --skip-written
```

```bash
node scripts/ingest.ts backfill cdec BLL,LIB,M13,MRW,ROR,SUC 2009 2026 --skip-written
```

That's about 650 station-years at about 2 MB each, roughly 1.3 GB and 650 requests, which fits in one Ingest run. The current year is backfilled on its own, `backfill cdec all 2026 2027`. Ingest hourly keeps the active stations current.
