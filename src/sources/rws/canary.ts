/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as rws from "./index.ts";

export const probes: Probes = {
  rws: { run: (start, end) => rws.levels("hoekvanholland", start, end, { fresh: true }) },
};
