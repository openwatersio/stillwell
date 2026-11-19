/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as smhi from "./index.ts";

export const probes: Probes = {
  // Smögen's latest day, and three days of the closed gauge at Götaälvbron in Gothenburg,
  // whose whole archive is about 100 KB; a recent range would download Smögen's.
  smhi: {
    run: async (start, end) => {
      const latest = await smhi.levels("2111", new Date(end.getTime() - 18 * 3_600_000), end);
      // The archive alone would pass a live feed that returns nothing.
      return latest.length
        ? [
            ...latest,
            ...(await smhi.levels("33092", new Date("2012-01-01Z"), new Date("2012-01-04Z"))),
          ]
        : [];
    },
  },
};
