/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as crms from "./index.ts";
import { header as crmsHeader } from "./export.ts";

export const probes: Probes = {
  // The CSV's header, from the export's directory and first 64 KB, checked by
  // the adapter's parser, then the station list: the whole 1.3 GB export is
  // read only once a month, by the refetch.
  crms: {
    run: async (start, end) => {
      await crmsHeader(crms.parser);
      return crms.stations();
    },
  },
};
