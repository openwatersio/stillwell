import { urlSafe } from "./store/paths.ts";
import { ID_KM, UNLINKS } from "./same-as.ts";
import { isDropped } from "./sources/gesla/dropped.ts";
import type { Epoch, StoredStation } from "./schema.ts";
import { distanceKm as km } from "./stats.ts";
import { sources } from "./sources/index.ts";

/**
 * Offsets to MSL, LAT and chart datum for each station, and its link to
 * slackwater-database, worked out as `stations.parquet` is built. Each offset says
 * where it came from (`datums_source`):
 *
 * - **slackwater-database**: the station's own record in slackwater-database, joined by
 *   provider ID within `ID_KM`, when the record's datums are in the same zero
 *   as the station's levels (`zeroOf`). Its MSL, LAT and chart datum replace
 *   the source's.
 * - **source**: what the source itself gives.
 * - **computed**: carried from another series of the same gauge (`same_as`)
 *   through a reference both give an offset to (`REFERENCES`), such as BSH's
 *   SKN to a PEGELONLINE gauge through NHN, or else through the offset
 *   measured between the two series' levels (`src/links.ts`).
 *
 * Prediction aliases cannot override explicit instrument separations; eligible peers can still supply a record.
 *
 * Offsets describe the current epoch, as `datums` always has; older epochs
 * reach them through `to_current` (`offsetRows`).
 */

/** The part of a slackwater-database station this needs. */
export interface TideStation {
  id: string;
  source: { id: string };
  latitude: number;
  longitude: number;
  datums: Record<string, number>;
  /** Whether the record's terms allow commercial use. */
  license: { commercial_use: boolean };
  /** The credit slackwater-database asks for wherever the record's values are shown. */
  attribution: string;
  datum_frame?: "gauge" | "constituent";
  chart_datum?: string;
  epoch?: Period;
  datum_epoch?: Period;
  /**
   * For a record slackwater-database keeps only as another's duplicate or
   * superseded copy, the accepted station that replaces it, or null when it
   * doesn't name one. Absent for an accepted record.
   */
  redundant?: string | null;
}

/** A datum's reduction period, as whole days. */
export interface Period {
  start: string;
  end: string;
}

export type DatumSource = "source" | "slackwater-database" | "computed";

/** Where a station's chart-datum offset came from: slackwater-database's record of this series, the source, or none. */
export type Frame = "gauge" | "source" | "unknown";

/** The store source whose station IDs each slackwater-database source's records carry. */
const JOINS: Record<string, string> = {
  noaa: "coops",
  ticon: "gesla",
  kartverket: "kartverket",
  jma: "jma",
};

/**
 * The store series a slackwater-database record carries the ID of: the series
 * its source's own station ID names, such as CO-OPS's for a NOAA record and
 * the GESLA file's for a TICON record. Undefined for a source whose IDs name
 * no series in the store.
 */
export function seriesOf(record: { id: string; source: { id: string } }): string | undefined {
  const source = JOINS[record.id.split("/")[0]!];
  return source && `${source}/${urlSafe(record.source.id)}`;
}

/** The datums slackwater-database gives a station, besides its chart datum. */
const FROM_TIDE = ["MSL", "LAT"];

/**
 * References an offset can be carried through between two series of a gauge:
 * national height systems, and Admiralty Chart Datum, which is fixed per UK
 * port. NAVD88 counts only with its realization. Tidal datums such as MSL
 * never count, since each tidal epoch moves them.
 */
const REFERENCES = ["NAP", "NHN", "NN", "HN", "NGVD29", "RH2000", "AOD", "ACD"];
const isReference = (key: string) => REFERENCES.includes(key) || /^NAVD88\(.+\)$/.test(key);

/**
 * What a GESLA record's `datum_information` says its zero is, where that's a
 * reference, so a record slackwater-database matched can carry its datums to the
 * originator's series.
 */
const GESLA_ZEROS: [RegExp, string][] = [
  [/^Normal Amsterdam Level$/, "NAP"],
  [/^RH 2000\b/, "RH2000"],
  [/^Admiralty Chart Datum\b/, "ACD"],
];

