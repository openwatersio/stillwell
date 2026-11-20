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
        "Every listed Venezia month requested with HEAD in November 2026: 100 return 200, from 201401 to 202204, and 66 return 404. Spot checks find Napoli's October 2023 and Trieste's January and February 2010, all listed, return 404 too.",
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
        "Monthly files read in November 2026: Bari and Ravenna, January 2015, each hold one such row, first after the header, and every other row has a time. Gaeta's January 2016 and Lampedusa's January 2015 files fail the strict parser on the same shape.",
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
      stations: "every station",
      handling: "dropped",
      error:
        "Some files hold two levels for one time. Carloforte's March 2019 file, after a gap from 15:50 on 12 March to 08:50 on 13 March, has 09:40, 09:50 and 10:00 on the 13th twice each, 15.4 and 17.9, 16.4 and 20.4, 16 and 20.3 cm, so two series interleave.",
      response:
        "Neither level of a time that appears with two different levels is stored, since nothing says which is right. A time repeated with the same level is read once.",
      evidence:
        "Carloforte's `carloforte_hydrometric_201903.csv`, read in November 2026: three repeated times, each with two levels, all within an hour on 13 March. Other stations' months are known only from a sample of six months of every gauge, in which it was the only one.",
      check: async (store) => {
        const times = new Set(
          (await store.levels("ispra/carloforte", "2019-03-13", "2019-03-14")).map((o) => o.time),
        );
        const at = (hm: string) => Date.parse(`2019-03-13T${hm}:00Z`);
        if (!times.has(at("09:30")) || !times.has(at("10:10")))
          throw new Error(
            "ispra/carloforte holds no levels either side of 13 March 2019's repeated times",
          );
        for (const hm of ["09:40", "09:50", "10:00"])
          if (times.has(at(hm)))
            throw new Error(`ispra/carloforte holds a level at ${hm} on 13 March 2019`);
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
