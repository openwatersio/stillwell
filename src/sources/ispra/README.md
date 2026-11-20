# ISPRA (`ispra`)

Sea levels from the Rete Mareografica Nazionale (RMN), Italy's national tide gauge network, run by ISPRA, the Istituto Superiore per la Protezione e la Ricerca Ambientale. The store reads the monthly CSV files in ISPRA's [open data repository](https://rep.isprambiente.it/), which its [RDF dump](https://rep.isprambiente.it/downloads/lod/rdf/rmn/kg/rmn_dump.nt.gz) lists.

- **Stations:** every gauge the dump lists with level files. Each is `ispra/<name>`, the name its files go by, such as `ispra/napoli` for `napoli_hydrometric_<YYYYMM>.csv`. The station name is the one in the series' English label ("Palinuro", where the platform's name is the municipality, "Centola"), and the position is the platform's. Every station is `active`, since the network still reports, but none is `live`. mareografico.it shows five more gauges, Arbatax, Cetraro, Marzamemi, Milazzo and Pozzallo, which have no files in the repository. The dump's Isole Tremiti is mareografico.it's Tremiti.
- **Levels:** every 10 minutes, which ISPRA gives in centimeters. The store rounds them to the millimeter. A station's years are partial, since many months the dump lists aren't served (erratum `ispra-listed-months-missing`), and a month's file can end early, as Venezia's April 2022 ends on the 19th.
- **Times:** UTC, as each file's header says.
- **Datum:** `ZERO`, the gauge's own zero. The files give a level only, and neither the files, the dump nor ISPRA's legal notes say how a gauge's zero relates to Italy's national datum (Genova 1942) or to mean sea level, so levels convert to no other datum. mareografico.it has a levelling section and a table of ellipsoidal heights that may give these, which the store doesn't read.
- **Flags:** ISPRA sends no quality flag. Every file is validation level L0, raw and unvalidated, and ISPRA publishes no validated version, so every value is `preliminary`. ISPRA's legal notes describe the values as non-validated dynamic data.
- **Freshness:** the repository's files end in October 2023, and new values arrive only if ISPRA adds months. mareografico.it shows the last 24 hours to 7 days of each gauge's levels, but only through session-driven pages behind a bot check, with no documented API, so the store doesn't read them and no station is polled hourly.

## Known limits

- **History before 2010:** mareografico.it's data archive lists "pre-NTN data" for 23 gauges, from stations the local hydrographic services ran before the network, with sea level only, collection starting in different years, and "the level reference is not unique". It also lists hourly levels, daily means with a Bloomfield filter, and tidal constants. These come only through the site's session-driven forms, with no files or terms of their own, so the store doesn't read them.

## Running ingest

- **Limits:** ISPRA publishes none. Requests start at least a second apart. A month is about 100 KB, a year of one gauge about 1.2 MB, and the dump 7 MB, read fresh on every run.
- **Files:** `https://rep.isprambiente.it/file/rmn/<station>_hydrometric_<YYYYMM>.csv`, a month each, with CRLF line ends, a `UTC;Level` header and rows such as `2014-01-01 00:10:00;-25.7`. The adapter asks only for the months the dump lists and skips a 404. A row it can't read (a blank or non-numeric level, a date that doesn't exist, an extra field) fails the station, since ISPRA documents no missing-value marker. A year of every gauge held no other kind of bad row than the two the errata describe.
- **Live view:** mareografico.it's figures come from a script-generated page whose address carries a key from the visitor's session, behind a script-run bot check.

### Backfill

The Monthly workflow refreshes the list on the 2nd; Compact daily needs the list in the store. The archive is closed, so one pass fetches it all. Through the Ingest workflow:

```bash
node scripts/ingest.ts backfill ispra all 2010 2024 --skip-written
```

That is one request for each listed month, a second apart, whether or not the file exists: about an hour and a half, within one Ingest run.

### Scheduled runs

Monthly refreshes the list on the 2nd. Its refetch skips the source, since no value is ever finalized.
