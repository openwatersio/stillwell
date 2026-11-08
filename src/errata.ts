/**
 * Errors in what a source publishes, found while ingesting it: values on the
 * wrong clock or day, positions far from the gauge, metadata that contradicts
 * the data, two endpoints that disagree. Each has an issue labeled
 * `source-error` that tracks the report to the agency, and the adapter cites
 * its ID (`erratum \`<id>\``) where it works around it or, where the lake keeps
 * the data as served, in its README. `stations.parquet` lists each station's
 * errata in `errata`, and `errata.json` publishes the list, so a user can see
 * which values the lake changed and why. See CONTRIBUTING.md.
 */

/** What the lake does about an erratum. */
export type Handling =
  /** Values or metadata changed to what the source should have published. */
  | "corrected"
  /** Values kept, flagged `suspect` or worse. */
  | "flagged"
  /** Stations or values left out. */
  | "dropped"
  /** The adapter refuses the file, so its values are missing until it's fixed. */
  | "refused"
  /** The lake doesn't use the wrong part, so nothing in it is affected. */
  | "avoided"
  /** Kept as the source serves it. */
  | "kept";

export interface Erratum {
  /** `<source>-<what>`, never reused. */
  id: string;
  source: string;
  /**
   * Lake station IDs known to be affected; null for every station of the
   * source. Partial or empty where the source doesn't say which stations, or
   * they aren't in the lake; `error` says which.
   */
  stations: string[] | null;
  /**
   * The UTC days of values the error is in, `since` to before `until`; null
   * for an open end or none. What the lake lacks or changed as a result can
   * be wider, and `lake` says so.
   */
  since: string | null;
  until: string | null;
  /** What the source publishes wrong, and how it was found. */
  error: string;
  handling: Handling;
  /** What the lake does about it. */
  lake: string;
  /** The `source-error` issue in this repository. */
  issue: number;
  /** When and how the agency was told; null until it is. */
  reported: { date: string; via: string } | null;
  /** When the agency fixed it, so the workaround can go; null while it stands. */
  fixed: string | null;
}

