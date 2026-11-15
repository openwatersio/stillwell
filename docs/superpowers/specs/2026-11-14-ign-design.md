# IGN tide gauges

Approved in chat: https://github.com/openwatersio/stillwell/issues/181.

## Intent

Read Spain's IGN tide gauges directly from the originator, including the historical record and daily observations. Preserve provenance, reviewed status and surveyed reference information, and link copies already in the store.

## Approach

Use a normal `ign` source adapter. Follow JMA's provisional/final distinction, CMEMS's timestamp-level precedence, BODC's explicit surveyed offsets, and the shared same-as machinery. A separate ingest service would duplicate the registry and scheduling. GESLA alone cannot supply IGN's live readings or reference metadata.

## Behavior

- List the 12 station directories, including retired FUER1 and MURC1, with metadata supported by IGN's station sheets.
- Read reviewed `procesados/integros` files and preferred-sensor daily `observados` files. Reviewed values win at shared timestamps; retain finer observations absent from the reviewed series.
- Store meters increasing upward. Retain Join Mark as the reference for reviewed series. Raw readings may join them only with an evidenced sensor-to-JM conversion; never infer a surveyed offset from a mean difference. Preserve separately referenced series where the source does not establish a conversion.
- Publish NMMA offsets only where the station sheet establishes that reference. Island orthometric heights alone do not establish NMMA.
- Keep commercial use false pending IGN's confirmation. Record the README's attribution condition and distinguish it from the broader IGN license.
- Link verified GESLA counterparts through existing same-as rules and decisions. Use shared preferred-series ranking.
- Include recorded-response tests, source documentation, a canary, registry integration, and the planning research-table entry.

## Constraints

Node 24 or later. No new dependencies. Follow `CONTRIBUTING.md`. Keep raw voltage channels, missing-value sentinels, malformed timestamps and unrelated sensors out of water levels. Directory and file failures must not silently look like absent data. No public ingest or agency email is part of implementation.

## Verification

Fixture tests cover station metadata, unit and sign conversion, datum isolation, timestamps, missing values, final/live overlap and failed upstream responses. Run `npm run check`, the site build if source integration affects it, and a small live canary. Check overlapping observations against reviewed data and existing copies before enabling the live path.

## Open evidence to collect

Record each station's sensor codes, reference relationships and time convention from IGN documentation. Alicante's sheet gives JM NP1 at 3.41 m but no BM height; that sheet alone cannot convert radar distances to JM. Confirm the preferred sensor and references before implementation chooses the raw-series representation. Island national-datum offsets remain absent unless explicitly supported.

## Reference decisions

Raw series are isolated per sensor. Current sheets do not establish every historical sensor-to-mark relationship; they provide no safe basis for merging those raw records into reviewed series. Reviewed headers validate mark identity as well as BM/JM role. Historical Tenerife BMs with different names remain separate and carry no surveyed offsets. MURC1’s reviewed NAP-943 reference uses its published 2.313 m NMMA height from MURC2’s sheet. Ambiguous numeric -9999 readings are retained as suspect; documented positive 9999 and explicit --- gaps are dropped.
