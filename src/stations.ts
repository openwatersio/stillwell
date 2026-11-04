import type { ListedStation, Station } from "./schema.ts";

/** A station whose source now reports it in another datum. */
export interface DatumChange {
  id: string;
  from: string;
  to: string;
}

/**
 * Merge a source's fresh station list into the committed one. Fields the lake
 * fills in later survive, and a station the source stopped listing stays,
 * marked inactive, so its ID is never reused.
 *
 * A series' files carry no datum of their own, so a station never changes
 * datum here. One the source now reports in another datum keeps its committed
 * record, inactive, and comes back in `changed` for a person to resolve. A
 * station the source listed without a datum keeps the committed one, and a new
 * station without one isn't listed until the source names it.
 */
export function mergeStationList(
  previous: Station[],
  fetched: ListedStation[],
): { stations: Station[]; changed: DatumChange[] } {
  const byId = new Map(previous.map((s) => [s.id, s]));
  const listed = new Set<string>();
  const changed: DatumChange[] = [];
  const merged: Station[] = [];
  for (const s of fetched) {
    if (s.id !== `${s.source}/${s.source_id}` || s.source.includes("/"))
      throw new Error(`Station ${s.id} isn't <source>/<source_id>`);
    const old = byId.get(s.id);
    if (s.datum === null && !old) continue;
    listed.add(s.id);
    if (old && s.datum !== null && s.datum !== old.datum) {
      changed.push({ id: s.id, from: old.datum, to: s.datum });
      merged.push({ ...old, status: "inactive" });
      continue;
    }
    merged.push({
      ...s,
      datum: s.datum ?? old!.datum,
      datums: s.datum === null ? old!.datums : s.datums,
      first: s.first ?? old?.first ?? null,
      last: s.last ?? old?.last ?? null,
      tide_station: s.tide_station ?? old?.tide_station ?? null,
    });
  }
  const stations = [
    ...merged,
    ...previous
      .filter((s) => !listed.has(s.id))
      .map((s) => ({ ...s, status: "inactive" as const })),
  ].sort((a, b) => a.id.localeCompare(b.id));
  return { stations, changed };
}

/** Make `same_as` links run both ways, whichever list recorded them. */
export function linkBothWays(stations: Station[]): Station[] {
  const links = new Map<string, Set<string>>();
  for (const s of stations)
    for (const other of s.same_as) {
      links.set(s.id, (links.get(s.id) ?? new Set()).add(other));
      links.set(other, (links.get(other) ?? new Set()).add(s.id));
    }
  return stations.map((s) => ({ ...s, same_as: [...(links.get(s.id) ?? [])].sort() }));
}
