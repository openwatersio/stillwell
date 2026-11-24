/**
 * The errata roundup: for each source with errata not yet reported or
 * questions not yet asked, a draft of the message to its agency (`draft`),
 * with the channel from the adapter's `metadata.contact`, and those held
 * back, whose `report` or `answer` says why. A person translates it into the
 * agency's language, approves and sends it, then records `reported` and
 * `report` on each erratum, and `asked` on each question.
 * Also checks that every erratum ID the code cites is an entry.
 *
 *   npm run errata              every source with unreported errata or unasked questions
 *   npm run errata -- refmar    one or more sources
 */
import { fileURLToPath } from "node:url";
import { citedIn } from "../src/citations.ts";
import { draft } from "../src/errata.ts";
import { errata, errataProblems, questions, sources } from "../src/sources/index.ts";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

for (const p of errataProblems) console.error(p);
if (errataProblems.length) process.exitCode = 1;
const ids = new Set(errata.map((e) => e.id));
const stray = [...citedIn(SRC)].filter(([id]) => !ids.has(id));
for (const [id, where] of stray)
  console.error(`${where.join(", ")} cites ${id}, which no entry holds`);
if (stray.length) process.exitCode = 1;

const asked = process.argv.slice(2);
for (const id of asked) if (!sources[id]) throw new Error(`Unknown source ${id}`);
for (const [id, { metadata }] of Object.entries(sources)) {
  if (asked.length && !asked.includes(id)) continue;
  const { text, held } = draft(id, metadata, errata, questions);
  for (const h of held) console.error(h);
  if (text) console.log(text);
}
