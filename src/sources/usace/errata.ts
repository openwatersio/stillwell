import { impossibleDropped, type ErrataFile, type StoreReader } from "../../errata.ts";
import { POSITIONS } from "../../positions.ts";
import type { StoredStation } from "../../schema.ts";
import { distanceKm } from "../../stats.ts";

const FEET = 0.3048;

/** A station as the store lists it; throws where it doesn't. */
async function listed(store: StoreReader, id: string): Promise<StoredStation> {
  const station = await store.station(id);
  if (!station) throw new Error(`the store doesn't list ${id}`);
  return station;
}

/** Throws unless the store lists a station at the position `POSITIONS` moves it to, rather than the one CWMS serves. */
async function moved(store: StoreReader, id: string): Promise<void> {
  const station = await listed(store, id);
  const { served, at } = POSITIONS[id]!;
  if (distanceKm(station, at) > 0.1 || distanceKm(station, served) < 10)
    throw new Error(
      `the store lists ${id} at ${station.lat}, ${station.lon}, not ${at.lat}, ${at.lon}`,
    );
}

/** Throws unless the store lists a datum offset within a millimeter of `m`. */
async function offset(store: StoreReader, id: string, datum: string, m: number): Promise<void> {
  const got = (await listed(store, id)).datums[datum];
  if (got === undefined || Math.abs(got - m) > 0.001)
    throw new Error(`the store lists ${id}'s ${datum} as ${got}, not ${m}`);
}

