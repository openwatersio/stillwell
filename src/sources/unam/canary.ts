/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as unam from "./index.ts";

export const probes: Probes = {
  // La Paz's radar, from the end of its file, which holds 5 days.
  unam: {
    run: (start, end) =>
      unam.levels({ source_id: "14-radar", column: "Nivel del mar (radar promedio)" }, start, end),
  },
};
