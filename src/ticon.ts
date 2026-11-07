import type { Station } from "./schema.ts";

/**
 * Which lake source can replace each TICON record in tide-database. TICON ids
 * are `<place>-<code>-<iso3>-<contributor>`, where the code is often the
 * originator's own (a NOAA station number, a PEGELONLINE number, a UHSLC id).
 */
export type Status =
  /** An adapter exists and the record matched one of its stations. */
  | "ready"
  /** Cleared for commercial use; the adapter is in the plan. */
  | "planned"
  /**
   * Cleared source with an adapter in the plan, but the record is a CMEMS copy
   * that still has to be matched to one of its stations once the adapter exists.
   */
  | "to_match"
  /** The source's terms need confirming before it can ship. */
  | "license"
  /** The source forbids what we'd do with it; stays on TICON. */
  | "restricted"
  /** An adapter exists but no station matched; check by hand. */
  | "unmatched";

export interface TiconRecord {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  contributor: string;
  /** The code TICON's id carries before the country. */
  code: string;
  iso3: string;
  commercial_use: boolean;
  epoch: { start: string; end: string };
  /** Whether a tide-database station file lists this record. */
  published: boolean;
  /** Whether tide-database's quality evaluation accepts it; rejected records still get a route. */
  accepted: boolean;
  /** The tide-database station file that lists it, as `<country>/<slug>`. */
  station?: string;
  /** The originator tide-database's provenance declares, as `source/id`. */
  declared?: string;
}

export interface Replacement {
  source: string;
  id: string | null;
  status: Status;
  distance_km?: number;
  note?: string;
}

export function parseId(id: string): { code: string; iso3: string; contributor: string } {
  const parts = id.split("-");
  return { contributor: parts.at(-1)!, iso3: parts.at(-2)!, code: parts.at(-3)! };
}

/** Lake sources for the countries whose CMEMS records copy a national feed. */
const NATIONAL: Record<string, { source: string; status: Status }> = {
  nld: { source: "rws", status: "ready" },
  deu: { source: "pegelonline", status: "ready" },
  nor: { source: "kartverket", status: "planned" },
  swe: { source: "smhi", status: "planned" },
  fra: { source: "refmar", status: "planned" },
  irl: { source: "marine-institute", status: "planned" },
  dnk: { source: "dmi", status: "planned" },
  // UK gauges are BODC's national network; UK EA may publish some of the same.
  gbr: { source: "bodc", status: "restricted" },
  fin: { source: "fmi", status: "license" },
  esp: { source: "redmar", status: "license" },
  ita: { source: "ispra", status: "license" },
};

const BODC_NOTE =
  "BODC needs permission for commercial use; where the EA runs the gauge, its own readings match instead";

/** Contributors whose records all go to one planned source. */
const DIRECT: Record<string, { source: string; status: Status; note?: string }> = {
  smhi: { source: "smhi", status: "planned" },
  refmar: { source: "refmar", status: "planned" },
  mi_c: { source: "marine-institute", status: "planned" },
  mi_r: { source: "marine-institute", status: "planned" },
  dmi: { source: "dmi", status: "planned" },
  fmi: { source: "fmi", status: "license", note: "FMI's sea-level terms not confirmed" },
  crms: { source: "crms", status: "license", note: "Louisiana CRMS terms to check" },
  cdwr: { source: "cdec", status: "license", note: "California CDEC terms to check" },
  sfwmd: { source: "sfwmd", status: "license", note: "South Florida WMD terms to check" },
  nwfwmd: { source: "nwfwmd", status: "license", note: "Northwest Florida WMD terms to check" },
  ncdem: { source: "ncdem", status: "license", note: "North Carolina DEM terms to check" },
  bom: { source: "bom", status: "license", note: "BOM license not stated" },
  unam: { source: "unam", status: "license", note: "UNAM Servicio Mareográfico terms to check" },
  unam_hist: {
    source: "unam",
    status: "license",
    note: "UNAM Servicio Mareográfico terms to check",
  },
  ispra: { source: "ispra", status: "license" },
  ieo: { source: "redmar", status: "license" },
  meds: { source: "chs", status: "restricted", note: "CHS license bars commercial derivatives" },
  bodc: { source: "bodc", status: "restricted", note: BODC_NOTE },
  noc: { source: "bodc", status: "restricted", note: BODC_NOTE },
  cmems: { source: "cmems", status: "restricted", note: "GESLA lists CMEMS as research only" },
  uz: { source: "gesla", status: "restricted", note: "GESLA lists UZ as research only" },
  cv: { source: "gesla", status: "restricted", note: "GESLA lists CV as research only" },
};

