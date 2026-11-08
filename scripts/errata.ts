/**
 * Check the errata in the open `source-error` issues against the code: every
 * issue parses, no ID is reused, and every erratum ID the code cites is one
 * of them. An issue for a source this build doesn't register, a typo or a
 * source still in a pull request, is checked in full and is a warning, as is
 * an erratum its adapter doesn't cite yet, between opening the issue and
 * merging the change that cites it. CI runs this with
 * GITHUB_TOKEN.
 *
 *   npm run errata
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { citedIn, openErrata } from "../src/errata.ts";
import { sources } from "../src/sources/index.ts";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const fetched = await openErrata(Object.keys(sources)).catch((error: Error) => error);
if (fetched instanceof Error) {
  console.log(`::error::Couldn't read the source-error issues: ${fetched.message}`);
  process.exit(1);
}
const { errata, problems, ignored, unregistered } = fetched;
for (const u of unregistered)
  console.log(
    `::warning::#${u.issue} is for ${u.source}, which this build doesn't register: a typo, or a source still in a pull request`,
  );
for (const p of problems) console.log(`::error::${p.message}`);
if (ignored.length)
  console.log(`source-error issues not from a maintainer, not errata: #${ignored.join(", #")}`);

const cited = citedIn(SRC);
// An adapter in the repo but not registered yet can cite its own errata.
const open = new Set([...errata, ...unregistered.map((u) => u.erratum!)].map((e) => e.id));
const stray = [...cited].filter(([id]) => !open.has(id));
for (const [id, where] of stray)
  console.log(`::error::${where.join(", ")} cites ${id}, which no open source-error issue holds`);
for (const e of errata)
  if (!cited.get(e.id)?.some((f) => f.startsWith(join(SRC, "sources", e.source, "/"))))
    console.log(`::warning::${e.id} (#${e.issue}) isn't cited in src/sources/${e.source}/ yet`);

console.log(
  `${errata.length} errata, ${problems.length} issues that don't parse, ${stray.length} stray citations`,
);
if (problems.length || stray.length) process.exitCode = 1;
