# Station lists in the lake

**Status: built and switched on.** This replaced the station lists once committed to the repo, and the rule that a station has one datum for its whole record. On 2026-11-05 the R2 lake was seeded from the last committed lists (19,809 stations), and the published `stations.parquet` matched one built from them, as did every station's own fields in each list's `extra` (USACE `series` and `zero_since`, CO-OPS `established` and `removed`, USGS series). Not built yet:

- a `restore` command for a list snapshot;
- `tide_station` and series pins in `overrides`, which so far holds epoch decisions only;
- readers outside this repo (tide-database, crowd-depth) reading `epochs`.

Each source's station list lives in the lake, not in git. A new source adds only code: its adapter, README, fixtures and tests. No ingest run changes a file in the repo. A station that changes datum, once or many times, stays active: each datum epoch gets series files of its own, and `stations.parquet` says how to put the epochs together.

## Why the lists can leave git

The lists hold three kinds of thing, and none of them needs git:

- **What the source says**: name, position, products, intervals, datums. The next refresh fetches it again, and moves the few stations a source places away from their gauge (below).
- **State a refresh carries forward**: stations the source stopped listing (kept inactive so an ID is never reused), datums the source left out this time, CO-OPS `established`/`removed`, and USACE `series`. This is state, and the lake can hold it.
- **What a person decided**: `tide_station`, hand-entered gauge zero dates, and positions corrected in `POSITIONS` (`src/positions.ts`). As of 2026-11-04 no station has a hand-set `tide_station`, and the zero dates already live in code (`src/sources/usace/zeros.ts`). Decisions like these go in code, where a PR reviews them.

## Datum epochs

An epoch is a span over which a station's levels share one reference. A zero reset, a change of datum name, and a change back each start a new epoch. The label alone can't tell them apart: a reset keeps the label (`GZ` before and after) while the reference moves.

**Each epoch has its own series files, and no file is ever rewritten into another epoch.** Epoch 1 keeps today's paths, and later epochs add the epoch number:

```
obs/<source>/<station>/<year>.parquet           epoch 1, as today
obs/<source>/<station>/<epoch>/<year>.parquet   epoch 2 and later
```

The same goes for `extremes/`, `predictions/` and `predicted-extremes/`. Every file still holds one `datum` on every row, and that datum matches its own epoch. Nothing moves when an epoch opens, so there's no rebase to resume, no file half in one epoch and half in another, and nothing to archive. Compaction and `recent` write into the station's current epoch. `recent/<source>.parquet` gains an `epoch` column, so compaction folds each row into the right file.

The station's list entry carries its epochs:

```
epochs: [{ id, datum, since, until, seen, reference, reference_since, datums, to_current, state }]
```

- `id` counts up from 1 and is never reused. The next `id` is above the list's epochs, any epoch directory already in the lake for any product, and any epoch the recent window still has rows for, so a list restored from a snapshot can't hand out an `id` that already has files or rows.
- `since` and `until` are instants in UTC. The first epoch's `since` is null when the record has no known start, and the current epoch has no `until`. Rows in an epoch's files outside `[since, until)` aren't part of the series. That's how the uncertain stretch around a change stays out without being moved.
- `seen` is the last refresh whose fetch named this epoch's datum. A refresh in which the source left the datum out doesn't advance it, so it says how long the old reference was really confirmed.
- `reference` is what the source says identifies the reference, where it says anything: PEGELONLINE's `gaugeZero.validFrom`, or the research-quality version letter a UHSLC series carries. A source with no such field can instead say, through `seriesChanged`, that a station kept its label but not its zero. USGS does when a station's `time_series_id` changes or its gage datum moves, and Kartverket when chart datum moves more than a centimeter against NN2000; the reason it gives stands in for the reference, and the epoch starts at that refresh, since USGS gives no date.
- `reference_since` is where the source says `reference` starts, or null. A first epoch with no `since` learns it on the first refresh that sees it, so a later change can still be held for coming soon after it, or before it.
- `datums` holds the offsets to other datums. The current epoch's follow the source, refresh by refresh, as `datums` does today. An epoch's offsets are frozen when it closes, at the values in the list as the refresh that closed it started, before any fetch could change them.
- `to_current` is the meters to add to the epoch's levels to put them in the current epoch's datum, or null when they can't be converted (below). Every refresh recomputes it from the frozen offsets and the current ones.
- `state` is `open`, `closed`, `held` (below) or `rejected`.

