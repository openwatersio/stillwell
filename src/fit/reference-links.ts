import { dropped, seriesOf, sound } from "../datums.ts";
import { readMatches, sameByData, tooManyStopped, type DataMatch } from "../matches.ts";
import { ID_KM } from "../same-as.ts";
import { exists, readRows } from "../store/parquet.ts";
import { matchesPath, referencesPath, stationsPath } from "../store/paths.ts";
import { km } from "../ticon.ts";
import {
  ASSUMED,
  constantsDigest,
  packageVersion,
  STATED,
  type Link,
  type Reference,
} from "./references.ts";

/**
 * Which slackwater-database records are a station's gauge, for
 * `references.ts` to score. A record counts as the
 * same gauge on what the store records, never on position or name alone:
 *
 * - `id`: the record carries the station's own ID in its source (`seriesOf`),
 *   within `ID_KM`, as a NOAA record does for a CO-OPS station and a TICON
 *   record for the GESLA file it was analyzed from.
 * - `levels`: the record carries the ID of another series of the gauge
 *   (`same_as`) whose hourly levels the store has compared with the
 *   station's and found within 1 cm RMS with no lag (`sameByData`). The
 *   comparison covers the latest years both series hold, so it shows the
 *   two are one series now, not over the years the record was analyzed.
 *
 * A record a link reaches without either, such as a `tide_station` taken from
 * a linked series nothing compared, isn't scored: its constants may describe
 * another gauge on the same water. Nor is a record of a database source whose
 * IDs `seriesOf` joins to no series.
 */

/** The part of a slackwater-database station this reads. */
export interface TideRecord {
  id: string;
  source: { name: string; id: string };
  latitude: number;
  longitude: number;
  epoch?: { start: string; end: string };
  license: { type: string; commercial_use: boolean };
  attribution: string;
  harmonic_constituents: { name: string; amplitude: number; phase: number }[];
}

/** What links a station to records: its position, and its published `same_as`. */
export interface Linked {
  id: string;
  lat: number;
  lon: number;
  same_as: string[];
}

const pair = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

/** The pairs of series whose levels show one gauge: within 1 cm RMS, with no lag. */
const agreeing = (matches: readonly DataMatch[]) =>
  new Set(matches.filter((m) => sameByData(m) && m.lag_h === 0).map((m) => pair(m.a, m.b)));

/**
 * Each station's records to score, from the database's records, the
 * published stations (every series a `same_as` can name, with its position)
 * and the store's level comparisons. `release` names the database's release.
 * Null for a station `published` doesn't hold, whose links can't be told:
 * that is no evidence its records are gone.
 */
export function referenceIndex(
  records: readonly TideRecord[],
  release: string,
  published: readonly Linked[],
  matches: readonly DataMatch[],
): (station: { id: string }) => Reference[] | null {
  const bySeries = new Map<string, TideRecord[]>();
  for (const record of records) {
    const series = seriesOf(record);
    if (!series || dropped(record.id)) continue;
    bySeries.set(series, [...(bySeries.get(series) ?? []), record]);
  }
  const stations = new Map(published.map((s) => [s.id, s]));
  const agree = agreeing(matches);
  // A record carries a series' ID only where it is also where the series is: a far one is a wrong ID.
  const own = (series: Linked) =>
    (bySeries.get(series.id) ?? []).filter(
      (r) => km(series, { lat: r.latitude, lon: r.longitude }) <= ID_KM,
    );
  return ({ id }) => {
    const station = stations.get(id);
    if (!station) return null;
    const found = new Map<string, Reference>();
    const add = (record: TideRecord, link: Link, linked: string | null) => {
      if (found.has(record.id)) return;
      const constituents = record.harmonic_constituents.map(({ name, amplitude, phase }) => ({
        name,
        amplitude,
        phase,
      }));
      if (!constituents.length) return;
      const stated = STATED[record.id.split("/")[0]!];
      found.set(record.id, {
        id: record.id,
        source: record.source.name,
        release,
        link,
        linked,
        nodeCorrections: stated ?? ASSUMED,
        assumed: stated === undefined,
        epoch: record.epoch ?? null,
        license: record.license.type,
        commercialUse: record.license.commercial_use,
        attribution: record.attribution,
        constituents,
        digest: constantsDigest(constituents),
      });
    };
    for (const record of own(station)) add(record, "id", null);
    for (const other of [...station.same_as].sort()) {
      const series = stations.get(other);
      if (!series || !agree.has(pair(id, other))) continue;
      for (const record of own(series)) add(record, "levels", other);
    }
    return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
  };
}

/**
 * `referenceIndex` for a store, from the installed `@slackwater/database`:
 * every tide station there with constants of its own that the database
 * accepts or keeps only as another's duplicate (`sound`), which is still an
 * analysis of the gauge. One it rejects for its constants, clock, datum or
 * range isn't scored. Links come from the store's published
 * `stations.parquet`, which holds every series' `same_as`, and its level
 * comparisons; a series `shown` rejects, as a withheld one, links nothing,
 * whatever a list from before it was withheld says. Throws without
 * `stations.parquet`, since no link could then be told. A store with no
 * comparisons yet has no `levels` links, but one whose comparisons are
 * missing while `source` has scores that rest on them has lost a file, and
 * throws too, so the scores stay. So does one whose comparisons no longer
 * hold up many of `source`'s stored scores at once (`tooManyStopped`), as a
 * file written short would, unless `accept`.
 */
export async function loadReferences(
  store: string,
  source: string,
  shown: (id: string) => boolean,
  accept = false,
): Promise<ReturnType<typeof referenceIndex>> {
  const { loadStations } = await import("@slackwater/database");
  const db = await loadStations();
  const records = db.all.filter(
    (s) => s.kind === "tide" && s.type === "reference" && sound(db.qualityMap.get(s.id)),
  );
  if (!(await exists(stationsPath(store))))
    throw new Error(`no ${stationsPath(store)} to link records by; run \`ingest publish\` first`);
  const published = (await readRows(stationsPath(store)))
    .map((r) => ({
      id: String(r.id),
      lat: Number(r.lat),
      lon: Number(r.lon),
      // DuckDB returns a list as a value holding its items.
      same_as: (r.same_as as { items: unknown[] }).items.map(String),
    }))
    .filter((s) => shown(s.id));
  const compared = await exists(matchesPath(store));
  const scores = referencesPath(store, source);
  // The pairs the source's stored scores rest on, between series that are still shown.
  const rested = new Set(
    ((await exists(scores)) ? await readRows(scores) : [])
      .filter((r) => String(r.link) === "levels" && shown(String(r.linked)))
      .map((r) => pair(String(r.id), String(r.linked))),
  );
  if (!compared && rested.size)
    throw new Error(
      `no ${matchesPath(store)}, which ${source}'s reference scores rest on; run \`ingest matches\` first`,
    );
  const matches = compared ? await readMatches(store) : [];
  const agree = agreeing(matches);
  const lost = [...rested].filter((p) => !agree.has(p));
  if (tooManyStopped(lost.length, rested.size) && !accept)
    throw new Error(
      `${matchesPath(store)} no longer shows ${lost.length} of the ${rested.size} pairs ${source}'s reference scores rest on agreeing; scores unchanged. Check the file and rerun with --accept-matches`,
    );
  return referenceIndex(records, packageVersion("@slackwater/database"), published, matches);
}
