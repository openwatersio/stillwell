/**
 * Years with no file that a `--skip-written` backfill asked a source for and
 * got nothing back, including years outside a series' dates, which adapters
 * answer without a request. A year that has a file is never recorded, so an
 * empty answer can't block its refill.
 *
 * Such a year writes no file, so without a record each run of a campaign asks
 * for it again before reaching new stations: CO-OPS lists Alameda from 1939
 * but serves nothing before 1985, which costs every run about 25 seconds a
 * year, and most of a run across the first stations. Only a source whose
 * metadata sets `empty_means_none`, whose adapter throws on an outage rather
 * than answer with nothing, keeps a record, and an entry still lasts only
 * `EMPTY_KEEP_DAYS`, so a later campaign asks again. Only `--skip-written` reads the record; a plain or refetching
 * backfill asks for every year as before.
 */
import { readJsonArray, writeJsonArray } from "./lake/parquet.ts";
import { emptyYearsPath } from "./lake/paths.ts";

export const EMPTY_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

/** One series year: station, product, epoch and year. */
export function emptyKey(station: string, product: string, epoch: number, year: number): string {
  return `${station} ${product} ${epoch} ${year}`;
}

/** The record for a source, by key, with when each was found; entries past their time are left out. */
export async function readEmptyYears(
  lake: string,
  source: string,
  now: number,
): Promise<Map<string, string>> {
  const rows = ((await readJsonArray(emptyYearsPath(lake, source))) ?? []) as {
    key: string;
    seen: string;
  }[];
  const cutoff = now - EMPTY_KEEP_DAYS * DAY_MS;
  return new Map(rows.filter((r) => Date.parse(r.seen) >= cutoff).map((r) => [r.key, r.seen]));
}

/** Write the record, dropping entries past their time. */
export async function writeEmptyYears(
  lake: string,
  source: string,
  empty: Map<string, string>,
  now: number,
): Promise<void> {
  const cutoff = now - EMPTY_KEEP_DAYS * DAY_MS;
  const rows = [...empty]
    .filter(([, seen]) => Date.parse(seen) >= cutoff)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, seen]) => ({ key, seen }));
  await writeJsonArray(emptyYearsPath(lake, source), rows);
}
