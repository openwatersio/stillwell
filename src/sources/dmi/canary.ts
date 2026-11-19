/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as dmi from "./index.ts";

export const probes: Probes = {
  // Hornbæk, on DVR90 since 1997.
  dmi: { run: (start, end) => dmi.levels("30017", start, end) },
};
