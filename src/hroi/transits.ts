import { moonTransits } from "@openwaters/almanac";

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

const GREENWICH = { latitudeDeg: 51.4769, longitudeDeg: 0 };
// Transit zero predates Almanac's 1950 start. Preserve the Astronomy Engine epoch.
const EPOCH = Date.parse("1949-12-31T21:07:50.451Z");

/** Upper and lower transits at Greenwich in [start, end), in order. */
export function transits(start: number, end: number): Transit[] {
  return moonTransits(new Date(start), new Date(end), GREENWICH).map((event) => {
    const time = event.time.getTime();
    const upper = event.kind === "upper";
    return { time, upper, number: transitNumber(time, upper) };
  });
}

export function transitNumber(time: number, upper: boolean): number {
  const offset = upper ? 0 : LUNAR_DAY_MS / 2;
  return Math.round((time - EPOCH - offset) / LUNAR_DAY_MS);
}
