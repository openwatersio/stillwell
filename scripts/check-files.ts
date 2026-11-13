/**
 * Compare a sample of a store's files with their definitions in
 * src/store/files.ts: `sources.json` and `errata.json` with their JSON
 * Schemas; `stations.parquet`, the offsets and links; each source's list,
 * years, analysis and recent window where it has them; one year file of
 * observed levels per source, the latest its years file lists; and the
 * examples of the other series. Prints what differs and exits 1 if anything
 * does. The weekly bucket check runs it against the public store.
 *
 *   node scripts/check-files.ts [https://stillwell.openwaters.io]
 */
import { FILES, JSON_FILES, jsonProblems, type ParquetFile } from "../src/store/files.ts";
import { checkFile, isMissing, readRows } from "../src/store/parquet.ts";
import { seriesPath } from "../src/store/paths.ts";

const base = process.argv[2] ?? "https://stillwell.openwaters.io";
// The JSON files are fetched, so only an HTTP(S) store can be checked.
if (!/^https?:\/\//.test(base)) throw new Error(`${base}: only an HTTP(S) store can be checked`);
let failed = false;
const report = (path: string, problems: string[]) => {
  console.log(`${problems.length ? "✗" : "✓"} ${path}`);
  for (const p of problems.slice(0, 20)) console.log(`    ${p}`);
  if (problems.length > 20) console.log(`    and ${problems.length - 20} more`);
  if (problems.length) failed = true;
};

const json: Record<string, unknown> = {};
for (const [path, schema] of Object.entries(JSON_FILES)) {
  const response = await fetch(`${base}/${path}`);
  if (!response.ok) report(path, [`HTTP ${response.status}`]);
  else report(path, jsonProblems(schema, (json[path] = await response.json())));
}
// The per-source files are found through sources.json, so without any there's nothing to sample.
const sources = ((json["sources.json"] ?? []) as { id: string }[]).map((s) => s.id);
if (!sources.length) report("sources.json", ["no sources"]);

/** Check a file; one a source doesn't have yet, such as a recent window, is skipped when `optional`. */
async function check(path: string, file: ParquetFile, optional = false): Promise<void> {
  try {
    report(path, await checkFile(`${base}/${path}`, file));
  } catch (error) {
    if (optional && isMissing(error)) console.log(`- ${path}: none`);
    else report(path, [String(error)]);
  }
}

for (const f of [FILES.stations, FILES.offsets, FILES.links]) await check(f.path, f);
for (const f of [FILES.extremes, FILES.predictions, FILES["predicted-extremes"]])
  await check(f.example, f);
for (const source of sources) {
  await check(`stations/${source}.parquet`, FILES.lists);
  await check(`stations/analysis/${source}.parquet`, FILES.analysis, true);
  await check(`recent/${source}.parquet`, FILES.recent, true);
  const years = `stations/years/${source}.parquet`;
  await check(years, FILES.years, true);
  // A missing years file has no rows; one that can't be read fails the check.
  const rows = await readRows(`${base}/${years}`).catch((error: unknown) => {
    report(years, [String(error)]);
    return [];
  });
  const latest = rows
    .filter((r) => r.year !== null)
    .sort((a, b) => Number(b.year) - Number(a.year) || String(a.id).localeCompare(String(b.id)))[0];
  if (latest) {
    const id = String(latest.id);
    const path = seriesPath(
      "",
      "levels",
      source,
      id.slice(source.length + 1),
      Number(latest.year),
      Number(latest.epoch),
    ).slice(1);
    await check(path, FILES.obs);
  }
}

process.exit(failed ? 1 : 0);
