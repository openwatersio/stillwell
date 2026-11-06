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

const ALMANAC_START = Date.UTC(1950, 0, 1);

// Greenwich crossings from Astronomy Engine 2.1.19 in the two lunar days before 1950.
const LOOKBACK: Transit[] = [
  { time: Date.parse("1949-12-30T07:58:49.056Z"), upper: false, number: -2 },
  { time: Date.parse("1949-12-30T20:20:56.608Z"), upper: true, number: -1 },
  { time: Date.parse("1949-12-31T08:43:55.580Z"), upper: false, number: -1 },
  { time: EPOCH, upper: true, number: 0 },
];

export function predictionTransits(start: number, end: number): Transit[] {
  const from = start - 2 * LUNAR_DAY_MS;
  if (start >= ALMANAC_START && from < ALMANAC_START) {
    return LOOKBACK.filter((t) => t.time >= from).concat(transits(ALMANAC_START, end));
  }
  return transits(from, end);
}

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
