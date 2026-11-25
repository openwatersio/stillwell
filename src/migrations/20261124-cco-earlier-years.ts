import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import type { Migration } from "../jobs/migrations.ts";

const DAY_MS = 86_400_000;

// Each gauge's first reading with a value in the API, read from it on 2026-11-25 with the month before. The API lists
// stamps from earlier, with no value: Herne Bay's from 1 January 1996, Deal Pier's from 27 August 2005 and Hastings
// Pier's from 1 January 2017. Lymington's and Brighton's have none before their first value.
const STARTS = [
  ["cco/89", "1996-03-19"],
  ["cco/87", "2003-01-02"],
  ["cco/88", "2004-07-12"],
  ["cco/90", "2005-09-16"],
  ["cco/126", "2017-01-27"],
] as const;

// The years the archive adds at each gauge, up to the year the store's files started.
const YEARS = [
  ["cco/89", 1996, 2005],
  ["cco/87", 2003, 2009],
  ["cco/88", 2005, 2006],
] as const;

export default {
  description:
    "Read CCO's archive from each gauge's first reading, and flag CMEMS's offset at West Bay Harbour",
  steps: [
    // Every gauge and year before 2009, so a year with no readings is recorded as asked.
    {
      ingest: "backfill cco all 1996 2009 --skip-written --with-inactive --concurrency 1",
      timeout: 240,
    },
    // The first files of these gauges start part way through the year, and Port Isaac's refetch reads what the API sends now.
    { ingest: "backfill cco 90 2005 2006 --refetch --concurrency 1" },
    { ingest: "backfill cco 88 2006 2007 --refetch --concurrency 1" },
    { ingest: "backfill cco 102 2010 2012 --refetch --concurrency 1" },
    { ingest: "backfill cco 87 2009 2010 --refetch --concurrency 1" },
    { ingest: "backfill cco 126 2017 2018 --refetch --concurrency 1" },
    { ingest: "compact cco --rebuild-bounds" },
    { ingest: "requalify cmems WestBayHarbourTG 2024 2026" },
    { ingest: "requalify gesla westbayharbourtg-wes-gbr-cmems 2024 2026" },
    { ingest: "publish" },
    {
      check:
        "the gauges start at the API's first value, every year has levels without fill values, and the erratum reads back",
      async verify(store) {
        const reader = errataReader(() => store, store);
        const rows = await reader.rows("stations.parquet");
        const first = (id: string) =>
          Number(
            (rows.find((r) => r.id === id)?.first as { micros?: unknown } | undefined)?.micros,
          ) / 1000;
        // A gauge with readings keeps its bounds; a rebuild from a short listing would leave it without.
        for (const r of rows.filter((r) => String(r.id).startsWith("cco/") && r.last))
          if (!Number.isFinite(first(String(r.id))))
            throw new Error(`stations.parquet has no first value for ${r.id}`);
        for (const [id, day] of STARTS)
          if (!(first(id) >= Date.parse(day) && first(id) < Date.parse(day) + DAY_MS))
            throw new Error(`${id} starts ${new Date(first(id)).toISOString()}, not on ${day}`);
        const mean = async (id: string, year: number) => {
          const levels = await reader.levels(id, `${year}-01-01`, `${year + 1}-01-01`);
          if (!levels.length) throw new Error(`the store holds no ${id} levels in ${year}`);
          // Fill values and the sentinels the adapter drops, which a year of a gauge's readings never holds.
          const fill = levels.filter(
            (o) => Math.abs(o.level) >= 99 || Math.abs(o.level + 10) < 5e-5,
          );
          if (fill.length)
            throw new Error(`the store holds ${fill.length} ${id} fill values in ${year}`);
          return levels.reduce((sum, o) => sum + o.level, 0) / levels.length;
        };
        // Each new year's mean level sits within 0.15 m of the next year's, so no datum or clock step joins them.
        for (const [id, from, until] of YEARS) {
          let next = await mean(id, until);
          for (let year = until - 1; year >= from; year--) {
            const here = await mean(id, year);
            if (Math.abs(here - next) > 0.15)
              throw new Error(
                `${id}'s mean level is ${here.toFixed(3)} m in ${year} and ${next.toFixed(3)} m in ${year + 1}`,
              );
            next = here;
          }
        }
        // Port Isaac's refetched years hold levels; 2010 starts on 30 June.
        for (const year of [2010, 2011])
          if (!(await reader.levels("cco/102", `${year}-01-01`, `${year + 1}-01-01`)).length)
            throw new Error(`the store holds no cco/102 levels in ${year}`);
        // The part years the refetches fill, from 1 January to the first reading the store held.
        for (const [id, from, until] of [
          ["cco/87", "2009-01-01", "2009-02-13"],
          ["cco/88", "2006-01-01", "2006-02-12"],
        ] as const)
          if (!(await reader.levels(id, from, until)).length)
            throw new Error(`the store holds no ${id} levels from ${from} to ${until}`);
        for (const id of ["cmems-west-bay-harbour-offset", "cco-duplicate-stamps"]) {
          const e = errata.find((x) => x.id === id);
          if (!e?.check) throw new Error(`no erratum ${id} with a check`);
          await e.check(reader, e);
        }
      },
    },
  ],
} satisfies Migration;
