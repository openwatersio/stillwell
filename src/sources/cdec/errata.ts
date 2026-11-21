import { impossibleDropped, type ErrataFile } from "../../errata.ts";

export default {
  errata: [
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
        "November 2026. A scan of the range of levels in every year file of every source in the store (335,320 files) found 383 holding a level outside the span, which were then read in full; each of them also has a `bad` value, as QC flags every level outside the span.",
      // DLC's 2005 file held fill values among real levels: they're left out, or kept flagged bad where nothing else is left.
      check: (store) => impossibleDropped(store, "cdec/DLC", 2005),
    },
  ],
  retired: [],
} satisfies ErrataFile;