/** tide-database source prefixes, as lake sources, with each one's status. */
const DECLARED: Record<string, { source: string; status: Status }> = {
  noaa: { source: "coops", status: "planned" },
  kartverket: { source: "kartverket", status: "planned" },
  jhod: { source: "jodc", status: "license" },
  jma: { source: "jma", status: "license" },
  linz: { source: "linz", status: "license" },
};

const PEGELONLINE_NOTE = "history needs a PEGELONLINE backfill";

/**
 * Picks the replacement for one record. `lists` holds the lake's station lists
 * by source, for the sources that have adapters.
 *
 * The record's own `commercial_use` doesn't decide anything here: it describes
 * TICON's copy, and the replacement comes from the originator under the
 * originator's terms, which `status` reflects.
 */
export function replacement(record: TiconRecord, lists: Record<string, Station[]>): Replacement {
  const { contributor, code, iso3 } = record;
  if (contributor === "noaa") return byCode(record, "coops", code, "planned", lists);
  if (contributor === "usgs") {
    // TICON drops a leading zero, which can leave an 8-digit code for a 9-digit
    // site; the list says which one USGS has, and the nearer wins if it has both.
    const listed = [code, usgsSite(code), `0${code}`]
      .map((c) => lists.usgs?.find((s) => s.source_id === c && usable(s)))
      .filter((s) => s !== undefined)
      .sort((a, b) => km(record, a) - km(record, b));
    const site = listed[0]?.source_id ?? usgsSite(code);
    return byCode(record, "usgs", site, "planned", lists);
  }

  if (contributor === "wsv" || contributor === "bfg") {
    const byNumber = lists.pegelonline?.find((s) => s.source_id === code && usable(s));
    if (byNumber)
      return {
        source: "pegelonline",
        id: byNumber.id,
        status: "ready",
        distance_km: round(km(record, byNumber)),
        note: PEGELONLINE_NOTE,
      };
    return nearest(record, "pegelonline", lists.pegelonline, { note: PEGELONLINE_NOTE });
  }

  if (contributor === "rws" || contributor === "rws_hist") return nearest(record, "rws", lists.rws);

  if (contributor === "nhs")
    return { source: "kartverket", id: `kartverket/${code.toUpperCase()}`, status: "planned" };

  // A UHSLC or JODC relay of a gauge another source publishes goes to that
  // source, as tide-database's provenance declares.
  if (contributor.startsWith("uhslc") || contributor.startsWith("jodc")) {
    const [prefix, id] = record.declared?.split("/") ?? [];
    const declared = prefix ? DECLARED[prefix] : undefined;
    const relay = contributor.startsWith("uhslc") ? "UHSLC" : "JODC";
    if (declared && id) {
      const sourceId = declared.source === "kartverket" ? id.toUpperCase() : id;
      const match = byCode(record, declared.source, sourceId, declared.status, lists);
      const note = `${relay} relay of ${record.declared}`;
      return { ...match, note: match.note ? `${note}; ${match.note}` : note };
    }
    if (relay === "UHSLC") {
      // A station's latest research-quality version is part of its FD series,
      // `uhslc/<number>`, whose `version` names it.
      const [, number, version] = /^(\d{3})([a-z])$/.exec(code) ?? [];
      const carried = lists.uhslc?.some(
        (s) =>
          s.source_id === number &&
          usable(s) &&
          (s as Station & { version?: string }).version === version?.toUpperCase(),
      );
      // An FD record whose series UHSLC no longer serves is its latest version's.
      const latest = /^\d{3}$/.test(code)
        ? lists.uhslc
            ?.filter((s) => s.source_id.startsWith(code) && usable(s))
            .filter((s, _, all) => !all.some((o) => o.source_id === code))
            .map((s) => s.source_id)
            .sort()
            .at(-1)
        : undefined;
      const match = byCode(record, "uhslc", carried ? number! : (latest ?? code), "planned", lists);
      // UHSLC serves South Africa's gauges only with SANHO's permission, so the
      // adapter leaves them out; TICON also files Namibia's Lüderitz there, which UHSLC serves.
      if (iso3 === "zaf" && match.status !== "ready")
        return { source: "uhslc", id: null, status: "restricted", note: "SANHO's data" };
      // A contributor's terms can bar commercial use at a station UHSLC serves openly.
      const listed = lists.uhslc?.find((s) => s.id === match.id);
      if (match.status === "ready" && listed && !listed.commercial_use)
        return {
          ...match,
          status: "restricted",
          note: "The contributor's terms bar commercial use",
        };
      return match;
    }
    return {
      source: "jodc",
      id: null,
      status: "license",
      note: "Japanese originals also fix GESLA's year-end truncation",
    };
  }

  // The National Tide Gauge Network's records come from BODC, which needs
  // permission for commercial use; the EA serves its own readings of the same
  // gauges openly, so they match by position once the EA's list is there.
  if (
    (contributor === "bodc" ||
      contributor === "noc" ||
      (contributor === "cmems" && ["gbr", "jey", "imn"].includes(iso3))) &&
    lists.ea
  ) {
    // A record no EA gauge matches, such as a Channel Coastal Observatory or
    // overseas gauge, stays with the rules below.
    const match = nearest(record, "ea", lists.ea, {
      note: "The EA's real-time readings of the gauge",
    });
    if (match.status === "ready") return match;
  }

  if (contributor === "cmems") {
    const national = NATIONAL[iso3];
    const note = "CMEMS record of a gauge the national feed publishes";
    if (national && lists[national.source])
      return nearest(record, national.source, lists[national.source], { note });
    if (national)
      return {
        source: national.source,
        id: null,
        // Planned or ready, a CMEMS record only counts once it matches a station.
        status:
          national.status === "planned" || national.status === "ready"
            ? "to_match"
            : national.status,
        note: national.source === "bodc" ? BODC_NOTE : note,
      };
  }

  const direct = DIRECT[contributor];
  if (direct) return { source: direct.source, id: null, status: direct.status, note: direct.note };
  return { source: contributor, id: null, status: "license", note: "Terms not reviewed" };
}

