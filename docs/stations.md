# Station lists in the lake

**Status: proposed.** This replaces the committed `stations/<source>.json` lists and the "a station has one datum for its whole record" rule in [plan.md](plan.md) decision 4. Nothing here is built yet, and the other docs describe the system as it runs today.

Each source's station list lives in the lake, not in git. A new source adds only code: its adapter, README, fixtures and tests. No ingest run changes a file in the repo. A station that changes datum, once or many times, stays active: each datum epoch gets series files of its own, and `stations.parquet` says how to put the epochs together.

## Why the lists can leave git

The committed lists hold three kinds of thing, and none of them needs git:

- **What the source says**: name, position, products, intervals, datums. The next refresh fetches it again.
- **State a refresh carries forward**: stations the source stopped listing (kept inactive so an ID is never reused), datums the source left out this time, CO-OPS `established`/`removed`, and USACE `series`. This is state, and the lake can hold it.
- **What a person decided**: `tide_station` and hand-entered gauge zero dates. As of 2026-11-04 no station has a hand-set `tide_station`, and the zero dates already live in code (`src/sources/usace/zeros.ts`). Decisions like these go in code, where a PR reviews them.

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
epochs: [{ id, datum, since, until, seen, reference, datums, to_current, state }]
```

- `id` counts up from 1 and is never reused. The next `id` is above both the list's epochs and any epoch directory already in the lake, so a list restored from a snapshot can't hand out an `id` that already has files.
- `since` and `until` are instants in UTC. The first epoch's `since` is null when the record has no known start, and the current epoch has no `until`. Rows in an epoch's files outside `[since, until)` aren't part of the series. That's how the uncertain stretch around a change stays out without being moved.
- `seen` is the last refresh whose fetch named this epoch's datum. A refresh in which the source left the datum out doesn't advance it, so it says how long the old reference was really confirmed.
- `reference` is what the source says identifies the reference, where it says anything: PEGELONLINE's `gaugeZero.validFrom`.
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
```

[data.md](data.md) would give the full query, and the API does the same. A reader that reads one epoch's files gets one datum, as before. Rows from an epoch that can't be converted stay in the lake, readable in their own datum, but outside the combined series.

### When an epoch opens

A refresh opens an epoch for a station when:

- the source reports another datum label;
- the source reports a new `reference` under the same label: PEGELONLINE's `gaugeZero.validFrom` changing. A changed `gaugeZero.value` under the same `validFrom` is a re-survey of the zero's height, not a moved zero, so it only updates `datums`, like any other offset. A station's first refresh after seeding records its `reference` without opening an epoch;
- `overrides.ts`, which is what `zeros.ts` becomes, enters a reset later than the current epoch's `since`.

**When it began.** The new epoch's `since` is the first of these that exists:

1. the instant the source gives;
2. the date in `overrides.ts`, read with the adapter's day boundary. For USACE that's 06:00 UTC, local midnight or later at every office, as `zeroSince` uses today;
3. the time of the refresh that saw the change.

**When the old one ended.**

- A date without a time, as both PEGELONLINE's `validFrom` and the override dates are, leaves the whole day out of both epochs. The old epoch ends at the start of the day and the new one starts with the adapter's next day boundary, because nobody knows when in the day the change came. An override can end the old epoch earlier with an `until`, as `zeros.ts`'s "sometime during March 2019" needs.
- In case 3 the change came sometime after the old epoch's `seen`, so the old epoch ends there.

Rows in between are in the lake, in the old epoch's files, but outside both spans. A source that keeps that stretch is backfilled into the new epoch from its `since`. Rows a source no longer serves, such as PEGELONLINE's beyond its 31 days, stay out of the combined series; giving them to an epoch would be a later override.

A `since` no later than the current epoch's is refused. The station is held, and the report says so.

