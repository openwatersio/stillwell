# Channel Coastal Observatory (`cco`)

Tide levels every 10 minutes at the gauges of the National Network of Regional Coastal Monitoring Programmes for England and Wales, from the Channel Coastal Observatory's [real-time API](https://www.coastalmonitoring.org/ccoresources/api/).

**This adapter is written against the API page, not against a live response.** Every request needs a key, and Open Waters has none yet, so the fixtures follow the page's field list with made-up site numbers, and the adapter has never run against the service. The list under [Needs a key](#needs-a-key) is what a first run has to confirm.

- **License:** [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/), which the API page names. GESLA's paper links version 2. Both allow republishing and commercial use with attribution, so every station goes to the public store with `commercial_use`. The page asks pages showing real-time data to credit "National Network of Regional Coastal Monitoring Programmes" and to say the data are not quality-controlled in real time, which the attribution says, since the API passes only that field on. The key's terms bar sharing it, and tie it to a domain; the page says a server-side script sets that domain as its `Referer` itself.
- **Contact for errors:** the observatory's [feedback form](https://www.coastalmonitoring.org/contact_us) or cco@channelcoast.org, the contact the API page gives.
- **Key:** requests carry `X-API-Key` and a `Referer` on the domain the key was issued for, from `CCO_API_KEY` and `CCO_REFERER`. The adapter refuses to run without both. The key stays out of the URL, so logs and cache keys don't hold it. The Ingest, Ingest hourly, Monthly and Canary workflows pass both as secrets, and the canary is skipped without them. The poller reads them from `/etc/stillwell.env`.
- **Stations:** `GET /observations/tides/latest.geojson` answers with every site, in alphabetical order, as a GeoJSON feature with `id`, `sensor` (the name), `date` and a point position. A site whose `id` is a link to its provider's page has no readings and is left out. A station is `cco/<id>`, active and live while its latest reading is under a year old; it throws when no site has a readable date or a position isn't around Great Britain (latitude 49 to 61, longitude −9 to 3). Every station is `coastal`, `GB`, and a GESLA record of the gauge goes in `same_as` by name (`GESLA` in [`index.ts`](index.ts)): the 15 records the store has no originator series for. Whitby Harbour's is left out: TICON and CMEMS keep that gauge apart from the EA's and BODC's Whitby, so its link waits for a check of CCO's position. A name CCO spells differently gets no link.
- **Datum:** `CD`, chart datum: tide `value` is meters above Chart Datum. The tide QC manual measures from Ordnance Datum Newlyn and adds the Admiralty Tide Tables' offset, so there are no `datums` yet.
- **Levels:** `GET /observations/tides/<YYYYMMDDhhmmss>.geojson?sensor=<id>&duration=<hours>` answers with the readings in the hours before the time, up to 8,760 hours (a year) for one site, so the adapter asks a year at a time, from the end back, with a second between requests, each starting one reading inside the last so an edge the API leaves out isn't lost. An answer whose features carry none of the site's id, or a date or value it can't read, fails the request rather than read as no values. Times are UTC, written `YYYYMMDD#hhmmss`; one that isn't a real time fails the request. A `value` of null or 9999 is not stored.
- **Flags:** `QCflag` is empty until the monthly check, and an empty flag doesn't mean the value passed, so a reading with none is `preliminary`. The check's flags follow the IOC's scheme ([tide QC manual](https://www.coastalmonitoring.org/ccoresources/dataqualitycontrol/TideQCManual_v1.0.pdf), table 1): 1 and 5 good, 2 interpolated, 4, 8 and 9 bad, and 3, 6, 7 and any other code suspect. Whether the API sends the code as a number or text isn't known; both read the same. 0 (no check) and a blank flag are `preliminary`. Monthly's refetch (`finalizes`) runs `backfill cco preliminary`, which reads again from the earliest reading still `preliminary`, so flags the check adds reach readings the store holds as preliminary. A reading the check marks missing (9) with its value still sent is bad, so a refetch replaces the preliminary one the store holds; one sent with a null value is dropped, and the store keeps the value it had.
- **Limits:** none published. The page asks clients to request no more often than the data is recorded (every 10 minutes for tides), to use `duration` for a wider window, and says the observatory may limit or disable a key without notice.

## Needs a key

Nothing below has been checked against the service:

- the station list, and whether `tides/latest` lists every tide gauge, including those that stopped (Teignmouth Pier ended in 2014);
- each site's name as the API spells it, for the GESLA links, and Whitby Harbour's position against the EA's and BODC's Whitby gauges, which would add its link (the other 14 have no EA or BODC gauge within 7 km);
- how far back each site goes, and whether a year-long request returns the full 10-minute history;
- whether a request for a time and duration answers with one feature per reading, and what `QCflag` holds;
- the license version and the credit line, with the observatory;
- that the observatory allows one key to be used from GitHub Actions and the poller's server, all sending the issued domain as `Referer`, and that the Actions runs and the poller (every 10 minutes) asking for the same readings stays within what it expects;
- the `latest` feed's `date` as a gauge's last reading, which decides `active` and `live`;
- whether `duration` includes the reading exactly at the earlier end, and the datum's name: the adapter treats `CD` as Admiralty Chart Datum, like BODC's and the EA's.

## Backfill

Once the key is in place, the Monthly workflow refreshes the list on the 2nd. Then backfill each year back to the earliest reading the API has:

```bash
node scripts/ingest.ts backfill cco all 2010 2027
```
