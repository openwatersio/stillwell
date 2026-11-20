import { flaggedSpan, type ErrataFile } from "../../errata.ts";
import { Flag } from "../../schema.ts";

export default {
  errata: [
    {
      id: "smhi-eriksberg-2018-tingstadstunneln",
      stations: ["smhi/33096"],
      since: "2018-01-01",
      until: "2018-11-13",
      handling: "flagged",
      error:
        "SMHI's Göteborg-Eriksberg levels from 1 January to 12 November 2018 are Göteborg-Tingstadstunneln's, value for value.",
      response:
        "1 January to 12 November 2018 at Eriksberg is flagged `suspect`, keeping SMHI's own flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026. Eriksberg and Tingstadstunneln (`smhi/33093`), 6 km apart, usually differ by 2 cm RMS and 3 to 6 cm in mean level; over the span they are identical, mean included. Against Göteborg-Torshamnen (`smhi/2109`), Eriksberg sits about 1 cm low before and after but 3 to 7 cm high over the span, where Tingstadstunneln always is, so Eriksberg is the one holding the other's data. GESLA's SMHI copy carries the same values (erratum `gesla-eriksberg-2018-tingstadstunneln`); GESLA's CMEMS copy doesn't.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const eriksberg = await store.levels(e.stations![0]!, "2018-03-01", "2018-04-01");
        if (!eriksberg.length) throw new Error("the store holds no Eriksberg levels in March 2018");
        if (eriksberg.some((o) => o.flag < Flag.suspect))
          throw new Error("Eriksberg's March 2018 isn't flagged suspect");
        const tingstad = new Map(
          (await store.levels("smhi/33093", "2018-03-01", "2018-04-01")).map((o) => [
            o.time,
            o.level,
          ]),
        );
        const same = eriksberg.filter(
          (o) => Math.abs(o.level - (tingstad.get(o.time) ?? Infinity)) < 0.005,
        ).length;
        if (same < 0.9 * eriksberg.length)
          throw new Error(
            `${same} of Eriksberg's ${eriksberg.length} hours in March 2018 are Tingstadstunneln's, not nearly all`,
          );
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
