/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as cco from "./index.ts";

export const probes: Probes = {
  // Its levels path names the request's time, so it's never recorded.
  // Deal Pier, found by name in the site list; needs a key, so it is skipped without one.
  cco: {
    run: async (start, end) => {
      const deal = (await cco.stations()).find((s) => s.name === "Deal Pier");
      if (!deal) throw new Error("CCO no longer lists Deal Pier");
      return cco.levels(deal.source_id, start, end);
    },
    recorded: false,
    env: ["CCO_API_KEY", "CCO_REFERER"],
  },
};
