/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import { DAY_MS, type Probes } from "../canary.ts";
import * as jma from "./index.ts";

export const probes: Probes = {
  // Kushimoto, since 1924: a week of provisional values, which arrive a day or
  // two late, and three days of final ones a year back. Its paths name the month
  // and its text has no shape, so it's never recorded and only has to return values.
  jma: {
    run: async (start, end) => {
      const latest = await jma.levels("KS", new Date(end.getTime() - 7 * DAY_MS), end);
      const final = await jma.levels(
        "KS",
        new Date(start.getTime() - 365 * DAY_MS),
        new Date(end.getTime() - 365 * DAY_MS),
      );
      // Either set alone would pass a path JMA moved, whose 404s read as no file.
      return latest.length && final.length ? [...latest, ...final] : [];
    },
    recorded: false,
  },
};
