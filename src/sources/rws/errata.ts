import { dayAfter, flaggedSpan, type ErrataFile } from "../../errata.ts";
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
      stations: ["rws/petten.meetraai3", "gesla/petten_meetraai_03-pet-nld-rws"],
      since: "2012-10-22",
      until: "2013-05-16",
      handling: "flagged",
      error:
        "From 22 October 2012 to the record's end on 15 May 2013, RWS's Petten meetraai 03 series holds exactly 0.00 m NAP for hours at a time through high and low water, a fill value rather than the sea. GESLA's copy of the series carries the same values.",
      response:
        "22 October 2012 to 15 May 2013 is flagged `suspect`, keeping each record's own flag as `source_flag`. About 800 of the span's 19,000 values are the held fill, and the rest is sound tide, but the fill comes and goes within hours, so only the whole span covers it: QC of a tidal gauge flags 199 of the 797 held values.",
      evidence:
        "Found from the station's analysis, November 2026: the held values counted as drains and judged it not tidal. 0.00 m NAP is about mid-tide at Petten, where the tide runs from about −1.0 to 0.8 m. From 22 October 2012 to 3 May 2013 the series jumps from the tide to exactly 0.00 m and holds it in 33 runs of an hour or more, 5 of them 6 hours or more, through high and low water. Before that, 0.00 m appears 60 to 125 times a year as the tide passes through it, rarely twice in a row. GESLA's copy (`gesla/petten_meetraai_03-pet-nld-rws`) holds the same 778 values of 0.00 m in 2012 and 466 in 2013.",
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
    {
      id: "rws-hourly-means-weirs",
      stations: [
        "rws/dehaandrik.beneden",
        "rws/dehaandrik.boven",
        "rws/hardenberg.beneden",
        "rws/hardenberg.boven",
        "rws/junne.beneden",
        "rws/junne.boven",
        "rws/marienberg.beneden",
        "rws/marienberg.boven",
        "rws/vechterweerd.boven",
        "rws/vilsteren.beneden",
        "rws/vilsteren.boven",
      ],
      since: "1999-12-31",
      until: "2005-01-01",
      handling: "kept",
      error:
        "From midnight on 1 January 2000 (local time) to 2004, RWS serves these weirs' levels only as hourly means (`WaardeBewerkingsMethode` `GEMH`), on the hour, from the float gauge that gave readings (`NVT`) in 1999. RWS doesn't say whether a mean is stamped at the start, middle or end of its hour.",
      response:
        "The means are stored as levels at the times RWS stamps them, flagged as the source flags them (`preliminary`), until the sampling metadata of [#527](https://github.com/openwatersio/stillwell/issues/527) says which values are means and where they are stamped.",
      evidence:
        "Read from RWS's answers, November 2026, for all 11 stations and all 6 years (66 station-years): every year from 2000 to 2004 is one `GEMH` series of 3,150 to 8,785 values from the float gauge (`other:Vlotterniveaumeter`), stamped on the hour, with source flag `Ongecontroleerd`, and 1999 holds that gauge's hourly readings (8,452 to 8,759 values) up to 31 December 23:00, then two `GEMH` values. The series continues across the change of label at midnight on 1 January 2000 at dehaandrik.boven (911, 911 cm at the last two readings, 912, 912 cm at the first two means); at the other 10 only the counts were read. In all 55 station-years of means, the hourly change of level has a median of 1 to 2 cm, a 90th percentile of 1 to 6 cm and a 99th percentile of 2 to 17 cm, so for most hours a mean stamped half an hour from where a reading would be differs from it by about 1 cm or less, and by up to about half of the 99th percentile in the steepest 1% of hours. The documentation we found doesn't say where a mean is stamped. The refetch of the whole record, 1800 to 2027, failed on a `GEMH` series only at these 11 stations and only in these years, so no other station or year holds one.",
      reported: null,
      report: null,
      check: async (store, e) => {
        // Hourly values on the hour, read on two days of each year of the span; a station that has a gap on all of them fails.
        for (const station of e.stations!) {
          let read = 0;
          for (const day of ["2000", "2001", "2002", "2003", "2004"].flatMap((y) => [
            `${y}-03-15`,
            `${y}-09-15`,
          ])) {
            const rows = await store.levels(station, day, dayAfter(day, 1));
            read += rows.length;
            const off = rows.filter((o) => o.time % 3_600_000 !== 0);
            if (off.length)
              throw new Error(`${station} holds ${off.length} values off the hour on ${day}`);
            if (rows.length > 24)
              throw new Error(`${station} holds ${rows.length} values on ${day}, more than hourly`);
          }
          if (!read) throw new Error(`${station} holds no hourly mean on any day read`);
        }
      },
    },
    {
      id: "rws-eemshaven-waddenzee-2016-offset",
      stations: ["rws/eemshaven.waddenzee", "gesla/eemshaven_waddenzee-eem-nld-rws"],
      since: "2016-04-07",
      until: "2016-05-12",
      handling: "flagged",
      error:
        "RWS's Eemshaven Waddenzee levels sit 15 to 20 cm higher than usual against Delfzijl from 7 April to 11 May 2016. GESLA's copy of the RWS record carries the same values.",
      response:
        "7 April to 11 May 2016 is flagged `suspect`, keeping each record's own flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026, in GESLA's copy (`gesla/eemshaven_waddenzee-eem-nld-rws`): a step of +18 cm against three of three neighboring gauges on 8 April 2016 and back on 20 May. Daily means against GESLA's Delfzijl (`gesla/delfzijl-del-nld-rws`) are about −9 cm through March and from mid-May, +1 cm on 7 April, and +7 to +12 cm on most days from 14 April to 11 May, falling to −3 cm on 12 May. The step check compares 30-day medians, so its dates are a few days off; the span follows the daily means. RWS's own record (`rws/eemshaven.waddenzee`) holds the same values at all 5,040 times the two share, on all 35 days of the span, so the offset is RWS's.",
      check: (store, e) => flaggedSpan(store, e),
    },
  ],
  retired: [],
} satisfies ErrataFile;
