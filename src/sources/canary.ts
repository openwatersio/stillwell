/** A source's probes for the weekly canary (scripts/canary.ts), in its own `canary.ts`. */
export const DAY_MS = 86_400_000;

export interface Probe {
  /** Asks the source through its adapter for a few days at a long-running gauge, ending near `end`. */
  run(start: Date, end: Date): Promise<unknown[]>;
  /** False for a probe whose request paths change, or whose responses have no shape, so it has only to return values. */
  recorded?: false;
  /** Environment variables the probe needs; the canary skips it without them. */
  env?: string[];
}

/** By probe name: the source's ID, or another name for a second probe in its directory. */
export type Probes = Record<string, Probe>;
