import {
  dayAfter,
  flaggedSpan,
  medianGap,
  type ErrataFile,
  type StoreReader,
} from "../../errata.ts";
import { Flag } from "../../schema.ts";
import { distanceKm } from "../../stats.ts";

/** Throws unless every level the store holds for `station` on the 15th of each month of the `years` years from `year` is suspect or worse. A month with no values that day is skipped, and reading fewer than 5 of every 6 months fails. */
async function everyMonthSuspect(store: StoreReader, station: string, year: number, years: number) {
  let read = 0;
  for (let m = 0; m < 12 * years; m++) {
    const day = new Date(Date.UTC(year, m, 15)).toISOString().slice(0, 10);
    const rows = await store.levels(station, day, dayAfter(day, 1));
    if (!rows.length) continue;
    read++;
    const missed = rows.filter((o) => o.flag < Flag.suspect).length;
    if (missed)
      throw new Error(`${missed} of ${station}'s ${rows.length} levels on ${day} aren't suspect`);
  }
  if (read < (12 * years * 5) / 6)
    throw new Error(
      `the store holds ${station} levels on only ${read} of ${12 * years} mid-month days`,
    );
}

export default {
  errata: [
    {
      id: "bom-broome-ahd",
      stations: ["bom/166"],
      handling: "avoided",
      error:
        "The list beside BOM's files, readme.txt, gives Broome's offset to the Australian Height Datum as 4.462 m, but its mean level in the gauge's own zero is 5.51 to 5.58 m in 1996, 2005, 2025 and 2026, 1.1 m more. At the 11 gauges whose offset is used, the mean level is 0.10 to 0.26 m above it.",
      response: "Broome has no AHD in `datums`, so no level is converted with the list's value.",
      evidence:
        "Mean levels of the gauge's year files in 1996, 2005, 2025 and 2026 against the list's value (checked 2026-11-14); UHSLC's Broome series is exactly 2.000 m below BOM's file for 2026, so the two sources' zeros differ by that much as well.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        const station = await store.station(id);
        if (!station) throw new Error(`the store doesn't list ${id}`);
        if ("AHD" in station.datums)
          throw new Error(`the store lists Broome's AHD as ${station.datums.AHD}`);
        const rows = await store.levels(id, "2025-01-01", "2026-01-01");
        if (!rows.length) throw new Error("the store holds no Broome levels in 2025");
        const mean = rows.reduce((s, o) => s + o.level, 0) / rows.length;
        // The other gauges' mean levels are within 0.26 m of the list's value.
        if (mean - 4.462 < 0.5)
          throw new Error(
            `Broome's mean level in 2025 is ${mean.toFixed(2)} m, within 0.5 m of readme.txt's AHD`,
          );
      },
    },
    {
      id: "bom-burnie-2005-position-line",
      stations: ["bom/994"],
      handling: "avoided",
      error:
        "The first line of BOM's 2005 file for Burnie, which gives the station's name and position, is damaged: it holds a tab and misses characters (`994BURNIE<tab>L2005  T=41 03.0S  LONG=145 57.0E A  TIMEZONE=GMT`). The values below it are intact.",
      response:
        "A first line that isn't a line of levels is skipped without being read, and Burnie's position comes from GESLA's record of the gauge.",
      evidence:
        "The decompressed member h994.dat.Z of 2005.ar, whose 730 lines of levels all read and run from January 1 to December 31 (checked 2026-11-14).",
      // The year's values, read from the line after the damaged one, run from its first day to its last.
      check: async (store, e) => {
        const id = e.stations![0]!;
        const [station, gesla] = await Promise.all([
          store.station(id),
          store.station("gesla/burnie-60910-aus-bom"),
        ]);
        if (!station || !gesla)
          throw new Error("the store doesn't list bom/994 or GESLA's BOM Burnie");
        const km = distanceKm(station, gesla);
        if (km > 0.1)
          throw new Error(`the store places Burnie ${km.toFixed(1)} km from GESLA's record of it`);
        const rows = await store.levels(id, "2005-01-01", "2006-01-01");
        if (rows.length < 8000)
          throw new Error(`the store holds only ${rows.length} Burnie levels in 2005`);
        const [first, last] = [rows[0]!.time, rows.at(-1)!.time];
        if (first >= Date.UTC(2005, 0, 2) || last < Date.UTC(2005, 11, 31))
          throw new Error(
            `Burnie's 2005 levels run from ${new Date(first).toISOString()} to ${new Date(last).toISOString()}`,
          );
      },
    },
    {
      id: "bom-majuro-2005-2008-values",
      stations: ["bom/005"],
      since: "2005-01-01",
      until: "2009-01-01",
      handling: "flagged",
      error:
        "BOM's Majuro files for 2005 to 2008 aren't a record of the gauge's tide as UHSLC's series of it holds it, which GESLA's record of BOM's gauge also holds. Their mean level is 0.74 to 0.77 m against UHSLC's 1.04 to 1.13 m, a harmonic fit leaves residuals of 0.13 to 0.15 m against UHSLC's 0.05 to 0.08 m, and M2 is 0.29 to 0.30 m and S2 0.09 m against UHSLC's 0.50 to 0.51 m and 0.28 to 0.29 m. In 2006 the two correlate at -0.21 at the same hour and at 0.81 at best, 9 hours apart, so a shift of the clock doesn't join them. From January 2009 BOM's monthly means equal UHSLC's to 1 mm.",
      response:
        "2005 to 2008 is flagged `suspect`. The values stay in the store as BOM's files hold them. UHSLC's series (`uhslc/005`) covers the same years.",
      evidence:
        "November 2026. Month by month from 2005 to 2026, BOM's Majuro (`bom/005`) equals UHSLC's (`uhslc/005`) to 1 mm in every month from January 2009, and differs by more than 0.01 m on average in all 48 months of 2005 to 2008 (0.44 m in January 2005, 0.17 to 0.45 m from September to December 2008); of the 29 gauges BOM shares with UHSLC, no other differs by 0.11 m or more in any month. BOM's 1996 file for Majuro, the only other year before 2009, agrees with UHSLC's within 0.03 m at all 8,784 hours. Stony Point and Lorne have no UHSLC series, so they were compared with GESLA's records of BOM's gauges instead: Lorne's equals BOM's file in all 180 months, and Stony Point's is 0.090 m above it in every month of 2005 to 2014 and equal to it in 1996 and 2020 to 2023, which no entry covers. GESLA's record of BOM's Majuro (`gesla/majuro-67680-mhl-bom`) equals UHSLC's to 1 mm at every hour of 2005 and 2008 (8,732 and 8,784 hours) and, in 2006 and 2007, at all but 28 and 53 hours, whose largest difference from UHSLC's is 0.13 m; those hours equal BOM's file at none, so the record doesn't carry BOM's values and isn't listed. Per-year fits of M2, S2, N2, K2, K1, O1, P1 and Q1 gave BOM's 2005, 2006, 2007 and 2008 files residuals of 0.147, 0.141, 0.151 and 0.128 m and UHSLC's 0.053, 0.076, 0.070 and 0.061 m. BOM's 2006 file has all 8,760 hours.",
      reported: null,
      report: null,
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await everyMonthSuspect(store, "bom/005", 2005, 4);
        const inSpan = await medianGap(store, "bom/005", "uhslc/005", "2006-03-01", "2006-04-01");
        if (Math.abs(inSpan) < 0.1)
          throw new Error(`UHSLC's Majuro is only ${inSpan.toFixed(3)} m from BOM's in March 2006`);
        const after = await medianGap(store, "bom/005", "uhslc/005", "2009-03-01", "2009-04-01");
        if (Math.abs(after) > 0.005)
          throw new Error(`UHSLC's Majuro is ${after.toFixed(3)} m from BOM's in March 2009`);
      },
    },
    {
      id: "bom-christmas-island-2009-offset",
      stations: ["bom/170", "gesla/christmas_island-46290-aus-bom"],
      since: "2009-08-05",
      until: "2011-09-01",
      handling: "kept",
      error:
        "BOM's files and UHSLC's series of Christmas Island (`uhslc/170`), which equal each other to 0.1 mm in every month of 2008 and until 23:00 UTC on 4 August 2009 (UHSLC has no 2007 values), differ from 00:00 UTC on 5 August 2009 to the end of BOM's file, on 31 August 2011. UHSLC's values are 0.045 to 0.052 m lower in daily medians through 2009 and 2010, and exactly 0.048 m lower on some days, but the difference swings by several centimeters within a day around the turn of 2009 and 2010 and from 20 December 2010 to 9 January 2011. From 10 January to 3 July 2011 they are 0.010 m lower in 140 daily medians, apart from 12 February to 10 March, when they are 0.03 to 0.06 m lower. From 4 July 2011 they are about 0.05 m lower again. One of the two copies is on the wrong reference for these years, or the two are different sensors of the gauge, and the store can't tell which. Erratum `uhslc-christmas-island-2009-offset` records the same difference for UHSLC.",
      response:
        "Both series are kept as served and this entry flags neither. A reader of either copy reads levels that differ from the other's by 0.01 to 0.06 m in daily medians across these two years, and by up to 0.24 m at single hours.",
      evidence:
        "November 2026. Hourly values of `bom/170` and `uhslc/170` compared hour by hour for 2008 to 2011: equal to 0.1 mm in every month of 2008 and to 4 August 2009, then apart from the first hour of 5 August by the amounts above. The difference isn't a shift of the clock: from September to November 2009 the mean absolute difference is 0.049 m at a lag of 0 hours (correlation 0.99917) and 0.12 and 0.14 m at lags of -1 and 1 hour. GESLA's record of BOM's gauge (`gesla/christmas_island-46290-aus-bom`) equals BOM's file at every hour from 5 August to the end of 2009, its last year (3,487 hours), and is 0.049 m above UHSLC's on average. UHSLC's documentation file for the research-quality version (`rqds/indian/doc/qa170a.dmt`) lists data replaced on days 201, 213, 215 and 216 of 2009, the last run ending at 05:00 UTC on 4 August, and says the series from 2008 is assumed linked to the historic reference level. Cocos Island (`bom/171`, equal to UHSLC's to 1 mm in all 225 months), the only other gauge within 1,000 km, can't settle it: its monthly difference from Christmas Island moves by more than 0.1 m between years in the same month. Of the other 28 gauges BOM and UHSLC share, none has a month in which the two copies' mean difference is more than 0.01 m from the gauge's median, except Majuro in 2005 to 2008 (erratum `bom-majuro-2005-2008-values`) and single months at Suva, Honiara, Port Vila and Esperance; Stony Point and Lorne have no UHSLC series; GESLA's records of them equal BOM's files except Stony Point's 2005 to 2014, which they sit 0.090 m above. Which copy is right wasn't settled; question `bom-christmas-island-2009-reference` puts it to BOM.",
      reported: null,
      report: null,
      check: async (store, e) => {
        const before = await medianGap(store, "bom/170", "uhslc/170", "2009-07-01", "2009-08-01");
        if (Math.abs(before) > 0.002)
          throw new Error(
            `UHSLC's Christmas Island is ${before.toFixed(3)} m from BOM's in July 2009`,
          );
        const onset = await medianGap(store, "bom/170", "uhslc/170", "2009-08-05", "2009-09-05");
        if (onset > -0.04 || onset < -0.058)
          throw new Error(
            `UHSLC's Christmas Island is ${onset.toFixed(3)} m from BOM's from 5 August to 4 September 2009`,
          );
        for (const [from, to, low, high] of [
          ["2010-03-01", "2010-04-01", -0.058, -0.042],
          ["2011-04-01", "2011-05-01", -0.014, -0.006],
          ["2011-08-01", "2011-09-01", -0.062, -0.04],
        ] as const) {
          const gap = await medianGap(store, "bom/170", "uhslc/170", from, to);
          if (gap < low || gap > high)
            throw new Error(
              `UHSLC's Christmas Island is ${gap.toFixed(3)} m from BOM's from ${from} to ${to}, not ${low} to ${high} m`,
            );
        }
        const copy = await medianGap(
          store,
          "bom/170",
          "gesla/christmas_island-46290-aus-bom",
          "2009-08-05",
          "2010-01-01",
        );
        if (Math.abs(copy) > 0.002)
          throw new Error(
            `GESLA's record of BOM's gauge is ${copy.toFixed(3)} m from BOM's in 2009`,
          );
      },
    },
    {
      id: "bom-gzip-named-z",
      stations: "every station",
      since: "1996-01-01",
      until: "1997-01-01",
      handling: "corrected",
      error:
        "Every member of BOM's 1996 archive is named `h<number>.dat.Z` but is a gzip file, not a file `compress` wrote: each starts with the gzip bytes 1f 8b.",
      response: "A member is decoded by the bytes it starts with, not by its name.",
      evidence:
        "The first two bytes of each member of 1996.ar (checked 2026-11-14): 1f 8b in all 31, where the archives of 2005, 2015, 2025 and 2026 start 1f 9d.",
      check: async (store) => {
        for (const id of ["bom/166", "bom/994"]) {
          const rows = await store.levels(id, "1996-01-01", "1997-01-01");
          if (rows.length < 8000)
            throw new Error(`the store holds only ${rows.length} ${id} levels in 1996`);
        }
      },
    },
  ],
  questions: [
    {
      id: "bom-christmas-island-2009-reference",
      stations: ["bom/170"],
      question:
        "Christmas Island's hourly values in your FTP files and in UHSLC's series are identical until 23:00 UTC on 4 August 2009. From 00:00 UTC on 5 August 2009 to the end of your file on 31 August 2011, UHSLC's are 0.01 to 0.06 m lower in daily medians. Which of the two is on the gauge's tide gauge zero, and did the gauge's zero or sensor change on 4 or 5 August 2009 (UHSLC's notes list replaced data on 3 and 4 August)? If your later values are on the same zero as these, where can we read them, since your FTP archives hold none for Christmas Island after 2011?",
      why: "The answer says which copy is right, so the entry `bom-christmas-island-2009-offset` can flag the other series or retire, and says whether to open a datum epoch for the change.",
      meanwhile:
        "Both series are kept as served and neither is flagged; `preferred` is worked out from their lengths and flags as for any pair of copies.",
      asked: null,
      answer: null,
    },
  ],
  retired: [],
} satisfies ErrataFile;
