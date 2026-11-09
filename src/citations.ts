/** Erratum citations in the repository's files, for the tests and `npm run errata`. Node only. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The erratum IDs cited under `dir`, with the files that cite each. */
export function citedIn(dir: string): Map<string, string[]> {
  const files = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)],
    );
  const cited = new Map<string, string[]>();
  for (const file of files(dir))
    for (const id of citations(readFileSync(file, "utf8")))
      cited.set(id, [...(cited.get(id) ?? []), file]);
  return cited;
}

/** Erratum IDs cited in a file's text, as erratum `<id>`. */
export function citations(text: string): string[] {
  return [...text.matchAll(/[Ee]rratum\s+(?:\*\s+)?`([a-z0-9-]+)`/g)].map((m) => m[1]!);
}
