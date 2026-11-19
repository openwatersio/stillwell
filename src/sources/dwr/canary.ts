/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import { DAY_MS, type Probes } from "../canary.ts";
import * as dwr from "./index.ts";

export const probes: Probes = {
  // Fisherman's Cut in the Delta, from the tail of its file, which runs a day or two behind.
  dwr: {
    run: (start, end) =>
      dwr.levels(
        {
          source_id: "B95050Q",
          parameter: "WaterSurfaceElevationNAVD88",
          datum: "NAVD88",
          record_start: "2015-10-01T08:00:00.000Z",
        },
        new Date(start.getTime() - 7 * DAY_MS),
        end,
      ),
  },
};
