import { errataOf, utcDay, type Erratum } from "../errata.ts";
import { Flag, type Epoch, type SourceMetadata, type StoredStation } from "../schema.ts";
import { readObservationsBetween } from "../store/parquet.ts";
import { seriesPath } from "../store/paths.ts";
import type { YearRow } from "../store/years.ts";
import type { Sample } from "../types.ts";

/**
 * The levels a harmonic fit or a tidal datum reads from a station's year
 * files: every datum epoch in the current datum, only values the source won't
 * revise again, and nothing a `kept` erratum says to leave out.
 */

/** Why a series can't be read for a fit yet. The fit's row carries the message. */
export class Unfit extends Error {}

/**
 * Which values a read takes. `final` is what a fit takes: values the source
 * won't revise again. `measured` is every measured value, final or not, which
 * a datum takes, since it needs complete months more than verified ones.
 */
export type Values = "final" | "measured";

/** What a read used, so a fit can be reproduced and a changed input refits it. */
export interface Inputs {
  /** Each year file's version, by `<epoch> <year>`. */
  versions: Record<string, string>;
  /** The station's epochs as they were read. */
  epochs: Pick<Epoch, "id" | "since" | "until" | "to_current" | "state">[];
  source_qc_start: string | null;
  /** For a source that never finalizes, the instant its measured values were read as final before. */
  settled_before: string | null;
  /** The errata touching the station in the periods read, and what was done with each kept one. */
  errata: Record<string, Pick<Erratum, "handling" | "since" | "until" | "fit">>;
}

export const emptyInputs = (): Inputs => ({
  versions: {},
  epochs: [],
  source_qc_start: null,
  settled_before: null,
  errata: {},
});

/**
 * For a source that never finalizes, the instant its values have settled
 * before: the start of the latest calendar year that began at least
 * `settles_after_months` before `now`, so every year before it ended that
 * long ago. Null for a source that finalizes, which marks its own final
 * values. Throws `Unfit` where the source's revision window isn't known.
 */
export function settledBefore(metadata: SourceMetadata, now: Date): Date | null {
  if (metadata.finalizes) return null;
  const months = metadata.settles_after_months;
  if (months === undefined)
    throw new Unfit(`${metadata.id} never finalizes its values and states no revision window`);
  const year = (y: number) => Date.UTC(y, 0, 1);
  let y = now.getUTCFullYear();
  while (Date.UTC(y, months, 1) > +now) y--;
  return new Date(year(y));
}

/**
 * A source's last whole year of final values, the same for every one of its
 * gauges, so their fits are scored on the same year. For a source that never
 * finalizes, the year before `settledBefore`. Otherwise the latest year before
 * the current one in which most of its stations with values that year have no
 * preliminary ones, over all their epochs; a station marked as being written
 * votes for no year.
 */
export function finalYear(
  metadata: SourceMetadata,
  years: ReadonlyMap<string, YearRow>,
  now: Date,
): number {
  const settled = settledBefore(metadata, now);
  if (settled) return settled.getUTCFullYear() - 1;
  const writing = new Set(
    [...years.values()].filter((r) => r.epoch === null || r.year === null).map((r) => r.id),
  );
  const preliminary = new Map<number, Map<string, boolean>>();
  for (const r of years.values()) {
    if (writing.has(r.id) || r.year === null || !r.flags) continue;
    const stations = preliminary.get(r.year) ?? new Map<string, boolean>();
    stations.set(r.id, (stations.get(r.id) ?? false) || r.flags[Flag.preliminary]! > 0);
    preliminary.set(r.year, stations);
  }
  const final = [...preliminary]
    .filter(([year]) => year < now.getUTCFullYear())
    .filter(([, stations]) => [...stations.values()].filter(Boolean).length * 2 < stations.size)
    .map(([year]) => year);
  if (!final.length) throw new Unfit(`${metadata.id} has no year of final values`);
  return Math.max(...final);
}

/** The errata that touch `station` from `start` to before `end`. */
export function errataIn(
  errata: Erratum[],
  station: { id: string; source: string },
  period: { start: number; end: number },
): Erratum[] {
  const touching = new Set(errataOf(station, errata));
  return errata.filter(
    (e) =>
      touching.has(e.id) &&
      (e.since === null || utcDay(e.since) < period.end) &&
      (e.until === null || utcDay(e.until) > period.start),
  );
}