/** Datums a tidal epoch moves, which a source's `datums_period` dates. */
const TIDAL_DATUMS = ["MHHW", "MHW", "DTL", "MTL", "MSL", "MLW", "MLLW", "LAT", "HAT"];

/** The span a station's source says it reduced the station's tidal datums over, kept in its list as `datums_period`. */
const periodOf = (s: StoredStation) => (s as { datums_period?: Period | null }).datums_period;

/** Keys carried between a gauge's series, besides each series' chart datum. */
export const CARRIED = ["MSL", "LAT", "SKN"];

/** Chart datums fixed for a whole stretch of coast or river, which carry between series of a gauge however far apart. */
const FIXED_CHARTS = ["SKN", "CD"];

/** Tidal datums such as MSL and LAT carry only between series of a gauge this close, in km. */
export const TIDAL_KM = 1;

/** Where slackwater-database's value and the source's differ by more than this, publish reports it. */
const DISAGREE_M = 0.05;

/**
 * The most an epoch a reduction period overlaps may convert by, so datums
 * reduced partly from values in its reference stay within this of the current
 * one's: RWS's revision of NAP in 2005 moved most Dutch gauges by a few
 * centimeters at most.
 */
const MIXED_M = 0.05;

export interface DatumReport {
  /** Stations joined to a slackwater-database record, and those whose datums it gave. */
  joined: number;
  fromTide: number;
  computed: number;
  /** ID joins dropped as too far apart: station, record, km. */
  far: string[];
  /** Where slackwater-database and the source differ by more than `DISAGREE_M`. */
  disagree: string[];
}

/**
 * Each station with its `tide_station`, its `datums` gaining MSL, LAT and
 * chart datum where they can be had, `datums_source`, `datums_epoch`,
 * `chart_datum` and `frame`. Stations must already be linked (`linkGauges`).
 * `shifts` are measured offsets between linked series (`linkShifts`).
 */
