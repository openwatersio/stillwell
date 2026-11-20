/** Reads LINZ's levels back from the store for the errata checks in `errata.ts`. */
import type { StoreReader } from "../../errata.ts";
import { Flag, type Epoch, type Observation } from "../../schema.ts";
import { median } from "../../stats.ts";

type Level = Observation & { epoch: number };
const DAY_MS = 86_400_000;
const day = (o: Observation) => Math.floor(o.time / DAY_MS);
const iso = (t: number) => new Date(t).toISOString().slice(0, 16);

/** The day after `d` (`YYYY-MM-DD`). */
const next = (d: string) => new Date(Date.parse(d) + DAY_MS).toISOString().slice(0, 10);

/**
 * A station's levels at instants from `from` to before `to`, each a day or a
 * UTC instant; throws for fewer than `min`, so no check passes on a gap.
 */
export async function levels(
  store: StoreReader,
  id: string,
  from: string,
  to: string,
  min = 60,
): Promise<Level[]> {
  const [a, b] = [
    Date.parse(from.length > 10 ? `${from}Z` : `${from}T00:00Z`),
    Date.parse(to.length > 10 ? `${to}Z` : `${to}T00:00Z`),
  ];
  // An hour typo such as T25:00 parses as NaN, which would keep nothing and let `absent` pass.
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`${from} to ${to} isn't a UTC span`);
  const until = to.length > 10 ? next(to.slice(0, 10)) : to;
  const out = (await store.levels(id, from.slice(0, 10), until)).filter(
    (o) => o.time >= a && o.time < b,
  );
  if (out.length < min)
    throw new Error(`the store holds ${out.length} ${id} levels from ${from} to ${to}`);
  return out;
}

/** The median level; levels are already non-empty from `levels`. */
export const med = (obs: Observation[]) => median(obs.map((o) => o.level));

/** Each UTC day's median and range, of the values QC passed. */
export function daily(obs: Observation[]): { day: string; median: number; range: number }[] {
  return [
    ...Map.groupBy(
      obs.filter((o) => o.flag < Flag.suspect),
      day,
    ),
  ].map(([d, v]) => {
    const l = v.map((o) => o.level);
    return {
      day: iso(d * DAY_MS).slice(0, 10),
      median: median(l),
      range: Math.max(...l) - Math.min(...l),
    };
  });
}

/** The median of `a` less `b` at the instants both have. */
export function offset(a: Observation[], b: Observation[]): number {
  const at = new Map(a.map((o) => [o.time, o.level]));
  const diffs = b.flatMap((o) => (at.has(o.time) ? [at.get(o.time)! - o.level] : []));
  if (diffs.length < 24) throw new Error(`only ${diffs.length} instants in common`);
  return median(diffs);
}

/** The station's epochs; throws where the store doesn't list it. */
export async function epochs(store: StoreReader, id: string): Promise<Epoch[]> {
  const s = await store.station(id);
  if (!s) throw new Error(`the store doesn't list ${id}`);
  return s.epochs;
}

/** The epoch that starts on `day`, and the one before it; throws where none starts then. */
export async function epochFrom(store: StoreReader, id: string, day: string) {
  const list = await epochs(store, id);
  const i = list.findIndex((e) => e.since === `${day}T00:00:00Z`);
  if (i < 1)
    throw new Error(
      `no epoch of ${id} starts on ${day} (${list.map((e) => e.since ?? "start").join(", ")})`,
    );
  return { after: list[i]!, before: list[i - 1]! };
}

/** Throws where an epoch of the station starts after `from` and before `to`. */
export async function noEpochBetween(store: StoreReader, id: string, from: string, to: string) {
  const e = (await epochs(store, id)).find(
    (e) => e.since && e.since > `${from}T00:00:00Z` && e.since < `${to}T00:00:00Z`,
  );
  if (e) throw new Error(`an epoch of ${id} starts on ${e.since}`);
}

