import {
  currentEpoch,
  firstEpochs,
  nextEpochs,
  type EpochEvent,
  type EpochOptions,
} from "./epochs.ts";
import type { LakeStation, ListedStation, Station } from "./schema.ts";

/** Something a refresh did to a station's epochs, for the report. */
export interface EpochChange {
  id: string;
  event: EpochEvent;
  from: string;
  to: string;
  reason?: string;
}

/**
 * Merge a source's fresh station list into the lake's. A station the source
 * stopped listing stays, marked inactive, so its ID is never reused. What the
 * lake can answer (`first`, `last`) isn't kept here; `stations.parquet` gets
 * it from the bounds compaction writes.
 *
 * A station the source now reports against another reference opens a datum
 * epoch (src/epochs.ts), so its new values go to files of their own. A station
 * the source listed without a datum, or without any offsets, keeps the ones it
 * had, and a new station without a datum isn't listed until the source names
 * it. A source that sends no offsets at all keeps the old ones while the datum
 * stays the same, so a refresh that loses them doesn't erase them; one that
 * sends some replaces them all.
 */
export function mergeStationList(
  previous: LakeStation[],
  fetched: ListedStation[],
  options: Omit<EpochOptions, "nextId" | "station">,
): { stations: LakeStation[]; changes: EpochChange[] } {
  const byId = new Map(previous.map((s) => [s.id, s]));
  const listed = new Set<string>();
  const changes: EpochChange[] = [];
  const merged: LakeStation[] = [];
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
    if (old) {
      const next = nextEpochs(
        old.epochs,
        { datum: s.datum, datums, reference },
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
        });
    } else
      epochs = firstEpochs({ datum: s.datum!, datums, reference }, { ...options, station: s.id });
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

/** Make `same_as` links run both ways, whichever list recorded them. */
export function linkBothWays<T extends Station>(stations: T[]): T[] {
  const links = new Map<string, Set<string>>();
  for (const s of stations)
    for (const other of s.same_as) {
      links.set(s.id, (links.get(s.id) ?? new Set()).add(other));
      links.set(other, (links.get(other) ?? new Set()).add(s.id));
    }
  return stations.map((s) => ({ ...s, same_as: [...(links.get(s.id) ?? [])].sort() }));
}
