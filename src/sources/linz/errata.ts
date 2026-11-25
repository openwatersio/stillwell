import { dayAfter, flaggedSpan, type ErrataFile } from "../../errata.ts";
import { Flag } from "../../schema.ts";
import {
  absent,
  current,
  epochFrom,
  levels,
  med,
  noEpochBetween,
  offset,
  step,
  stepCorrected,
  tide,
} from "./checks.ts";

export default {
  errata: [
    {
      id: "linz-kaikoura-uplift",
      stations: ["linz/KAIT"],
      since: "2016-11-13",
      until: "2016-11-14",
      handling: "flagged",
      error:
        "The Kaikoura earthquake of 14 November 2016 NZDT (13 November, 11:02 UTC) lifted the gauge and its benchmark 0.88 m, as the README says, and LINZ's levels carry on from the same zero without a note. Daily means fall from about 3.4 m on 12 November to 2.4 m on 14 November, and the minimum on 13 November is 0.38 m against 1.5 m on 14 November.",
      response:
        "13 November 2016 is flagged `suspect`, keeping the source's own flag as `source_flag`: from 11:02 UTC its values are on the new zero but stored in the earlier epoch. A datum epoch starts on 14 November, and the levels before it convert to it by the README's 0.88 m, so the series carries on across the lift. The README's chart datum offset is from 2017 and is dropped, since sensors were replaced in 2018.",
      evidence:
        "Daily means and minimums of the 2016 sensor 40 file, November 2016; the README's note that the station was uplifted 0.88 m.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await epochFrom(store, "linz/KAIT", e.until!).then(({ before, after }) => {
          if (!(Math.abs((before.to_current ?? NaN) - (after.to_current ?? NaN) + 0.88) < 0.005))
            throw new Error(`KAIT's epoch before 14 November 2016 doesn't convert by -0.88 m`);
        });
        const [a, b] = [
          med(
            await current(
              store,
              "linz/KAIT",
              await levels(store, "linz/KAIT", "2016-11-05", e.since!),
            ),
          ),
          med(
            await current(
              store,
              "linz/KAIT",
              await levels(store, "linz/KAIT", e.until!, "2016-11-22"),
            ),
          ),
        ];
        if (!(Math.abs(a - b) < 0.1))
          throw new Error(
            `KAIT's median on the current zero is ${a.toFixed(3)} m before the lift and ${b.toFixed(3)} m after`,
          );
      },
    },
    {
      id: "linz-sensor-off-values",
      stations: "every station",
      handling: "dropped",
      error:
        "LINZ's daily files write 0.001 m where a sensor was off, and 0.000 m appears in the year's files too, among rows marked missing. Wellington's file for 10 April 2025 reads 0.001 at 02:26 to 02:28 and 22:48 to 22:50, and the year's file for 2025 has the missing mark `//.///` for the same minutes.",
      response:
        "A 0.001 in a day's file and a 0.000 in any file are left out. A level of exactly zero is lost at a gauge whose tide crosses its zero, such as Sumner's, at most a minute a crossing.",
      evidence:
        "Wellington's daily and year's files for 10 April 2025, November 2026; 15 rows of 0.000 beside marked values at Fishing Rock and one at Wellington in 2025.",
      check: async (store) => {
        for (const [id, year] of [
          ["linz/WLGT", "2025"],
          ["linz/RFRT", "2025"],
        ] as const) {
          const obs = await levels(store, id, `${year}-01-01`, `${+year + 1}-01-01`);
          const off = obs.filter((o) => o.level === 0);
          if (off.length)
            throw new Error(`the store holds ${off.length} ${id} levels of 0.000 m in ${year}`);
        }
        // Daily files are read only for the year LINZ hasn't issued, where 0.001 stands in this day's file at 22:18 to 22:20.
        await levels(store, "linz/WLGT", "2026-01-12", "2026-01-13", 1000);
        await absent(store, "linz/WLGT", "2026-01-12T22:18", "2026-01-12T22:21");
      },
    },
    {
      id: "linz-wellington-drift",
      stations: ["linz/WLGT"],
      since: "2015-06-01",
      handling: "kept",
      error:
        "At Wellington both sensors' levels move against UHSLC's hourly Wellington by tenths of a metre. Sensor 40's monthly median offset swings seasonally between 1.94 and 2.37 m from June 2015 to February 2018 while sensor 41 holds 2.03 to 2.07 m, and in 2023 and 2024 it is sensor 41 that swings, from 1.16 to 1.82 m, while sensor 40 stays within 1.33 and 1.56 m. The zero steps down as well, by 0.26 m on 30 May 2012 and 0.38 m on 15 April 2021 (errata `linz-wellington-step-2012` and `linz-wellington-step-2021`).",
      response:
        "Kept as LINZ serves it, from sensor 40. Neither sensor holds against UHSLC throughout, so the store can't pick the better one and flags nothing. UHSLC's Wellington is the preferred series.",
      evidence:
        "Hourly values at the same instants for 2010 to 2024, compared with `uhslc/071`, monthly medians, November 2026.",
      check: async (store) => {
        const [a, b] = await Promise.all([
          levels(store, "linz/WLGT", "2016-01-01", "2017-01-01"),
          levels(store, "uhslc/071", "2016-01-01", "2017-01-01"),
        ]);
        const months = [...Map.groupBy(b, (o) => new Date(o.time).getUTCMonth()).values()].map(
          (m) => offset(a, m),
        );
        if (months.length < 12)
          throw new Error(`the store holds ${months.length} months of uhslc/071 in 2016`);
        const swing = Math.max(...months) - Math.min(...months);
        if (!(swing > 0.15))
          throw new Error(
            `WLGT's monthly offset from uhslc/071 moves only ${swing.toFixed(3)} m in 2016`,
          );
        const n = a.filter((o) => o.flag >= Flag.suspect).length;
        if (n > a.length / 100)
          throw new Error(`${n} of WLGT's ${a.length} levels in 2016 are flagged suspect`);
      },
    },
    {
      id: "linz-new-brighton-pier-high-values",
      stations: ["linz/NBRT"],
      since: "2025-02-08",
      until: "2025-12-07",
      handling: "kept",
      error:
        "Four stretches of New Brighton Pier's 2025 sensor 40 file, each 1,440 minutes from 23:54 UTC on 8 February, 19 May, 27 August and 5 December to 23:53 UTC on the next day, read 13.4 to 13.9 m (5,760 minutes in all), at a gauge whose other 2025 minutes run from 2.9 to 5.6 m. Sensor 41 has no value for those minutes, and from August 2024 it reads a constant 11.7 to 12.2 m on its own.",
      response: "Kept as LINZ serves it. QC flags all 5,760 minutes `suspect`.",
      evidence: "The 2025 sensor 40 and 41 files, and the stored 2025 file's flags, November 2026.",
      check: async (store, e) => {
        const high = (await levels(store, "linz/NBRT", e.since!, e.until!)).filter(
          (o) => o.level > 13,
        );
        if (!(high.length > 5000))
          throw new Error(
            `the store holds ${high.length} NBRT levels above 13 m in 2025, not 5,760`,
          );
        const n = high.filter((o) => o.flag < Flag.suspect).length;
        if (n) throw new Error(`${n} NBRT levels above 13 m in 2025 aren't flagged suspect`);
      },
    },
    {
      id: "linz-owenga-sensor-fault",
      stations: ["linz/CHIT"],
      since: "2008-11-25",
      until: "2010-02-17",
      handling: "corrected",
      error:
        'Sensor 40 at Owenga failed on 25 November 2008 (its file for that day has a range of 40 m; the README says "sensor 40 malfunctioning from November 26") and reads a constant -4.85 m until its replacement on 17 February 2010, whose file has only the last 41 minutes of that day. Sensor 41 reads a tide throughout.',
      response:
        "Sensor 41 is read from 25 November 2008 to before 17 February 2010. Over the 60 days before the failure sensor 41 agrees with sensor 40 within 0.02 m (median difference -0.013 m). Sensor 41 spikes from 11 to 13 February 2010 (erratum `linz-owenga-sensor-41-spikes`). In the six days after the replacement, 18 to 23 February 2010, sensor 41's daily median is 0.05 to 0.06 m above sensor 40's.",
      evidence:
        "The sensor 40 and 41 files for the years and the README's gauge history, November 2026.",
      check: async (store, e) => {
        const before = med(await levels(store, "linz/CHIT", "2008-09-26", e.since!));
        // A season apart, so held to the level before only within its swing.
        await tide(store, "linz/CHIT", "2009-01-01", "2010-02-01", before, { tolerance: 0.15 });
      },
    },
    {
      id: "linz-owenga-sensor-41-spikes",
      stations: ["linz/CHIT"],
      since: "2010-02-11",
      until: "2010-02-14",
      handling: "flagged",
      error:
        "Sensor 41 at Owenga, which the store reads in place of sensor 40 (erratum `linz-owenga-sensor-fault`), spikes from about 06:00 UTC on 11 February to 13 February 2010. It has 147 minutes above 5 m, up to 16.2 m, on the 11th, 106 above 5 m, up to 8.2 m, on the 12th and 4 above 5 m on the 13th, against daily medians of 3.1 to 3.5 m.",
      response:
        "The three days are flagged `suspect`, keeping the source's own flag as `source_flag`. As of November 2026, QC flags 494 of the 1,440 levels on the 11th, 636 on the 12th and 135 on the 13th, and leaves 35 levels on the 11th and 33 on the 12th above 4.5 m unflagged, up to 5.76 and 7.12 m, among spikes it flags. The days' other levels are flagged too, because spans are whole UTC days.",
      evidence: "The store's levels for 7 to 16 February 2010, November 2026.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const spikes = (await levels(store, "linz/CHIT", "2010-02-11", "2010-02-12")).filter(
          (o) => o.level > 5,
        );
        if (spikes.length < 100)
          throw new Error(
            `CHIT has ${spikes.length} levels above 5 m on 11 February 2010, under 100`,
          );
      },
    },
    {
      id: "linz-castlepoint-sensor-fault",
      stations: ["linz/CPIT"],
      since: "2012-01-29",
      until: "2012-03-31",
      handling: "corrected",
      error:
        "Sensor 40 at Castlepoint failed on 29 January 2012 and was replaced on 26 March, as the README says. From 30 January to 30 March its daily medians run from 1.8 to 3.7 m with daily ranges from 0.01 to 3.6 m, while sensor 41's run from 3.7 to 4.2 m.",
      response:
        "Sensor 41 is read from 29 January to before 31 March 2012. Its median level in the span is 3.82 m, against sensor 40's 3.73 m in the 60 days before and 3.79 m in the 60 days after.",
      evidence:
        "The sensor 40 and 41 files for the years and the README's gauge history, November 2026.",
      // Ends on 25 March: the levels from then to the gap on 27 March fall to 0.1 m, outside what this entry describes.
      check: (store) => tide(store, "linz/CPIT", "2012-01-30", "2012-03-25", 3.82),
    },
    {
      id: "linz-north-cape-sensor-fault",
      stations: ["linz/NCPT"],
      since: "2011-07-07",
      until: "2012-02-20",
      handling: "corrected",
      error:
        "Sensor 40 at North Cape malfunctioned from 10 July 2011 and was replaced on 6 October, as the README says, but it stays erratic until 19 February 2012: from 7 July to 21 September 2011 its daily medians run from -1.9 to 4.5 m and its daily ranges from 0.03 to 7.1 m, and from 6 October to 19 February from 0.4 to 4.3 m and 1.2 to 5.3 m. Over the same days sensor 41's medians stay between 3.9 and 4.4 m, with ranges of 1.2 to 2.5 m before 22 September.",
      response:
        "Sensor 41 is read from 7 July 2011 to before 22 September and from 6 October 2011 to before 20 February 2012, and neither sensor is read between (erratum `linz-north-cape-both-sensors-stuck`). Sensor 41's median level is 4.12 and 4.06 m in the two spans, against sensor 40's 4.34 m in the 60 days before and 4.04 m after the first, and 4.16 and 4.14 m around the second.",
      evidence:
        "The sensor 40 and 41 files for the years and the README's gauge history, November 2026.",
      check: async (store, e) => {
        // The store holds nothing from 01:20 UTC on 19 September to the stuck days.
        await tide(store, "linz/NCPT", e.since!, "2011-09-19", 4.12);
        await tide(store, "linz/NCPT", "2011-10-06", e.until!, 4.06);
      },
    },
    {
      id: "linz-sumner-sensor-fault",
      stations: ["linz/SUMT"],
      since: "2016-06-28",
      until: "2022-04-02",
      handling: "corrected",
      error:
        'Sensor 40 at Sumner was damaged on 28 or 29 June 2016, as the README says ("sensor 40 damaged from June 29"), and was never replaced before the site closed on 1 April 2022. Its daily range is 7.7 m on 28 June and 10.9 m on 29 June 2016. From 11 July to 31 December 2016 its daily medians run from -4.8 to -3.6 m with ranges up to 12.8 m, and it holds -4.79 m through 2017 and 2018 and +4.79 m from 1 January 2019 to 24 August 2020, after which it has no values; sensor 41 reads a tide throughout, with daily medians of 1.7 to 2.4 m, until the closure.',
      response:
        "Sensor 41 is read from 28 June 2016 to the closure. Before the failure it agrees with sensor 40 within 0.03 m (median difference 0.025 m over the 60 days before, with a daily standard deviation of 0.005 m). Against UHSLC's Lyttelton, 5.5 km away, sensor 40's monthly median offset was 0.4 to 0.5 m from March 2011 to May 2016, and sensor 41's is 0.42 to 0.53 m from June 2016 to December 2020, so sensor 41 holds the level. In the years LINZ serves only as daily files, 2021 and 2022, 63 of the 455 days (every seventh) give an offset of 0.45 to 0.53 m.",
      evidence:
        "The sensor 40 and 41 files for the years and UHSLC's Lyttelton (`uhslc/667a`) at the same hours, with the README's gauge history, November 2026.",
      check: async (store) => {
        const months = ["2016-07", "2017-01", "2018-06", "2019-06", "2020-12"];
        for (const m of months) {
          const [from, to] = [`${m}-01`, `${m}-28`];
          const o = offset(
            await levels(store, "linz/SUMT", from, to),
            await levels(store, "uhslc/667a", from, to, 24),
          );
          if (!(o > 0.4 && o < 0.55))
            throw new Error(`SUMT's offset from uhslc/667a in ${m} is ${o.toFixed(3)} m`);
        }
        await tide(store, "linz/SUMT", "2017-01-01", "2017-03-01", 2.0, { tolerance: 0.4 });
      },
    },
    {
      id: "linz-castlepoint-sensor-fault-2019",
      stations: ["linz/CPIT"],
      since: "2019-07-26",
      until: "2021-07-26",
      handling: "corrected",
      error:
        'Sensor 40 at Castlepoint reads a constant 4.85 m from 28 July 2019 (the README lists a "sensor 40 failure" in July 2019) until the sensors were replaced on 24 November 2021. Sensor 41 reads a tide until it failed on 26 July 2021, as the README says.',
      response:
        "Sensor 41 is read from 26 July 2019 to before 26 July 2021. Its median level in the span is 4.03 m, against sensor 40's 4.03 m in the 60 days before. LINZ lists no file for any day from 27 July to 22 November 2021, and both sensors fail on 26 July itself, which QC flags.",
      evidence:
        "The sensor 40 and 41 files for the years and the README's gauge history, November 2026.",
      check: async (store, e) => {
        await tide(store, "linz/CPIT", "2019-07-28", e.until!, 4.03);
        const n = (await levels(store, "linz/CPIT", e.until!, "2021-07-27")).filter(
          (o) => o.flag < Flag.suspect && Math.abs(o.level - 4.85) < 0.01,
        ).length;
        if (n) throw new Error(`${n} CPIT levels of 4.85 m on 26 July 2021 aren't flagged`);
      },
    },
    {
      id: "linz-north-cape-both-sensors-stuck",
      stations: ["linz/NCPT"],
      since: "2011-09-22",
      until: "2011-10-06",
      handling: "dropped",
      error:
        "Sensor 40 holds 4.84 m and sensor 41 4.81 m, each with a daily range of 0.00 to 0.04 m, from 22 September to 5 October 2011.",
      response: "Both sensors' values are left out for those days.",
      evidence:
        "The sensor 40 and 41 files for the years and the README's gauge history, November 2026.",
      check: (store, e) => absent(store, "linz/NCPT", e.since!, e.until!),
    },
    {
      id: "linz-north-cape-sensor-fault-2013",
      stations: ["linz/NCPT"],
      since: "2012-12-13",
      until: "2013-03-04",
      handling: "corrected",
      error:
        "Sensor 40 at North Cape is erratic again from 13 December 2012 to 3 March 2013: its daily medians run from 0.6 to 4.4 m and its daily ranges up to 5.2 m, against sensor 41's medians of 4.0 to 4.4 m and ranges of 1.2 to 2.5 m. The README lists nothing for these months.",
      response:
        "Sensor 41 is read from 13 December 2012 to before 4 March 2013. Its median level is 4.19 m, against sensor 40's 4.08 m in the 60 days before and 4.15 m after.",
      evidence:
        "The sensor 40 and 41 files for the years and the README's gauge history, November 2026.",
      check: (store, e) => tide(store, "linz/NCPT", e.since!, e.until!, 4.19),
    },
    {
      id: "linz-north-cape-sensor-fault-2014",
      stations: ["linz/NCPT"],
      since: "2013-11-17",
      until: "2014-01-23",
      handling: "corrected",
      error:
        "Sensor 40 at North Cape is erratic a third time, from 17 November 2013 to 22 January 2014: its daily medians run from 0.6 to 4.4 m and its daily ranges up to 5.2 m, against sensor 41's medians of 4.0 to 4.3 m and ranges of 1.4 to 2.5 m. The README lists routine maintenance on 23 January.",
      response:
        "Sensor 41 is read from 17 November 2013 to before 23 January 2014. Its median level is 4.13 m, against sensor 40's 3.99 m in the 60 days before and 4.17 m after.",
      evidence:
        "The sensor 40 and 41 files for the years and the README's gauge history, November 2026.",
      check: (store, e) => tide(store, "linz/NCPT", e.since!, e.until!, 4.13),
    },
    {
      id: "linz-auckland-sensor-fault",
      stations: ["linz/AUCT"],
      since: "2012-11-19",
      until: "2012-11-27",
      handling: "corrected",
      error:
        "Sensor 40 at Devonport is erratic from 19 to 26 November 2012, with daily ranges up to 6.1 m against sensor 41's 2.8 m. The README lists nothing for these days.",
      response:
        "Sensor 41 is read from 19 to before 27 November 2012. Its median level is 5.14 m, against sensor 40's 5.03 m in the 60 days before and 5.06 m after. From 11 July to 27 August 2012 sensor 40 is erratic too, and sensor 41's level is 5.61 m against 5.36 m before and 5.03 m after, which is 0.25 m or more from either side, so those values stay as LINZ serves them, for QC.",
      evidence:
        "The sensor 40 and 41 files for the years and the README's gauge history, November 2026.",
      check: (store, e) => tide(store, "linz/AUCT", e.since!, e.until!, 5.14),
    },
    {
      id: "linz-wellington-sensor-fault",
      stations: ["linz/WLGT"],
      since: "2014-12-23",
      until: "2015-01-10",
      handling: "corrected",
      error:
        "Sensor 40 at Wellington is erratic from 23 December 2014 to 9 January 2015: its daily medians run from 4.6 to 4.8 m with ranges up to 4.8 m, while sensor 41's are 3.1 to 3.2 m with ranges of 0.9 to 1.4 m. Its monthly offset from UHSLC's Wellington has a standard deviation of 0.77 m in December and 0.74 m in January, against 0.01 m in most months.",
      response:
        "Sensor 41 is read from 23 December 2014 to before 10 January 2015. Its median level is 3.12 m, against sensor 40's 3.19 m in the 60 days before and 3.20 m after.",
      evidence:
        "The sensor 40 and 41 files for the two years and UHSLC's Wellington (`uhslc/071`) at the same hours, November 2026.",
      check: (store, e) => tide(store, "linz/WLGT", e.since!, e.until!, 3.12),
    },
    {
      id: "linz-napier-sensor-fault",
      stations: ["linz/NAPT"],
      since: "2010-02-07",
      until: "2010-03-05",
      handling: "corrected",
      error:
        "Sensor 40 at Napier is erratic from 7 February to 4 March 2010: its daily medians run from 3.0 to 13.1 m and its daily ranges from 3.2 to 14.6 m, while sensor 41's are 2.8 to 3.0 m and 1.1 to 2.3 m. The README lists nothing for these days.",
      response:
        "Sensor 41 is read from 7 February to before 5 March 2010. Its median level is 2.91 m, against sensor 40's 2.72 m in the 60 days before and 2.74 m after.",
      evidence:
        "The sensor 40 and 41 files for the years and the README's gauge history, November 2026.",
      check: (store, e) => tide(store, "linz/NAPT", e.since!, e.until!, 2.91),
    },
    {
      id: "linz-napier-step-2008",
      stations: ["linz/NAPT"],
      since: "2007-09-20",
      until: "2008-02-25",
      handling: "corrected",
      error:
        "Napier's levels step down 0.344 m at 18:51 UTC on 24 February 2008, which is the 25 February of the README's \"step in data on February 25\", after a gap in the record. Against UHSLC's hourly Napier, sensor 40's median offset is 2.097 m from 1 to 24 February and 1.753 m from 26 February to 19 March; sensor 41 steps 0.36 m too.",
      response:
        "The levels before the step are converted to the later zero by -0.344 m, as an earlier epoch. Epochs start on a whole day, so the five hours after the step on 24 February are left out.",
      evidence:
        "The 2008 sensor 40 and 41 files and UHSLC's Napier (`uhslc/668a`) for the same hours, November 2026; the README's gauge history.",
      check: async (store, e) => {
        await stepCorrected(
          store,
          "linz/NAPT",
          "uhslc/668a",
          e.until!,
          ["2008-02-01", "2008-02-24T18:00"],
          ["2008-02-26", "2008-03-20"],
          -0.344,
        );
        await absent(store, "linz/NAPT", "2008-02-24T18:52", e.until!);
      },
    },
    {
      id: "linz-zero-steps",
      stations: "every station",
      since: null,
      until: null,
      handling: "kept",
      error:
        "A gauge's levels are measured from its sensors' own zero, which moves when sensors are replaced or calibrated, by amounts no README gives. Only Wellington, Napier, Port Chalmers, Tauranga and Gisborne have a UHSLC record to measure the steps against, and the steps both sensors share there are corrected (errata `linz-wellington-step-2012`, `linz-wellington-step-2021`, `linz-napier-step-2008`, `linz-port-chalmers-step-2021`, `linz-tauranga-step-2024`, `linz-gisborne-step-2013`, `linz-gisborne-step-2021`, `linz-gisborne-step-2024`). At Wellington in March 2018, Napier in April 2018 and Tauranga in June 2020, when the README lists sensors replaced, sensor 40 steps by -0.51, -0.56 and -0.28 m while sensor 41 steps by about -0.2 m or not at all, so the step is the replacement resetting sensor 40's drift, not the zero, and it stays. Korotiti Bay's step has no record to measure against (erratum `linz-korotiti-bay-step-2024`). At the other gauges a step is not measurable, so their levels are as LINZ serves them.",
      response:
        "Kept as LINZ serves it. A step changes the level of the whole record after it, so a series that spans one isn't continuous in height.",
      evidence:
        "Comparison of both sensors' monthly offsets against UHSLC's hourly records at the five gauges that have one, November 2026. The measured steps are good to the 0.01 to 0.08 m the offsets scatter by over 30 days.",
      check: async (store) => {
        await noEpochBetween(store, "linz/NAPT", "2018-01-01", "2019-01-01");
        const s = await step(
          store,
          "linz/NAPT",
          "uhslc/668a",
          ["2018-03-01", "2018-04-01"],
          ["2018-05-01", "2018-06-01"],
        );
        if (!(s < -0.3))
          throw new Error(
            `NAPT's offset from uhslc/668a moves ${s.toFixed(3)} m from March to May 2018`,
          );
      },
    },
    {
      id: "linz-korotiti-bay-sensors",
      stations: ["linz/GBIT", "gesla/korotiti_bay-gbit-nzl-ttw"],
      since: "2021-08-01",
      until: "2024-09-11",
      handling: "flagged",
      error:
        "Korotiti Bay's two sensors disagree from August 2021 until they were replaced on 11 September 2024. Sensor 40's monthly medians run from 6.1 to 6.8 m from August 2021 to April 2023, then 4.1 m in June 2023 and 8.3 to 14.7 m from July 2023 to August 2024 (with daily ranges beyond 6 m), while sensor 41's run from 5.3 to 6.3 m. Before the span both read 5.8 to 6.0 m, and from September 2024 both read 4.5 to 4.8 m. The README's chart datum, 4.43 m above TG0, is from the 2021 calibration, before sensors were replaced in 2023 and 2024, so the store does not publish it.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. Neither sensor is known to be right, so neither is read as a replacement.",
      evidence:
        "The 2021 to 2024 sensor 40 and 41 files, monthly medians, November 2026; the README's gauge history and calibration. GESLA's copy (`gesla/korotiti_bay-gbit-nzl-ttw`) holds the same values at all 2,795 times the two share, on 119 of the 150 days read in five 30-day pieces spread over the span's 1,137.",
      check: async (store, e) => {
        await flaggedSpan(store, e, ["linz/GBIT"]);
        // The new sensors' zero sits below the one before the span (`linz-korotiti-bay-step-2024`), so GESLA's datum-jump rule (`gesla-datum-jumps`) flags the copy's values from the day the span ends, which isn't judged as spill from the span.
        const gesla = "gesla/korotiti_bay-gbit-nzl-ttw";
        await flaggedSpan(store, e, [gesla], { untilDay: false });
        const after = await store.levels(gesla, e.until!, dayAfter(e.until!, 1));
        if (!after.length || after.some((o) => o.flag < Flag.suspect))
          throw new Error(
            `${gesla}'s levels on ${e.until} aren't all suspect, as the datum-jump rule flags them`,
          );
        const s = await store.station("linz/GBIT");
        if (s?.datums && "CD" in s.datums)
          throw new Error("the store publishes GBIT's chart datum");
      },
    },
    {
      id: "linz-wellington-step-2012",
      stations: ["linz/WLGT"],
      since: null,
      until: "2012-05-30",
      handling: "corrected",
      error:
        "Wellington's zero steps down on 30 May 2012, when the README lists sensors replaced: sensor 40's median offset from UHSLC's Wellington is 2.271 m over the 30 days before and 2.007 m after (0.264 m), and sensor 41's 2.256 and 2.040 m (0.216 m).",
      response:
        "Levels before 30 May 2012 are converted to the later zero by -0.26 m, as an earlier epoch. The step falls in an hour's gap between 22:54 UTC on the 29th and 00:02 on the 30th, so no minute is left out.",
      evidence:
        "UHSLC's hourly Wellington (`uhslc/071`) at the same instants, the medians of both sensors' offsets over the 30 days either side, November 2026; the README's gauge history.",
      check: (store, e) =>
        stepCorrected(
          store,
          "linz/WLGT",
          "uhslc/071",
          e.until!,
          ["2012-04-30", "2012-05-29T22:00"],
          ["2012-05-30", "2012-06-29"],
          -0.26,
        ),
    },
    {
      id: "linz-wellington-step-2021",
      stations: ["linz/WLGT"],
      since: null,
      until: "2021-04-16",
      handling: "corrected",
      error:
        "Wellington's zero steps down on 15 April 2021, after a gap from 20:25 to 21:56 UTC, and the README lists no work then: sensor 40's median offset from UHSLC's Wellington is 1.860 m over the 30 days before and 1.483 m after (0.377 m), and sensor 41's 1.927 and 1.541 m (0.386 m).",
      response:
        "Levels before 16 April 2021 are converted to the later zero by -0.38 m, as an earlier epoch. Epochs start on a whole day, so the 2 hours from 21:56 UTC on 15 April are left out.",
      evidence:
        "UHSLC's hourly Wellington (`uhslc/071`) at the same instants, the medians of both sensors' offsets over the 30 days either side, November 2026; the README's gauge history.",
      check: async (store, e) => {
        await stepCorrected(
          store,
          "linz/WLGT",
          "uhslc/071",
          e.until!,
          ["2021-03-16", "2021-04-15T20:00"],
          ["2021-04-16", "2021-05-16"],
          -0.38,
        );
        await absent(store, "linz/WLGT", "2021-04-15T21:56", e.until!);
      },
    },
    {
      id: "linz-port-chalmers-step-2021",
      stations: ["linz/OTAT"],
      since: null,
      until: "2021-05-26",
      handling: "corrected",
      error:
        "Port Chalmers' zero steps down on 26 May 2021, when the README lists sensors replaced: sensor 40's median offset from UHSLC's Port Chalmers is 3.483 m over the 30 days before (daily standard deviation 0.084 m) and 2.923 m after (0.560 m), and sensor 41's 3.439 and 2.891 m (0.548 m).",
      response:
        "Levels before 26 May 2021 are converted to the later zero by -0.56 m, as an earlier epoch. The step falls in the gap between 23:40 UTC on the 25th and about 03:00 on the 26th, so no minute is left out.",
      evidence:
        "UHSLC's hourly Port Chalmers (`uhslc/669a`) at the same instants, the medians of both sensors' offsets over the 30 days either side, November 2026; the README's gauge history.",
      check: (store, e) =>
        stepCorrected(
          store,
          "linz/OTAT",
          "uhslc/669a",
          e.until!,
          ["2021-04-25", "2021-05-25T23:00"],
          ["2021-05-26T03:00", "2021-06-25"],
          -0.56,
        ),
    },
    {
      id: "linz-tauranga-step-2024",
      stations: ["linz/TAUT"],
      since: null,
      until: "2024-03-21",
      handling: "corrected",
      error:
        "Tauranga's zero steps down on 20 March 2024, after a gap from 22:17 to 23:17 UTC, and the README lists nothing for 2024: sensor 40's median offset from UHSLC's Tauranga is 3.807 m over the 30 days before and 3.336 m after (0.471 m), and sensor 41's 3.783 and 3.298 m (0.485 m).",
      response:
        "Levels before 21 March 2024 are converted to the later zero by -0.47 m, as an earlier epoch. Epochs start on a whole day, so the 43 minutes from 23:17 UTC on 20 March are left out.",
      evidence:
        "UHSLC's hourly Tauranga (`uhslc/073a`) at the same instants, the medians of both sensors' offsets over the 30 days either side, November 2026; the README's gauge history.",
      check: async (store, e) => {
        await stepCorrected(
          store,
          "linz/TAUT",
          "uhslc/073a",
          e.until!,
          ["2024-02-19", "2024-03-20T22:00"],
          ["2024-03-21", "2024-04-20"],
          -0.47,
        );
        await absent(store, "linz/TAUT", "2024-03-20T23:17", e.until!);
      },
    },
    {
      id: "linz-korotiti-bay-step-2024",
      stations: ["linz/GBIT"],
      since: null,
      until: "2024-09-10",
      handling: "kept",
      error:
        "Korotiti Bay's zero steps down on 10 September 2024, when the README lists sensors replaced on the 11th (NZ time): both sensors read 4.6 to 5.0 m from 21:39 UTC, when the file for the day begins after a gap, against 5.2 m on the 9th, and 4.4 to 4.5 m from the 11th. No other record of the gauge exists to measure the step against.",
      response:
        "Values from 10 September 2024 are in a later epoch, and the earlier epoch has no `to_current`, so the API doesn't convert across the step.",
      evidence: "The 2024 sensor 40 and 41 files, November 2026; the README's gauge history.",
      check: async (store, e) => {
        const { before } = await epochFrom(store, "linz/GBIT", e.until!);
        if (before.to_current != null)
          throw new Error(
            `GBIT's epoch before 10 September 2024 has a to_current of ${before.to_current}`,
          );
        const m = med(await levels(store, "linz/GBIT", "2024-09-11", "2024-09-21"));
        if (!(m > 4.3 && m < 5))
          throw new Error(`GBIT's median from 11 to 20 September 2024 is ${m.toFixed(3)} m`);
      },
    },
    {
      id: "linz-devonport-sensor-fault-2012",
      stations: ["linz/AUCT", "gesla/auckland-auct-nzl-ttw"],
      since: "2012-07-11",
      until: "2012-08-28",
      handling: "flagged",
      error:
        "Sensor 40 at Devonport is erratic from 11 July to 27 August 2012: its daily medians run from 1.2 to 5.1 m and its daily ranges up to 5.8 m, while sensor 41's medians are 5.4 to 6.0 m with ranges of 1.8 to 3.0 m. The README lists sensors replaced on 28 August.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. Sensor 41 isn't read for it: its level there is more than 0.25 m from sensor 40's healthy levels on at least one side, or its own. Sensor 41's median level is 5.61 m, against sensor 40's 5.36 m in the 60 days before and 5.03 m after.",
      evidence:
        "The sensor 40 and 41 files for the years, November 2026. GESLA's copy (`gesla/auckland-auct-nzl-ttw`) holds the same values at all 1,152 times the two share, on all 48 days of the span.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "linz-boat-cove-sensor-fault-2013",
      stations: ["linz/RBCT", "gesla/boat_cove-rbct-nzl-ttw"],
      since: "2013-07-16",
      until: "2013-11-12",
      handling: "flagged",
      error:
        "Sensor 40 at Boat Cove is erratic from 16 July to 11 November 2013: its daily medians run from 2.8 to 4.9 m and its daily ranges up to 11.7 m, and it is stuck on some days. Sensor 41's own range is 0.0 to 5.5 m, so it is stuck or erratic on some days too.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. Sensor 41 isn't read for it: its level there is more than 0.25 m from sensor 40's healthy levels on at least one side, or its own.",
      evidence:
        "The sensor 40 and 41 files for the years, November 2026. GESLA's copy (`gesla/boat_cove-rbct-nzl-ttw`) holds the same values at all 2,842 times the two share, on all 119 days of the span.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "linz-boat-cove-sensor-fault-2014",
      stations: ["linz/RBCT"],
      since: "2014-08-23",
      until: "2015-02-27",
      handling: "flagged",
      error:
        "Sensor 40 at Boat Cove fails at about 12:00 UTC on 23 August 2014 and stays bad until about 22:00 UTC on 26 February 2015. It reads 34.5 to 34.8 m from 23 to 25 August, 4.1 to 4.4 m on 26 August, 0.0 to 4.7 m from 27 August to 5 September and daily medians of 33.4 to 33.7 m from 6 September to 2 October, then a constant 4.85 m to 31 December, -4.85 m from 1 January and -4.24 m from 25 February. Sensor 41 reads 0.0 to 35.9 m from 23 August to 14 September, a tide with daily medians of 4.0 to 4.4 m from 15 September to 2 October, and then the same constant 4.85 and -4.85 m as sensor 40 until 24 February, and -4.1 m on 25 and 26 February. Both read a tide again from about 22:00 UTC on 26 February.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. Sensor 41 isn't read for it: it is stuck or erratic except from 15 September to 2 October, and its level there is more than 0.25 m from sensor 40's daily medians of 5.8 to 6.0 m before and after. The span's first and last days are whole UTC days, so the 12 hours before the fault on 23 August and the 2 hours after it on 26 February, which read normally, are flagged too.",
      evidence: "The sensor 40 and 41 files for 2014 and 2015, November 2026.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "linz-fishing-rock-sensor-fault",
      stations: ["linz/RFRT"],
      since: "2016-12-22",
      until: "2017-03-27",
      handling: "flagged",
      error:
        "Sensor 40 at Fishing Rock reads daily medians of -4.84 to -4.83 m, with ranges up to 9.3 m, from 22 December 2016 to 02:00 UTC on 26 March 2017, while sensor 41's medians are 3.4 to 4.0 m with ranges of 0.8 to 1.6 m until it sticks at -4.85 m on 25 March. Both read a tide again from 02:00 UTC on 26 March.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. Sensor 41 isn't read for it: its level there is more than 0.25 m from sensor 40's healthy levels on at least one side, or its own. Before it sticks on 25 March, sensor 41's median level is 3.65 m, against sensor 40's 3.16 m in the 60 days before and 3.58 m after. The span's last day is a whole UTC day, so the 22 hours of 26 March after 02:00 UTC, which read normally, are flagged too.",
      evidence: "The sensor 40 and 41 files for the years, November 2026.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "linz-napier-sensor-fault-2010-12",
      stations: ["linz/NAPT", "gesla/napier-napt-nzl-ttw"],
      since: "2010-12-07",
      until: "2010-12-15",
      handling: "flagged",
      error:
        "Sensor 40 at Napier is erratic from 7 to 14 December 2010: its daily medians run from 2.7 to 27.9 m and its daily ranges up to 30 m, while sensor 41's medians are 3.0 to 3.1 m. The README lists sensors replaced on 15 December.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. Sensor 41 isn't read for it: its level there is more than 0.25 m from sensor 40's healthy levels on at least one side, or its own. Sensor 41's median level is 3.07 m, against sensor 40's 2.70 m in the 60 days before and 2.76 m after.",
      evidence:
        "The sensor 40 and 41 files for the years, November 2026. GESLA's copy (`gesla/napier-napt-nzl-ttw`) holds the same values at all 109 times the two share, on all 8 days of the span.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "linz-gisborne-step-2013",
      stations: ["linz/GIST"],
      since: null,
      until: "2013-09-26",
      handling: "corrected",
      error:
        "Gisborne's zero steps down on 25 or 26 September 2013, in a gap in the record from 20:48 UTC to 03:23, and the README lists nothing then: sensor 40's median offset from UHSLC's Gisborne is 3.304 m over the 30 days before and 2.730 m after (0.574 m), and sensor 41's 3.392 and 2.736 m (0.656 m).",
      response:
        "Levels before 26 September 2013 are converted to the later zero by -0.57 m, as an earlier epoch. The step falls in the gap, so no minute is left out.",
      evidence:
        "UHSLC's hourly Gisborne (`uhslc/078b`) at the same instants, the medians of both sensors' offsets over the 30 days either side, November 2026; the README's gauge history.",
      check: (store, e) =>
        stepCorrected(
          store,
          "linz/GIST",
          "uhslc/078b",
          e.until!,
          ["2013-08-26", "2013-09-25T20:00"],
          ["2013-09-26T04:00", "2013-10-26"],
          -0.57,
        ),
    },
    {
      id: "linz-gisborne-step-2021",
      stations: ["linz/GIST"],
      since: null,
      until: "2021-05-12",
      handling: "corrected",
      error:
        "Gisborne's zero steps down on 11 or 12 May 2021, after a gap from 23:07 to 23:56 UTC, and the README lists nothing then: sensor 40's median offset from UHSLC's Gisborne is 2.721 m over the 30 days before and 2.308 m after (0.413 m), and sensor 41's 2.804 and 2.417 m (0.387 m).",
      response:
        "Levels before 12 May 2021 are converted to the later zero by -0.41 m, as an earlier epoch. Epochs start on a whole day, so the 4 minutes from 23:56 UTC on 11 May are left out.",
      evidence:
        "UHSLC's hourly Gisborne (`uhslc/078b`) at the same instants, the medians of both sensors' offsets over the 30 days either side, November 2026; the README's gauge history.",
      check: async (store, e) => {
        await stepCorrected(
          store,
          "linz/GIST",
          "uhslc/078b",
          e.until!,
          ["2021-04-11", "2021-05-11T23:00"],
          ["2021-05-12", "2021-06-11"],
          -0.41,
        );
        await absent(store, "linz/GIST", "2021-05-11T23:56", e.until!);
      },
    },
    {
      id: "linz-gisborne-step-2024",
      stations: ["linz/GIST"],
      since: null,
      until: "2024-12-13",
      handling: "corrected",
      error:
        "Gisborne's zero steps down on 12 or 13 December 2024, with no file for the 12th, when the README lists sensors replaced in 2024: sensor 40's median offset from UHSLC's Gisborne is 2.323 m over the 30 days before and 1.781 m after (0.542 m), and sensor 41's 2.368 and 1.826 m (0.542 m).",
      response:
        "Levels before 13 December 2024 are converted to the later zero by -0.54 m, as an earlier epoch. The step falls in the gap before the file for the 13th, so no minute is left out.",
      evidence:
        "UHSLC's hourly Gisborne (`uhslc/078b`) at the same instants, the medians of both sensors' offsets over the 30 days either side, November 2026; the README's gauge history.",
      check: (store, e) =>
        stepCorrected(
          store,
          "linz/GIST",
          "uhslc/078b",
          e.until!,
          ["2024-11-11", "2024-12-12"],
          ["2024-12-13", "2025-01-12"],
          -0.54,
        ),
    },
    {
      id: "linz-antarctic-formats",
      stations: ["linz/ROBT", "linz/SCOT"],
      since: null,
      until: null,
      handling: "corrected",
      error:
        "The READMEs of Cape Roberts and Scott Base describe the files' layouts wrongly or leave some out. Cape Roberts' README lists three layouts and none for 2010, whose rows carry ten fields, or for 2022, which uses the Julian-day layout; 2007's daily files hold `ROBT,2007-11-08 00:05,6.117`. Scott Base's README gives `SCOT,2016-01-05 15:50,1.881` and a layout with separate date and time for 2024 and 2025, but its 2016 to 2022 files hold `SCOT,20160105,15:50:00,1.881`, its 2023 file `2023-01-01,00:00:00,2.504` in meters, its 2024 and 2026 files the same layout in millimeters, and its 2025 file `1/01/2025,00:00:00,3162` in millimeters with the day first (31/12/2025 is its last row). Scott Base's 2026 file is `SCOT_00_2026_01-03.zip`, January to March, since the gauge was removed on 5 March.",
      response:
        "Each row is read by the layout it holds and accepted only where the fields that give its time and level are where that layout puts them. Scott Base's levels are millimeters from labels of 1 January 2024 on and meters before, where its levels stay near 2.4 m across the change (2.398 at 23:59 on 31 December 2023 and 2.400 at 00:00 on 1 January 2024) and their tide matches Cape Roberts' in amplitude and phase.",
      evidence:
        "Every row of every file: 72 of 72 Cape Roberts files (18 yearly files for 2008 to 2025 and 54 daily files for 8 November to 31 December 2007) and 11 of 11 Scott Base files (yearly files for 2016 to 2025 and the 2026 file), November 2026; tide fits of each year against Cape Roberts' and UHSLC's Scott Base (erratum `linz-scott-base-clock`).",
      check: async (store) => {
        const spans: [string, string, string][] = [
          ["linz/ROBT", "2007-11-08", "2007-11-09"],
          ["linz/ROBT", "2010-12-01", "2010-12-02"],
          ["linz/ROBT", "2022-06-01", "2022-06-02"],
          // Each UTC day of Scott Base's within one file's labels: a level left in millimeters
          // is dropped as 5 m or more, and 13 January read month first isn't a date.
          ["linz/SCOT", "2016-03-30", "2016-03-31"],
          ["linz/SCOT", "2023-01-01", "2023-01-02"],
          ["linz/SCOT", "2024-01-01", "2024-01-02"],
          ["linz/SCOT", "2025-01-13", "2025-01-14"],
          ["linz/SCOT", "2026-01-01", "2026-01-02"],
        ];
        for (const [id, from, to] of spans) {
          const m = med(await levels(store, id, from, to));
          if (!(m > 1 && m < 8)) throw new Error(`${id}'s median from ${from} to ${to} is ${m} m`);
        }
      },
    },
    {
      id: "linz-antarctic-file-rows",
      stations: ["linz/ROBT", "linz/SCOT"],
      since: null,
      until: null,
      handling: "dropped",
      error:
        "The Antarctic files hold rows that aren't levels or are cut. Missing levels are `-6999.000` in Cape Roberts' 2008 to 2010 files and `6999` or `-6999` with empty fields in 2011's (95,310 rows). Cape Roberts' 2024 file has 383 rows with a field missing or two joined (`2024,0,30,6.252,-2.681,976.63` has no day, and the 287 like it would read as a level of -2.7 m; `2024,11,1715,26,6.-3.368,979.01` has no level), and its 2023 file has three empty rows. Scott Base's 2023 file has 12,960 rows for 1 to 9 December whose dates and times a spreadsheet has mangled (`1/12/2023  1,02:00:00,2.573`, with the hour in the date and `:59:00 am` for a time). Rows repeat in both gauges: Cape Roberts' 31 December 2021 (285 rows), 10 to 15 September 2023 (1,728 rows) and 1 January 2022 (3 rows), and Scott Base's 24 and 25 January 2017 (499 rows) and 10 and 11 August 2020 (244 rows), with the same level each time, and five minutes where two levels disagree (Cape Roberts on 12 April 2008, 22 June 2009, 21 October 2011 and 3 August 2023, 0.001 to 0.01 m apart, and Scott Base on 5 July 2023 at 16:13 NZST, 0.004 m apart). Scott Base reads 0.000 for 11,382 rows.",
      response:
        "A row that isn't a level is left out, as are a level of 0.000 and any level of 20 m or more at Cape Roberts or 5 m or more at Scott Base, which never reads above 3.5 m outside its failures. A minute that repeats with the same level is kept once, and where its levels disagree neither is kept. The mangled December 2023 rows are left out: their minutes can't be told from the rows around them, though 9 days of 1,440 rows run on from one valid level to the next.",
      evidence: "Every row of the 72 and 11 files, counted by layout, November 2026.",
      check: async (store) => {
        for (const [id, max, years] of [
          ["linz/ROBT", 20, [2008, 2011, 2021, 2023, 2024]],
          ["linz/SCOT", 5, [2017, 2020, 2023]],
        ] as const)
          for (const y of years) {
            const obs = await levels(store, id, `${y}-01-01`, `${y + 1}-01-01`);
            const bad = obs.filter(
              (o) => o.level === 0 || o.level >= max || (id === "linz/ROBT" && o.level < 0),
            );
            if (bad.length)
              throw new Error(
                `the store holds ${bad.length} ${id} levels in ${y} that aren't levels, such as ${bad[0]!.level}`,
              );
            const repeats = obs.length - new Set(obs.map((o) => o.time)).size;
            if (repeats) throw new Error(`${repeats} of ${id}'s minutes in ${y} repeat`);
          }
        await absent(store, "linz/SCOT", "2023-11-30T11:00", "2023-12-09T11:00");
      },
    },
    {
      id: "linz-scott-base-clock",
      stations: ["linz/SCOT"],
      since: null,
      until: null,
      handling: "corrected",
      error:
        "Scott Base's README gives the time system NZST for its first layout and none for the rest. Its labels are NZST, UTC+12 and without daylight saving, in every file but one stretch: from the reinstalled logger on 25 November 2023 to the end of October 2024 they are UTC+13, and from November 2024 UTC+12 again. The README says nothing of it. The labels run on without a break across the change, so the day it happened can't be read from the file, and the fit of the tide moves from UTC+13 on 28 October to UTC+12 on 1 November.",
      response:
        "Labels are read as UTC+12, except as UTC+13 from 25 November 2023 to 29 October 2024, and the labels from 29 to 31 October 2024 are left out.",
      evidence:
        "Against UHSLC's hourly Scott Base (`uhslc/663a`) in 2016 and 2017, a one-hour centered mean of the five-minute levels fits at a lag of exactly 12.00 hours every month (r 0.9999, residual 2.5 mm). From 2016 to 2026 the phases of K1, O1, M2 and S2 in each period, Cape Roberts' (UTC) less Scott Base's, are 8, 8, 12 and 17 degrees at UTC+12, and 9, 9, 12 and 19 degrees at UTC+13 from December 2023 to October 2024, where UTC+12 gives -7, -5, -19 and -11; a whole hour is 15, 14, 29 and 30 degrees. Daily fits of the tide against the prediction from UHSLC's record change over between 28 October and 1 November 2024. Cape Roberts' labels, the reference for these phases, are UTC: its phases of K1, O1, M2 and S2 in each half-year from 2008 to 2025 are within 7 degrees of UHSLC's Scott Base in the 9 half-years the two share, and the other half-years continue their neighbors' phases to within 7 degrees. November 2026.",
      check: async (store) => {
        const lag = async (from: string, to: string) => {
          const robt = await levels(store, "linz/ROBT", from, to);
          const scot = new Map(
            (await levels(store, "linz/SCOT", from, to)).map((o) => [o.time, o.level]),
          );
          let best = { lag: NaN, r: -1 };
          for (let min = -120; min <= 120; min += 5) {
            const pairs = robt.flatMap((o) => {
              const y = scot.get(o.time + min * 60_000);
              return y === undefined ? [] : [[o.level, y] as const];
            });
            if (pairs.length < 1000) continue;
            const mx = pairs.reduce((s, [x]) => s + x, 0) / pairs.length;
            const my = pairs.reduce((s, [, y]) => s + y, 0) / pairs.length;
            let [sxy, sxx, syy] = [0, 0, 0];
            for (const [x, y] of pairs) {
              sxy += (x - mx) * (y - my);
              sxx += (x - mx) ** 2;
              syy += (y - my) ** 2;
            }
            const r = sxy / Math.sqrt(sxx * syy);
            if (r > best.r) best = { lag: min, r };
          }
          if (Number.isNaN(best.lag))
            throw new Error(`SCOT and ROBT share no levels from ${from} to ${to}`);
          return best.lag;
        };
        const before = await lag("2017-03-01", "2017-04-01");
        for (const [from, to] of [
          ["2024-03-01", "2024-04-01"],
          ["2025-01-01", "2025-02-01"],
        ] as const) {
          const l = await lag(from, to);
          if (Math.abs(l - before) > 20)
            throw new Error(
              `SCOT lags ROBT by ${l} minutes from ${from} to ${to}, against ${before} in March 2017`,
            );
        }
        await absent(store, "linz/SCOT", "2024-10-28T11:00", "2024-10-31T12:00");
      },
    },
    {
      id: "linz-cape-roberts-unreliable-2009",
      stations: ["linz/ROBT"],
      since: "2009-08-29",
      until: "2009-12-09",
      handling: "flagged",
      error:
        "LINZ's README marks Cape Roberts' levels from 29 August to 7 December 2009 \"DATA UNRELIABLE\": its sensor malfunctioned in late August, and a new one installed on 4 December failed 4 days later. The levels climb from 6.2 m in the first days of the span to 8.6 m by late November, 2.4 m up, with no change in the tide; those from 3:05 UTC on 4 December are 0.4 to 1.5 m.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The levels from 3:05 UTC on 4 December aren't kept (erratum `linz-cape-roberts-new-sensor-2009`).",
      evidence: "Daily medians of the 2009 file, November 2026; the README's gauge history.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const rise =
          med(await levels(store, "linz/ROBT", "2009-11-20", "2009-12-01")) -
          med(await levels(store, "linz/ROBT", "2009-08-01", dayAfter(e.since!, -1)));
        if (!(rise > 1.5))
          throw new Error(`ROBT's levels rise ${rise.toFixed(3)} m from August to November 2009`);
      },
    },
    {
      id: "linz-cape-roberts-new-sensor-2009",
      stations: ["linz/ROBT"],
      since: "2009-12-04",
      until: "2010-01-01",
      handling: "dropped",
      error:
        "From 3:05 UTC on 4 December 2009, when the README says a new sensor was installed and failed 4 days later, Cape Roberts' levels are 0.4 to 1.5 m, against 8.6 m in the days before and 6.2 m before the sensor malfunctioned.",
      response: "Levels from 03:00 UTC on 4 December 2009 to the end of the year aren't kept.",
      evidence: "The 2009 file, November 2026; the README's gauge history.",
      check: (store, e) => absent(store, "linz/ROBT", `${e.since}T03:00`, e.until!),
    },
    {
      id: "linz-cape-roberts-step-2010",
      stations: ["linz/ROBT"],
      since: null,
      until: "2010-11-05",
      handling: "kept",
      error:
        "Cape Roberts' gauge was re-established on 5 November 2010 (the README says early November) and reads about 0.25 m lower than before 2009: the median of its levels is 6.2 m from January to August 2009 and 5.9 to 6.0 m from November 2010 on. UHSLC's Scott Base has no values for 2007 to 2009, so no record measures the step.",
      response:
        "Values from 5 November 2010 are in a later epoch, and the earlier epoch has no `to_current`, so the API doesn't convert across the step.",
      evidence:
        "Medians of the 2008 to 2010 files, and of Cape Roberts' hourly levels less UHSLC's Scott Base, which stay between 3.96 and 4.06 m from November 2010 to June 2017, November 2026; the README's gauge history and its table of the zero below benchmark B93M (8.234 m in November 2008, 7.993 m in November 2011).",
      check: async (store, e) => {
        const { before } = await epochFrom(store, "linz/ROBT", e.until!);
        if (before.to_current != null)
          throw new Error(
            `ROBT's epoch before 5 November 2010 has a to_current of ${before.to_current}`,
          );
        const d =
          med(await levels(store, "linz/ROBT", "2009-01-01", "2009-08-29")) -
          med(await levels(store, "linz/ROBT", e.until!, "2011-01-01"));
        if (!(d > 0.1 && d < 0.4))
          throw new Error(`ROBT's levels fall ${d.toFixed(3)} m from 2009 to November 2010`);
      },
    },
    {
      id: "linz-cape-roberts-step-2019",
      stations: ["linz/ROBT"],
      since: "2019-02-03",
      until: "2019-02-04",
      handling: "dropped",
      error:
        "Cape Roberts' levels step up 1.2 m at 03:07 UTC on 3 February 2019, from about 5.9 to 7.1 m, and the README lists nothing for 2019 but a calibration. Against Scott Base's, which was working, the difference steps from 3.891 m over the ten days before to 5.121 m over the ten days after (1.230 m); the step across the minutes of the jump is 1.17 to 1.29 m depending on the window. The README's table puts the zero 1.319 m lower in October 2019 than in November 2018 (erratum `linz-cape-roberts-calibration-2019`).",
      response:
        "Levels from 03:00 UTC on 3 February 2019 to the end of that day aren't kept, since an epoch starts on a whole day, and values from 4 February are in a later epoch. The earlier epoch has no `to_current`: a `to_current` is to the current zero, and Cape Roberts' failure and re-establishment in 2021 left no record to measure that step against (erratum `linz-cape-roberts-step-2021`).",
      evidence:
        "Cape Roberts' 2019 file and Scott Base's (UTC+12 labels) at the same hours, the medians of the differences over the 10 days either side, November 2026; the README's table of the zero below B93M.",
      check: async (store, e) => {
        await absent(store, "linz/ROBT", `${e.since}T03:00`, e.until!);
        const { before } = await epochFrom(store, "linz/ROBT", e.until!);
        if (before.to_current != null)
          throw new Error(
            `ROBT's epoch before 4 February 2019 has a to_current of ${before.to_current}`,
          );
        const d =
          med(await levels(store, "linz/ROBT", e.until!, "2019-02-14")) -
          med(await levels(store, "linz/ROBT", "2019-01-24", e.since!));
        if (!(Math.abs(d - 1.2) < 0.3))
          throw new Error(`ROBT's levels step ${d.toFixed(3)} m on 3 February 2019`);
      },
    },
    {
      id: "linz-cape-roberts-calibration-2019",
      stations: ["linz/ROBT"],
      since: null,
      until: null,
      handling: "kept",
      error:
        "Cape Roberts' README lists the zero of the gauge 9.534 m below benchmark B93M at the calibration of October 2019, marked \"unreliable\", against 8.215 m in November 2018 and 7.766 m in November 2021. The levels step up 1.2 m on 3 February 2019 and stay on that zero until the gauge failed in March 2021, which fits the table's change of 1.319 m and doesn't show a calibration of a different zero.",
      response:
        "No levels are flagged for the calibration, since the data hold no span that marks it; the README's value isn't used for any conversion.",
      evidence:
        "Cape Roberts' daily medians from February 2019 to March 2021, November 2026; the README's table.",
      check: async (store) => {
        await noEpochBetween(store, "linz/ROBT", "2019-02-04", "2021-11-06");
        const oct = await levels(store, "linz/ROBT", "2019-10-01", "2019-11-01");
        const n = oct.filter((o) => o.flag >= Flag.suspect).length;
        if (n > oct.length / 100)
          throw new Error(`${n} of ROBT's levels in October 2019 are flagged suspect`);
        const d = med(oct) - med(await levels(store, "linz/ROBT", "2019-03-01", "2019-04-01"));
        if (!(Math.abs(d) < 0.3))
          throw new Error(`ROBT's median moves ${d.toFixed(3)} m from March to October 2019`);
      },
    },
    {
      id: "linz-cape-roberts-step-2021",
      stations: ["linz/ROBT"],
      since: null,
      until: "2021-11-06",
      handling: "kept",
      error:
        "Cape Roberts' levels step down about 1.7 m between its failure on 16 March 2021 and its re-establishment on 6 November: from about 7.5 m to 5.7 m. Scott Base's gauge failed and was re-established in the same months (erratum `linz-scott-base-step-2021`), so the two gauges' difference, which steps from 5.403 m to 3.546 m (1.857 m), shows only the two steps together. The README's tables put Cape Roberts' zero 1.768 m higher in November 2021 than in October 2019 and Scott Base's 0.124 m lower than in November 2020, which adds to 1.892 m.",
      response:
        "Values from 6 November 2021 are in a later epoch, and the earlier epoch has no `to_current`.",
      evidence:
        "The medians of both gauges' hourly differences over the 4 weeks before 5 February and the 5 weeks from 25 November, November 2026; the README tables of both gauges.",
      check: async (store, e) => {
        const { before } = await epochFrom(store, "linz/ROBT", e.until!);
        if (before.to_current != null)
          throw new Error(
            `ROBT's epoch before 6 November 2021 has a to_current of ${before.to_current}`,
          );
        const d =
          med(await levels(store, "linz/ROBT", "2021-02-15", "2021-03-15")) -
          med(await levels(store, "linz/ROBT", "2021-11-10", "2021-12-10"));
        if (!(Math.abs(d - 1.75) < 0.3))
          throw new Error(`ROBT's levels fall ${d.toFixed(3)} m across 2021`);
      },
    },
    {
      id: "linz-cape-roberts-failed-2021",
      stations: ["linz/ROBT"],
      since: "2021-03-16",
      until: "2021-11-07",
      handling: "dropped",
      error:
        "Cape Roberts' gauge failed on 16 March 2021 (the README says so) and was re-established on 6 November. Its file still has a row for every five minutes: from 21:55 UTC on 16 March the levels are 20 to 23 m and then, from April to November, run from -9 to 35 m with daily medians that jump by up to 5 m, until 03:00 UTC on 6 November, when they read 4.6 m and settle over three hours to a tide around 5.9 m.",
      response: "Levels from 21:00 UTC on 16 March to 06:00 UTC on 6 November 2021 aren't kept.",
      evidence: "The 2021 file, November 2026; the README's gauge history.",
      check: (store, e) => absent(store, "linz/ROBT", `${e.since}T21:00`, "2021-11-06T06:00"),
    },
    {
      id: "linz-scott-base-start-2016",
      stations: ["linz/SCOT"],
      since: "2016-01-01",
      until: "2016-02-03",
      handling: "dropped",
      error:
        "Scott Base's file for 2016 starts at 15:50 NZST on 5 January, and its levels aren't a tide until 03:40 UTC on 2 February: they drift from 2.0 to 1.7 m until the 13th, then sit near 0.4 m, flat to a few centimeters, until 03:40 UTC on 2 February, when they jump to 2.3 m. UHSLC's record starts on 2 February.",
      response: "Levels before 04:00 UTC on 2 February 2016 aren't kept.",
      evidence: "The 2016 file and UHSLC's hourly Scott Base (`uhslc/663a`), November 2026.",
      check: async (store, e) => {
        await absent(store, "linz/SCOT", e.since!, "2016-02-02T04:00");
        await levels(store, "linz/SCOT", "2016-02-02T04:00", "2016-02-03");
      },
    },
    {
      id: "linz-scott-base-step-2016",
      stations: ["linz/SCOT"],
      since: "2016-02-28",
      until: "2016-03-29",
      handling: "dropped",
      error:
        "Scott Base's levels run 0.120 m above UHSLC's hourly Scott Base (`uhslc/663a`) from 2 to 21 February 2016 (daily medians of the difference 0.119 to 0.121 m) and level with it from 29 March (0.000 m). The gauge failed at about 23:00 UTC on 28 February, after spikes to 0.03 m from noon, reading 0.01 to 0.4 m, and has no values from 3 to 29 March, so the zero moved in the failure.",
      response:
        "Levels from 23:00 UTC on 28 February to 29 March aren't kept, and values from 29 March are in a later epoch. The earlier epoch has no `to_current`, since a `to_current` is to the current zero and no record measures Scott Base's later steps (erratum `linz-scott-base-step-2021`).",
      evidence:
        "The 2016 file and UHSLC's hourly Scott Base, a one-hour centered mean at lag 12.00 hours, November 2026.",
      check: async (store, e) => {
        await absent(store, "linz/SCOT", `${e.since}T23:00`, e.until!);
        const { before } = await epochFrom(store, "linz/SCOT", e.until!);
        if (before.to_current != null)
          throw new Error(
            `SCOT's epoch before 29 March 2016 has a to_current of ${before.to_current}`,
          );
        const s = await step(
          store,
          "linz/SCOT",
          "uhslc/663a",
          ["2016-02-03", "2016-02-21"],
          [e.until!, "2016-04-28"],
        );
        if (!(Math.abs(s + 0.12) < 0.05))
          throw new Error(
            `SCOT's offset from uhslc/663a moves ${s.toFixed(3)} m across March 2016`,
          );
      },
    },
    {
      id: "linz-scott-base-step-2018",
      stations: ["linz/SCOT"],
      since: "2018-01-14",
      until: "2018-01-22",
      handling: "flagged",
      error:
        "Scott Base's README lists a drift of TG0 over 15 and 16 January 2018 and a sharp offset of about 0.08 m between 15:15 and 15:25 on 21 January. Against Cape Roberts', the difference falls from 3.954 m over the 12 days before to 3.866 m over the 2 weeks from the 23rd (0.088 m), so its levels rise 0.09 m.",
      response:
        "The span from 14 to 21 January is flagged `suspect`, keeping the source's own flag as `source_flag`, and values from 22 January are in a later epoch. The earlier epoch has no `to_current`.",
      evidence:
        "Scott Base's and Cape Roberts' hourly levels, the medians of the differences either side, November 2026; the README's gauge history.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const { before } = await epochFrom(store, "linz/SCOT", e.until!);
        if (before.to_current != null)
          throw new Error(
            `SCOT's epoch before 22 January 2018 has a to_current of ${before.to_current}`,
          );
        const s = await step(
          store,
          "linz/SCOT",
          "linz/ROBT",
          ["2018-01-02", e.since!],
          ["2018-01-23", "2018-02-06"],
        );
        if (!(Math.abs(s - 0.088) < 0.04))
          throw new Error(`SCOT's offset from ROBT moves ${s.toFixed(3)} m across January 2018`);
      },
    },
    {
      id: "linz-scott-base-stuck-2018-12",
      stations: ["linz/SCOT"],
      since: "2018-12-13",
      until: "2018-12-19",
      handling: "dropped",
      error:
        "From 09:35 UTC on 13 December 2018 to 19:55 UTC on 18 December Scott Base's levels are spikes to 0.02 m and then a constant 2.10 m, one level an hour from the 14th. The README lists nothing for 2018 but January.",
      response:
        "Levels from 09:00 UTC on 13 December to 20:00 UTC on 18 December 2018 aren't kept.",
      evidence: "The 2018 file, November 2026.",
      check: (store, e) => absent(store, "linz/SCOT", `${e.since}T09:00`, "2018-12-18T20:00"),
    },
    {
      id: "linz-scott-base-steps-2019-01",
      stations: ["linz/SCOT", "gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2019-01-17",
      until: "2019-01-20",
      handling: "flagged",
      error:
        "Scott Base's README lists TG0 raised 0.122 m at 10:30 and 0.072 m at 16:00 on 18 January 2019, then lowered 0.128 m at 09:00 on the 20th. The three together move the levels by 0.066 m, and against Cape Roberts' the difference is 3.907 m over the 11 days before and 3.891 m over the 11 days after (0.016 m), so no step is left to convert; the zero between the steps is up to 0.19 m off.",
      response:
        "The days of the three shifts, 17 to 19 January, are flagged `suspect`, keeping the source's own flag as `source_flag`. No epoch opens, since no step shows.",
      evidence:
        "Scott Base's and Cape Roberts' hourly levels, the medians of the differences either side, November 2026; the README's gauge history. GESLA's copy (`gesla/scott_base_antarctica-scot-nzl-ttw`) holds the same values at all 72 times the two share, on all 3 days of the span.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await noEpochBetween(store, "linz/SCOT", "2019-01-06", "2019-02-01");
        const s = await step(
          store,
          "linz/SCOT",
          "linz/ROBT",
          ["2019-01-06", e.since!],
          ["2019-01-21", "2019-02-01"],
        );
        if (!(Math.abs(s) < 0.05))
          throw new Error(
            `SCOT's offset from ROBT moves ${s.toFixed(3)} m across 17 to 19 January 2019`,
          );
      },
    },
    {
      id: "linz-scott-base-step-2019",
      stations: ["linz/SCOT"],
      since: "2019-02-24",
      until: "2019-11-04",
      handling: "dropped",
      error:
        "Scott Base's gauge fails at about 12:00 UTC on 24 February 2019, which its README doesn't list, and reads 0.01 m, with spells of 7.999 m and a fall from 7.4 m to 0.3 m on 28 to 31 October, until 01:00 UTC on 3 November. It then reads a tide again 0.50 m below its levels before: against Cape Roberts', the difference steps from 3.891 m to 5.622 m (1.731 m), of which Cape Roberts' own step of 3 February is 1.230 m (erratum `linz-cape-roberts-step-2019`). The README's table puts the zero 0.341 m higher in November 2019 than in November 2018.",
      response:
        "Levels from 12:00 UTC on 24 February to 02:00 UTC on 3 November 2019 aren't kept, and values from 3 November are in a later epoch. The earlier epoch has no `to_current`.",
      evidence:
        "The 2019 file and Cape Roberts', November 2026; the README's table of the zero below DJRB.",
      check: async (store, e) => {
        await absent(store, "linz/SCOT", `${e.since}T12:00`, "2019-11-03T02:00");
        await epochFrom(store, "linz/SCOT", "2019-11-03");
      },
    },
    {
      id: "linz-scott-base-step-2020",
      stations: ["linz/SCOT"],
      since: "2020-01-25",
      until: "2020-05-13",
      handling: "dropped",
      error:
        "Scott Base's gantry was lifted on the morning of 25 January 2020 (NZ time) and lowered and lifted again in the late afternoon, and from 06:40 UTC (19:40 NZ time) its levels read 0.27 and then 0.03 m, 0.000 for most of February to April and 0.01 m until 12 May, when the README says the gauge was returned to the water with its mount moved about 1 m. The levels read after it are 0.18 m higher against Cape Roberts', the difference falling from 5.606 to 5.428 m.",
      response:
        "Levels from 06:00 UTC on 25 January to 04:10 UTC on 12 May 2020 aren't kept, and values from 12 May are in a later epoch. The earlier epoch has no `to_current`.",
      evidence:
        "The 2020 file and Cape Roberts', the medians of the differences, November 2026; the README's gauge history.",
      check: async (store, e) => {
        await absent(store, "linz/SCOT", `${e.since}T06:00`, "2020-05-12T04:10");
        await epochFrom(store, "linz/SCOT", "2020-05-12");
      },
    },
    {
      id: "linz-scott-base-unreliable-2021",
      stations: ["linz/SCOT", "gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2021-02-07",
      until: "2021-03-17",
      handling: "flagged",
      error:
        "Scott Base's README marks its levels from 8 February to 17 March 2021 unreliable, after a drift of TG0, and lists six shifts of TG0 from 17 February to 16 March. The levels still follow a tide, and against Cape Roberts' the difference moves from 5.403 m over the 4 weeks before to 5.583 m over the span, with a standard deviation of 0.103 m against 0.065 m, and by 0.2 to 0.3 m over days.",
      response: "The span is flagged `suspect`, keeping the source's own flag as `source_flag`.",
      evidence:
        "Scott Base's and Cape Roberts' hourly levels, November 2026; the README's gauge history. GESLA's copy (`gesla/scott_base_antarctica-scot-nzl-ttw`) holds the same values at all 906 times the two share, on all 38 days of the span.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "linz-scott-base-step-2021",
      stations: ["linz/SCOT"],
      since: "2021-03-16",
      until: "2021-11-18",
      handling: "dropped",
      error:
        "Scott Base's gauge fails at 19:45 UTC on 16 March 2021 and reads 0.0 to 1.4 m, drifting down from 1.5 m to 0.1 m by October with a tide much smaller than before, until the README's re-establishment on 17 November (NZ time). Its levels then sit on a zero about 1.9 m lower against Cape Roberts', the difference falling from 5.403 to 3.546 m (1.857 m), which Cape Roberts' own step of November 2021 shares (erratum `linz-cape-roberts-step-2021`).",
      response:
        "Levels from 19:00 UTC on 16 March to 02:00 UTC on 17 November 2021 aren't kept, and values from 17 November are in a later epoch. The earlier epoch has no `to_current`.",
      evidence: "The 2021 file and Cape Roberts', November 2026; the README's gauge history.",
      check: async (store, e) => {
        await absent(store, "linz/SCOT", `${e.since}T19:00`, "2021-11-17T02:00");
        await epochFrom(store, "linz/SCOT", "2021-11-17");
      },
    },
    {
      id: "linz-scott-base-step-2022",
      stations: ["linz/SCOT"],
      since: "2022-03-06",
      until: "2022-03-09",
      handling: "dropped",
      error:
        "Scott Base's gauge fails from 08:15 UTC on 6 March 2022 (levels 0.01 to 0.04 m, then a spell of 8.0 m) to 01:45 UTC on the 8th, and the 2022 file has no levels from 9 March to 30 October. Its levels are then 0.17 m higher against Cape Roberts', the difference falling from 3.553 m over the 7 weeks before to 3.383 m over the 2 months from 2 November. The README's table puts the zero 0.145 m lower in November 2022 than in 2021.",
      response:
        "Levels from 08:00 UTC on 6 March to 02:00 UTC on 8 March 2022 aren't kept, and values from 30 October are in a later epoch. The earlier epoch has no `to_current`.",
      evidence: "The 2022 file and Cape Roberts', November 2026; the README's table.",
      check: async (store, e) => {
        await absent(store, "linz/SCOT", `${e.since}T08:00`, "2022-03-08T02:00");
        await epochFrom(store, "linz/SCOT", "2022-10-30");
      },
    },
    {
      id: "linz-scott-base-shift-2024",
      stations: ["linz/SCOT"],
      since: "2024-05-09",
      until: "2024-05-11",
      handling: "dropped",
      error:
        "Scott Base's README lists a vertical shift of the gauge on 10 May 2024. From 21:17 UTC on 9 May to 02:48 UTC on 10 May its levels hold spikes to 0.05 m, and against Cape Roberts' they show no step across it: the difference is 3.446 m before and 3.424 m after (0.022 m).",
      response:
        "Levels from 21:00 UTC on 9 May to 03:00 UTC on 10 May 2024 aren't kept. No epoch opens.",
      evidence: "The 2024 file and Cape Roberts', November 2026; the README's gauge history.",
      check: async (store, e) => {
        await absent(store, "linz/SCOT", `${e.since}T21:00`, "2024-05-10T03:00");
        await noEpochBetween(store, "linz/SCOT", "2024-01-01", "2025-01-01");
      },
    },
    {
      id: "linz-scott-base-drift-2024",
      stations: ["linz/SCOT"],
      since: "2024-06-01",
      until: "2024-07-11",
      handling: "kept",
      error:
        "From June to early July 2024 the difference between Cape Roberts' and Scott Base's levels falls 0.21 m, from 3.424 to 3.215 m, in steps of 0.1 to 0.16 m over days, while Scott Base's own monthly median rises 0.12 m and Cape Roberts' falls 0.14 m. Neither gauge's README lists anything for these weeks, and the zero of neither can be told to have moved.",
      response:
        "Kept as LINZ serves it, with no epoch, since the weeks the zero moved can't be placed or tied to a gauge.",
      evidence:
        "Hourly differences and each gauge's monthly medians for 2024, November 2026; both READMEs' gauge histories.",
      check: async (store, e) => {
        await noEpochBetween(store, "linz/SCOT", "2024-05-15", "2024-07-25");
        const obs = await levels(store, "linz/SCOT", e.since!, e.until!);
        const n = obs.filter((o) => o.flag >= Flag.suspect).length;
        if (n > obs.length / 100)
          throw new Error(`${n} of SCOT's levels from June to 10 July 2024 are flagged suspect`);
        const s = await step(
          store,
          "linz/SCOT",
          "linz/ROBT",
          ["2024-05-15", e.since!],
          [e.until!, "2024-07-25"],
        );
        if (!(Math.abs(s - 0.21) < 0.06))
          throw new Error(`SCOT's offset from ROBT moves ${s.toFixed(3)} m from May to July 2024`);
      },
    },
    {
      id: "linz-scott-base-step-2025",
      stations: ["linz/SCOT"],
      since: "2025-03-09",
      until: "2025-11-21",
      handling: "dropped",
      error:
        "Scott Base's gauge fails at about 01:00 UTC on 9 March 2025 and reads -0.02 m, flat, until 00:42 UTC on 20 November, when a tide returns. The README says only that its gantry was moved landward in 2025. The levels are then 0.64 m lower against Cape Roberts', the difference rising from 3.417 m over the 7 weeks before to 4.052 m over the 2 weeks from 25 November.",
      response:
        "Levels from 01:00 UTC on 9 March to 01:00 UTC on 20 November 2025 aren't kept, and values from 20 November are in a later epoch. The earlier epoch has no `to_current`.",
      evidence: "The 2025 file and Cape Roberts', November 2026; the README's gauge history.",
      check: async (store, e) => {
        await absent(store, "linz/SCOT", `${e.since}T01:00`, "2025-11-20T01:00");
        await epochFrom(store, "linz/SCOT", "2025-11-20");
      },
    },
  ],
  questions: [
    {
      id: "linz-calibration-history",
      stations: "every station",
      question:
        "For each gauge, the calibration results at every visit or sensor replacement since the record began: the date, the benchmark used, and the height of tide gauge zero (TG0) below it. The README files give one calibration at ten gauges, none at six (Devonport, Gisborne, Napier, Port Chalmers, Tauranga, Wellington), and yearly tables only for Cape Roberts and Scott Base. Which sensor, 40 or 41, does each calibration apply to? The two sensors differ by 0.3 to 1.5 m on a yearly cycle at Lottin Point, Kaikoura, Korotiti Bay, Fishing Rock, Boat Cove and Napier. Is one of them the reference?",
      why: "The store could put each gauge's levels on one continuous height reference, with chart datum on every epoch, instead of on each sensor's own tide gauge zero.",
      meanwhile:
        "The store keeps each level above the tide gauge zero of its time and opens a datum epoch where the data show a step. It sets `datums.CD` only where a README gives chart datum against TG0, and reads sensor 40, with sensor 41 where sensor 40 fails.",
      asked: null,
      answer: null,
    },
    {
      id: "linz-steps-in-the-zero",
      stations: ["linz/NAPT", "linz/WLGT", "linz/OTAT", "linz/TAUT", "linz/GIST"],
      question:
        'What happened at these steps? Compared with UHSLC\'s hourly records, both sensors step down together at Napier at 18:51 UTC on 24 February 2008 (0.34 m; the README says "step in data on February 25"); at Wellington on 30 May 2012 (0.26 m) and between 20:25 and 21:56 UTC on 15 April 2021 (0.38 m; the README lists no work in April 2021); at Port Chalmers on 26 May 2021 (0.56 m); at Tauranga between 22:17 and 23:17 UTC on 20 March 2024 (0.47 m; the README lists nothing in 2024); and at Gisborne on 25 to 26 September 2013 (0.57 m), 11 to 12 May 2021 (0.41 m) and 12 to 13 December 2024 (0.54 m; none listed except the 2024 sensor replacement). The sizes are 30-day median offsets against UHSLC, good to about 0.01 to 0.08 m.',
      why: "Whether each step is a move of the gauge's zero, which the store should carry as a datum change, or an error in the levels.",
      meanwhile:
        "The store records each step in an erratum and a datum epoch, with a note on how far the levels before it sit above the same water since.",
      asked: null,
      answer: null,
    },
    {
      id: "linz-quality-controlled-series",
      stations: "every station",
      question:
        "Does LINZ publish the quality-controlled series it uses for tsunami warning or for the reference ports, and where? We also have a list of spells when sensor 40 was stuck or erratic, such as Sumner from June 2016 to 2020, and can send it to whoever looks after the data.",
      why: "The store could take LINZ's own checked values, with quality flags, in place of the unchecked ones it reads now.",
      meanwhile:
        "LINZ sends no quality flag, so the store marks day files `preliminary` and year files `good`, which here means final and not checked, and flags the sensor faults it has found in its errata.",
      asked: null,
      answer: null,
    },
  ],
  retired: [],
} satisfies ErrataFile;