**Detected between refreshes.** Adapters that refuse values in another datum, as PEGELONLINE's `levels` does, make `recent` fail for that station. `recent` records the failure and goes on, and the next station refresh opens the epoch. With phase 4's monthly refresh that's up to a month, so phase 4 should also run `stations` daily for a source with such a failure.

### When epochs convert

`to_current` is set only when the two epochs share a fixed reference R:

```
to_current = epoch.datums[R] − current.datums[R]
```

- R is a geodetic datum in the same realization in both epochs: NAP, NHN, NN, HN, NGVD29, or NAVD88 with its realization recorded, such as `NAVD88(2009.55)`. Tidal datums such as MSL, MLLW and LAT never count, because each tidal epoch moves them.
- An epoch's own datum counts as R with offset 0. So a PEGELONLINE station that goes from PNP, with `datums.NN`, to NN converts exactly. PNP with `datums.NHN` to NN doesn't, since NN and NHN are different height systems.
- Where the epochs share more than one R, the first in that order is used.
- **A same-label reset never converts on its own.** Offsets that changed across it might mean the zero moved, or only that its height was re-surveyed (MVK Helena and Bogalusa, which `zeros.ts` leaves out for that reason). Offsets that stayed the same might mean the offsets never followed the reset. A person who knows which sets `to_current` for that epoch in `overrides.ts`.

Because each epoch converts straight to the current one, conversions never chain, and a station with many epochs gains no error from the number of changes. When the current epoch's offsets are re-levelled, every `to_current` follows at the next refresh, which is right: the older epochs' frozen offsets haven't changed.

USACE stations carry an NGVD29 or NAVD88 offset at 984 of 1,353 stations. Their resets are same-label (`GZ`), so they keep today's behavior until a person decides: rows from before the reset stay out of the combined series. The difference from today is that those rows can stay in the lake under epoch 1, rather than being deleted by hand.

### A gauge that changes datum more than once

Each change opens one more epoch, with its own files. Nothing about earlier epochs changes except their `to_current`, which is recomputed against the new current epoch:

- epoch 1 converts to epoch 3 if they share a fixed reference, whether or not epoch 2 did;
- an epoch that can't convert drops out of the combined series, and its files stay as they are;
- a change back (A → B → A) is a new epoch, not a return to an old one. The label matches, but the reference may not have;
- several changes between two refreshes show up as one. The source's own dates, or `overrides.ts`, can enter the epochs in between; otherwise their rows fall in the gap.

A station that keeps changing is held. A change within 180 days of the current epoch's `since`, or a label returning to one of the station's earlier ones, opens the epoch as `held`. While held, the station's `backfill` and `recent` skip it, and the report lists it, until `overrides.ts` confirms or rejects the change. 180 days spans several refreshes at any cadence, so a source that flips labels gets one epoch at most before a person looks.

**Undoing an epoch** is an entry in `overrides.ts` marking it `rejected`. For example, an adapter bug misread a label, so the reference never changed. A rejected epoch's span goes back to the epoch before it: that one's `until` is cleared, and the rejected epoch's files are read as the earlier epoch's, with `to_current` 0, unless the entry gives another offset. No file moves, so an undo can itself be undone. Entries are marked, never deleted: as `zeros.ts` says today, removing a reset date would let a backfill write the old zero's values back.

## Lake layout

New paths beside the ones in [data.md](data.md). `<station>` is the URL-encoded `source_id`.

```
stations/<source>.parquet                    one source's list: every station it has listed, with epochs
stations/bounds/<source>.parquet             first and last per station, written by compaction
history/stations/<source>/<time>.parquet     the source's list as each refresh started
history/stations/<source>/<time>.json        what that refresh changed
```

