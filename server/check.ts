/**
 * Runs one migration's check against the store, as a job of its own
 * (src/jobs/migrations.ts), and fails when it throws.
 *
 *   node server/check.ts <migration> <step>
 *   node server/check.ts selftest [fail]
 */
import { STORE } from "../src/store/stores.ts";
import type { Migration } from "../src/jobs/migrations.ts";

const [id, index] = process.argv.slice(2);
// `stillwell-jobs selftest` runs a job through the whole path that touches no store: `fail` fails it.
if (id === "selftest") {
  console.log(`selftest: node ${process.version}, ${import.meta.filename}, store ${STORE}`);
  process.exit(index === "fail" ? 1 : 0);
}
if (!/^\d{8}-[a-z0-9-]+$/.test(id ?? "")) throw new Error("usage: check.ts <migration> <step>");
const { default: migration } = (await import(`../src/migrations/${id}.ts`)) as {
  default: Migration;
};
const step = migration.steps[Number(index)];
if (!step || !("check" in step)) throw new Error(`${id} has no check at step ${index}`);
await step.verify(STORE);
console.log(`${id}: ${step.check}: passed`);
