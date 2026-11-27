import type { Migration } from "../jobs/migrations.ts";
import { FLAG_COUNTS } from "../store/files.ts";
import { readYears } from "../store/years.ts";

// Kartverket marks no value checked, and its adapter stores every value it reads as preliminary. The year files
// written before that hold values over a year old as good, in `flag` and `source_flag`, which a requalify keeps.
// A backfill replaces every stored reading in a month it fetches, so one of the whole record leaves them preliminary.
// About 920 station-years at 30 to 40 seconds each, in three shards. On 27 November 2026 the store's 33 Kartverket
// gauges are all active with one datum epoch each, so the backfill reaches every file. It doesn't reach a gauge
// held since, a closed epoch's files, or a month the API no longer serves, and the check names files left with
// good values so they can be dealt with by name. A build from before this one, run after the migration, stores
// values over a year old as good again from January three years back, and nothing here runs twice: going back
// to such a build and forward again needs this backfill once more, under a new name.

// The hours each gauge's year files held from 1986 to 2025 on 27 November 2026, from the store's years file. A
// backfill that replaced a month with part of one would leave fewer.
// prettier-ignore
const HOURS: Record<string, number> = {
    "kartverket/AES": 346454,
    "kartverket/ANX": 298652,
    "kartverket/BGO": 325094,
    "kartverket/BOH": 1499,
    "kartverket/BOO": 313115,
    "kartverket/BRJ": 27162,
    "kartverket/HAR": 323468,
    "kartverket/HEI": 305101,
    "kartverket/HFT": 306143,
    "kartverket/HRO": 330887,
    "kartverket/HVG": 323672,
    "kartverket/KAB": 324740,
    "kartverket/KSU": 343202,
    "kartverket/LEH": 27614,
    "kartverket/MAY": 343243,
    "kartverket/MSU": 133130,
    "kartverket/NVK": 315184,
    "kartverket/NYA": 291279,
    "kartverket/OSC": 307038,
    "kartverket/OSL": 166043,
    "kartverket/RVK": 325501,
    "kartverket/SBG": 27251,
    "kartverket/SIE": 28972,
    "kartverket/SOY": 18211,
    "kartverket/SVG": 334538,
    "kartverket/TAZ": 19573,
    "kartverket/TOS": 339515,
    "kartverket/TRD": 314396,
    "kartverket/TRG": 327317,
    "kartverket/VAW": 304571,
    "kartverket/VIK": 304887,
};
/** How far a gauge's hours may fall: Kartverket can withdraw readings, and a month cut short takes more. */
const MAY_LOSE = 0.005;

export default {
  description: "Store Kartverket's values as preliminary",
  steps: [
    ...[1, 2, 3].map((i) => ({
      ingest: `backfill kartverket all 1986 2027 --refetch --with-inactive --shard ${i}/3`,
      timeout: 360,
    })),
    {
      check:
        "no Kartverket year file holds a good value, and no gauge lost more than 0.5% of its hours before 2026",
      async verify(store) {
        const years = await readYears(store, "kartverket");
        if (!years) throw new Error("the store has no years file for kartverket");
        const rows = [...years.values()];
        // A row without counts is a station marked as being written, whose rows may be out of date.
        const uncounted = rows.filter((r) => !r.flags);
        if (uncounted.length)
          throw new Error(
            `the years file has rows without counts, for ${[...new Set(uncounted.map((r) => r.id))].join(", ")}`,
          );
        const good = rows.filter((r) => r.flags![FLAG_COUNTS.indexOf("good")]! > 0);
        if (good.length)
          throw new Error(
            `${good.length} Kartverket year files still hold good values, among them ${good
              .slice(0, 20)
              .map((r) => `${r.id} epoch ${r.epoch} ${r.year}`)
              .join(", ")}`,
          );
        const lost = Object.entries(HOURS).flatMap(([id, before]) => {
          const now = rows
            .filter((r) => r.id === id && r.year! >= 1986 && r.year! <= 2025)
            .reduce((sum, r) => sum + (r.hours ?? 0), 0);
          return now < before * (1 - MAY_LOSE) ? [`${id} (${before} to ${now})`] : [];
        });
        if (lost.length) throw new Error(`gauges lost hours before 2026: ${lost.join(", ")}`);
      },
    },
    { ingest: "publish" },
  ],
} satisfies Migration;
