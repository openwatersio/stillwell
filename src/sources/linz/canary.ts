/** The weekly canary's probes (scripts/canary.ts): a few days at a long-running gauge, through the adapter. */
import { DAY_MS, type Probes } from "../canary.ts";
import { Flag } from "../../schema.ts";
import * as linz from "./index.ts";

export const probes: Probes = {
  // Wellington, since 2007: three days of daily files from about two weeks back, since
  // they appear 6 to 12 days late, and three days of a year's file from four years back; Cape Roberts and
  // Scott Base, three days of a year's file each. Its paths name the
  // year and the day, so it's never recorded and only has to return values.
  linz: {
    run: async (start, end) => {
      const latest = await linz.levels(
        "WLGT",
        new Date(start.getTime() - 14 * DAY_MS),
        new Date(end.getTime() - 14 * DAY_MS),
      );
      const final = await linz.levels(
        "WLGT",
        new Date(start.getTime() - 1500 * DAY_MS),
        new Date(end.getTime() - 1500 * DAY_MS),
      );
      // A listing that lost its yearly zip falls back to the day files, which are preliminary. In early
      // January the latest days can come from last year's zip, so only the old year is held to its flag.
      const read = final.every((o) => o.flag === Flag.good);
      // The Antarctic gauges' files change layout from year to year, so one year of each is read too,
      // on fixed days since one gauge is closed and the other issues a year at a time: Cape Roberts'
      // Julian-day layout of 2025 and Scott Base's day-first millimeters of 2025.
      const robt = await linz.levels("ROBT", new Date("2025-03-01"), new Date("2025-03-04"));
      const scot = await linz.levels("SCOT", new Date("2025-01-10"), new Date("2025-01-13"));
      return latest.length && final.length && read && robt.length && scot.length
        ? [...latest, ...final, ...robt, ...scot]
        : [];
    },
    recorded: false,
  },
};
