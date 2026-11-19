/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as cdec from "./index.ts";

export const probes: Probes = {
  // Martinez, on the Carquinez Strait.
  cdec: { run: (start, end) => cdec.levels({ source_id: "MRZ" }, start, end) },
};
