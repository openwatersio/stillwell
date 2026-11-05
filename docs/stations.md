# Station lists in the lake

**Status: proposed.** This replaces the committed `stations/<source>.json` lists and the "a station has one datum for its whole record" rule in [plan.md](plan.md) decision 4. Nothing here is built yet, and the current docs describe the system as it runs today.

Each source's station list lives in the lake, not in git. A new source adds only code: its adapter, README, fixtures and tests. No ingest run changes a file in the repo. A station that changes datum, once or many times, stays active, and ingest keeps its public series in one datum.

## Why the lists can leave git

The committed lists hold three kinds of thing, and none of them needs git:

- **What the source says**: name, position, products, intervals, datums. The next refresh fetches it again.
- **State a refresh carries forward**: stations the source stopped listing (kept inactive so an ID is never reused), datums the source left out this time, CO-OPS `established`/`removed`, USACE `series` and `zero_since`. This is state, and the lake can hold it.
- **What a person decided**: `tide_station` and hand-entered gauge zero dates. As of 2026-11-04 no station has a hand-set `tide_station`, and the zero dates already live in code (`src/sources/usace/zeros.ts`). Decisions like these go in code, where a PR reviews them.

Today the committed `datum` and the `datum` column in each series file guard the lake together: `refuseOtherDatum` refuses a write whose datum differs from the file's. A label can't tell two references with the same name apart, such as a gauge zero before and after a reset, so this design adds an `epoch` column that can (below).

## Lake layout

New paths beside the ones in [data.md](data.md). `<station>` is the URL-encoded `source_id`, as in the series paths.

```
stations.parquet                                        published list: every public source's, plus bounds
stations/<source>.parquet                               one source's list, every station it has listed
stations/bounds.parquet                                 first and last per station, written by compaction
history/stations/<source>/<run>.parquet                 the source's list before each refresh
history/stations/<source>/<run>.json                    what that refresh changed
archive/<dataset>/<source>/<station>/<epoch>/<year>.parquet  rows from an epoch that couldn't be converted
```

- **`stations/<source>.parquet`** has the `stations.parquet` columns except `first`/`last`, plus:
  - `datum_since`, when the current epoch began;
  - `epochs`, the station's datum history (below);
  - `extra`, a JSON column for the source's own fields (USACE `series`, CO-OPS `established`/`removed`).

  Reading a list spreads `extra` back onto each station, so adapters, `backfill` and `recent` see `series` and `established` as top-level fields, as they do today.

- **Series files** (`obs/`, `extremes/`, `predictions/`, `predicted-extremes/`) gain an `epoch` column, the same on every row like `datum`. A write is refused unless both `datum` and `epoch` match the station's current epoch.
- **Archive files** carry the same columns as the series file they came from, in their own epoch's datum. `<dataset>` is the series directory (`obs`, `extremes`, …), so two products never share an archive path. An archive write merges with what is already there, by time, and never replaces it.
- **`stations.parquet`** is rebuilt from the per-source files and `bounds.parquet` at the end of every refresh and every compaction. The per-source files and `bounds.parquet` hold all the state, so the published file can always be rebuilt from them, and a rebuild that read a stale input is fixed by the next one.
- **Restricted sources.** A non-commercial station's list entry, history and archive go to the restricted lake through `lakeFor`, like its series. The public `stations.parquet` leaves them out. The restricted lake gets its own `stations.parquet`.

## A refresh

1. Read `stations/<source>.parquet`, the previous list, from the lake.
2. Fetch the source's list with `stations(previous)`, as now.
3. Merge with `mergeStationList`, and apply the datum rules below.
4. Apply the source's `overrides.ts`: hand decisions such as a `tide_station`, a pinned USACE series or a reset date.
5. Run the guards. Any one of these keeps the previous list and exits nonzero:
   - the fetch failed;
   - the list is empty;
   - it shrank sharply (`shrankSharply`);
   - too many stations opened an epoch at once (below).
