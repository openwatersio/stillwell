/** What the checks in errata.ts measure in the store's series. */
import type { StoreReader } from "../../errata.ts";
import { Flag, type Observation } from "../../schema.ts";
import { median } from "../../stats.ts";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** A station's stored levels from `since` to before `until`, throwing when there are none. */
export async function read(
  store: StoreReader,
  id: string,
  since: string,
  until: string,
): Promise<Observation[]> {
  const rows = await store.levels(id, since, until);
  if (!rows.length) throw new Error(`the store holds no ${id} levels from ${since} to ${until}`);
  return rows;
}

/**
 * The RMS, in meters, of a's value at T less b's at T − lag minutes, the
 * difference's mean removed since the two zeros differ. `b` is interpolated
 * between its values and sorted by time.
 */
function rmsAt(a: Observation[], b: Observation[], lag: number): number {
  // A spike QC flagged bad would skew the RMS.
  [a, b] = [a, b].map((s) => s.filter((o) => o.flag !== Flag.bad));
  const at = (t: number) => {
    let lo = 0;
    let hi = b.length - 1;
    if (!b.length || t < b[0]!.time || t > b[hi]!.time) return NaN;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid]!.time <= t) lo = mid;
      else hi = mid;
    }
    const [p, q] = [b[lo]!, b[hi]!];
    // A gap wider than an hour, the coarsest series compared, is missing values.
    if (q.time - p.time > HOUR_MS) return NaN;
    return q.time === p.time
      ? p.level
      : p.level + ((q.level - p.level) * (t - p.time)) / (q.time - p.time);
  };
  const d = a.map((o) => o.level - at(o.time - lag * MINUTE_MS)).filter((v) => !Number.isNaN(v));
  if (d.length < 12) return Infinity;
  const mean = d.reduce((s, v) => s + v, 0) / d.length;
  return Math.sqrt(d.reduce((s, v) => s + (v - mean) ** 2, 0) / d.length);
}

/** The lag in minutes, every `step` up to `max` either way, at which a's value at T best equals b's at T − lag, and the RMS there. */
export function best(a: Observation[], b: Observation[], max: number, step: number) {
  let out = { lag: 0, rms: Infinity };
  for (let lag = -max; lag <= max; lag += step) {
    const rms = rmsAt(a, b, lag);
    if (rms < out.rms) out = { lag, rms };
  }
  if (out.rms === Infinity) throw new Error("the two series share too few times to compare");
  return out;
}

/** Minutes `a` runs late against `b` over a span, both read from the store. */
export async function lateBy(
  store: StoreReader,
  a: string,
  b: string,
  [since, until]: [string, string],
  max: number,
  step: number,
) {
  return best(await read(store, a, since, until), await read(store, b, since, until), max, step);
}

/** The median of a station's levels over a span. */
export const middle = async (store: StoreReader, id: string, [since, until]: [string, string]) =>
  median((await read(store, id, since, until)).map((o) => o.level));

/** Throws when more than a tenth of a station's values over a span are flagged `suspect` or worse. */
export async function unflagged(store: StoreReader, id: string, [since, until]: [string, string]) {
  const rows = await read(store, id, since, until);
  const suspect = rows.filter((o) => o.flag >= Flag.suspect).length;
  if (suspect > rows.length / 10)
    throw new Error(
      `${suspect} of ${rows.length} ${id} levels from ${since} to ${until} are flagged suspect or worse`,
    );
}
