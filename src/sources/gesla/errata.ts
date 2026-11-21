import { flaggedSpan, impossibleDropped, type Check, type ErrataFile } from "../../errata.ts";
import { POSITIONS } from "../../positions.ts";
import { Flag } from "../../schema.ts";
import { distanceKm, median } from "../../stats.ts";
import { dropped, fits, levels, station } from "./check.ts";

/** Each of the entry's records is listed within 0.5 km of its gauge's position in `POSITIONS`. */
const atPositions: Check = async (store, e) => {
  const rows = await store.rows("stations.parquet");
  for (const id of e.stations!) {
    const at = POSITIONS[id]?.at;
    if (!at) throw new Error(`POSITIONS holds no position for ${id}`);
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`stations.parquet doesn't list ${id}`);
    const off = distanceKm(row as { lat: number; lon: number }, at);
    if (!(off <= 0.5))
      throw new Error(`stations.parquet lists ${id} ${off.toFixed(1)} km from its gauge`);
  }
};

export default {
  errata: [
    {
      id: "gesla-wsv-hourly-means-early",
      stations: [
        "gesla/altengamme-5930070-deu-wsv",
        "gesla/althagen-9650024-deu-wsv",
        "gesla/anklam-9660001-deu-wsv",
        "gesla/bakea-9510063-deu-wsv",
        "gesla/bakez-9510066-deu-wsv",
        "gesla/barhft-9650040-deu-wsv",
        "gesla/barth-9650030-deu-wsv",
        "gesla/belum-5980060-deu-wsv",
        "gesla/bhvalterleuchtturm-4990010-deu-wsv",
        "gesla/borgfeld-4940010-deu-wsv",
        "gesla/borkumfischerbalje-9340020-deu-wsv",
        "gesla/borkumsdstrand-9340030-deu-wsv",
        "gesla/brake-4970020-deu-wsv",
        "gesla/breitenberg-5970038-deu-wsv",
        "gesla/bremervrdeuw-5980010-deu-wsv",
        "gesla/brokdorf-5970050-deu-wsv",
        "gesla/brunsbttelmpm-5970094-deu-wsv",
        "gesla/bsum-9510095-deu-wsv",
        "gesla/buttelerhrne-4960060-deu-wsv",
        "gesla/buxtehude-5950080-deu-wsv",
        "gesla/cranz-5950070-deu-wsv",
        "gesla/cuxhavensteubenhft-5990020-deu-wsv",
        "gesla/dagebll-9570040-deu-wsv",
        "gesla/dreyschloot-3880010-deu-wsv",
        "gesla/dukegat-3990020-deu-wsv",
        "gesla/dwarsgat-9460020-deu-wsv",
        "gesla/eckernfrde-9610045-deu-wsv",
        "gesla/eidersperrwerkap-9530010-deu-wsv",
        "gesla/eidersperrwerkbp-9520081-deu-wsv",
        "gesla/elmshornhafen-5970022-deu-wsv",
        "gesla/elsfleth-4970010-deu-wsv",
        "gesla/elsflethohrt-4960080-deu-wsv",
        "gesla/emdenneueseeschleuse-3970010-deu-wsv",
        "gesla/emshrn-9340010-deu-wsv",
        "gesla/esteinneressperrwerkbp-5950081-deu-wsv",
        "gesla/fahrenholzup-5940060-deu-wsv",
        "gesla/farge-4950020-deu-wsv",
        "gesla/flensburg-9610010-deu-wsv",
        "gesla/friedrichstadtstrassenbrcke-9520060-deu-wsv",
        "gesla/friedrichstadttreene-9520061-deu-wsv",
        "gesla/glckstadt-5970035-deu-wsv",
        "gesla/grauerortreede-5970026-deu-wsv",
        "gesla/greifswaldoie-9690078-deu-wsv",
        "gesla/greifswaldwieck-9650073-deu-wsv",
        "gesla/grnhude-5970037-deu-wsv",
        "gesla/grosseweserbrcke-4910050-deu-wsv",
        "gesla/hechthausen-5980030-deu-wsv",
        "gesla/heiligenhafen-9610070-deu-wsv",
        "gesla/helgolandbinnenhafen-9510070-deu-wsv",
        "gesla/helgolandsdhafen-9510075-deu-wsv",
        "gesla/herbrumhafendamm-3770030-deu-wsv",
        "gesla/hetlingen-5970010-deu-wsv",
        "gesla/hollersiel-4960050-deu-wsv",
        "gesla/hooksielplate-9430020-deu-wsv",
        "gesla/horneburg-5960020-deu-wsv",
        "gesla/hrnum-9570050-deu-wsv",
        "gesla/hundsmhlen-4960020-deu-wsv",
        "gesla/huntebrck-4960070-deu-wsv",
        "gesla/husum-9530020-deu-wsv",
        "gesla/ilmenausperrwerkap-5940080-deu-wsv",
        "gesla/itzehoehafen-5970042-deu-wsv",
        "gesla/jadeweserport-9430050-deu-wsv",
        "gesla/kappeln-9610035-deu-wsv",
        "gesla/karlshagen-9690085-deu-wsv",
        "gesla/karnin-9690084-deu-wsv",
        "gesla/kielholtenau-9610066-deu-wsv",
        "gesla/kloster-9670050-deu-wsv",
        "gesla/knock-3990010-deu-wsv",
        "gesla/kollmar-5970025-deu-wsv",
        "gesla/koserow-9690093-deu-wsv",
        "gesla/krautsandreede-5970031-deu-wsv",
        "gesla/krckausperrwerkap-5970024-deu-wsv",
        "gesla/krckausperrwerkbp-5970023-deu-wsv",
        "gesla/langballigau-9610015-deu-wsv",
        "gesla/langeoog-9390010-deu-wsv",
        "gesla/lauterbach-9670063-deu-wsv",
        "gesla/lbeckbauhof-9620090-deu-wsv",
        "gesla/ledasperrwerkup-3880050-deu-wsv",
        "gesla/leerort-3910010-deu-wsv",
        "gesla/leuchtturmalteweser-9460040-deu-wsv",
        "gesla/lhort-5960010-deu-wsv",
        "gesla/listaufsylt-9570070-deu-wsv",
        "gesla/ltkiel-9610050-deu-wsv",
        "gesla/marienleuchte-9610075-deu-wsv",
        "gesla/mellumplate-9420010-deu-wsv",
        "gesla/mittelgrund-9510132-deu-wsv",
        "gesla/neuendorfhafen-9670046-deu-wsv",
        "gesla/neustadt-9610080-deu-wsv",
        "gesla/niederblockland-4940020-deu-wsv",
        "gesla/nokbrunsbttel-5970091-deu-wsv",
        "gesla/nokkielaussen-5650068-deu-wsv",
        "gesla/nokkielbinnen-5979020-deu-wsv",
        "gesla/nordenham-4970040-deu-wsv",
        "gesla/norderneyriffgat-9360010-deu-wsv",
        "gesla/nordfeldoberwasser-9520040-deu-wsv",
        "gesla/nordfeldunterwasser-9520050-deu-wsv",
        "gesla/oldenburgdrielake-4960030-deu-wsv",
        "gesla/oslebshausen-4910060-deu-wsv",
        "gesla/osteriffmpm-5970096-deu-wsv",
        "gesla/otterndorfmpm-5990011-deu-wsv",
        "gesla/over-5950010-deu-wsv",
        "gesla/papenburg-3790010-deu-wsv",
        "gesla/pellwormanleger-9550021-deu-wsv",
        "gesla/pinnausperrwerkap-5970019-deu-wsv",
        "gesla/pinnausperrwerkbp-5970018-deu-wsv",
        "gesla/pogum-3950020-deu-wsv",
        "gesla/rechtenfleth-4970030-deu-wsv",
        "gesla/reithrne-4960040-deu-wsv",
        "gesla/ritterhude-4940030-deu-wsv",
        "gesla/robbensdsteert-9460010-deu-wsv",
        "gesla/ruden-9690077-deu-wsv",
        "gesla/sassnitz-9670065-deu-wsv",
        "gesla/scharhrn-9510060-deu-wsv",
        "gesla/schillig-9430030-deu-wsv",
        "gesla/schleimndesp-9610025-deu-wsv",
        "gesla/schulau-5950090-deu-wsv",
        "gesla/spiekeroog-9410010-deu-wsv",
        "gesla/stadersand-5970013-deu-wsv",
        "gesla/stahlbrode-9650070-deu-wsv",
        "gesla/stralsund-9650043-deu-wsv",
        "gesla/terborg-3910020-deu-wsv",
        "gesla/thiessow-9670067-deu-wsv",
        "gesla/timmendorfpoel-9630007-deu-wsv",
        "gesla/tnning-9520070-deu-wsv",
        "gesla/travemnde-9620085-deu-wsv",
        "gesla/ueckermnde-9690088-deu-wsv",
        "gesla/uetersen-5970016-deu-wsv",
        "gesla/vegesack-4950010-deu-wsv",
        "gesla/wangeroogenord-9420030-deu-wsv",
        "gesla/wangeroogewest-9420040-deu-wsv",
        "gesla/warnemnde-9640015-deu-wsv",
        "gesla/wasserhorst-4930010-deu-wsv",
        "gesla/weener-3790020-deu-wsv",
        "gesla/wehrgeesthachtup-5930062-deu-wsv",
        "gesla/weserwehruw-4910040-deu-wsv",
        "gesla/whvaltervorhafen-9440020-deu-wsv",
        "gesla/whvneuervorhafen-9440030-deu-wsv",
        "gesla/wittdn-9570010-deu-wsv",
        "gesla/wittowerfhre-9670055-deu-wsv",
        "gesla/wolgast-9650080-deu-wsv",
        "gesla/zehnerloch-9510010-deu-wsv",
        "gesla/zollenspieker-5930090-deu-wsv",
      ],
      handling: "corrected",
      error:
        "GESLA 4.1 stamps WSV's hourly means at the start of the hour they average, so every WSV value is labeled 30 minutes before the middle of its hour.",
      response:
        "The adapter moves every WSV record's times 30 minutes later, to the middle of the hour each value averages.",
      evidence:
        "At Cuxhaven Steubenhöft in 2015, the value `gesla/cuxhavensteubenhft-5990020-deu-wsv` labels T equals the mean of PEGELONLINE's 1-minute values (`pegelonline/5990020`, in the store) from T to T + 60 minutes, with a standard deviation of 3.7 mm over 8,757 hours. Against PEGELONLINE's single value at T the spread is 266 mm, and at T + 30 minutes it's 19 mm. BfG's copy of the same gauge (`cuxhaven_steubenhoft-cux-deu-bfg`) matches PEGELONLINE at T exactly, so the offset is in the WSV records only. With the shift, `scripts/clock-check.ts` fits Cuxhaven (against UHSLC's and BfG's TICON records) and Helgoland (against CMEMS's) at 0 minutes. 4.1 fixed 4.0's local time labeled as UTC at WSV; this half hour is what's left.",
      // Cuxhaven Steubenhöft's hourly means, moved to the middle of their hour, line up with PEGELONLINE's minute values.
      check: (store) =>
        fits(
          store,
          "gesla/cuxhavensteubenhft-5990020-deu-wsv",
          "pegelonline/5990020",
          "2015-06-01",
          "2015-06-08",
          0,
          [-30, 0, 30],
        ),
    },
    {
      id: "gesla-hong-kong-hour-early",
      stations: [
        "gesla/hong_kong-329-hkg-uhslc_fd",
        "gesla/hong_kong-329a-hkg-uhslc_rq",
        "gesla/hong_kong-329b-hkg-uhslc_rq",
      ],
      handling: "corrected",
      error:
        "GESLA 4.1 copies UHSLC's Hong Kong (Quarry Bay) records with UHSLC's times, which are an hour early: the height labeled T was measured at T + 1 h UTC.",
      response:
        "The adapter moves the three records' times an hour later, as the `uhslc` adapter does for UHSLC's own series (erratum `uhslc-hong-kong-hour-early`).",
      evidence:
        "GESLA's values are UHSLC's at the same labels: on 2010-06-01 at 00:00, 01:00 and 02:00, `hong_kong-329b-hkg-uhslc_rq` gives 2.13, 2.23 and 2.28 m, and UHSLC's ERDDAP (`global_hourly_rqds`, 329 version B) 2130, 2230 and 2280 mm; on 2024-06-01 the fast-delivery record matches `global_hourly_fast` the same way. slackwater-database found UHSLC's hour against the Hong Kong Observatory's predictions ([openwatersio/slackwater-database#360](https://github.com/openwatersio/slackwater-database/issues/360)). With the shift, `scripts/clock-check.ts` on 2015 fits 329 and 329b at 0 minutes against slackwater-database's re-fit.",
      // Both records line up with the `uhslc` source's Quarry Bay, which it moves the same hour.
      check: async (store) => {
        await fits(
          store,
          "gesla/hong_kong-329b-hkg-uhslc_rq",
          "uhslc/329",
          "2010-06-01",
          "2010-06-15",
          0,
          [-60, 0, 60],
        );
        await fits(
          store,
          "gesla/hong_kong-329-hkg-uhslc_fd",
          "uhslc/329",
          "2024-06-01",
          "2024-06-08",
          0,
          [-60, 0, 60],
        );
      },
    },
    {
      id: "gesla-spain-uhslc-hour-early",
      stations: [
        "gesla/las_palmas-217a-esp-uhslc_rq",
        "gesla/las_palmas-217b-esp-uhslc_rq",
        "gesla/las_palmas-217c-esp-uhslc_rq",
        "gesla/vigo-208a-esp-uhslc_rq",
      ],
      handling: "corrected",
      error:
        "GESLA 4.1 copies UHSLC's research-quality versions of Vigo (208a) and its older ones of Las Palmas (217a, 217b, 217c, to 1991) with UHSLC's times, which are an hour early (erratum `uhslc-spain-hour-early`). Its copies of Las Palmas's later versions (217, 217d) are on time.",
      response:
        "The adapter moves the four records' times an hour later, as the `uhslc` adapter does for UHSLC's own series.",
      evidence:
        "M2's phase in GESLA's four copies is 240 to 245° a year at Vigo and 189 to 201° at Las Palmas, the same as UHSLC's versions and 29° (an hour) below IEO's records of the gauges, Puertos del Estado's (CMEMS) and Las Palmas's later UHSLC versions in GESLA, 217 and 217d, at 220 to 225°.",
      // Vigo's UHSLC copy lines up with IEO's record of the gauge, which is on time.
      check: (store) =>
        fits(
          store,
          "gesla/vigo-208a-esp-uhslc_rq",
          "gesla/vigo-vigo-esp-ieo",
          "1980-06-01",
          "1980-06-15",
          0,
          [-60, 0, 60],
        ),
    },
    {
      id: "gesla-santa-cruz-de-la-palma-hour-early",
      stations: ["gesla/cruz-cruz-esp-ieo"],
      since: "1949-04-30",
      until: "1987-01-01",
      handling: "corrected",
      error:
        "GESLA 4.1's IEO record of Santa Cruz de la Palma (`cruz-cruz-esp-ieo`) is an hour early from its start in 1949 to the end of 1986: the height labeled T was measured at T + 1 h UTC. The record has no values from 1987 to 1995, and from 1996 it is on time.",
      response:
        "The adapter moves the record's values labeled before 1990, within its gap, an hour later.",
      evidence:
        "November 2026. UHSLC's versions of the gauge (`uhslc/206a`, `uhslc/206b`) equal the record an hour later in every year they share, 1949 to 1980, at a standard deviation of 0.6 to 6 cm a year. M2's phase in the record is 189 to 198° a year to 1986 and 223 to 230° from 1996, against 218 to 228° in UHSLC's versions (1949 to 1990) and in CMEMS's La Palma gauge (from 2007). Of GESLA's 12 IEO records, only this one changes phase by an hour. The store's level match of November 2026 found it equal to UHSLC's only at an hour's offset.",
      // Moved, the record lines up with UHSLC's version B in 1970; unmoved after its gap, with CMEMS's La Palma in 2010.
      check: async (store, e) => {
        const id = station(e);
        await fits(store, id, "uhslc/206b", "1970-06-01", "1970-06-15", 0, [-60, 0, 60]);
        await fits(
          store,
          id,
          "gesla/lapalmatg-lap-esp-cmems",
          "2010-06-01",
          "2010-06-15",
          0,
          [-60, 0, 60],
        );
      },
    },
    {
      id: "gesla-progreso-uhslc-721a-six-hours-late",
      stations: ["gesla/progreso_yuc-721a-mex-uhslc_rq"],
      handling: "corrected",
      error:
        "GESLA 4.1 copies UHSLC's Progreso version A (721a) with UHSLC's times, which are 6 hours late (erratum `uhslc-progreso-721a-six-hours-late`).",
      response:
        "The adapter moves the record's times 6 hours earlier, as the `uhslc` adapter does for UHSLC's own series.",
      evidence:
        "K1's and M2's phases in GESLA's copy are 119° and 282°, the same as UHSLC's version A. November 2026. GESLA's copy of UNAM's historical Progreso record (`progreso-402-mex-unam_hist`) equals UHSLC's version A 6 hours later in 1982 and 1983 (r 0.998, standard deviation 1.4 cm), against r 0.88 or less at any other whole hour. K1's and M2's phases in version A are 119° and 282°; in UNAM's record from 1952 to 1993 they are 21° and 105°, in UHSLC's versions B (1999 to 2004) and C (2012 to 2013) 28° and 110° and 10° and 105°, and at the Yucatán gauges either side, Celestún, Sisal and Telchac, 13 to 15° and 101 to 109°. Six hours moves K1 by 90° and M2 by 174°.",
      // Moved, version A lines up with UNAM's historical Progreso record.
      check: (store, e) =>
        fits(
          store,
          station(e),
          "gesla/progreso-402-mex-unam_hist",
          "1982-06-01",
          "1982-06-15",
          0,
          [-360, -60, 0, 60, 360],
        ),
    },
    {
      id: "gesla-scott-base-ttw-nzst",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2016-01-05",
      until: "2025-01-01",
      handling: "corrected",
      error:
        "GESLA 4.1's Toitū Te Whenua record of Scott Base, Antarctica (`scott_base_antarctica-scot-nzl-ttw`, 2016 to 2024) is on New Zealand Standard Time (UTC+12) labeled UTC, except from November 2023 to October 2024, when it is on UTC+13 (erratum `gesla-scott-base-ttw-nzdt-2023`): the height labeled T was measured at T − 12 h UTC.",
      response: "The adapter moves the record's times 12 hours earlier.",
      evidence:
        "November 2026. The record equals UHSLC's Scott Base (`uhslc/663a`) 12 hours earlier in every month they share, February 2016 to June 2017 (r 0.93 to 1.00 a month, 0.97 in all, standard deviation 5.9 cm, slope 0.97); at its own times they're anti-correlated (r −0.4 to −0.86), since Scott Base's tide is diurnal. K1's phase in the record is 18 to 32° a year from 2016 to 2024, against 182 to 204° in UHSLC's record (2001 to 2017) and 181 to 217° in Toitū Te Whenua's Cape Roberts record nearby; 12 hours moves K1 by 180°. Toitū Te Whenua's other GESLA records match UHSLC's at the same times. LINZ's README for the gauge says its early times are NZST (see the `linz` source's README). The store's level match of November 2026 found the two 45 cm apart at every lag up to 2 hours.",
      // Moved, the record lines up with UHSLC's Scott Base, on UTC.
      check: (store, e) =>
        fits(
          store,
          station(e),
          "uhslc/663a",
          "2016-06-01",
          "2016-06-15",
          0,
          [-720, -60, 0, 60, 720],
        ),
    },
    {
      id: "gesla-queensland-2020-aest",
      stations: [
        "gesla/cape_ferguson-h033007a-aus-bom",
        "gesla/cardwell-h035012a-aus-bom",
        "gesla/cooktown-h066003a-aus-bom",
        "gesla/fishermans_landing-h052003b-aus-bom",
        "gesla/half_tide_tug_harbour-h060010a-aus-bom",
        "gesla/south_trees-h052026a-aus-bom",
        "gesla/thursday_island-h057022b-aus-bom",
      ],
      since: "2019-12-31",
      until: "2026-01-01",
      handling: "corrected",
      error:
        "From 2020, GESLA 4.1's seven Queensland records that run past 2019 (Cape Ferguson, Cardwell, Cooktown, Fishermans Landing, Half Tide Tug Harbour, South Trees and Thursday Island) are on Australian Eastern Standard Time (UTC+10), labeled UTC: the height labeled T was measured at T − 10 h UTC. Before 2020 they're on UTC, and each ends at 13:50 UTC on 31 December 2019, local midnight; each 2020 part starts at a label of 00:00 on 1 January. From 2020 a label on day 1 to 12 of a month also has its day and month swapped: the values labeled 1 March were measured on 3 January, and those labeled 3 January on 1 March.",
      response:
        "For the records' times labeled from 1 January 2020, the adapter swaps the day and month of a date whose day is 12 or less, then moves the time 10 hours earlier. That joins the two parts with no gap or overlap and gives one time for each label.",
      evidence:
        "November 2026. In each of the seven records K1's phase moves by +148 to +152° and M2's by −69 to −72° from 2019 to 2020 and stays there through 2025, the shift 10 hours makes (+150° and −70°), while UHSLC's and BOM's own Cape Ferguson series (`uhslc/343a`, `gesla/cape_ferguson-59260-aus-bom`) hold their phases. Before 2020 Cape Ferguson's record equals UHSLC's at the same times to 1 to 3 cm (standard deviation) a year; in 2020 and 2021 it equals it 10 hours earlier on 409 of 730 days (r 0.99 or more a day, 3 to 4 cm). Most of the hours that differ are on days 1 to 12 of a month: in 2020, after the 10-hour move, 2,704 of 3,456 hours on those days are more than 10 cm from UHSLC's (standard deviation 50 cm), and with day and month swapped 26 are (1.6 cm). On days 13 to 31, 47 of 5,328 hours are. With both fixes, Cape Ferguson's record differs from UHSLC's by 1.7 cm (standard deviation) in 2020 and 4.4 cm in 2021, 10 minutes after UHSLC's times as in 2019 (3.3 cm), against 32 and 35 cm with the 10-hour move alone. In the raw file the label 2020/03/01 00:00 follows 2020/02/29 23:50 with a step of 84 cm, both flagged correct. In all seven records the mean step where day 12 meets day 13 and where a month meets the next is 3 to 13 cm a year to 2019, the size of the records' 10-minute steps, and 38 to 113 cm from 2020 to 2025; with day and month swapped back they're 1 to 12 cm in every record and year, against 3.5 to 10.6 cm for the records' other 10-minute steps, and no two values share a time. The same step test on the stored values of every other GESLA record with values from 2020 (3,131 with such joins) finds no other record with the swap. The store's level match of November 2026 found the record 75 cm from UHSLC's.",
      // Fixed, Cape Ferguson's record lines up with UHSLC's 10 minutes later, as before 2020, on days 1 to 12 of March as well as after.
      check: (store) =>
        fits(
          store,
          "gesla/cape_ferguson-h033007a-aus-bom",
          "uhslc/343a",
          "2020-03-01",
          "2020-03-31",
          -10,
          [-600, -60, -10, 0, 60, 600],
        ),
    },
    {
      id: "gesla-sfwmd-est",
      stations: [
        "gesla/biscaynebay_s123_t-s123-usa-sfwmd",
        "gesla/biscaynebay_s20f_t-s20f-usa-sfwmd",
        "gesla/biscaynebay_s20g_t-s20g-usa-sfwmd",
        "gesla/biscaynebay_s21_t-s21_t-usa-sfwmd",
        "gesla/biscaynebay_s21a_t-s21a-usa-sfwmd",
        "gesla/biscaynebay_s22_t-s22_t-usa-sfwmd",
        "gesla/calahootchieriver_markh-markh-usa-sfwmd",
        "gesla/calahootchieriver_s79_t-s79_t-usa-sfwmd",
        "gesla/calahootchieriver_vali_75-vali7-usa-sfwmd",
        "gesla/cocohatchee_river_coco1_t-coco1-usa-sfwmd",
        "gesla/g54_t_westfortlauderdale-g54_t-usa-sfwmd",
        "gesla/g56_t_pampanobay-g56_t-usa-sfwmd",
        "gesla/g57_t_navd88-g57_t-usa-sfwmd",
        "gesla/g58_h_navd88-g58_h-usa-sfwmd",
        "gesla/g93_t-g93_t-usa-sfwmd",
        "gesla/gg1_floridawestcoast-gg1_t-usa-sfwmd",
        "gesla/gordon_floridawestcoast-gordo-usa-sfwmd",
        "gesla/gordy_t_navd88-gordy-usa-sfwmd",
        "gesla/haldeman_navd88-halde-usa-sfwmd",
        "gesla/hendersoncreek_southwestflorida_hc1_t-hc1_t-usa-sfwmd",
        "gesla/mbts_navd88-mbts-usa-sfwmd",
        "gesla/mdts-mdts-usa-sfwmd",
        "gesla/miami_north_s27_t-s27_t-usa-sfwmd",
        "gesla/miami_north_s28_t-s28_t-usa-sfwmd",
        "gesla/miami_s25_t-s25_t-usa-sfwmd",
        "gesla/miami_s25b_t-s25b-usa-sfwmd",
        "gesla/miami_s25bm_t_navd88-s25bm-usa-sfwmd",
        "gesla/miamiriver_mrms1-mrms1-usa-sfwmd",
        "gesla/miamiriver_mrms4-mrms4-usa-sfwmd",
        "gesla/miamiriver_s26_t-s26_t-usa-sfwmd",
        "gesla/s13_navd88_t-s13_t-usa-sfwmd",
        "gesla/s155_t_lakeworthlagoon-s155-usa-sfwmd",
        "gesla/s197_t-s197-usa-sfwmd",
        "gesla/s29_t_biscaynebaynorth_navd88-s29_t-usa-sfwmd",
        "gesla/s36_t-s36_t-usa-sfwmd",
        "gesla/s37a-s37a-usa-sfwmd",
        "gesla/s40_t-s40_t-usa-sfwmd",
        "gesla/s41_t_boyntonbeach-s41_t-usa-sfwmd",
        "gesla/s44_t-s44_t-usa-sfwmd",
        "gesla/s46_t_loxahatchee_southwestfork-s46_t-usa-sfwmd",
        "gesla/s49_t_st_lucie_northfork-s49_t-usa-sfwmd",
        "gesla/tpts_navd88-tpts-usa-sfwmd",
        "gesla/wcoco_t_navd88-wcoco-usa-sfwmd",
      ],
      handling: "corrected",
      error:
        "GESLA 4.1's 43 South Florida Water Management District records are on Eastern Standard Time (UTC−5) all year, labeled UTC: the height labeled T was measured at T + 5 h UTC.",
      response:
        "The adapter moves every SFWMD record's times 5 hours later. They also sit on another zero than SFWMD's own NAVD88 series, about 47 cm apart, which the store measures as a link offset.",
      evidence:
        "November 2026. Each of the 36 records with an SFWMD series of its gauge in the store and a year in common was compared with it, in its first, middle and last such year, at every whole hour from −8 to +8. 34 fit best 5 hours later, from 1974 to 2024, at r 0.98 to 1.00 and a standard deviation of 0.0 to 3.7 cm, against r 0.94 or less at any other hour, but for S-197 from January to June 1998, which fits best 4 hours later and is moved 5 like the rest. Thursday Point and West Coconut Grove, where the tide is weak, fit at r 0.8 or less at 5 to 8 hours; Thursday Point's M2 phase is 140° from SFWMD's, about 5 hours. Gordon River and Haldeman Creek equal SFWMD's `GORDON_2_T` and `HALDEMAN_T` 5 hours later (r 1.00). S-79, S-37A, S-46 and Henderson Creek have no series to compare in the same years and are moved with the rest. Lake Worth Lagoon's S155 record equals CO-OPS's Lake Worth ICW gauge (8722669) 5 hours later too (r 0.997, 2009). The store's level match of November 2026 found GESLA's SFWMD records 20 to 54 cm from SFWMD's own series at the same times.",
      // Moved, S-123's record lines up with SFWMD's own series of the gauge.
      check: (store) =>
        fits(
          store,
          "gesla/biscaynebay_s123_t-s123-usa-sfwmd",
          "sfwmd/S123_T",
          "2010-06-01",
          "2010-06-15",
          0,
          [-300, -60, 0, 60, 300],
        ),
    },
    {
      id: "gesla-vardo-uhslc-2007-2018-five-minutes-late",
      stations: ["gesla/vardo-805-nor-uhslc_fd", "gesla/vardo-805a-nor-uhslc_rq"],
      since: "2007-01-01",
      until: "2019-01-01",
      handling: "kept",
      error:
        "GESLA 4.1 copies UHSLC's Vardø records (805 and 805a) with UHSLC's times, whose values from 2007 to 2018 are 5 minutes late (erratum `uhslc-vardo-2007-2018-five-minutes-late`).",
      response:
        "Kept as served, as UHSLC's own series is (erratum `uhslc-vardo-2007-2018-five-minutes-late`). Kartverket's own series of the gauge is the group's preferred series.",
      evidence:
        "Both copies fit Kartverket's series best 300 seconds earlier in 2010 and 2016, and at their own times in 2005, as UHSLC's own series does. GESLA's NHS and CMEMS copies of the gauge fit at their own times in all three years.",
      // Kept late: the research-quality copy lines up with Kartverket's Vardø 5 minutes earlier.
      check: (store) =>
        fits(
          store,
          "gesla/vardo-805a-nor-uhslc_rq",
          "kartverket/VAW",
          "2010-06-01",
          "2010-06-15",
          -5,
          [-10, -5, 0, 5, 10],
        ),
    },
    {
      id: "gesla-vardo-uhslc-1989-2003-decimeters",
      stations: ["gesla/vardo-805-nor-uhslc_fd", "gesla/vardo-805a-nor-uhslc_rq"],
      since: "1989-11-01",
      until: "2004-01-01",
      handling: "kept",
      error:
        "GESLA 4.1 copies UHSLC's Vardø records (805 and 805a) with UHSLC's values, which from 1 November 1989 to 2003 are whole decimeters (erratum `uhslc-vardo-1989-2003-decimeters`).",
      response:
        "Kept as served, as UHSLC's own series is. Kartverket's own series of the gauge is the group's preferred series.",
      evidence:
        "November 2026. Both copies hold whole decimeters throughout 1998, as `uhslc/805` does, and finer values in 2005.",
      check: async (store) => {
        for (const [id, year, whole] of [
          ["gesla/vardo-805a-nor-uhslc_rq", 1998, true],
          ["gesla/vardo-805-nor-uhslc_fd", 1998, true],
          ["gesla/vardo-805-nor-uhslc_fd", 2005, false],
        ] as const) {
          const rows = await levels(store, id, `${year}-03-01`, `${year}-04-01`);
          const share =
            rows.filter((o) => Math.abs(o.level * 10 - Math.round(o.level * 10)) < 1e-6).length /
            rows.length;
          if (whole ? share < 0.99 : share > 0.2)
            throw new Error(
              `${(100 * share).toFixed(1)}% of ${id}'s March ${year} values are whole decimeters`,
            );
        }
      },
    },
    {
      id: "gesla-vardo-uhslc-zero-steps",
      stations: ["gesla/vardo-805-nor-uhslc_fd", "gesla/vardo-805a-nor-uhslc_rq"],
      since: "1989-11-01",
      handling: "kept",
      error:
        "GESLA 4.1 copies UHSLC's Vardø records (805 and 805a) with UHSLC's values, whose zero sits at four heights above Kartverket's chart datum from 1989 (erratum `uhslc-vardo-zero-steps`).",
      response:
        "Kept as served, as UHSLC's own series is. Kartverket's own series of the gauge is the group's preferred series.",
      evidence:
        "November 2026. Against `kartverket/VAW` at the same hours, the research-quality copy's median difference is 866 mm in March 1998 and 926 in June 2010, and the fast-delivery copy's is 907 mm in June 2022, as `uhslc/805`'s are.",
      check: async (store) => {
        for (const [id, span, expected] of [
          ["gesla/vardo-805a-nor-uhslc_rq", ["1998-03-01", "1998-04-01"], 866],
          ["gesla/vardo-805a-nor-uhslc_rq", ["2010-06-01", "2010-07-01"], 925],
          ["gesla/vardo-805-nor-uhslc_fd", ["2022-06-01", "2022-07-01"], 907],
        ] as const) {
          const kartverket = new Map(
            (await levels(store, "kartverket/VAW", span[0], span[1])).map((o) => [o.time, o.level]),
          );
          const d = (await levels(store, id, span[0], span[1]))
            .filter((o) => kartverket.has(o.time))
            .map((o) => o.level - kartverket.get(o.time)!);
          if (d.length < 500) throw new Error(`${id} shares ${d.length} hours with Kartverket`);
          const mm = median(d) * 1000;
          if (Math.abs(mm - expected) > 6)
            throw new Error(`${id} sits ${mm.toFixed(0)} mm above kartverket/VAW, not ${expected}`);
        }
      },
    },
    {
      id: "gesla-crms-hour-early",
      stations: [
        "gesla/crms0002-crms0002-usa-crms",
        "gesla/crms0003-crms0003-usa-crms",
        "gesla/crms0006-crms0006-usa-crms",
        "gesla/crms0008-crms0008-usa-crms",
        "gesla/crms0030-crms0030-usa-crms",
        "gesla/crms0033-crms0033-usa-crms",
        "gesla/crms0034-crms0034-usa-crms",
        "gesla/crms0035-crms0035-usa-crms",
        "gesla/crms0038-crms0038-usa-crms",
        "gesla/crms0039-crms0039-usa-crms",
        "gesla/crms0046-crms0046-usa-crms",
        "gesla/crms0047-crms0047-usa-crms",
        "gesla/crms0056-crms0056-usa-crms",
        "gesla/crms0058-crms0058-usa-crms",
        "gesla/crms0059-crms0059-usa-crms",
        "gesla/crms0061-crms0061-usa-crms",
        "gesla/crms0063-crms0063-usa-crms",
        "gesla/crms0065-crms0065-usa-crms",
        "gesla/crms0086-crms0086-usa-crms",
        "gesla/crms0089-crms0089-usa-crms",
        "gesla/crms0097-crms0097-usa-crms",
        "gesla/crms0103-crms0103-usa-crms",
        "gesla/crms0108-crms0108-usa-crms",
        "gesla/crms0114-crms0114-usa-crms",
        "gesla/crms0115-crms0115-usa-crms",
        "gesla/crms0117-crms0117-usa-crms",
        "gesla/crms0118-crms0118-usa-crms",
        "gesla/crms0119-crms0119-usa-crms",
        "gesla/crms0120-crms0120-usa-crms",
        "gesla/crms0121-crms0121-usa-crms",
        "gesla/crms0125-crms0125-usa-crms",
        "gesla/crms0129-crms0129-usa-crms",
        "gesla/crms0131-crms0131-usa-crms",
        "gesla/crms0132-crms0132-usa-crms",
        "gesla/crms0135-crms0135-usa-crms",
        "gesla/crms0136-crms0136-usa-crms",
        "gesla/crms0139-crms0139-usa-crms",
        "gesla/crms0146-crms0146-usa-crms",
        "gesla/crms0147-crms0147-usa-crms",
        "gesla/crms0148-crms0148-usa-crms",
      ],
      handling: "corrected",
      error:
        "GESLA 4.1's copies of 40 CRMS gauges in Louisiana, at sites CRMS0002 to CRMS0148, are an hour early: the height labeled T was measured at T + 1 h UTC. TICON-4's records fitted from these copies share the hour.",
      response:
        "The adapter moves the 40 records' times an hour later, as it does Hong Kong's, over each whole record: the 35 record-years CPRA's export doesn't cover are moved on the same record's clock. Of GESLA's other 300 CRMS records, CRMS0090 and CRMS0128 hold the site's marsh well an hour early and are flagged whole, kept as served (erratum `gesla-crms0090-marsh-well`, erratum `gesla-crms0128-marsh-well`). The other 298 hold another site's values and are dropped (erratum `gesla-crms-wrong-site`). CPRA's own series (`crms`) are preferred to every GESLA CRMS record.",
      evidence:
        "Compared hour by hour with the store's `crms` series, from CPRA's export of 8 November 2026, after removing each year's median offset (GESLA's values before October 2013 sit a few centimeters to decimeters off CPRA's GEOID99 ones, 0.107 m at CRMS0002). Moved one hour later, each of the 40 records equals CPRA's series to the millimeter on 94 to 100% of hours in every one of its 714 years that CPRA's export covers (median 100%, 5.27 million hours, 2006 to 2025). At GESLA's own times, and at two hours later or one hour earlier, the same years match on a median 7% or less, the hours when a calm marsh doesn't change. The records' other 35 record-years, between 2007 and 2012, hold the site's marsh well, which they equal to the millimeter at the same shift (flagged by nine errata such as erratum `gesla-crms0008-marsh-well`). Of GESLA's other CRMS records, 270 match CPRA's series on fewer than 30% of hours at every shift from one hour earlier to two hours later, and 30 have no CPRA values in the years compared, CRMS0090's and CRMS0128's among them. Independently, GESLA's CRMS0061 equals USGS's real-time relay of the gauge (CRMS0061-H01-RT, site 301324090382400) to 0.0 mm through 2015 at one hour later, and CPRA's export is on Central Standard Time by the tide's phase against NOAA gauges (see the `crms` README).",
      // Moved, CRMS0061's record lines up with CPRA's own series of the gauge.
      check: (store) =>
        fits(
          store,
          "gesla/crms0061-crms0061-usa-crms",
          "crms/CRMS0061-H01",
          "2015-06-01",
          "2015-06-15",
          0,
          [-120, -60, 0, 60, 120],
        ),
    },
    {
      id: "gesla-crms-wrong-site",
      stations: [
        "gesla/crms0151-crms0151-usa-crms",
        "gesla/crms0153-crms0153-usa-crms",
        "gesla/crms0154-crms0154-usa-crms",
        "gesla/crms0156-crms0156-usa-crms",
        "gesla/crms0157-crms0157-usa-crms",
        "gesla/crms0159-crms0159-usa-crms",
        "gesla/crms0161-crms0161-usa-crms",
        "gesla/crms0162-crms0162-usa-crms",
        "gesla/crms0163-crms0163-usa-crms",
        "gesla/crms0164-crms0164-usa-crms",
        "gesla/crms0171-crms0171-usa-crms",
        "gesla/crms0172-crms0172-usa-crms",
        "gesla/crms0173-crms0173-usa-crms",
        "gesla/crms0174-crms0174-usa-crms",
        "gesla/crms0175-crms0175-usa-crms",
        "gesla/crms0176-crms0176-usa-crms",
        "gesla/crms0178-crms0178-usa-crms",
        "gesla/crms0179-crms0179-usa-crms",
        "gesla/crms0181-crms0181-usa-crms",
        "gesla/crms0184-crms0184-usa-crms",
        "gesla/crms0185-crms0185-usa-crms",
        "gesla/crms0188-crms0188-usa-crms",
        "gesla/crms0189-crms0189-usa-crms",
        "gesla/crms0190-crms0190-usa-crms",
        "gesla/crms0192-crms0192-usa-crms",
        "gesla/crms0194-crms0194-usa-crms",
        "gesla/crms0197-crms0197-usa-crms",
        "gesla/crms0200-crms0200-usa-crms",
        "gesla/crms0206-crms0206-usa-crms",
        "gesla/crms0209-crms0209-usa-crms",
        "gesla/crms0211-crms0211-usa-crms",
        "gesla/crms0217-crms0217-usa-crms",
        "gesla/crms0218-crms0218-usa-crms",
        "gesla/crms0219-crms0219-usa-crms",
        "gesla/crms0220-crms0220-usa-crms",
        "gesla/crms0224-crms0224-usa-crms",
        "gesla/crms0225-crms0225-usa-crms",
        "gesla/crms0226-crms0226-usa-crms",
        "gesla/crms0232-crms0232-usa-crms",
        "gesla/crms0234-crms0234-usa-crms",
        "gesla/crms0237-crms0237-usa-crms",
        "gesla/crms0241-crms0241-usa-crms",
        "gesla/crms0248-crms0248-usa-crms",
        "gesla/crms0251-crms0251-usa-crms",
        "gesla/crms0253-crms0253-usa-crms",
        "gesla/crms0258-crms0258-usa-crms",
        "gesla/crms0260-crms0260-usa-crms",
        "gesla/crms0261-crms0261-usa-crms",
        "gesla/crms0263-crms0263-usa-crms",
        "gesla/crms0268-crms0268-usa-crms",
        "gesla/crms0272-crms0272-usa-crms",
        "gesla/crms0273-crms0273-usa-crms",
        "gesla/crms0276-crms0276-usa-crms",
        "gesla/crms0278-crms0278-usa-crms",
        "gesla/crms0282-crms0282-usa-crms",
        "gesla/crms0287-crms0287-usa-crms",
        "gesla/crms0290-crms0290-usa-crms",
        "gesla/crms0292-crms0292-usa-crms",
        "gesla/crms0293-crms0293-usa-crms",
        "gesla/crms0294-crms0294-usa-crms",
        "gesla/crms0296-crms0296-usa-crms",
        "gesla/crms0400-crms0400-usa-crms",
        "gesla/crms0403-crms0403-usa-crms",
        "gesla/crms0409-crms0409-usa-crms",
        "gesla/crms0411-crms0411-usa-crms",
        "gesla/crms0414-crms0414-usa-crms",
        "gesla/crms0416-crms0416-usa-crms",
        "gesla/crms0421-crms0421-usa-crms",
        "gesla/crms0434-crms0434-usa-crms",
        "gesla/crms0461-crms0461-usa-crms",
        "gesla/crms0463-crms0463-usa-crms",
        "gesla/crms0464-crms0464-usa-crms",
        "gesla/crms0465-crms0465-usa-crms",
        "gesla/crms0479-crms0479-usa-crms",
        "gesla/crms0482-crms0482-usa-crms",
        "gesla/crms0484-crms0484-usa-crms",
        "gesla/crms0488-crms0488-usa-crms",
        "gesla/crms0489-crms0489-usa-crms",
        "gesla/crms0490-crms0490-usa-crms",
        "gesla/crms0493-crms0493-usa-crms",
        "gesla/crms0494-crms0494-usa-crms",
        "gesla/crms0496-crms0496-usa-crms",
        "gesla/crms0498-crms0498-usa-crms",
        "gesla/crms0499-crms0499-usa-crms",
        "gesla/crms0501-crms0501-usa-crms",
        "gesla/crms0504-crms0504-usa-crms",
        "gesla/crms0507-crms0507-usa-crms",
        "gesla/crms0508-crms0508-usa-crms",
        "gesla/crms0511-crms0511-usa-crms",
        "gesla/crms0513-crms0513-usa-crms",
        "gesla/crms0514-crms0514-usa-crms",
        "gesla/crms0517-crms0517-usa-crms",
        "gesla/crms0520-crms0520-usa-crms",
        "gesla/crms0522-crms0522-usa-crms",
        "gesla/crms0523-crms0523-usa-crms",
        "gesla/crms0524-crms0524-usa-crms",
        "gesla/crms0527-crms0527-usa-crms",
        "gesla/crms0528-crms0528-usa-crms",
        "gesla/crms0529-crms0529-usa-crms",
        "gesla/crms0530-crms0530-usa-crms",
        "gesla/crms0531-crms0531-usa-crms",
        "gesla/crms0532-crms0532-usa-crms",
        "gesla/crms0535-crms0535-usa-crms",
        "gesla/crms0536-crms0536-usa-crms",
        "gesla/crms0541-crms0541-usa-crms",
        "gesla/crms0542-crms0542-usa-crms",
        "gesla/crms0543-crms0543-usa-crms",
        "gesla/crms0544-crms0544-usa-crms",
        "gesla/crms0545-crms0545-usa-crms",
        "gesla/crms0547-crms0547-usa-crms",
        "gesla/crms0549-crms0549-usa-crms",
        "gesla/crms0550-crms0550-usa-crms",
        "gesla/crms0551-crms0551-usa-crms",
        "gesla/crms0552-crms0552-usa-crms",
        "gesla/crms0553-crms0553-usa-crms",
        "gesla/crms0554-crms0554-usa-crms",
        "gesla/crms0556-crms0556-usa-crms",
        "gesla/crms0557-crms0557-usa-crms",
        "gesla/crms0560-crms0560-usa-crms",
        "gesla/crms0562-crms0562-usa-crms",
        "gesla/crms0565-crms0565-usa-crms",
        "gesla/crms0567-crms0567-usa-crms",
        "gesla/crms0568-crms0568-usa-crms",
        "gesla/crms0570-crms0570-usa-crms",
        "gesla/crms0571-crms0571-usa-crms",
        "gesla/crms0572-crms0572-usa-crms",
        "gesla/crms0574-crms0574-usa-crms",
        "gesla/crms0575-crms0575-usa-crms",
        "gesla/crms0576-crms0576-usa-crms",
        "gesla/crms0580-crms0580-usa-crms",
        "gesla/crms0581-crms0581-usa-crms",
        "gesla/crms0583-crms0583-usa-crms",
        "gesla/crms0584-crms0584-usa-crms",
        "gesla/crms0587-crms0587-usa-crms",
        "gesla/crms0588-crms0588-usa-crms",
        "gesla/crms0589-crms0589-usa-crms",
        "gesla/crms0590-crms0590-usa-crms",
        "gesla/crms0593-crms0593-usa-crms",
        "gesla/crms0595-crms0595-usa-crms",
        "gesla/crms0599-crms0599-usa-crms",
        "gesla/crms0600-crms0600-usa-crms",
        "gesla/crms0603-crms0603-usa-crms",
        "gesla/crms0604-crms0604-usa-crms",
        "gesla/crms0605-crms0605-usa-crms",
        "gesla/crms0608-crms0608-usa-crms",
        "gesla/crms0609-crms0609-usa-crms",
        "gesla/crms0610-crms0610-usa-crms",
        "gesla/crms0614-crms0614-usa-crms",
        "gesla/crms0615-crms0615-usa-crms",
        "gesla/crms0616-crms0616-usa-crms",
        "gesla/crms0618-crms0618-usa-crms",
        "gesla/crms0619-crms0619-usa-crms",
        "gesla/crms0622-crms0622-usa-crms",
        "gesla/crms0623-crms0623-usa-crms",
        "gesla/crms0624-crms0624-usa-crms",
        "gesla/crms0626-crms0626-usa-crms",
        "gesla/crms0630-crms0630-usa-crms",
        "gesla/crms0632-crms0632-usa-crms",
        "gesla/crms0633-crms0633-usa-crms",
        "gesla/crms0635-crms0635-usa-crms",
        "gesla/crms0638-crms0638-usa-crms",
        "gesla/crms0639-crms0639-usa-crms",
        "gesla/crms0641-crms0641-usa-crms",
        "gesla/crms0642-crms0642-usa-crms",
        "gesla/crms0644-crms0644-usa-crms",
        "gesla/crms0645-crms0645-usa-crms",
        "gesla/crms0647-crms0647-usa-crms",
        "gesla/crms0648-crms0648-usa-crms",
        "gesla/crms0650-crms0650-usa-crms",
        "gesla/crms0651-crms0651-usa-crms",
        "gesla/crms0655-crms0655-usa-crms",
        "gesla/crms0656-crms0656-usa-crms",
        "gesla/crms0658-crms0658-usa-crms",
        "gesla/crms0660-crms0660-usa-crms",
        "gesla/crms0661-crms0661-usa-crms",
        "gesla/crms0662-crms0662-usa-crms",
        "gesla/crms0663-crms0663-usa-crms",
        "gesla/crms0665-crms0665-usa-crms",
        "gesla/crms0669-crms0669-usa-crms",
        "gesla/crms0672-crms0672-usa-crms",
        "gesla/crms0677-crms0677-usa-crms",
        "gesla/crms0680-crms0680-usa-crms",
        "gesla/crms0682-crms0682-usa-crms",
        "gesla/crms0683-crms0683-usa-crms",
        "gesla/crms0684-crms0684-usa-crms",
        "gesla/crms0685-crms0685-usa-crms",
        "gesla/crms0687-crms0687-usa-crms",
        "gesla/crms0691-crms0691-usa-crms",
        "gesla/crms0693-crms0693-usa-crms",
        "gesla/crms0694-crms0694-usa-crms",
        "gesla/crms0697-crms0697-usa-crms",
        "gesla/crms0978-crms0978-usa-crms",
        "gesla/crms1024-crms1024-usa-crms",
        "gesla/crms1069-crms1069-usa-crms",
        "gesla/crms1100-crms1100-usa-crms",
        "gesla/crms1130-crms1130-usa-crms",
        "gesla/crms1205-crms1205-usa-crms",
        "gesla/crms1277-crms1277-usa-crms",
        "gesla/crms1409-crms1409-usa-crms",
        "gesla/crms1413-crms1413-usa-crms",
        "gesla/crms1446-crms1446-usa-crms",
        "gesla/crms1650-crms1650-usa-crms",
        "gesla/crms1738-crms1738-usa-crms",
        "gesla/crms1743-crms1743-usa-crms",
        "gesla/crms1838-crms1838-usa-crms",
        "gesla/crms1858-crms1858-usa-crms",
        "gesla/crms1965-crms1965-usa-crms",
        "gesla/crms2041-crms2041-usa-crms",
        "gesla/crms2154-crms2154-usa-crms",
        "gesla/crms2156-crms2156-usa-crms",
        "gesla/crms2166-crms2166-usa-crms",
        "gesla/crms2189-crms2189-usa-crms",
        "gesla/crms2219-crms2219-usa-crms",
        "gesla/crms2334-crms2334-usa-crms",
        "gesla/crms2418-crms2418-usa-crms",
        "gesla/crms2493-crms2493-usa-crms",
        "gesla/crms2568-crms2568-usa-crms",
        "gesla/crms2608-crms2608-usa-crms",
        "gesla/crms2614-crms2614-usa-crms",
        "gesla/crms2627-crms2627-usa-crms",
        "gesla/crms2634-crms2634-usa-crms",
        "gesla/crms2785-crms2785-usa-crms",
        "gesla/crms2825-crms2825-usa-crms",
        "gesla/crms2830-crms2830-usa-crms",
        "gesla/crms2854-crms2854-usa-crms",
        "gesla/crms2862-crms2862-usa-crms",
        "gesla/crms2881-crms2881-usa-crms",
        "gesla/crms2887-crms2887-usa-crms",
        "gesla/crms2939-crms2939-usa-crms",
        "gesla/crms2991-crms2991-usa-crms",
        "gesla/crms3054-crms3054-usa-crms",
        "gesla/crms3136-crms3136-usa-crms",
        "gesla/crms3166-crms3166-usa-crms",
        "gesla/crms3169-crms3169-usa-crms",
        "gesla/crms3296-crms3296-usa-crms",
        "gesla/crms3565-crms3565-usa-crms",
        "gesla/crms3590-crms3590-usa-crms",
        "gesla/crms3601-crms3601-usa-crms",
        "gesla/crms3617-crms3617-usa-crms",
        "gesla/crms3626-crms3626-usa-crms",
        "gesla/crms3639-crms3639-usa-crms",
        "gesla/crms3641-crms3641-usa-crms",
        "gesla/crms3650-crms3650-usa-crms",
        "gesla/crms3664-crms3664-usa-crms",
        "gesla/crms3667-crms3667-usa-crms",
        "gesla/crms3680-crms3680-usa-crms",
        "gesla/crms3784-crms3784-usa-crms",
        "gesla/crms3800-crms3800-usa-crms",
        "gesla/crms3913-crms3913-usa-crms",
        "gesla/crms3985-crms3985-usa-crms",
        "gesla/crms4014-crms4014-usa-crms",
        "gesla/crms4016-crms4016-usa-crms",
        "gesla/crms4045-crms4045-usa-crms",
        "gesla/crms4094-crms4094-usa-crms",
        "gesla/crms4103-crms4103-usa-crms",
        "gesla/crms4107-crms4107-usa-crms",
        "gesla/crms4110-crms4110-usa-crms",
        "gesla/crms4218-crms4218-usa-crms",
        "gesla/crms4245-crms4245-usa-crms",
        "gesla/crms4355-crms4355-usa-crms",
        "gesla/crms4406-crms4406-usa-crms",
        "gesla/crms4407-crms4407-usa-crms",
        "gesla/crms4448-crms4448-usa-crms",
        "gesla/crms4455-crms4455-usa-crms",
        "gesla/crms4529-crms4529-usa-crms",
        "gesla/crms4548-crms4548-usa-crms",
        "gesla/crms4551-crms4551-usa-crms",
        "gesla/crms4557-crms4557-usa-crms",
        "gesla/crms4572-crms4572-usa-crms",
        "gesla/crms4596-crms4596-usa-crms",
        "gesla/crms4626-crms4626-usa-crms",
        "gesla/crms4690-crms4690-usa-crms",
        "gesla/crms5003-crms5003-usa-crms",
        "gesla/crms5035-crms5035-usa-crms",
        "gesla/crms5116-crms5116-usa-crms",
        "gesla/crms5167-crms5167-usa-crms",
        "gesla/crms5255-crms5255-usa-crms",
        "gesla/crms5267-crms5267-usa-crms",
        "gesla/crms5373-crms5373-usa-crms",
        "gesla/crms5414-crms5414-usa-crms",
        "gesla/crms5452-crms5452-usa-crms",
        "gesla/crms5536-crms5536-usa-crms",
        "gesla/crms5672-crms5672-usa-crms",
        "gesla/crms5770-crms5770-usa-crms",
        "gesla/crms5845-crms5845-usa-crms",
        "gesla/crms5858-crms5858-usa-crms",
        "gesla/crms5992-crms5992-usa-crms",
        "gesla/crms6008-crms6008-usa-crms",
        "gesla/crms6038-crms6038-usa-crms",
        "gesla/crms6042-crms6042-usa-crms",
        "gesla/crms6088-crms6088-usa-crms",
        "gesla/crms6090-crms6090-usa-crms",
        "gesla/crms6209-crms6209-usa-crms",
        "gesla/crms6299-crms6299-usa-crms",
        "gesla/crms6301-crms6301-usa-crms",
        "gesla/crms6302-crms6302-usa-crms",
        "gesla/crms6303-crms6303-usa-crms",
        "gesla/crms6304-crms6304-usa-crms",
      ],
      handling: "dropped",
      error:
        "298 of GESLA 4.1's 340 CRMS records in Louisiana hold another CRMS site's surface-water series, an hour early, under their own site's name and position. Most hold one site's series throughout, often the next site in GESLA's own list of CRMS records (CRMS0153's record holds CRMS0154's series, CRMS0154's CRMS0156's, CRMS5414's CRMS5845's, CRMS6209's CRMS4014's), seven switch to yet another site in 2019 (CRMS1838's record holds CRMS2154 to 2019 and CRMS0661 after), and ten (CRMS0190, 0192, 0194, 0217, 0234, 0268, 2862, 3800, 5267 and 5373) hold an unidentified site's values that match no surface-water series in CPRA's export. Only the 40 records of `gesla-crms-hour-early` and the two marsh-well records (`gesla-crms0090-marsh-well`, `gesla-crms0128-marsh-well`) hold their own site. TICON-4's records fitted from these copies carry the wrong site's tide.",
      response:
        "The store lists the 298 records as inactive, with no products and no links, and never fetches them, as it does Uddevalla's (`gesla-uddevalla-is-arko`). No link joins them to a group, a link to one from an adapter's `same_as` or from `LINKS` is dropped, each is its own preferred series, and the TICON inventory doesn't offer them as GESLA copies. TICON's records fitted from them give no datums, since their tide is another site's. CPRA's own series (`crms`) carry every gauge the 288 matched records hold, and `ingest drop gesla` deletes their stored files. The ten unidentified records hold values the store has nowhere else, so their files stay (`KEEP_FILES`) and can still be read under their wrong names and positions, though the records are listed inactive with no products.",
      evidence:
        "Every GESLA CRMS record was compared with every `crms` series in the store, from CPRA's export of 8 November 2026, hour by hour to the millimeter, at GESLA's own times and an hour either way, for each year from 2014 to 2025 (after the GEOID12B switch, when the two sit on the same datum). 283 of the 298 records equal another site's series moved an hour later, on a median 95% of hours (52 to 100% a year, 24.1 million of 25.4 million hours, 3,279 record-years), and never their own site's. Five more (CRMS0554, 0556, 0575, 0599, 2041) correlate at r 1.00 with another site's series an hour later (CRMS0562, 0565, 0583, 0605, 2189) at a fixed offset, and ten (CRMS0190, 0192, 0194, 0217, 0234, 0268, 2862, 3800, 5267, 5373) match no `crms` series better than r 0.88. The 40 hour-early records equal their own site on 94 to 100% of hours a year once moved. GESLA's positions agree with CPRA's for the site each record is named for, so the values, not the names, are another site's. Within each stretch of GESLA's list of CRMS records, every matched record holds the series of the record a fixed number of places further on (two around CRMS0190, four around CRMS0550, five around CRMS5300). At that offset nine of the ten unidentified records fall on sites with no surface-water series in CPRA's export since 2014 (CRMS0194, 0197, 0200, 0219, 0241, 0273, 2991, 5672 and 5770), which is why they match nothing; CRMS3800's, where the list's order wraps, is unknown. CPRA's series are on time: USGS's own relays of two CRMS gauges, read from USGS's API with explicit UTC offsets, equal the store's `crms/CRMS0282-H01` (June 2024) and `crms/CRMS0061-H01` (January 2024) at the same times to 0.03 cm, and GESLA's CRMS0061 record, once moved an hour later, equals USGS's to the millimeter in June 2023. Matched by the store's cross-station level match of November 2026, which found GESLA's CRMS0153 equal to CRMS0154 an hour early at 0.03 cm.",
      // CRMS0153's record holds CRMS0154's series; CRMS0190's, an unidentified site's, which the store keeps.
      check: async (store) => {
        await dropped(
          store,
          "gesla/crms0153-crms0153-usa-crms",
          2021,
          "gesla/crms0061-crms0061-usa-crms",
        );
        await dropped(store, "gesla/crms0190-crms0190-usa-crms", 2020);
      },
    },
    {
      id: "gesla-datum-jumps",
      stations: [
        "gesla/cape_dor-240-can-meds",
        "gesla/mazatlan_flotador-16-mex-unam",
        "gesla/mazatlan_radar-16-mex-unam",
        "gesla/ominato-hd04-jpn-jodc_jcg",
        "gesla/gorge_at_craigflower_bc-7124-can-meds",
        "gesla/papeeteuhslctg_01minute-pap-fra-cmems",
      ],
      handling: "flagged",
      error:
        "Some GESLA 4.1 records change datum partway through while every value stays flagged correct and usable, so a record mixes two zeros meters apart.",
      response:
        "The adapter checks every coastal record's raw levels for jumps of more than 0.75 m in the 30-day median, and flags each segment that sits more than 0.75 m from the record's longest segment as suspect, keeping GESLA's own flag in `source_flag`. The stations listed are the ones found so far; the check covers any other coastal record. `datumJumps` takes daily means of the usable values on days they span at least 12 hours of, finds where the median of the next 30 such days differs from the previous 30 days (as few as 5 near the record's ends) by more than 0.75 m, places the jump at the largest day-to-day step nearby (at least half of 0.75 m, since a jump partway through a day splits across two days), and flags every segment whose median is more than 0.75 m from the longest segment's. Rivers and lakes aren't checked, tidal ones included, since their floods move monthly medians that far: the check would flag 30% of the Connecticut at Hartford's values and 15% of the Columbia at Vancouver's. It leaves the earthquake steps at Ayukawa and Onahama (Tōhoku, 2011), Kaikōura and Wellington (2016) alone.",
      evidence:
        "Monthly means of the usable values (QC flag 1, use flag 1):\n\n| Record | Off segment | Main level |\n| --- | --- | --- |\n| Cape d'Or, MEDS 240 | 1965-06 to 1965-10: 23.5 to 32.3 m | 5.7 to 6.3 m, 1969 to 1979 |\n| Mazatlán float, UNAM 16 | 2021-06-20 to 2021-11-24: −0.1 to 1.5 m | 2.2 to 2.4 m |\n| Mazatlán radar, UNAM 16 | to 2021-11-25: 2.8 to 3.4 m | 2.2 to 2.6 m |\n| Ōminato, JCG HD04 | 1952: 3.6 to 3.8 m | 1.4 to 1.8 m, 1953 on |\n| Gorge at Craigflower, MEDS 7124 | 1969: 2.0 to 2.3 m | 0.8 m, 2011 |\n| Papeete, UHSLC's gauge, from CMEMS | 2010-09-14 to 2011-09-12: 1.43 to 1.52 m | 0.44 to 0.56 m, 2009 to 2012 |\n\nGESLA's metadata marks Cape d'Or and the Mazatlán float record \"Possible datum and quality control issues\", and Ōminato and Gorge at Craigflower \"Possible datum issues\", but leaves the values usable. The check found Ōminato and Gorge at Craigflower in a random sample of 80 coastal records, and nothing in the other 78. Papeete's CMEMS record of UHSLC's gauge (`papeeteuhslctg_01minute-pap-fra-cmems`) has the same 0.95 m step, on the same days, as REFMAR's own record of that gauge (erratum `refmar-papeete-uhslc-2010-offset`), and the check flags it in the store. GESLA's other Papeete records covering 2010 and 2011 (UHSLC's 015 and 015B, REFMAR's 383 and CMEMS's copy of it) don't have it.",
      check: async (store, e) => {
        // The entry has no span, so each record's off segment is one. Ōminato's runs from the record's start to 31 October 1952, and its values resume, clear, on 19 November.
        const ominato = "gesla/ominato-hd04-jpn-jodc_jcg";
        await flaggedSpan(store, { id: e.id, stations: null, since: null, until: "1952-11-01" }, [
          ominato,
        ]);
        const clear = await levels(store, ominato, "1952-11-19", "1952-11-20");
        if (clear.some((o) => o.flag >= Flag.suspect))
          throw new Error(`some of ${ominato}'s levels on 1952-11-19 are suspect`);
        await flaggedSpan(
          store,
          { id: e.id, stations: null, since: "2010-09-14", until: "2011-09-13" },
          ["gesla/papeeteuhslctg_01minute-pap-fra-cmems"],
        );
      },
    },
    {
      id: "gesla-wewak-time-zone",
      stations: ["gesla/wewak-56070-png-bom"],
      handling: "avoided",
      error:
        "GESLA 4.1's Wewak record (BOM 56070, Papua New Guinea) says its times are UTC+1 (`TIME ZONE HOURS 1`, in the file's header and the metadata CSV), but its values are on UTC. It's the only record in the release that isn't labeled UTC.",
      response:
        "The adapter keeps Wewak's times as served, on UTC, and ignores the header's time zone. Any other record labeled off UTC is refused rather than converted.",
      evidence:
        "`scripts/clock-check.ts` on 1990, against UHSLC's TICON record for the same gauge (`wewak-063a-png-uhslc_rq`): as served, the series fits best at −10 minutes (r 0.962) and K1 at −5 minutes. Moved by the header's hour to UTC, it fits best at −70 minutes. UTC+1 isn't Papua New Guinea's time zone either (UTC+10).",
      // Kept on UTC, the record lines up with UHSLC's Wewak, not an hour off.
      check: (store, e) =>
        fits(store, station(e), "uhslc/063a", "1990-06-01", "1990-06-15", 0, [-60, 0, 60]),
    },
    {
      id: "gesla-uhslc-positions",
      stations: [
        "gesla/port_stanley-290a-gbr-uhslc_rq",
        "gesla/port_stanley-290-gbr-uhslc_fd",
        "gesla/port_stanley-290b-gbr-uhslc_rq",
        "gesla/meulaboh-914-idn-uhslc_fd",
        "gesla/acapulco_gro-316c-mex-uhslc_rq",
        "gesla/kaumalapau_hi-548a-usa-uhslc_rq",
        "gesla/thule_pituffik-808-dnk-uhslc_fd",
        "gesla/castletownbere-835-irl-uhslc_fd",
        "gesla/castletownsend-835a-irl-uhslc_rq",
        "gesla/langkawi-142a-mys-uhslc_rq",
        "gesla/sao_tome-225a-stp-uhslc_rq",
        "gesla/macae-719a-bra-uhslc_rq",
        "gesla/sadeng-417-idn-uhslc_fd",
        "gesla/ammassalik-297a-dnk-uhslc_rq",
        "gesla/port_sonara-816-cmr-uhslc_fd",
        "gesla/alotau-069a-png-uhslc_rq",
        "gesla/nouakchott-806-mrt-uhslc_fd",
        "gesla/inhambane-900-moz-uhslc_fd",
        "gesla/davao-372-phl-uhslc_fd",
        "gesla/bundaberg-332-aus-uhslc_fd",
        "gesla/ofunato-351-jpn-uhslc_fd",
        "gesla/st_helena-292-shn-uhslc_fd",
      ],
      handling: "corrected",
      error:
        "GESLA 4.1's copies of UHSLC series keep positions UHSLC had when GESLA copied them. UHSLC has corrected most of them since, and 22 records sit 5 to 112 km from their gauge, some at sea or inland.",
      response:
        "The station refresh moves each record to the gauge's position, listed with its source in `POSITIONS` in `src/positions.ts`. An entry applies only while GESLA still serves the position it was written against; a release that moves the record keeps GESLA's position, and the refresh reports the entry and fails the run until a person checks it. With the positions corrected, eleven GESLA records whose UHSLC links were dropped as 10 to 91 km apart link to UHSLC's series again.",
      evidence:
        "Positions are GESLA's and the gauge's, from UHSLC's current metadata unless the source says otherwise:\n\n| Record | GESLA | Gauge | Source of the gauge's position |\n| --- | --- | --- | --- |\n| Port Stanley 290A (1964–1974) | -52.7, -57.867 | -51.6903, -57.8649 | PSMSL Stanley (1082); UHSLC carries the same error (`uhslc-positions`) |\n| Port Stanley 290, 290B (1992 on) | -51.75, -57.933 | -51.6924, -57.8205 | PSMSL Stanley II (1796) |\n| Meulaboh 914 | 5.128, 96.132 | 4.1275, 96.1319 | IOC (meul) |\n| Acapulco 316C | 16.842, -99.852 | 16.8379, -99.903 | IOC (acap2) |\n| Kaumalapau 548A | 20.78, -156.9 | 20.79, -156.995 | CO-OPS 1614465, as GESLA's own 548 FD and NOAA records have it |\n| Thule 808 | 76, -68 | 76.5434, -68.8626 | IOC (thul) |\n| Castletownbere 835, 835A | 51.533, -9.183 | 51.6496, -9.9034 | IOC (cast); GESLA's is near Castletownshend, 51 km east |\n| Langkawi 142A | 6.87, 99.77 | 6.4305, 99.7629 | PSMSL (1676) |\n| São Tomé 225A | 0.017, 6.513 | 0.3483, 6.7367 | IOC (saot) |\n| Macaé 719A | -22.233, -41.467 | -22.385, -41.77 | GLOSS (352) |\n| Sadeng 417 | -8.5, 110.783 | -8.1902, 110.798 | IOC (sade) |\n| Ammassalik 297A | 65.6, -37 | 65.615, -37.625 | IOC (tasw) |\n| Port Sonara 816 | 4.217, 9.133 | 4.0067, 9.1267 | IOC (sona) |\n| Alotau 069A | -10.168, 150.453 | -10.3167, 150.4533 | PSMSL (1607) |\n| Nouakchott 806 | 18.1, -15.95 | 17.99, -16.0367 | UHSLC's FD and RQ series; GESLA's is 8 km inland |\n| Inhambane 900 | -23.917, 35.5 | -23.8683, 35.3767 | UHSLC's FD and RQ series, on Inhambane's waterfront |\n| Davao 372 (1998 on) | 7.083, 125.633 | 7.1537, 125.6629 | IOC (davo); GESLA's is PSMSL's older Davao gauge, which 372A keeps |\n| Bundaberg 332 | -24.833, 152.35 | -24.7667, 152.38 | PSMSL (1154) |\n| Ofunato 351 | 39.067, 141.717 | 39.0167, 141.75 | JMA (jma/OF) and IOC (ofun) |\n| St Helena 292 | -15.967, -5.7 | -15.9167, -5.7167 | IOC (sthl2) |\n\nAmbon 133, Sabang 123 and Davao 372A also disagree with UHSLC by 5 to 7 km, but other sources don't settle which is right, so they're kept as served. slackwater-database tracks the same positions in TICON's copies in [openwatersio/slackwater-database#375](https://github.com/openwatersio/slackwater-database/issues/375). Among the 22, Meulaboh sits 111 km north of its gauge and Langkawi 49 km north, in Thailand.",
      check: atPositions,
    },
    {
      id: "gesla-uddevalla-is-arko",
      stations: ["gesla/uddevalla-2541-swe-smhi"],
      since: "2014-04-02",
      until: "2026-06-18",
      handling: "dropped",
      error:
        "GESLA 4.1's Uddevalla record (`uddevalla-2541-swe-smhi`) holds Arkö's data. Its rows are identical to `arko-2545-swe-smhi`, from a Baltic gauge 300 km east, so it has no Skagerrak tide and carries Arkö's mean level. TICON-4's Uddevalla record, fitted from it, has the same error.",
      response:
        "SMHI's own series (`smhi/2541`) and GESLA's CMEMS copy (`gesla/uddevalla-udd-swe-cmems`) carry Uddevalla. The store lists it as inactive, with no products and no links, and never fetches it. No link joins it to a group, a link to it from an adapter's `same_as` or from `LINKS` is dropped, it is its own preferred series, and the TICON inventory doesn't offer it as a GESLA copy.",
      evidence:
        "The data rows of the two files from GESLA's CloudFront links are byte-identical, and both match the store's `smhi/2545` (Arkö) to 0 mm on all 98,855 shared hours. Against SMHI's own Uddevalla series they correlate at r 0.19 to 0.36 hourly. SMHI's Uddevalla matches GESLA's CMEMS copy to 0 mm and nearby Stenungsund at r 0.98. The record starts at Arkö's first hour (2014-04-02), not Uddevalla's (2010-12-15). TICON-4's two records have identical constants (M2 0.008 m) and MSL (0.108 m), while TICON-4's CMEMS Uddevalla has M2 0.141 m. Of GESLA's 71 SMHI records, this is the only one whose start disagrees with SMHI's station of the same ID.",
      check: (store, e) => dropped(store, station(e), 2015, "gesla/arko-2545-swe-smhi"),
    },
    {
      id: "gesla-st-pauli-wrong-minute",
      stations: ["gesla/stpaulitg-stp-deu-cmems"],
      since: "2025-03-01",
      until: "2026-06-01",
      handling: "kept",
      error:
        "From March 2025, GESLA 4.1's St. Pauli record (from CMEMS) has about 16% of its 10-minute values taken from a different minute than its timestamp says. Most are 1 or 2 cm off, but some are up to 42 cm off at mid-tide. GESLA flags all of them as correct and usable.",
      response:
        "The store keeps the values as GESLA serves them. The group's preferred station is `pegelonline/5952050`, which takes its history from HPA's own archive on kuestendaten.de, and that archive has the right values.",
      evidence:
        "I compared GESLA's record (`stpaulitg-stp-deu-cmems`, created 2026-07-19) with HPA's 1-minute file for gauge 5952050 from kuestendaten.de (downloaded 2026-11-09, shifted from UTC+1 to UTC).\n\n- From 1999-11-01 to 2025-02-28, every one of about 1.3 million shared 10-minute times differs by exactly 5.004 m, which is the gauge zero's offset to NHN. That holds for all 12,954 times in December 2024 to February 2025 too.\n- From 2025-03-01 03:40 to the end of the record on 2026-05-31, 12,838 of 65,622 shared times differ. Of those, 10,207 are off by 1 cm, 1,991 by 2 cm, 640 by 3 to 9 cm and 101 by more than 5 cm, up to 42 cm. Every month from March 2025 to May 2026 has between 759 and 931.\n- At 11,803 of the 12,838, GESLA's value equals HPA's value from a minute within 10 minutes of the stated time, most often 1 minute before or after. The large differences come from minutes 5 to 29 away, on the steep part of the tide. 5,495 are single points with both 10-minute neighbors matching HPA exactly.\n- HPA's series is smooth around these times. Its largest 1-minute step near the 101 large differences is 3 cm. Against Seemannshöft and Blankenese, two HPA gauges downstream, HPA's St. Pauli value is the one that fits the local difference between the gauges at 100 of the 101 large differences. The median departure is 1 cm for HPA and 6 cm for GESLA.\n- Example (UTC, meters above gauge zero): on 2025-05-14 06:10, HPA has 6.12 and GESLA 5.82. Seemannshöft has 6.04, and both copies have 6.29 at 06:00 and 5.98 at 06:20.\n\nThere's no third copy to compare with. PEGELONLINE's REST API keeps 31 days, and BSH's `508P` holds predictions only.",
      // Kept as served: 2025-05-14 06:10 holds a value from another minute, 16 cm below the next on a falling tide (HPA has it 14 cm above).
      check: async (store, e) => {
        const rows = await levels(store, station(e), "2025-05-14", "2025-05-15");
        const at = (hhmm: string) =>
          rows.find((o) => o.time === Date.parse(`2025-05-14T${hhmm}:00Z`))?.level;
        const [before, wrong, after] = [at("06:00"), at("06:10"), at("06:20")];
        if (before === undefined || wrong === undefined || after === undefined)
          throw new Error(
            "the store holds no St. Pauli value at 06:00, 06:10 or 06:20 on 2025-05-14",
          );
        if (!(wrong < after - 0.1 && after < before))
          throw new Error(
            `St. Pauli reads ${before}, ${wrong} and ${after} m at 06:00, 06:10 and 06:20 on 2025-05-14, not GESLA's dip`,
          );
      },
    },
    {
      id: "gesla-goteborg-2007-hour-early",
      stations: ["gesla/goteborgorsh-819-swe-uhslc_fd", "gesla/goteborgorsh-819a-swe-uhslc_rq"],
      since: "2007-07-23",
      until: "2008-01-01",
      handling: "flagged",
      error:
        "GESLA's copies of UHSLC's Göteborg-Torshamnen (fast delivery and research quality) are stamped one hour early from 23 July to 31 December 2007, as UHSLC's own files are.",
      response:
        "23 July to 31 December 2007 is flagged `suspect` in both records, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "Both records equal `uhslc/819` on every day of 2007, which is an hour early against SMHI's record of the gauge over that span (erratum `uhslc-goteborg-2007-hour-early`). GESLA rates the records usable.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-goteborg-2011-hour-early",
      stations: ["gesla/goteborgorsh-819-swe-uhslc_fd", "gesla/goteborgorsh-819a-swe-uhslc_rq"],
      since: "2011-02-01",
      until: "2011-07-01",
      handling: "flagged",
      error:
        "GESLA's copies of UHSLC's Göteborg-Torshamnen (fast delivery and research quality) are stamped one hour early from 1 February to 30 June 2011, as UHSLC's own files are.",
      response:
        "February to June 2011 is flagged `suspect` in both records, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "Both records equal `uhslc/819` on every day of 2011, which is an hour early against SMHI's record of the gauge over that span (erratum `uhslc-goteborg-2011-hour-early`).",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-cuxhaven-uhslc-2024-march",
      stations: ["gesla/cuxhaven-825-deu-uhslc_fd"],
      since: "2024-02-29",
      until: "2024-04-01",
      handling: "flagged",
      error:
        "GESLA's copy of UHSLC's fast-delivery Cuxhaven doesn't match the gauge's other records from 29 February to 31 March 2024, as UHSLC's own file doesn't.",
      response:
        "29 February to 31 March 2024 is flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "The record equals `uhslc/825` over the span, which differs from PEGELONLINE's and GESLA's other Cuxhaven records by 56 cm RMS (erratum `uhslc-cuxhaven-2024-march`).",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-cuxhaven-uhslc-2024-summer",
      stations: ["gesla/cuxhaven-825-deu-uhslc_fd"],
      since: "2024-07-01",
      until: "2024-09-01",
      handling: "flagged",
      error:
        "GESLA's copy of UHSLC's fast-delivery Cuxhaven doesn't match the gauge's other records in July and August 2024, as UHSLC's own file doesn't.",
      response:
        "July and August 2024 are flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "The record equals `uhslc/825` over the span, which differs from PEGELONLINE's and GESLA's other Cuxhaven records by 52 to 54 cm RMS (erratum `uhslc-cuxhaven-2024-summer`).",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-buesum-cmems-spikes",
      stations: ["gesla/buesumtg-bue-deu-cmems"],
      since: "2024-02-25",
      until: "2025-05-05",
      handling: "flagged",
      error:
        "GESLA's CMEMS record of Büsum has spikes of up to 3 m and repeated values from February 2024 to early May 2025 that PEGELONLINE's record of the gauge doesn't have.",
      response:
        "25 February 2024 to 4 May 2025 is flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026. The record equals PEGELONLINE's Büsum (`pegelonline/9510095`) to 0.0 cm through January 2024. From 25 February 2024 it differs by 3 cm RMS on most days, from values held for several 10-minute steps, and by 34 to 101 cm on 25 February, 18 March, 22 April and 1 to 3 August 2024, from spikes of up to 3 m. From 5 May 2025 to the record's end in May 2026 it matches PEGELONLINE's again, within 2 cm RMS every day.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-usgs-nj-2003-daylight-time",
      stations: [
        "gesla/absecon_creek_at_absecon_nj-1410510-usa-usgs",
        "gesla/barnegat_bay_at_barnegat_light_nj-1409125-usa-usgs",
        "gesla/barnegat_bay_at_mantoloking_nj-1408168-usa-usgs",
        "gesla/cape_may_harbor_at_cape_may_nj-1411390-usa-usgs",
        "gesla/cohansey_river_at_greenwich_nj-1413038-usa-usgs",
        "gesla/east_thorofare_at_ship_bottom_nj-1409146-usa-usgs",
      ],
      since: "2003-04-06",
      until: "2003-05-10",
      handling: "flagged",
      error:
        "GESLA's records of six USGS tide gauges in New Jersey run an hour late from 6 April to 9 May 2003, starting the day daylight saving time began.",
      response:
        "6 April to 9 May 2003 is flagged `suspect` at the six gauges, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026: the tide-timing check put all six 49 to 71 minutes late in the windows from 8 April to 8 May 2003, and nowhere near that before or after. Day by day, Cape May Harbor's tide best matches CO-OPS's Atlantic City (`coops/8534720`) at a 60-minute lag before 6 April and after 9 May, and at 120 minutes between. The store's own USGS series of these gauges start later, so only GESLA's records hold the span.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-eemshaven-waddenzee-2016-offset",
      stations: ["gesla/eemshaven_waddenzee-eem-nld-rws"],
      since: "2016-04-07",
      until: "2016-05-12",
      handling: "flagged",
      error:
        "GESLA's RWS record of Eemshaven Waddenzee sits 15 to 20 cm higher than usual against Delfzijl from 7 April to 11 May 2016.",
      response:
        "7 April to 11 May 2016 is flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "Found by the cross-station checks in `scripts/cross-check.ts` ([#121](https://github.com/openwatersio/stillwell/pull/121)), November 2026: a step of +18 cm against three of three neighboring gauges on 8 April 2016 and back on 20 May. Daily means against GESLA's Delfzijl (`gesla/delfzijl-del-nld-rws`) are about −9 cm through March and from mid-May, +1 cm on 7 April, and +7 to +12 cm on most days from 14 April to 11 May, falling to −3 cm on 12 May. The step check compares 30-day medians, so its dates are a few days off; the span follows the daily means.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-helgoland-binnenhafen-2000-offset",
      stations: ["gesla/helgolandbinnenhafen-9510070-deu-wsv"],
      until: "2000-11-01",
      handling: "flagged",
      error:
        "GESLA's WSV record of Helgoland Binnenhafen sits about 25 cm low before 1 November 2000, as PEGELONLINE's does.",
      response:
        "Values before 1 November 2000 are flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "GESLA's WSV record of the gauge, hourly means of the values PEGELONLINE serves, equals PEGELONLINE's over the span: daily means differ by 0.0 cm at the median, 0.2 cm standard deviation, over 305 days (erratum `pegelonline-helgoland-binnenhafen-2000-offset`).",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-helgoland-suedhafen-2001-offset",
      stations: ["gesla/helgolandsdhafen-9510075-deu-wsv"],
      until: "2004-01-01",
      handling: "flagged",
      error:
        "GESLA's WSV record of Helgoland Südhafen sits about 29 cm low until its 2002 and 2003 outage, as PEGELONLINE's does.",
      response:
        "Values before 2004 are flagged `suspect`, keeping GESLA's own flag as `source_flag`: the step falls in the 2002 and 2003 outage, so the few values left from then are flagged too.",
      evidence:
        "GESLA's WSV record of the gauge, hourly means of the values PEGELONLINE serves, equals PEGELONLINE's over the span: daily means differ by 0.0 cm at the median over 407 days (erratum `pegelonline-helgoland-suedhafen-2001-offset`).",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-helgoland-suedhafen-2013-clock",
      stations: ["gesla/helgolandsdhafen-9510075-deu-wsv"],
      since: "2013-05-29",
      until: "2013-07-25",
      handling: "flagged",
      error:
        "GESLA's WSV record of Helgoland Südhafen runs about 19 minutes late on 29 and 30 May and from 17 June to 24 July 2013, as PEGELONLINE's does.",
      response:
        "29 May to 24 July 2013 is flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "Its hourly values equal the means of PEGELONLINE's minute values over the same hours to 0.0 cm RMS from April to August 2013, so it carries PEGELONLINE's clock error (erratum `pegelonline-helgoland-suedhafen-2013-clock`).",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-bake-z-2004-offset",
      stations: ["gesla/bakez-9510066-deu-wsv"],
      since: "2004-11-11",
      until: "2005-03-08",
      handling: "flagged",
      error:
        "GESLA's WSV record of Bake Z sits 0.5 to 1 m high from 11 November 2004 to 7 March 2005, as PEGELONLINE's does.",
      response:
        "11 November 2004 to 7 March 2005 is flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "GESLA's WSV record of the gauge, hourly means of the values PEGELONLINE serves, equals PEGELONLINE's over the span: daily means differ by 0.0 cm at the median over 93 days, with a few days apart (erratum `pegelonline-bake-z-2004-offset`).",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-mittelgrund-2012-offset",
      stations: ["gesla/mittelgrund-9510132-deu-wsv"],
      since: "2012-10-10",
      until: "2012-11-20",
      handling: "flagged",
      error:
        "GESLA's WSV record of Mittelgrund sits about 13 cm low from 10 October to 19 November 2012, as PEGELONLINE's does.",
      response:
        "10 October to 19 November 2012 is flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "GESLA's WSV record of the gauge, hourly means of the values PEGELONLINE serves, equals PEGELONLINE's over the span: daily means differ by 0.0 cm over 41 days (erratum `pegelonline-mittelgrund-2012-offset`).",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-borkum-suedstrand-2014-offset",
      stations: ["gesla/borkumsdstrand-9340030-deu-wsv"],
      since: "2014-12-05",
      until: "2015-03-12",
      handling: "flagged",
      error:
        "GESLA's WSV record of Borkum Südstrand sits about 11 cm high from 5 December 2014 to 11 March 2015, as PEGELONLINE's does.",
      response:
        "5 December 2014 to 11 March 2015 is flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "GESLA's WSV record of the gauge, hourly means of the values PEGELONLINE serves, equals PEGELONLINE's over the span: daily means differ by 0.0 cm over 97 days (erratum `pegelonline-borkum-suedstrand-2014-offset`).",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-eriksberg-2018-tingstadstunneln",
      stations: ["gesla/goteborg_eriksberg-33096-swe-smhi"],
      since: "2018-01-01",
      until: "2018-11-13",
      handling: "flagged",
      error:
        "GESLA's SMHI record of Göteborg-Eriksberg holds Tingstadstunneln's levels from 1 January to 12 November 2018, as SMHI's own does.",
      response:
        "1 January to 12 November 2018 is flagged `suspect`, keeping GESLA's own flag as `source_flag`.",
      evidence:
        "Its daily means equal SMHI's Eriksberg (`smhi/33096`) to 0.0 cm at the median over 297 days of the span (erratum `smhi-eriksberg-2018-tingstadstunneln`). GESLA's CMEMS record of the gauge differs from SMHI's by 5 cm at the median over the span, and agrees outside it, so it may hold Eriksberg's own levels.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-kilrush-2025-01-09-offset",
      stations: ["gesla/kilrushlough-kil-irl-cmems"],
      since: "2025-01-09",
      until: "2025-01-10",
      handling: "flagged",
      error:
        "GESLA's hourly CMEMS record of Kilrush Lough holds 4 values about 6 m low, from 02:00 to 05:00 UTC on 9 January 2025, with GESLA's good flag, from the drop the Marine Institute's own record has.",
      response:
        "9 January 2025 is flagged `suspect` in the CMEMS record, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the day's other values are flagged too. GESLA's Marine Institute record (`gesla/kilrush_lough-kil-irl-mi_c`) holds the same drop as 53 values from 01:20 to 05:40, which GESLA already flags, so it isn't listed.",
      evidence:
        "In the store, checked in November 2026: the CMEMS record (`gesla/kilrushlough-kil-irl-cmems`) has 4 values below −3 m, down to −5.95 m, from 02:00 to 05:00 with flag good, against daily medians of 0.13 m on 8 January and 0.07 m on 10 January. The Marine Institute record has the same 53 values as the Marine Institute's own (erratum `marine-institute-kilrush-2025-01-09-offset`).",
      // The drop is kept, flagged.
      check: async (store, e) => {
        await flaggedSpan(store, e);
        const low = (await levels(store, station(e), e.since!, e.until!)).filter(
          (o) => o.level < -3,
        );
        if (low.length !== 4)
          throw new Error(
            `the store holds ${low.length} Kilrush levels below −3 m on 2025-01-09, not 4`,
          );
      },
    },
    {
      id: "gesla-unam-carmen-number",
      stations: ["gesla/ciudadcarmen_radar-4-mex-unam"],
      handling: "corrected",
      error:
        "GESLA 4.1 and TICON-4 number SMN's Ciudad del Carmen radar record 4 (`ciudadcarmen_radar-4-mex-unam`), which is Celestún's station number. SMN numbers Ciudad del Carmen 5.",
      response:
        "The record links to `unam/5-radar`, SMN's Ciudad del Carmen radar, not to Celestún's station 4.",
      evidence:
        "SMN's station menu lists Ciudad del Carmen as station 5 and Celestún as station 4, and GESLA's Celestún records (`celestun_radar-4-mex-unam`, `celestun_flotador-4-mex-unam`) also carry 4.",
      check: async (store, e) => {
        const id = station(e);
        const row = (await store.rows("stations.parquet")).find((r) => r.id === id);
        if (!row) throw new Error(`stations.parquet doesn't list ${id}`);
        const sameAs = (row.same_as as { items: string[] }).items;
        if (!sameAs.includes("unam/5-radar") || sameAs.some((s) => s.startsWith("unam/4-")))
          throw new Error(`${id} is linked to ${sameAs.join(", ") || "nothing"}`);
      },
    },
    {
      id: "gesla-crms0008-marsh-well",
      stations: ["gesla/crms0008-crms0008-usa-crms"],
      since: "2008-01-25",
      until: "2011-11-15",
      handling: "flagged",
      error:
        "GESLA's CRMS0008 record holds the site's marsh well (`CRMS0008-W01`), which measures water in the marsh soil, from 25 January 2008 to 14 November 2011, and the site's surface-water gauge (`CRMS0008-H01`) after it, all as one surface-water record.",
      response:
        "25 January 2008 to 14 November 2011 is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the surface-water values of 14 November 2011 are flagged too.",
      evidence:
        "Once `gesla-crms-hour-early` moves it, every one of the span's 32,879 hours equals `CRMS0008-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.171 m below it. From its next value the record equals `CRMS0008-H01` at the same offset.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0058-marsh-well",
      stations: ["gesla/crms0058-crms0058-usa-crms"],
      since: "2007-06-19",
      until: "2011-06-17",
      handling: "flagged",
      error:
        "GESLA's CRMS0058 record holds the site's marsh well (`CRMS0058-W01`), which measures water in the marsh soil, from 19 June 2007 to 16 June 2011, and the site's surface-water gauge (`CRMS0058-H01`) after it, all as one surface-water record.",
      response:
        "19 June 2007 to 16 June 2011 is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the surface-water values of 16 June 2011 are flagged too.",
      evidence:
        "Once `gesla-crms-hour-early` moves it, every one of the span's 33,660 hours equals `CRMS0058-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.155 m below it. From its next value the record equals `CRMS0058-H01` at the same offset.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0059-marsh-well",
      stations: ["gesla/crms0059-crms0059-usa-crms"],
      since: "2007-06-21",
      until: "2012-01-18",
      handling: "flagged",
      error:
        "GESLA's CRMS0059 record holds the site's marsh well (`CRMS0059-W01`), which measures water in the marsh soil, from 21 June 2007 to 17 January 2012, and the site's surface-water gauge (`CRMS0059-H01`) after it, all as one surface-water record.",
      response:
        "21 June 2007 to 17 January 2012 is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the surface-water values of 17 January 2012 are flagged too.",
      evidence:
        "Once `gesla-crms-hour-early` moves it, every one of the span's 35,734 hours equals `CRMS0059-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.110 m below it. From its next value the record equals `CRMS0059-H01` at the same offset.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0065-marsh-well",
      stations: ["gesla/crms0065-crms0065-usa-crms"],
      since: "2008-01-28",
      until: "2011-06-18",
      handling: "flagged",
      error:
        "GESLA's CRMS0065 record holds the site's marsh well (`CRMS0065-W01`), which measures water in the marsh soil, from 28 January 2008 to 17 June 2011, and the site's surface-water gauge (`CRMS0065-H01`) after it, all as one surface-water record.",
      response:
        "28 January 2008 to 17 June 2011 is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the surface-water values of 17 June 2011 are flagged too.",
      evidence:
        "Once `gesla-crms-hour-early` moves it, every one of the span's 28,097 hours equals `CRMS0065-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.271 m below it. From its next value the record equals `CRMS0065-H01` at the same offset.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0089-marsh-well",
      stations: ["gesla/crms0089-crms0089-usa-crms"],
      since: "2007-06-21",
      until: "2011-06-18",
      handling: "flagged",
      error:
        "GESLA's CRMS0089 record holds the site's marsh well (`CRMS0089-W01`), which measures water in the marsh soil, from 21 June 2007 to 17 June 2011, and the site's surface-water gauge (`CRMS0089-H01`) after it, all as one surface-water record.",
      response:
        "21 June 2007 to 17 June 2011 is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the surface-water values of 17 June 2011 are flagged too.",
      evidence:
        "Once `gesla-crms-hour-early` moves it, every one of the span's 34,245 hours equals `CRMS0089-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.155 m below it. From its next value the record equals `CRMS0089-H01` at the same offset.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0090-marsh-well",
      stations: ["gesla/crms0090-crms0090-usa-crms"],
      since: "2007-06-21",
      until: "2025-04-11",
      handling: "flagged",
      error:
        "GESLA's CRMS0090 record holds the site's marsh well (`CRMS0090-W01`), which measures water in the marsh soil, over the whole record, 21 June 2007 to 10 April 2025, as a surface-water gauge. CPRA's export has no surface-water gauge at the site. The record is also an hour early, as the 40 in `gesla-crms-hour-early` are.",
      response:
        "The whole record is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Its times are kept as served.",
      evidence:
        "Moved an hour later, all 151,805 of its hours equal `CRMS0090-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.119 m below it before October 2013 and level with it from then on. At GESLA's own times they match on 45 to 51% of hours, those when the slow-moving well doesn't change.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0114-marsh-well",
      stations: ["gesla/crms0114-crms0114-usa-crms"],
      since: "2007-10-29",
      until: "2013-03-08",
      handling: "flagged",
      error:
        "GESLA's CRMS0114 record holds the site's marsh well (`CRMS0114-W01`), which measures water in the marsh soil, from 29 October 2007 to 7 March 2013, and the site's surface-water gauge (`CRMS0114-H01`) after it, all as one surface-water record.",
      response:
        "29 October 2007 to 7 March 2013 is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the surface-water values of 7 March 2013 are flagged too.",
      evidence:
        "Once `gesla-crms-hour-early` moves it, every one of the span's 45,513 hours equals `CRMS0114-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.085 m below it. From its next value the record equals `CRMS0114-H01` at the same offset.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0115-marsh-well",
      stations: ["gesla/crms0115-crms0115-usa-crms"],
      since: "2007-10-29",
      until: "2008-09-10",
      handling: "flagged",
      error:
        "GESLA's CRMS0115 record holds the site's marsh well (`CRMS0115-W01`), which measures water in the marsh soil, from 29 October 2007 to 9 September 2008, and the site's surface-water gauge (`CRMS0115-H01`) after it, all as one surface-water record.",
      response:
        "29 October 2007 to 9 September 2008 is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the surface-water values of 9 September 2008 are flagged too.",
      evidence:
        "Once `gesla-crms-hour-early` moves it, every one of the span's 7,436 hours equals `CRMS0115-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.113 m below it. From its next value the record equals `CRMS0115-H01` at the same offset.",
      // The record has no values from 10 September 2008 to 8 April 2009.
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0117-marsh-well",
      stations: ["gesla/crms0117-crms0117-usa-crms"],
      since: "2007-10-29",
      until: "2013-03-07",
      handling: "flagged",
      error:
        "GESLA's CRMS0117 record holds the site's marsh well (`CRMS0117-W01`), which measures water in the marsh soil, from 29 October 2007 to 6 March 2013, and the site's surface-water gauge (`CRMS0117-H01`) after it, all as one surface-water record.",
      response:
        "29 October 2007 to 6 March 2013 is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the surface-water values of 6 March 2013 are flagged too.",
      evidence:
        "Once `gesla-crms-hour-early` moves it, every one of the span's 42,971 hours equals `CRMS0117-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.177 m below it. From its next value the record equals `CRMS0117-H01` at the same offset.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0120-marsh-well",
      stations: ["gesla/crms0120-crms0120-usa-crms"],
      since: "2007-10-29",
      until: "2009-08-19",
      handling: "flagged",
      error:
        "GESLA's CRMS0120 record holds the site's marsh well (`CRMS0120-W01`), which measures water in the marsh soil, from 29 October 2007 to 18 August 2009, and the site's surface-water gauge (`CRMS0120-H01`) after it, all as one surface-water record.",
      response:
        "29 October 2007 to 18 August 2009 is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the surface-water values of 18 August 2009 are flagged too.",
      evidence:
        "Once `gesla-crms-hour-early` moves it, every one of the span's 8,875 hours equals `CRMS0120-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, 0.119 m below it. From its next value the record equals `CRMS0120-H01` at the same offset.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-crms0128-marsh-well",
      stations: ["gesla/crms0128-crms0128-usa-crms"],
      since: "2013-10-01",
      until: "2025-04-24",
      handling: "flagged",
      error:
        "GESLA's CRMS0128 record holds the site's marsh well (`CRMS0128-W01`), which measures water in the marsh soil, over the whole record, 1 October 2013 to 23 April 2025, as a surface-water gauge. The site's surface-water gauge, `CRMS0128-H01`, ends in October 2012, a year before the record starts. The record is also an hour early, as the 40 in `gesla-crms-hour-early` are.",
      response:
        "The whole record is flagged `suspect`, keeping GESLA's own flag as `source_flag`. Its times are kept as served.",
      evidence:
        "Moved an hour later, all 90,749 of its hours equal `CRMS0128-W01`'s adjusted elevation in CPRA's export of 8 November 2026 to the millimeter, level with it. At GESLA's own times they match on 45 to 51% of hours, those when the slow-moving well doesn't change.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-ttw-longitudes",
      stations: [
        "gesla/boat_cove-rbct-nzl-ttw",
        "gesla/fishing_rock-rfrt-nzl-ttw",
        "gesla/owenga-chit-nzl-ttw",
      ],
      handling: "kept",
      error:
        "GESLA 4.1 gives Boat Cove and Fishing Rock (Raoul Island) longitudes of 177.9°E, and Owenga (Chatham Islands) 176.37°E, where LINZ's READMEs give 177.89°W, 177.90°W and 176.37°W. Each record sits about 410 to 580 km from its gauge, on the wrong side of the antimeridian.",
      response:
        "The three records keep GESLA's positions. Each is linked to LINZ's gauge by decision in `LINKS` (`src/same-as.ts`), so the copy rule's distance limit doesn't leave it unlinked.",
      evidence:
        "LINZ's READMEs for RBCT, RFRT and CHIT, November 2026; the three GESLA TTW records' positions in the store's list.",
      // Kept east of the antimeridian, and linked to LINZ's gauge by decision.
      check: async (store, e) => {
        const rows = await store.rows("stations.parquet");
        for (const id of e.stations!) {
          const linz = `linz/${id.split("-")[1]!.toUpperCase()}`;
          const row = rows.find((r) => r.id === id);
          if (!row) throw new Error(`stations.parquet doesn't list ${id}`);
          if (!((row.lon as number) > 0))
            throw new Error(`${id} is listed at ${String(row.lon)}°, not GESLA's east longitude`);
          if (!(row.same_as as { items: string[] }).items.includes(linz))
            throw new Error(`${id} isn't linked to ${linz}`);
        }
      },
    },
    {
      id: "gesla-petten-meetraai3-2012-zero",
      stations: ["gesla/petten_meetraai_03-pet-nld-rws"],
      since: "2012-10-22",
      until: "2013-05-16",
      handling: "flagged",
      error:
        "GESLA's copy of RWS's Petten meetraai 03 holds exactly 0.00 m NAP for hours at a time through high and low water from 22 October 2012 to the record's end on 15 May 2013, as RWS's own series does (erratum `rws-petten-meetraai3-2012-zero`).",
      response:
        "22 October 2012 to 15 May 2013 is flagged `suspect`, keeping the source flag as `source_flag`. About 800 of the span's 19,000 values are the held fill, and the rest is sound tide, but the fill comes and goes within hours, so only the whole span covers it: QC of a tidal gauge flags 199 of the 797 held values.",
      evidence:
        "The same 778 values of 0.00 m in 2012 and 466 in 2013 as RWS's series. Found from the station's analysis, November 2026: the held values counted as drains and judged it not tidal. 0.00 m NAP is about mid-tide at Petten, where the tide runs from about −1.0 to 0.8 m. From 22 October 2012 to 3 May 2013 the series jumps from the tide to exactly 0.00 m and holds it in 33 runs of an hour or more, 5 of them 6 hours or more, through high and low water. Before that, 0.00 m appears 60 to 125 times a year as the tide passes through it, rarely twice in a row.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-fill-values",
      stations: [
        "gesla/arun_platform-arn-gbr-cco",
        "gesla/arunplatformtg-aru-gbr-cmems",
        "gesla/awgtg-awg-nld-cmems",
        "gesla/bayonnepontblanctg_05minute-bay-fra-cmems",
        "gesla/brighton-btn-gbr-cco",
        "gesla/brightontg-bri-gbr-cmems",
        "gesla/cape_roberts-robt-nzl-ttw",
        "gesla/deal_pier-dlp-gbr-cco",
        "gesla/dealpiertg-dea-gbr-cmems",
        "gesla/exmouth-exm-gbr-cco",
        "gesla/exmouthtg-exm-gbr-cmems",
        "gesla/hastings_pier-hgp-gbr-cco",
        "gesla/hastingspiertg-has-gbr-cmems",
        "gesla/idsl_ceuta-ids-esp-cmems",
        "gesla/k141tg-k14-nld-cmems",
        "gesla/l91tg-l91-nld-cmems",
        "gesla/marienleuchtetg-mar-deu-cmems",
        "gesla/pontseudretg_05minute-pon-fra-cmems",
        "gesla/saint_pierre_et_miquelon-115-fra-refmar",
        "gesla/saintpierreetmiquelontg_60minute-sai-fra-cmems",
        "gesla/sandown_pier-sdp-gbr-cco",
        "gesla/sandownpiertg-san-gbr-cmems",
        "gesla/scarborough-sca-gbr-cco",
        "gesla/scarboroughtg-sca-gbr-cmems",
        "gesla/secondseverncrossingtg-sec-gbr-cmems",
        "gesla/severn_bridge-ssc-gbr-cco",
        "gesla/swanage_pier-swp-gbr-cco",
        "gesla/swanagepiertg-swa-gbr-cmems",
        "gesla/teignbridgepiertg-tei-gbr-cmems",
        "gesla/teignmouth_pier-tnp-gbr-cco",
        "gesla/villefranquetg_05minute-vil-fra-cmems",
      ],
      since: "2008-01-01",
      handling: "dropped",
      error:
        "These 31 GESLA records hold levels no gauge can read, outside the store's span of −500 to 9,000 m, as values rather than as GESLA's null of −99.9999: 42,040 values in 142 record-years from 2008 to 2026. Most are fill values: 999,999.06 m in CMEMS's AWG, K14 and L9 records, 99,999.01 m at Ceuta, −9,999.99 m at Pont Seudre, −10,000 m at Bayonne and Villefranque, and −6,999 m in Toitū Te Whenua's Cape Roberts. The CCO and CMEMS records of England's regional coastal monitoring gauges (Arun Platform, Brighton, Deal Pier, Exmouth, Hastings Pier, Sandown Pier, Scarborough, Second Severn Crossing, Swanage Pier and Teignmouth) hold hundreds of different values from about −1.05 × 10¹¹ m to 214,000 m, and Marienleuchte's and Saint-Pierre-et-Miquelon's records similar ones.",
      response:
        "The adapter leaves out a value outside the store's span (`SPAN_M` in src/span.ts) as missing, as it does GESLA's null, and requalify drops any the store holds.",
      evidence:
        "November 2026. A scan of the range of levels in every one of the store's GESLA and CMEMS year files (145,149 files) found 205 holding a level outside the span, which were then read in full; each of them also has a `bad` value, as QC flags every level outside the span.",
      // Cape Roberts' −6,999 m, most of its 2010, are left out, or kept flagged bad where nothing else is left.
      check: (store) => impossibleDropped(store, "gesla/cape_roberts-robt-nzl-ttw", 2010),
    },
    {
      id: "gesla-kornwerderzand-2025-10-05-ramp",
      stations: [
        "gesla/kornwerderzandbuitentg-kor-nld-cmems",
        "gesla/kornwerderzandtg-kor-nld-cmems",
      ],
      since: "2025-10-05",
      until: "2025-10-06",
      handling: "flagged",
      error:
        "GESLA's CMEMS records of Kornwerderzand fall slowly from 1.60 m at 04:40 UTC to 1.49 m at 08:30 UTC on 5 October 2025, with GESLA's good flag, through a storm high water of about 2.75 m, as CMEMS's own records do.",
      response:
        "5 October 2025 is flagged `suspect` in both CMEMS records, keeping GESLA's own flag as `source_flag`. Errata spans are whole days, so the day's other values are flagged too. GESLA's RWS record (`gesla/kornwerderzand_waddenzee_buitenhaven-kor-nld-rws`) reads the storm as RWS does, so it isn't listed.",
      evidence:
        "In the store, checked in November 2026: both records hold the same 10-minute values as CMEMS's on that morning (erratum `cmems-kornwerderzand-2025-10-05-ramp`), 1.59 m at 05:00 UTC and 1.49 m at 08:30 UTC, while GESLA's RWS record reads 2.75 m and 1.83 m and RWS Harlingen peaks at 2.86 m at 05:30 UTC. GESLA's CMEMS records rise again from 08:40 UTC and match the RWS record at 09:00 UTC. They end on 2026-05-31, before CMEMS's July 2026 offsets.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-scott-base-ttw-nzdt-2023",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2023-11-24",
      until: "2024-10-29",
      handling: "corrected",
      error:
        "From the logger's reinstallation on 25 November 2023 to late October 2024, the Toitū Te Whenua record of Scott Base is on UTC+13, not the New Zealand Standard Time (UTC+12) of the rest of the record (erratum `gesla-scott-base-ttw-nzst`), so after the 12-hour move its times are an hour late: the height labeled T was measured at T − 13 h UTC. The labels of 29 to 31 October 2024, in which the clock changed back, can't be placed (erratum `gesla-scott-base-ttw-clock-2024-10`).",
      response:
        "The adapter moves the record's times 13 hours earlier from labels of 25 November 2023 to before 29 October 2024.",
      evidence:
        "November 2026. The record's hourly values equal the `linz` source's Scott Base levels at the same minute at a lag of one hour from December 2023 to October 2024 (83% of 8,693 hours of 2024 within 1.5 mm, against 18% at none), and at none in 2016 to 2022. Against Cape Roberts' record (UTC) the phases of K1, O1, M2 and S2 are 9, 9, 12 and 19 degrees at UTC+13 and -7, -5, -19 and -11 at UTC+12 over the span.",
      // Moved 13 hours, the record lines up with the `linz` source's Scott Base, which it moves the same.
      check: (store, e) =>
        fits(store, station(e), "linz/SCOT", "2024-03-01", "2024-03-15", 0, [-60, 0, 60]),
    },
    {
      id: "gesla-scott-base-ttw-clock-2024-10",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2024-10-28",
      until: "2024-11-01",
      handling: "flagged",
      error:
        "The Toitū Te Whenua record of Scott Base changes from UTC+13 to UTC+12 on a day from 29 to 31 October 2024, and its labels run on without a break, so the clock of those three days can't be settled: the fit of the tide moves from UTC+13 on 28 October to UTC+12 on 1 November.",
      response:
        "The labels of 29 to 31 October 2024 are moved 12 hours earlier and flagged `suspect`, keeping the source's own flag as `source_flag`. The `linz` source leaves those days out (erratum `linz-scott-base-clock`).",
      evidence:
        "November 2026. Daily fits of the tide against the prediction from UHSLC's Scott Base (`uhslc/663a`) favor UTC+13 until 28 October, are even on the 29th to 31st (by 0.013 m, 0.017 m the other way and 0.004 m), and favor UTC+12 from 1 November.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-scott-base-ttw-held-2016",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2016-03-02",
      until: "2016-03-30",
      handling: "flagged",
      error:
        "From 06:00 UTC on 2 March to 00:00 on 29 March 2016 the Toitū Te Whenua record of Scott Base holds one value for all 643 hours, the last before the gauge failed, where LINZ's files have no levels. These aren't measurements: a tide at Scott Base changes by up to 0.05 m an hour, and the record is flagged good throughout.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay. The `linz` source's Scott Base series is the measured record and has no values in these gaps.",
      evidence:
        "The store's 2016 file, November 2026: all 643 hourly steps are 0.000 m; the `linz` source's Scott Base has no level from 3 March to 29 March.",
      // `gesla-scott-base-ttw-failed-2016` flags the days before it.
      check: (store, e) => flaggedSpan(store, { ...e, since: "2016-02-28" }),
    },
    {
      id: "gesla-scott-base-ttw-held-2022",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2022-03-09",
      until: "2022-10-31",
      handling: "flagged",
      error:
        "From 02:00 UTC on 9 March to 23:00 UTC on 30 October 2022 the Toitū Te Whenua record of Scott Base holds one value, changing by at most 0.0001 m an hour, for all 5,662 hours, where LINZ's file has no levels. These aren't measurements: a tide at Scott Base changes by up to 0.05 m an hour, and the record is flagged good throughout.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay. The `linz` source's Scott Base series is the measured record and has no values in these gaps.",
      evidence:
        "The store's 2022 file, November 2026: every hourly step is 0.0000 to 0.0001 m; the `linz` source's Scott Base has no level from 9 March to 30 October 2022.",
      // `gesla-scott-base-ttw-failed-2022` flags the days before it, and GESLA flags 31 October's afternoon bad.
      check: (store, e) => flaggedSpan(store, { ...e, since: "2022-03-06" }),
    },
    {
      id: "gesla-scott-base-ttw-held-2023-08",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2023-08-02",
      until: "2023-11-25",
      handling: "flagged",
      error:
        "From 03:00 UTC on 2 August to 11:00 on 24 November 2023, the gauge's failure and its reinstallation, the Toitū Te Whenua record of Scott Base changes by 0.0001 to 0.0002 m an hour for all 2,745 hours. These aren't measurements: a tide at Scott Base changes by up to 0.05 m an hour, and the record is flagged good throughout.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay. The `linz` source's Scott Base series is the measured record and has no values in these gaps.",
      evidence:
        "The store's 2023 file, November 2026: every hourly step in the span is between -0.0002 and -0.0001 m; LINZ's file has no levels from 2 August to 25 November (erratum `linz-scott-base-clock` for its labels). The span's first and last day also hold the hours either side, which are measured.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-scott-base-ttw-held-2023-12",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2023-11-30",
      until: "2024-01-01",
      handling: "flagged",
      error:
        "From 12:00 UTC on 30 November to 10:00 on 31 December 2023 the Toitū Te Whenua record of Scott Base falls by 0.0004 to 0.0005 m an hour for all 743 hours, from 2.48 m to 2.27 m, where LINZ's files have measured levels from 10 December. These aren't measurements: a tide at Scott Base changes by up to 0.05 m an hour, and the record is flagged good throughout.",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay. The `linz` source's Scott Base series is the measured record and has no values in these gaps.",
      evidence:
        "The store's 2023 file, November 2026: every hourly step in the span is between -0.0005 and -0.0004 m. For the 528 hours from 10 to 31 December that the `linz` source also holds, the correlation with its levels is 0.06 at lags of -3 to +3 hours, the mean absolute difference 0.30 m, and LINZ's range 1.39 m against 0.47 m. The span's first day also holds measured hours.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-scott-base-ttw-failed-2016",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2016-02-28",
      until: "2016-03-02",
      handling: "flagged",
      error:
        "The Toitū Te Whenua record of Scott Base holds the gauge's failed readings as LINZ's file does (0.01 to 0.4 m from 23:00 UTC on 28 February), as levels flagged correct and usable, where the `linz` source leaves them out (erratum `linz-scott-base-step-2016`).",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay; QC's own rules flag some of them worse.",
      evidence:
        "November 2026. The record's hourly values in the span equal the `linz` source's raw levels at the same hour, every hour both hold, in the store's 2016 to 2022 files.",
      // `gesla-scott-base-ttw-held-2016` flags the days after it.
      check: (store, e) => flaggedSpan(store, { ...e, until: "2016-03-30" }),
    },
    {
      id: "gesla-scott-base-ttw-failed-2018-12",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2018-12-13",
      until: "2018-12-19",
      handling: "flagged",
      error:
        "The Toitū Te Whenua record of Scott Base holds the gauge's failed readings as LINZ's file does (spikes to 0.02 m and a constant 2.10 m from 09:35 UTC on 13 December to 19:55 on 18 December), as levels flagged correct and usable, where the `linz` source leaves them out (erratum `linz-scott-base-stuck-2018-12`).",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay; QC's own rules flag some of them worse.",
      evidence:
        "November 2026. The record's hourly values in the span equal the `linz` source's raw levels at the same hour, every hour both hold, in the store's 2016 to 2022 files.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-scott-base-ttw-failed-2019",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2019-02-24",
      until: "2019-11-04",
      handling: "flagged",
      error:
        "The Toitū Te Whenua record of Scott Base holds the gauge's failed readings as LINZ's file does (0.01 m, with spells of 7.999 m, from about 12:00 UTC on 24 February to 01:00 UTC on 3 November), as levels flagged correct and usable, where the `linz` source leaves them out (erratum `linz-scott-base-step-2019`).",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay; QC's own rules flag some of them worse.",
      evidence:
        "November 2026. The record's hourly values in the span equal the `linz` source's raw levels at the same hour, every hour both hold, in the store's 2016 to 2022 files.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-scott-base-ttw-failed-2020",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2020-01-25",
      until: "2020-05-13",
      handling: "flagged",
      error:
        "The Toitū Te Whenua record of Scott Base holds the gauge's failed readings as LINZ's file does (0.27, 0.03, 0.000 and 0.01 m from 06:40 UTC on 25 January to 04:05 UTC on 12 May), as levels flagged correct and usable, where the `linz` source leaves them out (erratum `linz-scott-base-step-2020`).",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay; QC's own rules flag some of them worse.",
      evidence:
        "November 2026. The record's hourly values in the span equal the `linz` source's raw levels at the same hour, every hour both hold, in the store's 2016 to 2022 files.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-scott-base-ttw-failed-2021",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2021-03-16",
      until: "2021-11-18",
      handling: "flagged",
      error:
        "The Toitū Te Whenua record of Scott Base holds the gauge's failed readings as LINZ's file does (a drift from 1.5 to 0.1 m with a shrunken tide, from 19:45 UTC on 16 March to 01:45 UTC on 17 November), as levels flagged correct and usable, where the `linz` source leaves them out (erratum `linz-scott-base-step-2021`).",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay; QC's own rules flag some of them worse.",
      evidence:
        "November 2026. The record's hourly values in the span equal the `linz` source's raw levels at the same hour, every hour both hold, in the store's 2016 to 2022 files.",
      check: (store, e) => flaggedSpan(store, e),
    },
    {
      id: "gesla-scott-base-ttw-failed-2022",
      stations: ["gesla/scott_base_antarctica-scot-nzl-ttw"],
      since: "2022-03-06",
      until: "2022-03-09",
      handling: "flagged",
      error:
        "The Toitū Te Whenua record of Scott Base holds the gauge's failed readings as LINZ's file does (0.01 to 0.04 m and a spell of 8.0 m from 08:15 UTC on 6 March to 01:45 on the 8th), as levels flagged correct and usable, where the `linz` source leaves them out (erratum `linz-scott-base-step-2022`).",
      response:
        "The span is flagged `suspect`, keeping the source's own flag as `source_flag`. The GESLA adapter can't drop a span, so the values stay; QC's own rules flag some of them worse.",
      evidence:
        "November 2026. The record's hourly values in the span equal the `linz` source's raw levels at the same hour, every hour both hold, in the store's 2016 to 2022 files.",
      // `gesla-scott-base-ttw-held-2022` flags the days after it, and GESLA flags 31 October's afternoon bad.
      check: (store, e) => flaggedSpan(store, { ...e, until: "2022-10-31" }),
    },
    {
      id: "gesla-sciacca-position",
      stations: ["gesla/sciacca-sci-ita-ispra"],
      handling: "corrected",
      error:
        "GESLA 4.1 places its ISPRA record of Sciacca at 37.2212, 13.0765, 31 km south of the gauge and at sea. The longitude is right.",
      response:
        "The station refresh moves the record to ISPRA's position for the gauge, in `POSITIONS` in `src/positions.ts`, as it does for GESLA's UHSLC records (erratum `gesla-uhslc-positions`). The entry applies only while GESLA still serves the position it was written against. With the position corrected, the record links to ISPRA's series and Copernicus's copy of the gauge.",
      evidence:
        "ISPRA's RDF dump gives its Sciacca tide gauge at 37.50454, 13.07646, and Copernicus's In Situ TAC lists RMN-Sciacca at 37.5045, 13.0765; GESLA's own record of the Copernicus copy (`gesla/rmn_sciacca-rmn-ita-cmems`) is at 37.5045, 13.0765. Only GESLA's ISPRA record differs, checked in November 2026.",
      check: atPositions,
    },
  ],
  retired: [],
} satisfies ErrataFile;
