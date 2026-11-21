import { Flag } from "../schema.ts";
import { seriesPath } from "../store/paths.ts";
import { readObservations } from "../store/parquet.ts";
import type { Migration } from "../jobs/migrations.ts";

const utc = (iso: string) => Date.parse(iso);
const rows = async (id: string, year: number, epoch: number, store: string) => {
  const path = seriesPath(store, "levels", "refmar", id, year, epoch);
  return readObservations(path);
};

// Hiva Oa's second epoch moves to 5 March 2020 and its six values from 23:00 UTC that day move into its files;
// Rikitea's and Papeete's errata spans (erratum `refmar-rikitea-2007-datum`, `refmar-papeete-uhslc-2010-offset`) reach
// the rows stored before they changed.
export default {
  description:
    "Place REFMAR's Hiva Oa, Rikitea and Papeete values on the right side of their zero changes",
  steps: [
    { ingest: "stations refmar --no-publish" },
    { ingest: "backfill refmar 495 2020 2021 --refetch" },
    { ingest: "misplaced refmar" },
    { ingest: "backfill refmar 43 2007 2008 --refetch" },
    { ingest: "backfill refmar 43 2012 2013 --refetch" },
    { ingest: "backfill refmar 6385 2010 2011 --refetch" },
    { ingest: "compact refmar" },
    { ingest: "publish" },
    {
      check: "each stretch is in the right epoch's file and flag",
      async verify(store) {
        const at = (r: { time: number }, from: string, to: string) =>
          r.time >= utc(from) && r.time < utc(to);
        const hiva = (await rows("495", 2020, 2, store)).filter((r) =>
          at(r, "2020-03-05T23:00:00Z", "2020-03-06T00:00:00Z"),
        );
        if (hiva.length !== 6)
          throw new Error(
            `refmar/495: ${hiva.length} values, not 6, at 23:00 UTC on 2020-03-05 in epoch 2`,
          );
        const stray = (await rows("495", 2020, 1, store).catch(() => [])).filter((r) =>
          at(r, "2020-03-05T00:00:00Z", "2020-03-06T00:00:00Z"),
        );
        if (stray.length)
          throw new Error(
            `refmar/495: ${stray.length} values of 5 March 2020 remain in epoch 1's file`,
          );

        const first = (await rows("43", 2007, 1, store)).filter((r) =>
          at(r, "2007-12-25T23:00:00Z", "2007-12-26T00:00:00Z"),
        );
        if (first.length !== 3 || first.some((r) => r.flag < Flag.suspect))
          throw new Error(
            "refmar/43: the three values from 23:00 UTC on 2007-12-25 aren't all suspect",
          );
        const later = (await rows("43", 2012, 1, store)).filter((r) =>
          at(r, "2012-05-14T21:54:00Z", "2012-05-15T00:00:00Z"),
        );
        if (!later.length || later.some((r) => r.flag >= Flag.suspect))
          throw new Error("refmar/43: values from 21:54 UTC on 2012-05-14 are flagged suspect");

        const papeete = (await rows("6385", 2010, 1, store)).filter((r) =>
          at(r, "2010-09-13T22:10:00Z", "2010-09-14T00:00:00Z"),
        );
        if (!papeete.length || papeete.some((r) => r.flag < Flag.suspect))
          throw new Error("refmar/6385: values from 22:10 UTC on 2010-09-13 aren't all suspect");
      },
    },
  ],
} satisfies Migration;
