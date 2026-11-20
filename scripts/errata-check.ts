/**
 * Runs each erratum's check against the store, STILLWELL_STORE (as ingest
 * reads it, a directory or an `s3://` or `https://` URL), and says whether the
 * store holds what the entry says. A check that fails after a refetch means
 * the source changed the data, so the entry needs looking at again. Exits 1
 * when any fails.
 *
 *   npm run errata:check                          every erratum
 *   npm run errata:check -- cco usace-fill-values  sources or erratum IDs
 *   STILLWELL_STORE=https://stillwell.openwaters.io npm run errata:check
 *   npm run errata:check -- --report report.json  also write each result as JSON
 *
 * The report is what scripts/errata-issues.ts reads: `{ problems, results }`,
 * each result `{ id, source, error }`, `error` null where the check passed.
 */
import { existsSync, writeFileSync } from "node:fs";
import { errata, errataProblems } from "../src/sources/index.ts";
import { errataReader } from "../src/store/errata-reader.ts";
import { STORE } from "../src/store/stores.ts";

const store = errataReader();

if (!/^[a-z0-9]+:\/\//.test(STORE) && !existsSync(STORE))
  throw new Error(
    `no store at ${STORE}; set STILLWELL_STORE, such as to https://stillwell.openwaters.io`,
  );
const args = process.argv.slice(2);
const at = args.indexOf("--report");
const report = at === -1 ? null : args.splice(at, 2)[1];
if (at !== -1 && !report) throw new Error("--report needs a file");
// A file that breaks the rules is left out whole, so its checks would silently not run.
for (const p of errataProblems) console.error(p);
const unknown = args.filter((a) => !errata.some((e) => e.source === a || e.id === a));
if (unknown.length) throw new Error(`no source or erratum ${unknown.join(", ")}`);
const chosen = errata.filter((e) => !args.length || args.includes(e.source) || args.includes(e.id));

let failed = 0;
const results: { id: string; source: string; error: string | null }[] = [];
await Promise.all(
  [...Map.groupBy(chosen, (e) => e.source).values()].map(async (list) => {
    for (const e of list) {
      try {
        if (!e.check) throw new Error("no check");
        await e.check(store, e);
        console.log(`pass ${e.id}`);
        results.push({ id: e.id, source: e.source, error: null });
      } catch (error) {
        failed++;
        console.log(`FAIL ${e.id}: ${(error as Error).message}`);
        results.push({ id: e.id, source: e.source, error: (error as Error).message });
      }
    }
  }),
);
console.log(`\n${chosen.length - failed} passed, ${failed} failed`);
if (report)
  writeFileSync(
    report,
    JSON.stringify({
      problems: errataProblems,
      results: results.sort((a, b) => a.id.localeCompare(b.id)),
    }),
  );
if (failed || errataProblems.length) process.exitCode = 1;