/**
 * A record whose originator code names the station directly. Once the source's
 * list is loaded, the record is ready if the station is there, and unmatched if
 * it isn't; until then it has the status the source's plan gives it.
 */
function byCode(
  record: TiconRecord,
  source: string,
  sourceId: string,
  status: Status,
  lists: Record<string, Station[]>,
): Replacement {
  const list = lists[source];
  if (!list) return { source, id: `${source}/${sourceId}`, status };
  const station = list.find((s) => s.source_id === sourceId && usable(s));
  if (!station)
    return { source, id: null, status: "unmatched", note: `No ${source}/${sourceId} in the list` };
  return { source, id: station.id, status: "ready", distance_km: round(km(record, station)) };
}

/** A station that still reports levels. */
function usable(station: Station): boolean {
  return station.status === "active" && station.products.includes("levels");
}

/**
 * The best station near the record. Stations within 5 km whose names share an
 * identifying word come first, ranked by how many words they share (counting
 * words like "buiten" that can't identify a gauge alone), then by distance.
 * Without one, the nearest station within 1 km. A station within 50 m wins
 * outright, and two equally good gauges farther apart leave the record
 * unmatched. Never by name alone: RWS and CMEMS spell places differently.
 */
function nearest(
  record: TiconRecord,
  source: string,
  stations: Station[] | undefined,
  { note }: { note?: string } = {},
): Replacement {
  // Ranked by whether the names share an identifying word, then by how many
  // words they share in all, then by distance.
  let best: { station: Station; km: number; score: number } | undefined;
  const candidates: { station: Station; score: number }[] = [];
  for (const station of stations ?? []) {
    if (!usable(station)) continue;
    const d = km(record, station);
    if (d > 5) continue;
    const score = nameScore(record.name, station.name);
    if (score.identifying === 0 && d > 1) continue;
    const rank = (score.identifying > 0 ? 1000 : 0) + score.total;
    candidates.push({ station, score: rank });
    const better = !best || rank > best.score || (rank === best.score && d < best.km);
    if (better) best = { station, km: d, score: rank };
  }
  if (!best)
    return {
      source,
      id: null,
      status: "unmatched",
      note: note ? `${note}; no station within 1 km, or 5 km with a shared name` : undefined,
    };
  // A station at the record's own position (within 50 m) is the gauge, whatever
  // the names say: RWS and TICON share coordinates.
  const exact = candidates
    .map((c) => ({ ...c, km: km(record, c.station) }))
    .filter((c) => c.km <= 0.05)
    .sort((x, y) => x.km - y.km)[0];
  if (exact)
    return { source, id: exact.station.id, status: "ready", distance_km: round(exact.km), note };
  // Two equally good gauges more than 100 m apart: the name doesn't say which.
  const rival = candidates.find(
    (c) =>
      c.score === best!.score && c.station !== best!.station && km(c.station, best!.station) > 0.1,
  );
  if (rival)
    return {
      source,
      id: null,
      status: "unmatched",
      note: `Ambiguous between ${best.station.id} and ${rival.station.id}`,
    };
  return { source, id: best.station.id, status: "ready", distance_km: round(best.km), note };
}