/** Levels on the current zero, by each epoch's `to_current`. */
export async function current(store: StoreReader, id: string, obs: Level[]) {
  const list = await epochs(store, id);
  return obs.map((o) => {
    const to = list.find((e) => e.id === o.epoch)?.to_current;
    if (to == null) throw new Error(`${id}'s epoch ${o.epoch} has no to_current`);
    return { ...o, level: o.level + to };
  });
}

/**
 * Throws where the store holds a level from `from` to before `to` (UTC
 * instants or days), or holds none in the 30 days either side, since a
 * missing year would read as the same gap.
 */
export async function absent(store: StoreReader, id: string, from: string, to: string) {
  const held = await levels(store, id, from, to, 0);
  if (held.length)
    throw new Error(
      `the store holds ${held.length} ${id} levels from ${from} to ${to}, the first at ${iso(held[0]!.time)}`,
    );
  const shift = (d: string, days: number) =>
    new Date(Date.parse(d.slice(0, 10)) + days * DAY_MS).toISOString().slice(0, 10);
  const around =
    (await levels(store, id, shift(from, -30), from, 0)).length +
    (await levels(store, id, to, shift(to, 31), 0)).length;
  if (!around)
    throw new Error(`the store holds no ${id} levels within 30 days of ${from} to ${to}`);
}

/**
 * Throws unless `id`'s levels on the current zero hold one offset from a
 * reference series across a step, within 0.05 m, and the epoch starting on
 * `day` is `step` m from the one before, within 0.015 m, since `to_current` sums rounded steps.
 */
export async function stepCorrected(
  store: StoreReader,
  id: string,
  ref: string,
  day: string,
  before: [string, string],
  after: [string, string],
  step: number,
) {
  const e = await epochFrom(store, id, day);
  const moved = (e.before.to_current ?? NaN) - (e.after.to_current ?? NaN);
  if (!(Math.abs(moved - step) < 0.015))
    throw new Error(`${id}'s epochs either side of ${day} are ${moved} m apart, not ${step} m`);
  const at = async ([from, to]: [string, string]) =>
    offset(
      await current(store, id, await levels(store, id, from, to)),
      await levels(store, ref, from, to, 24),
    );
  const [a, b] = [await at(before), await at(after)];
  if (!(Math.abs(b - a) < 0.05))
    throw new Error(`${id}'s offset from ${ref} moves from ${a.toFixed(3)} to ${b.toFixed(3)} m`);
}

/** How far `id`'s offset from `ref` moves from `before` to `after`, each as stored. */
export async function step(
  store: StoreReader,
  id: string,
  ref: string,
  before: [string, string],
  after: [string, string],
): Promise<number> {
  const at = async ([from, to]: [string, string]) =>
    offset(await levels(store, id, from, to), await levels(store, ref, from, to, 24));
  return (await at(after)) - (await at(before));
}

/**
 * Throws unless the levels from `from` to before `to` read a tide: every
 * day's range of values QC passed is 0.3 to `maxRange` m, and the median is
 * within `tolerance` of `expected`.
 */
export async function tide(
  store: StoreReader,
  id: string,
  from: string,
  to: string,
  expected: number,
  { tolerance = 0.05, maxRange = 4 } = {},
) {
  const obs = (await levels(store, id, from, to)).filter((o) => o.flag < Flag.suspect);
  const days = daily(obs);
  // A window QC flagged whole, or mostly missing, can't show a tide.
  const span = (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY_MS;
  if (days.length < 0.5 * span)
    throw new Error(
      `${id} has QC-passed levels on ${days.length} of the ${span} days from ${from} to ${to}`,
    );
  const odd = days.filter((d) => d.range < 0.3 || d.range > maxRange);
  if (odd.length)
    throw new Error(
      `${id} doesn't read a tide on ${odd.length} days from ${from} to ${to}, such as ${odd[0]!.day} (range ${odd[0]!.range.toFixed(2)} m)`,
    );
  const m = med(obs);
  if (!(Math.abs(m - expected) <= tolerance))
    throw new Error(`${id}'s median from ${from} to ${to} is ${m.toFixed(3)} m, not ${expected} m`);
}
