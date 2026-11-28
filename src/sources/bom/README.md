# Bureau of Meteorology, National Tidal Centre (`bom`)

Hourly sea levels from the gauges that the Bureau of Meteorology's National Tidal Centre runs, read from the yearly archives on BOM's anonymous FTP server, `ftp://ftp.bom.gov.au/anon/home/ntc/pacific/uhslc/`. The gauges are those of the Australian Baseline Sea Level Monitoring Array (ABSLMP) and the Pacific Sea Level and Geodetic Monitoring Project (SPSLCMP), plus Suva in Fiji and Christmas Island.

- **Stations:** each gauge is `bom/<number>`, the number in its file's name, `h<number>.dat`. The ABSLMP gauges numbered 956 to 959 and 992 to 997 carry BOM's own numbers, and the rest carry UHSLC's. Positions come from BOM's records of the gauges in GESLA, and UHSLC's for Alofi, since the files give them only to the minute.
- **Not listed:** the archives also carry gauges BOM relays for their owners: Fremantle (Western Australia's Department of Transport), Brisbane Bar, Bundaberg and Townsville (Queensland's Department of Transport and Main Roads), Fort Denison (Manly Hydraulics Laboratory) and Booby Island. The ABSLMP's Thursday Island gauge has no file in the archives.
- **Levels:** one an hour, in BOM's copy of UHSLC's hourly format. A year's file can end before December 31, as Thevenard's 2019 file ends in May, and is read as far as it goes.
- **Times:** UTC, as the files' `TIMEZONE=GMT` says. Levels match UHSLC's fast-delivery series of the same gauges hour for hour, with no lag, except where an erratum of BOM's or UHSLC's says otherwise.
- **Datum:** `TGZ`, each gauge's tide gauge zero. The files don't name their zero. `datums.AHD` comes from the list beside the files, `readme.txt` (2015), at the 11 gauges where it gives one value and the gauge's mean level sits 0.10 to 0.26 m above it. It is left out at Broome (erratum `bom-broome-ahd`), at Darwin, for which the list gives two values, at Port Stanvac, whose value the list marks uncertain, and at the gauges the list has no value for. No independent reference checks the list's values: BOM's station sheets on its website aren't reachable by script.
- **Flags:** the files have none. A value from the year under way is `preliminary`, as are the two years before it until April, since BOM rebuilds a year's archive in the next year's first weeks and again a year later. Every other value is `good`, which here means final, not checked, except where an erratum flags it. That an archive is final after its rebuilds is an assumption.
- **Freshness:** BOM rewrites the current year's archive about monthly, weeks behind, so no station is polled hourly. BOM's real-time displays aren't served as files.

## Known limits

- **Missing years:** BOM has no archives for 1997 to 2004. The archives for 2015 to 2018 hold only Alofi's file, so the other gauges have no values for those years. Suva starts in 2005, and Christmas Island covers only 2007 to 2011.
- **Christmas Island:** UHSLC's copy differs from BOM's from August 2009 to the end of BOM's file, and no record in the store shows which is right ([`bom-christmas-island-2009-offset`](errata.ts)).
- **Stony Point:** the files for 2005 to 2014 are 0.090 m below the gauge's zero in its other years, so the adapter adds 0.090 m to them ([`bom-stony-point-2005-2014-zero`](errata.ts)); BOM's own monthly statistics of the gauge agree with the correction, and no record from another agency covers it. 28 October to 1 December 2007 is flagged `suspect` ([`bom-stony-point-november-2007-timing`](errata.ts)).
- **Majuro:** BOM's files for 2005 to 2008 are flagged `suspect` ([`bom-majuro-2005-2008-values`](errata.ts)).

## Running ingest

- **Requests:** BOM states no rate limit for its FTP server. The adapter asks for one archive at a time, a second apart, each on its own passive connection. An archive, `<year>.ar`, holds every gauge's file for the year, so a run asks for each year once.
- **Missing archives:** a 550 for 1997 to 2004, or for a year with no archive yet, reads as no values. A 550 for any other year fails the run.
- **Not read:** the `h<number>.dat` files beside the archives, which repeat the current year's members; the `IDO7…SLD.txt` monthly statistics; and `jasl/`, which is UHSLC's JASL archive, a copy of UHSLC's data. The ABSLMP CSVs and the Pacific project's files on BOM's website are behind bot protection, which the adapter doesn't try to get around.

### Backfill

From nothing, through the Ingest workflow. `--with-inactive` takes Port Stanvac's and Christmas Island's closed records:

```bash
node scripts/ingest.ts backfill bom all 1996 2027 --skip-written --with-inactive
```

The run makes about 30 requests and writes about 500 station-years.

### Scheduled runs

Monthly refreshes the list on the 2nd. Its refetch runs the backfill in `schedule.refetch`, which `node scripts/schedule.ts refetch bom` prints: every active gauge from the year before last on, with `--refetch`. A rebuild of an older archive is read with `backfill bom all <year> <next year> --refetch`.
