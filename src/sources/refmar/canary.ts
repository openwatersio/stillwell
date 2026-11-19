/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import { DAY_MS, type Probes } from "../canary.ts";
import * as refmar from "./index.ts";

export const probes: Probes = {
  // Brest: three days of raw values, and three of validated ones a year back.
  refmar: {
    run: async (start, end) => [
      ...(await refmar.levels({ source_id: "3", first_observation: null }, start, end)),
      ...(await refmar.levels(
        { source_id: "3", first_observation: null },
        new Date(start.getTime() - 365 * DAY_MS),
        new Date(end.getTime() - 365 * DAY_MS),
      )),
    ],
  },
};
