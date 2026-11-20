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
