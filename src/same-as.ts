import type { Station } from "./schema.ts";
import { DROPPED } from "./sources/gesla/dropped.ts";
import { km, nameScore } from "./ticon.ts";

/**
 * Which series in the lake share a gauge, and which of them to use. A link
 * comes from one of:
 *
 * - **an adapter**, from an ID the source gives: BSH names each gauge's
 *   PEGELONLINE series, UHSLC's documentation files name the originator's
 *   station number, and a source links its own series of one gauge (UHSLC's
 *   versions, RWS's twins). A link to a station another source lists more than
 *   `ID_KM` away is dropped and reported, as a wrong ID.
 * - **nearness and name**: two stations of different sources within `NEAR_KM`
 *   whose names share an identifying word and name the same side of any dam or
 *   lock. Never name alone, never within one source, since a source's own
 *   neighbors (two sides of a lock, a gauge and its backup) are its to link,
 *   and never across a `SEPARATE` pair.
 * - **a copy's best match**: a redistributor rounds positions, so a station
 *   that copies another agency's gauge, and whose adapter didn't name the
 *   original by a link that held, is linked to the station in each other source within `COPY_KM`
 *   of the same kind (where both say) that shares the most words with it, the
 *   nearest among equals, unless an equally named one more than 100 m away,
 *   which its source doesn't link to the first, leaves it in doubt.
 * - **`LINKS`**, an explicit decision.
 *
 * Linked stations form a group, and each lists every other in `same_as`. A
 * link by nearness or copy that would put two stations of one source in a
 * group is skipped, since one of them is likelier another gauge nearby
 * (except for an `ASSEMBLED` source), and
 * no link may join two stations listed in `UNLINKS`. Both are reported.
 * `preferred` names the group's series to use for observed levels, by `rank`.
 */

/** A decision on a pair of stations, with why. */
export interface Decision {
  a: string;
  b: string;
  note: string;
}

