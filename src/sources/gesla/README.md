# GESLA 4.1 (`gesla`)

Sea levels from [GESLA](https://gesla787883612.wordpress.com/) (Global Extreme Sea Level Analysis) 4.1, a static release from July 2026 of 6,682 records from more than 40 agencies, read from the release's zip on iCloud. Each record is a contributor's series in a common format, with GESLA's quality-control flags, from one value a minute to one an hour, back to 1800 at the oldest. Many records copy gauges another source in the store serves from its originator. `stations.parquet` prefers the originator's series wherever both exist, so GESLA fills the years and gauges the originators don't have. The [coverage report](coverage.md) says which records the store also has from their originator and which years each side lacks.

- **Stations:** one per record, `gesla/<file name>`, as GESLA names its files and TICON its records (`gesla/cuxhavensteubenhft-5990020-deu-wsv`). A character a URL would have to encode is `_` in the ID, and the list keeps GESLA's name as `file`. Names have GESLA's underscores as spaces, and `kind` is GESLA's gauge type. The list also keeps GESLA's `contributor`, `originator`, `datum_information`, `record_quality`, `record_start` and `record_end`, and each record's download link as `source_url`. Uddevalla's record and 298 of the CRMS records hold another gauge's values, so they're listed inactive with no products (errata `gesla-uddevalla-is-arko` and `gesla-crms-wrong-site`).
- **Contributors:** each record's `commercial_use` and credit follow its contributor: the stricter of GESLA's license table and the originator's own terms where they've been checked. A contributor GESLA's table doesn't list is non-commercial until its own terms are read. UHSLC's records take their terms from UHSLC's documentation files, as the `uhslc` source does. The [table of terms by contributor](contributors.md) lists them.
- **Not listed:** the South African Navy Hydrographic Office (SANHO) refused permission to republish any of its data ([#80](https://github.com/openwatersio/stillwell/issues/80), [#82](https://github.com/openwatersio/stillwell/issues/82)). Its 25 records in GESLA are withheld: 23 UHSLC records named `-zaf-` and two of Walvis Bay, in Namibia. So are both of GESLA's Lüderitz records, in Namibia, which GESLA credits to SANHO, and every copy of a UHSLC station number the `uhslc` source withholds. The rule covers GESLA's copies of UHSLC records only.
- **Levels:** in meters, at each record's own interval.
- **Times:** UTC, as every file's header says except Wewak's (erratum `gesla-wewak-time-zone`). The clock check against other contributors' TICON records of the same gauges over 2015 puts Cuxhaven, Helgoland, Hoek van Holland, Vlissingen and Seattle at 0 minutes with the corrections, and K1 within 16 minutes, as it does Hong Kong's 329 and 329b against slackwater-database's re-fit. The Baltic tides at Travemünde and Stockholm are too small to say. RWS's records are on UTC, and JODC's Japan Coast Guard records keep every year-end hour, which 4.0 lost after local midnight on December 31.
- **Datum:** `ZERO`, each record's own zero, with no offsets. GESLA describes each contributor's datum in free text, kept as `datum_information`, and gives "Unspecified" at about 1,280 records. GESLA's RWS records give Normal Amsterdam Level (NAP), except four offshore platforms that give mean sea level: Borssele Windpark Alpha, Goeree lichteiland, Hollandse kust noord deelgebied and Hollandse Kust Zuid platform Alpha.
- **Rivers:** many of GESLA's river records are tidal. QC judges each station by its measured tide ([how a station is judged tidal](https://openwatersio.github.io/stillwell/docs/guides/quality-control/#how-a-station-is-judged-tidal)), from the record's last year, so a river that gained or lost its tide during the record is judged by how it ends. At Harris County's Brays Bayou and Goose Creek and the Delaware at Penns Landing, the flatlines QC flags are stuck gauges, not a tide too small to see.
- **Flags:** GESLA's QC flag 0 (no quality control) and 1 (correct) are `good`, since a static release never finalizes anything, and the store's own QC still runs on them. 2 (interpolated) is `interpolated`, 3 (doubtful) is `suspect` and 4 (spike or wrong) is `bad`. A value whose use-in-analysis flag is 0 is at least `suspect`. Every coastal record is checked for datum jumps, which are flagged `suspect` (erratum `gesla-datum-jumps`), and `source_flag` keeps GESLA's own flag.
- **Freshness:** the release is static, so the values don't change after the backfill. Only the station list is refreshed, monthly, and no station is live.

## Known limits

- **Datum jumps not judged again:** about 50 coastal records' copies in the store miss an end of their record by more than a year, because GESLA's stated span counts the rows its own file marks missing. When QC rules change, these keep the datum jumps found in GESLA's whole file, and the current QC can only make their flags worse.
- **4.0 records missing from 4.1:** 4.1 renames most of 4.0's RWS records and splits RWS's history into `rws_hist` records ending in 2018. Matching each of 4.0's 120 RWS file names that 4.1 lacks to 4.1's RWS records within 1 km that share a word of their name leaves these 4.0 years with no 4.1 record. Most are North Sea platforms. The `rws` source has A12, Ameland Westgat, Europlatform, K13a and Q1 from RWS itself. None of 4.0 is in the store.

| 4.0 record                                  | Years with no 4.1 record | 4.1 records nearby                                                          |
| ------------------------------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `amelander_westgat_platform-awgpfm-nld-rws` | 2008–2023                | none                                                                        |
| `aukfield_platform-aukfpfm-nld-rws`         | 1984–2006                | none                                                                        |
| `awg_platform-awg-nld-rws`                  | 2024–2025                | none                                                                        |
| `bergsediepsluis-bdsl-nld-rws`              | 2024–2025                | none                                                                        |
| `d15_platform-d15-nld-rws`                  | 2024–2025                | none                                                                        |
| `euro_platform-eurpfm-nld-rws`              | 1982–2000, 2019–2023     | `euro_platform-eurpfm-nld-rws_hist`                                         |
| `europlatform-epl-nld-rws`                  | 2024–2025                | none                                                                        |
| `f3_platform-f3pfm-nld-rws`                 | 1999–2023                | none                                                                        |
| `heesbeen-hees-nld-rws`                     | 2024–2025                | `heesbeen-heesbn-nld-rws_hist,heesbeen-hee-nld-rws`                         |
| `j6_platform-j6-nld-rws`                    | 2024–2025                | none                                                                        |
| `k13_alpha-k13-nld-rws`                     | 2024–2025                | none                                                                        |
| `k13a_platform-k13apfm-nld-rws`             | 1978–2022                | none                                                                        |
| `k14_platform-k14-nld-rws`                  | 2024–2025                | none                                                                        |
| `l9_platform-l9-nld-rws`                    | 2024–2025                | none                                                                        |
| `l9_platform-l9pfm-nld-rws`                 | 2012–2023                | none                                                                        |
| `lichteiland_goeree-lichtelgre-nld-rws`     | 1982–2000, 2019–2022     | `lichteiland_goeree-lichtelgre-nld-rws_hist,goeree_lichteiland-goe-nld-rws` |
| `lith_dorp-lito-nld-rws`                    | 2024–2025                | `lith_dorp-lit-nld-rws`                                                     |
| `north_cormorant-northcmrt-nld-rws`         | 1990–2023                | none                                                                        |
| `overloop_van_hansweert-ovha-nld-rws`       | 2024–2025                | none                                                                        |
| `platform_a12-a12-nld-rws`                  | 2009–2023                | none                                                                        |
| `platform_d15_a-d15-nld-rws`                | 2009–2023                | none                                                                        |
| `platform_f16_a-f16-nld-rws`                | 2009–2020                | none                                                                        |
| `platform_hoorn_q1_a-q1-nld-rws`            | 2007–2022                | none                                                                        |
| `platform_j6-j6-nld-rws`                    | 2009–2023                | none                                                                        |
| `terschelling_noordzee-ters-nld-rws`        | 2024–2025                | none                                                                        |
| `texel_noordzee-texe-nld-rws`               | 2024–2025                | none                                                                        |

## Running ingest

- **Withheld records:** `withheld` names every UHSLC record that carries SANHO's notice (`refused` in [UHSLC's notice list](../uhslc/notices.ts)) and every record of a UHSLC station number the `uhslc` adapter withholds, and the adapter never lists or fetches them. UHSLC's Lüderitz series, `uhslc/702`, is withheld by hand (`ALSO_WITHHELD`). A refusal from one of GESLA's other contributors, such as BOM, would need a rule of its own. [Withheld stations](../../../docs/contributing/sources.md#withheld-stations) has how withheld records leave the store.
- **Terms and coverage files:** [`contributors.ts`](contributors.ts) holds each contributor's terms. `npm run gesla:contributors` writes the table of terms by contributor, and `npm run gesla:coverage` the coverage report.
- **Dropped records:** `isDropped` in [`dropped.ts`](dropped.ts) finds the records that hold another gauge's values, and the adapter refuses to fetch them, so `backfill all` skips them. `ingest drop gesla` deletes their stored files and backfilled years, except those of the ten CRMS records in `KEEP_FILES`, whose values match nothing else in the store.

### Reading the release

GESLA publishes 4.1 three ways, all the same build: a zip of every record on iCloud (7.94 GB, 69 GB unzipped), a link per record on CloudFront (`d2lyy96te42c83.cloudfront.net/v4-1/<file>`, given in the metadata CSV), whose files are byte for byte the zip's entries, and UHSLC's ERDDAP (`global_hourly_gesla`), whose values match. The adapter reads the zip. Each entry is deflated on its own and the iCloud link answers HTTP Range requests, so a record is two ranged reads (its local header, then its data) and an inflate, after one read of the zip's central directory (765 KB) per run. A whole backfill moves the 8 GB compressed. CloudFront would move the 69 GB uncompressed, and it blocked further requests ("Request blocked", 403) for about ten minutes after some 15 files in a few minutes. ERDDAP answers per query, so a backfill a year at a time would be some 130,000 queries on UHSLC's small server, the same one the `uhslc` adapter uses.

The iCloud links are CloudKit shares: a POST of the share ID (`092OldNDh1CEOTcC1atuThsww` for the zip, `02fFab01rq4LdVcwRCf5QCyCQ` for the metadata CSV) to CloudKit's `records/resolve` returns `rootRecord.fields.fileContent.value.downloadURL`, with `${f}` standing for a file name. The URL is signed for 15 minutes, its expiry the `e` query parameter in Unix seconds, so the adapter keeps no copy on disk: it shares one URL among a run's workers until a minute before `e`, resolves a new one then, and resolves again once when a read on it fails. A failure on an older URL leaves a newer one in place, so a burst of failures resolves once, not once per worker. The share's size must be the 4.1 zip's (`release.bytes`), so a new release under the same share stops the adapter rather than mixing two releases' values. This isn't a documented API; if it changes, the canary fails, and the CloudFront links or ERDDAP are the fallbacks.

### Backfill

The Monthly workflow refreshes GESLA's list on the 2nd with every other source's; a first run dispatches Monthly with `sources: gesla`. Then backfill through the Ingest workflow, the ended years first, then 2026 on its own, since backfill fetches a year still under way on every run and `--skip-written` never skips it:

```bash
node scripts/ingest.ts backfill gesla all 1800 2026 --skip-written
```

```bash
node scripts/ingest.ts backfill gesla all 2026 2027
```

Years whose flags were written under other rules follow a station's analysis once `analyze gesla --requalify` requalifies it, or a requalify of every record:

```bash
node scripts/ingest.ts requalify gesla all 1800 2027 --shard 1/8
```

`all` reads every record's files and writes those whose flags change: the stations whose analysis changed their rules, and any other year that backfill judged before the year after it was written. Requalify lists the records whose datum jumps it can't judge again (Known limits) under warnings.

Years outside each record's span (`record_start` to `record_end`) ask for nothing. For the seven Queensland records the span runs a year either side of the labels, since a swapped day can move a value to any month of its year. Each record is read once per run and kept while backfill asks for its years (`KEEP`, the eight used last), the largest, Fremantle Fishing Boat Harbour, being 197 MB of text, which peaks at about 1.3 GB while it's parsed and keeps about 100 MB. A run cut short resumes with `--skip-written`. A written year is complete, so neither that nor a plain backfill reads it again: a change to how the adapter reads records, such as a clock fix, reaches the store only through `--refetch` of the records and years it touches.
