import { dayAfter, type ErrataFile, type StoreReader } from "../../errata.ts";
import { POSITIONS } from "../../positions.ts";
import { Flag } from "../../schema.ts";
import { distanceKm } from "../../stats.ts";

/** A station's stored levels, throwing when there are none. */
async function levels(store: StoreReader, id: string, since: string, until = dayAfter(since, 1)) {
  const rows = await store.levels(id, since, until);
  if (!rows.length) throw new Error(`the store holds no ${id} levels from ${since} to ${until}`);
  return rows;
}

export default {
  errata: [
    {
      id: "bodc-erddap-positions",
      stations: ["bodc/wor", "bodc/imm", "bodc/nha"],
      handling: "corrected",
      error:
        "BODC's ERDDAP places three UK National Tide Gauge Network gauges away from where they are. Workington's dataset gives 50.2112, -5.4803, at St Ives in Cornwall, about 500 km from Workington in Cumbria. Immingham's and Newhaven's give -999 for latitude and longitude.",
      response:
        "The station refresh moves each station to the Environment Agency's position for the same gauge, listed in `POSITIONS` in `src/positions.ts`. An entry applies only while BODC still serves the position it was written against. If BODC moves the station, it keeps BODC's position, and the refresh reports the entry and fails the run until a person checks it.",
      evidence:
        "| Station | Dataset | ERDDAP position | EA's position of the gauge |\n| --- | --- | --- | --- |\n| `bodc/wor`, Workington | `WOR_ukcff_9310_001` | 50.211182, -5.4803309 | `ea/E73639-anglian`, 54.650691, -3.56717 |\n| `bodc/imm`, Immingham | `IMM_ukcff_3751_001` | -999, -999 | `ea/E71124`, 53.63039, -0.18755 |\n| `bodc/nha`, Newhaven | `NHA_ukcff_4006_001` | -999, -999 | `ea/E71739`, 50.781775, 0.057004 |\n\nWorkington's levels are the Workington gauge's: in November 2025, all 2,786 shared quarter hours of BODC's `ASLVBG02` and the EA's Workington readings are exactly 4.20 m apart (r = 1.0000), which is chart datum's depth below ordnance datum at Workington in NTSLF's table. Immingham's and Newhaven's datasets also give `minTime` as 1970-01-01, a fill value, in `allDatasets`. Checked on 2026-11-09.",
      reported: "2026-11-09",
      report:
        "Sent to BODC on 2026-11-09 in ticket BODCREQ-11479, with [#107](https://github.com/openwatersio/stillwell/issues/107), [#109](https://github.com/openwatersio/stillwell/issues/109) and [#110](https://github.com/openwatersio/stillwell/issues/110) together. No answer yet.",
      check: async (store, e) => {
        for (const id of e.stations!) {
          const station = await store.station(id);
          if (!station) throw new Error(`the store doesn't list ${id}`);
          const km = distanceKm(station, POSITIONS[id]!.at);
          if (km > 0.05)
            throw new Error(`the store places ${id} ${km.toFixed(1)} km from the EA's position`);
        }
      },
    },
    {
      id: "bodc-erddap-times",
      stations: "every station",
      handling: "corrected",
      error:
        "Times in BODC's UK National Tide Gauge Network datasets on ERDDAP are a few milliseconds off the quarter hour, such as `2024-12-07T07:59:59.998Z` and `2025-01-19T02:44:59.971Z`, up to about 30 ms. The pattern repeats through each day, which suggests the times are stored as fractional days and converted with rounding error.",
      response:
        "The adapter rounds each time to the nearest minute. It asks for each year with half a minute either side, so a value stamped just before New Year comes with the year it rounds into.",
      evidence:
        "Lowestoft (`LOW_ukcff_3942_001`) on 1 June 2024 runs `06:00:00.000`, `06:14:59.999`, `06:30:00.001`, `06:45:00.000`, `06:59:59.999`, and so on, with the error growing to 2 ms by the afternoon. Aberdeen's `time_coverage_end` is `2026-09-30T16:59:59.973Z`. The same values in GESLA's copy of BODC's processed files are on whole quarter hours. Checked on 2026-11-09.",
      reported: "2026-11-09",
      report:
        "Sent to BODC on 2026-11-09 in ticket BODCREQ-11479, with [#107](https://github.com/openwatersio/stillwell/issues/107), [#109](https://github.com/openwatersio/stillwell/issues/109) and [#110](https://github.com/openwatersio/stillwell/issues/110) together. No answer yet.",
      check: async (store) => {
        const rows = await levels(store, "bodc/low", "2024-06-01");
        const off = rows.filter((o) => o.time % 60_000);
        if (off.length)
          throw new Error(`${off.length} Lowestoft times on 2024-06-01 aren't on the minute`);
      },
    },
    {
      id: "bodc-erddap-gaps",
      stations: "every station",
      since: "2022-04-01",
      handling: "kept",
      error:
        "BODC's ERDDAP datasets for the UK National Tide Gauge Network hold less than its processed files. About one value in 32 is missing, so a 31-day month has 2,880 values, not 2,976. Whole months are missing. Most gauges' records end in December 2024, February 2026 or September 2026, though BODC's processed data page offers the network to August 2026.",
      response:
        "The store keeps what ERDDAP serves and leaves the gaps. Monthly's refetch reads every station's last three calendar years again, so months BODC adds later reach the store. GESLA's `-bodc` records hold BODC's processed files to 2024 or 2025 without these gaps.",
      evidence:
        "At Lowestoft (`LOW_ukcff_3942_001`) on 1 June 2024, ERDDAP has 93 of the day's 96 quarter hours. 07:30, 15:15 and 23:00 are missing; GESLA's copy has them (07:30 is 1.956 m). Over May 2024, ERDDAP has no Lowestoft values at all, while GESLA's copy has 2,976.\n\nAt Lerwick (`LER_ukcff_4109_001`), the months present have 2,880 values in 31-day months, 2,788 in 30-day ones and 2,602 in February. These months are missing: May to December 2022, October 2023 to February 2024, May 2024, July 2024, and April to September 2025. Holyhead has no values in March 2026.\n\nRecords end on 2024-12-31 at 16 gauges, 2026-02-28 at 9, 2026-09-30 at 15, 2024-12-07 at Mumbles and 2025-11-30 at Workington. Checked on 2026-11-09.",
      reported: "2026-11-09",
      report:
        "Sent to BODC on 2026-11-09 in ticket BODCREQ-11479, with [#107](https://github.com/openwatersio/stillwell/issues/107), [#109](https://github.com/openwatersio/stillwell/issues/109) and [#110](https://github.com/openwatersio/stillwell/issues/110) together. No answer yet.",
      check: async (store) => {
        const times = new Set((await levels(store, "bodc/low", "2024-06-01")).map((o) => o.time));
        const missing = ["07:30", "15:15", "23:00"].filter((t) =>
          times.has(Date.parse(`2024-06-01T${t}Z`)),
        );
        if (times.size !== 93 || missing.length)
          throw new Error(
            `Lowestoft holds ${times.size} values on 2024-06-01, not ERDDAP's 93 without 07:30, 15:15 and 23:00`,
          );
        const may = await store.levels("bodc/low", "2024-05-01", "2024-06-01");
        if (may.length)
          throw new Error(
            `the store holds ${may.length} Lowestoft levels in May 2024, which ERDDAP lacks`,
          );
        const march = await store.levels("bodc/hol", "2026-03-01", "2026-04-01");
        if (march.length)
          throw new Error(
            `the store holds ${march.length} Holyhead levels in March 2026, which ERDDAP lacks`,
          );
        await levels(store, "bodc/hol", "2026-02-28");
        await levels(store, "bodc/hol", "2026-04-01");
      },
    },
    {
      id: "bodc-st-helier-2025-zero",
      stations: ["bodc/jer"],
      since: "2025-10-14",
      until: "2025-10-15",
      handling: "kept",
      error:
        "BODC's ERDDAP gives St. Helier 0.000 m at 19:15 UTC on 14 October 2025, between 5.559 m at 19:00 and 6.772 m after a one-hour gap.",
      response:
        "The value is kept as served, with BODC's good flag as `source_flag`. QC flags it `suspect` with the two values before it. Its residual-jump rule flags the 0.000 m, and its spike rule flags the 5.383 m at 18:45 and 5.559 m at 19:00, which it judges against the 0.000 m. No erratum span flags it, since spans are whole days and would mark the rest of the day suspect too.",
      evidence:
        "In BODC's ERDDAP record of St. Helier, as the store holds it, checked in November 2026: 5.383 m at 18:45, 5.559 m at 19:00, 0.000 m at 19:15 with BODC's good flag, nothing until 20:15, then 6.772 m. The store flags those three values `suspect`, and no others that day. Run on the year's 14,830 values with the QC rules the store uses, the residual-jump rule flags the 0.000 m, and with that rule off, the spike rule flags only the two before it.",
      reported: null,
      report: null,
      check: async (store, e) => {
        const day = e.since!;
        const rows = (await levels(store, e.stations![0]!, day)).filter(
          (o) => o.time >= Date.parse(`${day}T18:45Z`),
        );
        const [first, before, zero, after] = rows;
        if (
          first?.time !== Date.parse(`${day}T18:45Z`) ||
          Math.abs(first.level - 5.383) > 0.0005 ||
          before?.time !== Date.parse(`${day}T19:00Z`) ||
          Math.abs(before.level - 5.559) > 0.0005 ||
          zero?.time !== Date.parse(`${day}T19:15Z`) ||
          zero.level !== 0 ||
          !after ||
          after.time - zero.time < 3_600_000 ||
          Math.abs(after.level - 6.772) > 0.0005
        )
          throw new Error(
            `St. Helier doesn't hold 5.383 m at 18:45, 5.559 m at 19:00, 0.000 m at 19:15 and 6.772 m after an hour's gap on ${day}`,
          );
        for (const o of [first, before, zero])
          if (o.source_flag !== Flag.good)
            throw new Error(
              `St. Helier's ${o.level} m at ${new Date(o.time).toISOString()} has source flag ${o.source_flag}, not BODC's good`,
            );
        // QC flags these three and no other value that day.
        const suspect = rows.filter((o) => o.flag >= Flag.suspect).map((o) => o.time);
        const all = (await levels(store, e.stations![0]!, day)).filter(
          (o) => o.flag >= Flag.suspect,
        );
        const expected = [first.time, before.time, zero.time];
        if (all.map((o) => o.time).join() !== expected.join() || suspect.length !== 3)
          throw new Error(
            `St. Helier's suspect levels on ${day} are at ${all.map((o) => new Date(o.time).toISOString()).join(", ") || "no time"}, not 18:45, 19:00 and 19:15`,
          );
        if (after.time !== Date.parse(`${day}T20:15Z`))
          throw new Error(`St. Helier's first level after the gap isn't at 20:15 UTC on ${day}`);
      },
    },
    {
      id: "bodc-hinkley-channel",
      stations: ["bodc/hin"],
      handling: "corrected",
      error:
        "BODC's processed dataset for Hinkley Point (`HIN_ukcff_4602_001`) has no values in `ASLVBG02`, the channel that holds the processed series at every other gauge with values in it, and marks no channel as the processed one. Hinkley Point's processed series is in `ASLVRADR`, the radar channel, from January 2023.",
      response:
        "The adapter reads `ASLVRADR` at Hinkley Point (`CHANNELS` in `src/sources/bodc/index.ts`) and `ASLVBG02` everywhere else.",
      evidence:
        "In November 2026, Hinkley Point's `ASLVBG02` has no values in any year. Its `ASLVRADR` matches the store's copy of GESLA's BODC record of the gauge (`gesla/hinkley_point-hin-gbr-bodc`) within 1.5 mm at all 5,563 quarter hours both hold in 2025 and 2026, sits on the same zero as GESLA's CMEMS record (`gesla/hinkley-hin-gbr-cmems`) in each year from 2023 (median difference under 1 mm), and matches the EA's chart datum series (`ea/E72524`) within 5 mm at 99% of times in 2026.",
      reported: null,
      check: async (store, e) => {
        const gesla = new Map(
          (await store.levels("gesla/hinkley_point-hin-gbr-bodc", "2025-10-01", "2025-11-01")).map(
            (o) => [o.time, o.level],
          ),
        );
        const shared = (await levels(store, e.stations![0]!, "2025-10-01", "2025-11-01")).filter(
          (o) => gesla.has(o.time),
        );
        if (!shared.length)
          throw new Error("Hinkley Point and GESLA's BODC copy share no times in October 2025");
        const off = shared.filter((o) => Math.abs(o.level - gesla.get(o.time)!) > 0.0015);
        if (off.length)
          throw new Error(
            `${off.length} of ${shared.length} Hinkley Point values in October 2025 differ from GESLA's BODC copy by more than 1.5 mm`,
          );
      },
    },
  ],
  retired: ["bodc-ilfracombe-2023-offsets"],
} satisfies ErrataFile;