/** Pairs that share a gauge the rules below miss. */
export const LINKS: Decision[] = [
  {
    a: "gesla/uddevalla-udd-swe-cmems",
    b: "smhi/2541",
    note: "CMEMS's copy of SMHI's Uddevalla gauge: 98% of 128,161 shared hours agree within 0.5 mm. GESLA calls it a river gauge and SMHI a coastal one, so the copy rule skips it.",
  },
  {
    a: "bodc/dev",
    b: "ea/E72139",
    note: "One National Tide Gauge Network gauge, 3 m apart, which BODC names Devonport and the EA Plymouth. The EA's readings less BODC's equal NTSLF's chart datum offset to the centimeter (see the BODC README). The names share no word, so nearness doesn't link them.",
  },
  {
    a: "uhslc/805",
    b: "kartverket/VAW",
    note: "UHSLC's copy of the Norwegian Hydrographic Service's Vardø gauge, which UHSLC rounds to 70°20′N 31°06′E, 4.6 km from Kartverket's position and beyond the copy rule's 2 km.",
  },
  {
    a: "uhslc/850a",
    b: "refmar/749",
    note: "UHSLC's copy of SHOM's Ile Royale gauge, SHOM number 540 in UHSLC's documentation file. UHSLC keeps Ile Royale Anse Legoff (545) apart as 851, as REFMAR keeps 127 apart from 749, but both REFMAR names share Ile Royale's words, so the copy rule leaves it in doubt.",
  },
  {
    a: "gesla/delfzijl-delfzl-nld-rws_hist",
    b: "gesla/delfzijl-del-nld-rws",
    note: "GESLA's historic and current RWS records of Delfzijl, 0.2 km apart. The cross-station checks (scripts/cross-check.ts, November 2026) find them identical, 0.0 cm RMS a month, where they overlap in 2005 and 2006. One source's two records, so nearness doesn't link them.",
  },
  {
    a: "gesla/delfzijltg-del-nld-cmems",
    b: "gesla/delfzijl-del-nld-rws",
    note: "CMEMS's copy of RWS's Delfzijl gauge, which CMEMS names as originator, 0.3 km from GESLA's RWS record. The cross-station checks (scripts/cross-check.ts, November 2026) find them identical, 0.0 cm RMS a month from 2014. One source's two records, so nearness doesn't link them.",
  },
  {
    a: "gesla/eemshaventg-eem-nld-cmems",
    b: "gesla/eemshaven_haven-eem-nld-rws",
    note: "CMEMS's copy of RWS's Eemshaven haven gauge, 1.8 km from GESLA's RWS record. The cross-station checks (scripts/cross-check.ts, November 2026) find them 0.4 cm RMS apart in a usual month. One source's two records, so nearness doesn't link them.",
  },
  {
    a: "gesla/eemsmeetpaaltg-eem-nld-cmems",
    b: "gesla/eemshaven_waddenzee-eem-nld-rws",
    note: "CMEMS's Eems Meetpaal is RWS's Eemshaven Waddenzee gauge, 0.1 km from GESLA's RWS record. The cross-station checks (scripts/cross-check.ts, November 2026) find them identical, 0.0 cm RMS a month. One source's two records, so nearness doesn't link them.",
  },
  {
    a: "gesla/eidersptg-eid-deu-cmems",
    b: "pegelonline/9530010",
    note: "CMEMS's copy of WSA Tönning's Eider barrier gauge, at PEGELONLINE's position for Eider-Sperrwerk AP. The cross-station checks (scripts/cross-check.ts, November 2026) find them identical, 0.0 cm RMS a month. GESLA's CMEMS name says no side of the barrier, where PEGELONLINE's says the outer one (AP), so nearness doesn't link them.",
  },
  {
    a: "gesla/degerby-deg-fin-cmems",
    b: "gesla/foglo_degerby-134252-fin-fmi",
    note: "CMEMS's copy of FMI's Föglö Degerby gauge, which CMEMS names as originator, 0.3 km apart. The cross-station checks (scripts/cross-check.ts, November 2026) find them 0.9 cm RMS apart in a usual month; on the hour, 48% of 29,924 shared hours agree within 5 mm once their 11 cm datum difference is removed, so the two are processed differently, though FMI runs no other gauge there. One source's two records, so nearness doesn't link them.",
  },
  {
    a: "bodc/ptb",
    b: "ea/E72624",
    note: "The National Tide Gauge Network's Portbury gauge, which the EA names Avonmouth Portbury and places 2 km east; its other listing of the gauge, E72623, is 70 m from BODC's position. Both are in chart datum with a mean level about 7.4 m. BODC flags its whole record improbable, so its record counts as empty in `rank` and the EA's series is preferred.",
  },
  {
    a: "gesla/rostocktg-ros-deu-cmems",
    b: "pegelonline/9640018",
    note: "CMEMS's copy of WSV's Rostock Mühlendamm UW gauge: 316 of the 318 months both hold from December 1999 agree within 10 mm RMS, most to the millimeter, 4.981 m below PEGELONLINE's gauge zero, its NHN offset. The OW gauge 80 m away differs by 147 mm RMS in the median month. 'RostockTG' names no side of the weir, so nearness links neither.",
  },
  {
    a: "gesla/wangeroogetg-wan-deu-cmems",
    b: "pegelonline/9420040",
    note: "CMEMS's copy of WSV's Wangerooge West gauge, though CMEMS places it 40 m from Wangerooge Nord: 302 of the 316 months both hold from December 1999 agree within 10 mm RMS, most to the millimeter, 5.05 m below PEGELONLINE's gauge zero, its NHN offset; the rest hold CMEMS's stuck readings. Nord differs by 101 mm RMS in the median month, and in all but one month by more than 10 mm. West is 5.2 km away, beyond the copy rule's 2 km.",
  },
  {
    a: "gesla/kielholtenautg-kie-deu-cmems",
    b: "pegelonline/9610066",
    note: "CMEMS's copy of WSV's Kiel-Holtenau gauge: all 318 months both hold from December 1999 agree within 3 mm RMS, 4.997 m below PEGELONLINE's gauge zero, its NHN offset. CMEMS places it 3.3 km away, beyond the copy rule's 2 km.",
  },
  {
    a: "gesla/luebecktg-lue-deu-cmems",
    b: "pegelonline/9620090",
    note: "CMEMS's copy of WSV's Lübeck-Bauhof gauge: 307 of the 318 months both hold from December 1999 agree within 10 mm RMS, most to the millimeter, 5.021 m below PEGELONLINE's gauge zero, its NHN offset. CMEMS places it 4.8 km away, beyond the copy rule's 2 km.",
  },
];

