import { flaggedSpan, type ErrataFile } from "../../errata.ts";
import { Flag } from "../../schema.ts";

export default {
  errata: [
    {
      id: "coops-inventory-omits-preliminary-before-1997",
      stations: ["coops/1840000"],
      since: "1994-11-01",
      until: "1994-12-01",
      handling: "avoided",
      error:
        "CO-OPS's data inventory for Chuuk, Moen Island (1840000) lists no 6-minute period at all, though the data API answers 7,200 preliminary 6-minute values for November 1994.",
      response:
        "A month before 1997 is asked for if its hourly or its 6-minute period covers it, and its hourly heights come with its 6-minute values, which they replace by erratum `coops-preliminary-offset-before-1997`. The month is requested through the hourly period, and the inventory's gap costs nothing.",
      evidence:
        "Requests of 2026-11-21: of 300 months outside every period the inventory lists for 20 stations (months next to a period excluded), this was the one with values. Only 20 stations were sampled, so other stations may omit preliminary periods too.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        const rows = await store.levels(id, "1994-11-01", "1994-12-01");
        if (!rows.length) throw new Error(`the store holds no ${id} levels in November 1994`);
        if (rows.some((o) => o.flag === Flag.preliminary))
          throw new Error(`the store holds preliminary ${id} levels in November 1994`);
      },
    },
    {
      id: "coops-gps-buoy-9414796",
      stations: ["coops/9414796"],
      handling: "avoided",
      error:
        'CO-OPS lists "GPS Buoy, San Francisco Bay" (9414796) among its water-level stations, but its station details answer 404 and its data is not a level above STND. Of the weeks in March of 1996, 2000, 2010, 2020 and 2025, only 2000 answers values, 6-minute values from −32.088 to −31.672 m; the others answer "No data was found". The reference of those values is not confirmed; −32 m is about the geoid height in San Francisco Bay, so they are probably heights above the ellipsoid.',
      response:
        "The station is withheld: the adapter never lists or fetches it, a refresh drops it from the store's list, and `withhold` deletes any files. A backfill no longer fails every year of both products looking its details up.",
      evidence:
        "Requests of 2026-11-21: `details.json` answers 404 while `stations/9414796.json` answers 200; `water_level` for 9414796 in the first week of March 1996, 2000, 2010, 2020 and 2025 answers values only in 2000. Only those five weeks were asked for, so other years may hold data.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        // A list that doesn't read at all would pass for one without the buoy.
        if (!(await store.station("coops/9447130")))
          throw new Error("the store doesn't list CO-OPS");
        if (await store.station(id)) throw new Error(`the store lists ${id}`);
        const rows = await store.rows("stations.parquet");
        if (!rows.some((r) => String(r.id).startsWith("coops/")))
          throw new Error("stations.parquet lists no CO-OPS station");
        if (rows.some((r) => r.id === id)) throw new Error(`stations.parquet lists ${id}`);
      },
    },
    {
      id: "coops-boston-light-2001-offset",
      stations: ["coops/8444162"],
      since: "2001-03-06",
      until: "2001-06-30",
      handling: "flagged",
      error: "CO-OPS's Boston Light levels sit about 1.6 m high from 6 March to 29 June 2001.",
      response:
        "6 March to 29 June 2001 is flagged `suspect`, keeping CO-OPS's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against Boston (`coops/8443970`), 13 km away: the difference is 1.09 to 1.12 m before and after and 2.73 m over the span; Block Island (`coops/8459681`) gives the same step.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "coops-boston-light-2004-offset",
      stations: ["coops/8444162"],
      since: "2004-04-27",
      until: "2004-05-05",
      handling: "flagged",
      error: "CO-OPS's Boston Light levels sit about 1 m high from 27 April to 4 May 2004.",
      response:
        "27 April to 4 May 2004 is flagged `suspect`, keeping CO-OPS's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against Boston (`coops/8443970`): the difference is 1.08 m before and 2.09 m over the span.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "coops-brandywine-shoal-1998-datum",
      stations: ["coops/8555889"],
      until: "2002-07-01",
      handling: "flagged",
      error:
        "CO-OPS's Brandywine Shoal Light levels before July 2002 are on other zeros than the current one: about 4.2 m below it in 1984 and 1985, and 6.8 m below it from 1997.",
      response:
        "Values before 1 July 2002 are flagged `suspect`, keeping CO-OPS's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against Atlantic City (`coops/8534720`) and Annapolis (`coops/8575512`): the differences are −2.35 and −1.74 m from 1997 to July 2002 and +4.42 and +4.99 m after; against Atlantic City the 1984 and 1985 values are +0.18 m, on a third zero. Yearly medians are −0.12 to 0.00 m in 1997 and 1998 and 6.59 to 6.80 m from 2002 on.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "coops-burlington-2002-datum",
      stations: ["coops/8539094"],
      until: "2002-06-11",
      handling: "flagged",
      error:
        "CO-OPS's Burlington (Delaware River) levels before 11 June 2002 read about 3.9 m lower than on the current zero.",
      response:
        "Values before 11 June 2002 are flagged `suspect`, keeping CO-OPS's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against Bergen Point (`coops/8519483`) and Atlantic City (`coops/8534720`): the differences are 0.28 and 0.25 m before the date and 4.15 and 4.09 m after.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "coops-kiptopeke-2001-offset",
      stations: ["coops/8632200"],
      since: "2001-01-05",
      until: "2001-03-21",
      handling: "flagged",
      error: "CO-OPS's Kiptopeke levels sit 0.6 to 1.4 m off from 5 January to 20 March 2001.",
      response:
        "5 January to 20 March 2001 is flagged `suspect`, keeping CO-OPS's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against GESLA's copy of NOAA's record of the gauge (`gesla/kiptopeke-8632200-usa-noaa`): the series equals it before and after the span and differs by −0.58 m from 5 to 11 January and +1.44 m from 12 January.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "coops-wachapreague-2008-offset",
      stations: ["coops/8631044"],
      since: "2008-05-30",
      until: "2008-10-04",
      handling: "flagged",
      error:
        "CO-OPS's Wachapreague levels sit 0.3 to 1.6 m high from 30 May to 3 October 2008, growing over the span.",
      response:
        "30 May to 3 October 2008 is flagged `suspect`, keeping CO-OPS's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against GESLA's copy of NOAA's record of the gauge (`gesla/wachapreague-8631044-usa-noaa`), which equals the series within 1 mm in every other year from 2000 to 2009: daily means differ by +0.30 m on 30 May, +0.71 to +0.98 m through the summer and +1.0 to +1.6 m in late September, and match again from 4 October. Against Bishops Head (`coops/8571421`) the series steps down 0.8 m on 4 October.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "coops-bradmoor-island-2004-offset",
      stations: ["coops/9414811"],
      since: "2004-09-09",
      until: "2004-10-01",
      handling: "flagged",
      error: "CO-OPS's Bradmoor Island levels sit about 1.3 m low from 9 to 30 September 2004.",
      response:
        "9 to 30 September 2004 is flagged `suspect`, keeping CO-OPS's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against California DWR's B91212 and B95060 (`dwr/B91212`, `dwr/B95060`), 21 and 23 km away: the differences are +0.54 to +0.63 m before and after and −0.79 and −0.73 m over the span.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "coops-stale-limit-flag",
      stations: "every station",
      handling: "corrected",
      error:
        "CO-OPS's verified 6-minute water levels and hourly heights carry the limit flag (L, an expected maximum or minimum height exceeded) on ordinary values at some stations, from an acquisition check against limits that are stale there. In March 2010 it is set on 4,142 of Annapolis's (8575512) 7,440 verified values and 2,210 of the Battery's (8518750), nearly all inside the month's own 1 to 99% range, and on none of Baltimore's (8574680), San Francisco's (9414290) or Key West's (8724580). On hourly heights it is set on every value at some stations, which left the store holding whole records as `suspect`: American Falls (9063010) 1960 to 1976, Black Rock Canal (9063017) 1970 to 1975, Barcelona (9063032) 1960 to 1969, Essexville (9075034) 1962 to 1969, Detour on Lake Huron (9075098) 1971 to 1976 and Bridgeport (8467150) in 1972.",
      response:
        "On a verified 6-minute value or an hourly height L alone doesn't make it `suspect`; flat (F) and rate-of-change (R) still do, and L still does on preliminary values and on high and low waters. Years written before this rule keep these L values as `suspect` until a backfill with `--refetch` reads them again.",
      evidence:
        "Found November 2026 by crowd-depth's store reader, which saw Tolchester Beach (8573364) lose 212 days of 2012 to `suspect` at levels of −0.09 to +0.57 m MLLW, and confirmed by counting L in the verified values of March 2010, 2015 and 2020 at seven stations from CO-OPS's API with `datum=MLLW`: Tolchester Beach (8573364), Baltimore (8574680), Annapolis (8575512), Chesapeake Bay Bridge Tunnel (8638610), the Battery (8518750), San Francisco (9414290) and Key West (8724580). Where L is set, at Tolchester, Annapolis, the Battery and the Bridge Tunnel, nearly every flagged value sits inside the month's own 1 to 99% range, and the count changes from year to year (Annapolis 4,142 in March 2010, none in March 2020). The hourly heights were found the same month by the store's preferred-record check, which saw these records entirely `suspect`, and confirmed with one month a station from CO-OPS's API with `datum=STND`: at American Falls (June 1970), Black Rock Canal (June 1972), Barcelona (June 1965), Essexville (June 1965), Detour (June 1972) and Bridgeport (March 1972) L is set on every one of the 680 to 744 hourly values, and on none at Buffalo (9063020) or Harbor Beach (9075014) in the same months, or at the Battery, Annapolis, San Francisco or Key West in March 1982. The flagged values match unflagged ones: Detour's June 1972 median of 176.95 m against 176.93 m at Harbor Beach on the same lake, and Bridgeport's March 1972 range of 0.33 to 3.46 m (median 1.62 m) against −0.27 to 3.40 m (1.60 m) in March 1971 and 0.42 to 3.02 m (1.64 m) in March 1973, neither of which carries L. Where L marks only part of a month, it marks ordinary values too: at Bridgeport in 1978 it is set on 738 of March's 744 hourly values, which run from −0.19 to 3.18 m like April's unflagged −0.27 to 3.25 m, and on 114 of July's, with a median of 1.66 m against 1.72 m for the rest. None of the 478 high and low waters at the Battery, Annapolis, San Francisco and Key West in March 1982 carry L; CO-OPS publishes none for Bridgeport in 1972 to compare.",
      // L marks most of these months and is on no other flag, so only a few values stay suspect.
      check: async (store) => {
        for (const [id, since, until] of [
          ["coops/8575512", "2010-03-01", "2010-04-01"],
          ["coops/9075098", "1972-06-01", "1972-07-01"],
        ] as const) {
          const rows = await store.levels(id, since, until);
          if (!rows.length) throw new Error(`the store holds no ${id} levels from ${since}`);
          const suspect = rows.filter((o) => o.flag >= Flag.suspect).length;
          if (suspect > rows.length / 100)
            throw new Error(
              `${suspect} of ${id}'s ${rows.length} levels from ${since} are suspect`,
            );
        }
      },
    },
    {
      id: "coops-preliminary-offset-before-1997",
      stations: ["coops/1840000", "coops/9455920"],
      since: "1994-01-01",
      until: "1997-01-01",
      handling: "dropped",
      error:
        "CO-OPS's preliminary 6-minute water levels from 1994 to 1996 sit well above its verified hourly heights at the same times, by a near-constant 0.66 m at Chuuk, Moen Island (1840000) and by 1.7 to 1.9 m on average at Anchorage (9455920), whose 1996 differences run from -2.3 to 7.9 m. Its verified record for those years is the hourly heights.",
      response:
        "In an hour with a verified hourly height, the store keeps none of the preliminary 6-minute values and reads the hourly height instead. An hour with no hourly height keeps its preliminary values, flagged `preliminary`.",
      evidence:
        "Found November 2026 at Anchorage, and measured the same month against CO-OPS's API with `datum=STND`, pairing each preliminary 6-minute value with the hourly height at the same minute over every month the store holds as preliminary: 1840000 in 1994 (8,554 pairs, mean +0.66 m) and 1995 (2,020 pairs, +0.664 m), Anchorage in 1995 (4,055 pairs, mean +1.73 m) and 1996 (8,757 pairs, mean +1.87 m). Every preliminary hour at these two stations has an hourly height, and these are the only 1994 to 1996 station-years the store holds preliminary where CO-OPS has hourly heights. Two others hold preliminary values with no hourly heights to compare: Nome (9468756) in 1994 to 1996, and Skagway (9452400) in September to December 1996.",
      // An hourly height replaces every preliminary hour at these stations, so none stays in the months read.
      check: async (store) => {
        for (const [id, since, until] of [
          ["coops/1840000", "1994-03-01", "1994-04-01"],
          ["coops/9455920", "1996-03-01", "1996-04-01"],
        ] as const) {
          const rows = await store.levels(id, since, until);
          if (!rows.length) throw new Error(`the store holds no ${id} levels from ${since}`);
          const preliminary = rows.filter((o) => o.flag === Flag.preliminary).length;
          if (preliminary)
            throw new Error(
              `${preliminary} of ${id}'s ${rows.length} levels from ${since} are preliminary`,
            );
        }
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
