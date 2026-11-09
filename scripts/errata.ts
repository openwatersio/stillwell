/**
 * The errata roundup: for each source with errata not yet reported, a draft of
 * the message to its agency, and those held back, whose `report` says why, with the channel from the adapter's
 * `metadata.contact`. A person translates it into the agency's language,
 * approves and sends it, then records `reported` and `report` on each entry.
 * Also checks that every erratum ID the code cites is an entry.
 *
 *   npm run errata              every source with unreported errata
 *   npm run errata -- refmar    one or more sources
 */
import { fileURLToPath } from "node:url";
import { citedIn } from "../src/citations.ts";
import { errata, errataProblems, sources } from "../src/sources/index.ts";

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
const span = (since: string | null, until: string | null) =>
  since && until
    ? `${since} to before ${until}`
    : since
      ? `from ${since}`
      : until
        ? `before ${until}`
        : "";
for (const [id, { metadata }] of Object.entries(sources)) {
  if (asked.length && !asked.includes(id)) continue;
  // A `report` with no `reported` date says why the entry is held back for now.
  const due = errata.filter((e) => e.source === id && !e.reported && !e.report);
  const held = errata.filter((e) => e.source === id && !e.reported && e.report);
  for (const e of held) console.error(`${e.id} held: ${e.report}`);
  if (!due.length) continue;
  const { email, url } = metadata.contact;
  console.log(`## ${metadata.name}\n\nTo: ${[email, url].filter(Boolean).join(" or ")}\n`);
  for (const e of due)
    console.log(
      [
        `### ${e.id}`,
        e.error,
        `Stations: ${e.stations === null ? "every station" : e.stations.join(", ") || "none listed"}${span(e.since, e.until) ? `; values ${span(e.since, e.until)}` : ""}.`,
        e.evidence ?? "",
        `What we do meanwhile: ${e.lake}`,
      ]
        .filter(Boolean)
        .join("\n\n") + "\n",
    );
}