- **`stations/<source>.parquet`** has the `stations.parquet` columns except `first`/`last`, plus `epochs` and an `extra` JSON column for the source's own fields (USACE `series`, CO-OPS `established`/`removed`). Reading a list spreads `extra` back onto each station, so adapters, `backfill` and `recent` see those fields as they do today. USACE's `zero_since` becomes the current epoch's `since`.
- **`stations.parquet`** is rebuilt from the per-source lists and bounds. All the state is in those, so the published file can always be rebuilt. Each of them is written only by jobs in its source's group: the refresh, a restore and the seed write the list, and compaction writes the bounds.
- **`<time>`** is the refresh's start time to the second, so a re-run never overwrites an earlier snapshot.
- **Restricted sources.** A source's terms decide which lake holds its list, history and series. A source that mixes open and restricted stations is split into two source IDs, as GESLA's contributors would be, and a refresh refuses a list holding a station whose `commercial_use` differs from its source's. A restricted lake keeps its own `stations.parquet`. Whether the public one should also list restricted stations, metadata only, as [plan.md](plan.md) decision 1 expects, is settled with the first restricted source.

## A refresh

1. Read the previous list from the lake.
2. Fetch with `stations(previous)`, as now.
3. Merge with `mergeStationList`, and open, hold or close epochs as above.
4. Apply the source's `overrides.ts`: a `tide_station`, a pinned USACE series, a reset date, an epoch's `to_current`, a rejection.
5. Run the guards. Any one of these keeps the previous list and exits nonzero:
   - the fetch failed;
   - the list is empty;
   - it shrank sharply (`shrankSharply`);
   - the lake has no list for the source but does have its history. A list that went missing would otherwise read as an empty lake, and every station would be rebuilt from scratch;
   - more stations opened an epoch than the source's limit, by default 5 stations or 2%, whichever is larger. That's likelier an adapter bug than gauge work. A person who has checked it reruns with `--accept-epochs`, so a real batch of changes doesn't hold up the source for good.
6. Copy the previous list to history, then write the new list.
7. Write the change report next to the snapshot, and add it to the job summary: stations added, retired and changed field by field, plus epochs opened, held and rejected.

**Jobs.** `stations` with no source runs as a matrix, one job per source in a `lake-<source>` group, which `backfill`, `recent` and compaction of that source share. A final job, with `if: always()`, rebuilds `stations.parquet` in its own `lake-stations` group. Within a group, GitHub cancels a pending run when a newer one queues; for the rebuild that's harmless, because each run reads every list fresh. A cancelled source run leaves no summary, so the scheduled workflow checks each source's list age instead, and the next run does the work. This is phase 4 workflow work, alongside the daily refresh above. Today's `ingest.yml` has one `lake` group for every run. Local runs (`WATER_LEVELS_LAKE=data`) have no group.

**Backups.** The lake becomes the only live copy of the station lists, and some of what they hold can't be fetched again: retired stations, USACE series pins, and closed epochs' frozen offsets. History snapshots sit in the same bucket and are written by the same job that could damage a list. So every refresh also writes its snapshot to `WATER_LEVELS_BACKUP`, a location outside the lake, when that's set. Nothing relies on R2 object versioning.

**Restoring a list** copies a snapshot back to `stations/<source>.parquet` and rebuilds. The series files never change for an epoch, so any snapshot is safe to restore. A station's epochs go back to what the snapshot says, and files written under an epoch it doesn't have stay in the lake, unread. The restore runs the source's refresh straight after, before any `backfill` or `recent`, so an epoch the source or `overrides.ts` still reports opens again, under a new `id`, and is backfilled.

**Local runs and tools.** `WATER_LEVELS_LAKE=data` behaves the same against a local directory. On an empty lake, the first refresh lists every station as new. Read-only tools, such as the TICON inventory, get a reader for the public bucket over HTTPS. Tests use fixtures only.

## Starting

