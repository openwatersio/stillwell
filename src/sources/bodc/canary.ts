/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as bodc from "./index.ts";

export const probes: Probes = {
  // Aberdeen, from a month BODC has processed: its values arrive months late.
  bodc: {
    run: (start, end) =>
      bodc.levels("abe", new Date("2025-12-01T00:00Z"), new Date("2025-12-04T00:00Z")),
  },
};