6. Copy the previous list to `history/stations/<source>/<run>.parquet`, then write the new list.
7. Write the change report next to the snapshot, and print it to the job summary: stations added, retired and changed field by field, plus epochs opened, confirmed and rebased.
8. Rebase any station with an unfinished epoch (below), then rebuild `stations.parquet`.

**Concurrency.** Everything that writes one source's files (its refresh, rebase, `backfill`, `recent` and compaction) runs in a `lake-<source>` group, so a rebase never races an hourly write. Only the rebuild of the shared `stations.parquet` sits outside it. GitHub drops a pending run when a third queues, which is safe here: each rebuild reads all its inputs fresh. Local runs (`WATER_LEVELS_LAKE=data`) have no group, and are one person's lake.

**Backups.** The lake becomes the only copy of the station lists, so history snapshots alone aren't enough: they're written by the same job that could damage the list. The quarterly bulk snapshot (plan phase 4) also copies `stations/` and `history/` to the snapshot bucket. Nothing here relies on R2 object versioning.

**Rollback.** Copy a snapshot back to `stations/<source>.parquet` and rebuild. That's safe only for a snapshot taken after the station's latest epoch opened. A snapshot from before would name a datum and epoch the series files no longer hold, so the restore command refuses it and says to undo the epoch instead (below).

**Local runs and tools.** `WATER_LEVELS_LAKE=data` behaves the same against a local directory; on an empty lake, the first refresh lists every station as new. Read-only tools, such as the TICON inventory, get a reader for the public bucket over HTTPS. Tests use fixtures only.

**Starting.** A one-time `ingest seed-stations` writes main's committed lists into the lake, each station with one epoch: `{ id: 1, datum, since: zero_since }`, where `since` is null except for USACE's 33 reset stations. Every existing series file gets `epoch = 1`. Seeding sets `datum_since` from `zero_since`, so `zeros.ts` opens no epoch on the first refresh. To check it:

- build a `stations.parquet` from main's lists with today's code, and compare it with DuckDB `EXCEPT` both ways against one built from the seeded lists. Don't compare against the published file, which a manual run may have refreshed since main;
- compare `extra` with the JSON lists field by field, since `stations.parquet` doesn't carry it.

The PR after that removes `stations/` and the seed command.

## Datum changes

USACE's `zero_since` handles one kind of datum change today. CWMS keeps one series across a gauge zero reset, so the reset date is entered by hand, and backfill never fetches before it. A station's files then hold one zero, and a person deletes any rows from before the date that are already in the lake.

The general rule: **a station's public series holds only its current epoch, with earlier epochs converted into it where a fixed reference allows, and archived otherwise.** A zero reset, a change of datum name, and a change back are all the same event.

### Epochs

An epoch is a span over which a station's levels share one reference:

```
epochs: [{ id, datum, since, until, datums, state }]
```

- `id` is a number that is never reused, even if an epoch is undone, so archive paths and `epoch` columns stay stable.
- `datum` is the label, such as `PNP` or `GZ`. A label alone doesn't identify an epoch: a zero reset keeps the label while the reference moves.
- `since` and `until` bound the epoch. The current epoch has no `until`, and its `since` is the station's `datum_since`.
- `datums` holds the offsets to other datums that applied during the epoch. The current epoch's `datums` follows the station's, refresh by refresh. When the epoch closes, they're frozen at the values from the last snapshot taken before the new epoch's `since`. Offsets fetched after a change are never credited to the epoch before it, which matters for a reset found late.
- `state` is `pending`, `confirmed` or `rebased`.

### When an epoch opens

A refresh opens an epoch when any of these happens:

- the source reports another datum label for the station;
- the source reports another reference under the same label, with the date it took effect, such as a change in PEGELONLINE's `gaugeZero.value` and its `validFrom`;
- `overrides.ts` (which is what `zeros.ts` becomes) enters a reset later than the station's `datum_since`.