Overrides name an epoch by the station and the epoch's `since`, not by `id`, so they still point at the right epoch after a list is restored and `id`s are handed out again.

`stations.parquet` publishes `epochs` alongside `datum` and `datums`, which describe the current epoch. The published epochs are already resolved for readers:

- a rejected epoch carries the `to_current` of the epoch before it, plus any offset its override gives, and that epoch's span runs on to the next epoch that isn't rejected;
- a held epoch carries a null `to_current`.

A station's whole series in its current datum is then:

```sql
-- obs: the station's files, with `epoch` taken from each file's path (1 for today's paths)
SELECT o.time, o.level_m + e.to_current AS level_m, o.flag
FROM epochs e JOIN obs o ON o.epoch = e.id
  AND (e.since IS NULL OR o.time >= e.since) AND (e.until IS NULL OR o.time < e.until)
WHERE e.to_current IS NOT NULL
-- after a rejected epoch, its files and the epoch before it can share a time; the latter wins
QUALIFY row_number() OVER (PARTITION BY o.time ORDER BY e.state = 'rejected') = 1
```

[data.md](data.md) would give the full query, and the API does the same. A reader that reads one epoch's files gets one datum, as before. Rows from an epoch that can't be converted stay in the lake, readable in their own datum, but outside the combined series.

### When an epoch opens

A refresh opens an epoch for a station when:

