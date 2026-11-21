/**
 * One small live request per adapter, from its `src/sources/<source>/canary.ts`, checked against the shape recorded in
 * src/sources/<source>/canary.json, so a change upstream fails a check rather
 * than leaving gaps in the store.
 *
 *   node scripts/canary.ts [source...] [--record]
 *
 * Each probe goes through the adapter's own code, so its pacing applies and
 * its own checks (units, datums) run too, and it has to return values. Every
 * response is shaped by its URL path; `--record` writes those shapes as the
 * new reference, after a change has been checked and the adapter handles it.
 * A source with no recording yet prints its shape and has only to return
 * values. A probe is skipped without the environment variables its `env` names.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fetchText, setTransport } from "../src/http.ts";
import { drift, merge, type Shape, shapeOf } from "../src/shape.ts";
import { DAY_MS, type Probes } from "../src/sources/canary.ts";

const end = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
// Three days, so a gauge's outage of a day or two still leaves values.
const start = new Date(end.getTime() - 3 * DAY_MS);

/** Every source's probes, from its own `canary.ts`. */
const probes: Probes = {};
for (const dir of readdirSync(new URL("../src/sources/", import.meta.url), {
  withFileTypes: true,
})) {
  const file = new URL(`../src/sources/${dir.name}/canary.ts`, import.meta.url);
  if (dir.isDirectory() && existsSync(file))
    Object.assign(probes, ((await import(file.href)) as { probes: Probes }).probes);
}

const args = process.argv.slice(2);
const record = args.includes("--record");
const named = args.filter((a) => !a.startsWith("--"));
for (const id of named) if (!probes[id]) throw new Error(`No canary for ${id}`);

let failed = false;
for (const id of named.length ? named : Object.keys(probes)) {
  const probe = probes[id]!;
  const missing = probe.env?.filter((name) => !process.env[name]) ?? [];
  if (missing.length) {
    console.log(`${id}: skipped, no ${missing.join(" and no ")}`);
    continue;
  }
  const shapes: Record<string, Shape[]> = {};
  setTransport(async (url, options) => {
    const text = await fetchText(url, options);
    (shapes[new URL(url).pathname] ??= []).push(shapeOf(text));
    return text;
  });
  const file = new URL(`../src/sources/${id}/canary.json`, import.meta.url);
  try {
    const values = await probe.run(start, end);
    const live = Object.fromEntries(Object.entries(shapes).map(([path, s]) => [path, merge(...s)]));
    if (record) {
      if (!values.length) throw new Error("no values, so nothing to record");
      if (probe.recorded === false) {
        console.log(`${id}: not recorded; its probe sets recorded: false`);
        continue;
      }
      writeFileSync(file, `${JSON.stringify(live, null, 2)}\n`);
      console.log(`${id}: recorded ${Object.keys(live).length} responses, ${values.length} values`);
      continue;
    }
    // Until it's recorded, a source has only to return values.
    const recorded: Record<string, Shape> = existsSync(file)
      ? JSON.parse(readFileSync(file, "utf8"))
      : {};
    if (!Object.keys(recorded).length && probe.recorded !== false)
      console.log(
        `${id}: no recorded shape; check this one and record it\n${JSON.stringify(live, null, 2)}`,
      );
    const problems = Object.entries(recorded).flatMap(([path, shape]) =>
      live[path] ? drift(shape, live[path]).map((p) => `${path} ${p}`) : [`no request to ${path}`],
    );
    if (!values.length) problems.push("no values");
    if (problems.length) {
      failed = true;
      console.log(`${id}: FAILED\n${problems.map((p) => `  ${p}`).join("\n")}`);
    } else console.log(`${id}: ok, ${values.length} values`);
  } catch (error) {
    failed = true;
    console.log(`${id}: FAILED\n  ${error instanceof Error ? error.message : error}`);
  }
}
setTransport(fetchText);
if (failed) process.exitCode = 1;
