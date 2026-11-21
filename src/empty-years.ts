/**
 * Years with no file that a `--skip-written` backfill asked a source for and
 * got nothing back, including years outside a series' dates, which adapters
 * answer without a request. A year that has a file is never recorded, so an
 * empty answer can't block its refill.
 *
 * Such a year writes no file, so without a record each run of a campaign asks
 * for it again before reaching new stations: a source that serves nothing
 * for a station before some year, within the dates it lists, costs every run
 * a request a month for each of those years, and most of a run across the
 * first stations. Only a source whose metadata sets `empty_means_none` or
 * `skip_empty` keeps a record (`keepsEmptyYears`), and an entry still lasts
 * only `EMPTY_KEEP_DAYS`, so a later campaign asks again. Only
 * `--skip-written` reads the record; a plain or refetching
 * backfill asks for every year as before.
 */
import type { SourceMetadata } from "./schema.ts";
import { readJsonArray, writeJsonArray } from "./store/parquet.ts";
import { emptyYearsPath } from "./store/paths.ts";

export const EMPTY_KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * Whether a source keeps a record: its empty answer means no data (`empty_means_none`), or it
 * may be an outage but is skipped for a campaign all the same (`skip_empty`).
 */
export function keepsEmptyYears(
  metadata: Pick<SourceMetadata, "empty_means_none" | "skip_empty">,
): boolean {
  return Boolean(metadata.empty_means_none || metadata.skip_empty);
}

/** One series year: station, product, epoch and year. */
export function emptyKey(station: string, product: string, epoch: number, year: number): string {
  return `${station} ${product} ${epoch} ${year}`;
}

/** The record for a source, by key, with when each was found; entries past their time are left out. */
export async function readEmptyYears(
  store: string,
  source: string,
  now: number,
): Promise<Map<string, string>> {
  const rows = ((await readJsonArray(emptyYearsPath(store, source))) ?? []) as {
    key: string;
    seen: string;
  }[];
  const cutoff = now - EMPTY_KEEP_DAYS * DAY_MS;
  return new Map(rows.filter((r) => Date.parse(r.seen) >= cutoff).map((r) => [r.key, r.seen]));
}

/** Write the record, dropping entries past their time. */
export async function writeEmptyYears(
  store: string,
  source: string,
  empty: Map<string, string>,
  now: number,
): Promise<void> {
  const cutoff = now - EMPTY_KEEP_DAYS * DAY_MS;
  const rows = [...empty]
    .filter(([, seen]) => Date.parse(seen) >= cutoff)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, seen]) => ({ key, seen }));
  await writeJsonArray(emptyYearsPath(store, source), rows);
}
