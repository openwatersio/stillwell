import { fit } from "./harmonic.ts";
import { Flag, type Observation } from "./schema.ts";

const DAY_MS = 86_400_000;

/** The lunar tide, M2's and O1's amplitudes added, in meters, that makes a river or lake station tidal. */
export const TIDE_M = 0.08;

/** More runs than this, in a year, that only a tide gauge's flatline limit flags, and a stream drains (`drains`). */
export const DRAINS_RUNS = 3;

/**
 * Whether a record carries a tide of `TIDE_M` or more, fitted over its last
 * 366 days of usable values; values spanning under 30 days, or whose median
 * step is over 3 hours, which can't resolve a tide, say no (gaps are fine). Lunar
 * constituents only, since a daily schedule, such as a hydropower dam's, puts
 * power in the solar S2 and K1; O1 catches the diurnal tides of the Gulf of
 * Mexico, where M2 is small.
 */
export function tidal(record: {
  times: ArrayLike<number>;
  levels: ArrayLike<number>;
  /** The values' flags, as the lake's: the source's own, or after QC. */
  source: ArrayLike<number>;
}): boolean {
  const samples = [];
  for (let i = 0; i < record.times.length; i++)
    if (record.source[i]! < Flag.suspect && Number.isFinite(record.levels[i]))
      samples.push({ time: record.times[i]!, level: record.levels[i]! });
  const end = samples.at(-1)?.time ?? 0;
  const year = samples.filter((s) => s.time > end - 366 * DAY_MS);
  if (!year.length || end - year[0]!.time < 30 * DAY_MS) return false;
  const steps = year.slice(1).map((s, i) => s.time - year[i]!.time);
  if (steps.sort((a, b) => a - b)[steps.length >> 1]! > 3 * 3_600_000) return false;
  const tide = fit(year, ["M2", "O1"])
    .constituents.filter((c) => c.name === "M2" || c.name === "O1")
    .reduce((sum, c) => sum + c.amplitude, 0);
  return tide >= TIDE_M;
}

/**
 * Whether a tide gauge's flatline limit flags more than `DRAINS_RUNS` runs of
 * the last year that the river's two days don't. Water the tide reaches only
 * at times holds still for hours on end in between: a creek drained to a sill
 * or pool at low water, a lagoon whose mouth has closed, a canal held by its
 * structure. A stuck sensor is better told apart there by the river's limit,
 * though one that sticks more than `DRAINS_RUNS` times a year keeps it too.
 */
export function drains(river: Observation[], tide: Observation[]): boolean {
  const since = (river.at(-1)?.time ?? 0) - 366 * DAY_MS;
  const only = (i: number) =>
    river[i]!.time > since && tide[i]!.flag >= Flag.suspect && river[i]!.flag < Flag.suspect;
  let runs = 0;
  for (let i = 0; i < river.length; i++) if (only(i) && (i === 0 || !only(i - 1))) runs++;
  return runs > DRAINS_RUNS;
}