export function withDatums(
  stations: StoredStation[],
  tide: TideStation[],
  shifts: Map<string, number> = new Map(),
): { stations: StoredStation[]; report: DatumReport } {
  const report: DatumReport = { joined: 0, fromTide: 0, computed: 0, far: [], disagree: [] };
  const byId = new Map(stations.map((s) => [s.id, s]));
  const records = new Map<string, { record: TideStation; zero: number | undefined }>();
  for (const t of tide) {
    if (dropped(t.id)) continue;
    const prefix = t.id.split("/")[0]!;
    const join = (station: StoredStation | undefined, zero: number | undefined) => {
      if (!station) return;
      const distance = km(station, { lat: t.latitude, lon: t.longitude });
      // A position that isn't a number can't vouch for an ID.
      if (!(distance <= ID_KM)) report.far.push(`${station.id} ${t.id} ${distance.toFixed(1)} km`);
      else {
        const joined = {
          record: t,
          zero:
            t.datum_frame !== "constituent" &&
            allowed(t, station) &&
            // A record that doesn't say when it was reduced could span any epoch.
            usable(station, t.datum_epoch ?? t.epoch ?? ALL_TIME)
              ? zero
              : undefined,
        };
        // A record whose datums can be used wins, then an accepted one over a copy,
        // then the later reduction, then the lower ID, so the database's order doesn't matter.
        const rank = (j: typeof joined) => [
          j.zero !== undefined ? 1 : 0,
          j.record.redundant === undefined ? 1 : 0,
          Date.parse((j.record.datum_epoch ?? j.record.epoch)?.end ?? "") || 0,
        ];
        const had = records.get(station.id);
        const order = had && compare(rank(joined), rank(had));
        if (!had || order! > 0 || (order === 0 && t.id < had.record.id))
          records.set(station.id, joined);
      }
    };
    const own = byId.get(seriesOf(t) ?? "");
    if (own) join(own, zeroOf(own, t));
  }
  report.joined = records.size;
  const constituent = new Set(tide.filter((t) => t.datum_frame === "constituent").map((t) => t.id));

  const out = new Map<string, StoredStation>();
  for (const s of stations) {
    const { record, zero } = records.get(s.id) ?? {};
    const datums_source: Record<string, DatumSource> = Object.fromEntries(
      Object.keys(s.datums).map((k) => [k, "source"]),
    );
    const candidate =
      s.tide_station ?? (record?.redundant === undefined ? record?.id : record.redundant) ?? null;
    const replacement = candidate;
    const slash = replacement?.indexOf("/") ?? -1;
    const source = slash > 0 && JOINS[replacement!.slice(0, slash)];
    const replacedBy = source && `${source}/${urlSafe(replacement!.slice(slash + 1))}`;
    // A duplicate in the prediction catalog cannot override a known instrument separation in the store.
    const members = new Set([s.id, ...s.same_as]);
    const replacementMembers = new Set(
      replacedBy ? [replacedBy, ...(byId.get(replacedBy)?.same_as ?? [])] : [],
    );
    const distinct = UNLINKS.some(
      ({ a, b }) =>
        (members.has(a) && replacementMembers.has(b)) ||
        (members.has(b) && replacementMembers.has(a)),
    );
    const station: StoredStation = {
      ...s,
      datums: { ...s.datums },
      datums_source,
      // The span a source says it reduced its tidal datums over, as CO-OPS does.
      datums_epoch: Object.fromEntries(
        Object.keys(s.datums)
          .filter((k) => TIDAL_DATUMS.includes(k) && periodOf(s))
          .map((k) => [k, periodOf(s)!]),
      ),
      tide_station: distinct ? null : candidate,
      datums_attribution: [],
      chart_datum: null,
      frame: "unknown",
    };
    if (record && zero !== undefined) {
      const chart = record.chart_datum;
      let gave = false;
      for (const key of [...FROM_TIDE, ...(chart ? [chart] : [])]) {
        const height = record.datums[key];
        if (height === undefined || key === s.datum) continue;
        const offset = round(zero - height);
        const had = s.datums[key];
        if (had !== undefined && Math.abs(had - offset) > DISAGREE_M)
          report.disagree.push(`${s.id} ${key}: source ${had}, ${record.id} ${offset}`);
        station.datums[key] = offset;
        datums_source[key] = "slackwater-database";
        gave = true;
        // The span the source reduced its own values over wins: NOAA's records give the national tidal epoch for CO-OPS's.
        const period = periodOf(s) ?? record.datum_epoch ?? record.epoch;
        if (period) station.datums_epoch![key] = period;
        else delete station.datums_epoch![key];
        if (!station.datums_attribution!.includes(record.attribution))
          station.datums_attribution!.push(record.attribution);
      }
      if (chart && (chart === s.datum || station.datums[chart] !== undefined))
        station.chart_datum = chart;
      if (gave) report.fromTide++;
    }
    // Otherwise the source's own chart datum, before any is carried in.
    const fallback = sources[s.source]?.metadata.chart_datum;
    if (!station.chart_datum && fallback && fallback in offsetsOf(station))
      station.chart_datum = fallback;
    out.set(s.id, station);
  }

  // Carry offsets across each gauge's series until nothing more can be carried.
  const ordered = [...out.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const s of ordered) {
      for (const otherId of s.same_as) {
        const other = out.get(otherId);
        // Nothing from a series whose terms bar commercial use reaches one that allows it.
        if (!other || (s.commercial_use && !other.commercial_use)) continue;
        const via = sharedReference(s, other);
        const shift = via
          ? offsetsOf(s)[via]! - offsetsOf(other)[via]!
          : shifts.get(`${s.id} ${other.id}`);
        if (shift === undefined) continue;
        const keys = [...CARRIED, ...(other.chart_datum ? [other.chart_datum] : [])];
        const near = km(s, other) <= TIDAL_KM;
        for (const key of keys) {
          // A tidal datum is the gauge's own; only a fixed chart datum holds along an estuary.
          if (!near && !FIXED_CHARTS.includes(key)) continue;
          const there = offsetsOf(other)[key];
          const period = other.datums_epoch?.[key];
          if (there === undefined || key in offsetsOf(s) || !usable(s, period)) continue;
          s.datums[key] = round(shift + there);
          s.datums_source![key] = "computed";
          if (period) s.datums_epoch![key] = period;
          // The linked station's offsets are used, so its credit goes with them.
          for (const credit of [other.attribution, ...other.datums_attribution!])
            if (credit && !s.datums_attribution!.includes(credit))
              s.datums_attribution!.push(credit);
          if (key === other.chart_datum && !s.chart_datum) s.chart_datum = key;
          changed = true;
        }
      }
    }
  }

  for (const s of ordered) {
    if (!s.tide_station) s.tide_station = tideStationOf(s, out);
    if (Object.values(s.datums_source!).includes("computed")) report.computed++;
    const joined = records.get(s.id);
    // Predictions from datums in the constituent frame (MSL = 0) can't be compared with levels in absolute terms.
    s.frame = constituent.has(s.tide_station ?? "")
      ? "unknown"
      : frameOf(s, joined?.zero !== undefined && joined.record.id === s.tide_station);
  }
  return { stations: stations.map((s) => out.get(s.id)!), report };
}

