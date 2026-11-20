# Japan Oceanographic Data Center (`jodc`)

Hourly tide levels from Japanese tide gauges that the Japan Coast Guard, the Geospatial Information Authority of Japan (GSI) and port authorities run, read from JODC's [tide data service](https://www.jodc.go.jp/vpage/tide.html). The Coast Guard's gauges include Syowa Station in Antarctica. JODC also serves the Japan Meteorological Agency's gauges and other products, such as tidal constants, which the store doesn't read here. The `jma` source reads JMA's gauges from JMA itself.

- **Stations:** every station in JODC's list, [`station_info.json`](https://www.jodc.go.jp/vpage/tide/station_info.json), except those whose codes start `MA`, which are JMA's. Each is `jodc/<code>`. The code gives the agency, which each station's credit names: `HD` for the Japan Coast Guard, `GS` for GSI, and four digits for a port authority. Names are JODC's English ones in title case. Two places can share a name: GSI's Kure (`GS13`, 久礼, in Kōchi) is 110 km from the Coast Guard's Kure (`HD13`, 呉, in Hiroshima). A station is active while its record reaches within two years of the newest of its agency's, since JODC adds each agency's years on its own.
- **Levels:** hourly, in centimeters above the station's zero of tide height ([format](https://www.jodc.go.jp/jodcweb/JDOSS/formatTide_j.html)). A few hours hold `999`, `9901`, `9990` or `9996`, as at several Coast Guard gauges in 2009. The store keeps them as levels, and QC flags them `suspect` or `bad`.
- **Times:** 「時刻は日本標準時（世界時 +9:00、但し昭和基地は世界時 +3:00)」: JST, UTC+9, but UTC+3 at Syowa Station (`HD50`). Naze (`HD22`) and Syowa Station match UHSLC's fast delivery, which UHSLC converts to UTC itself, at zero lag in 2010. Maizuru's Coast Guard gauge (`HD24`) matches JMA's record at the same port in 2005. Kure (`GS13` and `HD13`), Oshoro (`GS04`), Aburatsubo (`GS01`) and Moji's port gauge (`9010`) match their own TICON records in 2015. None of these is 12 hours off.
- **Datum:** `ZERO`, each station's zero of tide height, the name GESLA gives it. Each station's [attribute page](https://www.jodc.go.jp/TideAttrib/tide_attrib_8413_e.htm) gives it below the station's standard mark and T.P. `datums` is empty, since JODC doesn't say whether a zero moved during a record or whether earlier years were shifted to it.
- **Flags:** JODC sends no quality flag and publishes final values only, so every value's `source_flag` is `good`.
- **Freshness:** JODC adds each agency's new year in a batch, a year or more after it ends. A yearly backfill brings in the new year and any values JODC revised.

## Known limits

- **Summer time:** the clock checks start in 2005. Japan kept summer time from 1948 to 1951, and those years' files may be an hour off in summer.

## Running ingest

- **Withholding:** if JODC refuses permission, a `withheld` rule added to the adapter takes its stations out, and `ingest withhold jodc --accept-withheld` deletes their files, as for SANHO's. GESLA's copies of JODC's records would need a rule of their own.
- **Files:** one zip per station, `vpage/tide/<code>.zip`, 30 to 300 KB, with a text file per year, `<code>_<yyyy>.txt`. Each line is a local day: the code, the date as `yyyy/mm/dd`, then 24 levels for hours 0 to 23, comma-separated, `9999` where missing. A zip gains a year in place, so it's always fetched fresh rather than from the disk cache.
- **Year ends:** a year's file starts at local midnight, 9 hours (3 at Syowa) before the UTC year, so a UTC year's last hours come from the next year's file. The adapter reads every year's file, so it keeps those hours, which TICON's JODC records lose: their epochs end at 15:00 UTC on 31 December. A UTC year before the record's first file would get only those hours, so they're dropped (a year missing within the record keeps them), and a station's `record_start` is the first UTC year's start.
- **Caching:** a backfill asks for a year at a time, so the last 4 stations' records are kept in memory, one for each of backfill's workers, and each zip is usually read once a run. A worker slow to write can find its record evicted and fetch it again. A year outside a station's first and last years isn't asked for. A zip that fails, or holds a line the adapter can't read, fails all of that station's years in the run, rather than be asked for again for each one.
- **Limits:** JODC publishes no rate limit. Its robots.txt disallows `/cgi/` and others, not `/vpage/`. Requests start a second apart.

### Backfill

On a store with no JODC list, dispatch Monthly with `sources: jodc` first. Then backfill through the Ingest workflow. `all` takes active stations only, so the 16 inactive ones are named in a second run:

```bash
node scripts/ingest.ts backfill jodc all 1910 2027 --skip-written
```

```bash
node scripts/ingest.ts backfill jodc 0101,0138,3002,3003,8413,HD01,HD02,HD03,HD04,HD07,HD12,HD17,HD24,HD26,HD30,HD50 1910 2027 --skip-written
```

That's 126 zips, about 15 MB, at a second each, and about 4,700 station-years to write, so each run fits in one Ingest run.

### Scheduled runs

Monthly refreshes JODC's list on the 2nd. Nothing runs hourly, and since no value is preliminary, the Monthly refetch doesn't run either. Once JODC has added a year, dispatch Monthly with `sources: jodc` first, since a backfill asks for nothing past each station's last year in the store's list, then run it again over the last three years with `--refetch`, which also picks up values JODC revised. The refresh's change report lists any station the new list retires, and `all` takes active stations only, so name those in a second run like the one above:

```bash
node scripts/ingest.ts backfill jodc all 2023 2027 --refetch
```
