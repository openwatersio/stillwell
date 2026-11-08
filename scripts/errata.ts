/**
 * Write docs/errata.md from the list in src/errata.ts.
 *
 *   npm run errata
 */
import { writeFile } from "node:fs/promises";
import { render } from "../src/errata.ts";

await writeFile(new URL("../docs/errata.md", import.meta.url), render());
