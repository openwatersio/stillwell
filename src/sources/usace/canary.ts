/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as usace from "./index.ts";

export const probes: Probes = {
  usace: {
    run: (start, end) => usace.levels("MVN", "Baton_Rouge.Stage.Inst.1Hour.0.rev", start, end),
  },
};