/** Pairs that don't share a gauge, though a rule links them. */
export const UNLINKS: Decision[] = [];

/** Stations chosen as their group's preferred series, with why. */
export const PREFER: Record<string, string> = {};

/**
 * Whether a station's series is a copy of another agency's gauge, by source,
 * so the originator's own series comes first. A station carries its list's
 * own fields, such as UHSLC's `contributor`, alongside the shared ones.
 */
const REDISTRIBUTED: Record<string, (s: Station & { contributor?: string | null }) => boolean> = {
  // UHSLC runs some gauges itself; the rest it collects from their agencies.
  uhslc: (s) => s.contributor !== "University of Hawaii Sea Level Center",
  // REFMAR republishes some of UHSLC's under names ending in "UHSLC".
  refmar: (s) => /\bUHSLC\b/.test(s.name),
  // GESLA assembles other agencies' records.
  gesla: () => true,
};

export function redistributed(s: Station): boolean {
  return REDISTRIBUTED[s.source]?.(s) ?? false;
}

/**
 * Sources whose series is the copy when they share a gauge with another:
 * USACE districts relay the satellite transmissions of gauges USGS runs, and
 * USGS relays a few of CRMS's gauges in real time, named for them.
 */
const COPIES: Record<string, string> = { usace: "usgs", usgs: "crms" };

/** The stations in a group that copy another member's gauge, by `COPIES`. */
function copiesIn(group: Station[]): Set<string> {
  const sources = new Set(group.map((s) => s.source));
  return new Set(group.filter((s) => sources.has(COPIES[s.source] ?? "")).map((s) => s.id));
}

/**
 * Sources that assemble other agencies' records, often several of one gauge
 * (GESLA has NOAA's, UHSLC's and CMEMS's copies of many), so two of their
 * stations in a group are two copies, not two gauges, and don't keep groups apart.
 */
const ASSEMBLED = new Set(["gesla"]);

/**
 * Source pairs whose agencies each run their own gauges, so two of their
 * stations at one pier are separate instruments that check each other, never
 * one gauge. Only an ID or an entry in `LINKS` joins them.
 */
const SEPARATE = new Set(["coops~usgs", "coops~usace"]);

function separate(a: Station, b: Station): boolean {
  return a.source === b.source || SEPARATE.has([a.source, b.source].sort().join("~"));
}

/** Farthest apart two stations matched by nearness and name can be. */
export const NEAR_KM = 0.1;

/** Farthest a copy's station can be from the original's, since redistributors round positions. */
export const COPY_KM = 2;

/** Farthest apart two stations an ID links across sources can be before the ID is taken as wrong. */
export const ID_KM = 10;

/** A series still reporting has a value within this long. */
const REPORTING_MS = 366 * 86_400_000;

export type How = "id" | "near" | "copy" | "manual";

export interface LinkReport {
  /** Links made, by `<source>~<source>` (sorted) and how. */
  pairs: Record<string, Partial<Record<How, number>>>;
  /** Links and decisions dropped: to a station no list has, or too far away. */
  dropped: { from: string; to: string; reason: string }[];
  /** Links found but not made, since they'd join what the rules keep apart. */
  skipped: { a: string; b: string; how: How; reason: string }[];
  /** Groups of more than `LARGE` stations, worth a look. */
  large: string[][];
}

const LARGE = 8;

/** The order links join groups in: `LINKS` first, inferred ones last. */
const ORDER: How[] = ["manual", "id", "near", "copy"];

/**
 * Link every station to the others sharing its gauge, and name each group's
 * preferred series. A station with no links is its own preferred series.
 */
