/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as jodc from "./index.ts";

export const probes: Probes = {
  // Mitajiri-Nakanoseki's whole record, 2011 to 2013, the smallest zip (34 KB).
  jodc: {
    run: (start, end) => jodc.levels("8413", new Date("2012-01-01Z"), new Date("2012-01-04Z")),
  },
};
