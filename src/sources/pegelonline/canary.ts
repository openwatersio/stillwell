/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as kuestendaten from "./kuestendaten.ts";
import * as pegelonline from "./index.ts";

export const probes: Probes = {
  // The catalog covers the whole portal, so `catalog()` checks only the six entries backfill needs; never recorded.
  // Hamburg Port Authority's files on kuestendaten.de, which a backfill reads
  // only after each half-year update: the catalog alone, not the 60 MB zips.
  kuestendaten: {
    run: async (start, end) => {
      const entries = await kuestendaten.catalog();
      // A new half-year's files fail the run, so its email reaches someone.
      const update = kuestendaten.update(entries);
      if (update) throw new Error(update);
      return entries;
    },
    recorded: false,
  },
  // Cuxhaven Steubenhöft.
  pegelonline: { run: (start, end) => pegelonline.levels("5990020", start, end) },
};