export function linkGauges<T extends Station>(
  stations: T[],
  now = new Date(),
  usable: Map<string, number> = new Map(),
): { stations: (T & { preferred: string })[]; report: LinkReport } {
  const byId = new Map(stations.map((s) => [s.id, s]));
  // GESLA's records whose values are another gauge's join no group.
  const alone = new Set([...DROPPED].map((file) => `gesla/${file}`).filter((id) => byId.has(id)));
  const linkable = stations.filter((s) => !alone.has(s.id));
  const edges = new Map<string, How>();
  const dropped: LinkReport["dropped"] = [];
  const skipped: LinkReport["skipped"] = [];
  const add = (a: string, b: string, how: How) => {
    const key = pairKey(a, b);
    if (a !== b && !edges.has(key) && !alone.has(a) && !alone.has(b)) edges.set(key, how);
  };

  for (const { a, b } of LINKS)
    if (alone.has(a) || alone.has(b))
      dropped.push({ from: a, to: b, reason: "LINKS names a GESLA record in DROPPED" });
    else if (byId.has(a) && byId.has(b)) add(a, b, "manual");
    else dropped.push({ from: a, to: b, reason: "LINKS names no such station" });
  for (const { a, b } of UNLINKS)
    if (!byId.has(a) || !byId.has(b))
      dropped.push({ from: a, to: b, reason: "UNLINKS names no such station" });
  for (const id of Object.keys(PREFER))
    if (!byId.has(id)) dropped.push({ from: id, to: id, reason: "PREFER names no such station" });
  /** The stations whose own `same_as` named another source's, by pair. */
  const namers = new Map<string, Set<string>>();
  for (const s of linkable)
    for (const other of s.same_as) {
      const target = byId.get(other);
      if (!target) dropped.push({ from: s.id, to: other, reason: "no such station" });
      else if (alone.has(other))
        dropped.push({ from: s.id, to: other, reason: "a GESLA record in DROPPED" });
      // A position that isn't a number can't vouch for an ID either.
      else if (target.source !== s.source && !(km(s, target) <= ID_KM))
        dropped.push({ from: s.id, to: other, reason: `${Math.round(km(s, target))} km apart` });
      else {
        add(s.id, other, "id");
        if (target.source !== s.source)
          (
            namers.get(pairKey(s.id, other)) ??
            namers.set(pairKey(s.id, other), new Set()).get(pairKey(s.id, other))!
          ).add(s.id);
      }
    }
  for (const [a, b] of nearPairs(linkable)) add(a.id, b.id, "near");
  // A copy whose adapter named its original, by a link that held, needs no
  // guess. Only the station that named it: one another source's copy names,
  // as GESLA names UHSLC's series, may still be a copy to match.
  const named = new Set<string>();
  const unlinked = new Set(UNLINKS.map(({ a, b }) => pairKey(a, b)));
  for (const [key, ids] of namers) if (!unlinked.has(key)) for (const id of ids) named.add(id);
  for (const [a, b] of copyPairs(linkable, named)) add(a.id, b.id, "copy");

  // Union-find, with each group's members kept so a merge can be refused.
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    const p = parent.get(id);
    if (!p || p === id) return id;
    const r = root(p);
    parent.set(id, r);
    return r;
  };
  const members = new Map<string, T[]>(stations.map((s) => [s.id, [s]]));
  const apart = UNLINKS.map(({ a, b }) => [a, b] as const);
  const pairs: LinkReport["pairs"] = {};
  const ordered = [...edges]
    .map(([key, how]) => {
      const [a, b] = key.split("\n").map((id) => byId.get(id)!) as [T, T];
      return { a, b, how, d: km(a, b) };
    })
    // Nearest first within each kind, then by ID, so which of two rival links wins doesn't depend on list order.
    .sort(
      (x, y) =>
        ORDER.indexOf(x.how) - ORDER.indexOf(y.how) ||
        x.d - y.d ||
        pairKey(x.a.id, x.b.id).localeCompare(pairKey(y.a.id, y.b.id)),
    );
  const count = (a: T, b: T, how: How) => {
    const counts = (pairs[[a.source, b.source].sort().join("~")] ??= {});
    counts[how] = (counts[how] ?? 0) + 1;
  };
  for (const { a, b, how } of ordered) {
    const ra = root(a.id);
    const rb = root(b.id);
    if (ra === rb) {
      count(a, b, how);
      continue;
    }
    const ga = members.get(ra)!;
    const gb = members.get(rb)!;
    const ids = (g: T[]) => new Set(g.map((s) => s.id));
    const [ia, ib] = [ids(ga), ids(gb)];
    const unlinked = apart.find(([x, y]) => (ia.has(x) && ib.has(y)) || (ia.has(y) && ib.has(x)));
    if (unlinked) {
      skipped.push({ a: a.id, b: b.id, how, reason: `UNLINKS ${unlinked.join(" ")}` });
      continue;
    }
    // Checked across the whole of both groups, so a third station can't bridge them.
    if (how === "near" || how === "copy") {
      const clash = ga.flatMap((x) =>
        gb.filter((y) => separate(x, y) && !ASSEMBLED.has(x.source)).map((y) => [x, y]),
      )[0];
      if (clash) {
        const [x, y] = clash as [T, T];
        const reason =
          x.source === y.source
            ? `would join two ${x.source} stations`
            : `would join ${x.source} and ${y.source}, which run separate gauges`;
        skipped.push({ a: a.id, b: b.id, how, reason });
        continue;
      }
    }
    parent.set(rb, ra);
    members.set(ra, [...ga, ...gb]);
    members.delete(rb);
    count(a, b, how);
  }
  const preferredOf = new Map<string, string>();
  const large: string[][] = [];
  for (const [r, group] of members) {
    const copies = copiesIn(group);
    preferredOf.set(
      r,
      group.reduce((best, s) => (rank(s, best, now, copies, usable) < 0 ? s : best)).id,
    );
    if (group.length > LARGE) large.push(group.map((s) => s.id).sort());
  }
  return {
    stations: stations.map((s) => ({
      ...s,
      same_as: members
        .get(root(s.id))!
        .map((o) => o.id)
        .filter((id) => id !== s.id)
        .sort(),
      preferred: preferredOf.get(root(s.id))!,
    })),
    report: { pairs, dropped, skipped, large },
  };
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