/**
 * The height of the station's zero in a slackwater-database record's datums, or
 * undefined when the record is in another zero: a record that names the
 * station's datum (NOAA's STND, Kartverket's CD), or a TICON record in its
 * GESLA file's gauge zero, which is the GESLA station's.
 */
function zeroOf(station: StoredStation, record: TideStation): number | undefined {
  if (record.datums[station.datum] !== undefined) return record.datums[station.datum];
  if (record.id.startsWith("ticon/") && record.datum_frame === "gauge") return 0;
  return undefined;
}

/**
 * Whether datums reduced over `period` apply to the station's current epoch:
 * every epoch the period overlaps converts to the current one, by no more
 * than `MIXED_M`. The period's dates are whole days, so it ends a day after
 * its last.
 */
function usable(station: StoredStation, period: Period | undefined): boolean {
  if (!period) return true;
  const [start, end] = [Date.parse(period.start), Date.parse(period.end) + DAY_MS];
  return station.epochs.every(
    (e) =>
      (e.to_current !== null && round(Math.abs(e.to_current)) <= MIXED_M) ||
      (e.since !== null && Date.parse(e.since) >= end) ||
      (e.until !== null && Date.parse(e.until) <= start),
  );
}

/** Whether a record's terms cover the station's: a record that bars commercial use serves only a station that does too. */
const allowed = (record: TideStation, station: StoredStation) =>
  record.license.commercial_use || !station.commercial_use;

/** A station's offsets with its own datum and any name it has for a reference. */
function offsetsOf(s: StoredStation): Record<string, number> {
  const offsets: Record<string, number> = { ...s.datums, [s.datum]: 0 };
  for (const [name, reference] of Object.entries(sources[s.source]?.metadata.datum_aliases ?? {}))
    if (offsets[name] !== undefined) offsets[reference] ??= offsets[name];
  const note = (s as { datum_information?: string }).datum_information;
  const zero = note && GESLA_ZEROS.find(([pattern]) => pattern.test(note))?.[1];
  if (s.source === "gesla" && zero) offsets[zero] = 0;
  return offsets;
}

/** The first reference both stations give an offset to, in `REFERENCES` order. */
export function sharedReference(a: StoredStation, b: StoredStation): string | undefined {
  const [x, y] = [offsetsOf(a), offsetsOf(b)];
  const keys = [...REFERENCES, ...Object.keys(x).filter((k) => k.startsWith("NAVD88("))];
  return keys.find((k) => isReference(k) && x[k] !== undefined && y[k] !== undefined);
}

/** A linked series' slackwater-database station: the preferred series' first, then by ID. */
function tideStationOf(s: StoredStation, all: Map<string, StoredStation>): string | null {
  const group = [s.preferred, ...[...s.same_as].sort()].filter((id) => id && id !== s.id);
  for (const id of group) {
    const linked = all.get(id!)?.tide_station;
    if (linked) return linked;
  }
  return null;
}