/** Words too common in gauge names to identify one, though they still separate two. */
const COMMON = new Set([
  "noord",
  "zuid",
  "oost",
  "west",
  "north",
  "south",
  "east",
  "haven",
  "hafen",
  "harbour",
  "harbor",
  "port",
  "platform",
  "buiten",
  "binnen",
  "sluis",
  "schleuse",
  "pegel",
]);

function fold(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/([aou])e/g, "$1");
}

/**
 * Words two names share: as words, or inside a run-together name such as
 * CMEMS's "KielHoltenauTG". `identifying` counts those of four letters or more,
 * or short codes with a digit such as "A12", that aren't in `COMMON`.
 */
function nameScore(a: string, b: string): { identifying: number; total: number } {
  const words = (s: string) =>
    fold(s)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 || (w.length >= 2 && /\d/.test(w)));
  const compact = (s: string) => fold(s).replace(/[^a-z0-9]/g, "");
  const ca = compact(a);
  const cb = compact(b);
  const shared = new Set([
    ...words(b).filter((w) => ca.includes(w)),
    ...words(a).filter((w) => cb.includes(w)),
    ...[...COMMON].filter((w) => ca.includes(w) && cb.includes(w)),
  ]);
  return {
    identifying: [...shared].filter((w) => !COMMON.has(w)).length,
    total: shared.size,
  };
}

/** Whether the names share an identifying word. */
export function sharesWord(a: string, b: string): boolean {
  return nameScore(a, b).identifying > 0;
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A record left unmatched takes the match of a record in the same tide-database
 * station file, since tide-database merges records only when they're the same
 * gauge. Only when every matched record there agrees on one series. It keeps
 * the record's own note, such as why it was unmatched.
 */
export function adoptSiblings<T extends { record: TiconRecord; replacement: Replacement }>(
  rows: T[],
  stations: Station[] = [],
): T[] {
  const byStation = Map.groupBy(
    rows.filter((r) => r.record.station),
    (r) => r.record.station!,
  );
  return rows.map((row) => {
    if (row.replacement.status !== "unmatched" || !row.record.station) return row;
    const matched = byStation
      .get(row.record.station)!
      .filter(
        (r) => r.replacement.status === "ready" && r.replacement.source === row.replacement.source,
      );
    const ids = new Set(matched.map((r) => r.replacement.id));
    if (ids.size !== 1) return row;
    const sibling = matched[0]!;
    return {
      ...row,
      replacement: {
        source: sibling.replacement.source,
        id: sibling.replacement.id,
        status: "ready",
        ...distanceTo(
          row.record,
          stations.find((s) => s.id === sibling.replacement.id),
        ),
        note: [`Same tide-database station as ${sibling.record.id}`, row.replacement.note]
          .filter(Boolean)
          .join("; "),
      },
    };
  });
}

function distanceTo(record: TiconRecord, station: Station | undefined): { distance_km?: number } {
  return station ? { distance_km: round(km(record, station)) } : {};
}

/**
 * USGS site numbers are mostly 8, 10 or 15 digits, often with a leading zero
 * that TICON's ids drop. Restore it to the next of those lengths. A few sites
 * have 9 digits, which `replacement` finds by checking the station list.
 */
export function usgsSite(code: string): string {
  const length =
    code.length < 8 ? 8 : code.length === 9 ? 10 : code.length === 14 ? 15 : code.length;
  return code.padStart(length, "0");
}
