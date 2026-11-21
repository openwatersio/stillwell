/**
 * Prints the `backfill` runs a source's monthly job makes today, one a line,
 * each the arguments after `backfill <source>` separated by tabs, from its
 * adapter's `schedule` (src/schema.ts). scripts/monthly.sh runs each.
 *
 *   node scripts/schedule.ts <lists|refetch> <source>
 */
import { sourceOf } from "../src/sources/index.ts";
import { planFor } from "../src/sources/schedule.ts";

const [job, id] = process.argv.slice(2);
if ((job !== "lists" && job !== "refetch") || !id) {
  console.error("usage: node scripts/schedule.ts <lists|refetch> <source>");
  process.exit(2);
}
for (const args of await planFor(job, sourceOf(id), new Date())) console.log(args.join("\t"));