export interface ReadContext {
  store: string;
  metadata: SourceMetadata;
  /** The source's years file, by `<id> <epoch> <year>` (`readYears`). */
  years: ReadonlyMap<string, YearRow>;
  errata: Erratum[];
  now: Date;
  /** Filled with what each read used. */
  inputs: Inputs;
}

/**
 * A station's levels on the hour from `start` to before `end` (epoch ms), in
 * meters in its current datum, sorted by time. Each epoch's levels are read
 * inside its span and moved by its `to_current`; an epoch that can't be
 * converted is left out, and where a rejected epoch and another share a time
 * the other wins. Throws `Unfit` where a `kept` erratum in the period has no
 * `fit` decision, where the station's year files are being written, and, for
 * `final` values of a source that never finalizes, where the period ends
 * after its values have settled.
 */
export async function readSeries(
  station: StoredStation,
  period: { start: number; end: number },
  values: Values,
  context: ReadContext,
): Promise<Sample[]> {
  const { store, metadata, years, inputs } = context;
  const settled = values === "final" ? settledBefore(metadata, context.now) : null;
  if (settled && period.end > +settled)
    throw new Unfit(
      `${station.id}: values from ${settled.toISOString().slice(0, 10)} haven't settled`,
    );
  if (years.has(`${station.id} null null`))
    throw new Unfit(`${station.id}: its year files are being written`);

  const touching = errataIn(context.errata, station, period);
  const undecided = touching.filter((e) => e.handling === "kept" && !e.fit);
  if (undecided.length)
    throw new Unfit(
      `${station.id}: erratum ${undecided.map((e) => e.id).join(", ")} is kept as the source serves it, with no decision on whether a fit may read it`,
    );
  const dropped = touching
    .filter((e) => e.fit === "drop")
    .map((e) => [e.since ? utcDay(e.since) : -Infinity, e.until ? utcDay(e.until) : Infinity]);
  const inDropped = (t: number) => dropped.some(([since, until]) => t >= since! && t < until!);

  const qcStart = station.source_qc_start ? Date.parse(station.source_qc_start) : null;
  const takes = (flag: Flag, time: number) =>
    flag === Flag.good
      ? true
      : flag !== Flag.preliminary
        ? false
        : values === "measured" || settled !== null || (qcStart !== null && time < qcStart);

  // In id order, so a rejected epoch yields to the one before it.
  const epochs = [...station.epochs].sort((a, b) => a.id - b.id);
  const byTime = new Map<number, { level: number; rejected: boolean }>();
  for (const epoch of epochs) {
    if (epoch.to_current === null) continue;
    const start = Math.max(period.start, epoch.since ? Date.parse(epoch.since) : -Infinity);
    const end = Math.min(period.end, epoch.until ? Date.parse(epoch.until) : Infinity);
    if (!(start < end)) continue;
    const rejected = epoch.state === "rejected";
    const last = new Date(end - 1).getUTCFullYear();
    for (let year = new Date(start).getUTCFullYear(); year <= last; year++) {
      // A year the years file doesn't count has no values.
      const version = years.get(`${station.id} ${epoch.id} ${year}`)?.version;
      if (version === undefined) continue;
      inputs.versions[`${epoch.id} ${year}`] = version;
      const path = seriesPath(store, "levels", station.source, station.source_id, year, epoch.id);
      for (const o of await readObservationsBetween(path, start, end, true)) {
        if (!takes(o.flag, o.time) || !Number.isFinite(o.level)) continue;
        if (rejected && byTime.has(o.time)) continue;
        // Levels are stored as 32-bit floats; round off the widening noise below 0.1 mm.
        const level = Math.round((o.level + epoch.to_current) * 1e4) / 1e4;
        byTime.set(o.time, { level, rejected });
      }
    }
  }

  const used = epochs.map(({ id, since, until, to_current, state }) => ({
    id,
    since,
    until,
    to_current,
    state,
  }));
  inputs.epochs = used;
  inputs.source_qc_start = station.source_qc_start ?? null;
  if (settled) inputs.settled_before = settled.toISOString();
  for (const { id, handling, since, until, fit } of touching)
    inputs.errata[id] = { handling, since, until, fit };
  return [...byTime]
    .filter(([time]) => !inDropped(time))
    .map(([time, { level }]) => ({ time, level }))
    .sort((a, b) => a.time - b.time);
}
