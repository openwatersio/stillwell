import { errata } from "../sources/index.ts";
import { errataReader } from "../store/errata-reader.ts";
import { Flag } from "../schema.ts";
import {
  listYears,
  readObservations,
  readRows,
  readStationBounds,
  readStationList,
} from "../store/parquet.ts";
import { boundsPath, seriesDir, seriesPath, stationListPath, yearsPath } from "../store/paths.ts";
import type { Migration } from "../jobs/migrations.ts";

const FIRST_YEAR = 2000;
/** The last admitted year, 2023, since the interval ends before 2024. */
const LAST_YEAR = 2023;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
/** Every observation in the 24 admitted files, from the recorded inputs the change was validated on. */
const OBSERVATIONS = 209_544;

const ID = "ign/ACOR1";

/** Every row of every admitted year file, by year. */
async function readAll(store: string) {
  return Promise.all(
    YEARS.map(
      async (year) =>
        [year, await readObservations(seriesPath(store, "levels", "ign", "ACOR1", year))] as const,
    ),
  );
}

export default {
  description: "Publish Coruña's reviewed hourly record, 2000 to 2023, from IGN",
  steps: [
    { ingest: "stations ign --no-publish" },
    {
      check:
        "IGN's list holds only ign/ACOR1, inactive and not live, hourly, on JM with NMMA at 4.998 m",
      async verify(store) {
        const list = await readStationList(stationListPath(store, "ign"));
        if (!list) throw new Error("the store holds no IGN list");
        if (list.length !== 1 || list[0]!.id !== ID)
          throw new Error(`IGN's list holds ${list.map((s) => s.id).join(", ") || "nothing"}`);
        const s = list[0]!;
        if (s.status !== "inactive" || s.live)
          throw new Error(`${ID} is ${s.status}, live ${s.live}`);
        if (s.interval_s !== 3600) throw new Error(`${ID}'s interval is ${s.interval_s} s`);
        if (s.datum !== "JM" || s.datums.NMMA !== 4.998)
          throw new Error(`${ID} is on ${s.datum} with datums ${JSON.stringify(s.datums)}`);
      },
    },
    // One station and 24 yearly files, a request every 350 ms, so one run holds the whole range.
    { ingest: "backfill ign all 2000 2025 --with-inactive --refetch" },
    { ingest: "compact ign --rebuild-bounds" },
    { ingest: "publish" },
    { ingest: `requalify ign ACOR1 ${FIRST_YEAR} 2025` },
    {
      check:
        "ign/ACOR1 has 24 year files, 2000 to 2023, each with only its own year's hours, every quality flag at least suspect and every source flag good",
      async verify(store) {
        const years = await listYears(seriesDir(store, "levels", "ign", "ACOR1"));
        const held = [...years].sort((a, b) => a - b);
        if (held.join() !== YEARS.join())
          throw new Error(`${ID} has year files for ${held.join(", ") || "no year"}`);
        const rows = await readRows(yearsPath(store, "ign"));
        const files = rows.filter((r) => r.year !== null);
        if (files.length !== rows.length)
          throw new Error("IGN's years file has a station marked mid-write");
        if (files.length !== YEARS.length || files.some((r) => r.id !== ID || r.epoch !== 1))
          throw new Error(
            `IGN's years file holds ${files.length} files, not ${YEARS.length} of ${ID}`,
          );

        let total = 0;
        for (const [year, observations] of await readAll(store)) {
          if (!observations.length) throw new Error(`${ID} ${year}: no levels`);
          total += observations.length;
          for (const o of observations) {
            if (new Date(o.time).getUTCFullYear() !== year)
              throw new Error(`${ID} ${year}: a level at ${new Date(o.time).toISOString()}`);
            if (o.flag < Flag.suspect)
              throw new Error(`${ID} ${year}: flag ${o.flag} at ${new Date(o.time).toISOString()}`);
            if (o.source_flag !== Flag.good)
              throw new Error(
                `${ID} ${year}: source flag ${o.source_flag} at ${new Date(o.time).toISOString()}`,
              );
          }
        }
        if (total !== OBSERVATIONS)
          throw new Error(`${ID} holds ${total} levels, not the ${OBSERVATIONS} validated`);
      },
    },
    {
      check:
        "IGN's bounds hold only ign/ACOR1 from its first to its last stored level, and its published credit names those dates",
      async verify(store) {
        const all = await readAll(store);
        let min = Infinity;
        let max = -Infinity;
        for (const [, rows] of all)
          for (const o of rows) {
            if (o.time < min) min = o.time;
            if (o.time > max) max = o.time;
          }
        const first = new Date(min).toISOString().slice(0, 10);
        const last = new Date(max).toISOString().slice(0, 10);
        if (first < "2000-01-01" || last >= "2024-01-01")
          throw new Error(`${ID} holds levels from ${first} to ${last}`);

        const bounds = await readStationBounds(boundsPath(store, "ign"));
        if ([...bounds.keys()].join() !== ID)
          throw new Error(`IGN's bounds hold ${[...bounds.keys()].join(", ") || "nothing"}`);
        const b = bounds.get(ID)!;
        if (b.first?.slice(0, 10) !== first || b.last?.slice(0, 10) !== last)
          throw new Error(`${ID}'s bounds are ${b.first} to ${b.last}, not ${first} to ${last}`);

        const rows = (await readRows(`${store}/stations.parquet`)).filter((r) => r.id === ID);
        if (rows.length !== 1)
          throw new Error(`stations.parquet holds ${rows.length} rows of ${ID}`);
        const credit = String(rows[0]!.attribution);
        const expected = `Obra derivada de Red de Mareógrafos ${first}–${last} CC-BY 4.0 ign.es; Área de Geodesia, Instituto Geográfico Nacional (IGN)`;
        if (credit !== expected)
          throw new Error(`${ID}'s credit is "${credit}", not "${expected}"`);
      },
    },
    {
      check: "every IGN erratum's check passes against the store",
      async verify(store) {
        const reader = errataReader(() => store, store);
        for (const e of errata.filter((x) => x.source === "ign")) {
          if (!e.check) throw new Error(`no check for ${e.id}`);
          try {
            await e.check(reader, e);
          } catch (error) {
            throw new Error(`${e.id}: ${(error as Error).message}`);
          }
        }
      },
    },
  ],
} satisfies Migration;
