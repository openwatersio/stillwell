import {
  currentEpoch,
  epochKey,
  firstEpochs,
  nextEpochs,
  splitStarts,
  type EpochEvent,
  type EpochOptions,
} from "./epochs.ts";
import type { EpochRestart, StoredStation, ListedStation, Station } from "./schema.ts";

/** Something a refresh did to a station's epochs, for the report. */
export interface EpochChange {
  id: string;
  event: EpochEvent;
  from: string;
  to: string;
  reason?: string;
  /** The key a decision on it takes in the source's overrides. */
  key: string;
}

/**
 * Merge a source's fresh station list into the store's. A station the source
 * stopped listing stays, marked inactive, so its ID is never reused. The
 * refresh takes withheld stations out of both lists first, so they leave. What the
 * store can answer (`first`, `last`) isn't kept here; `stations.parquet` gets
 * it from the bounds compaction writes.
 *
 * A station the source now reports against another reference opens a datum
 * epoch (src/epochs.ts), so its new values go to files of their own. A station
 * the source listed without a datum, or without any offsets, keeps the ones it
 * had, and a new station without a datum isn't listed until the source names
 * it. A source that sends no offsets at all keeps the old ones while the datum
 * stays the same, so a refresh that loses them doesn't erase them; one that
 * sends some replaces them all.
 *
 * `seriesChanged` lets a source say a station kept its datum's name but not
 * the series or zero it measures from, such as a USGS gage whose datum moved.
 * That opens an epoch too, from the refresh that saw it, since the source
 * gives no date.
 */
export function mergeStationList(
  previous: StoredStation[],
  fetched: ListedStation[],
  {
    seriesChanged,
    restarts,
    ...options
  }: Omit<EpochOptions, "nextId" | "station"> & {
    seriesChanged?: (previous: Station, listed: ListedStation) => string | null;
    restarts?: Record<string, EpochRestart>;
  },
): { stations: StoredStation[]; changes: EpochChange[] } {
  const byId = new Map(previous.map((s) => [s.id, s]));
  const listed = new Set<string>();
  const changes: EpochChange[] = [];
  const merged: StoredStation[] = [];
  for (const { reference, ...s } of fetched) {
    if (s.id !== `${s.source}/${s.source_id}` || s.source.includes("/"))
      throw new Error(`Station ${s.id} isn't <source>/<source_id>`);
    const old = byId.get(s.id);
    if (s.datum === null && !old) continue;
    listed.add(s.id);
    // Offsets the source left out this time are kept, rather than erased, but
    // only for the same datum: another datum's offsets would be wrong for it.
    const sameDatum = old && (s.datum === null || s.datum === old.datum);
    const omitted = s.datum === null || !Object.keys(s.datums).length;
    const datums = omitted && sameDatum ? old.datums : s.datums;
    let epochs;
    const restart = restarts?.[s.id];
    // Once: a station with an epoch in that datum already has history there, which a restart would orphan.
    if (
      old &&
      restart &&
      s.datum === restart.datum &&
      !old.epochs.some((e) => e.datum === restart.datum)
    ) {
      // Fresh epochs from the start, under ids above the old ones, which are never reused.
      epochs = firstEpochs(
        { datum: s.datum, datums, reference },
        { ...options, station: s.id, nextId: Math.max(...old.epochs.map((e) => e.id)) + 1 },
      );
      changes.push({
        id: s.id,
        event: "opened",
        from: old.datum,
        to: s.datum,
        reason: `restarted in ${s.datum} from the start of its record, replacing its ${old.datum} epochs, by \`restarts\` in overrides; backfill its history`,
        key: epochKey(s.id, epochs[0]!.since),
      });
    } else if (old) {
      const next = nextEpochs(
        old.epochs,
        {
          datum: s.datum,
          datums,
          sent: s.datums,
          reference,
          changed: s.datum === null ? null : seriesChanged?.(old, s),
        },
        { ...options, station: s.id },
      );
      epochs = next.epochs;
      if (next.event)
        changes.push({
          id: s.id,
          event: next.event,
          from: old.datum,
          to: s.datum ?? old.datum,
          reason: next.reason,
          // The epoch a decision would apply to: the one the change names, the held one, or else the newest.
          key: epochKey(
            s.id,
            (next.decide ?? next.epochs.find((e) => e.state === "held") ?? next.epochs.at(-1)!)
              .since,
          ),
        });
    } else {
      epochs = firstEpochs({ datum: s.datum!, datums, reference }, { ...options, station: s.id });
      // A new station with a split is reported as an existing one would be.
      const starts = splitStarts(options.splits?.[s.id], options.offsets);
      const days = epochs
        .filter((e) => starts.has(e.since ?? ""))
        .map((e) => e.since!.slice(0, 10));
      if (days.length)
        changes.push({
          id: s.id,
          event: "opened",
          from: s.datum!,
          to: s.datum!,
          reason: `split where the zero moved on ${days.join(", ")}; backfill the station from ${days[0]}`,
          key: epochKey(s.id, epochs[0]!.since),
        });
    }
    const current = currentEpoch(epochs);
    merged.push({
      ...s,
      datum: current.datum,
      datums: current.datums,
      first: null,
      last: null,
      tide_station: s.tide_station ?? old?.tide_station ?? null,
      epochs,
    });
  }
  const stations = [
    ...merged,
    ...previous
      .filter((s) => !listed.has(s.id))
      .map((s) => ({ ...s, first: null, last: null, status: "inactive" as const })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  return { stations, changes };
}
