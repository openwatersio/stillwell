import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

// Where each gauge's archive starts in the API, and the year the store's first file began later than that.
const STARTS = [
  ["cco/89", "1996-01-02"],
  ["cco/87", "2003-01-02"],
  ["cco/88", "2004-07-12"],
] as const;

export default {
  description:
    "Read CCO's archive from the first year of Herne Bay, Lymington and Brighton, and flag CMEMS's offset at West Bay Harbour",
  steps: [
    { ingest: "backfill cco 89 1996 2005 --skip-written --concurrency 1" },
    { ingest: "backfill cco 87 2003 2009 --skip-written --concurrency 1" },
    // The first files of Lymington (2009) and Brighton (2006) start part way through the year.
    { ingest: "backfill cco 87 2009 2010 --refetch --concurrency 1" },
    { ingest: "backfill cco 88 2004 2006 --skip-written --concurrency 1" },
    { ingest: "backfill cco 88 2006 2007 --refetch --concurrency 1" },
    { ingest: "compact cco --rebuild-bounds" },
    { ingest: "requalify cmems WestBayHarbourTG 2024 2026" },
    { ingest: "requalify gesla westbayharbourtg-wes-gbr-cmems 2024 2026" },
    { ingest: "publish" },
    {
      check:
        "the three gauges start where the API's archive does, and the CMEMS erratum reads back",
      async verify(store) {
        const reader = errataReader(() => store, store);
        const rows = await reader.rows("stations.parquet");
        for (const [id, day] of STARTS) {
          const first =
            Number(
              (rows.find((r) => r.id === id)?.first as { micros?: unknown } | undefined)?.micros,
            ) / 1000;
          if (!Number.isFinite(first))
            throw new Error(`stations.parquet has no first value for ${id}`);
          // The first day can start a few hours in, so only a start more than two days later is a gap.
          if (first > Date.parse(day) + 2 * 86_400_000)
            throw new Error(`${id} starts ${new Date(first).toISOString()}, after ${day}`);
        }
        const e = errata.find((x) => x.id === "cmems-west-bay-harbour-offset");
        if (!e?.check) throw new Error("no erratum cmems-west-bay-harbour-offset with a check");
        await e.check(reader, e);
      },
    },
  ],
} satisfies Migration;
