# Coastwide Reference Monitoring System (`crms`)

Hourly water levels at the surface-water gauges of Louisiana's Coastwide Reference Monitoring System (CRMS), which the Coastal Protection and Restoration Authority (CPRA) runs with USGS. The adapter reads CPRA's weekly export of the whole record, `CRMS_Continuous_Hydrographic.zip`, the "CRMS Data Only" Continuous Hydrographic file on the [Coastal Information Management System's Full Table Exports page](https://cims.coastal.la.gov/FullTableExports.aspx). There's no per-station API: a web form emails a CSV per station.

- **Stations:** every hourly CRMS surface-water gauge in CIMS's [monitoring-stations layer](https://cimsgeo3.coastal.louisiana.gov/arcgis/rest/services/prot_rest/monitoring_stations/MapServer/0), `crms/CRMS<site>-H0<n>`, with the layer's position and status. CPRA numbers a gauge it moves at a site anew (`H01`, then `H02`), so a site can have an inactive series and an active one. A site's series follow one another, except CRMS3667's `H01` and `H02`, which overlap by seven months, 0.46 km apart. Left out: marsh wells (`W01`), which measure water in the marsh soil; floating-marsh sensors (`M01`, `M02`); `M100` series, which have no elevations; and `H0X` series, which CPRA's comments say "are the same as" another site's gauge.
- **Kind:** from the site's vegetation type in CIMS's [CRMS sites layer](https://cimsgeo3.coastal.louisiana.gov/arcgis/rest/services/prot_rest/crms_points/MapServer/0): `lake` at swamp sites, whose water sits still, and `estuary` at the marsh sites, fresh to saline.
- **Levels:** "Adjusted Water Elevation to Datum (ft)", corrected by CPRA for drift and fouling, rounded to the millimeter. The raw and adjusted "Water Level" columns are measured from the sensor and aren't comparable between stations. CPRA deletes outliers and values from unsurveyed sites by leaving the elevation empty, and those rows are dropped.
- **Times:** Central Standard Time all year (every row's `Time Zone` is `CST`), on the hour, though some stations' stamps fall 4 to 8 seconds past it and a few spans are 15- or 30-minute. Stamps are kept as CPRA gives them. CRMS0002 at Eden Isle, inside Lake Pontchartrain, lags NOAA's Shell Beach (8761305) on Lake Borgne, and Grand Isle (8761724) and Pilots Station East (8760922) by over 6 hours, as tide entering the lake through the Rigolets must.
- **Datum:** NAVD88, with the geoid model on each row. Every series moved from GEOID99 to GEOID12B at 2013-10-01 00:00 CST. Levels fall across the switch by much more than they move in other years, so it moved each gauge's reference, by an amount CPRA doesn't publish. `archive` is `previous`, and each station's `reference` is `GEOID12B` from 2013-10-01, so the GEOID99 years are an epoch of their own, with no conversion to the current one. No independent record checks either reference.
- **Flags:** the export has no quality column. A value is `suspect` when its row's `Comments` say the elevation isn't the water's: the water level 0.03 ft or less above the sensor ("Raw water level less than or equal to 0.03", where the elevation is the sensor's own), "low water" as a note of its own, the sonde out of the water, a day's median kept in place of its readings, readings moved to the top of the hour, or a sonde whose desiccant cap kept it from venting, which a pressure gauge's level depends on. Every other value is `good`, including one whose comment is about another measurement ("Drastic SpCond drop likely due to low water level") or only records a correction ("WL to Datum and WL to Marsh Adjusted +0.31 based on field observation"). CPRA re-adjusts recent months after field visits and marks no value preliminary, so the store reads every station's last three years again each month.
- **Freshness:** CPRA rebuilds the export every Sunday morning, and the store reads it once a month, so a value is as of the export its station's last refetch read. The export's newest values are a few months old.

## Known limits

- **Withdrawn months:** a month whose every elevation CPRA later withdraws stays in the store as it was, since a refetch replaces only the months it brings values for. A refetch that brings fewer values for a month replaces that month.

## Running ingest

- **Access:** `cims.coastal.la.gov/robots.txt` disallows all automated access. CPRA's CIMS team, asked whether a weekly download of the export was all right, pointed to the same page and file ([#49](https://github.com/openwatersio/stillwell/issues/49)). The export is downloaded in Actions only; the weekly canary reads only its last 64 KB and the CSV's first 64 KB, whose header it checks with the adapter's parser.
- **Station refresh:** a refresh reads the two CIMS layers, not the export. Some layer IDs end in a no-break space, which is trimmed.
- **Unknown labels and zones:** an elevation under any other `Sensor Environment` label but `Surface Water` or `Marsh Well` fails the run, so one such row stops every station's fetch until the adapter knows the label, as a row outside CST does.
- **Download:** the server answers byte ranges, at about 150 to 550 KB/s a connection. The adapter reads the central directory from the last 64 KB (the zip is under 4 GB, so it ends in the classic end record, and only the CSV's entry carries ZIP64 sizes), downloads the CSV's deflated bytes as 16 MB ranges, eight at once, to the response cache (`STILLWELL_CACHE`, under `crms/<crc>-<size>-v<format>/`, the format of the split files and the rules that read them), reads the tail again to check the export wasn't rebuilt meanwhile, checks the bytes against the zip's CRC, and splits the rows by station into files of their own in one pass. Every later fetch in the run reads its station's file. A run therefore downloads the export once, on its first fetch; expect 10 minutes to an hour, and about 2.5 GB of disk. A failed load fails every station of the run without downloading again, except that an export rebuilt during the download, or one that doesn't match its CRC, is downloaded once more. A row whose number of fields isn't the header's is counted in the log. An export with more than 100 such rows and more than 1% of all rows, or with no surface-water elevations at all, fails the run as a changed format, rather than leave every station empty. Old weeks' directories aren't removed, which matters only for a local cache.
- **Refetch:** the Monthly refetch reads every station in the list, inactive ones included (`--with-inactive`), since CIMS can retire a gauge before its last months reach the export.
- **Geoids:** a value against any other geoid for its time fails the fetch, so a later move, such as to GEOID18, stops ingest until the new geoid and its date are added to the adapter's check.

### Backfill

Dispatch Monthly with `sources: crms` to start the list, then backfill through the Ingest workflow. Each run downloads the export once, and `backfill … all` skips inactive stations, about 50 of which hold years of record, so the history is one run naming every station in the list, active or not, from 2006, both epochs, dispatched with `timeout` at 360 minutes. The IDs come from the list:

```bash
duckdb -noheader -list -c "CREATE SECRET (TYPE http, EXTRA_HTTP_HEADERS MAP {'User-Agent': 'openwaters-stillwell/1 (+https://github.com/openwatersio/stillwell)'}); select string_agg(source_id, ',' order by source_id) from 'https://stillwell.openwaters.io/stations/crms.parquet'" | tail -n 1
```

```bash
node scripts/ingest.ts backfill crms <those IDs> 2006 2026
```

Then the current year, after the next Sunday's export, so the store reads one export a week:

```bash
node scripts/ingest.ts backfill crms all 2026 2027
```

From then on, Monthly's refetch on the 9th reads every station's last three years from that month's export.
