# Station lists in the lake

**Status: proposed.** This replaces the committed `stations/<source>.json` lists and the "a station has one datum for its whole record" rule in [plan.md](plan.md) decision 4. Nothing here is built yet.

Each source's station list lives in the lake, not in git. A new source adds only code: its adapter, README, fixtures and tests. No ingest run changes a file in the repo. A station that changes datum, once or many times, stays active, and ingest keeps its series in one datum without a person resolving it.

## Why the lists can leave git

The committed lists hold three kinds of thing, and none of them needs git:

- **What the source says**: name, position, products, intervals, datums. The next refresh fetches it again.
- **State a refresh carries forward**: stations the source stopped listing (kept inactive so an ID is never reused), datums the source left out this time, CO-OPS `established`/`removed`, USACE `series` and `zero_since`. This is state, and the lake can hold it.
- **What a person decided**: `tide_station` and hand-entered gauge zero dates. As of 2026-11-04 no station has a hand-set `tide_station`, and the zero dates already live in code (`src/sources/usace/zeros.ts`). Decisions like these go in code, where a PR reviews them.

The committed `datum` used to guard the lake's files, but the files guard themselves: every series row records its `datum`, and `refuseOtherDatum` refuses any write in another.

## Lake layout

New paths beside the ones in [data.md](data.md):

```
stations.parquet                                   published list: every source's, plus bounds
stations/<source>.parquet                          one source's list, every station it has listed
stations/bounds.parquet                            first and last per station, written by compaction
history/stations/<source>/<run>.parquet            the source's list before each refresh
history/stations/<source>/<run>.json               what that refresh changed
archive/<source>/<station>/<epoch>/<year>.parquet  levels from a datum epoch that couldn't be converted
```

- **`stations/<source>.parquet`** has the `stations.parquet` columns except `first`/`last`, plus:
  - `datum_since`, when the current datum took effect;
  - `epochs`, the station's datum history (below);
  - `extra`, a JSON column for the source's own fields (USACE `series`, CO-OPS `established`/`removed`).
- **`stations.parquet`** is rebuilt from the per-source files and `bounds.parquet` at the end of every refresh and every compaction. Only the per-source files and `bounds.parquet` hold state, so the published file can always be rebuilt from them.
- **One writer per file.** A source's refresh writes only that source's file, and compaction writes only `bounds.parquet`. Sources refresh independently, and compaction can't overwrite a refresh. The rebuild of `stations.parquet` runs in the `lake` concurrency group.

## A refresh

1. Read `stations/<source>.parquet`, the previous list, from the lake.
2. Fetch the source's list with `stations(previous)`, as now.
3. Merge with `mergeStationList`, and apply the datum rules below.
4. Apply the source's `overrides.ts`: hand decisions such as a `tide_station`, a pinned USACE series or a forced datum.
5. Run the guards. Any one of these keeps the previous list and exits nonzero:
   - the fetch failed;
   - the list is empty;
   - it shrank sharply (`shrankSharply`);
   - more stations changed datum at once than the source's limit (below).
6. Copy the previous list to `history/stations/<source>/<run>.parquet`, then write the new list.
7. Write the change report next to the snapshot, and print it to the job summary: stations added, retired, and changed field by field, plus datum epochs opened.
8. Rebuild `stations.parquet`.

**Rollback:** copy a snapshot back to `stations/<source>.parquet` and rebuild. Turn on R2 bucket versioning as a backstop, since the lake is now the only copy.

**Local runs:** `WATER_LEVELS_LAKE=data` behaves the same against a local directory. On an empty lake, the first refresh lists every station as new. Read-only tools, such as the TICON inventory, read the public bucket over HTTPS. Tests use fixtures only.

**Starting:** a one-time `ingest seed-stations` writes main's committed lists into the lake. Check it with DuckDB `EXCEPT` both ways against the published `stations.parquet`. The PR after that removes `stations/` and the seed command.

## Datum changes

USACE's `zero_since` handles one kind of datum change today. CWMS keeps one series across a gauge zero reset, so the reset date is entered by hand, and backfill never fetches before it. A station's files then hold one zero, and a person deletes any rows from before the date that are already in the lake.

The general rule: **a station's public series holds only levels in its current datum epoch, converted into it where that's possible.** A zero reset, a change of datum name, and a change back are all the same event.

### Epochs

An epoch is a span of time over which a station's levels share one reference:

```
epochs: [{ datum, since, until, datums }]
```

- `datum` is the label, such as `PNP` or `GZ`. A label alone doesn't identify an epoch, because a zero reset keeps the label (`GZ` before and after) while the reference moves.
- `since` and `until` bound the epoch. The last epoch has no `until`, and its `since` is the station's `datum_since`.
- `datums` holds the offsets to other datums that applied during the epoch, such as `{ NAVD88: 1.23 }`. Offsets are copied in when the epoch opens, because a source usually publishes only its current ones.

Each epoch is numbered by its position in the list, so archive paths stay unique even when a label repeats.

### When an epoch opens

A refresh opens a new epoch when either:

