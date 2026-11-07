import { DatumChanged } from "../../epochs.ts";
import { getJson, HttpError } from "../../http.ts";
import {
  Flag,
  stationDefaults,
  type ListedStation,
  type Observation,
  type Source,
  type SourceMetadata,
  type Station,
} from "../../schema.ts";
import { countryOf } from "../coops/index.ts";
import { CONTRIBUTORS } from "./contributors.ts";
import { NOTICES } from "./notices.ts";

/**
 * University of Hawaii Sea Level Center (UHSLC) hourly tide gauge records,
 * from its ERDDAP: the research-quality (RQ) set, one record per station
 * version, and the fast-delivery (FD) set, which is each station's latest RQ
 * version with FD values appended. See README.md.
 */
const ERDDAP = "https://uhslc.soest.hawaii.edu/erddap/tabledap";
const RQ = "global_hourly_rqds";
const FD = "global_hourly_fast";

export const metadata: SourceMetadata = {
  id: "uhslc",
  name: "University of Hawaii Sea Level Center (UHSLC)",
  url: "https://uhslc.soest.hawaii.edu/data/",
  license: {
    id: "LicenseRef-UHSLC",
    name: "UHSLC data terms: free use and redistribution, not for legal use",
    url: "https://uhslc.soest.hawaii.edu/datainfo/",
    // UHSLC's terms let anyone use and redistribute the data free, with no
    // limit on purpose, as tide-database already does through TICON.
    commercial_use: true,
    redistribution: true,
  },
  attribution: "University of Hawaii Sea Level Center (UHSLC)",
  // Fast-delivery files arrive monthly, and research-quality values replace them a year or two later.
  hourly: false,
  finalizes: true,
  terms:
    "The data may be used and redistributed for free but is not intended for legal use, since it may contain inaccuracies; no warranty. Cite Caldwell, Merrifield and Thompson (2015), doi:10.7289/V5V40S7W, and for fast-delivery data the date through which it was obtained. Fast-delivery values are preliminary and are replaced by research-quality values about once a year.",
};

/** What UHSLC measures every level from; its `reference_datum`. */
const REFERENCE = "station zero";
const DATUM = "ZERO";

/**
 * UHSLC stamps its Hong Kong hourly heights an hour early: the height it
 * labels T was measured at T + 1 h UTC (tide-database#360). Every version and
 * the FD series. Remove once UHSLC corrects its files; the clock check shows it.
 */
const EARLY_HOURS: Record<number, number> = { 329: 1 };

/**
 * The South African Navy Hydrographic Office owns and holds copyright in its
 * gauges' data and asks anyone downloading it for permission first, so
 * stations UHSLC lists in South Africa (ISO 3166-1 710) are left out, as
 * UHSLC's own download page asks before serving them.
 */
const EXCLUDED_COUNTRIES = new Set([710]);

/** ISO numeric codes whose UHSLC names `countryOf` doesn't know, some sent mis-encoded. */
// prettier-ignore
const COUNTRY_CODES: Record<number, string> = {
  104: "MM", 132: "CV", 158: "TW", 178: "CG", 238: "FK", 344: "HK", 364: "IR", 384: "CI",
  446: "MO", 531: "CW", 581: "UM", 583: "FM", 638: "RE", 643: "RU", 654: "SH", 670: "VC",
  678: "ST", 704: "VN", 826: "GB", 834: "TZ", 850: "VI", 862: "VE",
};

const HOUR_MS = 3_600_000;
/** Daily records without an hourly series a list may hold before it looks partial. */
const DAILY_ONLY = 5;
const DAY_MS = 86_400_000;
const MARGIN_MS = 31 * DAY_MS;

/**
 * A UHSLC station as listed. `version` is the RQ version the series carries
 * (for the FD series, its latest RQ version, null without one), and
 * `record_start` and `record_end` the first and last days UHSLC has, which a
 * backfill keeps to. `contributor` is the agency UHSLC's documentation names,
 * null where it names none. They're kept in the lake's list only.
 */
export type UhslcStation = ListedStation & {
  version: string | null;
  contributor: string | null;
  /** The contributor's own number for the gauge, from the documentation file. */
  originator: string | null;
  record_start: string | null;
  record_end: string | null;
};

