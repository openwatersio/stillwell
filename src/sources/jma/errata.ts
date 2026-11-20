import type { ErrataFile } from "../../errata.ts";

export default {
  errata: [
    {
      id: "jma-saigo-1980-day-stamp",
      stations: ["jma/SA"],
      since: "1980-10-21",
      until: "1980-10-23",
      handling: "corrected",
      error:
        "JMA's historical file for Saigo in October 1980 stamps its 22nd line as the 20th, between lines stamped the 21st and 23rd.",
      response:
        "The line is read as the 22nd, since the lines on either side are stamped the 21st and 23rd.",
      evidence:
        'The file is `sea_lev_var/1980/198010/hry198010SA.txt`. Its 22nd line, stamped `801020SA`, sits between lines stamped `801021SA` and `801023SA`; the backfill of 1924–2026 failed on it with "not a day, or a day twice". [#57](https://github.com/openwatersio/stillwell/pull/57) reads it as the 22nd.',
      reported: "2026-11-08",
      report:
        "Submitted through JMA's web feedback form on 2026-11-08. No answer yet. Text in [#58](https://github.com/openwatersio/stillwell/issues/58).",
      // The line read as the 22nd fills JST 22 October and runs on from the 21st into the 23rd within an hour's change of the tide.
      check: async (store, e) => {
        const HOUR_MS = 3_600_000;
        const rows = await store.levels(e.stations![0]!, "1980-10-19", "1980-10-24");
        const jst = (day: number) => Date.UTC(1980, 9, day) - 9 * HOUR_MS;
        for (let day = 20; day <= 23; day++) {
          const n = rows.filter((o) => o.time >= jst(day) && o.time < jst(day + 1)).length;
          if (n !== 24)
            throw new Error(`the store holds ${n} Saigo levels on ${day} October 1980 JST, not 24`);
        }
        const steps = rows
          .slice(1)
          .map((o, i) => ({ time: o.time, change: Math.abs(o.level - rows[i]!.level) }));
        const within = Math.max(
          ...steps.filter((s) => s.time !== jst(22) && s.time !== jst(23)).map((s) => s.change),
        );
        for (const s of steps.filter((s) => s.time === jst(22) || s.time === jst(23)))
          if (s.change > within)
            throw new Error(
              `Saigo's level changes ${s.change.toFixed(2)} m at ${new Date(s.time).toISOString()}, the edge of 22 October 1980 JST, more than in any other hour`,
            );
        const day = (d: number) =>
          rows.filter((o) => o.time >= jst(d) && o.time < jst(d + 1)).map((o) => o.level);
        if (day(22).every((v, i) => v === day(20)[i]))
          throw new Error("Saigo's 22 October 1980 JST holds the 20th's levels");
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
