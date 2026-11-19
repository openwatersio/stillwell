/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as marineInstitute from "./index.ts";

export const probes: Probes = {
  // Ballycotton, since 2010.
  "marine-institute": {
    run: (start, end) => marineInstitute.levels("Ballycotton Harbour", start, end),
  },
};
