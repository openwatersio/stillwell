/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as bsh from "./index.ts";

export const probes: Probes = {
  // Cuxhaven's predicted highs and lows: the year's smaller file.
  bsh: { run: (start, end) => bsh.extremes("506P", end.getUTCFullYear()) },
};
