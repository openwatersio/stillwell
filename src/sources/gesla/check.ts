/** What GESLA's errata checks share: comparing two stored series, and reading a flagged span or a dropped record. */
import type { Erratum, StoreReader } from "../../errata.ts";
import { Flag } from "../../schema.ts";
import { median } from "../../stats.ts";

type Level = { time: number; level: number; flag?: number };

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;

/** The one station an entry lists. */
export function station(e: Pick<Erratum, "id" | "stations">): string {
  if (e.stations?.length !== 1) throw new Error(`${e.id} doesn't list one station`);
  return e.stations[0]!;
}

/** A station's levels from `since` to before `until`, throwing when there are none. */
export async function levels(store: StoreReader, id: string, since: string, until: string) {
  const rows = await store.levels(id, since, until);
  if (!rows.length) throw new Error(`the store holds no ${id} levels from ${since} to ${until}`);
  return rows;
}

/**
 * `a` against `b` read `lag` later, `b` interpolated between values at most
 * `gap` apart: the median difference, the spread of the differences about it
 * (RMS, m), and the share of them within `tolerance` of the median; an
 * infinite spread where fewer than 24 values pair.
 */
export function compare(a: Level[], b: Level[], lag: number, tolerance = 0.005, gap = HOUR_MS) {
  // A spike QC flagged bad would skew the spread; suspect values stay, since a flagged span's own values are compared.
  [a, b] = [a, b].map((s) => s.filter((o) => o.flag !== Flag.bad));
  const d: number[] = [];
  let j = 0;
  if (!b.length) return { n: 0, offset: NaN, spread: Infinity, within: 0 };
  for (const o of a) {
    const t = o.time + lag;
    while (j < b.length - 1 && b[j + 1]!.time <= t) j++;
    const [p, q] = [b[j]!, b[j + 1]];
    let v: number | undefined;
    if (p.time === t) v = p.level;
    else if (q && p.time < t && q.time > t && q.time - p.time <= gap)
      v = p.level + ((q.level - p.level) * (t - p.time)) / (q.time - p.time);
    if (v !== undefined) d.push(o.level - v);
  }
  if (d.length < 24) return { n: d.length, offset: NaN, spread: Infinity, within: 0 };
  const offset = median(d);
  const spread = Math.sqrt(d.reduce((s, x) => s + (x - offset) ** 2, 0) / d.length);
  const within = d.filter((x) => Math.abs(x - offset) <= tolerance).length / d.length;
  return { n: d.length, offset, spread, within };
}

/**
 * Throws unless `a` fits `b` best, of `lags` (minutes), at `expected`, by
 * spread, from `since` to before `until`, and within `max` (m) there.
 */
export async function fits(
  store: StoreReader,
  a: string,
  b: string,
  since: string,
  until: string,
  expected: number,
  lags: number[],
  max = 0.05,
) {
  const [x, y] = await Promise.all([
    levels(store, a, since, until),
    levels(store, b, since, until),
  ]);
  const fits = lags.map((lag) => ({ lag, ...compare(x, y, lag * MINUTE_MS) }));
  const best = fits.reduce((p, q) => (q.spread < p.spread ? q : p));
  const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;
  if (best.lag !== expected)
    throw new Error(
      `${a} fits ${b} best ${best.lag} minutes later (${cm(best.spread)}), not ${expected} (${cm(fits.find((f) => f.lag === expected)!.spread)}), from ${since} to ${until}`,
    );
  if (best.spread > max)
    throw new Error(
      `${a} differs from ${b} ${expected} minutes later by ${cm(best.spread)} RMS from ${since} to ${until}`,
    );
}

/**
 * `id` listed inactive with no products and no links, as for a record of
 * another gauge's values; with `neighbor`, none of its levels in `year`
 * while `neighbor` holds some, and without, its levels in `year` kept.
 */
export async function dropped(store: StoreReader, id: string, year: number, neighbor?: string) {
  const row = (await store.rows("stations.parquet")).find((r) => r.id === id);
  if (!row) throw new Error(`stations.parquet doesn't list ${id}`);
  if (row.status !== "inactive") throw new Error(`${id} is listed ${String(row.status)}`);
  const products = (row.products as { items: string[] }).items;
  if (products.length) throw new Error(`${id} is listed with ${products.join(", ")}`);
  const sameAs = (row.same_as as { items: string[] }).items;
  if (sameAs.length) throw new Error(`${id} is linked to ${sameAs.join(", ")}`);
  const links = (await store.rows("stations/links.parquet")).filter(
    (r) => r.a === id || r.b === id,
  );
  if (links.length)
    throw new Error(
      `stations/links.parquet pairs ${id} with ${links.map((r) => (r.a === id ? r.b : r.a)).join(", ")}`,
    );
  const [since, until] = [`${year}-01-01`, `${year + 1}-01-01`];
  if (!neighbor) {
    await levels(store, id, since, until);
    return;
  }
  // A year the store can't read at all would also hold nothing, so a neighbor's must read.
  await levels(store, neighbor, since, until);
  const rows = await store.levels(id, since, until);
  if (rows.length) throw new Error(`the store holds ${rows.length} ${id} levels in ${year}`);
}
