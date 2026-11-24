# South Florida Water Management District (`sfwmd`)

Stage at the District's tidal gauges in South Florida, from [DBHYDRO](https://www.sfwmd.gov/science-data/dbhydro), its hydrologic database, read through the API behind [DBHYDRO Insights](https://insightsdata.sfwmd.gov/).

- **Stations:** the SFWMD records TICON keeps, each `sfwmd/<DBHYDRO location>` (`sfwmd/S123_T`, and `sfwmd/GORDON_2_T` for `GORDON 2_T`). They are the tailwaters of the coastal structures on canals at tidewater (S-20F to S-44, G-54 to G-93 and others), G-58's headwater, estuary gauges on the Miami, Caloosahatchee, Cocohatchee, Gordon and Loxahatchee rivers, and three bay gauges in Barnes Sound and Florida Bay (MBTS, MDTS, TPTS). DBHYDRO has no tidal flag, so the adapter keeps the list.
- **Series:** each station joins two of DBHYDRO's stage series (dbkeys), both from the District's own gauges. The catalog's USGS series aren't read. The derived series (recorder `ONEP`) is DBHYDRO's reviewed record, joined from the gauge's earlier recorders, and usually reaches back furthest but ends some months back. The telemetry series (`TELE`) reaches to within minutes. Levels come from the derived series over its span and from telemetry before and after it: G-56's telemetry starts in 1985, six years before its derived series. The store replaces whole UTC months, so a month always comes from one series, and the two switch only at the start of a month.
- **Levels:** feet, converted to meters and rounded to the millimeter. Readings are breakpoints, irregular and from about 30 seconds to an hour apart, as DBHYDRO stores them, so `interval_s` is null in the list. `stations.parquet` gives the step the store measures ([the `interval_s` column](https://openwatersio.github.io/stillwell/docs/reference/stations/#column-interval_s)).
- **Times:** Eastern Standard Time all year, with no daylight saving: on 8 March 2026 readings run through 02:00 to 03:00, and on 1 November 2026 01:00 to 02:00 comes once. Against NOAA's Virginia Key (8723214), S-123's and S-155's tailwaters lag by the same amount in winter and summer, so the derived series has no daylight-saving hour back to 1982 at least. S-21A's 1975 shows no hour shift either. Earlier years aren't checked.
- **Datum:** NAVD88. Every request asks for it, and DBHYDRO converts each series by its own offset, NGVD29 series included, so the whole record comes in one datum and `archive` isn't set.
- **Flags:** `QUALITY_CODE` A (approved) is `good` and P (provisional) is `preliminary`. Each CSV opens with a notice that provisional data may be revised. Of the `CODE` column, which DBHYDRO doesn't document, M marks a missing reading and is skipped, and E marks an estimate, at best `interpolated`. V comes on ordinary approved readings in line with their neighbors and changes nothing. Any other code is `suspect`.
- **Freshness:** telemetry arrives within minutes and is read hourly. It's approved within days to months, and the derived series still holds provisional values more than a year back.
- **Independent checks:** the [pair check](../../../docs/contributing/checks.md#pair-check) on 19 pairs of an SFWMD structure (7 stations) and CO-OPS's or USGS's record at the same water, over the latest year both hold. 14 fit best at zero lag. The other 5 fit 10 to 30 minutes off at 1.0 to 3.3 cm RMS against 1.9 to 4.3 cm, which are two gauges along a canal: MBTS, MDTS and TPTS against USGS's Manatee Bay Creek, S155 against CO-OPS's Lake Worth, and VALI75 against CO-OPS's Fort Myers. The 2 CO-OPS pairs that share NAVD88 (MRMS4 and VALI75) differ from the offset between the datums by 2.6 and 1.8 cm, so DBHYDRO's NAVD88 conversion agrees with CO-OPS's.

## Known limits

- **Earlier recorders:** ones the derived series doesn't include are left out, such as S-197's chart recorder from 1970 to 1993.
- **Empty months:** a series that sends nothing for a month leaves the store's copy of that month as it was.

## Running ingest

- **API:** the adapter reads the JSON and CSV API behind DBHYDRO Insights, `https://insightsdata.api.sfwmd.gov/v1/insights-data`, which needs no key. The [Insights user's guide](https://www.sfwmd.gov/sites/default/files/documents/dbhydroinsightsuserdocumentation.pdf) documents its report URLs, but not the API itself. The documented [Hydro Data Service](https://www.sfwmd.gov/sites/default/files/documents/hydrodataservicedocumentation.pdf) serves the same data with a client ID, which datarequests@sfwmd.gov issues on request; it caps a response at 100,000 rows.
- **Station list:** it comes from DBHYDRO's series catalog, `POST /cont/ts`, which ignores any filter and returns all 35,000 series, about 40 MB of uncompressed JSON. Monthly reads it once. Latitude and longitude come packed as DDMMSS.sss, west positive. A station whose series is in any unit but `ft NAVD88` fails the refresh. Backfill asks for nothing outside a station's `record_start` and `record_end`. `stations.parquet` doesn't carry `series`, so a station read from there takes it from `source_url`, which names it.
- **Requests:** `GET /cont/data?timeseriesIds=<dbkey>&reportType=timeseries&format=csv&startDate=<YYYYMMDD>&endDate=<YYYYMMDD>&datum=NAVD88`, both dates inclusive EST days, one request per UTC calendar year, so a backfill's year is one request. `format=csv` returns a zip holding one CSV, about 0.8 MB a year at 115,000 rows, in about 20 seconds; the same year as JSON is about 40 MB. A range with no readings comes back as an empty zip, and a reading that isn't a number fails the request. DBHYDRO publishes no rate limit, so requests start a second apart.

### Backfill

Monthly refreshes SFWMD's list on the 2nd, and the poller and Compact daily skip SFWMD until its list is in the store, so a first run dispatches Monthly with `sources: sfwmd`. Then backfill through the Ingest workflow, active stations first and the inactive ones in a second run. Check the inactive list in the store after the refresh against the second command's:

```bash
node scripts/ingest.ts backfill sfwmd all 1974 2026 --skip-written
```

```bash
node scripts/ingest.ts backfill sfwmd HALDEMAN_T,MBTS,MDTS,S79_T,TPTS,WCOCO_T 1970 2026 --skip-written
```

That is about 1,400 station-years, at about 0.8 MB and 20 seconds a year, so about 1.1 GB and 8 hours, two Ingest runs with `--skip-written` resuming the second. The current year is fetched whole on every run; backfill it on its own with `backfill sfwmd all 2026 2027`.

### Scheduled runs

The poller fetches each active station's telemetry. Monthly's refetch on the 9th reads again from each station's earliest provisional value, back to the refetch's three-year cutoff: three years of each active station at 20 seconds a year, roughly 40 minutes.
