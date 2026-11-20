import { dayAfter, flaggedSpan, type ErrataFile } from "../../errata.ts";
import { Flag } from "../../schema.ts";

export default {
  errata: [
    {
      id: "crms-0626-marsh-well",
      stations: ["crms/CRMS0626-H01"],
      since: "2009-05-07",
      until: "2010-06-03",
      handling: "flagged",
      error:
        "CPRA's export files CRMS0626's marsh well under the site's surface-water gauge, `CRMS0626-H01`, from 7 May 2009 to 2 June 2010: 8,721 rows whose `Sensor Environment` reads `Marsh Well`, 8,111 of them with an elevation. The marsh well measures water in the marsh soil.",
      response:
        "The adapter leaves out a surface-water gauge's elevations labeled `Marsh Well`, and fails on any other label but `Surface Water`, so no fetch brings these values. The ones the store already holds are flagged `suspect` over the span once `requalify` runs over it, since a refetch keeps the months it brings nothing for; a store backfilled anew doesn't hold them. Errata spans are whole days, so the two surface-water values of 2 June 2010, from 22:00 UTC, are flagged too.",
      evidence:
        "In CPRA's export of 8 November 2026, all 8,111 of those elevations equal the site's marsh well, `CRMS0626-W01`, at the same hour to the millimeter. The rows are `CRMS0626-H01`'s first, from 17:00 UTC on 7 May 2009. The well's own series ends at 21:00 UTC on 2 June 2010, and `CRMS0626-H01`'s surface-water rows start at 22:00. No other `H0n` series in the export has a row that isn't `Surface Water`. GESLA's CRMS0626 record isn't the well: it matches `CRMS0626-W01` on 1 to 7% of hours a year.",
      check: async (store, e) => {
        const [id, since, until] = [e.stations![0]!, e.since!, e.until!];
        if ((await store.levels(id, since, dayAfter(since, 1))).length)
          return flaggedSpan(store, e);
        // A store backfilled anew holds none of the marsh well, so the series starts with the span's last day's surface-water values, flagged with the rest.
        const lastDay = dayAfter(until, -1);
        if ((await store.levels(id, since, lastDay)).length)
          throw new Error(`the store holds ${id} levels inside the span but none on its first day`);
        const last = await store.levels(id, lastDay, until);
        if (last.some((o) => o.flag < Flag.suspect))
          throw new Error(`${id}'s levels on ${lastDay} aren't all suspect`);
        if (!(await store.levels(id, until, dayAfter(until, 28))).length)
          throw new Error(`the store holds no ${id} levels after the span`);
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
