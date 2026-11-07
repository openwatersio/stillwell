/**
 * Prints, as a JSON array, the sources a scheduled job runs for, from each
 * adapter's metadata, so the workflows' matrices never list them by hand.
 *
 *   node scripts/sources.ts <hourly|compact|lists|refetch> [source...]
 *
 * Given sources, it prints those of them the job runs for, and fails when
 * one isn't registered or none is left.
 */
import { JOBS, sourcesFor, type Job } from "../src/sources/jobs.ts";

const [job, ...ids] = process.argv.slice(2);
if (!JOBS.includes(job as Job)) {
  console.error(`usage: node scripts/sources.ts <${JOBS.join("|")}> [source...]`);
  process.exit(2);
}
try {
  const picked = sourcesFor(job as Job, ids);
  if (!picked.length)
    throw new Error(ids.length ? `None of ${ids.join(", ")} runs ${job}` : `No source runs ${job}`);
  console.log(JSON.stringify(picked));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