/** A station as the lake's list holds it, with the references of its epochs. */
type Listed = Partial<UhslcStation> & { epochs?: { reference: string | null }[] };

interface Table {
  table: { columnNames: string[]; rows: (string | number | null)[][] };
}

/** ERDDAP's rows as objects keyed by column name. */
function rowsOf(body: Table): Record<string, string | number | null>[] {
  const { columnNames, rows } = body.table;
  return rows.map((r) => Object.fromEntries(columnNames.map((c, i) => [c, r[i] ?? null])));
}

/** `<dataset>.json?<variables>&<constraints>`, each part percent-encoded. */
function url(dataset: string, variables: string, constraints: string[] = []): string {
  return `${ERDDAP}/${dataset}.json?${[variables, ...constraints].map(encodeURIComponent).join("&")}`;
}

/**
 * One station for each FD series, `uhslc/<number>`, and one for each RQ
 * version it doesn't carry, `uhslc/<number><version>`: older versions, which
 * UHSLC couldn't tie to the same benchmark, and every version of a station
 * with no FD series.
 */
export async function stations(previous: Listed[] = []): Promise<UhslcStation[]> {
  const columns = "uhslc_id,station_name,station_country,station_country_code,latitude,longitude";
  // Station rows are subset variables ERDDAP answers at once; the spans come
  // from the daily sets, since the hourly RQ one times out.
  const rq = rowsOf(
    await request(url(RQ, `${columns},version,reference_datum`, ["distinct()"]), true),
  );
  const fd = rowsOf(await request(url(FD, `${columns},reference_datum`, ["distinct()"]), true));
  const rqSpans = spans(
    rowsOf(
      await request(
        url("global_daily_rqds", "uhslc_id,version,time", [
          'orderByMinMax("uhslc_id,version,time")',
        ]),
        true,
      ),
    ),
  );
  const fdSpans = spans(
    rowsOf(
      await request(
        url("global_daily_fast", "uhslc_id,time", ['orderByMinMax("uhslc_id,time")']),
        true,
      ),
    ),
  );
  // An empty list is a broken response; taken at its word, it would retire
  // every station. Without spans, a backfill would ask for every year since 1846.
  if (!rq.length || !fd.length) throw new Error("UHSLC listed no stations");
  // The hourly lists and the daily spans are separate datasets. Every hourly
  // series needs a span, or a new version would be dated at the refresh. The
  // daily RQ set has a few records with no hourly data (391A in 2026), but
  // more than a few spans without a station is a list caught mid-reload, which
  // would retire series.
  const rqKeys = new Set(rq.map((r) => `${r.uhslc_id}${r.version}`));
  const fdKeys = new Set(fd.map((r) => `${r.uhslc_id}`));
  for (const [keys, spanKeys, name] of [
    [rqKeys, rqSpans, "research-quality"],
    [fdKeys, fdSpans, "fast-delivery"],
  ] as const)
    if ([...keys].some((k) => !spanKeys.has(k)) || spanKeys.size - keys.size > DAILY_ONLY)
      throw new Error(`UHSLC's ${name} stations and record spans disagree; try again later`);
  const included = (r: Record<string, unknown>) =>
    !EXCLUDED_COUNTRIES.has(Number(r.station_country_code));

  const versionsOf = new Map<number, string[]>();
  for (const r of rq)
    versionsOf.set(Number(r.uhslc_id), [
      ...(versionsOf.get(Number(r.uhslc_id)) ?? []),
      String(r.version),
    ]);
  const before = new Map(previous.map((s) => [s.id, s]));
  const carried = new Map<number, string>();
  const listed: UhslcStation[] = [];
  for (const r of fd.filter(included)) {
    const id = Number(r.uhslc_id);
    const span = fdSpans.get(`${id}`);
    const versions = (versionsOf.get(id) ?? []).sort().reverse();
    const startOf = (v: string) => rqSpans.get(`${id}${v}`)![0];
    // The FD series carries the RQ version it starts with: the latest, except
    // while the FD set and the RQ sets reload apart after a release. With none
    // matching, the station keeps the version the lake's list has, or on its
    // first listing takes the latest.
    const version =
      versions.find(
        (v) => span && Math.abs(Date.parse(startOf(v)) - Date.parse(span[0])) <= 2 * DAY_MS,
      ) ??
      kept(id, versions, before.get(`uhslc/${pad(id)}`)?.version) ??
      versions[0] ??
      null;
    if (version) carried.set(id, version);
    const start = version && versions.includes(version) ? startOf(version) : null;
    listed.push({
      ...toStation(r, pad(id), span),
      version,
      // A new RQ version is a new benchmark, so it opens a datum epoch from the
      // version's start, which a backfill then fills. The daily spans can start
      // a day after the hourly record, so it's dated a day early.
      reference: version ? { id: version, since: start ? dayBefore(start) : null } : null,
      // An FD series still reporting grows on every refresh, so it gets an end
      // only once it has stopped for a year, which a backfill then keeps to.
      record_end: span && Date.parse(span[1]) < Date.now() - 365 * DAY_MS ? span[1] : null,
    });
  }
  for (const r of rq.filter(included)) {
    const id = Number(r.uhslc_id);
    const version = String(r.version);
    if (carried.get(id) === version) continue;
    listed.push({
      ...toStation(r, `${pad(id)}${version.toLowerCase()}`, rqSpans.get(`${id}${version}`)),
      version,
    });
  }
  unscanned.length = 0;
  for (const s of listed) withTerms(s, before.get(s.id));
  if (unscanned.length)
    console.error(
      `  uhslc: no contributor scanned for ${unscanned.join(", ")}; tagged non-commercial until \`npm run uhslc:contributors\` reads their files`,
    );
  // Every series from one UHSLC station number is the same gauge site, and
  // so is the originator's own series where its number is a lake station's ID.
  const byNumber = new Map<string, string[]>();
  for (const s of listed) byNumber.set(number(s), [...(byNumber.get(number(s)) ?? []), s.id]);
  for (const s of listed)
    s.same_as = [
      ...byNumber.get(number(s))!.filter((id) => id !== s.id),
      ...[originatorStation(s)].filter((id) => id !== null),
    ].sort();
  refuseRegression(previous, listed);
  return listed.sort((a, b) => a.id.localeCompare(b.id));

  function toStation(
    r: Record<string, string | number | null>,
    sourceId: string,
    span: [string, string] | undefined,
  ): UhslcStation {
    const code = Number(r.station_country_code);
    const lon = Number(r.longitude);
    return {
      ...stationDefaults(metadata),
      id: `uhslc/${sourceId}`,
      source_id: sourceId,
      name: String(r.station_name),
      lat: Number(r.latitude),
      lon: lon > 180 ? lon - 360 : lon,
      country_code: COUNTRY_CODES[code] ?? countryOf(String(r.station_country)),
      kind: "coastal",
      interval_s: 3600,
      // Another reference is another label, so the refresh opens or holds an epoch for it.
      datum: labelOf(r.reference_datum),
      datums: {},
      products: ["levels"],
      first: null,
      last: null,
      tide_station: null,
      same_as: [],
      status: "active",
      // FD values arrive weeks after they're measured; nothing here is live.
      live: false,
      min_interval_s: null,
      source_url: `https://uhslc.soest.hawaii.edu/stations/?stn=${sourceId.slice(0, 3)}#levels`,
      version: null,
      contributor: null,
      originator: null,
      record_start: span?.[0] ?? null,
      record_end: span?.[1] ?? null,
    };
  }
}

