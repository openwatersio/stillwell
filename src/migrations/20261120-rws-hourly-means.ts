import { seriesPath } from "../store/paths.ts";
import { readObservations } from "../store/parquet.ts";
import type { Migration } from "../jobs/migrations.ts";

const WEIRS = [
  "dehaandrik.beneden",
  "dehaandrik.boven",
  "hardenberg.beneden",
  "hardenberg.boven",
  "junne.beneden",
  "junne.boven",
  "marienberg.beneden",
  "marienberg.boven",
  "vechterweerd.boven",
  "vilsteren.beneden",
  "vilsteren.boven",
];

// RWS serves each of these weirs' 2000 to 2004 as one series of hourly means (erratum `rws-hourly-means-weirs`), of 3,150
// to 8,785 values a year, and 1999 as hourly readings of 8,452 to 8,759 values; before 2005 a station's years are in its
// first epoch.
const FLOOR: Record<number, number> = {
  1999: 8_000,
  2000: 3_000,
  2001: 3_000,
  2002: 3_000,
  2003: 3_000,
  2004: 3_000,
};

export default {
  description: "Read the Overijsselse Vecht weirs' hourly means",
  steps: [
    { ingest: `backfill rws ${WEIRS.join(",")} 1999 2005 --refetch` },
    { ingest: "compact rws" },
    {
      check: "every weir's 1999 to 2004 holds hourly values on the hour, none short of values",
      async verify(store) {
        for (const id of WEIRS)
          for (const [year, floor] of Object.entries(FLOOR)) {
            const rows = await readObservations(
              seriesPath(store, "levels", "rws", id, Number(year)),
            );
            if (rows.length < floor)
              throw new Error(`rws/${id} ${year}: ${rows.length} values, under ${floor}`);
            const off = rows.filter((r) => r.time % 3_600_000 !== 0).length;
            if (off) throw new Error(`rws/${id} ${year}: ${off} values off the hour`);
          }
      },
    },
  ],
} satisfies Migration;
