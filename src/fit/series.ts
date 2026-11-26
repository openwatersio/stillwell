import { createHash } from "node:crypto";
import { errataOf, utcDay, type Erratum } from "../errata.ts";
import { Flag, type Epoch, type SourceMetadata, type StoredStation } from "../schema.ts";
import { listFiles, readObservationsBetween } from "../store/parquet.ts";
import { seriesPath } from "../store/paths.ts";
import type { YearRow } from "../store/years.ts";
import type { Sample } from "../types.ts";
import { candidatesFor } from "./candidates.ts";
import { NODE_CORRECTIONS } from "./scores.ts";

/**
 * The levels a harmonic fit or a tidal datum reads from a station's year
 * files: every datum epoch in the current datum, and only values the source
 * won't revise again. It reads what the store's flags allow. An erratum whose
 * values shouldn't be read is `flagged`, which marks them suspect for every
 * reader; one that is `kept` has evidence for serving its values, so a fit
 * reads them, and records the erratum with what else it read.
 */

/** Why a series can't be read for a fit. The fit's row carries the message. */
export class Unfit extends Error {}

/** A station whose year files are being written: its fit waits, and what the store holds for it stays. */
export class Busy extends Unfit {}

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
  /** The errata touching the station in the years read. */
  errata: Record<string, Pick<Erratum, "handling" | "since" | "until">>;
  /** `inputsDigest` when the fit ran: the fit is due again when it changes. */
  digest: string;
}

export const emptyInputs = (): Inputs => ({
  versions: {},
  epochs: [],
  source_qc_start: null,
  settled_before: null,
  errata: {},
  digest: "",
});

/**
 * The fit's method, counted up whenever a change to `src/fit/` could change a
 * fit's constants or scores, so every stored fit comes due under the new one.
 * The candidate list is in the digest itself, and needs no count.
 */
export const METHOD = 1;

/**
 * A digest of everything a station's fit depends on: its
 * year files up to the source's final year, with their versions, its epochs
 * and their conversions, where its source's checks start, every erratum that
 * names it with its handling, the source's rule for final values, and
 * the method's version.
 * A fit records it, and is due again when it changes.
 */
export function inputsDigest(
  station: StoredStation,
  context: Pick<ReadContext, "metadata" | "years" | "errata"> & { finalYear: number | null },
): string {
  const { metadata, years, finalYear: final } = context;
  const files = [...years.values()]
    .filter((r) => r.id === station.id && (r.year === null || final === null || r.year <= final))
    .map((r) => [r.epoch, r.year, r.version ?? null])
    .sort((a, b) => Number(a[0]) - Number(b[0]) || Number(a[1]) - Number(b[1]));
  const touching = new Set(errataOf(station, context.errata));
  return createHash("sha256")
    .update(
      JSON.stringify({
        files,
        final,
        epochs: [...station.epochs]
          .sort((a, b) => a.id - b.id)
          .map(({ id, since, until, to_current, state }) => [id, since, until, to_current, state]),
        source_qc_start: station.source_qc_start ?? null,
        errata: context.errata
          .filter((e) => touching.has(e.id))
          .map((e) => [e.id, e.handling, e.since, e.until])
          .sort(),
        finalizes: metadata.finalizes,
        settles_after_months: metadata.settles_after_months ?? null,
        method: METHOD,
        candidates: candidatesFor(NODE_CORRECTIONS).map((c) => [c.name, c.doodson]),
      }),
    )
    .digest("hex")
    .slice(0, 16);
}

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
 * preliminary ones the source will still check, over all their epochs: a year
 * that ended by a station's `source_qc_start`, in `qcStarts` by station, is
 * final as it stands. A station marked as being written votes for no year.
 */
export function finalYear(
  metadata: SourceMetadata,
  years: ReadonlyMap<string, YearRow>,
  now: Date,
  qcStarts: ReadonlyMap<string, number> = new Map(),
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
    const checked = Date.UTC(r.year + 1, 0, 1) > (qcStarts.get(r.id) ?? -Infinity);
    stations.set(
      r.id,
      (stations.get(r.id) ?? false) || (checked && r.flags[Flag.preliminary]! > 0),
    );
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
 * the other wins. Throws `Unfit` where the station's year files are being
 * written (`Busy`) and, for `final` values of a source that never finalizes, where the period
 * ends after its values have settled. Throws an ordinary error where a year
 * file the years file counts is missing, so no fit records a file it didn't read.
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
    throw new Busy(`${station.id}: its year files are being written`);

  // Only errata in years the station has a file for: one that names every
  // station of a source says nothing about a gauge with no values in its span.
  const held = [...years.values()]
    .filter((r) => r.id === station.id && r.year !== null)
    .map((r) => ({ start: Date.UTC(r.year!, 0, 1), end: Date.UTC(r.year! + 1, 0, 1) }));
  const touching = errataIn(context.errata, station, period).filter((e) =>
    held.some(
      (y) =>
        y.start < period.end &&
        y.end > period.start &&
        (e.since === null || utcDay(e.since) < y.end) &&
        (e.until === null || utcDay(e.until) > y.start),
    ),
  );

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
      const rows = await readObservationsBetween(path, start, end, true);
      // A missing file reads as no rows, as a year with none on the hour does.
      // A listing globs, so a station ID with a glob character counts only its own file.
      if (!rows.length && !(await listFiles(path)).includes(path))
        throw new Error(`${station.id}: ${path} is in the years file and missing from the store`);
      for (const o of rows) {
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
  for (const { id, handling, since, until } of touching)
    inputs.errata[id] = { handling, since, until };
  return [...byTime].map(([time, { level }]) => ({ time, level })).sort((a, b) => a.time - b.time);
}
