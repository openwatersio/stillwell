/** One water level. `time` is a UTC epoch in milliseconds. */
export interface Sample {
  time: number;
  level: number; // meters, in the series' datum
}

export type ExtremeType = "high" | "low";

/** A high or low water. */
export interface Extreme extends Sample {
  type: ExtremeType;
}

/** A high or low water as BSH publishes it, with its HRoI bookkeeping. */
export interface TransitExtreme extends Extreme {
  /** Lunar transit number: upper transits at Greenwich since 1949-12-31. */
  transit: number;
  /** HRoI event index: 1 HW upper, 2 LW upper, 3 HW lower, 4 LW lower. */
  event: EventIndex;
}

export type EventIndex = 1 | 2 | 3 | 4;

export interface Station {
  /** `<source>:<source_id>`, e.g. `rws:hoekvanholland`, `bsh:506P`. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** What `level` is measured from, e.g. `NAP`, `MSL`, `PNP`. */
  datum: string;
  /** Meters to add to a level in `datum` to refer it to another datum, by name. */
  offsets?: Record<string, number>;
  source_url?: string;
}
