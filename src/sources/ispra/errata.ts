import { type ErrataFile } from "../../errata.ts";

export default {
  errata: [
    {
      id: "ispra-listed-months-missing",
      stations: "every station",
      handling: "avoided",
      error:
        "ISPRA's RDF dump lists 5,138 monthly level files, from 2010 to October 2023, and many of them return 404. For Venezia, 100 of the 166 listed months resolve, January 2014 to April 2022; the months before and after, listed too, don't.",
      response:
        "The loader asks only for the months the dump lists and skips one that returns 404, so a station's years are partial and the store's coverage is what the repository serves.",
      evidence:
        "Of the 5,138 months the dump lists, 2,714 are served and 2,424 return 404; every served month falls between January 2014 and April 2022. Venezia's 166 listed months, each requested, give 100 served and 66 that return 404. Napoli's October 2023 and Trieste's January and February 2010 are listed and return 404.",
      // Venezia's served months run January 2014 to April 2022; the listed months either side return 404.
      check: async (store) => {
        const held = async (since: string, until: string) =>
          (await store.levels("ispra/venezia", since, until)).length;
        if (!(await held("2014-01-01", "2014-01-02")) || !(await held("2022-04-01", "2022-04-02")))
          throw new Error("ispra/venezia holds no levels in January 2014 or April 2022");
        for (const [since, until] of [
          ["2013-12-01", "2014-01-01"],
          ["2022-05-01", "2022-06-01"],
        ] as const)
          if (await held(since, until))
            throw new Error(`ispra/venezia holds levels from ${since}, a month ISPRA didn't serve`);
      },
    },
    {
      id: "ispra-midnight-without-time",
      stations: "every station",
      handling: "corrected",
      error:
        "The first row of some monthly files gives a date and no time, such as `2015-01-01;-1.6` at the top of Bari's, Gaeta's, Lampedusa's and Ravenna's January files, followed by `2015-01-01 00:10:00`.",
      response:
        "A row with a date and no time is read as 00:00 UTC on that date, which the row's place before 00:10 gives.",
      evidence:
        "Of the 2,714 served files, 52 start with one such row, at all 36 gauges, and none holds another. Bari's and Ravenna's January 2015 files hold it first after the header, and every other row has a time.",
      check: async (store) => {
        const [first] = await store.levels("ispra/bari", "2015-01-01", "2015-01-02");
        if (
          first?.time !== Date.parse("2015-01-01T00:00:00Z") ||
          Math.abs(first.level + 0.016) > 5e-4
        )
          throw new Error("ispra/bari holds no −0.016 m at midnight on 1 January 2015");
      },
    },
    {
      id: "ispra-repeated-times",
      stations: ["ispra/ginostra", "ispra/crotone", "ispra/carloforte"],
      handling: "dropped",
      error:
        "Some files hold two levels for one time, as if two series were interleaved. Ginostra, Crotone and Carloforte hold 685 such times in 14 months: 528 at Ginostra in seven months of 2018 and 2019, 143 at Crotone in three months of 2018, and 14 at Carloforte in four months of 2018 and 2019. Carloforte's March 2019 file, after a gap from 15:50 on 12 March to 08:50 on 13 March, has 09:40, 09:50 and 10:00 on the 13th twice each, 15.4 and 17.9, 16.4 and 20.4, 16 and 20.3 cm.",
      response:
        "Neither level of a time that appears with two different levels is stored, since nothing says which is right. A time repeated with the same level is read once.",
      evidence:
        "The adapter's parser read every one of the 2,714 monthly files the repository serves, 11.2 million rows. Fourteen hold a time with two levels: Ginostra June, July, October and November 2018 and April, May and June 2019, Crotone June, October and November 2018, and Carloforte June, July and August 2018 and March 2019. No other file holds one, and none holds a row the parser can't read.",
      check: async (store) => {
        // Each stretch's neighbors are held and its repeated times are not.
        for (const [id, day, held, repeated] of [
          ["ispra/carloforte", "2019-03-13", ["09:30", "10:10"], ["09:40", "09:50", "10:00"]],
          ["ispra/crotone", "2018-06-08", ["08:40", "09:40"], ["08:50", "09:00", "09:30"]],
          ["ispra/ginostra", "2018-06-14", ["08:10", "08:40"], ["08:20"]],
        ] as const) {
          const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
            .toISOString()
            .slice(0, 10);
          const times = new Set((await store.levels(id, day, next)).map((o) => o.time));
          const at = (hm: string) => Date.parse(`${day}T${hm}:00Z`);
          if (!held.every((hm) => times.has(at(hm))))
            throw new Error(`${id} holds no levels either side of ${day}'s repeated times`);
          for (const hm of repeated)
            if (times.has(at(hm))) throw new Error(`${id} holds a level at ${hm} on ${day}`);
        }
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
