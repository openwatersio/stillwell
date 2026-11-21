/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as usgs from "./index.ts";

export const probes: Probes = {
  // Mississippi River at Baton Rouge, gage height.
  usgs: {
    run: (start, end) => usgs.levels("9361fa9f474443a4b2391c1f1a63ca4b", start, end),
    env: ["USGS_API_KEY"],
  },
};
