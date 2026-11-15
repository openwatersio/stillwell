# Instituto Geográfico Nacional, Spain (`ign`)

IGN's [tide-gauge network](https://www.ign.es/web/gds-red-mareografos) publishes observations and reviewed records through an [open HTTPS directory](https://datos-geodesia.ign.es/Red_de_Mareografos/). The store includes its twelve physical gauges, with separate series for raw sensors and differently referenced reviewed records.

- **License:** the [server README](https://datos-geodesia.ign.es/Red_de_Mareografos/Leeme.txt) requires attribution to Área de Geodesia, IGN and states no other condition on the series. Redistribution is permitted with that credit. Commercial use is tagged false pending confirmation that IGN's broader CC BY 4.0 policy covers these observations, following [issue #181](https://github.com/openwatersio/stillwell/issues/181).
- **Contact:** ign@transportes.gob.es, published in IGN's website footer; the server README also gives buzon-geodesia@fomento.es.
- **Metadata:** positions, numeric file codes, marks and sensor periods come from the [station sheets](https://datos-geodesia.ign.es/Red_de_Mareografos/fichas/). The root listing must contain exactly twelve distinct supported gauges. Ten are operational according to their sheets, although ACOR1 and ALBO1 can have empty current-year directories. FUER1 stopped in 2018 and MURC1 in 2005.
- **Series:** a plain gauge ID, such as `ign/ALAC1`, holds reviewed data. Raw sensors have IDs such as `ign/ALAC1-1633`, including historical chart sensors such as `ign/ALAC1-0301`. The newer radar is the live sensor; other sensors remain available for backfill. All records of one physical gauge name each other in `same_as`. Sheet periods identify retired sensors; archive inventories decide which years can be fetched because the sheets can be incomplete.
- **Raw levels:** digital files give distances downward from BM, so their sign is reversed and millimeters become meters. They use datum `BM`, with a reference identifying the individual sensor and no surveyed offsets. Today's station sheet does not establish every historical sensor's calibration or mark. Chart readings retain their published sign in `ZERO`, separately per instrument, except MURC1 sensor 0503, whose archived distances are reversed after comparison with reviewed heights (erratum `ign-murc1-chart-archive`). Raw readings are never merged into reviewed series. Battery voltage (`2000`) and pressure (`1501`) are excluded by sensor selection and unit validation.
- **Reviewed levels:** both `procesados/integros` and `procesados/horarios` are read. Minute values win at shared timestamps, with direct JM files preferred to converted BM within each product; hourly files supply years and hours they lack. Station, units, reference role and named mark are validated. BM files convert to JM only where the named mark matches the surveyed BM; Alborán's `C_Mfo` identifies the sheet's `Clv. Mfo`. Unknown marks and known marks without a surveyed conversion fail the fetch; they are never silently assigned another reference. New TN031 JM/current-BM files also fail until the catalog has a series for their reference.
- **Historical references:** MURC1's reviewed file names JM NAP-943, at 2.313 m NMMA in MURC2's sheet, rather than MURC1's sheet's NP-1744 at 6.55 m. TN021's older BM files name NGZ-581 and stay in `ign/TN021-NGZ581` without an offset; its JM files stay in `ign/TN021`. TN031's reviewed files name BM NGAB-161 and stay in `ign/TN031`, with no assumed offset to today's Inox. CRI 1 or JM (erratum `ign-reviewed-marks`).
- **Flags:** reviewed values are `good`; IGN includes interpolation and corrections but supplies no qualifier to distinguish them. Raw readings are `preliminary`. Positive `9999` and `---` are missing and dropped. Numeric `-9999` is ambiguous: exports use it both for missing data and genuine −9.999 m heights. It is retained as `suspect`, including the source flag, so real readings survive and placeholders fail the default quality filter (erratum `ign-negative-sentinel`). Identical adjacent raw logger rows are kept once; conflicting repeated timestamps fail the fetch.
- **Times:** timestamps are read as UTC. Alicante's reviewed record fits the store's CMEMS copy best with zero shift in the first week of January 2024: 152 shared samples, 1.79 cm RMS after removing the mean offset, against 2.16 cm one hour earlier and 2.17 cm later. This sample does not establish every historical chart's clock. Impossible dates, wrong file years or days, and decreasing timestamps fail the fetch. Results include the start and exclude the end of the interval.
- **Datums:** reviewed JM series carry their named mark's height relative to `NMMA` on the peninsula, or `Tenerife`, `Fuerteventura` or `Alboran` on those islands. IGN's [height-origin table](https://datos-geodesia.ign.es/Red_de_Mareografos/fichas/Origenes_Altitudes_Nacionales.pdf) distinguishes these origins. Island heights are never labeled NMMA. Both Alicante Join Marks are NP1, given to the centimeter as 3.41 m. Raw series and unmatched historical BMs carry no surveyed offsets.
- **Copies:** explicit links to the nine GESLA CMEMS records in issue #181 use positions checked against the store. Shared ranking prefers IGN over GESLA under matching commercial-use tags. A commercially usable CMEMS series can remain preferred while IGN's confirmation is pending.

## Errata

- **Repeated logger rows** (erratum `ign-duplicate-raw-rows`). Identical adjacent raw rows are kept once.
- **Ambiguous missing marker** (erratum `ign-negative-sentinel`). Numeric −9999 is retained as suspect because it can be a real height or a missing placeholder.
- **Historical mark names** (erratum `ign-reviewed-marks`). Headers identify references that differ from today's sheets; offsets follow the named mark or remain unset.

- **Chart archive metadata** (erratum `ign-murc1-chart-archive`). Cartagena 0503 exports cover 2001–2003 despite the earlier period in the sheet; comparison with reviewed heights establishes their downward direction.

## Running ingest

Requests start at least 350 ms apart. Inventories and files are read fresh because IGN does not establish that exports are immutable. Historical requests longer than a week use the requested sensor's annual export in `observados/ficheros_anuales` where available, otherwise its daily files. A spare sensor's annual export cannot override the requested sensor. Current-year backfills can need hundreds of daily files per live sensor.

Failed requests, malformed listings, invalid timestamps and empty data files fail the fetch so an outage cannot be mistaken for a withdrawal. A missing optional annual-export directory falls back to daily files; absent observed years are not requested. A syntactically complete listing can omit files without revealing that fact. `keepsStored` preserves omitted timestamps in backfill and `keepsRecent` does so in hourly Parquet ingest and realtime polling; raw observations cannot overwrite reviewed values because the series are separate.

Hourly ingest polls the newer radar of each operational gauge. Monthly refreshes the catalog and refetches the last three calendar years, inactive series included. That fixed window brings new reviewed annual files even though raw readings live in other series. Raw values stay preliminary. Inventories avoid requesting years the server does not list. Current-year refreshes can take over an hour because every available daily file is fetched; the job timeout is 360 minutes.

The canary requires recent Alicante radar observations and reviewed JM values. Tests use recorded directory and data excerpts and make no network calls.

### Backfill

Refresh the station list, then include inactive gauges and sensors for a complete history:

```bash
node scripts/ingest.ts backfill ign all 1927 2026 --with-inactive --skip-written
node scripts/ingest.ts backfill ign all 2026 2027 --with-inactive
```

The end year is exclusive. Annual exports can contain years absent from the daily directory listing; both inventories are used. Group records through `same_as` instead of counting sensors as extra physical gauges.
