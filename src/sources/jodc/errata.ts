import { flaggedSpan, type ErrataFile } from "../../errata.ts";
import { Flag } from "../../schema.ts";
import { median } from "../../stats.ts";

export default {
  errata: [
    {
      id: "jodc-day-zero",
      stations: ["jodc/0132", "jodc/7315", "jodc/7317", "jodc/7318", "jodc/7319"],
      since: "2012-01-08",
      until: "2021-09-02",
      handling: "corrected",
      error:
        "Eight lines in JODC's port files are dated day 00 of a month: 0132's 2012/01/00, 7315's 2021/05/00, 7317's 2021/01/00, 2021/03/00 and 2021/09/00, 7318's 2021/08/00, and 7319's 2021/04/00 and 2021/08/00. Each sits where the month's one missing day belongs.",
      response:
        "A line dated day 00 is read as the day after the line before it, or the month's first day at the top of a file, and refused if that falls outside the month it names.",
      evidence:
        'Every day-00 line is the only missing day of its month and sits between the lines for the days either side of it (2012/01/08 and 2012/01/10 for 0132), and its levels continue the tide from the line before. The full backfill on 2026-11-12 failed every year of these stations on "no day".',
      // Each month with a day-00 line holds every day, each hour once.
      check: async (store) => {
        for (const [id, month] of [
          ["jodc/0132", "2012-01"],
          ["jodc/7315", "2021-05"],
          ["jodc/7317", "2021-01"],
          ["jodc/7317", "2021-03"],
          ["jodc/7317", "2021-09"],
          ["jodc/7318", "2021-08"],
          ["jodc/7319", "2021-04"],
          ["jodc/7319", "2021-08"],
        ]) {
          const start = new Date(`${month}-01T00:00:00Z`);
          const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
          const rows = await store.levels(id, `${month}-01`, end.toISOString().slice(0, 10));
          const hours = (end.getTime() - start.getTime()) / 3_600_000;
          const times = new Set(rows.map((o) => o.time)).size;
          const onHour = rows.every((o) => o.time % 3_600_000 === 0);
          if (rows.length !== hours || times !== hours || !onHour)
            throw new Error(
              `the store holds ${rows.length} ${id} levels at ${times} times in ${month}, not one in each of its ${hours} hours`,
            );
        }
      },
    },
    {
      id: "jodc-zip-duplicates",
      stations: [
        "jodc/GS01",
        "jodc/GS02",
        "jodc/GS03",
        "jodc/GS04",
        "jodc/GS05",
        "jodc/GS06",
        "jodc/GS07",
        "jodc/GS08",
        "jodc/GS09",
      ],
      handling: "kept",
      error: "The zips of GSI's GS01 to GS09 hold their 1965 file twice.",
      response:
        "The copies are identical, so the year is read once; a zip whose copies differ is refused.",
      evidence:
        "The zips' central directories list 1965's file twice, with the same contents in GS01's and GS02's (checked 2026-11-12).",
      // The evidence compared GS01's and GS02's copies.
      check: async (store, e) => {
        for (const id of e.stations!.slice(0, 2)) {
          const rows = await store.levels(id, "1965-01-01", "1966-01-01");
          if (!rows.length) throw new Error(`the store holds no ${id} levels in 1965`);
          const times = new Set(rows.map((o) => o.time)).size;
          if (times !== rows.length)
            throw new Error(
              `the store holds ${rows.length} ${id} levels in 1965 at only ${times} times`,
            );
        }
      },
    },
    {
      id: "jodc-ominato-1952-offset",
      stations: ["jodc/HD04"],
      since: "1952-05-31",
      until: "1952-11-01",
      handling: "flagged",
      error:
        "JODC's Ōminato (HD04) levels sit about 2.1 m high from the start of its record, 1 June 1952 JST, to the end of October 1952.",
      response:
        "31 May 1952 UTC to the end of 31 October 1952 is flagged `suspect`, keeping the source's own flag as `source_flag`. The step isn't measured, since the record has a gap across it, so the months are flagged, as in GESLA's copy, rather than given a datum epoch of their own.",
      evidence:
        "Monthly means of JODC's values (checked 2026-11-13) are 3.62 to 3.80 m from June to October 1952 and, after a gap to 19 November, 1.52 m for the rest of November and 1.42 to 1.72 m through 1953; every year from 1953 to 2008, the record's last, averages 1.49 to 1.73 m. GESLA's copy of the gauge, `gesla/ominato-hd04-jpn-jodc_jcg`, has the same step on the same days, which GESLA's metadata marks \"Possible datum issues\" and its datum-jump check flags (erratum `gesla-datum-jumps`).",
      // The record starts with the span and has a gap after it, so 1953 stands for the levels outside it.
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const id = e.stations![0]!;
        const span = await store.levels(id, e.since!, e.until!);
        const later = await store.levels(id, "1953-01-01", "1954-01-01");
        if (!span.length || !later.length)
          throw new Error("the store holds no HD04 levels in June to October 1952 or in 1953");
        const suspect = later.filter((o) => o.flag >= Flag.suspect).length;
        if (suspect > later.length / 10)
          throw new Error(
            `${suspect} of ${later.length} HD04 levels in 1953 are flagged suspect or worse`,
          );
        const step = median(span.map((o) => o.level)) - median(later.map((o) => o.level));
        if (step < 1.8 || step > 2.4)
          throw new Error(
            `HD04's levels in June to October 1952 sit ${step.toFixed(2)} m above 1953's, not about 2.1`,
          );
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