1. **Seed.** A one-time `ingest seed-stations` writes main's committed lists into the lake. Each station gets one epoch: `{ id: 1, datum, since: zero_since at 06:00 UTC, or the start of time }`. Every existing series file is epoch 1 already, at its current path, so nothing in the series is rewritten. Seeding sets USACE's `since` from `zero_since`, so the 33 `zeros.ts` entries open no epoch on the first refresh.
2. **Recent files.** A `recent/<source>.parquet` written before the switch has no `epoch` column, and is read as epoch 1.
3. **Check.** Build a `stations.parquet` from main's lists with today's code, and one from the seeded lists, and compare them with DuckDB `EXCEPT` both ways. Don't compare against the published file, which a manual run may have refreshed since main. Compare `extra` with the JSON lists field by field, since `stations.parquet` doesn't carry it.
4. **Switch.** The PR after that removes `stations/` and the seed command.

**Rolling the code back** past the switch isn't supported. A revert brings back the station files as they were at the switch, but the old build knows nothing of epochs, so it could write a new epoch's values into epoch 1's files under the same label. Roll forward instead. If an old build does run, the lake lists still bound what the new build reads afterwards: epoch 1's `until` leaves out anything written after it.

## What changes in the code

- `src/stations.ts`: `mergeStationList` opens epochs instead of marking a station inactive. `first`/`last` leave the merge.
- `src/lake/`: epoch paths, the `epoch` column in `recent`, readers and writers for the lists, bounds and history, and an HTTPS reader for the public bucket.
- `scripts/ingest.ts`: `stations`, `backfill` and `recent` read the lists from the lake, write the current epoch, and skip held stations. `seed-stations` is temporary.
- `src/sources/<source>/overrides.ts`: hand decisions per source. USACE's `zeros.ts` moves into it. Its test now checks the overrides against the lake list instead of `stations/usace.json`.
- `src/sources/pegelonline`: report `gaugeZero.validFrom` as the station's `reference`.
- `src/sources/usace/index.ts`: `zero_since` becomes the current epoch's `since`.
- `scripts/ticon-inventory.ts`: read the lists from the lake.
- `.github/workflows/`: the per-source matrix, the rebuild job, and the daily refresh after a datum failure (phase 4).
- Tests that pin today's behavior change with it: `test/stations.test.ts` (inactive on a datum change) and `test/sources.test.ts` (the USACE zero dates against `stations/usace.json`).
- Docs to update when built:
  - [plan.md](plan.md): decision 4, the repo shape, the `Source` interface comment, the columns paragraph, the checklist line, and phase 4's monthly commit;
  - [data.md](data.md): the layout, the epoch paths, the `epochs` column and the combined-series query;
  - [api.md](api.md): the layout and "each station's own datum";
  - the README's layout;
  - the plan's bulk snapshot, which must carry each row's epoch and keep only rows inside their epoch's span;
  - CONTRIBUTING: the layout, the ingest paragraph, and "a station keeps one datum";
  - the README's license paragraph about the copies in `stations/`;
  - the BSH, CO-OPS, PEGELONLINE, RWS and USACE READMEs;
  - the comments in `scripts/ingest.ts`, `scripts/ticon-inventory.ts`, `src/stations.ts` (which also says a series' files carry no datum, though they do), `src/schema.ts`, `src/lake/paths.ts` and `src/sources/usace/index.ts`, and the `stations/<id>.json` error messages.
- The open USGS PR drops its `stations/usgs.json`.
- Readers outside this repo that read series paths directly, tide-database and crowd-depth, need to read `epochs`, or they stop at epoch 1.

## What this gives up

- **No reviewed diff of station changes.** The change report and guards replace PR review, and a station that moves or is renamed shows only in the report.
- **The lake is the only live copy of the station lists.** Snapshots and the quarterly copy cover that.
- **A combined series takes a join.** Readers that want one datum across a station's whole history use `epochs`, not a single file glob. Most stations have one epoch, and for them nothing changes.
- **A held station stops** until `overrides.ts` decides. That's the price of never filling a station's series from a source that keeps flipping its datum.
- **A hand decision needs a code PR.** That's the right weight for something that changes how a station's history is read.
