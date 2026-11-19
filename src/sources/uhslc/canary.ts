/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import { DAY_MS, type Probes } from "../canary.ts";
import * as uhslc from "./index.ts";

export const probes: Probes = {
  // Honolulu: its FD series ten weeks back, since FD values arrive 4 to 6
  // weeks late, and three days of its research-quality version A.
  uhslc: {
    run: async (start, end) => [
      ...(await uhslc.levels(
        "057",
        new Date(start.getTime() - 70 * DAY_MS),
        new Date(end.getTime() - 70 * DAY_MS),
      )),
      ...(await uhslc.levels("057a", new Date("1880-01-01Z"), new Date("1880-01-04Z"))),
    ],
  },
};
