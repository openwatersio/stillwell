/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import { DAY_MS, type Probes } from "../canary.ts";
import * as cmems from "./index.ts";

export const probes: Probes = {
  // Aarhus, relayed from DMI: a week of the latest window, which runs a day or
  // two behind, and three days of the history copy a year back. Its paths name
  // the time chunk and its SQLite files have no shape, so it's never recorded.
  cmems: {
    run: async (start, end) => {
      const latest = await cmems.levels("Aarhus", new Date(end.getTime() - 7 * DAY_MS), end);
      const history = await cmems.levels(
        "Aarhus",
        new Date(start.getTime() - 365 * DAY_MS),
        new Date(end.getTime() - 365 * DAY_MS),
      );
      // Either alone would pass a moved bucket, whose 403s read as no chunk.
      return latest.length && history.length ? [...latest, ...history] : [];
    },
    recorded: false,
  },
};
