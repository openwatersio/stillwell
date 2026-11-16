/**
 * Prints, as a JSON array, the sources a scheduled job runs for, from each
 * adapter's metadata, so the workflows' matrices never list them by hand.
 *
 *   node scripts/sources.ts <hourly|compact|lists|refetch> [source...]
 *
 * Given sources, it prints those of them the job runs for, and fails when
 * one isn't registered or none is left.
 */
import { JOBS, SERVER_SOURCES, sourcesFor, type Job } from "../src/sources/jobs.ts";

const [job, ...ids] = process.argv.slice(2);
if (!JOBS.includes(job as Job)) {
  console.error(`usage: node scripts/sources.ts <${JOBS.join("|")}> [source...]`);
  process.exit(2);
}
try {
  const picked = sourcesFor(job as Job, ids);
  // One named but on the server would otherwise be left out of a run that goes green.
  const onServer = ids.filter((id) => SERVER_SOURCES.has(id));
  if (onServer.length)
    throw new Error(
      `${onServer.join(", ")} ${onServer.length > 1 ? "are" : "is"} in src/sources/server.json, so the server's job queue writes ${onServer.length > 1 ? "them" : "it"}, not Actions`,
    );
  if (!picked.length)
    throw new Error(ids.length ? `None of ${ids.join(", ")} runs ${job}` : `No source runs ${job}`);
  console.log(JSON.stringify(picked));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
}
