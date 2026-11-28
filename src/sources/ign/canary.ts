/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as ign from "./index.ts";

export const probes: Probes = {
  // The admitted hourly archive, a fixed plain-text export, so it's never recorded; no raw or minute fallback.
  ign: {
    run: async () =>
      (await ign.corunaHourly(new Date("2000-01-02Z"), new Date("2000-01-04Z"))).filter(
        (r) => !r.withdrawn,
      ),
    recorded: false,
  },
};
