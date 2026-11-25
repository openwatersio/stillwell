import { impossibleDropped, type ErrataFile } from "../../errata.ts";

export default {
  errata: [
    {
      id: "cdec-fall-back-clock",
      stations: "every station",
      handling: "corrected",
      error:
        "CDEC's pages say its times are PST, but they follow daylight saving. On the day it ends, CDEC sends the repeated hour once, as standard time, and its clock switches to standard time at 00:30, 00:45 or 01:00, so a 00:30 or 00:45 stamp can be either daylight or standard time.",
      response:
        "The adapter reads the stamps after the level's jump across the skipped hour as standard time and the ones before it as daylight time, so a 00:30 or 00:45 reading follows the clock it was taken on. Where no jump stands out, or the reply doesn't cover the hour, it drops the stamps from 00:30 to 01:00. The poller's later window fills them in once its reply covers the hour.",
      evidence:
        "Fisherman's Cut's stage, a gauge the store doesn't hold, against DWR's record of it (B95050Q, PST all year): the clock switched at 00:30 in 2018 and at 00:45 in 2017, 2019 and 2021 to 2023, and no jump stood out in 2020 and 2024. Martinez's 2025 stage drops 1.25 ft from 00:30 to 00:45. Applied to the fall-back day of each of the store's 41 stations for 2018 to 2025 (a day counts when a station has 40 or more readings), the rule put the switch at 01:00, with every 00:xx stamp in daylight time, at 25 to 32 stations a year (of 28 to 36 with readings), at 00:45 at 0 to 7, never at 00:30, and dropped the stamps at 0 to 3. Which stations switched at 00:45 differs by year. No station other than Fisherman's Cut has been checked against another agency's record.",
      reported: null,
      report: null,
      check: async (store) => {
        const day = (await store.levels("cdec/MRZ", "2025-11-02", "2025-11-03")).map((l) =>
          new Date(l.time).toISOString(),
        );
        if (!day.includes("2025-11-02T08:45:00.000Z"))
          throw new Error("cdec/MRZ has no reading at 00:45 PST on 2 November 2025");
        if (day.includes("2025-11-02T07:45:00.000Z"))
          throw new Error("cdec/MRZ has a reading at 00:45 PDT on 2 November 2025");
      },
    },
    {
      id: "cdec-fill-values",
      stations: [
        "cdec/DLC",
        "cdec/FAL",
        "cdec/GSS",
        "cdec/HLT",
        "cdec/HOL",
        "cdec/LPS",
        "cdec/ORQ",
        "cdec/OSJ",
        "cdec/PRI",
        "cdec/SDC",
        "cdec/SSS",
        "cdec/SUT",
        "cdec/TRN",
        "cdec/VCU",
      ],
      since: "2004-01-01",
      handling: "dropped",
      error:
        "These 14 CDEC stations hold levels no gauge can read, outside the store's span of −500 to 9,000 m: 8,131 values in 23 station-years from 2004 to 2009, all −7,999 ft (−2,438.095 m) or −99,999 ft (−30,479.695 m).",
      response:
        "The store leaves out a level outside its span (`SPAN_M` in src/span.ts) wherever it fetches levels, and requalify drops any it holds. Backfill writes a year of nothing else as its rows flagged `bad`, and requalify and compaction keep such a file, with a warning.",
      evidence:
        "A scan of the range of levels in every year file of every source in the store (335,320 files) found 383 holding a level outside the span, which were then read in full; each of them also has a `bad` value, as QC flags every level outside the span.",
      // DLC's 2005 file held fill values among real levels: they're left out, or kept flagged bad where nothing else is left.
      check: (store) => impossibleDropped(store, "cdec/DLC", 2005),
    },
  ],
  retired: [],
} satisfies ErrataFile;
