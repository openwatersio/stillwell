/**
 * Prints the errata report (src/errata-report.ts) as Markdown, from an
 * `errata-check --report` file and the `--findings` files of the Monthly run's
 * cross-check jobs. Exits 1 when a file can't be read or isn't what it should
 * be, so a broken input never reads as nothing to do.
 *
 *   node scripts/errata-report.ts report.json [findings.json ...]
 *
 * Run from the Errata check workflow; the errata runbook reads its output.
 */
import { readFileSync } from "node:fs";
import { reviewed } from "../src/cross-check-reviewed.ts";
import { errataReport, parseChecks } from "../src/errata-report.ts";
import { parseFindings } from "../src/findings.ts";

const [file, ...findingsFiles] = process.argv.slice(2);
if (!file) throw new Error("usage: node scripts/errata-report.ts report.json [findings.json ...]");
const checks = (() => {
  try {
    return parseChecks(JSON.parse(readFileSync(file, "utf8")));
  } catch (error) {
    throw new Error(`${file}: ${(error as Error).message}`);
  }
})();
const findings = findingsFiles.map((f) => {
  try {
    return parseFindings(JSON.parse(readFileSync(f, "utf8")));
  } catch (error) {
    throw new Error(`${f}: ${(error as Error).message}`);
  }
});
console.log(errataReport(checks, findings, reviewed));