export default {
  errata: [
    {
      id: "usace-baton-rouge-position",
      stations: ["usace/MVN.Baton_Rouge"],
      handling: "corrected",
      error:
        "The New Orleans District places its Baton Rouge gauge at 29.43° N, about 110 km south of the gauge, which the Vicksburg District places at 30.45° N.",
      response:
        "The station refresh moves it to MVK's position, 30.4457, −91.1916, which USGS 07374000 shares, listed in `POSITIONS` in `src/positions.ts`. If MVN moves the station, the refresh reports the entry and fails the run until a person checks it.",
      evidence:
        "CWMS catalogs: `MVN.Baton_Rouge` at 29.4292° N, −91.2069; `MVK.Baton_Rouge` at 30.4457° N, −91.1916. The gauge is at Baton Rouge, 30.45° N.",
      reported: "2026-11-07",
      report:
        "Sent to the New Orleans District (CEMVN-WATER-MANAGEMENT@usace.army.mil) on 2026-11-07, as a reply to the 2026-11-05 data request in [#10](https://github.com/openwatersio/stillwell/issues/10). No answer yet.",
      check: (store, e) => moved(store, e.stations![0]!),
    },
    {
      id: "usace-placeholder-positions",
      stations: [],
      handling: "dropped",
      error:
        "Some CWMS locations with an observed stage series sit at 0,0, at a placeholder such as 9.09,9.09 (Anoka) or −3.4 × 10³⁸, or have no position.",
      response:
        "A location with no position, or one outside the contiguous US, is left out of the station list. The refresh fails for a station already listed that CWMS moves to one, until a `POSITIONS` entry or `RETIRED` settles it.",
      evidence:
        "CWMS location and stage-series catalogs of the nine offices, read 2026-11-24 with the adapter's rules: a location that has an observed series (`observed()` in `src/sources/usace/index.ts`) and no position in the contiguous US, once `published-latitude` and `published-longitude` stand in for a location with neither coordinate. That is 154 locations. Three more, whose longitude lost its sign, are placed by erratum `usace-longitude-sign`.\n\n| Office | Locations | Position |\n| --- | --- | --- |\n| MVS | 72 | 0,0, such as `Baton Rouge-Mississippi`, `St Paul-Mississippi` and `Kansas City-Missouri`; they are MVS's own entries for other districts' gauges |\n| MVS | 1 | 9.09, 9.09, `Anoka-Mississippi` |\n| MVS | 1 | none, `Fayette-Moniteau Cr` |\n| LRL | 62 | none, such as `Alpine`, `Madison`, `Cairo` and `Muncie` |\n| LRL | 7 | 0,0: `Olmsted`, `Olmsted-HW`, `Olmsted-OLMI2`, `Olmsted-TW`, `Clifty Creek`, `FarmersTW` and `Shawneetown` |\n| LRL | 6 | −3.4028235 × 10³⁸: `Brownsville`, `BrownsvilleWtrT`, `CHSI2`, `MURI2`, `MammothCave` and `NMDM7` |\n| LRH | 4 | none: `NewCumberlandLD-Pool`, `NewCumberlandLD-Tailwater`, `PikeIslandLD-Pool` and `PikeIslandLD-Tailwater` |\n| LRC | 1 | none, `Shawano` |\n\nMVM, MVN, LRP and LRN have none.",
      report:
        "Not sent: held until upstream reports go out. It goes to MVS's water managers (dll-cemvs-water-managers@usace.army.mil, from the Water Control page at https://www.mvs-wc.usace.army.mil/) for MVS's locations, and to the adapter's default contact for LRL's, LRH's and LRC's, whose own contacts aren't confirmed. It asks who maintains the locations and whether their positions can be filled in. The New Orleans District was asked on 2026-11-07 who takes them.",
      check: async (store) => {
        const usace = (await store.rows("stations.parquet")).filter((r) => r.source === "usace");
        if (!usace.length) throw new Error("the store lists no USACE stations");
        const outside = usace.filter(
          (r) =>
            !(
              (r.lat as number) > 24 &&
              (r.lat as number) < 50 &&
              (r.lon as number) > -125 &&
              (r.lon as number) < -66
            ),
        );
        if (outside.length)
          throw new Error(
            `the store lists USACE stations outside the contiguous US: ${outside.map((r) => r.id).join(", ")}`,
          );
      },
    },
    {
      id: "usace-zero-elevation",
      stations: ["usace/MVK.Baton_Rouge"],
      handling: "avoided",
      error:
        "Some districts give an elevation of 0 to locations they have no elevation for, the same as a gauge set at the datum: MVK gives Baton Rouge 0, where MVN's description puts it 0.71 ft off. CWMS doesn't say which other zeros are real, so only Baton Rouge is listed.",
      response:
        "An elevation of exactly 0 is ignored, so those gauges have no NGVD29 or NAVD88 offset.",
      evidence:
        "MVK's location for Baton Rouge has elevation 0 NAVD88, while MVN's description of the same gauge puts its zero 0.71 ft off.",
      reported: "2026-11-07",
      report:
        "MVN's part sent to the New Orleans District (CEMVN-WATER-MANAGEMENT@usace.army.mil) on 2026-11-07, asking whether 0 marks a missing elevation. MVK's Baton Rouge isn't reported to MVK yet. No answer yet.",
      check: async (store, e) => {
        const { datums } = await listed(store, e.stations![0]!);
        if (datums.NGVD29 !== undefined || datums.NAVD88 !== undefined)
          throw new Error(
            `the store lists MVK's Baton Rouge with offsets ${JSON.stringify(datums)}`,
          );
      },
    },
    {
      id: "usace-lwrp-corrections-disagree",
      stations: [
        "usace/MVN.Baton_Rouge",
        "usace/MVN.Morgan_City",
        "usace/MVN.Reserve",
        "usace/MVN.Knox_Ldg",
        "usace/MVN.Krotz_Springs",
        "usace/MVN.Donaldsonville",
        "usace/MVN.Bonnet_Carre",
        "usace/MVN.Red_River_Ldg",
      ],
      handling: "kept",
      error:
        "At some New Orleans District gauges, the NAVD88 correction in the CWMS location description differs from the one MVN applies in its own `rev-NAVD88` series, or from the RiverGages station page, by more than 0.05 ft. That is more than the series' 0.1 ft rounding explains. Red River Landing's description is a copy of Knox Landing's.",
      response:
        "`datums.NAVD88`, and `datums.LWRP` where the description gives it, are the description's values, and the list's `datums_from` quotes them. Red River Landing's description isn't read, so it has neither. Each offset is applied to the whole record since the gauge's last zero reset.",
      evidence:
        "Feet. \"Applied\" is `rev-NAVD88` minus `rev`, hourly over 2026-01-01 to 2026-09-14, read 2026-11-08. RiverGages values are from [#10](https://github.com/openwatersio/stillwell/issues/10), read 2026-11-05.\n\n| Gauge | Description | Applied | RiverGages |\n| --- | --- | --- | --- |\n| Baton Rouge | −0.71 (OPUS 2019) | −0.4 | −0.71 |\n| Morgan City | −1.403 (OPUS 2021) | −1.2 | |\n| Reserve | −0.87 (2009.55) | −0.7 | −1.19 |\n| Knox Landing | −0.08 | −0.2 | −0.60 |\n| Krotz Springs | 0.00 (2004.65) | −0.1 | |\n| Donaldsonville | −0.74 (OPUS 2010) | −0.7 | −1.18 |\n| Bonnet Carré | −0.89 (2009.55) | | −0.96 |\n| Red River Landing | Knox Landing's text | −0.26 | −1.04 (OPUS) |\n\nNew Orleans, Melville, Simmesport and Donaldsonville's applied value agree with the description within 0.05 ft. The corrections change as the gauges subside and are re-surveyed, and each source quotes whichever survey it last copied.",
      reported: "2026-11-05",
      report:
        "Asked in the data request to the New Orleans District (CEMVN-WATER-MANAGEMENT@usace.army.mil) on 2026-11-05, described in [#10](https://github.com/openwatersio/stillwell/issues/10): every NAVD88 correction each gauge has had, with its effective date and realization. No answer yet.",
      // The descriptions' values, not the ones MVN applies in rev-NAVD88 (−0.4, −0.7 and −0.2 ft).
      check: async (store) => {
        await offset(store, "usace/MVN.Baton_Rouge", "NAVD88", -0.71 * FEET);
        await offset(store, "usace/MVN.Reserve", "NAVD88", -0.87 * FEET);
        await offset(store, "usace/MVN.Knox_Ldg", "NAVD88", -0.08 * FEET);
      },
    },
    {
      id: "usace-positions",
      stations: [
        "usace/MVK.Olive_Branch",
        "usace/MVK.Oxford",
        "usace/MVN.Bayou_Boeuf-Amelia",
        "usace/MVN.Chicot_Pass-Myette",
        "usace/LRN.RoaringR_Hilham",
        "usace/LRN.WFBrownsCr_Glen",
      ],
      handling: "corrected",
      error:
        "The CWMS location catalog places six gauges 14 to 334 km from where USGS places the same gauge. Two have a latitude off by whole degrees, and one has another gauge's position.",
      response:
        "The station refresh moves each station to the USGS gauge's position, listed in `POSITIONS` in `src/positions.ts`. An entry applies only while CWMS still serves the position it was written against. If CWMS moves the station, the station keeps CWMS's position, and the refresh reports the entry and fails the run until a person checks it.",
      evidence:
        "| Station | CWMS | USGS gauge | Off by |\n| --- | --- | --- | --- |\n| `MVK.Olive_Branch`, Coldwater River at Olive Branch | 37.9075, −89.7533 | 07275900, 34.9075, −89.7533 | 334 km; latitude 3° off |\n| `MVK.Oxford`, Yocona River at Oxford | 32.2733, −89.5214 | 07274000, 34.2733, −89.5214 | 222 km; latitude 2° off |\n| `MVN.Bayou_Boeuf-Amelia` | 29.8691, −90.5950 | 073814675, 29.6683, −91.0997, railroad bridge at Amelia | 54 km |\n| `MVN.Chicot_Pass-Myette`, Chicot Pass near Myette Point | 30.0680, −91.4740, the same as `MVN.Chicot_Pass` near West Fork | 073815450, 29.8927, −91.4457 | 20 km |\n| `LRN.RoaringR_Hilham`, Roaring River near Hilham | 36.3409, −85.5902 | 03418000, 36.3409, −85.4264 | 15 km |\n| `LRN.WFBrownsCr_Glen`, West Fork Browns Creek at Glendale Lane | 36.2177, −86.8202 | 03431100, 36.0943, −86.7939 | 14 km |\n\nFound by matching every USACE station's river and place names against USGS and the other districts' catalogs on 2026-11-08. MVN's Baton Rouge, 113 km south, is [#64](https://github.com/openwatersio/stillwell/issues/64).",
      report:
        "Not sent: held until upstream reports go out. It goes to MVN Water Management for its gauges (CEMVN-WATER-MANAGEMENT@usace.army.mil), to the Nashville District for LRN's (lrn.water.management@usace.army.mil, from its Water Management contact page), and to the adapter's default contact for MVK's, whose own isn't confirmed. It asks each to check the coordinates and correct them in CWMS, and says the store places the gauges at USGS's positions until then.",
      check: async (store, e) => {
        for (const id of e.stations!) await moved(store, id);
      },
    },
    {
      id: "usace-longitude-sign",
      stations: ["usace/MVK.Pine_Bluff", "usace/LRL.BuckCreek", "usace/LRH.PleasantHill-Outflow"],
      handling: "corrected",
      error:
        "The CWMS location catalog drops the minus sign of the longitude at three locations, which puts them in Asia.",
      response:
        "The station refresh moves each station to USGS's gauge's position, listed in `POSITIONS` in `src/positions.ts`. An entry applies only while CWMS still serves the position it was written against. If CWMS moves the station, the station keeps CWMS's position, and the refresh reports the entry and fails the run until a decision settles it.",
      evidence:
        "Positions read 2026-11-24. Each USGS record is a gauge at the same structure, from the USGS site service.\n\n| Station | CWMS | USGS gauge | Off by |\n| --- | --- | --- | --- |\n| `MVK.Pine_Bluff`, Arkansas River at Pine Bluff, AR | 34.29028, +91.99556 | 07263650, Arkansas River at Pine Bluff, AR: 34.29027778, −91.9955556 | 0 km, with the sign restored |\n| `LRL.BuckCreek`, Buck Creek below C J Brown Reservoir | 39.951389, +83.754167 | 03268100, Buck Creek bl CJ Brown Reservoir nr Springfield OH: 39.951449, −83.7540936 | 0.01 km |\n| `LRH.PleasantHill-Outflow` | 40.620518, +82.323769 | 03133500, Clear Fork bl Pleasant Hill Dam nr Perrysville OH: 40.6203379, −82.3243284 | 0.05 km |\n\nWith the sign restored, each CWMS position is within 60 m of its gauge, on the stream and at the dam its name gives.",
      report:
        "Not sent: held until upstream reports go out. It goes to MVK, LRL and LRH's water managers, whose own contacts aren't confirmed, so to the adapter's default contact. It asks them to restore the minus sign of the three longitudes in CWMS, and says the store places the stations at USGS's positions until then.",
      check: async (store, e) => {
        for (const id of e.stations!) await moved(store, id);
      },
    },
    {
      id: "usace-red-river-datum-label",
      stations: ["usace/MVN.Red_River_Ldg"],
      handling: "corrected",
      error:
        "CWMS gives Red River Landing's gauge zero an elevation of −0.27 ft and labels it NGVD29. The value is the gauge's NAVD88 correction: MVN's own `rev-NAVD88` series applies −0.26 ft there.",
      response:
        "The station refresh puts the elevation in `datums.NAVD88` (−0.082 m) instead of `datums.NGVD29`, from `MISLABELED` in `src/sources/usace/index.ts`. The entry applies only while CWMS still serves −0.27 ft labeled NGVD29; if CWMS changes either, the store takes the catalog as served and the refresh says so.",
      evidence:
        "- CWMS `catalog/LOCATIONS` for `Red_River_Ldg` (office MVN): `elevation` −0.27, `unit` ft, `vertical-datum` NGVD29, read 2026-11-08.\n- `Red_River_Ldg.Stage.Inst.1Hour.0.rev-NAVD88` minus `Red_River_Ldg.Stage.Inst.1Hour.0.rev` is −0.26 ft at every hour compared: 42 hours in 2020 and 6,149 from 2026-01-01 to 2026-09-14.\n- MVN's other nonzero catalog elevations are NAVD88 corrections too. Harvey Lock GIWW's −0.87 ft (labeled NAVD88) matches its description's \"add -0.87' to gage data\" for NAVD88. New Orleans's −0.96 ft (labeled \"Local Datum 1\") matches its description's NAVD88 adjustment.\n- The location's description is a copy of Knox Landing's, and the RiverGages station page gives −1.04 ft (OPUS), so neither confirms it ([#76](https://github.com/openwatersio/stillwell/issues/76)).",
      report:
        "Not sent. Hold until MVN answers the data request in [#10](https://github.com/openwatersio/stillwell/issues/10) and [#76](https://github.com/openwatersio/stillwell/issues/76), which asks for each gauge's NAVD88 corrections. Then ask about this label in the same thread to the New Orleans District (CEMVN-WATER-MANAGEMENT@usace.army.mil).",
      check: async (store, e) => {
        const id = e.stations![0]!;
        await offset(store, id, "NAVD88", -0.27 * FEET);
        if ((await listed(store, id)).datums.NGVD29 !== undefined)
          throw new Error("the store lists Red River Landing with an NGVD29 offset");
      },
    },
    {
      id: "usace-relay-clock-offsets",
      stations: [
        "usace/LRP.DuquesneHeights",
        "usace/LRP.Hall",
        "usace/LRP.LittleEtna",
        "usace/LRP.SandRun",
        "usace/MVK.Bush",
        "usace/MVK.Calhoun_City",
        "usace/MVK.Franklinton",
        "usace/MVK.Oxford",
        "usace/MVK.Tendal",
        "usace/MVS.Eureka-Meramec",
        "usace/MVS.Taylor-S_Fabius",
        "usace/MVS.Union-Bourbeuse",
      ],
      handling: "kept",
      error:
        "Some district series in CWMS relay a USGS gauge's readings at other times than USGS gives them: in 2026, 12 gauges' values equal their USGS gauge's 45 minutes to 2 hours later (Hall, Franklinton), or an hour earlier (Little Pine Creek near Etna), on 52 to 96% of readings. The offset differs by gauge, isn't a whole number of hours at most of them, doesn't change with daylight saving time, and at Hall moves between 105 and 120 minutes from month to month. It isn't one time zone taken for another, and CDA's times are epoch milliseconds, which the adapter keeps as they are.",
      response:
        "Kept as served, since no steady offset could correct them. Every one links to its USGS gauge, which its group prefers for observed levels: eleven by nearness and name, and Tendal by a decision in `LINKS` (src/same-as.ts).",
      evidence:
        "November 2026: each gauge's 2026 values against its USGS gauge's at 15-minute lags from −3 to +3 hours, in millimeters. Best lags, with the share of readings equal there: Tendal +60 min (95%), Union +45 (96%), Eureka +45 (89%), Sand Run +90 (83%), Bush +105 (73%), Little Pine Creek −60 (70%), Franklinton +120 (65%), Duquesne Heights +105 (64%), Taylor +45 (57%), Oxford +45 (54%), Calhoun City +60 (53%), Hall +120 (52%). At their own times, equal readings are rare outside slack water. Hall in 2024 and 2025 fits best at 105 or 120 minutes, month by month. Found by the store's level match of November 2026, which put 23 USACE gauges level with their USGS twins only at an hour or two's offset; the other 11 match on fewer than half their readings at any lag in 2026, or best at no lag.",
      // Tendal's values equal its USGS gauge's an hour later, and at its own times much less often.
      check: async (store) => {
        const tendal = await store.levels("usace/MVK.Tendal", "2026-10-01", "2026-11-01");
        const usgs = new Map(
          (await store.levels("usgs/07369500", "2026-10-01", "2026-11-02")).map((o) => [
            o.time,
            o.level,
          ]),
        );
        const equal = (lag: number) => {
          const pairs = tendal.filter((o) => usgs.has(o.time + lag));
          if (!pairs.length)
            throw new Error(`Tendal shares no times with USGS 07369500 at ${lag / 60_000} min`);
          return (
            pairs.filter((o) => Math.abs(o.level - usgs.get(o.time + lag)!) < 0.002).length /
            pairs.length
          );
        };
        const [same, later] = [equal(0), equal(3_600_000)];
        if (later < 0.9 || later - same < 0.2)
          throw new Error(
            `Tendal equals USGS 07369500 on ${Math.round(later * 100)}% of readings an hour later and ${Math.round(same * 100)}% at once`,
          );
        const row = (await store.rows("stations.parquet")).find((r) => r.id === "usace/MVK.Tendal");
        if (row?.preferred !== "usgs/07369500")
          throw new Error(`Tendal's group prefers ${row?.preferred}, not USGS 07369500`);
      },
    },
    {
      id: "usace-fill-values",
      stations: [
        "usace/LRH.CaptAMeldahlLD-Pool",
        "usace/LRH.HawksNest",
        "usace/LRH.MiddleIslandCr",
        "usace/LRN.ANTT1-MillCr-AntiochTN",
        "usace/LRN.BIGT1-BigSandyR-BrucetonTN",
        "usace/LRN.BYGT1-WolfR-ByrdstownTN",
        "usace/LRN.CKVT1-CumberlandR-ClarksvilleTN",
        "usace/LRN.COLT1-DuckR-ColumbiaTN",
        "usace/LRN.CTHT1-CumberlandR-CarthageTN",
        "usace/LRN.CumbR_Cockrill",
        "usace/LRN.CumbR_Omohundro",
        "usace/LRN.CumbR_StonesR",
        "usace/LRN.DBLT1-BigRockCr-nrDoubleBridgesTN",
        "usace/LRN.DOVT1-CumberlandR-DoverTN",
        "usace/LRN.EMGT1-YellowCr-EllisMillsTN",
        "usace/LRN.LBVT1-BuffaloR-blwLobelvilleTN",
        "usace/LRN.ManskersCr_Hwy41",
        "usace/LRN.MillCr_Nolensvll",
        "usace/LRN.NAST1-CumberlandR-NashvilleTN",
        "usace/LRN.PENT1-CumberlandR-PenitentiaryBrTN",
        "usace/LRN.PRVT1-TennesseeR-PerryvilleTN",
        "usace/LRN.SMLK2-CumberlandR-SmithlandKY",
        "usace/LRN.WFBrownsCr_Glen",
        "usace/LRP.Blaine",
        "usace/LRP.Cooksburg",
        "usace/LRP.Dailey",
        "usace/LRP.Dillonvale",
        "usace/LRP.ElmGrove",
        "usace/LRP.Enterprise",
        "usace/LRP.Grantsville",
        "usace/LRP.Mosquito-Outflow",
        "usace/LRP.Piney-Outflow",
        "usace/MVK.Arkabutla_Lake-Tailwater",
        "usace/MVK.Cypress_Byu_Lake",
        "usace/MVK.Dogwood_Trail",
        "usace/MVK.Helena",
        "usace/MVK.Joyce",
        "usace/MVK.Lake_Bistineau",
        "usace/MVK.Low_Water_Bridge",
        "usace/MVK.New_Madrid",
        "usace/MVK.Olive_Branch",
        "usace/MVK.Pendleton",
        "usace/MVK.Portland",
        "usace/MVK.Remmel_Dam",
        "usace/MVK.Sheridan",
        "usace/MVK.Simmsport",
        "usace/MVK.Smackover",
        "usace/MVK.Springhill",
        "usace/MVK.Tendal",
        "usace/MVM.BD111",
        "usace/MVM.LA104",
        "usace/MVM.MS116",
        "usace/MVM.MS117",
        "usace/MVM.MS121",
        "usace/MVM.MS132",
        "usace/MVM.MS133",
        "usace/MVM.MS134",
        "usace/MVM.SF118",
        "usace/MVM.SF128",
        "usace/MVM.SJ111",
        "usace/MVM.WR118",
        "usace/MVN.Bayou_Sorrel_Lck",
        "usace/MVN.CAIRO",
        "usace/MVN.Chicot_Pass",
        "usace/MVN.Grand_Pass_USGS",
        "usace/MVN.Lwr_Grand_Sorrel",
        "usace/MVN.ORCC-LowSill_Structure_Inflow",
        "usace/MVN.Schooner_Bayou_E",
        "usace/MVN.Schooner_Bayou_W",
        "usace/MVN.Walker_DS_FS",
        "usace/MVS.Bethany-Marrowbone_Cr",
        "usace/MVS.Chesterville-Kaskaskia",
        "usace/MVS.Cox_Bridge-Kaskaskia",
        "usace/MVS.Delta-Castor",
        "usace/MVS.Desloge-Big",
        "usace/MVS.Greenville-St_Francis",
        "usace/MVS.LD_25_TW-Mississippi",
        "usace/MVS.Millcreek-St_Francis",
        "usace/MVS.Nav_TW-Kaskaskia",
        "usace/MVS.Rend_Lk-Big_Muddy",
        "usace/MVS.Richwoods-Big",
        "usace/MVS.Sullivan-Jonathan_Cr",
      ],
      since: "1982-01-01",
      handling: "dropped",
      error:
        "These 82 CWMS series hold levels no gauge can read, outside the store's span of −500 to 9,000 m: 409,338 values in 147 station-years from 1982 to 2026. Most are 99,999 ft (30,479.695 m) or −99,999 ft, and −1.04 × 10³⁸ m at the Cumberland River gauges; the rest are values such as 999,999 ft and 9,999,999 ft, up to 2 × 10¹⁶ m.",
      response:
        "The store leaves out a level outside its span (`SPAN_M` in src/span.ts) wherever it fetches levels, and requalify drops any it holds. A year file of nothing else keeps its rows, flagged `bad`, with a warning, until `ingest delete-years` deletes it.",
      evidence:
        "November 2026. A scan of the range of levels in every year file of every source in the store (335,320 files) found 383 holding a level outside the span, which were then read in full; each of them also has a `bad` value, as QC flags every level outside the span.",
      check: (store) => impossibleDropped(store, "usace/MVK.Helena", 2026),
    },
  ],
  retired: [],
} satisfies ErrataFile;