Hourly runs also notice a label change sooner. Where an adapter refuses values in another datum, as PEGELONLINE does, `recent` holds that station and queues a station refresh for its source, so the gap is an hour, not a month.

**When it began.** The new epoch's `since` is the first of these that exists:

1. the date the source gives;
2. the date in `overrides.ts`;
3. the time of the last refresh that still saw the old reference. The change happened between then and the refresh that saw it, so rows in that window are treated as uncertain (below).

`since` must be later than the current epoch's `since`. An earlier date would rewrite an epoch already rebased, so the refresh holds the station and reports it for `overrides.ts` to settle.

### Pending, then confirmed

A new epoch starts `pending`. While pending, the station's `backfill` and `recent` skip it, so nothing is written under either label. The published `stations.parquet` keeps the old epoch. A station refresh for that source runs daily until each pending epoch is resolved:

- the source still reports the new reference a day or more later: the epoch is `confirmed`;
- the source reports the old one again: the epoch is dropped, and nothing was touched;
- `overrides.ts` confirms or rejects it: that decides, whatever the source says.

An epoch entered in `overrides.ts` is confirmed when it opens. A one-refresh glitch therefore never moves anything.

### Rebasing the series

A station with a `confirmed` epoch is rebased in step 8, and again on every later refresh until it's done. Each series file is checked separately, and a file is done when its `epoch` column is the current epoch:

1. **Archive what can't be converted.** Rows from before `since` that can't be converted (below) are merged into their epoch's archive file. Then rows in the uncertain window go to the archive too, under the old epoch, marked `uncertain`.
2. **Convert the rest.** Every remaining row from before `since` is converted into the new epoch.
3. **Rewrite the file** in the new `datum` and `epoch`. The rewrite is one whole-file write, so a file is either all old epoch or all new. Because the archive merge comes first and never replaces anything, a retry after a crash never duplicates archived rows or converts a row twice.
4. **Re-fetch** from the start of the uncertain window, or from `since` if there's none, in the new datum, as a backfill. All the station's rows in `recent/<source>.parquet` are dropped and fetched again, since recent rows have no epoch column. Rows a windowed source can no longer serve stay archived as uncertain.

Once every file is done, the epoch is `rebased`. The station's published `datum` and `datum_since` switch to it, and `backfill` and `recent` resume. Until then, the published station still names the old epoch, which every file not yet rewritten is still in.

**When rows convert.** Rows convert through a fixed reference R when both epochs have an offset to R:

```
level_new = level_old + old.datums[R] − new.datums[R]
```

R must be a geodetic datum in the same realization in both epochs: NAP, NHN, NGVD29, or NAVD88 with its realization recorded (such as `NAVD88(2009.55)`). Tidal datums (MSL, MLLW, LAT) are never used, because each tidal epoch moves them. The same goes for an adapter that folds realizations together, as USACE's does for NAVD88 today, unless it records which one. Where both epochs share more than one reference, the first in that order is used.

Rows are not converted when:

- the epochs share no fixed reference;
- the old epoch's offsets weren't captured before the change;
- the offsets are equal across a same-label reset. Equal offsets there mean the offsets didn't follow the reset, not that the gauge zero stayed put.

USACE's `datums` hold no fixed reference today (they're empty), so its resets archive until offsets are entered in `overrides.ts`. That's no worse than now: today, rows from before `zero_since` are left out of backfill and deleted by hand.

### A gauge that changes datum more than once

Each change opens one more epoch, and the same steps run again.

