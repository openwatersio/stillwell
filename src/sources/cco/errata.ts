import type { ErrataFile, Erratum, StoreReader } from "../../errata.ts";

/** A station's levels in the years from `since` to before `until`; throws when the store holds none. */
async function levels(store: StoreReader, id: string, since: number, until = since + 1) {
  const rows = await store.levels(id, `${since}-01-01`, `${until}-01-01`);
  if (!rows.length) throw new Error(`the store holds no ${id} levels from ${since} to ${until}`);
  return rows;
}

/** The years to read at each station the entry lists, from `years`; throws for a station it has none for. */
function sample(e: Erratum, years: Record<string, [number, number?]>) {
  return e.stations!.map((id) => {
    const [since, until] = years[id] ?? [];
    if (since === undefined) throw new Error(`no year to read at ${id}`);
    return [id, since, until ?? since + 1] as const;
  });
}

// Levels are stored to 0.1 mm, so −9.99999 reads back as −10.
const FILL = [99.999, -99.999, -10];

export default {
  errata: [
    {
      id: "cco-fill-values",
      stations: ["cco/86", "cco/88", "cco/90", "cco/93", "cco/117", "cco/126"],
      handling: "dropped",
      error:
        "CCO's levels hold fill values where a gauge sent nothing, with no flag: 999.9999 or −999.9999, and at some gauges exactly 99.999, −99.999, −10 or −9.99999. A year of Exmouth's has 16 readings of 999.9999 from 18:30 on 18 December 2019, Hastings Pier's 2019 has 2 on 19 June, and Swanage Pier's 2018 has 2 of −999.9999 on 23 April. Deal Pier has 3,249 readings of exactly ±99.999 between April 2012 and August 2020, Brighton 167 of −9.99999 between August 2018 and September 2020, and Arun Platform 1 on 10 February 2014. GESLA's records of CCO's gauges and CMEMS's copies of them hold such values too, and erratum `gesla-fill-values` and `cmems-fill-values` leave out only those outside the store's span. The store's span of −500 to 9,000 m admits 999.9999, 99.999 and −10, and its QC marks the rest doubtful or bad after the fact.",
      response:
        "A level of 999 m or more in either direction, or exactly 99.999, −99.999, −10 or −9.99999, is left out as missing, as is 9999. No tide reaches those, and no gauge here reads exactly −10 or −9.99999.",
      evidence:
        "Every stored CCO reading, 13.1 million from 2005 to 2026, read on 2026-11-17: the sentinels above, found by the exact level. 999.9999 and −999.9999 were found in one year of readings at six sites, 2013 to 2020, read from the API on 2026-11-16: Deal Pier 2015, Arun Platform 2012, Brighton 2020, Swanage Pier 2018, Exmouth 2019 and Hastings Pier 2019. The other years of those, and the other sites, weren't scanned from the API.",
      reported: "2026-11-17",
      report:
        "Sent to the Channel Coastal Observatory's API team on 2026-11-17. The observatory said on 2026-11-18 that these were old raw readings and that its quality-controlled annual files now replace them at Deal, Brighton, Exmouth, Hastings and Swanage Pier; a missing valid reading is now null with its QC flag.",
      check: async (store, e) => {
        // The years the entry's error gives for each station.
        const years = sample(e, {
          "cco/117": [2019],
          "cco/126": [2019],
          "cco/93": [2018],
          "cco/86": [2012, 2021],
          "cco/88": [2018, 2021],
          "cco/90": [2014],
        });
        for (const [id, since, until] of years) {
          const fill = (await levels(store, id, since, until)).filter(
            (o) => Math.abs(o.level) >= 999 || FILL.some((f) => Math.abs(o.level - f) < 5e-5),
          );
          if (fill.length)
            throw new Error(
              `the store holds ${fill.length} fill values at ${id} from ${since}, such as ${fill[0]!.level} at ${new Date(fill[0]!.time).toISOString()}`,
            );
        }
      },
    },
    {
      id: "cco-duplicate-stamps",
      stations: ["cco/87", "cco/95"],
      handling: "dropped",
      error:
        "For stretches of 2011 at West Bay Harbour, CCO sends each reading twice, stamped a second apart, as 11:20:02 and 11:20:03, with nearly the same level. West Bay Harbour has 6,513 such pairs, about 6,500 of them within 5 mm and about 6,150 within 2 mm, counted on the stored levels, which are single-precision. Lymington has 5 pairs a second apart between 2013 and 2017, 2 within 5 mm. Arun Platform has 11 pairs in 2012 and 2013 and Sandown Pier 1 in 2017, on the days the clocks changed, whose levels differ.",
      response:
        "A reading within 2 seconds of the last one kept, with a level within 5 mm of it, is left out, so the first of each pair stays: about 6,500 readings. A pair whose levels differ by more is kept.",
      evidence:
        "Every stored CCO reading, read on 2026-11-17, compared with the one before it at the same site: West Bay Harbour on 30 March 2011 has 11:20:02 and 11:20:03, 2.081 and 2.080 m, then 11:30:02 and 11:30:03, 2.099 m twice.",
      reported: "2026-11-17",
      report:
        "Sent to the Channel Coastal Observatory's API team on 2026-11-17. The observatory said on 2026-11-18 that West Bay Harbour's duplicates remain until its quality-controlled files are loaded. Port Isaac's, which the first report also named, are gone from its API.",
      check: async (store, e) => {
        const years = sample(e, {
          "cco/95": [2011],
          "cco/87": [2013, 2018],
        });
        for (const [id, since, until] of years) {
          const rows = await levels(store, id, since, until);
          const pairs = rows.filter(
            (o, i) =>
              i &&
              o.time - rows[i - 1]!.time <= 2000 &&
              // Stored levels are rounded to 0.1 mm, so a pair just over 5 mm apart can read as 5 mm.
              Math.abs(o.level - rows[i - 1]!.level) < 0.0049,
          );
          if (pairs.length)
            throw new Error(
              `the store holds ${pairs.length} ${id} readings within 2 s and 5 mm of the one before, from ${since} to ${until}, the first at ${new Date(pairs[0]!.time).toISOString()}`,
            );
        }
      },
    },
  ],
  retired: ["cco-empty-window-answers", "cco-west-bay-position"],
} satisfies ErrataFile;
