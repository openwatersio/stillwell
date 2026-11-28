import {
  dayAfter,
  flaggedSpan,
  impossibleDropped,
  type ErrataFile,
  type StoreReader,
} from "../../errata.ts";
import { compare } from "../gesla/check.ts";
import { Flag } from "../../schema.ts";

const iso = (time: number) => new Date(time).toISOString();

/** A station's levels on `day`; throws when the store holds none. */
async function levels(store: StoreReader, id: string, day: string) {
  const rows = await store.levels(id, day, dayAfter(day, 1));
  if (!rows.length) throw new Error(`the store holds no ${id} levels on ${day}`);
  return rows;
}

/** Throws unless every level the store holds for `id` from `since` to before `until` is suspect or worse, and it holds some. */
async function allSuspect(store: StoreReader, id: string, since: string, until: string) {
  const rows = await store.levels(id, since, until);
  if (!rows.length) throw new Error(`the store holds no ${id} levels from ${since} to ${until}`);
  const missed = rows.filter((o) => o.flag < Flag.suspect);
  if (missed.length)
    throw new Error(
      `${missed.length} of ${id}'s ${rows.length} levels from ${since} to ${until} aren't suspect, the first at ${iso(missed[0]!.time)}`,
    );
}

export default {
  errata: [
    ...[
      { year: "2020", since: "2020-07-01", until: "2020-09-01", probe: "2020-08-05", lag: -60 },
      { year: "2022", since: "2022-06-01", until: "2022-10-01", probe: "2022-08-20", lag: -20 },
    ].map(({ year, since, until, probe, lag }) => ({
      id: `cmems-coruna-clock-${year}`,
      stations: ["cmems/Coruna2TG", "gesla/coruna2tg-cor-esp-cmems"],
      since,
      until,
      handling: "flagged" as const,
      error: `Coruna2TG and its GESLA copy have timing discrepancies against REDMAR's separate Coruña instrument during the ${year} episode.`,
      response:
        "Keep the conservative uncertainty window suspect without changing timestamps or native source flags. These are observation-based windows, not inferred exact correction epochs. The native UTC product is checked separately from IGN's own hourly files, whose clock has its own errata.",
      evidence:
        "Complete 2019–2024 controls against both REDMAR CorunaTG and UHSLC/830, and weekly REDMAR controls, are at https://github.com/openwatersio/stillwell/blob/main/docs/results/ign-coruna-identity-2026-11-22.md (copy-controls.json and copy-windows.json). The windows include adjacent weak-offset weeks and padding around the strong discrepancies. Most other well-paired months favor zero lag against REDMAR. UHSLC diverges after mid-2020, so it is not treated as sole ground truth. The GESLA copy has the same stored numeric series as CMEMS over 2019–2023. No correction is inferred.",
      check: async (store: StoreReader, e: Parameters<typeof flaggedSpan>[1]) => {
        await flaggedSpan(store, e);
        const until = dayAfter(probe, 7);
        const reference = await store.levels("cmems/CorunaTG", probe, until);
        if (!reference.length) throw new Error("no independent REDMAR control");
        for (const id of e.stations ?? []) {
          const observed = await store.levels(id, probe, until);
          const zero = compare(observed, reference, 0),
            shifted = compare(observed, reference, lag * 60000);
          if (zero.n < 72 || !Number.isFinite(zero.spread))
            throw new Error(`${id} lacks a usable zero-lag control`);
          if (
            shifted.n < 72 ||
            !Number.isFinite(shifted.spread) ||
            shifted.spread >= zero.spread * 0.85
          )
            throw new Error(
              `${id} no longer shows the recorded clock discrepancy; review the erratum`,
            );
        }
      },
    })),

    {
      id: "cmems-baltic-names",
      stations: [
        "cmems/Ahus",
        "cmems/Angelholm",
        "cmems/Arko",
        "cmems/Barseback",
        "cmems/Bjorn",
        "cmems/Bonan",
        "cmems/Degerby",
        "cmems/Draghallan",
        "cmems/Dragor",
        "cmems/E4BronSodertalje",
        "cmems/Faaborg",
        "cmems/Furuogrund",
        "cmems/GavleHamn",
        "cmems/GoteborgAgnesberg",
        "cmems/GoteborgEriksberg",
        "cmems/GoteborgGotaalvbron",
        "cmems/GoteborgHisingsbron",
        "cmems/GoteborgKlippan",
        "cmems/GoteborgKrossholmen",
        "cmems/GoteborgLarjeholm",
        "cmems/GoteborgTingstadstunneln",
        "cmems/GoteborgTorshamnen",
        "cmems/Grena",
        "cmems/Haademeeste",
        "cmems/Hamina",
        "cmems/Hanko",
        "cmems/KalixStoron",
        "cmems/Kaskinen",
        "cmems/Kobenhavn",
        "cmems/Koege",
        "cmems/Korsor",
        "cmems/Malmo",
        "cmems/MalmoHamn",
        "cmems/Montu",
        "cmems/NarvaJoesuu",
        "cmems/NarvaJoesuu2",
        "cmems/NordreRose",
        "cmems/NynasFiskehamn",
        "cmems/OlandsNorraUdde",
        "cmems/Oulu",
        "cmems/OxelosundVinterklasen",
        "cmems/Parnu",
        "cmems/Pietarsaari",
        "cmems/Pori",
        "cmems/Porvoo",
        "cmems/Rauma",
        "cmems/Rodby",
        "cmems/Rodvig",
        "cmems/Ronne",
        "cmems/Sillamae",
        "cmems/Skanor",
        "cmems/Smogen",
        "cmems/Sonderborg",
        "cmems/Soru",
        "cmems/Stromoren",
        "cmems/TanguddenGBGHamn",
        "cmems/Turku",
        "cmems/Vastervik",
        "cmems/Verko",
      ],
      handling: "avoided",
      error:
        'The Baltic production unit\'s files cut a `platform_name` with letters beyond ASCII short, a byte for each byte past the first that such a letter takes in UTF-8 ("Fåbor" for Fåborg, "Göteborg-Agnesber" for Göteborg-Agnesberg), and in five put U+FFFD in a letter\'s place ("Ark�" for Arkö, "Malm�", "Verk�", "Gren�", "Hanko Pikku Kolalahti / Hang�"). The attribute\'s length counts the name\'s letters, not its bytes.',
      response:
        "Every station from a Baltic file (`BO_TS_TG_`) whose name has a letter beyond ASCII is named by its platform code instead, such as `Faaborg`, which is whole.",
      evidence:
        '`ncdump -h` of the latest window\'s files on 14 November 2026, such as `BO_TS_TG_Faaborg_20261015.nc` (`platform_name = "Fåbor"`, 6 bytes `46 c3 a5 62 6f 72`) and `BO_TS_TG_Arko_20261015.nc` (`Ark` and `ef bf bd`). Names from the other units\' files, such as Puertos del Estado\'s "A Coruña 2 tide gauge", are whole.',
      check: async (store, e) => {
        for (const id of e.stations!) {
          const s = await store.station(id);
          if (!s) throw new Error(`the store doesn't list ${id}`);
          if (s.name !== id.slice("cmems/".length))
            throw new Error(`the store names ${id} "${s.name}", not its platform code`);
        }
      },
    },
    {
      id: "cmems-list-2024-level",
      stations: ["cmems/ListTG", "gesla/listtg-lis-deu-cmems"],
      since: "2024-08-21",
      handling: "flagged",
      error:
        "CMEMS's record of the WSV's List auf Sylt gauge has sat 6 to 25 cm lower against DMI's Havneby since 21 August 2024 than before, as PEGELONLINE's does (erratum `pegelonline-list-2024-level`).",
      response:
        "Values from 21 August 2024 on are flagged `suspect`, keeping the source flag as `source_flag`, as PEGELONLINE's are. GESLA's copy of the record is flagged over the same span.",
      evidence:
        "Found with erratum `pegelonline-list-2024-level`, November 2026. The record's monthly median against Havneby (`dmi/9006802`, 11 km) is −2.4 to 0.6 cm in every month from January 2023 to July 2024 and −24.4 to −8.4 cm in every month from September 2024 to November 2026. Its daily median goes from −1.4 cm on 20 August 2024 to −13.4 cm on the 21st and −24.4 cm on the 22nd, the days PEGELONLINE's record steps. The record isn't a copy of PEGELONLINE's values, which it differs from by up to tens of centimeters at single times, so it has an entry of its own. GESLA's copy, which ends on 31 May 2026, equals it at all 92,626 times they share from 21 August 2024, on 645 days.",
      reported: null,
      report: null,
      check: async (store, e) => {
        await flaggedSpan(store, e);
        // The span has no end, so days of its later years too, before the poller's last week.
        for (const id of e.stations!)
          for (const day of ["2025-06-15", "2026-05-15"]) {
            const open = (await levels(store, id, day)).filter((o) => o.flag < Flag.suspect);
            if (open.length)
              throw new Error(`${open.length} ${id} values on ${day} aren't suspect`);
          }
        // The step itself: the record against Havneby, over the weeks before and after it.
        const against = async (since: string, until: string) => {
          const other = new Map(
            (await store.levels("dmi/9006802", since, until)).map((o) => [o.time, o.level]),
          );
          const d = (await store.levels(e.stations![0]!, since, until))
            .flatMap((o) => (other.has(o.time) ? [o.level - other.get(o.time)!] : []))
            .sort((x, y) => x - y);
          if (d.length < 500)
            throw new Error(`ListTG and Havneby share ${d.length} times from ${since} to ${until}`);
          return d[d.length >> 1]!;
        };
        const moved =
          (await against(dayAfter(e.since!, 4), dayAfter(e.since!, 29))) -
          (await against("2024-08-01", dayAfter(e.since!, -7)));
        if (moved > -0.05)
          throw new Error(
            `ListTG moves ${(moved * 100).toFixed(1)} cm against Havneby, not down 5 cm`,
          );
      },
    },
    {
      id: "cmems-wangerooge-west-2026-dropout",
      stations: ["cmems/WangeroogeTG"],
      since: "2026-10-26",
      until: "2026-10-30",
      handling: "flagged",
      error:
        "CMEMS's copy of the WSV's Wangerooge West gauge reads −7.45 m from 20:30 UTC on 25 October 2026 to 13:40 UTC on 29 October, as PEGELONLINE's −2.40 m (erratum `pegelonline-wangerooge-west-2026-dropout`). CMEMS flags 293 of the 363 values below −4 m probably bad and leaves the other 70 unflagged, with its preliminary flag. The store holds no value on 28 October.",
      response:
        "26 to 29 October 2026 is flagged `suspect`, keeping the source flag as `source_flag`. QC flags the 20 unflagged −7.45 m values of 25 October, and the span flags the 50 of 26 and 27 October.",
      evidence:
        "Found with erratum `pegelonline-wangerooge-west-2026-dropout`, November 2026. The store's 2026 file for the gauge has 363 values below −4 m, none before 20:30 UTC on 25 October and none after 13:40 UTC on 29 October: 20 on 25 October, 116 on 26, 144 on 27 and 83 on 29. CMEMS flags 90 of the 26th's, 120 of the 27th's and all of the 29th's, and none of the 25th's. The 20 on 25 October are from 20:30 to 23:50 UTC, the 26 on 26 October from 00:00 to 16:10, and the 24 on 27 October from 12:00 to 15:50. A fresh fetch of the gauge's 2026 levels in November 2026 returns none for 28 October either, while PEGELONLINE's has 1,440, all −2.40 or −2.41 m.",
      reported: null,
      report: null,
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        await allSuspect(store, id, e.since!, e.until!);
        const low = (await levels(store, id, dayAfter(e.since!, 1))).filter(
          (o) => o.level < -7,
        ).length;
        if (low < 100)
          throw new Error(`the store holds ${low} Wangerooge levels below −7 m on 27 October 2026`);
        // CMEMS leaves 25 October's dropout unflagged; QC flags it.
        const first = (await levels(store, id, dayAfter(e.since!, -1))).filter((o) => o.level < -7);
        if (!first.length)
          throw new Error("the store holds no Wangerooge levels below −7 m on 25 October 2026");
        const missed = first.filter((o) => o.flag < Flag.suspect);
        if (missed.length)
          throw new Error(
            `${missed.length} of ${first.length} Wangerooge levels below −7 m on 25 October 2026 aren't suspect, the first at ${iso(missed[0]!.time)}`,
          );
        if (!first.some((o) => (o.source_flag ?? Flag.good) < Flag.suspect))
          throw new Error("CMEMS flags every Wangerooge level below −7 m on 25 October 2026");
        const held = await store.levels(id, "2026-10-28", "2026-10-29");
        if (held.length)
          throw new Error(`the store holds ${held.length} Wangerooge levels on 28 October 2026`);
        for (const day of ["2026-10-27", "2026-10-29"]) await levels(store, id, day);
      },
    },
    {
      id: "cmems-holyhead-2026-erratic",
      stations: ["cmems/Holyhead", "gesla/holyhead-hol-gbr-cmems"],
      since: "2026-02-03",
      until: "2026-02-21",
      handling: "flagged",
      error:
        "CMEMS's copy of the Holyhead gauge carries the erratic readings of the EA's record of it from 3 to 20 February 2026: 86 of the 430 values it holds read above 7 m, up to 12.05 m, where the highest water in the rest of 2026, outside 1 to 20 February and 8 to 14 April, is 6.51 m. CMEMS flags none of them.",
      response:
        "3 to 20 February 2026 is flagged `suspect`, keeping the source flag as `source_flag`. QC flags 14 of the 86 values above 7 m, so the span flags the rest and the readings between them.",
      evidence:
        "Found in November 2026 while reading back the EA's Holyhead record (`ea/E70539`), whose readings from 1 to 20 February are erratic, between the −3.05 m floor and 8.94 m above Ordnance Datum, 3.46 m being the highest water in the rest of 2026. CMEMS's values agree with the EA's at −3.05 m, its datum difference, through 31 January and from 21 February. The store holds no CMEMS value on 1 February and 9 on 2 February, all within the tide, and GESLA's copy of the CMEMS record (`gesla/holyhead-hol-gbr-cmems`) holds the same values at all 421 times the two share, on all 18 days of the span. BODC's record of the gauge (`bodc/hol`) stays between 0.4 and 6.2 m on those days.",
      reported: null,
      report: null,
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        await allSuspect(store, id, e.since!, e.until!);
        const high = (await levels(store, id, "2026-02-10")).filter((o) => o.level > 7);
        if (!high.length) throw new Error(`the store holds no ${id} level above 7 m on 2026-02-10`);
        // CMEMS flags none of them, as the entry says.
        const flagged = high.filter((o) => (o.source_flag ?? Flag.good) >= Flag.suspect);
        if (flagged.length)
          throw new Error(
            `CMEMS flags ${flagged.length} of ${id}'s ${high.length} levels above 7 m on 2026-02-10`,
          );
        for (const day of ["2026-01-25", "2026-02-25"]) {
          const top = Math.max(...(await levels(store, id, day)).map((o) => o.level));
          if (top > 6.7) throw new Error(`${id}'s highest level on ${day} is ${top} m, past 6.7 m`);
        }
      },
    },
    {
      id: "cmems-holyhead-2026-april-erratic",
      stations: ["cmems/Holyhead", "gesla/holyhead-hol-gbr-cmems"],
      since: "2026-04-10",
      until: "2026-04-11",
      handling: "flagged",
      error:
        "CMEMS's copy of the Holyhead gauge reads 7.88, 10.37, 8.82 and 9.81 m at 14:00, 15:00, 16:00 and 19:00 UTC on 10 April 2026, above 6.51 m, the highest water in the rest of 2026 outside 1 to 20 February and 8 to 14 April. CMEMS flags none of them.",
      response:
        "10 April 2026 is flagged `suspect`, keeping the source flag as `source_flag`. QC flags the 9.81 m value, so the span flags the other three and the day's other readings.",
      evidence:
        "Found in November 2026 while reading back the EA's Holyhead record (`ea/E70539`), which is erratic from 8 to 14 April. The store holds 10 CMEMS values on 10 April, from 14:00 to 23:00 UTC, and no value from 8 to 14 April outside 0.3 to 6.5 m on any other day. GESLA's copy of the CMEMS record (`gesla/holyhead-hol-gbr-cmems`) holds the same 10 values that day.",
      reported: null,
      report: null,
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        await allSuspect(store, id, e.since!, e.until!);
        const high = (await levels(store, id, "2026-04-10")).filter((o) => o.level > 7);
        if (!high.length) throw new Error(`the store holds no ${id} level above 7 m on 2026-04-10`);
        // CMEMS flags none of them, as the entry says.
        const flagged = high.filter((o) => (o.source_flag ?? Flag.good) >= Flag.suspect);
        if (flagged.length)
          throw new Error(
            `CMEMS flags ${flagged.length} of ${id}'s ${high.length} levels above 7 m on 2026-04-10`,
          );
        for (const day of ["2026-04-05", "2026-04-20"]) {
          const top = Math.max(...(await levels(store, id, day)).map((o) => o.level));
          if (top > 6.7) throw new Error(`${id}'s highest level on ${day} is ${top} m, past 6.7 m`);
        }
      },
    },
    {
      id: "cmems-fill-values",
      stations: [
        "cmems/AWGTG",
        "cmems/ArunPlatformTG",
        "cmems/BrightonTG",
        "cmems/DealPierTG",
        "cmems/ExmouthTG",
        "cmems/HastingsPierTG",
        "cmems/K141TG",
        "cmems/L91TG",
        "cmems/MarienleuchteTG",
        "cmems/SaintPierreEtMiquelonTG",
        "cmems/SandownPierTG",
        "cmems/ScarboroughTG",
        "cmems/SecondSevernCrossingTG",
        "cmems/SwanagePierTG",
      ],
      since: "2013-01-01",
      handling: "dropped",
      error:
        "These 14 CMEMS series hold levels no gauge can read, outside the store's span of −500 to 9,000 m: 17,626 values in 63 station-years from 2013 to 2026. AWG, K14 and L9 use 999,999.06 m as a fill value. The series of England's regional coastal monitoring gauges (Arun Platform, Brighton, Deal Pier, Exmouth, Hastings Pier, Sandown Pier, Scarborough, Second Severn Crossing and Swanage Pier) hold hundreds of different values from about −1.05 × 10¹¹ m to 214,000 m, Marienleuchte −3,350 m in 2026 and Saint-Pierre-et-Miquelon up to 2.4 × 10¹² m.",
      response:
        "The adapter leaves out a value outside the store's span (`SPAN_M` in src/span.ts) as missing, counts them, and requalify drops any the store holds, values CMEMS keeps (`keepsStored`) among them. Backfill writes a year of nothing else as its rows flagged `bad`, and requalify and compaction keep such a file, with a warning.",
      evidence:
        "November 2026. A scan of the range of levels in every one of the store's GESLA and CMEMS year files (145,149 files) found 205 holding a level outside the span, which were then read in full; each of them also has a `bad` value, as QC flags every level outside the span. GESLA's copies of the same gauges hold the same values (erratum `gesla-fill-values`). GESLA's records of Bayonne, Villefranque, Pont Seudre and Teignmouth also hold fill values in years CMEMS's own series no longer serve, and CMEMS's Ceuta series (`IDSL-Ceuta`) has no value outside the span. REFMAR's own Saint-Pierre-et-Miquelon series (`refmar/115`) holds levels of 0.2 to 2.9 m in 2024, with no value outside the span.",
      // Marienleuchte's 2026 is the one station-year the entry names.
      check: (store) => impossibleDropped(store, "cmems/MarienleuchteTG", 2026),
    },
    {
      id: "cmems-kornwerderzand-2025-10-05-ramp",
      stations: ["cmems/KornwerderzandBuitenTG", "cmems/KornwerderzandTG"],
      since: "2025-10-05",
      until: "2025-10-06",
      handling: "flagged",
      error:
        "CMEMS's Kornwerderzand levels from 04:40 to 08:40 UTC on 5 October 2025 fall slowly from 1.60 to 1.49 m, flagged good, through a storm high water of about 2.75 m.",
      response:
        "5 October 2025 is flagged `suspect` in both CMEMS records, keeping CMEMS's own flag as `source_flag`. Errata spans are whole days, so the day's other values are flagged too. GESLA's copies of these records hold the same values (erratum `gesla-kornwerderzand-2025-10-05-ramp`).",
      evidence:
        "RWS's own record of the gauge (rws/kornwerderzand.waddenzee.buitenhaven) reads 2.66 to 2.77 m falling to 1.76 m over the same 25 values, RWS Harlingen peaks at 2.86 m at 05:30 UTC, and a prediction of the gauge from Harlingen and West-Terschelling reads 2.74 to 1.73 m. CMEMS has no values from 04:00 to 04:30 UTC and matches RWS again from 08:50 UTC. `cmems/KornwerderzandTG` and `cmems/KornwerderzandBuitenTG` hold the same values and flags on every row of the day, and on all 85,513 rows of 2025 and 2026. CMEMS's copies of RWS's Harlingen, Den Oever, Vlieland and Den Helder gauges follow the storm that morning, Harlingen's to the centimeter of RWS's own, and `cmems/KornwerderzandBinnenTG`, on the IJsselmeer side of the locks, doesn't see it. Checked in November 2026.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        for (const id of e.stations!) {
          const ramp = (await levels(store, id, e.since!)).filter(
            (o) => o.time >= Date.UTC(2025, 9, 5, 4, 40) && o.time <= Date.UTC(2025, 9, 5, 8, 40),
          );
          if (ramp.length < 20 || ramp.some((o) => o.level > 1.7))
            throw new Error(
              `${id} doesn't hold the ramp below 1.7 m from 04:40 to 08:40 on 5 October 2025: ${ramp.length} values up to ${Math.max(...ramp.map((o) => o.level))} m`,
            );
        }
      },
    },
    {
      id: "cmems-kornwerderzand-2026-07-26-off",
      stations: ["cmems/KornwerderzandBuitenTG", "cmems/KornwerderzandTG"],
      since: "2026-07-26",
      until: "2026-07-28",
      handling: "flagged",
      error:
        "CMEMS's Kornwerderzand levels at 00:30, 06:30, 19:40 and 19:50 UTC on 26 July 2026 and 01:50 to 02:00 UTC on 27 July are 13 to 27 cm off the tide.",
      response:
        "26 and 27 July 2026 are flagged `suspect` in both CMEMS records, keeping CMEMS's own flag as `source_flag`. Errata spans are whole days, so the days' other values are flagged too.",
      evidence:
        "Against a prediction of the gauge from RWS Harlingen and Den Oever (2.8 cm RMS where the copies agree), while RWS's record of the gauge is within 7 cm. At 2026-07-27 02:00 UTC CMEMS reads -0.37 m, RWS -0.07 m and the prediction -0.10 m. The values carry CMEMS's good flag (`source_flag` 0), so they come from CMEMS's history files. Both CMEMS records hold the same values and flags on every row of the two days. CMEMS's copies of RWS Harlingen and Den Oever match RWS's own on both days, and GESLA's copies of these records end on 2026-05-31. Checked in November 2026.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        for (const id of e.stations!) {
          // The tide doesn't rise 0.2 m in the 10 minutes after the 02:00 value.
          const at = new Map(
            (await levels(store, id, dayAfter(e.until!, -1))).map((o) => [o.time, o.level]),
          );
          const [off, next] = [
            at.get(Date.UTC(2026, 6, 27, 2)),
            at.get(Date.UTC(2026, 6, 27, 2, 10)),
          ];
          if (off === undefined || next === undefined)
            throw new Error(`${id} has no levels at 02:00 and 02:10 on 27 July 2026`);
          if (next - off <= 0.2)
            throw new Error(
              `${id} rises ${(next - off).toFixed(2)} m from 02:00 to 02:10 on 27 July 2026, not over 0.2 m`,
            );
        }
      },
    },
    {
      id: "cmems-buesum-spikes",
      stations: ["cmems/BuesumTG", "gesla/buesumtg-bue-deu-cmems"],
      since: "2024-02-25",
      until: "2025-05-05",
      handling: "flagged",
      error:
        "CMEMS's Büsum record has spikes of up to 3 m and repeated values from February 2024 to early May 2025 that PEGELONLINE's record of the gauge doesn't have. GESLA's copy of the CMEMS record carries the same values.",
      response:
        "25 February 2024 to 4 May 2025 is flagged `suspect`, keeping each record's own flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026, in GESLA's copy of the CMEMS record (`gesla/buesumtg-bue-deu-cmems`). The copy equals PEGELONLINE's Büsum (`pegelonline/9510095`) to 0.0 cm through January 2024. From 25 February 2024 it differs by 3 cm RMS on most days, from values held for several 10-minute steps, and by 34 to 101 cm on 25 February, 18 March, 22 April and 1 to 3 August 2024, from spikes of up to 3 m. From 5 May 2025 to the copy's end in May 2026 it matches PEGELONLINE's again, within 2 cm RMS every day. CMEMS's own record (`cmems/BuesumTG`) holds the same values at all 21,581 times the two share, on 150 days in five 30-day pieces spread over the span's 435, so the spikes are CMEMS's.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "cmems-kilrush-2025-01-09-offset",
      stations: ["cmems/KilrushLough", "gesla/kilrushlough-kil-irl-cmems"],
      since: "2025-01-09",
      until: "2025-01-10",
      handling: "flagged",
      error:
        "CMEMS's hourly Kilrush Lough record holds 4 values about 6 m low, from 02:00 to 05:00 UTC on 9 January 2025, unflagged, from the drop the Marine Institute's own record has. GESLA's copy of the CMEMS record carries the same values, with GESLA's good flag.",
      response:
        "9 January 2025 is flagged `suspect`, keeping each record's own flag as `source_flag`. Errata spans are whole days, so the day's other values are flagged too.",
      evidence:
        "In the store, checked in November 2026: GESLA's copy of the CMEMS record (`gesla/kilrushlough-kil-irl-cmems`) has 4 values below −3 m, down to −5.95 m, from 02:00 to 05:00 with flag good, against daily medians of 0.13 m on 8 January and 0.07 m on 10 January. CMEMS's own hourly record (`cmems/KilrushLough`) holds the same values at all 24 times the two share that day. The drop is the one in erratum `marine-institute-kilrush-2025-01-09-offset`; CMEMS's hourly values aren't a copy of the Marine Institute's value for value, so the entry is CMEMS's own.",
      // The drop is kept, flagged, in each record.
      check: async (store, e) => {
        await flaggedSpan(store, e);
        for (const id of e.stations!) {
          const low = (await levels(store, id, e.since!)).filter((o) => o.level < -3);
          if (low.length !== 4)
            throw new Error(
              `the store holds ${low.length} ${id} levels below −3 m on ${e.since}, not 4`,
            );
        }
      },
    },
    {
      id: "cmems-emden-2025-07-whole-centimeters",
      stations: ["cmems/EmdenTG", "gesla/emdentg-emd-deu-cmems"],
      since: "2025-07-01",
      handling: "kept",
      error:
        "CMEMS's Emden levels are whole centimeters from 00:00 UTC on 1 July 2025; the 10-minute values before it have millimeters. The gauge itself reports whole centimeters.",
      response:
        "The store keeps CMEMS's values as served. The adapter reads each value as it is and doesn't round, so the whole centimeters come from CMEMS's files. GESLA's copy of the record holds the same values.",
      evidence:
        "Every one of `cmems/EmdenTG`'s levels from 2025-07-01 is a whole centimeter, and none before is, to 2025-06-30 23:50 UTC. Before July 2025, each level is PEGELONLINE's Emden Neue Seeschleuse level (`pegelonline/3970010`, whole centimeters in its own PNP datum) less 5.011 m, at all 21,768 times the two share; from July 2025 it is less 5.01 m at 60,755 of 65,724 shared times and less 5.02 m at 3,739 more, and the other 1,230 differ by other amounts, so CMEMS's values aren't PEGELONLINE's value for value. GESLA's copy (`gesla/emdentg-emd-deu-cmems`) holds `cmems/EmdenTG`'s value at all 47,996 times it has from 2025-07-01 to its end on 2026-05-31. PEGELONLINE's own values are whole centimeters throughout, so the change is in how CMEMS's source offsets the series, not in the gauge.",
      check: async (store, e) => {
        const whole = (o: { level: number }) =>
          Math.abs(o.level * 100 - Math.round(o.level * 100)) < 1e-4;
        for (const id of e.stations!)
          for (const day of [e.since!, "2025-12-15", "2026-03-01"]) {
            const rows = await levels(store, id, day);
            const fine = rows.filter((o) => !whole(o));
            if (fine.length)
              throw new Error(
                `${fine.length} of ${rows.length} ${id} levels on ${day} aren't whole centimeters`,
              );
          }
        const before = await levels(store, e.stations![0]!, dayAfter(e.since!, -1));
        if (before.every(whole))
          throw new Error("Emden's levels on 2025-06-30 are whole centimeters, not millimeters");
      },
    },
    {
      id: "cmems-st-pauli-wrong-minute",
      stations: ["cmems/StPauliTG", "gesla/stpaulitg-stp-deu-cmems"],
      since: "2025-03-01",
      until: "2026-07-01",
      handling: "kept",
      error:
        "From March 2025, CMEMS's St. Pauli record (`cmems/StPauliTG`) and GESLA 4.1's copy of it have about 20% of their 10-minute values taken from a different minute than their timestamp says. Most are 1 or 2 cm off, but some are up to 42 cm off at mid-tide. GESLA flags all of them as correct and usable, and CMEMS flags 8 of the 25 that are over 8 cm.",
      response:
        "The store keeps the values as GESLA and CMEMS serve them. The group's preferred station is `pegelonline/5952050`, which takes its history from HPA's own archive on kuestendaten.de, and that archive has the right values through June 2026. The span ends where HPA's file does: later months have no file to compare with, and the 9 November 2026 value is in erratum `pegelonline-st-pauli-2026-11-09-dip`.",
      evidence:
        "I compared GESLA's record (`stpaulitg-stp-deu-cmems`, created 2026-07-19) with HPA's 1-minute file for gauge 5952050 from kuestendaten.de (downloaded 2026-11-09, shifted from UTC+1 to UTC).\n\n- From 1999-11-01 to 2025-02-28, every one of about 1.3 million shared 10-minute times differs by exactly 5.004 m, which is the gauge zero's offset to NHN. That holds for all 12,954 times in December 2024 to February 2025 too.\n- From 2025-03-01 03:40 to the end of the record on 2026-05-31, 12,838 of 65,622 shared times differ in that download. Of those, 10,207 are off by 1 cm, 1,991 by 2 cm, 640 by 3 cm or more, 101 of them by more than 5 cm, up to 42 cm. The store's own files give 65,600 shared times and 71 over 5 cm, a difference of counting that isn't explained. Every month from March 2025 to May 2026 has between 759 and 931.\n- At 11,803 of the 12,838, GESLA's value equals HPA's value from a minute within 10 minutes of the stated time, most often 1 minute before or after. The large differences come from minutes 5 to 29 away, on the steep part of the tide. 5,495 are single points with both 10-minute neighbors matching HPA exactly.\n- HPA's series is smooth around these times. Its largest 1-minute step near the 101 large differences is 3 cm. Against Seemannshöft and Blankenese, two HPA gauges downstream, HPA's St. Pauli value is the one that fits the local difference between the gauges at 100 of the 101 large differences. The median departure is 1 cm for HPA and 6 cm for GESLA.\n- Example (UTC, meters above gauge zero): on 2025-05-14 06:10, HPA has 6.12 and GESLA 5.82. Seemannshöft has 6.04, and both copies have 6.29 at 06:00 and 5.98 at 06:20.\n- In the store's files, `cmems/StPauliTG` holds the same values as GESLA's at all 126,816 times the two share from 2024 to 31 May 2026, and carries on after GESLA's copy ends. Against the store's `pegelonline/5952050`, which holds HPA's file, 12,838 of 65,600 shared times from 2025-03-01 03:40 to 31 May 2026 differ, and 850 of 4,282 in June 2026, the last month of HPA's file. Of the 13,688, 71 differ by more than 5 cm in the 65,600, and 25 by more than 8 cm over the whole span, each 8 to 40 cm below the CMEMS record's own neighbors where HPA's file is smooth. CMEMS flags 8 of the 25, 30 to 42 cm off; the other 17 are 9 to 26 cm off and unflagged. Example: on 2026-06-05 00:20, HPA's file has 3.540 m above gauge zero (−1.464 m NHN) and CMEMS −1.554 m.\n- From 9 October to 23 November 2026 the store's `pegelonline/5952050` holds values from PEGELONLINE's REST API, which equal the CMEMS record at all 4,537 shared times, including a value 42 cm below its neighbors at 04:10 UTC on 9 November with 04:11 missing (erratum `pegelonline-st-pauli-2026-11-09-dip`). The wrong minutes may come from the WSV's live feed, not from CMEMS or GESLA. No HPA file covers those months, so that isn't confirmed.\n\nNo other record of the gauge covers March 2025 to June 2026, and none of later months has HPA's file to compare with. BSH's `508P` holds predictions only.",
      // Kept as served: 2025-05-14 06:10 holds a value from another minute, 16 cm below the next on a falling tide (HPA has it 14 cm above).
      check: async (store, e) => {
        for (const id of e.stations!) {
          const rows = await levels(store, id, "2025-05-14");
          const at = (hhmm: string) =>
            rows.find((o) => o.time === Date.parse(`2025-05-14T${hhmm}:00Z`))?.level;
          const [before, wrong, after] = [at("06:00"), at("06:10"), at("06:20")];
          if (before === undefined || wrong === undefined || after === undefined)
            throw new Error(
              `the store holds no ${id} value at 06:00, 06:10 or 06:20 on 2025-05-14`,
            );
          if (!(wrong < after - 0.1 && after < before))
            throw new Error(
              `${id} reads ${before}, ${wrong} and ${after} m at 06:00, 06:10 and 06:20 on 2025-05-14, not the dip`,
            );
        }
        // HPA's file is in meters above gauge zero, 5.004 m below NHN, which CMEMS reports in.
        const hpa = await levels(store, "pegelonline/5952050", "2026-06-05");
        const cmems = await levels(store, "cmems/StPauliTG", "2026-06-05");
        const time = Date.parse("2026-06-05T00:20:00Z");
        const [h, c] = [hpa.find((o) => o.time === time), cmems.find((o) => o.time === time)];
        if (!h || !c) throw new Error("the store holds no St. Pauli value at 00:20 on 2026-06-05");
        if (!(h.level - 5.004 - c.level > 0.05))
          throw new Error(
            `CMEMS reads ${c.level} m at 00:20 on 2026-06-05 and HPA's file ${h.level - 5.004} m, not the 9 cm dip`,
          );
      },
    },
    {
      id: "cmems-west-bay-harbour-offset",
      stations: ["cmems/WestBayHarbourTG", "gesla/westbayharbourtg-wes-gbr-cmems"],
      since: "2024-09-24",
      until: "2025-11-06",
      handling: "flagged",
      error:
        "CMEMS's West Bay Harbour record reads about 0.093 m lower than the Channel Coastal Observatory's (`cco/95`) from 24 September 2024 to 13:00 UTC on 5 November 2025, and equals it to 0.0 m before and after. GESLA's copy of the CMEMS record carries the same values.",
      response:
        "24 September 2024 to 5 November 2025 is flagged `suspect`, keeping each record's own flag as `source_flag`. Errata spans are whole days, so the 11 matching hours after the step ends on 5 November are flagged too. The Observatory's record, which has no step, is the one to use.",
      evidence:
        "In the store, checked in November 2026: at the 58,227 times the two records share in that span they differ by a median of 0.093 m (CMEMS lower), and at every shared time before and after by 0.0 m. Against Weymouth, a different gauge 25 km east, CMEMS's West Bay Harbour reads 1.46 m above it in August 2024, 1.36 to 1.39 m above in every month from October 2024 to October 2025, and 1.48 m above in December 2025, while the Observatory's West Bay Harbour reads 1.46 to 1.49 m above it in all of them. The step is in the CMEMS record, not the Observatory's, which has no step at either end. The start falls in a gap in the CMEMS record from 20 to 24 September 2024; the last offset reading is at 13:00 UTC on 5 November 2025 and the first matching one at 13:10. Why CMEMS's values differ isn't known.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        for (const id of e.stations!) await allSuspect(store, id, e.since!, e.until!);
        // The step stays in the stored records; a refetch that removes it means the entry needs looking at again.
        const day = "2025-03-01";
        const cco = await levels(store, "cco/95", day);
        const at = new Map(cco.map((o) => [o.time, o.level]));
        for (const id of e.stations!) {
          const own = await levels(store, id, day);
          const diffs = own
            .flatMap((o) => (at.has(o.time) ? [at.get(o.time)! - o.level] : []))
            .sort((a, b) => a - b);
          const median = diffs[Math.floor(diffs.length / 2)];
          if (median === undefined || median < 0.08 || median > 0.11)
            throw new Error(
              `${id} is ${median?.toFixed(3)} m from cco/95 on ${day} at ${diffs.length} shared times, not about 0.093 m`,
            );
        }
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
