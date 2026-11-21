import { dayAfter, flaggedSpan, type ErrataFile, type StoreReader } from "../../errata.ts";
import { Flag } from "../../schema.ts";
import { median } from "../../stats.ts";

/** A station's levels from `since` to before `until`, a day by default; throws when the store holds none. */
async function levels(store: StoreReader, id: string, since: string, until = dayAfter(since, 1)) {
  const rows = await store.levels(id, since, until);
  if (!rows.length) throw new Error(`the store holds no ${id} levels from ${since} to ${until}`);
  return rows;
}

/** Throws when most of `id`'s levels on `day`, outside the span, are flagged suspect or worse. */
async function unflagged(store: StoreReader, id: string, day: string) {
  const rows = await levels(store, id, day);
  // QC flags a few values of its own around a fault, so only most of the day is asked of it.
  const n = rows.filter((o) => o.flag >= Flag.suspect).length;
  if (n > rows.length / 2)
    throw new Error(`${n} of ${rows.length} ${id} levels on ${day}, outside the span, are flagged`);
}

const dayMedian = async (store: StoreReader, id: string, day: string) =>
  median((await levels(store, id, day)).map((o) => o.level));

/** Throws unless `id`'s median on `bad` less its median on `good` is past `limit`, on the side of its sign. */
async function offset(store: StoreReader, id: string, bad: string, good: string, limit: number) {
  const d = (await dayMedian(store, id, bad)) - (await dayMedian(store, id, good));
  if (limit < 0 ? d >= limit : d <= limit)
    throw new Error(
      `${id}'s median on ${bad} is ${d.toFixed(2)} m from ${good}'s, not past ${limit} m`,
    );
}

/** Gauge `a`'s levels less gauge `b`'s at the times both have from `since` to before `until`. */
async function paired(
  store: StoreReader,
  a: string,
  b: string,
  since: string,
  until = dayAfter(since, 1),
) {
  const other = new Map((await levels(store, b, since, until)).map((o) => [o.time, o.level]));
  const diffs = (await levels(store, a, since, until))
    .filter((o) => other.has(o.time))
    .map((o) => o.level - other.get(o.time)!);
  // Half a day of hourly pairs.
  if (diffs.length < 12)
    throw new Error(`${a} and ${b} share ${diffs.length} times from ${since} to ${until}`);
  return diffs;
}

/** Throws unless more than a quarter of TGB HAROPA LH's (`id`) levels on `day` are over 0.3 m off VIGIE HAROPA LH's, on the same zero. */
async function dropouts(store: StoreReader, id: string, day: string) {
  const diffs = await paired(store, id, "refmar/6366", day);
  const off = diffs.filter((d) => Math.abs(d) > 0.3).length;
  if (off <= diffs.length / 4)
    throw new Error(
      `${off} of ${diffs.length} TGB HAROPA LH levels on ${day} are over 0.3 m off VIGIE HAROPA LH's`,
    );
}

async function station(store: StoreReader, id: string) {
  const s = await store.station(id);
  if (!s) throw new Error(`the store doesn't list ${id}`);
  return s;
}

const day = (time: string | null) => time?.slice(0, 10) ?? null;

