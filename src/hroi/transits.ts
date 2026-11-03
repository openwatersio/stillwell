import { Body, MakeTime, Observer, SearchHourAngle } from "astronomy-engine";

/** A meridian passage of the moon at Greenwich. */
export interface Transit {
  time: number; // UTC epoch ms
  upper: boolean;
  /**
   * Lunar transit number: upper transits since the one on 1949-12-31, which is 0.
   * A lower transit has the number of the upper transit before it.
   */
  number: number;
}

/** Mean lunar day, in milliseconds per transit number. */
export const LUNAR_DAY_MS = 1.03505013 * 86_400_000;

// Hour angle 0 at Greenwich is independent of the observer's latitude, and the
// moon's topocentric right ascension equals its geocentric one at transit.
const GREENWICH = new Observer(51.4769, 0, 0);

const EPOCH = SearchHourAngle(
  Body.Moon,
  GREENWICH,
  0,
  MakeTime(new Date(Date.UTC(1949, 11, 31))),
).time.date.getTime();

/** Upper and lower transits at Greenwich in [start, end), in order. */
export function transits(start: number, end: number): Transit[] {
  const result: Transit[] = [];
  let time = MakeTime(new Date(start));
  for (;;) {
    const upper = SearchHourAngle(Body.Moon, GREENWICH, 0, time);
    const lower = SearchHourAngle(Body.Moon, GREENWICH, 12, time);
    const next = upper.time.ut < lower.time.ut ? upper : lower;
    const t = next.time.date.getTime();
    if (t >= end) break;
    const isUpper = next === upper;
    result.push({ time: t, upper: isUpper, number: transitNumber(t, isUpper) });
    // Transits are about 12.4 hours apart, so a few hours on finds the next one.
    time = next.time.AddDays(0.1);
  }
  return result;
}

export function transitNumber(time: number, upper: boolean): number {
  const offset = upper ? 0 : LUNAR_DAY_MS / 2;
  return Math.round((time - EPOCH - offset) / LUNAR_DAY_MS);
}
