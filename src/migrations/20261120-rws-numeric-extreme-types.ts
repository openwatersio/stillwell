import { seriesPath } from "../store/paths.ts";
import { readExtremes } from "../store/parquet.ts";
import type { Migration } from "../jobs/migrations.ts";

const STATIONS = ["dukegat", "knock", "pogum"];

// The years are in each station's current epoch, 2, since the NAP 2005 reference begins one at 2005. RWS names the type of these stations' astronomical extremes with the codes 1 and 2 from their first value of 2027; a
// year holds about 1,410 high and low waters (705 tides), and the first 2027 value falls on 31 December 2026 in UTC.
const FLOOR: Record<number, number> = { 2026: 1_300, 2027: 1_300 };

export default {
  description: "Read Dukegat's, Knock's and Pogum's predicted extremes for 2027",
  steps: [
    { ingest: `backfill rws ${STATIONS.join(",")} 2026 2028 --refetch` },
    { ingest: "compact rws" },
    {
      check: "each station holds highs and lows for 2026 and 2027, none short",
      async verify(store) {
        for (const id of STATIONS)
          for (const [year, floor] of Object.entries(FLOOR)) {
            const rows = await readExtremes(
              seriesPath(store, "predicted_extremes", "rws", id, Number(year), 2),
            );
            if (rows.length < floor)
              throw new Error(
                `rws/${id} ${year}: ${rows.length} predicted extremes, under ${floor}`,
              );
            const highs = rows.filter((r) => r.type === "high").length;
            if (Math.abs(highs - (rows.length - highs)) > 2)
              throw new Error(`rws/${id} ${year}: ${highs} highs of ${rows.length} extremes`);
          }
      },
    },
  ],
} satisfies Migration;