export default {
  errata: [
    {
      id: "refmar-pointe-a-pitre-clock",
      stations: [
        "refmar/125",
        "cmems/PointeAPitreTG",
        "gesla/pointe_a_pitre-125-fra-refmar",
        "gesla/pointeapitretg_60minute-poi-fra-cmems",
      ],
      since: "2020-01-01",
      until: "2025-01-01",
      handling: "flagged",
      error:
        "SHOM's Pointe-à-Pitre levels run 60 to 70 minutes late in 2023 against UHSLC's, CMEMS's and REFMAR's own TICON records, and hardly fit at all in 2020 and 2024, with no steady offset; 2025 fits again.",
      response: "2020 to 2024 is flagged `suspect`, keeping SHOM's own flag as `source_flag`.",
      evidence:
        "`scripts/clock-check.ts`, November 2026: within 10 minutes of UHSLC's record in 2015, 2018, 2021, 2022 and 2025; 60 to 70 minutes late in 2023 against UHSLC's, CMEMS's and REFMAR's own TICON records; r 0.36 in 2020 and 0.15 in 2024. CMEMS's record (`cmems/PointeAPitreTG`) and GESLA's copies of REFMAR's and CMEMS's (`gesla/pointe_a_pitre-125-fra-refmar` and `gesla/pointeapitretg_60minute-poi-fra-cmems`) hold REFMAR's values, within 0.4 cm RMS at the 2,650 to 2,656 times each shares with REFMAR's, on 111 of the 150 days read in five 30-day pieces spread over the span's 1,827.",
      reported: "2026-11-06",
      report:
        "Sent to refmar@shom.fr on 2026-11-06, in French, with the yearly results above. No answer yet.",
      // The store holds no independent record of the gauge for 2023 (CMEMS's copy is SHOM's), so this reads only the flags.
      check: async (store, e) => {
        await flaggedSpan(store, e);
        // The record has no values from 1 to 18 January 2025.
        await unflagged(store, e.stations![0]!, "2025-01-20");
      },
    },
    {
      id: "refmar-kerguelen-raw-hour-late",
      stations: ["refmar/23"],
      since: "1993-04-05",
      until: "2013-06-04",
      handling: "corrected",
      error:
        "SHOM serves Kerguelen's raw series (2), hourly from 5 April 1993 to 3 June 2013, an hour late: each value is the one its 1-minute series (1) carries an hour earlier, and the one UHSLC's, CMEMS's and GESLA's records of the gauge carry an hour earlier.",
      response:
        "The adapter moves the raw series' values at Kerguelen labeled before 4 June 2013 an hour earlier. SHOM's validated hourly series (4), which covers a few months of the span such as November 2001 to March 2003, is on time and kept as served.",
      evidence:
        "November 2026. For every month the raw series covers, SHOM's raw series equals its 1-minute series an hour earlier on every whole hour, and the store's values from it equal GESLA's copy of CMEMS's Kerguelen record (`gesla/kerguelentg_60minute-ker-fra-cmems`) an hour earlier to the millimeter (standard deviation 0.0 cm), while the months the validated series covers equal it at the same time. M2's phase in the store's values is 50 to 57° in 1993 to 2013, against 22 to 28° in UHSLC's record (`uhslc/180`), CMEMS's, GESLA's copy of REFMAR's from an earlier download, and REFMAR's own values before 1993 and from 2017. The store's level match of November 2026 found the gauge equal to UHSLC, GESLA and CMEMS only at an hour's offset, at 0.00 cm. Of SHOM's 173 gauges, only Kerguelen and Dumont d'Urville serve both raw series as hourly values on 1 June 2000 and 1 June 2010. Dumont d'Urville's differ by an hour on 1 June 2000 too, but its stored values, mostly SHOM's validated series, hold one M2 phase from 1996 to 2026, so it isn't moved.",
      // The raw series of June 2010 and the validated one of December 2001 both equal GESLA's copy of CMEMS's record at the same time.
      check: async (store, e) => {
        for (const month of ["2010-06", "2001-12"]) {
          const diffs = await paired(
            store,
            e.stations![0]!,
            "gesla/kerguelentg_60minute-ker-fra-cmems",
            `${month}-01`,
            `${month}-28`,
          );
          // A few of the validated series' values differ from CMEMS's by a centimeter or more.
          const off = diffs.filter((d) => Math.abs(d) > 0.005).length;
          if (off > diffs.length / 20)
            throw new Error(
              `${off} of ${diffs.length} Kerguelen levels in ${month} differ from GESLA's copy of CMEMS's at the same time`,
            );
        }
      },
    },
    {
      id: "refmar-hiva-oa-uhslc-2020-datum",
      stations: ["refmar/495"],
      handling: "corrected",
      error:
        "REFMAR's Hiva Oa (UHSLC) levels before March 2020 read 1.35 m lower than on the current zero.",
      response:
        "The record splits into datum epochs on 5 March 2020, and the epoch before converts to today's zero by adding 1.35 m. That epoch holds through 4 March, as the record's first values back, from 23:00 UTC on the 5th, are already on the new zero. The values stay as served.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against UHSLC's record of the gauge (`uhslc/017`), which has no step: REFMAR's sits 0.24 m above it every year from 2010 to 2015 and 1.59 m above it from 2020 on. UHSLC's record starts in September 2010; REFMAR's yearly medians from 1977 to 2017 stay between 0.68 and 0.91 m, and from 2020 read 2.2 m, so the years before 2010 are on the same zero as 2010 to 2015.",
      until: "2020-03-05",
      check: async (store, e) => {
        const id = e.stations![0]!;
        const [before, after, ...rest] = (await station(store, id)).epochs;
        if (
          rest.length ||
          day(before?.until ?? null) !== e.until ||
          before?.to_current !== 1.35 ||
          day(after?.since ?? null) !== e.until ||
          after?.to_current !== 0
        )
          throw new Error(
            `Hiva Oa's epochs aren't split at 5 March 2020 with 1.35 m before: ${JSON.stringify([before, after, ...rest])}`,
          );
        await unflagged(store, id, "2015-06-15");
        const m = async (since: string, until: string) =>
          median((await levels(store, id, since, until)).map((o) => o.level));
        const d =
          (await m("2021-06-01", "2021-07-01")) - (await m("2015-06-01", "2015-07-01")) - 1.35;
        if (Math.abs(d) > 0.3)
          throw new Error(
            `Hiva Oa's June 2015 median plus 1.35 m is ${d.toFixed(2)} m from June 2021's`,
          );
      },
    },
    {
      id: "refmar-cancale-vigicrues-2021-2025-datum",
      stations: ["refmar/6438"],
      until: "2025-01-21",
      handling: "flagged",
      error:
        "REFMAR's Cancale (Vigicrues) levels from 12 September 2021 to 20 January 2025 are on a zero 1.4 to 2.8 m from the current one, and drift by about 0.8 m within that time.",
      response:
        "The record splits into datum epochs on 12 September 2021 and 21 January 2025. 12 September 2021 to 20 January 2025 is flagged `suspect`, keeping the source's own flag as `source_flag`, and its epoch has no offset to today's zero because it drifts. The epoch before 2021 converts to today's zero by adding 0.13 m.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against Saint-Malo (`refmar/410`), 13 km away: Cancale less Saint-Malo is 0.95 m before 12 September 2021, 3.80 m from 18 to 27 September, 3.23 to 3.28 m in the 90 days after, 2.48 m in the 90 days before 21 January 2025, and 1.04 to 1.11 m since. The values before 2021 are within 0.15 m of the current ones.",
      since: "2021-09-12",
      check: async (store, e) => {
        const id = e.stations![0]!;
        const epochs = (await station(store, id)).epochs;
        const [a, b, c] = epochs;
        if (
          epochs.length !== 3 ||
          day(a!.until) !== e.since ||
          a!.to_current !== 0.13 ||
          day(b!.since) !== e.since ||
          day(b!.until) !== e.until ||
          b!.to_current !== null ||
          day(c!.since) !== e.until
        )
          throw new Error(
            `Cancale's epochs aren't split on 12 September 2021 and 21 January 2025 as the entry says: ${JSON.stringify(epochs)}`,
          );
        await flaggedSpan(store, e);
        const d =
          (await dayMedian(store, id, "2022-06-15")) -
          (await dayMedian(store, "refmar/410", "2022-06-15"));
        if (d <= 2)
          throw new Error(
            `Cancale less Saint-Malo is ${d.toFixed(2)} m on 15 June 2022, not over 2 m`,
          );
      },
    },
    {
      id: "refmar-huahine-2021-datum",
      stations: ["refmar/587"],
      handling: "kept",
      error:
        "SHOM's Huahine levels from 10 October 2021 on are on a zero about 6 m from the record's earlier one, with no change of datum marked.",
      response:
        "The store keeps the values as served: the store holds no independent record of the gauge to show which zero is wrong, so nothing is flagged.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`) over every record the store lists as coastal, November 2026; the store holds no other record of the gauge or gauge nearby to compare, so this rests on the record's own medians. Yearly medians are 0.33 to 0.50 m from 2011 to 2013 and 6.35 to 6.57 m from 2021 on. No other gauge in the store lies within 150 km; GESLA's copies hold the same values.",
      since: "2021-10-10",
      check: async (store, e) => {
        const id = e.stations![0]!;
        await unflagged(store, id, "2011-12-01");
        await unflagged(store, id, "2022-06-15");
        await offset(store, id, "2022-06-15", "2011-12-01", 4);
      },
    },
    {
      id: "refmar-rikitea-2007-datum",
      stations: ["refmar/43"],
      since: "2007-12-25",
      until: "2012-05-14",
      handling: "flagged",
      error:
        "SHOM's Rikitea levels from 25 December 2007 to 13 May 2012 are on other zeros than the record's later one, about 5 to 6 m apart. The record starts at 23:00 UTC on 25 December 2007 and has no values from 18 April to 14 May 2012, whose first value, at 21:54 UTC, is on the later zero.",
      response:
        "25 December 2007 to 13 May 2012 is flagged `suspect`, keeping SHOM's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against UHSLC's record of the gauge (`uhslc/016`), 0.6 km away: the difference is 4.93 m to September 2010, 5.86 m to May 2012, and −0.30 m after.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await offset(store, e.stations![0]!, "2011-06-15", "2013-06-15", 4);
      },
    },
    {
      id: "refmar-papeete-uhslc-2010-offset",
      stations: ["refmar/6385"],
      since: "2010-09-13",
      until: "2011-09-13",
      handling: "flagged",
      error:
        "REFMAR's Papeete (UHSLC) levels sit about 0.95 m high from 22:00 UTC on 13 September 2010 to 12 September 2011.",
      response:
        "13 September 2010 to 12 September 2011 is flagged `suspect`, keeping the source's own flag as `source_flag`. An erratum spans whole UTC days, so the 22 hours of 13 September before the step are flagged with them.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against SHOM's Papeete (`refmar/383`) and Vairao (`refmar/317`): the differences are 0.01 to 0.04 m before and after and 0.96 to 0.99 m over the span.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const d = median(await paired(store, e.stations![0]!, "refmar/383", "2011-03-15"));
        if (d <= 0.7)
          throw new Error(
            `Papeete (UHSLC) less SHOM's Papeete is ${d.toFixed(2)} m on 15 March 2011, not over 0.7 m`,
          );
      },
    },
    {
      id: "refmar-dumont-durville-datums",
      stations: ["refmar/108"],
      since: "1997-02-28",
      handling: "kept",
      error:
        "SHOM's Dumont d'Urville levels change zero four times with no change of datum marked: about 1.1 m in 1996 and from December 1997 to February 2000, 6.0 m from March to October 1997 and from March 2000 to 2005, 5.1 m from 2006 to 9 March 2023, and 1.3 m since, from 23:20 UTC on 9 March.",
      response:
        "The record splits into a datum epoch at each change of zero, and the store keeps the values as served. The store holds no independent record of the gauge to measure the offsets, so the epochs before March 2023 have none and stay out of the combined series, readable on their own zeros; nothing is flagged. The last epoch starts on 10 March 2023, so the two values at 23:20 and 23:40 UTC on 9 March, already on the new zero, sit at the end of the epoch before; an erratum flags whole days, and flagging the 9th would mark 24 good values to catch two.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`) over every record the store lists as coastal, November 2026; the store's only other record of the gauge, UHSLC's (`uhslc/189`), equals this one to the millimeter from 2008 to February 2023, so it is a copy rather than a check, and this rests on the record's own medians. Monthly medians are about 1.1 m in early 1996 and from December 1997 to February 2000, 5.9 to 6.1 m from March to October 1997 and from March 2000 to 2005, 5.0 to 5.3 m from 2006 to 2022, and 1.2 to 1.3 m from March 2023 on. GESLA's REFMAR copy holds the same values.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        const epochs = (await station(store, id)).epochs;
        const since = epochs
          .slice(1)
          .map((e) => day(e.since))
          .join(", ");
        if (
          since !== `${e.since}, 1997-12-17, 2000-03-03, 2006-01-09, 2023-03-10` ||
          epochs.slice(0, -1).some((e) => e.to_current !== null) ||
          epochs.at(-1)!.to_current !== 0
        )
          throw new Error(
            `Dumont d'Urville's epochs aren't the entry's, with offsets only on the last: ${JSON.stringify(epochs)}`,
          );
        for (const d of ["1997-06-15", "2008-06-15", "2024-06-15"]) await unflagged(store, id, d);
        await offset(store, id, "1997-06-15", "2024-06-15", 3);
        await offset(store, id, "2008-06-15", "2024-06-15", 3);
      },
    },
    {
      id: "refmar-le-havre-tgb-2026-08-dropouts",
      stations: ["refmar/6372"],
      since: "2026-08-03",
      until: "2026-09-06",
      handling: "flagged",
      error:
        "REFMAR's TGB HAROPA LH levels at Le Havre drop toward 0 m on their zero, as low as −0.06 m, for hours at a time on most days from 12:30 on 3 August to 17:20 on 5 September 2026, while the tide there runs from about 1 to 8 m.",
      response:
        "3 August to 5 September 2026 is flagged `suspect` whole, keeping the source's own flag as `source_flag`, since the drops come on nearly every day of it. The wrong values are SHOM's raw ones; once its validated values for the span replace them, this entry can be retired.",
      evidence:
        "Compared, November 2026, with VIGIE HAROPA LH (`refmar/6366`), 1 km away on the same zero (ZI), which agrees with this gauge to a median of 0.085 m in June 2026. Over the span, 2,511 of 4,401 values are more than 0.3 m off it, reading −0.06 to 4.18 m, all of them SHOM's raw values, stored as preliminary. From 6 to 13 September none is more than 0.3 m off.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await dropouts(store, e.stations![0]!, "2026-08-20");
      },
    },
    {
      id: "refmar-le-havre-tgb-2026-09-dropouts",
      stations: ["refmar/6372"],
      since: "2026-09-14",
      until: "2026-09-18",
      handling: "flagged",
      error:
        "REFMAR's TGB HAROPA LH levels at Le Havre drop toward 0 m on their zero again from 20:30 on 14 September to 01:40 on 17 September 2026.",
      response:
        "14 to 17 September 2026 is flagged `suspect` whole, keeping the source's own flag as `source_flag`. The wrong values are SHOM's raw ones; once its validated values for the span replace them, this entry can be retired.",
      evidence:
        "Compared, November 2026, with VIGIE HAROPA LH (`refmar/6366`), 1 km away on the same zero (ZI), which agrees with this gauge to a median of 0.085 m in June 2026. Over the span, 311 of 572 values are more than 0.3 m off it, all of them SHOM's raw values, stored as preliminary. After 01:40 on 17 September the two agree again.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await dropouts(store, e.stations![0]!, "2026-09-15");
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