/**
 * ERDDAP caught mid-reload can drop rows from a list. FD series stop only a
 * few at a time, so a list where many do is refused and the lake keeps the one
 * it has; taken at its word, it would retire them for good. A real clean-up
 * that large needs `FD_STOPPED` raised for one refresh.
 */
function refuseRegression(previous: Listed[], listed: UhslcStation[]): void {
  const now = new Set(listed.map((s) => s.id));
  const gone = previous.filter(
    (s) => s.status === "active" && s.source_id?.length === 3 && !now.has(s.id!),
  ).length;
  if (gone > FD_STOPPED)
    throw new Error(`UHSLC stopped listing ${gone} fast-delivery series at once; try again later`);
}

/** FD series one refresh may lose before the list looks partial. */
const FD_STOPPED = 5;

/**
 * A station's contributor, and the terms its documentation file adds to
 * UHSLC's: its commercial-use tag and the contributor's credit. An FD series
 * takes its RQ version's file; one with no RQ version has none, and keeps
 * UHSLC's terms. See docs/uhslc-contributors.md.
 */
function withTerms(station: UhslcStation, previous?: Listed): void {
  const fd = station.source_id.length === 3;
  // An FD series's earlier epochs hold its earlier versions' values, so it
  // takes the strictest terms and every credit of each version its epochs name.
  const versions = fd
    ? [station.version, ...(previous?.epochs ?? []).map((e) => e.reference)]
    : [station.version];
  const keys = [
    ...new Set(
      versions
        .filter((v): v is string => !!v)
        .map((v) => (fd ? `${station.source_id}${v.toLowerCase()}` : station.source_id)),
    ),
  ];
  station.contributor = keys.length ? (CONTRIBUTORS[keys[0]!]?.contributor ?? null) : null;
  station.originator = keys.length ? (CONTRIBUTORS[keys[0]!]?.originator ?? null) : null;
  const credits = [metadata.attribution];
  for (const key of keys) {
    const record = CONTRIBUTORS[key];
    // A version released since the last scan may have a file nobody has read,
    // so its terms are unknown and it isn't tagged for commercial use until a
    // rescan. A record the scan found no file for has UHSLC's terms.
    if (!record) {
      unscanned.push(key);
      station.commercial_use = false;
      continue;
    }
    if (!record.notice) continue;
    const notice = NOTICES[record.notice];
    // A notice renamed or removed since the scan leaves its terms unknown.
    if (!notice) {
      unscanned.push(key);
      station.commercial_use = false;
      continue;
    }
    if (!notice.commercial_use) station.commercial_use = false;
    const credit = notice.credit ?? record.contributor;
    if (credit && !credits.includes(credit)) credits.push(credit);
  }
  station.attribution = credits.join("; ");
}

