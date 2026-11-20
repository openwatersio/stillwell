import { dayAfter, type ErrataFile, type StoreReader } from "../../errata.ts";
import { median } from "../../stats.ts";

/** The median of `a` minus `b` from `since` to before `until`, at the times both hold. */
async function difference(store: StoreReader, a: string, b: string, since: string, until: string) {
  const other = new Map((await store.levels(b, since, until)).map((o) => [o.time, o.level]));
  const d = (await store.levels(a, since, until)).flatMap((o) => {
    const v = other.get(o.time);
    return v === undefined ? [] : [o.level - v];
  });
  if (!d.length) throw new Error(`${a} and ${b} share no times from ${since} to ${until}`);
  return median(d);
}

export default {
  errata: [
    {
      id: "dmi-coastal-authority-dnn",
      stations: [
        "dmi/9004201",
        "dmi/9004203",
        "dmi/9004303",
        "dmi/9005101",
        "dmi/9005103",
        "dmi/9005110",
        "dmi/9005113",
        "dmi/9005201",
        "dmi/9005203",
        "dmi/9005210",
        "dmi/9005212",
        "dmi/9005213",
        "dmi/9006401",
        "dmi/9006501",
        "dmi/9006601",
        "dmi/9006701",
        "dmi/9006703",
        "dmi/9006801",
        "dmi/9006901",
        "dmi/9006902",
        "dmi/9007101",
        "dmi/9007102",
        "dmi/9010101",
        "dmi/9010102",
        "dmi/9010201",
        "dmi/9010202",
        "dmi/9020101",
        "dmi/9020102",
        "dmi/9020201",
        "dmi/9020202",
        "dmi/9020301",
        "dmi/9020302",
        "dmi/9030101",
        "dmi/9030102",
        "dmi/9030201",
        "dmi/9030202",
      ],
      until: "2002-05-29",
      handling: "kept",
      error:
        "DMI's documentation says the Danish Coastal Authority's gauges measure in DVR90, and the store labels their `sea_reg` DVR90, but until 27 or 28 May 2002 it's on an older reference, likely DNN, 5 to 20 cm above DVR90.",
      response:
        "Each gauge's record is split into a datum epoch of its own from 29 May 2002. Values before are kept in the earlier epoch, labeled DVR90 as DMI serves them, with no conversion to the current one until its offset is measured.",
      evidence:
        "Against DMI's `sealev_dvr` at the same or a nearby gauge, 29 of the 36 gauges read 5 to 20 cm higher over 12 to 25 May 2002 than over 29 May to 11 June (11 cm at Vidåslusen/Højer and 13 cm at Esbjerg, both beside a DMI gauge); the three in Ringkøbing Fjord drop 9 to 11 cm within an hour on 28 May. At the eastern harbors the `I` and `II` gauges disagree by up to 20 cm through late 2002, and at Fåborg, Karrebæksminde and Kalvehave the difference between them changed by 7 to 22 cm at the switch; they agree within 1 cm by 2004.",
      check: async (store, e) => {
        const until = e.until!;
        for (const id of e.stations!) {
          const station = await store.station(id);
          if (
            !station?.epochs.some(
              (epoch) => epoch.until === `${until}T00:00:00Z` && epoch.to_current === null,
            )
          )
            throw new Error(
              `${id} has no epoch ending on ${until} without an offset to the current one`,
            );
        }
        const esbjerg = (since: string, to: string) =>
          difference(store, "dmi/9006401", "dmi/25149", since, to);
        const before = await esbjerg(dayAfter(until, -17), dayAfter(until, -3));
        const after = await esbjerg(until, dayAfter(until, 14));
        if (before - after < 0.05)
          throw new Error(
            `Esbjerg's Coastal Authority gauge drops ${((before - after) * 100).toFixed(1)} cm against DMI's on ${until}, not 5 cm or more`,
          );
      },
    },
    {
      id: "dmi-coastal-authority-eastern-pairs",
      stations: [
        "dmi/9020301",
        "dmi/9020302",
        "dmi/9030101",
        "dmi/9030102",
        "dmi/9030201",
        "dmi/9030202",
      ],
      since: "2002-05-29",
      until: "2004-05-01",
      handling: "kept",
      error:
        "The Coastal Authority's `I` and `II` gauges at Fåborg, Karrebæksminde and Kalvehave, beside each other, disagree by up to 20 cm through late 2002, and the difference between them changed by 7 to 22 cm when they moved to DVR90 in May 2002, so at least one of each pair is off DVR90 in those years.",
      response:
        "Kept as DMI serves them, labeled DVR90; which gauge of each pair is right isn't known.",
      evidence:
        "Median hourly difference between each pair over 12 to 25 May 2002, 29 May to 11 June 2002, September 2002 and May 2004: Fåborg 26, 4, −20 and 1 cm; Karrebæksminde 4, −3, −9 and −1 cm; Kalvehave 21, 2, 0 and −1 cm.",
      check: async (store, e) => {
        // The entry lists each pair's `I` gauge then its `II`.
        const s = e.stations!;
        const pairs = s.filter((_, i) => i % 2 === 0).map((a, i) => [a, s[2 * i + 1]!] as const);
        const apart = async (since: string, until: string) => {
          let most = 0;
          for (const [a, b] of pairs)
            most = Math.max(most, Math.abs(await difference(store, a, b, since, until)));
          return most;
        };
        const september = await apart("2002-09-01", "2002-10-01");
        if (september < 0.1)
          throw new Error(
            `the eastern pairs disagree by ${(september * 100).toFixed(1)} cm at most in September 2002, not 10 cm or more`,
          );
        const may = await apart(e.until!, dayAfter(e.until!, 31));
        if (may > 0.02)
          throw new Error(
            `an eastern pair disagrees by ${(may * 100).toFixed(1)} cm in May 2004, not within 2 cm`,
          );
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