/**
 * Negative when `a` is the better series for the gauge's observed levels: a
 * choice in `PREFER`; one with levels; one whose terms allow commercial use, so
 * the API can serve it before tokens exist; one not from an assembled
 * collection (`ASSEMBLED`), which is the fallback; one still reporting; the
 * originator's over a copy (a redistributor's, or one of `copies`, the
 * group's `COPIES` stations); the longer record in the lake, its span from `first` to
 * `last` times its share of values not flagged suspect or bad (`usable`, by ID,
 * from the years file, or whole where unknown); the finer interval; then the
 * lower ID, so equals always break the same way.
 */
export function rank(
  a: Station,
  b: Station,
  now = new Date(),
  copies: Set<string> = new Set(),
  usable: Map<string, number> = new Map(),
): number {
  const copy = (s: Station) => redistributed(s) || copies.has(s.id);
  const levels = (s: Station) => s.products.includes("levels");
  const reporting = (s: Station) =>
    s.status === "active" && s.last !== null && now.getTime() - Date.parse(s.last) < REPORTING_MS;
  const span = (s: Station) => {
    const ms = s.first && s.last ? Date.parse(s.last) - Date.parse(s.first) : 0;
    return Number.isFinite(ms) ? ms * (usable.get(s.id) ?? 1) : 0;
  };
  const tests: [boolean | number, boolean | number][] = [
    [a.id in PREFER, b.id in PREFER],
    [levels(a), levels(b)],
    [a.commercial_use, b.commercial_use],
    [!ASSEMBLED.has(a.source), !ASSEMBLED.has(b.source)],
    [reporting(a), reporting(b)],
    [!copy(a), !copy(b)],
    [span(a), span(b)],
    [-(a.interval_s ?? Infinity), -(b.interval_s ?? Infinity)],
  ];
  for (const [x, y] of tests) if (x !== y) return Number(y) - Number(x) < 0 ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/**
 * Words that say which side of a dam, lock, weir or barrier a gauge reads: two
 * gauges there sit meters apart at different levels, so their names must
 * agree. PEGELONLINE's `OP` and `UP` are Oberpegel and Unterpegel, upstream
 * and downstream; its `BP` and `AP` the inner and outer gauge of a barrier.
 */
const SIDES: Record<string, string> = Object.fromEntries(
  Object.entries({
    up: "upper above abv headwater hw pool inflow oberwasser ow op oberpegel boven bovenstrooms",
    down: "lower below blw bl tailwater tw outflow outlet unterwasser uw up unterpegel beneden benedenstrooms",
    in: "binnen binnenpegel bp innen",
    out: "aussen aussenpegel ap buiten",
  }).flatMap(([side, words]) => words.split(" ").map((w) => [w, side])),
);

/** Compass words, which name a side only as a name's last word, as in "Control Structure - West". */
const COMPASS: Record<string, string> = {
  north: "n",
  nth: "n",
  nord: "n",
  south: "s",
  sth: "s",
  sud: "s",
  east: "e",
  ost: "e",
  west: "w",
};

function sides(name: string): string {
  const words = name
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // A trailing code such as "(76010)" isn't the name's last word.
    .replace(/\(\d+\)\s*$/, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
  const found = new Set(words.map((w) => SIDES[w]).filter(Boolean));
  const last = COMPASS[words.at(-1) ?? ""];
  if (last) found.add(last);
  return [...found].sort().join();
}

/** Pairs of stations from different sources close enough, and named alike, to be one gauge. */
export function nearPairs<T extends Station>(stations: T[]): [T, T][] {
  // Sorted by latitude, a station need only be checked against those just after it.
  const located = stations
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .sort((a, b) => a.lat - b.lat);
  const window = NEAR_KM / 111;
  const pairs: [T, T][] = [];
  for (let i = 0; i < located.length; i++) {
    const a = located[i]!;
    for (let j = i + 1; j < located.length && located[j]!.lat - a.lat <= window; j++) {
      const b = located[j]!;
      if (!separate(a, b) && km(a, b) <= NEAR_KM && alike(a, b)) pairs.push([a, b]);
    }
  }
  return pairs;
}

/** Whether two names share an identifying word and name the same side of any structure. */
function alike(a: Station, b: Station): boolean {
  return nameScore(a.name, b.name).identifying > 0 && sides(a.name) === sides(b.name);
}

/** Each copied station with its original's best match in every other source (see the top). */
export function copyPairs<T extends Station>(
  stations: T[],
  named: Set<string> = new Set(),
): [T, T][] {
  const pairs: [T, T][] = [];
  const window = COPY_KM / 111;
  for (const copy of stations.filter((s) => redistributed(s) && !named.has(s.id))) {
    const candidates = stations
      .filter((s) => !separate(copy, s) && Math.abs(s.lat - copy.lat) <= window)
      .map((s) => ({ s, d: km(copy, s), words: nameScore(copy.name, s.name).total }))
      .filter(
        // A town's name is shared by its streams, so a coastal copy matches no river.
        (c) =>
          c.d <= COPY_KM && alike(copy, c.s) && !(copy.kind && c.s.kind && copy.kind !== c.s.kind),
      );
    for (const [, matches] of Map.groupBy(candidates, (c) => c.s.source)) {
      matches.sort((x, y) => y.words - x.words || x.d - y.d || x.s.id.localeCompare(y.s.id));
      const [best, ...rest] = matches as [(typeof matches)[0], ...typeof matches];
      // A rival the source already links to the best match is the same gauge.
      const linked = (r: (typeof rest)[0]) =>
        r.s.same_as.includes(best.s.id) || best.s.same_as.includes(r.s.id);
      if (rest.some((r) => r.words === best.words && km(r.s, best.s) > 0.1 && !linked(r))) continue;
      pairs.push([copy, best.s]);
    }
  }
  return pairs;
}
