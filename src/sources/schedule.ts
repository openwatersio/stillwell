/**
 * The `backfill` runs a source's monthly jobs make, from its `schedule`
 * (src/schema.ts), and helpers for writing one. Nothing here imports a
 * package, since the workflows load the registry without `npm ci`.
 */
import type { Source } from "../schema.ts";

/**
 * How many years before the current one the default refetch reaches back
 * (`backfill … preliminary` from January of that year), and so how far back
 * compaction looks for a station's first preliminary value.
 */
export const REFETCH_YEARS = 3;

/** The first day of the month `months` from `today`'s, in UTC, as `YYYY-MM-DD`. */
export function firstOfMonth(today: Date, months = 0): string {
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + months, 1))
    .toISOString()
    .slice(0, 10);
}

/** `today`'s UTC year. */
export const yearOf = (today: Date) => today.getUTCFullYear();

/** The runs `source`'s `job` makes on `today`, each the arguments after `backfill <source>`. */
export async function planFor(
  job: "lists" | "refetch",
  source: Source,
  today: Date,
): Promise<string[][]> {
  const own = source.schedule?.[job];
  if (own) {
    const runs = await own(today);
    // A refetch that plans nothing would pass having read nothing.
    if (job === "refetch" && !runs.length)
      throw new Error(`${source.metadata.id}'s refetch plans no run`);
    return runs;
  }
  if (job === "lists") return [];
  return defaultRefetch(today);
}

/** Each station from its earliest preliminary value, from January REFETCH_YEARS back, to this month. */
export function defaultRefetch(today: Date): string[][] {
  return [["preliminary", `${yearOf(today) - REFETCH_YEARS}`, firstOfMonth(today)]];
}