export const ERRATA: Erratum[] = [
  {
    id: "dwr-b95580-another-header",
    source: "dwr",
    stations: [],
    since: null,
    until: null,
    error:
      "WDL's raw level file for San Joaquin River at Venice Island (B95580) carries the header of another station, B95500 (Middle River at Union Point).",
    handling: "dropped",
    lake: "A station is left out of the list when none of its files is usable, and a file that names another station isn't, so B95580 isn't in the lake until WDL fixes it.",
    issue: 67,
    reported: null,
    fixed: null,
  },
  {
    id: "jma-saigo-1980-day-stamp",
    source: "jma",
    stations: ["jma/SA"],
    since: "1980-10-21",
    until: "1980-10-23",
    error:
      "JMA's historical file for Saigo in October 1980 stamps its 22nd line as the 20th, between lines stamped the 21st and 23rd.",
    handling: "refused",
    lake: "The file is refused as having a day twice, so Saigo's 1980 is missing from the lake.",
    issue: 58,
    reported: null,
    fixed: null,
  },
  {
    id: "pegelonline-download-api-differ",
    source: "pegelonline",
    stations: ["pegelonline/5990020", "pegelonline/9530020"],
    since: null,
    until: null,
    error:
      "At Cuxhaven Steubenhöft and Husum, PEGELONLINE's raw-data download and its REST API give different levels for the same minutes, by up to 6 and 8 cm, though both are labeled unchecked raw data on the same gauge zero.",
    handling: "kept",
    lake: "History comes from the download and the last 31 days from the REST API, so the series can step by a few centimeters where one hands over to the other.",
    issue: 26,
    reported: null,
    fixed: null,
  },
  {
    id: "pegelonline-cuxhaven-2025-revised",
    source: "pegelonline",
    stations: ["pegelonline/5990020"],
    since: "2025-05-13",
    until: "2025-06-25",
    error:
      "PEGELONLINE's download for Cuxhaven sits 4 to 6 cm above GESLA's copy from 13 May to 24 June 2025, so the WSV changed values it still labels raw and unchecked.",
    handling: "kept",
    lake: "Kept as the download serves it.",
    issue: 26,
    reported: null,
    fixed: null,
  },
  {
    id: "marine-institute-coverage-start",
    source: "marine-institute",
    stations: null,
    since: null,
    until: null,
    error:
      "The dataset's `time_coverage_start` says 2000, but no gauge has values before October 2006.",
    handling: "avoided",
    lake: "Backfills start from each gauge's first value, not the dataset's coverage.",
    issue: 59,
    reported: null,
    fixed: null,
  },
  {
    id: "marine-institute-lat-2026",
    source: "marine-institute",
    stations: [
      "marine-institute/aranmore-island-leabgarrow",
      "marine-institute/ballycotton-harbour",
      "marine-institute/ballyglass-harbour",
      "marine-institute/buncranna",
      "marine-institute/castletownbere-port",
      "marine-institute/dingle-harbour",
      "marine-institute/dublin-port",
      "marine-institute/dunmore-east-harbour",
      "marine-institute/galway-port",
      "marine-institute/howth-water-level-1",
      "marine-institute/inishmore",
      "marine-institute/killybegs-port",
      "marine-institute/kilrush-lough",
      "marine-institute/malin-head-portmore-pier",
      "marine-institute/rosslare",
      "marine-institute/skerries-harbour",
      "marine-institute/sligo",
      "marine-institute/union-hall-harbor",
      "marine-institute/wexford-harbour",
    ],
    since: "2026-03-24",
    until: null,
    error:
      "On 24 March 2026 the network moved LAT by 1 to 5 cm at its gauges without noting it in the dataset; OD Malin is unbroken.",
    handling: "kept",
    lake: "Levels are in OD Malin, unaffected. `datums` gives only the current LAT, so a level from before 24 March 2026 converted with it is on the new LAT, not the one in use then.",
    issue: 60,
    reported: null,
    fixed: null,
  },
  {
    id: "uhslc-hong-kong-hour-early",
    source: "uhslc",
    stations: ["uhslc/329", "uhslc/329a"],
    since: null,
    until: null,
    error:
      "UHSLC stamps its Hong Kong (Quarry Bay) hourly heights an hour early in every version and the fast-delivery series: the height labeled T was measured at T + 1 h UTC (tide-database#360, confirmed by the clock check).",
    handling: "corrected",
    lake: "Every value is moved an hour later.",
    issue: 63,
    reported: null,
    fixed: null,
  },
  {
    id: "refmar-pointe-a-pitre-clock",
    source: "refmar",
    stations: ["refmar/125"],
    since: "2020-01-01",
    until: "2025-01-01",
    error:
      "SHOM's Pointe-à-Pitre levels run 60 to 70 minutes late in 2023 against UHSLC's, CMEMS's and REFMAR's own TICON records, and hardly fit at all in 2020 and 2024, with no steady offset; 2025 fits again.",
    handling: "flagged",
    lake: "2020 to 2024 is flagged `suspect`, keeping SHOM's own flag as `source_flag`.",
    issue: 61,
    reported: null,
    fixed: null,
  },
  {
    id: "rws-ameland-westgat-twice",
    source: "rws",
    stations: ["rws/ameland.westgat", "rws/amelandwestgat"],
    since: null,
    until: null,
    error:
      "RWS lists the Ameland Westgat gauge twice, as `ameland.westgat` and `amelandwestgat`, a few meters apart.",
    handling: "kept",
    lake: "Both are kept as served, and linked in `same_as` as one gauge.",
    issue: 62,
    reported: null,
    fixed: null,
  },
  {
    id: "usace-baton-rouge-position",
    source: "usace",
    stations: ["usace/MVN.Baton_Rouge"],
    since: null,
    until: null,
    error:
      "The New Orleans District places its Baton Rouge gauge at 29.43° N, about 110 km south of the gauge, which the Vicksburg District places at 30.45° N.",
    handling: "kept",
    lake: "Kept at MVN's position, so it isn't linked to MVK's copy.",
    issue: 64,
    reported: null,
    fixed: null,
  },
  {
    id: "usace-placeholder-positions",
    source: "usace",
    stations: [],
    since: null,
    until: null,
    error:
      "Some CWMS locations sit at 0,0 or at a placeholder such as 9.09,9.09 (Anoka), and a few have the longitude's sign dropped (Buck Creek, Pine Bluff), which puts them in Asia.",
    handling: "dropped",
    lake: "Locations outside the contiguous US are left out.",
    issue: 65,
    reported: null,
    fixed: null,
  },
  {
    id: "usace-zero-elevation",
    source: "usace",
    stations: ["usace/MVK.Baton_Rouge"],
    since: null,
    until: null,
    error:
      "Some districts give an elevation of 0 to locations they have no elevation for, the same as a gauge set at the datum: MVK gives Baton Rouge 0, where MVN's description puts it 0.71 ft off. CWMS doesn't say which other zeros are real, so only Baton Rouge is listed.",
    handling: "avoided",
    lake: "An elevation of exactly 0 is ignored, so those gauges have no NGVD29 or NAVD88 offset.",
    issue: 66,
    reported: null,
    fixed: null,
  },
  {
    id: "usace-lwrp-corrections-disagree",
    source: "usace",
    stations: [],
    since: null,
    until: null,
    error:
      "The New Orleans District's NAVD88 corrections for lower Mississippi gauges disagree between sources: at Donaldsonville the description gives −0.74 ft, rivergages −1.18 ft and the `rev-NAVD88` series −0.70 ft. Which of the district's gauges carry a correction is in prose only, so none is listed.",
    handling: "avoided",
    lake: "No LWRP or NAVD88 correction is published for these gauges until the district confirms which is right.",
    issue: 10,
    reported: null,
    fixed: null,
  },
];

