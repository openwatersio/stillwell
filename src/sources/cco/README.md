# Channel Coastal Observatory (`cco`)

Tide levels every 10 minutes from the gauges of the National Network of Regional Coastal Monitoring Programmes for England and Wales, read from the Channel Coastal Observatory's [real-time API](https://www.coastalmonitoring.org/ccoresources/api/).

- **Stations:** each gauge is `cco/<id>`, with the observatory's site number. The API also lists other providers' gauges, such as the National Tidal and Sea Level Facility's, with no readings, and the store leaves them out. A station is active while its latest reading, with or without a value, is under a year old. Teignmouth Pier, which ended in 2014, isn't listed.
- **Levels:** one every 10 minutes. Brighton's are 5 minutes apart until 2016 and Scarborough's until 2010, with stretches of one a minute in Scarborough's 2006. Arun Platform's 2019 has one a minute. Brighton has no readings in 2017. Port Isaac's last readings have no value and flag 9.
- **Times:** UTC. Whitby Harbour's levels fit best against BODC's Whitby, an independent gauge 150 m away, at zero lag. TICON's records of Herne Bay and Penarth also fit at zero lag, but TICON fitted them to CCO's own series, so they show only that the clock hasn't changed. The other gauges have no independent clock check.
- **Datum:** `CD`, Admiralty Chart Datum. The [tide QC manual](https://www.coastalmonitoring.org/ccoresources/dataqualitycontrol/TideQCManual_v1.0.pdf) measures from Ordnance Datum Newlyn and adds the Admiralty Tide Tables' offset. The store has no offset to Ordnance Datum Newlyn, so `datums` is empty. Whitby Harbour's levels agree with BODC's Whitby, in Admiralty Chart Datum, to about 0.13 m. The other gauges have no other originator's gauge to compare with. Their levels stay positive through the tide, as heights above chart datum do and heights above Ordnance Datum Newlyn, which centers on zero, don't.
- **Flags:** the observatory's monthly check flags readings in arrears, on the IOC's scheme (the manual's table 1). 1 and 5 are `good`, 2 is `interpolated`, 4, 8 and 9 are `bad`, and 3, 6, 7 and any other code are `suspect`. 0 and a blank flag are `preliminary`, since the API page says an empty flag doesn't mean the value passed. The newest month has no flags. CCO is importing its quality-controlled archive, so a gauge has stretches of years where 90 to 100 percent of readings are flagged 1 and stretches with none.
- **Freshness:** each site's last 12 hours are read every hour.

## Known limits

- **First days:** the store lacks up to a day at the start of Brighton's and Lymington's records (erratum `cco-empty-window-answers`).
- **Older flags:** flags the observatory adds to years more than 12 months back reach the store only when those years are read again, so much of the archive stays `preliminary`.
- **West Bay Harbour:** CMEMS's copy is 0.094 m lower than CCO's from mid-September 2024 to mid-November 2025, so one of the two has a step there, and no independent record shows which.
- **Removed values:** where the check removes a reading's value, a refetch of that month drops the stored reading. A month with no values left keeps what the store held.

## Running ingest

- **Key:** every request needs a key tied to a domain. Ours is for `https://stillwell.openwaters.io/`, and the API answers 403 unless the request's `Referer` is that domain or a subdomain. The adapter sends the key as `X-API-Key` and the domain as `Referer`, from `CCO_API_KEY` and `CCO_REFERER`, and refuses to run without both. The server's jobs read them from `/etc/stillwell.env`. The workflows pass the repository secrets of the same names, for the canary and for a move back to Actions.
- **Limits:** the observatory asks for one request at a time, caching, and no request more often than the data is recorded, and may limit or switch off a key without notice. It publishes no rate. The adapter sends one request at a time, however many stations a run reads, each starting a second after the last. A timeout or a 5xx is sent again, up to four times in all. The poller asks each site once an hour (`poller: "hourly"`), the one request per site an hour that Stillwell told the observatory to expect.
- **Requests:** `GET /observations/tides/latest.geojson` lists every site with its latest reading. `GET /observations/tides/<YYYYMMDDhhmmss>.geojson?sensor=<id>&duration=<hours>` answers with every reading from `duration` hours before the time up to it, both ends included, newest first. A request covers up to 168 hours for all sites or 8,760 for one. The adapter asks a year at a time, from the end back, each request starting one reading inside the last. A year of one site is about 50,000 readings and takes from seconds to several minutes, so a request of more than a day waits up to 15 minutes. Values and flags arrive as text, such as `"3.88300"`, and times as `YYYYMMDD#hhmmss`.

### Backfill

A backfill is a job on [the server's queue](../../../docs/plans/jobs.md#the-queue), queued on the box. On a store with no CCO list, `stillwell-jobs enqueue stations cco --no-publish` runs first. The years before 2009 run by name, and Brighton's and Lymington's first years start the day after their first reading (erratum `cco-empty-window-answers`). A full backfill is about 11 million rows and takes about an hour:

```bash
stillwell-jobs enqueue backfill cco 86,89,90,92,93,95,111 2005 2009 --skip-written --concurrency 1
stillwell-jobs enqueue backfill cco 88 2006-02-12 2009 --skip-written --concurrency 1
stillwell-jobs enqueue backfill cco 87 2009-02-13 2010 --skip-written --concurrency 1
stillwell-jobs enqueue backfill cco all 2009 2027 --skip-written --with-inactive --concurrency 1
```

Most years hold preliminary readings, so they count as unfinished, and `--skip-written` keeps a run that stops partway from starting over. After the last run, `stillwell-jobs enqueue compact cco --rebuild-bounds` updates the store's bounds, and Compact daily's publish picks them up that night.

### Scheduled runs

CCO is on the server's job queue ([src/sources/server.json](../server.json)), which runs its hourly, nightly and monthly jobs at Actions' times. Monthly refreshes the list on the 2nd. Its refetch on the 9th runs `schedule.refetch`, which `node scripts/schedule.ts refetch cco` prints: every active station from 12 months back to this month, with `--refetch`, since a month's flags arrive within weeks. To bring in flags on older years, run the backfills again without `--skip-written`.
