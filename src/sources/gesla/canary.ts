/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as gesla from "./index.ts";

export const probes: Probes = {
  // GESLA's iCloud links are signed anew every 15 minutes, so it's never recorded.
  // A static release, so its metadata, from one iCloud share, then a record's
  // first days from the other: Honolulu Pier 45, one of the smallest.
  gesla: {
    run: async (start, end) => [
      ...(await gesla.stations()).slice(0, 1),
      ...(await gesla.levels(
        { source_id: "honolulu_pier_45-027a-usa-uhslc_rq", kind: "coastal" },
        new Date("1985-10-26Z"),
        new Date("1985-10-29Z"),
      )),
    ],
    recorded: false,
  },
};