const unscanned: string[] = [];

/**
 * The originator's own station for a series, where its contributor numbers
 * gauges as a lake source does: NOS's are CO-OPS station IDs. Other
 * contributors' numbers (SHOM's, JMA's codes) aren't their lake source's IDs,
 * so those gauges are matched by nearness and name (src/same-as.ts).
 */
export function originatorStation(
  s: Pick<UhslcStation, "contributor" | "originator">,
): string | null {
  if (/^National Ocean Service\b/.test(s.contributor ?? "") && /^\d{7}$/.test(s.originator ?? ""))
    return `coops/${s.originator}`;
  return null;
}

/**
 * The lake's version for an FD series none of whose versions starts where it
 * does. Meant for a row ERDDAP left out mid-reload; when the version is still
 * listed, the FD series has moved somewhere unexpected, which is reported.
 */
function kept(id: number, versions: string[], version?: string | null): string | null | undefined {
  if (version && versions.includes(version))
    console.error(
      `  uhslc: ${pad(id)}'s FD series no longer starts where version ${version} or any other does; keeping ${version}`,
    );
  return version;
}

function number(station: Pick<Station, "source_id">): string {
  return station.source_id.slice(0, 3);
}

/** The datum label for UHSLC's `reference_datum`. */
function labelOf(reference: unknown): string {
  return reference === REFERENCE ? DATUM : String(reference);
}

function dayBefore(day: string): string {
  return new Date(Date.parse(day) - 86_400_000).toISOString().slice(0, 10);
}

function pad(id: number): string {
  return String(id).padStart(3, "0");
}

/** First and last day by `uhslc_id` and version, from `orderByMinMax` rows (min, then max). */
function spans(rows: Record<string, string | number | null>[]): Map<string, [string, string]> {
  const out = new Map<string, [string, string]>();
  for (const r of rows) {
    const key = `${r.uhslc_id}${r.version ?? ""}`;
    const day = String(r.time).slice(0, 10);
    const span = out.get(key);
    if (span) span[1] = day;
    else out.set(key, [day, day]);
  }
  return out;
}

/**
 * Hourly levels in meters above station zero over [start, end), a calendar
 * year per request: from the FD series for `<number>`, from the RQ version for
 * `<number><version>`. RQ values are good and FD values preliminary.
 */
