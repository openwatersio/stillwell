/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import type { Probes } from "../canary.ts";
import * as sfwmd from "./index.ts";

export const probes: Probes = {
  // S-123 tailwater on Biscayne Bay: the telemetry series, and two days of the derived one in 2024.
  sfwmd: {
    run: async (start, end) => {
      const live = await sfwmd.levels(
        { series: "IY320", history: null, history_end: null },
        start,
        end,
      );
      // The derived series alone would pass a live feed that returns nothing.
      return live.length
        ? [
            ...live,
            ...(await sfwmd.levels(
              { series: "IY320", history: "AP159", history_end: "2026-05-11T05:00:00.000Z" },
              new Date("2024-01-16T05:00:00Z"),
              new Date("2024-01-18T05:00:00Z"),
            )),
          ]
        : [];
    },
  },
};
