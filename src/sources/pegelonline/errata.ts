import { dayAfter, flaggedSpan, impossibleDropped, type ErrataFile } from "../../errata.ts";
import {
  differences,
  held,
  flaggedByQc,
  kept,
  lagMinutes,
  levels,
  offset,
  qcFlags,
  step,
  unflagged,
} from "./errata-checks.ts";

export default {
  errata: [
    {
      id: "pegelonline-download-api-differ",
      stations: ["pegelonline/5990020", "pegelonline/9530020"],
      handling: "kept",
      error:
        "At Cuxhaven Steubenhöft and Husum, PEGELONLINE's raw-data download and its REST API give different levels for the same minutes, by up to 6 and 8 cm, though both are labeled unchecked raw data on the same gauge zero.",
      response:
        "History comes from the download and the last 31 days from the REST API, so the series can step by a few centimeters where one hands over to the other.",
      evidence:
        "At Cuxhaven Steubenhöft (`pegelonline/5990020`) and Husum (`pegelonline/9530020`), PEGELONLINE's raw-data download and its REST API give different water levels for the same minutes. The store takes history from the download and recent values from the REST API, so at these two gauges the record can step by a few centimeters where one source hands over to the other.\n\n#### What was compared\n\nOn 5 November 2026, about 16 hours of 1-minute values at 14 tide gauges, downloaded the way backfill does and compared with what hourly ingest stored from the REST API:\n\n| Gauges | Equal values | Largest difference |\n|---|---|---|\n| Helgoland Binnenhafen, Kiel-Holtenau | all | 0 |\n| 9 more tide gauges from [docs/ticon-inventory.csv](docs/ticon-inventory.csv) | 92 to 99% | 1 to 2 cm |\n| Cuxhaven Steubenhöft | 24% | 6 cm |\n| Husum | 3% | 8 cm |\n\n- **Not a clock error:** both sources match best with no time shift (0 to 7% of values match at a one- or two-hour offset), and the download's timestamps carry their MEZ/MESZ offset.\n- **Not a later correction:** the REST API still returns exactly what hourly ingest stored the day before, so its values weren't revised.\n- **Same metadata:** both sides describe the series as `WASSERSTAND ROHDATEN`, unchecked, in cm, on the same gauge zero.\n- At Cuxhaven the REST value is 0 to 6 cm higher, most around high water and close to zero around low water.\n\n#### Open questions\n\nAsked PEGELONLINE (pegelonline@itzbund.de) on 2026-11-07, in German, which sensor each endpoint serves at the two gauges, whether the Husum download is about 5 cm low this autumn, and about the May to June 2025 Cuxhaven correction. No answer yet.\n\n- [ ] Which series is right? Compare an older year of the download with GESLA's WSV record and with a TICON fit at both gauges.\n- [x] If that doesn't settle it, ask WSV which series the download and the REST API serve at these gauges.\n- [ ] Check whether more gauges do this, once the backfill has written more of them.\n- [ ] If the download is the wrong one, refetch the two gauges with `--refetch` once it's fixed or once we switch sources.\n\nThe backfill goes ahead in the meantime. Files it writes for these gauges can be replaced with `--refetch`.",
      reported: "2026-11-07",
      report:
        "Asked in the same message as pegelonline-wachendorf-zero-date ([#75](https://github.com/openwatersio/stillwell/issues/75)), to pegelonline@itzbund.de on 2026-11-07. Answered 2026-11-16: the download comes from a different data store than the REST API, and the WSV knows the two can give different values for the same timestamp. The REST API will be moved onto that store, which is in progress, and the WSV recommends the download for an open database. The answer doesn't say which sensor serves which endpoint or whether Husum's download is about 5 cm low. Text in [#26](https://github.com/openwatersio/stillwell/issues/26).",
      check: async (store, e) => {
        // The store keeps one value a minute, so the two endpoints' disagreement can't be read back from it, and a backfill keeps each value's first `received`; this shows only that both days the response describes are held whole: one from the download's history, one hourly ingest read from the REST API.
        for (const station of e.stations!)
          for (const day of ["2026-10-01", "2026-11-10"]) {
            const n = (await levels(store, station, day)).length;
            if (n < 1300)
              throw new Error(`the store holds ${n} ${station} levels on ${day}, not a day's`);
          }
      },
    },
    {
      id: "pegelonline-wachendorf-zero-date",
      stations: ["pegelonline/3500031"],
      handling: "kept",
      error:
        "PEGELONLINE dates Wachendorf's gauge zero, PNP at 12.77 m above NHN, from 2026-06-18, and doesn't say that the zero moved that day. The WSV says it was 13.77 m above NHN before.",
      response:
        "The store holds only the REST API's last 31 days, all after that date, so PEGELONLINE's overrides reject the date as a move and Wachendorf stays on one epoch at 12.77 m.",
      evidence:
        "The REST API gives the zero as 12.77 m above NHN, `validFrom` 2026-06-18. The first station refresh to list Wachendorf, on 2026-11-05, recorded 12.77 m but not the date. The next refresh read `validFrom`, saw a zero dated within 180 days of the gauge's first sighting, and held it:\n\n```\npegelonline/3500031: epoch held, PNP to PNP (first seen within 180 days of its date, so epoch 1 may hold values from before and after it); overrides key \"pegelonline/3500031 2026-06-18T23:00:00Z\"\n```\n\nBoth epochs carry the same label and height, PNP at 12.77 m above NHN. The REST API shows only the current zero. Wachendorf has no raw-data download (`history_since` is null), so the readings can't be checked for a step on that day either.\n\nThe WSV answered on 2026-11-09 that the zero was 13.77 m above NHN until 2026-06-18 and 12.77 m after.\n\n#### To resolve\n\n- [x] Ask WSV (Standort Meppen) whether Wachendorf's gauge zero changed on 2026-06-18, and if so from what height\n- [ ] If values from before that day become available: replace the `reject` with `confirm` and the old zero's `to_current`, then backfill the station",
      reported: "2026-11-08",
      report:
        "Sent to PEGELONLINE (pegelonline@itzbund.de) on 2026-11-08, in German. Answered 2026-11-09: the zero was 13.77 m above NHN until 2026-06-18 and 12.77 m after. Text in [#72](https://github.com/openwatersio/stillwell/issues/72).",
      check: async (store, e) => {
        const id = e.stations![0]!;
        const station = await store.station(id);
        if (!station) throw new Error("the store doesn't list Wachendorf");
        const used = station.epochs.filter((e) => e.state !== "rejected");
        if (used.length !== 1 || used[0]!.datums.NHN !== 12.77)
          throw new Error("Wachendorf isn't on one epoch at 12.77 m above NHN");
        if (
          !station.epochs.some((e) => e.state === "rejected" && e.since?.startsWith("2026-06-18"))
        )
          throw new Error("Wachendorf has no rejected epoch from 2026-06-18");
        // A week of values the first station refresh to list Wachendorf read.
        await levels(store, id, "2026-11-05", "2026-11-12");
        const before = await store.levels(id, "2000-01-01", "2026-06-19");
        if (before.length)
          throw new Error(`the store holds ${before.length} Wachendorf levels before 2026-06-19`);
      },
    },
    {
      id: "pegelonline-cuxhaven-2025-revised",
      stations: ["pegelonline/5990020"],
      since: "2025-05-13",
      until: "2025-06-25",
      handling: "kept",
      error:
        "PEGELONLINE's download for Cuxhaven sits 4 to 6 cm above GESLA's copy from 13 May to 24 June 2025, so the WSV changed values it still labels raw and unchecked.",
      response:
        "Kept as the download serves it, so Cuxhaven's store values from 13 May to 24 June 2025 are the revised ones.",
      evidence:
        "While comparing the store's 2024 and 2025 Cuxhaven Steubenhöft files, which come from PEGELONLINE's raw-data download, with other records of the same gauge for [#26](https://github.com/openwatersio/stillwell/issues/26), the download sat 4 to 6 cm above GESLA's copy from 13 May to 24 June 2025, and matched it before and after. Both describe the series as unchecked raw data, so the WSV changed values after GESLA copied them without relabeling them. The comparison is in [#26's comment](https://github.com/openwatersio/stillwell/issues/26#issuecomment-6700549671).",
      reported: "2026-11-07",
      report:
        "Asked in the same message as [#26](https://github.com/openwatersio/stillwell/issues/26), to pegelonline@itzbund.de on 2026-11-07. The 2026-11-16 answer doesn't mention the 2025 correction or where the WSV notes later corrections to raw data.",
      check: async (store, e) => {
        const [station, since, until] = [e.stations![0]!, e.since!, e.until!];
        const cmems = "gesla/cuxhaventg-cux-deu-cmems";
        const before: [string, string] = [dayAfter(since, -12), since];
        const after: [string, string] = [until, dayAfter(until, 13)];
        await step(store, station, cmems, before, [since, until], 0.025);
        await step(store, station, cmems, [since, until], after, -0.025);
      },
    },
    {
      id: "pegelonline-wangerooge-ost-filled",
      stations: ["pegelonline/9420020"],
      since: "2007-11-05",
      until: "2008-04-02",
      handling: "flagged",
      error:
        "PEGELONLINE's Wangerooge Ost levels from 5 November 2007 to 1 April 2008 are Wangerooge West's, less an offset that steps by 1 cm every few weeks from 8 cm to 1 cm.",
      response:
        "5 November 2007 to 1 April 2008 is flagged `suspect`, keeping the source flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026. Wangerooge Ost and West, 8 km apart, usually differ by 6 to 8 cm RMS a month. Over the span they differ by 0.0 cm RMS each day, with the mean difference falling from −8 to −1 cm in whole-centimeter steps. Against Wangerooge Nord, Ost's RMS over the span equals West's.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        // West less a whole-centimeter offset, which steps by a centimeter at most within a day.
        const d = await differences(store, e.stations![0]!, "9420040", "2008-01-15", "2008-01-16");
        if (Math.max(...d) - Math.min(...d) > 0.0101)
          throw new Error("Wangerooge Ost isn't Wangerooge West less an offset on 2008-01-15");
      },
    },
    {
      id: "pegelonline-helgoland-suedhafen-2013-clock",
      stations: ["pegelonline/9510075"],
      since: "2013-05-29",
      until: "2013-07-25",
      handling: "flagged",
      error:
        "PEGELONLINE's Helgoland Südhafen levels run about 19 minutes late on 29 and 30 May and from 17 June to 24 July 2013.",
      response:
        "29 May to 24 July 2013 is flagged `suspect`, keeping the source flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026: the tide-timing check put the semidiurnal tide 19 minutes and the diurnal 13 minutes late from mid-June to mid-July, against about 3 minutes of scatter. Against Helgoland Binnenhafen (`pegelonline/9510070`), 0.5 km away, the daily RMS rises from about 2 cm to 8 to 14 cm on those days. GESLA's WSV copy carries it too (erratum `gesla-helgoland-suedhafen-2013-clock`).",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const lag = await lagMinutes(store, e.stations![0]!, "9510070", "2013-07-01");
        if (lag < 12 || lag > 26)
          throw new Error(
            `Helgoland Südhafen runs ${lag} minutes behind Binnenhafen on 2013-07-01, not about 19`,
          );
      },
    },
    {
      id: "pegelonline-bake-z-2004-offset",
      stations: ["pegelonline/9510066"],
      since: "2004-11-11",
      until: "2005-03-08",
      handling: "flagged",
      error:
        "PEGELONLINE's Bake Z levels sit 0.5 to 1 m high from 11 November 2004 to 7 March 2005, apart from a few days in December.",
      response:
        "11 November 2004 to 7 March 2005 is flagged `suspect`, keeping the source flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026: a step of −95 cm on 7 March 2005 against all four neighboring gauges. Daily means against Scharhörn (`pegelonline/9510060`) are about +5 cm before and after, and +48 to +64 cm over the span. GESLA's WSV copy carries it too (erratum `gesla-bake-z-2004-offset`).",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const since = e.since!;
        await step(
          store,
          e.stations![0]!,
          "9510060",
          [dayAfter(since, -14), dayAfter(since, -1)],
          [dayAfter(since, 1), dayAfter(since, 14)],
          0.3,
        );
      },
    },
    {
      id: "pegelonline-helgoland-binnenhafen-2000-offset",
      stations: ["pegelonline/9510070"],
      until: "2000-11-01",
      handling: "flagged",
      error:
        "PEGELONLINE's Helgoland Binnenhafen levels before 1 November 2000 sit about 25 cm lower than the gauge's later ones against its neighbors, with no change of gauge zero recorded.",
      response:
        "Values before 1 November 2000 are flagged `suspect`, keeping the source flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026: a step of +27 cm on 29 October 2000 against three neighboring gauges. Against Bake A (`pegelonline/9510063`) the yearly median difference is −25 cm in 2000 and between −13 and +2 cm in every later year; against Bake Z it is −17 cm in 2000 and −1 to +2 cm in 2001 to 2004. Helgoland Südhafen sits as low as Binnenhafen until its own step (erratum `pegelonline-helgoland-suedhafen-2001-offset`). The gauge's zero has one date, 2019-11-01. Daily means against Südhafen move from about +4 cm to +30 cm between 30 October and 1 November 2000. GESLA's WSV copy carries it too (erratum `gesla-helgoland-binnenhafen-2000-offset`).",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const until = e.until!;
        await step(
          store,
          e.stations![0]!,
          "9510063",
          [dayAfter(until, -17), dayAfter(until, -4)],
          [until, dayAfter(until, 9)],
          0.15,
        );
      },
    },
    {
      id: "pegelonline-helgoland-suedhafen-2001-offset",
      stations: ["pegelonline/9510075"],
      until: "2004-01-01",
      handling: "flagged",
      error:
        "PEGELONLINE's Helgoland Südhafen levels before 2004 sit about 29 cm lower than the gauge's later ones against its neighbors, and May and November 2001 are a further 75 cm low and 47 cm high.",
      response:
        "Values before 2004 are flagged `suspect`, keeping the source's own flag as `source_flag`: the step falls in the 2002 and 2003 outage, so the few values left from then are flagged too.",
      evidence:
        "Against Bake A (`pegelonline/9510063`) the yearly median difference is −29 cm in 2000 and 2001 and between −13 and +1 cm from 2004 on. Against Helgoland Binnenhafen, 0.5 km away, it is −4 cm until November 2000, when Binnenhafen steps (erratum `pegelonline-helgoland-binnenhafen-2000-offset`), then −30 cm through 2001, and the two agree again from 2004. The step falls in 2002 and 2003, when almost every value is flagged. Monthly differences against Bake A are −105 cm in May 2001 and +19 cm in November 2001. Found while checking the Binnenhafen erratum; the cross-station check's 120-day limit skipped the span because of the gap. GESLA's WSV copy carries it too (erratum `gesla-helgoland-suedhafen-2001-offset`).",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const d = await offset(store, e.stations![0]!, "9510070", "2001-08-01", "2001-08-08");
        if (d >= -0.15)
          throw new Error(
            `Helgoland Südhafen sits ${(d * 100).toFixed(1)} cm off Binnenhafen in August 2001, not 15 cm low or more`,
          );
      },
    },
    {
      id: "pegelonline-mittelgrund-2012-offset",
      stations: ["pegelonline/9510132"],
      since: "2012-10-10",
      until: "2012-11-20",
      handling: "flagged",
      error:
        "PEGELONLINE's Mittelgrund levels sit about 13 cm lower than usual against Cuxhaven from 10 October to 19 November 2012.",
      response:
        "10 October to 19 November 2012 is flagged `suspect`, keeping the source flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026: steps of −19 cm on 10 October and +17 cm on 20 November 2012 against two of three neighboring gauges. The monthly median difference against Cuxhaven Steubenhöft (`pegelonline/5990020`) is −25 cm in October 2012 against −11 to −14 cm in the months around it. GESLA's WSV copy carries it too (erratum `gesla-mittelgrund-2012-offset`).",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const since = e.since!;
        await step(
          store,
          e.stations![0]!,
          "5990020",
          [dayAfter(since, -14), dayAfter(since, -1)],
          [dayAfter(since, 1), dayAfter(since, 14)],
          -0.07,
        );
      },
    },
    {
      id: "pegelonline-borkum-suedstrand-2014-offset",
      stations: ["pegelonline/9340030"],
      since: "2014-12-05",
      until: "2015-03-12",
      handling: "flagged",
      error:
        "PEGELONLINE's Borkum Südstrand levels sit about 11 cm higher than usual against Borkum Fischerbalje from 5 December 2014 to 11 March 2015.",
      response:
        "5 December 2014 to 11 March 2015 is flagged `suspect`, keeping the source flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026: a step of −11 cm on 14 March 2015 against both neighboring gauges with values then. The monthly median difference against Borkum Fischerbalje (`pegelonline/9340020`), 2 km away, is −8 to −11 cm in every month of 2014 and 2015 except December 2014 to February 2015, at +1.5 to +2.5 cm. Daily means against Fischerbalje are back near usual from 12 March 2015. The step check compares 30-day medians, so its dates are a few days off; the span follows the daily means. GESLA's WSV copy carries it too (erratum `gesla-borkum-suedstrand-2014-offset`).",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const since = e.since!;
        await step(
          store,
          e.stations![0]!,
          "9340020",
          [dayAfter(since, -15), dayAfter(since, -1)],
          [dayAfter(since, 1), dayAfter(since, 15)],
          0.07,
        );
      },
    },
    {
      id: "pegelonline-schillig-2006-offset",
      stations: ["pegelonline/9430030"],
      since: "2006-08-01",
      until: "2006-09-07",
      handling: "flagged",
      error:
        "PEGELONLINE's Schillig levels sit about 9 cm higher than usual against Wilhelmshaven from 1 August to 6 September 2006.",
      response:
        "1 August to 6 September 2006 is flagged `suspect`, keeping the source flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026: a step of +9 cm on 28 July 2006 against two of three neighboring gauges. Monthly median differences against Wilhelmshaven Alter Vorhafen (`pegelonline/9440020`) are −4 to −6 cm from January to July 2006 and about −3 cm from October to December, and +4 cm in August; daily means over the span are +7 to +11 cm. Daily means first sit high on 1 August. The step check compares 30-day medians, so its dates are a few days off; the span follows the daily means.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const since = e.since!;
        await step(
          store,
          e.stations![0]!,
          "9440020",
          [dayAfter(since, -22), dayAfter(since, -8)],
          [dayAfter(since, 1), dayAfter(since, 15)],
          0.05,
        );
      },
    },
    {
      id: "pegelonline-list-2024-level",
      stations: ["pegelonline/9570070"],
      since: "2024-09-01",
      handling: "kept",
      error:
        "PEGELONLINE's List auf Sylt levels have sat 8 to 20 cm lower against Hörnum and Wittdün since September 2024 than before, with no change of gauge zero.",
      response:
        "The store keeps the values as served: the offset wanders and continues, so its cause, and whether newer values are right, needs the WSV's answer.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026: a step of −23 cm on 28 August 2024 against three of four neighboring gauges. Monthly median differences against Hörnum (`pegelonline/9570050`) are within ±1.3 cm from January to August 2024 and −7 to −22 cm in every month since; against Wittdün (`pegelonline/9570010`) within ±2.6 cm before and −7 to −20 cm in every month since except October 2024. The gauge zero's only date is 2019-11-01.",
      check: async (store, e) => {
        const [station, since] = [e.stations![0]!, e.since!];
        await unflagged(store, station, dayAfter(since, 14));
        await step(
          store,
          station,
          "9570050",
          ["2024-08-01", dayAfter(since, -7)],
          [dayAfter(since, 4), dayAfter(since, 29)],
          -0.05,
        );
      },
    },
    {
      id: "pegelonline-bake-z-2002-offset",
      stations: ["pegelonline/9510066"],
      since: "2002-09-30",
      until: "2002-10-22",
      handling: "flagged",
      error:
        "PEGELONLINE's Bake Z levels sit 0.8 to 2.4 m high from 30 September to 21 October 2002.",
      response:
        "30 September to 21 October 2002 is flagged `suspect`, keeping the source's own flag as `source_flag`. The store's QC already flags about two thirds of it.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against Bake A (`pegelonline/9510063`) and Scharhörn (`pegelonline/9510060`): the differences are 0.03 to 0.08 m before and after, +0.83 m from 30 September and +2.37 m from 18 October.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const since = e.since!;
        await step(
          store,
          e.stations![0]!,
          "9510063",
          [dayAfter(since, -14), dayAfter(since, -1)],
          [dayAfter(since, 1), dayAfter(since, 14)],
          0.5,
        );
      },
    },
    {
      id: "pegelonline-este-sperrwerk-2025-06-03",
      stations: ["pegelonline/5950081"],
      since: "2025-06-03",
      until: "2025-06-04",
      handling: "kept",
      error:
        "PEGELONLINE gives Este Inneres Sperrwerk BP 3.20 m at 08:10 UTC on 3 June 2025, after 6.51 and 6.40 m at 08:08 and 08:09, followed by a gap.",
      response:
        "The values are kept as served, with the flags QC gives them in the store's 2025 file, checked on 20 November 2026: the spike rule flags 6.40 m at 08:09, which sits between 6.51 and 3.20 m, and the residual-jump rule flags 3.20 m at 08:10. The 6.51 m at 08:08 stays unflagged. Errata spans are whole days, so flagging the three minutes here would mark about 1,400 good one-minute values suspect.",
      evidence:
        "In PEGELONLINE's raw-data download for the gauge, as the store holds it, checked in November 2026: 6.51 m at 08:08 UTC, 6.40 m at 08:09, 3.20 m at 08:10, then a gap. The gauge also jumps for a minute or two to fixed values such as 5.19, 4.99 and 4.19 m dozens of times a year, which the store's spike test mostly catches.",
      check: async (store, e) => {
        const [station, day] = [e.stations![0]!, e.since!];
        const values = await levels(store, station, day);
        kept(values, station, `${day}T08:08Z`, 6.51);
        flaggedByQc(values, station, `${day}T08:09Z`, 6.4);
        flaggedByQc(values, station, `${day}T08:10Z`, 3.2);
      },
    },
    {
      id: "pegelonline-eichhorst-zero",
      stations: ["pegelonline/693320", "pegelonline/693330"],
      since: "2026-11-10",
      until: "2026-11-11",
      handling: "kept",
      error:
        "PEGELONLINE gives Eichhorst OP and Eichhorst UP 0 cm at 03:30 UTC on 10 November 2026, then nothing until 05:15, between steady levels of 389 and 107 cm.",
      response:
        "The values are kept as served. In the values the store holds, checked on 20 November 2026, no rule in its QC flags the 0 cm values. Both stations are judged not tidal, so the residual-jump rule is off for them, and the spike rule judges a value only when it has neighbors within three sampling intervals on both sides, and the next value comes after a gap. It flags the level at 03:15 UTC before each zero (389 and 107 cm) as suspect. Errata spans are whole days, so flagging the zeros here would mark the rest of the day suspect too.",
      evidence:
        "PEGELONLINE's REST API (`/stations/693320/W/measurements.json` and the same for 693330), checked on 11 November 2026, returns 389 and 107 cm at 04:00 and 04:15 CET, 0.0 at 04:30 CET, and nothing until 06:15 CET. The store holds the same values.",
      check: async (store, e) => {
        const day = e.since!;
        for (const station of e.stations!) {
          const values = await levels(store, station, day);
          kept(values, station, `${day}T03:30Z`, 0);
          flaggedByQc(values, station, `${day}T03:15Z`, station.endsWith("320") ? 3.89 : 1.07);
          const [from, to] = [Date.parse(`${day}T03:30Z`), Date.parse(`${day}T05:15Z`)];
          if (values.some((o) => o.time > from && o.time < to))
            throw new Error(`${station} holds values between 03:30 and 05:15 on ${day}`);
        }
      },
    },
    {
      id: "pegelonline-wangerooge-west-2026-dropout",
      stations: ["pegelonline/9420040"],
      since: "2026-10-26",
      until: "2026-10-30",
      handling: "flagged",
      error:
        "From the storm surge of 25 October 2026 to 29 October, PEGELONLINE's Wangerooge West gauge reads −2.40 m, 7.5 m below its median and 6 m below any low water, whenever the water is below about 7.1 m, and all day on 27 and 28 October.",
      response:
        "26 to 29 October 2026 is flagged `suspect`, keeping the source flag as `source_flag`. The −2.40 m values from 20:28 UTC on 25 October are flagged by QC once the station is judged tidal: with this span, its last year has one hold that drains count, and tidal QC flags every −2.40 m value of 2026.",
      evidence:
        "Found from the station's analysis, November 2026: the held values counted as drains and judged the gauge not tidal. 5,086 values read −2.40 m from 25 October 20:28 to 29 October 13:43 UTC, each run starting with a drop of up to 10 m in a minute. Wilhelmshaven Alter Vorhafen (`pegelonline/9440020`) reads normal tides throughout, with a high water of 8.83 m on 25 October. CMEMS's copy carries the same values (erratum `cmems-wangerooge-west-2026-dropout`). Every value from 30 October to 14 November is a normal tide.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await held(store, e.stations![0]!, dayAfter(e.since!, 1), -2.4, 1200);
        await qcFlags(store, e, -2.4);
      },
    },
    {
      id: "pegelonline-schillig-2026-dropout",
      stations: ["pegelonline/9430030"],
      since: "2026-10-26",
      until: "2026-11-14",
      handling: "flagged",
      error:
        "From 26 October to 13 November 2026, after the storm surge of 25 October, PEGELONLINE's Schillig gauge reads −2.50 m, 7.6 m below its median, for most of each day and all of some. Single values and runs of up to a few hours read −2.50 m from 13 July.",
      response:
        "26 October to 13 November 2026 is flagged `suspect`, keeping the source flag as `source_flag`. The earlier −2.50 m values are flagged by QC once the station is judged tidal: with this span, its last year has no hold that drains count, and tidal QC flags every −2.50 m value of 2026.",
      evidence:
        "Found from the station's analysis, November 2026: the held values counted as drains and judged the gauge not tidal. 22,411 values read −2.50 m in 2026, 22,014 of them from 26 October 02:47 to 13 November 06:20 UTC. Wilhelmshaven Alter Vorhafen (`pegelonline/9440020`), 12 km away, reads normal tides throughout. Every value from 14 November is a normal tide.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await held(store, e.stations![0]!, "2026-11-01", -2.5, 720);
        await qcFlags(store, e, -2.5);
      },
    },
    {
      id: "pegelonline-mellumplate-2026-dropout",
      stations: ["pegelonline/9420010"],
      since: "2026-09-16",
      until: "2026-09-18",
      handling: "flagged",
      error:
        "On 16 and 17 September 2026 PEGELONLINE's Mellumplate gauge reads −2.50 m, 7.6 m below its median, for half of the 16th and a few minutes of the 17th, and values from 0.31 to 10.0 m in between. −2.50 m is the value Schillig's sensor reads from October (erratum `pegelonline-schillig-2026-dropout`).",
      response:
        "16 and 17 September 2026 are flagged `suspect`, keeping the source flag as `source_flag`. QC flags the −2.50 m values of its other days in 2026.",
      evidence:
        "Found from the dropouts at Wangerooge West and Schillig, November 2026: Mellumplate has 1,202 values of −2.50 m from 14 July to 5 October 2026, all flagged by QC except 46 on 16 and 17 September. On the 16th, 732 of the day's values are −2.50 m in runs under 6 hours, so the flatline rule doesn't reach them and they widen the spread the outlier check judges by.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await held(store, e.stations![0]!, e.since!, -2.5, 500);
        await qcFlags(store, e, -2.5);
      },
    },
    {
      id: "pegelonline-rechtenfleth-2026-11-11",
      stations: ["pegelonline/4970030"],
      since: "2026-11-11",
      until: "2026-11-12",
      handling: "flagged",
      error:
        "From 08:33 to about 11:30 UTC on 11 November 2026 PEGELONLINE's Rechtenfleth gauge falls from 3.17 to 0.15 m in ten minutes, holds 0.56 m for 40 minutes, then holds 10.56 m for about two hours, above any other value of its year.",
      response: "11 November 2026 is flagged `suspect`, keeping the source flag as `source_flag`.",
      evidence:
        "Found from the dropouts at Wangerooge West and Schillig, November 2026: 0.1% of Rechtenfleth's values before November 2026 are below 2.14 m and 0.1% above 8.24 m. QC flags 7 values of the episode: the holds are shorter than the 6-hour flatline, and the outlier check judges them against a spread they widen. The tide before 08:33 and from 12:00 is normal.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const day = e.since!;
        const [from, to] = [Date.parse(`${day}T08:30Z`), Date.parse(`${day}T12:00Z`)];
        const values = (await levels(store, e.stations![0]!, day)).filter(
          (o) => o.time >= from && o.time < to,
        );
        const count = (low: number, high: number) =>
          values.filter((o) => o.level >= low && o.level < high).length;
        if (count(10.4, 10.7) < 60 || count(0.5, 0.6) < 20)
          throw new Error(`Rechtenfleth doesn't hold 0.56 m then 10.56 m for long on ${day}`);
      },
    },
    {
      id: "pegelonline-fill-values",
      stations: ["pegelonline/9520050", "pegelonline/9520070"],
      since: "2019-01-01",
      handling: "dropped",
      error:
        "These 2 PEGELONLINE gauges hold levels no gauge can read, outside the store's span of −500 to 9,000 m: 14 values from 2019 to 2022, from 10,635 to 25,689 m.",
      response:
        "The store leaves out a level outside its span (`SPAN_M` in src/span.ts) wherever it fetches levels, and requalify drops any it holds. A year file of nothing else keeps its rows, flagged `bad`, with a warning.",
      evidence:
        "November 2026. A scan of the range of levels in every year file of every source in the store (335,320 files) found 383 holding a level outside the span, which were then read in full; each of them also has a `bad` value, as QC flags every level outside the span.",
      check: async (store) => {
        await impossibleDropped(store, "pegelonline/9520050", 2021);
        await impossibleDropped(store, "pegelonline/9520070", 2022);
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
