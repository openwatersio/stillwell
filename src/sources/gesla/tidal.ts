import { fit } from "../../harmonic.ts";
import { Flag } from "../../schema.ts";
import type { GeslaRecord } from "./index.ts";

const DAY_MS = 86_400_000;

/** The lunar tide, M2's and O1's amplitudes added, in meters, that makes a river or lake record tidal. */
export const TIDE_M = 0.08;

/**
 * Whether a record carries a tide of `TIDE_M` or more, fitted over its last
 * 366 days of usable values; values spanning under 30 days, or whose median
 * step is over 3 hours, which can't resolve a tide, say no (gaps are fine). Lunar
 * constituents only, since a daily schedule, such as a hydropower dam's, puts
 * power in the solar S2 and K1; O1 catches the diurnal tides of the Gulf of
 * Mexico, where M2 is small.
 */
export function tidal(record: Pick<GeslaRecord, "times" | "levels" | "source">): boolean {
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