/** `own` is whether the station's slackwater-database record is the one its `tide_station` predicts from. */
function frameOf(s: StoredStation, own: boolean): Frame {
  const chart = s.chart_datum;
  if (!chart) return "unknown";
  if (!own) return "source";
  return chart === s.datum || s.datums_source?.[chart] === "slackwater-database"
    ? "gauge"
    : "source";
}

/** One row of `stations/offsets.parquet`. */
export interface OffsetRow {
  station: string;
  epoch: number;
  datum: string;
  offset_m: number;
}

/**
 * Meters to add to a level in each epoch to refer it to each named datum. An
 * epoch that converts to the current one reaches every current offset through
 * its `to_current`; one that doesn't has only its frozen offsets. A station's
 * own label (RWS's offshore `MSL`, `NAP`, `STND`) isn't the datum of that name,
 * so it gets a row only where it is the station's chart datum, as Kartverket's
 * `CD` is, and only in an epoch that converts. A reader takes a level in its
 * own epoch's reference through `to_current`. `datums` never holds a station's
 * own label, so every other row is a real conversion.
 */
export function offsetRows(s: StoredStation): OffsetRow[] {
  const current = s.datum === s.chart_datum ? { ...s.datums, [s.datum]: 0 } : s.datums;
  // A rejected epoch's levels read as the epoch before it, so frozen offsets are that one's too.
  const frozen = (e: Epoch) =>
    e.state === "rejected"
      ? (s.epochs.filter((b) => b.id < e.id && b.state !== "held" && b.state !== "rejected").at(-1)
          ?.datums ?? e.datums)
      : e.datums;
  return s.epochs.flatMap((e: Epoch) =>
    Object.entries(
      e.to_current === null
        ? frozen(e)
        : Object.fromEntries(
            Object.entries(current).map(([k, v]) => [k, round(e.to_current! + v)]),
          ),
    ).map(([datum, offset_m]) => ({ station: s.id, epoch: e.id, datum, offset_m })),
  );
}

const DAY_MS = 86_400_000;
const ALL_TIME: Period = { start: "0000-01-01", end: "9999-12-30" };

/** Compares two lists of numbers, first difference first. */
const compare = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!).find((d) => d !== 0) ?? 0;

/** A TICON record of a GESLA file whose values are another gauge's. */
export const dropped = (id: string | undefined) =>
  !!id?.startsWith("ticon/") && isDropped(id.slice(6));
const round = (m: number) => Math.round(m * 1e4) / 1e4 + 0; // + 0 turns -0 into 0

/**
 * Rejections that leave a record's datums sound: another record of the same
 * gauge was kept instead. Its datums are still in its own zero, the GESLA
 * file's, so they serve that file's series.
 */
const REDUNDANT = ["duplicate", "superseded"];

/**
 * Whether a record's quality evaluation leaves it sound: the database accepts
 * it, or rejects it only because it kept another record of the same gauge.
 * One rejected for its constants, clock, datum or range isn't.
 */
export const sound = (quality: { accepted: boolean; reason?: string } | undefined): boolean =>
  !quality || quality.accepted || REDUNDANT.includes(quality.reason ?? "");

/**
 * Reference stations in the installed `@slackwater/database` that it accepts,
 * or keeps only as another's duplicate, with the accepted station that
 * replaces each of those.
 */
export async function tideStations(): Promise<TideStation[]> {
  const { loadStations } = await import("@slackwater/database");
  const db = await loadStations();
  const accepted = (id: string | undefined): string | undefined => {
    for (let i = 0; id && !dropped(id) && i < 10; i++) {
      const q = db.qualityMap.get(id);
      if (!q || q.accepted) return id;
      id = q.redundant;
    }
    return undefined;
  };
  return db.all.flatMap((s) => {
    const q = db.qualityMap.get(s.id);
    if (s.type !== "reference" || dropped(s.id)) return [];
    if (!q || q.accepted) return [s as TideStation];
    if (!sound(q)) return [];
    return [{ ...(s as TideStation), redundant: accepted(q.redundant) ?? null }];
  });
}
