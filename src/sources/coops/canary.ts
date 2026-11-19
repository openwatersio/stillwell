/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as coops from "./index.ts";

export const probes: Probes = {
  // San Francisco; live, so no metadata request for its dates.
  coops: { run: (start, end) => coops.levels("9414290", start, end, { live: true }) },
};
