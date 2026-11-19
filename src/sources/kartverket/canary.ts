/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as kartverket from "./index.ts";

export const probes: Probes = {
  // Vardø, since 1989.
  kartverket: { run: (start, end) => kartverket.levels("VAW", start, end) },
};
