import { dayAfter, flaggedSpan, type ErrataFile } from "../../errata.ts";
import { POSITIONS } from "../../positions.ts";
import { distanceKm, median } from "../../stats.ts";
import { lateBy, middle, read, unflagged } from "./checks.ts";

export default {
  errata: [
    {
      id: "uhslc-hong-kong-hour-early",
      stations: ["uhslc/329", "uhslc/329a"],
      handling: "corrected",
      error:
        "UHSLC stamps its Hong Kong (Quarry Bay) hourly heights an hour early in every version and the fast-delivery series: the height labeled T was measured at T + 1 h UTC ([openwatersio/slackwater-database#360](https://github.com/openwatersio/slackwater-database/issues/360), confirmed by the clock check).",
      response: "Every value is moved an hour later.",
      evidence:
        "Found in [openwatersio/slackwater-database#360](https://github.com/openwatersio/slackwater-database/issues/360) and confirmed by `scripts/clock-check.ts`: Quarry Bay fits other records best an hour later, in every version and the fast-delivery series.",
      reported: "2026-10-24",
      report:
        "Sent to srdata@soest.hawaii.edu on 2026-10-24, with a follow-up on 2026-11-07. No answer yet.",
      // The tide reaches Shanwei, Quarry Bay and Macau in turn, westward along the coast; an hour early would put Quarry Bay before Shanwei.
      check: async (store) => {
        for (const [id, other, span, lo, hi] of [
          ["uhslc/329", "uhslc/641a", ["1995-07-01", "1995-07-15"], 15, 60],
          ["uhslc/329a", "uhslc/641a", ["1980-07-01", "1980-07-15"], 15, 60],
          ["uhslc/329a", "uhslc/338a", ["1980-03-01", "1980-03-15"], -60, -15],
        ] as const) {
          const { lag } = await lateBy(store, id, other, [...span], 120, 15);
          if (lag < lo || lag > hi)
            throw new Error(
              `${id} runs ${lag} minutes late against ${other} from ${span[0]} to ${span[1]}, not ${lo} to ${hi}`,
            );
        }
      },
    },
    {
      id: "uhslc-spain-hour-early",
      stations: ["uhslc/208a", "uhslc/217a", "uhslc/217b", "uhslc/217c"],
      handling: "corrected",
      error:
        "UHSLC stamps its research-quality versions of Vigo (208 version A, 1943 to 1990) and its older ones of Las Palmas (217 versions A, B and C, 1949 to 1991) an hour early: the height labeled T was measured at T + 1 h UTC. Las Palmas's FD series (217), from May 1991, is on time.",
      response: "The four versions' values are moved an hour later.",
      evidence:
        "IEO's records of both gauges (GESLA's `vigo-vigo-esp-ieo` and `pluz-pluz-esp-ieo`) equal UHSLC's an hour earlier in every year they share: Vigo 1943 to 1990 at a standard deviation of 0.2 to 1.6 cm in most years against 41 to 44 cm at UHSLC's own times, Las Palmas 1949 to 1956 at 0.2 to 0.4 cm in most years and 1975 to 1990 at 0.9 to 13 cm against 28 to 32 cm. From 1993 IEO's Las Palmas equals UHSLC's FD series at the same time to 0.01 cm. M2's phase, which an hour moves by 29°, is 241 to 245° a year in UHSLC's Vigo version A (1943 to 1990) against 269 to 276° in IEO's Vigo record (GESLA's `vigo-vigo-esp-ieo`) from 1943 to 2016 and in Puertos del Estado's Vigo 2 gauge (CMEMS, from 1992); at Las Palmas it is 189 to 201° in versions A, B and C against 218 to 227° in IEO's record from 1949 to 2016, UHSLC's own FD series (217) from 1991 and CMEMS's from 1992. The store's level match found IEO's Las Palmas and Vigo equal to UHSLC's only at an hour's offset.",
      // IEO's records of both gauges are on time, so the moved values equal them at the same times.
      check: async (store) => {
        for (const [id, ieo, span] of [
          ["uhslc/208a", "gesla/vigo-vigo-esp-ieo", ["1985-03-01", "1985-03-04"]],
          ["uhslc/217a", "gesla/pluz-pluz-esp-ieo", ["1950-03-01", "1950-03-04"]],
        ] as const) {
          const { lag, rms } = await lateBy(store, id, ieo, [...span], 120, 60);
          if (lag !== 0 || rms > 0.02)
            throw new Error(
              `${id} fits ${ieo} best ${lag} minutes late, at ${rms.toFixed(3)} m RMS`,
            );
        }
      },
    },
    {
      id: "uhslc-progreso-721a-six-hours-late",
      stations: ["uhslc/721a"],
      handling: "corrected",
      error:
        "UHSLC's Progreso version A (721a, 1980 to 1984) is 6 hours late: the height labeled T was measured at T − 6 h UTC. Versions B and C are on time.",
      response: "Every value of version A is moved 6 hours earlier.",
      evidence:
        "GESLA's copy of UNAM's historical Progreso record (`progreso-402-mex-unam_hist`) equals UHSLC's version A 6 hours later in 1982 and 1983 (r 0.998, standard deviation 1.4 cm), against r 0.88 or less at any other whole hour. K1's and M2's phases in version A are 119° and 282°; in UNAM's record from 1952 to 1993 they are 21° and 105°, in UHSLC's versions B (1999 to 2004) and C (2012 to 2013) 28° and 110° and 10° and 105°, and at the Yucatán gauges either side, Celestún, Sisal and Telchac, 13 to 15° and 101 to 109°. Six hours moves K1 by 90° and M2 by 174°. The store's level match found UNAM's record 27 cm from UHSLC's at the same times.",
      // UNAM's historical record is on time, so the moved values equal it at the same times.
      check: async (store, e) => {
        const id = e.stations![0]!;
        const { lag, rms } = await lateBy(
          store,
          id,
          "gesla/progreso-402-mex-unam_hist",
          ["1983-03-01", "1983-03-04"],
          420,
          60,
        );
        if (lag !== 0 || rms > 0.02)
          throw new Error(
            `721a fits UNAM's Progreso best ${lag} minutes late, at ${rms.toFixed(3)} m RMS`,
          );
      },
    },
    {
      id: "uhslc-vardo-2007-2018-five-minutes-late",
      stations: ["uhslc/805"],
      since: "2007-01-01",
      until: "2019-01-01",
      handling: "kept",
      error:
        "UHSLC's Vardø values (805, in the research-quality version and the FD series alike) from January 2007 to December 2018 are 5 minutes late: the height labeled T stands for T − 5 min UTC. Its values from 2004 to 2006 and from 2019 are on time. The research-quality version (805a) and the FD series carry the same values.",
      response:
        "Kept as served. Moved 5 minutes earlier, the values would sit off the hour, where the store's hourly comparisons (level matches, link offsets) don't read them, and they may be 10-minute means rather than a clock error. Kartverket's own series of the gauge (`kartverket/VAW`) is the group's preferred series, and has no such lag.",
      evidence:
        "UHSLC's hourly Vardø values were compared with Kartverket's 10-minute series of the gauge (`kartverket/VAW`), interpolated to lags from −15 to +15 minutes, year by year from 1990. In every month from January 2007 to December 2018 they fit best 300 seconds earlier, to within 10 seconds, at a standard deviation of 15 to 17 mm against 34 to 39 mm at their own times. In 2004 to 2006 and from January 2019 they equal Kartverket's at their own times to 0 to 2 mm. Kartverket's mean over the 10 minutes before each label fits as well as the lag, and no centred window does, so the values may be 10-minute means labeled at their end; either way they stand for 5 minutes before their labels. Before 2004 UHSLC's values are rounded to decimeters, which differs from Kartverket's by about 30 mm at every lag (erratum `uhslc-vardo-1989-2003-decimeters`), and aren't moved. GESLA's NHS and CMEMS copies of the gauge are on time. A harmonic fit of 2006 to 2020, which mixes the late years with on-time ones, put UHSLC 170 to 240 seconds behind Kartverket from K1 to M4, while UHSLC's Honningsvåg and Andenes agree with Kartverket within about 10 seconds.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        for (const [span, late] of [
          [["2015-06-01", "2015-06-03"], 5],
          [["2020-06-01", "2020-06-03"], 0],
        ] as const) {
          const { lag } = await lateBy(store, id, "kartverket/VAW", [...span], 15, 5);
          if (lag !== late)
            throw new Error(
              `Vardø (805) runs ${lag} minutes late against kartverket/VAW from ${span[0]}, not ${late}`,
            );
        }
      },
    },
    {
      id: "uhslc-vardo-1989-2003-decimeters",
      stations: ["uhslc/805"],
      since: "1989-11-01",
      until: "2004-01-01",
      handling: "kept",
      error:
        "UHSLC's Vardø values (805) from 1 November 1989 to the end of 2003 are whole decimeters, apart from short runs in single days (135 of the 117,361 values of 1990 to 2003), so each rounded value is up to 5 cm from the level the gauge read. Before November 1989 they are in centimeters and from 2004 in millimeters. The research-quality version (805a) and the FD series carry the same values.",
      response:
        "Kept as served. The values are not rounded again or marked; nothing in the store says which are the rounded ones except this entry. Kartverket's own series of the gauge (`kartverket/VAW`), in tenths of a centimeter, is the group's preferred series and covers the span from 1 November 1989.",
      evidence:
        "Of the 117,361 values from 1990 to 2003, 117,226 are whole decimeters; the other 135 are runs of hours in single days such as 11 March 1991, in millimeters. In 1989 every value from 1 November is a whole decimeter, and the last that isn't is at 22:00 UTC on 30 September; UHSLC has none in October. UHSLC's documentation file for 805a gives a Scan-Matic gauge from 1 November 1989 and units of millimeters. Against Kartverket's 10-minute series at the same hours, the difference after removing its median has a standard deviation of 28.6 to 31 mm in every year from 1990 to 2003, at its own times and at no other lag, which is 100 mm / √12 = 28.9 mm, the spread of a rounding to 0.1 m. UHSLC's value equals Kartverket's rounded to 0.1 m after adding 866 mm in 98.6% of hours in 1990, 98.2% in 1998 and 95.8% in 2003. In 2004 to 2006 the difference has a standard deviation of 0 to 1 mm. The 5-minute lag of erratum `uhslc-vardo-2007-2018-five-minutes-late` starts in 2007, so the span is on time.",
      // Whole decimeters in 1998 and finer values in 2005, against Kartverket's values rounded to 0.1 m.
      check: async (store) => {
        const whole = (rows: { level: number }[]) =>
          rows.filter((o) => Math.abs(o.level * 10 - Math.round(o.level * 10)) < 1e-6).length /
          rows.length;
        const early = await read(store, "uhslc/805", "1998-03-01", "1998-04-01");
        const late = await read(store, "uhslc/805", "2005-03-01", "2005-04-01");
        if (whole(early) < 0.99)
          throw new Error(
            `only ${(100 * whole(early)).toFixed(1)}% of Vardø's March 1998 values are whole decimeters`,
          );
        if (whole(late) > 0.2)
          throw new Error(
            `${(100 * whole(late)).toFixed(1)}% of Vardø's March 2005 values are whole decimeters`,
          );
        const kartverket = new Map(
          (await read(store, "kartverket/VAW", "1998-03-01", "1998-04-01")).map((o) => [
            o.time,
            o.level,
          ]),
        );
        const pairs = early.filter((o) => kartverket.has(o.time));
        const hits = pairs.filter(
          (o) => Math.abs(Math.round((kartverket.get(o.time)! + 0.866) * 10) / 10 - o.level) < 1e-6,
        ).length;
        if (pairs.length < 500 || hits / pairs.length < 0.95)
          throw new Error(
            `${hits} of ${pairs.length} March 1998 values equal Kartverket's rounded to 0.1 m after adding 866 mm`,
          );
      },
    },
    {
      id: "uhslc-tregde-1987-2003-decimeters",
      stations: ["uhslc/804"],
      since: "1987-12-11",
      until: "2004-01-01",
      handling: "kept",
      error:
        "UHSLC's Tregde values (804) from 11 December 1987 to the end of 2003 are whole decimeters, apart from short runs (20 of 134,733 values), so each rounded value is up to 5 cm from the level the gauge read. Before 1987 they are in centimeters and from 2004 in millimeters.",
      response:
        "Kept as served. Kartverket's own series of the gauge (`kartverket/TRG`) is in tenths of a centimeter.",
      evidence:
        "Of the 134,733 values stored for 1987 to 2003, 134,713 are whole decimeters. The last value in a finer unit before the run is at 23:00 UTC on 31 December 1986, and UHSLC has none from then to 10 December 1987. In 2004 to 2012 about 1% are whole decimeters, by chance. Against `kartverket/TRG` in March 1998 the median difference is 494 mm. UHSLC's Andenes (800), Honningsvåg (801), Måløy (802) and Rørvik (803), the other Norwegian NHS records with a Kartverket counterpart, hold millimeters in 1991 and 1999. Zero steps against Kartverket weren't looked for at Tregde, Andenes, Måløy or Rørvik.",
      // Whole decimeters in March 1998 and finer values in March 2005.
      check: async (store) => {
        const whole = (rows: { level: number }[]) =>
          rows.filter((o) => Math.abs(o.level * 10 - Math.round(o.level * 10)) < 1e-6).length /
          rows.length;
        const early = whole(await read(store, "uhslc/804", "1998-03-01", "1998-04-01"));
        const late = whole(await read(store, "uhslc/804", "2005-03-01", "2005-04-01"));
        if (early < 0.99)
          throw new Error(
            `only ${(100 * early).toFixed(1)}% of Tregde's March 1998 values are whole decimeters`,
          );
        if (late > 0.2)
          throw new Error(
            `${(100 * late).toFixed(1)}% of Tregde's March 2005 values are whole decimeters`,
          );
      },
    },
    {
      id: "uhslc-vardo-zero-steps",
      stations: ["uhslc/805"],
      since: "1989-11-01",
      handling: "kept",
      error:
        "UHSLC's Vardø values (805, in the research-quality version and the FD series alike) sit at four different heights above Kartverket's chart datum: 866 mm from November 1989 to 31 December 2006, about 925 mm from 1 January 2007 to 31 December 2018, 886 mm from 1 January 2019 to 31 May 2021 and 907 mm from 1 June 2021, while the store keeps them in one datum epoch, ZERO, from 1947. The offset steps by +59, −39 and +21 mm, on the first day with values after each change. UHSLC's documentation gives the distance between its zero (TGZ) and chart datum as 907 mm.",
      response:
        "Kept as served, in one epoch. The store holds no offset from UHSLC's zero to chart datum, so UHSLC's Vardø and Kartverket's aren't linked, and a link would carry one offset across all four zeros. A level read across 2007, 2019 or 2021 carries the step. The station's `datums` (MSL and LAT, carried from other records of the gauge) are single values, so they fit at most one of the four zeros.",
      evidence:
        "The median of UHSLC's value less Kartverket's at the same hours, by year from 1990, is 863 to 867 mm to 2006, 924 to 926 in 2007 to 2018 (at lag 0; 925 at 5 minutes earlier, with the lag of erratum `uhslc-vardo-2007-2018-five-minutes-late`), 886 in 2019 and 2020 and 907 from 2022. By day it is 866 mm on 31 December 2006 and 937 on 1 January 2007, 926 on 30 December 2018 and 889 on 1 January 2019 (UHSLC has no value on 31 December), and 886 on 31 May 2021 and 907 on 1 June. GESLA's NHS copy of the gauge (`vardo-vaw-nor-nhs`) equals Kartverket's to 0 mm in every year from 1990 to 2026, so the steps are in UHSLC's values and not Kartverket's. UHSLC's Honningsvåg (801) against Kartverket's (HVG) steps at other dates: the yearly median is 53 to 61 mm to 2014 (45 in 2013), −28 to −33 mm from 2015 to 2020 and 0 to −1 mm from 2021, so both gauges step in 2021. UHSLC's documentation file for 805a says that the 2007 to 2014 values were replaced in January 2020 after NHS corrected systematic errors, and the 2007 step is in the values it serves. Only the offset after 31 May 2021 has the size the documentation gives, and its wording (TGZ = Chart Datum + 907 mm) doesn't say which way it runs; UHSLC's values read 907 mm above Kartverket's.",
      // The offset in a month of each span, at lag 0, within 6 mm of its value.
      check: async (store) => {
        for (const [span, expected] of [
          [["1998-03-01", "1998-04-01"], 866],
          [["2010-06-01", "2010-07-01"], 925],
          [["2020-06-01", "2020-07-01"], 886],
          [["2022-06-01", "2022-07-01"], 907],
        ] as const) {
          const kartverket = new Map(
            (await read(store, "kartverket/VAW", span[0], span[1])).map((o) => [o.time, o.level]),
          );
          const d = (await read(store, "uhslc/805", span[0], span[1]))
            .filter((o) => kartverket.has(o.time))
            .map((o) => o.level - kartverket.get(o.time)!);
          if (d.length < 500)
            throw new Error(`Vardø shares ${d.length} hours with Kartverket from ${span[0]}`);
          const mm = median(d) * 1000;
          if (Math.abs(mm - expected) > 6)
            throw new Error(
              `Vardø (805) sits ${mm.toFixed(0)} mm above kartverket/VAW from ${span[0]}, not ${expected}`,
            );
        }
      },
    },
    {
      id: "uhslc-positions",
      stations: ["uhslc/290a", "uhslc/290", "uhslc/914", "uhslc/316", "uhslc/548", "uhslc/054a"],
      handling: "corrected",
      error:
        "UHSLC's station metadata places six series several kilometers from their gauge, one of them in the open sea.",
      response:
        "The station refresh moves each station to the gauge's position from another source, listed in `POSITIONS` in `src/positions.ts`. An entry applies only while UHSLC still serves the position it was written against; if UHSLC moves the station, it keeps UHSLC's position and the refresh reports the entry and fails the run until the entry is checked.",
      evidence:
        "| Station | UHSLC | Gauge | Off by | Source of the gauge's position |\n| --- | --- | --- | --: | --- |\n| Port Stanley 290A, 1964–1974 | -52.7, -57.8667 | -51.690339, -57.864931 | 112 km | PSMSL Stanley (1082), 1964–1974 |\n| Port Stanley 290, 1992 on | -51.75, -57.9333 | -51.692358, -57.820514 | 10 km | PSMSL Stanley II (1796), 1992 on |\n| Meulaboh 914 | 4.316667, 96.21667 | 4.1274865, 96.131854 | 23 km | IOC sea level monitoring (meul) |\n| Acapulco 316 | 16.8417, -99.8517 | 16.8379333, -99.903 | 5.5 km | IOC (acap2); UHSLC's own 316A and 316B, and UNAM's records, are within 1 km of it |\n| Kaumalapau 548 | 20.78, -156.9 | 20.79, -156.995 | 10 km | CO-OPS Kaumalapau Harbor (1614465); UHSLC's position is inland on Lanai |\n| Chuuk 054A, 1947–1991 | 7.45368, 151.8982 | 7.44667, 151.847 | 5.7 km | NOAA's Moen Island gauge (CO-OPS 1840000); UHSLC's position is its current gauge's |\n\nUHSLC's 290A position sits 112 km south of Stanley in the South Atlantic. slackwater-database tracks the same positions in TICON's copies of these series in [openwatersio/slackwater-database#375](https://github.com/openwatersio/slackwater-database/issues/375).",
      check: async (store, e) => {
        for (const id of e.stations!) {
          const s = await store.station(id);
          if (!s) throw new Error(`the store doesn't list ${id}`);
          const at = POSITIONS[id]?.at;
          if (!at) throw new Error(`POSITIONS holds no position for ${id}`);
          const km = distanceKm(s, at);
          if (km > 0.1)
            throw new Error(`the store places ${id} ${km.toFixed(1)} km from its gauge`);
        }
      },
    },
    {
      id: "uhslc-goteborg-2007-hour-early",
      stations: [
        "uhslc/819",
        "gesla/goteborgorsh-819-swe-uhslc_fd",
        "gesla/goteborgorsh-819a-swe-uhslc_rq",
      ],
      since: "2007-07-23",
      until: "2008-01-01",
      handling: "flagged",
      error:
        "UHSLC's hourly Göteborg-Torshamnen levels are stamped one hour early from 23 July to 31 December 2007. GESLA's copies of the fast-delivery and research-quality records carry the same values.",
      response:
        "23 July to 31 December 2007 is flagged `suspect`, keeping each record's own flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)): the tide's timing at Göteborg ran about 65 minutes early in those windows. Against SMHI's own record of the gauge (`smhi/2109`), UHSLC's values differ by 3.6 to 4.3 cm RMS a month, and by 0.0 cm once shifted 60 minutes; before 23 July and after 31 December they match unshifted. GESLA's copies of UHSLC's fast-delivery and research-quality records (`gesla/goteborgorsh-819-swe-uhslc_fd` and `gesla/goteborgorsh-819a-swe-uhslc_rq`) hold the same values at all 3,600 times each shares with UHSLC's, on 150 of the 150 days read in five 30-day pieces spread over the span's 162, and GESLA rates them usable. GESLA's CMEMS record of the gauge differs from UHSLC's by the same amount over the span, as SMHI's does, so it's on the right clock.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        const { lag } = await lateBy(store, id, "smhi/2109", ["2007-09-01", "2007-09-04"], 120, 10);
        if (Math.abs(lag + 60) > 10)
          throw new Error(
            `Göteborg (819) runs ${lag} minutes late against smhi/2109 in September 2007, not −60`,
          );
      },
    },
    {
      id: "uhslc-goteborg-2011-hour-early",
      stations: [
        "uhslc/819",
        "gesla/goteborgorsh-819-swe-uhslc_fd",
        "gesla/goteborgorsh-819a-swe-uhslc_rq",
      ],
      since: "2011-02-01",
      until: "2011-07-01",
      handling: "flagged",
      error:
        "UHSLC's hourly Göteborg-Torshamnen levels are stamped one hour early from 1 February to 30 June 2011. GESLA's copies of the fast-delivery and research-quality records carry the same values.",
      response:
        "February to June 2011 is flagged `suspect`, keeping each record's own flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)): the tide's timing at Göteborg ran about 62 minutes early. Against SMHI's own record (`smhi/2109`) the values differ by 3.5 to 4.8 cm RMS a month, and by 0.0 to 0.2 cm once shifted 60 minutes; January and July onward match unshifted. GESLA's copies of UHSLC's fast-delivery and research-quality records (`gesla/goteborgorsh-819-swe-uhslc_fd` and `gesla/goteborgorsh-819a-swe-uhslc_rq`) hold the same values at all 3,600 times each shares with UHSLC's, on all 150 days of the span. GESLA's CMEMS record of the gauge differs from UHSLC's by the same amount over the span, as SMHI's does, so it's on the right clock.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        const { lag } = await lateBy(store, id, "smhi/2109", ["2011-03-01", "2011-03-04"], 120, 10);
        if (Math.abs(lag + 60) > 10)
          throw new Error(
            `Göteborg (819) runs ${lag} minutes late against smhi/2109 in March 2011, not −60`,
          );
      },
    },
    {
      id: "uhslc-cuxhaven-2024-march",
      stations: ["uhslc/825", "gesla/cuxhaven-825-deu-uhslc_fd"],
      since: "2024-02-29",
      until: "2024-04-01",
      handling: "flagged",
      error:
        "UHSLC's hourly Cuxhaven levels from 29 February to 31 March 2024 don't match the gauge's other records, even allowing for a clock offset. GESLA's copy of the fast-delivery record carries the same values.",
      response:
        "29 February to 31 March 2024 is flagged `suspect`, keeping each record's own flag as `source_flag`. These are fast-delivery values; check the span again when UHSLC's research-quality release replaces them.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)). Against PEGELONLINE's Cuxhaven Steubenhöft (`pegelonline/5990020`) and GESLA's BfG and CMEMS records of the gauge, which agree with each other, UHSLC's March 2024 differs by 56 cm RMS, and still by 38 cm at its best lag of about 45 minutes; April to June and September to December 2024 match to within 0.4 cm. No other gauge in the German Bight matches the month (best r 0.94). GESLA's copy of UHSLC's fast-delivery record (`gesla/cuxhaven-825-deu-uhslc_fd`) holds the same values at all 768 times the two share, on all 32 days of the span.",
      // Months that match PEGELONLINE's gauge do so to under a centimeter.
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        for (const [span, off] of [
          [["2024-03-10", "2024-03-12"], true],
          [["2024-05-10", "2024-05-12"], false],
        ] as const) {
          const { rms } = await lateBy(store, id, "pegelonline/5990020", [...span], 120, 10);
          if (rms > 0.1 !== off)
            throw new Error(
              `Cuxhaven (825) fits pegelonline/5990020 from ${span[0]} at ${rms.toFixed(3)} m RMS at best`,
            );
        }
      },
    },
    {
      id: "uhslc-cuxhaven-2024-summer",
      stations: ["uhslc/825", "gesla/cuxhaven-825-deu-uhslc_fd"],
      since: "2024-07-01",
      until: "2024-09-01",
      handling: "flagged",
      error:
        "UHSLC's hourly Cuxhaven levels for July and August 2024 don't match the gauge's other records, even allowing for a clock offset. GESLA's copy of the fast-delivery record carries the same values.",
      response:
        "July and August 2024 are flagged `suspect`, keeping each record's own flag as `source_flag`. These are fast-delivery values; check the span again when UHSLC's research-quality release replaces them.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)). Against PEGELONLINE's Cuxhaven Steubenhöft (`pegelonline/5990020`) and GESLA's BfG and CMEMS records, UHSLC's July and August 2024 differ by 52 and 54 cm RMS, and still by 26 and 34 cm at their best lag of about 50 minutes; the tide-timing check puts them about 45 minutes late in the semidiurnal band and 60 in the diurnal. No other gauge in the German Bight matches (best r 0.94). GESLA's copy of UHSLC's fast-delivery record (`gesla/cuxhaven-825-deu-uhslc_fd`) holds the same values at all 1,488 times the two share, on all 62 days of the span.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        const { rms } = await lateBy(
          store,
          id,
          "pegelonline/5990020",
          ["2024-07-15", "2024-07-17"],
          120,
          10,
        );
        if (rms <= 0.1)
          throw new Error(
            `Cuxhaven (825) fits pegelonline/5990020 in July 2024 to ${rms.toFixed(3)} m RMS`,
          );
      },
    },
    {
      id: "uhslc-esperanza-1998-datum",
      stations: ["uhslc/601"],
      until: "1998-08-31",
      handling: "flagged",
      error:
        "UHSLC's Esperanza research-quality levels before 31 August 1998 are on a zero 3.3 m from the record's later one.",
      response:
        "Values before 31 August 1998 are flagged `suspect`, keeping UHSLC's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed by daily-mean differences against GESLA's copy of UHSLC's fast-delivery Esperanza record (`gesla/esperanza-601-arg-uhslc_fd`), which keeps one zero throughout: the series less it is −3.29 m before the date and 0.0 after.",
      // GESLA's copy of the FD series keeps one zero throughout.
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        const fd = "gesla/esperanza-601-arg-uhslc_fd";
        for (const [span, lo, hi] of [
          [["1998-07-01", "1998-08-30"], -3.5, -3],
          [["1998-09-01", "1998-10-31"], -0.1, 0.1],
        ] as const) {
          const d = (await middle(store, id, [...span])) - (await middle(store, fd, [...span]));
          if (d < lo || d > hi)
            throw new Error(
              `Esperanza (601) sits ${d.toFixed(2)} m from ${fd} from ${span[0]}, not ${lo} to ${hi}`,
            );
        }
      },
    },
    {
      id: "uhslc-milolii-2025-datum",
      stations: ["uhslc/431"],
      until: "2025-06-17",
      handling: "flagged",
      error:
        "UHSLC's Milolii levels before 17 June 2025 are on a zero about 1 m from the later one.",
      response:
        "Values before 17 June 2025 are flagged `suspect`, keeping UHSLC's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed by daily-mean differences against UHSLC's Honokohau (`uhslc/430`), 55 km away: the difference is −1.10 m before the date and −0.08 m after.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        // The record holds nothing from 30 November 2024 10:00 to the span's end.
        await flaggedSpan(store, { ...e, until: "2024-12-01" });
        await unflagged(store, id, [e.until!, dayAfter(e.until!, 4)]);
        for (const [span, lo, hi] of [
          [["2024-10-01", "2024-12-01"], -1.3, -0.9],
          [["2025-06-18", "2025-08-01"], -0.3, 0.1],
        ] as const) {
          const d =
            (await middle(store, id, [...span])) - (await middle(store, "uhslc/430", [...span]));
          if (d < lo || d > hi)
            throw new Error(
              `Milolii (431) sits ${d.toFixed(2)} m from Honokohau (430) from ${span[0]}, not ${lo} to ${hi}`,
            );
        }
      },
    },
    {
      id: "uhslc-inhambane-2012-datum",
      stations: ["uhslc/900", "gesla/inhambane-900a-moz-uhslc_rq"],
      until: "2012-04-21",
      handling: "flagged",
      error:
        "UHSLC's Inhambane levels before 21 April 2012 are on a zero about 1 m from the later one.",
      response:
        "Values before 21 April 2012 are flagged `suspect`, keeping UHSLC's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed by daily-mean differences against GESLA's copies of UHSLC's fast-delivery and research-quality records: the series equals the fast-delivery copy before the date and the research-quality copy (`gesla/inhambane-900a-moz-uhslc_rq`) after it, and the fast-delivery copy sits 1.03 m from the series after it. The research-quality copy holds the series' values before the date too, at all 2,042 times the two share, on 143 of the 150 days read in five 30-day pieces spread from the record's start to the date, 295 days in all.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        // The record holds nothing from 15 April 2012 11:00 to the span's end.
        await flaggedSpan(store, { ...e, until: "2012-04-16" });
        await unflagged(store, id, [e.until!, dayAfter(e.until!, 10)]);
        const step =
          (await middle(store, id, ["2012-04-22", "2012-06-01"])) -
          (await middle(store, id, ["2012-03-01", "2012-04-20"]));
        if (step < 0.5)
          throw new Error(`Inhambane (900) steps ${step.toFixed(2)} m on 21 April 2012`);
      },
    },
    {
      id: "uhslc-qaqortoq-2008-datum",
      stations: ["uhslc/299"],
      handling: "kept",
      error:
        "UHSLC's Qaqortoq levels from June 2008 on are on a zero about 5 m from the record's earlier one, with no change of datum marked.",
      response:
        "The store keeps the values as served: the store holds no independent record of the gauge to show which zero is wrong, so nothing is flagged.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`) over every record the store lists as coastal; the store holds no other record of the gauge or gauge nearby to compare, so this rests on the record's own medians. Yearly medians are 1.59 to 1.81 m from 1991 to 1998 and 6.74 to 6.81 m from 2008 on, across a gap from 1999 to 2007. No other gauge in the store lies within 150 km; GESLA's copies hold the same values.",
      since: "2008-06-01",
      check: async (store, e) => {
        const id = e.stations![0]!;
        await unflagged(store, id, ["2009-01-01", "2010-01-01"]);
        const step =
          (await middle(store, id, ["2009-01-01", "2010-01-01"])) -
          (await middle(store, id, ["1998-01-01", "1999-01-01"]));
        if (step < 4.5 || step > 5.5)
          throw new Error(
            `Qaqortoq's (299) median steps ${step.toFixed(2)} m from 1998 to 2009, not about 5`,
          );
      },
    },
    {
      id: "uhslc-sao-tome-2004-datum",
      stations: ["uhslc/225"],
      handling: "kept",
      error:
        "UHSLC's Sao Tome levels from 27 August 2004 on are on a zero about 5 m from the record's earlier one, with no change of datum marked.",
      response:
        "The store keeps the values as served: the store holds no independent record of the gauge to show which zero is wrong, so nothing is flagged.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`) over every record the store lists as coastal; the store holds no other record of the gauge or gauge nearby to compare, so this rests on the record's own medians. Yearly medians are 7.02 to 7.05 m from 1985 to 1988 and 1.76 to 1.90 m from 2004 on. No other gauge in the store lies within 150 km; GESLA's copies hold the same values. The values on the later zero start at 17:00 UTC on 27 August 2004.",
      since: "2004-08-27",
      check: async (store, e) => {
        const id = e.stations![0]!;
        await unflagged(store, id, ["2005-01-01", "2006-01-01"]);
        const step =
          (await middle(store, id, ["2005-01-01", "2006-01-01"])) -
          (await middle(store, id, ["1988-01-01", "1989-01-01"]));
        if (step < -5.5 || step > -4.5)
          throw new Error(
            `Sao Tome's (225) median steps ${step.toFixed(2)} m from 1988 to 2005, not about −5`,
          );
      },
    },
    {
      id: "uhslc-gibraltar-2023-datum",
      stations: ["uhslc/289"],
      handling: "kept",
      error:
        "UHSLC's Gibraltar levels from November 2023 on read about 1.5 m higher than the record's earlier ones, with no change of datum marked.",
      response:
        "The store keeps the values as served: the store holds no independent record of the gauge to show which zero is wrong, so nothing is flagged and the record has one datum epoch. The step falls inside the 2001 to 2022 gap, where no record shows the day or the cause, so no split is listed.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`) over every record the store lists as coastal; no gauge in the store spans the 2001 to 2022 gap, so this rests on the record's own medians. Yearly medians are 0.60 to 0.67 m from 1993 to 2000 and 2.07 to 2.10 m from 2023 on. The record joins UHSLC's research-quality version B (1993 to 2000) to its fast-delivery series from November 2023, which TICON's matching places 1.8 km from version B's position, so the later series may be a relocated gauge with its own zero.",
      since: "2023-11-01",
      check: async (store, e) => {
        const id = e.stations![0]!;
        await unflagged(store, id, ["2024-01-01", "2025-01-01"]);
        const step =
          (await middle(store, id, ["2024-01-01", "2025-01-01"])) -
          (await middle(store, id, ["2000-01-01", "2001-01-01"]));
        if (step < 1.2 || step > 1.8)
          throw new Error(
            `Gibraltar's (289) median steps ${step.toFixed(2)} m from 2000 to 2024, not about 1.5`,
          );
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
