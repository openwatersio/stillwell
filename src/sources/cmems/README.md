# Copernicus Marine (`cmems`)

Sea levels at tide gauges that Copernicus Marine's In Situ Thematic Assembly Centre (TAC) collects from about 65 national networks and institutes, read from the global near-real-time product [INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030](https://data.marine.copernicus.eu/product/INSITU_GLO_PHYBGCWAV_DISCRETE_MYNRT_013_030/description) (DOI [10.48670/moi-00036](https://doi.org/10.48670/moi-00036)). Most gauges are in Europe's seas, and SHOM's are worldwide. Many relay networks the store also reads directly, and the network's own series is preferred while it reports. The rest, in Spain, Italy outside ISPRA's network, Greece, Turkey, Estonia, Finland, the Black Sea and elsewhere, have no other open feed.

- **Stations:** each gauge is `cmems/<code>`, with its platform code, and the store lists every tide-gauge file (`TG`) with sea level (`SLEV`) in the product's indexes. SHOM splits a gauge's history by sampling interval (`BrestTG_01minute`, `BrestTG_60minute`), and the store lists the gauge once (`BrestTG`). Moorings and buoys that also report sea level aren't listed. A gauge is active while the latest dataset (below) has a file for it. The name is the file's `platform_name`, or the code where that's empty or cut short (erratum `cmems-baltic-names`). The position is the middle of the newest file's span of positions, which is a point at every gauge but Andratx, whose history file spans about 600 m. Stations have no country: the files give only the providing institution's, which isn't the gauge's for SHOM's overseas gauges or JRC's in the Mediterranean.
- **Levels:** at the provider's interval, from one a minute (Spain, SHOM) to one an hour. Some providers' history holds hourly values where their latest dataset holds minutes, as at Puertos del Estado's Alcudia.
- **Times:** UTC.
- **Datum:** `ZERO`, each provider's own zero. The file's `sea_level_datum` describes it as free text, such as chart datum, `BSCD2000(DVR90)`, `DHHN2016`, `MSL`, `Harbour Local Datum` or `Unknown`, which the store keeps as `datum_information`. A change in that text, other than in case or spacing, opens a datum epoch. Linked series give the offsets to the originator's datum where there is one ([src/links.ts](../../links.ts)).
- **Datasets:** the product has two. `latest` holds about the last 30 days, updated several times a day, 24 to 48 hours behind. `history` holds each gauge's whole record to about two months ago, updated about monthly. Where both have a value at a time, the history's stands.
- **Flags:** `value_qc` follows the Copernicus in situ scheme, set by the TAC's automatic checks. 0 (no QC) is `preliminary`. 1 (good), 2 (probably good) and 5 (changed) are `good`. 3 (probably bad) is `suspect`, as is any other code, such as 7 (nominal value). 4 is `bad`, 8 is `interpolated`, and 9 (missing) is dropped. A value from the latest dataset is at least `preliminary` until the history copy replaces it.
- **Freshness:** values arrive a day or two late, so no station is polled hourly. Monthly's refetch reads them, and replaces the latest dataset's values once the history copy has them.

## Known limits

- **Kept values:** a refetch replaces only the times it fetches, since the latest dataset moves past a month long before the history copy reaches it. So a value the latest dataset had and the history copy drops stays as the latest dataset gave it, `preliminary`. Where a provider's history is coarser than its latest dataset, as at Alcudia, a month holds both, and the minutes the history lacks stay `preliminary`.
- **No levels:** twelve inactive gauges have no ARCO chunks, so the store has no levels for them. Eleven are SHOM's (`BaieDuLazaretTG`, `LifouTG`, `LorientTG`, `MataUtuTG`, `OuveaTG`, `PapeeteUhslcTG`, `PariacaboTG`, `PointeDesRochesTG`, `PorquerollesTG`, `PortCrosTG`, `PortDeLaRedonneTG`), and REFMAR's series of each has the levels. The twelfth is Emercit's Parus (`073`), whose levels only the native netCDF file holds.
- **Emden:** CMEMS's copy of PEGELONLINE's Emden gauge holds whole centimeters from July 2025.

## Running ingest

- **Access:** no account. The product's files are in the Marine Data Store's public buckets on CloudFerro's S3, readable anonymously. Neither bucket publishes a rate limit, and requests aren't paced.
- **Station refresh:** the list comes from the native `index_history.txt` and `index_latest.txt`. The name, datum text and credit line come from each gauge's newest file: the latest daily file, about 50 KB, or for an inactive gauge its history file, up to 20 MB. The adapter reads these text attributes from the netCDF-4 file's bytes. A stopped gauge the list already has, with the same last day, keeps what the list has. A file that can't be read, such as a daily file that left the window after the index was read, keeps what the list had, or leaves the name to the code and the datum text empty. The refresh fails on a file that names a licence other than Copernicus's, or none. It refuses an empty index, a row with a missing position or an impossible time, and a latest index with fewer than half the gauges the list has active, unless the list has fewer than 20 active.
- **Levels:** the native files are netCDF-4 (HDF5), which nothing in the store reads, so levels come from the ARCO copy: one SQLite file per platform, variable and time chunk (`platformChunked`), with `time` (Unix seconds), `value` and `value_qc` columns, read with Node's built-in `node:sqlite`. Each dataset's STAC record, read once a run, says where the chunks are and how long each spans. The adapter asks the latest dataset only for the last 60 days.
- **Missing chunks:** a chunk that doesn't exist, a span with no values, answers 403, so a bucket that moved or locked reads as no values. The weekly canary, which needs values from both datasets, notices that.
- **Caching:** a chunk is cached once it ends more than a year ago. Newer chunks are fetched again each time.

### Backfill

A full backfill goes through the Ingest workflow, inactive gauges included:

```bash
node scripts/ingest.ts backfill cmems all 1821 2027 --skip-written --with-inactive
```

That's about 790 gauges, asked only within each gauge's record, a chunk of 200 days a request, up to about 2 MB each.

### Scheduled runs

Monthly refreshes the list on the 2nd. Its refetch on the 9th runs `schedule.refetch`, which `node scripts/schedule.ts refetch cmems` prints: every gauge, stopped ones included, from six months back to next month. It brings in the latest dataset's new values, replaces the preliminary ones the history copy has reached, and fills the gap between the two datasets once the history covers it. A gauge stops being active about a month after its last value, while the history copy reaches its last months only later, so stopped gauges are read too. One that stopped before the six months asks for nothing.
