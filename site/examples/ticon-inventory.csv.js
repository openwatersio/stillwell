// The TICON inventory that `npm run ticon:inventory` writes to docs/, served beside the page that charts it.
import { readFileSync } from "node:fs";

process.stdout.write(readFileSync(new URL("../../docs/ticon-inventory.csv", import.meta.url)));
