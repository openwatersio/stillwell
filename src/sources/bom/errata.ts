import type { ErrataFile } from "../../errata.ts";
import { distanceKm } from "../../stats.ts";

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
  retired: [],
} satisfies ErrataFile;