- **Conversions compose through the fixed reference.** Rows from epoch 1, converted into epoch 2, get converted into epoch 3 with epoch 2's and epoch 3's offsets to the same R. That equals converting straight from 1 to 3. When the two changes used different references, it doesn't, so the second conversion counts as possible only if R is shared by every epoch the rows passed through.
- **Each epoch's archive holds its own rows.** A row converted into epoch 2 that can't go on to epoch 3 is archived under epoch 2, in epoch 2's datum. Originals from epoch 1 that were never converted stay in epoch 1's archive. Archive files only merge, so a later epoch never overwrites one.
- **A change back (A → B → A) opens a new epoch**, not a return to the old one: the label matches, but the reference may not. Whether to convert is decided by the epochs' offsets, as for any change.
- **Several changes between two refreshes** are seen as one. The refresh sees only the latest reference. The source's own dates, or `overrides.ts`, can enter the epochs in between; without them, their rows land in the uncertain window.
- **A station that keeps changing is held.** A second change within 180 days, or a label returning to one of the station's earlier ones, holds the new epoch as `pending` until `overrides.ts` decides. 180 days spans several refreshes at any cadence, so a source flipping labels can't keep moving a station's history.

### Guards

- **Many changes at once:** if more of a source's stations open an epoch in one refresh than its limit allows (by default 5 stations or 2%, whichever is larger), an adapter bug is likelier than gauge work. The refresh keeps the previous list and exits nonzero. Seeding sets every station's `datum_since`, so existing `zeros.ts` entries don't trip this.
- **Nothing is deleted.** Rebasing only converts rows or moves them into the archive.
- **Undoing an epoch** is a command, `ingest undo-epoch <station> <epoch>`, rather than a snapshot restore:
  - it converts rows back with the same offsets, which is exact up to FLOAT storage (about 0.1 mm);
  - it moves the epoch's archived rows back;
  - it marks the epoch `undone` in the list, keeping its `id`;
  - its PR marks the epoch rejected in `overrides.ts`, so the next refresh doesn't open it again. As `zeros.ts` says today, removing a reset date would let a backfill write the old zero's values back, so an entry is marked rejected, never deleted.

## What changes in the code

- `src/stations.ts`: `mergeStationList` opens pending epochs instead of marking a station inactive. `first`/`last` leave the merge.
- `src/lake/`: readers and writers for the per-source lists, bounds, history and archive; the `epoch` column; `rebaseStation`; `undo-epoch`; an HTTPS reader for the public bucket.
- `scripts/ingest.ts`: `stations`, `backfill` and `recent` read the lists from the lake, skip pending and unrebased stations, and route lists through `lakeFor`. `seed-stations` is temporary.
- `src/sources/<source>/overrides.ts`: hand decisions per source. USACE's `zeros.ts` moves into it, and its test checks the overrides against the lake list instead of `stations/usace.json`.
- `src/sources/pegelonline`: report `gaugeZero` value and `validFrom` so a same-label reset opens an epoch.
- `scripts/ticon-inventory.ts`: read the lists from the lake.
- Tests that pin today's behavior change with it: `test/stations.test.ts` (inactive on a datum change), and `test/sources.test.ts` (the USACE zero dates against `stations/usace.json`).
- Removed or reworded when built:
  - `stations/` and its `.prettierignore` entry;
  - [plan.md](plan.md) decision 4, the repo shape, phase 4's monthly PR, and the `Source` interface comment;
  - CONTRIBUTING (the layout, the ingest paragraph, and "a station keeps one datum");
  - the README's license paragraph about the copies in `stations/`;
  - the USACE, CO-OPS and RWS adapter READMEs;
  - the comments in `scripts/ingest.ts`, `src/stations.ts`, `src/schema.ts` and `src/lake/paths.ts`, and the `stations/<id>.json` error messages;
  - [data.md](data.md)'s note that a file's datum matches the station's, which becomes its epoch.
- The open USGS PR drops its `stations/usgs.json`.

## What this gives up

- **No reviewed diff of station changes.** The change report and guards replace PR review. A station that moves or is renamed shows only in the report.
- **The lake is the only live copy of the station lists.** Snapshots and the quarterly copy cover that.
- **A pending epoch pauses a station.** It stays paused for at least a day, and longer if `overrides.ts` must decide. That's the price of never writing under a label that might be wrong.
- **A hand decision needs a code PR.** That's the right weight for something that changes how a station's history is stored.
