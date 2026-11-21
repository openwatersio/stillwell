import type { ErrataFile } from "../../errata.ts";

export default {
  errata: [
    {
      id: "dwr-b95580-another-header",
      stations: [],
      handling: "refused",
      error:
        "WDL's raw level file for San Joaquin River at Venice Island (B95580) carries the header of another station, B95500 (Middle River at Union Point).",
      response:
        "The adapter refuses a file that names another station, so the store has no values for B95580 until WDL fixes it. A refresh lists B95580 only while its file is usable. The public store listed it before the adapter checked headers, so it stays there with no data, and is inactive from the first refresh with the check. `stations` stays empty, since a store started since then has no such station.",
      evidence:
        "The file's header names B95500, with variable code 821 and no notes, where B95580's own number belongs. Of all 71 WDL files the adapter reads, it's the only one. Found while backfilling California DWR; see [#55](https://github.com/openwatersio/stillwell/pull/55).",
      reported: "2026-11-07",
      report:
        "Sent to wdlweb@water.ca.gov on 2026-11-07. Asked again on 2026-11-21, in the email about the stale files (#461), whether the file is meant to hold B95500. No answer yet.",
      // Another WDL station's levels show the read isn't empty for another reason.
      check: async (store) => {
        if (!(await store.levels("dwr/B95060", "2025-01-01", "2026-01-01")).length)
          throw new Error("the store holds no B95060 levels in 2025");
        // A store started since the adapter checked headers never lists it.
        const station = await store.station("dwr/B95580");
        if (station && station.status !== "inactive")
          throw new Error(`the store lists B95580 as ${station.status}`);
        if (station && (await store.levels("dwr/B95580", "1982-01-01", "2027-01-01")).length)
          throw new Error("the store holds B95580 levels");
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
