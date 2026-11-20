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
      id: "ea-holyhead-2026-offset",
      stations: ["ea/E70539"],
      since: "2026-01-22",
      until: "2026-02-20",
      handling: "flagged",
      error: "The EA's Holyhead levels sit about 1.5 m off from 22 January to 19 February 2026.",
      response:
        "22 January to 19 February 2026 is flagged `suspect`, keeping the EA's own flag as `source_flag`.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against BODC's record of the same gauge (`bodc/hol`): the EA's less BODC's is −3.06 m in the 90 days before and after the span, its datum difference, and −1.57 m over it. GESLA's BODC copy agrees with BODC's.",
      check: async (store, e) => {
        const id = e.stations![0]!;
        await flaggedSpan(store, e);
        // EA less BODC is −3.05 m, their datum difference, outside the span.
        const diff = async (day: string) => {
          const bodc = new Map(
            (await levels(store, "bodc/hol", day)).map((o) => [o.time, o.level]),
          );
          const d = (await levels(store, id, day))
            .filter((o) => bodc.has(o.time))
            .map((o) => o.level - bodc.get(o.time)!);
          if (d.length < 48)
            throw new Error(`the EA's and BODC's Holyhead share ${d.length} times on ${day}`);
          return median(d) + 3.05;
        };
        const [inside, after] = [await diff("2026-02-10"), await diff("2026-02-25")];
        if (Math.abs(inside) < 1 || Math.abs(after) > 0.1)
          throw new Error(
            `the EA's Holyhead sits ${inside.toFixed(2)} m off BODC's on 10 February 2026 and ${after.toFixed(2)} m on 25 February`,
          );
      },
    },
    {
      id: "ea-washpile-2026-offset",
      stations: ["ea/E71339"],
      since: "2026-04-05",
      handling: "flagged",
      error:
        "The EA's Washpile levels jump about 3.1 m from 5 April 2026, through the last values the store holds, in April 2026.",
      response:
        "Values from 5 April 2026 on are flagged `suspect`, keeping the EA's own flag as `source_flag`, until the EA says the gauge is right again.",
      evidence:
        "Found by running GESLA's datum-jump rule (`datumJumps` in `src/sources/gesla`, a 30-day median shift of more than 0.75 m) over every record the store lists as coastal, and confirmed, November 2026, by daily-mean differences against three EA gauges within 115 km (`ea/E71239`, `ea/E71124`, `ea/E70039`): each difference moves by 3.1 to 3.2 m on 5 April and stays there. Monthly medians are 0.25 m in January, −0.09 m in February and 3.39 m in April.",
      check: async (store, e) => {
        await flaggedSpan(store, e);
        await offset(store, e.stations![0]!, dayAfter(e.since!, 1), "2026-01-21", 2.5);
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
  retired: [],
} satisfies ErrataFile;
