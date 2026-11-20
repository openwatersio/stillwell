import { flaggedSpan, type ErrataFile } from "../../errata.ts";
import { Flag } from "../../schema.ts";
import { distanceKm, median } from "../../stats.ts";

export default {
  errata: [
    {
      id: "rws-ameland-westgat-twice",
      stations: ["rws/ameland.westgat", "rws/amelandwestgat"],
      handling: "kept",
      error:
        "RWS lists the Ameland Westgat gauge twice, as `ameland.westgat` and `amelandwestgat`, a few meters apart.",
      response: "Both are kept as served, and linked in `same_as` as one gauge.",
      evidence: "RWS's catalog lists both codes at 53.4916° N, 5.9412° E.",
      reported: "2026-11-08",
      report:
        "Submitted through Rijkswaterstaat's web contact form on 2026-11-08. It asks whether the two codes are two sensors or a duplicate, since their levels differ by about 33 cm. No answer yet. Text in [#62](https://github.com/openwatersio/stillwell/issues/62).",
      check: async (store, e) => {
        const [a, b] = await Promise.all(e.stations!.map((id) => store.station(id)));
        if (!a || !b) throw new Error("the store doesn't list both Ameland Westgat codes");
        if (distanceKm(a, b) > 0.05)
          throw new Error("the two Ameland Westgat codes are more than 50 m apart");
        if (!a.same_as.includes(b.id) || !b.same_as.includes(a.id))
          throw new Error("the two Ameland Westgat codes aren't linked in same_as");
      },
    },
    {
      id: "rws-kralendijk-2026-level",
      stations: ["rws/kralendijk.plazabeachterminal"],
      since: "2026-10-27",
      handling: "kept",
      error:
        "RWS's Kralendijk Plazabeach Terminal levels from 27 October 2026 on sit about 0.75 m above January and February 2026's, with no change of datum marked.",
      response:
        "The record splits into datum epochs on 27 October 2026, and the store keeps the values as served. No gauge nearby measures the offset, so the epoch before has none and stays out of the combined series, readable on its own zero, until RWS answers.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`) over every record the store lists as coastal, November 2026; the store holds no other record of the gauge or gauge nearby to compare, so this rests on the record's own medians. Monthly medians are −0.62 m in January and February 2026 and +0.12 to +0.15 m in October and November, with no values between. No other gauge in the store lies within 150 km.",
      check: async (store, e) => {
        const [id, since] = [e.stations![0]!, e.since!];
        const station = await store.station(id);
        const before = station?.epochs.find((epoch) => epoch.until?.startsWith(since));
        if (!before || before.to_current !== null)
          throw new Error(
            `Kralendijk has no epoch ending on ${since} without an offset to the current one`,
          );
        const level = async (since: string, until: string) => {
          const rows = await store.levels(id, since, until);
          if (!rows.length)
            throw new Error(`the store holds no Kralendijk levels from ${since} to ${until}`);
          return median(rows.map((o) => o.level));
        };
        const rise =
          (await level("2026-11-01", "2026-11-08")) - (await level("2026-02-01", "2026-02-08"));
        if (rise < 0.5)
          throw new Error(
            `Kralendijk's November 2026 sits ${(rise * 100).toFixed(0)} cm above February's, not about 75`,
          );
      },
    },
    {
      id: "rws-petten-meetraai3-2012-zero",
      stations: ["rws/petten.meetraai3"],
      since: "2012-10-22",
      until: "2013-05-16",
      handling: "flagged",
      error:
        "From 22 October 2012 to the record's end on 15 May 2013, RWS's Petten meetraai 03 series holds exactly 0.00 m NAP for hours at a time through high and low water, a fill value rather than the sea.",
      response:
        "22 October 2012 to 15 May 2013 is flagged `suspect`, keeping the source flag as `source_flag`. About 800 of the span's 19,000 values are the held fill, and the rest is sound tide, but the fill comes and goes within hours, so only the whole span covers it: QC of a tidal gauge flags 199 of the 797 held values.",
      evidence:
        "Found from the station's analysis, November 2026: the held values counted as drains and judged it not tidal. 0.00 m NAP is about mid-tide at Petten, where the tide runs from about −1.0 to 0.8 m. From 22 October 2012 to 3 May 2013 the series jumps from the tide to exactly 0.00 m and holds it in 33 runs of an hour or more, 5 of them 6 hours or more, through high and low water. Before that, 0.00 m appears 60 to 125 times a year as the tide passes through it, rarely twice in a row. GESLA's copy carries the same values (erratum `gesla-petten-meetraai3-2012-zero`).",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const rows = await store.levels(e.stations![0]!, e.since!, e.until!);
        const not = rows.filter((o) => o.flag < Flag.suspect);
        if (not.length)
          throw new Error(`${not.length} Petten values in the span aren't flagged suspect`);
        // Runs of 0.00 m lasting an hour or more.
        let runs = 0;
        let start: number | null = null;
        for (const [i, o] of rows.entries()) {
          if (o.level === 0) start ??= o.time;
          else if (start !== null) {
            if (rows[i - 1]!.time - start >= 3_600_000) runs++;
            start = null;
          }
        }
        if (runs < 20)
          throw new Error(
            `Petten holds 0.00 m for an hour or more ${runs} times in the span, not about 33`,
          );
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