- the source reports another datum label for the station; or
- `overrides.ts`, which is what `zeros.ts` becomes, enters a reset for the station that is later than its `datum_since`. A same-label reset is invisible to the adapter, so only a person can enter it.

The new epoch's `since` is the latest of these:

1. the effective date the source gives, such as PEGELONLINE's `gaugeZero.validFrom`;
2. the date in `overrides.ts`;
3. the `datum_since` already in the lake, so no refresh can move it earlier;
4. failing all of those, the time of the first refresh that saw the change.

The previous epoch gets `until` = the new `since`, and the station stays active. Today's "mark inactive and exit nonzero" goes away. The change report lists the new epoch instead.

### What ingest does to the series

The step runs once, after the refresh writes the new epoch, for every product the station has. For each year file that has any rows from before the new epoch's `since`:

- **Convertible:** if the old and new epochs share a reference datum R in their `datums` maps, convert each old row:

  ```
  level_new = level_old + datums_old[R] − datums_new[R]
  ```

  Then rewrite the file in the new datum. If several references are shared, use the first in a fixed order (NAVD88, NAP, NHN, MSL), so the result is reproducible.

- **Not convertible:** move the rows from before `since` to `archive/<source>/<station>/<epoch>/<year>.parquet`, then rewrite the year file without them. Archived rows stay out of `stations.parquet` and the API, but nothing is deleted.

Rows from `since` onward are fetched again in the new datum, as a backfill bounded below by `datum_since`. That covers values the hourly job stored in the old datum before the change was noticed. A source that re-serves its whole history in the new datum still fills only the years from `since` on. Re-fetching earlier years would mean deciding that the source's own conversion is right, which is a call for `overrides.ts`.

`backfill` and `recent` never fetch before `datum_since`, as `zeroSince` bounds USACE today. The recent window drops the station's rows from before `since`, since recent rows don't carry a datum. `refuseOtherDatum` stays, so a file still never holds two datums.

### A gauge that changes datum more than once

Each change opens one more epoch, and the step above runs again. The public series always ends up in the newest epoch's datum.

- **Converting composes through the shared reference, not through a chain.** Rows from epoch 1 that were converted into epoch 2 are, after the next change, converted again with epoch 2's and epoch 3's offsets. Each conversion is exact, so the total equals a direct conversion from epoch 1 to 3. No rounding builds up beyond the FLOAT storage of each rewrite, about 0.1 mm.
- **Rows that couldn't be converted earlier stay archived under their own epoch.** A later epoch never pulls them back, since nothing has changed about whether they can be converted. A person who finds a shared reference adds it to that epoch's `datums` in `overrides.ts`, and the next refresh converts them.
- **When one change can't be converted, everything before it gets archived.** That includes rows converted into the epoch from earlier ones, which are archived in the form they were converted to. Their own epoch's archive keeps any originals that were never converted.
- **A change back (A → B → A) is a new epoch, not a return to the old one.** The label matches but the reference may not, so the epochs' `datums` decide whether to convert, as for any other change.
- **Several changes between two refreshes** are seen as one. The refresh sees only the current datum, so it opens one epoch from the latest `since` it can find. Any reference that was in force in between shows up only in the source's own history, and can be entered in `overrides.ts`.
- **Every rewrite of a year file is a whole-file write.** As with compaction, a failed run leaves the previous file. The step is idempotent: run again, it finds no rows before `since` in the public files and does nothing.

### Guards

- **Many changes at once:** if more than a source's limit of stations open an epoch in one refresh (default 5 stations or 2%, whichever is larger), it's an adapter bug more likely than gauge work. The refresh keeps the previous list and exits nonzero.
- **Rapid changes:** a station that opens a second epoch within 30 days of its last one is held in its current epoch, with a nonzero exit and a line in the report, until `overrides.ts` confirms it. A source flapping between two labels then can't keep archiving the station's history.
- **Nothing archived is ever deleted** by ingest. Undoing a wrong epoch means removing it in `overrides.ts`, copying back the snapshot, and moving the archive back. That's a documented manual step, not a command, until it's needed.

## What changes in the code

- `src/stations.ts`: `mergeStationList` opens epochs instead of marking a station inactive. `first`/`last` leave the merge.
- `src/lake/`: readers and writers for the per-source lists, bounds, history and archive. A `rebaseStation` step converts or archives a station's series files.
- `scripts/ingest.ts`: `stations` reads and writes the lake as above. `seed-stations` is temporary.
- `src/sources/<source>/overrides.ts`: hand decisions per source. USACE's `zeros.ts` moves into it, and its test, which now reads `stations/usace.json`, checks the overrides against the lake list instead.
- Removed: `stations/`, its `.prettierignore` entry, and the docs that describe committing it ([plan.md](plan.md) repo shape and phase 4's monthly PR, CONTRIBUTING).
- The open USGS PR drops its `stations/usgs.json`.

## What this gives up

- **No reviewed diff of station changes.** The change report and guards replace PR review. A station that moves or is renamed shows only in the report.
- **The lake is the only copy of the station lists.** Snapshots and bucket versioning cover that.
- **A hand decision needs a code PR.** That is the right weight for something that changes how a station's history is stored.
