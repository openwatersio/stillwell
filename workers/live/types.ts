// What the poller and the live Worker exchange, shared by src/realtime/live.ts and store.ts. No imports, so the
// Worker's type check doesn't reach the Node code.

/** A value as D1's `live.rows` holds it: [epoch, time, level, flag, source_flag, received], times in epoch ms. */
export type LiveCell = [number, number, number, number, number | null, number | null];

/** One poller pass, as the `polls` table in schema.sql holds it. */
export interface PollRow {
  source: string;
  started: number;
  finished: number;
  intervals: number[];
  ok: boolean;
  stations: number;
  updated: number;
  values: number;
  stale: string[];
  failed: string[];
  blocked: boolean;
  datum_changed: boolean;
}
