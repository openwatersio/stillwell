/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as ispra from "./index.ts";

export const probes: Probes = {
  // Napoli, January 2014: the dump, then the first month of a gauge with files.
  ispra: {
    run: (start, end) => ispra.levels("napoli", new Date("2014-01-01Z"), new Date("2014-01-04Z")),
  },
};
