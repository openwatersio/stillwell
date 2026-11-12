# USGS value qualifiers and status codes (partly unverified)

## Citation and sources

U.S. Geological Survey, National Water Information System (NWIS) and the new Water Data APIs.

- Code dictionary: https://waterdata.usgs.gov/code-dictionary (could not be fetched; returned HTTP 403)
- Legacy help pages: https://help.waterdata.usgs.gov/code/uv_rmk_cd_query?fmt=html and https://help.waterdata.usgs.gov/codes-and-parameters/instantaneous-and-daily-value-status-codes (both redirect to the new site; the API collection pages returned 404)
- Water Services daily values documentation: https://waterservices.usgs.gov/docs/dv-service/

## License and local copy

U.S. government web content, public domain. No local copy.

## What is verified

From the Water Services daily values documentation (read directly) and USGS memos stored in this folder:

- Daily values and instantaneous values carry a qualifier. The documentation example has the qualifier code `P` with description "Provisional data subject to revision." It states "most recent data are marked provisional" and "should be interpreted with caution."
- Approved data are shown as Approved on NWISWeb; every other state is shown as Provisional (see [usgs-osw-records-policy.md](usgs-osw-records-policy.md)).
- The ice masking behavior for discharge is described in OSW Technical Memorandum 2014.08 (same note).

## What is unverified

From search-result snippets only, not from the code dictionary itself:

- Instantaneous-value status codes include `Eqp` (value affected by equipment malfunction), `Ice` (value affected by ice at the measurement site) and `Ssn` (parameter monitored seasonally).
- An archived USGS Ohio Water Science Center page listed an older remark code `A` for "value affected by ice at the measurement site," so code meaning has changed across eras.
- Other codes commonly seen in NWIS output (for example `Mnt` maintenance, `Dis` discontinued, `Dry`, `Bkw` backwater, `Fld`, `Zfl` zero flow, `e` estimated) were recalled from general knowledge and not confirmed here. Treat the list as incomplete until the code dictionary is read.

## Related

The WMO manual's recommended four unit-value flags (Affected, Erroneous, Missing, Estimated) are described in [wmo-1044.md](wmo-1044.md).
