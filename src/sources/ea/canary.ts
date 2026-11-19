/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as ea from "./index.ts";

export const probes: Probes = {
  // Newlyn, from the readings API.
  ea: { run: (start, end) => ea.levels("E72239-level-tidal_level-Mean-15_min-mAOD", start, end) },
};
