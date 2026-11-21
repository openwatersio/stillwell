import { dayAfter, flaggedSpan, type ErrataFile, type StoreReader } from "../../errata.ts";
import { Flag } from "../../schema.ts";
import { median } from "../../stats.ts";

/** A station's levels from `since` to before `until`, a day by default; throws when the store holds none. */
async function levels(store: StoreReader, id: string, since: string, until = dayAfter(since, 1)) {
  const rows = await store.levels(id, since, until);
  if (!rows.length) throw new Error(`the store holds no ${id} levels from ${since} to ${until}`);
  return rows;
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

/** Throws unless every level the store holds for `id` from `since` to before `until` is suspect or worse. */
async function allSuspect(store: StoreReader, id: string, since: string, until: string) {
  const rows = await levels(store, id, since, until);
  const missed = rows.filter((o) => o.flag < Flag.suspect);
  if (missed.length)
    throw new Error(
      `${missed.length} of ${id}'s ${rows.length} levels from ${since} to ${until} aren't suspect, the first at ${new Date(missed[0]!.time).toISOString()}`,
    );
}

/** Throws unless the store holds no levels on `day` at a few gauges, and holds the days either side. */
async function gap(store: StoreReader, day: string) {
  for (const id of ["ea/E70539", "ea/E71239", "ea/E71639"]) {
    const held = (await store.levels(id, day, dayAfter(day, 1))).length;
    if (held)
      throw new Error(`the store holds ${held} ${id} levels on ${day}, which the archive lacks`);
    // Most of a day's 96 readings either side, so the gap is the archive's day alone.
    for (const d of [dayAfter(day, -1), dayAfter(day, 1)]) {
      const n = (await levels(store, id, d)).length;
      if (n < 90)
        throw new Error(
          `the store holds ${n} ${id} levels on ${d}, next to the archive's missing ${day}`,
        );
    }
  }
}

export default {
  errata: [
    {
      id: "ea-holyhead-2026-erratic",
      stations: ["ea/E70539"],
      since: "2026-02-01",
      until: "2026-02-21",
      handling: "flagged",
      error:
        "The EA's Holyhead readings are erratic from 1 to 20 February 2026. Of the 1,920 values the store holds, 357 read between 3.95 and 8.94 m AOD and 148 sit at the −3.05 m floor, while the highest water at Holyhead in the rest of 2026 outside 8 to 14 April is 3.46 m.",
      response:
        "1 to 20 February 2026 is flagged `suspect`, keeping the EA's own flag as `source_flag`. Spans are whole days, so the readings between the erratic ones are flagged with them.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and read back in November 2026 value by value. The readings agree with CMEMS's Holyhead (`cmems/Holyhead`) at −3.05 m, its datum difference, through 31 January, and with BODC's record (`bodc/hol`) at −3.05 m on each day from 22 to 31 January and from 02:00 UTC on 20 February, so the EA's gauge isn't off by a constant before or after. They go wrong from 01:15 UTC on 1 February to 01:45 UTC on 20 February, and agree again from 02:00 UTC on 20 February. CMEMS's copy of the gauge carries the same readings. BODC's record of the gauge (`bodc/hol`), whose values stay between 0.4 and 6.2 m chart datum on those days, follows a tide that neaps on 10 February and springs on 19 February.",
      reported: null,
      report: null,
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        await allSuspect(store, id, e.since!, e.until!);
        const high = (await levels(store, id, "2026-02-10")).filter((o) => o.level > 3.95);
        if (!high.length)
          throw new Error(`the store holds no ${id} level above 3.95 m on 2026-02-10`);
        for (const day of ["2026-01-25", "2026-02-25"]) {
          const top = Math.max(...(await levels(store, id, day)).map((o) => o.level));
          if (top > 3.6) throw new Error(`${id}'s highest level on ${day} is ${top} m, past 3.6 m`);
        }
      },
    },
    {
      id: "ea-holyhead-2026-april-erratic",
      stations: ["ea/E70539"],
      since: "2026-04-08",
      until: "2026-04-15",
      handling: "flagged",
      error:
        "The EA's Holyhead readings are erratic again on 8, 9, 10, 13 and 14 April 2026: 204 of the 654 values from 8 to 14 April read above 3.95 m AOD, up to 8.27 m, or sit at the −3.05 m floor. The readings of 11 and 12 April follow the tide.",
      response:
        "8 to 14 April 2026 is flagged `suspect`, keeping the EA's own flag as `source_flag`. QC flags 196 of the 204 erratic values, so the span flags the other 8 and the readings between them.",
      evidence:
        "Found in November 2026 while reading back erratum `ea-holyhead-2026-erratic`, by counting the readings above 3.95 m AOD or at the floor: the highest water at Holyhead in the rest of 2026, outside 1 to 20 February and 8 to 14 April, is 3.46 m. None of 11 and 12 April's 187 readings is beyond. CMEMS's copy of the gauge (`cmems/Holyhead`) also has erratic values on 10 April.",
      reported: null,
      report: null,
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        await allSuspect(store, id, e.since!, e.until!);
        const high = (await levels(store, id, "2026-04-10")).filter((o) => o.level > 3.95);
        if (!high.length)
          throw new Error(`the store holds no ${id} level above 3.95 m on 2026-04-10`);
        for (const day of ["2026-04-05", "2026-04-20"]) {
          const top = Math.max(...(await levels(store, id, day)).map((o) => o.level));
          if (top > 3.6) throw new Error(`${id}'s highest level on ${day} is ${top} m, past 3.6 m`);
        }
      },
    },
    {
      id: "ea-washpile-2026-offset",
      stations: ["ea/E71339"],
      since: "2026-03-17",
      handling: "flagged",
      error:
        "The EA's Washpile levels are 3.1 to 3.2 m higher against neighboring gauges from 17 March 2026 than they were up to 3 February, through the last values the store holds, on 30 April 2026. The gauge has almost no readings in between (erratum `ea-washpile-2026-gap`), so the shift can't be dated more closely than 4 February to 17 March.",
      response:
        "Values from 17 March 2026 on are flagged `suspect`, keeping the EA's own flag as `source_flag`, until the EA says the gauge is right again.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by hourly differences against three EA gauges within 115 km (`ea/E71239`, `ea/E71124`, `ea/E70039`). Washpile less each of them has medians of 0.04, −3.82 and −0.01 m through 3 February and 3.22, −0.58 and 3.11 m from 5 April, shifts of 3.18, 3.24 and 3.12 m. The five values between, on 17 March, 22 March and 1 April, differ from `ea/E71124`'s nearest reading by −1.33, −1.25, −0.53, −0.56 and −1.03 m, nearer its level after the shift than before, as are `ea/E71239`'s, while `ea/E70039`'s fall between the two levels. Each differs from its gauge's reading minutes apart in time. Monthly medians are 0.25 m in January, −0.09 m in February and 3.39 m in April. The last values, on 30 April, read 29.797 m.",
      reported: null,
      report: null,
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await allSuspect(store, e.stations![0]!, e.since!, "2026-05-01");
        await offset(store, e.stations![0]!, "2026-04-10", "2026-01-21", 2.5);
      },
    },
    {
      id: "ea-washpile-2026-gap",
      stations: ["ea/E71339"],
      since: "2026-02-04",
      until: "2026-04-05",
      handling: "kept",
      error:
        "The EA's archive has five readings for Washpile from 4 February to 4 April 2026, none on a quarter hour: two on 17 March at 12:17 and 12:23 UTC, one on 22 March at 12:42, and two on 1 April at 12:57 and 15:53. It has none on the other 57 of those 60 days. The gauge's last reading before them is at 06:00 UTC on 3 February, and the next at 00:00 UTC on 5 April.",
      response: "The store keeps what the EA serves and leaves the gap.",
      evidence:
        "Read from the EA's daily archive files in November 2026: `GET /archive/readings-<day>.csv` for each of the 60 days from 4 February to 4 April, and for 3 February and 5 April. Only 17 March (2 rows), 22 March (1) and 1 April (2) have a row for E71339. 3 February's file has 25 rows, to 06:00 UTC, and 5 April's has 96.",
      reported: null,
      report: null,
      check: async (store, e) => {
        const id = e.stations![0]!;
        const held = (await store.levels(id, e.since!, e.until!)).map((o) =>
          new Date(o.time).toISOString(),
        );
        const expected = [
          "2026-03-17T12:17:48.000Z",
          "2026-03-17T12:23:54.000Z",
          "2026-03-22T12:42:12.000Z",
          "2026-04-01T12:57:43.000Z",
          "2026-04-01T15:53:53.000Z",
        ];
        if (held.join() !== expected.join())
          throw new Error(
            `the store holds ${id} levels at ${held.join(", ") || "no time"} from ${e.since} to ${e.until}, not at ${expected.join(", ")}`,
          );
        const before = await levels(store, id, "2026-02-03");
        if (before.at(-1)!.time !== Date.parse("2026-02-03T06:00:00Z"))
          throw new Error(`${id}'s last level on 2026-02-03 isn't at 06:00 UTC`);
        const after = await levels(store, id, e.until!);
        if (after[0]!.time !== Date.parse(`${e.until}T00:00:00Z`))
          throw new Error(`${id}'s first level on ${e.until} isn't at 00:00 UTC`);
      },
    },
    {
      id: "ea-dover-2026-offset",
      stations: ["ea/E71639"],
      since: "2026-05-29",
      until: "2026-06-19",
      handling: "flagged",
      error: "The EA's Dover levels sit about 4.6 m low from 29 May to 18 June 2026.",
      response:
        "29 May to 18 June 2026 is flagged `suspect`, keeping the EA's own flag as `source_flag`. The store's QC already flags the gauge's values from 19 June to 31 August.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against REFMAR's Calais (`refmar/55`) and Boulogne-sur-Mer (`refmar/111`): the differences are −3.84 and −4.78 m before and after the span and −8.41 and −9.37 m over it.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        // QC flags the gauge from 19 June itself, so only the day before the span is read outside it.
        await flaggedSpan(store, { ...e, until: null });
        const last = await levels(store, id, dayAfter(e.until!, -1));
        if (last.some((o) => o.flag < Flag.suspect))
          throw new Error(`Dover's levels on ${dayAfter(e.until!, -1)} aren't all suspect`);
        await offset(store, id, "2026-06-05", dayAfter(e.since!, -1), -3);
      },
    },
    {
      id: "ea-archive-missing-2026-07-25",
      stations: "every station",
      since: "2026-07-25",
      until: "2026-07-26",
      handling: "kept",
      error:
        "The EA's archive has no daily file for 25 July 2026, though it holds the days around it; `GET /archive/readings-2026-07-25.csv` answers 404.",
      response:
        "The day has no values from the archive, and the store keeps what it holds for it; the rest of its month is read as usual.",
      evidence:
        "Found in November 2026, when every EA station's 2026 file in the store had no values for July or August. The archive also has no file for 25 July, 16 August or 20 August 2026, and the readings API keeps only about 30 days, so nothing else holds the day.",
      reported: null,
      report: null,
      check: (store, e) => gap(store, e.since!),
    },
    {
      id: "ea-archive-missing-2026-08-16",
      stations: "every station",
      since: "2026-08-16",
      until: "2026-08-17",
      handling: "kept",
      error:
        "The EA's archive has no daily file for 16 August 2026, though it holds the days around it; `GET /archive/readings-2026-08-16.csv` answers 404.",
      response:
        "The day has no values from the archive, and the store keeps what it holds for it; the rest of its month is read as usual.",
      evidence:
        "Found in November 2026, when every EA station's 2026 file in the store had no values for July or August. The archive also has no file for 25 July, 16 August or 20 August 2026, and the readings API keeps only about 30 days, so nothing else holds the day.",
      reported: null,
      report: null,
      check: (store, e) => gap(store, e.since!),
    },
    {
      id: "ea-archive-missing-2026-08-20",
      stations: "every station",
      since: "2026-08-20",
      until: "2026-08-21",
      handling: "kept",
      error:
        "The EA's archive has no daily file for 20 August 2026, though it holds the days around it; `GET /archive/readings-2026-08-20.csv` answers 404.",
      response:
        "The day has no values from the archive, and the store keeps what it holds for it; the rest of its month is read as usual.",
      evidence:
        "Found in November 2026, when every EA station's 2026 file in the store had no values for July or August. The archive also has no file for 25 July, 16 August or 20 August 2026, and the readings API keeps only about 30 days, so nothing else holds the day.",
      reported: null,
      report: null,
      check: (store, e) => gap(store, e.since!),
    },
  ],
  retired: ["ea-holyhead-2026-offset"],
} satisfies ErrataFile;