const REPO = "https://github.com/openwatersio/water-levels";

/** `errata.json`: each erratum with its issue's URL. */
export function published(errata: Erratum[] = ERRATA): object[] {
  return errata.map(({ issue, ...e }) => ({ ...e, issue: `${REPO}/issues/${issue}` }));
}

/** The IDs of the errata that affect a station. */
export function errataOf(station: { id: string; source: string }, errata = ERRATA): string[] {
  return errata
    .filter((e) => e.source === station.source && (!e.stations || e.stations.includes(station.id)))
    .map((e) => e.id);
}

/** `docs/errata.md`, from the list; `npm run errata` writes it. */
export function render(errata: Erratum[] = ERRATA): string {
  const lines = [
    "# Source errata",
    "",
    "Errors in what a source publishes, and what the lake does about each one. `stations.parquet` lists the errata that affect each station in `errata`, and [`errata.json`](https://water-levels.openwaters.io/errata.json) has this list. Each links to an issue that tracks the report to the agency. This file is generated from [src/errata.ts](../src/errata.ts) by `npm run errata`; see [CONTRIBUTING.md](../CONTRIBUTING.md#source-errata) to add one.",
    "",
    "| Erratum | Source | Stations | Values | Lake | Reported | Issue |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  const span = (e: Erratum) =>
    e.since || e.until
      ? `${e.since?.slice(0, 10) ?? "…"} to ${e.until?.slice(0, 10) ?? "now"}`
      : "all";
  for (const e of errata)
    lines.push(
      `| [${e.id}](#${e.id}) | ${e.source} | ${e.stations ? e.stations.map((s) => `\`${s}\``).join(", ") || "none listed" : "every station"} | ${span(e)} | ${e.handling} | ${e.fixed ? `fixed ${e.fixed}` : (e.reported?.date ?? "no")} | [#${e.issue}](${REPO}/issues/${e.issue}) |`,
    );
  for (const e of errata) lines.push("", `## ${e.id}`, "", e.error, "", `**Lake:** ${e.lake}`);
  return `${lines.join("\n")}\n`;
}
