import { type ErrataFile, type StoreReader } from "../../errata.ts";
import { Flag } from "../../schema.ts";

/** Coruña's levels over the admitted interval, read once per check. */
const held = (store: StoreReader) => store.levels("ign/ACOR1", "2000-01-01", "2024-01-01");

/** Pearson's r of two equal-length series. */
function correlation(a: number[], b: number[]): number {
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const [ma, mb] = [mean(a), mean(b)];
  let [ab, aa, bb] = [0, 0, 0];
  for (let i = 0; i < a.length; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}

/** Throws unless the store lists the admitted series and holds levels for it. */
async function listed(store: StoreReader) {
  if (!(await store.station("ign/ACOR1"))) throw new Error("the store doesn't list ign/ACOR1");
  if (!(await held(store)).length) throw new Error("the store holds no ign/ACOR1 levels");
}

/** Throws when the store lists a series the release leaves out, after confirming it lists the admitted one. */
async function absent(store: StoreReader, ids: string[]) {
  await listed(store);
  for (const id of ids)
    if (await store.station(id))
      throw new Error(`the store lists ${id}, which the release leaves out`);
}

export default {
  errata: [
    {
      id: "ign-duplicate-raw-rows",
      stations: [],
      handling: "dropped",
      error:
        "Some exports repeat identical rows. ALAC1’s 1633 daily file repeats 12 November 2026 at 04:05:00 three times with the same 798 mm value. Reviewed BM files also repeat identical rows, including TN021 in 2010, 2013 and 2018 and TN031 in 2013.",
      response:
        "Keep one copy of identical adjacent rows in raw and reviewed exports. Conflicting repeated timestamps and decreasing timestamps still refuse the fetch.",
      evidence:
        "Observed in https://datos-geodesia.ign.es/Red_de_Mareografos/ALAC1/observados/2026/220051_1633_20261112.txt on 15 November 2026 UTC: 1,442 rows, with three identical 04:05:00 rows. A recorded excerpt is test/fixtures/ign-duplicates.txt. The 17 November 2026 full annual audit also checked the reviewed duplicates byte for byte, including TN021 2010-02-15 12:11:00 -2251 twice and TN031 2013-01-01 00:00:00 -2302 twice.",
      check: (store) => absent(store, ["ign/ALAC1-1633", "ign/TN021-NGZ581", "ign/TN031"]),
    },
    {
      id: "ign-negative-sentinel",
      stations: [],
      handling: "flagged",
      error:
        "Reviewed exports use numeric -9999 both for missing data and for genuine -9.999 m heights, although Leeme.txt documents only positive 9999 as missing.",
      response:
        "Carry positive 9999 and explicit missing markers as source invalidations. A stored reading explicitly invalidated by the source retains its prior numeric level with bad source and quality flags; a marker without a stored reading writes no observation. Retain numeric -9999 with a suspect source flag so real heights are not deleted and ambiguous placeholders fail normal quality filters. The admitted Coruña hourly subset has separate source-specific evidence and handling in ign-coruna-hourly-gaps; it does not retain those unusable aggregates as levels.",
      evidence:
        "TN013's 2024 minute JM file has 506 numeric -9999 readings, all neighboring levels within 150 mm, including 1 January at 19:21 between -9987 and -10001. Its 2020 hourly JM file has 71 consecutive -9999 hours from 18 December 11:00 through 21 December 09:00. FUER1's 2005 minute JM file starts with -9999 and has 39,865 such rows. Source URLs are under https://datos-geodesia.ign.es/Red_de_Mareografos/<station>/procesados/; checked 15 November 2026.",
      check: (store) => absent(store, ["ign/TN013", "ign/FUER1"]),
    },
    {
      id: "ign-reviewed-marks",
      stations: [],
      handling: "refused",
      error:
        "Some reviewed files name marks that differ from the station sheet: MURC1's 2001 hourly file uses JM NAP-943 rather than NP-1744; TN021's 2008–2019 BM files use NGZ-581 rather than BM Inox; TN031's 2009–2021 BM files use NGAB-161 rather than Inox. CRI 1. Alborán headers abbreviate the sheet’s Clv. Mfo as C_Mfo.",
      response:
        "The affected series remain withheld by ign-release-coverage. The candidate parser validates named marks and separates the historical Tenerife BMs; none of these candidate reference conversions supplies the public Coruña release.",
      evidence:
        "Headers in MURC1/procesados/horarios/220046_horarios_2001_JM.txt, TN021/procesados/integros/370032_2008_BM.txt and TN031/procesados/integros/370033_2009_BM.txt, compared with fichas/MURC1.pdf, MURC2.pdf, TN021.pdf and TN031.pdf, under https://datos-geodesia.ign.es/Red_de_Mareografos/. MURC1's first -2260 mm reading is +0.053 m NMMA using the named NAP-943, versus +4.290 m using NP-1744. ALBO1/procesados/integros/220048_2024_BM.txt names C_Mfo; fichas/ALBO1.pdf names Clv. Mfo.",
      check: (store) => absent(store, ["ign/ALBO1", "ign/MURC1", "ign/TN021-NGZ581", "ign/TN031"]),
    },
    {
      id: "ign-murc1-chart-archive",
      stations: [],
      since: "2001-01-01",
      until: "2004-01-01",
      handling: "refused",
      error:
        "The MURC1 sheet labels sensor 0503 as a mechanical recorder operating in 1991–1998, but its archive publishes 2001–2003 observations. Those values increase downward, opposite to reviewed water heights.",
      response:
        "Withhold MURC1-0503 pending dated calibration evidence. The candidate parser demonstrates a sign reversal supported strongly in 2001, but this is not a published correction or clearance for 2002–2003.",
      evidence:
        "MURC1/observados/ficheros_anuales/ lists 220046_0503_2001.txt through 2003. In the first 64 KB of the 2001 export, 364 shared hours correlate -1.0 with procesados/horarios/220046_horarios_2001_JM.txt. At 2001-01-01 00:00 the raw distance is 583 mm and the reviewed height is -2260 mm. Files and fichas/MURC1.pdf under https://datos-geodesia.ign.es/Red_de_Mareografos/ checked 15 November 2026.",
      check: (store) => absent(store, ["ign/MURC1-0503"]),
    },
    {
      id: "ign-export-integrity",
      stations: [],
      handling: "refused",
      error:
        "Thirteen current-name annual exports fail strict header, timestamp, numeric-value or ordering validation. Examples include TN031 2019’s year 2109, headerless ALME2 2022, malformed ALBO1 values and truncated ACOR1 rows. Some raw exports also contain earlier-year rows beyond a normal terminal-midnight boundary. Affected series, none in the store: ign/ACOR1-0601, ign/ACOR1-0701, ign/ALAC1-0702, ign/ALBO1, ign/ALME2, ign/FUER2-1607, ign/FUER2-1621, ign/TN013-1301, ign/TN031.",
      response:
        "All affected series remain withheld by ign-release-coverage. Candidate parsers refuse the malformed exports rather than invent dates, marks, levels or units. Corrected exports or evidenced file-specific handling and full validation are required before admission.",
      evidence:
        "All 797 current-name annual water-level exports were checked on 17 November 2026: 784 parse, 13 refuse after exact reviewed duplicates are removed. Source URLs and byte hashes are in docs/results/ign-validation-2026-11-17/annual-files.csv; per-file parser errors are in syntax.csv.",
      check: (store) =>
        absent(store, [
          "ign/ACOR1-0601",
          "ign/ACOR1-0701",
          "ign/ALAC1-0702",
          "ign/ALBO1",
          "ign/ALME2",
          "ign/FUER2-1607",
          "ign/FUER2-1621",
          "ign/TN013-1301",
          "ign/TN031",
        ]),
    },
    {
      id: "ign-invalid-missing-dates",
      stations: [],
      handling: "dropped",
      error:
        "Some exports contain impossible-date missing placeholders. The confirmed example is MURC2’s reviewed 2024 export, with 1,440 rows labelled 31 November 2024, all carrying the explicit missing marker ---. Ignoring nonexistent missing timestamps is a general parser rule across water-level exports, not a date correction limited to this file.",
      response:
        "Discard a nonexistent timestamp only when its value is explicitly missing. Never roll it into another day or invalidate a real timestamp. Impossible dates with numerical observations still refuse the file; a file with no valid timestamp refuses too.",
      evidence:
        "Full audit of MURC2/procesados/integros/220047_2024_JM.txt on 17 November 2026: 31/11/2024 00:00:00 --- through 23:59:00 ---. Regression checks preserve the adjacent valid November 30 and December 1 observations without inventing dates.",
      check: (store) => absent(store, ["ign/MURC2"]),
    },
    {
      id: "ign-export-boundaries",
      stations: [],
      handling: "kept",
      error:
        "Historical exports vary between quoted, unquoted and omitted inline mm units and may include a terminal midnight belonging to the next day or year. Affected series, none in the store: ign/ACOR1-0302, ign/TN031.",
      response:
        "Use the agency-documented millimeter unit for catalogued water-level channels. Preserve a final midnight at its actual timestamp. When only the preceding file’s closing timestamp overlaps a request, inspect only its final row; unrelated malformed earlier rows do not block the requested period. Header and closing-row validation still apply when a closing row is present.",
      evidence:
        "The 17 November 2026 audit records unit variants in annual-audit.json. TN031 2021 BM ends at 1 January 2022 00:00. IGN Leeme.txt documents millimeters. These are supported export conventions, not inferred clock corrections.",
      check: (store) => absent(store, ["ign/ACOR1-0302", "ign/TN031"]),
    },
    {
      id: "ign-coruna-clock",
      stations: ["ign/ACOR1"],
      since: "2000-01-01",
      until: "2024-01-01",
      handling: "kept",
      error:
        "IGN hasn't confirmed the time convention of its historical hourly labels. Its server README says reviewed processing corrects temporal phase, and neither it nor IGN's 17 November reply names UTC.",
      response:
        "The labels are stored as UTC, with no shift, and the values keep the flags QC and IGN's reviewed source flag give them. The record agrees with other originators' records of the gauge in every year, so it is kept; a change in that agreement shows in this entry's check.",
      evidence:
        "Each of the 24 years, 2000 to 2023, was cross-correlated with the TICON constants of IEO's Coruña gauge 0.7 km away, UHSLC's La Coruña and CMEMS's Coruna2TG, at lags of up to 3 hours: best lag 0 minutes in 57 of the 72 fits and ±10 minutes in the rest, K1 phase −9 to +16 minutes, zero-lag correlation 0.987 to 0.995. A whole-hour or seasonal shift would show as a lag of an hour or more. IEO's gauge is the independent reference: the CMEMS copy may be IGN's own data, and UHSLC's may come from IEO. See docs/results/ign-coruna-clock-check-2026-11-21.md.",
      check: async (store) => {
        await listed(store);
        // The CMEMS copy of the gauge, hourly from November 2019: its levels fit IGN's at zero lag, not an hour either way.
        const fit = async (lag: number) => {
          const copy = await store.levels(
            "gesla/coruna2tg-cor-esp-cmems",
            "2020-01-01",
            "2021-01-01",
          );
          if (!copy.length) throw new Error("the store holds no CMEMS Coruña levels in 2020");
          const ign = new Map(
            (await store.levels("ign/ACOR1", "2019-12-31", "2021-01-02")).map((o) => [
              o.time,
              o.level,
            ]),
          );
          const a: number[] = [];
          const b: number[] = [];
          for (const o of copy) {
            const w = ign.get(o.time - lag * 60_000);
            if (w !== undefined) {
              a.push(o.level);
              b.push(w);
            }
          }
          if (a.length < 5000)
            throw new Error(`only ${a.length} hours of 2020 are in both records`);
          return correlation(a, b);
        };
        const [early, now, late] = [await fit(-60), await fit(0), await fit(60)];
        if (now < 0.98 || now - Math.max(early, late) < 0.05)
          throw new Error(
            `ign/ACOR1 fits the CMEMS copy at r ${now.toFixed(3)}, against ${early.toFixed(3)} an hour early and ${late.toFixed(3)} an hour late`,
          );
        const levels = await held(store);
        const good = levels.filter((o) => o.flag === Flag.good).length;
        if (good < levels.length * 0.99)
          throw new Error(`only ${good} of ${levels.length} ign/ACOR1 levels are good`);
      },
    },
    {
      id: "ign-release-coverage",
      stations: "every station",
      handling: "refused",
      error:
        "The broader IGN archive has unresolved historical clocks, changing raw signs/scales, undocumented channels, malformed exports and unconfirmed daily/annual authority.",
      response:
        "The registered source admits only ACOR1 hourly JM exports for 2000–2023. Every other series, product and period is excluded from the public adapter, with no live polling or monthly refetch. The candidate catalog and parsers are research utilities and do not widen registered source coverage. Extend admission only after the evidence and local/store readback for the added coverage are reviewed.",
      evidence:
        "Full census and 797-file annual syntax/tidal audit in docs/results/ign-validation-2026-11-17.md. Remaining agency and validation work is tracked by https://github.com/openwatersio/stillwell/issues/181; initial scope approved by the maintainer on 18 November 2026.",
      check: async (store) => {
        await listed(store);
        const others = (await store.rows("stations.parquet")).filter(
          (s) => s.source === "ign" && s.id !== "ign/ACOR1",
        );
        if (others.length)
          throw new Error(
            `the store lists other IGN stations: ${others.map((s) => s.id).join(", ")}`,
          );
      },
    },
    {
      id: "ign-coruna-hourly-gaps",
      stations: ["ign/ACOR1"],
      since: "2000-01-01",
      until: "2024-01-01",
      handling: "dropped",
      error:
        "The admitted Coruña hourly files contain 840 numeric -9999 aggregates that are unusable water levels, unlike other gauges where -9.999 m can be a genuine height.",
      response:
        "Treat -9999 only in this admitted hourly product as a withdrawal marker, not a numeric level. A fresh ingest writes no observation at those hours; a source revision invalidates a previously stored reading without inventing a replacement. The generic candidate parser continues to retain ambiguous -9999 values in other products and gauges.",
      evidence:
        "All 24 Coruña hourly exports checked: ordinary numeric values span -7046 to -1528 mm. Of the 840 -9999 hours, 798 have wholly missing reviewed full-resolution (integros) data, nine have partially missing full-resolution data, and 33 overlap a held -4154 mm run with boundary values in the 2022 integro product. These are missing/rejected hourly aggregates, not corroborating -9999 water heights. See docs/results/ign-coruna-2026-11-18/negative-missing-evidence.json and input receipts. No replacement heights are inferred.",
      check: async (store) => {
        // A genuine Coruña level is within a few meters of the mark, so the sentinel's -9.999 m would stand out.
        const sentinels = (await held(store)).filter((o) => o.level < -9);
        if (sentinels.length)
          throw new Error(
            `ign/ACOR1 holds ${sentinels.length} levels under -9 m, the -9999 sentinel`,
          );
      },
    },
    {
      id: "ign-coruna-hourly-grid",
      stations: ["ign/ACOR1"],
      since: "2000-01-01",
      until: "2024-01-01",
      handling: "refused",
      error:
        "A successful HTTP response can end at a row boundary or omit/off-shift hours, yielding a syntactically valid but incomplete hourly archive.",
      response:
        "Require each admitted own-year body to contain every on-the-hour timestamp of that calendar year, including explicit missing markers: 8760 or 8784 hours. Refuse a shortened or shifted grid even for a partial-year request. A terminal midnight outside the own year is ignored; no predecessor file is required because the own year must include its first hour.",
      evidence:
        "The 24 downloaded Coruña hourly exports all have complete regular own-year grids: 210384 hours before unusable aggregate markers are removed. Receipt hashes and complete local checks are in docs/results/ign-coruna-2026-11-18/. Tests reproduce truncation, an interior missing row and a half-hour timestamp.",
      check: async (store) => {
        // Only unusable aggregates are missing from a complete grid (840 in all), so a year well under its hours was cut short.
        const counts = new Map<number, number>();
        for (const o of await held(store)) {
          if (o.time % 3_600_000)
            throw new Error(`ign/ACOR1 holds a level off the hour at ${o.time}`);
          const year = new Date(o.time).getUTCFullYear();
          counts.set(year, (counts.get(year) ?? 0) + 1);
        }
        for (let year = 2000; year < 2024; year++) {
          const hours = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 3_600_000;
          const held = counts.get(year) ?? 0;
          if (held < hours * 0.9 || held > hours)
            throw new Error(`ign/ACOR1 holds ${held} levels in ${year}, of ${hours} hours`);
        }
      },
    },
  ],
  retired: [],
} satisfies ErrataFile;