- the source reports another datum label;
- the source reports a new `reference` under the same label: PEGELONLINE's `gaugeZero.validFrom` changing. A changed `gaugeZero.value` under the same `validFrom` is a re-survey of the zero's height, not a moved zero, so it only updates `datums`, like any other offset. A station's first refresh to see a `reference` records it without opening an epoch, unless its date is less than 180 days old: the zero may have moved since the station was last checked, so the refresh opens a `held` epoch from that date for a person to decide, as at PEGELONLINE's Wachendorf ([#72](https://github.com/openwatersio/water-levels/issues/72));
- a hand-entered reset moves a station's reference later: USACE's `zeros.ts`, whose dates the adapter reports as the station's `reference`.

**When it began.** The new epoch's `since` is the first of these that exists:

1. the instant the source gives;
2. the date entered by hand, such as a `zeros.ts` date, read with the adapter's day boundary: the latest instant the source's local day can start, which for USACE is 06:00 UTC, as `zeroSince` uses today;
3. the time of the refresh that saw the change.

**When the old one ended.**

- A date without a time, as both PEGELONLINE's `validFrom` and the override dates are, leaves the whole day out of both epochs. The old epoch ends at the start of the day and the new one starts with the adapter's next day boundary, because nobody knows when in the day the change came. An override can end the old epoch earlier with an `until`, as `zeros.ts`'s "sometime during March 2019" needs.
- In case 3 the change came sometime after the old epoch's `seen`, so the old epoch ends there.

Rows in between are in the lake, in the old epoch's files, but outside both spans. Rows in `recent` from the new epoch's `since` on move into it, since they were fetched in its reference; anything older than the recent window needs a `backfill` of the station from that `since`, which a person runs after reading the report. Rows a source no longer serves stay out of the combined series; giving them to an epoch would be a later override.

**A source that serves its history in today's reference.** Some sources serve their whole archive measured from each station's current reference, whether because they correct it when a zero moves or because no zero has moved in the span they serve. Such a source sets `archive: "current"` in its metadata, as PEGELONLINE does. Its station's first epoch then has no `since`, only a `reference_since`, and backfill reaches back past the reference's date into that epoch's files, as far as the source's archive goes. The `reference_since` still holds a later change dated before it. A reference dated ahead keeps its `since`, since the values until then are on the zero before it. A later epoch keeps its `since`, and backfill doesn't reach before it, since that would overlap the epochs before it.

**A source that serves its history in the reference of its time.** RWS serves values from before the 2005 NAP revision against NAP as it was then, under the same label. Such a source sets `archive: "previous"`, and lists the reference its stations moved to with its start, as RWS lists `NAP 2005` from 2005-01-01 at the Dutch stations whose revision offset isn't known. The first refresh to see that reference splits the station's only epoch there, rather than record it: epoch 1 keeps its files and ends at the reference's start, with no day left out between them, since the source names the instant, and a new epoch opens from it, so values already written from that start on fall outside epoch 1's span until a backfill writes them into the new epoch. A new station gets both epochs at once. The two share a label, so the earlier one converts only by a `to_current` in the source's `overrides`, under the earlier epoch's key, which the report prints, and its `to_current` is null until then. Backfill writes the span of each closed epoch under the current label into its files as well as the current one's, since the source serves those values in their own reference. A reference first seen after a station already has a start, or a second epoch, is only recorded, as for any source, and backfill then writes nothing before it, so its earlier values wait for a person.

A `since` no later than the current epoch's is refused. The station is held, and the report says so.

**Detected between refreshes.** Adapters that refuse values in another datum, as PEGELONLINE's `levels` does, make `recent` fail for that station. `recent` records the failure and goes on, and the next station refresh opens the epoch. When such a failure is a `DatumChanged` error, Ingest hourly starts the Monthly workflow's refresh of that source, at most once a day, so the epoch opens within a day rather than at the next monthly refresh. A change a person rejected for that station, to the same datum and reference, doesn't start one, since a refresh ignores it. PEGELONLINE's `levels` can't tell a PNP series' reference, so a change to PNP starts one every day, even when rejected, until the rejection is removed.

### When epochs convert

`to_current` is set only when the two epochs share a fixed reference R:

```
to_current = epoch.datums[R] − current.datums[R]
```

- R is a geodetic datum in the same realization in both epochs: NAP, NHN, NN, HN, NGVD29, or NAVD88 with its realization recorded, such as `NAVD88(2009.55)`. Tidal datums such as MSL, MLLW and LAT never count, because each tidal epoch moves them.
- An epoch's own datum counts as R with offset 0. So a PEGELONLINE station that goes from PNP, with `datums.NN`, to NN converts exactly. PNP with `datums.NHN` to NN doesn't, since NN and NHN are different height systems.
- Where the epochs share more than one R, the first in that order is used.
- **A same-label reset never converts on its own.** Offsets that changed across it might mean the zero moved, or only that its height was re-surveyed (MVK Helena and Bogalusa, which `zeros.ts` leaves out for that reason). Offsets that stayed the same might mean the offsets never followed the reset. A person who knows which sets `to_current` for that epoch in the source's `overrides`.

Because each epoch converts straight to the current one, conversions never chain, and a station with many epochs gains no error from the number of changes. When the current epoch's offsets are re-levelled, every `to_current` follows at the next refresh, which is right: the older epochs' frozen offsets haven't changed.

USACE stations carry an NGVD29 or NAVD88 offset at about 1,060 of 1,353 stations. Their resets are same-label (`GZ`), so they keep today's behavior until a person decides: rows from before the reset stay out of the combined series. The difference from today is that those rows can stay in the lake under epoch 1, rather than being deleted by hand.

### A gauge that changes datum more than once

Each change opens one more epoch, with its own files. Nothing about earlier epochs changes except their `to_current`, which is recomputed against the new current epoch:

- epoch 1 converts to epoch 3 if they share a fixed reference, whether or not epoch 2 did. A return to the same label (NAP → MSL → NAP) never converts on its own, though, since the zero may have moved in between; a person sets its `to_current`;
- an epoch that can't convert drops out of the combined series, and its files stay as they are;
- a change back (A → B → A) is a new epoch, not a return to an old one. The label matches, but the reference may not have;
- several changes between two refreshes show up as one. The source's own dates, or a person's decisions, can enter the epochs in between; otherwise their rows fall in the gap.

A station that keeps changing is held. A change within 180 days of the current epoch's `since`, or a label returning to one of the station's earlier ones, opens the epoch as `held`. While held, the station's `backfill` and `recent` skip it, and the report lists it, until the source's `overrides` confirms or rejects the change. `compact` folds its values from before the held epoch's start and lists the rest as waiting, without failing; they age out of the 7-day window, so after a decision, `backfill` the held span. 180 days spans several refreshes at any cadence, so a source that flips labels gets one epoch at most before a person looks.

**Undoing an epoch** is an entry in the source's `overrides` marking it `rejected`. For example, an adapter bug misread a label, so the reference never changed. A rejected epoch's span goes back to the epoch before it: that one's `until` becomes the rejected epoch's (none, when the rejected epoch was the current one), and the rejected epoch's files are read as the earlier epoch's, with `to_current` 0, unless the entry gives another offset. No file moves, so an undo can itself be undone. Rejecting says the source's new reference continues the old one: a USGS station whose new series is rejected as a change goes on fetching that series, into the epoch before. USACE is the exception: its `zero_since` keeps the later of the list's and `zeros.ts`'s dates, so a rejected zero date still bounds its fetches until it's removed from both. Entries are marked, never deleted: as `zeros.ts` says today, removing a reset date would let a backfill write the old zero's values back.

## Lake layout

New paths beside the ones in [data.md](data.md). `<station>` is the URL-encoded `source_id`.

```
stations/<source>.parquet                    one source's list: every station it has listed but withheld ones, with epochs
stations/bounds/<source>.parquet             first, last, earliest preliminary and screened per station, by compaction and backfill
stations/years/<source>.parquet              each year file of levels: its hours, values by flag and version, by every run that writes them
stations/empty/<source>.json                 years with no file a --skip-written backfill found empty, kept 30 days
history/stations/<source>/<time>.parquet     the source's list as each refresh started, less withheld stations
history/stations/<source>/<time>.json        what that refresh changed
```

- **`stations/<source>.parquet`** has the `stations.parquet` columns except `first`, `last`, `preferred`, `errata`, `source_qc_start` and `source_qc_start_inferred`, plus `epochs` and an `extra` JSON column. `extra` holds `source_qc_start` and `source_qc_start_inferred`, absent for a station the adapter hasn't asked about yet, and the source's own fields (USACE `series`/`zero_since`/`datums_from`, CO-OPS `established`/`removed`, PEGELONLINE `history_since`, UHSLC `version`/`record_start`/`record_end`, GESLA `contributor`/`originator`/`datum_information`/`record_quality`/`record_start`/`record_end`, SMHI `record_start`/`record_end`/`inferred_qc_start`, JMA and the Marine Institute `record_start`/`record_end`, Kartverket `record_start`, REFMAR `first_observation`, California DWR `parameter`/`record_start`/`record_end`, CDEC `record_start`/`record_end`, SFWMD `series`/`series_start`/`series_end`/`history`/`history_start`/`history_end`/`record_start`/`record_end`). Reading a list spreads `extra` back onto each station, so adapters, `backfill` and `recent` see those fields as they do today. USACE's `zero_since` becomes the current epoch's `since`.
- **`stations.parquet`** and `sources.json` are rebuilt from the per-source lists and bounds; a source joins `sources.json` with its first list. All the state is in those, so the published file can always be rebuilt. `errata.json` and each station's `errata` come from the errata files in the repository as they stand when publish runs, not from the lake. Each of them is written only by jobs in its source's group: the refresh and a restore write the list, and compaction and backfill write the bounds.
- **`stations/years/<source>.parquet`** lists every year file of levels, in every epoch, as [data.md](data.md#which-years-a-station-has) describes for readers. Backfill and requalify mark each batch of 100 stations before writing any of their files and set those files' rows after, and compaction does the same for each batch it folds; a file a run didn't write keeps its row. After its fold, compaction lists the source's files, drops the rows of files that are gone, reads the files that have no row and every file of a station still marked, which a run stopped partway leaves, and clears the marks. It reads at most 5,000 files a night, leaving the rest's stations marked for the next, and a file it can't read keeps its station marked, and fails the run so a person looks, without holding up the rest. A station's files are read together, so the limit leaves few stations part-read. `withhold`, and each refresh, drop withheld stations' rows. Compaction leaves out withheld stations' files, so their rows don't come back between a refresh and `withhold`. A batch compaction can't mark still folds, since its rows would age out of the window, and its stations' files are read again after the fold. A mark belongs to the run that set it: a later run that writes the same station leaves an earlier stopped run's mark for the reconcile. A source's first refresh starts the file empty; a source with files but no years file gets none from these runs, since compaction can't read every file in its time, until `ingest years <source>` reads them all, writing what it has every 5,000 files with the stations it hasn't finished marked, so a run stopped by its time limit picks up where it left off when run again without `--rebuild-years`; until then, compaction goes on with it 5,000 files a night. Anything that writes year files without keeping the years file, such as a build rolled back to, a run from an older local checkout or a restore of `obs/`, leaves rows out of date that nothing reads again; afterwards run `ingest years <source> --rebuild-years` for each source it wrote, as [CONTRIBUTING.md](../CONTRIBUTING.md#running-ingest) says. Each station's `first` and `last` in `stations.parquet` still come from the bounds, which apply each epoch's `since` and `until` to the rows and hold the earliest preliminary value; the years file counts whole files, so a reader that needs the record as it stands now, rather than as of the last publish, reads it.
- **`<time>`** is the refresh's start time to the second, so a re-run never overwrites an earlier snapshot.
- **Restricted sources.** A source's `license.redistribution` decides which lake holds its list, history and series: a source whose terms bar republishing goes to the restricted lake, which keeps its own `stations.parquet`. `commercial_use` is a tag on each station, which can differ from its source's default, and doesn't move a station between lakes.

## A refresh

1. Read the previous list from the lake.
2. Fetch with `stations(previous)`, as now, and move the stations `POSITIONS` (`src/positions.ts`) names to where their gauge is. Each entry is a station its source places away from its gauge, the position the source serves, and the gauge's position from another source, such as PSMSL, IOC's sea level monitoring, the gauge's operator, or the source's own other series of the gauge, with a note naming it and the erratum it works around. Most are GESLA's copies of UHSLC series, which keep metadata UHSLC has since corrected. An entry applies only while the source still lists the station at the position it names: a source that moves the station keeps its own position, and the refresh reports the entry in its change report and fails the run, as a held epoch does, so a person checks it. A station the source stops listing keeps its corrected position, as it keeps the rest of the station. A version UHSLC splits off a corrected series, as a new station, takes UHSLC's position until an entry names it.
3. Drop withheld stations, whose owner refused republication (`withheld` on the source), from the list it read and from the fetch. They leave the list rather than stay inactive, and don't count toward the sharp-shrink guard below. More of them than 5 stations or 2% of the list, whichever is larger, is refused as likelier a wrong rule, until a person reruns with `--accept-withheld` (the Monthly workflow's `accept_withheld`).
4. Merge with `mergeStationList`, and open, hold or close epochs as above.
5. Apply the source's `overrides`: confirm or reject an epoch, end the one before it earlier, or give its `to_current`.
6. Run the guards. Any one of these keeps the previous list and exits nonzero:
   - the fetch failed;
   - the list is empty;
   - it shrank sharply (`shrankSharply`);
   - the lake has no list for the source but does have its history. A list that went missing would otherwise read as an empty lake, and every station would be rebuilt from scratch;
   - the lake has no list or history for the source but does have its values, in series files or a recent window. A list started from the fetch would forget what the old one carried forward;
   - more stations opened an epoch than the source's limit, by default 5 stations or 2%, whichever is larger. That's likelier an adapter bug than gauge work. A person who has checked it reruns with `--accept-epochs` (the Monthly workflow's `accept_epochs`), so a real batch of changes doesn't hold up the source for good.
7. Copy the previous list, without withheld stations, to history, then write the new list, and drop withheld stations' rows from the source's bounds, recent window and empty-years record. A new source's first snapshot, its empty list, is written after its list, so a run cut short can't leave history with no list.
8. Write the change report next to the snapshot, and add it to the job summary: stations added, retired, removed (withheld, with a line saying to run `ingest withhold <source>` while any still has series files) and changed field by field, epochs opened, held and rejected, and `POSITIONS` entries whose station the source moved.

**Jobs.** The Monthly workflow refreshes each list in a job of its own, in the source's `lake-<source>` group, which `backfill`, `recent` and compaction of that source share, and the Ingest workflow refuses `stations`, so no two jobs write one list at once. A final job rebuilds `stations.parquet` with `publish`, in the `lake` group, from whatever lists the lake holds, so a source whose refresh failed or was cancelled keeps its last list there. Within a group, GitHub cancels a pending job when a newer one queues, so a refresh queued behind a long backfill is cancelled by the next hourly run, shows as cancelled in the run, and is rerun from Actions. Local runs (`WATER_LEVELS_LAKE=data`) have no group.

**Nothing is lost by a refresh**, except withheld stations, which are meant to go ([CONTRIBUTING.md](../CONTRIBUTING.md#withheld-stations)). Before a refresh writes a list, it writes the list it read to `history/`, and the series files never change for an epoch. A bad refresh is undone by restoring the snapshot before it (below), and a bad epoch by rejecting it in the source's overrides. Some of what a list holds can't be fetched again (retired stations, USACE series pins, closed epochs' frozen offsets), so the snapshots matter, but protecting the bucket itself, from deletion or a bad credential, is a matter for the whole lake, observations included, and lives outside ingest.

**Restoring a list** copies a snapshot back to `stations/<source>.parquet` and rebuilds. The series files never change for an epoch, so any snapshot is safe to restore. A station's epochs go back to what the snapshot says, and files written under an epoch it doesn't have stay in the lake, unread. The restore runs the source's refresh straight after, before any `backfill` or `recent`, so an epoch the source or the source's `overrides` still reports opens again, under a new `id`, and is backfilled.

**Local runs and tools.** `WATER_LEVELS_LAKE=data` behaves the same against a local directory. On an empty lake, the first refresh lists every station as new. Read-only tools, such as the TICON inventory, get a reader for the public bucket over HTTPS. Tests use fixtures only.

## Starting

The R2 lake was seeded once from the committed lists, with a command since removed: each station got one epoch, starting at USACE's `zero_since` where it had one, so every existing series file was already epoch 1 at its path and nothing in the series was rewritten. A `recent/<source>.parquet` written before the switch has no `epoch` column, and is read as epoch 1. A new source's list starts with its first refresh. A source with no list and no history whose series are already in the lake is refused instead, since a list started from the fetch would forget what the old one carried forward; its list is copied in from a snapshot or another lake.

**Rolling the code back** to a build from before the lake lists (before openwatersio/water-levels#7) isn't supported. A revert brings back the station files as they were at the switch, which go stale from then on, and that build knows nothing of epochs, so it could write a new epoch's values into epoch 1's files under the same label. Roll forward instead. If an old build does run, the lake lists still bound what the new build reads afterwards: epoch 1's `until` leaves out anything written after it. `recent` isn't covered: the old build rewrites it without the `epoch` column, so its rows read back as epoch 1, and a station in a later epoch loses up to a week of recent values.

## Gauges in more than one source

Many gauges are in more than one source: UHSLC carries copies of CO-OPS, REFMAR, Kartverket, SMHI and other agencies' gauges, REFMAR some of UHSLC's, BSH lists PEGELONLINE's gauges for its predictions, and USACE districts publish many USGS gauges. `stations.parquet` links the stations that share a gauge with `same_as`, and names the one to use for its observed levels with `preferred`. Both are worked out each time the file is built, in `linkGauges` (`src/same-as.ts`). A source's list keeps only its adapter's own links in `same_as`, so a better rule or a person's decision reaches every station at the next `publish`, while an adapter's new links wait for its next station refresh. `preferred` is worked out again on every build too, so it moves when a series stops reporting, another's record grows longer, or the share of a record's values flagged suspect or bad changes.

**Matching.** A link comes from one of four places:

1. **An ID the source gives**, which its adapter writes to `same_as`. BSH names each gauge's PEGELONLINE series, and UHSLC's documentation files give the originator's station number, which the adapter turns into a CO-OPS station where the contributor is NOS, and a JMA station where it is JMA or JODC and the number is a two-character JMA code. GESLA's site codes are the originator's own IDs for NOAA, USGS, WSV, SMHI, REFMAR, Kartverket, SFWMD, California DWR and CDEC, and UHSLC. Other contributors' numbers aren't their lake source's IDs: SHOM's aren't REFMAR's, and Kartverket, SMHI, DMI and BfG give only NODC numbers. A source also links its own series of one gauge, such as UHSLC's versions and RWS's twins. A link to a station no list has is dropped, as is one to another source's station more than 10 km away, which is taken as a wrong ID. Both are reported.
2. **Nearness and name**, for two stations of different sources within 100 m whose names share an identifying word (`nameScore` in `src/ticon.ts`, the TICON inventory's), and that name the same side of any dam, lock or barrier: pool or tailwater, PEGELONLINE's `OP` and `UP`, `BP` and `AP`, or a compass word ending the name, such as a control structure's "- East". Never name alone, and never two stations of one source, whose neighbors (a gauge and its backup, two sides of a lock) are its adapter's to link. Nor does it link CO-OPS with USGS or USACE: each agency runs its own gauges, so two of them at one pier are separate instruments that check each other, and only an ID or a person links them.
3. **A copy's best match.** UHSLC rounds its positions, so its copy of a gauge can sit a kilometer from the original. A station that copies another agency's gauge (see the preferred series below), and whose own adapter didn't already name the original by a link that held, is linked to the station in each other source within 2 km, of the same kind where both say, that shares the most words with its name, the nearest among equals. Two equally named candidates more than 100 m apart leave it unlinked, unless their source links them as one gauge. Being named by another source's copy, as GESLA names UHSLC's series, doesn't stop a station's own matching. The kind keeps a coastal copy at Sitka off USGS's Indian River at Sitka.
4. **A person's decision** in `LINKS`, in `src/same-as.ts` with a note on why.

Linked stations form a group, and each lists every other in `same_as`, so a link through a third station counts: a CO-OPS gauge that UHSLC copies is linked to every UHSLC version of it. Links join groups in the order above, a person's first and the nearest first within each kind, and two rules keep groups apart:

- a link by nearness or copy never puts two stations of one source in a group, since one of them is likelier another gauge close by: CO-OPS lists several stations at some piers, and USACE a pool and a lock beside one USGS gauge. GESLA is the exception: it holds several agencies' copies of many gauges, so two of its records in a group are two copies, not two gauges;
- no link joins two stations a person put in `UNLINKS`, even through a third station.

A GESLA record whose values are another gauge's (`DROPPED` in `src/sources/gesla/dropped.ts`) joins no group, and is its own preferred series. A link to it, from an adapter's `same_as` or from `LINKS`, is dropped and reported.

**The preferred series** is the group's best by these, in order:

1. a person's choice in `PREFER`;
2. it has observed levels (a BSH prediction gauge doesn't);
3. its terms allow commercial use, so the API can serve it before tokens exist;
4. it isn't a GESLA record, which is the fallback for a gauge no other series covers;
5. it is active and still reporting, with a value in the last year, so a live series wins over a version that ended;
6. it is the originator's own series rather than a copy: a UHSLC station whose contributor isn't UHSLC, or isn't on file, is a copy, as is a REFMAR station named for UHSLC, and so is a USACE station beside a USGS one, since USACE districts relay the transmissions of gauges USGS runs;
7. the longer record in the lake, its span from `first` to `last` times its share of values not flagged suspect or bad, from the source's years file (`stations/years/<source>.parquet`), or its whole span where the source has none or it can't be read;
8. the finer interval;
9. the lower ID, so equals always break the same way.

**Using the links.** For one series per gauge, read the stations whose `preferred` is their own `id`; a station's other series are its `same_as`, and `preferred` names which of them to read. `preferred` is worked out again on every build, so a reader that must be reproducible, such as a datum reduction, records the series it read rather than looking it up again. [ticon-replacement.csv](ticon-replacement.csv) gives, for each TICON record, the lake series that replaces it in `replacement_id` (the declared originator's where there is one, and the EA's gauge for a UK network record) and the record's GESLA copy in `gesla_id`. Either can be empty, as for a record whose source's terms aren't cleared, so a reader joins whichever it has to `stations.parquet` and keeps a record neither resolves. The joined row's `preferred` is the gauge's series to read, which can be another source's than `replacement_id`: BODC's processed record of an EA gauge while it is the longer one still reporting (see the [BODC README](../src/sources/bodc/README.md)).

A station with no links is its own preferred series. A series that allows commercial use wins over one that doesn't, even one still reporting, so `preferred` can name a stopped series when the gauge's live one is non-commercial. `publish` prints the links made by source pair and how, the links and decisions it dropped (to no such station, or an ID more than 10 km off), the links the two rules above skipped, and any group of more than eight stations, which is likelier a bad link than one gauge. An older build's `publish` writes `stations.parquet` without `preferred`, so a rollback breaks queries on it until the next build publishes again.

## Where it lives

- `src/epochs.ts`: opening, holding and deciding epochs, and `to_current`.
- `src/stations.ts`: `mergeStationList`, which opens epochs rather than marking a station inactive.
- `src/refresh.ts`: a source's refresh with its guards and report, and the rebuild of `stations.parquet`, `sources.json` and `errata.json`.
- `src/same-as.ts`: `same_as` and `preferred` across sources, with a person's decisions on them.
- `src/lake/`: epoch paths, the `epoch` column in `recent`, readers and writers for the lists, bounds and history, and an HTTPS reader for the public bucket.
- `scripts/ingest.ts`: `stations`, `backfill` and `recent` read the lists from the lake, write the current epoch, and skip held stations; `backfill` writes closed epochs too for an `archive: "previous"` source (`epochSpans` in `src/backfill.ts`).
- `Source.overrides` (`src/schema.ts`): a person's decisions on a source's epochs, keyed by station and epoch start. Each epoch event in the report prints the key.
- Adapters: PEGELONLINE reports `gaugeZero.validFrom`, USACE its `zeros.ts` dates and CDEC the gauge-zero row of each station's page as each station's `reference`; USGS says through `seriesChanged` when a station's series or gage zero moved, and Kartverket when chart datum moved against NN2000.
- `src/lake/recent.ts`: `recent` and `compact`. Compaction folds each `recent` row into its own epoch's year file, in that epoch's datum, and fails a row whose epoch the list doesn't have. Then it writes the source's bounds, each station's first and last level over the rows its epochs count (`updateBounds`). A listing of the source's files gives each station's first and last year. Those years' spans come from the files compaction just folded, or from the bound already known when it's in that year and the year is before last year, or else from reading the files; an end year with no counted rows moves the end a year inward. So a backfill of earlier years, or of any end year from last year on, is seen. A backfill within an older end year isn't, nor are rows an epoch's widened span takes in, such as after a rejection; `compact --rebuild-bounds` reads every station again. Beside them goes the earliest value in the current epoch the source sent as preliminary, which the monthly refetch fetches again from. Compaction keeps the one it knows unless a file it folded holds an earlier one, and reads a station new to the bounds, or every station on a rebuild, from three years before this one, the refetch's cutoff, until a file holds one. Beside it, `screened` says whether any value in the current epoch is one the source screened: null until a file compaction or backfill reads says. Compaction only ever sets it true; backfill's read of a station's files sets it either way. A bounds file without the column, which an older build wrote, stays without it until a rebuild, and backfill leaves it alone, since a null there would say a station has none. Backfill reads it again from a station's files after fetching its levels, and for every station `backfill … preliminary` picks. Other backfills lower it to where each station's fetch starts, but no earlier than the cutoff year, before fetching, so a run killed partway leaves it too early rather than too late. Only the current epoch counts, since backfill writes no other.

Still to come: a `restore` command. Readers outside this repo that read series paths directly, tide-database and crowd-depth, need to read `epochs`, or they stop at epoch 1.

## What this gives up

- **No reviewed diff of station changes.** The change report and guards replace PR review, and a station that moves or is renamed shows only in the report.
- **The lake is the only live copy of the station lists.** Its history snapshots undo a bad refresh; losing the bucket itself is the same risk as for the rest of the lake.
- **A combined series takes a join.** Readers that want one datum across a station's whole history use `epochs`, not a single file glob. Most stations have one epoch, and for them nothing changes.
- **A held station stops** until the source's `overrides` decide. That's the price of never filling a station's series from a source that keeps flipping its datum.
- **A hand decision needs a code PR.** That's the right weight for something that changes how a station's history is read.