export async function levels(
  sourceId: string,
  start: Date,
  end: Date,
  {
    datum = DATUM,
    record_start,
    record_end,
  }: Partial<Pick<UhslcStation, "datum" | "record_start" | "record_end">> = {},
): Promise<Observation[]> {
  const match = /^(\d{3})([a-z])?$/.exec(sourceId);
  if (!match) throw new Error(`Not a UHSLC station: ${sourceId}`);
  const id = Number(match[1]);
  const version = match[2]?.toUpperCase();
  const shift = (EARLY_HOURS[id] ?? 0) * HOUR_MS;
  // The days UHSLC has, with a month's margin, since they come from its daily
  // means, which can start or end a day inside the hourly record. An FD series
  // keeps growing past its last listed day.
  const from = Math.max(
    start.getTime(),
    record_start ? Date.parse(record_start) - MARGIN_MS : -Infinity,
  );
  const to = Math.min(end.getTime(), record_end ? Date.parse(record_end) + MARGIN_MS : Infinity);
  const out: Observation[] = [];
  for (const [a, b] of years(from, to)) {
    const constraints = [
      `uhslc_id=${id}`,
      ...(version ? [`version="${version}"`] : []),
      // Labeled times, which are `shift` early.
      `time>=${new Date(a - shift).toISOString()}`,
      `time<${new Date(b - shift).toISOString()}`,
    ];
    const rows = rowsOf(
      await request(
        url(version ? RQ : FD, "time,sea_level,quality,reference_datum", constraints),
        false,
        // Only a version's values are cached: the FD series's change, and a new
        // version replaces even its RQ years under the same URL. A range cut at
        // the version's end is re-keyed if a release extends it.
        version ? (b < end.getTime() && b === to ? -Infinity : b - shift) : undefined,
      ),
    );
    for (const r of rows) {
      if (labelOf(r.reference_datum) !== datum)
        throw new DatumChanged(
          `UHSLC ${sourceId} is measured from ${r.reference_datum}, not ${datum}`,
          labelOf(r.reference_datum),
        );
      if (typeof r.sea_level !== "number") continue;
      out.push({
        time: Date.parse(String(r.time)) + shift,
        level: r.sea_level / 1000,
        flag: flagOf(r.quality),
      });
    }
  }
  return out;
}

/** Quality 4 is RQ, 3 FD; UHSLC documents no others, so they're suspect. */
function flagOf(quality: unknown): Flag {
  return quality === 4 ? Flag.good : quality === 3 ? Flag.preliminary : Flag.suspect;
}

/** [from, to) split at UTC calendar years. */
function* years(from: number, to: number): Generator<[number, number]> {
  for (let t = from; t < to;) {
    const next = Date.UTC(new Date(t).getUTCFullYear() + 1, 0, 1);
    yield [t, Math.min(next, to)];
    t = next;
  }
}

/**
 * UHSLC's ERDDAP publishes no limit; requests start a second apart so a
 * backfill's parallel stations don't crowd a small academic server.
 */
export const pacing = { requestMs: 1000 };
let nextSlot = 0;

async function pace(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + pacing.requestMs;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

/**
 * ERDDAP answers a query with no rows with 404 and says so in the body; any
 * other 404, such as a renamed dataset, fails. Station lists are fresh. A
 * range of levels ending at `end` is cached only when every value is RQ and
 * they run to its last hour, since FD values change and an RQ release can
 * extend a short year.
 */
async function request(href: string, fresh = false, end?: number): Promise<Table> {
  try {
    return await getJson<Table>(href, {
      fresh,
      pace,
      keep: (text) => end !== undefined && final(text, end),
    });
  } catch (error) {
    if (error instanceof HttpError && /produced no matching results/.test(error.body))
      return { table: { columnNames: [], rows: [] } };
    throw error;
  }
}

export function final(text: string, end: number): boolean {
  const { columnNames, rows } = (JSON.parse(text) as Table).table;
  const quality = columnNames.indexOf("quality");
  const time = columnNames.indexOf("time");
  const last = rows.at(-1)?.[time];
  return (
    rows.every((r) => r[quality] === 4) &&
    typeof last === "string" &&
    Date.parse(last) >= end - HOUR_MS
  );
}

export const source: Source = {
  metadata,
  stations,
  observations: (s, start, end) => levels(s.source_id, start, end, s as UhslcStation),
};
